// Gas ↔ liquid interaction: liquids must bubble gas upward (not destroy it).
// Regression for acrid smoke vanishing under acid/water columns — moveMaterialInto
// used to drop gas when vacatedStamp[toK] was set during a bottom-up cascade.
//
// Run: node scripts/gas-bubble-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 200, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const mk = () => createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});

const { check, done } = makeChecker('gas bubbles through liquid');

const count = (e, mat) => {
  const g = e.getGrid();
  let n = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === mat) n++;
  return n;
};
const topMost = (e, mat) => {
  const g = e.getGrid();
  for (let i = 0; i < g.length; i++) if (g[i] === mat) return (i / COLS) | 0;
  return -1;
};
const stepN = (e, n) => {
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += 16;
    e.step(t);
  }
};

// 1. Acrid smoke under a water column bubbles up gradually; water mass conserved.
//    Must NOT teleport to the free surface in one step (cascade was the visual bug).
{
  console.log('acrid smoke under water bubbles up');
  const e = mk();
  for (let y = 80; y < 100; y++) for (let x = 80; x < 120; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  const smokeY0 = 72, smokeY1 = 75, waterY0 = 50, waterY1 = 71;
  const waterDepth = waterY1 - waterY0 + 1; // ~22
  for (let y = smokeY0; y <= smokeY1; y++) for (let x = 95; x < 105; x++) e.paintDisc(x, y, 0, MAT.ACRID_SMOKE, true);
  for (let y = waterY0; y <= waterY1; y++) for (let x = 90; x < 110; x++) e.paintDisc(x, y, 0, MAT.WATER, true);
  const smoke0 = count(e, MAT.ACRID_SMOKE);
  const water0 = count(e, MAT.WATER);
  check(`setup has smoke under water (${smoke0} smoke, ${water0} water)`, smoke0 > 0 && water0 > 0);

  let escaped = false;
  let smokeAt5 = -1;
  let topAfter1 = -1;
  let tops = [];
  let t = 0;
  for (let s = 0; s < 80; s++) {
    t += 16;
    e.step(t);
    const n = count(e, MAT.ACRID_SMOKE);
    if (s === 0) topAfter1 = topMost(e, MAT.ACRID_SMOKE);
    if (s === 4) smokeAt5 = n;
    const top = topMost(e, MAT.ACRID_SMOKE);
    if (s < 12) tops.push(top);
    // Free surface of the water stack is at waterY0; smoke above that has vented.
    if (top >= 0 && top < waterY0) escaped = true;
  }
  const water1 = count(e, MAT.WATER);
  const smoke1 = count(e, MAT.ACRID_SMOKE);
  check(`water conserved while bubbling (${water0} -> ${water1})`, water1 === water0);
  // Without the first fix, smoke hit 0 by step ~3.
  check(`smoke not wiped under liquid in 5 steps (${smokeAt5} of ${smoke0})`, smokeAt5 >= Math.floor(smoke0 * 0.5));
  // One-step teleport: top would jump from ~72 to < waterY0 immediately.
  // Gradual bubble: after 1 step, still inside the water column (or just into it).
  check(
    `smoke does not teleport to free surface in 1 step (top ${topAfter1}, surface ${waterY0})`,
    topAfter1 < 0 || topAfter1 >= waterY0 - 1,
  );
  // Should have climbed several cells over the first dozen steps (still mid-column).
  const topAt10 = tops[9];
  check(
    `smoke climbs gradually (tops ${tops.slice(0, 10).join(',')})`,
    topAfter1 >= 0 && topAt10 >= 0 && topAt10 < topAfter1 && topAt10 > waterY0 - waterDepth,
  );
  check(`smoke eventually vents above free surface`, escaped);
  check(`smoke survived or fully vented after rise (final ${smoke1})`, smoke1 > 0 || escaped);
  e.destroy();
}

// 2. Steam under water (same bubble path; normal steam decay is slow).
{
  console.log('steam under water bubbles up');
  const e = mk();
  for (let y = 80; y < 100; y++) for (let x = 80; x < 120; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  for (let y = 72; y < 76; y++) for (let x = 95; x < 105; x++) e.paintDisc(x, y, 0, MAT.STEAM, true);
  for (let y = 50; y < 72; y++) for (let x = 90; x < 110; x++) e.paintDisc(x, y, 0, MAT.WATER, true);
  const steam0 = count(e, MAT.STEAM);
  const water0 = count(e, MAT.WATER);
  let escaped = false;
  let minSteam = steam0;
  let topAfter1 = -1;
  let t = 0;
  for (let s = 0; s < 60; s++) {
    t += 16;
    e.step(t);
    const n = count(e, MAT.STEAM);
    minSteam = Math.min(minSteam, n);
    if (s === 0) topAfter1 = topMost(e, MAT.STEAM);
    if (topMost(e, MAT.STEAM) >= 0 && topMost(e, MAT.STEAM) < 50) escaped = true;
  }
  check(`water conserved (${water0} -> ${count(e, MAT.WATER)})`, count(e, MAT.WATER) === water0);
  check(`steam not wiped in 60 steps (min ${minSteam} of ${steam0})`, minSteam >= Math.floor(steam0 * 0.25));
  check(`steam does not teleport in 1 step (top ${topAfter1})`, topAfter1 < 0 || topAfter1 >= 49);
  check(`steam rose above water surface`, escaped || topMost(e, MAT.STEAM) < 50);
  e.destroy();
}

// 3. Acid pool in a stone chamber: dissolving must emit acrid smoke that reaches open air.
{
  console.log('acid pool emits acrid smoke that vents above the free surface');
  const e = mk();
  for (let y = 40; y < 90; y++) for (let x = 60; x < 120; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  for (let y = 42; y < 70; y++) for (let x = 70; x < 110; x++) e.paintDisc(x, y, 0, MAT.EMPTY, true);
  e.syncComponents();
  const surfaceY = 50;
  for (let y = surfaceY; y < 70; y++) for (let x = 70; x < 110; x++) e.paintDisc(x, y, 0, MAT.ACID, true);

  let peak = 0;
  let roseHits = 0;
  let t = 0;
  for (let s = 0; s < 250; s++) {
    t += 16;
    e.step(t);
    const n = count(e, MAT.ACRID_SMOKE);
    peak = Math.max(peak, n);
    const top = topMost(e, MAT.ACRID_SMOKE);
    if (top >= 0 && top < surfaceY) roseHits++;
  }
  check(`acid dissolving produced acrid smoke (peak ${peak})`, peak >= 5);
  check(`smoke vented above acid free surface (roseHits ${roseHits})`, roseHits >= 5);
  e.destroy();
}

// 4. Open-surface acid on stone still works (sand-test baseline, kept local).
{
  console.log('acid on open stone still emits rising smoke');
  const e = mk();
  for (let y = 50; y < 90; y++) for (let x = 60; x < 120; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  for (let y = 46; y < 50; y++) for (let x = 60; x < 120; x++) e.paintDisc(x, y, 0, MAT.ACID, true);
  let peak = 0, bestTop = -1;
  let t = 0;
  for (let s = 0; s < 150; s++) {
    t += 16;
    e.step(t);
    const n = count(e, MAT.ACRID_SMOKE);
    peak = Math.max(peak, n);
    const top = topMost(e, MAT.ACRID_SMOKE);
    if (top >= 0 && (bestTop < 0 || top < bestTop)) bestTop = top;
  }
  check(`open acid produced smoke (peak ${peak})`, peak > 0);
  check(`open acid smoke rose above acid layer (best top ${bestTop} < 46)`, bestTop >= 0 && bestTop < 46);
  e.destroy();
}

const failures = done();
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall gas-bubble checks passed');
