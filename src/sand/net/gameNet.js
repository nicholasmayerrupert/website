// Browser multiplayer glue for createSandGame. The browser is ALWAYS a pure
// client: the authoritative engine runs in a headless Node server
// (scripts/sand-server.mjs), which spawns a player per client, applies their
// input + survival intents, and broadcasts the world, players, dropped items, and
// each client's inventory/cursor. This module connects by ws URL, sends local
// input + intents, applies the world diffs into a (server-dimensioned) local
// engine for rendering, and predicts its own player for zero-lag movement.
//
// When offline this layer is inert. The shared local worker authority supplies
// the same world/actor snapshot contract instead.

import {
  encode, decode, MSG, makeInput, makeJoin, makeLeave, makeResync,
  makeSelect, makeSize, makeMove, makePick, makeThrow, INV_SLOTS, INV_FIELDS, ITEM_FIELDS, CREATURE_FIELDS,
} from './protocol.js';
import { applyWorldMessage, applyDiffMessage } from './worldSync.js';
import { Predictor } from './predict.js';

const SMOOTH = 0.35;             // client render smoothing toward the latest snapshot
const fallbackPlayerSize = (engine) => engine?.getPlayerSize?.() || { w: 4, h: 8 };

let clientCounter = 0;
const newClientId = () => `c${Date.now().toString(36)}-${(clientCounter++).toString(36)}`;

