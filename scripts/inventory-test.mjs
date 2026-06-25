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
  // Fill every non-tool slot (33 of them; tools occupy slots 0-2) with stone at max stack.
  e.addToInventory(id, MAT.STONE, 999 * 33);
  const full = e.addToInventory(id, MAT.GOLD_ORE, 1);
  check('a full inventory rejects a new material', full === false);
  // And a world item near the player is NOT absorbed when the inventory is full.
  e.spawnItem(MAT.GOLD_ORE, 1, 52, FLOOR - 4, 0, 0);
  run(e, 30);
  check(`unabsorbable item stays in the world (count ${e.itemCount()})`, e.itemCount() === 1);
  e.destroy();
}

// 4) Starter kit + empty-slot-is-hand: pickaxe (slot 0) drops stone; an EMPTY slot
//    mines by hand and drops no stone.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(10, FLOOR - 8); // far from the mined block (no auto-pickup)
  const kit = e.getInventory(id);
  const footprints = e.getSurvivalFootprints();
  check('starter kit has no hand slot (slots 0-2 = pickaxe/axe/shovel)',
    kit.slots[0].toolClass === TC.pickaxe && kit.slots[1].toolClass === TC.axe && kit.slots[2].toolClass === TC.shovel && kit.slots[3].count === 0);
  check('survival sizes run 1x1 through 8x8 with 3x3 default',
    footprints.length === 8 && footprints[0].width === 1 && footprints[7].width === 8 && kit.selectedFootprint === 2);
  e.placeMaterial(60, 50, 2, MAT.STONE);
  e.setSelectedSlot(id, 0); // wood pickaxe
  e.setSelectedFootprint(id, 0); // 1x1 isolates the drop-gate behavior under test
  for (let i = 0; i < 60; i++) e.playerMine(id, 60, 50);
  const withPick = e.getItems().filter((it) => it.kind === 0 && it.material === MAT.STONE).length;
  check(`selecting the pickaxe drops stone (${withPick})`, withPick > 0);

  const e2 = survivalEngine();
  const id2 = e2.spawnPlayer(10, FLOOR - 8);
  e2.placeMaterial(60, 50, 2, MAT.STONE);
  e2.setSelectedSlot(id2, 5); // an EMPTY slot -> bare hand
  e2.setSelectedFootprint(id2, 0);
  for (let i = 0; i < 60; i++) e2.playerMine(id2, 60, 50);
  const withHand = e2.getItems().filter((it) => it.kind === 0 && it.material === MAT.STONE).length;
  check(`an empty slot mines by hand, no stone drop (${withHand})`, withHand === 0);
  e.destroy(); e2.destroy();
}

// 5) Per-pixel economy: placing consumes exactly as many units as cells it creates,
//    capped at the stack count.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(10, FLOOR - 8);
  e.addToInventory(id, MAT.STONE, 50);
  const slot = e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.STONE && s.count > 0);
  e.setSelectedSlot(id, slot);
  const fp = e.getSurvivalFootprints()[e.getInventory(id).selectedFootprint];
  const stoneBefore = e.getGrid().reduce((a, v) => a + (v === MAT.STONE), 0);
  const before = slotCount(e, id, MAT.STONE);
  e.placeFromSelected(id, 40, 30); // open air, above the floor
  const stoneAfter = e.getGrid().reduce((a, v) => a + (v === MAT.STONE), 0);
  const placed = before - slotCount(e, id, MAT.STONE);
  check(`placed cells == consumed units (${placed})`, placed === fp.cellCount && placed === stoneAfter - stoneBefore);

  // A stack of 3 can place at most 3 cells (center-first cap).
  const e2 = survivalEngine();
  const id2 = e2.spawnPlayer(10, FLOOR - 8);
  e2.addToInventory(id2, MAT.SAND, 3);
  const s2 = e2.getInventory(id2).slots.findIndex((s) => !s.isTool && s.material === MAT.SAND && s.count > 0);
  e2.setSelectedSlot(id2, s2);
  e2.setSelectedFootprint(id2, 2); // 3x3 footprint proves the capped partial placement path
  e2.placeFromSelected(id2, 40, 20);
  let sand = 0; for (const v of e2.getGrid()) if (v === MAT.SAND) sand++;
  check(`a 3-stack places exactly 3 cells (${sand}) and empties the slot`, sand === 3 && slotCount(e2, id2, MAT.SAND) === 0);
  e.destroy(); e2.destroy();
}

