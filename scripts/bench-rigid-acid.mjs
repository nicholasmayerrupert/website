// Deterministic stress benchmark for acid eating through a settled pile of
// large rigid bodies. Reports the body phase separately because body erosion and
// connectivity repair run inside moveBodies(), not the reaction phase.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const COLS = 448;
const ROWS = 352;
const FLOOR_Y = ROWS - 4;
const WARMUP_STEPS = 240;
const ACID_STEPS = 360;
const PILE_ROWS = 8;
const PILE_COLS = 4;
const SLAB_W = 92;
const SLAB_H = 14;
const GAP_X = 8;
const SPAWN_GAP_Y = 6;
const RAIN_MATERIAL = process.argv.includes('--water') ? MAT.WATER : MAT.ACID;

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor(sorted.length * fraction))] ?? 0;
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const checksum = (engine) => {
  let hash = 0x811c9dc5;
  for (const material of engine.getGrid()) {
    hash ^= material;
    hash = Math.imul(hash, 0x01000193);
  }
  for (let body = 0; body < engine._bodyCount(); body++) {
    const state = engine._bodyState(body);
    for (const value of [
      state?.px, state?.py, state?.angle,
      state?.vx, state?.vy, state?.omega, state?.nPts,
    ]) {
      const quantized = Math.round((value ?? 0) * 1e6);
      hash ^= quantized;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
const rectangle = (x0, y0, width, height) => {
  const cells = [];
  for (let y = y0; y < y0 + height; y++)
    for (let x = x0; x < x0 + width; x++) cells.push([x, y]);
  return cells;
};

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0xac1d51ab,
  sinksOn: false,
  infinite: false,
}));

for (let y = FLOOR_Y; y < ROWS; y++)
  for (let x = 0; x < COLS; x++)
    engine.paintDisc(x, y, 0, MAT.STONE, true);
engine.syncComponents();

const pileWidth = PILE_COLS * SLAB_W + (PILE_COLS - 1) * GAP_X;
const baseX = Math.floor((COLS - pileWidth) / 2);
for (let row = 0; row < PILE_ROWS; row++) {
  const y = FLOOR_Y - (row + 1) * (SLAB_H + SPAWN_GAP_Y);
  const offset = row % 2 ? Math.floor(GAP_X / 2) : 0;
  for (let column = 0; column < PILE_COLS; column++) {
    const x = baseX + column * (SLAB_W + GAP_X) + offset;
    engine.spawnBody(rectangle(x, y, SLAB_W, SLAB_H));
  }
}

for (let step = 0; step < WARMUP_STEPS; step++) engine.stepWorld();

const bodyMs = [];
const stepMs = [];
let childPairs = 0;
let manifolds = 0;
let sweepFallbacks = 0;
let islandBodySteps = 0;
let contacts = 0;
let peakBodies = engine._bodyCount();
for (let step = 0; step < ACID_STEPS; step++) {
  if (step < 144 && step % 6 === 0) {
    const y = FLOOR_Y - PILE_ROWS * (SLAB_H + SPAWN_GAP_Y) - 12;
    for (let x = baseX + 5; x < baseX + pileWidth - 5; x += 14)
      engine.paintDisc(x, y, 3, RAIN_MATERIAL, false);
  }
  engine.stepWorld();
  const phases = engine.getStepPerf();
  const solver = engine.getRigidSolverDebug();
  bodyMs.push(phases.bodyMs);
  stepMs.push(engine.getPerf().stepMs);
  childPairs += solver.childPairs;
  manifolds += solver.childManifolds;
  sweepFallbacks += solver.sweepFallbacks;
  islandBodySteps += solver.islandBodySteps;
  contacts += solver.contacts;
  peakBodies = Math.max(peakBodies, engine._bodyCount());
}

const points = [];
for (let body = 0; body < engine._bodyCount(); body++)
  points.push(engine._bodyState(body)?.nPts ?? 0);
const rainCells = [...engine.getGrid()]
  .reduce((count, material) => count + (material === RAIN_MATERIAL), 0);

console.log(JSON.stringify({
  scene: `${PILE_ROWS * PILE_COLS} ${SLAB_W}x${SLAB_H} slabs`,
  warmupSteps: WARMUP_STEPS,
  acidSteps: ACID_STEPS,
  finalChecksum: checksum(engine),
  bodies: {
    initial: PILE_ROWS * PILE_COLS,
    peak: peakBodies,
    final: engine._bodyCount(),
  },
  occupiedBodyCells: Math.round(sum(points)),
  rainMaterial: RAIN_MATERIAL === MAT.ACID ? 'acid' : 'water',
  rainCells,
  bodyMs: {
    mean: sum(bodyMs) / bodyMs.length,
    p50: percentile(bodyMs, 0.50),
    p95: percentile(bodyMs, 0.95),
    p99: percentile(bodyMs, 0.99),
    max: Math.max(...bodyMs),
    total: sum(bodyMs),
  },
  stepMs: {
    mean: sum(stepMs) / stepMs.length,
    p50: percentile(stepMs, 0.50),
    p95: percentile(stepMs, 0.95),
    p99: percentile(stepMs, 0.99),
    max: Math.max(...stepMs),
  },
  solver: {
    childPairs, manifolds, sweepFallbacks, islandBodySteps, contacts,
  },
}, null, 2));

engine.destroy();
