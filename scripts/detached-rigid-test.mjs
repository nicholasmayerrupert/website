// A component-backed solid remains static while connected to the world, becomes
// one material-preserving rigid body when cut free, then bakes back into static
// components after settling.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 100, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('detached solids become bodies and bake on rest');
const e = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});

const paintRect = (x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, material, true);
  }
};
const count = (material) => {
  let n = 0;
  for (const value of e.getGrid()) if (value === material) n++;
  return n;
};

paintRect(0, ROWS - 2, COLS - 1, ROWS - 1, MAT.STONE);
paintRect(8, 20, 12, ROWS - 3, MAT.STONE);
paintRect(35, 80, 39, ROWS - 3, MAT.STONE);
paintRect(10, 20, 50, 22, MAT.BRICK);
paintRect(40, 10, 52, 19, MAT.IRON_ORE);
e.syncComponents();
e.stepWorld();
check(`structure connected to the floor stays static (bodies ${e._bodyCount()})`,
  e._bodyCount() === 0);

for (let y = 5; y <= 28; y++) e.paintDisc(30, y, 0, MAT.EMPTY, true);
e.syncComponents();
const expectedBrick = count(MAT.BRICK);
const expectedOre = count(MAT.IRON_ORE);
const detachedBrick = 20 * 3;
const detachedOre = 13 * 10;
e.stepWorld();

const spawned = e._bodyState(0);
check(`cut-off mixed solid becomes one body (bodies ${e._bodyCount()})`,
  e._bodyCount() === 1);
check(`body contains both detached materials (${spawned?.nPts ?? 0} cells)`,
  spawned?.nPts === detachedBrick + detachedOre);
check('body begins accelerating downward', !!spawned && spawned.vy > 0);
check('materials are preserved while airborne',
  count(MAT.BRICK) === expectedBrick && count(MAT.IRON_ORE) === expectedOre);

let bakedAt = -1;
let maxAngle = Math.abs(spawned?.angle ?? 0);
for (let i = 0; i < 1000; i++) {
  e.stepWorld();
  const state = e._bodyState(0);
  if (!state) {
    bakedAt = i;
    break;
  }
  maxAngle = Math.max(maxAngle, Math.abs(state.angle));
}

check(`detached solid rotates on the offset ledge (max angle ${maxAngle.toFixed(2)} rad)`,
  maxAngle > 0.2);
check(`settled body bakes back into static components (step ${bakedAt})`,
  bakedAt >= 0 && e._bodyCount() === 0);
const bakedBrick = count(MAT.BRICK);
const bakedOre = count(MAT.IRON_ORE);
check(`baking preserves both materials (${bakedBrick}/${expectedBrick} brick, ${bakedOre}/${expectedOre} ore)`,
  Math.abs(bakedBrick - expectedBrick) <= 4 && Math.abs(bakedOre - expectedOre) <= 4);

for (let i = 0; i < 30; i++) e.stepWorld();
check(`baked solid remains static (bodies ${e._bodyCount()})`, e._bodyCount() === 0);
e.destroy();

const naturallyLoose = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});
for (let y = 10; y <= 13; y++) {
  for (let x = 45; x <= 48; x++) naturallyLoose.paintDisc(x, y, 0, MAT.STONE, true);
}
naturallyLoose.syncComponents();
naturallyLoose.stepWorld();
let naturalTop = ROWS;
for (let k = 0; k < naturallyLoose.getGrid().length; k++) {
  if (naturallyLoose.getGrid()[k] === MAT.STONE) naturalTop = Math.min(naturalTop, Math.floor(k / COLS));
}
check(`naturally unsupported solid keeps component motion (top ${naturalTop}, bodies ${naturallyLoose._bodyCount()})`,
  naturalTop > 10 && naturallyLoose._bodyCount() === 0);
naturallyLoose.destroy();

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
