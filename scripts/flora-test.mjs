// Phase 4 flora: per-species trees grow with distinct rules/materials. PT_OAK is
// the original behavior. Cactus/mushroom grow WITHOUT water (desert/cave); each
// species is made of its own wood/leaf material so the type survives streaming.
// Run: node scripts/flora-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 160, ROWS = 120;
const PT = { OAK: 0, PINE: 1, WILLOW: 2, CACTUS: 3, MUSHROOM: 4, BUSH: 5 };
await initSandWasm();
const { check, done } = makeChecker('flora types (Phase 4)');

const LEAF = new Set([MAT.PLANT, MAT.MUSH_CAP]);
const PLANTISH = new Set([MAT.SEED, MAT.WOOD, MAT.PLANT, MAT.PINE_WOOD, MAT.CACTUS, MAT.MUSH_STEM, MAT.MUSH_CAP, MAT.VINE]);

// Grow one seeded tree on a stone floor; water it unless it's a dry species.
// `worldSeed` varies so species shape can be measured across RNG streams (a single
// seed can occasionally flip oak/willow width by a cell).
function grow(type, water, steps = 1100, worldSeed = 7) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed, sinksOn: false, infinite: false });
  for (let x = 20; x < 140; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeSeedTyped(70, 88, type);
  let t = 0;
  for (let s = 0; s < steps; s++) { if (water && s % 15 === 0) e.paintDisc(70, 86, 2, MAT.WATER, false); t += 16; e.step(t); }
  const g = e.getGrid();
  const cnt = {}; let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, leaves = 0;
  let leafBelowWood = 0, leafAboveWood = 0, woodCells = 0;
  // First pass: wood top (min Y — smaller y is up).
  let woodMinY = 1e9;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === MAT.WOOD || g[i] === MAT.PINE_WOOD) {
      const y = (i / COLS) | 0;
      if (y < woodMinY) woodMinY = y;
      woodCells++;
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (!PLANTISH.has(g[i])) continue;
    const x = i % COLS, y = (i / COLS) | 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    cnt[g[i]] = (cnt[g[i]] || 0) + 1;
    if (LEAF.has(g[i])) {
      leaves++;
      // Adjacent leaf contacts on wood cells measure droop (willow leaf candidates bias y+1).
      const up = y > 0 ? g[(y - 1) * COLS + x] : 0;
      const down = y + 1 < ROWS ? g[(y + 1) * COLS + x] : 0;
      if (up === MAT.WOOD || up === MAT.PINE_WOOD) leafBelowWood++; // leaf is below a wood cell
      if (down === MAT.WOOD || down === MAT.PINE_WOOD) leafAboveWood++; // leaf is above a wood cell
    }
  }
  e.destroy();
  return {
    cnt, leaves, w: maxX - minX + 1, h: maxY - minY + 1,
    leafBelowWood, leafAboveWood, woodCells, woodMinY,
  };
}

const oak = grow(PT.OAK, true);
check(`oak grows wood + foliage (${oak.cnt[MAT.WOOD]}w ${oak.cnt[MAT.PLANT]}l)`, oak.cnt[MAT.WOOD] > 10 && oak.cnt[MAT.PLANT] > 10);

const pine = grow(PT.PINE, true);
check(`pine is its own wood (PINE_WOOD ${pine.cnt[MAT.PINE_WOOD] || 0})`, (pine.cnt[MAT.PINE_WOOD] || 0) > 10);
check(`pine grows tall & narrow (h ${pine.h} > w ${pine.w})`, pine.h > pine.w * 2);

const willow = grow(PT.WILLOW, true);
check(`willow grows wood + foliage (${willow.cnt[MAT.WOOD] || 0}w ${willow.cnt[MAT.PLANT] || 0}l)`,
  (willow.cnt[MAT.WOOD] || 0) > 8 && (willow.cnt[MAT.PLANT] || 0) > 8);
// Willow foliage candidates bias downward (y+1/y+2). Across several growth RNG
// streams the canopy is also narrower than oak on average (single-seed width can
// tie or flip by a cell — seed 7 is one such case: willow 13 vs oak 12).
const SHAPE_SEEDS = [7, 11, 13, 17, 19, 23, 29, 31];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const oakWidths = SHAPE_SEEDS.map((s) => grow(PT.OAK, true, 1100, s).w);
const willowWidths = SHAPE_SEEDS.map((s) => grow(PT.WILLOW, true, 1100, s).w);
const oakMeanW = mean(oakWidths);
const willowMeanW = mean(willowWidths);
check(
  `willow canopy is narrower than oak on average (mean w ${willowMeanW.toFixed(1)} < oak ${oakMeanW.toFixed(1)}; samples willow=[${willowWidths}] oak=[${oakWidths}])`,
  willowMeanW < oakMeanW,
);
// Droop: willow should put at least as much foliage under wood as over it
// (oak prefers crown-up candidates). Measured on the default seed stream.
check(
  `willow foliage droops (leaf-below-wood ${willow.leafBelowWood} >= leaf-above-wood ${willow.leafAboveWood})`,
  willow.leafBelowWood >= willow.leafAboveWood,
);

