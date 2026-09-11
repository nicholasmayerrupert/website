import assert from 'node:assert/strict';
import { GAME_CONTENT, GAME_WORLD, PLAYER_ART } from '../src/sand/content/catalog.js';
import { compileContent } from '../src/sand/content/compile.js';
import { initSandWasm, createEngineWasm, PLANET, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { MISSION, ITEM_KIND, CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import materialArt from '../src/sand/content/materialArt.js';
import { MATERIAL_BY_ID } from '../src/sand/materials.generated.js';

const invalid = (mutate, expected) => {
  const world = structuredClone(GAME_WORLD), art = structuredClone(PLAYER_ART);
  mutate(world, art);
  assert.throws(() => compileContent(world, art), expected);
};
invalid(w => { w.quests[0].target = 'missing.anchor'; }, /missing target/);
invalid(w => { w.quests[0].after = ['homecoming']; }, /must precede/);
invalid(w => { w.prefabs.pine = [{ use: 'pine' }]; }, /recursive prefab/);
invalid(w => { w.sites[0].operations[0].material = 'TYPO'; }, /unknown material/);
invalid((w, a) => { a.clips.walk.frames[0][0] = 'short'; }, /expected 32/);
invalid((w, a) => { a.clips.walk.frames[0][0] = '?'.repeat(a.width); }, /unknown pixel/);
invalid(w => { w.quests[0].condition.material = 'TYPO'; }, /condition material/);
invalid(w => { w.quests[0].condition.count = 0; }, /expected integer/);
invalid(w => { w.quests[1].condition.bounds = [0, 0, 1000, 1]; }, /construction area/);
invalid(w => { w.quests[4].condition.species = 'TYPO'; }, /encounter species/);
invalid(w => { w.residents[0].roamRadius = -1; }, /expected integer/);
invalid(w => { w.textures.STONE = { palette: ['#ffffff'], rows: ['0'] }; }, /tile/);
invalid(w => { w.textures.STONE = { palette: ['#ffffff'], rows: Array(32).fill('9'.repeat(32)) }; }, /palette index/);
assert.deepEqual(compileContent(GAME_WORLD, PLAYER_ART).packed, GAME_CONTENT.packed);
console.log('ok: content rejects broken references, dependency cycles, recursive prefabs and malformed art');

await initSandWasm();
// Read the entire authored tile back through the packet and real WASM renderer.
// Full ambient removes lighting from this source-pixel fidelity check.
const artWorld = structuredClone(GAME_WORLD);
artWorld.presentation.surfaceLight = artWorld.presentation.deepLight = 255;
const artEngine = createEngineWasm({ cols: 32, rows: 32, infinite: false, sinksOn: false,
  planetId: PLANET.FRONTIER, content: compileContent(artWorld, PLAYER_ART) });
try {
  assert.deepEqual(Object.keys(materialArt).sort(), Object.keys(MAT).filter(name => name !== 'EMPTY').sort());
  for (const [name, tile] of Object.entries(materialArt)) {
    if (MATERIAL_BY_ID[MAT[name]].renderAnim !== 'none') continue;
    // Render-only fixture: no world step consumes these component cells.
    artEngine.getGrid().fill(MAT[name]);
    artEngine.renderFull();
    const rgba = artEngine.getRenderPixels();
    for (let i = 0; i < 1024; i++) {
      const hex = tile.palette[Number(tile.rows[i >> 5][i & 31])];
      const rgb = parseInt(hex.slice(1), 16);
      assert.equal((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2], rgb, `${name} texel ${i}`);
    }
    const alpha = rgba[3];
    assert.equal(alpha, Math.round((1 - MATERIAL_BY_ID[MAT[name]].transparency) * 255), `${name} schema opacity`);
  }
  artEngine.getGrid().fill(MAT.EMPTY);
  artEngine.renderFull();
  assert.ok(artEngine.getRenderPixels().every(value => value === 0), 'empty cells remain transparent');
} finally { artEngine.destroy(); }
console.log('ok: every static material preserves its complete authored tile and optical opacity');

const create = content => createEngineWasm({ cols: 640, rows: 448, worldSeed: GAME_WORLD.seed,
  infinite: true, sinksOn: false, planetId: PLANET.FRONTIER, content });
const rewardFixture = structuredClone(GAME_WORLD);
rewardFixture.quests[0].reward = { gear: 100, count: 1, name: 'Armor' };
const e = create(compileContent(rewardFixture, PLAYER_ART));
try {
  e.setSurvivalInventory(true);
  const player = e.spawnPlayerAtSurface(320);
  assert.equal(e.startMission(MISSION.FRONTIER, player), true);
  const jobs = e.getMission().objectives;
  assert.equal(jobs[0].worldX, GAME_CONTENT.anchors[GAME_WORLD.quests[0].target].x);
  assert.equal(jobs[1].worldY, GAME_CONTENT.anchors[GAME_WORLD.quests[1].target].y);
  assert.equal(jobs.at(-1).state, 0);
  const at = (x, y, bg = false) => (bg ? e.getGridBg() : e.getGrid())[(y - e.getWorldOffsetY()) * e.cols + x - e.getWorldOffsetX()];
  assert.equal(at(-16, 10), MAT.EMPTY);
  assert.equal(at(-16, 16), MAT.SANDSTONE);
  for (let i = 0; i < 90; i++) e.stepWorld();
  assert.equal(at(-16, 16), MAT.SANDSTONE, 'lodge foundation survives physical settling');
  assert.notEqual(at(-60, -30, true), MAT.EMPTY, 'authored background retains component membership');
  e.setPlayerState(player, { ...e.getPlayer(player), x: 96 - e.getWorldOffsetX(), y: 6 - e.getWorldOffsetY() });
  assert.equal(e.interactFrontier(player, 0), true, 'accept the quest beside Osei');
  e.addToInventory(player, MAT.IRON_ORE, 31);
  while (e.addSpecialItem(player, ITEM_KIND.RESCUE_BEAM, 1)) { /* fill nonstacking equipment slots */ }
  const before = e.getInventory(player);
  assert.equal(e.interactFrontier(player, 0), false, 'full inventory cannot accept delivery rewards');
  assert.deepEqual(e.getInventory(player), before, 'a failed reward preserves all delivery materials');
  assert.equal(e.getMission().objectives[0].state, 1, 'failed handoff keeps the job active');
  e.eraseDisc(-16 - e.getWorldOffsetX(), 16 - e.getWorldOffsetY(), 5);
  assert.equal(e.repairFrontierBase(player), true);
  assert.equal(at(-16, 16), MAT.SANDSTONE, 'repair uses the content blueprint');
} finally { e.destroy(); }

const edited = structuredClone(GAME_WORLD);
edited.quests[0].reward.count = 7;
edited.sites[0].anchors.vale = [-60, 8];
const changed = compileContent(edited, PLAYER_ART);
assert.notEqual(changed.hash, GAME_CONTENT.hash);
const alternate = create(changed);
try {
  alternate.setSurvivalInventory(true);
  const p = alternate.spawnPlayerAtSurface(320);
  alternate.startMission(MISSION.FRONTIER, p);
  assert.equal(alternate.getMission().objectives.at(-1).worldX, -60, 'engine uses edited content without a WASM rebuild');
} finally { alternate.destroy(); }
const broken = { ...GAME_CONTENT, packed: GAME_CONTENT.packed.slice() };
broken.packed[3] = 20001;
assert.throws(() => create(broken), /allocation failed/);
console.log('ok: real WASM consumes per-instance content, keeps structures stable, repairs them and rejects malformed packages');

const mirror = createEngineWasm({ cols: 96, rows: 96, infinite: true, storageRole: 'presentation', planetId: PLANET.FRONTIER });
try {
  assert.ok(mirror.spawnScriptedCreature(CREATURE.IRIS_COMMANDER, 0, 0), 'art previews do not require authority-only grounding buffers');
} finally { mirror.destroy(); }
