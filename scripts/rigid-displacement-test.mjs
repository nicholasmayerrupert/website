// A deeply submerged rigid raster must continue its spill search past the
// normal visit budget rather than dropping displaced liquid volume.

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
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
