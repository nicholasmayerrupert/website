// Exercises a falling rigid tub carrying a large water volume and many buoyant
// bodies. Reports the pressure-domain size and iteration budget beside timing.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';

const createEngineWasm = (options) =>
  attachTestHooks(createEngineWasmRaw(options));
const COLS = 240;
const ROWS = 220;
const STEPS = 120;
const WINDOW = 20;

const percentile = (values, fraction) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(
    ordered.length - 1,
    Math.floor(ordered.length * fraction),
  )] ?? 0;
};

await initSandWasm();
const engine = createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x7ab5,
  sinksOn: false,
  infinite: false,
});
engine.setBgEnabled(false);

const paintRect = (x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};

paintRect(0, 212, COLS - 1, ROWS - 1, MAT.STONE);
engine.syncComponents();

const tub = [];
for (let y = 54; y <= 144; y++) {
  for (let x = 46; x <= 194; x++) {
    if (y >= 139 || x <= 51 || x >= 189) tub.push([x, y]);
  }
}
engine.spawnBody(tub);
paintRect(52, 72, 188, 138, MAT.WATER);
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 6; col++)
    engine.spawnBox(72 + col * 20, 67 + row * 19, 6, 4, MAT.WOOD);
}

let bodyMs = [];
let stepMs = [];
let maxNodes = 0;
let maxFaces = 0;
let maxIterations = 0;
let maxSpillVisits = 0;
let correctors = 0;
console.log('ticks       tub y    body p50/p95   step p50/p95   nodes/faces/iters spill/corr');
for (let tick = 0; tick < STEPS; tick++) {
  engine.stepWorld();
  const phases = engine.getStepPerf();
  const rigid = engine.getRigidSolverDebug();
  bodyMs.push(phases.bodyMs ?? 0);
  stepMs.push(engine.getPerf().stepMs);
  maxNodes = Math.max(maxNodes, rigid.fluidNodes);
  maxFaces = Math.max(maxFaces, rigid.fluidFaces);
  maxIterations = Math.max(maxIterations, rigid.fluidIterations);
  maxSpillVisits = Math.max(maxSpillVisits, rigid.spillVisits);
  correctors += rigid.fluidCorrectorPasses;
  if ((tick + 1) % WINDOW !== 0) continue;

  const body = engine._bodyState(0);
  console.log(
    `${String(`${tick + 2 - WINDOW}-${tick + 1}`).padEnd(11)}`
    + `${(body?.py.toFixed(1) ?? 'gone').padStart(7)}`
    + `${percentile(bodyMs, 0.5).toFixed(2).padStart(8)}`
    + `/${percentile(bodyMs, 0.95).toFixed(2).padEnd(7)}`
    + `${percentile(stepMs, 0.5).toFixed(2).padStart(8)}`
    + `/${percentile(stepMs, 0.95).toFixed(2).padEnd(7)}`
    + `${String(maxNodes).padStart(7)}/${maxFaces}/${maxIterations}`
    + ` ${maxSpillVisits}/${correctors}`,
  );
  bodyMs = [];
  stepMs = [];
  maxNodes = 0;
  maxFaces = 0;
  maxIterations = 0;
  maxSpillVisits = 0;
  correctors = 0;
}

engine.destroy();
