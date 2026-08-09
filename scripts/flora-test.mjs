// Per-species flora grow without water and use distinct silhouettes/materials.
// Vines descend and produce emissive glowberries.
// Run: node scripts/flora-test.mjs

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const createEngineWasm = (options) => attachTestHooks(createEngineWasmRaw(options));

const COLS = 160, ROWS = 120;
const PT = { OAK: 0, PINE: 1, WILLOW: 2, CACTUS: 3, MUSHROOM: 4, BUSH: 5, VINE: 6, STANDARD: 7 };
await initSandWasm();
const { check, done } = makeChecker('flora types');

const SEEDS = new Set([MAT.SEED, MAT.OAK_SEED]);
const LEAF = new Set([MAT.PLANT, MAT.OAK_LEAF, MAT.PINE_NEEDLES, MAT.WILLOW_LEAF, MAT.BUSH_LEAF, MAT.MUSH_CAP, MAT.GLOWBERRY]);
const WOOD = new Set([MAT.WOOD, MAT.OAK_WOOD, MAT.PINE_WOOD, MAT.CACTUS, MAT.MUSH_STEM, MAT.VINE]);
const PLANTISH = new Set([...SEEDS, ...WOOD, ...LEAF]);

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
    if (SEEDS.has(g[i])) seedIndex = i;
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
check(`oak grows WITHOUT water (${oak.cnt[MAT.OAK_WOOD]}w ${oak.cnt[MAT.OAK_LEAF]}l)`, oak.cnt[MAT.OAK_WOOD] > 10 && oak.cnt[MAT.OAK_LEAF] > 10);
check('Oak Seed and its tree use only oak material identities', oak.cnt[MAT.OAK_SEED] === 1 && !oak.cnt[MAT.SEED] && !oak.cnt[MAT.WOOD] && !oak.cnt[MAT.PLANT]);
check(`oak is medium-tall with a broad crown (${oak.w}w x ${oak.h}h, ${oak.leaves} leaves)`, oak.h >= 54 && oak.h <= 62 && oak.w >= 30 && oak.leaves >= 400);
check(`oak growth stays connected to its seed (${oak.disconnectedWood}w+${oak.disconnectedLeaves}l)`, oak.disconnectedCells === 0);
check(`oak trunk has no missing rows (${oak.trunkGapRows} gaps)`, oak.trunkGapRows === 0);

const standard = grow(PT.STANDARD, false);
check(`plain Seed retains its growth budget (${standard.woodCells} wood, ${standard.leaves} leaves)`, standard.woodCells >= 120 && standard.woodCells <= 122 && standard.leaves === 105);
check(`plain Seed remains distinct from Oak Seed (${standard.w}w x ${standard.h}h)`, standard.w < oak.w && standard.leaves < oak.leaves / 3);
check('plain Seed and its tree never become oak materials', standard.cnt[MAT.SEED] === 1 && !standard.cnt[MAT.OAK_SEED] && !standard.cnt[MAT.OAK_WOOD] && !standard.cnt[MAT.OAK_LEAF]);

const pine = grow(PT.PINE, false);
check(`pine grows WITHOUT water as PINE_WOOD (${pine.cnt[MAT.PINE_WOOD] || 0})`, (pine.cnt[MAT.PINE_WOOD] || 0) > 10);
check(`pine has a substantial distinct needle canopy (${pine.cnt[MAT.PINE_NEEDLES] || 0})`, (pine.cnt[MAT.PINE_NEEDLES] || 0) >= 220 && !pine.cnt[MAT.PLANT]);
check(`pine grows a broad, irregular branch skeleton (${pine.woodW}w skeleton; ${pine.w}w x ${pine.h}h overall)`, pine.woodW >= 12 && pine.w >= 16 && pine.h > pine.w);
check(`pine grows taller than it is wide (${pine.h} cells tall)`, pine.h >= 30);
check(`pine has a tapered multi-cell trunk (${pine.thickTrunkRows} thick lower rows)`, pine.thickTrunkRows >= 8);
const youngPine = grow(PT.PINE, false, 60, 7);
check(`pine starts foliage while its skeleton is young (${youngPine.woodCells} wood, ${youngPine.leaves} needles)`, youngPine.woodCells < pine.woodCells && youngPine.leaves >= 7);

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
  willow.woodW >= 22 && willow.leafBelowWood > willow.leafAboveWood * 1.05,
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

// A vine seed settles at the edge of a grounded ledge, grows downward, then
// buds berries.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 19, sinksOn: false, infinite: false });
  for (let x = 20; x <= 70; x++) e.paintDisc(x, 20, 0, MAT.STONE, true);
  for (let y = 20; y < ROWS; y++) e.paintDisc(20, y, 0, MAT.STONE, true);
  e.syncComponents();
  e.placeSeedTyped(70, 19, PT.VINE);
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

