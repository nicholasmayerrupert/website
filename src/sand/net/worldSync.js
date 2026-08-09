// Client-side world replication: apply incoming world/diff messages to the
// local render engine, plus the shared base64 helpers. The host-side encode
// half lives in server/worldEncode.js so it never ships in the browser bundle.

import {
  isValidWorldRle,
  maxWorldDiffBytes,
  maxWorldRleBytes,
  worldRleHash,
} from '../worldPacketValidation.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';

// base64 <-> Uint8Array, chunked so large snapshots don't overflow the call
// stack (String.fromCharCode(...big) throws). Node uses Buffer when available.
const hasBuffer = typeof globalThis.Buffer !== 'undefined';
export function bytesToB64(u8) {
  if (hasBuffer) return globalThis.Buffer.from(u8).toString('base64');
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(s);
}
export function b64ToBytes(s) {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) {
    throw new Error('invalid base64 payload');
  }
  if (hasBuffer) return new Uint8Array(globalThis.Buffer.from(s, 'base64'));
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function validateWorldMessage(m, { verifyHash = false } = {}) {
  const cells = m?.cols * m?.rows;
  if (!Number.isInteger(m?.cols) || !Number.isInteger(m?.rows) || m.cols <= 0 || m.rows <= 0 ||
      m.cols > ENGINE_MAX_DIMENSION || m.rows > ENGINE_MAX_DIMENSION
      || !Number.isSafeInteger(cells) || cells > ENGINE_MAX_CELLS ||
      typeof m.data !== 'string' || !Number.isInteger(m.hash)
      || m.hash < 0 || m.hash > 0xffffffff) return null;
  // Alternating cells are the largest legal RLE stream: five bytes per cell,
  // for each of the two layers. Reject oversized input before allocating it.
  if (m.data.length > Math.ceil(maxWorldRleBytes(cells) / 3) * 4 + 4) return null;
  try {
    const bytes = b64ToBytes(m.data);
    if (verifyHash)
      return worldRleHash(bytes, cells) === (m.hash >>> 0) ? bytes : null;
    return isValidWorldRle(bytes, cells) ? bytes : null;
  } catch { return null; }
}

// Client: apply a world / diff message. Returns whether the post-apply grid hash
// matches the host's stated hash (a mismatch on a diff means a lost packet -> the
// client should request a resync).
export function applyWorldMessage(engine, m, { mirror = false, validatedBytes = null } = {}) {
  if (!engine || engine.cols !== m?.cols || engine.rows !== m?.rows) return false;
  // `validatedBytes` is an internal fast path for callers that just received
  // this array from validateWorldMessage. Direct callers still take the full JS
  // boundary validation below; the native decoder validates transactionally in
  // both cases before mutating the engine.
  const payload = validatedBytes ?? validateWorldMessage(m);
  if (!(payload instanceof Uint8Array)) return false;
  let applied;
  if (mirror) {
    applied = engine.applyWorldMirror(payload, m.offsetX, m.offsetY);
    if (applied === false) return false;
  } else if (engine.applyWorld(payload) === false) return false;
  if (engine.gridHash() !== (m.hash >>> 0)) return false;
  if (mirror) engine.setMirrorWorldTick?.(m.tick);
  return true;
}
export function applyDiffMessage(engine, m, { mirror = false } = {}) {
  if (!engine || typeof m?.data !== 'string'
      || m.data.length > Math.ceil(maxWorldDiffBytes(engine.cols * engine.rows) / 3) * 4 + 4) return false;
  let bytes;
  try { bytes = b64ToBytes(m.data); } catch { return false; }
  if (mirror) {
    if (engine.applyDiffMirror(bytes) === false) return false;
  } else if (engine.applyDiff(bytes) === false) return false;
  if (engine.gridHash() !== (m.hash >>> 0)) return false;
  if (mirror) engine.setMirrorWorldTick?.(m.tick);
  return true;
}