// 5b) Survival footprint selection scales loose-material volume and inventory cost.
{
  const waterPlaced = (footprintId, stack) => {
    const e = survivalEngine();
    const id = e.spawnPlayer(10, FLOOR - 8);
    e.addToInventory(id, MAT.WATER, stack);
    const slot = e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.WATER && s.count > 0);
    e.setSelectedSlot(id, slot);
    e.setSelectedFootprint(id, footprintId);
    const before = slotCount(e, id, MAT.WATER);
    const gridBefore = e.getGrid().reduce((a, v) => a + (v === MAT.WATER), 0);
    e.placeFromSelected(id, 40, 24);
    const after = slotCount(e, id, MAT.WATER);
    const gridAfter = e.getGrid().reduce((a, v) => a + (v === MAT.WATER), 0);
    const res = { placed: gridAfter - gridBefore, spent: before - after, fp: e.getSurvivalFootprints()[footprintId] };
    e.destroy();
    return res;
  };
  const small = waterPlaced(0, 30); // 1x1
  const large = waterPlaced(3, 30); // 4x4
  check(`1x1 water spend matches placed cells (${small.spent}/${small.placed})`, small.spent === 1 && small.spent === small.placed);
  check(`4x4 water spend matches placed cells (${large.spent}/${large.placed})`, large.spent === 16 && large.spent === large.placed);
  check(`4x4 places more water than 1x1 (${large.placed} > ${small.placed})`, large.placed > small.placed);
}

// 6) The survival CONTROLS route an empty slot to bare-hand mining (driven through
//    real player input, exercising applyInventoryPlayer — not the direct mine hook).
{
  const PI_PRIMARY = 16;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 8);
  let t = 0; for (let s = 0; s < 6; s++) { t += 16; e.step(t); } // let the player settle on the floor
  e.placeMaterial(44, FLOOR - 1, 0, MAT.DIRT); // a single dirt cell within reach
  e.setSelectedSlot(id, 5); // an EMPTY slot -> bare hand
  e.setSelectedFootprint(id, 0); // 1x1 keeps this focused on empty-slot routing
  for (let s = 0; s < 40; s++) {
    e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 44.5, aimY: FLOOR - 1 + 0.5, seq: s + 1 });
    t += 16; e.step(t);
  }
  const dirtLeft = e.getGrid().reduce((a, v) => a + (v === MAT.DIRT), 0);
  const inv = e.getInventory(id);
  const gotDirt = inv.slots.some((s) => !s.isTool && s.material === MAT.DIRT && s.count > 0) ||
    e.getItems().some((it) => it.kind === 0 && it.material === MAT.DIRT);
  check(`empty-slot hand mining breaks the dirt (${dirtLeft} left) and yields it`, dirtLeft === 0 && gotDirt);
  e.destroy();
}

