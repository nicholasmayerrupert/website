// Validated, transport-independent multiplayer protocol. JSON envelopes carry
// packed actor arrays and base64-encoded binary world snapshots/diffs.

import { INPUT, TOOL, SOUND_EVENT, ITEM_KIND, PROJECTILE_KIND, CREATURE, CREATURE_ATTACK_STATE, INV_SLOTS, STRIDES, OFF } from '../wasmBridge/abi.generated.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';
import { isValidMaterialId } from '../worldPacketValidation.js';

export const PROTOCOL_VERSION = 19;
export { INV_SLOTS };

export const MSG = Object.freeze({
  JOIN: 'join',
  LEAVE: 'leave',
  ASSIGN: 'assign',     // host -> client: your authoritative playerId
  REJECT: 'reject',     // host -> client: join refused with a stable reason
  INPUT: 'input',
  VIEW: 'view',         // client -> host: visible + desired loaded-window dimensions
  SNAPSHOT: 'snapshot',
  WORLD: 'world',       // host -> client: full world snapshot (base64 RLE)
  DIFF: 'diff',         // host -> client: changed cells (base64)
  RESYNC: 'resync',     // client -> host: request a full world snapshot
  ITEMS: 'items',       // host -> client: dropped-item entities (packed)
  CREATURES: 'creatures', // host -> client: material-aware actors (packed)
  PROJECTILES: 'projectiles',
  SOUNDS: 'sounds',     // host -> client: semantic positional sound events (packed)
  INVENTORY: 'inv',     // host -> client: one player's authoritative inventory
  CURSOR: 'cursor',     // host -> client: one player's carried cursor stack
  ACT_SELECT: 'aselect',// client -> host: select a hotbar slot
  ACT_SIZE: 'asize',    // client -> host: select a survival footprint preset
  ACT_MOVE: 'amove',    // client -> host: move/swap two inventory slots
  ACT_PICK: 'apick',    // client -> host: cursor pick/place/swap on a slot
  ACT_THROW: 'athrow',  // client -> host: throw the carried cursor stack out
  ACT_CRAFT: 'acraft',
  ACT_RESPAWN: 'arespawn',
});

// Field bounds, derived from the generated ABI manifest so they can't drift
// from the engine.
export const INPUT_BITS_MAX = Object.values(INPUT).reduce((a, b) => a | b, 0); // 511
export const TOOL_MAX = Math.max(...Object.values(TOOL)); // 11
const SOUND_EVENT_MAX = Math.max(...Object.values(SOUND_EVENT));
const ITEM_KIND_MAX = Math.max(...Object.values(ITEM_KIND));
const PROJECTILE_KIND_MAX = Math.max(...Object.values(PROJECTILE_KIND));
const CREATURE_MAX = Math.max(...Object.values(CREATURE));
const CREATURE_ATTACK_STATE_MAX = Math.max(...Object.values(CREATURE_ATTACK_STATE));
const MAX_SNAPSHOT_PLAYERS = 64;
const MAX_SHIELD_HEALTH = 200;
export const ITEM_FIELDS = STRIDES.itemSnapshot;      // [id,kind,material,count,x,y,life,plantType] per item
export const CREATURE_FIELDS = STRIDES.creatureSnapshot;
export const PROJECTILE_FIELDS = STRIDES.projectileSnapshot;
export const SOUND_FIELDS = STRIDES.soundEvent;
export const INV_FIELDS = STRIDES.inventorySlot - 1;  // wire slots omit the `selected` flag (sent separately)
const MAX_SNAPSHOT_ITEMS = 1024; // IT_MAX_ITEMS in items.inc
const MAX_SNAPSHOT_CREATURES = 128;
const MAX_CREATURE_DIMENSION = 32;
const MAX_SOUND_EVENTS = 192;

const isInt = (v) => Number.isInteger(v);
const isNonNegInt = (v) => isInt(v) && v >= 0;
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isId = (v) => (isNonNegInt(v)) || (typeof v === 'string' && v.length > 0 && v.length <= 64);
const isRoom = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

export function encode(msg) { return JSON.stringify(msg); }

