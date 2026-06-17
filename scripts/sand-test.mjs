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
  // Marker uses ICE (12) — a material the generator never produces — so the count
  // reflects only this edit, not generated terrain (the revamp seeds oil/water/
  // lava pockets underground).
  const ICE = 12;
  for (let y = 30; y < 46; y++) for (let x = 20; x < 40; x++) e.paintDisc(x, y, 0, ICE, true); // ice marker
  const before = counts(e.getGrid())[ICE];
  e.shiftWorld(128);
  const offEdge = counts(e.getGrid())[ICE];
  e.shiftWorld(-128);
  const after = counts(e.getGrid())[ICE];
  check(`edit marker saved (${before}) and restored (${after})`, before > 0 && offEdge === 0 && after === before);
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

// 8. tool/pointer state machine: paint-while-held, throttle, RMB erase, stone
//    draft+finalize, cube spawn, seed placement — all policy owned by the engine.
{
  console.log('tools / pointer');
  const e = mk(); // empty (non-infinite) world: paint targets start EMPTY
  const T = { cube: 0, sand: 1, water: 2, stone: 3, oil: 4, fire: 5, acid: 6, lava: 7, ice: 8, seed: 9, driftwood: 10, eraser: 11 };
  let t = 0; const tk = () => (t += 20); // > EMIT_INTERVAL_MS (18) so each apply emits

  // water: paints only while LMB held
  e.setTool(T.water);
  e.pointerDown(50, 30, 0);
  e.applyTool(50, 30, tk(), true, true);
  e.applyTool(50, 30, tk(), true, true);
  const water = counts(e.getGrid())[2];
  e.pointerButtons(0); e.pointerUp(0);
  const afterUp = counts(e.getGrid())[2];
  e.applyTool(70, 30, tk(), true, true); // LMB up -> must not paint
  check(`water tool paints while held (${water})`, water > 0);
  check('no paint after release', counts(e.getGrid())[2] === afterUp);

  // RMB places the selected material into the BACKGROUND layer (fg untouched)
  e.pointerDown(50, 30, 2);
  e.applyTool(50, 30, tk(), true, true);
  e.pointerButtons(0); e.pointerUp(2);
  check(`RMB placed water in the background (${counts(e.getGridBg())[2]})`, counts(e.getGridBg())[2] > 0);
  check('RMB left the foreground water intact', counts(e.getGrid())[2] === afterUp);

  // stone: hold to draft, release to finalize into stone cells
  e.setTool(T.stone);
  e.pointerDown(100, 30, 0);
  for (let i = 0; i < 6; i++) e.pointerDraft(100 + i, 30);
  const draftN = e.getStoneDraftCells().length;
  e.pointerUp(0);
  const stone = counts(e.getGrid())[3];
  check(`stone draft -> finalize (draft ${draftN}, stone ${stone})`, draftN > 0 && stone > 0);

  // cube: spawns one rigid body on press
  e.setTool(T.cube);
  const b0 = e._bodyCount();
  e.pointerDown(150, 18, 0);
  check(`cube spawns a body (${b0} -> ${e._bodyCount()})`, e._bodyCount() === b0 + 1);

  // seed: draft origin on press, placed on release
  e.setTool(T.seed);
  e.pointerDown(40, 18, 0);
  const hasOrigin = !!e.getSeedDraft();
  e.pointerUp(0);
  check(`seed placed (origin ${hasOrigin}, seeds ${counts(e.getGrid())[7]})`, hasOrigin && counts(e.getGrid())[7] > 0);
  e.destroy();
}

