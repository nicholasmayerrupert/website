// Client-side world replication: apply incoming world/diff messages to the
// local render engine, plus the shared base64 helpers. The host-side encode
// half lives in server/worldEncode.js so it never ships in the browser bundle.

// base64 <-> Uint8Array, chunked so large snapshots don't overflow the call
// stack (String.fromCharCode(...big) throws). Node uses Buffer when available.
const hasBuffer = typeof Buffer !== 'undefined';
export function bytesToB64(u8) {
  if (hasBuffer) return Buffer.from(u8).toString('base64');
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(s);
}
export function b64ToBytes(s) {
  if (hasBuffer) return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// Client: apply a world / diff message. Returns whether the post-apply grid hash
// matches the host's stated hash (a mismatch on a diff means a lost packet -> the
// client should request a resync).
export function applyWorldMessage(engine, m) {
  engine.applyWorld(b64ToBytes(m.data));
  return engine.gridHash() === (m.hash >>> 0);
}
export function applyDiffMessage(engine, m) {
  engine.applyDiff(b64ToBytes(m.data));
  return engine.gridHash() === (m.hash >>> 0);
}
