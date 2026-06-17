// Browser multiplayer glue for createSandGame. Host-authoritative:
//
//   HOST peer  — runs the real engine. Spawns a player per remote client, applies
//                their inputs (via the tested Host class), and broadcasts player
//                snapshots. Its own local player is driven locally as usual.
//   CLIENT peer— sends its input to the host and renders ALL players from the
//                host's snapshots (smoothed). Its own authoritative position is
//                whatever the host reports (no local prediction yet — Phase 7).
//
// The transport is the WebSocket relay (scripts/dev-multiplayer-server.mjs); this
// module never trusts client-side world edits. World replication (cell diffs) is
// Phase 6 — for now each peer keeps its own local sand world and only PLAYERS are
// replicated, which is enough to see and move each other.

import { Host } from './host.js';
import { encode, decode, makeInput, makeJoin, makeLeave, makeSnapshot, makeAssign, makeResync, MSG } from './protocol.js';
import { encodeWorld, encodeDiff, applyWorldMessage, applyDiffMessage } from './worldSync.js';

const SNAPSHOT_INTERVAL = 3;     // steps between host snapshot broadcasts (~20Hz)
const SMOOTH = 0.35;             // client render smoothing toward the latest snapshot
const DEFAULT_W = 4, DEFAULT_H = 8;

let clientCounter = 0;
const newClientId = () => `c${Date.now().toString(36)}-${(clientCounter++).toString(36)}`;

