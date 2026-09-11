import assert from 'node:assert/strict';
import { EQUIPMENT_BY_ID } from '../src/sand/content/equipment.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { PROJECTILE_KIND, MISSION, CREATURE, STATUS_EFFECT, STATUS_ACTOR, GEAR_FAMILY, WORLD_FEATURE } from '../src/sand/wasmBridge/abi.generated.js';

await initSandWasm();
const options = { cols: 240, rows: 144, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER };
const tick = (e, n = 1) => { for (let i = 0; i < n; i++) e.stepActors(); };
const input = (e, id, bits = 0, aimX = 180, aimY = 92) => e.setPlayerInput(id, { bits, aimX, aimY });
function arena(label, run, overrides = {}) {
  const e = createEngineWasm({ ...options, ...overrides });
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

arena('new travellers carry elemental, healing and crystal options plus mana cordials', (e, id) => {
  const inventory = e.getInventory(id);
  assert.deepEqual(wand(e, id).spells, [300, 0, 0], 'Ember is ready to cast');
  for (const definition of [301, 302, 305, 306, 501, 503])
    assert.ok(inventory.slots.some(item => item.definitionId === definition && item.count === 1), `starter item ${definition} is available in the pack`);
  assert.equal(inventory.slots[4].definitionId, 321);
  assert.equal(inventory.slots[4].count, 3, 'three mana cordials are on the quickbar');
});

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
  assert.equal(e.getPlayer(id).manaCastCost, 24);
  for (let i = 0; i < 3; i++) { cast(e, id); tick(e, 36); }
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
  assert.equal(e.getPlayer(id).mana, 76);
  assert.equal(e.wandSocket(id, 5, 1, 0), false, 'a committed cast prevents socket edits');
});

arena('charge is affordable, pays on release and cancels cleanly on switching or guard', (e, id) => {
  socket(e, id, 1, 0, 502);
  input(e, id, INPUT.PRIMARY); tick(e, 61);
  assert.equal(e.getPlayer(id).mana, 100); assert.equal(e.getPlayer(id).spellCharge, 1);
  assert.equal(e.getPlayer(id).manaCastCost, 21);
  input(e, id); tick(e); assert.equal(e.getPlayer(id).mana, 79);
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
  const previous = new Set(e.getProjectiles().map(p => p.id));
  const before = e.getPlayer(id).mana;
  cast(e, id, 210, 40); tick(e, 12);
  assert.ok(e.getPlayer(id).mana <= before - 37);
  assert.equal(e.getProjectiles().filter(p => !previous.has(p.id) && p.fuse === 301 && p.kind === PROJECTILE_KIND.RUNE).length, 0);
  tick(e, 24);
  assert.equal(e.getProjectiles().filter(p => !previous.has(p.id) && p.fuse === 301 && p.kind === PROJECTILE_KIND.RUNE).length, 1);
});

for (const definition of [300, 309, 310]) arena(`bounce reflects spell ${definition} before its terrain impact`, (e, id) => {
  for (let y = 1; y < 110; y++) e.paintDisc(80, y, 0, MAT.STONE, true);
  e.syncComponents();
  socket(e, id, 0, 0, definition); socket(e, id, 1, 0, 501);
  cast(e, id, 150, 96);
  let reflected = false;
  for (let i = 0; i < 55; i++) {
    tick(e);
    if (e.getProjectiles().some(p => [PROJECTILE_KIND.RUNE, PROJECTILE_KIND.FROST_BREATH].includes(p.kind) && p.vx < 0)) { reflected = true; break; }
  }
  assert.ok(reflected, 'the projectile reflects from the wall');
});

