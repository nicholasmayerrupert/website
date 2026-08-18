import { initSandWasm, createEngineWasm } from '../wasmBridge/engineFactory.js';
import {
  ABI_FINGERPRINT,
  ABI_VERSION,
  CREATIVE_KIND,
  CREATURE,
  ITEM_KIND,
  MISSION,
  PLANET,
  PLANET_GAMEPLAY_FLAG,
  planetHasGameplayFlag,
} from '../wasmBridge/abi.generated.js';
import {
  copyReplayValue,
  REPLAY_EVENT_TYPES,
  REPLAY_FORMAT,
  REPLAY_VERSION,
  validateReplayCapsule,
} from '../game/replayCapsule.js';
import { isMaterialId, MAT_FLAGS, MF } from '../materials.generated.js';
import { MAT } from '../materials.js';
import { createTurnDeadline, SIM_STEP_MS } from '../timing/fixedRateClock.js';
import {
  encodeWorkerLiveness,
  WORKER_LIVENESS_STAGE,
} from './workerLiveness.js';

const STREAM_MARGIN = 40;
const LIVE_SIM_COLS = 512;
const LIVE_SIM_ROWS = 352;

let engine = null;
let timer = 0;
let epoch = 1;
let sequence = 0;
let awaitingAck = false;
let fullResyncRequested = false;
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
let lightEditX0 = Infinity;
let lightEditX1 = -Infinity;
let lastToolWriteX = null;
let resizeId = 0;
let mirroredCreatures = false;
let survival = false;
let survivalSpawnViewReady = false;
let localPlayerId = 0;
let missionId = MISSION.NONE;
let activePlanetId = PLANET.EARTH;
let latestInput = null;
let lastInventoryHash = -1;
let liveSimulationFocus = null;
let closing = false;
let initGeneration = 0;
let pendingRuntimeConfig = null;
let pendingResize = null;
let livenessStage = WORKER_LIVENESS_STAGE.INITIALIZING;
let livenessTurn = 0;
let livenessProbeArmed = false;
let replayCapture = null;
let replayCaptureStarting = false;
let replayInputSignature = '';
let replayRunning = false;
let replayTransportSuppressed = false;
const turnDeadline = createTurnDeadline({ now: performance.now() });

function replayInitOptions(data) {
  const options = copyReplayValue(data);
  delete options.type;
  return options;
}

function beginReplayCapture(data) {
  replayCaptureStarting = true;
  replayInputSignature = '';
  replayCapture = {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    abiVersion: ABI_VERSION,
    abiFingerprint: ABI_FINGERPRINT,
    init: replayInitOptions(data),
    events: [],
    turns: [],
  };
}

function recordReplayMessage(data) {
  if (!replayCapture || replayRunning || !REPLAY_EVENT_TYPES.has(data.type)) return;
  if (data.type === 'input') return;
  replayCapture.events.push({
    tick: replayCaptureStarting ? 0 : replayCapture.turns.length,
    message: copyReplayValue(data),
  });
}

function recordReplayTurn(started) {
  let inputSeq = null;
  if (latestInput) {
    inputSeq = latestInput.seq >>> 0;
    const inputState = copyReplayValue(latestInput);
    delete inputState.seq;
    const signature = JSON.stringify(inputState);
    if (signature !== replayInputSignature) {
      replayInputSignature = signature;
      replayCapture.events.push({
        tick: replayCapture.turns.length,
        message: { type: 'input', input: copyReplayValue(latestInput) },
      });
    }
  }
  replayCapture.turns.push({
    now: started,
    awaitingAck,
    fullResyncRequested,
    inputSeq,
  });
}

function replayFinalState() {
  const perfState = engine.getPerf();
  return {
    tick: engine.getTick(),
    actorTick: engine.getActorTick(),
    gridHash: engine.gridHash(),
    worldOffsetX: engine.getWorldOffsetX(),
    worldOffsetY: engine.getWorldOffsetY(),
    cols: engine.cols,
    rows: engine.rows,
    componentCount: perfState.componentCount || 0,
    componentCellCount: perfState.componentCellCount || 0,
    crossBondCount: perfState.crossBondCount || 0,
    playerCount: engine.getPlayers().length,
    itemCount: engine.itemCount(),
    creatureCount: engine.creatureCount(),
    projectileCount: engine.getProjectiles().length,
  };
}

function replayStateMatches(expected, actual) {
  return [
    'tick', 'actorTick', 'gridHash', 'worldOffsetX', 'worldOffsetY',
    'cols', 'rows', 'componentCount', 'componentCellCount', 'crossBondCount',
    'playerCount', 'itemCount', 'creatureCount', 'projectileCount',
  ].every((key) => expected[key] === actual[key]);
}

