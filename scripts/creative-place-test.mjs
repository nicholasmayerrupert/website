// Creative pointer routing for materials, seeds, eraser, cube, and creature eggs.
// Run: node scripts/creative-place-test.mjs

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
import { MAT } from '../src/sand/materials.js';
import { CREATIVE_KIND as CK, CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { buildEntries } from '../src/sand/embed/toolPalette.js';
import { makeChecker } from './sand-test-util.mjs';

const PT = { OAK: 0, PINE: 1, WILLOW: 2, CACTUS: 3, MUSHROOM: 4, BUSH: 5, VINE: 6 };
const COLS = 100, ROWS = 80;
await initSandWasm();
const { check, done } = makeChecker('creative spawn-everything');
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
const at = (g, x, y) => g[y * COLS + x];
const count = (g, material) => {
  let total = 0;
  for (const cell of g) if (cell === material) total++;
  return total;
};
const hasCell = (cells, x, y) => {
  const k = y * COLS + x;
  for (const c of cells) if (c === k) return true;
  return false;
};

const expectedEggs = [
  ['Minnow Spawn Egg', CREATURE.MINNOW],
  ['Fox Spawn Egg', CREATURE.FOX],
  ['Mole Spawn Egg', CREATURE.MOLE],
  ['Bird Spawn Egg', CREATURE.BIRD],
  ['Dynamiteer Spawn Egg', CREATURE.DYNAMITEER],
  ['Bore Sentinel Spawn Egg', CREATURE.BORE_SENTINEL],
  ['Caustic Mortarman Spawn Egg', CREATURE.CAUSTIC_MORTARMAN],
  ['Cluster Wasp Spawn Egg', CREATURE.CLUSTER_WASP],
  ['Minigunner Spawn Egg', CREATURE.MINIGUNNER],
];
const menuTail = buildEntries().slice(-expectedEggs.length);
check('creative menu ends with the nine enabled creature spawn eggs',
  menuTail.length === expectedEggs.length && menuTail.every((entry, i) =>
    entry.kind === CK.CREATURE && entry.label === expectedEggs[i][0] && entry.value === expectedEggs[i][1]));
const seedEntries = buildEntries().filter((entry) => entry.kind === CK.SEED);
check('all seven species seeds have distinct creative-menu pixel icons',
  seedEntries.length === 7 && new Set(seedEntries.map((entry) => entry.seedPixels.join('/'))).size === 7
    && new Set(seedEntries.map((entry) => entry.seedColors.join('/'))).size === 7);

// 1) Any COMPONENT material drafts with a live preview, then starts as a body,
// falls, and bakes after grounded contact.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.COPPER_ORE);
  e.pointerDown(50, 40, 0);
  check(`copper ore shows a draft preview (${e.getStoneDraftCells().length} cells)`, e.getStoneDraftCells().length > 0);
  e.pointerUp(0);
  check('copper ore finalized into the grid', at(e.getGrid(), 50, 40) === MAT.COPPER_ORE);
  check('copper ore finalized as one body', e._bodyCount() === 1);
  const initial = e._bodyState(0);
  e.step(16);
  const falling = e._bodyState(0);
  check('new copper ore body begins falling',
    initial && falling && falling.py > initial.py && falling.vy > 0);
  let bakedAt = -1;
  for (let i = 0; i < 400; i++) {
    e.step((i + 2) * 16);
    if (e._bodyCount() === 0) { bakedAt = i; break; }
  }
  let maxY = -1;
  for (let i = 0; i < e.getGrid().length; i++)
    if (e.getGrid()[i] === MAT.COPPER_ORE) maxY = Math.max(maxY, (i / COLS) | 0);
  check(`copper ore bakes after grounded rest (step ${bakedAt}, bottom ${maxY})`,
    bakedAt >= 0 && maxY >= ROWS - 3);
  e.destroy();
}

// 2) A different component (brick) drafts + finalizes the same generic way.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.BRICK);
  e.pointerDown(30, 30, 0);
  e.pointerUp(0);
  check('brick finalized into the grid', at(e.getGrid(), 30, 30) === MAT.BRICK);
  check('brick finalized as a body', e._bodyCount() === 1);
  e.destroy();
}

// 3) A powder paints continuously (no draft).
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.SAND);
  e.pointerDown(50, 20, 0);
  let t = 0; for (let i = 0; i < 3; i++) { t += 20; e.applyTool(50, 20, t, true, true); }
  e.pointerUp(0);
  let sand = 0; for (const v of e.getGrid()) if (v === MAT.SAND) sand++;
  check(`sand painted continuously (${sand} cells)`, sand > 0);
  e.destroy();
}

