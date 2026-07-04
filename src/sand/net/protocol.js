// Multiplayer wire protocol. Pure, transport-agnostic, and dependency-free so it
// can be unit-tested in Node without a real network. Messages are JSON for the
// MVP (Phase 6 may swap world diffs to a binary/RLE encoding). Every decode is
// strictly validated and integer fields are preserved exactly — divergence here
// would desync a host-authoritative session.

export const PROTOCOL_VERSION = 3;

export const MSG = Object.freeze({
  JOIN: 'join',
  LEAVE: 'leave',
  ASSIGN: 'assign',     // host -> client: your authoritative playerId
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  WORLD: 'world',       // host -> client: full world snapshot (base64 RLE)
  DIFF: 'diff',         // host -> client: changed cells (base64)
  RESYNC: 'resync',     // client -> host: request a full world snapshot
  ITEMS: 'items',       // host -> client: dropped-item entities (packed)
  INVENTORY: 'inv',     // host -> client: one player's authoritative inventory
  CURSOR: 'cursor',     // host -> client: one player's carried cursor stack
  ACT_SELECT: 'aselect',// client -> host: select a hotbar slot
  ACT_SIZE: 'asize',    // client -> host: select a survival footprint preset
  ACT_MOVE: 'amove',    // client -> host: move/swap two inventory slots
  ACT_PICK: 'apick',    // client -> host: cursor pick/place/swap on a slot
  ACT_THROW: 'athrow',  // client -> host: throw the carried cursor stack out
});

// Field bounds (must match the engine: PlayerInput is 7 bits, 12 tools).
export const INPUT_BITS_MAX = 127;
export const TOOL_MAX = 11;
const MAX_SNAPSHOT_PLAYERS = 64;
// Inventory + item packing (must match the engine: INV_SLOTS, item snapshot).
export const INV_SLOTS = 36;     // hotbar(9) + grid(27); inventory.inc
export const ITEM_FIELDS = 7;    // [id,kind,material,count,x,y,life] per item
export const INV_FIELDS = 5;     // [material,isTool,toolClass,toolTier,count] per slot
const MAX_SNAPSHOT_ITEMS = 1024; // IT_MAX_ITEMS in items.inc

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
export function makeInput({ room, client, player, tick, seq, bits, aimX, aimY, tool }) {
  return {
    t: MSG.INPUT, room, client, player,
    tick: Math.trunc(tick), seq: Math.trunc(seq),
    bits: bits & INPUT_BITS_MAX,
    aimX: Math.trunc(aimX), aimY: Math.trunc(aimY),
    tool: tool | 0,
  };
}
export function makeSnapshot(tick, players, hash = null) {
  return {
    t: MSG.SNAPSHOT, tick: Math.trunc(tick),
    hash: hash == null ? null : (hash >>> 0),
    players: players.map((p) => ({
      id: p.id | 0, x: p.x, y: p.y, vx: p.vx ?? 0, vy: p.vy ?? 0,
      facing: p.facing | 0, grounded: p.grounded ? 1 : 0, jr: p.jumpReady ? 1 : 0,
      tool: p.tool | 0, health: p.health | 0, seq: (p.inputSeq ?? p.seq ?? 0) >>> 0,
      animState: p.animState | 0, animFrame: p.animFrame | 0,
    })),
  };
}
export function makeWorld(tick, cols, rows, hash, data) {
  return { t: MSG.WORLD, tick: Math.trunc(tick), cols: cols | 0, rows: rows | 0, hash: hash >>> 0, data: String(data) };
}
export function makeDiff(tick, hash, data) {
  return { t: MSG.DIFF, tick: Math.trunc(tick), hash: hash >>> 0, data: String(data) };
}
export function makeResync(room, client) { return { t: MSG.RESYNC, room, client }; }

// ---- world-state replication beyond players (Phase 9) ----
// Dropped items, packed flat as ITEM_FIELDS numbers each. `items` is an array of
// { id, kind, material, count, x, y, life } (the engine's getItems() shape); the
// caller filters which kinds to send (cosmetic particles are usually dropped).
export function makeItems(tick, items) {
  const data = new Array(items.length * ITEM_FIELDS);
  for (let i = 0; i < items.length; i++) {
    const it = items[i], o = i * ITEM_FIELDS;
    data[o] = it.id | 0; data[o + 1] = it.kind | 0; data[o + 2] = it.material | 0;
    data[o + 3] = it.count | 0; data[o + 4] = it.x; data[o + 5] = it.y; data[o + 6] = it.life | 0;
  }
  return { t: MSG.ITEMS, tick: Math.trunc(tick), data };
}
// One player's authoritative inventory. `slots` is the getInventory() slots array
// ({material,isTool,toolClass,toolTier,count}); `selected` is the hotbar index.
export function makeInventory(tick, player, slots, selected, selectedFootprint = 0) {
  const data = new Array(slots.length * INV_FIELDS);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i], o = i * INV_FIELDS;
    data[o] = s.material | 0; data[o + 1] = s.isTool ? 1 : 0;
    data[o + 2] = s.toolClass | 0; data[o + 3] = s.toolTier | 0; data[o + 4] = s.count | 0;
  }
  return { t: MSG.INVENTORY, tick: Math.trunc(tick), player: player | 0, data, selected: selected | 0, selectedFootprint: selectedFootprint | 0 };
}
// One player's carried cursor stack (null when empty).
export function makeCursor(tick, player, cur) {
  return {
    t: MSG.CURSOR, tick: Math.trunc(tick), player: player | 0,
    cur: cur ? { material: cur.material | 0, isTool: cur.isTool ? 1 : 0, toolClass: cur.toolClass | 0, toolTier: cur.toolTier | 0, count: cur.count | 0 } : null,
  };
}

