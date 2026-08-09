// Host-side world replication: build full-world / diff protocol messages from
// the engine's binary snapshot (cpp/engine/netsync.inc). The client-side apply
// half (and the shared base64 helpers) live in ../worldSync.js, which is what
// the browser bundle ships; this module is server/test-only.

import { makeWorld, makeDiff } from '../protocol.js';
import { bytesToB64 } from '../worldSync.js';

export function encodeWorld(engine, tick) {
  return makeWorld(
    tick, engine.cols, engine.rows, engine.gridHash(), bytesToB64(engine.serializeWorld()),
    engine.getWorldOffsetX(), engine.getWorldOffsetY(),
  );
}
export function encodeDiff(engine, tick) {
  const bytes = engine.serializeDiff();
  if (bytes.length <= 4) return null; // two empty layer headers -> no changed cells
  return makeDiff(tick, engine.gridHash(), bytesToB64(bytes));
}
