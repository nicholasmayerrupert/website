// Loose powders and liquids accumulate fall speed instead of moving at a fixed
// per-tick rate. Powders share one cap; material-specific density still limits
// liquids.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { KIND, MATERIALS, MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 96, ROWS = 100, SEED = 0xC0FFEE;
await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('loose-material fall acceleration');
const e = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});

const powders = MATERIALS.filter((material) => material.kind === KIND.POWDER)
  .map((material, index) => ({ ...material, x: 8 + index * 9, rows: [], speeds: [] }));
const water = { material: MAT.WATER, x: COLS - 8, rows: [], speeds: [] };
const lava = { material: MAT.LAVA, x: COLS - 16, rows: [], speeds: [] };
for (const powder of powders) e.paintDisc(powder.x, 10, 0, powder.id, true);
e.paintDisc(water.x, 10, 0, water.material, true);
e.paintDisc(lava.x, 10, 0, lava.material, true);

const rowOf = (material, x) => {
  const grid = e.getGrid();
  for (let y = 0; y < ROWS; y++) if (grid[y * COLS + x] === material) return y;
  return -1;
};
for (let i = 0; i < 8; i++) {
  e.stepWorld();
  for (const sample of [...powders, water, lava]) {
    const material = sample.id ?? sample.material;
    const y = rowOf(material, sample.x);
    sample.rows.push(y);
    sample.speeds.push(y >= 0 ? e._fallSpeedGrid()[y * COLS + sample.x] : -1);
  }
}
const deltas = (rows) => rows.map((y, i) => y - (i ? rows[i - 1] : 10));
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const cappedDeltas = [1, 2, 3, 3, 3, 3, 3, 3];

for (const powder of powders) {
  check(`${powder.name.toLowerCase()} accelerates to the shared powder cap (${deltas(powder.rows).join(', ')})`,
    same(deltas(powder.rows), cappedDeltas));
  check(`${powder.name.toLowerCase()} speed remains capped (${powder.speeds.join(', ')})`,
    same(powder.speeds, cappedDeltas));
}
check(`water accelerates to its terminal speed (${deltas(water.rows).join(', ')})`,
  same(deltas(water.rows), cappedDeltas));
check(`water speed remains capped (${water.speeds.join(', ')})`,
  same(water.speeds, cappedDeltas));
check(`lava matches ordinary fluid fall acceleration despite its viscosity (${deltas(lava.rows).join(', ')})`,
  same(deltas(lava.rows), cappedDeltas));
check(`lava speed matches the ordinary fluid terminal cap (${lava.speeds.join(', ')})`,
  same(lava.speeds, cappedDeltas));
check('all loose cells remain conserved',
  powders.every((powder) => [...e.getGrid()].filter((m) => m === powder.id).length === 1)
    && [...e.getGrid()].filter((m) => m === water.material).length === 1
    && [...e.getGrid()].filter((m) => m === lava.material).length === 1);
check(`loose cells remain cellular materials (bodies ${e._bodyCount()})`,
  e._bodyCount() === 0);

e.destroy();

{
  const cols = 256, rows = 256;
  const streamed = createEngineWasm({
    cols, rows, worldSeed: 3, sinksOn: false, infinite: true,
  });
  streamed.setBgEnabled(false);
  const x = 48;
  for (let y = 16; y <= 40; y++) streamed.paintDisc(x, y, 0, MAT.EMPTY, true);
  streamed.paintDisc(x, 18, 0, MAT.SAND, true);
  for (let tick = 0; tick < 3; tick++) streamed.stepWorld();
  const grid = streamed.getGrid();
  let sandCell = -1;
  for (let y = 16; y <= 40; y++) if (grid[y * cols + x] === MAT.SAND) sandCell = y * cols + x;
  const speedBefore = sandCell >= 0 ? streamed._fallSpeedGrid()[sandCell] : -1;
  const waterX = 60, waterY = 50, waterCell = waterY * cols + waterX;
  streamed.paintDisc(waterX, waterY, 0, MAT.WATER, true);
  streamed._setLiquidVelocity(0, waterX, waterY, 0.375, -0.25);
  const velocityBefore = streamed._liquidVelocityGrid()[waterCell];
  streamed.shiftWorldXY(128, 0);
  streamed.shiftWorldXY(-128, 0);
  const speedAfter = sandCell >= 0 ? streamed._fallSpeedGrid()[sandCell] : -1;
  const velocityAfter = streamed._liquidVelocityGrid()[waterCell];
  check(`streamed loose material retains fall speed (${speedBefore} -> ${speedAfter})`,
    speedBefore > 0 && speedAfter === speedBefore);
  check(`streamed liquid retains packed velocity (${velocityBefore} -> ${velocityAfter})`,
    velocityBefore !== 0 && velocityAfter === velocityBefore);
  streamed._setMotionSentinel(0, sandCell, 0x13572468);
  streamed.paintDisc(x, Math.floor(sandCell / cols), 0, MAT.SAND, true);
  check('repainting a powder clears every registered state phase',
    streamed._motionCellZero(0, sandCell));
  streamed._setMotionSentinel(0, waterCell, 0x24681357);
  streamed.paintDisc(waterX, waterY, 0, MAT.WATER, true);
  check('repainting a liquid clears every registered state phase',
    streamed._motionCellZero(0, waterCell));
  streamed.destroy();
}

const viscosity = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});
for (let x = 0; x < COLS; x++)
  for (let y = 90; y < ROWS; y++)
    viscosity.paintDisc(x, y, 0, MAT.STONE, true);
viscosity.syncComponents();
for (let x = 18; x <= 20; x++) for (let y = 78; y < 90; y++)
  viscosity.paintDisc(x, y, 0, MAT.WATER, true);
for (let x = 70; x <= 72; x++) for (let y = 78; y < 90; y++)
  viscosity.paintDisc(x, y, 0, MAT.LAVA, true);
for (let tick = 0; tick < 4; tick++) viscosity.stepWorld();
const horizontalSpan = (material) => {
  let minX = COLS, maxX = -1;
  const grid = viscosity.getGrid();
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== material) continue;
    const x = k % COLS;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return maxX - minX + 1;
};
const waterSpan = horizontalSpan(MAT.WATER);
const lavaSpan = horizontalSpan(MAT.LAVA);
check(`lava remains more viscous laterally than water (${lavaSpan} < ${waterSpan})`,
  lavaSpan < waterSpan);
viscosity.destroy();

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