// A plain seed can fall as a rigid, bake, and grow without being reclassified as
// oak anywhere in the component/body lifecycle.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 17, sinksOn: false, infinite: false });
  for (let x = 30; x < 130; x++) for (let y = 100; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeSeedAt(70, 65);
  let t = 0;
  for (let s = 0; s < 1100; s++) { t += 16; e.step(t); }
  const cnt = {};
  for (const m of e.getGrid()) cnt[m] = (cnt[m] || 0) + 1;
  check(
    `plain Seed keeps its species through rigid fall and bake (${cnt[MAT.WOOD] || 0}w ${cnt[MAT.PLANT] || 0}l)`,
    cnt[MAT.SEED] === 1 && (cnt[MAT.WOOD] || 0) > 20 && (cnt[MAT.PLANT] || 0) > 20
      && !cnt[MAT.OAK_SEED] && !cnt[MAT.OAK_WOOD] && !cnt[MAT.OAK_LEAF],
  );
  e.destroy();
}

// Reaching a cap makes a tree dormant. Removing foliage from the seeded
// component re-arms growth, while the remaining cap still bounds the repair.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 20; x < 140; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeSeedTyped(70, 88, PT.OAK);
  let t = 0;
  for (let s = 0; s < 1100; s++) { t += 16; e.step(t); }
  const before = [...e.getGrid()].reduce((n, m) => n + (m === MAT.OAK_LEAF), 0);
  const leaf = [...e.getGrid()].findIndex((m) => m === MAT.OAK_LEAF);
  e.eraseDisc(leaf % COLS, (leaf / COLS) | 0, 0);
  const damaged = [...e.getGrid()].reduce((n, m) => n + (m === MAT.OAK_LEAF), 0);
  for (let s = 0; s < 500; s++) { t += 16; e.step(t); }
  const repaired = [...e.getGrid()].reduce((n, m) => n + (m === MAT.OAK_LEAF), 0);
  check(`dormant mature tree resumes growth after damage (${before} -> ${damaged} -> ${repaired})`, damaged < before && repaired > damaged && repaired <= before);
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

// A dropped seed item is represented as a one-cell rigid while falling.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 50; x < 90; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let x = 62; x <= 78; x++) for (let y = 84; y < 90; y++) e.paintDisc(x, y, 0, MAT.WATER, false);
  e.spawnItem(MAT.SEED, 1, 70, 80, 0, 0);
  let t = 0, sawSeedBody = false;
  for (let s = 0; s < 40; s++) {
    t += 16;
    e.step(t);
    if ([...e.getGrid()].some((v) => v === MAT.SEED)) sawSeedBody = true;
  }
  let itemSeeds = 0;
  for (const it of e.getItems()) if (it.kind === 0 && it.material === MAT.SEED) itemSeeds += it.count;
  check(`dropped seed enters the rigid path (seen ${sawSeedBody}, item ${itemSeeds})`, sawSeedBody && itemSeeds === 0);
  e.destroy();
}

// Seeds always begin as bodies. After a stable bake, diagonal structural support
// remains valid; once every neighbouring support cell is gone, both the seed and
// any other isolated component must re-enter the body solver.
{
  const C = 720, R = 520, sx = 350, sy = 299, seedK = sy * C + sx;
  const solidK = sy * C + sx - 2;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 7, sinksOn: false, infinite: false });
  e.setBgEnabled(false);
  for (let x = 300; x < 400; x++) for (let y = 490; y < R; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let y = 298; y < 490; y++) e.paintDisc(349, y, 0, MAT.WOOD, true);
  for (const [x, y] of [[350, 298], [351, 298], [351, 299], [350, 300], [351, 300]])
    e.paintDisc(x, y, 0, MAT.WOOD, true);
  e.paintDisc(sx - 2, sy, 0, MAT.BRICK, true);
  e.syncComponents();
  const bodiesBeforeSeed = e._bodyCount();
  e.placeSeedAt(sx, sy);
  const placedDynamic = e._bodyCount() === bodiesBeforeSeed + 1
    && e.getGrid()[seedK] === MAT.SEED && e._bodyOwnerGrid()[seedK] >= 0;
  let t = 0;
  for (let s = 0; s < 40; s++) { t += 16; e.step(t); }
  const baked = e._bodyCount() === 0
    && e.getGrid()[seedK] === MAT.SEED && e._bodyOwnerGrid()[seedK] < 0;
  e.eraseDisc(sx, sy + 1, 0);
  for (let s = 0; s < 5; s++) { t += 16; e.step(t); }
  const keptDiagonalSupport = e._bodyCount() === 0
    && e.getGrid()[seedK] === MAT.SEED && e._groundedGrid()[seedK] === 1;

  const saturatedBody = [];
  for (let y = 50; y < 140; y++) for (let x = 50; x < 150; x++) saturatedBody.push([x, y]);
  e.spawnBody(saturatedBody);
  e.resetSimulationActivity();
  e.activateSimulationRect(280, 270, 420, 510);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    e.eraseDisc(sx + ox, sy + oy, 0);
  }
  t += 16;
  e.step(t);
  const released = e._bodyCount() === 3
    && e._bodyOwnerGrid()[seedK] >= 0 && e._bodyOwnerGrid()[solidK] >= 0;
  check(
    `seed falls, bakes, and keeps diagonal support under unrelated body load (placed ${placedDynamic}, baked ${baked}, diagonal ${keptDiagonalSupport}, released ${released}, bodies ${e._bodyCount()})`,
    placedDynamic && baked && keptDiagonalSupport && released,
  );
  e.destroy();
}

