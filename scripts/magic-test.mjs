import assert from 'node:assert/strict';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { PROJECTILE_KIND, MISSION } from '../src/sand/wasmBridge/abi.generated.js';

await initSandWasm();
const options = { cols: 240, rows: 144, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER };
const tick = (e, n = 1) => { for (let i = 0; i < n; i++) e.stepActors(); };
const input = (e, id, bits = 0, aimX = 180, aimY = 92) => e.setPlayerInput(id, { bits, aimX, aimY });
function arena(label, run) {
  const e = createEngineWasm(options);
  try {
    e.setSurvivalInventory(true); e.setCreatureRuntime(false, false);
    for (let x = 0; x < e.cols; x++) for (let y = 110; y < e.rows; y++) e.paintDisc(x, y, 0, MAT.STONE, true);
    e.syncComponents();
    const id = e.spawnPlayer(40, 102);
    const slot = e.getInventory(id).slots.findIndex(item => item.definitionId === 13);
    e.inventoryMove(id, slot, 5); e.setSelectedSlot(id, 5);
    run(e, id);
    console.log('ok:', label);
  } finally { e.destroy(); }
}
function stashCursor(e, id) {
  if (!e.getCursor(id)) return;
  const empty = e.getInventory(id).slots.findIndex((item, i) => i >= 9 && !item.count);
  assert.ok(empty >= 0); e.inventoryCursorPick(id, empty, false);
  assert.equal(e.getCursor(id), null);
}
function socket(e, id, kind, index, definition, wand = 5) {
  stashCursor(e, id);
  if (definition) {
    let from = e.getInventory(id).slots.findIndex(item => item.definitionId === definition);
    if (from < 0) { assert.ok(e.addGear(id, definition)); from = e.getInventory(id).slots.findIndex(item => item.definitionId === definition); }
    e.inventoryCursorPick(id, from, false);
  }
  assert.ok(e.wandSocket(id, wand, kind, index), `socket ${definition} into ${kind}:${index}`);
  stashCursor(e, id);
}
function cast(e, id, aimX = 180, aimY = 92) {
  input(e, id, INPUT.PRIMARY, aimX, aimY); tick(e); input(e, id, 0, aimX, aimY);
}
const wand = (e, id, slot = 5) => e.getInventory(id).slots[slot].wand;

arena('one player mana pool pays both wands; switching cannot refill it', (e, id) => {
  assert.equal(e.getPlayer(id).manaMax, 100);
  assert.equal(e.getPlayer(id).manaCastCost, 18);
  cast(e, id); assert.equal(e.getPlayer(id).mana, 82);
  const mana = e.getPlayer(id).mana;
  assert.ok(e.addGear(id, 14));
  const second = e.getInventory(id).slots.findIndex(item => item.definitionId === 14);
  e.inventoryMove(id, second, 2); e.setSelectedSlot(id, 2);
  assert.equal(e.getPlayer(id).mana, mana);
  tick(e, 36);
  const before = e.getPlayer(id).mana;
  cast(e, id); assert.ok(e.getPlayer(id).mana <= before - 19);
  assert.equal(e.getInventory(id).slots[2].wand.mana, undefined);
  const other = e.spawnPlayer(20, 102);
  assert.equal(e.getPlayer(other).mana, 100, 'another player has their own pool');
});

arena('regeneration uses alive player ticks and does not bank at full mana', (e, id) => {
  tick(e, 37); cast(e, id);
  assert.equal(e.getPlayer(id).mana, 82);
  tick(e, 14); assert.equal(e.getPlayer(id).mana, 82);
  tick(e); assert.equal(e.getPlayer(id).mana, 83);
  tick(e, 15 * 30); assert.equal(e.getPlayer(id).mana, 100);
  cast(e, id); assert.equal(e.getPlayer(id).mana, 82);
  tick(e); assert.equal(e.getPlayer(id).mana, 82);
});

