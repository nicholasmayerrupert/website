import assert from 'node:assert/strict';
import { GEAR_FAMILY, WAND_SOCKET } from '../src/sand/wasmBridge/abi.generated.js';
import { EQUIPMENT_BY_ID } from '../src/sand/content/equipment.js';

// Configure an ordinary inventory wand through the same socket API as the HUD.
export function equipWandSpell(engine, player, spell, hotbar = 5) {
  assert.equal(EQUIPMENT_BY_ID[spell]?.family, GEAR_FAMILY.SPELL);
  assert.equal(engine.getCursor(player), null, 'fixture needs an empty inventory cursor');
  let inventory = engine.getInventory(player);
  let wand = inventory.slots.findIndex(item => item.count && item.wand);
  if (wand < 0) {
    assert.ok(engine.addGear(player, 13));
    wand = engine.getInventory(player).slots.findIndex(item => item.count && item.wand);
  }
  if (wand !== hotbar) engine.inventoryMove(player, wand, hotbar);
  if (engine.getInventory(player).slots[hotbar].wand.spells[0] !== spell) {
    if (!engine.getInventory(player).slots.some(item => item.definitionId === spell && item.count)) assert.ok(engine.addGear(player, spell));
    const source = engine.getInventory(player).slots.findIndex(item => item.definitionId === spell && item.count);
    engine.inventoryCursorPick(player, source, false);
    assert.ok(engine.wandSocket(player, hotbar, WAND_SOCKET.SPELL, 0));
    if (engine.getCursor(player)) {
      inventory = engine.getInventory(player);
      const empty = inventory.slots.findIndex((item, index) => index >= 9 && !item.count);
      assert.ok(empty >= 0); engine.inventoryCursorPick(player, empty, false);
    }
  }
  engine.setSelectedSlot(player, hotbar);
  return hotbar;
}