export function createGameNet({ getEngine, getLocalInput, getSpawn }) {
  const engineNow = () => getEngine();
  let ws = null, role = null, room = null, clientId = null, connected = false;
  let host = null;                 // Host instance (host role only)
  let ownPlayerId = 0;             // client: my authoritative player id on the host
  let inputSeq = 0, snapCounter = 0, sinceSnap = 0;
  let worldReady = false;     // client: has the initial world snapshot been applied?
  let worldDimsMismatch = false; // client: host buffer size differs from ours (degraded)
  let dbgSent = 0, dbgRecvInput = 0; // diagnostics
  const inQueue = [];              // inbound decoded messages, drained each step
  const remotes = new Map();       // client render: id -> { x,y,vx,vy,facing,grounded,tool,w,h,tx,ty }
  let statusText = 'offline';
  let onStatus = null;

  const send = (obj) => { if (ws && ws.readyState === 1) ws.send(encode(obj)); };
  const setStatus = (s) => { statusText = s; onStatus?.(s); };

  function connect(url, asRole) {
    disconnect();
    role = asRole;
    room = null;
    clientId = newClientId();
    ws = new WebSocket(url);
    setStatus('connecting');
    ws.onmessage = (ev) => {
      const m = decode(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m) inQueue.push(m);
    };
    ws.onclose = () => { connected = false; setStatus('disconnected'); };
    ws.onerror = () => setStatus('error');
    return new Promise((resolve) => {
      ws.onopen = () => { connected = true; resolve(); };
    });
  }

  async function hostRoom(url, roomId) {
    await connect(url, 'host');
    room = roomId;
    host = new Host({ engine: engineNow(), roomId });
    send(makeJoin(roomId, clientId, 'host'));
    setStatus(`hosting ${roomId}`);
  }
  async function joinRoom(url, roomId) {
    await connect(url, 'client');
    room = roomId;
    // The host owns this peer's player; drop any local engine player so we render
    // purely from snapshots.
    send(makeJoin(roomId, clientId, 'client'));
    setStatus(`joined ${roomId}`);
  }

  function disconnect() {
    if (ws) {
      try { if (room && clientId) send(makeLeave(room, clientId)); } catch { /* closing */ }
      try { ws.close(); } catch { /* already closing */ }
    }
    ws = null; role = null; host = null; connected = false;
    ownPlayerId = 0; inputSeq = 0; worldReady = false; worldDimsMismatch = false;
    remotes.clear(); inQueue.length = 0;
    setStatus('offline');
  }

  function handleHost(m) {
    switch (m.t) {
      case MSG.JOIN: {
        if (m.client === clientId) break;
        const pid = host.addClient(m.client, getSpawn());
        if (pid) send(makeAssign(room, m.client, pid));
        send(encodeWorld(engineNow(), snapCounter)); // full world for the joiner
        break;
      }
      case MSG.INPUT: dbgRecvInput++; host.receive(m); break;
      case MSG.RESYNC: send(encodeWorld(engineNow(), snapCounter)); break; // client fell behind
      case MSG.LEAVE: host.removeClient(m.client); break;
      default: break;
    }
  }
  function handleClient(m) {
    switch (m.t) {
      case MSG.ASSIGN: if (m.client === clientId) ownPlayerId = m.player; break;
      case MSG.SNAPSHOT: ingestSnapshot(m); break;
      case MSG.WORLD: {
        const e = engineNow();
        if (m.cols !== e.cols || m.rows !== e.rows) { worldDimsMismatch = true; break; } // size differs -> can't replicate (MVP)
        applyWorldMessage(e, m); worldReady = true; worldDimsMismatch = false;
        break;
      }
      case MSG.DIFF: {
        if (!worldReady || worldDimsMismatch) break;
        if (!applyDiffMessage(engineNow(), m)) send(makeResync(room, clientId)); // hash mismatch -> resync
        break;
      }
      default: break;
    }
  }

  function ingestSnapshot(m) {
    const seen = new Set();
    for (const p of m.players) {
      seen.add(p.id);
      let r = remotes.get(p.id);
      if (!r) { r = { x: p.x, y: p.y, w: DEFAULT_W, h: DEFAULT_H }; remotes.set(p.id, r); }
      r.tx = p.x; r.ty = p.y; r.vx = p.vx; r.vy = p.vy;
      r.facing = p.facing; r.grounded = !!p.grounded; r.tool = p.tool; r.seq = p.seq;
      r.w = DEFAULT_W; r.h = DEFAULT_H;
    }
    for (const id of [...remotes.keys()]) if (!seen.has(id)) remotes.delete(id); // left
  }

  // Called once per fixed step from the game loop.
  function update() {
    if (!connected) return;
    // Client doesn't step, so reset its dirty marks here; the diffs applied below
    // then mark exactly the cells that changed for an incremental repaint.
    if (role === 'client') engineNow().resetDirty();
    for (let i = 0; i < inQueue.length; i++) (role === 'host' ? handleHost : handleClient)(inQueue[i]);
    inQueue.length = 0;

    if (role === 'host') {
      // World diffs go out every step (row marks reset each step, so a lower rate
      // would drop changes); only when someone is listening, and empty diffs are
      // skipped. Must run BEFORE the engine's own render consumes the dirty marks.
      if (host.clients.size > 0) { const d = encodeDiff(engineNow(), snapCounter); if (d) { d.room = room; send(d); } }
      if (++sinceSnap >= SNAPSHOT_INTERVAL) {
        sinceSnap = 0;
        const snap = makeSnapshot(snapCounter++, engineNow().getPlayers(), null);
        snap.room = room;
        send(snap);
      }
    } else if (role === 'client') {
      // smooth render players toward the latest snapshot target
      for (const r of remotes.values()) {
        if (r.tx === undefined) continue;
        r.x += (r.tx - r.x) * SMOOTH;
        r.y += (r.ty - r.y) * SMOOTH;
      }
      // send local input to the host
      const inp = getLocalInput();
      send(makeInput({ room, client: clientId, player: ownPlayerId, tick: inputSeq, seq: inputSeq, bits: inp.bits, aimX: inp.aimX, aimY: inp.aimY, tool: inp.tool }));
      if (inp.bits) dbgSent++;
      inputSeq++;
    }
  }

  // Players to render: host/single-player read the engine; clients read the
  // smoothed snapshot entities.
  function getPlayersForRender() {
    if (role !== 'client') return engineNow().getPlayers();
    const out = [];
    for (const [id, r] of remotes) out.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, facing: r.facing ?? 1, grounded: r.grounded, tool: r.tool ?? 0 });
    return out;
  }
  function getOwnPlayer() {
    if (role !== 'client') return null;
    const r = remotes.get(ownPlayerId);
    return r ? { id: ownPlayerId, x: r.x, y: r.y, w: r.w, h: r.h, facing: r.facing ?? 1, grounded: r.grounded } : null;
  }

  return {
    hostRoom, joinRoom, disconnect, update,
    getPlayersForRender, getOwnPlayer,
    get role() { return role; },
    get connected() { return connected; },
    get ownPlayerId() { return ownPlayerId; },
    get remoteCount() { return role === 'host' ? (host ? host.clients.size : 0) : remotes.size; },
    get status() { return statusText; },
    set onStatus(fn) { onStatus = fn; },
    get clientId() { return clientId; },
    get worldReady() { return worldReady; },
    get debug() { return { sent: dbgSent, recvInput: dbgRecvInput, ownPlayerId, role, connected, worldReady, worldDimsMismatch }; },
  };
}