function setLivenessStage(stage, publish = false) {
  livenessStage = stage;
  if (!publish) return;
  self.postMessage(encodeWorkerLiveness(
    stage, livenessTurn, awaitingAck, !!control,
  ));
}

function shutdown() {
  if (closing) return;
  closing = true;
  initGeneration++;
  clearTimeout(timer);
  const doomed = engine;
  engine = null;
  try { doomed?.destroy(); } catch { /* the worker is closing regardless */ }
  try { self.postMessage({ type: 'destroyed' }); } catch { /* the worker is closing */ }
  self.close();
}

function noteLightEdit(x, radius = 4) {
  if (!Number.isFinite(x)) return;
  const from = Number.isFinite(lastToolWriteX) ? lastToolWriteX : x;
  lightEditX0 = Math.min(lightEditX0, from - radius, x - radius);
  lightEditX1 = Math.max(lightEditX1, from + radius, x + radius);
  lastToolWriteX = x;
}

function seedReactionInterface(material, cap, phase) {
  const grid = engine.getGrid(), cols = engine.cols, rows = engine.rows;
  const sourceFlag = material === MAT.FIRE ? MF.flammable : MF.dissolvable;
  const offsetX = engine.getWorldOffsetX(), offsetY = engine.getWorldOffsetY();
  const focus = liveSimulationFocus;
  const x0 = focus ? Math.max(2, focus.x0 - offsetX) : 2;
  const x1 = focus ? Math.min(cols - 2, focus.x1 - offsetX) : cols - 2;
  const y0 = focus ? Math.max(2, focus.y0 - offsetY) : 2;
  const y1 = focus ? Math.min(rows - 2, focus.y1 - offsetY) : rows - 2;
  const height = Math.max(0, y1 - y0);
  let count = 0;
  const yStart = y0 + ((phase | 0) * 97) % Math.max(1, height);
  for (let yo = 0; yo < height && count < cap; yo++) {
    const y = y0 + ((yStart - y0 + yo) % height), rb = y * cols;
    for (let x = x0 + (((phase | 0) * 53 + y * 7) % 11);
         x < x1 && count < cap; x += 11) {
      const k = rb + x;
      if (grid[k] !== MAT.EMPTY) continue;
      if (![k - 1, k + 1, k - cols, k + cols].some((q) => (MAT_FLAGS[grid[q]] & sourceFlag) !== 0)) continue;
      if (engine.paintDisc(x, y, 0, material, false)) count++;
    }
  }
  toolWrites += count;
}

const postBytes = (message, bytes) => {
  if (replayTransportSuppressed) return;
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  self.postMessage({ ...message, data }, [data]);
};

