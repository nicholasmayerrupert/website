// Tests for the two-layer engine (foreground + background) and the cross-layer
// powder/liquid transfer. Runs headless in Node. Run with:
//   node scripts/layer-test.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/engineWasm.js';
import { countMaterials } from './sand-test-util.mjs';

await initSandWasm();

const COLS = 60, ROWS = 80;
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, infinite: false, sinksOn: false });
const k = (x, y) => y * COLS + x;
const step = (e, n, dt = 16) => { let t = 0; for (let i = 0; i < n; i++) { t += dt; e.step(t); } };
const countIn = (grid, mat) => { let c = 0; for (let i = 0; i < grid.length; i++) if (grid[i] === mat) c++; return c; };

let failures = 0;
const check = (label, ok, extra = '') => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); };

// A GROUNDED static stone block (a component touching the bottom, so it doesn't
// fall like an ungrounded assembly) filling [cx-hw,cx+hw] x [fy, ROWS-1] in
// `layer` (0=fg, 1=bg). Its top row at `fy` is the floor.
const stoneFloor = (e, layer, cx, fy, hw) => {
  for (let x = cx - hw; x <= cx + hw; x++) for (let y = fy; y < ROWS; y++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(layer);
};

// 1. The background settles independently (transfer off, so it stays isolated).
{
  console.log('background settles independently');
  const e = mk();
  e.paintDiscLayer(1, 30, 8, 2, MAT.SAND, true); // sand disc high up in the BACKGROUND
  e.setBgEnabled(false);                          // isolate the bg: no cross-layer transfer
  const before = countIn(e.getGridBg(), MAT.SAND);
  step(e, 120);
  const bg = e.getGridBg(), fg = e.getGrid();
  let lowest = 0; for (let i = 0; i < bg.length; i++) if (bg[i] === MAT.SAND) lowest = Math.max(lowest, (i / COLS) | 0);
  check('bg sand conserved', countIn(bg, MAT.SAND) === before, `(${before})`);
  check('bg sand fell to the bottom', lowest >= ROWS - 4, `(lowest row ${lowest})`);
  check('foreground stayed empty', countMaterials(fg).slice(1).every((c) => c === 0));
}

// 2. A stuck foreground powder transfers into an empty background below it.
{
  console.log('transfer: stuck fg powder -> bg');
  const e = mk();
  stoneFloor(e, 0, 30, 50, 2);     // fg static stone floor at y=50
  e.setBgEnabled(true);            // background empty but active
  e.paintDisc(30, 49, 0, MAT.SAND, true); // a single grain boxed on the floor
  check('grain starts in fg', e.getGrid()[k(30, 49)] === MAT.SAND);
  step(e, 1);
  check('grain left the foreground', e.getGrid()[k(30, 49)] === MAT.EMPTY);
  check('grain appeared in the background', e.getGridBg()[k(30, 49)] === MAT.SAND);
}

// 3. No transfer when the background cannot accept it (can't keep falling there).
{
  console.log('transfer: rests when boxed in both layers');
  const e = mk();
  stoneFloor(e, 0, 30, 50, 2);              // fg floor
  stoneFloor(e, 1, 30, 50, 2);              // bg floor directly below in the bg
  e.paintDisc(30, 49, 0, MAT.SAND, true);   // fg grain boxed
  step(e, 3);
  check('grain stays in the foreground (bg below blocked)', e.getGrid()[k(30, 49)] === MAT.SAND);
  check('nothing transferred to the bg target cell', e.getGridBg()[k(30, 49)] === MAT.EMPTY);
}

// 4. No oscillation + conservation: once transferred, the grain falls in the bg
//    and never bounces back to the foreground.
{
  console.log('transfer: no oscillation, material conserved');
  const e = mk();
  stoneFloor(e, 0, 30, 50, 2);
  e.setBgEnabled(true);
  e.paintDisc(30, 49, 0, MAT.SAND, true);
  let bouncedBack = 0; const totals = new Set();
  for (let s = 0; s < 40; s++) {
    step(e, 1);
    const fgN = countIn(e.getGrid(), MAT.SAND), bgN = countIn(e.getGridBg(), MAT.SAND);
    if (s > 1 && fgN > 0) bouncedBack++; // after the first transfer the grain should be bg-only
    totals.add(fgN + bgN);
  }
  check('grain never bounced back to fg', bouncedBack === 0);
  check('exactly one grain conserved across both layers', totals.size === 1 && totals.has(1), `(totals ${[...totals]})`);
}

// 5. The background fully simulates components (a bg stone floor persists).
{
  console.log('background components persist');
  const e = mk();
  e.paintDiscLayer(1, 30, 60, 3, MAT.STONE, true);
  e.syncComponentsLayer(1);
  const before = countIn(e.getGridBg(), MAT.STONE);
  step(e, 20);
  const after = countIn(e.getGridBg(), MAT.STONE);
  check('bg stone component did not flicker/erase', after === before && before > 0, `(${before} -> ${after})`);
}

// 6. Both layers replicate: full snapshot + diff round-trip between two engines.
{
  console.log('two-layer serialize / diff round-trip');
  const a = mk(), b = mk();
  // seed both layers of A with distinct content
  stoneFloor(a, 0, 20, 60, 4);
  a.paintDisc(20, 40, 3, MAT.WATER, true);
  a.paintDiscLayer(1, 40, 30, 3, MAT.SAND, true);
  a.paintDiscLayer(1, 40, 60, 4, MAT.STONE, true); a.syncComponentsLayer(1);
  // full snapshot -> apply into B
  b.applyWorld(a.serializeWorld());
  check('full snapshot: hashes match', a.gridHash() === b.gridHash(), `(${a.gridHash()} vs ${b.gridHash()})`);
  check('full snapshot: bg grids equal', a.getGridBg().every((v, i) => v === b.getGridBg()[i]));
  // diff round-trip after edits to BOTH layers
  a.resetDirty();
  a.paintDisc(30, 70, 2, MAT.OIL, true);          // fg edit
  a.paintDiscLayer(1, 15, 20, 2, MAT.WATER, true); // bg edit
  b.applyDiff(a.serializeDiff());
  check('diff: hashes match after fg+bg edits', a.gridHash() === b.gridHash(), `(${a.gridHash()} vs ${b.gridHash()})`);
}

// 7. RMB paints into the background; LMB into the foreground.
{
  console.log('RMB -> background, LMB -> foreground');
  const T_SAND = 1, T_WATER = 2;
  const rmb = mk();
  rmb.setTool(T_WATER);
  rmb.pointerDown(30, 30, 2);                 // right mouse button down
  rmb.applyTool(30, 30, 1000, true, true);    // inside, draw mode
  check('RMB placed water in the background', countIn(rmb.getGridBg(), MAT.WATER) > 0);
  check('RMB left the foreground empty', countMaterials(rmb.getGrid()).slice(1).every((c) => c === 0));

  const lmb = mk();
  lmb.setTool(T_SAND);
  lmb.pointerDown(30, 30, 0);                 // left mouse button down
  lmb.applyTool(30, 30, 1000, true, true);
  check('LMB placed sand in the foreground', countIn(lmb.getGrid(), MAT.SAND) > 0);
  check('LMB left the background empty', countMaterials(lmb.getGridBg()).slice(1).every((c) => c === 0));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
