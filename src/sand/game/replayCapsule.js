import { ABI_FINGERPRINT, ABI_VERSION } from '../wasmBridge/abi.generated.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';

export const REPLAY_FORMAT = 'sand-input-replay';
export const REPLAY_VERSION = 1;
export const REPLAY_PREFIX = 'SAND-REPLAY-1:';

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
  if (!Array.isArray(turns) || turns.length > MAX_REPLAY_TURNS)
    throw new Error('Replay turn list is invalid or too large.');
  if (!Array.isArray(events) || events.length > MAX_REPLAY_TURNS * 4)
    throw new Error('Replay event list is invalid or too large.');
  for (const turn of turns) {
    if (!turn || typeof turn !== 'object'
        || !Number.isFinite(turn.now) || turn.now < 0
        || typeof turn.awaitingAck !== 'boolean'
        || typeof turn.fullResyncRequested !== 'boolean'
        || (turn.inputSeq !== null
          && !finiteInteger(turn.inputSeq, 0, 0xffffffff)))
      throw new Error('Replay contains an invalid turn timestamp.');
  }
  let previousTick = -1;
  for (const event of events) {
    if (!event || typeof event !== 'object'
        || !finiteInteger(event.tick, 0, turns.length)
        || event.tick < previousTick
        || !event.message || typeof event.message !== 'object'
        || !REPLAY_EVENT_TYPES.has(event.message.type))
      throw new Error('Replay contains an invalid authority event.');
    previousTick = event.tick;
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
  if (final.tick !== turns.length)
    throw new Error('Replay turn count does not match its final tick.');

  return value;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  if (binary.length > MAX_REPLAY_TEXT_BYTES)
    throw new Error('Replay capsule is too large.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readLimited(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) { finished = true; continue; }
    length += value.length;
    if (length > MAX_REPLAY_TEXT_BYTES) {
      await reader.cancel();
      throw new Error('Replay capsule expands beyond the size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function encodeReplayCapsule(capsule) {
  validateReplayCapsule(capsule);
  const bytes = new TextEncoder().encode(JSON.stringify(capsule));
  if (typeof CompressionStream === 'function') {
    const compressed = await readLimited(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    );
    return `${REPLAY_PREFIX}gzip:${bytesToBase64(compressed)}`;
  }
  return `${REPLAY_PREFIX}json:${bytesToBase64(bytes)}`;
}

export async function decodeReplayCapsule(text) {
  const compact = String(text || '').trim();
  if (!compact.startsWith(REPLAY_PREFIX))
    throw new Error('Replay text must start with SAND-REPLAY-1:.');
  const payload = compact.slice(REPLAY_PREFIX.length);
  const separator = payload.indexOf(':');
  if (separator < 0) throw new Error('Replay text is incomplete.');
  const encoding = payload.slice(0, separator);
  let bytes = base64ToBytes(payload.slice(separator + 1));
  if (encoding === 'gzip') {
    if (typeof DecompressionStream !== 'function')
      throw new Error('This browser cannot decompress replay capsules.');
    bytes = await readLimited(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    );
  } else if (encoding !== 'json') {
    throw new Error('Replay text uses an unknown encoding.');
  }
  return validateReplayCapsule(JSON.parse(new TextDecoder().decode(bytes)));
}
