// A structure-scale irregular body must retain contact-generated spin while
// landing on rough terrain, without entering the terrain raster.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('large rigid rotation');

const cols = 420;
const rows = 330;
const floorY = 280;
const radius = 105;
const engine = attachTestHooks(createEngineWasmRaw({
  cols,
  rows,
  worldSeed: 0x726f6c6c,
  sinksOn: false,
  infinite: false,
}));

const grid = engine.getGrid();
for (let x = 0; x < cols; x++) {
  const wave = Math.round(3 * Math.sin((x + 24) * 0.105));
  const ledge = (x * 17 + 24 * 11) % 31 < 5 ? -3 : 0;
  const slope = Math.round((x - cols / 2) * 0.16);
  const top = floorY + wave + ledge + slope;
  for (let y = top; y < rows; y++) grid[y * cols + x] = MAT.STONE;
}
engine.syncComponents();

const cells = [];
for (let y = -radius; y <= radius; y++) {
  for (let x = -radius; x <= radius; x++) {
    const warped = x * x + y * y
      + 8 * x * Math.sin(y * 0.17)
      - 6 * y * Math.cos(x * 0.13);
    const bite = x > radius * 0.25 && y < -radius * 0.15
      && (x - radius * 0.25) ** 2 + (y + radius * 0.15) ** 2
        < (radius * 0.32) ** 2;
    if (warped <= radius * radius && !bite)
      cells.push([150 + x, 120 + y]);
  }
}
engine.spawnBody(cells);

const initial = engine._bodyState(0);
let last = initial;
let minAngle = initial.angle;
let maxAngle = initial.angle;
let firstContact = -1;
let maxBlocked = 0;
let maxRejected = 0;
let maxDepenetrations = 0;
for (let tick = 0; tick < 520; tick++) {
  engine.stepWorld();
  const state = engine._bodyState(0);
  if (!state) break;
  last = state;
  const solver = engine.getRigidSolverDebug();
  const rigid = engine.getRigidDebug();
  if (firstContact < 0 && solver.contacts > 0) firstContact = tick;
  minAngle = Math.min(minAngle, state.angle);
  maxAngle = Math.max(maxAngle, state.angle);
  maxBlocked = Math.max(maxBlocked, engine._bodyTerrainBlocked(0));
  maxRejected = Math.max(maxRejected, rigid.rejectedCells);
  maxDepenetrations = Math.max(maxDepenetrations, rigid.depenetrations);
}

const angleRange = maxAngle - minAngle;
check(`irregular body is structure scale (${initial.nPts} cells, `
    + `${initial.maxR.toFixed(1)} radius)`,
  initial.nPts >= 30000 && initial.maxR >= 100);
check(`irregular body reaches uneven terrain (tick ${firstContact})`,
  firstContact >= 0);
check(`contact torque produces a visible roll `
    + `(${angleRange.toFixed(3)} radians, `
    + `${Math.abs(last.px - initial.px).toFixed(1)} cells)`,
  angleRange >= 0.15 && Math.abs(last.px - initial.px) >= 15);
check(`rolling body never enters terrain `
    + `(${maxBlocked} blocked, ${maxRejected} rejected, `
    + `${maxDepenetrations} depenetrations)`,
  maxBlocked === 0 && maxRejected === 0 && maxDepenetrations === 0);
check('rolling body settles', engine._bodyAwake(0) === 0);

engine.destroy();
process.exitCode = done();
