// A joint foreground/background structure and an independent background body
// must retain a unique integer-raster assignment when they collide.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';
import { makeComplexStackScenario } from './rigid-complex-stack-scenario.mjs';

await initSandWasm();
const requestedSolverMode = process.env.RIGID_SOLVER_MODE;
const SOLVER_MODES = requestedSolverMode
  ? [Number(requestedSolverMode)]
  : [2, 45];
const COLS = 245, ROWS = 197, SCALE = 0.35;

const transform = (cells, spec) => {
  const result = new Map();
  for (const [x, y] of cells) {
    const worldX = Math.round((x + spec.x - 150) * SCALE) + 10;
    const worldY = Math.round((y + spec.y - 90) * SCALE) + 10;
    if (worldX <= 0 || worldX >= COLS - 1
        || worldY <= 0 || worldY >= ROWS)
      continue;
    result.set(`${worldX},${worldY}`, [worldX, worldY]);
  }
  return [...result.values()];
};

const { specs } = makeComplexStackScenario(7);
const joint = specs[1];
const independent = specs[2];
const jointFg = transform(joint.cells, joint);
const jointBg = transform(joint.peerCells, joint);
const independentBg = transform(independent.cells, independent);

const runCase = (solverMode) => {
  const { check, done } = makeChecker(
    `cross-layer rigid raster projection (solver ${solverMode})`);
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: 7,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(true);
  engine._setRigidSolverOptions(solverMode, 0.0001, 4);
  engine._setRigidPeerBiasScale(1);
  engine._setRigidWorldPositionLimit(0.5);
  
  const layerGrid = (layer) => layer ? engine.getGridBg() : engine.getGrid();
  const deferred = [];
  const seedFloating = (layer, cells, material) => {
    if (!cells.length) throw new Error('empty rigid raster fixture mask');
    deferred.push({ layer, cell: cells[0], material });
    const grid = layerGrid(layer);
    for (let index = 1; index < cells.length; index++) {
      const [x, y] = cells[index];
      grid[y * COLS + x] = material;
    }
  };
  seedFloating(0, jointFg, MAT.BRICK);
  seedFloating(1, jointBg, MAT.IRON_ORE);
  seedFloating(1, independentBg, MAT.IRON_ORE);
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  for (const seed of deferred) {
    const written = engine.paintDiscLayer(
      seed.layer, seed.cell[0], seed.cell[1], 0, seed.material, true);
    if (written !== 1) throw new Error('failed to activate rigid raster fixture');
  }
  engine.stepWorld();
  
  const findBody = (layer, role) => {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++)
      if (engine._bodyJointRoleLayer(layer, body) === role) return body;
    return -1;
  };
  const leader = findBody(0, 1);
  const follower = findBody(1, 2);
  const target = findBody(1, 0);
  check('fixture creates exactly one joint and one independent background body',
    engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 2
      && leader >= 0 && follower >= 0 && target >= 0);
  
  const targetId = engine._bodyIdLayer(1, target);
  engine._setBodyMotion(leader,
    -0.4399018567055464,
    0.4504933575168252,
    0.02624906545970589);
  
  let maxPeerBlocked = 0;
  let maxSameLayerBlocked = 0;
  let maxTerrainBlocked = 0;
  let maxOwnershipConflicts = 0;
  let maxProjectionFailures = 0;
  let maxBlocker = { id: -1, count: 0 };
  let totalContacts = 0;
  for (let tick = 0; tick < 120; tick++) {
    engine.stepWorld();
    const peerBlocked = engine._bodyOwnerBlockedGrid(0, leader, 1);
    const sameLayerBlocked = engine._bodyOwnerBlockedGrid(0, leader, 0);
    const blocker = engine._bodyPrimaryBlocker(0, leader, 1);
    const solver = engine.getRigidSolverDebug();
    maxPeerBlocked = Math.max(maxPeerBlocked, peerBlocked);
    maxSameLayerBlocked = Math.max(maxSameLayerBlocked, sameLayerBlocked);
    maxTerrainBlocked = Math.max(maxTerrainBlocked,
      engine._bodyTerrainBlockedLayer(0, leader));
    maxOwnershipConflicts = Math.max(
      maxOwnershipConflicts, solver.ownershipConflicts);
    maxProjectionFailures = Math.max(
      maxProjectionFailures, solver.rasterProjectionFailures);
    totalContacts += solver.contacts;
    if (blocker.count > maxBlocker.count) maxBlocker = blocker;
  }
  
  check(`joint contacts the independent body (${totalContacts} contacts)`,
    totalContacts > 0);
  check(`peer raster overlap stays within one alias cell (${maxPeerBlocked})`,
    maxPeerBlocked <= 1);
  check(`peer overlap attribution remains exact (${maxBlocker.id}:${maxBlocker.count})`,
    maxBlocker.count === maxPeerBlocked
      && (maxBlocker.count === 0 || maxBlocker.id === targetId));
  check(`same-layer raster remains unique (${maxSameLayerBlocked})`,
    maxSameLayerBlocked === 0);
  check(`joint remains clear of terrain (${maxTerrainBlocked})`,
    maxTerrainBlocked === 0);
  check(`every final raster projection finds a valid pose (${maxProjectionFailures})`,
    maxProjectionFailures === 0);
  console.log(`  info attempted ownership conflicts ${maxOwnershipConflicts}`);
  console.log(`  info masks ${jointFg.length}/${jointBg.length}/${independentBg.length}`);
  
  engine.destroy();
  return done();
};

let failures = 0;
for (const solverMode of SOLVER_MODES) failures += runCase(solverMode);
process.exitCode = failures;
