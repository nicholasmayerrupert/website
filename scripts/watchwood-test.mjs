// Watchwood trees and observation shrines use real component-backed materials.
import process from 'node:process';
import { initSandWasm, createEngineWasm, BIOME, MAT, WORLD_FEATURE } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';
import { PLANT_SPECIES, TC, TT } from '../src/sand/materials.generated.js';

await initSandWasm();
const { check, done } = makeChecker('Watchwood generation');
const eyeMats = new Set([MAT.EYE_WOOD, MAT.EYE_SCLERA, MAT.EYE_IRIS, MAT.EYE_PUPIL]);
const make = (worldSeed, cols = 320) => attachTestHooks(createEngineWasm({
  cols, rows: 240, worldSeed, sinksOn: false, infinite: true,
}));
function moveTo(e, x, y) {
  const targetX = Math.round((x - e.cols / 2) / 32) * 32;
  const targetY = Math.round((y - e.rows / 2) / 32) * 32;
  while (e.getWorldOffsetX() !== targetX)
    e.shiftWorldXY(Math.max(-128, Math.min(128, targetX - e.getWorldOffsetX())), 0);
  while (e.getWorldOffsetY() !== targetY)
    e.shiftWorldXY(0, Math.max(-96, Math.min(96, targetY - e.getWorldOffsetY())));
}
const e = make(0xBEEF);
moveTo(e, -550, -8);
check('Watchwood is a real generated biome with plum soil and pale strata',
  e.worldBiomeAt(-550) === BIOME.WATCHWOOD
  && e.getGrid().includes(MAT.VEIN_SOIL) && e.getGrid().includes(MAT.PALESTONE));
check('generated eye trees contain trunks, sclera, irises, and pupils',
  [...eyeMats].every((mat) => e.getGridBg().filter((value) => value === mat).length > 40));
const x0 = e.getWorldOffsetX() + 48, y0 = e.getWorldOffsetY() + 32;
const patch = (en) => {
  const result = [];
  for (const grid of [en.getGrid(), en.getGridBg()])
    for (let y = y0; y < y0 + 160; y++) for (let x = x0; x < x0 + 224; x++)
      result.push(grid[(y - en.getWorldOffsetY()) * en.cols + x - en.getWorldOffsetX()]);
  return result;
};
const before = patch(e);
const wide = make(0xBEEF, 512);
moveTo(wide, -550, -8);
const wider = patch(wide);
check('eye crowns and buried roots are identical across viewport sizes',
  before.every((mat, i) => mat === wider[i]));
wide.destroy();
for (let i = 0; i < 4; i++) e.shiftWorldXY(128, 0);
for (let i = 0; i < 4; i++) e.shiftWorldXY(-128, 0);
const streamed = patch(e);
check('both layers restore the same eye forest across streaming boundaries',
  before.every((mat, i) => mat === streamed[i]));
const trees = e.getGridBg().slice();
for (let i = 0; i < 120; i++) e.stepWorld();
let changed = 0;
for (let y = 0; y < e.rows; y++) for (let x = 32; x < e.cols - 32; x++) {
  const k = y * e.cols + x;
  if (eyeMats.has(trees[k]) && e.getGridBg()[k] !== trees[k]) changed++;
}
check(`rooted eye trees remain static during terrain settling (${changed} changed cells)`, changed === 0);
let cut = null;
for (let x = 72; x < e.cols - 72 && !cut; x++) {
  const y = e.worldSurfaceAbsAt(e.getWorldOffsetX() + x) - e.getWorldOffsetY() - 3;
  if (e.getGridBg()[y * e.cols + x] === MAT.EYE_WOOD
      && e.getGridBg()[y * e.cols + x + 1] === MAT.EYE_WOOD) cut = { x, y };
}
let released = false;
if (cut) {
  e.eraseDiscLayer(1, cut.x, cut.y, 4);
  for (let i = 0; i < 90; i++) {
    e.stepWorld();
    released ||= e._bodyCountLayer(1) > 0;
  }
}
check('cutting a rooted eye tree releases a simulated rigid body', !!cut && released);
e.destroy();

const village = make(7);
moveTo(village, -225, -24);
const context = village.worldContextAt(-225, -20);
check('Watchwood observation shrines participate in settlement placement and semantics',
  context.surfaceBiome === BIOME.WATCHWOOD
  && context.featureKind === WORLD_FEATURE.VILLAGE_BUILDING);
