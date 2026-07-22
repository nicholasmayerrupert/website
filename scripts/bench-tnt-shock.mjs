// Focused benchmark for the per-blast free-body shockwave scan. Direct test-only
// detonation excludes fuse ticks and rigid-body simulation from the timed region.
import { performance } from 'node:perf_hooks';
import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 512;
const ROWS = 256;
const BASE_BODIES = 64; // suppress generic blast-debris creation in both cases
const FAR_BODIES = Math.max(BASE_BODIES + 1, Number(process.env.BODIES || 6000) | 0);
const DETONATIONS = Math.max(10, Number(process.env.DETONATIONS || 200) | 0);
const REPEAT = Math.max(3, Number(process.env.REPEAT || 7) | 0);

await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor((sorted.length - 1) * q)];
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: at(0.50),
    p95: at(0.95),
  };
}

function run(bodyCount) {
  const engine = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xC0FFEE, sinksOn: false, infinite: false });
  let spawned = 0;
  for (let y = 3; y < ROWS - 2 && spawned < bodyCount; y += 3) {
    for (let x = COLS / 2 + 4; x < COLS - 2 && spawned < bodyCount; x += 3) {
      engine.spawnBox(x, y, 1, 1, MAT.RIGID);
      spawned++;
    }
  }
  if (engine._bodyCount() !== bodyCount) throw new Error(`spawned ${engine._bodyCount()} of ${bodyCount} bodies`);

  // Allocate persistent blast scratch and warm the call path outside timing.
  engine._detonateTnt(64, ROWS >> 1);
  const started = performance.now();
  for (let i = 0; i < DETONATIONS; i++) {
    const cy = 32 + ((i * 37) % (ROWS - 64));
    engine._detonateTnt(64, cy);
  }
  const elapsed = performance.now() - started;
  engine.destroy();
  return elapsed;
}

// Warm module/JIT paths before the paired samples.
run(BASE_BODIES);

const base = [];
const far = [];
for (let repeat = 0; repeat < REPEAT; repeat++) {
  // Alternate order to reduce drift bias between the paired cases.
  if (repeat & 1) {
    far.push(run(FAR_BODIES));
    base.push(run(BASE_BODIES));
  } else {
    base.push(run(BASE_BODIES));
    far.push(run(FAR_BODIES));
  }
}

const baseSummary = summary(base);
const farSummary = summary(far);
const delta = far.map((value, i) => value - base[i]);
const deltaSummary = summary(delta);
const extraVisits = (FAR_BODIES - BASE_BODIES) * DETONATIONS;
const nsPerExtraBody = deltaSummary.p50 * 1e6 / extraVisits;

console.log(`TNT shockwave scan (${REPEAT} repeats; ${DETONATIONS} direct blasts each)`);
console.log(`  baseline ${BASE_BODIES} bodies  p50 ${baseSummary.p50.toFixed(3)}  p95 ${baseSummary.p95.toFixed(3)}  mean ${baseSummary.mean.toFixed(3)} ms`);
console.log(`  distant  ${FAR_BODIES} bodies  p50 ${farSummary.p50.toFixed(3)}  p95 ${farSummary.p95.toFixed(3)}  mean ${farSummary.mean.toFixed(3)} ms`);
console.log(`  paired scan delta       p50 ${deltaSummary.p50.toFixed(3)}  p95 ${deltaSummary.p95.toFixed(3)}  mean ${deltaSummary.mean.toFixed(3)} ms`);
console.log(`  p50 cost per extra body/blast ${nsPerExtraBody.toFixed(2)} ns`);