// Removing the medium below a sleeping seed must wake its rigid body. This is a
// generic sleeping-body support check; the seed has not baked yet.
{
  const C = 120, R = 120;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 7, sinksOn: false, infinite: false });
  e.setBgEnabled(false);
  for (let x = 20; x < 100; x++) for (let y = 105; y < R; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let s = 0; s < 80; s++) e.stepWorld();
  for (let x = 35; x < 85; x++) for (let y = 80; y < 105; y++) e.paintDisc(x, y, 0, MAT.WATER, false);
  e.placeSeedAt(60, 40);
  let slept = false;
  for (let s = 0; s < 180; s++) {
    e.stepWorld();
    if (e._bodyCount() === 1 && e._bodyMaterial(0) === MAT.SEED && e._bodyAwake(0) === 0) {
      slept = true;
      break;
    }
  }
  const beforeY = e._bodyState(0)?.py ?? -1;
  const snapshot = [...e.getGrid()];
  for (let k = 0; k < snapshot.length; k++)
    if (snapshot[k] === MAT.WATER) e.eraseDisc(k % C, (k / C) | 0, 0);
  for (let s = 0; s < 5; s++) e.stepWorld();
  const after = e._bodyState(0);
  check(
    `sleeping seed falls when water support is removed (slept ${slept}, y ${beforeY.toFixed(2)} -> ${after?.py.toFixed(2)})`,
    slept && e._bodyCount() === 1 && e._bodyAwake(0) === 1 && after?.py > beforeY + 0.1,
  );
  e.destroy();
}

// A seed can initially rest and bake on a powder bed, but every growth write
// changes the assembly load. After the tree overloads a deep dirt bed and
// rebakes below the surface, its exposed crown remains part of the seeded plant
// and continues growing.
{
  const C = 160, R = 150;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 17, sinksOn: false, infinite: false });
  e.setBgEnabled(false);
  for (let x = 20; x < 140; x++) for (let y = 110; y < R; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let s = 0; s < 80; s++) e.stepWorld();
  for (let x = 50; x < 110; x++) for (let y = 100; y < 110; y++) e.paintDisc(x, y, 0, MAT.DIRT, false);
  for (let s = 0; s < 200; s++) e.stepWorld();
  e.placeSeedAt(80, 70);
  let sawGrowingBody = false, maxSeedY = -1, maxWood = 0, maxLeaves = 0;
  let woodWhenBuried = -1, topWoodY = R;
  for (let s = 0; s < 900; s++) {
    e.stepWorld();
    const grid = e.getGrid();
    let seed = -1, wood = 0, leaves = 0, top = R;
    for (let k = 0; k < grid.length; k++) {
      if (grid[k] === MAT.SEED) seed = k;
      else if (grid[k] === MAT.WOOD) { wood++; top = Math.min(top, (k / C) | 0); }
      else if (grid[k] === MAT.PLANT) leaves++;
    }
    if (seed >= 0) {
      const seedY = (seed / C) | 0;
      maxSeedY = Math.max(maxSeedY, seedY);
      if (seedY >= 102 && woodWhenBuried < 0) woodWhenBuried = wood;
    }
    maxWood = Math.max(maxWood, wood);
    maxLeaves = Math.max(maxLeaves, leaves);
    topWoodY = Math.min(topWoodY, top);
    if (wood > 0 && e._bodyCount() > 0) sawGrowingBody = true;
  }
  check(
    `buried seed keeps growing from its exposed tree after rebake (${woodWhenBuried} -> ${maxWood} wood, ${maxLeaves} leaves, seed y ${maxSeedY}, top y ${topWoodY})`,
    sawGrowingBody && maxSeedY >= 102 && topWoodY < 100
      && woodWhenBuried >= 0 && maxWood > woodWhenBuried + 40
      && maxWood >= 118 && maxLeaves >= 100,
  );
  e.destroy();
}

