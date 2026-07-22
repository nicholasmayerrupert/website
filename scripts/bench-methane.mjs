// Focused methane benchmarks: a small pocket isolates the capped blast-front
// work while a very large cloud keeps the connected-volume path covered.
import { performance } from 'node:perf_hooks';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 512, ROWS = 256;
const REPEATS = Math.max(3, Number(process.env.REPEAT || 7) | 0);
await initSandWasm();

const hashGrid = (grid) => {
  let h = 2166136261 >>> 0;
  for (const v of grid) { h ^= v; h = Math.imul(h, 16777619) >>> 0; }
  return `0x${h.toString(16).padStart(8, '0')}`;
};
const count = (grid, mat) => { let n = 0; for (const v of grid) if (v === mat) n++; return n; };
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.50)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};

const scenarios = [
  { name: 'eight-front-pocket', x0: 208, x1: 256, y0: 116, y1: 140 },
  { name: 'large-cloud', x0: 80, x1: 432, y0: 70, y1: 190 },
];

function runScenario(scenario) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xC0FFEE, sinksOn: false, infinite: false });
  for (let y = scenario.y0; y < scenario.y1; y++)
    for (let x = scenario.x0; x < scenario.x1; x++) e.placeMaterial(x, y, 0, MAT.METHANE);
  e.placeMaterial(scenario.x0 - 1, (scenario.y0 + scenario.y1) >> 1, 0, MAT.FIRE);
  const initial = count(e.getGrid(), MAT.METHANE);
  const started = performance.now();
  e.step(0);
  const wallMs = performance.now() - started;
  const reactMs = e.getStepPerf().reactMs || 0;
  const grid = e.getGrid();
  const remaining = count(grid, MAT.METHANE);
  const visible = count(grid, MAT.FIRE) + count(grid, MAT.ACRID_SMOKE);
  const hash = hashGrid(grid);
  e.destroy();
  return { initial, remaining, visible, hash, wallMs, reactMs };
}

console.log(`methane benchmark (${REPEATS} repeats; ${COLS}x${ROWS})`);
let failed = false;
for (const scenario of scenarios) {
  runScenario(scenario); // warm module/JIT paths outside the samples
  const runs = Array.from({ length: REPEATS }, () => runScenario(scenario));
  const wall = summary(runs.map(({ wallMs }) => wallMs));
  const react = summary(runs.map(({ reactMs }) => reactMs));
  const hashes = [...new Set(runs.map(({ hash }) => hash))];
  const first = runs[0];
  console.log(`\n${scenario.name}: cloud ${first.initial} -> ${first.remaining}, visible aftermath ${first.visible}`);
  console.log(`  ignition wall  p50 ${wall.p50.toFixed(3)}  p95 ${wall.p95.toFixed(3)}  max ${wall.max.toFixed(3)} ms`);
  console.log(`  reaction phase p50 ${react.p50.toFixed(3)}  p95 ${react.p95.toFixed(3)}  max ${react.max.toFixed(3)} ms`);
  console.log(`  hash ${hashes.join(',')}${hashes.length === 1 ? '' : ' UNSTABLE'}`);
  if (first.remaining !== 0 || hashes.length !== 1) failed = true;
}
if (failed) process.exit(1);
