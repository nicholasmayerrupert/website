// Tests for the multiplayer protocol + sequencing layer (Phase 4). All run in
// Node with no real network. Run with:
//   node scripts/net-test.mjs

import {
  MSG, encode, decode, makeJoin, makeLeave, makeInput, makeSnapshot, makePing, makePong,
  INPUT_BITS_MAX, TOOL_MAX,
} from '../src/sand/net/protocol.js';
import { SequenceTracker, InputSequencer, applyInputStream } from '../src/sand/net/client.js';
import { Host } from '../src/sand/net/host.js';
import { encodeWorld, encodeDiff, applyWorldMessage, applyDiffMessage } from '../src/sand/net/worldSync.js';
import { startServer } from './dev-multiplayer-server.mjs';
import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/engineWasm.js';
import { gridHash } from './sand-test-util.mjs';

const COLS = 200, ROWS = 120;
const stoneFloor = (e) => { for (let x = 20; x < 180; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0); e.finalizeStoneDraft(); };

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const rt = (m) => decode(encode(m)); // round trip through the wire format

// 1. input message round trip.
{
  console.log('input round trip');
  const m = makeInput({ room: 'r1', client: 7, player: 3, tick: 42, seq: 5, bits: INPUT.RIGHT | INPUT.JUMP, aimX: 120, aimY: -8, tool: 6 });
  const d = rt(m);
  check('decodes to input', d && d.t === MSG.INPUT);
  check('fields preserved', d && d.room === 'r1' && d.client === 7 && d.player === 3 && d.tick === 42 && d.seq === 5 && d.bits === (INPUT.RIGHT | INPUT.JUMP) && d.aimX === 120 && d.aimY === -8 && d.tool === 6);
}

// 2. snapshot round trip.
{
  console.log('snapshot round trip');
  const players = [
    { id: 1, x: 10.5, y: 20.25, vx: -1.5, vy: 0.75, facing: -1, grounded: true, tool: 2, health: 100, inputSeq: 9 },
    { id: 2, x: 33, y: 5, vx: 0, vy: 0, facing: 1, grounded: false, tool: 0, health: 80, inputSeq: 0 },
  ];
  const d = rt(makeSnapshot(123, players, 0xdeadbeef));
  check('decodes to snapshot', d && d.t === MSG.SNAPSHOT && d.tick === 123);
  check('hash preserved', d && d.hash === 0xdeadbeef);
  check('two players, positions intact', d && d.players.length === 2 && d.players[0].x === 10.5 && d.players[0].y === 20.25 && d.players[1].id === 2);
  check('grounded normalized to 0/1', d && d.players[0].grounded === 1 && d.players[1].grounded === 0);
}

// 3. join/leave/ping/pong round trip.
{
  console.log('control messages');
  check('join', rt(makeJoin('room', 4, 'Nick')).t === MSG.JOIN);
  check('leave', rt(makeLeave('room', 4)).t === MSG.LEAVE);
  check('ping', rt(makePing(4, 1000)).t === MSG.PING);
  check('pong', rt(makePong(4, 1000)).t === MSG.PONG);
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
  check('snapshot bad player', decode(JSON.stringify({ t: 'snapshot', tick: 1, hash: null, players: [{ id: -1 }] })) === null);
  check('snapshot non-array players', decode(JSON.stringify({ t: 'snapshot', tick: 1, hash: null, players: 5 })) === null);
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
  const host = new Host({ engine, roomId: 'r' });
  const pA = host.addClient('A', { x: 80, y: 80 });
  const pB = host.addClient('B', { x: 120, y: 80 });
  check('two clients -> two players', pA && pB && pA !== pB && engine.playerCount() === 2);
  for (let i = 0; i < 30; i++) host.step(); // settle on floor

  const seqA = new InputSequencer();
  const x0 = engine.getPlayer(pA).x;
  for (let i = 0; i < 60; i++) {
    host.receive(encode(seqA.next({ room: 'r', client: 'A', player: pA, tick: i, bits: INPUT.RIGHT, aimX: 0, aimY: 0, tool: 0 })));
    host.step();
  }
  check(`remote input moved client A's player (${x0.toFixed(1)} -> ${engine.getPlayer(pA).x.toFixed(1)})`, engine.getPlayer(pA).x > x0 + 4);
  check('client B player unaffected (no input)', Math.abs(engine.getPlayer(pB).x - 120) < 6);

  const snap = host.snapshot({ withHash: true });
  const snapA = snap.players.find((p) => p.id === pA);
  check('snapshot carries both players', snap.players.length === 2 && !!snapA);
  check(`snapshot lastProcessedSeq advanced (${snapA.seq})`, snapA.seq >= 59);
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

    hostWs.send(encode(makeSnapshot(5, [{ id: 1, x: 10, y: 20, vx: 0, vy: 0, facing: 1, grounded: true, tool: 0, health: 100, inputSeq: 0 }])));
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
  host.resetDirty();

  // a sequence of incremental diffs reconstructs the host hash on the client.
  for (let i = 0; i < 4; i++) {
    host.paintDisc(100 + i * 8, 40, 3, 1, true); // paint sand blobs in fresh regions
    const d = decode(encode(encodeDiff(host, i + 1)));
    host.resetDirty();
    const ok = applyDiffMessage(client, d);
    check(`diff ${i} applied, hashes match`, ok && host.gridHash() === client.gridHash());
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

  host.destroy(); client.destroy();
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

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
