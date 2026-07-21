import { initSandWasm, createEngineWasm } from '../wasmBridge/engineFactory.js';
import { CREATIVE_KIND } from '../wasmBridge/abi.generated.js';
import { MAT_FLAGS, MF } from '../materials.generated.js';
import { MAT } from '../materials.js';
import { createFixedRateClock } from '../timing/fixedRateClock.js';

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
let survival = false;
let localPlayerId = 0;
let latestInput = null;
let actorClock = null;
let lastInventoryHash = -1;
let lastItemsActorTick = -6;

function seedReactionInterface(material, cap, phase) {
  const grid = engine.getGrid(), cols = engine.cols, rows = engine.rows;
  const sourceFlag = material === MAT.FIRE ? MF.flammable : MF.dissolvable;
  let count = 0;
  const yStart = 2 + ((phase | 0) * 97) % Math.max(1, rows - 4);
  for (let yo = 0; yo < rows - 4 && count < cap; yo++) {
    const y = 2 + ((yStart - 2 + yo) % (rows - 4)), rb = y * cols;
    for (let x = 2 + (((phase | 0) * 53 + y * 7) % 11); x < cols - 2 && count < cap; x += 11) {
      const k = rb + x;
      if (grid[k] !== MAT.EMPTY) continue;
      if (![k - 1, k + 1, k - cols, k + cols].some((q) => (MAT_FLAGS[grid[q]] & sourceFlag) !== 0)) continue;
      if (engine.paintDisc(x, y, 0, material, false)) count++;
    }
  }
  toolWrites += count;
}

const postBytes = (message, bytes) => {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  self.postMessage({ ...message, data }, [data]);
};

function perf() {
  const elapsed = Math.max(1, performance.now() - rateStart);
  const parallel = engine?.getPerf?.() || {};
  return {
    ...parallel,
    worldTps: rateSteps * 1000 / elapsed, stepMs: lastStepMs, actorMs: parallel.actorMs || 0,
    actorTick: engine?.getActorTick?.() || 0,
    creatureCount: engine?.creatureCount?.() || 0,
    itemCount: engine?.itemCount?.() || 0,
    controlsReceived, edgesProcessed, toolWrites,
  };
}

