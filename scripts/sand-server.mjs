// Authoritative headless multiplayer server. It runs the WASM simulation and
// sends world, actor, item, inventory, and cursor state to pure browser clients.
//
//   node scripts/sand-server.mjs [port] [--cols N --rows N --seed N --room id]
//
// Exports startSandServer(opts) for tests and embedding.

import { WebSocketServer } from 'ws';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { decode, encode, MSG, makeAssign, makeReject, makeSnapshot } from '../src/sand/net/protocol.js';
import { Host } from '../src/sand/net/server/host.js';
import { encodeWorld, encodeDiff } from '../src/sand/net/server/worldEncode.js';
import { encodeItems, encodeCreatures, encodeProjectiles, encodeSounds, encodeInventory, encodeCursor, inventoryRevision } from '../src/sand/net/server/stateSync.js';
import { createFixedRateClock } from '../src/sand/timing/fixedRateClock.js';
import { syncWorldWindow } from '../src/sand/net/server/worldWindow.js';
import { canSendBufferLocalFrame } from '../src/sand/net/server/frameGate.js';

// Bootstrap size only. Connected clients report their survival viewport needs;
// the shared authority window then streams/resizes around the player group.
const DEFAULTS = { port: 5191, cols: 320, rows: 192, seed: 0xC0FFEE, room: 'main' };
const STEP_MS = 16;            // fixed sim step (matches the browser STEP_MS)
const SNAPSHOT_INTERVAL = 3;   // steps between player-snapshot broadcasts (~20Hz)
const ITEMS_INTERVAL = 6;      // steps between dropped-item broadcasts (~10Hz)
const MAX_PLAYERS = 8;
const MAX_BUFFERED_BYTES = 1 << 20;

