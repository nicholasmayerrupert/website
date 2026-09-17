import assert from 'node:assert/strict';
import { GAME_CONTENT, GAME_WORLD, PLAYER_ART } from '../src/sand/content/catalog.js';
import { compileContent } from '../src/sand/content/compile.js';
import { initSandWasm, createEngineWasm, PLANET, MAT, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { MISSION, ITEM_KIND, CREATURE, WORLD_FEATURE } from '../src/sand/wasmBridge/abi.generated.js';
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
invalid(w => { w.sites.find(s => s.id === 'mine').placement.terrain = [[-10, 0], [-20, 0]]; }, /ordered/);
invalid(w => { w.sites.find(s => s.id === 'mine').placement.terrain = [[-10, 3], [20, 0]]; }, /ground level/);
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
  const millAnchor = GAME_CONTENT.anchors[GAME_WORLD.quests[1].target];
  assert.equal(jobs[1].worldX, millAnchor.x + e.contentOffset(millAnchor.surface).x);
  assert.equal(jobs[1].worldY, millAnchor.y + e.contentOffset(millAnchor.surface).y);
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

// An authored clearing reserves an entire procedural building before either
// layer is stamped; the reservation follows the seed's surface elevation.
for (const seed of [7, 12345, 0xffffffff]) {
  const scout = createEngineWasm({ cols: 96, rows: 96, worldSeed: seed,
    infinite: true, storageRole: 'presentation', planetId: PLANET.FRONTIER });
  let site;
  try {
    for (let x = 1600; x < 30000 && !site; x += 32) {
      const y = scout.worldSurfaceAbsAt(x), context = scout.worldContextAt(x, y);
      if ([WORLD_FEATURE.VILLAGE, WORLD_FEATURE.VILLAGE_BUILDING].includes(context.featureKind))
        site = { x, y, ...context };
    }
    assert.ok(site, `seed ${seed} has a procedural settlement`);
    const world = structuredClone(GAME_WORLD), b = site.bounds;
    world.sites.push({ id: 'reservation-test', origin: [site.x, 0], surfaceAt: site.x,
      operations: [{ layer: 'both', material: 'EMPTY',
        rect: [b.left - site.x, b.top - site.y, b.right - site.x, b.bottom - site.y] }] });
    const reserved = createEngineWasm({ cols: 96, rows: 96, worldSeed: seed,
      infinite: true, storageRole: 'presentation', planetId: PLANET.FRONTIER,
      content: compileContent(world, PLAYER_ART) });
    try {
      assert.equal(reserved.worldContextAt(site.x, site.y).featureKind, WORLD_FEATURE.NONE,
        `seed ${seed}: procedural structures respect the authored clearing`);
      assert.equal(reserved.getWorldSeed(), seed);
    } finally { reserved.destroy(); }
  } finally { scout.destroy(); }
}
console.log('ok: authored clearings reserve procedural settlement footprints across seeds');

const slopeWorld = structuredClone(GAME_WORLD);
for (const site of slopeWorld.sites) site.operations = [];
const terrainScout = createEngineWasm({ cols: 128, rows: 192, worldSeed: 7,
  infinite: true, storageRole: 'presentation', planetId: PLANET.FRONTIER });
let surfaceAnchor;
try {
  for (let x = 600; x < 30000; x += 16) {
    const y = terrainScout.worldSurfaceAbsAt(x);
    if (y >= -24 && y < 0) { surfaceAnchor = x; break; }
  }
} finally { terrainScout.destroy(); }
assert.ok(surfaceAnchor, 'fixture finds an elevated foundation datum');
slopeWorld.sites.push({ id: 'foundation-test', origin: [0, 0], surfaceAt: surfaceAnchor,
  operations: [{ layer: 'both', material: 'PALESTONE', rect: [-12, 0, 12, 1] }] });
const grounded = createEngineWasm({ cols: 128, rows: 192, worldSeed: 7,
  infinite: true, planetId: PLANET.FRONTIER, content: compileContent(slopeWorld, PLAYER_ART) });
try {
  const floor = grounded.worldSurfaceAbsAt(surfaceAnchor) + 1;
  for (const grid of [grounded.getGrid(), grounded.getGridBg()]) {
    for (let y = floor; y <= grounded.worldSurfaceAbsAt(0) + 1; y++) {
      const index = (y - grounded.getWorldOffsetY()) * grounded.cols - grounded.getWorldOffsetX();
      assert.equal(grid[index], MAT.PALESTONE, 'foundation reaches the terrain in both layers');
    }
  }
} finally { grounded.destroy(); }
console.log('ok: terrain-anchored masonry extends to solid ground in both layers');

// Placement is a seed-derived world plan, independent of viewport and streaming.
let chosenRelief = 0, fixedRelief = 0;
const sites = GAME_WORLD.sites.filter(site => site.placement);
const layouts = new Set();
for (const seed of [0, 7, 42, 12345, 0xc0ffee, 0xffffffff, GAME_WORLD.seed]) {
  const small = createEngineWasm({ cols: 96, rows: 96, worldSeed: seed,
    infinite: true, storageRole: 'presentation', planetId: PLANET.FRONTIER });
  const large = createEngineWasm({ cols: 512, rows: 384, worldSeed: seed,
    infinite: true, storageRole: 'presentation', planetId: PLANET.FRONTIER });
  try {
    const occupied = [];
    const layout = [];
    for (const site of sites) {
      const scene = GAME_CONTENT.scenes.find(scene => scene.id === site.id);
      const p = site.placement, offset = small.contentOffset(scene.surface);
      assert.deepEqual(offset, large.contentOffset(scene.surface), `${site.id}: viewport-independent placement`);
      const left = site.origin[0] + offset.x + p.footprint[0];
      const right = site.origin[0] + offset.x + p.footprint[1];
      const ground = site.origin[1] + offset.y + p.ground;
      layout.push([site.id, offset]);
      occupied.push({ left: left - p.blend, right: right + p.blend, id: site.id });
      for (let x = left; x <= right; x += 8) {
        if (p.terrain?.length) continue;
        assert.equal(small.worldSurfaceAbsAt(x), ground, `${site.id}: continuous bearing surface`);
        assert.equal(large.worldSurfaceAbsAt(x), ground);
      }
      for (const [x, y] of p.terrain || []) {
        const worldX = site.origin[0] + offset.x + x;
        assert.equal(small.worldSurfaceAbsAt(worldX), ground + y, `${site.id}: terrain follows the hillside and gorge control points`);
        assert.equal(large.worldSurfaceAbsAt(worldX), ground + y);
      }
      for (const edge of [left - p.blend, left, right, right + p.blend]) {
        assert.ok(Math.abs(small.worldSurfaceAbsAt(edge + 1) - small.worldSurfaceAbsAt(edge - 1)) <= Math.max(3, Math.abs(small.naturalSurfaceAt(edge + 1) - small.naturalSurfaceAt(edge - 1))),
          `${site.id}: no vertical seam at grading boundary`);
      }
      for (const x of [left - p.blend, right + p.blend])
        assert.equal(small.worldSurfaceAbsAt(x), small.naturalSurfaceAt(x), `${site.id}: joins untouched terrain`);
      const relief = center => {
        const heights = [];
        for (let x = p.footprint[0]; x <= p.footprint[1]; x += 8) heights.push(small.naturalSurfaceAt(center + x));
        return Math.max(...heights) - Math.min(...heights);
      };
      chosenRelief += relief(site.origin[0] + offset.x);
      fixedRelief += relief(site.origin[0]);
    }
    occupied.sort((a,b) => a.left - b.left);
    for (let i = 1; i < occupied.length; i++)
      assert.ok(occupied[i].left > occupied[i - 1].right, `seed ${seed}: ${occupied[i].id} grading cannot overlap ${occupied[i-1].id}`);
    layouts.add(JSON.stringify(layout));
  } finally { small.destroy(); large.destroy(); }
}
assert.equal(layouts.size, 7, 'each seed selects its own site layout');
assert.ok(chosenRelief < fixedRelief * .8, `placement reduces required earthworks: ${chosenRelief} vs ${fixedRelief}`);
console.log(`ok: seven seeds select disjoint sites with continuous terrain joins; footprint relief ${fixedRelief} -> ${chosenRelief}`);

const planned = createEngineWasm({ cols: 160, rows: 160, worldSeed: 7,
  infinite: true, planetId: PLANET.FRONTIER });
const restored = createEngineWasm({ cols: 160, rows: 160, worldSeed: 42,
  infinite: true, planetId: PLANET.FRONTIER });
try {
  const player = planned.spawnPlayerAtSurface(80);
  assert.equal(planned.startMission(MISSION.FRONTIER, player), true);
  // Prime the receiver's plan with a different seed before restoring the save.
  for (const scene of GAME_CONTENT.scenes) restored.contentOffset(scene.surface);
  assert.equal(restored.readCheckpoint(planned.writeCheckpoint()), true);
  for (const scene of GAME_CONTENT.scenes)
    assert.deepEqual(restored.contentOffset(scene.surface), planned.contentOffset(scene.surface),
      `${scene.id}: checkpoint restoration reuses the saved seed's placement`);
} finally { planned.destroy(); restored.destroy(); }
console.log('ok: checkpoint seed restoration invalidates provisional site placement');

// Stream the mine through the real authority and settle its destructible cells.
const mine = createEngineWasm({ cols: 768, rows: 448, worldSeed: GAME_WORLD.seed,
  infinite: true, planetId: PLANET.FRONTIER });
try {
  const site = GAME_WORLD.sites.find(s => s.id === 'mine');
  const offset = mine.contentOffset(GAME_CONTENT.anchors['mine.mouth'].surface);
  const origin = [site.origin[0] + offset.x, site.origin[1] + offset.y];
  const target = [Math.round((origin[0] - 384) / 32) * 32,
    Math.round((origin[1] - 224) / 32) * 32];
  for (let axis = 0; axis < 2; axis++) {
    const current = () => axis ? mine.getWorldOffsetY() : mine.getWorldOffsetX();
    while (current() !== target[axis]) {
      const shift = Math.max(-128, Math.min(128, target[axis] - current()));
      mine.shiftWorldXY(axis ? 0 : shift, axis ? shift : 0);
    }
  }
  const cell = (x, y, bg = false) => (bg ? mine.getGridBg() : mine.getGrid())[
    (origin[1] + y - mine.getWorldOffsetY()) * mine.cols + origin[0] + x - mine.getWorldOffsetX()];
  for (let tick = 0; tick < 90; tick++) mine.stepWorld();
  for (const [x, y] of [[-246,-12],[-144,-12],[-40,-12],[-85,20],[-115,49],[-239,80],[-165,80],[-46,82],[40,30]])
    assert.equal(cell(x, y), MAT.EMPTY, `mine passage ${x},${y} stays open after settling`);
  for (const [x,y,m] of [[-60,-55,'OAK_WOOD'],[34,-88,'SLATE'],[150,-59,'SLATE'],[-185,-10,'SLATE']])
    assert.equal(cell(x,y), MAT[m], `mine roof or rockfall ${x},${y} stays supported`);
  assert.equal(cell(-284,-35,true), MAT.OAK_WOOD, 'oak pit props retain background membership');
  assert.equal(cell(-250,80,true), MAT.DEEPSTONE, 'the deep gallery retains its background');
  for (const chest of GAME_WORLD.chests.filter(c => c.anchor === 'mine.gallery')) {
    const x = site.anchors.gallery[0] + chest.offset[0], y = site.anchors.gallery[1] + chest.offset[1];
    for (let dy=-3;dy<=3;dy++) for (let dx=-3;dx<=3;dx++)
      assert.equal(cell(x+dx,y+dy),MAT.EMPTY,`${chest.name} has foreground clearance`);
  }
  for (const [material, area, required] of [
    ['IRON_ORE',[-298,-57,-225,-1],48], ['COAL_ORE',[-133,-22,-101,-1],20],
    ['GOLD_ORE',[-296,71,-257,94],12],
  ]) {
    let count=0;
    for(let y=area[1];y<=area[3];y++) for(let x=area[0];x<=area[2];x++)
      if(cell(x,y)===MAT[material])count++;
    assert.ok(count>=required,`${material}: ${count} harvestable cells cover the ${required}-ore errand`);
  }
  const player = mine.spawnPlayer(origin[0]-239-mine.getWorldOffsetX(), origin[1]+86-mine.getWorldOffsetY());
  mine.setPlayerInput(player, { bits: INPUT.RIGHT });
  for (let tick=0;tick<360;tick++) {
    mine.stepActors();
    if(mine.getPlayer(player).x+mine.getWorldOffsetX()>origin[0]-35)break;
  }
  const climbed=mine.getPlayer(player);
  assert.ok(climbed.alive && climbed.x+mine.getWorldOffsetX()>origin[0]-40
    && climbed.y+mine.getWorldOffsetY()<=origin[1]-7,
  `walk from the lower gold working to the mouth: ${climbed.x+mine.getWorldOffsetX()-origin[0]},${climbed.y+mine.getWorldOffsetY()-origin[1]}`);
} finally { mine.destroy(); }
console.log('ok: streamed mine galleries, pit props, roofs, coffers and quest ore survive settling');