let lenses = 0, dome = 0, blocked = 0;
for (let wx = -244; wx <= -206; wx++) {
  const x = wx - village.getWorldOffsetX();
  for (let wy = -36; wy < -9; wy++) {
    const k = (wy - village.getWorldOffsetY()) * village.cols + x;
    lenses += village.getGridBg()[k] === MAT.EYE_IRIS;
    dome += village.getGrid()[k] === MAT.PALESTONE;
    if (wy >= -19) blocked += village.getGrid()[k] !== MAT.EMPTY;
  }
}
check('observation shrines contain pale domes and eye instruments with a clear passage',
  lenses > 10 && dome > 10 && blocked === 0);
village.destroy();

const eyeSpecies = PLANT_SPECIES.find((species) => species.name === 'EYE');
const grownShapes = new Set(), grownHeights = new Set();
for (let seed = 0; seed < 8; seed++) {
  const typed = seed % 2 === 0;
  const planted = attachTestHooks(createEngineWasm({
    cols: 160, rows: 120, worldSeed: seed, sinksOn: false, infinite: false,
  }));
  for (let x = 20; x < 140; x++) for (let y = 90; y < 120; y++)
    planted.addDiscToStoneDraft(x, y, 0);
  planted.finalizeStoneDraft();
  const seedX = 45 + seed * 8;
  if (typed) planted.placeSeedTyped(seedX, 88, eyeSpecies.id);
  else planted.placeMaterial(seedX, 88, 0, MAT.EYE_SEED);
  for (let i = 0; i < 60; i++) planted.step(i * 16);
  const youngCells = planted.getGrid().filter((mat) => eyeMats.has(mat)).length;
  for (let i = 60; i < 100; i++) planted.step(i * 16);
  const budding = planted.getGrid().slice();
  for (let i = 100; i < 1100; i++) planted.step(i * 16);
  const grown = planted.getGrid().slice();
  check(`${typed ? 'typed' : 'material'} eyeball seeds grow complete eyes on branching trunks`,
    grown.includes(MAT.EYE_SEED)
    && [...eyeMats].every((mat) => grown.filter((value) => value === mat).length >= 3)
    && !grown.includes(MAT.PLANT));
  const coords = [...grown.keys()].filter((k) => eyeMats.has(grown[k]));
  if (seed === 0) {
    const isEye = (mat) => eyeMats.has(mat) && mat !== MAT.EYE_WOOD;
    const budTop = Math.min(...coords.filter((k) => isEye(budding[k]))
      .map((k) => Math.floor(k / planted.cols)));
    check('the eye develops across a living crown instead of completing horizontal rows',
      coords.some((k) => isEye(grown[k]) && budding[k] === MAT.EMPTY
        && Math.floor(k / planted.cols) > budTop + 1));
  }
  check('eyeball seedlings grow gradually before filling their mature crowns',
    youngCells > 0 && youngCells < coords.length / 2);
  const top = Math.min(...coords.map((k) => Math.floor(k / planted.cols)));
  const left = Math.min(...coords.map((k) => k % planted.cols));
  const right = Math.max(...coords.map((k) => k % planted.cols));
  grownShapes.add(`${right - left}:${coords.length}`);
  grownHeights.add(89 - top);
  for (let i = 1100; i < 1300; i++) planted.step(i * 16);
  check('mature planted eye trees remain stable',
    grown.every((mat, i) => mat === planted.getGrid()[i]));
  if (seed === 0) {
    const player = planted.spawnPlayer(110, 80);
    planted.setPlayerTool(player, TC.dig, TT.wood);
    for (const k of coords) if (grown[k] !== MAT.EYE_WOOD)
      for (let hit = 0; hit < 40; hit++) planted.playerMine(player, k % planted.cols, Math.floor(k / planted.cols));
    const seeds = planted.getItems().filter((item) => item.material === MAT.EYE_SEED);
    check('harvesting an eye crown drops plantable eyeball seeds with their species intact',
      seeds.length > 0 && seeds.every((item) => item.plantType === eyeSpecies.id));
  }
  planted.destroy();
}
check(`seed-grown eyes vary in silhouette and height across plants (${[...grownShapes]} / ${[...grownHeights]})`,
  grownShapes.size >= 6 && grownHeights.size >= 3);
process.exitCode = done() === 0 ? 0 : 1;