// A willow growing on deep powder can overload its support several times. Each
// rigid bake changes the trunk raster, but resumed growth still turns upward and
// rebuilds the species' broad upper limbs and hanging foliage.
{
  const C = 180, R = 160;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 11, sinksOn: false, infinite: false });
  e.setBgEnabled(false);
  for (let x = 20; x < 160; x++) for (let y = 120; y < R; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let s = 0; s < 80; s++) e.stepWorld();
  for (let x = 45; x < 135; x++) for (let y = 100; y < 120; y++) e.paintDisc(x, y, 0, MAT.DIRT, false);
  for (let s = 0; s < 200; s++) e.stepWorld();
  e.placeSeedTyped(90, 70, PT.WILLOW);

  let sawGrowingBody = false;
  for (let s = 0; s < 1400; s++) {
    e.stepWorld();
    if (e._bodyCount() > 0) sawGrowingBody = true;
  }
  const grid = e.getGrid();
  let seed = -1, wood = 0, leaves = 0, plainLeaves = 0;
  let minX = C, maxX = -1, minY = R, maxY = -1, wideWoodRows = 0;
  for (let k = 0; k < grid.length; k++) {
    const material = grid[k];
    if (material === MAT.SEED) seed = k;
    else if (material === MAT.WOOD) wood++;
    else if (material === MAT.WILLOW_LEAF) leaves++;
    else if (material === MAT.PLANT) plainLeaves++;
    if (material === MAT.SEED || material === MAT.WOOD || material === MAT.WILLOW_LEAF) {
      const x = k % C, y = (k / C) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  for (let y = minY; y <= maxY; y++) {
    let lo = C, hi = -1;
    for (let x = minX; x <= maxX; x++) if (grid[y * C + x] === MAT.WOOD) {
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    if (hi - lo >= 7) wideWoodRows++;
  }
  const seedY = seed >= 0 ? (seed / C) | 0 : -1;
  check(
    `rebaked willow turns upward and restores its crown (${wood} wood, ${leaves} leaves, ${maxX - minX + 1}w x ${maxY - minY + 1}h, ${wideWoodRows} wide rows)`,
    sawGrowingBody && seedY >= 112 && wood >= 190 && leaves >= 240
      && maxX - minX + 1 >= 22 && maxY - minY + 1 >= 45
      && wideWoodRows >= 12 && plainLeaves === 0,
  );
  e.destroy();
}

// Fracturing a falling typed tree preserves species on every rigid piece. The
// seed-bearing half can regrow after it settles, but it must remain willow.
{
  const C = 180, R = 160;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 19, sinksOn: false, infinite: false });
  e.setBgEnabled(false);
  for (let x = 20; x < 160; x++) e.addDiscToStoneDraft(x, 110, 0);
  for (let y = 110; y < R; y++) e.addDiscToStoneDraft(20, y, 0);
  for (let x = 20; x < 160; x++) for (let y = 145; y < R; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let s = 0; s < 80; s++) e.stepWorld();
  e.placeSeedTyped(90, 108, PT.WILLOW);
  for (let s = 0; s < 260; s++) e.stepWorld();

  for (let x = 55; x <= 125; x++) e.eraseDisc(x, 110, 0);
  let released = false;
  for (let s = 0; s < 30; s++) {
    e.stepWorld();
    if (e._bodyCount() > 0) { released = true; break; }
  }

  let minY = R, maxY = -1;
  const beforeCut = [...e.getGrid()];
  for (let k = 0; k < beforeCut.length; k++) if (PLANTISH.has(beforeCut[k])) {
    const y = (k / C) | 0;
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cutY = ((minY + maxY) / 2) | 0;
  let cutCells = 0;
  for (let k = cutY * C; k < (cutY + 1) * C; k++) if (PLANTISH.has(beforeCut[k])) {
    e.eraseDisc(k % C, cutY, 0);
    cutCells++;
  }
  let willowAfterCut = 0;
  for (const material of e.getGrid()) if (material === MAT.WILLOW_LEAF) willowAfterCut++;
  for (let s = 0; s < 700; s++) e.stepWorld();
  let seeds = 0, willowLeaves = 0, plainLeaves = 0;
  for (const material of e.getGrid()) {
    if (material === MAT.SEED) seeds++;
    else if (material === MAT.WILLOW_LEAF) willowLeaves++;
    else if (material === MAT.PLANT) plainLeaves++;
  }
  check(
    `falling willow keeps its species after a body fracture (${willowAfterCut} -> ${willowLeaves} willow leaves, ${plainLeaves} plain leaves)`,
    released && cutCells > 0 && seeds === 1
      && willowLeaves > willowAfterCut && plainLeaves === 0,
  );
  e.destroy();
}

// Worldgen produces typed flora (trees are stamped into the background layer).
{
  const e = createEngineWasm({ cols: 220, rows: 160, worldSeed: 0xBED, sinksOn: false, infinite: true });
  const woods = new Set(); let willowLeaves = 0;
  for (let i = 0; i < 40; i++) {
    const g = e.getGridBg();
    for (const v of g) {
      if (v === MAT.OAK_WOOD || v === MAT.PINE_WOOD || v === MAT.CACTUS) woods.add(v);
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
  const C = 220, R = 140;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 4, sinksOn: false, infinite: true });
  // Locate a clear surface column in the half that will leave on the next shift.
  // A fixed column can now intersect a canonical village roof or cave mouth.
  const grid = e.getGrid();
  let SX = -1, top = R;
  for (let x = 16; x < 100 && SX < 0; x++) {
    let candidateTop = R;
    for (let y = 1; y < R; y++) {
      const v = grid[y * C + x];
      if (v !== MAT.EMPTY && v !== MAT.WATER) { candidateTop = y; break; }
    }
    let clear = candidateTop > 32;
    for (let xx = x - 4; clear && xx <= x + 4; xx++)
      for (let yy = candidateTop - 28; yy < candidateTop; yy++) {
        if (grid[yy * C + xx] !== MAT.EMPTY) { clear = false; break; }
      }
    if (clear) {
      SX = x;
      top = candidateTop;
    }
  }
  const placed = e.placeSeedTyped(SX, top - 3, PT.CACTUS);
  check('cactus seed placed in the infinite world', placed);
  const count = (en) => { const g = en.getGrid(); let n = 0; for (const v of g) if (v === MAT.CACTUS) n++; return n; };
  let t = 0;
  for (let s = 0; s < 300 && count(e) < 6; s++) { t += 16; e.step(t); }
  const before = count(e);
  e.shiftWorldXY(128, 0); // stream the cactus off the left edge
  const offEdge = count(e);
  e.shiftWorldXY(-128, 0); // stream it back in from the tile store
  const after = count(e);
  for (let s = 0; s < 900; s++) { t += 16; e.step(t); }
  const resumed = count(e);
  check(`growing cactus persists across streaming (${before} -> off ${offEdge} -> ${after})`,
    before >= 3 && offEdge === 0 && after === before);
  check(`streamed cactus resumes its growth clock (${after} -> ${resumed})`,
    resumed > after && resumed > 8);
  e.destroy();
}

// Persistent metadata retires after its last stored fragment and loaded
// component disappear; revisiting the same tiles must not retain one record per
// plant that used to exist there.
{
  const C = 224, R = 160;
  const e = createEngineWasm({
    cols: C, rows: R, worldSeed: 1, sinksOn: false, infinite: true,
  });
  e.setBgEnabled(false);
  e.shiftWorldXY(128, 0);
  e.shiftWorldXY(-128, 0);
  const baseline = e._componentStateCount();
  for (let x = 20; x <= 80; x++) for (let y = 4; y <= 46; y++)
    if (e.getGrid()[y * C + x] !== MAT.EMPTY) e.eraseDisc(x, y, 0);
  for (let x = 20; x <= 80; x++) e.addDiscToStoneDraft(x, 46, 0);
  e.finalizeStoneDraft();
  const seedX = 50, seedY = 45;
  const placed = e.placeSeedTyped(seedX, seedY, PT.CACTUS);
  let cactusCells = 0;
  for (let step = 0; step < 60; step++) {
    e.stepWorld();
    cactusCells = 0;
    for (const material of e.getGrid()) if (material === MAT.CACTUS) cactusCells++;
  }
  e.shiftWorldXY(128, 0);
  const stored = e._componentStateCount();
  e.shiftWorldXY(-128, 0);
  const grid = e.getGrid();
  let start = -1, nearest = Infinity;
  for (let k = 0; k < grid.length; k++) if (SEEDS.has(grid[k])) {
    const x = k % C, y = (k / C) | 0;
    const distance = Math.abs(x - seedX) + Math.abs(y - seedY);
    if (distance < nearest) { nearest = distance; start = k; }
  }
  const seen = new Uint8Array(grid.length), cells = start >= 0 ? [start] : [];
  if (start >= 0) seen[start] = 1;
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i], x = k % C, y = (k / C) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
      const next = ny * C + nx;
      if (!seen[next] && (grid[next] === MAT.CACTUS || SEEDS.has(grid[next]))) {
        seen[next] = 1;
        cells.push(next);
      }
    }
  }
  for (const k of cells) e.eraseDisc(k % C, (k / C) | 0, 0);
  e.syncComponents();
  e.shiftWorldXY(128, 0);
  const retired = e._componentStateCount();
  check(`streamed component metadata is retired (${baseline} -> ${stored} -> ${retired}; seed distance ${nearest}, erased ${cells.length})`,
    placed && cactusCells >= 3 && cells.length >= 3
      && stored > baseline && retired === stored - 1);
  e.destroy();
}

