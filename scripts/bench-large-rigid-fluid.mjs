// Exercises one large rigid body entering a large, connected pool.
// Reports fixed windows so entry, deep coupling, and settling stay visible.
//
//   node scripts/bench-large-rigid-fluid.mjs

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';

const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const COLS = 480, ROWS = 300, STEPS = 160, WINDOW = 20;

const percentile = (values, fraction) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] || 0;
};
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

await initSandWasm();
const engine = createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0xBEEF,
  sinksOn: false,
});
engine.setBgEnabled(false);

const paintRect = (x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};

paintRect(0, ROWS - 4, COLS - 1, ROWS - 1, MAT.STONE);
paintRect(0, 40, 3, ROWS - 1, MAT.STONE);
paintRect(COLS - 4, 40, COLS - 1, ROWS - 1, MAT.STONE);
engine.syncComponents();
paintRect(4, 70, COLS - 5, ROWS - 5, MAT.WATER);

engine.spawnBox(COLS >> 1, 38, 60, 30, MAT.WOOD);
engine._setBodyMotion(0, 0.3, 1.4, 0.002);

let now = 0;
let bodyMs = [], stepMs = [], correctors = 0;
console.log('ticks       body y/vy    body p50/p95   step p50/p95   corr');
for (let i = 0; i < STEPS; i++) {
  now += 16;
  engine.step(now);
  const perf = engine.getStepPerf();
  bodyMs.push(perf.bodyMs || 0);
  stepMs.push(engine.getPerf().stepMs);
  correctors += engine.getRigidSolverDebug().fluidCorrectorPasses;
  if ((i + 1) % WINDOW !== 0) continue;

  const body = engine._bodyState(0);
  console.log(
    `${String(`${i + 2 - WINDOW}-${i + 1}`).padEnd(11)}`
    + `${body ? `${body.py.toFixed(1)}/${body.vy.toFixed(2)}`.padStart(12) : 'gone'.padStart(12)}`
    + `${mean(bodyMs).toFixed(2).padStart(8)}/${percentile(bodyMs, 0.95).toFixed(2).padEnd(7)}`
    + `${mean(stepMs).toFixed(2).padStart(8)}/${percentile(stepMs, 0.95).toFixed(2)}`
    + `${String(correctors).padStart(7)}`,
  );
  bodyMs = [];
  stepMs = [];
  correctors = 0;
}

engine.destroy();