function postDraft() {
  const view = engine.getStoneDraftCells();
  const cells = Int32Array.from(view);
  // Avoid transferring the same preview every world tick while the pointer is still.
  const inv = cells.length && survival && localPlayerId ? engine.getInventory(localPlayerId) : null;
  const material = inv?.slots?.[inv.selected]?.material ?? creativeValue;
  let signature = `${material}:${cells.length}`;
  for (let i = 0; i < cells.length; i++) signature += `:${cells[i]}`;
  if (signature === lastDraftSignature) return;
  lastDraftSignature = signature;
  const data = cells.buffer;
  self.postMessage({ type: 'draft', epoch, revision: ++draftRevision, material, data }, [data]);
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

function postActors(force = false) {
  if (!survival || !localPlayerId) return;
  const players = engine.getPlayers();
  const inventoryHash = engine.inventoryHash(localPlayerId);
  const inventoryChanged = force || inventoryHash !== lastInventoryHash;
  if (inventoryChanged) lastInventoryHash = inventoryHash;
  const actorTick = engine.getActorTick();
  const itemsChanged = force || actorTick - lastItemsActorTick >= 6;
  const items = itemsChanged ? engine.getItems().filter((item) => item.kind === 0) : undefined;
  if (itemsChanged) lastItemsActorTick = actorTick;
  const player = players.find((candidate) => candidate.id === localPlayerId) || null;
  self.postMessage({
    type: 'actors', epoch, actorTick, localPlayerId, players,
    mineProgress: engine.getPlayerMineProgress(localPlayerId),
    mineTarget: engine.getPlayerMineTarget(localPlayerId),
    actionCount: engine.getPlayerActionCount(),
    inventory: inventoryChanged ? engine.getInventory(localPlayerId) : undefined,
    cursor: inventoryChanged ? engine.getCursor(localPlayerId) : undefined,
    items,
    projectiles: engine.getProjectiles(),
    ackSeq: player?.inputSeq ?? 0,
  });
}

function postSounds() {
  const sounds = engine.drainSoundEvents();
  if (!sounds.length) return;
  const data = sounds.buffer;
  self.postMessage({ type: 'sounds', epoch, data }, [data]);
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
  if (!control || control.suspendStreaming) return false;
  // A viewport must fit inside the loaded window before edge streaming has a
  // meaningful answer. This also makes the worker robust to a resize/control
  // message reordering: an oversized view otherwise satisfies an edge test on
  // every world turn and races the world offset away from the camera.
  if (control.viewCols + STREAM_MARGIN * 2 > engine.cols ||
      control.viewRows + STREAM_MARGIN * 2 > engine.rows) return false;
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
    // An edge is a complete pointer sample, while `control` may still describe
    // the previous RAF (or the previous touch). Keep the continuous state in
    // lockstep with the edge before applying it, otherwise this same world turn
    // can start a draft at the new press and immediately extend it back to the
    // stale control point.
    if (control) {
      control.worldX = edge.worldX;
      control.worldY = edge.worldY;
      control.buttons = edge.buttons | 0;
      control.inside = !!edge.inside;
      control.drawMode = !!edge.drawMode;
    }
    if (edge.kind === 'down') {
      workerButtons |= edge.button === 2 ? 2 : 1;
      engine.pointerDown(p.x, p.y, edge.button);
    }
    else {
      engine.pointerDraft(p.x, p.y);
      engine.pointerUp(edge.button);
      workerButtons &= ~(edge.button === 2 ? 2 : 1);
    }
  }
  edges = [];
}

