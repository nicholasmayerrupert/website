import { initSandWasm, createEngineWasm } from '../wasmBridge/engineFactory.js';
import { CREATIVE_KIND } from '../wasmBridge/abi.generated.js';

const WORLD_STEP_MS = 16;
const STREAM_MARGIN = 40;

let engine = null;
let timer = 0;
let epoch = 1;
let sequence = 0;
let awaitingAck = false;
let control = null;
let edges = [];
let creativeKind = 0;
let creativeValue = 0;
let creatureNaturalSpawning = false;
let creatureSimulationRequested = false;
let workerButtons = 0;
let paused = false;
let draftRevision = 0;
let lastDraftSignature = '';
let rateStart = performance.now();
let rateSteps = 0;
let lastStepMs = 0;
let artificialDelayMs = 0;
let lastStatsPost = 0;
let controlsReceived = 0;
let edgesProcessed = 0;
let toolWrites = 0;
let resizeId = 0;
let mirroredCreatures = false;

const postBytes = (message, bytes) => {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  self.postMessage({ ...message, data }, [data]);
};

function perf() {
  const elapsed = Math.max(1, performance.now() - rateStart);
  return { worldTps: rateSteps * 1000 / elapsed, stepMs: lastStepMs, controlsReceived, edgesProcessed, toolWrites };
}

function postDraft() {
  const view = engine.getStoneDraftCells();
  const cells = Int32Array.from(view);
  // Avoid transferring the same preview every world tick while the pointer is still.
  let signature = `${creativeValue}:${cells.length}`;
  for (let i = 0; i < cells.length; i++) signature += `:${cells[i]}`;
  if (signature === lastDraftSignature) return;
  lastDraftSignature = signature;
  const data = cells.buffer;
  self.postMessage({ type: 'draft', epoch, revision: ++draftRevision, material: creativeValue, data }, [data]);
}

function postCreatures() {
  const creatures = engine.getCreatureSnapshotData();
  if (!creatures.length && !mirroredCreatures) return;
  mirroredCreatures = creatures.length > 0;
  const data = creatures.buffer;
  self.postMessage({
    type: 'creatures', worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(), data,
  }, [data]);
}

function applyCreatureRuntime() {
  if (creativeKind === CREATIVE_KIND.CREATURE) creatureSimulationRequested = true;
  engine.setCreatureRuntime(creatureNaturalSpawning || creatureSimulationRequested, creatureNaturalSpawning);
}

function postFull(reason) {
  sequence++;
  awaitingAck = true;
  const bytes = engine.serializeWorld();
  engine.consumeReplicaDirty();
  postBytes({
    type: 'full', epoch, sequence, reason,
    resizeId,
    cols: engine.cols, rows: engine.rows,
    worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(),
    worldTick: engine.getTick(), perf: perf(),
  }, bytes);
}

function postDiffIfReady() {
  if (awaitingAck) return;
  const bytes = engine.serializeDiff();
  if (bytes.length <= 4) return; // two empty layer headers
  sequence++;
  awaitingAck = true;
  engine.consumeReplicaDirty();
  postBytes({ type: 'diff', epoch, sequence, worldTick: engine.getTick(), perf: perf() }, bytes);
}

function toLocal(worldX, worldY) {
  return {
    x: Math.floor(worldX - engine.getWorldOffsetX()),
    y: Math.floor(worldY - engine.getWorldOffsetY()),
  };
}

function streamForControl() {
  if (!control) return false;
  const localX = Math.floor(control.camWorldX - engine.getWorldOffsetX());
  const dx = engine.maybeShiftWorld(localX, control.viewCols, STREAM_MARGIN);
  const localY = Math.floor(control.camWorldY - engine.getWorldOffsetY());
  const dy = engine.maybeShiftWorldV(localY, control.viewRows, STREAM_MARGIN);
  return !!(dx || dy);
}

function applyEdges() {
  for (const edge of edges) {
    edgesProcessed++;
    const p = toLocal(edge.worldX, edge.worldY);
    if (edge.kind === 'down') {
      workerButtons |= edge.button === 2 ? 2 : 1;
      if (control) control.buttons = edge.buttons | 0;
      engine.pointerDown(p.x, p.y, edge.button);
    }
    else {
      engine.pointerDraft(p.x, p.y);
      engine.pointerUp(edge.button);
      workerButtons &= ~(edge.button === 2 ? 2 : 1);
      if (control) control.buttons = edge.buttons | 0;
    }
  }
  edges = [];
}

