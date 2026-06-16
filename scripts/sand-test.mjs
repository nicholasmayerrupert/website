// Headless smoke test for the WebAssembly sand engine. Run with:
//   node scripts/sand-test.mjs
// Covers the core behaviours: material conservation, rigid components, reactions,
// plant growth, free rigid bodies, and edits persisting across a world shift.

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

const COLS = 200, ROWS = 120, SEED = 0xC0FFEE;
const counts = (g) => { const c = new Array(16).fill(0); for (let i = 0; i < g.length; i++) c[g[i]]++; return c; };
const rigidCells = (g) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === 13) n++; return n; };

await initSandWasm();
const mk = (opts = {}) => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, ...opts });

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const run = (steps, e) => { let t = 0; for (let i = 0; i < steps; i++) { t += 16; e.step(t); } };

// 1. sand + water are only moved, never created or destroyed.
{
  console.log('conservation');
  const e = mk();
  for (let i = 0; i < 40; i++) e.paintDisc(40 + (i % 20), 10 + ((i * 7) % 15), 4, 1, false);
  for (let i = 0; i < 40; i++) e.paintDisc(100 + (i % 20), 10 + ((i * 5) % 15), 4, 2, false);
  const before = counts(e.getGrid());
  run(300, e);
  const after = counts(e.getGrid());
  check(`sand conserved (${before[1]})`, before[1] === after[1] && before[1] > 0);
  check(`water conserved (${before[2]})`, before[2] === after[2] && before[2] > 0);
  e.destroy();
}

// 2. a floating stone block falls as one piece and lands.
{
  console.log('rigid components');
  const e = mk();
  for (let y = 20; y < 28; y++) for (let x = 70; x < 82; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  const before = counts(e.getGrid());
  run(250, e);
  const g = e.getGrid();
  let maxY = 0; for (let i = 0; i < g.length; i++) if (g[i] === 3) maxY = Math.max(maxY, (i / COLS) | 0);
  check(`stone conserved (${before[3]})`, counts(g)[3] === before[3] && before[3] > 0);
  check(`stone fell to the floor (row ${maxY})`, maxY >= ROWS - 3);
  e.destroy();
}

// 3. fire next to water makes steam.
{
  console.log('reactions');
  const e = mk();
  for (let y = 70; y <= 80; y++) for (let x = 70; x <= 90; x++) e.paintDisc(x, y, 0, 2, false);
  let peak = 0, t = 0;
  for (let s = 0; s < 60; s++) {
    if (s % 6 === 0) for (let x = 70; x <= 90; x++) e.paintDisc(x, 69, 0, 5, false);
    t += 16; e.step(t);
    const g = e.getGrid(); let st = 0; for (let i = 0; i < g.length; i++) if (g[i] === 6) st++;
    peak = Math.max(peak, st);
  }
  check(`steam produced (peak ${peak})`, peak > 0);
  e.destroy();
}

// 4. a watered seed grows.
{
  console.log('growth');
  const e = mk();
  for (let x = 60; x < 100; x++) for (let y = 80; y < 82; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeSeedAt(78, 78);
  let t = 0;
  for (let s = 0; s < 400; s++) { if (s % 40 === 0) e.paintDisc(80, 77, 2, 2, false); t += 16; e.step(t); }
  const c = counts(e.getGrid());
  check(`plant material grew (${c[7] + c[8] + c[9]})`, c[7] + c[8] + c[9] > 0);
  e.destroy();
}

// 5. a dropped cube settles on terrain without disintegrating or clipping.
{
  console.log('free rigid body');
  const e = mk({ infinite: true });
  const surf = e.worldSurfaceAt(0);
  e.spawnBox(COLS / 2, surf - 20, 5, 5); // 10x10 box, built engine-side
  run(260, e);
  const n = rigidCells(e.getGrid());
  check(`cube intact and resting (${n} cells)`, n >= 90 && n <= 100);
  e.destroy();
}

// 6. an edited band survives scrolling off the edge and back.
{
  console.log('work-saving across world shift');
  const e = mk({ infinite: true });
  for (let y = 30; y < 46; y++) for (let x = 20; x < 40; x++) e.paintDisc(x, y, 0, 4, true); // oil marker
  const before = counts(e.getGrid())[4];
  e.shiftWorld(128);
  const offEdge = counts(e.getGrid())[4];
  e.shiftWorld(-128);
  const after = counts(e.getGrid())[4];
  check(`oil marker saved (${before}) and restored (${after})`, before > 0 && offEdge === 0 && after === before);
  e.destroy();
}

// 7. erasing through a (rotated) rigid body splits it into two simulated halves
//    rather than shattering / losing a half.
{
  console.log('rigid body split');
  const e = mk({ infinite: false });
  // sloped stone floor so the cube rests rotated (the case that regressed).
  for (let x = 5; x < COLS - 5; x++) { const top = 50 + ((x - 5) >> 1); for (let y = top; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0); }
  e.finalizeStoneDraft();
  const body = []; for (let dx = -8; dx < 8; dx++) for (let dy = 0; dy < 12; dy++) body.push([100 + dx, 10 + dy]);
  e.spawnBody(body);
  run(400, e); // settle on the slope (body comes to rest rotated)
  const g0 = e.getGrid(); let t = 1e9, b = -1, l = 1e9, r = 0;
  for (let i = 0; i < g0.length; i++) if (g0[i] === 13) { const y = (i / COLS) | 0, x = i % COLS; if (y < t) t = y; if (y > b) b = y; if (x < l) l = x; if (x > r) r = x; }
  // the rotated body must rasterize without holes (192-cell cube -> ~full count)
  check(`rotated body renders solid (${rigidCells(g0)}/192 cells)`, rigidCells(g0) > 160);
  const midX = (l + r) >> 1;
  for (let y = t - 1; y <= b + 1; y += 2) e.eraseDisc(midX, y, 2); // vertical eraser swipe
  run(50, e);
  const g = e.getGrid(); let left = 0, right = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === 13) ((i % COLS) < midX ? left++ : right++);
  check(`both halves survive the cut (L${left} R${right}, ${e._bodyCount()} bodies)`, e._bodyCount() >= 2 && left > 12 && right > 12);
  e.destroy();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
