// Deterministic regressions for adaptive rigid-fluid coupling.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const COLS = 180;
const ROWS = 130;
const STONE = 3;
const WATER = 2;
const WOOD = 8;
const RIGID = 13;

await initSandWasm();

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};
const makeEngine = () => createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x51A7E,
  sinksOn: false,
});
const run = (engine, steps, start = 0) => {
  let now = start;
  for (let i = 0; i < steps; i++) {
    now += 16;
    engine.step(now);
  }
  return now;
};
const paintRect = (engine, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};
const buildPool = (engine) => {
  paintRect(engine, 24, 112, 155, 115, STONE);
  paintRect(engine, 24, 42, 27, 111, STONE);
  paintRect(engine, 152, 42, 155, 111, STONE);
  engine.syncComponents();
  paintRect(engine, 28, 48, 151, 111, WATER);
};
const countMaterial = (engine, material) => {
  let count = 0;
  for (const value of engine.getGrid()) if (value === material) count++;
  return count;
};

{
  console.log('fast wet motion receives a post-advection pressure correction');
  const engine = makeEngine();
  buildPool(engine);
  let now = run(engine, 100);
  const waterBefore = countMaterial(engine, WATER);
  engine.spawnBox(90, 32, 5, 5, RIGID);
  engine._setBodyMotion(0, 0, 3, 0);
  let correctors = 0;
  for (let i = 0; i < 90; i++) {
    now = run(engine, 1, now);
    correctors += engine.getRigidSolverDebug().fluidCorrectorPasses;
  }
  const waterAfter = countMaterial(engine, WATER);
  check(`strong entry used the adaptive corrector (${correctors} passes)`,
    correctors > 0);
  check(`pressure correction conserved liquid volume (${waterAfter} == ${waterBefore})`,
    waterAfter === waterBefore);
  engine.destroy();
}

{
  console.log('ordinary wet motion stays on the single pressure pass');
  const engine = makeEngine();
  buildPool(engine);
  let now = run(engine, 100);
  engine.spawnBox(90, 75, 5, 5, RIGID);
  engine._setBodyMotion(0, 0.2, 0, 0);
  now = run(engine, 1, now);
  const correctors = engine.getRigidSolverDebug().fluidCorrectorPasses;
  check(`sub-cell travel skipped the corrector (${correctors} passes)`,
    correctors === 0);
  engine.destroy();
}

{
  console.log('a new current wakes a fluid-supported sleeping body');
  const engine = makeEngine();
  buildPool(engine);
  let now = run(engine, 100);
  engine.spawnBox(90, 35, 7, 4, WOOD);
  for (let i = 0; i < 900 && engine._bodyAwake(0) !== 0; i++)
    now = run(engine, 1, now);
  check('wood reached a sleeping buoyant equilibrium',
    engine._bodyAwake(0) === 0);

  const grid = engine.getGrid();
  const owners = engine._bodyOwnerGrid();
  let wetNeighbor = -1;
  const offsets = [-1, 1, -COLS, COLS];
  for (let k = 0; k < owners.length && wetNeighbor < 0; k++) {
    if (owners[k] < 0) continue;
    const x = k % COLS;
    const y = (k / COLS) | 0;
    for (const offset of offsets) {
      const neighbor = k + offset;
      if (neighbor < 0 || neighbor >= grid.length) continue;
      const nx = neighbor % COLS;
      const ny = (neighbor / COLS) | 0;
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      if (grid[neighbor] === WATER && owners[neighbor] < 0) {
        wetNeighbor = neighbor;
        break;
      }
    }
  }
  check('sleeping body has an exposed wet face', wetNeighbor >= 0);
  if (wetNeighbor >= 0) {
    const x = wetNeighbor % COLS;
    const y = (wetNeighbor / COLS) | 0;
    engine._setLiquidVelocity(0, x, y, 1.5, 0);
    now = run(engine, 1, now);
    const state = engine._bodyState(0);
    check(`current woke the body (awake ${engine._bodyAwake(0)})`,
      engine._bodyAwake(0) === 1);
    check(`current transferred momentum (vx ${state.vx.toFixed(5)})`,
      Math.abs(state.vx) > 1e-4);
  }
  engine.destroy();
}

console.log(failures ? `\n${failures} checks FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
