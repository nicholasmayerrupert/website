// Thin foreground/background structures cut by fast eraser strokes remain
// separate while a neutronium field compacts them against one another.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';
import { buildCrossLayerSliverScene } from './rigid-sliver-scenario.mjs';

await initSandWasm();
const { check, done } = makeChecker('cross-layer rigid slivers');

const engine = attachTestHooks(createEngineWasmRaw({
  cols: 360,
  rows: 240,
  worldSeed: 0x51a7c0de,
  sinksOn: false,
  infinite: false,
}));
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
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
