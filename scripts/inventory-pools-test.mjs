import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { POOL_ACTION, ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

await initSandWasm();
const make = () => {
  const e = createEngineWasm({ cols: 120, rows: 100, worldSeed: 4, infinite: false, sinksOn: false });
  e.setSurvivalInventory(true);
  const id = e.spawnPlayer(40, 40);
  e.setSelectedFootprint(id, 0);
  return { e, id };
};
const count = (e, id, material) => e.getInventoryPools(id).flatMap((p) => p.entries).find((r) => r.material === material)?.count || 0;
const held = (e, id) => { const inv = e.getInventory(id); return inv.slots[inv.selected]; };

{
  const { e, id } = make();
  try {
    const inv = e.getInventory(id);
    assert.equal(inv.slots.length, 36);
    assert.deepEqual(inv.slots.map((s, i) => s.pool ? [i, s.pool] : null).filter(Boolean), [[6, 1], [7, 2], [8, 3]]);
    assert.equal(inv.slots[0].itemKind, ITEM_KIND.BLAST_GUN);
    assert.ok(e.addToInventory(id, MAT.STONE, 100000003));
    assert.ok(e.addToInventory(id, MAT.WOOD, 100));
    assert.equal(count(e, id, MAT.STONE), 100000003, 'pool counts retain int32 precision beyond float32 exact integers');
    e.setSelectedSlot(id, 6);
    assert.equal(held(e, id).count, 100000003);
    const before = e.inventoryHash(id);
    e.inventoryPoolAction(id, 1, POOL_ACTION.ENABLE, MAT.STONE, 0);
    assert.notEqual(e.inventoryHash(id), before, 'disabled state changes the worker snapshot hash');
    assert.equal(held(e, id).material, MAT.WOOD);
    e.inventoryPoolAction(id, 1, POOL_ACTION.ENABLE, MAT.STONE, 1);
    e.inventoryPoolAction(id, 1, POOL_ACTION.MOVE, MAT.WOOD, 0);
    assert.equal(held(e, id).material, MAT.WOOD);
    e.inventoryPoolAction(id, 1, POOL_ACTION.SELECT, MAT.STONE);
    assert.equal(held(e, id).material, MAT.STONE, 'exact selection overrides queue order');
    e.inventoryPoolAction(id, 1, POOL_ACTION.WITHDRAW, MAT.STONE, 999);
    assert.equal(e.getCursor(id).count, 999);
    e.inventoryCursorPick(id, 2, false);
    assert.equal(e.getInventory(id).slots[2].count, 999);
    assert.equal(e.getInventory(id).slots[2].pool, 0, 'withdrawn material is a normal stack');
    e.inventoryCursorPick(id, 2, true);
    e.inventoryCursorPick(id, 6, true);
    assert.equal(e.getCursor(id).count, 499, 'right-click deposits one unit');
    e.inventoryCursorPick(id, 6, false);
    assert.equal(e.getCursor(id), null);
    e.inventoryPoolAction(id, 1, POOL_ACTION.DEPOSIT);
    assert.equal(count(e, id, MAT.STONE), 100000003, 'stack transfers conserve every unit');
    e.inventoryMove(id, 6, 20);
    assert.equal(e.getInventory(id).slots[20].pool, 1);
    assert.equal(count(e, id, MAT.WOOD), 100, 'moving a pool preserves its contents');
    e.inventoryCursorPick(id, 20, false);
    assert.equal(e.getCursor(id).pool, 1);
    assert.equal(e.throwFromCursor(id, true), false, 'pool containers cannot lose their contents through a throw');
    assert.ok(e.addToInventory(id, MAT.WOOD, 2), 'pickup works while carrying the container');
    e.inventoryCursorPick(id, 6, false);
    const unchanged = e.inventoryHash(id);
    e.inventoryPoolAction(id, 9, POOL_ACTION.WITHDRAW, MAT.WOOD, 5);
    e.inventoryPoolAction(id, 1, POOL_ACTION.SELECT, MAT.WATER);
    e.inventoryPoolAction(id, 1, POOL_ACTION.ENABLE, 999, 1);
    assert.equal(e.inventoryHash(id), unchanged, 'invalid pool requests are no-ops');
    assert.equal(e.addToInventory(id, MAT.STONE, 2147483647), false);
    assert.equal(count(e, id, MAT.STONE), 100000003, 'integer overflow cannot silently discard stored materials');
  } finally { e.destroy(); }
}

{
  const { e, id } = make();
  try {
    e.addToInventory(id, MAT.SAND, 1); e.addToInventory(id, MAT.DIRT, 3);
    e.setSelectedSlot(id, 7);
    assert.ok(e.placeFromSelected(id, 60, 20));
    assert.equal(e.getGrid()[20 * 120 + 60], MAT.SAND);
    assert.equal(held(e, id).material, MAT.DIRT);
    assert.ok(e.placeFromSelected(id, 61, 20));
    assert.equal(e.getGrid()[20 * 120 + 61], MAT.DIRT);
    e.inventoryPoolAction(id, 2, POOL_ACTION.SELECT, MAT.SAND);
    assert.equal(e.placeFromSelected(id, 62, 20), false, 'an exhausted exact selection stops');
    assert.equal(count(e, id, MAT.DIRT), 2);
    e.addToInventory(id, MAT.WATER, 1); e.addToInventory(id, MAT.ACID, 10);
    e.setSelectedSlot(id, 8);
    assert.equal(e.getInventoryPools(id)[2].exactMaterial, MAT.WATER);
    assert.ok(e.placeFromSelected(id, 64, 20));
    assert.equal(e.placeFromSelected(id, 65, 20), false, 'water does not automatically become acid');
    e.inventoryPoolAction(id, 3, POOL_ACTION.SELECT, 0);
    assert.equal(e.placeFromSelected(id, 65, 20), false, 'hazards begin excluded from Auto');
    e.inventoryPoolAction(id, 3, POOL_ACTION.ENABLE, MAT.ACID, 1);
    assert.ok(e.placeFromSelected(id, 65, 20));
    assert.equal(count(e, id, MAT.ACID), 9);
  } finally { e.destroy(); }
}

{
  const { e, id } = make();
  try {
    e.addToInventory(id, MAT.STONE, 1); e.addToInventory(id, MAT.WOOD, 10);
    e.setSelectedSlot(id, 6);
    let seq = 0;
    const input = (bits, x) => { e.setPlayerInput(id, { bits, aimX: x, aimY: 40, seq: ++seq }); e.stepActors(); };
    input(INPUT.PRIMARY, 50);
    assert.equal(count(e, id, MAT.STONE), 0);
    input(INPUT.PRIMARY, 51);
    assert.equal(count(e, id, MAT.WOOD), 10, 'a solid draft cannot silently switch material while held');
    input(0, 51);
    input(INPUT.PRIMARY, 51);
    assert.equal(count(e, id, MAT.WOOD), 9, 'the next solid placement advances the queue');
    input(0, 51);
    e.setSelectedSlot(id, 7);
    const before = e.getGrid()[40 * 120 + 50];
    for (let i = 0; i < 30; i++) input(INPUT.PRIMARY, 50);
    assert.equal(e.getGrid()[40 * 120 + 50], before, 'an empty pool never turns into a mining tool');
    e.addToInventory(id, MAT.CLAY, 8);
    e.inventoryPoolAction(id, 2, POOL_ACTION.ENABLE, MAT.CLAY, 0);
    assert.equal(e.craft(id, 6), 1, 'crafting can spend stored materials disabled for placement');
    assert.equal(count(e, id, MAT.CLAY), 0);
    assert.equal(count(e, id, MAT.BRICK), 8);
    assert.equal(e.craft(id, 6), 0, 'insufficient ingredients cannot craft');
  } finally { e.destroy(); }
}
{
  const { e, id } = make();
  try {
    attachTestHooks(e);
    e.addToInventory(id, MAT.STONE, 25000);
    e.addToInventory(id, MAT.WATER, 12000);
    e._damagePlayer(id, 999);
    const items = e.getItems().filter((item) => item.itemKind === ITEM_KIND.MATERIAL);
    for (const [material, quantity] of [[MAT.STONE, 25000], [MAT.WATER, 12000]]) {
      assert.equal(items.filter((item) => item.material === material).reduce((n, item) => n + item.count, 0), quantity,
        'death drops conserve pooled quantities');
      assert.equal(count(e, id, material), 0);
    }
    assert.equal(items.length, 2, 'death drops use one bulk item per stored material');
  } finally { e.destroy(); }
}
console.log('Inventory pool storage, queues, exact selection, transfers, placement, crafting and death drops pass.');
