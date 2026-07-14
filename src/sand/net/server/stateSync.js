// State replication beyond players + world cells: dropped items, per-player
// inventory, and the carried cursor. The authoritative side (the headless server
// or any Host) reads the engine's snapshots and builds protocol messages; the
// client decodes + ingests them in gameNet. Isomorphic (Node + browser), so it
// unit-tests in Node without a socket. World cells live in worldSync.js.

import { makeItems, makeCreatures, makeSounds, makeInventory, makeCursor } from '../protocol.js';

// Dropped items only (kind 0). Cosmetic mining particles (kind 1) are short-lived
// and high-volume; they stay local to each renderer rather than being replicated.
export function encodeItems(engine, tick) {
  return makeItems(tick, engine.getItems().filter((it) => it.kind === 0));
}
export function encodeCreatures(engine, tick) {
  return makeCreatures(tick, engine.getCreatures());
}
export function encodeSounds(engine, tick) {
  const events = engine.drainSoundEvents();
  return events.length ? makeSounds(tick, events) : null;
}
export function encodeInventory(engine, tick, playerId) {
  const inv = engine.getInventory(playerId);
  return makeInventory(tick, playerId, inv.slots, inv.selected, inv.selectedFootprint);
}
export function encodeCursor(engine, tick, playerId) {
  return makeCursor(tick, playerId, engine.getCursor(playerId));
}

// Cheap FNV-1a fingerprint of a player's inventory + selected slot + cursor, so
// the server only broadcasts that player's inventory when it actually changed
// (idle players cost zero inventory bandwidth). Folds the same fields makeInventory
// / makeCursor send, so any wire-visible change flips the revision.
export function inventoryRevision(engine, playerId) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (v & 0xffffffff), 0x01000193) >>> 0; };
  const inv = engine.getInventory(playerId);
  mix(inv.selected);
  mix(inv.selectedFootprint ?? 0);
  for (const s of inv.slots) {
    mix(s.material);
    mix(s.count);
    mix(s.isTool ? ((s.toolClass << 8) | s.toolTier | 0x10000) : 0);
  }
  const c = engine.getCursor(playerId);
  mix(c ? ((c.material << 16) | (c.count & 0xffff)) : 0x7fffffff);
  if (c) mix(c.isTool ? ((c.toolClass << 8) | c.toolTier | 0x10000) : 0);
  return h >>> 0;
}
