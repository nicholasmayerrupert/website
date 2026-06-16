// Tests for the multiplayer protocol + sequencing layer (Phase 4). All run in
// Node with no real network. Run with:
//   node scripts/net-test.mjs

import {
  MSG, encode, decode, makeJoin, makeLeave, makeInput, makeSnapshot, makePing, makePong,
  INPUT_BITS_MAX, TOOL_MAX,
} from '../src/sand/net/protocol.js';
import { SequenceTracker, InputSequencer, applyInputStream } from '../src/sand/net/client.js';
import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/engineWasm.js';
import { gridHash } from './sand-test-util.mjs';

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

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
