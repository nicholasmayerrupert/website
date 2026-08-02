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
for (const powder of powders) e.paintDisc(powder.x, 10, 0, powder.id, true);
e.paintDisc(water.x, 10, 0, water.material, true);

const rowOf = (material, x) => {
  const grid = e.getGrid();
  for (let y = 0; y < ROWS; y++) if (grid[y * COLS + x] === material) return y;
  return -1;
};
for (let i = 0; i < 8; i++) {
  e.stepWorld();
  for (const sample of [...powders, water]) {
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
check('all loose cells remain conserved',
  powders.every((powder) => [...e.getGrid()].filter((m) => m === powder.id).length === 1)
    && [...e.getGrid()].filter((m) => m === water.material).length === 1);
check(`loose cells remain cellular materials (bodies ${e._bodyCount()})`,
  e._bodyCount() === 0);

e.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