arena('Sparks reflects like a mirror and shares its range across two ricochets', (e, id) => {
  for (const x of [25, 70]) for (let y = 1; y < 110; y++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  socket(e, id, 0, 0, 311); socket(e, id, 1, 0, 501);
  input(e, id, INPUT.PRIMARY, 180, 80); tick(e);
  const arcs = e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC);
  assert.equal(arcs.length, 3, 'two wall reflections make three connected segments');
  assert.ok(Math.abs(arcs.reduce((sum, p) => sum + p.charge, 0) - 96) < .001, 'reflections share the spell range');
  for (let i = 1; i < arcs.length; i++) {
    const before = arcs[i - 1], after = arcs[i];
    assert.ok(Math.abs(before.vx + after.vx) < 1e-8, 'vertical mirror reverses horizontal velocity');
    assert.ok(Math.abs(before.vy - after.vy) < 1e-8, 'vertical mirror preserves vertical velocity');
    assert.ok(Math.hypot(before.x + before.vx * before.charge - after.x, before.y + before.vy * before.charge - after.y) < 1e-4, 'segments meet at the reflection point');
  }
  tick(e, 12);
  assert.equal(e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC).length, 3, 'holding sustains the reflected path');
  assert.equal(e.getPlayer(id).health, 100, 'reflected lightning spares its caster');
  input(e, id); tick(e, 5);
  assert.equal(e.getProjectiles().length, 0, 'release clears every segment');
});

arena('a reflected arc shocks its target and delivers one connected payload', (e, id) => {
  for (let y = 1; y < 110; y++) e.paintDisc(70, y, 0, MAT.STONE, true);
  e.syncComponents();
  socket(e, id, 0, 0, 311); socket(e, id, 0, 1, 300);
  socket(e, id, 1, 0, 501); socket(e, id, 1, 1, 505);
  const victim = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 20 + e.getWorldOffsetX(), 98 + e.getWorldOffsetY());
  cast(e, id, 180, 102);
  assert.ok(e.getStatusEffects().some(s => s.actorId === victim && s.actorKind === STATUS_ACTOR.CREATURE && s.effect === STATUS_EFFECT.SHOCKED), 'returning arc shocks a creature behind the caster');
  assert.equal(e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC).length, 2, 'actor contact stops the reflected ray');
  tick(e, 4);
  assert.equal(e.getProjectiles().filter(p => p.fuse === 300).length, 1, 'intermediate terrain contact does not duplicate the payload');
});

arena('held Winterbreath preserves mirror angles at a wall', (e, id) => {
  for (let y = 1; y < 110; y++) e.paintDisc(70, y, 0, MAT.STONE, true);
  e.syncComponents();
  socket(e, id, 0, 0, 309); socket(e, id, 1, 0, 501);
  input(e, id, INPUT.PRIMARY, 160, 60);
  let reflections = 0;
  for (let turn = 0; turn < 36; turn++) {
    const before = new Map(e.getProjectiles().map(p => [p.id, p]));
    tick(e);
    for (const after of e.getProjectiles()) {
      const previous = before.get(after.id);
      if (after.kind !== PROJECTILE_KIND.FROST_BREATH || !previous || previous.vx <= 0 || after.vx >= 0) continue;
      assert.ok(Math.abs(previous.vx + after.vx) < 1e-8);
      assert.ok(Math.abs(previous.vy - after.vy) < 1e-8);
      reflections++;
    }
  }
  assert.ok(reflections >= 5, 'successive held frost pulses all follow the reflected stream');
});

