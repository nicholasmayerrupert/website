// Multiplayer protocol, sequencing, authority, and prediction tests. All run in
// Node with no real network. Run with:
//   node scripts/net-test.mjs

import {
  MSG, encode, decode, makeJoin, makeLeave, makeInput, makeSnapshot,
  makeAssign, makeReject, makeWorld, makeDiff, makeView, makeSounds, makeCursor, INPUT_BITS_MAX, TOOL_MAX,
} from '../src/sand/net/protocol.js';
import { SequenceTracker, InputSequencer, applyInputStream } from '../src/sand/net/server/sequencing.js';
import { Host } from '../src/sand/net/server/host.js';
import { encodeWorld, encodeDiff } from '../src/sand/net/server/worldEncode.js';
import { applyWorldMessage, applyDiffMessage, bytesToB64 } from '../src/sand/net/worldSync.js';
import { Predictor } from '../src/sand/net/predict.js';
import { createGameNet } from '../src/sand/net/gameNet.js';
import { ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { startServer } from './dev-multiplayer-server.mjs';
import { approxEqual } from './sand-test-util.mjs';
import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { gridHash } from './sand-test-util.mjs';
import { WebSocket } from 'ws';

const COLS = 200, ROWS = 120;
const stoneFloor = (e) => { for (let x = 20; x < 180; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0); e.finalizeStoneDraft(); };

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const rt = (m) => decode(encode(m)); // round trip through the wire format

// Connection setup is transactional: a socket failure rejects and leaves no
// public client state behind.
{
  console.log('failed connection rollback');
  const RealWebSocket = globalThis.WebSocket;
  class FailingWebSocket {
    constructor() { this.readyState = 0; queueMicrotask(() => this.onerror?.(new Error('refused'))); }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  }
  globalThis.WebSocket = FailingWebSocket;
  const net = createGameNet({ getEngine: () => null, getLocalInput: () => ({ bits: 0, aimX: 0, aimY: 0, tool: 0 }), rebuildEngine: () => null });
  let rejected = false;
  try { await net.joinRoom('ws://localhost:1', 'main'); } catch { rejected = true; }
  check('joinRoom rejects', rejected);
  check('failed join is disconnected', !net.connected);
  check('failed join clears client role', net.role === null);
  check('failed join clears world readiness', !net.worldReady);
  check('failed join clears remotes', net.remoteCount === 0);
  check(`failed join status is not joined (${net.status})`, !net.status.startsWith('joined '));
  globalThis.WebSocket = RealWebSocket;
}

{
  console.log('structured join rejection');
  const RealWebSocket = globalThis.WebSocket;
  class RejectingWebSocket {
    constructor() { this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw) {
      const m = decode(raw);
      if (m?.t === MSG.JOIN) queueMicrotask(() => this.onmessage?.({ data: encode(makeReject(m.room, 'full')) }));
    }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  }
  globalThis.WebSocket = RejectingWebSocket;
  const net = createGameNet({ getEngine: () => null, getLocalInput: () => ({ bits: 0, aimX: 0, aimY: 0, tool: 0 }), rebuildEngine: () => null });
  try { await net.joinRoom('ws://test', 'main'); } catch { /* expected */ }
  await Promise.resolve();
  check('structured rejection reason survives socket close', net.status === 'rejected: full');
  globalThis.WebSocket = RealWebSocket;
}

// A join resolves only after ASSIGN + a validated mirror WORLD, even while the
// presentation loop is paused. Paused diffs stay bounded and trigger one resync.
{
  console.log('client join handshake + paused queue');
  const RealWebSocket = globalThis.WebSocket;
  let socket;
  const worldBytes = Uint8Array.from([4, 0, 0, 0, 0, 4, 0, 0, 0, 0]);
  const engine = {
    cols: 2, rows: 2, mirrorApplies: 0, mirrorTick: -1,
    applyWorldMirror() { this.mirrorApplies++; },
    applyDiffMirror() {},
    setMirrorWorldTick(t) { this.mirrorTick = t; },
    gridHash() { return 123; },
    resetDirty() {},
  };
  class HandshakeWebSocket {
    constructor() { socket = this; this.readyState = 0; this.sent = []; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw) {
      this.sent.push(raw);
      const m = decode(raw);
      if (m?.t === MSG.JOIN) queueMicrotask(() => {
        this.onmessage?.({ data: encode(makeAssign(m.room, m.client, 7)) });
        this.onmessage?.({ data: encode(makeWorld(3, 2, 2, 123, bytesToB64(worldBytes))) });
      });
    }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  }
  globalThis.WebSocket = HandshakeWebSocket;
  const net = createGameNet({
    getEngine: () => engine,
    getLocalInput: () => ({ bits: 0, aimX: 0, aimY: 0, tool: 0 }),
    rebuildEngine: () => engine,
  });
  await net.joinRoom('ws://test', 'main');
  check('join waits for authoritative assignment', net.ownPlayerId === 7);
  check('join applies initial world through mirror API', net.worldReady && engine.mirrorApplies === 1 && engine.mirrorTick === 3);
  net.setPaused(true);
  for (let i = 0; i < 200; i++) socket.onmessage({ data: encode(makeDiff(4 + i, 123, 'AAAAAA==')) });
  net.setPaused(false);
  check('paused diff backlog requests one full resync', socket.sent.map(decode).filter((m) => m?.t === MSG.RESYNC).length === 1);
  socket.onmessage({ data: encode(makeCursor(5, 7, { material: 1, isTool: false, toolClass: 0, toolTier: 0, count: 2, plantType: 0, itemKind: 0 })) });
  for (let i = 0; i < 200; i++) socket.onmessage({ data: encode(makeSounds(6 + i, [])) });
  net.update();
  check('inbound pressure preserves change-triggered cursor state', net.getOwnCursor()?.count === 2);
  net.disconnect();
  globalThis.WebSocket = RealWebSocket;
}

// 1. input message round trip.
{
  console.log('input round trip');
  const m = makeInput({ room: 'r1', client: 7, player: 3, tick: 42, seq: 5, bits: INPUT.RIGHT | INPUT.JUMP | INPUT.JETPACK, aimX: 120, aimY: -8, tool: 6 });
  const d = rt(m);
  check('decodes to input', d && d.t === MSG.INPUT);
  check('fields preserved', d && d.room === 'r1' && d.client === 7 && d.player === 3 && d.tick === 42 && d.seq === 5 && d.bits === (INPUT.RIGHT | INPUT.JUMP | INPUT.JETPACK) && d.aimX === 120 && d.aimY === -8 && d.tool === 6);
  const analog = rt(makeInput({ room: 'r1', client: 7, player: 3, tick: 43, seq: 6, bits: INPUT.RIGHT, aimX: 0, aimY: 0, tool: 0, moveX: 0.3, moveY: -0.4 }));
  check('analog vector preserved', analog && analog.moveX === 0.3 && analog.moveY === -0.4);
}

// 2. snapshot round trip.
{
  console.log('snapshot round trip');
  const players = [
    { id: 1, x: 10.5, y: 20.25, vx: -1.5, vy: 0.75, facing: -1, grounded: true, tool: 2, health: 100, alive: true, inputSeq: 9, animState: 2, animFrame: 3, heldItemKind: ITEM_KIND.BLAST_GUN, jetpackFuel: 0.625, jetpackActive: true, aimX: -12.5, aimY: 44.75 },
    { id: 2, x: 33, y: 5, vx: 0, vy: 0, facing: 1, grounded: false, tool: 0, health: 80, alive: true, inputSeq: 0, animState: 0, animFrame: 1, aimX: 37, aimY: 8 },
  ];
  const d = rt(makeSnapshot(123, players, 0xdeadbeef));
  check('decodes to snapshot', d && d.t === MSG.SNAPSHOT && d.tick === 123);
  check('hash preserved', d && d.hash === 0xdeadbeef);
  check('two players, positions intact', d && d.players.length === 2 && d.players[0].x === 10.5 && d.players[0].y === 20.25 && d.players[1].id === 2);
  check('grounded normalized to 0/1', d && d.players[0].grounded === 1 && d.players[1].grounded === 0);
  check('animation state preserved', d && d.players[0].animState === 2 && d.players[0].animFrame === 3 && d.players[1].animFrame === 1);
  check('alive state preserved', d && d.players[0].alive === 1 && d.players[1].alive === 1);
  check('held item kind preserved', d && d.players[0].heldItemKind === ITEM_KIND.BLAST_GUN);
  check('jetpack state preserved', d && d.players[0].jetpackFuel === 0.625 && d.players[0].jetpackActive === 1
    && d.players[1].jetpackFuel === 1 && d.players[1].jetpackActive === 0);
  check('player aim preserved', d && d.players[0].aimX === -12.5 && d.players[0].aimY === 44.75
    && d.players[1].aimX === 37 && d.players[1].aimY === 8);
}

// 3. join/leave round trip.
{
  console.log('control messages');
  check('join', rt(makeJoin('room', 4, 'Nick')).t === MSG.JOIN);
  check('leave', rt(makeLeave('room', 4)).t === MSG.LEAVE);
  const view = rt(makeView('room', 4, 120, 72, 384, 256));
  check('survival viewport', view?.t === MSG.VIEW && view.bufferCols === 384 && view.bufferRows === 256);
}

// 4. malformed messages are rejected.
{
  console.log('reject malformed');
  check('bad json', decode('{not json') === null);
  check('missing type', decode('{}') === null);
  check('unknown type', decode(JSON.stringify({ t: 'frobnicate' })) === null);
  check('input bits out of range', decode(JSON.stringify({ t: 'input', room: 'r', client: 1, player: 0, tick: 0, seq: 0, bits: INPUT_BITS_MAX + 1, aimX: 0, aimY: 0, tool: 0 })) === null);
  check('input tool out of range', decode(JSON.stringify({ t: 'input', room: 'r', client: 1, player: 0, tick: 0, seq: 0, bits: 0, aimX: 0, aimY: 0, tool: TOOL_MAX + 1 })) === null);
  check('input non-int aim', decode(JSON.stringify({ t: 'input', room: 'r', client: 1, player: 0, tick: 0, seq: 0, bits: 0, aimX: 1.5, aimY: 0, tool: 0 })) === null);
  check('input rejects incomplete analog vector', decode(JSON.stringify({ t: 'input', room: 'r', client: 1, player: 0, tick: 0, seq: 0, bits: 0, aimX: 0, aimY: 0, tool: 0, moveX: 0.5 })) === null);
  check('input rejects oversized analog vector', decode(JSON.stringify({ t: 'input', room: 'r', client: 1, player: 0, tick: 0, seq: 0, bits: 0, aimX: 0, aimY: 0, tool: 0, moveX: 1, moveY: 1 })) === null);
  check('snapshot bad player', decode(JSON.stringify({ t: 'snapshot', tick: 1, hash: null, players: [{ id: -1 }] })) === null);
  const validPlayer = { id: 1, x: 0, y: 0, facing: 1, grounded: false, tool: 0, health: 100, alive: true, animState: 0, animFrame: 0, aimX: 12, aimY: -4 };
  const missingAnim = makeSnapshot(1, [validPlayer]);
  delete missingAnim.players[0].animState;
  check('snapshot missing anim rejected', decode(JSON.stringify(missingAnim)) === null);
  const badHeldItem = makeSnapshot(1, [validPlayer]);
  badHeldItem.players[0].heldItemKind = Math.max(...Object.values(ITEM_KIND)) + 1;
  check('snapshot unknown held item rejected', decode(JSON.stringify(badHeldItem)) === null);
  const missingAim = makeSnapshot(1, [validPlayer]);
  delete missingAim.players[0].aimX;
  check('snapshot missing aim rejected', decode(JSON.stringify(missingAim)) === null);
  const nonFiniteAim = makeSnapshot(1, [validPlayer]);
  nonFiniteAim.players[0].aimY = Number.POSITIVE_INFINITY;
  check('snapshot non-finite aim rejected', decode(JSON.stringify(nonFiniteAim)) === null);
  const badFuel = makeSnapshot(1, [validPlayer]);
  badFuel.players[0].jetpackFuel = 1.01;
  check('snapshot over-full jetpack rejected', decode(JSON.stringify(badFuel)) === null);
  const badJetpackActive = makeSnapshot(1, [validPlayer]);
  badJetpackActive.players[0].jetpackActive = 2;
  check('snapshot non-bit jetpack activity rejected', decode(JSON.stringify(badJetpackActive)) === null);
  check('snapshot non-array players', decode(JSON.stringify({ t: 'snapshot', tick: 1, hash: null, players: 5 })) === null);
  check('viewport cannot exceed its buffer', rt(makeView('r', 'c', 200, 100, 100, 100)) === null);
  check('viewport buffer cell cap enforced', rt(makeView('r', 'c', 100, 100, 4000, 4000)) === null);
}

// 5. integer fields preserved exactly across large values.
{
  console.log('integer exactness');
  const bigTick = 2 ** 31 + 12345, bigSeq = 2 ** 31 - 1;
  const d = rt(makeInput({ room: 'r', client: 'abc', player: 0, tick: bigTick, seq: bigSeq, bits: 0, aimX: -99999, aimY: 99999, tool: 0 }));
  check(`tick exact (${d.tick})`, d.tick === bigTick);
  check(`seq exact (${d.seq})`, d.seq === bigSeq);
  check('negative aim exact', d.aimX === -99999 && d.aimY === 99999);
  check('string client id allowed', d.client === 'abc');
}

// 6. reorder / loss / duplicate harness via SequenceTracker.
{
  console.log('reorder / loss harness');
  const tr = new SequenceTracker();
  check('accepts 0', tr.accept(0));
  check('rejects duplicate 0', !tr.accept(0));
  check('accepts 1', tr.accept(1));
  check('rejects reordered-late 0', !tr.accept(0));
  check('accepts jump to 5 (loss tolerated)', tr.accept(5));
  check('rejects late 3', !tr.accept(3));

  // a shuffled, duplicated, lossy stream is reduced to a strictly-increasing set
  const seqs = [0, 2, 1, 2, 4, 3, 5, 5, 7, 6];
  const seq = new InputSequencer(); // not used for numbering here; build messages directly
  const msgs = seqs.map((s) => encode(makeInput({ room: 'r', client: 1, player: 1, tick: s, seq: s, bits: 0, aimX: 0, aimY: 0, tool: 0 })));
  const accepted = applyInputStream(msgs).map((m) => m.seq);
  check(`accepted strictly increasing (${accepted.join(',')})`, JSON.stringify(accepted) === JSON.stringify([0, 2, 4, 5, 7]));
  void seq;
}

// 7. deterministic two-engine replay: same seed + same ordered input stream
//    (round-tripped through the protocol) -> identical final player state + grid.
{
  console.log('deterministic replay');
  await initSandWasm();
  for (const [cols, rows] of [[0, 10], [10.5, 10], [16385, 1], [10, Number.NaN]]) {
    let rejected = false;
    try { createEngineWasm({ cols, rows, sinksOn: false }); } catch (e) { rejected = e instanceof RangeError; }
    check(`unsafe engine dimensions rejected (${cols}x${rows})`, rejected);
  }
  const COLS = 200, ROWS = 120, SEED = 0xABCDEF;
  const stoneFloor = (e) => { for (let x = 20; x < 180; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0); e.finalizeStoneDraft(); };
  // a fixed input program, encoded as protocol messages
  const program = [];
  for (let i = 0; i < 180; i++) {
    let bits = 0;
    if (i < 90) bits |= INPUT.RIGHT; else bits |= INPUT.LEFT;
    if (i % 30 === 0) bits |= INPUT.JUMP;
    program.push(encode(makeInput({ room: 'r', client: 1, player: 0, tick: i, seq: i, bits, aimX: 0, aimY: 0, tool: 0 })));
  }
  const replay = () => {
    const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false });
    stoneFloor(e);
    const id = e.spawnPlayer(100, 80);
    for (let i = 0; i < program.length; i++) {
      const m = decode(program[i]);
      e.setPlayerInput(id, { bits: m.bits, aimX: m.aimX, aimY: m.aimY, tool: m.tool, seq: m.seq });
      e.step(16 * i);
    }
    const p = e.getPlayer(id);
    const h = gridHash(e.getGrid());
    e.destroy();
    return { p, h };
  };
  const a = replay(), b = replay();
  check(`final player x identical (${a.p.x.toFixed(4)})`, a.p.x === b.p.x);
  check(`final player y identical (${a.p.y.toFixed(4)})`, a.p.y === b.p.y);
  check('final velocities identical', a.p.vx === b.p.vx && a.p.vy === b.p.vy);
  check(`grid hash identical (${a.h.toString(16)})`, a.h === b.h);
}

