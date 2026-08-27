// Full stamp rejection restores the last pose. Tiny seeds sleep on a raster
// lock; larger shapes stay awake without a lock or a depenetration pop.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const solverMode = Number(process.env.RIGID_SOLVER_MODE ?? 2);
const createEngine = (opts) => {
  const engine = attachTestHooks(createEngineWasmRaw(opts));
  engine._setRigidSolverOptions(solverMode);
  return engine;
};

const rectangle = (x0, y0, x1, y1) => {
  const cells = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return cells;
};

// Mark destination cells as owned by a missing body so the proposed raster is
// wholly rejected without becoming solid terrain the CCD wall would stop on.
const blockCells = (engine, x0, y0, x1, y1) => {
  const owners = engine._bodyOwnerGrid(0);
  const cols = engine.cols;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      owners[y * cols + x] = 999999;
};

const resetBlockedCells = (engine) => {
  const owners = engine._bodyOwnerGrid(0);
  for (let k = 0; k < owners.length; k++)
    if (owners[k] === 999999) owners[k] = -1;
};

const runUntilRecovery = (engine, steps = 40) => {
  let previous = engine._bodyState(0);
  for (let tick = 0; tick < steps; tick++) {
    engine.stepWorld();
    const state = engine._bodyState(0);
    if (state && state.stampRecoveryTotal > 0)
      return { recovered: true, previous, after: state };
    previous = state;
  }
  return { recovered: false, previous, after: engine._bodyState(0) };
};

const { check, done } = makeChecker('stamp rejection restores pose without popping large shapes');

{
  const engine = createEngine({
    cols: 96, rows: 64, worldSeed: 0x51a7e, sinksOn: false, infinite: false,
  });
  engine.spawnBody([[20, 30]]);
  engine.stepWorld();
  blockCells(engine, 22, 20, 80, 50);
  engine._setBodyMotion(0, 3, 0, 0);
  const result = runUntilRecovery(engine);
  const after = result.after;
  check('tiny seed stamp rejection actually ran', result.recovered && after);
  check('tiny seed sleeps after a rejected stamp',
    after && engine._bodyAwake(0) === 0);
  check('tiny seed keeps a stamp-recovery lock',
    after && after.stampRecoveryTotal > 0 && after.stampRecoveryStreak > 0);
  check('tiny seed pose stays on the last accepted raster',
    after && result.previous
    && Math.hypot(after.px - result.previous.px, after.py - result.previous.py) < 1);
  resetBlockedCells(engine);
}

{
  const engine = createEngine({
    cols: 96, rows: 64, worldSeed: 0x51a7e, sinksOn: false, infinite: false,
  });
  engine.spawnBody(rectangle(12, 24, 16, 28));
  engine.stepWorld();
  blockCells(engine, 18, 10, 90, 50);
  engine._setBodyMotion(0, 3, 0, 0);
  const result = runUntilRecovery(engine);
  const after = result.after;
  check('large shape stamp rejection actually ran',
    result.recovered && after && after.nPts > 4);
  check('large shape stays awake after a rejected stamp',
    after && engine._bodyAwake(0) > 0);
  check('large shape does not sleep-lock the rejected stamp',
    after && after.stampRecoveryTotal > 0 && engine._bodyAwake(0) > 0);
  check('large shape restores the last pose without a ~4.5-cell pop',
    after && result.previous
    && Math.hypot(after.px - result.previous.px, after.py - result.previous.py) < 1);
  resetBlockedCells(engine);
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