const bush = grow(PT.BUSH, true);
check(`bush stays short & leafy (h ${bush.h}, leaves ${bush.leaves})`, bush.h < oak.h / 2 && bush.leaves > 0);

const cactus = grow(PT.CACTUS, false); // NO water
check(`cactus grows WITHOUT water as CACTUS (${cactus.cnt[MAT.CACTUS] || 0})`, (cactus.cnt[MAT.CACTUS] || 0) > 8);
check(`cactus has zero foliage (leaves ${cactus.leaves})`, cactus.leaves === 0);

const mush = grow(PT.MUSHROOM, false); // NO water
check(`mushroom grows WITHOUT water: stem + cap (${mush.cnt[MAT.MUSH_STEM] || 0} stem, ${mush.cnt[MAT.MUSH_CAP] || 0} cap)`, (mush.cnt[MAT.MUSH_STEM] || 0) > 4 && (mush.cnt[MAT.MUSH_CAP] || 0) > 4);

// Generic wood placement should stay inert. Trees only grow while connected to a seed.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 20; x < 140; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeMaterial(70, 88, 1, MAT.WOOD);
  let t = 0;
  for (let s = 0; s < 500; s++) { if (s % 15 === 0) e.paintDisc(70, 86, 2, MAT.WATER, false); t += 16; e.step(t); }
  let wood = 0, plant = 0;
  for (const v of e.getGrid()) { if (v === MAT.WOOD) wood++; if (v === MAT.PLANT) plant++; }
  check(`placed wood does not grow without a seed (${wood} wood, ${plant} foliage)`, wood <= 13 && plant === 0);
  e.destroy();
}

// A dropped seed item floating on water should plant itself and wake growth.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 50; x < 90; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let x = 62; x <= 78; x++) for (let y = 84; y < 90; y++) e.paintDisc(x, y, 0, MAT.WATER, false);
  e.spawnItem(MAT.SEED, 1, 70, 80, 0, 0);
  let t = 0;
  for (let s = 0; s < 800; s++) { t += 16; e.step(t); }
  let seed = 0, wood = 0, leaf = 0, itemSeeds = 0;
  for (const v of e.getGrid()) { if (v === MAT.SEED) seed++; if (v === MAT.WOOD) wood++; if (v === MAT.PLANT) leaf++; }
  for (const it of e.getItems()) if (it.kind === 0 && it.material === MAT.SEED) itemSeeds += it.count;
  check(`dropped seed auto-plants on water and grows (seed ${seed}, wood ${wood}, leaf ${leaf}, item ${itemSeeds})`, seed > 0 && wood > 0 && itemSeeds === 0);
  e.destroy();
}

// Worldgen produces typed flora (trees are stamped into the background layer).
{
  const e = createEngineWasm({ cols: 220, rows: 160, worldSeed: 0xBED, sinksOn: false, infinite: true });
  const woods = new Set();
  for (let i = 0; i < 40; i++) {
    const g = e.getGridBg();
    for (const v of g) if (v === MAT.WOOD || v === MAT.PINE_WOOD || v === MAT.CACTUS) woods.add(v);
    e.shiftWorldXY(128, 0);
  }
  check(`worldgen stamps multiple tree species (${[...woods].length} wood types)`, woods.size >= 2);
  e.destroy();
}

// Type persistence across streaming: a grown cactus's cells (which ENCODE the
// species) survive a shift off-buffer and back via the tile store.
{
  const C = 220, R = 140, SX = 110;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 9, sinksOn: false, infinite: true });
  // find the solid surface top in column SX and seat the seed just above it
  let top = R; { const g = e.getGrid(); for (let y = 0; y < R; y++) { const v = g[y * C + SX]; if (v !== MAT.EMPTY && v !== MAT.WATER) { top = y; break; } } }
  const placed = e.placeSeedTyped(SX, top - 3, PT.CACTUS);
  check('cactus seed placed in the infinite world', placed);
  let t = 0; for (let s = 0; s < 900; s++) { t += 16; e.step(t); }
  const count = (en) => { const g = en.getGrid(); let n = 0; for (const v of g) if (v === MAT.CACTUS) n++; return n; };
  const before = count(e);
  e.shiftWorldXY(128, 0); // stream the cactus off the left edge
  const offEdge = count(e);
  e.shiftWorldXY(-128, 0); // stream it back in from the tile store
  const after = count(e);
  check(`grown cactus persists across streaming (${before} -> off ${offEdge} -> ${after})`, before > 8 && offEdge === 0 && after === before);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
