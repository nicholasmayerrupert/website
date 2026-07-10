// Authoritative headless multiplayer server for the sand game. Unlike the old
// relay (dev-multiplayer-server.mjs, where the first browser peer secretly ran
// the engine), THIS process IS the authority: it loads the WASM engine, runs the
// real fixed-step simulation, and serializes world + players + items + inventory
// + cursor down to every connected browser. Browsers are always pure clients —
// they connect by IP:port, send input + survival intents, and render what the
// server sends. The "host" is simply whoever runs this and also joins from a tab.
//
//   node scripts/sand-server.mjs [port] [--cols N --rows N --seed N --room id]
//
// Exports startSandServer(opts) so tests can spin one up in-process.

import { WebSocketServer } from 'ws';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { decode, encode, MSG, makeAssign, makeSnapshot } from '../src/sand/net/protocol.js';
import { Host } from '../src/sand/net/server/host.js';
import { encodeWorld, encodeDiff } from '../src/sand/net/server/worldEncode.js';
import { encodeItems, encodeInventory, encodeCursor, inventoryRevision } from '../src/sand/net/server/stateSync.js';
import { createFixedRateClock } from '../src/sand/timing/fixedRateClock.js';

// Bounded shared arena (MVP): a fixed, non-streaming world buffer. Multiples of
// the 32-cell render chunk; ~61k cells stays well under the engine's cell budget.
const DEFAULTS = { port: 5191, cols: 320, rows: 192, seed: 0xC0FFEE, room: 'main' };
const STEP_MS = 16;            // fixed sim step (matches the browser STEP_MS)
const SNAPSHOT_INTERVAL = 3;   // steps between player-snapshot broadcasts (~20Hz)
const ITEMS_INTERVAL = 6;      // steps between dropped-item broadcasts (~10Hz)
const MAX_PLAYERS = 8;

export async function startSandServer(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  await initSandWasm();
  const engine = createEngineWasm({
    cols: cfg.cols, rows: cfg.rows, infinite: true, worldSeed: cfg.seed >>> 0,
    emittersOn: false, sinksOn: false,
  });
  engine.setSurvivalInventory(true); // mining -> drops -> inventory; spawnPlayer seeds the starter kit
  engine.setPlayMode(true);
  const host = new Host({ engine, roomId: cfg.room, maxPlayers: MAX_PLAYERS });

  const spawnFor = (i) => engine.getSurfaceSpawn(Math.floor(cfg.cols / 2) + ((i % 5) - 2) * 6);

  const peers = new Map(); // clientId -> { ws, pid, invRev }
  let joinCounter = 0;
  const broadcast = (data) => { for (const p of peers.values()) if (p.ws.readyState === 1) p.ws.send(data); };
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
          if (peers.size >= MAX_PLAYERS) { sendTo(ws, encode({ t: 'full', room: cfg.room })); ws.close(); return; }
          cid = m.client;
          const pid = host.addClient(cid, spawnFor(joinCounter++));
          if (!pid) { ws.close(); cid = null; return; }
          peers.set(cid, { ws, pid, invRev: -1 });
          // The joiner gets its authoritative id, the full world, and an initial
          // items/inventory/cursor fill so its HUD + scene are correct immediately.
          sendTo(ws, encode(makeAssign(cfg.room, cid, pid)));
          sendTo(ws, encode(encodeWorld(engine, host.worldTick)));
          sendTo(ws, encode(encodeItems(engine, host.actorTick)));
          sendTo(ws, encode(encodeInventory(engine, host.actorTick, pid)));
          sendTo(ws, encode(encodeCursor(engine, host.actorTick, pid)));
          break;
        }
        case MSG.INPUT: host.receive(m); break; // movement + place/mine (rate-limited, validated)
        case MSG.RESYNC: sendTo(ws, encode(encodeWorld(engine, host.worldTick))); break;
        case MSG.ACT_SELECT: { const p = host.playerIdFor(cid); if (p) engine.setSelectedSlot(p, m.slot); break; }
        case MSG.ACT_SIZE: { const p = host.playerIdFor(cid); if (p) engine.setSelectedFootprint(p, m.footprint); break; }
        case MSG.ACT_MOVE: { const p = host.playerIdFor(cid); if (p) engine.inventoryMove(p, m.from, m.to); break; }
        case MSG.ACT_PICK: { const p = host.playerIdFor(cid); if (p) engine.inventoryCursorPick(p, m.slot, m.half); break; }
        case MSG.ACT_THROW: { const p = host.playerIdFor(cid); if (p) engine.throwFromCursor(p, m.whole); break; }
        case MSG.LEAVE: cleanup(); break;
        default: break;
      }
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  let sinceSnap = 0, sinceItems = 0;
  function stepActorsOnce(now) {
    host.stepActors(now);
    const t = host.actorTick;
    if (peers.size > 0) {
      if (++sinceSnap >= SNAPSHOT_INTERVAL) { sinceSnap = 0; broadcast(encode(makeSnapshot(t, engine.getPlayers(), null))); }
      if (++sinceItems >= ITEMS_INTERVAL) { sinceItems = 0; broadcast(encode(encodeItems(engine, t))); }
      // Per-player inventory + cursor, only when that player's inventory changed
      // (idle players cost zero inventory bandwidth).
      for (const p of peers.values()) {
        const rev = inventoryRevision(engine, p.pid);
        if (rev !== p.invRev) {
          p.invRev = rev;
          sendTo(p.ws, encode(encodeInventory(engine, t, p.pid)));
          sendTo(p.ws, encode(encodeCursor(engine, t, p.pid)));
        }
      }
    }
  }

  function stepWorldOnce() {
    host.stepWorld();
    if (peers.size > 0) {
      // Actor edits and cellular changes accumulate in the same dirty set and
      // leave together after this single world phase.
      const d = encodeDiff(engine, host.worldTick);
      if (d) broadcast(encode(d));
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
    cols: cfg.cols,
    rows: cfg.rows,
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
