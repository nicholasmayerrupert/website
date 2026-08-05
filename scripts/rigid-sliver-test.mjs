// Thin foreground/background structures cut by fast eraser strokes remain
// separate while a neutronium field compacts them against one another.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';
import { buildCrossLayerSliverScene } from './rigid-sliver-scenario.mjs';

await initSandWasm();
const { check, done } = makeChecker('cross-layer rigid slivers');
const solverMode = Number(process.env.RIGID_SOLVER_MODE ?? 2);
const useSolverMode = (engine) => {
  engine._setRigidSolverOptions(solverMode);
  return engine;
};

const engine = useSolverMode(attachTestHooks(createEngineWasmRaw({
  cols: 360,
  rows: 240,
  worldSeed: 0x51a7c0de,
  sinksOn: false,
  infinite: false,
})));
buildCrossLayerSliverScene(engine, {
  left: 28,
  right: 332,
  top: 16,
  bottom: 112,
  floorY: 235,
  sourceX: 180,
  sourceY: 205,
  cutSpacing: 10,
  backgroundCutOffset: 1,
});

let maxJointSlivers = 0;
let maxBlocked = 0;
let maxOwnershipConflicts = 0;
let maxRejected = 0;
let maxBodyMs = 0;
let maxBodyTick = -1;
let maxBodyCount = 0;
let maxGlobalBodySteps = 0;
let maxPositionCorrections = 0;
let maxRecoveryBodies = 0;
let maxRigidCoreMs = 0;
let maxRigidDepenMs = 0;
let maxRigidStampMs = 0;
let firstBlockedTick = -1;
let firstConflictTick = -1;
let maxBodyCenterY = 0;
for (let tick = 0; tick < 360; tick++) {
  engine.stepWorld();
  const solver = engine.getRigidSolverDebug();
  const rigid = engine.getRigidDebug();
  maxOwnershipConflicts = Math.max(
    maxOwnershipConflicts, solver.ownershipConflicts);
  maxRejected = Math.max(maxRejected, rigid.rejectedCells);
  const bodyMs = engine.getStepPerf().bodyMs;
  if (bodyMs > maxBodyMs) {
    maxBodyMs = bodyMs;
    maxBodyTick = tick;
    maxBodyCount = engine._bodyCountLayer(0);
  }
  maxGlobalBodySteps = Math.max(
    maxGlobalBodySteps, solver.globalBodySteps);
  maxPositionCorrections = Math.max(
    maxPositionCorrections, solver.positionCorrections);
  maxRecoveryBodies = Math.max(maxRecoveryBodies, solver.recoveryBodies);
  maxRigidCoreMs = Math.max(maxRigidCoreMs, solver.rigidCoreMs);
  maxRigidDepenMs = Math.max(maxRigidDepenMs, solver.rigidDepenMs);
  maxRigidStampMs = Math.max(maxRigidStampMs, solver.rigidStampMs);
  let jointSlivers = 0;
  for (let i = 0; i < engine._bodyCountLayer(0); i++)
    if (engine._bodyJointRoleLayer(0, i) === 1) jointSlivers++;
  maxJointSlivers = Math.max(maxJointSlivers, jointSlivers);
  for (let i = 0; i < engine._bodyCountLayer(0); i++) {
    const state = engine._bodyStateLayer(0, i);
    if (state) maxBodyCenterY = Math.max(maxBodyCenterY, state.py);
    const blocked = engine._bodyBlocked(i);
    if (blocked > 0 && firstBlockedTick < 0) firstBlockedTick = tick;
    maxBlocked = Math.max(maxBlocked, blocked);
  }
  if (solver.ownershipConflicts > 0 && firstConflictTick < 0)
    firstConflictTick = tick;
}
check(`eraser strokes create many cross-layer slivers (${maxJointSlivers})`,
  maxJointSlivers >= 24);
check(`slivers reach the neutronium collision zone (y ${maxBodyCenterY.toFixed(1)})`,
  maxBodyCenterY >= 160);
check(`sliver rasters stay mutually clear (${maxBlocked} blocked cells)`,
  maxBlocked === 0);
check(`sliver stamping keeps unique ownership (${maxOwnershipConflicts} conflicts)`,
  maxOwnershipConflicts === 0);
check(`sliver rasters remain clear of terrain (${maxRejected} rejected cells)`,
  maxRejected === 0);
console.log(`  info body max ${maxBodyMs.toFixed(3)} ms at tick ${maxBodyTick} with ${maxBodyCount} foreground bodies (core/depen/stamp ${maxRigidCoreMs.toFixed(3)}/${maxRigidDepenMs.toFixed(3)}/${maxRigidStampMs.toFixed(3)}), solver body-steps max ${maxGlobalBodySteps}, position corrections/recoveries max ${maxPositionCorrections}/${maxRecoveryBodies}, first blocked/conflict ticks ${firstBlockedTick}/${firstConflictTick}`);

engine.destroy();

console.log('\nforce-driven single-layer rigid pile stays live');
const pile = useSolverMode(attachTestHooks(createEngineWasmRaw({
  cols: 768,
  rows: 320,
  worldSeed: 0xC0FFEE,
  sinksOn: false,
  infinite: false,
})));
const paintPileRect = (x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      pile.paintDisc(x, y, 0, material, true);
};
paintPileRect(0, 315, 767, 319, MAT.STONE);
paintPileRect(390, 145, 390, 314, MAT.STONE);
pile.paintDisc(390, 145, 7, MAT.NEUTRONIUM, true);
for (let i = 0; i < 48; i++)
  pile.spawnBox(255 + (i % 8) * 19, 45 + Math.floor(i / 8) * 16,
    2, 2, MAT.RIGID);
pile.syncComponents();

let maxPileRecoveries = 0;
for (let tick = 0; tick <= 500; tick++) {
  pile.stepWorld();
  maxPileRecoveries = Math.max(maxPileRecoveries,
    pile.getRigidSolverDebug().recoveryBodies);
}
let finalPileAwake = 0;
let finalPileMoving = 0;
for (let body = 0; body < pile._bodyCount(); body++) {
  finalPileAwake += pile._bodyAwake(body) > 0;
  const state = pile._bodyState(body);
  const pointSpeed = Math.hypot(state.vx, state.vy)
    + Math.abs(state.omega) * state.maxR;
  finalPileMoving += pointSpeed > 0.001;
}
check(`single-layer pile bypasses cross-layer recovery (${maxPileRecoveries} bodies)`,
  maxPileRecoveries === 0);
check(`force-driven pile stays live (${finalPileMoving}/48 moving, ${finalPileAwake} awake)`,
  finalPileMoving >= 8 && finalPileAwake >= 16);
pile.destroy();

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