// ---- builders (always produce a normalized, valid message object) ----
export function makeJoin(room, client, name = '') {
  return { t: MSG.JOIN, v: PROTOCOL_VERSION, room, client, name: String(name).slice(0, 32) };
}
export function makeLeave(room, client) {
  return { t: MSG.LEAVE, v: PROTOCOL_VERSION, room, client };
}
export function makeAssign(room, client, player) {
  return { t: MSG.ASSIGN, room, client, player: player | 0 };
}
export function makeReject(room, reason) {
  return { t: MSG.REJECT, room, reason };
}
export function makeInput({ room, client, player, tick, seq, bits, aimX, aimY, tool, moveX, moveY }) {
  const msg = {
    t: MSG.INPUT, room, client, player,
    tick: Math.trunc(tick), seq: Math.trunc(seq),
    bits: bits & INPUT_BITS_MAX,
    aimX: Math.trunc(aimX), aimY: Math.trunc(aimY),
    tool: tool | 0,
  };
  if (Number.isFinite(moveX) && Number.isFinite(moveY)) {
    const mag = Math.hypot(moveX, moveY);
    msg.moveX = mag > 1 ? moveX / mag : moveX;
    msg.moveY = mag > 1 ? moveY / mag : moveY;
  }
  return msg;
}
export function makeSnapshot(tick, players, hash = null) {
  return {
    t: MSG.SNAPSHOT, tick: Math.trunc(tick),
    hash: hash == null ? null : (hash >>> 0),
    players: players.map((p) => ({
      id: p.id | 0, x: p.x, y: p.y, vx: p.vx ?? 0, vy: p.vy ?? 0,
      facing: p.facing | 0, grounded: p.grounded ? 1 : 0, jr: p.jumpReady ? 1 : 0,
      tool: p.tool | 0, health: p.health | 0, alive: p.alive === false ? 0 : 1,
      seq: (p.inputSeq ?? p.seq ?? 0) >>> 0,
      animState: p.animState | 0, animFrame: p.animFrame | 0,
      deathTicks: p.deathTicks | 0, respawnReady: p.respawnReady ? 1 : 0,
      bowCharge: Number.isFinite(p.bowCharge) ? p.bowCharge : 0, heldItemKind: p.heldItemKind | 0,
      jetpackFuel: Number.isFinite(p.jetpackFuel) ? p.jetpackFuel : 1,
      jetpackActive: p.jetpackActive ? 1 : 0,
      shieldHealth: Number.isFinite(p.shieldHealth)
        ? Math.max(0, Math.min(MAX_SHIELD_HEALTH, Math.trunc(p.shieldHealth))) : MAX_SHIELD_HEALTH,
      shieldActive: p.shieldActive ? 1 : 0,
      aimX: Number.isFinite(p.aimX) ? p.aimX : 0, aimY: Number.isFinite(p.aimY) ? p.aimY : 0,
      mineProgress: Number.isFinite(p.mineProgress) ? Math.max(0, Math.min(1, p.mineProgress)) : 0,
      mineTarget: p.mineTarget && Number.isFinite(p.mineTarget.x) && Number.isFinite(p.mineTarget.y)
        ? { x: Math.trunc(p.mineTarget.x), y: Math.trunc(p.mineTarget.y) } : null,
    })),
  };
}
export function makeWorld(tick, cols, rows, hash, data, offsetX = 0, offsetY = 0) {
  return {
    t: MSG.WORLD, tick: Math.trunc(tick), cols: cols | 0, rows: rows | 0,
    offsetX: offsetX | 0, offsetY: offsetY | 0,
    hash: hash >>> 0, data: String(data),
  };
}
export function makeDiff(tick, hash, data) {
  return { t: MSG.DIFF, tick: Math.trunc(tick), hash: hash >>> 0, data: String(data) };
}
export function makeResync(room, client) { return { t: MSG.RESYNC, room, client }; }
export function makeView(room, client, viewCols, viewRows, bufferCols, bufferRows) {
  return {
    t: MSG.VIEW, room, client,
    viewCols: Math.trunc(viewCols), viewRows: Math.trunc(viewRows),
    bufferCols: Math.trunc(bufferCols), bufferRows: Math.trunc(bufferRows),
  };
}

