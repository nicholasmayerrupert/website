// Verifies the snapshot shapes consumed by the HUD and intent round trips. Browser
// dialog/accessibility coverage lives in player-e2e.mjs.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { mergePlayerPrediction } from '../src/sand/worker/playerPresentation.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('inventory bridge');

const e = createEngineWasm({ cols: 100, rows: 80, worldSeed: 1, sinksOn: false, infinite: false });
e.setSurvivalInventory(true);
const id = e.spawnPlayer(40, 40);

// Local prediction may smooth movement, but must never replace survival state
// from the worker snapshot (the HUD reads this merged presentation record).
const authoritative = {
  id, x: 10, y: 20, health: 63, alive: true, deathTicks: 12,
  respawnReady: false, bowCharge: 0.8, heldItemKind: ITEM_KIND.BOW,
};
const predicted = {
  x: 11.5, y: 19.5, vx: 2, vy: -1, health: 100, alive: true,
  deathTicks: 0, respawnReady: false, bowCharge: 0, heldItemKind: 0,
};
const presented = mergePlayerPrediction(authoritative, predicted, id);
check('prediction supplies responsive player position', presented.x === 11.5 && presented.y === 19.5);
check('worker health remains authoritative for the HUD', presented.health === 63);
check('worker bow/death state survives prediction', presented.bowCharge === 0.8 && presented.heldItemKind === ITEM_KIND.BOW && presented.deathTicks === 12);

// Fresh explosive-survival inventories select the starter gun in slot 0 and
// keep the universal mining tool ready in slot 1.
const inv = e.getInventory(id);
check(`getInventory returns 36 slots (${inv.slots.length})`, inv.slots.length === 36);
check(`starter weapon selected by default (${inv.selected})`, inv.selected === 0);
check('slot 0 starts with one blast gun', inv.slots[0].itemKind === ITEM_KIND.BLAST_GUN && inv.slots[0].count === 1);
check('slot 1 starts with the universal wood mining tool',
  inv.slots[1].itemKind === ITEM_KIND.MINING_TOOL && inv.slots[1].isTool
    && inv.slots[1].toolClass === TC.dig && inv.slots[1].toolTier === TT.wood && inv.slots[1].count === 1);
check('slot 3 is an empty selectable bare-hand slot', inv.slots[3].count === 0);

// Crafting remains available and can make a second universal mining tool.
e.addToInventory(id, MAT.WOOD, 24);
const beforeTools = e.getInventory(id).slots.filter((s) => s.itemKind === ITEM_KIND.MINING_TOOL && s.count > 0).length;
check('wood mining tool recipe crafts once', e.craft(id, 0) === 1);
const tools = e.getInventory(id).slots.filter((s) => s.itemKind === ITEM_KIND.MINING_TOOL && s.count > 0);
check('crafted tool adds a second universal wood tier tool',
  tools.length === beforeTools + 1 && tools.every((s) => s.isTool && s.toolClass === TC.dig && s.toolTier === TT.wood));

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
