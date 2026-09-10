import { equipWandSpell } from './magic-fixtures.mjs';
import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE, MISSION, PROJECTILE_KIND, OFF, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';
await initSandWasm();
const options = { cols: 240, rows: 160, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER };
function arena(fn) {
  const e = createEngineWasm(options);
  try {
    e.setSurvivalInventory(true); e.setCreatureRuntime(false, false);
    for (let layer = 0; layer < 2; layer++) {
      for (let y = 120; y < 160; y++) for (let x = 1; x < 239; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
      e.syncComponentsLayer(layer);
    }
    fn(e, e.spawnPlayer(35, 112));
  } finally { e.destroy(); }
}
const tick = (e, n = 1) => { for (let i = 0; i < n; i++) e.stepActors(); };
function cast(e, id, gear, aimX, aimY) {
  equipWandSpell(e, id, gear);
  e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX, aimY }); tick(e);
  e.setPlayerInput(id, { bits: 0, aimX, aimY });
  for (let i = 0; i < 40 && !e.getProjectiles().length; i++) tick(e);
  assert.ok(e.getProjectiles().length, `rune ${gear} launches`);
}
const stoneCount = grid => grid.filter(m => m === MAT.STONE).length;
arena((e, id) => {
  for (let layer = 0; layer < 2; layer++) {
    for (let x = 68; x < 76; x++) for (let y = 65; y < 120; y++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    e.syncComponentsLayer(layer);
  }
  const before = [stoneCount(e.getGrid()), stoneCount(e.getGridBg())];
  cast(e, id, 306, 110, 108);
  assert.equal(e.getProjectiles().length, 5, 'Prism Choir launches a five-shard fan');
  assert.equal(new Set(e.getProjectiles().map(p => p.vy)).size, 5);
  assert.ok(e.getPlayer(id).mana <= 78, 'the fan pays one mana cost');
  let bounced = false;
  for (let i = 0; i < 18; i++) { tick(e); bounced ||= e.getProjectiles().some(p => p.kind === PROJECTILE_KIND.RUNE && p.vx < 0); }
  assert.ok(bounced, 'a shard banks back off a wall');
  [e.getGrid(), e.getGridBg()].forEach((grid, i) => assert.ok(stoneCount(grid) < before[i], `ricochets chip layer ${i}`));
  tick(e, 60); assert.equal(e.getProjectiles().length, 0, 'ricochets have a bounded lifetime');
  console.log('ok: Prism Choir spread, resource cost, ricochet, terrain and expiry');
});
arena((e, id) => {
  assert.ok(e.startMission(MISSION.FRONTIER, id));
  cast(e, id, 307, 80, 118);
  for (let i = 0; i < 30 && !e.getProjectiles().some(p => p.kind === PROJECTILE_KIND.RUNE_FIELD); i++) tick(e);
  const star = e.getProjectiles().find(p => p.kind === PROJECTILE_KIND.RUNE_FIELD);
  assert.ok(star, 'Hollow Star anchors at its aimed distance');
  assert.ok(Math.abs(star.x - 80) < 3);
  const enemy = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 92 + e.getWorldOffsetX(), 110 + e.getWorldOffsetY());
  const villager = e.spawnScriptedCreature(CREATURE.VILLAGER, 88 + e.getWorldOffsetX(), 110 + e.getWorldOffsetY());
  const residents = e.getCreatureSnapshotData();
  for (let i = 0; i < residents.length; i += STRIDES.creatureSnapshot)
    if (residents[i + OFF.creatureSnapshot.id] === villager) residents[i + OFF.creatureSnapshot.npcId] = 7;
  e.setMirrorCreatures(residents, e.getWorldOffsetX(), e.getWorldOffsetY());
  e.setPlayerState(id, { x: 70, y: 112 });
  const actor = () => e.getCreatures().find(c => c.id === enemy);
  const hp = actor().health, playerHp = e.getPlayer(id).health;
  const item = e.spawnItem(MAT.SAND, 1, 92, 108);
  const before = stoneCount(e.getGrid());
  tick(e, 3);
  assert.ok(actor().vx < 0, 'the well pulls nearby enemies inward');
  assert.ok(e.getItems().find(i => i.id === item).x < 92, 'the well pulls loose debris inward');
  assert.equal(e.getCreatures().find(c => c.id === villager).vx, 0, 'protected residents are not pulled');
  assert.equal(e.getPlayer(id).x, 70, 'the caster is not pulled');
  assert.equal(actor().health, hp, 'attraction telegraphs the delayed damage');
  assert.equal(stoneCount(e.getGrid()), before, 'the gathering phase does not repeatedly rebuild terrain');
  // Checkpoints retain the live field's timer and ownership.
  const restored = createEngineWasm(options);
  try {
    assert.ok(restored.readCheckpoint(e.writeCheckpoint()));
    assert.deepEqual(restored.getProjectileSnapshotData(), e.getProjectileSnapshotData());
    tick(e, 72); tick(restored, 72);
    assert.equal(restored.gridHash(), e.gridHash(), 'a resumed star collapses identically');
  } finally { restored.destroy(); }
  assert.ok(stoneCount(e.getGrid()) < before, 'collapse excavates a crater');
  const after = e.getCreatures().find(c => c.id === enemy);
  assert.ok(!after || after.health < hp, 'the collapse damages gathered enemies');
  assert.equal(e.getPlayer(id).health, playerHp, 'the caster takes no spell damage');
  console.log('ok: Hollow Star aim, attraction, delay, terrain and live checkpoint');
});
arena((e, id) => {
  const before = e.getGrid().slice();
  cast(e, id, 308, 110, 132);
  assert.equal(e.getProjectiles()[0].kind, PROJECTILE_KIND.RUNE_FIELD);
  const startX = e.getProjectiles()[0].x;
  tick(e, 12);
  assert.ok(e.getProjectiles()[0].x > startX + 12, 'Faultline advances between eruptions');
  tick(e, 48);
  let first = 240, last = 0;
  const cutColumns = new Set();
  for (let y = 120; y < 145; y++) for (let x = 1; x < 239; x++) {
    if (before[y * 240 + x] === MAT.STONE && e.getGrid()[y * 240 + x] !== MAT.STONE) {
      first = Math.min(first, x); last = Math.max(last, x); cutColumns.add(x);
    }
  }
  assert.ok(last - first > 30, `six eruptions carve a long seam (${last - first} cells)`);
  assert.equal(cutColumns.size, last - first + 1, 'the seam has no intact columns between pulses');
  assert.ok(!e.getGrid().includes(MAT.FIRE), 'Faultline fractures terrain without igniting it');
  assert.equal(e.getProjectiles().length, 0);
  e.stepWorld();
  assert.equal(e.getGrid()[150 * 240 + 190], MAT.STONE, 'uncut supported terrain survives');
  console.log('ok: Faultline travelling excavation, expiry and component repair');
});
for (const [species, rune] of [[CREATURE.FEN_WISP, 306], [CREATURE.HOLLOW_BELLKEEPER, 307], [CREATURE.ROOT_KNIGHT, 308]]) arena(e => {
  e.setCreatureRuntime(true, false);
  e.spawnScriptedCreature(species, 100 + e.getWorldOffsetX(), 105 + e.getWorldOffsetY());
  const data = e.getCreatureSnapshotData(), o = OFF.creatureSnapshot;
  data[o.attackState] = 2; data[o.attackPattern] = 1; data[o.attackProgress] = 1;
  data[o.aimX] = 50; data[o.aimY] = 115;
  e.setMirrorCreatures(data, e.getWorldOffsetX(), e.getWorldOffsetY()); tick(e);
  assert.ok(e.getProjectiles().some(p => p.fuse === rune && p.owner < 0));
  assert.ok(data.length >= STRIDES.creatureSnapshot);
  console.log(`ok: enemy ${species} uses rune ${rune}`);
});
