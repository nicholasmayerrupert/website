// Phase E: the JS<->engine inventory bridge (no DOM). Verifies the snapshot shapes
// the HUD consumes and the intents it forwards round-trip through the engine. The
// HUD DOM itself is verified manually in-browser. Run: node scripts/inventory-bridge-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('inventory bridge (Phase E)');

const e = createEngineWasm({ cols: 100, rows: 80, worldSeed: 1, sinksOn: false, infinite: false });
e.setSurvivalInventory(true);
const id = e.spawnPlayer(40, 40);

// getInventory shape + starter kit (wood pickaxe/axe/shovel; no hand slot; pickaxe selected).
const inv = e.getInventory(id);
check(`getInventory returns 36 slots (${inv.slots.length})`, inv.slots.length === 36);
check(`pickaxe slot selected by default (${inv.selected})`, inv.selected === 0);
check('slot 0 is a wood pickaxe', inv.slots[0].isTool && inv.slots[0].toolClass === TC.pickaxe && inv.slots[0].toolTier === TT.wood);
check('slot 1 is a wood axe', inv.slots[1].isTool && inv.slots[1].toolClass === TC.axe);
check('slot 3 is empty (no hand slot)', inv.slots[3].count === 0);

// setSelectedSlot round-trips.
e.setSelectedSlot(id, 3);
check('setSelectedSlot round-trips (3)', e.getInventory(id).selected === 3);

// cycleSelectedSlot wraps within the hotbar.
e.setSelectedSlot(id, 8);
e.cycleSelectedSlot(id, 1);
check('cycle wraps 8 -> 0', e.getInventory(id).selected === 0);
e.cycleSelectedSlot(id, -1);
check('cycle wraps 0 -> 8', e.getInventory(id).selected === 8);

// inventoryMove swaps two slots.
e.addToInventory(id, MAT.STONE, 7);
const stoneIdx = e.getInventory(id).slots.findIndex((s) => !s.isTool && s.material === MAT.STONE);
e.inventoryMove(id, stoneIdx, 20);
const after = e.getInventory(id);
check(`inventoryMove relocates the stack (${stoneIdx} -> 20)`, after.slots[20].material === MAT.STONE && after.slots[20].count === 7 && after.slots[stoneIdx].count === 0);

// getItems shape.
e.spawnItem(MAT.WOOD, 2, 30, 10, 0, 0);
const items = e.getItems();
const it = items[items.length - 1];
check('getItems returns shaped records', it && it.material === MAT.WOOD && it.count === 2 && it.kind === 0 && typeof it.x === 'number');

e.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
