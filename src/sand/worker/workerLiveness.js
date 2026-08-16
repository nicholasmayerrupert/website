export const WORKER_LIVENESS_STAGE = Object.freeze({
  INITIALIZING: 0,
  STREAM: 1,
  STEP_ACTORS: 2,
  STEP_WORLD: 3,
  TRANSPORT: 4,
  SCHEDULED: 5,
  PAUSED: 6,
  WAITING_CONTROL: 7,
  FAILED: 8,
});

const SIGNAL_UNIT = 64;
const STAGE_MASK = 15;
const AWAITING_ACK = 16;
const HAS_CONTROL = 32;

const STAGE_NAMES = Object.freeze([
  'initializing',
  'stream',
  'step-actors',
  'step-world',
  'transport',
  'scheduled',
  'paused',
  'waiting-control',
  'failed',
]);

export function encodeWorkerLiveness(stage, turn, awaitingAck, hasControl) {
  const safeTurn = Number.isSafeInteger(turn) && turn > 0 ? turn : 0;
  return safeTurn * SIGNAL_UNIT
    + (stage & STAGE_MASK)
    + (awaitingAck ? AWAITING_ACK : 0)
    + (hasControl ? HAS_CONTROL : 0);
}

export function decodeWorkerLiveness(signal) {
  if (!Number.isSafeInteger(signal) || signal < 0) return null;
  const flags = signal % SIGNAL_UNIT;
  const stage = flags & STAGE_MASK;
  if (stage >= STAGE_NAMES.length) return null;
  return {
    stage,
    stageName: STAGE_NAMES[stage],
    turn: Math.floor(signal / SIGNAL_UNIT),
    awaitingAck: (flags & AWAITING_ACK) !== 0,
    hasControl: (flags & HAS_CONTROL) !== 0,
  };
}

