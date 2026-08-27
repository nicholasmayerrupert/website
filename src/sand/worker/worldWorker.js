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
  normalizeReplayInit,
  normalizeReplayMessage,
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
import { reconstructReplayWorld, replayFrameBytes } from './replayVisualBuffer.js';
import {
  createReplaySegmentBackingStore,
  decodeReplaySegment,
  encodeReplaySegment,
  ReplaySegmentCache,
} from './replaySegmentCache.js';

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
let pendingWeatherId = null;
let livenessStage = WORKER_LIVENESS_STAGE.INITIALIZING;
let livenessTurn = 0;
let replayCapture = null;
let replayCaptureStarting = false;
let replayInputSignature = '';
let replayJournalEvents = [];
let replayJournalGateFlags = 0;
let replayRunning = false;
let replayTransportSuppressed = false;
let replayMicroscopeSession = null;
let replayPlaybackStart = null;
let replayBufferSession = null;
let replayBufferCapturing = false;
let replayResumeRequestId = 0;
const REPLAY_GATE_AWAITING_ACK = 1;
const REPLAY_GATE_FULL_RESYNC = 2;
const REPLAY_VISUAL_KEYFRAME_TURNS = 120;
const REPLAY_RESUME_SLICE_MS = 100;
const REPLAY_BUILD_SLICE_MS = 100;
const REPLAY_PLAY_BUILD_SLICE_MS = SIM_STEP_MS / 2;
const MAX_REPLAY_SEGMENT_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_REPLAY_ACTIVE_SEGMENT_BYTES = 8 * 1024 * 1024;
const MAX_REPLAY_DECODED_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_REPLAY_DECODED_SEGMENTS = 3;
const turnDeadline = createTurnDeadline({ now: performance.now() });

const copyViewBuffer = (view) => view?.byteLength
  ? view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  : new ArrayBuffer(0);

function stopReplayBufferTimers(session = replayBufferSession) {
  if (!session) return;
  clearTimeout(session.buildTimer);
  clearTimeout(session.playTimer);
  session.buildTimer = 0;
  session.playTimer = 0;
}

function beginReplayCapture(data) {
  replayCaptureStarting = true;
  replayInputSignature = '';
  replayJournalEvents = [];
  replayJournalGateFlags = 0;
  const init = normalizeReplayInit(data);
  replayCapture = {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    abiVersion: ABI_VERSION,
    abiFingerprint: ABI_FINGERPRINT,
    init,
    events: [],
    gates: [],
    turns: 0,
  };
  self.postMessage({ type: 'replay-journal-reset', init });
}

function recordReplayMessage(data) {
  if (!replayCapture || replayRunning || !REPLAY_EVENT_TYPES.has(data.type)) return;
  if (data.type === 'input') return;
  const message = normalizeReplayMessage(data, !!replayCapture.init.survival);
  if (!message) return;
  const event = {
    tick: replayCaptureStarting ? 0 : replayCapture.turns,
    message,
  };
  replayCapture.events.push(event);
  const flags = (awaitingAck ? REPLAY_GATE_AWAITING_ACK : 0)
    | (fullResyncRequested ? REPLAY_GATE_FULL_RESYNC : 0);
  // Runtime messages can enter synchronous engine work before the next turn.
  // Publish the normalized event first so the main thread retains its trigger.
  self.postMessage({
    type: 'replay-journal-event',
    event,
    flags,
    phase: `apply-${message.type}`,
    worldTick: engine ? engine.getTick() : 0,
    actorTick: engine ? engine.getActorTick() : 0,
    epoch,
    sequence,
  });
}

function recordReplayTurn() {
  if (latestInput) {
    const message = normalizeReplayMessage(
      { type: 'input', input: latestInput }, !!replayCapture.init.survival,
    );
    const signature = JSON.stringify(message);
    if (signature !== replayInputSignature) {
      replayInputSignature = signature;
      const event = { tick: replayCapture.turns, message };
      replayCapture.events.push(event);
      replayJournalEvents.push(event);
    }
  }
  const flags = (awaitingAck ? REPLAY_GATE_AWAITING_ACK : 0)
    | (fullResyncRequested ? REPLAY_GATE_FULL_RESYNC : 0);
  replayJournalGateFlags = flags;
  if (flags) {
    const previous = replayCapture.gates.at(-1);
    if (previous?.end === replayCapture.turns && previous.flags === flags) {
      previous.end++;
    } else {
      replayCapture.gates.push({
        start: replayCapture.turns,
        end: replayCapture.turns + 1,
        flags,
      });
    }
  }
  replayCapture.turns++;
  replayCaptureStarting = false;
}