// 6a) RMB mining in survival inventory targets visible foreground first. This keeps
//     the user-facing "RMB mines" control from silently digging the background when
//     a foreground block is under the cursor.
{
  const PI_SECONDARY = 32;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 8);
  let t = 0; for (let s = 0; s < 6; s++) { t += 16; e.step(t); }
  e.placeMaterial(44, FLOOR - 1, 0, MAT.DIRT);
  e.setSelectedSlot(id, 5);
  e.setSelectedFootprint(id, 0);
  for (let s = 0; s < 40; s++) {
    e.setPlayerInput(id, { bits: PI_SECONDARY, aimX: 44.5, aimY: FLOOR - 1 + 0.5, seq: s + 1 });
    t += 16; e.step(t);
  }
  const fgDirt = e.getGrid().reduce((a, v) => a + (v === MAT.DIRT), 0);
  const bgDirt = e.getGridBg().reduce((a, v) => a + (v === MAT.DIRT), 0);
  check(`secondary mining clears foreground dirt (${fgDirt} fg, ${bgDirt} bg)`, fgDirt === 0 && bgDirt === 0);
  e.destroy();
}

// 6b) Mining time scales with the selected footprint area: 1x1 is 9x faster than 3x3.
{
  const mineTicks = (footprintId) => {
    const e = survivalEngine();
    const id = e.spawnPlayer(10, FLOOR - 8);
    e.setSelectedSlot(id, 0); // wood pickaxe
    e.setSelectedFootprint(id, footprintId);
    e.placeMaterial(60, 50, 2, MAT.STONE);
    let ticks = 0;
    while (ticks < 400 && e.getGrid()[50 * COLS + 60] === MAT.STONE) {
      e.playerMine(id, 60, 50);
      ticks++;
    }
    e.destroy();
    return ticks;
  };
  const one = mineTicks(0);
  const three = mineTicks(2);
  check(`1x1 mine ticks (${one})`, one > 0);
  check(`3x3 mine ticks are 9x 1x1 (${three} vs ${one})`, three === one * 9);
}

// 7) Placing a COMPONENT material in survival uses the creative-style DRAFT: holding
//    draws a preview that consumes inventory (before it's in the world); releasing
//    materializes it.
{
  const PI_PRIMARY = 16;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 9);
  let t = 0; for (let s = 0; s < 8; s++) { t += 16; e.step(t); } // settle
  e.setSelectedFootprint(id, 3); // 4x4 square
  e.addToInventory(id, MAT.STONE, 24);
  e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.STONE && s.count > 0));
  const stoneOf = () => e.getGrid().reduce((a, v) => a + (v === MAT.STONE), 0);
  const before = stoneOf();
  let seq = 100;
  // hold primary, aiming at open air in reach -> the draft grows + consumes inventory.
  e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 50.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t);
  const staged = e.getStoneDraftCells().length;
  const invDuring = slotCount(e, id, MAT.STONE);
  check(`draft consumes inventory but isn't in the world yet (${staged} staged, inv ${invDuring}, grid +${stoneOf() - before})`,
    staged === 16 && invDuring === 8 && stoneOf() === before);
  // release -> materialize exactly what was consumed.
  e.setPlayerInput(id, { bits: 0, aimX: 50.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t);
  check(`releasing materializes the draft (grid +${stoneOf() - before} == consumed ${24 - invDuring})`,
    stoneOf() - before === 16 && stoneOf() - before === 24 - invDuring);
  e.destroy();
}

// 8) Seeds are components internally, but survival places them through the seed
//    path: one press -> one 1x1 seed, not a stone-style brush draft.
{
  const PI_PRIMARY = 16;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 9);
  let t = 0; for (let s = 0; s < 8; s++) { t += 16; e.step(t); }
  e.addToInventory(id, MAT.SEED, 4);
  e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.SEED && s.count > 0));
  const seedOf = () => e.getGrid().reduce((a, v) => a + (v === MAT.SEED), 0);
  const before = seedOf();
  let seq = 200;
  for (let s = 0; s < 4; s++) { e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 50.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t); }
  const staged = e.getStoneDraftCells().length;
  const invAfter = slotCount(e, id, MAT.SEED);
  check(`seed places exactly one cell without a component draft (grid +${seedOf() - before}, staged ${staged}, inv ${invAfter})`,
    seedOf() - before === 1 && staged === 0 && invAfter === 3);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