// ---- client -> host survival-inventory intents (Phase 9) ----
export function makeSelect(room, client, slot) { return { t: MSG.ACT_SELECT, room, client, slot: slot | 0 }; }
export function makeSize(room, client, footprint) { return { t: MSG.ACT_SIZE, room, client, footprint: footprint | 0 }; }
export function makeMove(room, client, from, to) { return { t: MSG.ACT_MOVE, room, client, from: from | 0, to: to | 0 }; }
export function makePick(room, client, slot, half) { return { t: MSG.ACT_PICK, room, client, slot: slot | 0, half: half ? 1 : 0 }; }
export function makeThrow(room, client, whole) { return { t: MSG.ACT_THROW, room, client, whole: whole ? 1 : 0 }; }

// ---- decode + strict validation (returns the message or null) ----
export function decode(str) {
  let m;
  try { m = JSON.parse(str); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case MSG.JOIN: return (isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.LEAVE: return (isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.ASSIGN: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.player)) ? m : null;
    case MSG.INPUT: return validateInput(m);
    case MSG.SNAPSHOT: return validateSnapshot(m);
    case MSG.WORLD: return (isNonNegInt(m.tick) && isNonNegInt(m.cols) && isNonNegInt(m.rows) && isNonNegInt(m.hash) && typeof m.data === 'string') ? m : null;
    case MSG.DIFF: return (isNonNegInt(m.tick) && isNonNegInt(m.hash) && typeof m.data === 'string') ? m : null;
    case MSG.RESYNC: return (isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.ITEMS: return validateItems(m);
    case MSG.INVENTORY: return validateInventory(m);
    case MSG.CURSOR: return validateCursor(m);
    case MSG.ACT_SELECT: return (isRoom(m.room) && isId(m.client) && isSlot(m.slot)) ? m : null;
    case MSG.ACT_SIZE: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.footprint) && m.footprint <= 255) ? m : null;
    case MSG.ACT_MOVE: return (isRoom(m.room) && isId(m.client) && isSlot(m.from) && isSlot(m.to)) ? m : null;
    case MSG.ACT_PICK: return (isRoom(m.room) && isId(m.client) && isSlot(m.slot) && isBit(m.half)) ? m : null;
    case MSG.ACT_THROW: return (isRoom(m.room) && isId(m.client) && isBit(m.whole)) ? m : null;
    default: return null;
  }
}

const isBit = (v) => v === 0 || v === 1;
const isSlot = (v) => isInt(v) && v >= 0 && v < INV_SLOTS;

function validateItems(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  if (m.data.length % ITEM_FIELDS !== 0 || m.data.length > MAX_SNAPSHOT_ITEMS * ITEM_FIELDS) return null;
  for (let i = 0; i < m.data.length; i++) {
    const f = i % ITEM_FIELDS;
    // fields 4,5 are x,y (any finite); the rest are integers.
    if (f === 4 || f === 5) { if (!isFiniteNum(m.data[i])) return null; }
    else if (!isInt(m.data[i])) return null;
  }
  return m;
}

function validateInventory(m) {
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.player)) return null;
  if (!Array.isArray(m.data) || m.data.length !== INV_SLOTS * INV_FIELDS) return null;
  for (const v of m.data) if (!isInt(v)) return null;
  if (!isInt(m.selected) || m.selected < 0 || m.selected >= INV_SLOTS) return null;
  if (!isNonNegInt(m.selectedFootprint) || m.selectedFootprint > 255) return null;
  return m;
}

function validateCursor(m) {
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.player)) return null;
  if (m.cur === null) return m;
  const c = m.cur;
  if (!c || typeof c !== 'object') return null;
  if (!isInt(c.material) || !isBit(c.isTool) || !isInt(c.toolClass) || !isInt(c.toolTier) || !isInt(c.count)) return null;
  return m;
}

function validateInput(m) {
  if (!isRoom(m.room) || !isId(m.client) || !isNonNegInt(m.player)) return null;
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.seq)) return null;
  if (!isNonNegInt(m.bits) || m.bits > INPUT_BITS_MAX) return null;
  if (!isInt(m.aimX) || !isInt(m.aimY)) return null;
  if (!isNonNegInt(m.tool) || m.tool > TOOL_MAX) return null;
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
    if (!isNonNegInt(p.animState) || !isNonNegInt(p.animFrame)) return null;
  }
  return m;
}
