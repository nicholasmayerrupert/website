// Browser client for the authoritative Node server. Sends input/intents, applies
// world and actor state to the presentation engine, and predicts the local player.
// It remains inert while the offline worker authority is active.

import {
  encode, decode, MSG, makeInput, makeJoin, makeLeave, makeResync,
  makeView,
  makeSelect, makeSize, makeMove, makePick, makeThrow, makeCraft, makeRespawn,
  ITEM_FIELDS, CREATURE_FIELDS, PROJECTILE_FIELDS,
} from './protocol.js';
import { applyWorldMessage, applyDiffMessage, validateWorldMessage } from './worldSync.js';
import { Predictor } from './predict.js';
import { OFF, STRIDES } from '../wasmBridge/abi.generated.js';
import { translatePackedPositions } from './localCoordinates.js';
import { mergePlayerPrediction } from '../worker/playerPresentation.js';
import {
  unpackObjectWireRecord, unpackObjectWireRecords,
} from '../wasmBridge/recordCodec.js';

const MAX_REMOTE_EXTRAPOLATION_TICKS = 8;
const REMOTE_CORRECTION_SNAP = 16;
const REMOTE_CORRECTION_EASE = 0.25;
const MAX_INBOUND = 96;
const MAX_QUEUED_DIFFS = 48;
const LATEST_MESSAGES = new Set([
  MSG.SNAPSHOT, MSG.ITEMS, MSG.CREATURES, MSG.PROJECTILES,
  MSG.INVENTORY, MSG.CURSOR,
]);
const BUFFER_LOCAL_MESSAGES = new Set([
  MSG.SNAPSHOT, MSG.ITEMS, MSG.CREATURES, MSG.PROJECTILES,
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
  let remotePresentationTick = 0;
  let lastViewKey = '';
  let worldReady = false;          // has the initial world snapshot been applied?
  let paused = false, needsResync = false, resyncPending = false;
  let pendingJoin = null;
  let dbgSent = 0;                 // diagnostics
  const inQueue = [];              // inbound decoded messages, drained each step
  const remotes = new Map();       // projected player records by id for presentation
  let itemsForRender = new Float32Array(0); // generated itemSnapshot records from the server
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

  function dropQueuedLocalFrames() {
    for (let i = inQueue.length - 1; i >= 0; i--) {
      if (BUFFER_LOCAL_MESSAGES.has(inQueue[i].t)) inQueue.splice(i, 1);
    }
  }

  function enqueueMessage(m) {
    if (paused && m.t === MSG.SOUNDS) return;
    if (paused && (m.t === MSG.WORLD || m.t === MSG.DIFF)) {
      if (m.t === MSG.WORLD) resyncPending = false;
      dropQueuedWorld(); dropQueuedLocalFrames(); needsResync = true;
      return;
    }
    // Once a world frame was dropped, buffer-local actors cannot be interpreted
    // safely until a replacement WORLD establishes their coordinate frame.
    // Actor packets that follow an already-queued WORLD are safe: WebSocket
    // ordering guarantees they use that new frame.
    const queuedWorld = inQueue.some((queued) => queued.t === MSG.WORLD);
    if (BUFFER_LOCAL_MESSAGES.has(m.t) && (needsResync || resyncPending) && !queuedWorld) return;
    if (m.t === MSG.WORLD) {
      // Any buffer-local packet before this WORLD belongs to the frame of the
      // older queued/applied world. This also covers two rapid shifts before a
      // slow presentation tick, where the first shift's actors sit between the
      // two full worlds.
      dropQueuedLocalFrames();
      dropQueuedWorld();
    }
    if (m.t === MSG.DIFF && inQueue.reduce((n, q) => n + (q.t === MSG.DIFF ? 1 : 0), 0) >= MAX_QUEUED_DIFFS) {
      dropQueuedWorld(); dropQueuedLocalFrames(); needsResync = true; requestResync();
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
      if (dropped.t === MSG.WORLD || dropped.t === MSG.DIFF) {
        dropQueuedLocalFrames(); needsResync = true; requestResync();
      }
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
    ownPlayerId = 0; inputSeq = 0; remotePresentationTick = 0; lastViewKey = ''; worldReady = false;
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

  function rebaseRenderActors(dx, dy) {
    if (!dx && !dy) return;
    for (const r of remotes.values()) {
      r.x += dx; r.y += dy;
      if (r.tx !== undefined) r.tx += dx;
      if (r.ty !== undefined) r.ty += dy;
      if (r.snapshotX !== undefined) r.snapshotX += dx;
      if (r.snapshotY !== undefined) r.snapshotY += dy;
      if (r.aimX !== undefined) r.aimX += dx;
      if (r.aimY !== undefined) r.aimY += dy;
      if (r.mineTarget) {
        r.mineTarget = { x: r.mineTarget.x + dx, y: r.mineTarget.y + dy };
      }
    }
    translatePackedPositions(itemsForRender, STRIDES.itemSnapshot,
      OFF.itemSnapshot.x, OFF.itemSnapshot.y, dx, dy);
    translatePackedPositions(creaturesForRender, STRIDES.creatureSnapshot,
      OFF.creatureSnapshot.x, OFF.creatureSnapshot.y, dx, dy);
    translatePackedPositions(creaturesForRender, STRIDES.creatureSnapshot,
      OFF.creatureSnapshot.aimX, OFF.creatureSnapshot.aimY, dx, dy);
    translatePackedPositions(projectilesForRender, STRIDES.projectileSnapshot,
      OFF.projectileSnapshot.x, OFF.projectileSnapshot.y, dx, dy);
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
        const bytes = validateWorldMessage(m, { verifyHash: true });
        if (!bytes) { resyncPending = false; needsResync = true; requestResync(); break; }
        const oldOffsetX = cur.getWorldOffsetX?.() || 0;
        const oldOffsetY = cur.getWorldOffsetY?.() || 0;
        const oldCam = cur.getCam?.();
        const worldCam = worldReady && oldCam ? { x: oldOffsetX + oldCam.x, y: oldOffsetY + oldCam.y } : null;
        const dx = m.offsetX - oldOffsetX, dy = m.offsetY - oldOffsetY;
        let e = cur;
        const rebuild = !worldReady || m.cols !== cur.cols || m.rows !== cur.rows;
        // Adopt the server's buffer dims so diffs apply 1:1 (rebuild the local
        // render engine if ours differs). Only full snapshots (join/resync) carry
        // dims, so this is rare.
        if (rebuild) {
          try {
            e = rebuildEngine(m.cols, m.rows);
          } catch {
            failJoin(new Error('Unable to create the server world'));
            disconnect('world rebuild failed');
            break;
          }
          // Rebuild commits engine and prediction ownership together. Until it
          // succeeds, the current presentation remains usable.
          predictor = null; predId = 0;
        }
        resyncPending = false;
        if (!applyWorldMessage(e, m, { mirror: true, validatedBytes: bytes })) { needsResync = true; requestResync(); break; }
        rebaseRenderActors(-dx, -dy);
        if (!rebuild && predictor) predictor.rebase(-dx, -dy);
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
    remotePresentationTick = Math.max(remotePresentationTick, m.tick);
    const seen = new Set();
    for (const wirePlayer of m.players) {
      const p = unpackObjectWireRecord(wirePlayer, 'player');
      seen.add(p.id);
      let r = remotes.get(p.id);
      const size = fallbackPlayerSize(engineNow());
      if (!r) { r = { x: p.x, y: p.y, w: size.w, h: size.h }; remotes.set(p.id, r); }
      const age = Math.max(0, Math.min(
        MAX_REMOTE_EXTRAPOLATION_TICKS,
        remotePresentationTick - m.tick,
      ));
      const targetX = p.x + p.vx * age, targetY = p.y + p.vy * age;
      r.correctionX = Number.isFinite(r.x) ? r.x - targetX : 0;
      r.correctionY = Number.isFinite(r.y) ? r.y - targetY : 0;
      if (Math.hypot(r.correctionX, r.correctionY) > REMOTE_CORRECTION_SNAP) {
        r.correctionX = 0; r.correctionY = 0;
      }
      r.snapshotX = r.tx = p.x; r.snapshotY = r.ty = p.y;
      r.snapshotTick = m.tick;
      for (const [field, value] of Object.entries(p)) {
        if (field !== 'x' && field !== 'y') r[field] = value;
      }
      r.mineTarget = p.mineTarget ? { ...p.mineTarget } : null;
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
    const slots = unpackObjectWireRecords(m.data, 'inventoryStack');
    invByPlayer.set(m.player, { slots, selected: m.selected | 0, selectedFootprint: m.selectedFootprint | 0 });
    if (m.player === ownPlayerId) invDirty = true;
  }
  function ingestCursor(m) {
    curByPlayer.set(m.player,
      m.cur ? unpackObjectWireRecord(m.cur, 'inventoryStack') : null);
  }

  // Called once per fixed step from the game loop.
  function update() {
    if (!connected) return;
    // The client doesn't step, so reset its dirty marks here; the diffs applied
    // below then mark exactly the cells that changed for an incremental repaint.
    engineNow().resetDirty();
    for (let i = 0; i < inQueue.length; i++) {
      const message = inQueue[i];
      // A malformed/hash-invalid WORLD leaves the existing mirror installed.
      // Do not interpret later actor packets in the rejected frame while the
      // requested replacement full world is still pending.
      if (BUFFER_LOCAL_MESSAGES.has(message.t) && (needsResync || resyncPending)) continue;
      handleMessage(message);
    }
    inQueue.length = 0;

    remotePresentationTick++;
    const predictedActorTick = predictor
      ? Math.max(remotePresentationTick, engineNow().getActorTick?.() || 0)
      : remotePresentationTick;
    // Dead-reckon remote players between authority snapshots. The short cap keeps a
    // dropped packet from letting a player run through terrain indefinitely;
    // each authoritative snapshot corrects the projected target.
    for (const [id, r] of remotes) {
      if (r.tx === undefined) continue;
      if (id !== ownPlayerId && r.snapshotTick !== undefined) {
        const age = Math.max(0, Math.min(
          MAX_REMOTE_EXTRAPOLATION_TICKS,
          predictedActorTick - r.snapshotTick,
        ));
        r.tx = r.snapshotX + r.vx * age;
        r.ty = r.snapshotY + r.vy * age;
        r.correctionX = (r.correctionX || 0) * (1 - REMOTE_CORRECTION_EASE);
        r.correctionY = (r.correctionY || 0) * (1 - REMOTE_CORRECTION_EASE);
        if (Math.abs(r.correctionX) < 0.01) r.correctionX = 0;
        if (Math.abs(r.correctionY) < 0.01) r.correctionY = 0;
        r.x = r.tx + r.correctionX;
        r.y = r.ty + r.correctionY;
        continue;
      }
      r.x = r.tx;
      r.y = r.ty;
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
      if (dropQueuedWorld()) { dropQueuedLocalFrames(); needsResync = true; }
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
      if (ps) return mergePlayerPrediction(authoritative, {
        ...ps,
        ...fallbackPlayerSize(engineNow()),
      }, ownPlayerId);
    }
    const r = remotes.get(ownPlayerId);
    return r ? { id: ownPlayerId, ...r } : null;
  }
  function advancePresentation() { predictor?.advanceRenderSmoothing(); }

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
  function getMineProgress() { return remotes.get(ownPlayerId)?.mineProgress || 0; }
  function getMineTarget() {
    const target = remotes.get(ownPlayerId)?.mineTarget;
    return target ? { ...target } : null;
  }
  // True (and self-clearing) when our inventory changed since the last poll.
  function consumeInventoryDirty() { const d = invDirty; invDirty = false; return d; }

  return {
    joinRoom, disconnect, update, setPaused,
    getPlayersForRender, getOwnPlayer, advancePresentation,
    getItemsForRender, getCreaturesForRender, getProjectilesForRender, consumeSoundEvents,
    getOwnInventory, getOwnCursor, getMineProgress, getMineTarget, consumeInventoryDirty,
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