// 4) Seed species: a pine seed drafts + places SEED cells.
{
  const e = mk();
  e.setCreativeMaterial(CK.SEED, PT.PINE);
  e.pointerDown(50, 40, 0);
  e.pointerUp(0);
  let seeds = 0; for (const v of e.getGrid()) if (v === MAT.SEED) seeds++;
  check(`pine seed placed one SEED cell (${seeds})`, seeds === 1);
  e.destroy();
}

// 5) Default material SEED follows the seed path too, not the generic solid draft.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.SEED);
  e.pointerDown(50, 40, 0);
  check('default seed does not create a stone-style draft preview', e.getStoneDraftCells().length === 0);
  e.pointerUp(0);
  let seeds = 0; for (const v of e.getGrid()) if (v === MAT.SEED) seeds++;
  check(`default seed placed one SEED cell (${seeds})`, seeds === 1);
  e.destroy();
}

// Mycelium spores use their dedicated one-cell placement path.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.MYCELIUM_SPORE);
  e.pointerDown(50, 40, 0);
  check('mycelium spore does not create a stone-style draft preview', e.getStoneDraftCells().length === 0);
  e.pointerUp(0);
  let spores = 0; for (const v of e.getGrid()) if (v === MAT.MYCELIUM_SPORE) spores++;
  check(`mycelium spore placed one cell (${spores})`, spores === 1);
  e.destroy();
}

// Cube spawns a free rigid body.
{
  const e = mk();
  e.setCreativeMaterial(CK.CUBE, 0);
  e.pointerDown(50, 40, 0);
  check('cube spawned a rigid body', e._bodyCount() > 0);
  e.destroy();
}

// 7) The RIGID material selector drafts an arbitrary free body shape. The separate
// cube entry above stays the one-click cube tool.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.RIGID);
  e.pointerDown(50, 40, 0);
  check(`rigid material shows a draft preview (${e.getStoneDraftCells().length} cells)`, e.getStoneDraftCells().length > 0);
  check('rigid material did not spawn a cube on press', e._bodyCount() === 0);
  for (let x = 51; x <= 55; x++) e.pointerDraft(x, 40);
  e.pointerUp(0);
  check('rigid material finalized as one free rigid body', e._bodyCount() === 1);
  e.destroy();
}

// Creative structural placement welds to a touched existing body.
{
  const e = mk();
  e.spawnBox(50, 40, 3, 3, MAT.RIGID);
  const before = e._bodyState(0)?.nPts ?? 0;
  e.setCreativeMaterial(CK.MATERIAL, MAT.BRICK);
  e.pointerDown(50, 34, 0);
  e.pointerUp(0);
  const grid = e.getGrid();
  check('creative placement welds to the touched body',
    e._bodyCount() === 1 && (e._bodyState(0)?.nPts ?? 0) > before);
  check('creative weld preserves both material identities',
    count(grid, MAT.RIGID) > 0 && count(grid, MAT.BRICK) > 0);
  e.destroy();
}

// Static structural contact takes precedence over body contact. This keeps cave
// infill attached to the cave wall instead of turning it into colliding rubble.
{
  const e = mk();
  for (let y = 20; y < ROWS; y++) e.paintDisc(35, y, 0, MAT.STONE, true);
  e.syncComponents();
  e.spawnBox(44, 30, 3, 3, MAT.RIGID);
  const bodyCells = e._bodyState(0)?.nPts ?? 0;
  e.setCreativeMaterial(CK.MATERIAL, MAT.BRICK);
  e.pointerDown(38, 30, 0);
  e.pointerUp(0);
  check('creative placement touching static structure stays static',
    e._bodyCount() === 1 && (e._bodyState(0)?.nPts ?? 0) === bodyCells);
  check('static contact wins when the same placement also touches a body',
    at(e.getGrid(), 36, 30) === MAT.BRICK && e._bodyOwnerGrid()[30 * COLS + 36] < 0);
  e.stepWorld();
  check('cave-wall infill remains component-backed after a step',
    at(e.getGrid(), 36, 30) === MAT.BRICK);
  e.destroy();
}