function perf() {
  const elapsed = Math.max(1, performance.now() - rateStart);
  const parallel = engine?.getPerf?.() || {};
  return {
    ...parallel,
    worldTps: rateSteps * 1000 / elapsed, stepMs: lastStepMs, actorMs: parallel.actorMs || 0,
    wasmHeapBytes: engine?.getHeapBytes?.() || 0,
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
  if (replayTransportSuppressed) return;
  const data = cells.buffer;
  self.postMessage({
    type: 'draft', epoch, revision: ++draftRevision, material,
    worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(), data,
  }, [data]);
}

function postCreatures() {
  const creatures = engine.getCreatureSnapshotData();
  if (!creatures.length && !mirroredCreatures) return;
  mirroredCreatures = creatures.length > 0;
  if (replayTransportSuppressed) return;
  const data = creatures.buffer;
  self.postMessage({
    type: 'creatures', epoch,
    worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(), data,
  }, [data]);
}

function postActors(force = false) {
  if (!survival || !localPlayerId) return;
  const players = engine.getPlayers();
  const inventoryHash = engine.inventoryHash(localPlayerId);
  const inventoryChanged = force || inventoryHash !== lastInventoryHash;
  if (inventoryChanged) lastInventoryHash = inventoryHash;
  const actorTick = engine.getActorTick();
  // The browser mirror renders every authority item at actor cadence, including
  // cosmetic mining debris. A transferred packed snapshot avoids allocating an
  // object per item; multiplayer keeps its lower-bandwidth collectible-only path.
  const itemData = engine.getItemSnapshotData();
  const projectileData = engine.getProjectileSnapshotData();
  const player = players.find((candidate) => candidate.id === localPlayerId) || null;
  if (replayTransportSuppressed) return;
  const itemBuffer = itemData.buffer;
  const projectileBuffer = projectileData.buffer;
  self.postMessage({
    type: 'actors', epoch, actorTick, localPlayerId, players,
    worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(),
    mineProgress: engine.getPlayerMineProgress(localPlayerId),
    mineTarget: engine.getPlayerMineTarget(localPlayerId),
    actionCount: engine.getPlayerActionCount(),
    inventory: inventoryChanged ? engine.getInventory(localPlayerId) : undefined,
    cursor: inventoryChanged ? engine.getCursor(localPlayerId) : undefined,
    itemData: itemBuffer,
    projectileData: projectileBuffer,
    mission: missionId ? engine.getMission() : null,
    ackSeq: player?.inputSeq ?? 0,
  }, [itemBuffer, projectileBuffer]);
}

function postSounds() {
  const sounds = engine.drainSoundEvents();
  if (!sounds.length || replayTransportSuppressed) return;
  const data = sounds.buffer;
  self.postMessage({ type: 'sounds', epoch, data }, [data]);
}

function applyCreatureRuntime() {
  if (creativeKind === CREATIVE_KIND.CREATURE) creatureSimulationRequested = true;
  engine.setCreatureRuntime(creatureNaturalSpawning || creatureSimulationRequested, creatureNaturalSpawning);
}

function applyRuntimeConfig(data) {
  if (data.tool !== undefined) engine.setTool(data.tool | 0);
  if (data.drawMode !== undefined) engine.setDrawMode(!!data.drawMode);
  if (data.paused !== undefined) {
    paused = !!data.paused;
    if (paused) setLivenessStage(WORKER_LIVENESS_STAGE.PAUSED);
  }
  if (data.artificialDelayMs !== undefined)
    artificialDelayMs = Math.max(0, Math.min(100, +data.artificialDelayMs || 0));
  if (data.creativeKind !== undefined) {
    creativeKind = data.creativeKind | 0;
    creativeValue = data.creativeValue | 0;
    engine.setCreativeMaterial(creativeKind, creativeValue);
  }
  if (data.creatureNaturalSpawning !== undefined)
    creatureNaturalSpawning = !!data.creatureNaturalSpawning;
  if (!survival && (data.creativeKind !== undefined
      || data.creatureNaturalSpawning !== undefined)) applyCreatureRuntime();
}

function applyResize(data) {
  awaitingAck = false;
  fullResyncRequested = false;
  resizeId = data.resizeId | 0;
  if (survival) {
    survivalSpawnViewReady = false;
    engine.setCreatureRuntime(true, false);
  }
  // The authority does not render, so its internal camera normally remains at
  // startup. Give resizeLoadedWindow the presentation's exact world center.
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
  liveSimulationFocus = null;
  if (engine.resizeLoadedWindow(data.cols | 0, data.rows | 0)) {
    epoch++;
    sequence = 0;
  }
  postFull('resize');
  // Coordinate-free inventory/cursor updates must cross the resized actor
  // frame after their one-shot inventory hash was consumed.
  postActors(true);
}

function postFull(reason, fields = {}) {
  sequence++;
  awaitingAck = true;
  const bytes = engine.serializeWorld();
  engine.consumeReplicaDirty();
  postBytes({
    type: 'full', epoch, sequence, reason,
    resizeId,
    cols: engine.cols, rows: engine.rows,
    worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(),
    worldTick: engine.getTick(), perf: perf(), ...fields,
  }, bytes);
  lightEditX0 = Infinity;
  lightEditX1 = -Infinity;
  lastToolWriteX = null;
}

function postShift(fromWorldOffsetX, fromWorldOffsetY) {
  sequence++;
  awaitingAck = true;
  const bytes = engine.serializeDiff();
  engine.consumeReplicaDirty();
  const editX0 = Number.isFinite(lightEditX0) ? Math.floor(lightEditX0) : 1;
  const editX1 = Number.isFinite(lightEditX1) ? Math.ceil(lightEditX1) : 0;
  const worldOffsetX = engine.getWorldOffsetX();
  const worldOffsetY = engine.getWorldOffsetY();
  postBytes({
    type: 'shift', epoch, sequence, reason: 'stream', resizeId,
    cols: engine.cols, rows: engine.rows,
    fromWorldOffsetX, fromWorldOffsetY,
    shiftDx: worldOffsetX - fromWorldOffsetX,
    shiftDy: worldOffsetY - fromWorldOffsetY,
    worldOffsetX, worldOffsetY,
    worldTick: engine.getTick(), perf: perf(),
    lightEditX0: editX0, lightEditX1: editX1,
  }, bytes);
  lightEditX0 = Infinity;
  lightEditX1 = -Infinity;
  lastToolWriteX = null;
}

function postDiffIfReady() {
  if (awaitingAck) return;
  const bytes = engine.serializeDiff();
  if (bytes.length <= 4) return; // two empty layer headers
  sequence++;
  awaitingAck = true;
  engine.consumeReplicaDirty();
  const editX0 = Number.isFinite(lightEditX0) ? Math.floor(lightEditX0) : 1;
  const editX1 = Number.isFinite(lightEditX1) ? Math.ceil(lightEditX1) : 0;
  postBytes({
    type: 'diff', epoch, sequence, worldTick: engine.getTick(), perf: perf(),
    lightEditX0: editX0, lightEditX1: editX1,
  }, bytes);
  lightEditX0 = Infinity;
  lightEditX1 = -Infinity;
}

function toLocal(worldX, worldY) {
  return {
    x: Math.floor(worldX - engine.getWorldOffsetX()),
    y: Math.floor(worldY - engine.getWorldOffsetY()),
  };
}

function streamForControl() {
  // A partial shift contains only dirtiness accumulated after the last packet.
  // Keep its coordinate frame behind the unacknowledged diff that owns earlier
  // edits, otherwise the presentation's latest-packet queue could drop them.
  if (!control || control.suspendStreaming || awaitingAck) return false;
  // A viewport must fit inside the loaded window before edge streaming has a
  // meaningful answer. This also makes the worker robust to a resize/control
  // message reordering: an oversized view otherwise satisfies an edge test on
  // every world turn and races the world offset away from the camera.
  if (control.viewCols + STREAM_MARGIN * 2 > engine.cols ||
      control.viewRows + STREAM_MARGIN * 2 > engine.rows) return false;
  const localX = Math.floor(control.camWorldX - engine.getWorldOffsetX());
  const localY = Math.floor(control.camWorldY - engine.getWorldOffsetY());
  // Generate/cache the band we are approaching over several cheap turns. The
  // main-thread camera path already does this; worker authority must do it too.
  engine.prefetchAdvance(localX, localY, control.viewCols, control.viewRows);
  const dx = engine.maybeShiftWorld(localX, control.viewCols, STREAM_MARGIN);
  const dy = engine.maybeShiftWorldV(localY, control.viewRows, STREAM_MARGIN);
  return !!(dx || dy);
}

function simulationFocusRect() {
  const width = Math.min(engine.cols, LIVE_SIM_COLS);
  const height = Math.min(engine.rows, LIVE_SIM_ROWS);
  const worldOffsetX = engine.getWorldOffsetX();
  const worldOffsetY = engine.getWorldOffsetY();
  const centerX = Math.floor(control.camWorldX + control.viewCols * 0.5);
  const centerY = Math.floor(control.camWorldY + control.viewRows * 0.5);
  const worldX0 = Math.max(
    worldOffsetX,
    Math.min(worldOffsetX + engine.cols - width, centerX - Math.floor(width / 2)),
  );
  const worldY0 = Math.max(
    worldOffsetY,
    Math.min(worldOffsetY + engine.rows - height, centerY - Math.floor(height / 2)),
  );
  return { x0: worldX0, y0: worldY0, x1: worldX0 + width, y1: worldY0 + height };
}

function activateWorldRect(rect) {
  const offsetX = engine.getWorldOffsetX();
  const offsetY = engine.getWorldOffsetY();
  engine.activateSimulationRect(
    rect.x0 - offsetX, rect.y0 - offsetY,
    rect.x1 - offsetX, rect.y1 - offsetY,
  );
}

function refreshSimulationFocus(reset = false, preserveReplicaDirty = false) {
  if (!control) return;
  const next = simulationFocusRect();
  const previous = liveSimulationFocus;
  if (reset || !previous) {
    engine.resetSimulationActivity(preserveReplicaDirty);
    activateWorldRect(next);
  } else if (next.x0 !== previous.x0 || next.y0 !== previous.y0 ||
             next.x1 !== previous.x1 || next.y1 !== previous.y1) {
    const ix0 = Math.max(previous.x0, next.x0);
    const iy0 = Math.max(previous.y0, next.y0);
    const ix1 = Math.min(previous.x1, next.x1);
    const iy1 = Math.min(previous.y1, next.y1);
    if (ix0 >= ix1 || iy0 >= iy1) {
      activateWorldRect(next);
    } else {
      activateWorldRect({ x0: next.x0, y0: next.y0, x1: next.x1, y1: iy0 });
      activateWorldRect({ x0: next.x0, y0: iy1, x1: next.x1, y1: next.y1 });
      activateWorldRect({ x0: next.x0, y0: iy0, x1: ix0, y1: iy1 });
      activateWorldRect({ x0: ix1, y0: iy0, x1: next.x1, y1: iy1 });
    }
  }
  liveSimulationFocus = next;
}

function applyEdges() {
  for (const edge of edges) {
    // Creative drafts have only primary/background owners. Ignore auxiliary
    // mouse buttons instead of folding them into primary held state.
    if (edge.button !== 0 && edge.button !== 2) continue;
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
      if (engine.pointerDown(p.x, p.y, edge.button)) noteLightEdit(p.x);
    }
    else {
      const drafted = engine.pointerDraft(p.x, p.y);
      const finalized = engine.pointerUp(edge.button);
      if (drafted || finalized) noteLightEdit(p.x);
      workerButtons &= ~(edge.button === 2 ? 2 : 1);
      if (!workerButtons) lastToolWriteX = null;
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
  if (engine.applyTool(p.x, p.y, now, !!control.inside, !!control.drawMode)) {
    toolWrites++;
    noteLightEdit(p.x);
  }
  if (!(control.buttons | 0)) lastToolWriteX = null;
}

function schedule(delay = null) {
  clearTimeout(timer);
  const wait = delay ?? turnDeadline.nextDelay(performance.now());
  timer = setTimeout(run, wait);
}

function executeTurn(started, scheduleNext = true) {
  const detailedLiveness = livenessProbeArmed;
  livenessProbeArmed = false;
  livenessTurn++;
  setLivenessStage(WORKER_LIVENESS_STAGE.STREAM, detailedLiveness);
  const fromWorldOffsetX = engine.getWorldOffsetX();
  const fromWorldOffsetY = engine.getWorldOffsetY();
  const shifted = streamForControl();
  if (shifted) {
    // The shift has already translated every authority-owned actor into the new
    // buffer frame. Start its epoch before any of those coordinates are posted.
    epoch++;
    sequence = 0;
    awaitingAck = false;
    const shiftDx = engine.getWorldOffsetX() - fromWorldOffsetX;
    if (Number.isFinite(lightEditX0)) lightEditX0 -= shiftDx;
    if (Number.isFinite(lightEditX1)) lightEditX1 -= shiftDx;
    if (Number.isFinite(lastToolWriteX)) lastToolWriteX -= shiftDx;
    refreshSimulationFocus(true, true);
  }
  // Natural-spawn visibility is authority-owned. Keep its otherwise headless
  // camera aligned with the presentation camera so "off-screen" means outside
  // the player's real viewport rather than outside a stale startup rectangle.
  if (control && Number.isFinite(control.camWorldX) && Number.isFinite(control.camWorldY)) {
    const viewCols = Math.max(1, Math.min(engine.cols, control.viewCols | 0));
    const viewRows = Math.max(1, Math.min(engine.rows, control.viewRows | 0));
    engine.setViewport(1, 1, viewCols, viewRows);
    engine.cameraSet(
      control.camWorldX - engine.getWorldOffsetX(),
      control.camWorldY - engine.getWorldOffsetY(),
    );
  }
  if (!survival) {
    applyEdges();
    applyContinuous(started);
  }
  const stepStart = performance.now();
  if (survival && latestInput && localPlayerId) {
    const aimX = Math.floor(latestInput.worldAimX - engine.getWorldOffsetX());
    const aimY = Math.floor(latestInput.worldAimY - engine.getWorldOffsetY());
    engine.setPlayerInput(localPlayerId, { ...latestInput, aimX, aimY });
  }
  // Authority time advances as one coherent tick. An over-budget world slows
  // actors by the same amount instead of letting an actor catch-up loop race ahead.
  setLivenessStage(WORKER_LIVENESS_STAGE.STEP_ACTORS, detailedLiveness);
  engine.stepActors();
  setLivenessStage(WORKER_LIVENESS_STAGE.STEP_WORLD, detailedLiveness);
  engine.stepWorld();
  setLivenessStage(WORKER_LIVENESS_STAGE.TRANSPORT, detailedLiveness);
  // The DEV delay hook isolates scheduling without burning a browser CPU core.
  lastStepMs = performance.now() - stepStart;
  rateSteps++;
  // Establish the new mirror coordinate frame before publishing any payload
  // whose local coordinates were translated by the stream. A requested full
  // snapshot is reserved for recovery; ordinary shifts carry only dirty bands.
  const postedFull = fullResyncRequested;
  if (postedFull) {
    fullResyncRequested = false;
    postFull('resync');
  } else if (shifted) {
    postShift(fromWorldOffsetX, fromWorldOffsetY);
  }
  postSounds();
  if (started - lastStatsPost >= 250) {
    lastStatsPost = started;
    if (!replayTransportSuppressed)
      self.postMessage({ type: 'stats', worldTick: engine.getTick(), perf: perf(), epoch, sequence });
  }
  postDraft();
  postCreatures();
  // Inventory/cursor are change-triggered rather than periodic. Force them into
  // the first packet of a new epoch so coalescing cannot strand an update that
  // was posted immediately before the shift.
  postActors(shifted);
  if (!shifted && !postedFull) postDiffIfReady();
  if (scheduleNext) {
    const targetTurnMs = Math.max(SIM_STEP_MS, artificialDelayMs);
    if (targetTurnMs > SIM_STEP_MS)
      schedule(Math.max(0, targetTurnMs - (performance.now() - started)));
    else schedule();
  }
  setLivenessStage(WORKER_LIVENESS_STAGE.SCHEDULED, detailedLiveness);
}

function run() {
  if (closing || !engine || replayRunning) return;
  const started = performance.now();
  if (paused) {
    setLivenessStage(WORKER_LIVENESS_STAGE.PAUSED);
    schedule();
    return;
  }
  if (!control) {
    setLivenessStage(WORKER_LIVENESS_STAGE.WAITING_CONTROL);
    schedule();
    return;
  }
  if (replayCapture) recordReplayTurn(started);
  executeTurn(started);
}

async function initializeAuthority(data, { scheduleRuns = true, usePending = true } = {}) {
  livenessProbeArmed = false;
  const generation = ++initGeneration;
  clearTimeout(timer);
  try {
    await initSandWasm();
  } catch (error) {
    if (!closing && generation === initGeneration)
      self.postMessage({ type: 'error', phase: 'init', message: error?.message || String(error) });
    return false;
  }
  if (closing || generation !== initGeneration) return false;
  try {
      const previous = engine;
      engine = null;
      previous?.destroy();
      engine = createEngineWasm({
        cols: data.cols, rows: data.rows, worldSeed: data.worldSeed >>> 0,
        infinite: true, sinksOn: false, storageRole: 'authority',
        planetId: data.planetId,
        gravityScale: data.gravityScale,
      });
      survival = !!data.survival;
      paused = !!data.paused;
      artificialDelayMs = Math.max(0, Math.min(100, +data.artificialDelayMs || 0));
      engine.setPlayMode(survival);
      engine.setSurvivalInventory(survival);
      engine.setDrawMode(!!data.drawMode);
      creativeKind = data.creativeKind | 0;
      creativeValue = data.creativeValue | 0;
      creatureNaturalSpawning = !!data.creatureNaturalSpawning;
      creatureSimulationRequested = false;
      engine.setCreativeMaterial(creativeKind, creativeValue);
      // Wait for the first presentation control before natural spawning so the
      // initial encounter also observes the real viewport, not camera defaults.
      if (survival) engine.setCreatureRuntime(true, false);
      else applyCreatureRuntime();
      // Preserve the selected startup tool. The initial creative selection is an
      // EMPTY placeholder until the palette emits a real material selection.
      engine.setTool(data.tool | 0);
      if (usePending && pendingRuntimeConfig) {
        const config = pendingRuntimeConfig;
        pendingRuntimeConfig = null;
        applyRuntimeConfig(config);
      }
      localPlayerId = survival ? engine.spawnPlayerAtSurface(Math.floor(data.cols / 2)) : 0;
      missionId = survival ? data.missionId | 0 : MISSION.NONE;
      activePlanetId = data.planetId | 0;
      if (localPlayerId && planetHasGameplayFlag(
        activePlanetId, PLANET_GAMEPLAY_FLAG.SCRIPTED_CREW,
      )) {
        engine.spawnScriptedCreature(CREATURE.IRIS_COMMANDER, -64, 8);
        engine.spawnScriptedCreature(CREATURE.IRIS_ENGINEER, 64, 8);
        engine.spawnScriptedCreature(CREATURE.SURVEYOR, 30, -23);
      }
      if (localPlayerId && Array.isArray(data.loadout)) {
        for (const stack of data.loadout.slice(0, 16)) {
          const count = Math.max(0, Math.min(5000, stack?.count | 0));
          const itemKind = stack?.itemKind | 0;
          if (!count) continue;
          if (itemKind === ITEM_KIND.MATERIAL) {
            const material = stack?.material | 0;
            if (material > MAT.EMPTY && isMaterialId(material)) {
              engine.addToInventory(localPlayerId, material, count);
            }
          } else if (itemKind >= ITEM_KIND.DYNAMITE_SATCHEL
                     && itemKind <= ITEM_KIND.MINIGUN) {
            engine.addSpecialItem(localPlayerId, itemKind, count);
          }
        }
      }
      if (missionId && !engine.startMission(missionId, localPlayerId)) {
        self.postMessage({
          type: 'error',
          phase: 'mission',
          message: 'The selected campaign mission could not start on this planet.',
        });
        engine.destroy();
        engine = null;
        return false;
      }
      latestInput = null;
      lastInventoryHash = -1;
      epoch = 1; sequence = 0; awaitingAck = false; fullResyncRequested = false; resizeId = 0; control = null; edges = []; workerButtons = 0; mirroredCreatures = false; liveSimulationFocus = null; livenessTurn = 0;
      lightEditX0 = Infinity; lightEditX1 = -Infinity; lastToolWriteX = null;
      draftRevision = 0; lastDraftSignature = '';
      controlsReceived = 0; edgesProcessed = 0; toolWrites = 0;
      survivalSpawnViewReady = false;
      rateStart = performance.now(); rateSteps = 0; lastStepMs = 0;
      lastStatsPost = 0;
      turnDeadline.reset(performance.now());
      if (usePending && pendingResize) {
        const resize = pendingResize;
        pendingResize = null;
        applyResize(resize);
      } else {
        postFull('init');
        postActors(true);
      }
      replayCaptureStarting = false;
      if (scheduleRuns) schedule();
      setLivenessStage(paused
        ? WORKER_LIVENESS_STAGE.PAUSED
        : WORKER_LIVENESS_STAGE.SCHEDULED, true);
      return true;
  } catch (error) {
    engine?.destroy();
    engine = null;
    if (!closing && generation === initGeneration) {
      self.postMessage({ type: 'error', phase: 'init', message: error?.message || String(error) });
    }
    return false;
  }
}

function applyRuntimeMessage(data) {
  if (data.type === 'ack') {
    if (data.epoch === epoch && data.sequence === sequence) awaitingAck = false;
  } else if (data.type === 'resync') {
    awaitingAck = false;
    fullResyncRequested = true;
  } else if (data.type === 'control') {
    controlsReceived++;
    control = data;
    refreshSimulationFocus();
    if (survival && !survivalSpawnViewReady) {
      survivalSpawnViewReady = true;
      engine.setCreatureRuntime(
        true,
        !missionId && planetHasGameplayFlag(
          activePlanetId, PLANET_GAMEPLAY_FLAG.NATURAL_SPAWNS,
        ),
      );
    }
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
    applyRuntimeConfig(data);
  } else if (data.type === 'test-paint-disc') {
    const p = toLocal(data.worldX, data.worldY);
    const radius = Math.max(1, data.radius | 0);
    if (engine.paintDisc(p.x, p.y, radius, data.material | 0, false)) toolWrites++;
  } else if (data.type === 'test-seed-reaction') {
    seedReactionInterface(data.material | 0, Math.max(1, data.cap | 0), data.phase | 0);
  } else if (data.type === 'test-creature-runtime') {
    // An explicit diagnostic override owns the startup gate too. Otherwise a
    // late first viewport-control packet can silently re-enable natural spawns
    // after a browser test has frozen combat.
    survivalSpawnViewReady = true;
    engine.setCreatureRuntime(!!data.simulate, !!data.naturalSpawn);
  } else if (data.type === 'test-natural-spawn') {
    if (data.forceBreach) engine._testSpawnBreachNearFocus(data.species | 0, data.salt | 0);
    else engine._testSpawnNearFocus(data.species | 0, data.salt | 0);
    postSounds();
    postCreatures();
    postActors(true);
  } else if (data.type === 'test-step-actors') {
    // Test-driven actor turns own the worker clock while they run. Keeping the
    // authority paused makes the requested count exact even on a loaded host.
    paused = true;
    const steps = Math.max(0, Math.min(240, data.steps | 0));
    for (let i = 0; i < steps; i++) engine.stepActors();
    postSounds();
    postCreatures();
    postActors(true);
    postDiffIfReady();
  } else if (data.type === 'resize') {
    applyResize(data);
  }
}

function exportReplay(requestId, view) {
  if (!engine || !replayCapture) {
    self.postMessage({
      type: 'replay-error', requestId,
      message: 'The local authority has not finished starting.',
    });
    return;
  }
  paused = true;
  const capsule = {
    ...replayCapture,
    events: replayCapture.events.slice(),
    turns: replayCapture.turns.slice(),
    view: copyReplayValue(view || {}),
    final: replayFinalState(),
  };
  self.postMessage({ type: 'replay-capsule', requestId, capsule });
}

async function runReplayCapsule(requestId, value) {
  let capsule;
  try {
    capsule = validateReplayCapsule(value);
  } catch (error) {
    self.postMessage({ type: 'replay-error', requestId, message: error.message });
    return;
  }

  clearTimeout(timer);
  replayRunning = true;
  replayTransportSuppressed = true;
  replayCaptureStarting = false;
  pendingRuntimeConfig = null;
  pendingResize = null;
  const initialized = await initializeAuthority(
    { type: 'init', ...capsule.init },
    { scheduleRuns: false, usePending: false },
  );
  if (!initialized || closing) {
    replayRunning = false;
    replayTransportSuppressed = false;
    self.postMessage({
      type: 'replay-error', requestId,
      message: 'The replay engine could not be initialized.',
    });
    return;
  }

  let eventIndex = 0;
  let turnIndex = 0;
  const applyEventsAtTurn = (turn) => {
    while (eventIndex < capsule.events.length
           && capsule.events[eventIndex].tick === turn) {
      applyRuntimeMessage(capsule.events[eventIndex].message);
      eventIndex++;
    }
  };
  const fail = (error) => {
    replayRunning = false;
    replayTransportSuppressed = false;
    paused = true;
    self.postMessage({
      type: 'replay-error', requestId,
      message: error?.message || String(error),
    });
    schedule();
  };
  const finish = () => {
    try {
      applyEventsAtTurn(turnIndex);
      if (eventIndex !== capsule.events.length)
        throw new Error('Replay ended before all authority events were applied.');
      const actual = replayFinalState();
      const matched = replayStateMatches(capsule.final, actual);
      paused = true;
      replayRunning = false;
      replayTransportSuppressed = false;
      replayCapture = {
        ...capsule,
        events: capsule.events.slice(),
        turns: capsule.turns.slice(),
      };
      postFull('replay', { replayView: capsule.view || null });
      postActors(true);
      self.postMessage({
        type: 'replay-complete', requestId, matched,
        expected: capsule.final, actual,
      });
      schedule();
    } catch (error) {
      fail(error);
    }
  };
  const replaySlice = () => {
    if (closing || !replayRunning) return;
    try {
      const end = Math.min(capsule.turns.length, turnIndex + 120);
      while (turnIndex < end) {
        applyEventsAtTurn(turnIndex);
        const turn = capsule.turns[turnIndex];
        awaitingAck = turn.awaitingAck;
        fullResyncRequested = turn.fullResyncRequested;
        if (latestInput && turn.inputSeq !== null) latestInput.seq = turn.inputSeq;
        executeTurn(turn.now, false);
        turnIndex++;
      }
      if (turnIndex >= capsule.turns.length) {
        finish();
        return;
      }
      self.postMessage({
        type: 'replay-progress', requestId,
        turn: turnIndex, turns: capsule.turns.length,
      });
      setTimeout(replaySlice, 0);
    } catch (error) {
      fail(error);
    }
  };
  replaySlice();
}

self.onmessage = async ({ data }) => {
  if (!data) return;
  if (data.type === 'destroy') {
    shutdown();
    return;
  }
  if (closing) return;
  if (data.type === 'replay-export') {
    exportReplay(data.requestId, data.view);
    return;
  }
  if (data.type === 'replay-run') {
    if (replayRunning) {
      self.postMessage({
        type: 'replay-error', requestId: data.requestId,
        message: 'A replay is already running.',
      });
      return;
    }
    await runReplayCapsule(data.requestId, data.capsule);
    return;
  }
  if (replayRunning) return;
  if (data.type === 'init') {
    beginReplayCapture(data);
    await initializeAuthority(data);
    return;
  }
  if (REPLAY_EVENT_TYPES.has(data.type)) recordReplayMessage(data);
  if (data.type === 'config' && !engine) {
    pendingRuntimeConfig = { ...pendingRuntimeConfig, ...data };
    return;
  }
  if (data.type === 'resize' && !engine) {
    pendingResize = data;
    return;
  }
  if (data.type === 'liveness-probe') {
    livenessProbeArmed = true;
    setLivenessStage(livenessStage, true);
    return;
  }
  if (!engine) return;
  applyRuntimeMessage(data);
};

setLivenessStage(WORKER_LIVENESS_STAGE.INITIALIZING, true);
