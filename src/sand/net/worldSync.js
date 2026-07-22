// Client-side world replication: apply incoming world/diff messages to the
// local render engine, plus the shared base64 helpers. The host-side encode
// half lives in server/worldEncode.js so it never ships in the browser bundle.

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

const readU16 = (b, p) => b[p] | (b[p + 1] << 8);
const readU32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

function validWorldRle(bytes, cells) {
  let p = 0;
  for (let layer = 0; layer < 2; layer++) {
    let filled = 0;
    while (filled < cells) {
      if (p + 5 > bytes.length) return false;
      const run = readU32(bytes, p);
      p += 5;
      if (run === 0 || run > cells - filled) return false;
      filled += run;
    }
  }
  return p === bytes.length;
}

function validDiff(bytes, cols, rows) {
  let p = 0;
  for (let layer = 0; layer < 2; layer++) {
    if (p + 2 > bytes.length) return false;
    const rects = readU16(bytes, p); p += 2;
    for (let i = 0; i < rects; i++) {
      if (p + 8 > bytes.length) return false;
      const x0 = readU16(bytes, p), y0 = readU16(bytes, p + 2);
      const x1 = readU16(bytes, p + 4), y1 = readU16(bytes, p + 6);
      p += 8;
      if (x1 < x0 || y1 < y0 || x1 > cols || y1 > rows) return false;
      const area = (x1 - x0) * (y1 - y0);
      if (p + area > bytes.length) return false;
      p += area;
    }
  }
  return p === bytes.length;
}

export function validateWorldMessage(m) {
  const cells = m?.cols * m?.rows;
  if (!Number.isInteger(m?.cols) || !Number.isInteger(m?.rows) || m.cols <= 0 || m.rows <= 0 ||
      m.cols > 16384 || m.rows > 16384 || !Number.isSafeInteger(cells) || cells > 8_000_000 ||
      typeof m.data !== 'string') return null;
  // Alternating cells are the largest legal RLE stream: five bytes per cell,
  // for each of the two layers. Reject oversized input before allocating it.
  if (m.data.length > Math.ceil((cells * 10) / 3) * 4 + 4) return null;
  try {
    const bytes = b64ToBytes(m.data);
    return validWorldRle(bytes, cells) ? bytes : null;
  } catch { return null; }
}

// Client: apply a world / diff message. Returns whether the post-apply grid hash
// matches the host's stated hash (a mismatch on a diff means a lost packet -> the
// client should request a resync).
export function applyWorldMessage(engine, m, { mirror = false, bytes = null } = {}) {
  if (!engine || engine.cols !== m.cols || engine.rows !== m.rows) return false;
  const payload = bytes ?? validateWorldMessage(m);
  if (!payload) return false;
  if (mirror) {
    engine.applyWorldMirror(payload, 0, 0);
    engine.setMirrorWorldTick?.(m.tick);
  } else engine.applyWorld(payload);
  return engine.gridHash() === (m.hash >>> 0);
}
export function applyDiffMessage(engine, m, { mirror = false } = {}) {
  if (!engine || typeof m?.data !== 'string' || m.data.length > Math.ceil((engine.cols * engine.rows * 18) / 3) * 4 + 16) return false;
  let bytes;
  try { bytes = b64ToBytes(m.data); } catch { return false; }
  if (!validDiff(bytes, engine.cols, engine.rows)) return false;
  if (mirror) {
    engine.applyDiffMirror(bytes);
    engine.setMirrorWorldTick?.(m.tick);
  } else engine.applyDiff(bytes);
  return engine.gridHash() === (m.hash >>> 0);
}
