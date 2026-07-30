// Loose powders and liquids accumulate fall speed instead of moving at a fixed
// per-tick rate. Material-specific terminal speed still limits liquids.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 64, ROWS = 100, SEED = 0xC0FFEE;
await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('loose-material fall acceleration');
const e = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});

const sandX = 20, waterX = 40;
e.paintDisc(sandX, 10, 0, MAT.SAND, true);
e.paintDisc(waterX, 10, 0, MAT.WATER, true);

const rowOf = (material, x) => {
  const grid = e.getGrid();
  for (let y = 0; y < ROWS; y++) if (grid[y * COLS + x] === material) return y;
  return -1;
};
const sand = { rows: [], speeds: [] };
const water = { rows: [], speeds: [] };
for (let i = 0; i < 8; i++) {
  e.stepWorld();
  for (const [material, x, sample] of [
    [MAT.SAND, sandX, sand],
    [MAT.WATER, waterX, water],
  ]) {
    const y = rowOf(material, x);
    sample.rows.push(y);
    sample.speeds.push(y >= 0 ? e._fallSpeedGrid()[y * COLS + x] : -1);
  }
}
const deltas = (rows) => rows.map((y, i) => y - (i ? rows[i - 1] : 10));
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

check(`sand accelerates to water's terminal speed (${deltas(sand.rows).join(', ')})`,
  same(deltas(sand.rows), [1, 2, 3, 3, 3, 3, 3, 3]));
check(`sand speed remains capped (${sand.speeds.join(', ')})`,
  same(sand.speeds, [1, 2, 3, 3, 3, 3, 3, 3]));
check(`water accelerates to its terminal speed (${deltas(water.rows).join(', ')})`,
  same(deltas(water.rows), [1, 2, 3, 3, 3, 3, 3, 3]));
check(`water speed remains capped (${water.speeds.join(', ')})`,
  same(water.speeds, [1, 2, 3, 3, 3, 3, 3, 3]));
check('both loose cells remain conserved',
  [...e.getGrid()].filter((m) => m === MAT.SAND).length === 1
    && [...e.getGrid()].filter((m) => m === MAT.WATER).length === 1);
check(`loose cells remain cellular materials (bodies ${e._bodyCount()})`,
  e._bodyCount() === 0);

e.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
