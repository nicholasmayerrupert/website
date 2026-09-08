// Rigid displacement preserves liquid volume and uses the pool surface
// without pumping liquid onto a dry body top.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const createEngineWasm = (options) => attachTestHooks(createEngineWasmRaw(options));

const COLS = 320, ROWS = 320;
const LEFT = 20, RIGHT = 299, TOP = 5, FLOOR = 300, SURFACE = 20;

await initSandWasm();
const { check, done } = makeChecker('rigid displacement conservation');
const engine = createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x5350494c,
  sinksOn: false,
  infinite: false,
});

for (let y = TOP; y <= FLOOR; y++) {
  engine.paintDisc(LEFT, y, 0, MAT.STONE, true);
  engine.paintDisc(RIGHT, y, 0, MAT.STONE, true);
}
for (let x = LEFT; x <= RIGHT; x++) {
  engine.paintDisc(x, TOP, 0, MAT.STONE, true);
  engine.paintDisc(x, FLOOR, 0, MAT.STONE, true);
}
engine.syncComponents();
for (let y = SURFACE; y < FLOOR; y++)
  for (let x = LEFT + 1; x < RIGHT; x++)
    engine.paintDisc(x, y, 0, MAT.WATER, true);

const countWater = () => {
  let count = 0;
  for (const material of engine.getGrid()) if (material === MAT.WATER) count++;
  return count;
};
const before = countWater();
const spillBefore = engine.getRigidSolverDebug();
engine.spawnBox(160, SURFACE + 45, 2, 2, MAT.RIGID);
const after = countWater();
const spillAfter = engine.getRigidSolverDebug();
const displaced = spillAfter.spillDisplaced - spillBefore.spillDisplaced;
const searches = spillAfter.spillSearches - spillBefore.spillSearches;
const visits = spillAfter.spillVisits - spillBefore.spillVisits;
check(`deep body insertion conserves all displaced water (${before} -> ${after})`,
  after === before);
check('deep insertion relocated every displaced raster cell',
  displaced === 16 && searches === 1);
check(`spill search stopped after finding 16 destinations (${visits} visits)`,
  visits > 0 && visits < 10_000);

engine.destroy();
for (const [name, material] of [['acid', MAT.ACID], ['water', MAT.WATER]]) {
  const cols = 320, rows = 200;
  const pool = createEngineWasm({
    cols, rows, worldSeed: 0xac1d, sinksOn: false, infinite: false,
  });
  pool.setBgEnabled(false);
  const rect = (x0, y0, x1, y1, mat) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) pool.paintDisc(x, y, 0, mat, true);
  };
  rect(0, 196, 319, 199, MAT.STONE);
  rect(0, 70, 3, 195, MAT.STONE);
  rect(316, 70, 319, 195, MAT.STONE);
  pool.syncComponents();
  rect(4, 100, 315, 195, material);
  pool.spawnBox(160, 90, 100, 8, MAT.RIGID);
  pool._setBodyMotion(0, 0, 2, 0);

  let maxOnTop = 0, displacedCells = 0, dryTopTicks = 0;
  for (let tick = 0; tick < 20; tick++) {
    pool.stepWorld();
    displacedCells += pool.getRigidSolverDebug().spillDisplaced;
    const grid = pool.getGrid(), owners = pool._bodyOwnerGrid();
    let top = rows, surface = rows;
    for (let y = 0; y < rows; y++)
      for (let x = 121; x < 200; x++)
        if (owners[y * cols + x] >= 0) top = Math.min(top, y);
    for (let y = 0; y < rows; y++)
      for (let x = 4; x < 316; x++)
        if ((x < 40 || x > 280) && grid[y * cols + x] === material)
          surface = Math.min(surface, y);
    if (top < surface) dryTopTicks++;
    // The rising pool may cover the slab; reject liquid above both its top
    // and the exterior surface, where it cannot have flowed over the edge.
    let onTop = 0;
    for (let y = 0; y < Math.min(top, surface); y++)
      for (let x = 121; x < 200; x++)
        if (grid[y * cols + x] === material) onTop++;
    maxOnTop = Math.max(maxOnTop, onTop);
  }
  check(`${name} pool was displaced by the falling slab (${displacedCells} cells)`,
    displacedCells > 0 && dryTopTicks > 1);
  check(`${name} does not jump onto the slab above the pool (${maxOnTop} cells)`, maxOnTop === 0);
  if (material === MAT.WATER) {
    let remaining = 0;
    for (const mat of pool.getGrid()) if (mat === material) remaining++;
    check(`wide slab conserves water (${remaining} cells)`, remaining === 312 * 96);
  }
  pool.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
