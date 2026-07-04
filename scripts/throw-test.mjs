// Phase D: Minecraft cursor model + throw-out. cursorPick picks up / places / half /
// swaps the carried stack; throwFromCursor ejects it into the world in the facing
// direction (and it isn't instantly vacuumed back). Run: node scripts/throw-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100, FLOOR = 60;
await initSandWasm();
const { check, done } = makeChecker('inventory cursor + throw (Phase D)');

function eng() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 2, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 5; x < COLS - 5; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}
const firstOf = (inv, mat) => inv.slots.findIndex((s) => !s.isTool && s.material === mat && s.count > 0);

// 1) Pick up the whole stack onto the cursor, then place it whole into another slot.
{
  const e = eng(); const id = e.spawnPlayer(20, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 20);
  const slot = firstOf(e.getInventory(id), MAT.STONE);
  e.inventoryCursorPick(id, slot, false);
  const cur = e.getCursor(id);
  check(`cursor holds the whole stack (${cur?.count})`, cur && cur.material === MAT.STONE && cur.count === 20);
  check('source slot emptied', e.getInventory(id).slots[slot].count === 0);
  e.inventoryCursorPick(id, 25, false);
  check('placed whole stack into the target slot', e.getInventory(id).slots[25].count === 20 && e.getCursor(id) === null);
  e.destroy();
}

// 2) Right-click picks up half and places one.
{
  const e = eng(); const id = e.spawnPlayer(20, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 10);
  const slot = firstOf(e.getInventory(id), MAT.STONE);
  e.inventoryCursorPick(id, slot, true); // half of 10 = 5
  check(`half pick takes 5 (${e.getCursor(id)?.count})`, e.getCursor(id)?.count === 5);
  e.inventoryCursorPick(id, 26, true);   // place one
  check('right-click places one', e.getInventory(id).slots[26].count === 1 && e.getCursor(id)?.count === 4);
  e.destroy();
}

// 3) Different material on the slot -> swap.
{
  const e = eng(); const id = e.spawnPlayer(20, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 5);
  e.inventoryCursorPick(id, firstOf(e.getInventory(id), MAT.STONE), false); // cursor = 5 stone
  e.addToInventory(id, MAT.DIRT, 3);
  const dslot = firstOf(e.getInventory(id), MAT.DIRT);
  e.inventoryCursorPick(id, dslot, false); // swap
  check('different material swaps', e.getCursor(id)?.material === MAT.DIRT && e.getInventory(id).slots[dslot].material === MAT.STONE);
  e.destroy();
}

// 4) Throw from the cursor: ejects an item in the facing direction; not re-vacuumed.
{
  const e = eng(); const id = e.spawnPlayer(20, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 12);
  e.inventoryCursorPick(id, firstOf(e.getInventory(id), MAT.STONE), false); // cursor = 12
  const thrown = e.throwFromCursor(id, true);
  check('throw reports success and clears the cursor', thrown && e.getCursor(id) === null);
  const it0 = e.getItems()[0];
  check(`one item carrying the whole stack thrown (${it0?.count})`, e.itemCount() === 1 && it0 && it0.material === MAT.STONE && it0.count === 12);
  const x0 = it0.x;
  let t = 0; for (let i = 0; i < 10; i++) { t += 16; e.step(t); }
  const it1 = e.getItems()[0];
  check(`thrown item flew in the facing dir, not sucked back (x ${x0.toFixed(1)}->${it1?.x.toFixed(1)})`, e.itemCount() === 1 && it1 && it1.x > x0 + 1);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
