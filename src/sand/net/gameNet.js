// Browser client for the authoritative Node server. Sends input/intents, applies
// world and actor state to the presentation engine, and predicts the local player.
// It remains inert while the offline worker authority is active.

import {
  encode, decode, MSG, makeInput, makeJoin, makeLeave, makeResync,
  makeView,
  makeSelect, makeSize, makeMove, makePick, makeThrow, makeCraft, makeRespawn,
  INV_SLOTS, INV_FIELDS, ITEM_FIELDS, CREATURE_FIELDS, PROJECTILE_FIELDS,
} from './protocol.js';
import { applyWorldMessage, applyDiffMessage, validateWorldMessage } from './worldSync.js';
import { Predictor } from './predict.js';

const SMOOTH = 0.35;             // client render smoothing toward the latest snapshot
const MAX_INBOUND = 96;
const MAX_QUEUED_DIFFS = 48;
const LATEST_MESSAGES = new Set([
  MSG.SNAPSHOT, MSG.ITEMS, MSG.CREATURES, MSG.PROJECTILES,
  MSG.INVENTORY, MSG.CURSOR,
]);
const fallbackPlayerSize = (engine) => engine?.getPlayerSize?.() || { w: 4, h: 8 };

let clientCounter = 0;
const newClientId = () => `c${Date.now().toString(36)}-${(clientCounter++).toString(36)}`;

