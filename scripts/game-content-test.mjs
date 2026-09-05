import assert from 'node:assert/strict';
import { GAME_CONTENT, GAME_WORLD, PLAYER_ART } from '../src/sand/content/catalog.js';
import { compileContent } from '../src/sand/content/compile.js';
import { initSandWasm, createEngineWasm, PLANET, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { MISSION } from '../src/sand/wasmBridge/abi.generated.js';

const invalid = (mutate, expected) => {
  const world = structuredClone(GAME_WORLD), art = structuredClone(PLAYER_ART);
  mutate(world, art);
  assert.throws(() => compileContent(world, art), expected);
};
invalid(w => { w.quests[0].target = 'missing.anchor'; }, /missing target/);
invalid(w => { w.quests[0].after = ['homecoming']; }, /must precede/);
invalid(w => { w.prefabs.pine = [{ use: 'pine' }]; }, /recursive prefab/);
invalid(w => { w.sites[0].operations[0].material = 'TYPO'; }, /unknown material/);
invalid((w, a) => { a.clips.walk.frames[0][0] = 'short'; }, /expected 16/);
invalid((w, a) => { a.clips.walk.frames[0][0] = '?'.repeat(16); }, /unknown pixel/);
assert.deepEqual(compileContent(GAME_WORLD, PLAYER_ART).packed, GAME_CONTENT.packed);
console.log('ok: content rejects broken references, dependency cycles, recursive prefabs and malformed art');

await initSandWasm();
const create = content => createEngineWasm({ cols: 640, rows: 448, worldSeed: GAME_WORLD.seed,
  infinite: true, sinksOn: false, planetId: PLANET.FRONTIER, content });
const e = create(GAME_CONTENT);
try {
  e.setSurvivalInventory(true);
  const player = e.spawnPlayerAtSurface(320);
  assert.equal(e.startMission(MISSION.FRONTIER, player), true);
  const jobs = e.getMission().objectives;
  assert.equal(jobs[0].worldX, GAME_CONTENT.anchors[GAME_WORLD.quests[0].target].x);
  assert.equal(jobs[1].worldY, GAME_CONTENT.anchors[GAME_WORLD.quests[1].target].y);
  assert.equal(jobs[3].state, 0);
  const at = (x, y, bg = false) => (bg ? e.getGridBg() : e.getGrid())[(y - e.getWorldOffsetY()) * e.cols + x - e.getWorldOffsetX()];
  assert.equal(at(-16, 10), MAT.EMPTY);
  assert.equal(at(-16, 16), MAT.SANDSTONE);
  for (let i = 0; i < 90; i++) e.stepWorld();
  assert.equal(at(-16, 16), MAT.SANDSTONE, 'lodge foundation survives physical settling');
  assert.notEqual(at(-60, -30, true), MAT.EMPTY, 'authored background retains component membership');
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
  assert.equal(alternate.getMission().objectives[3].worldX, -60, 'engine uses edited content without a WASM rebuild');
} finally { alternate.destroy(); }
const broken = { ...GAME_CONTENT, packed: GAME_CONTENT.packed.slice() };
broken.packed[3] = 20001;
assert.throws(() => create(broken), /allocation failed/);
console.log('ok: real WASM consumes per-instance content, keeps structures stable, repairs them and rejects malformed packages');
