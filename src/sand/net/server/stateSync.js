// State replication beyond players + world cells: dropped items, per-player
// inventory, and the carried cursor. The authoritative side (the headless server
// or any Host) reads the engine's snapshots and builds protocol messages; the
// client decodes + ingests them in gameNet. Isomorphic (Node + browser), so it
// unit-tests in Node without a socket. World cells live in worldSync.js.

import { makeSnapshot, makeItems, makeCreatures, makeProjectiles, makeSounds, makeInventory, makeCursor } from '../protocol.js';
import { OBJECT_WIRE_CODECS } from '../../wasmBridge/abi.generated.js';
import { projectObjectRecords } from '../../wasmBridge/recordCodec.js';

const inventoryStackFields = OBJECT_WIRE_CODECS.inventoryStack.fields;

export function encodePlayers(engine, tick, hash = null) {
  const players = engine.getPlayers().map((player) => ({
    ...player,
    mineProgress: engine.getPlayerMineProgress(player.id),
    mineTarget: engine.getPlayerMineTarget(player.id),
  }));
  return makeSnapshot(tick, players, hash);
}

// Dropped items only (kind 0). Cosmetic mining particles (kind 1) are short-lived
// and high-volume; they stay local to each renderer rather than being replicated.
export function encodeItems(engine, tick) {
  return makeItems(tick, engine.getItems().filter((it) => it.kind === 0));
}
export function encodeCreatures(engine, tick) {
  return makeCreatures(tick, engine.getCreatures());
}
export function encodeProjectiles(engine, tick) {
  return makeProjectiles(tick, engine.getProjectiles());
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
// changes broadcast immediately (alongside the server's low-rate recovery
// refresh). Folds the same fields makeInventory / makeCursor send, so any
// wire-visible change flips the revision.
export function inventoryRevision(engine, playerId) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (v & 0xffffffff), 0x01000193) >>> 0; };
  const mixStack = (stack) => {
    const projected = projectObjectRecords([stack], 'inventoryStack')[0];
    for (const field of inventoryStackFields) mix(projected[field.name]);
  };
  const inv = engine.getInventory(playerId);
  mix(inv.selected);
  mix(inv.selectedFootprint ?? 0);
  for (const stack of inv.slots) mixStack(stack);
  const c = engine.getCursor(playerId);
  mix(c ? c.material : 0x7fffffff);
  if (c) mixStack(c);
  return h >>> 0;
}
