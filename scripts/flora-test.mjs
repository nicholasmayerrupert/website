// Per-species flora grow without water and use distinct silhouettes/materials.
// Vines descend and produce emissive glowberries.
// Run: node scripts/flora-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 160, ROWS = 120;
const PT = { OAK: 0, PINE: 1, WILLOW: 2, CACTUS: 3, MUSHROOM: 4, BUSH: 5, VINE: 6, STANDARD: 7 };
await initSandWasm();
const { check, done } = makeChecker('flora types');

const LEAF = new Set([MAT.PLANT, MAT.PINE_NEEDLES, MAT.WILLOW_LEAF, MAT.BUSH_LEAF, MAT.MUSH_CAP, MAT.GLOWBERRY]);
const WOOD = new Set([MAT.WOOD, MAT.PINE_WOOD, MAT.CACTUS, MAT.MUSH_STEM, MAT.VINE]);
const PLANTISH = new Set([MAT.SEED, ...WOOD, ...LEAF]);

// Grow one seeded tree on a stone floor. `water` is retained so this harness can
// still exercise the dormant water path if the growth requirement is restored.
// `worldSeed` varies so species shape can be measured across RNG streams (a single
// seed can occasionally flip oak/willow width by a cell).
function grow(type, water, steps = 1100, worldSeed = 7) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed, sinksOn: false, infinite: false });
  for (let x = 20; x < 140; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  if (type === PT.STANDARD) e.placeSeedAt(70, 88);
  else e.placeSeedTyped(70, 88, type);
  let t = 0;
  for (let s = 0; s < steps; s++) { if (water && s % 15 === 0) e.paintDisc(70, 86, 2, MAT.WATER, false); t += 16; e.step(t); }
  const g = e.getGrid();
  const cnt = {}; let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, leaves = 0;
  let leafBelowWood = 0, leafAboveWood = 0, woodCells = 0, woodMinX = 1e9, woodMaxX = -1;
  let plantCells = 0, seedIndex = -1, leafMinY = ROWS, leafMaxY = -1;
  const woodRowMin = Array(ROWS).fill(1e9), woodRowMax = Array(ROWS).fill(-1);
  // First pass: wood top (min Y — smaller y is up).
  let woodMinY = 1e9;
  for (let i = 0; i < g.length; i++) {
    if (WOOD.has(g[i])) {
      const y = (i / COLS) | 0;
      if (y < woodMinY) woodMinY = y;
      const x = i % COLS;
      woodMinX = Math.min(woodMinX, x); woodMaxX = Math.max(woodMaxX, x);
      woodRowMin[y] = Math.min(woodRowMin[y], x); woodRowMax[y] = Math.max(woodRowMax[y], x);
      woodCells++;
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (!PLANTISH.has(g[i])) continue;
    const x = i % COLS, y = (i / COLS) | 0;
    plantCells++;
    if (g[i] === MAT.SEED) seedIndex = i;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    cnt[g[i]] = (cnt[g[i]] || 0) + 1;
    if (LEAF.has(g[i])) {
      leaves++;
      leafMinY = Math.min(leafMinY, y); leafMaxY = Math.max(leafMaxY, y);
      // Adjacent leaf contacts on wood cells measure droop (willow leaf candidates bias y+1).
      const up = y > 0 ? g[(y - 1) * COLS + x] : 0;
      const down = y + 1 < ROWS ? g[(y + 1) * COLS + x] : 0;
      if (WOOD.has(up)) leafBelowWood++; // leaf is below a wood cell
      if (WOOD.has(down)) leafAboveWood++; // leaf is above a wood cell
    }
  }
  const branchWidths = woodRowMin.flatMap((x, y) => woodRowMax[y] - x >= 2 ? [woodRowMax[y] - x + 1] : []);
  let thickTrunkRows = 0;
  for (let y = 73; y < 88; y++) {
    let longest = 0, run = 0;
    for (let x = 65; x <= 75; x++) {
      if (WOOD.has(g[y * COLS + x])) { run++; longest = Math.max(longest, run); }
      else run = 0;
    }
    if (longest >= 2) thickTrunkRows++;
  }
  const seen = new Uint8Array(g.length), stack = seedIndex >= 0 ? [seedIndex] : [];
  let connectedCells = 0;
  if (seedIndex >= 0) seen[seedIndex] = 1;
  while (stack.length) {
    const i = stack.pop(), x = i % COLS, y = (i / COLS) | 0;
    connectedCells++;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const ni = ny * COLS + nx;
      if (!seen[ni] && PLANTISH.has(g[ni])) { seen[ni] = 1; stack.push(ni); }
    }
  }
  let disconnectedWood = 0, disconnectedLeaves = 0;
  for (let i = 0; i < g.length; i++) if (PLANTISH.has(g[i]) && !seen[i]) {
    if (WOOD.has(g[i])) disconnectedWood++;
    else disconnectedLeaves++;
  }
  let trunkGapRows = 0, lowerTrunkLeaves = 0;
  if (seedIndex >= 0 && woodMinY < ROWS) {
    const seedX = seedIndex % COLS, seedY = (seedIndex / COLS) | 0;
    for (let y = woodMinY; y < seedY; y++) {
      let hasTrunk = false;
      for (let x = seedX - 3; x <= seedX + 3; x++) if (WOOD.has(g[y * COLS + x])) { hasTrunk = true; break; }
      if (!hasTrunk) trunkGapRows++;
    }
    for (let y = seedY - 20; y < seedY; y++) for (let x = seedX - 4; x <= seedX + 4; x++)
      if (LEAF.has(g[y * COLS + x])) lowerTrunkLeaves++;
  }
  e.destroy();
  return {
    cnt, leaves, w: maxX - minX + 1, h: maxY - minY + 1,
    leafBelowWood, leafAboveWood, woodCells, woodMinY, woodW: woodMaxX - woodMinX + 1,
    branchRows: branchWidths.length, branchWidths, thickTrunkRows,
    disconnectedCells: plantCells - connectedCells, disconnectedWood, disconnectedLeaves,
    leafMinY, leafMaxY, trunkGapRows, lowerTrunkLeaves,
  };
}