export async function startSandServer(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  await initSandWasm();
  const engine = createEngineWasm({
    cols: cfg.cols, rows: cfg.rows, infinite: true, worldSeed: cfg.seed >>> 0,
    emittersOn: false, sinksOn: false,
  });
  engine.setSurvivalInventory(true); // arms new players and enables authoritative combat inventory
  engine.setCreatureRuntime(true, cfg.creatureNaturalSpawning !== false);
  engine.setPlayMode(true);
  const maxPlayers = cfg.maxPlayers ?? MAX_PLAYERS;
  const host = new Host({ engine, roomId: cfg.room, maxPlayers });

  const spawnFor = (i) => engine.getSurfaceSpawn(Math.floor(cfg.cols / 2) + ((i % 5) - 2) * 6);

  const peers = new Map(); // clientId -> { ws, pid, invRev, needsWorld }
  let joinCounter = 0;
  const writable = (ws) => ws.readyState === 1;
  const broadcastLatest = (data) => {
    for (const p of peers.values()) if (writable(p.ws) && p.ws.bufferedAmount <= MAX_BUFFERED_BYTES) p.ws.send(data);
  };
  const broadcastLocalFrame = (data) => {
    for (const p of peers.values()) {
      if (canSendBufferLocalFrame(p, MAX_BUFFERED_BYTES)) p.ws.send(data);
    }
  };
  const sendTo = (ws, data) => { if (ws.readyState === 1) ws.send(data); };

  const wss = new WebSocketServer({ port: cfg.port });
  wss.on('connection', (ws) => {
    let cid = null;
    const cleanup = () => { if (cid) { host.removeClient(cid); peers.delete(cid); cid = null; } };
    ws.on('message', (buf) => {
      const m = decode(buf.toString());
      if (!m) return; // drop malformed
      switch (m.t) {
        case MSG.JOIN: {
          if (cid) break; // already joined on this socket
          if (m.room !== cfg.room) { sendTo(ws, encode(makeReject(cfg.room, 'room'))); ws.close(); return; }
          if (peers.has(m.client)) { sendTo(ws, encode(makeReject(cfg.room, 'client'))); ws.close(); return; }
          if (!host.hasRoom()) { sendTo(ws, encode(makeReject(cfg.room, 'full'))); ws.close(); return; }
          const pid = host.addClient(m.client, spawnFor(joinCounter++));
          if (!pid) { sendTo(ws, encode(makeReject(cfg.room, 'full'))); ws.close(); return; }
          cid = m.client;
          peers.set(cid, { ws, pid, invRev: -1, invTick: -Infinity, needsWorld: false, view: null });
          // The joiner gets its authoritative id, the full world, and an initial
          // items/inventory/cursor fill so its HUD + scene are correct immediately.
          sendTo(ws, encode(makeAssign(cfg.room, cid, pid)));
          sendTo(ws, encode(encodeWorld(engine, host.worldTick)));
          sendTo(ws, encode(encodeItems(engine, host.actorTick)));
          sendTo(ws, encode(encodeCreatures(engine, host.actorTick)));
          sendTo(ws, encode(encodeProjectiles(engine, host.actorTick)));
          sendTo(ws, encode(encodeInventory(engine, host.actorTick, pid)));
          sendTo(ws, encode(encodeCursor(engine, host.actorTick, pid)));
          break;
        }
        case MSG.INPUT: host.receive(m, cid); break; // identity + movement/tool input are both authority-validated
        case MSG.VIEW: {
          const p = peers.get(cid);
          if (p && m.client === cid && m.room === cfg.room) p.view = {
            viewCols: m.viewCols, viewRows: m.viewRows,
            bufferCols: m.bufferCols, bufferRows: m.bufferRows,
          };
          break;
        }
        case MSG.RESYNC: {
          const p = peers.get(cid);
          if (p && m.client === cid && m.room === cfg.room) {
            if (ws.bufferedAmount <= MAX_BUFFERED_BYTES) { sendTo(ws, encode(encodeWorld(engine, host.worldTick))); p.needsWorld = false; }
            else p.needsWorld = true;
          }
          break;
        }
        case MSG.ACT_SELECT: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.setSelectedSlot(p.pid, m.slot); break; }
        case MSG.ACT_SIZE: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.setSelectedFootprint(p.pid, m.footprint); break; }
        case MSG.ACT_MOVE: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.inventoryMove(p.pid, m.from, m.to); break; }
        case MSG.ACT_PICK: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.inventoryCursorPick(p.pid, m.slot, m.half); break; }
        case MSG.ACT_THROW: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.throwFromCursor(p.pid, m.whole); break; }
        case MSG.ACT_CRAFT: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.craft(p.pid, m.recipe, m.max); break; }
        case MSG.ACT_RESPAWN: { const p = peers.get(cid); if (p && m.client === cid && m.room === cfg.room) engine.respawnPlayer(p.pid); break; }
        case MSG.LEAVE: if (m.client === cid && m.room === cfg.room) cleanup(); break;
        default: break;
      }
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  let sinceSnap = 0, sinceItems = 0, sinceCreatures = 0;
  function stepActorsOnce(now) {
    host.stepActors(now);
    const t = host.actorTick;
    if (peers.size > 0) {
      if (++sinceSnap >= SNAPSHOT_INTERVAL) { sinceSnap = 0; broadcastLocalFrame(encode(makeSnapshot(t, engine.getPlayers(), null))); }
      if (++sinceItems >= ITEMS_INTERVAL) { sinceItems = 0; broadcastLocalFrame(encode(encodeItems(engine, t))); }
      if (++sinceCreatures >= SNAPSHOT_INTERVAL) {
        sinceCreatures = 0;
        broadcastLocalFrame(encode(encodeCreatures(engine, t)));
        broadcastLocalFrame(encode(encodeProjectiles(engine, t)));
      }
      // Per-player inventory + cursor. Changes send immediately; a cheap 1 Hz
      // refresh recovers a one-shot packet lost while a large streamed-window
      // snapshot was in flight.
      for (const p of peers.values()) {
        const rev = inventoryRevision(engine, p.pid);
        if ((rev !== p.invRev || t - p.invTick >= 60) && p.ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
          p.invRev = rev; p.invTick = t;
          sendTo(p.ws, encode(encodeInventory(engine, t, p.pid)));
          sendTo(p.ws, encode(encodeCursor(engine, t, p.pid)));
        }
      }
    }
  }

  function stepWorldOnce() {
    const windowChanged = peers.size > 0 && syncWorldWindow(engine, peers);
    host.stepWorld();
    if (peers.size > 0) {
      // Actor edits and cellular changes accumulate in the same dirty set and
      // leave together after this single world phase.
      const d = windowChanged ? null : encodeDiff(engine, host.worldTick);
      let full = null;
      for (const p of peers.values()) {
        if (!writable(p.ws)) continue;
        if (windowChanged || p.needsWorld) {
          if (p.ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
            full ??= encode(encodeWorld(engine, host.worldTick));
            p.ws.send(full); p.needsWorld = false;
          } else p.needsWorld = true;
        } else if (d) {
          if (p.ws.bufferedAmount > MAX_BUFFERED_BYTES) p.needsWorld = true;
          else p.ws.send(encode(d));
        }
      }
      if (windowChanged) {
        broadcastLocalFrame(encode(makeSnapshot(host.actorTick, engine.getPlayers(), null)));
        broadcastLocalFrame(encode(encodeItems(engine, host.actorTick)));
        broadcastLocalFrame(encode(encodeCreatures(engine, host.actorTick)));
        broadcastLocalFrame(encode(encodeProjectiles(engine, host.actorTick)));
      }
      const sounds = encodeSounds(engine, host.actorTick);
      if (sounds) broadcastLatest(encode(sounds));
    } else {
      // Do not retain authority events forever when nobody is listening.
      engine.drainSoundEvents();
    }
    // The server never renders, so nothing else clears the per-step render-dirty
    // marks the diff reads — reset them here so the next diff is just that step.
    engine.resetDirty();
  }

  function stepOnce(now) {
    stepActorsOnce(now);
    stepWorldOnce();
  }

  // Actors repay small timing debt at 60 Hz; the expensive world is attempted
  // exactly once per turn. The next turn accounts for work time but never queues
  // missed world ticks.
  const actorClock = createFixedRateClock({ now: Date.now() });
  let timer = null;
  const runLoop = () => {
    const started = Date.now();
    actorClock.advance(started, () => stepActorsOnce(started));
    stepWorldOnce();
    const delay = Math.max(0, STEP_MS - (Date.now() - started));
    timer = setTimeout(runLoop, delay);
    timer.unref?.();
  };
  timer = setTimeout(runLoop, STEP_MS);
  timer.unref?.(); // don't keep the process alive purely for the loop in tests

  return {
    wss,
    engine,
    host,
    port: cfg.port,
    get cols() { return engine.cols; },
    get rows() { return engine.rows; },
    seed: cfg.seed >>> 0,
    peerCount: () => peers.size,
    step: stepOnce, // tests can drive the sim deterministically
    close: () => new Promise((resolve) => { clearTimeout(timer); wss.close(() => { try { engine.destroy(); } catch { /* already gone */ } resolve(); }); }),
  };
}

// ---- CLI entry ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opts = {};
  if (argv[0] && !argv[0].startsWith('--')) opts.port = Number(argv[0]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cols') opts.cols = Number(argv[++i]);
    else if (a === '--rows') opts.rows = Number(argv[++i]);
    else if (a === '--seed') opts.seed = Number(argv[++i]);
    else if (a === '--room') opts.room = String(argv[++i]);
    else if (a === '--port') opts.port = Number(argv[++i]);
  }
  startSandServer(opts).then((srv) => {
    console.log(`sand authoritative server on ws://0.0.0.0:${srv.port}`);
    console.log(`  world ${srv.cols}x${srv.rows}  seed 0x${srv.seed.toString(16)}  room "${opts.room ?? DEFAULTS.room}"`);
    console.log('  clients connect from the browser: Multiplayer panel -> host:port');
  }).catch((e) => { console.error('sand-server failed to start:', e); process.exit(1); });
}