// 8. host-authoritative core (in-process, no socket): remote input moves the
//    right player; snapshots carry state + lastProcessedSeq; dup/late/unknown
//    inputs are dropped; leave removes the player.
{
  console.log('host-authoritative (in-process)');
  const engine = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xC0FFEE, sinksOn: false });
  stoneFloor(engine);
  const host = new Host({ engine, roomId: 'r', inputBurst: 1000 }); // not testing rate-limit here
  const pA = host.addClient('A', { x: 80, y: 80 });
  const pB = host.addClient('B', { x: 120, y: 80 });
  check('two clients -> two players', pA && pB && pA !== pB && engine.playerCount() === 2);
  for (let i = 0; i < 30; i++) host.step(); // settle on floor

  const seqA = new InputSequencer();
  const x0 = engine.getPlayer(pA).x;
  for (let i = 0; i < 60; i++) {
    host.receive(encode(seqA.next({ room: 'r', client: 'A', player: pA, tick: i, bits: INPUT.RIGHT, aimX: 73, aimY: 41, tool: 0 })));
    host.step();
  }
  check(`remote input moved client A's player (${x0.toFixed(1)} -> ${engine.getPlayer(pA).x.toFixed(1)})`, engine.getPlayer(pA).x > x0 + 4);
  check('client B player unaffected (no input)', Math.abs(engine.getPlayer(pB).x - 120) < 6);

  const snap = host.snapshot({ withHash: true });
  const snapA = snap.players.find((p) => p.id === pA);
  check('snapshot carries both players', snap.players.length === 2 && !!snapA);
  check(`snapshot lastProcessedSeq advanced (${snapA.seq})`, snapA.seq >= 59);
  check('snapshot carries authoritative player aim', snapA.aimX === 73 && snapA.aimY === 41);
  check('snapshot has world hash', typeof snap.hash === 'number');

  check('duplicate/old seq dropped', host.receive(encode(makeInput({ room: 'r', client: 'A', player: pA, tick: 0, seq: 5, bits: INPUT.LEFT, aimX: 0, aimY: 0, tool: 0 }))) === null);
  check('unknown client dropped', host.receive(encode(makeInput({ room: 'r', client: 'Z', player: 1, tick: 0, seq: 99999, bits: 0, aimX: 0, aimY: 0, tool: 0 }))) === null);

  host.receive(encode(makeLeave('r', 'B')));
  check('leave removes the player', engine.playerCount() === 1);
  engine.destroy();
}