export function createGameNet({ getEngine, getLocalInput, rebuildEngine }) {
  const engineNow = () => getEngine();
  let ws = null, role = null, room = null, clientId = null, connected = false;
  let ownPlayerId = 0;             // my authoritative player id on the server
  let predictor = null, predId = 0; // local prediction of our own player
  let inputSeq = 0;
  let worldReady = false;          // has the initial world snapshot been applied?
  let dbgSent = 0;                 // diagnostics
  const inQueue = [];              // inbound decoded messages, drained each step
  const remotes = new Map();       // render: id -> { x,y,vx,vy,facing,grounded,tool,w,h,tx,ty,animState,animFrame }
  let itemsForRender = new Float32Array(0); // packed [id,kind,material,count,x,y,life] from the server
  let creaturesForRender = new Float32Array(0);
  const invByPlayer = new Map();   // player id -> { slots, selected, selectedFootprint } (server-authoritative)
  const curByPlayer = new Map();   // player id -> carried cursor stack (or null)
  let invDirty = false;            // our own inventory changed since last read (HUD pull)
  let statusText = 'offline';
  let onStatus = null;

  const send = (obj) => { if (ws && ws.readyState === 1) ws.send(encode(obj)); };
  const setStatus = (s) => { statusText = s; onStatus?.(s); };

  function resetState(status = 'offline') {
    ws = null; role = null; room = null; connected = false;
    ownPlayerId = 0; inputSeq = 0; worldReady = false;
    predictor = null; predId = 0;
    remotes.clear(); inQueue.length = 0;
    itemsForRender = new Float32Array(0); creaturesForRender = new Float32Array(0);
    invByPlayer.clear(); curByPlayer.clear(); invDirty = false;
    setStatus(status);
  }

  function connect(url, asRole) {
    disconnect();
    clientId = newClientId();
    const socket = new WebSocket(url);
    ws = socket;
    setStatus('connecting');
    socket.onmessage = (ev) => {
      const m = decode(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m) inQueue.push(m);
    };
    return new Promise((resolve, reject) => {
      let settled = false, opened = false;
      socket.onopen = () => {
        if (ws !== socket) return;
        opened = true; connected = true; role = asRole; settled = true;
        resolve();
      };
      socket.onerror = () => {
        if (ws !== socket || opened) return;
        try { socket.close(); } catch { /* failed socket */ }
        resetState('error');
        if (!settled) { settled = true; reject(new Error('WebSocket connection failed')); }
      };
      socket.onclose = () => {
        if (ws !== socket) return;
        if (opened) { resetState('disconnected'); return; }
        resetState('disconnected');
        if (!settled) { settled = true; reject(new Error('WebSocket connection closed before opening')); }
      };
    });
  }

  // Join an authoritative server. The server owns this peer's player; we render
  // purely from its snapshots (createSandGame drops any local engine player).
  async function joinRoom(url, roomId) {
    await connect(url, 'client');
    room = roomId;
    send(makeJoin(roomId, clientId, 'client'));
    setStatus(`joined ${roomId}`);
  }

  function disconnect() {
    const socket = ws;
    if (socket) {
      try { if (connected && room && clientId && socket.readyState === 1) socket.send(encode(makeLeave(room, clientId))); } catch { /* closing */ }
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      try { socket.close(); } catch { /* already closing */ }
    }
    resetState('offline');
  }

  function handleMessage(m) {
    switch (m.t) {
      case MSG.ASSIGN: if (m.client === clientId) ownPlayerId = m.player; break;
      case MSG.SNAPSHOT: {
        ingestSnapshot(m);
        if (ownPlayerId) {
          const op = m.players.find((p) => p.id === ownPlayerId);
          if (op?.alive) reconcilePredictor(op, m.tick);
        }
        break;
      }
      case MSG.WORLD: {
        const cur = engineNow();
        let e = cur;
        // Adopt the server's buffer dims so diffs apply 1:1 (rebuild the local
        // render engine if ours differs). Only full snapshots (join/resync) carry
        // dims, so this is rare.
        if (!worldReady || m.cols !== cur.cols || m.rows !== cur.rows) {
          e = rebuildEngine(m.cols, m.rows); predictor = null; predId = 0;
        }
        applyWorldMessage(e, m); worldReady = true;
        break;
      }
      case MSG.DIFF: {
        if (!worldReady) break;
        if (!applyDiffMessage(engineNow(), m)) send(makeResync(room, clientId)); // hash mismatch -> resync
        break;
      }
      case MSG.ITEMS: ingestItems(m); break;
      case MSG.CREATURES: ingestCreatures(m); break;
      case MSG.INVENTORY: ingestInventory(m); break;
      case MSG.CURSOR: ingestCursor(m); break;
      default: break;
    }
  }

  // Snap our local prediction to the server's authoritative own-player and replay
  // unacknowledged inputs (lazily spawns the prediction player).
  function reconcilePredictor(op, actorTick) {
    const e = engineNow();
    if (!predictor) { predId = e.spawnPlayer(op.x, op.y); predictor = new Predictor(e, predId); }
    predictor.reconcile({ x: op.x, y: op.y, vx: op.vx, vy: op.vy, facing: op.facing, grounded: !!op.grounded, jumpReady: !!op.jr }, op.seq >>> 0, actorTick);
  }

  function ingestSnapshot(m) {
    const seen = new Set();
    for (const p of m.players) {
      seen.add(p.id);
      let r = remotes.get(p.id);
      const size = fallbackPlayerSize(engineNow());
      if (!r) { r = { x: p.x, y: p.y, w: size.w, h: size.h }; remotes.set(p.id, r); }
      r.tx = p.x; r.ty = p.y; r.vx = p.vx; r.vy = p.vy;
      r.facing = p.facing; r.grounded = !!p.grounded; r.tool = p.tool; r.seq = p.seq;
      r.health = p.health | 0; r.alive = p.alive !== 0;
      r.animState = p.animState | 0; r.animFrame = p.animFrame | 0; // so remotes animate too
      r.w = size.w; r.h = size.h;
      if (p.id === ownPlayerId && !r.alive) { predictor = null; predId = 0; }
    }
    for (const id of [...remotes.keys()]) if (!seen.has(id)) remotes.delete(id); // left
  }

  function ingestItems(m) {
    // m.data is a plain number array; Float32Array is what glSetItems uploads.
    // Reuse the buffer when the length matches (steady state between pickups).
    if (itemsForRender.length === m.data.length) itemsForRender.set(m.data);
    else itemsForRender = Float32Array.from(m.data);
  }
  function ingestCreatures(m) {
    if (creaturesForRender.length === m.data.length) creaturesForRender.set(m.data);
    else creaturesForRender = Float32Array.from(m.data);
  }
  function ingestInventory(m) {
    const slots = new Array(INV_SLOTS);
    for (let i = 0; i < INV_SLOTS; i++) {
      const o = i * INV_FIELDS;
      slots[i] = { material: m.data[o] | 0, isTool: m.data[o + 1] === 1, toolClass: m.data[o + 2] | 0, toolTier: m.data[o + 3] | 0, count: m.data[o + 4] | 0 };
    }
    invByPlayer.set(m.player, { slots, selected: m.selected | 0, selectedFootprint: m.selectedFootprint | 0 });
    if (m.player === ownPlayerId) invDirty = true;
  }
  function ingestCursor(m) {
    const c = m.cur;
    curByPlayer.set(m.player, c ? { material: c.material | 0, isTool: c.isTool === 1, toolClass: c.toolClass | 0, toolTier: c.toolTier | 0, count: c.count | 0 } : null);
  }

  // Called once per fixed step from the game loop.
  function update() {
    if (!connected) return;
    // The client doesn't step, so reset its dirty marks here; the diffs applied
    // below then mark exactly the cells that changed for an incremental repaint.
    engineNow().resetDirty();
    for (let i = 0; i < inQueue.length; i++) handleMessage(inQueue[i]);
    inQueue.length = 0;

    // smooth render players toward the latest snapshot target
    for (const r of remotes.values()) {
      if (r.tx === undefined) continue;
      r.x += (r.tx - r.x) * SMOOTH;
      r.y += (r.ty - r.y) * SMOOTH;
    }
    // send local input to the server AND predict it locally (immediate, no lag).
    const inp = getLocalInput();
    send(makeInput({ room, client: clientId, player: ownPlayerId, tick: inputSeq, seq: inputSeq, bits: inp.bits, aimX: inp.aimX, aimY: inp.aimY, tool: inp.tool, moveX: inp.moveX, moveY: inp.moveY }));
    if (predictor) predictor.predict(inputSeq, inp);
    if (inp.bits) dbgSent++;
    inputSeq++;
  }

  // ---- survival-inventory intents (forwarded to the authoritative server) ----
  const sendSelect = (slot) => send(makeSelect(room, clientId, slot | 0));
  const sendSize = (footprint) => send(makeSize(room, clientId, footprint | 0));
  const sendMove = (from, to) => send(makeMove(room, clientId, from | 0, to | 0));
  const sendPick = (slot, half) => send(makePick(room, clientId, slot | 0, half));
  const sendThrow = (whole) => send(makeThrow(room, clientId, whole));

  // Players to render: clients read the smoothed snapshot entities (own player is
  // the responsive prediction when available).
  function getPlayersForRender() {
    const own = getOwnPlayer();
    const out = [];
    for (const [id, r] of remotes) {
      if (!r.alive) continue;
      if (id === ownPlayerId && own) { out.push({ id, x: own.x, y: own.y, w: own.w, h: own.h, facing: own.facing, grounded: own.grounded, tool: r.tool ?? 0, animState: own.animState | 0, animFrame: own.animFrame | 0 }); continue; }
      out.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, facing: r.facing ?? 1, grounded: r.grounded, tool: r.tool ?? 0, animState: r.animState | 0, animFrame: r.animFrame | 0 });
    }
    return out;
  }
  function getOwnPlayer() {
    // predicted (responsive) state when available; else the raw snapshot entity.
    const authoritative = remotes.get(ownPlayerId);
    if (authoritative && !authoritative.alive) return null;
    if (predictor) {
      const ps = predictor.renderState();
      if (ps) {
        const size = fallbackPlayerSize(engineNow());
        return { id: ownPlayerId, x: ps.x, y: ps.y, w: ps.w ?? size.w, h: ps.h ?? size.h, facing: ps.facing, grounded: ps.grounded };
      }
    }
    const r = remotes.get(ownPlayerId);
    return r ? { id: ownPlayerId, x: r.x, y: r.y, w: r.w, h: r.h, facing: r.facing ?? 1, grounded: r.grounded } : null;
  }

  // Server-authoritative dropped items for the renderer (empty when none).
  function getItemsForRender() { return itemsForRender; }
  function getCreaturesForRender() { return creaturesForRender; }
  // Our own inventory / cursor from the server (null until the first arrives).
  function getOwnInventory() { return invByPlayer.get(ownPlayerId) || null; }
  function getOwnCursor() { return curByPlayer.get(ownPlayerId) ?? null; }
  // True (and self-clearing) when our inventory changed since the last poll.
  function consumeInventoryDirty() { const d = invDirty; invDirty = false; return d; }

  return {
    joinRoom, disconnect, update,
    getPlayersForRender, getOwnPlayer,
    getItemsForRender, getCreaturesForRender, getOwnInventory, getOwnCursor, consumeInventoryDirty,
    sendSelect, sendSize, sendMove, sendPick, sendThrow,
    get role() { return role; },
    get connected() { return connected; },
    get ownPlayerId() { return ownPlayerId; },
    get remoteCount() { return remotes.size; },
    get status() { return statusText; },
    set onStatus(fn) { onStatus = fn; },
    get clientId() { return clientId; },
    get worldReady() { return worldReady; },
    get debug() { return { sent: dbgSent, ownPlayerId, role, connected, worldReady, items: itemsForRender.length / ITEM_FIELDS, creatures: creaturesForRender.length / CREATURE_FIELDS }; },
  };
}