// A loaded crown is inert while its seed is outside the window. Restoring that
// seed reapplies the component's persistent growth clock before growth resumes.
{
  const C = 192, R = 160, cutoff = R - 32;
  const e = createEngineWasm({
    cols: C, rows: R, worldSeed: 31, sinksOn: false, infinite: true,
  });
  for (let y = 82; y <= 135; y++) for (let x = 20; x <= 80; x++) {
    if (e.getGrid()[y * C + x] !== MAT.EMPTY) e.eraseDisc(x, y, 0);
  }
  for (let x = 20; x <= 80; x++) e.addDiscToStoneDraft(x, 136, 0);
  for (let y = 136; y < R; y++) e.addDiscToStoneDraft(20, y, 0);
  e.finalizeStoneDraft();
  check('partial-stream cactus seed placed', e.placeSeedTyped(50, 135, PT.CACTUS));

  const componentAtWorld = (worldX, worldY) => {
    const grid = e.getGrid();
    const sx = worldX - e.getWorldOffsetX();
    const sy = worldY - e.getWorldOffsetY();
    if (sx < 0 || sx >= C || sy < 0 || sy >= R) return { cells: [], count: 0, minY: R, maxY: -1 };
    const start = sy * C + sx;
    if (grid[start] !== MAT.CACTUS && !SEEDS.has(grid[start]))
      return { cells: [], count: 0, minY: R, maxY: -1 };
    const seen = new Uint8Array(grid.length), cells = [start];
    seen[start] = 1;
    for (let i = 0; i < cells.length; i++) {
      const k = cells[i], x = k % C, y = (k / C) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
        const neighbour = ny * C + nx;
        if (!seen[neighbour]
            && (grid[neighbour] === MAT.CACTUS || SEEDS.has(grid[neighbour]))) {
          seen[neighbour] = 1;
          cells.push(neighbour);
        }
      }
    }
    let minY = R, maxY = -1;
    for (const k of cells) {
      const y = (k / C) | 0;
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { cells, count: cells.length, minY, maxY };
  };
  const findSeed = () => {
    const grid = e.getGrid();
    for (let y = 82; y < R; y++) for (let x = 20; x <= 80; x++) {
      const k = y * C + x;
      if (SEEDS.has(grid[k])) return k;
    }
    return -1;
  };

  let t = 0, seed = -1;
  let staged = { cells: [], count: 0, minY: R, maxY: -1 };
  let seedWorldX = 0, seedWorldY = 0;
  for (let s = 0; s < 600; s++) {
    t += 16;
    e.step(t);
    seed = findSeed();
    if (seed < 0) continue;
    seedWorldX = e.getWorldOffsetX() + seed % C;
    seedWorldY = e.getWorldOffsetY() + ((seed / C) | 0);
    staged = componentAtWorld(seedWorldX, seedWorldY);
    if (staged.minY < cutoff && staged.maxY >= cutoff && staged.count < 30) break;
  }
  check(`cactus spans the outgoing seed band (${staged.count} cells, y ${staged.minY}..${staged.maxY})`,
    staged.minY < cutoff && staged.maxY >= cutoff && staged.count < 30);

  const anchor = staged.cells
    .filter((k) => ((k / C) | 0) < cutoff)
    .sort((a, b) => b - a)[0] ?? seed;
  const anchorWorldX = e.getWorldOffsetX() + anchor % C;
  const anchorWorldY = e.getWorldOffsetY() + ((anchor / C) | 0);
  e.shiftWorldXY(0, -32);
  const seedless = componentAtWorld(anchorWorldX, anchorWorldY);
  check(`seed streams out while its crown stays loaded (${staged.count} -> ${seedless.count})`,
    seedless.count > 0 && seedless.count < staged.count
      && componentAtWorld(seedWorldX, seedWorldY).count === 0);
  for (let s = 0; s < 8; s++) { t += 16; e.step(t); }

  e.shiftWorldXY(0, 32);
  const restored = componentAtWorld(seedWorldX, seedWorldY);
  let resumed = restored.count;
  for (let s = 0; s < 400 && resumed === restored.count; s++) {
    t += 16;
    e.step(t);
    resumed = componentAtWorld(seedWorldX, seedWorldY).count;
  }
  check(`restored seed rejoins its crown (${restored.count} cells)`,
    restored.count === staged.count);
  check(`restored seed resumes the authoritative growth clock (${restored.count} -> ${resumed})`,
    resumed > restored.count);
  e.destroy();
}

