// Validated, transport-independent multiplayer protocol. JSON envelopes carry
// packed actor arrays and base64-encoded binary world snapshots/diffs.

import {
  NETWORK_CATALOGUE_FINGERPRINT, INPUT, TOOL, SOUND_EVENT, ITEM_KIND,
  PROJECTILE_KIND, CREATURE, CREATURE_ATTACK_STATE, INV_SLOTS, STRIDES,
  OBJECT_WIRE_CODECS, CREATURE_MAX_DIMENSION,
} from '../wasmBridge/abi.generated.js';
import {
  packObjectWireRecords, packRecords, projectObjectRecords,
  validateObjectRecords, validatePackedObjectRecords, validatePackedRecords,
} from '../wasmBridge/recordCodec.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';
import { isValidMaterialId } from '../worldPacketValidation.js';

export const PROTOCOL_VERSION = 21;
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
export const ITEM_FIELDS = STRIDES.itemSnapshot;      // generated itemSnapshot stride
export const CREATURE_FIELDS = STRIDES.creatureSnapshot;
export const PROJECTILE_FIELDS = STRIDES.projectileSnapshot;
export const SOUND_FIELDS = STRIDES.soundEvent;
export const INV_FIELDS = OBJECT_WIRE_CODECS.inventoryStack.fields.length;

const isInt = (v) => Number.isInteger(v);
const isNonNegInt = (v) => isInt(v) && v >= 0;
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isId = (v) => (isNonNegInt(v)) || (typeof v === 'string' && v.length > 0 && v.length <= 64);
const isRoom = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

export function encode(msg) { return JSON.stringify(msg); }