arena('charge can release at exactly its base mana cost', (e, id) => {
  while (e.getPlayer(id).mana >= 18) { cast(e, id); tick(e, 36); }
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

for (let definition = 300; definition <= 311; definition++) arena(`loose rune ${definition} cannot cast or contain other items`, (e, id) => {
  assert.ok(e.addGear(id, definition));
  const source = e.getInventory(id).slots.findIndex(item => item.definitionId === definition);
  e.inventoryMove(id, source, 8); e.setSelectedSlot(id, 8);
  assert.equal(e.getInventory(id).slots[8].wand, undefined);
  assert.equal(e.getPlayer(id).manaCastCost, 0);
  attachTestHooks(e)._damagePlayer(id, 70);
  const health = e.getPlayer(id).health; assert.ok(health < 100);
  input(e, id, INPUT.PRIMARY); tick(e, 90); input(e, id); tick(e);
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

for (const stream of [309, 311]) arena(`hold spell ${stream}, release, then cast Ember once`, (e, id) => {
  socket(e, id, 0, 0, stream); socket(e, id, 0, 1, 300);
  input(e, id, INPUT.PRIMARY, 150, 70); tick(e, 30);
  assert.equal(wand(e, id).next, 1);
  assert.equal(e.getPlayer(id).manaCastCost, 1, 'preview prices the held pulse');
  assert.ok(e.getPlayer(id).mana >= 90 && e.getPlayer(id).mana <= 92);
  assert.ok(stream === 311 ? e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC).length === 1 : e.getProjectiles().filter(p => p.fuse === stream).length > 3, 'one lightning arc or overlapping frost pulses form a stream');
  assert.ok(!e.getProjectiles().some(p => p.fuse === 300), 'holding never switches to Ember');
  input(e, id, INPUT.PRIMARY, 5, 60); tick(e, 3);
  assert.ok(e.getProjectiles().some(p => p.fuse === stream && p.vx < 0), 'stream follows the aim');
  input(e, id); tick(e, 4);
  const last = Math.max(...e.getProjectiles().map(p => p.id));
  tick(e, 10); assert.ok(e.getProjectiles().every(p => p.id <= last), 'release stops new pulses');
  input(e, id, INPUT.PRIMARY, 210, 40); tick(e, 60);
  assert.equal(wand(e, id).next, 0, 'one press advances one ordinary spell');
  assert.ok(e.getProjectiles().every(p => p.fuse !== stream), 'the second hold never resumes the stream');
  input(e, id); tick(e); input(e, id, INPUT.PRIMARY); tick(e, 6);
  assert.ok(e.getProjectiles().some(p => p.fuse === stream), 'third press wraps to the stream');
  e.setSelectedSlot(id, 0); const mana = e.getPlayer(id).mana; tick(e, 9);
  assert.ok(e.getPlayer(id).mana >= mana, 'switching cancels ongoing mana drain');
});

arena('stream upgrades remain affordable and Charge does not defer the stream', (e, id) => {
  socket(e, id, 0, 0, 311); socket(e, id, 1, 0, 500); socket(e, id, 1, 1, 502);
  assert.equal(e.getPlayer(id).manaCastCost, 1);
  input(e, id, INPUT.PRIMARY); tick(e, 6);
  assert.ok(e.getProjectiles().some(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC && p.charge > 70));
  assert.equal(e.getPlayer(id).spellCharge, 0);
  const mana = e.getPlayer(id).mana;
  input(e, id, INPUT.PRIMARY | INPUT.SHIELD); tick(e, 12);
  assert.ok(e.getPlayer(id).mana >= mana, 'guard cancels the stream without further mana drain');
});

arena('sparks stun targets in front, respect walls, and spare the caster', (e, id) => {
  socket(e, id, 0, 0, 311);
  const victim = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 118 + e.getWorldOffsetX(), 98 + e.getWorldOffsetY());
  const behind = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 24 + e.getWorldOffsetX(), 98 + e.getWorldOffsetY());
  const protectedByWall = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 156 + e.getWorldOffsetX(), 98 + e.getWorldOffsetY());
  for (let y = 1; y < 110; y++) e.paintDisc(148, y, 0, MAT.STONE, true);
  e.syncComponents();
  const initialHealth = e.getCreatures().find(c => c.id === victim).health;
  input(e, id, INPUT.PRIMARY, 180, 102); tick(e);
  assert.equal(e.getCreatures().find(c => c.id === victim).health, initialHealth - 3, 'Sparks deals 3 direct damage');
  assert.equal(e.getStatusEffects().find(s => s.actorId === victim && s.effect === STATUS_EFFECT.SHOCKED).remainingTicks, 30);
  assert.equal(e.getProjectiles().filter(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC).length, 1);
  tick(e, 29);
  const statuses = e.getStatusEffects();
  assert.ok(statuses.some(s => s.actorId === victim && s.actorKind === STATUS_ACTOR.CREATURE && s.effect === STATUS_EFFECT.SHOCKED));
  for (const target of [behind, protectedByWall]) assert.ok(!statuses.some(s => s.actorId === target && s.actorKind === STATUS_ACTOR.CREATURE));
  assert.equal(e.getPlayer(id).health, 100);
  const contactHealth = e.getCreatures().find(c => c.id === victim).health;
  input(e, id); e.setCreatureRuntime(true, false); tick(e, 29);
  assert.equal(e.getStatusEffects().find(s => s.actorId === victim && s.effect === STATUS_EFFECT.SHOCKED).remainingTicks, 1, 'stun persists for half a second after contact');
  tick(e);
  assert.ok(!e.getStatusEffects().some(s => s.actorId === victim && s.effect === STATUS_EFFECT.SHOCKED), 'stun expires on tick 30');
  tick(e, 30);
  assert.ok(e.getCreatures().find(c => c.id === victim).health <= contactHealth - 4, 'electrification deals periodic damage after release');
  assert.ok(!e.getStatusEffects().some(s => s.effect === STATUS_EFFECT.SHOCKED), 'stun expires after the stream ends');
  assert.ok(e.getStatusEffects().some(s => s.actorId === victim && s.effect === STATUS_EFFECT.ELECTRIFIED), 'electrification outlasts contact');
  tick(e, 70);
  assert.ok(!e.getStatusEffects().some(s => s.effect === STATUS_EFFECT.ELECTRIFIED), 'electrification expires');
});