const oak = grow(PT.OAK, false);
check(`oak grows WITHOUT water (${oak.cnt[MAT.WOOD]}w ${oak.cnt[MAT.PLANT]}l)`, oak.cnt[MAT.WOOD] > 10 && oak.cnt[MAT.PLANT] > 10);
check(`oak is medium-tall with a broad crown (${oak.w}w x ${oak.h}h, ${oak.leaves} leaves)`, oak.h >= 54 && oak.h <= 62 && oak.w >= 30 && oak.leaves >= 400);
check(`oak growth stays connected to its seed (${oak.disconnectedWood}w+${oak.disconnectedLeaves}l)`, oak.disconnectedCells === 0);
check(`oak trunk has no missing rows (${oak.trunkGapRows} gaps)`, oak.trunkGapRows === 0);

const standard = grow(PT.STANDARD, false);
check(`plain Seed retains its original growth budget (${standard.woodCells} wood, ${standard.leaves} leaves)`, standard.woodCells === 121 && standard.leaves === 105);
check(`plain Seed remains distinct from Oak Seed (${standard.w}w x ${standard.h}h)`, standard.w < oak.w && standard.leaves < oak.leaves / 3);

const pine = grow(PT.PINE, false);
check(`pine grows WITHOUT water as PINE_WOOD (${pine.cnt[MAT.PINE_WOOD] || 0})`, (pine.cnt[MAT.PINE_WOOD] || 0) > 10);
check(`pine has a substantial distinct needle canopy (${pine.cnt[MAT.PINE_NEEDLES] || 0})`, (pine.cnt[MAT.PINE_NEEDLES] || 0) >= 220 && !pine.cnt[MAT.PLANT]);
check(`pine grows a broad, irregular branch skeleton (${pine.woodW}w skeleton; ${pine.w}w x ${pine.h}h overall)`, pine.woodW >= 12 && pine.w >= 16 && pine.h > pine.w);
check(`pine grows taller (${pine.h} cells tall)`, pine.h >= 36);
check(`pine has a tapered multi-cell trunk (${pine.thickTrunkRows} thick lower rows)`, pine.thickTrunkRows >= 8);
const youngPine = grow(PT.PINE, false, 60, 7);
check(`pine starts foliage while its skeleton is young (${youngPine.woodCells} wood, ${youngPine.leaves} needles)`, youngPine.woodCells < pine.woodCells && youngPine.leaves >= 8);

const willow = grow(PT.WILLOW, false);
check(`willow grows WITHOUT water with distinct foliage (${willow.cnt[MAT.WOOD] || 0}w ${willow.cnt[MAT.WILLOW_LEAF] || 0}l)`,
  (willow.cnt[MAT.WOOD] || 0) > 8 && (willow.cnt[MAT.WILLOW_LEAF] || 0) > 8 && !willow.cnt[MAT.PLANT]);
