// Deterministic stress benchmark for many large and long rigid bodies
// continuously colliding in one pile. Includes solid beams, thin verticals,
// jagged beams, and long L-shapes so both simple and compound proxies stay hot.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const COLS = 720;
const ROWS = 440;
const FLOOR_Y = ROWS - 4;
const STEPS = 1100;
const BODY_COUNT = 36;
const SPAWN_INTERVAL = 18;

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor(sorted.length * fraction))] ?? 0;
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const rectangle = (x0, y0, width, height) => {
  const cells = [];
  for (let y = y0; y < y0 + height; y++)
    for (let x = x0; x < x0 + width; x++) cells.push([x, y]);
  return cells;
};
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
      hash ^= Math.round((value ?? 0) * 1e6);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const shape = (body) => {
  const lane = body % 4;
  const x = 24 + lane * 160 + ((body / 4) | 0) % 2 * 18;
  const y = 8;
  const kind = body % 4;
  if (kind === 0)
    return rectangle(x, y, 148 + body % 5 * 8, 5 + body % 3 * 2);
  if (kind === 1)
    return rectangle(x + 68, y, 5 + body % 3, 96 + body % 4 * 10);
  if (kind === 2) {
    const cells = [];
    let py = y + 4;
    for (let step = 0; step < 160; step++) {
      if (step > 0 && step % 29 === 0) py++;
      if (step > 0 && step % 47 === 0) py--;
      cells.push([x + step, py], [x + step, py + 1]);
    }
    return cells;
  }
  const cells = rectangle(x, y + 96, 142, 6);
  cells.push(...rectangle(x, y, 6, 96));
  return cells;
};

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x10ab0d1e,
  sinksOn: false,
  infinite: false,
}));
const solverMode = Number.parseInt(process.env.RIGID_SOLVER_MODE ?? '2', 10);
const residualTolerance = Number.parseFloat(
  process.env.RIGID_RESIDUAL_TOLERANCE ?? '0.0001');
const solverMinIterations = Number.parseInt(
  process.env.RIGID_MIN_ITERATIONS ?? '4', 10);
engine._setRigidSolverOptions(
  solverMode, residualTolerance, solverMinIterations);

for (let y = FLOOR_Y; y < ROWS; y++)
  for (let x = 0; x < COLS; x++)
    engine.paintDisc(x, y, 0, MAT.STONE, true);
for (let y = FLOOR_Y - 150; y < FLOOR_Y; y++) {
  for (let x = 0; x < 5; x++) engine.paintDisc(x, y, 0, MAT.STONE, true);
  for (let x = COLS - 5; x < COLS; x++)
    engine.paintDisc(x, y, 0, MAT.STONE, true);
}
engine.syncComponents();

const bodyMs = [];
const stepMs = [];
let spawned = 0;
let childPairs = 0;
let manifolds = 0;
let sweepFallbacks = 0;
let contacts = 0;
let islandBodySteps = 0;
let globalBodySteps = 0;
let maxChildren = 0;
let childTransforms = 0;
let velocityConstraintEvals = 0;
let biasConstraintEvals = 0;
let maxVelocityResidual = 0;
let maxBiasResidual = 0;
let maxPenetrationResidual = 0;
let shockIslands = 0;
let shockConstraintEvals = 0;
let shockFallbacks = 0;
let shockMaxLayers = 0;
let shockSkipped = 0;
for (let step = 0; step < STEPS; step++) {
  if (spawned < BODY_COUNT && step % SPAWN_INTERVAL === 0) {
    engine.spawnBody(shape(spawned));
    const body = engine._bodyCount() - 1;
    const direction = spawned % 2 ? -1 : 1;
    engine._setBodyMotion(body, direction * (0.18 + spawned % 3 * 0.05),
      0, direction * (0.0015 + spawned % 4 * 0.0007));
    spawned++;
  }
  engine.stepWorld();
  const perf = engine.getStepPerf();
  const solver = engine.getRigidSolverDebug();
  bodyMs.push(perf.bodyMs);
  stepMs.push(engine.getPerf().stepMs);
  childPairs += solver.childPairs;
  manifolds += solver.childManifolds;
  sweepFallbacks += solver.sweepFallbacks;
  contacts += solver.contacts;
  islandBodySteps += solver.islandBodySteps;
  globalBodySteps += solver.globalBodySteps;
  maxChildren = Math.max(maxChildren, solver.maxChildren);
  childTransforms += solver.childTransforms;
  velocityConstraintEvals += solver.velocityConstraintEvals;
  biasConstraintEvals += solver.biasConstraintEvals;
  maxVelocityResidual = Math.max(
    maxVelocityResidual, solver.maxVelocityResidual);
  maxBiasResidual = Math.max(maxBiasResidual, solver.maxBiasResidual);
  maxPenetrationResidual = Math.max(
    maxPenetrationResidual, solver.maxPenetrationResidual);
  shockIslands += solver.shockIslands;
  shockConstraintEvals += solver.shockConstraintEvals;
  shockFallbacks += solver.shockFallbacks;
  shockMaxLayers = Math.max(shockMaxLayers, solver.shockMaxLayers);
  shockSkipped += solver.shockSkipped;
}

console.log(JSON.stringify({
  scene: `${BODY_COUNT} continuously spawned long bodies`,
  solverOptions: {
    mode: solverMode,
    residualTolerance,
    minIterations: solverMinIterations,
  },
  steps: STEPS,
  finalChecksum: checksum(engine),
  bodies: {
    spawned,
    final: engine._bodyCount(),
    awake: [...Array(engine._bodyCount()).keys()]
      .reduce((count, body) => count + engine._bodyAwake(body), 0),
  },
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
    childPairs,
    manifolds,
    sweepFallbacks,
    contacts,
    islandBodySteps,
    globalBodySteps,
    maxChildren,
    childTransforms,
    velocityConstraintEvals,
    biasConstraintEvals,
    maxVelocityResidual,
    maxBiasResidual,
    maxPenetrationResidual,
    shockIslands,
    shockConstraintEvals,
    shockFallbacks,
    shockMaxLayers,
    shockSkipped,
  },
}, null, 2));

engine.destroy();