// ---- replicated actors and inventory ----
// Dropped items, packed flat as ITEM_FIELDS numbers each. `items` is an array of
// { id, kind, material, count, x, y, life, plantType } (the engine's getItems() shape); the
// caller filters which kinds to send (cosmetic particles are usually dropped).
export function makeItems(tick, items) {
  const data = new Array(items.length * ITEM_FIELDS);
  for (let i = 0; i < items.length; i++) {
    const it = items[i], o = i * ITEM_FIELDS;
    data[o] = it.id | 0; data[o + 1] = it.kind | 0; data[o + 2] = it.material | 0;
    data[o + 3] = it.count | 0; data[o + 4] = it.x; data[o + 5] = it.y; data[o + 6] = it.life | 0;
    data[o + 7] = it.plantType | 0;
    data[o + 8] = it.itemKind | 0; data[o + 9] = it.isTool ? 1 : 0;
    data[o + 10] = it.toolClass | 0; data[o + 11] = it.toolTier | 0;
  }
  return { t: MSG.ITEMS, tick: Math.trunc(tick), data };
}
export function makeProjectiles(tick, projectiles) {
  const O = OFF.projectileSnapshot, data = new Array(projectiles.length * PROJECTILE_FIELDS);
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i], o = i * PROJECTILE_FIELDS;
    data[o + O.id] = p.id | 0; data[o + O.owner] = p.owner | 0;
    data[o + O.x] = p.x; data[o + O.y] = p.y; data[o + O.vx] = p.vx; data[o + O.vy] = p.vy;
    data[o + O.charge] = p.charge; data[o + O.kind] = p.kind | 0; data[o + O.fuse] = p.fuse | 0;
    data[o + O.rotation] = Number.isFinite(p.rotation) ? p.rotation : 0;
  }
  return { t: MSG.PROJECTILES, tick: Math.trunc(tick), data };
}
export function makeCreatures(tick, creatures) {
  const O = OFF.creatureSnapshot, data = new Array(creatures.length * CREATURE_FIELDS);
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i], o = i * CREATURE_FIELDS;
    data[o + O.id] = c.id | 0; data[o + O.species] = c.species | 0;
    data[o + O.x] = c.x; data[o + O.y] = c.y; data[o + O.vx] = c.vx; data[o + O.vy] = c.vy;
    data[o + O.w] = c.w | 0; data[o + O.h] = c.h | 0; data[o + O.facing] = c.facing | 0;
    data[o + O.health] = c.health | 0; data[o + O.maxHealth] = c.maxHealth | 0;
    data[o + O.alive] = c.alive ? 1 : 0; data[o + O.animFrame] = c.animFrame | 0;
    data[o + O.attackState] = c.attackState | 0;
    data[o + O.attackProgress] = Number.isFinite(c.attackProgress) ? c.attackProgress : 0;
    data[o + O.aimX] = Number.isFinite(c.aimX) ? c.aimX : c.x;
    data[o + O.aimY] = Number.isFinite(c.aimY) ? c.aimY : c.y;
    data[o + O.spawnProgress] = Number.isFinite(c.spawnProgress) ? c.spawnProgress : 0;
    data[o + O.attackPattern] = c.attackPattern | 0;
  }
  return { t: MSG.CREATURES, tick: Math.trunc(tick), data };
}
export function makeSounds(tick, events) {
  return { t: MSG.SOUNDS, tick: Math.trunc(tick), data: Array.from(events) };
}
// One player's authoritative inventory. `slots` is the getInventory() slots array
// ({material,isTool,toolClass,toolTier,count,plantType}); `selected` is the hotbar index.
export function makeInventory(tick, player, slots, selected, selectedFootprint = 0) {
  const data = new Array(slots.length * INV_FIELDS);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i], o = i * INV_FIELDS;
    data[o] = s.material | 0; data[o + 1] = s.isTool ? 1 : 0;
    data[o + 2] = s.toolClass | 0; data[o + 3] = s.toolTier | 0; data[o + 4] = s.count | 0;
    data[o + 5] = s.plantType | 0; data[o + 6] = s.itemKind | 0;
  }
  return { t: MSG.INVENTORY, tick: Math.trunc(tick), player: player | 0, data, selected: selected | 0, selectedFootprint: selectedFootprint | 0 };
}
// One player's carried cursor stack (null when empty).
export function makeCursor(tick, player, cur) {
  return {
    t: MSG.CURSOR, tick: Math.trunc(tick), player: player | 0,
    cur: cur ? { material: cur.material | 0, isTool: cur.isTool ? 1 : 0, toolClass: cur.toolClass | 0, toolTier: cur.toolTier | 0, count: cur.count | 0, plantType: cur.plantType | 0, itemKind: cur.itemKind | 0 } : null,
  };
}