export function createWorkerLivenessMonitor({
  now = () => performance.now(),
  stallMs = 2000,
  noDiffMs = 1000,
} = {}) {
  const state = {
    status: 'initializing',
    stage: 'initializing',
    stageAgeMs: 0,
    progressAgeMs: 0,
    messageAgeMs: 0,
    packetAgeMs: 0,
    applyAgeMs: 0,
    turn: 0,
    completedTurn: 0,
    awaitingAck: false,
    hasControl: false,
    authorityTick: 0,
    packetTick: 0,
    mirrorTick: 0,
    tickLag: 0,
  };
  let stageCode = WORKER_LIVENESS_STAGE.INITIALIZING;
  let stageAt = now();
  let lastProgressAt = stageAt;
  let lastMessageAt = stageAt;
  let lastPacketAt = stageAt;
  let lastApplyAt = stageAt;
  let ackSince = null;

  const reset = () => {
    const at = now();
    stageCode = WORKER_LIVENESS_STAGE.INITIALIZING;
    stageAt = lastProgressAt = lastMessageAt = lastPacketAt = lastApplyAt = at;
    ackSince = null;
    Object.assign(state, {
      status: 'initializing', stage: 'initializing', stageAgeMs: 0, progressAgeMs: 0,
      messageAgeMs: 0, packetAgeMs: 0, applyAgeMs: 0,
      turn: 0, completedTurn: 0, awaitingAck: false, hasControl: false,
      authorityTick: 0, packetTick: 0, mirrorTick: 0, tickLag: 0,
    });
  };

  const noteMessage = (at = now()) => { lastMessageAt = at; };

  const noteSignal = (signal, at = now()) => {
    const decoded = decodeWorkerLiveness(signal);
    if (!decoded) return false;
    lastMessageAt = at;
    const stageAdvanced = decoded.turn !== state.turn
      || decoded.stage !== stageCode
      || (decoded.stage === WORKER_LIVENESS_STAGE.SCHEDULED
          && decoded.turn > state.completedTurn);
    if (stageAdvanced) {
      stageAt = at;
      lastProgressAt = at;
    }
    stageCode = decoded.stage;
    state.stage = decoded.stageName;
    state.turn = decoded.turn;
    if (decoded.stage === WORKER_LIVENESS_STAGE.SCHEDULED)
      state.completedTurn = Math.max(state.completedTurn, decoded.turn);
    else if (decoded.turn > 0)
      state.completedTurn = Math.max(state.completedTurn, decoded.turn - 1);
    if (decoded.awaitingAck && !state.awaitingAck) ackSince = at;
    if (!decoded.awaitingAck) ackSince = null;
    state.awaitingAck = decoded.awaitingAck;
    state.hasControl = decoded.hasControl;
    return true;
  };

  const noteAuthorityTick = (tick, at = now()) => {
    noteMessage(at);
    if (Number.isFinite(tick)) {
      const nextTick = Math.max(0, tick | 0);
      if (nextTick !== state.authorityTick) lastProgressAt = at;
      state.authorityTick = nextTick;
    }
  };

  const notePacket = (tick, at = now()) => {
    lastPacketAt = at;
    noteAuthorityTick(tick, at);
    if (Number.isFinite(tick)) state.packetTick = Math.max(0, tick | 0);
  };

  const noteApplied = (tick, at = now()) => {
    lastApplyAt = at;
    if (Number.isFinite(tick)) state.mirrorTick = Math.max(0, tick | 0);
  };

  const noteAck = () => {
    ackSince = null;
    state.awaitingAck = false;
  };

  const noteFailure = (at = now()) => {
    lastMessageAt = stageAt = at;
    stageCode = WORKER_LIVENESS_STAGE.FAILED;
    state.stage = 'failed';
  };

  const snapshot = (at = now()) => {
    state.stageAgeMs = Math.max(0, at - stageAt);
    state.progressAgeMs = Math.max(0, at - lastProgressAt);
    state.messageAgeMs = Math.max(0, at - lastMessageAt);
    state.packetAgeMs = Math.max(0, at - lastPacketAt);
    state.applyAgeMs = Math.max(0, at - lastApplyAt);
    state.tickLag = Math.max(0, state.packetTick - state.mirrorTick);

    if (stageCode === WORKER_LIVENESS_STAGE.FAILED) state.status = 'failed';
    else if (stageCode === WORKER_LIVENESS_STAGE.PAUSED) state.status = 'paused';
    else if (stageCode === WORKER_LIVENESS_STAGE.WAITING_CONTROL)
      state.status = 'waiting-control';
    else if (stageCode === WORKER_LIVENESS_STAGE.STREAM
             && state.stageAgeMs >= stallMs)
      state.status = 'blocked-streaming';
    else if (stageCode === WORKER_LIVENESS_STAGE.STEP_ACTORS
             && state.stageAgeMs >= stallMs)
        state.status = 'blocked-step-actors';
    else if (stageCode === WORKER_LIVENESS_STAGE.STEP_WORLD
             && state.stageAgeMs >= stallMs)
        state.status = 'blocked-step-world';
    else if (stageCode === WORKER_LIVENESS_STAGE.TRANSPORT
             && state.stageAgeMs >= stallMs)
      state.status = 'blocked-transport';
    else if (stageCode === WORKER_LIVENESS_STAGE.SCHEDULED
             && state.progressAgeMs >= stallMs)
        state.status = 'stopped-scheduling';
    else if (stageCode === WORKER_LIVENESS_STAGE.INITIALIZING)
      state.status = state.progressAgeMs >= stallMs
        ? 'stopped-initializing'
        : 'initializing';
    else if (state.awaitingAck && ackSince !== null && at - ackSince >= stallMs) {
      state.status = 'waiting-ack';
    } else if (state.packetAgeMs >= noDiffMs && state.progressAgeMs < stallMs) {
      state.status = 'live-no-diffs';
    } else {
      state.status = 'live';
    }
    return state;
  };

  return {
    reset,
    noteMessage,
    noteSignal,
    noteAuthorityTick,
    notePacket,
    noteApplied,
    noteAck,
    noteFailure,
    snapshot,
  };
}
