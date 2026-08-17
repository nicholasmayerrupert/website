// A crowded foreground/background contact island must commit one exact raster
// assignment before it can settle.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';
import { makeComplexStackScenario } from './rigid-complex-stack-scenario.mjs';

await initSandWasm();

const COLS = 960;
const ROWS = 1440;
const FLOOR_Y = 1360;
const STEPS = Number.parseInt(process.env.STEPS ?? '260', 10);
const SOLVER_MODE = 45;
const { check, done } = makeChecker('crowded cross-layer raster island');
const { random, specs: allSpecs } = makeComplexStackScenario(19, COLS);
const specs = allSpecs.filter((_, index) => index >= 7 && index !== 10);
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 19,
  sinksOn: false,
  infinite: false,
}));
engine.setBgEnabled(true);
engine._setRigidSolverOptions(SOLVER_MODE, 0.0001, 4);
engine._setRigidPeerBiasScale(1);
engine._setRigidWorldPositionLimit(0.5);

const layerGrid = (layer) => layer ? engine.getGridBg() : engine.getGrid();
for (let x = 1; x < COLS - 1; x++) {
  const top = FLOOR_Y + Math.round(11 * Math.sin(x * 0.041 + 19))
    - ((x * 29 + 19) % 71 < 11 ? 19 : 0);
  for (let y = top; y < ROWS; y++) {
    engine.getGrid()[y * COLS + x] = MAT.STONE;
    engine.getGridBg()[y * COLS + x] = MAT.DEEPSTONE;
  }
}

const deferred = [];
const seedCells = (layer, cells, ox, oy, material) => {
  const grid = layerGrid(layer);
  deferred.push({ layer, x: cells[0][0] + ox, y: cells[0][1] + oy, material });
  for (let index = 1; index < cells.length; index++) {
    const [x, y] = cells[index];
    grid[(y + oy) * COLS + x + ox] = material;
  }
};
for (const spec of specs) {
  if (spec.kind === 'joint')
    seedCells(0, spec.cells, spec.x, spec.y, MAT.BRICK);
  if (spec.kind !== 'fg')
    seedCells(1, spec.kind === 'joint' ? spec.peerCells : spec.cells,
      spec.x, spec.y, MAT.IRON_ORE);
}
engine.syncComponentsLayer(0);
engine.syncComponentsLayer(1);
for (const seed of deferred) {
  const written = engine.paintDiscLayer(
    seed.layer, seed.x, seed.y, 0, seed.material, true);
  if (written !== 1) throw new Error('failed to activate rigid island fixture');
}
engine.stepWorld();
for (const spec of specs)
  if (spec.kind === 'fg')
    engine.spawnBody(spec.cells.map(([x, y]) => [x + spec.x, y + spec.y]));

let jointLeaders = 0;
for (let body = 0; body < engine._bodyCountLayer(0); body++) {
  if (engine._bodyJointRoleLayer(0, body) === 1) jointLeaders++;
  engine._setBodyMotion(body,
    (random() - 0.5) * 1.6,
    0.15 + random() * 0.65,
    (random() - 0.5) * 0.06);
}
check('fixture creates one joint and three ordinary bodies',
  engine._bodyCountLayer(0) === 2
    && engine._bodyCountLayer(1) === 3
    && jointLeaders === 1);

let maxBlocked = 0;
let maxTerrainBlocked = 0;
let maxOwnershipConflicts = 0;
let maxProjectionFailures = 0;
let maxCorrection = 0;
let maxCorrectionTick = -1;
let settledAt = -1;
let abruptRasterStops = 0;
let abruptRasterRotationStops = 0;
let maxStoppedPointSpeed = 0;
let maxStoppedOmega = 0;
const bodySnapshot = () => {
  const snapshot = new Map();
  for (let layer = 0; layer < 2; layer++) {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
      if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
      const state = engine._bodyStateLayer(layer, body);
      if (!state) continue;
      snapshot.set(`${layer}:${engine._bodyIdLayer(layer, body)}`, {
        awake: engine._bodyAwakeLayer(layer, body) > 0,
        pointSpeed: Math.hypot(state.vx, state.vy)
          + Math.abs(state.omega) * state.maxR,
        omega: state.omega,
      });
    }
  }
  return snapshot;
};
let previousBodies = bodySnapshot();
for (let tick = 0; tick < STEPS; tick++) {
  engine.stepWorld();
  const solver = engine.getRigidSolverDebug();
  const currentBodies = bodySnapshot();
  if (solver.rasterCorrections > 0) {
    for (const [key, previous] of previousBodies) {
      const current = currentBodies.get(key);
      if (!current || !previous.awake) continue;
      if (previous.pointSpeed > 0.25
          && !current.awake && current.pointSpeed <= 1e-9) {
        abruptRasterStops++;
        maxStoppedPointSpeed = Math.max(
          maxStoppedPointSpeed, previous.pointSpeed);
      }
      if (Math.abs(previous.omega) > 1e-4
          && Math.abs(current.omega) <= 1e-9) {
        abruptRasterRotationStops++;
        maxStoppedOmega = Math.max(
          maxStoppedOmega, Math.abs(previous.omega));
      }
    }
  }
  previousBodies = currentBodies;
  let awake = 0;
  for (let layer = 0; layer < 2; layer++) {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
      if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
      maxBlocked = Math.max(
        maxBlocked, engine._bodyBlockedLayer(layer, body));
      maxTerrainBlocked = Math.max(
        maxTerrainBlocked, engine._bodyTerrainBlockedLayer(layer, body));
      awake += engine._bodyAwakeLayer(layer, body) > 0;
    }
  }
  maxOwnershipConflicts = Math.max(
    maxOwnershipConflicts, solver.ownershipConflicts);
  maxProjectionFailures = Math.max(
    maxProjectionFailures, solver.rasterProjectionFailures);
  if (solver.rasterMaxCorrection > maxCorrection) {
    maxCorrection = solver.rasterMaxCorrection;
    maxCorrectionTick = tick;
  }
  if (awake === 0 && settledAt < 0) settledAt = tick;
}

let finalAwake = 0;
let finalBlocked = 0;
for (let layer = 0; layer < 2; layer++) {
  for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
    if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
    finalAwake += engine._bodyAwakeLayer(layer, body) > 0;
    finalBlocked += Math.max(
      0, engine._bodyBlockedLayer(layer, body));
  }
}

check(`all theoretical body claims remain unique (${maxBlocked})`,
  maxBlocked === 0);
check(`every body remains outside terrain (${maxTerrainBlocked})`,
  maxTerrainBlocked === 0);
check(`committed ownership remains conflict-free (${maxOwnershipConflicts})`,
  maxOwnershipConflicts === 0);
check(`every island projection succeeds (${maxProjectionFailures})`,
  maxProjectionFailures === 0);
check(`projection correction remains bounded `
    + `(${maxCorrection.toFixed(4)} at ${maxCorrectionTick})`,
  maxCorrection <= 2);
check(`raster recovery preserves active motion `
    + `(${abruptRasterStops} body stops, `
    + `${abruptRasterRotationStops} rotation stops, peak speed `
    + `${maxStoppedPointSpeed.toFixed(4)}, omega `
    + `${maxStoppedOmega.toFixed(6)})`,
  abruptRasterStops === 0 && abruptRasterRotationStops === 0);
check(`island settles and stays uniquely assigned (${settledAt}/${finalBlocked})`,
  settledAt >= 0 && finalAwake === 0 && finalBlocked === 0);

engine.destroy();
process.exitCode = done();
