import { ABI_FINGERPRINT, ABI_VERSION } from '../wasmBridge/abi.generated.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';

export const REPLAY_FORMAT = 'sand-input-replay';
export const REPLAY_VERSION = 2;
export const REPLAY_PREFIX = 'SAND-REPLAY-2:';

export const REPLAY_EVENT_TYPES = new Set([
  'control', 'input', 'intent', 'edge', 'config', 'resize',
  'test-paint-disc', 'test-seed-reaction', 'test-creature-runtime',
  'test-natural-spawn', 'test-step-actors',
]);

const MAX_REPLAY_TURNS = 2_000_000;
const MAX_REPLAY_TEXT_BYTES = 64 * 1024 * 1024;

export function copyReplayValue(value) {
  return JSON.parse(JSON.stringify(value));
}

const finiteInteger = (value, min, max) => Number.isInteger(value)
  && value >= min && value <= max;

export function validateReplayCapsule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Replay capsule must be an object.');
  if (value.format !== REPLAY_FORMAT || value.version !== REPLAY_VERSION)
    throw new Error('This is not a supported sand replay capsule.');
  if (value.abiVersion !== ABI_VERSION || value.abiFingerprint !== ABI_FINGERPRINT)
    throw new Error('This replay was recorded by an incompatible sand engine build.');

  const init = value.init;
  if (!init || typeof init !== 'object') throw new Error('Replay initialization is missing.');
  if (!finiteInteger(init.cols, 1, ENGINE_MAX_DIMENSION)
      || !finiteInteger(init.rows, 1, ENGINE_MAX_DIMENSION)
      || init.cols * init.rows > ENGINE_MAX_CELLS)
    throw new Error('Replay dimensions are invalid.');
  if (!finiteInteger(init.worldSeed, 0, 0xffffffff))
    throw new Error('Replay world seed is invalid.');

  const turns = value.turns;
  const events = value.events;
  const gates = value.gates;
  if (!finiteInteger(turns, 0, MAX_REPLAY_TURNS))
    throw new Error('Replay turn count is invalid or too large.');
  if (!Array.isArray(events) || events.length > MAX_REPLAY_TURNS * 4)
    throw new Error('Replay event list is invalid or too large.');
  if (!Array.isArray(gates) || gates.length > MAX_REPLAY_TURNS)
    throw new Error('Replay transport gate list is invalid or too large.');
  let previousTick = -1;
  for (const event of events) {
    if (!event || typeof event !== 'object'
        || !finiteInteger(event.tick, 0, turns)
        || event.tick < previousTick
        || !event.message || typeof event.message !== 'object'
        || !REPLAY_EVENT_TYPES.has(event.message.type))
      throw new Error('Replay contains an invalid authority event.');
    previousTick = event.tick;
  }
  let previousEnd = 0;
  for (const gate of gates) {
    if (!gate || typeof gate !== 'object'
        || !finiteInteger(gate.start, previousEnd, turns)
        || !finiteInteger(gate.end, gate.start + 1, turns)
        || !finiteInteger(gate.flags, 1, 3))
      throw new Error('Replay contains an invalid transport gate range.');
    previousEnd = gate.end;
  }

  const final = value.final;
  if (!final || typeof final !== 'object'
      || !finiteInteger(final.tick, 0, MAX_REPLAY_TURNS)
      || !finiteInteger(final.actorTick, 0, 0x7fffffff)
      || !finiteInteger(final.cols, 1, ENGINE_MAX_DIMENSION)
      || !finiteInteger(final.rows, 1, ENGINE_MAX_DIMENSION)
      || !finiteInteger(final.gridHash, 0, 0xffffffff)
      || !Number.isInteger(final.worldOffsetX)
      || !Number.isInteger(final.worldOffsetY))
    throw new Error('Replay final-state check is invalid.');

  return value;
}

function packReplayCapsule(capsule) {
  return {
    ...capsule,
    events: capsule.events.map((event) => [event.tick, event.message]),
    gates: capsule.gates.map((gate) => [gate.start, gate.end, gate.flags]),
  };
}

function unpackReplayCapsule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Array.isArray(value.events) || !Array.isArray(value.gates))
    throw new Error('This is not a supported sand replay capsule.');
  return {
    ...value,
    events: value.events.map(([tick, message]) => ({ tick, message })),
    gates: value.gates.map(([start, end, flags]) => ({ start, end, flags })),
  };
}

const replayTextBytes = (text) => new TextEncoder().encode(text).length;

export function encodeReplayCapsule(capsule) {
  validateReplayCapsule(capsule);
  const text = `${REPLAY_PREFIX}${JSON.stringify(packReplayCapsule(capsule))}`;
  if (replayTextBytes(text) > MAX_REPLAY_TEXT_BYTES)
    throw new Error('Replay capsule is too large.');
  return text;
}

export function decodeReplayCapsule(text) {
  const compact = String(text || '').trim();
  if (!compact.startsWith(REPLAY_PREFIX))
    throw new Error('Replay text must start with SAND-REPLAY-2:.');
  if (replayTextBytes(compact) > MAX_REPLAY_TEXT_BYTES)
    throw new Error('Replay capsule is too large.');
  const payload = compact.slice(REPLAY_PREFIX.length);
  if (!payload) throw new Error('Replay text is incomplete.');
  const value = JSON.parse(payload);
  return validateReplayCapsule(unpackReplayCapsule(value));
}