// A returned fragment keeps its persistent identity only when it is still
// connected to the loaded piece. A cut made while the crown is off-screen must
// leave that crown ungrounded even though the seed-bearing remainder is supported.
{
  const C = 192, R = 128;
  const e = createEngineWasm({
    cols: C, rows: R, worldSeed: 37, sinksOn: false, infinite: true,
  });
  e.setBgEnabled(false);
  e.shiftWorldXY(0, -64);
  for (let y = 4; y <= 45; y++) for (let x = 20; x <= 80; x++) {
    if (e.getGrid()[y * C + x] !== MAT.EMPTY) e.eraseDisc(x, y, 0);
  }
  for (let x = 20; x <= 80; x++) e.addDiscToStoneDraft(x, 46, 0);
  for (let y = 46; y < R; y++) e.addDiscToStoneDraft(20, y, 0);
  e.finalizeStoneDraft();
  check('cut-stream cactus seed placed', e.placeSeedTyped(50, 45, PT.CACTUS));

  const cactusFrom = (start) => {
    const grid = e.getGrid();
    if (start < 0 || start >= grid.length
        || (grid[start] !== MAT.CACTUS && !SEEDS.has(grid[start]))) return [];
    const seen = new Uint8Array(grid.length), cells = [start];
    seen[start] = 1;
    for (let i = 0; i < cells.length; i++) {
      const k = cells[i], x = k % C, y = (k / C) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
        const neighbour = ny * C + nx;
        if (!seen[neighbour]
            && (grid[neighbour] === MAT.CACTUS || SEEDS.has(grid[neighbour]))) {
          seen[neighbour] = 1;
          cells.push(neighbour);
        }
      }
    }
    return cells;
  };

  let t = 0, staged = [];
  const seedK = 45 * C + 50;
  for (let s = 0; s < 500; s++) {
    t += 16;
    e.step(t);
    staged = cactusFrom(seedK);
    const rows = new Set(staged.map((k) => (k / C) | 0));
    if (rows.has(30) && rows.has(32) && rows.has(37)) break;
  }
  const stagedRows = new Set(staged.map((k) => (k / C) | 0));
  check(`cut-stream cactus crosses the saved band (${staged.length} cells)`,
    stagedRows.has(30) && stagedRows.has(32) && stagedRows.has(37));
  const crownProbe = staged.find((k) => ((k / C) | 0) === 30) ?? -1;
  const crownWorldX = e.getWorldOffsetX() + crownProbe % C;
  const crownWorldY = e.getWorldOffsetY() + ((crownProbe / C) | 0);
  const seedWorldX = e.getWorldOffsetX() + seedK % C;
  const seedWorldY = e.getWorldOffsetY() + ((seedK / C) | 0);

  e.shiftWorldXY(0, 32);
  const cut = [];
  for (let x = 1; x < C - 1; x++) {
    const k = 5 * C + x;
    if (e.getGrid()[k] === MAT.CACTUS || SEEDS.has(e.getGrid()[k])) cut.push(k);
  }
  for (const k of cut) e.eraseDisc(k % C, (k / C) | 0, 0);
  e.shiftWorldXY(0, -32);

  const crownX = crownWorldX - e.getWorldOffsetX();
  const crownY = crownWorldY - e.getWorldOffsetY();
  const restoredCrownK = crownY * C + crownX;
  const seedX = seedWorldX - e.getWorldOffsetX();
  const seedY = seedWorldY - e.getWorldOffsetY();
  const restoredSeedK = seedY * C + seedX;
  const crownRestored = e.getGrid()[restoredCrownK] === MAT.CACTUS;
  e.stepWorld();
  const grounded = e._groundedGrid();
  check(
    `cut returned crown does not inherit seed support (seed ${grounded[restoredSeedK]}, crown ${grounded[restoredCrownK]})`,
    cut.length > 0 && crownRestored
      && grounded[restoredSeedK] === 1 && grounded[restoredCrownK] === 0,
  );
  e.destroy();
}

