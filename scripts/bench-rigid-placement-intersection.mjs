// Reproduce the two expensive placement failure modes: a structural placement
// bridging static terrain to a joint body, and a body already embedded too
// deeply for the local terrain correction radius.

import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

await initSandWasm();

const createEngine = (cols, rows, seed) => attachTestHooks(createEngineWasmRaw({
  cols,
  rows,
  worldSeed: seed,
  sinksOn: false,
  infinite: false,
}));

const overlap = createEngine(360, 240, 0x6f766572);
for (let y = 160; y < overlap.rows; y++)
  for (let x = 0; x < overlap.cols; x++)
    overlap.paintDisc(x, y, 0, MAT.STONE, true);
overlap.syncComponents();
overlap._spawnBoxLayer(0, 180, 125, 140, 38, MAT.STONE);
const overlapStart = performance.now();
overlap.stepWorld();
const overlapWallMs = performance.now() - overlapStart;
const overlapSolver = overlap.getRigidSolverDebug();
const overlapResult = {
  cells: overlap._bodyState(0)?.nPts ?? 0,
  wallMs: overlapWallMs,
  bodyMs: overlap.getStepPerf().bodyMs,
  depenMs: overlapSolver.rigidDepenMs,
  depenetrations: overlap.getRigidDebug().depenetrations,
};
overlap.destroy();

const placement = createEngine(420, 260, 0x616e6368);
placement.setBgEnabled(true);
for (let y = 36; y <= 126; y++) {
  for (let x = 24; x <= 190; x++)
    placement.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  for (let x = 184; x <= 390; x++)
    placement.paintDiscLayer(1, x, y, 0, MAT.BRICK, true);
}
placement.syncComponentsLayer(0);
placement.syncComponentsLayer(1);
placement.stepWorld();

const fgOwners = placement._bodyOwnerGrid(0);
const bgOwners = placement._bodyOwnerGrid(1);
const fg = placement.getGrid();
let target = null;
for (let y = 42; y <= 120 && !target; y++) for (let x = 230; x <= 370; x++) {
  const k = y * placement.cols + x;
  if (bgOwners[k] < 0 || fg[k] !== MAT.EMPTY) continue;
  let foregroundBodyNearby = false;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
    if (fgOwners[(y + oy) * placement.cols + x + ox] >= 0)
      foregroundBodyNearby = true;
  if (!foregroundBodyNearby) { target = { x, y }; break; }
}
if (!target) throw new Error('large placement scene has no peer-only joint cell');
for (let y = target.y; y < placement.rows; y++)
  placement.paintDiscLayer(0, target.x - 1, y, 0, MAT.STONE, true);
placement.syncComponentsLayer(0);
const placementStart = performance.now();
placement.placeMaterial(target.x, target.y, 0, MAT.TNT, 0);
const placementWallMs = performance.now() - placementStart;
const stepStart = performance.now();
placement.stepWorld();
const placementStepWallMs = performance.now() - stepStart;
const placementResult = {
  target,
  placementWallMs,
  nextStepWallMs: placementStepWallMs,
  nextStepBodyMs: placement.getStepPerf().bodyMs,
  nextStepDepenMs: placement.getRigidSolverDebug().rigidDepenMs,
  foregroundBodies: placement._bodyCountLayer(0),
  backgroundBodies: placement._bodyCountLayer(1),
  tntOwner: placement._bodyOwnerGrid(0)[target.y * placement.cols + target.x],
};
placement.destroy();

const result = { overlapRecovery: overlapResult, anchoredPlacement: placementResult };
console.log(JSON.stringify(result, null, 2));

const maxDepenMs = Number(process.env.MAX_INTERSECTION_DEPEN_MS ?? 40);
if (overlapResult.depenMs > maxDepenMs)
  throw new Error(`intersection recovery exceeded ${maxDepenMs} ms`);
if (placementResult.foregroundBodies !== 0
    || placementResult.backgroundBodies !== 0
    || placementResult.tntOwner >= 0)
  throw new Error('static+rigid placement did not immediately anchor');