// ---- client -> host survival intents ----
export function makeSelect(room, client, slot) { return { t: MSG.ACT_SELECT, room, client, slot: slot | 0 }; }
export function makeSize(room, client, footprint) { return { t: MSG.ACT_SIZE, room, client, footprint: footprint | 0 }; }
export function makeMove(room, client, from, to) { return { t: MSG.ACT_MOVE, room, client, from: from | 0, to: to | 0 }; }
export function makePick(room, client, slot, half) { return { t: MSG.ACT_PICK, room, client, slot: slot | 0, half: half ? 1 : 0 }; }
export function makeThrow(room, client, whole) { return { t: MSG.ACT_THROW, room, client, whole: whole ? 1 : 0 }; }
export function makeCraft(room, client, recipe, max) { return { t: MSG.ACT_CRAFT, room, client, recipe: recipe | 0, max: max ? 1 : 0 }; }
export function makeRespawn(room, client) { return { t: MSG.ACT_RESPAWN, room, client }; }

// ---- decode + strict validation (returns the message or null) ----
export function decode(str) {
  let m;
  try { m = JSON.parse(str); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    // JOIN/LEAVE carry the protocol version; a version-skewed peer is rejected
    // at decode so it desyncs loudly (join fails) instead of silently.
    case MSG.JOIN: return (m.v === PROTOCOL_VERSION && isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.LEAVE: return (m.v === PROTOCOL_VERSION && isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.ASSIGN: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.player)) ? m : null;
    case MSG.REJECT: return (isRoom(m.room) && ['full', 'room', 'client'].includes(m.reason)) ? m : null;
    case MSG.INPUT: return validateInput(m);
    case MSG.VIEW: return validateView(m);
    case MSG.SNAPSHOT: return validateSnapshot(m);
    case MSG.WORLD: return (isNonNegInt(m.tick) && isNonNegInt(m.cols) && m.cols > 0 && m.cols <= ENGINE_MAX_DIMENSION && isNonNegInt(m.rows) && m.rows > 0 && m.rows <= ENGINE_MAX_DIMENSION && m.cols * m.rows <= ENGINE_MAX_CELLS && isI32(m.offsetX) && isI32(m.offsetY) && isNonNegInt(m.hash) && typeof m.data === 'string') ? m : null;
    case MSG.DIFF: return (isNonNegInt(m.tick) && isNonNegInt(m.hash) && typeof m.data === 'string') ? m : null;
    case MSG.RESYNC: return (isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.ITEMS: return validateItems(m);
    case MSG.CREATURES: return validateCreatures(m);
    case MSG.PROJECTILES: return validateProjectiles(m);
    case MSG.SOUNDS: return validateSounds(m);
    case MSG.INVENTORY: return validateInventory(m);
    case MSG.CURSOR: return validateCursor(m);
    case MSG.ACT_SELECT: return (isRoom(m.room) && isId(m.client) && isSlot(m.slot)) ? m : null;
    case MSG.ACT_SIZE: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.footprint) && m.footprint <= 255) ? m : null;
    case MSG.ACT_MOVE: return (isRoom(m.room) && isId(m.client) && isSlot(m.from) && isSlot(m.to)) ? m : null;
    case MSG.ACT_PICK: return (isRoom(m.room) && isId(m.client) && isSlot(m.slot) && isBit(m.half)) ? m : null;
    case MSG.ACT_THROW: return (isRoom(m.room) && isId(m.client) && isBit(m.whole)) ? m : null;
    case MSG.ACT_CRAFT: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.recipe) && m.recipe < 64 && isBit(m.max)) ? m : null;
    case MSG.ACT_RESPAWN: return (isRoom(m.room) && isId(m.client)) ? m : null;
    default: return null;
  }
}

