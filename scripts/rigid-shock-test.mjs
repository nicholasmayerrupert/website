// Tall, gravity-supported stacks exercise Box2D pile collapse, contact, and
// island sleep separately from the irregular long-body benchmark.

import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const cols = 160, rows = 260, floorY = rows - 3;
const stone = 3;

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols, rows, worldSeed: 0x2f5f, sinksOn: false, infinite: false,
}));

for (let y = floorY; y < rows; y++)
  for (let x = 0; x < cols; x++)
    engine.paintDisc(x, y, 0, stone, true);
engine.syncComponents();

const rectangle = (x0, y0, width, height) => {
  const cells = [];
  for (let y = y0; y < y0 + height; y++)
    for (let x = x0; x < x0 + width; x++) cells.push([x, y]);
  return cells;
};

const bodyCount = 24, width = 9, height = 5, centerX = cols >> 1;
for (let body = 0; body < bodyCount; body++) {
  const x = centerX - (width >> 1);
  const y = floorY - height - body * (height + 1);
  engine.spawnBody(rectangle(x, y, width, height));
}
const initialStates = [...Array(bodyCount).keys()]
  .map((body) => engine._bodyState(body));

let solveMs = 0, settledAt = -1, maxLayers = 0;
let peakLatePointSpeed = 0, maxContacts = 0;
for (let tick = 1; tick <= 1200; tick++) {
  const start = performance.now();
  engine.stepWorld();
  solveMs += performance.now() - start;
  const diagnostics = engine.getRigidSolverDebug();
  maxContacts = Math.max(maxContacts, diagnostics.contacts);
  maxLayers = Math.max(maxLayers, diagnostics.islands);
  let awake = 0;
  for (let body = 0; body < engine._bodyCount(); body++) {
    awake += engine._bodyAwake(body) > 0;
    if (tick >= 800) {
      const state = engine._bodyState(body);
      peakLatePointSpeed = Math.max(peakLatePointSpeed,
        Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR);
    }
  }
  if (awake === 0 && settledAt < 0) settledAt = tick;
}

let finalAwake = 0, maxTilt = 0, maxHorizontalDrift = 0;
let minCenterY = Infinity, maxCenterY = -Infinity, preservedPairs = 0;
const finalStates = [];
for (let body = 0; body < engine._bodyCount(); body++) {
  finalAwake += engine._bodyAwake(body) > 0;
  const state = engine._bodyState(body);
  finalStates.push(state);
  maxTilt = Math.max(maxTilt, Math.abs(state.angle));
  maxHorizontalDrift = Math.max(maxHorizontalDrift,
    Math.abs(state.px - initialStates[body].px));
  minCenterY = Math.min(minCenterY, state.py);
  maxCenterY = Math.max(maxCenterY, state.py);
}
for (let body = 0; body + 1 < finalStates.length; body++)
  preservedPairs += finalStates[body].py > finalStates[body + 1].py;

const result = {
  scene: `${bodyCount}-body vertical stack`,
  finalBodies: engine._bodyCount(),
  finalAwake,
  settledAt,
  maxTilt,
  maxHorizontalDrift,
  finalVerticalSpan: maxCenterY - minCenterY,
  preservedPairs,
  peakLatePointSpeed,
  solveMs,
  maxContacts,
  maxLayers,
};
console.log(JSON.stringify(result, null, 2));

const checks = [
  ['all bodies remain represented', result.finalBodies === bodyCount],
  ['collapsed pile reaches island sleep by tick 800',
    result.settledAt > 0 && result.settledAt <= 800],
  ['tower has no awake bodies', result.finalAwake === 0],
  ['pile remains inside the finite arena', result.maxHorizontalDrift < cols / 2],
  ['pile retains a nonzero vertical span', result.finalVerticalSpan >= 30],
  ['Box2D contact graph activates', result.maxContacts > 0],
  ['late pile motion is zero', result.peakLatePointSpeed <= 0.001],
];
for (const [label, passed] of checks)
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}`);
if (checks.some(([, passed]) => !passed)) {
  engine.destroy();
  process.exit(1);
}

engine.destroy();