arena('a wall cuts the lightning arc before its target', (e, id) => {
  socket(e, id, 0, 0, 311);
  const victim = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 118 + e.getWorldOffsetX(), 98 + e.getWorldOffsetY());
  for (let y = 1; y < 110; y++) e.paintDisc(80, y, 0, MAT.STONE, true);
  e.syncComponents();
  cast(e, id, 180, 102);
  const beam = e.getProjectiles().find(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC);
  assert.ok(beam && beam.charge < 40, 'arc terminates on the wall');
  assert.ok(!e.getStatusEffects().some(s => s.actorId === victim), 'wall prevents shock and damage');
});

arena('Ember remains airborne beyond the lightning arc reach', (e, id) => {
  cast(e, id, 230, 100); tick(e, 58);
  const bolt = e.getProjectiles().find(p => p.fuse === 300 && p.kind === PROJECTILE_KIND.RUNE);
  assert.ok(bolt && bolt.x > e.getPlayer(id).x + 130, 'firebolt reaches distant targets beyond Sparks');
});

arena('a wand tip cannot project lightning through a nearby wall', (e, id) => {
  socket(e, id, 0, 0, 311);
  const victim = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 65 + e.getWorldOffsetX(), 98 + e.getWorldOffsetY());
  for (let y = 1; y < 110; y++) e.paintDisc(48, y, 0, MAT.STONE, true);
  e.syncComponents(); cast(e, id, 180, 102);
  const beam = e.getProjectiles().find(p => p.kind === PROJECTILE_KIND.LIGHTNING_ARC);
  assert.ok(beam && beam.x < 48 && beam.charge < 2, 'an occluded tip stops on the near wall face');
  assert.ok(!e.getStatusEffects().some(s => s.actorId === victim), 'no shock through the wall');
});

