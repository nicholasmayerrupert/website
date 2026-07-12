// Focused benchmark for the dry plant-fragment path exercised while fire cuts
// a broad component. Run before/after component-contact changes with:
//   node scripts/bench-fire-plant.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';

const COLS = 420, ROWS = 260, STEPS = 220;
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))];
};
const countPlant = (grid) => {
  let n = 0;
  for (const m of grid) if (m === MAT.WOOD || m === MAT.PLANT || m === MAT.SEED || m === MAT.DRIFTWOOD) n++;
  return n;
};

await initSandWasm();
const e = createEngineWasm({ cols: COLS, rows: ROWS, infinite: false, sinksOn: false });
for (let x = 45; x <= 375; x++) {
  for (let y = 70; y <= 75; y++) e.paintDisc(x, y, 0, MAT.WOOD, true);
  if (x % 4 !== 0) for (let y = 76; y <= 190; y++) e.paintDisc(x, y, 0, MAT.PLANT, true);
}
e.syncComponents();

const before = countPlant(e.getGrid());
const samples = [];
let peakFire = 0;
for (let step = 0; step < STEPS; step++) {
  if (step < 110) for (let x = 45; x <= 375; x += 2) e.paintDisc(x, 73, 0, MAT.FIRE, true);
  const start = performance.now();
  e.step((step + 1) * 16);
  samples.push(performance.now() - start);
  let fire = 0;
  for (const m of e.getGrid()) if (m === MAT.FIRE) fire++;
  peakFire = Math.max(peakFire, fire);
}
const after = countPlant(e.getGrid());
const measured = samples.slice(20);
console.log(`fire/plant benchmark (${COLS}x${ROWS}, ${measured.length} measured steps)`);
console.log(`  step mean ${(measured.reduce((sum, v) => sum + v, 0) / measured.length).toFixed(3)} ms`);
console.log(`  step p50 ${pct(measured, 0.50).toFixed(3)} ms  p95 ${pct(measured, 0.95).toFixed(3)} ms  p99 ${pct(measured, 0.99).toFixed(3)} ms`);
console.log(`  plant ${before} -> ${after}  peak fire ${peakFire}`);
if (peakFire <= 20 || after >= before - 100) process.exitCode = 1;
e.destroy();
