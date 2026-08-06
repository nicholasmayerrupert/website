// Reproduce large, irregular terrain islands released by broad TNT cuts.
// Reports landing overlap, late motion, and rigid-body phase timing.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const COLS = 560;
const ROWS = 420;
const FLOOR_Y = 350;
const STEPS = 620;

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor(sorted.length * fraction))] ?? 0;
};
const sum = (values) => values.reduce((total, value) => total + value, 0);

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x6c617267,
  sinksOn: false,
  infinite: false,
}));

const paintCell = (x, y, material = MAT.STONE) =>
  engine.paintDisc(x, y, 0, material, true);

for (let y = FLOOR_Y; y < ROWS; y++)
  for (let x = 0; x < COLS; x++) paintCell(x, y);

// One connected 420x170 natural-looking mass. Wavy outside edges, chambers,
// a deep central notch, and narrow load-bearing columns make the detached body
// both sparse and expensive for a bounding-box terrain scan.
for (let y = 34; y <= 204; y++) {
  const left = 65 + Math.round(8 * Math.sin(y * 0.17));
  const right = 494 + Math.round(10 * Math.sin(y * 0.11 + 1.3));
  for (let x = left; x <= right; x++) {
    const chamberA = ((x - 180) / 70) ** 2 + ((y - 118) / 45) ** 2 < 1;
    const chamberB = ((x - 365) / 82) ** 2 + ((y - 112) / 50) ** 2 < 1;
    const centerNotch = y > 122 && Math.abs(x - 280) < (y - 122) * 0.48;
    const scallop = y > 168 && ((x + Math.floor(y / 7)) % 31) < 11;
    if (!chamberA && !chamberB && !centerNotch && !scallop)
      paintCell(x, y, (x + y) % 37 === 0 ? MAT.IRON_ORE : MAT.STONE);
  }
}

for (let y = 192; y < FLOOR_Y; y++) {
  for (let x = 88; x <= 106; x++) paintCell(x, y);
  for (let x = 454; x <= 472; x++) paintCell(x, y);
}
engine.syncComponents();

// Actual explosion transactions remove both supports and enlarge the rough
// underside before grounding converts the surviving component into a body.
for (const [x, y] of [[97, 252], [97, 305], [463, 252], [463, 305]])
  engine._detonateTnt(x, y);

let peakBodies = 0;
let largestBodyCells = 0;
let largestBodyChildren = 0;
let landingTick = -1;
let peakBlocked = 0;
let peakTerrainBlocked = 0;
let latePeakBlocked = 0;
let latePeakSpeed = 0;
let lateAwakeTicks = 0;
let peakDepenetrations = 0;
let peakRejected = 0;
const bodyMs = [];
const activeBodyMs = [];
const childTransforms = [];
const childPairs = [];
const contacts = [];
const worstTicks = [];

for (let tick = 0; tick < STEPS; tick++) {
  engine.stepWorld();
  const count = engine._bodyCount();
  let largestState = null;
  peakBodies = Math.max(peakBodies, count);
  let blocked = 0;
  let terrainBlocked = 0;
  let speed = 0;
  let awake = 0;
  for (let body = 0; body < count; body++) {
    const state = engine._bodyState(body);
    largestBodyCells = Math.max(largestBodyCells, state?.nPts ?? 0);
    if (!largestState || state.nPts > largestState.nPts) largestState = state;
    largestBodyChildren = Math.max(largestBodyChildren,
      engine._bodyChildCount(body));
    blocked += Math.max(0, engine._bodyBlocked(body));
    terrainBlocked += Math.max(0, engine._bodyTerrainBlocked(body));
    speed = Math.max(speed,
      Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR);
    awake += engine._bodyAwake(body) > 0;
  }
  peakBlocked = Math.max(peakBlocked, blocked);
  peakTerrainBlocked = Math.max(peakTerrainBlocked, terrainBlocked);
  if (landingTick < 0 && blocked > 0) landingTick = tick;
  const perf = engine.getStepPerf();
  const solver = engine.getRigidSolverDebug();
  bodyMs.push(perf.bodyMs);
  if (count) activeBodyMs.push(perf.bodyMs);
  childTransforms.push(solver.childTransforms);
  childPairs.push(solver.childPairs);
  contacts.push(solver.contacts);
  worstTicks.push({
    tick,
    bodyMs: perf.bodyMs,
    bodies: count,
    largestCells: count
      ? Math.max(...Array.from({ length: count }, (_, body) =>
        engine._bodyState(body)?.nPts ?? 0))
      : 0,
    largestAngle: largestState?.angle ?? 0,
    rigidCoreMs: solver.rigidCoreMs,
    rigidClearMs: solver.rigidClearMs,
    rigidDepenMs: solver.rigidDepenMs,
    rigidStampMs: solver.rigidStampMs,
    rigidSpillMs: solver.rigidSpillMs,
    childTransforms: solver.childTransforms,
    childPairs: solver.childPairs,
    contacts: solver.contacts,
    substeps: solver.substeps,
  });
  const raster = engine.getRigidDebug();
  peakDepenetrations = Math.max(peakDepenetrations, raster.depenetrations);
  peakRejected = Math.max(peakRejected, raster.rejectedCells);
  if (tick >= 480) {
    latePeakBlocked = Math.max(latePeakBlocked, blocked);
    latePeakSpeed = Math.max(latePeakSpeed, speed);
    lateAwakeTicks += awake > 0;
  }
}

console.log(JSON.stringify({
  scene: 'TNT-released irregular terrain megabody',
  peakBodies,
  finalBodies: engine._bodyCount(),
  largestBodyCells,
  largestBodyChildren,
  landingTick,
  overlap: {
    peakBlocked,
    peakTerrainBlocked,
    latePeakBlocked,
    peakRejected,
    peakDepenetrations,
  },
  settling: { latePeakSpeed, lateAwakeTicks },
  bodyMs: {
    mean: sum(activeBodyMs) / Math.max(1, activeBodyMs.length),
    p50: percentile(activeBodyMs, 0.50),
    p95: percentile(activeBodyMs, 0.95),
    p99: percentile(activeBodyMs, 0.99),
    max: Math.max(0, ...activeBodyMs),
  },
  solverPerTick: {
    childTransformsMean: sum(childTransforms) / childTransforms.length,
    childPairsMean: sum(childPairs) / childPairs.length,
    contactsMean: sum(contacts) / contacts.length,
  },
  finalBodyStates: Array.from({ length: engine._bodyCount() }, (_, body) => ({
    ...engine._bodyState(body),
    awake: engine._bodyAwake(body),
    blocked: engine._bodyBlocked(body),
    material: engine._bodyMaterial(body),
    children: engine._bodyChildCount(body),
    blastDebris: engine._bodyBlastDebris(body),
  })),
  worstTicks: worstTicks.sort((a, b) => b.bodyMs - a.bodyMs).slice(0, 12),
}, null, 2));

engine.destroy();
