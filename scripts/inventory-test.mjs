// Survival inventory is authoritative in the engine. Pickup vacuums dropped
// items into per-player stacks; stacking merges; a full inventory overflows (item
// stays in world); the selected slot drives held tool vs placed material; placing
// consumes a count. Run: node scripts/inventory-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100, FLOOR = 60;
await initSandWasm();
const { check, done } = makeChecker('survival inventory');

function survivalEngine() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 4, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 5; x < COLS - 5; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}
const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
const slotCount = (e, id, mat) => e.getInventory(id).slots.filter((s) => !s.isTool && s.material === mat).reduce((a, s) => a + s.count, 0);
const hasDraftCell = (cells, x, y) => {
  const k = y * COLS + x;
  for (const c of cells) if (c === k) return true;
  return false;
};

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
  // The starter gun + mining tool reserve slots 0-1; fill the other 34 exactly.
  e.addToInventory(id, MAT.STONE, 999 * 34);
  const full = e.addToInventory(id, MAT.GOLD_ORE, 1);
  check('a full inventory rejects a new material', full === false);
  // And a world item near the player is NOT absorbed when the inventory is full.
  e.spawnItem(MAT.GOLD_ORE, 1, 52, FLOOR - 4, 0, 0);
  run(e, 30);
  check(`unabsorbable item stays in the world (count ${e.itemCount()})`, e.itemCount() === 1);
  e.destroy();
}

// 4) Armed spawn + crafting: the gun occupies slot 0 and the universal wood dig
//    tool occupies slot 1, while crafting can still create additional tools.
{
  const e = survivalEngine();
  const id = e.spawnPlayer(10, FLOOR - 8); // far from the mined block (no auto-pickup)
  let kit = e.getInventory(id);
  const footprints = e.getSurvivalFootprints();
  check('fresh survival inventory starts with the selected blast gun and wood dig tool',
    kit.selected === 0 && kit.slots[0].itemKind === ITEM_KIND.BLAST_GUN && kit.slots[0].count === 1
      && kit.slots[1].itemKind === ITEM_KIND.MINING_TOOL && kit.slots[1].isTool
      && kit.slots[1].toolClass === TC.dig && kit.slots[1].toolTier === TT.wood && kit.slots[1].count === 1
      && kit.slots.slice(2).every((slot) => slot.count === 0));
  check('survival sizes run 1x1 through 8x8 with 3x3 default',
    footprints.length === 8 && footprints[0].width === 1 && footprints[7].width === 8 && kit.selectedFootprint === 2);
  e.addToInventory(id, MAT.WOOD, 24);
  const starterTools = kit.slots.filter((slot) => slot.itemKind === ITEM_KIND.MINING_TOOL && slot.count > 0).length;
  check('24 wood crafts one additional wood mining tool', e.craft(id, 0) === 1
    && e.getInventory(id).slots.filter((slot) => slot.itemKind === ITEM_KIND.MINING_TOOL && slot.count > 0).length === starterTools + 1);
  kit = e.getInventory(id);
  const toolSlot = kit.slots.findIndex((slot) => slot.isTool);
  e.placeMaterial(60, 50, 2, MAT.STONE);
  e.setSelectedSlot(id, toolSlot);
  e.setSelectedFootprint(id, 0); // 1x1 isolates the drop-gate behavior under test
  for (let i = 0; i < 60; i++) e.playerMine(id, 60, 50);
  const withDig = e.getItems().filter((it) => it.kind === 0 && it.material === MAT.STONE).length;
  check(`selecting the dig tool drops stone (${withDig})`, withDig > 0);

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

// 6a) RMB mining in survival inventory digs both layers. This keeps the user-facing
//     "RMB mines" control useful for foreground blocks while still allowing
//     background mining when a large footprint overlaps nearby foreground.
{
  const PI_SECONDARY = 32;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 8);
  let t = 0; for (let s = 0; s < 6; s++) { t += 16; e.step(t); }
  e.placeMaterial(44, FLOOR - 1, 0, MAT.STONE);
  e.paintDiscLayer(1, 44, FLOOR - 1, 0, MAT.STONE, true);
  e.syncComponentsLayer(1);
  e.setSelectedSlot(id, 8); // empty arsenal slot -> legacy bare-hand mining
  e.setSelectedFootprint(id, 0);
  for (let s = 0; s < 40; s++) {
    e.setPlayerInput(id, { bits: PI_SECONDARY, aimX: 44.5, aimY: FLOOR - 1 + 0.5, seq: s + 1 });
    t += 16; e.step(t);
  }
  const k = (FLOOR - 1) * COLS + 44;
  const fgCell = e.getGrid()[k];
  const bgCell = e.getGridBg()[k];
  check(`secondary mining clears foreground and background stone (${fgCell} fg, ${bgCell} bg)`, fgCell === MAT.EMPTY && bgCell === MAT.EMPTY);
  e.destroy();
}