function publishReplayTurn() {
  if (!replayCapture || replayCapture.turns < 1) return false;
  const events = replayJournalEvents;
  replayJournalEvents = [];
  self.postMessage({
    type: 'replay-journal-turn',
    turns: replayCapture.turns,
    flags: replayJournalGateFlags,
    events,
    phase: 'turn-start',
    worldTick: engine.getTick(),
    actorTick: engine.getActorTick(),
    epoch,
    sequence,
    liveness: encodeWorkerLiveness(
      WORKER_LIVENESS_STAGE.STREAM, livenessTurn + 1, awaitingAck, !!control,
    ),
  });
  return true;
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
  stopReplayBufferTimers();
  void replayBufferSession?.cache.clear();
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

function replayView(session) {
  if (control && Number.isFinite(control.camWorldX)
      && Number.isFinite(control.camWorldY)) {
    return {
      cameraWorldX: control.camWorldX,
      cameraWorldY: control.camWorldY,
      viewCols: control.viewCols,
      viewRows: control.viewRows,
      zoom: session.capsule.view?.zoom,
    };
  }
  return session.capsule.view || {};
}

function replayActorSnapshot() {
  if (!survival || !localPlayerId) return null;
  const players = engine.getPlayers();
  const player = players.find((candidate) => candidate.id === localPlayerId) || null;
  return {
    type: 'actors', epoch, actorTick: engine.getActorTick(), localPlayerId,
    players: copyReplayValue(players),
    worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(),
    mineProgress: engine.getPlayerMineProgress(localPlayerId),
    mineTarget: copyReplayValue(engine.getPlayerMineTarget(localPlayerId)),
    actionCount: engine.getPlayerActionCount(),
    inventory: copyReplayValue(engine.getInventory(localPlayerId)),
    cursor: copyReplayValue(engine.getCursor(localPlayerId)),
    itemData: copyViewBuffer(engine.getItemSnapshotData()),
    projectileData: copyViewBuffer(engine.getProjectileSnapshotData()),
    mission: missionId ? copyReplayValue(engine.getMission()) : null,
    ackSeq: player?.inputSeq ?? 0,
  };
}

function captureReplayVisualFrame(session, turn, {
  forceFull = false,
  shifted = false,
  fromWorldOffsetX = engine.getWorldOffsetX(),
  fromWorldOffsetY = engine.getWorldOffsetY(),
} = {}) {
  const startsSegment = !session.activeSegment;
  const dimensionChanged = !!session.activeSegment
    && (session.activeSegment.cols !== engine.cols || session.activeSegment.rows !== engine.rows);
  const full = forceFull || startsSegment || dimensionChanged;
  if (startsSegment) {
    session.activeSegment = {
      start: turn, frames: [], rawBytes: 0,
      cols: engine.cols, rows: engine.rows,
    };
  }
  session.activeSegment.cols = engine.cols;
  session.activeSegment.rows = engine.rows;
  const type = full ? 'full' : (shifted ? 'shift' : 'diff');
  const bytes = full ? engine.serializeWorld() : engine.serializeDiff();
  engine.consumeReplicaDirty();
  const editX0 = Number.isFinite(lightEditX0) ? Math.floor(lightEditX0) : 1;
  const editX1 = Number.isFinite(lightEditX1) ? Math.ceil(lightEditX1) : 0;
  const view = replayView(session);
  const world = {
    type,
    epoch,
    sequence: turn + 1,
    reason: full ? 'replay-buffer-keyframe' : undefined,
    resizeId,
    worldOffsetX: engine.getWorldOffsetX(),
    worldOffsetY: engine.getWorldOffsetY(),
    worldTick: engine.getTick(),
    replayView: view,
    lightEditX0: editX0,
    lightEditX1: editX1,
    data: copyViewBuffer(bytes),
  };
  if (full) {
    world.cols = engine.cols;
    world.rows = engine.rows;
  } else if (shifted) {
    world.cols = engine.cols;
    world.rows = engine.rows;
    world.fromWorldOffsetX = fromWorldOffsetX;
    world.fromWorldOffsetY = fromWorldOffsetY;
    world.shiftDx = world.worldOffsetX - fromWorldOffsetX;
    world.shiftDy = world.worldOffsetY - fromWorldOffsetY;
  }
  const creatures = engine.getCreatureSnapshotData();
  const draft = engine.getStoneDraftCells();
  const inventory = draft.length && survival && localPlayerId
    ? engine.getInventory(localPlayerId)
    : null;
  const material = inventory?.slots?.[inventory.selected]?.material ?? creativeValue;
  const sounds = engine.drainSoundEvents();
  const frame = {
    turn,
    view: copyReplayValue(view),
    world,
    actors: replayActorSnapshot(),
    creatures: {
      type: 'creatures', epoch,
      worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(),
      data: copyViewBuffer(creatures),
    },
    draft: {
      type: 'draft', epoch, revision: turn + 1, material,
      worldOffsetX: engine.getWorldOffsetX(), worldOffsetY: engine.getWorldOffsetY(),
      data: copyViewBuffer(Int32Array.from(draft)),
    },
    sounds: sounds.length
      ? { type: 'sounds', epoch, data: copyViewBuffer(sounds) }
      : null,
  };
  session.activeSegment.frames.push(frame);
  session.activeSegment.rawBytes += replayFrameBytes(frame) + 1024;
  session.turn = turn;
  session.furthestTurn = Math.max(session.furthestTurn, turn);
  lightEditX0 = Infinity;
  lightEditX1 = -Infinity;
  lastToolWriteX = null;
  return true;
}

function cloneReplayPacket(packet) {
  if (!packet) return null;
  const clone = { ...packet };
  for (const key of ['data', 'itemData', 'projectileData']) {
    if (packet[key] instanceof ArrayBuffer) clone[key] = packet[key].slice(0);
  }
  return clone;
}

function replayActiveRange(session) {
  const frames = session.activeSegment?.frames;
  return frames?.length ? [[frames[0].turn, frames.at(-1).turn]] : [];
}

function replayCachedRanges(session) {
  return session.cache.ranges(replayActiveRange(session));
}

function replayCacheBytes(session) {
  let total = session.cache.bytes + (session.activeSegment?.rawBytes || 0);
  for (const decoded of session.decodedSegments.values()) total += decoded.bytes;
  return total;
}

function replayDecodedBytes(session) {
  let total = 0;
  for (const decoded of session.decodedSegments.values()) total += decoded.bytes;
  return total;
}

function trimDecodedReplaySegments(session, protectedStart = null) {
  while (session.decodedSegments.size > 1
      && (session.decodedSegments.size > MAX_REPLAY_DECODED_SEGMENTS
        || replayDecodedBytes(session) > MAX_REPLAY_DECODED_CACHE_BYTES)) {
    const candidates = [...session.decodedSegments.entries()]
      .filter(([start]) => start !== protectedStart)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess || a[0] - b[0]);
    if (!candidates.length) break;
    session.decodedSegments.delete(candidates[0][0]);
  }
}

async function finalizeReplaySegment(session) {
  const active = session.activeSegment;
  if (!active?.frames.length) return null;
  if (!active.encodingPromise) {
    active.encodingPromise = (async () => {
      const segment = await encodeReplaySegment(active.frames);
      if (closing || replayBufferSession !== session || session.activeSegment !== active)
        return null;
      await session.cache.add(segment);
      session.activeSegment = null;
      return segment;
    })();
  }
  return active.encodingPromise;
}

function activeReplayFrames(session, turn) {
  const active = session.activeSegment;
  if (!active?.frames.length) return null;
  const end = active.frames.at(-1).turn;
  return turn >= active.start && turn <= end ? active.frames : null;
}