arena('separate socket types conserve runes and upgrades through swapping', (e, id) => {
  const potion = e.getInventory(id).slots.findIndex(item => item.definitionId === 320);
  e.inventoryCursorPick(id, potion, false);
  const before = e.getInventory(id), cursor = e.getCursor(id);
  assert.equal(e.wandSocket(id, 5, 0, 0), false);
  assert.deepEqual(e.getInventory(id), before); assert.deepEqual(e.getCursor(id), cursor);
  stashCursor(e, id);
  socket(e, id, 0, 1, 301); socket(e, id, 1, 0, 501);
  assert.deepEqual(wand(e, id).spells, [300, 301, 0]);
  assert.deepEqual(wand(e, id).upgrades, [501, 0]);
  assert.equal(e.wandSocket(id, 5, 0, 3), false, 'capacity is enforced');
  assert.ok(e.wandSocket(id, 5, 0, 0));
  assert.equal(e.getCursor(id).definitionId, 300);
  assert.equal(e.wandSocket(id, 5, 1, 1), false, 'a spell cannot occupy an upgrade socket');
  assert.ok(e.wandSocket(id, 5, 0, 1));
  assert.equal(e.getCursor(id).definitionId, 301);
  assert.deepEqual(wand(e, id).spells, [0, 300, 0]);
});

arena('spells cycle left to right and an unaffordable spell is never skipped', (e, id) => {
  socket(e, id, 1, 0, 500); socket(e, id, 1, 1, 503);
  assert.equal(e.getPlayer(id).manaCastCost, 72);
  cast(e, id); assert.equal(e.getPlayer(id).mana, 28);
  tick(e, 36);
  socket(e, id, 1, 0, 0); socket(e, id, 1, 1, 0);
  socket(e, id, 0, 0, 307); socket(e, id, 0, 1, 300);
  const mana = e.getPlayer(id).mana;
  cast(e, id); assert.equal(wand(e, id).next, 0); assert.ok(e.getPlayer(id).mana >= mana);
  assert.equal(e.getPlayer(id).actionTicks, 0);
  while (e.getPlayer(id).mana < 42) tick(e);
  cast(e, id); assert.equal(wand(e, id).next, 1);
  assert.equal(e.getPlayer(id).manaCastCost, 18);
  tick(e, 36);
  while (e.getPlayer(id).mana < 18) tick(e);
  cast(e, id); assert.equal(wand(e, id).next, 0);
});

arena('multishot and power multiply real projectiles and pay the complete cost', (e, id) => {
  socket(e, id, 1, 0, 500); socket(e, id, 1, 1, 503);
  cast(e, id); input(e, id, 0, 210, 50); tick(e, 12);
  const bolts = e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.RUNE);
  assert.equal(bolts.length, 2);
  assert.ok(bolts.every(p => p.charge === 44));
  assert.equal(e.getPlayer(id).mana, 28);
  assert.equal(e.wandSocket(id, 5, 1, 0), false, 'a committed cast prevents socket edits');
});

arena('charge is affordable, pays on release and cancels cleanly on switching or guard', (e, id) => {
  socket(e, id, 1, 0, 502);
  input(e, id, INPUT.PRIMARY); tick(e, 61);
  assert.equal(e.getPlayer(id).mana, 100); assert.equal(e.getPlayer(id).spellCharge, 1);
  assert.equal(e.getPlayer(id).manaCastCost, 36);
  input(e, id); tick(e); assert.equal(e.getPlayer(id).mana, 64);
  assert.equal(e.getPlayer(id).spellCharge, 0);
  tick(e, 36); const before = e.getPlayer(id).mana;
  input(e, id, INPUT.PRIMARY); tick(e, 10); e.setSelectedSlot(id, 0);
  input(e, id); tick(e); assert.equal(e.getPlayer(id).spellCharge, 0);
  assert.ok(e.getPlayer(id).mana >= before);
  e.setSelectedSlot(id, 5); input(e, id, INPUT.PRIMARY); tick(e, 10);
  input(e, id, INPUT.PRIMARY | INPUT.SHIELD); tick(e); assert.equal(e.getPlayer(id).spellCharge, 0);
  input(e, id, INPUT.PRIMARY); tick(e, 10);
  e.inventoryMove(id, 5, 8); assert.equal(e.getPlayer(id).spellCharge, 0);
});