// ---- builders (always produce a normalized, valid message object) ----
export function makeJoin(room, client, name = '') {
  return {
    t: MSG.JOIN, v: PROTOCOL_VERSION,
    catalogue: NETWORK_CATALOGUE_FINGERPRINT,
    room, client, name: String(name).slice(0, 32),
  };
}
export function makeLeave(room, client) {
  return {
    t: MSG.LEAVE, v: PROTOCOL_VERSION,
    catalogue: NETWORK_CATALOGUE_FINGERPRINT,
    room, client,
  };
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
    players: projectObjectRecords(players, 'player'),
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
// Dropped items use the engine's getItems() record shape and the generated
// itemSnapshot codec. The caller filters which kinds to send; cosmetic particles
// are usually dropped.
export function makeItems(tick, items) {
  return { t: MSG.ITEMS, tick: Math.trunc(tick), data: packRecords(items, 'itemSnapshot') };
}
export function makeProjectiles(tick, projectiles) {
  return {
    t: MSG.PROJECTILES, tick: Math.trunc(tick),
    data: packRecords(projectiles, 'projectileSnapshot'),
  };
}
export function makeCreatures(tick, creatures) {
  return {
    t: MSG.CREATURES, tick: Math.trunc(tick),
    data: packRecords(creatures, 'creatureSnapshot'),
  };
}
export function makeSounds(tick, events) {
  return { t: MSG.SOUNDS, tick: Math.trunc(tick), data: Array.from(events) };
}
// One player's authoritative inventory. `slots` uses the generated
// inventoryStack projection of getInventory(); `selected` is the hotbar index.
export function makeInventory(tick, player, slots, selected, selectedFootprint = 0) {
  const data = packObjectWireRecords(slots, 'inventoryStack');
  return { t: MSG.INVENTORY, tick: Math.trunc(tick), player: player | 0, data, selected: selected | 0, selectedFootprint: selectedFootprint | 0 };
}
// One player's carried cursor stack (null when empty).
export function makeCursor(tick, player, cur) {
  return {
    t: MSG.CURSOR, tick: Math.trunc(tick), player: player | 0,
    cur: cur ? projectObjectRecords([cur], 'inventoryStack')[0] : null,
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
function validateDecodedMessage(m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    // JOIN/LEAVE carry the protocol version and the complete generated
    // simulation catalogue, so incompatible peers fail before state exchange.
    case MSG.JOIN: return (m.v === PROTOCOL_VERSION
      && m.catalogue === NETWORK_CATALOGUE_FINGERPRINT
      && isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.LEAVE: return (m.v === PROTOCOL_VERSION
      && m.catalogue === NETWORK_CATALOGUE_FINGERPRINT
      && isRoom(m.room) && isId(m.client)) ? m : null;
    case MSG.ASSIGN: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.player)) ? m : null;
    case MSG.REJECT: return (isRoom(m.room)
      && ['full', 'room', 'client', 'version', 'catalogue'].includes(m.reason))
      ? m : null;
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
    case MSG.ACT_SIZE: return (isRoom(m.room) && isId(m.client)
      && isNonNegInt(m.footprint) && m.footprint <= 255) ? m : null;
    case MSG.ACT_MOVE: return (isRoom(m.room) && isId(m.client) && isSlot(m.from) && isSlot(m.to)) ? m : null;
    case MSG.ACT_PICK: return (isRoom(m.room) && isId(m.client) && isSlot(m.slot) && isBit(m.half)) ? m : null;
    case MSG.ACT_THROW: return (isRoom(m.room) && isId(m.client) && isBit(m.whole)) ? m : null;
    case MSG.ACT_CRAFT: return (isRoom(m.room) && isId(m.client) && isNonNegInt(m.recipe) && m.recipe < 64 && isBit(m.max)) ? m : null;
    case MSG.ACT_RESPAWN: return (isRoom(m.room) && isId(m.client)) ? m : null;
    default: return null;
  }
}

export function decodeWithCompatibility(str) {
  let m;
  try { m = JSON.parse(str); } catch {
    return { message: null, rejection: null };
  }
  if (m?.t === MSG.JOIN && isRoom(m.room) && isId(m.client)) {
    if (m.v !== PROTOCOL_VERSION) {
      return { message: null, rejection: { room: m.room, reason: 'version' } };
    }
    if (m.catalogue !== NETWORK_CATALOGUE_FINGERPRINT) {
      return { message: null, rejection: { room: m.room, reason: 'catalogue' } };
    }
  }
  return { message: validateDecodedMessage(m), rejection: null };
}

export function decode(str) {
  return decodeWithCompatibility(str).message;
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
  if (!validatePackedRecords(m.data, 'itemSnapshot', (field, value) => {
    if (field === 'material') return isValidMaterialId(value);
    if (field === 'itemKind') return value >= 0 && value <= ITEM_KIND_MAX;
    return true;
  })) return null;
  return m;
}
function validateCreatures(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  if (!validatePackedRecords(m.data, 'creatureSnapshot', (field, value) => {
    if (field === 'species') return value >= 0 && value <= CREATURE_MAX;
    if (field === 'w' || field === 'h')
      return value > 0 && value <= CREATURE_MAX_DIMENSION;
    if (field === 'attackState') return value >= 0 && value <= CREATURE_ATTACK_STATE_MAX;
    if (field === 'attackPattern') return value >= 0 && value <= 2;
    if (field === 'attackProgress' || field === 'spawnProgress') return value >= 0 && value <= 1;
    return true;
  })) return null;
  return m;
}
function validateProjectiles(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  if (!validatePackedRecords(m.data, 'projectileSnapshot', (field, value) => {
    if (field === 'kind') return value >= 0 && value <= PROJECTILE_KIND_MAX;
    if (field === 'fuse') return value >= 0;
    return true;
  })) return null;
  return m;
}
function validateSounds(m) {
  if (!isNonNegInt(m.tick) || !Array.isArray(m.data)) return null;
  return validatePackedRecords(m.data, 'soundEvent', (field, value) => {
    if (field === 'type') return value >= 0 && value <= SOUND_EVENT_MAX;
    if (field === 'material') return isValidMaterialId(value);
    if (field === 'layer') return isBit(value);
    return true;
  }) ? m : null;
}

function validateInventory(m) {
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.player)) return null;
  if (!Array.isArray(m.data) || m.data.length !== INV_SLOTS * INV_FIELDS
      || !validatePackedObjectRecords(m.data, 'inventoryStack', (field, value) => {
        if (field === 'material') return isValidMaterialId(value);
        if (field === 'itemKind') return value >= 0 && value <= ITEM_KIND_MAX;
        return true;
      })) return null;
  if (!isInt(m.selected) || m.selected < 0 || m.selected >= INV_SLOTS) return null;
  if (!isNonNegInt(m.selectedFootprint) || m.selectedFootprint > 255) return null;
  return m;
}

function validateCursor(m) {
  if (!isNonNegInt(m.tick) || !isNonNegInt(m.player)) return null;
  if (m.cur === null) return m;
  const c = m.cur;
  if (!validateObjectRecords([c], 'inventoryStack', (field, value) => {
    if (field === 'material') return isValidMaterialId(value);
    if (field === 'itemKind') return value >= 0 && value <= ITEM_KIND_MAX;
    return true;
  })) return null;
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
  if (!validateObjectRecords(m.players, 'player', (field, value) => {
    if (field === 'tool') return value >= 0 && value <= TOOL_MAX;
    if (field === 'heldItemKind') return value >= 0 && value <= ITEM_KIND_MAX;
    return true;
  })) return null;
  return m;
}
