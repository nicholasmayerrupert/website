// Multiplayer wire protocol. Pure, transport-agnostic, and dependency-free so it
// can be unit-tested in Node without a real network. Messages are JSON for the
// MVP (Phase 6 may swap world diffs to a binary/RLE encoding). Every decode is
// strictly validated and integer fields are preserved exactly — divergence here
// would desync a host-authoritative session.

export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
  JOIN: 'join',
  LEAVE: 'leave',
  ASSIGN: 'assign',     // host -> client: your authoritative playerId
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  WORLD: 'world',       // host -> client: full world snapshot (base64 RLE)
  DIFF: 'diff',         // host -> client: changed cells (base64)
  RESYNC: 'resync',     // client -> host: request a full world snapshot
  PING: 'ping',
  PONG: 'pong',
});

// Field bounds (must match the engine: PlayerInput is 7 bits, 12 tools).
export const INPUT_BITS_MAX = 127;
export const TOOL_MAX = 11;
const MAX_SNAPSHOT_PLAYERS = 64;

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
      facing: p.facing | 0, grounded: p.grounded ? 1 : 0,
      tool: p.tool | 0, health: p.health | 0, seq: (p.inputSeq ?? p.seq ?? 0) >>> 0,
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
export function makePing(client, time) { return { t: MSG.PING, client, time: Math.trunc(time) }; }
export function makePong(client, time) { return { t: MSG.PONG, client, time: Math.trunc(time) }; }

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
    case MSG.PING:
    case MSG.PONG: return (isId(m.client) && isNonNegInt(m.time)) ? m : null;
    default: return null;
  }
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
  }
  return m;
}