// A component can leave in several tile bands while its growth state changes.
// Restore it through the perpendicular axis so the oldest fragment is visited
// first; that fragment must not override the component's final dormant state.
{
  const C = 224, R = 160;
  const e = createEngineWasm({
    cols: C, rows: R, worldSeed: 1, sinksOn: false, infinite: true,
  });

  // Build a deterministic platform in clear sky with the seed near the first
  // horizontal tile boundary while its cactus is still young.
  for (let y = 4; y <= 45; y++) for (let x = 20; x <= 80; x++) {
    if (e.getGrid()[y * C + x] !== MAT.EMPTY) e.eraseDisc(x, y, 0);
  }
  for (let y = 46; y < R; y++) e.addDiscToStoneDraft(20, y, 0);
  for (let x = 20; x <= 80; x++) e.addDiscToStoneDraft(x, 46, 0);
  e.finalizeStoneDraft();
  check('staged streaming cactus seed placed', e.placeSeedTyped(50, 45, PT.CACTUS));

  let seedWorldX = 0, seedWorldY = 0;
  let seedTrackingLocked = false;
  const cactusComponent = () => {
    const grid = e.getGrid();
    let seed = -1;
    const expectedX = seedWorldX - e.getWorldOffsetX();
    const expectedY = seedWorldY - e.getWorldOffsetY();
    if (seedWorldX || seedWorldY) {
      if (expectedX >= 0 && expectedX < C && expectedY >= 0 && expectedY < R) {
        const expected = expectedY * C + expectedX;
        if (SEEDS.has(grid[expected])) seed = expected;
      }
    }
    if (seed < 0 && !seedTrackingLocked) {
      for (let y = 40; y <= 48 && seed < 0; y++) for (let x = 46; x <= 54; x++) {
        const k = y * C + x;
        if (SEEDS.has(grid[k])) { seed = k; break; }
      }
      if (seed >= 0) {
        seedWorldX = e.getWorldOffsetX() + seed % C;
        seedWorldY = e.getWorldOffsetY() + ((seed / C) | 0);
      }
    }
    if (seed < 0) return { cells: [], count: 0, minX: C, maxX: -1, minY: R, maxY: -1 };
    const seen = new Uint8Array(grid.length), cells = [seed];
    seen[seed] = 1;
    for (let i = 0; i < cells.length; i++) {
      const k = cells[i], x = k % C, y = (k / C) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
        const nk = ny * C + nx;
        if (!seen[nk] && (grid[nk] === MAT.CACTUS || SEEDS.has(grid[nk]))) {
          seen[nk] = 1;
          cells.push(nk);
        }
      }
    }
    let minX = C, maxX = -1, minY = R, maxY = -1;
    for (const k of cells) {
      const x = k % C, y = (k / C) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { cells, count: cells.length, minX, maxX, minY, maxY };
  };

  let t = 0, staged = cactusComponent();
  for (let s = 0; s < 500; s++) {
    t += 16;
    e.step(t);
    staged = cactusComponent();
    if (staged.minY < 32 && staged.maxY >= 32 && staged.count < 32) break;
  }
  seedTrackingLocked = staged.count > 0 && e._bodyCount() === 0;
  const stagedReady = seedTrackingLocked && staged.minY < 32
    && staged.maxY >= 32 && staged.count < 32;
  check(`growing cactus spans the staged tile boundary (${staged.count} cells, y ${staged.minY}..${staged.maxY})`, stagedReady);

  // Save the upper fragment while growth is active, leaving the seed and lower
  // fragment loaded. Enclose that remainder until it records growing=false.
  e.shiftWorldXY(0, 32);
  const afterFirstBand = cactusComponent();
  check(`first stream leaves a live cactus remainder (${staged.count} -> ${afterFirstBand.count})`,
    stagedReady && afterFirstBand.count > 0 && afterFirstBand.count < staged.count);
  const blockers = [];
  for (let y = Math.max(1, afterFirstBand.minY - 3);
       y <= Math.min(R - 2, afterFirstBand.maxY + 3); y++) {
    for (let x = Math.max(1, afterFirstBand.minX - 4);
         x <= Math.min(C - 2, afterFirstBand.maxX + 4); x++) {
      const k = y * C + x;
      if (e.getGrid()[k] !== MAT.EMPTY) continue;
      e.paintDisc(x, y, 0, MAT.STONE, true);
      blockers.push({
        x: e.getWorldOffsetX() + x,
        y: e.getWorldOffsetY() + y,
      });
    }
  }
  e.syncComponents();
  for (let s = 0; s < 350; s++) { t += 16; e.step(t); }
  const dormant = cactusComponent();
  for (let s = 0; s < 120; s++) { t += 16; e.step(t); }
  const dormantAgain = cactusComponent();
  check(`enclosed cactus becomes dormant (${dormant.count} -> ${dormantAgain.count})`,
    stagedReady && dormant.count > 0 && dormant.count === dormantAgain.count);

  // Save the newer dormant fragment, move around the stored world with the
  // cactus outside both intervening windows, then restore horizontally. The
  // vertical tile walk encounters the old upper fragment before the newer one.
  e.shiftWorldXY(0, 32);
  e.shiftWorldXY(128, 0);
  e.shiftWorldXY(0, -64);
  e.shiftWorldXY(-128, 0);
  const restored = cactusComponent();
  check(`multi-axis restore rejoins every cactus fragment (${restored.count})`,
    stagedReady && restored.count > 0
      && restored.count === staged.count - afterFirstBand.count + dormantAgain.count);

  // Move the restored top row into the editable interior before removing the
  // enclosure; this preserves the component while making every blocker erasable.
  e.shiftWorldXY(0, -32);
  for (const blocker of blockers) {
    const x = blocker.x - e.getWorldOffsetX(), y = blocker.y - e.getWorldOffsetY();
    if (x > 0 && x < C - 1 && y > 0 && y < R && e.getGrid()[y * C + x] === MAT.STONE) {
      e.eraseDisc(x, y, 0);
    }
  }
  const blockersRemoved = blockers.length > 0 && blockers.every((blocker) => {
    const x = blocker.x - e.getWorldOffsetX(), y = blocker.y - e.getWorldOffsetY();
    return x > 0 && x < C - 1 && y > 0 && y < R
      && e.getGrid()[y * C + x] !== MAT.STONE;
  });
  check(`dormancy enclosure is fully removed (${blockers.length} cells)`, blockersRemoved);
  const released = cactusComponent().count;
  for (let s = 0; s < 400; s++) { t += 16; e.step(t); }
  const afterRelease = cactusComponent().count;
  check(`restored cactus keeps the authoritative dormant state (${released} -> ${afterRelease})`,
    stagedReady && blockersRemoved && released > 0
      && released === restored.count && afterRelease === released);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