async function replayFramesForTurn(session, turn) {
  const active = activeReplayFrames(session, turn);
  if (active) return { frames: active, start: session.activeSegment.start };
  const indexed = session.cache.getByTurn(turn);
  if (!indexed) return null;
  const existing = session.decodedSegments.get(indexed.start);
  if (existing) {
    existing.lastAccess = ++session.decodeClock;
    return { frames: existing.frames, start: indexed.start };
  }
  let pending = session.decodePromises.get(indexed.start);
  if (!pending) {
    pending = (async () => {
      const segment = await session.cache.loadByTurn(turn);
      return segment ? decodeReplaySegment(segment) : null;
    })().finally(() => {
      session.decodePromises.delete(indexed.start);
    });
    session.decodePromises.set(indexed.start, pending);
  }
  const frames = await pending;
  if (!frames || replayBufferSession !== session || !session.cache.getByTurn(turn))
    return null;
  session.decodedSegments.set(indexed.start, {
    frames,
    bytes: indexed.rawByteLength,
    lastAccess: ++session.decodeClock,
  });
  trimDecodedReplaySegments(session, indexed.start);
  return { frames, start: indexed.start };
}

function postReplayBufferStatus(session, fields = {}) {
  self.postMessage({
    type: 'replay-buffer-status',
    turn: session.playhead,
    turns: session.capsule.turns,
    bufferedTurn: session.furthestTurn,
    buildTurn: session.turn,
    seekTarget: session.pendingSeek,
    cachedRanges: replayCachedRanges(session),
    playing: session.playing,
    buffering: session.buffering,
    complete: session.complete,
    limitReached: session.cache.limitReached,
    matched: session.matched,
    bufferBytes: replayCacheBytes(session),
    storedBytes: session.cache.storedBytes,
    persistentCache: !!session.cache.backingStore,
    ...fields,
  });
}

