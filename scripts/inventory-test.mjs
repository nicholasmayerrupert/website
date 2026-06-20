// Phase D: survival inventory (authoritative in the engine). Pickup vacuums dropped
// items into per-player stacks; stacking merges; a full inventory overflows (item
// stays in world); the selected slot drives held tool vs placed material; placing
// consumes a count. Run: node scripts/inventory-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100, FLOOR = 60;
await initSandWasm();
const { check, done } = makeChecker('survival inventory (Phase D)');

function survivalEngine() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 4, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 5; x < COLS - 5; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}
const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
const slotCount = (e, id, mat) => e.getInventory(id).slots.filter((s) => !s.isTool && s.material === mat).reduce((a, s) => a + s.count, 0);

// 1) Pickup: a dropped item near a player is vacuumed into the inventory.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(50, FLOOR - 8); // standing on the floor
  e.spawnItem(MAT.WOOD, 1, 52, FLOOR - 4, 0, 0);
  check('item present before pickup', e.itemCount() === 1);
  run(e, 30);
  check(`item vacuumed into inventory (count ${e.itemCount()})`, e.itemCount() === 0);
  check(`inventory holds the wood (${slotCount(e, id, MAT.WOOD)})`, slotCount(e, id, MAT.WOOD) === 1);
  e.destroy();
}

// 2) Stacking: same-material adds merge into one slot.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(50, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 5);
  e.addToInventory(id, MAT.STONE, 5);
  const stoneSlots = e.getInventory(id).slots.filter((s) => !s.isTool && s.material === MAT.STONE && s.count > 0);
  check(`5+5 stone merge into one slot of 10 (${stoneSlots.length} slot, ${stoneSlots[0]?.count})`, stoneSlots.length === 1 && stoneSlots[0].count === 10);
  e.destroy();
}

// 3) Overflow: a full inventory rejects more (so the world item is not lost).
{
  const e = survivalEngine();
  const id = e.spawnPlayer(50, FLOOR - 8);
  // Fill every non-tool slot (32 of them, tools occupy 4) with stone at max stack.
  e.addToInventory(id, MAT.STONE, 999 * 32);
  const full = e.addToInventory(id, MAT.GOLD_ORE, 1);
  check('a full inventory rejects a new material', full === false);
  // And a world item near the player is NOT absorbed when the inventory is full.
  e.spawnItem(MAT.GOLD_ORE, 1, 52, FLOOR - 4, 0, 0);
  run(e, 30);
  check(`unabsorbable item stays in the world (count ${e.itemCount()})`, e.itemCount() === 1);
  e.destroy();
}

// 4) Selected slot drives the held tool: pickaxe drops stone, hand does not.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(10, FLOOR - 8); // far from the mined block (no auto-pickup)
  e.placeMaterial(60, 50, 2, MAT.STONE);
  e.setSelectedSlot(id, 1); // wood pickaxe
  for (let i = 0; i < 60; i++) e.playerMine(id, 60, 50);
  const withPick = e.getItems().filter((it) => it.kind === 0 && it.material === MAT.STONE).length;
  check(`selecting the pickaxe drops stone (${withPick})`, withPick > 0);

  const e2 = survivalEngine();
  const id2 = e2.spawnPlayer(10, FLOOR - 8);
  e2.placeMaterial(60, 50, 2, MAT.STONE);
  e2.setSelectedSlot(id2, 0); // bare hand
  for (let i = 0; i < 60; i++) e2.playerMine(id2, 60, 50);
  const withHand = e2.getItems().filter((it) => it.kind === 0 && it.material === MAT.STONE).length;
  check(`selecting the hand drops no stone (${withHand})`, withHand === 0);
  e.destroy(); e2.destroy();
}

// 5) Place-from-slot consumes one count per call and writes the grid.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(10, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 10); // lands in the first empty slot (4)
  const slot = e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.STONE && s.count > 0);
  e.setSelectedSlot(id, slot);
  const placed = e.placeFromSelected(id, 40, 30);
  check('placeFromSelected reports success', placed);
  check(`grid received stone at the aim`, e.getGrid()[30 * COLS + 40] === MAT.STONE);
  check(`one count consumed (10 -> ${slotCount(e, id, MAT.STONE)})`, slotCount(e, id, MAT.STONE) === 9);
  e.placeFromSelected(id, 45, 30);
  check(`second place consumes again (-> ${slotCount(e, id, MAT.STONE)})`, slotCount(e, id, MAT.STONE) === 8);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
