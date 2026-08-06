// Reproduce a large foreground/background structural island landing on terrain.
// Reports the exact solver phase and boundary-sample volume around first contact.

import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const COLS = 560;
const ROWS = 420;
const FLOOR_Y = 350;
const STEPS = 220;
const MAX_BAKE_MS = Number(process.env.MAX_BAKE_MS ?? 20);

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x6d756c74,
  sinksOn: false,
  infinite: false,
}));
engine.setBgEnabled(true);

const paint = (layer, x, y, material = MAT.STONE) =>
  engine.paintDiscLayer(layer, x, y, 0, material, true);

for (const layer of [0, 1]) {
  for (let y = FLOOR_Y; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) paint(layer, x, y);

  for (let y = 34; y <= 204; y++) {
    const shift = layer ? 4 : 0;
    const left = 65 + shift + Math.round(8 * Math.sin(y * 0.17));
    const right = 494 + shift
      + Math.round(10 * Math.sin(y * 0.11 + 1.3));
    for (let x = left; x <= right; x++) {
      const chamberA = ((x - shift - 180) / 70) ** 2
        + ((y - 118) / 45) ** 2 < 1;
      const chamberB = ((x - shift - 365) / 82) ** 2
        + ((y - 112) / 50) ** 2 < 1;
      const centerNotch = y > 122
        && Math.abs(x - shift - 280) < (y - 122) * 0.48;
      const scallop = y > 168
        && (x + Math.floor(y / 7) + layer * 11) % 31 < 11;
      if (!chamberA && !chamberB && !centerNotch && !scallop)
        paint(layer, x, y, (x + y) % 37 === 0 ? MAT.IRON_ORE : MAT.STONE);
    }
  }

  for (let y = 192; y < FLOOR_Y; y++) {
    for (let x = 88; x <= 106; x++) paint(layer, x, y);
    for (let x = 454; x <= 472; x++) paint(layer, x, y);
  }
  engine.syncComponentsLayer(layer);
}
engine.stepWorld();

// Cut both layers through both supports without adding blast debris to the
// measured landing scene.
for (const layer of [0, 1]) {
  engine.paintDiscLayer(layer, 97, 286, 14, MAT.EMPTY, true);
  engine.paintDiscLayer(layer, 463, 286, 14, MAT.EMPTY, true);
  engine.syncComponentsLayer(layer);
}
engine.stepWorld();

const findLeader = () => {
  for (let body = 0; body < engine._bodyCountLayer(0); body++)
    if (engine._bodyJointRoleLayer(0, body) === 1) return body;
  return -1;
};
const leader = findLeader();
if (leader < 0) throw new Error('scene did not create a joint rigid body');

const initial = engine._bodyStateLayer(0, leader);
const jointChildren = engine._bodyChildCount(leader);
let firstContact = -1;
let maxBodyMs = 0;
let maxTerrainMs = 0;
let maxTerrainSamples = 0;
let maxDepenMs = 0;
let maxBakeMs = 0;
let maxBakedCells = 0;
const ticks = [];
for (let tick = 0; tick < STEPS; tick++) {
  const start = performance.now();
  engine.stepWorld();
  const wallMs = performance.now() - start;
  const perf = engine.getStepPerf();
  const solver = engine.getRigidSolverDebug();
  if (firstContact < 0 && solver.contacts > 0) firstContact = tick;
  maxBodyMs = Math.max(maxBodyMs, perf.bodyMs);
  maxTerrainMs = Math.max(maxTerrainMs, solver.rigidTerrainContactMs);
  maxTerrainSamples = Math.max(maxTerrainSamples, solver.terrainSamples);
  maxDepenMs = Math.max(maxDepenMs, solver.rigidDepenMs);
  maxBakeMs = Math.max(maxBakeMs, solver.rigidBakeMs);
  maxBakedCells = Math.max(maxBakedCells, solver.rigidBakedCells);
  ticks.push({
    tick,
    wallMs,
    bodyMs: perf.bodyMs,
    terrainMs: solver.rigidTerrainContactMs,
    samples: solver.terrainSamples,
    samplesSkipped: solver.terrainSamplesSkipped,
    contacts: solver.contacts,
    substeps: solver.substeps,
    coreMs: solver.rigidCoreMs,
    depenMs: solver.rigidDepenMs,
    bakeMs: solver.rigidBakeMs,
    bakedCells: solver.rigidBakedCells,
    bakeSupportMs: solver.rigidBakeSupportMs,
    bakeRasterMs: solver.rigidBakeRasterMs,
    bakeRegisterMs: solver.rigidBakeRegisterMs,
    stampMs: solver.rigidStampMs,
    groundingMs: perf.groundingMs,
    crossLayerGroundingMs: perf.crossLayerGroundingMs,
    componentIndexMs: perf.componentIndexMs,
    layersMs: perf.layersMs,
    crossMs: perf.crossMs,
    foregroundBodies: engine._bodyCountLayer(0),
    backgroundBodies: engine._bodyCountLayer(1),
    jointLeader: findLeader() >= 0,
  });
}

const worstBodyTicks = [...ticks]
  .sort((a, b) => b.bodyMs - a.bodyMs).slice(0, 12);
const worstWallTicks = [...ticks]
  .sort((a, b) => b.wallMs - a.wallMs).slice(0, 12);
const bakeTicks = ticks.filter((tick) => tick.bakedCells > 0);
const result = {
  scene: 'large cross-layer rigid terrain landing',
  jointCells: initial?.nPts ?? 0,
  jointChildren,
  firstContact,
  maxBodyMs,
  maxTerrainMs,
  maxTerrainSamples,
  maxDepenMs,
  maxBakeMs,
  maxBakedCells,
  bakeTicks,
  worstBodyTicks,
  worstWallTicks,
};
console.log(JSON.stringify(result, null, 2));

if (firstContact < 0 || maxBakedCells < 40000
    || engine._bodyCountLayer(0) !== 0 || engine._bodyCountLayer(1) !== 0) {
  throw new Error('landing scene did not exercise a large joint-body bake');
}
if (bakeTicks.some((tick) => tick.bakeMs > MAX_BAKE_MS))
  throw new Error(`large joint-body bake exceeded ${MAX_BAKE_MS} ms`);

engine.destroy();