// 6b) The fast universal dig tool still charges more work for a larger selected
//     footprint. At the new 10x rate, integer damage floors 1x1 to one tick and
//     the default 3x3 footprint to five.
{
  const mineTicks = (footprintId) => {
    const e = survivalEngine();
    const id = e.spawnPlayer(10, FLOOR - 8);
    e.addToInventory(id, MAT.WOOD, 24);
    e.craft(id, 0);
    e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((slot) => slot.isTool));
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
  check(`boosted 1x1 mine ticks (${one})`, one === 1);
  check(`boosted 3x3 footprint still costs more work (${three} vs ${one})`, three === 5);
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

// 7b) RMB places selected materials into the background in survival inventory:
//     component drafts, seeds, and loose materials all route by button.
{
  const PI_SECONDARY = 32;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 9);
  let t = 0; for (let s = 0; s < 8; s++) { t += 16; e.step(t); }
  e.setSelectedFootprint(id, 0);
  e.addToInventory(id, MAT.STONE, 4);
  e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.STONE && s.count > 0));
  const bgStoneBefore = e.getGridBg().reduce((a, v) => a + (v === MAT.STONE), 0);
  let seq = 300;
  e.setPlayerInput(id, { bits: PI_SECONDARY, aimX: 50.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t);
  e.setPlayerInput(id, { bits: 0, aimX: 50.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t);
  const bgStoneAfter = e.getGridBg().reduce((a, v) => a + (v === MAT.STONE), 0);
  const fgStoneAtAim = e.getGrid()[(FLOOR - 6) * COLS + 50];
  check(`RMB survival stone draft materializes in background (${bgStoneBefore} -> ${bgStoneAfter}, fg ${fgStoneAtAim})`,
    bgStoneAfter > bgStoneBefore && fgStoneAtAim !== MAT.STONE);

  e.addToInventory(id, MAT.SEED, 1);
  e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.SEED && s.count > 0));
  const bgSeedBefore = e.getGridBg().reduce((a, v) => a + (v === MAT.SEED), 0);
  e.setPlayerInput(id, { bits: PI_SECONDARY, aimX: 52.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t);
  const bgSeedAfter = e.getGridBg().reduce((a, v) => a + (v === MAT.SEED), 0);
  const fgSeedAtAim = e.getGrid()[(FLOOR - 6) * COLS + 52];
  check(`RMB survival seed places in background (${bgSeedBefore} -> ${bgSeedAfter}, fg ${fgSeedAtAim})`,
    bgSeedAfter === bgSeedBefore + 1 && fgSeedAtAim !== MAT.SEED);

  e.addToInventory(id, MAT.WATER, 1);
  e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.WATER && s.count > 0));
  const bgWaterBefore = e.getGridBg().reduce((a, v) => a + (v === MAT.WATER), 0);
  // Keep this clear of the seed's first growth cells so it tests routing, not
  // immediate plant/water interaction.
  e.setPlayerInput(id, { bits: PI_SECONDARY, aimX: 58.5, aimY: FLOOR - 6 + 0.5, seq: ++seq }); t += 16; e.step(t);
  const bgWaterAfter = e.getGridBg().reduce((a, v) => a + (v === MAT.WATER), 0);
  check(`RMB survival loose material places in background (${bgWaterBefore} -> ${bgWaterAfter})`, bgWaterAfter > bgWaterBefore);
  e.destroy();
}

// 7c) Survival component drafts interpolate between aim samples and stop
// contiguously when the selected stack runs out.
{
  const PI_PRIMARY = 16;
  const e = survivalEngine();
  const id = e.spawnPlayer(40, FLOOR - 9);
  let t = 0; for (let s = 0; s < 8; s++) { t += 16; e.step(t); }
  e.setSelectedFootprint(id, 0); // 1x1 makes gaps/counting exact.
  e.addToInventory(id, MAT.STONE, 8);
  e.setSelectedSlot(id, e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.STONE && s.count > 0));
  let seq = 400;
  e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 45.5, aimY: FLOOR - 14 + 0.5, seq: ++seq }); t += 16; e.step(t);
  e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 55.5, aimY: FLOOR - 14 + 0.5, seq: ++seq }); t += 16; e.step(t);
  const cells = e.getStoneDraftCells();
  let continuous = cells.length === 8;
  for (let x = 45; x <= 52; x++) if (!hasDraftCell(cells, x, FLOOR - 14)) continuous = false;
  for (let x = 53; x <= 55; x++) if (hasDraftCell(cells, x, FLOOR - 14)) continuous = false;
  check(`survival draft interpolates until inventory runs out (${cells.length} staged)`, continuous);
  check('survival interpolation consumed exactly the staged cells', slotCount(e, id, MAT.STONE) === 0);
  const beforeRelease = e.getGrid().reduce((a, v) => a + (v === MAT.STONE), 0);
  e.setPlayerInput(id, { bits: 0, aimX: 55.5, aimY: FLOOR - 14 + 0.5, seq: ++seq }); t += 16; e.step(t);
  const afterRelease = e.getGrid().reduce((a, v) => a + (v === MAT.STONE), 0);
  check(`release after runout materializes the capped draft (+${afterRelease - beforeRelease})`, afterRelease - beforeRelease === 8);
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