const isBit = (v) => v === 0 || v === 1;
const isSlot = (v) => isInt(v) && v >= 0 && v < INV_SLOTS;
const isI32 = (v) => isInt(v) && v >= -2147483648 && v <= 2147483647;

function validateView(m) {
  if (!isRoom(m.room) || !isId(m.client)) return null;
  const dims = [m.viewCols, m.viewRows, m.bufferCols, m.bufferRows];
  if (dims.some((v) => !isInt(v) || v <= 0 || v > ENGINE_MAX_DIMENSION)) return null;
  if (m.viewCols > m.bufferCols || m.viewRows > m.bufferRows
      || m.bufferCols * m.bufferRows > ENGINE_MAX_CELLS) return null;
  return m;
}

function validateItems(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  if (m.data.length % ITEM_FIELDS !== 0 || m.data.length > MAX_SNAPSHOT_ITEMS * ITEM_FIELDS) return null;
  const O = OFF.itemSnapshot;
  for (let i = 0; i < m.data.length; i++) {
    const f = i % ITEM_FIELDS;
    // fields 4,5 are x,y (any finite); the rest are integers.
    if (f === 4 || f === 5) { if (!isFiniteNum(m.data[i])) return null; }
    else if (!isInt(m.data[i])) return null;
    else if (f === O.material && !isValidMaterialId(m.data[i])) return null;
    else if (f === O.itemKind && (m.data[i] < 0 || m.data[i] > ITEM_KIND_MAX)) return null;
  }
  return m;
}
function validateCreatures(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  if (m.data.length % CREATURE_FIELDS !== 0 || m.data.length > MAX_SNAPSHOT_CREATURES * CREATURE_FIELDS) return null;
  const O = OFF.creatureSnapshot;
  for (let i = 0; i < m.data.length; i++) {
    const f = i % CREATURE_FIELDS;
    if (f === O.x || f === O.y || f === O.vx || f === O.vy ||
        f === O.attackProgress || f === O.aimX || f === O.aimY ||
        f === O.spawnProgress) {
      if (!isFiniteNum(m.data[i])) return null;
      if ((f === O.attackProgress || f === O.spawnProgress) &&
          (m.data[i] < 0 || m.data[i] > 1)) return null;
    }
    else if (!isInt(m.data[i])) return null;
    else if (f === O.species && (m.data[i] < 0 || m.data[i] > CREATURE_MAX)) return null;
    else if ((f === O.w || f === O.h)
        && (m.data[i] <= 0 || m.data[i] > MAX_CREATURE_DIMENSION)) return null;
    else if (f === O.attackState && (m.data[i] < 0 || m.data[i] > CREATURE_ATTACK_STATE_MAX)) return null;
    else if (f === O.attackPattern && (m.data[i] < 0 || m.data[i] > 2)) return null;
  }
  return m;
}
function validateProjectiles(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data) || m.data.length % PROJECTILE_FIELDS !== 0 || m.data.length > 256 * PROJECTILE_FIELDS) return null;
  const O = OFF.projectileSnapshot;
  for (let i = 0; i < m.data.length; i++) {
    const f = i % PROJECTILE_FIELDS;
    if (f === O.x || f === O.y || f === O.vx || f === O.vy || f === O.charge || f === O.rotation) { if (!isFiniteNum(m.data[i])) return null; }
    else if (!isInt(m.data[i])) return null;
    else if (f === O.kind && (m.data[i] < 0 || m.data[i] > PROJECTILE_KIND_MAX)) return null;
    else if (f === O.fuse && m.data[i] < 0) return null;
  }
  return m;
}
function validateSounds(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  if (m.data.length % SOUND_FIELDS !== 0 || m.data.length > MAX_SOUND_EVENTS * SOUND_FIELDS) return null;
  const O = OFF.soundEvent;
  for (let i = 0; i < m.data.length; i++) {
    const field = i % SOUND_FIELDS;
    if (field === O.x || field === O.y || field === O.intensity) {
      if (!isFiniteNum(m.data[i])) return null;
    } else if (!isInt(m.data[i])) return null;
    else if (field === O.type && (m.data[i] < 0 || m.data[i] > SOUND_EVENT_MAX)) return null;
    else if (field === O.material && !isValidMaterialId(m.data[i])) return null;
    else if (field === O.layer && !isBit(m.data[i])) return null;
  }
  return m;
}

