// Regression: a cross-layer-bonded rigid shell FILLED with a lighter powder/liquid
// must still fall. A stone ring mirrored in both layers and filled with sand bonds
// across layers (full overlap), so it is moved by moveCrossLayerBondedAssemblies,
// not the single-layer mover. That mover used to only descend into EMPTY cells, so
// the ring's own interior sand (sitting directly beneath its top arc) pinned it in
// the air forever ("sand supported by stone supporting that very stone"). The mover
// now shoves aside lighter contents like the single-layer translateAssembly does.
// Run: node scripts/xlayer-bonded-fall-test.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 30, ROWS = 36;
await initSandWasm();
const { check, done } = makeChecker('cross-layer bonded sand-filled shell falls');

const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
const cnt = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };
const lowestStone = (g) => { let lo = -1; for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === MAT.STONE) lo = Math.max(lo, y); return lo; };

// hollow stone box outline filled with sand, in `layer`
function ring(e, x0, y0, x1, y1, layer) {
  for (let x = x0; x <= x1; x++) { e.placeMaterial(x, y0, 0, MAT.STONE, layer); e.placeMaterial(x, y1, 0, MAT.STONE, layer); }
  for (let y = y0; y <= y1; y++) { e.placeMaterial(x0, y, 0, MAT.STONE, layer); e.placeMaterial(x1, y, 0, MAT.STONE, layer); }
  for (let y = y0 + 1; y <= y1 - 1; y++) for (let x = x0 + 1; x <= x1 - 1; x++) e.placeMaterial(x, y, 0, MAT.SAND, layer);
}

const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
e.setBgEnabled(true);
for (let x = 0; x < COLS; x++) { e.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 0); e.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 1); }
ring(e, 10, 6, 18, 12, 0);
ring(e, 10, 6, 18, 12, 1);
run(e, 2);

const fg0 = e.getGrid(), bg0 = e.getGridBg();
const s0 = { stone: cnt(fg0, MAT.STONE), sand: cnt(fg0, MAT.SAND), bgStone: cnt(bg0, MAT.STONE), bgSand: cnt(bg0, MAT.SAND) };
const start = lowestStone(fg0);
run(e, 400);
const fg1 = e.getGrid(), bg1 = e.getGridBg();
const end = lowestStone(fg1);

check(`fg ring fell toward the floor (lowest stone ${start} -> ${end}, floor ${ROWS - 1})`, end >= ROWS - 3);
check('bg ring fell in lockstep (layers byte-symmetric)', fg1.every((v, i) => v === bg1[i]));
check(`stone conserved (fg ${s0.stone} bg ${s0.bgStone})`, cnt(fg1, MAT.STONE) === s0.stone && cnt(bg1, MAT.STONE) === s0.bgStone);
check(`sand conserved (fg ${s0.sand} bg ${s0.bgSand})`, cnt(fg1, MAT.SAND) === s0.sand && cnt(bg1, MAT.SAND) === s0.bgSand);
e.destroy();

// A GROUNDED sand-filled ring (its base sits on the floor in both layers) must NOT
// spuriously sink — the displacement path only fires for ungrounded assemblies.
const e2 = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
e2.setBgEnabled(true);
for (let x = 0; x < COLS; x++) { e2.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 0); e2.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 1); }
ring(e2, 10, ROWS - 8, 18, ROWS - 2, 0); // bottom arc at ROWS-2, directly on the floor
ring(e2, 10, ROWS - 8, 18, ROWS - 2, 1);
run(e2, 202);
const g2 = e2.getGrid();
let topRow = ROWS;
for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS; x++) if (g2[y * COLS + x] === MAT.STONE) { topRow = Math.min(topRow, y); }
check(`grounded ring stays put (top stone row ${topRow} ~ ${ROWS - 8})`, topRow <= ROWS - 7);
e2.destroy();

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