// The survival placement API uses the same weld path.
{
  const e = mk();
  e.spawnBox(50, 40, 3, 3, MAT.RIGID);
  const before = e._bodyState(0)?.nPts ?? 0;
  e.placeMaterial(50, 34, 2, MAT.COPPER_ORE);
  const grid = e.getGrid();
  check('survival placement welds to the touched body',
    e._bodyCount() === 1 && (e._bodyState(0)?.nPts ?? 0) > before);
  check('survival weld preserves both material identities',
    count(grid, MAT.RIGID) > 0 && count(grid, MAT.COPPER_ORE) > 0);
  e.destroy();
}

{
  const e = mk();
  for (let y = 20; y < ROWS; y++) e.paintDisc(35, y, 0, MAT.STONE, true);
  e.syncComponents();
  e.placeMaterial(38, 40, 2, MAT.COPPER_ORE);
  e.placeMaterial(38, 50, 2, MAT.WOOD);
  check('survival placement touching static structure stays static',
    e._bodyCount() === 0 && at(e.getGrid(), 36, 40) === MAT.COPPER_ORE);
  check('static wood placement uses plant-aware component registration',
    at(e.getGrid(), 36, 50) === MAT.WOOD && e._bodyOwnerGrid()[50 * COLS + 36] < 0);
  e.stepWorld();
  check('survival cave-wall infill remains static after a step',
    e._bodyCount() === 0 && at(e.getGrid(), 36, 40) === MAT.COPPER_ORE
      && at(e.getGrid(), 36, 50) === MAT.WOOD);
  e.destroy();
}

// Every creature exposed in the creative palette spawns at the clicked world
// position without requiring its natural habitat.
for (const [label, species] of expectedEggs) {
  const e = mk();
  e.setCreativeMaterial(CK.CREATURE, species);
  e.pointerDown(50, 30, 0);
  const creatures = e.getCreatures();
  check(`${label.toLowerCase()} creates its creature`,
    creatures.length === 1 && creatures[0].species === species &&
    Math.abs(creatures[0].x + creatures[0].w / 2 - 50) < 0.01 &&
    Math.abs(creatures[0].y + creatures[0].h / 2 - 30) < 0.01);
  e.destroy();
}

{
  const e = mk();
  e.setCreativeMaterial(CK.CREATURE, CREATURE.FOX);
  for (let i = 0; i < 12; i++) e.pointerDown(20 + i * 5, 30, 0);
  check('manual eggs bypass natural species and global mob caps',
    e.getCreatures().filter((c) => c.species === CREATURE.FOX).length === 12);
  e.destroy();
}

// 8) Fast rigid/component draft moves interpolate between samples instead of
// leaving empty chunks in the preview/finalized shape.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.RIGID);
  e.pointerDown(20, 40, 0);
  e.pointerDraft(36, 40);
  const cells = e.getStoneDraftCells();
  let continuous = true;
  for (let x = 20; x <= 36; x++) if (!hasCell(cells, x, 40)) continuous = false;
  check('rigid draft interpolates a fast horizontal stroke', continuous);
  e.pointerUp(0);
  check('interpolated rigid draft materializes as one free body', e._bodyCount() === 1);
  e.destroy();
}

{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.BRICK);
  e.pointerDown(20, 40, 0);
  e.pointerDraft(36, 40);
  e.pointerUp(0);
  let solidLine = true;
  for (let x = 20; x <= 36; x++) if (at(e.getGrid(), x, 40) !== MAT.BRICK) solidLine = false;
  check('component draft materializes an interpolated stroke without gaps', solidLine);
  check('component stroke starts as one body', e._bodyCount() === 1);
  e.destroy();
}

// 9) The direct draft ABI finalizes through the same body path.
{
  const e = mk();
  e.addDiscToStoneDraft(60, 60, 0);
  e.finalizeStoneDraft();
  check('direct stone draft finalizes as a body',
    at(e.getGrid(), 60, 60) === MAT.STONE && e._bodyCount() === 1);
  e.destroy();
}

// Disconnected islands in one draft make their own support decisions.
{
  const e = mk();
  for (let y = 20; y < ROWS; y++) e.paintDisc(35, y, 0, MAT.STONE, true);
  e.syncComponents();
  e.addDiscToStoneDraft(36, 30, 0);
  e.addDiscToStoneDraft(70, 30, 0);
  e.finalizeStoneDraft();
  const owners = e._bodyOwnerGrid();
  check('one draft can place a supported static island and an unsupported body',
    e._bodyCount() === 1 && owners[30 * COLS + 36] < 0 && owners[30 * COLS + 70] >= 0);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