// Willow uses a deliberately smaller, thinner wood skeleton than oak and grows
// long leaf curtains below its lateral limbs.
const SHAPE_SEEDS = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const oaks = SHAPE_SEEDS.map((s) => grow(PT.OAK, false, 1100, s));
const willows = SHAPE_SEEDS.map((s) => grow(PT.WILLOW, false, 1100, s));
const pines = SHAPE_SEEDS.map((s) => grow(PT.PINE, false, 1100, s));
const oakMeanWood = mean(oaks.map((tree) => tree.woodCells));
const willowMeanWood = mean(willows.map((tree) => tree.woodCells));
check(
  `willow keeps a distinct branch-led skeleton (mean wood ${willowMeanWood.toFixed(1)}, oak ${oakMeanWood.toFixed(1)})`,
  willowMeanWood < oakMeanWood * 1.05,
);
const pineShapes = new Set(pines.map((tree) => `${tree.woodCells}/${tree.woodW}/${tree.branchRows}`));
const willowShapes = new Set(willows.map((tree) => `${tree.woodCells}/${tree.woodW}/${tree.branchRows}`));
check(`pine branch frequency/length varies across seeds (${pineShapes.size}/${SHAPE_SEEDS.length} distinct skeletons)`, pineShapes.size >= 6);
check(`willow branch frequency/length varies across seeds (${willowShapes.size}/${SHAPE_SEEDS.length} distinct skeletons)`, willowShapes.size >= 6);
check(`willow growth stays connected to its seed (${willows.map((tree) => `${tree.disconnectedWood}w+${tree.disconnectedLeaves}l`).join('/')})`, willows.every((tree) => tree.disconnectedCells === 0));
check(
  `willow has wide arched limbs and hanging foliage (${willow.woodW}w skeleton; leaf-below ${willow.leafBelowWood} vs above ${willow.leafAboveWood})`,
  willow.woodW >= 22 && willow.leafBelowWood > willow.leafAboveWood * 1.15,
);
check(`willow has a substantial multi-cell trunk (${willow.thickTrunkRows} thick lower rows)`, willow.thickTrunkRows >= 8);
check(`willow grows taller (${willow.h} cells tall)`, willow.h >= 45);
check(`willow curtains hang from the upper branches (${willow.leafMinY}..${willow.leafMaxY}, ${willow.lowerTrunkLeaves} lower-trunk leaves)`,
  willow.leafMaxY - willow.leafMinY >= 30 && willow.leafMaxY >= 80 && willow.lowerTrunkLeaves <= 20);
const youngWillow = grow(PT.WILLOW, false, 100, 7);
check(`willow starts curtains while its skeleton is young (${youngWillow.woodCells} wood, ${youngWillow.leaves} leaves)`, youngWillow.woodCells < willow.woodCells && youngWillow.leaves >= 5);

const bush = grow(PT.BUSH, false);
check(`bush grows WITHOUT water and stays short (h ${bush.h}, leaves ${bush.cnt[MAT.BUSH_LEAF] || 0})`, bush.h < oak.h / 2 && (bush.cnt[MAT.BUSH_LEAF] || 0) > 0);

const cactus = grow(PT.CACTUS, false); // NO water
check(`cactus grows WITHOUT water as CACTUS (${cactus.cnt[MAT.CACTUS] || 0})`, (cactus.cnt[MAT.CACTUS] || 0) > 8);
check(`cactus has zero foliage (leaves ${cactus.leaves})`, cactus.leaves === 0);
check(`cactus grows a branching silhouette (${cactus.w}w x ${cactus.h}h)`, cactus.w >= 4 && cactus.h > cactus.w * 2);

const mush = grow(PT.MUSHROOM, false); // NO water
check(`mushroom grows WITHOUT water: stem + cap (${mush.cnt[MAT.MUSH_STEM] || 0} stem, ${mush.cnt[MAT.MUSH_CAP] || 0} cap)`, (mush.cnt[MAT.MUSH_STEM] || 0) > 4 && (mush.cnt[MAT.MUSH_CAP] || 0) > 4);
check(`mushroom grows a broad, substantial cap (${mush.w}w, ${mush.cnt[MAT.MUSH_CAP] || 0} cap)`, mush.w >= 9 && (mush.cnt[MAT.MUSH_CAP] || 0) >= 20);

// A vine seed hangs from a grounded ceiling, grows downward, then buds berries.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 19, sinksOn: false, infinite: false });
  for (let x = 20; x < 140; x++) e.addDiscToStoneDraft(x, 20, 0);
  for (let y = 20; y < ROWS; y++) e.addDiscToStoneDraft(20, y, 0);
  e.finalizeStoneDraft();
  e.placeSeedTyped(70, 21, PT.VINE);
  let t = 0;
  for (let s = 0; s < 1100; s++) { t += 16; e.step(t); }
  let vine = 0, berries = 0, minY = ROWS, maxY = 0;
  const g = e.getGrid();
  for (let i = 0; i < g.length; i++) {
    if (g[i] === MAT.VINE) { vine++; minY = Math.min(minY, (i / COLS) | 0); maxY = Math.max(maxY, (i / COLS) | 0); }
    if (g[i] === MAT.GLOWBERRY) berries++;
  }
  check(`vine grows downward (${vine} cells, y ${minY}..${maxY})`, vine >= 25 && maxY - minY >= 20);
  check(`vine grows glowberries (${berries})`, berries >= 3);
  e.destroy();
}

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
  const woods = new Set(); let willowLeaves = 0;
  for (let i = 0; i < 40; i++) {
    const g = e.getGridBg();
    for (const v of g) {
      if (v === MAT.WOOD || v === MAT.PINE_WOOD || v === MAT.CACTUS) woods.add(v);
      if (v === MAT.WILLOW_LEAF) willowLeaves++;
    }
    e.shiftWorldXY(128, 0);
  }
  check(`worldgen stamps multiple tree species (${[...woods].length} wood types)`, woods.size >= 2);
  check(`worldgen restores willow silhouettes to swamps (${willowLeaves} leaves sampled)`, willowLeaves > 0);
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
