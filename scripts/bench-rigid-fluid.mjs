// Exercises awake rigid bodies in one large, connected, actively settling pool.
// Reports the rigid-fluid phase separately from the cellular liquid phase.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const COLS = 480;
const ROWS = 300;
const STONE = 3;
const WATER = 2;
const WOOD = 8;
const STEPS = 120;

await initSandWasm();
const engine = createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0xBEEF,
  sinksOn: false,
});

const paintRect = (x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};

paintRect(0, ROWS - 4, COLS - 1, ROWS - 1, STONE);
paintRect(0, 40, 3, ROWS - 1, STONE);
paintRect(COLS - 4, 40, COLS - 1, ROWS - 1, STONE);
engine.syncComponents();
paintRect(4, 70, COLS - 5, ROWS - 5, WATER);

for (let i = 0; i < 12; i++) {
  const x = 45 + i * 34;
  const y = 54 + (i % 3) * 5;
  engine.spawnBox(x, y, 8, 3, WOOD);
  engine._setBodyMotion(i, i % 2 ? -0.35 : 0.35, 0.4, i % 2 ? -0.008 : 0.008);
}

const bodyMs = [];
const liquidMs = [];
const stepMs = [];
let now = 0;
const started = performance.now();
for (let i = 0; i < STEPS; i++) {
  now += 16;
  engine.step(now);
  const phases = engine.getStepPerf();
  bodyMs.push(phases.bodyMs ?? 0);
  liquidMs.push(phases.liquidMs ?? 0);
  stepMs.push(engine.getPerf().stepMs);
}
const elapsed = performance.now() - started;

const sorted = (values) => [...values].sort((a, b) => a - b);
const percentile = (values, fraction) => {
  const valuesSorted = sorted(values);
  return valuesSorted[Math.min(valuesSorted.length - 1, Math.floor(valuesSorted.length * fraction))];
};
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const report = (label, values) => {
  console.log(
    `${label.padEnd(12)} p50 ${percentile(values, 0.5).toFixed(3)} ms`
    + `  p95 ${percentile(values, 0.95).toFixed(3)} ms`
    + `  mean ${mean(values).toFixed(3)} ms`,
  );
};
let checksum = 0x811c9dc5;
for (const value of engine.getGrid()) {
  checksum ^= value;
  checksum = Math.imul(checksum, 0x01000193) >>> 0;
}

console.log(`${COLS}x${ROWS}, 12 wood bodies, ${STEPS} steps`);
report('body', bodyMs);
report('liquid', liquidMs);
report('step', stepMs);
console.log(`wall         ${(elapsed / STEPS).toFixed(3)} ms/step`);
console.log(`checksum     0x${checksum.toString(16).padStart(8, '0')}`);
engine.destroy();