// 9. live WebSocket relay: two peers join a room; client input reaches the host
//    peer, host snapshot reaches the client, disconnect produces a leave.
{
  console.log('websocket relay (live)');
  const PORT = 5193;
  const srv = startServer(PORT);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${PORT}`); ws.onopen = () => res(ws); ws.onerror = () => rej(new Error('ws connect failed')); });
  const inboxOf = (ws) => { const q = []; ws.onmessage = (ev) => { const m = decode(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m) q.push(m); }; return q; };
  try {
    const hostWs = await open();
    const clientWs = await open();
    const hostIn = inboxOf(hostWs), clientIn = inboxOf(clientWs);

    hostWs.send(encode(makeJoin('room1', 'host')));
    await wait(40);
    clientWs.send(encode(makeJoin('room1', 'c1')));
    await wait(40);
    check('host notified of client join', hostIn.some((m) => m.t === MSG.JOIN && m.client === 'c1'));

    clientWs.send(encode(makeInput({ room: 'room1', client: 'c1', player: 1, tick: 0, seq: 0, bits: INPUT.RIGHT, aimX: 0, aimY: 0, tool: 0 })));
    await wait(40);
    check('client input relayed to host', hostIn.some((m) => m.t === MSG.INPUT && m.client === 'c1'));

    hostWs.send(encode(makeSnapshot(5, [{ id: 1, x: 10, y: 20, vx: 0, vy: 0, facing: 1, grounded: true, tool: 0, health: 100, inputSeq: 0, aimX: 35, aimY: 12 }])));
    await wait(40);
    check('host snapshot relayed to client', clientIn.some((m) => m.t === MSG.SNAPSHOT && m.tick === 5));

    clientWs.close();
    await wait(80);
    check('client disconnect produces leave', hostIn.some((m) => m.t === MSG.LEAVE && m.client === 'c1'));
    hostWs.close();
  } catch (err) {
    check(`relay error: ${err.message}`, false);
  } finally {
    await srv.close();
  }
}

// 10. world replication: full snapshot + incremental diffs keep a client grid in
//     sync with the host; a lost diff is detected by hash and fixed by resync.
{
  console.log('world replication');
  const mkEngine = (seed) => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: seed, sinksOn: false });
  const host = mkEngine(0x1234);
  const client = mkEngine(0x9999); // different seed -> different initial terrain
  // some host edits (stone is static, so client doesn't need to simulate)
  for (let x = 30; x < 60; x++) for (let y = 80; y < 90; y++) host.addDiscToStoneDraft(x, y, 0);
  host.finalizeStoneDraft();

  // full snapshot makes the client match exactly, despite a different seed.
  check('grids differ before sync', host.gridHash() !== client.gridHash());
  const w = decode(encode(encodeWorld(host, 0)));
  const okW = applyWorldMessage(client, w);
  check(`full snapshot syncs client (host ${host.gridHash().toString(16)})`, okW && host.gridHash() === client.gridHash());
  const mirror = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x7777, sinksOn: false, storageRole: 'presentation' });
  check('presentation mirror accepts the authoritative world', applyWorldMessage(mirror, w, { mirror: true }) && mirror.gridHash() === host.gridHash());
  check('full snapshot carries the authority window offset', mirror.getWorldOffsetX() === host.getWorldOffsetX() && mirror.getWorldOffsetY() === host.getWorldOffsetY());
  const truncated = { ...w, data: w.data.slice(0, -4) };
  const beforeBad = mirror.gridHash();
  check('truncated world is rejected without mutating the mirror', !applyWorldMessage(mirror, truncated, { mirror: true }) && mirror.gridHash() === beforeBad);
  host.resetDirty();

  // a sequence of incremental diffs reconstructs the host hash on the client.
  for (let i = 0; i < 4; i++) {
    host.paintDisc(100 + i * 8, 40, 3, 1, true); // paint sand blobs in fresh regions
    const d = decode(encode(encodeDiff(host, i + 1)));
    host.resetDirty();
    const ok = applyDiffMessage(client, d);
    check(`diff ${i} applied, hashes match`, ok && host.gridHash() === client.gridHash());
    check(`mirror diff ${i} applied without component reconstruction`, applyDiffMessage(mirror, d, { mirror: true }) && host.gridHash() === mirror.gridHash());
  }

  // lost diff -> divergence detected -> resync restores the match.
  host.paintDisc(150, 60, 3, 4, true); host.resetDirty(); // edit whose diff is LOST (never sent)
  host.paintDisc(40, 30, 3, 6, true);
  const dLate = decode(encode(encodeDiff(host, 99)));
  host.resetDirty();
  const okLate = applyDiffMessage(client, dLate); // applies the late edit but misses the lost one
  check('lost diff detected by hash mismatch', okLate === false && client.gridHash() !== host.gridHash());
  applyWorldMessage(client, decode(encode(encodeWorld(host, 100)))); // resync
  check('resync restores the match', client.gridHash() === host.gridHash());

  host.destroy(); client.destroy(); mirror.destroy();
}

// 11. join-in-progress: a client joining mid-session gets the host's CURRENT world.
{
  console.log('join-in-progress');
  const host = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x5151, sinksOn: false });
  for (let x = 70; x < 110; x++) for (let y = 70; y < ROWS; y++) host.addDiscToStoneDraft(x, y, 0);
  host.finalizeStoneDraft();
  host.paintDisc(90, 60, 5, 2, true); // some water
  const latecomer = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xEEEE, sinksOn: false });
  applyWorldMessage(latecomer, decode(encode(encodeWorld(host, 7))));
  check('join-in-progress client matches host world', latecomer.gridHash() === host.gridHash());
  host.destroy(); latecomer.destroy();
}

// 12. Client prediction and reconciliation. Player physics is
//     deterministic, so prediction is exact and corrections converge in one step.
{
  console.log('prediction / reconciliation');
  // identical flat-floor engines (player only interacts with the painted floor).
  const makePlayerEngine = () => {
    const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x2222, sinksOn: false });
    for (let x = 20; x < 180; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
    e.finalizeStoneDraft();
    return e;
  };
  const authState = (e, id) => { const p = e.getPlayer(id); return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, grounded: p.grounded, jumpReady: p.jumpReady }; };
  // a deterministic input program
  const program = [];
  for (let i = 0; i < 120; i++) { let b = i < 60 ? INPUT.RIGHT : INPUT.LEFT; if (i % 20 === 0) b |= INPUT.JUMP; program.push(b); }

  // 12a. zero-latency prediction matches the host exactly (stepPlayerOnly vs step).
  {
    const host = makePlayerEngine(); const hid = host.spawnPlayer(100, 80);
    const client = makePlayerEngine(); const cid = client.spawnPlayer(100, 80);
    const pred = new Predictor(client, cid);
    for (let i = 0; i < program.length; i++) {
      host.setPlayerInput(hid, { bits: program[i], seq: i }); host.step(16 * i);
      pred.predict(i, { bits: program[i] });
    }
    const hp = host.getPlayer(hid), cp = pred.state();
    check(`zero-latency prediction matches host (${cp.x.toFixed(2)} == ${hp.x.toFixed(2)})`, cp.x === hp.x && cp.y === hp.y && cp.vx === hp.vx);
    host.destroy(); client.destroy();
  }

  // 12b. with ~100ms (6-frame) latency the predicted position stays within
  //      tolerance of where the host eventually is for the same input.
  {
    const LAG = 6;
    const host = makePlayerEngine(); const hid = host.spawnPlayer(100, 80);
    const states = [];
    for (let i = 0; i < program.length; i++) { host.setPlayerInput(hid, { bits: program[i], seq: i }); host.step(16 * i); states.push(authState(host, hid)); }
    const client = makePlayerEngine(); const cid = client.spawnPlayer(100, 80);
    const pred = new Predictor(client, cid);
    let maxErr = 0;
    for (let i = 0; i < program.length; i++) {
      pred.predict(i, { bits: program[i] });
      const ackSeq = i - LAG; // the host's correction arrives LAG frames late
      if (ackSeq >= 0) {
        const cur = pred.state();
        pred.reconcile(states[ackSeq], ackSeq);
        maxErr = Math.max(maxErr, Math.hypot(cur.x - pred.state().x, cur.y - pred.state().y));
      }
    }
    const cp = pred.state(), hp = states[states.length - 1];
    check(`100ms-latency prediction within tolerance (maxErr ${maxErr.toFixed(3)})`, maxErr < 0.001);
    // Tolerance is float32-snapshot scale, not 1e-6: reconciliation snaps to the
    // authoritative state read back through the float32 player snapshot (real netcode),
    // so the final can differ from the host's float64 trajectory by up to ~1 float32 ULP
    // (~1e-5 at these magnitudes). A real prediction bug diverges by whole cells, not micro-units.
    check('predicted final matches host authoritative', approxEqual(cp.x, hp.x, 1e-4) && approxEqual(cp.y, hp.y, 1e-4));
    host.destroy(); client.destroy();
  }

  // 12c. a correction after an artificial mismatch converges in one reconcile.
  {
    const host = makePlayerEngine(); const hid = host.spawnPlayer(100, 80);
    const client = makePlayerEngine(); const cid = client.spawnPlayer(100, 80);
    const pred = new Predictor(client, cid);
    for (let i = 0; i < 40; i++) { host.setPlayerInput(hid, { bits: program[i], seq: i }); host.step(16 * i); pred.predict(i, { bits: program[i] }); }
    // corrupt the client's predicted state (simulate divergence)
    client.setPlayerState(cid, { x: 5, y: 5, vx: 0, vy: 0, facing: 1, grounded: false });
    check('client diverged', pred.state().x !== host.getPlayer(hid).x);
    pred.reconcile(authState(host, hid), 39); // all inputs acked -> snap to truth
    check('correction converges to host', pred.state().x === host.getPlayer(hid).x && pred.state().y === host.getPlayer(hid).y);
    host.destroy(); client.destroy();
  }

  // 12d. a reordered (older) correction is ignored, not applied over newer state.
  {
    const client = makePlayerEngine(); const cid = client.spawnPlayer(100, 80);
    const pred = new Predictor(client, cid);
    for (let i = 0; i < 20; i++) pred.predict(i, { bits: INPUT.RIGHT });
    pred.reconcile({ x: 120, y: 82, vx: 0, vy: 0, facing: 1, grounded: true }, 15);
    const afterNew = pred.state().x;
    pred.reconcile({ x: 40, y: 82, vx: 0, vy: 0, facing: 1, grounded: true }, 8); // older -> ignore
    check(`reordered correction ignored (${pred.state().x.toFixed(2)} == ${afterNew.toFixed(2)})`, pred.state().x === afterNew);
    client.destroy();
  }

  // 12e. a lost correction is recovered by the next one (snap-to-authority).
  {
    const host = makePlayerEngine(); const hid = host.spawnPlayer(100, 80);
    const states = [];
    for (let i = 0; i < 60; i++) { host.setPlayerInput(hid, { bits: program[i], seq: i }); host.step(16 * i); states.push(authState(host, hid)); }
    const client = makePlayerEngine(); const cid = client.spawnPlayer(100, 80);
    const pred = new Predictor(client, cid);
    for (let i = 0; i < 60; i++) pred.predict(i, { bits: program[i] });
    // corrupt, then "lose" the ack@30 and only deliver ack@59 -> must still recover
    client.setPlayerState(cid, { x: 7, y: 7, vx: 9, vy: 9, facing: -1, grounded: false });
    pred.reconcile(states[59], 59);
    check('lost correction recovered by next snapshot', approxEqual(pred.state().x, states[59].x, 1e-6) && approxEqual(pred.state().y, states[59].y, 1e-6));
    host.destroy(); client.destroy();
  }
}

// 13. Host hardening: room cap, field validation, aim clamp, rate limit.
{
  console.log('hardening');
  const mkE = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x3333, sinksOn: false });

  // room cap: only maxPlayers admitted, the rest rejected.
  {
    const e = mkE();
    const host = new Host({ engine: e, roomId: 'r', maxPlayers: 3 });
    let admitted = 0;
    for (let i = 0; i < 6; i++) if (host.addClient('c' + i, { x: 50, y: 50 }) !== null) admitted++;
    check(`room cap enforced (${admitted} of 6 admitted)`, admitted === 3 && e.playerCount() === 3);
    e.destroy();
  }

  // invalid fields are dropped (defense in depth, even past protocol decode).
  {
    const e = mkE();
    const host = new Host({ engine: e, roomId: 'r' });
    const pid = host.addClient('A', { x: 50, y: 50 });
    check('bad tool dropped', host.applyInput({ room: 'r', client: 'A', player: pid, seq: 1, bits: 0, aimX: 0, aimY: 0, tool: 99 }) === false);
    check('bad bits dropped', host.applyInput({ room: 'r', client: 'A', player: pid, seq: 2, bits: 99999, aimX: 0, aimY: 0, tool: 0 }) === false);
    check('NaN aim dropped', host.applyInput({ room: 'r', client: 'A', player: pid, seq: 3, bits: 0, aimX: NaN, aimY: 0, tool: 0 }) === false);
    check('wrong player high sequence is rejected', host.applyInput({ room: 'r', client: 'A', player: pid + 1, seq: 999999, bits: 0, aimX: 0, aimY: 0, tool: 0 }) === false);
    check('wrong room high sequence is rejected', host.applyInput({ room: 'elsewhere', client: 'A', player: pid, seq: 999999, bits: 0, aimX: 0, aimY: 0, tool: 0 }) === false);
    check('valid input accepted after invalid high sequences', host.applyInput({ room: 'r', client: 'A', player: pid, seq: 4, bits: INPUT.RIGHT, aimX: 10, aimY: 10, tool: 1 }) === true);
    e.destroy();
  }

  // a wildly out-of-range aim is clamped into the buffer (reach is enforced in C++).
  {
    const e = mkE();
    const host = new Host({ engine: e, roomId: 'r' });
    const pid = host.addClient('A', { x: 50, y: 50 });
    host.applyInput({ room: 'r', client: 'A', player: pid, seq: 1, bits: INPUT.PRIMARY, aimX: 9999999, aimY: -9999999, tool: 1 });
    const p = e.getPlayer(pid);
    check(`far aim clamped to buffer (${p.aimX},${p.aimY})`, p.aimX >= -1 && p.aimX <= e.cols && p.aimY >= -1 && p.aimY <= e.rows);
    e.destroy();
  }

  // input rate limiting: a flood (clock frozen) is throttled to the burst size,
  // and the bucket refills as time passes.
  {
    let clock = 1000;
    const e = mkE();
    const host = new Host({ engine: e, roomId: 'r', maxInputRate: 90, inputBurst: 10, now: () => clock });
    const pid = host.addClient('A', { x: 50, y: 50 });
    let applied = 0;
    for (let i = 0; i < 100; i++) if (host.applyInput({ room: 'r', client: 'A', player: pid, seq: i + 1, bits: 0, aimX: 0, aimY: 0, tool: 0 })) applied++;
    check(`input flood throttled to burst (${applied} of 100 applied)`, applied >= 8 && applied <= 12 && host.droppedInputs >= 85);
    clock += 1000; // a second passes -> bucket refills (capped at burst)
    let refilled = 0;
    for (let i = 0; i < 100; i++) if (host.applyInput({ room: 'r', client: 'A', player: pid, seq: 200 + i, bits: 0, aimX: 0, aimY: 0, tool: 0 })) refilled++;
    check(`bucket refills over time (${refilled} applied)`, refilled >= 8 && refilled <= 12);
    e.destroy();
  }

  // clients can't edit the world directly — they only send input (the host owns
  // all world writes). This is structural: the protocol has no client->world edit
  // message, so a malicious client simply has no way to mutate the host grid.
  check('protocol has no client world-edit message', typeof MSG.INPUT === 'string' && !Object.values(MSG).includes('worldedit'));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
