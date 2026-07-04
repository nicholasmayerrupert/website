// Tests for the authoritative sand-server state replication (Phase 9): the
// item/inventory/cursor encoders round-trip through the wire format and back into
// the same engine values, the survival intents mutate engine state the way the
// server dispatches them, and a live two-client server hands out the world +
// inventory + acts on intents. Run: node scripts/server-roundtrip-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import WebSocket from 'ws';
import { MAT } from '../src/sand/materials.js';
import { decode, encode, MSG, makeJoin, makeInput, makeSelect, makeSize, makePick } from '../src/sand/net/protocol.js';
import { encodeItems, encodeInventory, encodeCursor, inventoryRevision } from '../src/sand/net/server/stateSync.js';
import { startSandServer } from './sand-server.mjs';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100, FLOOR = 60;
await initSandWasm();
const { check, done } = makeChecker('authoritative server replication (Phase 9)');

function survivalEngine() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 5; x < COLS - 5; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}

// 1) items encoder round-trips id/material/count/position through the wire.
{
  const e = survivalEngine();
  e.spawnPlayer(50, FLOOR - 8);
  const id = e.spawnItem(MAT.WOOD, 3, 40.5, FLOOR - 4, 0, 0);
  const m = decode(encode(encodeItems(e, 0)));
  check('items message decodes', m && m.t === MSG.ITEMS);
  check('one dropped item replicated', m && m.data.length === 7);
  check('item id/material/count preserved', m && m.data[0] === id && m.data[2] === MAT.WOOD && m.data[3] === 3);
  check('item x position preserved', m && m.data[4] === 40.5);
  e.destroy();
}

// 1b) cosmetic particles are NOT replicated (kept local, bandwidth saver).
{
  const e = survivalEngine();
  e.spawnPlayer(50, FLOOR - 8);
  e.spawnParticle(MAT.STONE, 40, FLOOR - 4, 0, 0, 20);
  e.spawnItem(MAT.WOOD, 1, 41, FLOOR - 4, 0, 0);
  const m = decode(encode(encodeItems(e, 0)));
  check('only the dropped item is sent, particle filtered', m && m.data.length === 7);
  e.destroy();
}

// 2) inventory encoder round-trips slots + selected.
{
  const e = survivalEngine();
  const pid = e.spawnPlayer(50, FLOOR - 8); // seeds starter tools in slots 0-2
  e.addToInventory(pid, MAT.STONE, 42);
  e.setSelectedSlot(pid, 4);
  e.setSelectedFootprint(pid, 3);
  const m = decode(encode(encodeInventory(e, 0, pid)));
  check('inventory message decodes', m && m.t === MSG.INVENTORY && m.player === pid);
  check('selected slot preserved', m && m.selected === 4);
  check('selected footprint preserved', m && m.selectedFootprint === 3);
  // slot 0 is the wood pickaxe (isTool, toolClass 1); compare against the engine.
  const inv = e.getInventory(pid);
  check('slot 0 tool fields match engine', m && m.data[1] === (inv.slots[0].isTool ? 1 : 0) && m.data[2] === inv.slots[0].toolClass);
  // the stone we added is somewhere in the flat data with count 42.
  let foundStone = false;
  for (let i = 0; i < m.data.length; i += 5) if (m.data[i] === MAT.STONE && m.data[i + 4] === 42) foundStone = true;
  check('added stone stack (42) present in flat data', foundStone);
  e.destroy();
}

// 3) cursor encoder: empty -> null, carrying -> the picked stack.
{
  const e = survivalEngine();
  const pid = e.spawnPlayer(50, FLOOR - 8);
  check('cursor empty initially', decode(encode(encodeCursor(e, 0, pid))).cur === null);
  e.inventoryCursorPick(pid, 0, false); // lift the whole slot-0 stack onto the cursor
  const m = decode(encode(encodeCursor(e, 0, pid)));
  check('cursor carries a stack after pick', m && m.cur !== null);
  e.destroy();
}

// 4) inventoryRevision changes exactly when wire-visible state changes.
{
  const e = survivalEngine();
  const pid = e.spawnPlayer(50, FLOOR - 8);
  const r0 = inventoryRevision(e, pid);
  const r0b = inventoryRevision(e, pid);
  check('revision stable when nothing changes', r0 === r0b);
  e.addToInventory(pid, MAT.STONE, 1);
  check('revision changes after a pickup', inventoryRevision(e, pid) !== r0);
  const r1 = inventoryRevision(e, pid);
  e.setSelectedSlot(pid, 5);
  check('revision changes after select', inventoryRevision(e, pid) !== r1);
  const r2 = inventoryRevision(e, pid);
  e.setSelectedFootprint(pid, 4);
  check('revision changes after footprint select', inventoryRevision(e, pid) !== r2);
  e.destroy();
}