// 9. a sleeping body must wake and fall when the ground beneath it is removed.
{
  console.log('wake on support removal');
  const e = mk({ infinite: false });
  const bodyBottom = (g) => { let b = -1; for (let i = 0; i < g.length; i++) if (g[i] === 13) { const y = (i / COLS) | 0; if (y > b) b = y; } return b; };
  // GROUNDED stone block (reaches the floor, so it doesn't fall) + a box on top.
  for (let x = 80; x < 120; x++) for (let y = 60; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.spawnBox(100, 54, 4, 4);
  run(400, e); // settle on the block and fall asleep
  const asleep = e._bodyAwake(0) === 0;
  const restY = bodyBottom(e.getGrid());
  check(`body came to rest and slept (bottom ${restY}, asleep ${asleep})`, asleep && restY >= 55 && restY < 65);
  // dig a deep pit directly beneath the body (leaves the body's own cells alone)
  for (let x = 90; x < 110; x++) for (let y = restY + 1; y < restY + 28; y++) e.eraseDisc(x, y, 0);
  run(120, e);
  const fellY = bodyBottom(e.getGrid());
  check(`body woke and fell into the pit (${restY} -> ${fellY})`, fellY > restY + 18);
  e.destroy();
}

// Flat / contained liquid SETTLES to inert instead of shimmering forever, and
// re-wakes + flows when the basin is breached. Without the settle fix, step()
// would stay active every frame (the open surface re-marks itself dirty), so this
// both proves the fix and guards the multiplayer-churn regression it prevents.
{
  console.log('liquid settles flat (no shimmer) + re-wakes on breach');
  const e = mk();
  // grounded basin: two full-height walls + a one-row floor slab spanning them,
  // with an EMPTY chamber beneath so a floor breach lets the water drain downward.
  for (let y = 80; y < ROWS; y++) { e.paintDisc(80, y, 0, 3, true); e.paintDisc(120, y, 0, 3, true); }
  for (let x = 81; x <= 119; x++) e.paintDisc(x, 100, 0, 3, true); // floor slab at y=100
  e.syncComponents();
  // pour water as an uneven column on the LEFT -> it must flow right and level out
  // before it can settle (exercises the dynamic settle, not just a pre-flat body).
  for (let x = 81; x <= 95; x++) for (let y = 82; y <= 99; y++) e.paintDisc(x, y, 0, 2, true);
  let t = 0, settledAt = -1;
  for (let i = 0; i < 1200; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`uneven water flows, levels, and settles to inert (step ${settledAt})`, settledAt > 1 && settledAt < 1200);
  const waterBelow = () => { const g = e.getGrid(); let n = 0; for (let y = 101; y < ROWS; y++) for (let x = 81; x <= 119; x++) if (g[y * COLS + x] === 2) n++; return n; };
  check(`water stayed above the floor while contained (${waterBelow()})`, waterBelow() === 0);
  e.eraseDisc(100, 100, 2); // breach the floor slab
  let woke = false; for (let i = 0; i < 4; i++) { t += 16; if (e.step(t)) woke = true; }
  check('settled water re-wakes when the floor is breached', woke);
  for (let i = 0; i < 400; i++) { t += 16; e.step(t); }
  check(`water drained into the chamber below (${waterBelow()} cells)`, waterBelow() > 20);
  e.destroy();
}

// Oil dropped onto a water pool on ONE SIDE must spread, separate, level to a flat
// oil/water boundary, and SETTLE — not freeze as a mound and not shimmer forever.
// Guards the liquid levelling/coalescence behaviour (the "drop oil into water" case).
{
  console.log('oil on water levels to a flat boundary + settles');
  const OIL = 4;
  const e = mk();
  const L = 70, R = 110, floorY = 100, top = 40; // grounded stone basin
  for (let y = top; y <= floorY; y++) { e.paintDisc(L, y, 0, 3, true); e.paintDisc(R, y, 0, 3, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, 3, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = floorY - 18; y < floorY; y++) e.paintDisc(x, y, 0, 2, true); // water
  let t = 0; for (let i = 0; i < 400; i++) { t += 16; if (!e.step(t)) break; }
  for (let x = L + 1; x <= L + 8; x++) for (let y = floorY - 30; y < floorY - 18; y++) e.paintDisc(x, y, 0, OIL, true); // oil on the left
  let settledAt = -1; for (let i = 0; i < 6000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`oil/water scene settles to inert (step ${settledAt})`, settledAt >= 0);
  // measure flatness: per column, the bottom-most oil row (the oil/water boundary)
  const g = e.getGrid(); let bots = [], oilN = 0;
  for (let x = L + 1; x < R; x++) { let b = -1; for (let y = top; y <= floorY; y++) if (g[y * COLS + x] === OIL) { b = y; oilN++; } if (b >= 0) bots.push(b); }
  const spread = bots.length ? Math.max(...bots) - Math.min(...bots) : -1;
  check(`oil spread across the surface and separated (${oilN} cells, ${bots.length} cols)`, bots.length > 25);
  check(`oil/water boundary is flat (spread ${spread})`, spread >= 0 && spread <= 1);
  e.destroy();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
