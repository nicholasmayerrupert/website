// Tracks the cost of one floating ice body as it freezes a large pool.
// Reports fixed step windows so growth-related scaling is visible.
//
//   node scripts/bench-ice-growth.mjs

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';

const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const COLS = 480, ROWS = 300, STEPS = 2400, WINDOW = 200;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

await initSandWasm();
const engine = createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0xC0FFEE,
  sinksOn: false,
});
engine.setBgEnabled(false);

for (let y = 32; y < ROWS - 5; y++) {
  for (let x = 5; x < COLS - 5; x++) {
    engine.paintDisc(x, y, 0, MAT.WATER, true);
  }
}
engine._spawnBoxLayer(0, COLS >> 1, 80, 5, 5, MAT.ICE);

let now = 0;
let stepMs = [], bodyMs = [], reactMs = [], groundMs = [];
console.log('ticks       cells   step p50/p95   body p50   react p50  ground p50');
for (let i = 0; i < STEPS; i++) {
  now += 16;
  engine.step(now);
  const perf = engine.getStepPerf();
  stepMs.push(engine.getPerf().stepMs);
  bodyMs.push(perf.bodyMs || 0);
  reactMs.push(perf.reactMs || 0);
  groundMs.push(perf.groundingMs || 0);
  if ((i + 1) % WINDOW !== 0) continue;

  const cells = engine._bodyState(0)?.nPts || 0;
  console.log(
    `${String(`${i + 2 - WINDOW}-${i + 1}`).padEnd(11)}`
    + `${String(cells).padStart(7)}`
    + `${mean(stepMs).toFixed(2).padStart(8)}/${percentile(stepMs, 0.95).toFixed(2).padEnd(7)}`
    + `${mean(bodyMs).toFixed(2).padStart(9)}`
    + `${mean(reactMs).toFixed(2).padStart(11)}`
    + `${mean(groundMs).toFixed(2).padStart(12)}`,
  );
  stepMs = []; bodyMs = []; reactMs = []; groundMs = [];
}

engine.destroy();