arena('coffers contain collectible runes and upgrades that survive loading', (e, id) => {
  assert.ok(e.startMission(MISSION.FRONTIER, id));
  for (const chestId of [1, 2, 3, 4]) {
    const chest = e.getChests().find(c => c.id === chestId);
    e.setPlayerState(id, { x: chest.worldX-e.getWorldOffsetX(), y: chest.worldY-e.getWorldOffsetY() });
    assert.ok(e.interactChest(id, chestId));
    const loot = e.getChestLoot().slots.filter(s => s.count);
    for (const family of [GEAR_FAMILY.SPELL, GEAR_FAMILY.UPGRADE])
      assert.ok(loot.some(s => EQUIPMENT_BY_ID[s.definitionId]?.family === family));
    const rune = loot.find(s => EQUIPMENT_BY_ID[s.definitionId]?.family === GEAR_FAMILY.SPELL);
    const slot = e.getChestLoot().slots.findIndex(s => s.definitionId === rune.definitionId);
    assert.ok(e.chestSlot(id, chestId, slot));
    assert.equal(e.getCursor(id).definitionId, rune.definitionId); stashCursor(e, id);
  }
  const saved = e.writeCheckpoint(); const chests = e.getChests();
  assert.ok(e.readCheckpoint(saved)); assert.deepEqual(e.getChests(), chests);
});

for (const stream of [309, 311]) arena(`checkpoints preserve paid ${stream} pulses but require a fresh hold`, (e, id) => {
  assert.ok(e.startMission(MISSION.FRONTIER, id));
  socket(e, id, 0, 0, stream); socket(e, id, 0, 1, 300);
  input(e, id, INPUT.PRIMARY, 150, 60); tick(e, 9);
  const saved = e.writeCheckpoint(), shots = e.getProjectiles(), mana = e.getPlayer(id).mana;
  assert.ok(e.readCheckpoint(saved)); assert.deepEqual(e.getProjectiles(), shots);
  tick(e, 9); assert.ok(e.getPlayer(id).mana >= mana, 'loading cannot resume unpaid mana drain');
  assert.equal(wand(e, id).next, 1, 'the successful stream advances once');
  cast(e, id); assert.ok(e.getPlayer(id).mana <= mana - 16, 'a fresh press selects Ember');
});

arena('village chests generate rune and upgrade loot once', (e, id) => {
  let building;
  for (let x = 1600; x < 7000 && !building; x += 8) {
    const surface = e.worldSurfaceAbsAt(x);
    for (let y = surface-40; y < surface; y += 4) {
      const context = e.worldContextAt(x,y);
      if (context.featureKind === WORLD_FEATURE.VILLAGE_BUILDING) { building = context; break; }
    }
  }
  assert.ok(building, 'a procedural building is available');
  const x = Math.floor((building.bounds.left+building.bounds.right)/2);
  const y = building.bounds.bottom-8;
  const ox = Math.floor((x-120)/64)*64, oy = Math.floor((y-80)/64)*64;
  while (e.getWorldOffsetX() !== ox) e.shiftWorldXY(Math.sign(ox-e.getWorldOffsetX())*Math.min(128,Math.abs(ox-e.getWorldOffsetX())),0);
  while (e.getWorldOffsetY() !== oy) e.shiftWorldXY(0,Math.sign(oy-e.getWorldOffsetY())*Math.min(64,Math.abs(oy-e.getWorldOffsetY())));
  e.setPlayerState(id,{x:x-ox,y:y-oy}); tick(e);
  const chest = e.getChests().find(c => c.id >= 1000000);
  assert.ok(chest, 'loaded village building spawns a chest');
  e.setPlayerState(id,{x:chest.worldX-ox,y:chest.worldY-oy});
  assert.ok(e.interactChest(id,chest.id));
  const loot = e.getChestLoot().slots;
  for (const family of [GEAR_FAMILY.SPELL,GEAR_FAMILY.UPGRADE])
    assert.ok(loot.some(s => s.count && EQUIPMENT_BY_ID[s.definitionId]?.family === family));
  const slot = loot.findIndex(s => EQUIPMENT_BY_ID[s.definitionId]?.family === GEAR_FAMILY.SPELL);
  assert.ok(e.interactChest(id,chest.id,slot)); tick(e,121);
  assert.equal(e.getChestLoot().slots[slot].count,0,'looted runes do not regenerate');
}, { infinite: true });