arena('impact payloads are prepaid and survive a checkpoint and later socket edits', (e, id) => {
  assert.ok(e.startMission(MISSION.FRONTIER, id));
  socket(e, id, 0, 0, 307); socket(e, id, 0, 1, 300); socket(e, id, 1, 0, 505);
  assert.equal(e.getPlayer(id).manaCastCost, 60);
  cast(e, id, 100, 70); assert.equal(e.getPlayer(id).mana, 40);
  tick(e, 13);
  const saved = e.writeCheckpoint(), restored = createEngineWasm(options);
  try {
    assert.ok(restored.readCheckpoint(saved));
    assert.equal(restored.getPlayer(id).mana, e.getPlayer(id).mana);
    assert.deepEqual(restored.getProjectiles(), e.getProjectiles());
    tick(e, 24); tick(restored, 24);
    socket(e, id, 0, 1, 301); socket(restored, id, 0, 1, 301);
    let delivered = false;
    for (let i = 0; i < 120; i++) {
      tick(e); tick(restored);
      if (e.getProjectiles().some(p => p.fuse === 300 && p.kind === PROJECTILE_KIND.RUNE)) { delivered = true; break; }
    }
    assert.ok(delivered, 'the paid Ember payload remains Ember after editing the wand');
    assert.deepEqual(restored.getProjectiles(), e.getProjectiles());
    assert.equal(restored.getPlayer(id).mana, e.getPlayer(id).mana);
    assert.ok(e.getPlayer(id).mana >= 40, 'payload emission never charges mana again');
  } finally { restored.destroy(); }
});

arena('trigger fan-out is fully priced before accepting a cast', (e, id) => {
  socket(e, id, 0, 0, 306); socket(e, id, 0, 1, 300); socket(e, id, 1, 0, 505);
  assert.equal(e.getPlayer(id).manaCastCost, 24 + 5 * 18);
  cast(e, id); assert.equal(e.getPlayer(id).mana, 100);
  assert.equal(e.getPlayer(id).actionTicks, 0); assert.equal(wand(e, id).next, 0);
  assert.equal(e.getProjectiles().length, 0);
});

arena('wand recipes and sequence positions travel with dropped items', (e, id) => {
  assert.ok(e.startMission(MISSION.FRONTIER, id));
  socket(e, id, 0, 1, 301); socket(e, id, 1, 0, 501);
  cast(e, id); tick(e, 36);
  const configured = wand(e, id);
  e.inventoryCursorPick(id, 5, false); assert.ok(e.throwFromCursor(id, true));
  const dropped = e.getItems().find(item => item.definitionId === 13); assert.ok(dropped);
  const saved = e.writeCheckpoint(); assert.ok(e.readCheckpoint(saved));
  for (let i = 0; i < 70; i++) {
    const item = e.getItems().find(item => item.definitionId === 13);
    if (!item) break;
    e.setPlayerState(id, { ...e.getPlayer(id), x: item.x - 2, y: item.y - 4 }); tick(e);
  }
  const recovered = e.getInventory(id).slots.find(item => item.definitionId === 13);
  assert.ok(recovered); assert.deepEqual(recovered.wand, configured);
});

arena('together emits both spells once and timer payloads wait for their carrier', (e, id) => {
  socket(e, id, 0, 1, 301); socket(e, id, 1, 0, 504);
  assert.equal(e.getPlayer(id).manaCastCost, 38);
  cast(e, id, 210, 40); tick(e, 12);
  assert.deepEqual(e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.RUNE).map(p => p.fuse).sort(), [300, 301]);
  tick(e, 36); socket(e, id, 1, 0, 506);
  const before = e.getPlayer(id).mana;
  cast(e, id, 210, 40); tick(e, 12);
  assert.ok(e.getPlayer(id).mana <= before - 37);
  assert.equal(e.getProjectiles().filter(p => p.fuse === 301 && p.kind === PROJECTILE_KIND.RUNE).length, 0);
  tick(e, 24);
  assert.equal(e.getProjectiles().filter(p => p.fuse === 301 && p.kind === PROJECTILE_KIND.RUNE).length, 1);
});