function applyContinuous(now) {
  if (!control) return;
  const released = workerButtons & ~(control.buttons | 0);
  if (released & 1) engine.pointerUp(0);
  if (released & 2) engine.pointerUp(2);
  workerButtons = control.buttons | 0;
  engine.pointerButtons(control.buttons | 0);
  const p = toLocal(control.worldX, control.worldY);
  engine.pointerDraft(p.x, p.y);
  if (engine.applyTool(p.x, p.y, now, !!control.inside, !!control.drawMode)) toolWrites++;
}

function schedule(delay = WORLD_STEP_MS) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (!engine) return;
  const started = performance.now();
  if (paused) { schedule(WORLD_STEP_MS); return; }
  const shifted = streamForControl();
  applyEdges();
  applyContinuous(started);
  const stepStart = performance.now();
  // The DEV delay hook isolates scheduling without burning a browser CPU core;
  // normal production turns always execute the real WASM world step here.
  if (artificialDelayMs <= 0) engine.stepWorld();
  engine.stepActors();
  lastStepMs = artificialDelayMs > 0 ? artificialDelayMs : performance.now() - stepStart;
  rateSteps++;
  if (started - lastStatsPost >= 250) {
    lastStatsPost = started;
    self.postMessage({ type: 'stats', worldTick: engine.getTick(), perf: perf(), epoch, sequence });
  }
  postDraft();
  postCreatures();
  if (shifted) {
    epoch++;
    sequence = 0;
    awaitingAck = false;
    postFull('stream');
  } else {
    postDiffIfReady();
  }
  const targetTurnMs = artificialDelayMs > 0 ? artificialDelayMs : WORLD_STEP_MS;
  schedule(Math.max(0, targetTurnMs - (performance.now() - started)));
}

self.onmessage = async ({ data }) => {
  if (!data) return;
  if (data.type === 'init') {
    clearTimeout(timer);
    await initSandWasm();
    engine?.destroy();
    engine = createEngineWasm({
      cols: data.cols, rows: data.rows, worldSeed: data.worldSeed >>> 0,
      infinite: true, sinksOn: false,
    });
    engine.setPlayMode(false);
    engine.setDrawMode(!!data.drawMode);
    creativeKind = data.creativeKind | 0;
    creativeValue = data.creativeValue | 0;
    creatureNaturalSpawning = !!data.creatureNaturalSpawning;
    creatureSimulationRequested = false;
    engine.setCreativeMaterial(creativeKind, creativeValue);
    applyCreatureRuntime();
    // Preserve the selected startup tool. The initial creative selection is an
    // EMPTY placeholder until the palette emits a real material selection.
    engine.setTool(data.tool | 0);
    epoch = 1; sequence = 0; awaitingAck = false; resizeId = 0; control = null; edges = []; workerButtons = 0; mirroredCreatures = false;
    rateStart = performance.now(); rateSteps = 0; lastStepMs = 0;
    postFull('init');
    schedule();
    return;
  }
  if (!engine) return;
  if (data.type === 'ack') {
    if (data.epoch === epoch && data.sequence === sequence) awaitingAck = false;
  } else if (data.type === 'control') {
    controlsReceived++;
    control = data;
  } else if (data.type === 'edge') {
    edges.push(data);
  } else if (data.type === 'config') {
    if (data.tool !== undefined) engine.setTool(data.tool | 0);
    if (data.drawMode !== undefined) engine.setDrawMode(!!data.drawMode);
    if (data.paused !== undefined) paused = !!data.paused;
    if (data.artificialDelayMs !== undefined) artificialDelayMs = Math.max(0, Math.min(100, +data.artificialDelayMs || 0));
    if (data.creativeKind !== undefined) {
      creativeKind = data.creativeKind | 0;
      creativeValue = data.creativeValue | 0;
      engine.setCreativeMaterial(creativeKind, creativeValue);
    }
    if (data.creatureNaturalSpawning !== undefined) creatureNaturalSpawning = !!data.creatureNaturalSpawning;
    if (data.creativeKind !== undefined || data.creatureNaturalSpawning !== undefined) applyCreatureRuntime();
  } else if (data.type === 'resize') {
    awaitingAck = false;
    resizeId = data.resizeId | 0;
    if (engine.resizeLoadedWindow(data.cols | 0, data.rows | 0)) {
      epoch++;
      sequence = 0;
      postFull('resize');
    } else postFull('resize');
  } else if (data.type === 'destroy') {
    clearTimeout(timer);
    engine.destroy();
    engine = null;
  }
};