function applyContinuous(now) {
  if (survival || !control) return;
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
  if (paused) { actorClock?.reset(started); schedule(WORLD_STEP_MS); return; }
  const shifted = streamForControl();
  if (!survival) {
    applyEdges();
    applyContinuous(started);
  }
  const stepStart = performance.now();
  actorClock?.advance(started, () => {
    if (survival && latestInput && localPlayerId) {
      const aimX = Math.floor(latestInput.worldAimX - engine.getWorldOffsetX());
      const aimY = Math.floor(latestInput.worldAimY - engine.getWorldOffsetY());
      engine.setPlayerInput(localPlayerId, { ...latestInput, aimX, aimY });
    }
    engine.stepActors();
  });
  // The DEV delay hook isolates scheduling without burning a browser CPU core;
  // normal production turns always execute the real WASM world step here.
  if (artificialDelayMs <= 0) engine.stepWorld();
  postSounds();
  lastStepMs = artificialDelayMs > 0 ? artificialDelayMs : performance.now() - stepStart;
  rateSteps++;
  if (started - lastStatsPost >= 250) {
    lastStatsPost = started;
    self.postMessage({ type: 'stats', worldTick: engine.getTick(), perf: perf(), epoch, sequence });
  }
  postDraft();
  postCreatures();
  postActors();
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
    try {
      await initSandWasm();
    } catch (error) {
      self.postMessage({ type: 'error', phase: 'init', message: error?.message || String(error) });
      return;
    }
    engine?.destroy();
    engine = createEngineWasm({
      cols: data.cols, rows: data.rows, worldSeed: data.worldSeed >>> 0,
      infinite: true, sinksOn: false, storageRole: 'authority',
    });
    survival = !!data.survival;
    engine.setPlayMode(survival);
    engine.setSurvivalInventory(survival);
    engine.setDrawMode(!!data.drawMode);
    creativeKind = data.creativeKind | 0;
    creativeValue = data.creativeValue | 0;
    creatureNaturalSpawning = !!data.creatureNaturalSpawning;
    creatureSimulationRequested = false;
    engine.setCreativeMaterial(creativeKind, creativeValue);
    if (survival) engine.setCreatureRuntime(true, true);
    else applyCreatureRuntime();
    // Preserve the selected startup tool. The initial creative selection is an
    // EMPTY placeholder until the palette emits a real material selection.
    engine.setTool(data.tool | 0);
    localPlayerId = survival ? engine.spawnPlayerAtSurface(Math.floor(data.cols / 2)) : 0;
    latestInput = null;
    actorClock = createFixedRateClock({ now: performance.now() });
    lastInventoryHash = -1; lastItemsActorTick = -6;
    epoch = 1; sequence = 0; awaitingAck = false; resizeId = 0; control = null; edges = []; workerButtons = 0; mirroredCreatures = false;
    rateStart = performance.now(); rateSteps = 0; lastStepMs = 0;
    postFull('init');
    postActors(true);
    schedule();
    return;
  }
  if (!engine) return;
  if (data.type === 'ack') {
    if (data.epoch === epoch && data.sequence === sequence) awaitingAck = false;
  } else if (data.type === 'control') {
    controlsReceived++;
    control = data;
  } else if (data.type === 'input') {
    latestInput = data.input || null;
  } else if (data.type === 'intent' && survival && localPlayerId) {
    switch (data.intent) {
      case 'select': engine.setSelectedSlot(localPlayerId, data.slot | 0); break;
      case 'size': engine.setSelectedFootprint(localPlayerId, data.footprint | 0); break;
      case 'move': engine.inventoryMove(localPlayerId, data.from | 0, data.to | 0); break;
      case 'pick': engine.inventoryCursorPick(localPlayerId, data.slot | 0, !!data.half); break;
      case 'throw': engine.throwFromCursor(localPlayerId, !!data.whole); break;
      case 'craft': engine.craft(localPlayerId, data.recipe | 0, !!data.max); break;
      case 'respawn': engine.respawnPlayer(localPlayerId); break;
      case 'add': engine.addToInventory(localPlayerId, data.material | 0, data.count | 0); break;
      case 'set-player-state': {
        const player = engine.getPlayer(localPlayerId);
        if (player) engine.setPlayerState(localPlayerId, { ...player, ...(data.state || {}) });
        break;
      }
      default: break;
    }
    postActors(true);
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
    if (!survival && (data.creativeKind !== undefined || data.creatureNaturalSpawning !== undefined)) applyCreatureRuntime();
  } else if (data.type === 'test-paint-disc') {
    const p = toLocal(data.worldX, data.worldY);
    if (engine.paintDisc(p.x, p.y, Math.max(1, data.radius | 0), data.material | 0, false)) toolWrites++;
  } else if (data.type === 'test-seed-reaction') {
    seedReactionInterface(data.material | 0, Math.max(1, data.cap | 0), data.phase | 0);
  } else if (data.type === 'resize') {
    awaitingAck = false;
    resizeId = data.resizeId | 0;
    // The authority does not render, so its internal camera normally remains at
    // startup. Give resizeLoadedWindow the presentation's exact world center;
    // otherwise its full snapshot can be re-anchored around that stale camera
    // and clamp the visible mirror after a second mobile zoom.
    if (Number.isFinite(data.worldCenterX) && Number.isFinite(data.worldCenterY)) {
      engine.setViewport(1, 1, 1, 1);
      engine.cameraSet(
        data.worldCenterX - engine.getWorldOffsetX() - 0.5,
        data.worldCenterY - engine.getWorldOffsetY() - 0.5,
      );
    }
    // The last control describes the pre-resize viewport. Wait for a fresh one
    // from the main thread after it accepts this full snapshot.
    control = null;
    if (engine.resizeLoadedWindow(data.cols | 0, data.rows | 0)) {
      epoch++;
      sequence = 0;
      postFull('resize');
    } else postFull('resize');
  } else if (data.type === 'destroy') {
    clearTimeout(timer);
    engine.destroy();
    engine = null;
    self.postMessage({ type: 'destroyed' });
    self.close();
  }
};