export function createGameNet({ getEngine, getLocalInput, getViewport = null, rebuildEngine }) {
  const engineNow = () => getEngine();
  let ws = null, role = null, room = null, clientId = null, connected = false;
  let ownPlayerId = 0;             // my authoritative player id on the server
  let predictor = null, predId = 0; // local prediction of our own player
  let inputSeq = 0;
  let lastViewKey = '';
  let worldReady = false;          // has the initial world snapshot been applied?
  let paused = false, needsResync = false, resyncPending = false;
  let pendingJoin = null;
  let dbgSent = 0;                 // diagnostics
  const inQueue = [];              // inbound decoded messages, drained each step
  const remotes = new Map();       // render: id -> { x,y,vx,vy,facing,grounded,tool,w,h,tx,ty,animState,animFrame }
  let itemsForRender = new Float32Array(0); // packed [id,kind,material,count,x,y,life] from the server
  let creaturesForRender = new Float32Array(0);
  let projectilesForRender = new Float32Array(0);
  let soundBatches = [];
  const invByPlayer = new Map();   // player id -> { slots, selected, selectedFootprint } (server-authoritative)
  const curByPlayer = new Map();   // player id -> carried cursor stack (or null)
  let invDirty = false;            // our own inventory changed since last read (HUD pull)
  let statusText = 'offline';
  let onStatus = null;

  const send = (obj) => { if (ws && ws.readyState === 1) ws.send(encode(obj)); };
  const setStatus = (s) => { statusText = s; onStatus?.(s); };

  const requestResync = () => {
    if (!connected || !room || !clientId || resyncPending) return;
    resyncPending = true;
    send(makeResync(room, clientId));
  };

  const sameLatestKey = (a, b) => a.t === b.t &&
    ((a.t === MSG.INVENTORY || a.t === MSG.CURSOR) ? a.player === b.player : true);

  function dropQueuedWorld() {
    let dropped = false;
    for (let i = inQueue.length - 1; i >= 0; i--) {
      if (inQueue[i].t === MSG.WORLD || inQueue[i].t === MSG.DIFF) {
        inQueue.splice(i, 1); dropped = true;
      }
    }
    return dropped;
  }

  function enqueueMessage(m) {
    if (paused && m.t === MSG.SOUNDS) return;
    if (paused && (m.t === MSG.WORLD || m.t === MSG.DIFF)) {
      if (m.t === MSG.WORLD) resyncPending = false;
      dropQueuedWorld(); needsResync = true;
      return;
    }
    if (m.t === MSG.WORLD) dropQueuedWorld();
    if (m.t === MSG.DIFF && inQueue.reduce((n, q) => n + (q.t === MSG.DIFF ? 1 : 0), 0) >= MAX_QUEUED_DIFFS) {
      dropQueuedWorld(); needsResync = true; requestResync();
      return;
    }
    if (LATEST_MESSAGES.has(m.t)) {
      for (let i = inQueue.length - 1; i >= 0; i--) if (sameLatestKey(inQueue[i], m)) { inQueue.splice(i, 1); break; }
    }
    inQueue.push(m);
    while (inQueue.length > MAX_INBOUND) {
      // Inventory/cursor are change-triggered authority facts, not periodic
      // streams. Preserve their coalesced latest values when a slow render
      // client falls behind; discard an older transient packet first.
      const transient = inQueue.findIndex((queued) => !LATEST_MESSAGES.has(queued.t));
      const [dropped] = inQueue.splice(transient >= 0 ? transient : 0, 1);
      if (dropped.t === MSG.WORLD || dropped.t === MSG.DIFF) { needsResync = true; requestResync(); }
    }
  }

  function finishJoin() {
    if (!pendingJoin || !ownPlayerId || !worldReady) return;
    const { resolve, timer } = pendingJoin;
    pendingJoin = null; clearTimeout(timer);
    setStatus(`joined ${room}`);
    sendViewport();
    resolve();
  }

  function failJoin(error) {
    if (!pendingJoin) return;
    const { reject, timer } = pendingJoin;
    pendingJoin = null; clearTimeout(timer);
    reject(error);
  }

  function resetState(status = 'offline') {
    ws = null; role = null; room = null; connected = false;
    ownPlayerId = 0; inputSeq = 0; lastViewKey = ''; worldReady = false;
    needsResync = false; resyncPending = false;
    predictor = null; predId = 0;
    remotes.clear(); inQueue.length = 0;
    itemsForRender = new Float32Array(0); creaturesForRender = new Float32Array(0);
    projectilesForRender = new Float32Array(0); soundBatches = [];
    invByPlayer.clear(); curByPlayer.clear(); invDirty = false;
    setStatus(status);
  }

  function connect(url, asRole) {
    disconnect();
    clientId = newClientId();
    const socket = new WebSocket(url);
    let closeStatus = 'disconnected';
    ws = socket;
    setStatus('connecting');
    socket.onmessage = (ev) => {
      const m = decode(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (!m) return;
      if (m.t === MSG.REJECT) {
        closeStatus = `rejected: ${m.reason}`;
        setStatus(closeStatus);
        failJoin(new Error(`Server rejected join: ${m.reason}`));
        try { socket.close(); } catch { /* already closing */ }
        return;
      }
      // Complete the join handshake even when presentation RAF is paused. Other
      // state remains queued and bounded until the next fixed step.
      if (pendingJoin && (m.t === MSG.ASSIGN || m.t === MSG.WORLD)) {
        try { handleMessage(m); finishJoin(); }
        catch (e) { failJoin(e); try { socket.close(); } catch { /* closing */ } }
        return;
      }
      enqueueMessage(m);
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
        failJoin(new Error('WebSocket connection closed before the join completed'));
        if (opened) { resetState(closeStatus); return; }
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
    setStatus(`joining ${roomId}`);
    const joined = new Promise((resolve, reject) => {
      const socket = ws;
      const timer = setTimeout(() => {
        failJoin(new Error('Timed out waiting for server assignment and world'));
        try { socket.close(); } catch { /* closing */ }
      }, 10000);
      pendingJoin = { resolve, reject, timer };
    });
    send(makeJoin(roomId, clientId, 'client'));
    return joined;
  }

  function disconnect(status = 'offline') {
    failJoin(new Error('Join cancelled'));
    const socket = ws;
    if (socket) {
      try { if (connected && room && clientId && socket.readyState === 1) socket.send(encode(makeLeave(room, clientId))); } catch { /* closing */ }
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      try { socket.close(); } catch { /* already closing */ }
    }
    resetState(status);
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
        const bytes = validateWorldMessage(m);
        if (!bytes) { resyncPending = false; needsResync = true; requestResync(); break; }
        const oldOffsetX = cur.getWorldOffsetX?.() || 0;
        const oldOffsetY = cur.getWorldOffsetY?.() || 0;
        const oldCam = cur.getCam?.();
        const worldCam = worldReady && oldCam ? { x: oldOffsetX + oldCam.x, y: oldOffsetY + oldCam.y } : null;
        const dx = m.offsetX - oldOffsetX, dy = m.offsetY - oldOffsetY;
        if (dx || dy) {
          for (const r of remotes.values()) {
            r.x -= dx; r.y -= dy;
            if (r.tx !== undefined) r.tx -= dx;
            if (r.ty !== undefined) r.ty -= dy;
            if (r.aimX !== undefined) r.aimX -= dx;
            if (r.aimY !== undefined) r.aimY -= dy;
          }
        }
        if (predId) cur.removePlayer(predId);
        predictor = null; predId = 0;
        let e = cur;
        // Adopt the server's buffer dims so diffs apply 1:1 (rebuild the local
        // render engine if ours differs). Only full snapshots (join/resync) carry
        // dims, so this is rare.
        if (!worldReady || m.cols !== cur.cols || m.rows !== cur.rows) {
          e = rebuildEngine(m.cols, m.rows);
        }
        resyncPending = false;
        if (!applyWorldMessage(e, m, { mirror: true, bytes })) { needsResync = true; requestResync(); break; }
        if (worldCam) e.cameraSet(worldCam.x - m.offsetX, worldCam.y - m.offsetY);
        worldReady = true; needsResync = false;
        break;
      }
      case MSG.DIFF: {
        if (!worldReady) break;
        if (!applyDiffMessage(engineNow(), m, { mirror: true })) { needsResync = true; requestResync(); } // hash mismatch -> resync
        break;
      }
      case MSG.ITEMS: ingestItems(m); break;
      case MSG.CREATURES: ingestCreatures(m); break;
      case MSG.PROJECTILES: ingestProjectiles(m); break;
      case MSG.SOUNDS: soundBatches.push(Float32Array.from(m.data)); break;
      case MSG.INVENTORY: ingestInventory(m); break;
      case MSG.CURSOR: ingestCursor(m); break;
      default: break;
    }
  }

  // Snap our local prediction to the server's authoritative own-player and replay
  // unacknowledged inputs (lazily spawns the prediction player).
  function reconcilePredictor(op, actorTick) {
    const e = engineNow();
    if (!predictor) { if (!predId) predId = e.spawnPlayer(op.x, op.y); predictor = new Predictor(e, predId); }
    predictor.reconcile({
      x: op.x, y: op.y, vx: op.vx, vy: op.vy, facing: op.facing,
      grounded: !!op.grounded, jumpReady: !!op.jr,
      jetpackFuel: op.jetpackFuel, jetpackActive: !!op.jetpackActive,
    }, op.seq >>> 0, actorTick);
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
      r.deathTicks = p.deathTicks | 0; r.respawnReady = p.respawnReady !== 0;
      r.bowCharge = p.bowCharge; r.heldItemKind = p.heldItemKind | 0;
      r.jetpackFuel = p.jetpackFuel; r.jetpackActive = p.jetpackActive !== 0;
      r.aimX = p.aimX; r.aimY = p.aimY;
      r.animState = p.animState | 0; r.animFrame = p.animFrame | 0; // so remotes animate too
      r.w = size.w; r.h = size.h;
      if (p.id === ownPlayerId && !r.alive) {
        predictor = null;
      }
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
  function ingestProjectiles(m) {
    if (projectilesForRender.length === m.data.length) projectilesForRender.set(m.data);
    else projectilesForRender = Float32Array.from(m.data);
  }
  function ingestInventory(m) {
    const slots = new Array(INV_SLOTS);
    for (let i = 0; i < INV_SLOTS; i++) {
      const o = i * INV_FIELDS;
      slots[i] = { material: m.data[o] | 0, isTool: m.data[o + 1] === 1, toolClass: m.data[o + 2] | 0, toolTier: m.data[o + 3] | 0, count: m.data[o + 4] | 0, plantType: m.data[o + 5] | 0, itemKind: m.data[o + 6] | 0 };
    }
    invByPlayer.set(m.player, { slots, selected: m.selected | 0, selectedFootprint: m.selectedFootprint | 0 });
    if (m.player === ownPlayerId) invDirty = true;
  }
  function ingestCursor(m) {
    const c = m.cur;
    curByPlayer.set(m.player, c ? { material: c.material | 0, isTool: c.isTool === 1, toolClass: c.toolClass | 0, toolTier: c.toolTier | 0, count: c.count | 0, plantType: c.plantType | 0, itemKind: c.itemKind | 0 } : null);
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
    sendViewport();
    // send local input to the server AND predict it locally (immediate, no lag).
    const inp = getLocalInput();
    const e = engineNow();
    send(makeInput({
      room, client: clientId, player: ownPlayerId, tick: inputSeq, seq: inputSeq, bits: inp.bits,
      aimX: inp.aimX + (e.getWorldOffsetX?.() || 0), aimY: inp.aimY + (e.getWorldOffsetY?.() || 0),
      tool: inp.tool, moveX: inp.moveX, moveY: inp.moveY,
    }));
    if (predictor) predictor.predict(inputSeq, inp);
    if (inp.bits) dbgSent++;
    inputSeq++;
  }

  function sendViewport() {
    if (!connected || !room || !clientId || !getViewport) return;
    const v = getViewport();
    if (!v) return;
    const key = `${v.viewCols}:${v.viewRows}:${v.bufferCols}:${v.bufferRows}`;
    if (key === lastViewKey) return;
    lastViewKey = key;
    send(makeView(room, clientId, v.viewCols, v.viewRows, v.bufferCols, v.bufferRows));
  }

  function setPaused(next) {
    const value = !!next;
    if (value === paused) return;
    paused = value;
    if (paused) {
      if (dropQueuedWorld()) needsResync = true;
      return;
    }
    if (needsResync) requestResync();
  }

  // ---- survival-inventory intents (forwarded to the authoritative server) ----
  const sendSelect = (slot) => send(makeSelect(room, clientId, slot | 0));
  const sendSize = (footprint) => send(makeSize(room, clientId, footprint | 0));
  const sendMove = (from, to) => send(makeMove(room, clientId, from | 0, to | 0));
  const sendPick = (slot, half) => send(makePick(room, clientId, slot | 0, half));
  const sendThrow = (whole) => send(makeThrow(room, clientId, whole));
  const sendCraft = (recipe, max = false) => send(makeCraft(room, clientId, recipe | 0, max));
  const sendRespawn = () => send(makeRespawn(room, clientId));

  // Players to render: clients read the smoothed snapshot entities (own player is
  // the responsive prediction when available).
  function getPlayersForRender() {
    const own = getOwnPlayer();
    const out = [];
    for (const [id, r] of remotes) {
      if (id === ownPlayerId && own) { out.push({ ...r, ...own, id, tool: r.tool ?? 0 }); continue; }
      out.push({ id, ...r });
    }
    return out;
  }
  function getOwnPlayer() {
    // predicted (responsive) state when available; else the raw snapshot entity.
    const authoritative = remotes.get(ownPlayerId);
    if (authoritative && !authoritative.alive) return { id: ownPlayerId, ...authoritative };
    if (predictor) {
      const ps = predictor.renderState();
      if (ps) {
        const size = fallbackPlayerSize(engineNow());
        return { ...authoritative, id: ownPlayerId, x: ps.x, y: ps.y, w: ps.w ?? size.w, h: ps.h ?? size.h, facing: ps.facing, grounded: ps.grounded };
      }
    }
    const r = remotes.get(ownPlayerId);
    return r ? { id: ownPlayerId, ...r } : null;
  }

  // Server-authoritative dropped items for the renderer (empty when none).
  function getItemsForRender() { return itemsForRender; }
  function getCreaturesForRender() { return creaturesForRender; }
  function getProjectilesForRender() { return projectilesForRender; }
  function consumeSoundEvents() {
    if (!soundBatches.length) return new Float32Array(0);
    if (soundBatches.length === 1) return soundBatches.shift();
    let length = 0;
    for (const batch of soundBatches) length += batch.length;
    const joined = new Float32Array(length);
    let offset = 0;
    for (const batch of soundBatches) { joined.set(batch, offset); offset += batch.length; }
    soundBatches = [];
    return joined;
  }
  // Our own inventory / cursor from the server (null until the first arrives).
  function getOwnInventory() { return invByPlayer.get(ownPlayerId) || null; }
  function getOwnCursor() { return curByPlayer.get(ownPlayerId) ?? null; }
  // True (and self-clearing) when our inventory changed since the last poll.
  function consumeInventoryDirty() { const d = invDirty; invDirty = false; return d; }

  return {
    joinRoom, disconnect, update, setPaused,
    getPlayersForRender, getOwnPlayer,
    getItemsForRender, getCreaturesForRender, getProjectilesForRender, consumeSoundEvents, getOwnInventory, getOwnCursor, consumeInventoryDirty,
    sendSelect, sendSize, sendMove, sendPick, sendThrow, sendCraft, sendRespawn,
    get role() { return role; },
    get connected() { return connected; },
    get ownPlayerId() { return ownPlayerId; },
    get remoteCount() { return remotes.size; },
    get status() { return statusText; },
    set onStatus(fn) { onStatus = fn; },
    get clientId() { return clientId; },
    get worldReady() { return worldReady; },
    get debug() { return { sent: dbgSent, ownPlayerId, role, connected, worldReady, items: itemsForRender.length / ITEM_FIELDS, creatures: creaturesForRender.length / CREATURE_FIELDS, projectiles: projectilesForRender.length / PROJECTILE_FIELDS }; },
  };
}