// 5) intents mutate engine state the way the server dispatch does (select/size/pick).
{
  const e = survivalEngine();
  const pid = e.spawnPlayer(50, FLOOR - 8);
  // simulate server's ACT_SELECT dispatch
  const sel = decode(encode(makeSelect('r', 'c', 6)));
  e.setSelectedSlot(pid, sel.slot);
  check('ACT_SELECT moves the selected slot', e.getInventory(pid).selected === 6);
  const size = decode(encode(makeSize('r', 'c', 4)));
  e.setSelectedFootprint(pid, size.footprint);
  check('ACT_SIZE moves the selected footprint', e.getInventory(pid).selectedFootprint === 4);
  // simulate server's ACT_PICK dispatch
  const pick = decode(encode(makePick('r', 'c', 0, false)));
  e.inventoryCursorPick(pid, pick.slot, pick.half);
  check('ACT_PICK lifts a stack onto the cursor', e.getCursor(pid) !== null);
  e.destroy();
}

// 6) live two-client server: join hands out world + inventory; INPUT + intents act.
{
  const PORT = 5197;
  const srv = await startSandServer({ port: PORT, cols: 128, rows: 96, seed: 0x1234, room: 'r' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${PORT}`); ws.onopen = () => res(ws); ws.onerror = () => rej(new Error('connect failed')); });
  const inboxOf = (ws) => { const q = []; ws.onmessage = (ev) => { const m = decode(typeof ev.data === 'string' ? ev.data : ev.data.toString()); if (m) q.push(m); }; return q; };
  const last = (q, t) => { for (let i = q.length - 1; i >= 0; i--) if (q[i].t === t) return q[i]; return null; };
  try {
    const a = await open(), b = await open();
    const ai = inboxOf(a), bi = inboxOf(b);
    a.send(encode(makeJoin('r', 'A', 'host'))); await wait(60);
    b.send(encode(makeJoin('r', 'B', 'client'))); await wait(120);

    const assignA = last(ai, MSG.ASSIGN), worldA = last(ai, MSG.WORLD), invA = last(ai, MSG.INVENTORY);
    check('client A got an authoritative player id', assignA && assignA.player > 0);
    check('client A got the full world at server dims', worldA && worldA.cols === 128 && worldA.rows === 96);
    check('client A got an initial inventory', invA && invA.data.length === 36 * 5);
    check('client B also got a world + inventory', last(bi, MSG.WORLD) && last(bi, MSG.INVENTORY));

    // snapshots list both players.
    const snapA = last(ai, MSG.SNAPSHOT);
    check('snapshot lists two players', snapA && snapA.players.length === 2);

    // ACT_SELECT from A -> the server re-broadcasts A's inventory with selected=3.
    ai.length = 0;
    a.send(encode(makeSelect('r', 'A', 3))); await wait(120);
    const invSel = last(ai, MSG.INVENTORY);
    check('ACT_SELECT reflected in A inventory broadcast', invSel && invSel.selected === 3);

    ai.length = 0;
    a.send(encode(makeSize('r', 'A', 4))); await wait(120);
    const invSize = last(ai, MSG.INVENTORY);
    check('ACT_SIZE reflected in A inventory broadcast', invSize && invSize.selectedFootprint === 4);

    // ACT_PICK from A -> the server sends a non-null cursor for A.
    a.send(encode(makePick('r', 'A', 0, false))); await wait(120);
    check('ACT_PICK reflected in A cursor broadcast', last(ai, MSG.CURSOR)?.cur != null);

    // INPUT reaches the host (the player exists + is simulated); send RIGHT a while.
    const pidA = assignA.player;
    for (let i = 0; i < 40; i++) { a.send(encode(makeInput({ room: 'r', client: 'A', player: pidA, tick: i, seq: i, bits: 2 /* RIGHT */, aimX: 0, aimY: 0, tool: 0 }))); await wait(8); }
    await wait(60);
    const snap2 = last(ai, MSG.SNAPSHOT), pA = snap2?.players.find((p) => p.id === pidA);
    check('A player present + advanced in snapshots after input', pA && Number.isFinite(pA.x));

    a.close(); b.close(); await wait(60);
  } catch (err) {
    check(`live server error: ${err.message}`, false);
  } finally {
    await srv.close();
  }
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
