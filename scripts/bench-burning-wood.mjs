// Broad, grounded wood slab with a sustained fire front. Injection and fixture
// construction are outside the timings; both layers contribute to the checksum.
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { readFileSync } from 'node:fs';

await initSandWasm();
const cols = 420, rows = 300;
const stepsAt = process.argv.indexOf('--steps');
const steps = stepsAt >= 0 ? Number(process.argv[stepsAt + 1]) : 480;
if (!Number.isInteger(steps) || steps < 40) throw new Error('--steps must be at least 40');
const fireY = process.argv.includes('--surface') ? 59 : 170;
const e = createEngineWasm({ cols, rows, worldSeed: 0xc0ffee, sinksOn: false });
for (let y = 60; y < rows; y++)
  for (let x = 40; x < cols - 40; x++) e.paintDisc(x, y, 0, MAT.WOOD, true);
e.syncComponents();
const samples = {};
let peakFire = 0, peakBurning = 0;
for (let tick = 0; tick < steps; tick++) {
  if (tick % 4 === 0)
    for (let x = 42; x < cols - 42; x += 3) e.paintDisc(x, fireY, 1, MAT.FIRE, true);
  e.stepWorld();
  if (tick >= 20) {
    const phases = { stepMs: e.getPerf().stepMs, ...e.getStepPerf() };
    for (const [key, value] of Object.entries(phases))
      if (key.endsWith('Ms')) (samples[key] ??= []).push(value);
  }
  peakFire = Math.max(peakFire, e.getGrid().reduce((n, m) => n + (m === MAT.FIRE), 0));
  peakBurning = Math.max(peakBurning, e.getBurningVisual().reduce((n, burning) => n + burning, 0));
}
let checksum = 0x811c9dc5;
for (const grid of [e.getGrid(), e.getGridBg()]) for (const m of grid)
  checksum = Math.imul(checksum ^ m, 0x01000193);
const wood = e.getGrid().reduce((n, m) => n + (m === MAT.WOOD), 0);
const timings = Object.fromEntries(Object.entries(samples).map(([key, values]) => {
  values.sort((a, b) => a - b);
  return [key, { p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)] }];
}));
const result = { scene: fireY === 59 ? 'surface' : 'fragmenting', steps, wood, peakFire, peakBurning, checksum: (checksum >>> 0).toString(16), timings };
console.log(JSON.stringify(result, null, 2));
const compareAt = process.argv.indexOf('--compare');
if (compareAt >= 0) {
  const baseline = JSON.parse(readFileSync(process.argv[compareAt + 1], 'utf8'));
  for (const key of ['wood', 'peakFire', 'checksum']) {
    if (baseline[key] !== result[key]) {
      console.error(`${key} changed: ${baseline[key]} -> ${result[key]}`);
      process.exitCode = 1;
    }
  }
  for (const key of ['stepMs', 'reactMs', 'carryMs', 'bodyMs']) {
    const before = baseline.timings[key].p50, after = timings[key].p50;
    console.error(`${key} p50: ${before.toFixed(3)} -> ${after.toFixed(3)} ms (${((after / before - 1) * 100).toFixed(1)}%)`);
  }
}
const minConsumed = fireY === 59 ? 500 : 1000;
if ((steps >= 480 && wood >= 340 * 240 - minConsumed) || peakFire < 100 || peakBurning < 100) process.exitCode = 1;
e.destroy();