function validateInventory(m) {
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.player)) return null;
  if (!Array.isArray(m.data) || m.data.length !== INV_SLOTS * INV_FIELDS) return null;
  const O = OFF.inventorySlot;
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i]; if (!isInt(v)) return null;
    const field = i % INV_FIELDS;
    if (field === O.material && !isValidMaterialId(v)) return null;
    if (field === O.itemKind && (v < 0 || v > ITEM_KIND_MAX)) return null;
  }
  if (!isInt(m.selected) || m.selected < 0 || m.selected >= INV_SLOTS) return null;
  if (!isNonNegInt(m.selectedFootprint) || m.selectedFootprint > 255) return null;
  return m;
}

function validateCursor(m) {
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.player)) return null;
  if (m.cur === null) return m;
  const c = m.cur;
  if (!c || typeof c !== 'object') return null;
  if (!isValidMaterialId(c.material) || !isBit(c.isTool) || !isInt(c.toolClass) || !isInt(c.toolTier) || !isInt(c.count) || !isNonNegInt(c.itemKind) || c.itemKind > ITEM_KIND_MAX) return null;
  return m;
}

function validateInput(m) {
  if (!isRoom(m.room) || !isId(m.client) || !isNonNegInt(m.player)) return null;
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.seq)) return null;
  if (!isNonNegInt(m.bits) || m.bits > INPUT_BITS_MAX) return null;
  if (!isInt(m.aimX) || !isInt(m.aimY)) return null;
  if (!isNonNegInt(m.tool) || m.tool > TOOL_MAX) return null;
  const hasMoveX = m.moveX !== undefined, hasMoveY = m.moveY !== undefined;
  if (hasMoveX !== hasMoveY) return null;
  if (hasMoveX && (!isFiniteNum(m.moveX) || !isFiniteNum(m.moveY) || Math.hypot(m.moveX, m.moveY) > 1.000001)) return null;
  return m;
}

function validateSnapshot(m) {
  if (!isNonNegInt(m.tick)) return null;
  if (m.hash != null && !isNonNegInt(m.hash)) return null;
  if (!Array.isArray(m.players) || m.players.length > MAX_SNAPSHOT_PLAYERS) return null;
  for (const p of m.players) {
    if (!p || !isNonNegInt(p.id)) return null;
    if (!isFiniteNum(p.x) || !isFiniteNum(p.y) || !isFiniteNum(p.vx) || !isFiniteNum(p.vy)) return null;
    if (!isInt(p.facing) || !isNonNegInt(p.tool) || !isNonNegInt(p.seq)) return null;
    if (!isNonNegInt(p.health) || !isBit(p.alive)) return null;
    if (!isNonNegInt(p.animState) || !isNonNegInt(p.animFrame) || !isNonNegInt(p.deathTicks) || !isBit(p.respawnReady)) return null;
    if (!isFiniteNum(p.bowCharge) || p.bowCharge < 0 || p.bowCharge > 1 || !isNonNegInt(p.heldItemKind) || p.heldItemKind > ITEM_KIND_MAX) return null;
    if (!isFiniteNum(p.jetpackFuel) || p.jetpackFuel < 0 || p.jetpackFuel > 1 || !isBit(p.jetpackActive)) return null;
    if (!isNonNegInt(p.shieldHealth) || p.shieldHealth > MAX_SHIELD_HEALTH || !isBit(p.shieldActive)) return null;
    if (!isFiniteNum(p.aimX) || !isFiniteNum(p.aimY)) return null;
    if (!isFiniteNum(p.mineProgress) || p.mineProgress < 0 || p.mineProgress > 1) return null;
    if (p.mineTarget !== null &&
        (!p.mineTarget || !isI32(p.mineTarget.x) || !isI32(p.mineTarget.y))) return null;
  }
  return m;
}