async function postReplayVisualFrame(
  session, target, seek = false, requestGeneration = session.seekGeneration,
) {
  if (closing || replayBufferSession !== session
      || requestGeneration !== session.seekGeneration
      || session.awaitingFrame !== null)
    return false;
  session.presentationPending++;
  const located = await replayFramesForTurn(session, target).finally(() => {
    session.presentationPending--;
  });
  if (!located || closing || replayBufferSession !== session
      || requestGeneration !== session.seekGeneration
      || session.awaitingFrame !== null) {
    resumeReplayBufferPresentation(session);
    return false;
  }
  const frameIndex = target - located.start;
  const frame = located.frames[frameIndex];
  if (!frame) {
    resumeReplayBufferPresentation(session);
    return false;
  }
  const world = seek || target !== session.presentedTurn + 1
    ? reconstructReplayWorld(located.frames, frameIndex)
    : frame.world;
  const worldPacket = cloneReplayPacket({
    ...world, replayView: frame.view, replayFrameTurn: target,
  });
  const transfers = [worldPacket.data];
  self.postMessage(worldPacket, transfers);
  for (const packet of [frame.creatures, frame.draft, frame.actors]) {
    if (!packet) continue;
    const next = cloneReplayPacket({ ...packet, replayFrameTurn: target });
    const packetTransfers = [];
    for (const key of ['data', 'itemData', 'projectileData']) {
      if (next[key] instanceof ArrayBuffer) packetTransfers.push(next[key]);
    }
    self.postMessage(next, packetTransfers);
  }
  if (!seek && frame.sounds) {
    const sounds = cloneReplayPacket(frame.sounds);
    self.postMessage(sounds, [sounds.data]);
  }
  session.awaitingFrame = target;
  session.buffering = session.pendingSeek !== null && target !== session.pendingSeek;
  self.postMessage({
    type: 'replay-buffer-frame-ready',
    turn: target,
    turns: session.capsule.turns,
    bufferedTurn: session.furthestTurn,
  });
  return true;
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
  // object per item, including short-lived cosmetic debris.
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

function streamForControl(blockedByTransport = awaitingAck) {
  // A partial shift contains only dirtiness accumulated after the last packet.
  // Keep its coordinate frame behind the unacknowledged diff that owns earlier
  // edits, otherwise the presentation's latest-packet queue could drop them.
  if (!control || control.suspendStreaming || blockedByTransport) return false;
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

function executeTurn(
  started,
  scheduleNext = true,
  streamBreadcrumbPublished = false,
  replayGateFlags = null,
) {
  const publishBreadcrumbs = !replayRunning;
  livenessTurn++;
  // The live capture journal already carries this packed stream marker. Reuse
  // it instead of posting a duplicate message on every authority turn.
  setLivenessStage(
    WORKER_LIVENESS_STAGE.STREAM,
    publishBreadcrumbs && !streamBreadcrumbPublished,
  );
  const fromWorldOffsetX = engine.getWorldOffsetX();
  const fromWorldOffsetY = engine.getWorldOffsetY();
  const replayAwaitingAck = replayGateFlags === null
    ? awaitingAck
    : !!(replayGateFlags & REPLAY_GATE_AWAITING_ACK);
  const shifted = streamForControl(replayAwaitingAck);
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
  setLivenessStage(WORKER_LIVENESS_STAGE.APPLY_TOOLS, publishBreadcrumbs);
  if (!survival) {
    applyEdges();
    // Held-tool cadence belongs to authority turn time, independent of worker scheduling jitter.
    applyContinuous(engine.getTick() * SIM_STEP_MS);
  }
  const stepStart = performance.now();
  if (survival && latestInput && localPlayerId) {
    const aimX = Math.floor(latestInput.worldAimX - engine.getWorldOffsetX());
    const aimY = Math.floor(latestInput.worldAimY - engine.getWorldOffsetY());
    engine.setPlayerInput(localPlayerId, { ...latestInput, aimX, aimY });
  }
  // Authority time advances as one coherent tick. An over-budget world slows
  // actors by the same amount instead of letting an actor catch-up loop race ahead.
  setLivenessStage(WORKER_LIVENESS_STAGE.STEP_ACTORS, publishBreadcrumbs);
  engine.stepActors();
  setLivenessStage(WORKER_LIVENESS_STAGE.STEP_WORLD, publishBreadcrumbs);
  engine.stepWorld();
  setLivenessStage(WORKER_LIVENESS_STAGE.TRANSPORT, publishBreadcrumbs);
  // The DEV delay hook isolates scheduling without burning a browser CPU core.
  lastStepMs = performance.now() - stepStart;
  rateSteps++;
  // Establish the new mirror coordinate frame before publishing any payload
  // whose local coordinates were translated by the stream. Live shifts carry
  // dirty bands; visible replay shifts use self-contained snapshots because
  // their recorded timing is independent of the current browser's ACK timing.
  const postedFull = fullResyncRequested || (
    replayGateFlags !== null
      && !!(replayGateFlags & REPLAY_GATE_FULL_RESYNC)
  );
  if (replayBufferCapturing) {
    if (postedFull) fullResyncRequested = false;
  } else {
    if (postedFull) {
      fullResyncRequested = false;
      postFull('resync');
    } else if (shifted) {
      if (replayGateFlags !== null && !replayTransportSuppressed)
        postFull('replay-stream');
      else postShift(fromWorldOffsetX, fromWorldOffsetY);
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
  }
  // Mark the scheduling handoff before calling into the timer API so the last
  // delivered breadcrumb distinguishes it from unfinished transport work.
  setLivenessStage(WORKER_LIVENESS_STAGE.SCHEDULED, publishBreadcrumbs);
  if (scheduleNext) {
    const targetTurnMs = Math.max(SIM_STEP_MS, artificialDelayMs);
    if (targetTurnMs > SIM_STEP_MS)
      schedule(Math.max(0, targetTurnMs - (performance.now() - started)));
    else schedule();
  }
  return { shifted, postedFull };
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
  let streamBreadcrumbPublished = false;
  try {
    if (replayCapture) {
      recordReplayTurn();
      // Flush accepted events before streaming, tool application, actors, or the
      // world step can enter a long synchronous path.
      streamBreadcrumbPublished = publishReplayTurn();
    }
    executeTurn(started, true, streamBreadcrumbPublished);
  } catch (error) {
    if (replayCapture) {
      replayCapture.turns = Math.max(0, replayCapture.turns - 1);
      replayCapture.events = replayCapture.events.filter((event) => event.tick <= replayCapture.turns);
      replayCapture.gates = replayCapture.gates.filter((gate) => gate.start < replayCapture.turns + 1);
      for (const gate of replayCapture.gates) {
        if (gate.end > replayCapture.turns + 1) gate.end = replayCapture.turns + 1;
      }
      self.postMessage({ type: 'replay-journal-abort-turn' });
    }
    self.postMessage({
      type: 'error', phase: 'turn',
      message: error?.message || String(error),
    });
  }
}

async function initializeAuthority(data, { scheduleRuns = true, usePending = true } = {}) {
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
      engine.setWeather(data.weatherId | 0);
      if (usePending && pendingWeatherId !== null) {
        engine.setWeather(pendingWeatherId);
        pendingWeatherId = null;
      }
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
        : WORKER_LIVENESS_STAGE.SCHEDULED, !replayRunning);
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
  } else if (data.type === 'weather') {
    engine.setWeather(data.weatherId | 0);
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
  setLivenessStage(WORKER_LIVENESS_STAGE.PAUSED, true);
  const capsule = {
    ...replayCapture,
    events: replayCapture.events.slice(),
    gates: replayCapture.gates.slice(),
    view: copyReplayValue(view || {}),
    final: replayFinalState(),
  };
  self.postMessage({ type: 'replay-capsule', requestId, capsule });
}

async function runReplayCapsule(requestId, value, { playback = false } = {}) {
  replayMicroscopeSession = null;
  let capsule;
  try {
    capsule = validateReplayCapsule(value);
  } catch (error) {
    self.postMessage({ type: 'replay-error', requestId, message: error.message });
    return;
  }

  clearTimeout(timer);
  replayRunning = true;
  replayTransportSuppressed = !playback;
  replayPlaybackStart = null;
  replayCaptureStarting = false;
  replayJournalEvents = [];
  replayJournalGateFlags = 0;
  pendingRuntimeConfig = null;
  pendingResize = null;
  pendingWeatherId = null;
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
  let gateIndex = 0;
  let turnIndex = 0;
  const applyEventsAtTurn = (turn) => {
    while (eventIndex < capsule.events.length
           && capsule.events[eventIndex].tick === turn) {
      applyRuntimeMessage(capsule.events[eventIndex].message);
      eventIndex++;
    }
  };
  const fail = (error) => {
    replayPlaybackStart = null;
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
      replayPlaybackStart = null;
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
        gates: capsule.gates.slice(),
      };
      replayInputSignature = latestInput
        ? JSON.stringify(normalizeReplayMessage(
          { type: 'input', input: latestInput }, !!capsule.init.survival,
        )) : '';
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
  const replayView = () => {
    if (control && Number.isFinite(control.camWorldX)
        && Number.isFinite(control.camWorldY)) {
      return {
        cameraWorldX: control.camWorldX,
        cameraWorldY: control.camWorldY,
        viewCols: control.viewCols,
        viewRows: control.viewRows,
        zoom: capsule.view?.zoom,
      };
    }
    return capsule.view || {};
  };
  const publishPlaybackProgress = () => {
    self.postMessage({
      type: 'replay-progress', requestId,
      turn: turnIndex, turns: capsule.turns,
      view: replayView(),
    });
  };
  const replayTurn = () => {
    if (closing || !replayRunning) return;
    try {
      if (turnIndex >= capsule.turns) {
        finish();
        return;
      }
      applyEventsAtTurn(turnIndex);
      while (gateIndex < capsule.gates.length
             && capsule.gates[gateIndex].end <= turnIndex) gateIndex++;
      const gate = capsule.gates[gateIndex];
      const flags = gate && gate.start <= turnIndex && turnIndex < gate.end
        ? gate.flags : 0;
      executeTurn(performance.now(), false, false, flags);
      turnIndex++;
      publishPlaybackProgress();
      if (turnIndex >= capsule.turns) {
        finish();
        return;
      }
      timer = setTimeout(replayTurn, turnDeadline.nextDelay(performance.now()));
    } catch (error) {
      fail(error);
    }
  };
  if (playback) {
    // Publish turn zero before starting the real-time clock. The browser ACK of
    // the initialization snapshot starts playback, so the first visible diff
    // cannot overtake the world it is based on.
    applyEventsAtTurn(0);
    publishPlaybackProgress();
    let started = false;
    const start = () => {
      if (started || closing || !replayRunning) return;
      started = true;
      replayPlaybackStart = null;
      clearTimeout(timer);
      turnDeadline.reset(performance.now());
      timer = setTimeout(replayTurn, turnDeadline.nextDelay(performance.now()));
    };
    replayPlaybackStart = start;
    // A renderer normally ACKs on its next RAF. Keep a bounded fallback for a
    // hidden/throttled document so playback cannot remain armed forever.
    timer = setTimeout(start, 500);
    return;
  }
  const replaySlice = () => {
    if (closing || !replayRunning) return;
    try {
      const end = Math.min(capsule.turns, turnIndex + 120);
      while (turnIndex < end) {
        applyEventsAtTurn(turnIndex);
        while (gateIndex < capsule.gates.length
               && capsule.gates[gateIndex].end <= turnIndex) gateIndex++;
        const gate = capsule.gates[gateIndex];
        const flags = gate && gate.start <= turnIndex && turnIndex < gate.end
          ? gate.flags : 0;
        executeTurn(performance.now(), false, false, flags);
        turnIndex++;
      }
      if (turnIndex >= capsule.turns) {
        finish();
        return;
      }
      self.postMessage({
        type: 'replay-progress', requestId,
        turn: turnIndex, turns: capsule.turns,
      });
      setTimeout(replaySlice, 0);
    } catch (error) {
      fail(error);
    }
  };
  replaySlice();
}

function resumeReplayBufferPresentation(session) {
  if (replayBufferSession !== session || session.presentationPending > 0
      || session.awaitingFrame !== null) return;
  if (session.pendingSeek !== null) {
    const target = session.pendingSeek;
    if (activeReplayFrames(session, target) || session.cache.getByTurn(target)) {
      void postReplayVisualFrame(
        session, target, true, session.seekGeneration,
      ).catch((error) => failReplayBuffer(session, error));
    }
  } else if (session.playing && !session.playTimer) {
    scheduleReplayBufferPlayback(session);
  }
  ensureReplayBuild(session);
}

function replayNeedsBuild(session) {
  return session.turn < session.capsule.turns;
}

function scheduleReplayBufferPlayback(session, resetDeadline = false) {
  clearTimeout(session.playTimer);
  session.playTimer = 0;
  session.presentationDueAt = NaN;
  if (closing || replayBufferSession !== session || !session.playing
      || session.awaitingFrame !== null) return;
  const target = session.playhead + 1;
  if (target > session.capsule.turns) {
    session.playing = false;
    postReplayBufferStatus(session);
    return;
  }
  if (!activeReplayFrames(session, target) && !session.cache.getByTurn(target)) {
    session.pendingSeek = target;
    session.buffering = true;
    postReplayBufferStatus(session);
    ensureReplayBuild(session);
    return;
  }
  session.buffering = false;
  const now = performance.now();
  // One immediate present after a stall, then a fresh 60 Hz interval. Do not
  // repay missed turns or playback races ahead once capture finishes.
  let wait;
  if (resetDeadline || !Number.isFinite(session.nextPlayAt) || now >= session.nextPlayAt) {
    session.presentationDueAt = now;
    session.nextPlayAt = now + SIM_STEP_MS;
    wait = 0;
  } else {
    session.presentationDueAt = session.nextPlayAt;
    wait = session.nextPlayAt - now;
    session.nextPlayAt += SIM_STEP_MS;
  }
  session.playTimer = setTimeout(() => {
    session.playTimer = 0;
    session.presentationDueAt = NaN;
    if (replayBufferSession !== session || !session.playing
        || session.awaitingFrame !== null) return;
    void postReplayVisualFrame(session, target, false).catch((error) => {
      failReplayBuffer(session, error);
    });
  }, wait);
}

function failReplayBuffer(session, error) {
  if (replayBufferSession !== session) return;
  replayBufferCapturing = false;
  session.playing = false;
  session.buffering = false;
  session.buildBusy = false;
  self.postMessage({
    type: 'replay-error', requestId: session.requestId,
    message: error?.message || String(error),
  });
}

function ensureReplayBuild(session) {
  if (closing || replayBufferSession !== session) return;
  if (session.buildBusy || session.buildTimer || !replayNeedsBuild(session)) return;
  const generation = session.buildGeneration;
  session.buildTimer = setTimeout(() => {
    void buildReplayBufferSlice(session, generation);
  }, 0);
}

async function buildReplayBufferSlice(session, generation = session.buildGeneration) {
  session.buildTimer = 0;
  if (closing || replayBufferSession !== session || generation !== session.buildGeneration
      || session.buildBusy) return;
  if (session.presentationPending > 0) {
    session.buildTimer = setTimeout(() => {
      void buildReplayBufferSlice(session, generation);
    }, 0);
    return;
  }
  session.buildBusy = true;
  replayBufferCapturing = true;
  try {
    // Unpaced left-to-right capture through the capsule end. Playing slices
    // stay shorter than a display turn so the 60 Hz present timer can fire.
    const started = performance.now();
    const presentAt = session.presentationDueAt;
    const presentDeadline = Number.isFinite(presentAt) && presentAt > started
      ? presentAt : Infinity;
    const sliceMs = session.playing ? REPLAY_PLAY_BUILD_SLICE_MS : REPLAY_BUILD_SLICE_MS;
    const deadline = Math.min(started + sliceMs, presentDeadline);
    let advanced = false;
    while (replayNeedsBuild(session)) {
      const now = performance.now();
      if (now >= deadline) break;
      if ((presentDeadline !== Infinity || advanced)
          && now + session.buildTurnMs >= deadline)
        break;
      const turnStarted = now;
      if (session.activeSegment?.frames.length
          && (session.activeSegment.frames.length >= REPLAY_VISUAL_KEYFRAME_TURNS
            || session.activeSegment.rawBytes >= MAX_REPLAY_ACTIVE_SEGMENT_BYTES)) {
        await finalizeReplaySegment(session);
        if (closing || replayBufferSession !== session
            || generation !== session.buildGeneration) return;
        if (session.presentationPending > 0
            || performance.now() + session.buildTurnMs >= deadline)
          break;
      }
      applyReplayCursorEvents(session, session.turn);
      const priorEpoch = epoch;
      const fromWorldOffsetX = engine.getWorldOffsetX();
      const fromWorldOffsetY = engine.getWorldOffsetY();
      const flags = applyReplayCursorGate(session);
      const result = executeTurn(performance.now(), false, false, flags);
      session.turn++;
      applyReplayCursorEvents(session, session.turn);
      const startsNewVisualState = result.postedFull
        || (!result.shifted && epoch !== priorEpoch)
        || (session.activeSegment
          && (session.activeSegment.cols !== engine.cols
            || session.activeSegment.rows !== engine.rows));
      if (startsNewVisualState && session.activeSegment?.frames.length) {
        await finalizeReplaySegment(session);
        if (closing || replayBufferSession !== session
            || generation !== session.buildGeneration) return;
      }
      captureReplayVisualFrame(session, session.turn, {
        forceFull: startsNewVisualState,
        shifted: result.shifted,
        fromWorldOffsetX,
        fromWorldOffsetY,
      });
      session.buildTurnMs = performance.now() - turnStarted;
      advanced = true;
    }
    if (session.turn >= session.capsule.turns) {
      await finalizeReplaySegment(session);
      if (closing || replayBufferSession !== session
          || generation !== session.buildGeneration) return;
      session.complete = true;
      session.matched = replayStateMatches(session.capsule.final, replayFinalState());
    }
    postReplayBufferStatus(session);
    if (session.pendingSeek !== null && session.awaitingFrame === null) {
      const target = session.pendingSeek;
      const targetAvailable = !!activeReplayFrames(session, target)
        || !!session.cache.getByTurn(target);
      if (targetAvailable) {
        void postReplayVisualFrame(
          session, target, true, session.seekGeneration,
        ).catch((error) => failReplayBuffer(session, error));
      }
    } else if (session.playing && session.awaitingFrame === null
        && !session.playTimer) {
      scheduleReplayBufferPlayback(session);
    }
    if (replayNeedsBuild(session)) {
      const now = performance.now();
      const delay = Number.isFinite(session.presentationDueAt)
        && session.presentationDueAt > now
        && now + session.buildTurnMs >= session.presentationDueAt
        ? Math.max(0, session.presentationDueAt - now) : 0;
      session.buildTimer = setTimeout(() => {
        void buildReplayBufferSlice(session, generation);
      }, delay);
    }
  } catch (error) {
    failReplayBuffer(session, error);
  } finally {
    if (replayBufferSession === session) {
      replayBufferCapturing = false;
      session.buildBusy = false;
    }
  }
}

async function startReplayBuffer(requestId, value) {
  let capsule;
  try {
    capsule = validateReplayCapsule(value);
  } catch (error) {
    self.postMessage({ type: 'replay-error', requestId, message: error.message });
    return;
  }
  stopReplayBufferTimers();
  replayBufferSession = null;
  replayMicroscopeSession = null;
  clearTimeout(timer);
  replayRunning = true;
  replayTransportSuppressed = true;
  replayCaptureStarting = false;
  replayJournalEvents = [];
  replayJournalGateFlags = 0;
  pendingRuntimeConfig = null;
  pendingResize = null;
  pendingWeatherId = null;
  const initialized = await initializeAuthority(
    { type: 'init', ...capsule.init },
    { scheduleRuns: false, usePending: false },
  );
  if (!initialized || closing) {
    replayRunning = false;
    replayTransportSuppressed = false;
    self.postMessage({
      type: 'replay-error', requestId,
      message: 'The buffered replay could not initialize the authority.',
    });
    return;
  }
  const backingStore = await createReplaySegmentBackingStore();
  if (closing) {
    void backingStore?.clear();
    return;
  }
  const session = {
    requestId,
    capsule,
    cache: new ReplaySegmentCache({
      maxBytes: MAX_REPLAY_SEGMENT_CACHE_BYTES,
      backingStore,
    }),
    activeSegment: null,
    decodedSegments: new Map(),
    decodePromises: new Map(),
    decodeClock: 0,
    eventIndex: 0,
    gateIndex: 0,
    turn: 0,
    furthestTurn: 0,
    playhead: 0,
    presentedTurn: -1,
    pendingSeek: null,
    awaitingFrame: null,
    presentationPending: 0,
    playing: true,
    buffering: false,
    complete: false,
    matched: null,
    buildTimer: 0,
    buildBusy: false,
    buildGeneration: 1,
    seekGeneration: 0,
    playTimer: 0,
    nextPlayAt: NaN,
    presentationDueAt: NaN,
    buildTurnMs: 0,
  };
  replayBufferSession = session;
  applyReplayCursorEvents(session, 0);
  awaitingAck = false;
  captureReplayVisualFrame(session, 0, { forceFull: true });
  self.postMessage({
    type: 'replay-buffer-started', requestId,
    turns: capsule.turns,
  });
  void postReplayVisualFrame(session, 0, true).catch((error) => {
    failReplayBuffer(session, error);
  });
  postReplayBufferStatus(session);
  session.buildTimer = setTimeout(() => {
    void buildReplayBufferSlice(session, session.buildGeneration);
  }, 0);
}

function controlReplayBuffer(data) {
  const session = replayBufferSession;
  if (!session) return;
  if (data.type === 'replay-buffer-pause') {
    session.playing = !data.paused;
    session.buffering = false;
    session.nextPlayAt = NaN;
    session.presentationDueAt = NaN;
    if (!session.playing) clearTimeout(session.playTimer);
    else scheduleReplayBufferPlayback(session, true);
    ensureReplayBuild(session);
    postReplayBufferStatus(session);
    return;
  }
  if (data.type === 'replay-buffer-seek') {
    const target = Math.max(0, Math.min(session.capsule.turns, data.turn | 0));
    session.playing = !!data.playAfter;
    session.nextPlayAt = NaN;
    session.presentationDueAt = NaN;
    session.pendingSeek = target;
    session.seekGeneration++;
    clearTimeout(session.playTimer);
    session.playTimer = 0;
    if (session.awaitingFrame !== null) {
      session.buffering = true;
    } else if (activeReplayFrames(session, target) || session.cache.getByTurn(target)) {
      session.buffering = false;
      void postReplayVisualFrame(
        session, target, true, session.seekGeneration,
      ).catch((error) => failReplayBuffer(session, error));
    } else {
      session.buffering = true;
    }
    ensureReplayBuild(session);
    postReplayBufferStatus(session);
    return;
  }
  if (data.type === 'replay-buffer-frame-applied') {
    if (session.awaitingFrame !== (data.turn | 0)) return;
    session.presentedTurn = session.awaitingFrame;
    session.playhead = session.awaitingFrame;
    session.awaitingFrame = null;
    if (session.pendingSeek !== null) {
      const target = session.pendingSeek;
      if (session.playhead === target) {
        session.pendingSeek = null;
        session.buffering = false;
        if (session.playing)
          scheduleReplayBufferPlayback(session, !Number.isFinite(session.nextPlayAt));
      } else if (activeReplayFrames(session, target) || session.cache.getByTurn(target)) {
        void postReplayVisualFrame(
          session, target, true, session.seekGeneration,
        ).catch((error) => failReplayBuffer(session, error));
      } else {
        session.buffering = true;
      }
    } else if (session.playing) {
      scheduleReplayBufferPlayback(session, !Number.isFinite(session.nextPlayAt));
    }
    ensureReplayBuild(session);
    postReplayBufferStatus(session);
  }
}

function replayBranchCapsule(capsule, turn, view) {
  return {
    format: capsule.format,
    version: capsule.version,
    abiVersion: capsule.abiVersion,
    abiFingerprint: capsule.abiFingerprint,
    init: copyReplayValue(capsule.init),
    turns: turn,
    events: capsule.events
      .filter((event) => event.tick <= turn)
      .map((event) => copyReplayValue(event)),
    gates: capsule.gates
      .filter((gate) => gate.start < turn)
      .map((gate) => ({
        start: gate.start,
        end: Math.min(turn, gate.end),
        flags: gate.flags,
      })),
    view: copyReplayValue(view || capsule.view || {}),
  };
}

function finishReplayResume(session, requestId, target) {
  applyReplayCursorEvents(session, target);
  if (survival && localPlayerId && latestInput) {
    latestInput = { ...latestInput, bits: 0, moveX: 0, moveY: 0 };
    engine.setPlayerInput(localPlayerId, {
      ...latestInput,
      aimX: Math.floor(latestInput.worldAimX - engine.getWorldOffsetX()),
      aimY: Math.floor(latestInput.worldAimY - engine.getWorldOffsetY()),
    });
  }
  workerButtons = 0;
  edges = [];
  if (control) control = { ...control, buttons: 0, inside: false };
  engine.pointerButtons(0);
  const branch = replayBranchCapsule(session.capsule, target, replayView(session));
  replayCapture = branch;
  replayCaptureStarting = false;
  replayInputSignature = '';
  replayJournalEvents = [];
  replayJournalGateFlags = 0;
  replayRunning = false;
  replayTransportSuppressed = false;
  replayBufferCapturing = false;
  replayBufferSession = null;
  replayResumeRequestId = requestId;
  paused = true;
  awaitingAck = false;
  fullResyncRequested = false;
  epoch++;
  sequence = 0;
  postFull('replay-resume', {
    replayView: branch.view,
    replayResumeRequestId: requestId,
  });
  postCreatures();
  postDraft();
  postActors(true);
  self.postMessage({ type: 'replay-branch', capsule: branch });
  self.postMessage({ type: 'replay-buffer-resume-ready', requestId, turn: target });
}

async function resumeReplayBuffer(requestId, value) {
  const active = replayBufferSession;
  if (!active) {
    self.postMessage({
      type: 'replay-error', requestId,
      message: 'Open a buffered replay before resuming from its timeline.',
    });
    return;
  }
  const target = Math.max(0, Math.min(active.capsule.turns, value | 0));
  const capsule = active.capsule;
  stopReplayBufferTimers(active);
  active.buildGeneration++;
  active.playing = false;
  replayBufferSession = null;
  replayBufferCapturing = true;
  replayTransportSuppressed = true;
  replayRunning = true;

  if (active.activeSegment?.encodingPromise)
    await active.activeSegment.encodingPromise;
  void active.cache.clear();

  let session = active;
  if (active.turn !== target) {
    const initialized = await initializeAuthority(
      { type: 'init', ...capsule.init },
      { scheduleRuns: false, usePending: false },
    );
    if (!initialized || closing) {
      replayBufferCapturing = false;
      replayTransportSuppressed = false;
      replayRunning = false;
      self.postMessage({
        type: 'replay-error', requestId,
        message: 'The replay branch could not initialize the authority.',
      });
      return;
    }
    session = { capsule, eventIndex: 0, gateIndex: 0, turn: 0 };
  }
  const abortResume = (error) => {
    replayBufferCapturing = false;
    replayTransportSuppressed = false;
    replayRunning = false;
    paused = true;
    self.postMessage({
      type: 'replay-error', requestId,
      message: error?.message || String(error),
    });
  };
  const advance = () => {
    if (closing) return;
    try {
      const sliceDeadline = performance.now() + REPLAY_RESUME_SLICE_MS;
      while (session.turn < target) {
        applyReplayCursorEvents(session, session.turn);
        const flags = applyReplayCursorGate(session);
        executeTurn(performance.now(), false, false, flags);
        session.turn++;
        if (performance.now() >= sliceDeadline) break;
      }
      if (session.turn >= target) {
        finishReplayResume(session, requestId, target);
        return;
      }
      self.postMessage({
        type: 'replay-buffer-resume-progress', requestId,
        turn: session.turn, turns: target,
      });
      setTimeout(advance, 0);
    } catch (error) {
      abortResume(error);
    }
  };
  advance();
}

async function resetReplayMicroscope(capsule, options) {
  clearTimeout(timer);
  replayRunning = true;
  replayTransportSuppressed = true;
  replayCaptureStarting = false;
  replayJournalEvents = [];
  replayJournalGateFlags = 0;
  pendingRuntimeConfig = null;
  pendingResize = null;
  pendingWeatherId = null;
  const initialized = await initializeAuthority(
    { type: 'init', ...capsule.init },
    { scheduleRuns: false, usePending: false },
  );
  if (!initialized || closing)
    throw new Error('The replay microscope could not initialize the authority.');
  const { createReplayMicroscopeProbe } = await import('./replayMicroscopeWorker.js');
  const probe = createReplayMicroscopeProbe(engine, options);
  replayMicroscopeSession = {
    capsule,
    eventIndex: 0,
    gateIndex: 0,
    turn: 0,
    probe,
  };
  probe.observe(0);
  return replayMicroscopeSession;
}

function applyReplayCursorEvents(session, turn) {
  const { capsule } = session;
  while (session.eventIndex < capsule.events.length
         && capsule.events[session.eventIndex].tick === turn) {
    applyRuntimeMessage(capsule.events[session.eventIndex].message);
    session.eventIndex++;
  }
}

function applyReplayCursorGate(session) {
  const { capsule, turn } = session;
  while (session.gateIndex < capsule.gates.length
         && capsule.gates[session.gateIndex].end <= turn) session.gateIndex++;
  const gate = capsule.gates[session.gateIndex];
  const flags = gate && gate.start <= turn && turn < gate.end ? gate.flags : 0;
  awaitingAck = !!(flags & REPLAY_GATE_AWAITING_ACK);
  fullResyncRequested = !!(flags & REPLAY_GATE_FULL_RESYNC);
  return flags;
}

async function seekReplayMicroscope(requestId, value, target, options = {}) {
  if (!import.meta.env.DEV) {
    self.postMessage({
      type: 'replay-error', requestId,
      message: 'The replay microscope is available only from the development build.',
    });
    return;
  }
  let capsule;
  try {
    capsule = value ? validateReplayCapsule(value) : replayMicroscopeSession?.capsule;
    if (!capsule) throw new Error('Open a replay before seeking its timeline.');
    target = Math.max(0, Math.min(capsule.turns, target | 0));
  } catch (error) {
    self.postMessage({ type: 'replay-error', requestId, message: error.message });
    return;
  }

  try {
    const mustReset = !replayMicroscopeSession || value
      || target < replayMicroscopeSession.turn;
    const session = mustReset
      ? await resetReplayMicroscope(capsule, options)
      : replayMicroscopeSession;
    replayRunning = true;
    replayTransportSuppressed = true;

    const fail = (error) => {
      replayRunning = false;
      replayTransportSuppressed = false;
      paused = true;
      self.postMessage({
        type: 'replay-error', requestId,
        message: error?.message || String(error),
      });
    };
    const finish = () => {
      try {
        applyReplayCursorEvents(session, session.turn);
        paused = true;
        replayRunning = false;
        replayTransportSuppressed = false;
        const diagnostics = session.probe.snapshot(session.turn, options);
        diagnostics.replayState = replayFinalState();
        postFull('replay-microscope', {
          microscopeRequestId: requestId,
          replayView: {
            cameraWorldX: diagnostics.camera.worldX,
            cameraWorldY: diagnostics.camera.worldY,
          },
        });
        postActors(true);
        self.postMessage({
          type: 'replay-microscope-frame', requestId,
          diagnostics,
        });
      } catch (error) {
        fail(error);
      }
    };
    const advanceSlice = () => {
      if (closing || !replayRunning) return;
      try {
        const end = Math.min(target, session.turn + 120);
        while (session.turn < end) {
          applyReplayCursorEvents(session, session.turn);
          applyReplayCursorGate(session);
          executeTurn(performance.now(), false);
          session.turn++;
          session.probe.observe(session.turn);
        }
        if (session.turn >= target) {
          finish();
          return;
        }
        self.postMessage({
          type: 'replay-progress', requestId,
          turn: session.turn, turns: capsule.turns,
        });
        setTimeout(advanceSlice, 0);
      } catch (error) {
        fail(error);
      }
    };
    advanceSlice();
  } catch (error) {
    replayRunning = false;
    replayTransportSuppressed = false;
    paused = true;
    self.postMessage({
      type: 'replay-error', requestId,
      message: error?.message || String(error),
    });
  }
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
  if (data.type === 'replay-buffer-start') {
    if (replayRunning) {
      self.postMessage({
        type: 'replay-error', requestId: data.requestId,
        message: 'A replay is already running.',
      });
      return;
    }
    await startReplayBuffer(data.requestId, data.capsule);
    return;
  }
  if (data.type === 'replay-buffer-pause'
      || data.type === 'replay-buffer-seek'
      || data.type === 'replay-buffer-frame-applied') {
    controlReplayBuffer(data);
    return;
  }
  if (data.type === 'replay-buffer-resume') {
    await resumeReplayBuffer(data.requestId, data.turn);
    return;
  }
  if (data.type === 'replay-buffer-resume-applied') {
    if ((data.requestId | 0) !== replayResumeRequestId) return;
    replayResumeRequestId = 0;
    paused = false;
    turnDeadline.reset(performance.now());
    schedule();
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
    await runReplayCapsule(data.requestId, data.capsule, {
      playback: !!data.playback,
    });
    return;
  }
  if (data.type === 'replay-microscope-seek') {
    if (replayRunning) {
      self.postMessage({
        type: 'replay-error', requestId: data.requestId,
        message: 'A replay seek is already running.',
      });
      return;
    }
    await seekReplayMicroscope(
      data.requestId, data.capsule, data.turn, data.options,
    );
    return;
  }
  if (replayRunning) {
    if (replayBufferSession) return;
    if (data.type === 'ack' || data.type === 'resync') {
      applyRuntimeMessage(data);
      if (!awaitingAck && replayPlaybackStart) replayPlaybackStart();
    }
    return;
  }
  if (data.type === 'init') {
    stopReplayBufferTimers();
    replayBufferSession = null;
    replayMicroscopeSession = null;
    beginReplayCapture(data);
    await initializeAuthority(data);
    return;
  }
  if (REPLAY_EVENT_TYPES.has(data.type)) recordReplayMessage(data);
  if (data.type === 'config' && !engine) {
    pendingRuntimeConfig = { ...pendingRuntimeConfig, ...data };
    return;
  }
  if (data.type === 'weather' && !engine) {
    pendingWeatherId = data.weatherId | 0;
    return;
  }
  if (data.type === 'resize' && !engine) {
    pendingResize = data;
    return;
  }
  if (data.type === 'liveness-probe') {
    setLivenessStage(livenessStage, true);
    return;
  }
  if (!engine) return;
  applyRuntimeMessage(data);
};

setLivenessStage(WORKER_LIVENESS_STAGE.INITIALIZING, true);
