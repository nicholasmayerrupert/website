// Focused methane benchmark: a very large connected cloud must flash in one
// bounded step instead of paying one blast per gas cell.
import { performance } from 'node:perf_hooks';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 512, ROWS = 256, REPEATS = 7;
await initSandWasm();

const hashGrid = (grid) => {
  let h = 2166136261 >>> 0;
  for (const v of grid) { h ^= v; h = Math.imul(h, 16777619) >>> 0; }
  return `0x${h.toString(16).padStart(8, '0')}`;
};
const count = (grid, mat) => { let n = 0; for (const v of grid) if (v === mat) n++; return n; };
const times = [], hashes = new Set();
let initial = 0, remaining = 0, visible = 0;
for (let run = 0; run < REPEATS; run++) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0xC0FFEE, sinksOn: false, infinite: false });
  for (let y = 70; y < 190; y++) for (let x = 80; x < 432; x++) e.placeMaterial(x, y, 0, MAT.METHANE);
  e.placeMaterial(79, 130, 0, MAT.FIRE);
  initial = count(e.getGrid(), MAT.METHANE);
  const t0 = performance.now(); e.step(0); times.push(performance.now() - t0);
  const grid = e.getGrid(); remaining = count(grid, MAT.METHANE);
  visible = count(grid, MAT.FIRE) + count(grid, MAT.ACRID_SMOKE);
  hashes.add(hashGrid(grid));
  e.destroy();
}
times.sort((a, b) => a - b);
const p50 = times[Math.floor(times.length * 0.50)], p95 = times[Math.floor(times.length * 0.95)];
console.log(`methane benchmark (${REPEATS} repeats; ${COLS}x${ROWS})`);
console.log(`  cloud ${initial} -> ${remaining}, visible aftermath ${visible}`);
console.log(`  ignition step p50 ${p50.toFixed(3)}  p95 ${p95.toFixed(3)}  max ${times.at(-1).toFixed(3)} ms`);
console.log(`  hash ${[...hashes].join(',')}${hashes.size === 1 ? '' : ' UNSTABLE'}`);
if (remaining !== 0 || hashes.size !== 1) process.exit(1);
