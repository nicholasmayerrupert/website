// Acid enclosed by dissolvable material must remain active until it escapes,
// consumes its neighbours, or decays.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 40, ROWS = 60;
await initSandWasm();
const { check, done } = makeChecker('acid does not freeze inside solids');

const fresh = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
const run = (e, n, t0 = 0) => { let t = t0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } return t; };
const countMat = (e, mat) => { let n = 0; for (const v of e.getGrid()) if (v === mat) n++; return n; };
const isDissolvable = (m) => m === MAT.STONE || m === MAT.DEEPSTONE || m === MAT.SAND || m === MAT.DIRT;
// The freeze signature: an acid cell that is touching dissolvable material yet has
// gone inert (settled in its pit, open above, never eating the stone under/beside it).
// If acid stays active while it has a dissolvable neighbour it keeps boring until it
// punches through or decays — so after long settling there must be ZERO such cells.
// (Acid that pooled on a non-dissolvable floor with no dissolvable neighbour is a
// legitimate settled puddle, not a freeze, and is excluded.)
const frozenInSolid = (e) => {
  const g = e.getGrid(); let n = 0;
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    const k = y * COLS + x;
    if (g[k] !== MAT.ACID) continue;
    if (isDissolvable(g[k - 1]) || isDissolvable(g[k + 1]) || isDissolvable(g[k - COLS]) || isDissolvable(g[k + COLS])) n++;
  }
  return n;
};

// Pour acid onto solid strata and run long enough for every active cell to bore
// through or decay. An inert acid cell touching the stratum would persist.
const testStratum = (material, name) => {
  const e = fresh();
  for (let y = 20; y <= 50; y++) for (let x = 5; x <= 34; x++) e.placeMaterial(x, y, 0, material);
  const t = run(e, 3);
  const before = countMat(e, material);
  for (let x = 18; x <= 22; x++) e.placeMaterial(x, 18, 0, MAT.ACID);
  for (let x = 18; x <= 22; x++) e.placeMaterial(x, 17, 0, MAT.ACID);
  run(e, 800, t);
  const removed = before - countMat(e, material);
  const frozen = frozenInSolid(e);
  check(`acid dissolved into ${name} (removed ${removed} > 5)`, removed > 5);
  check(`no acid left frozen against ${name} (frozen=${frozen})`, frozen === 0);
  e.destroy();
};
testStratum(MAT.STONE, 'stone');
testStratum(MAT.DEEPSTONE, 'Deepstone');

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