for (const definition of [300, 309, 310]) arena(`bounce reflects spell ${definition} before its terrain impact`, (e, id) => {
  for (let y = 1; y < 110; y++) e.paintDisc(80, y, 0, MAT.STONE, true);
  e.syncComponents();
  socket(e, id, 0, 0, definition); socket(e, id, 1, 0, 501);
  cast(e, id, 150, 96);
  let reflected = false;
  for (let i = 0; i < 55; i++) {
    tick(e);
    if (e.getProjectiles().some(p => p.kind === PROJECTILE_KIND.RUNE && p.vx < 0)) { reflected = true; break; }
  }
  assert.ok(reflected, 'the projectile reflects from the wall');
});

arena('charge can release at exactly its base mana cost', (e, id) => {
  socket(e, id, 1, 0, 500); socket(e, id, 1, 1, 503);
  cast(e, id); tick(e, 36);
  socket(e, id, 1, 0, 0); socket(e, id, 1, 1, 0);
  cast(e, id); tick(e, 36);
  socket(e, id, 1, 0, 502);
  while (e.getPlayer(id).mana < 18) tick(e);
  assert.equal(e.getPlayer(id).mana, 18);
  input(e, id, INPUT.PRIMARY); tick(e);
  assert.ok(e.getPlayer(id).spellCharge > 0);
  assert.equal(e.getPlayer(id).manaCastCost, 18);
  input(e, id); tick(e);
  assert.equal(e.getPlayer(id).mana, 0);
  assert.ok(e.getPlayer(id).actionTicks > 0);
});

for (let definition = 300; definition <= 310; definition++) arena(`loose rune ${definition} cannot cast or contain other items`, (e, id) => {
  assert.ok(e.addGear(id, definition));
  const source = e.getInventory(id).slots.findIndex(item => item.definitionId === definition);
  e.inventoryMove(id, source, 8); e.setSelectedSlot(id, 8);
  assert.equal(e.getInventory(id).slots[8].wand, undefined);
  assert.equal(e.getPlayer(id).manaCastCost, 0);
  attachTestHooks(e)._damagePlayer(id, 70);
  const health = e.getPlayer(id).health; assert.ok(health < 100);
  input(e, id, INPUT.PRIMARY); tick(e, 90); input(e, id);
  assert.equal(e.getPlayer(id).mana, 100);
  assert.equal(e.getPlayer(id).health, health, 'Lumen cannot heal from a loose rune');
  assert.equal(e.getPlayer(id).actionTicks, 0);
  assert.equal(e.getProjectiles().length, 0);
  for (const nested of [13, 301, 501]) {
    if (!e.getInventory(id).slots.some((item, index) => index !== 8 && item.definitionId === nested)) assert.ok(e.addGear(id, nested));
    const from = e.getInventory(id).slots.findIndex((item, index) => index !== 8 && item.definitionId === nested);
    e.inventoryCursorPick(id, from, false);
    const before = e.getInventory(id), cursor = e.getCursor(id);
    assert.equal(e.wandSocket(id, 8, 0, 0), false, 'a rune cannot contain a wand, rune, or upgrade');
    assert.deepEqual(e.getInventory(id), before); assert.deepEqual(e.getCursor(id), cursor);
    e.inventoryCursorPick(id, from, false);
  }
  e.inventoryCursorPick(id, 8, false);
  assert.equal(e.wandSocket(id, 5, 1, 0), false, 'a spell cannot occupy an upgrade socket');
  assert.ok(e.wandSocket(id, 5, 0, 0), 'the same rune fits a real wand');
  assert.equal(e.getCursor(id)?.wand, undefined, 'the removed rune is a plain item');
  stashCursor(e, id); e.setSelectedSlot(id, 5);
  assert.ok(e.getPlayer(id).manaCastCost > 0);
  cast(e, id); assert.ok(e.getPlayer(id).mana < 100);
});
