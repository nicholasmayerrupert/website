// Headless smoke test for the WebAssembly sand engine. Run with:
//   node scripts/sand-test.mjs
// Covers the core behaviours: material conservation, rigid components, reactions,
// plant growth, free rigid bodies, and edits persisting across a world shift.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
// Every engine in this file gets the test hooks (grounding/body/particle pokes).
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
import { MAT } from '../src/sand/materials.js';

const COLS = 200, ROWS = 120, SEED = 0xC0FFEE;
const counts = (g) => { const c = new Array(64).fill(0); for (let i = 0; i < g.length; i++) c[g[i]]++; return c; };
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

// 2b. In the infinite world, a rigid structure touching the streamed buffer edge is
//     treated as supported — its real floor-contact may have streamed off the buffer —
//     so it does NOT spuriously fall, while an identical structure in open space still
//     falls. Regression for: a block dropped when the chunk holding its support unloaded.
{
  console.log('edge-supported components (infinite)');
  const e = mk({ infinite: true });
  const EDGE_X0 = 1, EDGE_X1 = 13;   // leftmost column x=1 touches the streamed edge
  const FREE_X0 = 40, FREE_X1 = 52;  // open space, touches no edge
  // Place both blocks in empty sky, comfortably above the generated surface (see #5).
  const surf = Math.min(e.worldSurfaceAt(EDGE_X0), e.worldSurfaceAt(FREE_X1));
  const Y0 = Math.max(2, surf - 30), Y1 = Y0 + 8;
  for (let y = Y0; y < Y1; y++) for (let x = EDGE_X0; x < EDGE_X1; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let y = Y0; y < Y1; y++) for (let x = FREE_X0; x < FREE_X1; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  const topRowIn = (g, x0, x1) => { let m = ROWS; for (let i = 0; i < g.length; i++) { if (g[i] !== 3) continue; const x = i % COLS, y = (i / COLS) | 0; if (x >= x0 && x < x1 && y < m) m = y; } return m; };
  const skyStoneIn = (g, x0, x1) => {
    let n = 0;
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== MAT.STONE) continue;
      const x = i % COLS, y = (i / COLS) | 0;
      if (x >= x0 && x < x1 && y < e.worldSurfaceAt(x) - 1) n++;
    }
    return n;
  };
  const edgeBefore = skyStoneIn(e.getGrid(), EDGE_X0, EDGE_X1);
  run(200, e);
  const g = e.getGrid();
  const edgeTop = topRowIn(g, EDGE_X0, EDGE_X1), freeTop = topRowIn(g, FREE_X0, FREE_X1);
  const edgeAfter = skyStoneIn(g, EDGE_X0, EDGE_X1);
  check(`edge-supported block conserved (${edgeAfter}/${edgeBefore})`, edgeAfter === edgeBefore && edgeBefore > 0);
  check(`edge-touching block stayed up (top row ${edgeTop} ~ ${Y0})`, edgeTop <= Y0 + 1);
  check(`free block fell (top row ${freeTop} > ${Y0 + 8})`, freeTop > Y0 + 8);
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

// 3b. acid dissolving stone emits acrid smoke (a yellow gas) that rises and
//     dissipates like steam, and keeps its own identity (never turns into steam).
{
  console.log('acid dissolving emits acrid smoke');
  const STONE = 3, ACID = 10, STEAM = 6, ACRID = 31;
  const e = mk();
  for (let y = 50; y < 90; y++) for (let x = 60; x < 120; x++) e.paintDisc(x, y, 0, STONE, true);
  e.syncComponents();
  for (let y = 46; y < 50; y++) for (let x = 60; x < 120; x++) e.paintDisc(x, y, 0, ACID, true);
  const count = (mat) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === mat) n++; return n; };
  const topMost = (mat) => { const g = e.getGrid(); for (let i = 0; i < g.length; i++) if (g[i] === mat) return (i / COLS) | 0; return -1; };
  let t = 0, peakSmoke = 0, anySteam = 0;
  for (let s = 0; s < 150; s++) { t += 16; e.step(t); peakSmoke = Math.max(peakSmoke, count(ACRID)); anySteam = Math.max(anySteam, count(STEAM)); }
  const rose = topMost(ACRID);
  check(`acid dissolving produced acrid smoke (peak ${peakSmoke})`, peakSmoke > 0);
  check(`acrid smoke rose above the acid layer (top row ${rose} < 46)`, rose >= 0 && rose < 46);
  check(`acrid smoke never became steam (steam ${anySteam})`, anySteam === 0);
  for (let s = 0; s < 500; s++) { t += 16; e.step(t); }
  check(`acrid smoke dissipates over time (${count(ACRID)} <= 3)`, count(ACRID) <= 3);
  e.destroy();
}

// 3c. Acrid smoke that is boxed in (can't vent) dissolves quickly instead of
//     churning up through fluid forever — a trapped cloud keeps the layer active,
//     and an active layer pays a full grounding reflood every step, so a long-lived
//     trapped cloud is pure cost. A sealed pocket of acrid must clear fast.
{
  console.log('trapped acrid smoke dissolves quickly');
  const STONE = 3, ACRID = 31;
  const e = mk();
  const x0 = 60, x1 = 100, y0 = 50, y1 = 80;
  for (let y = y0 - 3; y <= y1 + 3; y++) for (let d = 1; d <= 3; d++) { e.paintDisc(x0 - d, y, 0, STONE, true); e.paintDisc(x1 + d, y, 0, STONE, true); }
  for (let x = x0 - 3; x <= x1 + 3; x++) for (let d = 1; d <= 3; d++) { e.paintDisc(x, y0 - d, 0, STONE, true); e.paintDisc(x, y1 + d, 0, STONE, true); }
  e.syncComponents();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, ACRID, true);
  const count = (mat) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === mat) n++; return n; };
  const start = count(ACRID);
  let t = 0; for (let s = 0; s < 80; s++) { t += 16; e.step(t); }
  const after = count(ACRID);
  check(`sealed acrid pocket mostly dissolved in 80 steps (${after} < ${Math.round(start * 0.1)} of ${start})`, after < start * 0.1);
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

// 4b. magic mycelium grows through stone from a spore, then goes inert.
{
  console.log('magic mycelium');
  const e = mk();
  for (let y = 42; y <= 88; y++) for (let x = 54; x <= 124; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.paintDisc(88, 66, 0, MAT.MYCELIUM_SPORE, true);
  e.syncComponents();
  const start = counts(e.getGrid());
  run(900, e);
  const mid = counts(e.getGrid());
  const grown = (mid[MAT.MYCELIUM] || 0) + (mid[MAT.MYCELIUM_SPORE] || 0);
  check(`mycelium converted nearby stone (${grown} cells)`, grown > 20);
  check(`mycelium consumed stone locally (${start[MAT.STONE]} -> ${mid[MAT.STONE]})`, mid[MAT.STONE] < start[MAT.STONE] - 20);
  run(1800, e);
  const after = counts(e.getGrid());
  const finalGrid = e.getGrid();
  const finalGrown = (after[MAT.MYCELIUM] || 0) + (after[MAT.MYCELIUM_SPORE] || 0);
  let myc = 0, neighbourSum = 0, denseCells = 0;
  const isMyc = (v) => v === MAT.MYCELIUM || v === MAT.MYCELIUM_SPORE;
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    if (!isMyc(finalGrid[y * COLS + x])) continue;
    myc++;
    let n = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      if (isMyc(finalGrid[(y + oy) * COLS + x + ox])) n++;
    }
    neighbourSum += n;
    if (n >= 4) denseCells++;
  }
  const avgNeighbours = myc ? neighbourSum / myc : 0;
  check(`mycelium remains bounded (${finalGrown} cells)`, finalGrown <= 190);
  check(`mycelium grows as sparse tendrils (avg neighbours ${avgNeighbours.toFixed(2)}, dense ${denseCells})`, avgNeighbours < 2.5 && denseCells <= 2);
  check(`mycelium spore remains as colony core (${after[MAT.MYCELIUM_SPORE] || 0})`, (after[MAT.MYCELIUM_SPORE] || 0) === 1);
  e.destroy();
}

// 4c. a spore placed in open air can fall first, then activate once it contacts stone.
{
  console.log('falling mycelium spore activates on stone contact');
  const e = mk();
  for (let y = 94; y <= 96; y++) for (let x = 70; x <= 110; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeMaterial(90, 20, 0, MAT.MYCELIUM_SPORE);
  run(900, e);
  const c = counts(e.getGrid());
  const grown = (c[MAT.MYCELIUM] || 0) + (c[MAT.MYCELIUM_SPORE] || 0);
  check(`falling spore infected stone after landing (${grown} cells)`, grown > 1);
  check(`falling spore remained as one colony core (${c[MAT.MYCELIUM_SPORE] || 0})`, (c[MAT.MYCELIUM_SPORE] || 0) === 1);
  e.destroy();
}

// 4d. diagonal contact is enough for a spore to infect stone.
{
  console.log('mycelium spore infects diagonal stone');
  const e = mk();
  e.paintDisc(82, 82, 0, MAT.STONE, true);
  e.paintDisc(81, 81, 0, MAT.MYCELIUM_SPORE, true);
  e.syncComponents();
  run(400, e);
  const c = counts(e.getGrid());
  check(`diagonal spore converted the diagonal stone (${c[MAT.MYCELIUM] || 0})`, (c[MAT.MYCELIUM] || 0) >= 1);
  check(`diagonal spore remained as one colony core (${c[MAT.MYCELIUM_SPORE] || 0})`, (c[MAT.MYCELIUM_SPORE] || 0) === 1);
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
  // The cube lands on sloped natural terrain and rolls a quarter turn before it
  // settles, so it comes to rest ROTATED; a rotated 100-cell raster covers a few
  // cells more or fewer than the axis-aligned 100. The check is "intact" (no
  // disintegration well below 100, no terrain clipping that swallows cells), not
  // "still axis-aligned" — so allow the rotated-raster spread.
  check(`cube intact and resting (${n} cells)`, n >= 90 && n <= 104);
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

// 8b. Creative held eraser must stay pinned through world shifts. The stroke
//     stores buffer-space cells; when the loaded window slides, the previous emit
//     point must slide too or the next emit sweeps a long line across new chunks.
{
  console.log('creative eraser across world shifts');
  const T = { eraser: 11 };
  const stoneAt = (e, x, y) => e.getGrid()[y * COLS + x] === 3;

  {
    const e = mk({ infinite: true });
    let t = 0;
    e.setTool(T.eraser);
    e.pointerDown(50, 40, 0);
    e.applyTool(50, 40, t += 20, true, true);
    e.shiftWorldXY(-128, 0);
    e.eraseDisc(110, 40, 3);
    e.addDiscToStoneDraft(110, 40, 0);
    e.finalizeStoneDraft();
    e.applyTool(178, 40, t += 20, true, true);
    check('horizontal shift does not erase between stale and remapped cursor', stoneAt(e, 110, 40));
    e.pointerButtons(0); e.pointerUp(0);
    e.destroy();
  }

  {
    const e = mk({ infinite: true });
    let t = 0;
    e.setTool(T.eraser);
    e.pointerDown(50, 10, 0);
    e.applyTool(50, 10, t += 20, true, true);
    e.shiftWorldXY(0, -96);
    e.eraseDisc(50, 58, 3);
    e.addDiscToStoneDraft(50, 58, 0);
    e.finalizeStoneDraft();
    e.applyTool(50, 106, t += 20, true, true);
    check('vertical shift does not erase between stale and remapped cursor', stoneAt(e, 50, 58));
    e.pointerButtons(0); e.pointerUp(0);
    e.destroy();
  }
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

// The INVERSE, and the harder case: WATER (denser) dropped into an OIL pool must SINK
// through the oil, level into a FLAT layer BELOW it (flat interface), and SETTLE — not
// freeze as a pile/mound under the oil. Guards the two-fluid density-levelling fix
// (lateral density spread + lighter-liquid rise).
{
  console.log('water dropped into oil sinks, levels flat below it + settles');
  const OIL = 4, WATER = 2;
  const e = mk();
  // grounded basin: walls reach the world bottom (ROWS) so the registered stone doesn't
  // fall; a floor slab partway up holds the liquid.
  const L = 70, R = 110, floorY = 100, top = 45;
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, 3, true); e.paintDisc(R, y, 0, 3, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, 3, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = floorY - 22; y < floorY; y++) e.paintDisc(x, y, 0, OIL, true); // oil pool
  let t = 0; for (let i = 0; i < 500; i++) { t += 16; if (!e.step(t)) break; }
  const cnt = (m) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
  const oil0 = cnt(OIL);
  for (let x = L + 1; x <= L + 10; x++) for (let y = floorY - 34; y < floorY - 22; y++) e.paintDisc(x, y, 0, WATER, true); // water blob on the left, above the oil
  const water0 = cnt(WATER);
  let settledAt = -1; for (let i = 0; i < 8000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`water/oil scene settles to inert (step ${settledAt})`, settledAt >= 0);
  check(`oil + water conserved (${oil0}/${water0})`, cnt(OIL) === oil0 && cnt(WATER) === water0 && oil0 > 0 && water0 > 0);
  const g = e.getGrid();
  // per interior column: top-most water row (the interface), and water must be BELOW oil
  let wTop = [], inverted = 0;
  for (let x = L + 1; x < R; x++) {
    let wt = -1, maxW = -1, maxO = -1;
    for (let y = top; y <= floorY; y++) { const v = g[y * COLS + x]; if (v === WATER) { if (wt < 0) wt = y; maxW = y; } if (v === OIL) maxO = y; }
    if (wt >= 0) wTop.push(wt);
    if (maxW >= 0 && maxO >= 0 && maxO >= maxW) inverted++; // any oil at/below the water in this column = not separated
  }
  const spread = wTop.length ? Math.max(...wTop) - Math.min(...wTop) : -1;
  check(`water settled as a layer below the oil (no inversion, ${inverted})`, inverted === 0 && wTop.length > 25);
  check(`water/oil interface is flat (water-top spread ${spread})`, spread >= 0 && spread <= 2);
  e.destroy();
}

// A wide single fluid's TOP (fluid-against-air) surface must flatten too, not just
// the fluid/fluid interface: a one-sided dump used to settle as a crooked ramp
// (~1px per MAX_WATER_FLOW cells) because local moves across a 1px step are
// energy-neutral and go inert. levelLiquidSurfaces now detects connected lower
// surface to a side, but only moves one cell sideways per pass so the body flows
// locally, ends nearly level, and then goes inert.
{
  console.log('wide single-fluid top surface flattens + settles');
  const WATER = 2;
  const e = mk();
  const L = 18, R = 182, floorY = 100, top = 30;
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, 3, true); e.paintDisc(R, y, 0, 3, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, 3, true);
  e.syncComponents();
  // one-sided dump: a tall water block on the left quarter only
  for (let x = L + 1; x <= L + 48; x++) for (let y = floorY - 52; y < floorY; y++) e.paintDisc(x, y, 0, WATER, true);
  const cntW = () => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === WATER) n++; return n; };
  const water0 = cntW();
  let t = 0, settledAt = -1; for (let i = 0; i < 9000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`single-fluid scene settles to inert (step ${settledAt})`, settledAt >= 0);
  check(`water conserved (${water0})`, cntW() === water0 && water0 > 0);
  const g = e.getGrid();
  let tops = [];
  for (let x = L + 1; x < R; x++) { for (let y = top; y <= floorY; y++) { if (g[y * COLS + x] === WATER) { tops.push(y); break; } } }
  const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : -1;
  // pre-fix this body settled with a ~5-9px ramp; the leveller brings it to <=3px.
  check(`wide top surface is near-flat (spread ${spread}px over ${tops.length} cols)`, spread >= 0 && spread <= 3 && tops.length > 100);
  e.destroy();
}

// The surface leveller must NOT touch water that is still falling/flowing — only a
// RESTING crooked surface. Regression guard for the bug where it teleported active
// water sideways (a narrow falling column ballooned wide mid-air; spawned water shot
// across to the lowest point "too fast"). A column dropped into open air must stay
// narrow as it falls.
{
  console.log('falling water stays narrow (leveller ignores moving water)');
  const WATER = 2;
  const e = mk();
  const L = 10, R = 90, floorY = 110;
  for (let y = 6; y < ROWS; y++) { e.paintDisc(L, y, 0, 3, true); e.paintDisc(R, y, 0, 3, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, 3, true);
  e.syncComponents();
  for (let x = 48; x <= 51; x++) for (let y = 10; y < 26; y++) e.paintDisc(x, y, 0, WATER, true); // 4-wide column up high
  // Sample while the column is still mid-air. Liquids now fall density-scaled (water
  // ~3 cells/tick), so 12 steps lands the leading edge well above the floor — enough
  // ticks to exercise the leveller, few enough that the water is still falling.
  let t = 0; for (let i = 0; i < 12; i++) { t += 16; e.step(t); }
  const g = e.getGrid();
  let minX = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === WATER) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const w = maxX - minX + 1;
  check(`column still falling (bottom y ${maxY} < floor ${floorY})`, maxY < floorY - 10);
  // natural fall spreads a 4-wide column to ~19-21px here; the cascade bug flung it to
  // ~34+ (and growing). 27 sits clearly between -> catches the regression, allows RNG.
  check(`falling column stayed narrow (width ${w}, not flung sideways)`, w <= 27);
  e.destroy();
}

// Water is denser than snow, so a pressured water column dropped through a snow cap
// must push the snow aside/up and settle as a flat layer below it. Pre-fix, the
// water formed a tall center mound under the snow and then went inert.
{
  console.log('water through snow levels instead of pyramiding');
  const WATER = 2, SNOW = 16, STONE = 3;
  const e = mk();
  const L = 35, R = 85, floorY = 78, top = 18;
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = floorY - 14; y < floorY; y++) e.paintDisc(x, y, 0, WATER, true);
  for (let x = L + 1; x < R; x++) for (let y = floorY - 23; y < floorY - 14; y++) e.paintDisc(x, y, 0, SNOW, true);
  for (let x = 58; x <= 62; x++) for (let y = floorY - 38; y < floorY - 23; y++) e.paintDisc(x, y, 0, WATER, true);
  const cnt = (m) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
  const water0 = cnt(WATER), snow0 = cnt(SNOW);
  let t = 0, settledAt = -1;
  for (let i = 0; i < 7000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`snow/water scene settles to inert (step ${settledAt})`, settledAt >= 0);
  check(`water + snow conserved (${water0}/${snow0})`, cnt(WATER) === water0 && cnt(SNOW) === snow0 && water0 > 0 && snow0 > 0);
  const g = e.getGrid(); const tops = [];
  for (let x = L + 1; x < R; x++) {
    for (let y = top; y <= floorY; y++) { if (g[y * COLS + x] === WATER) { tops.push(y); break; } }
  }
  const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : -1;
  check(`water under snow is near-flat (top spread ${spread}px over ${tops.length} cols)`, tops.length > 35 && spread >= 0 && spread <= 2);
  e.destroy();
}

// Dense component solids should sink through lighter loose powders instead of being
// grounded by them. Stone (2.6) must pass through snow (0.4), conserving both.
{
  console.log('stone component sinks through snow');
  const STONE = 3, SNOW = 16;
  const e = mk();
  for (let x = 25; x < 95; x++) for (let y = 65; y < ROWS; y++) e.paintDisc(x, y, 0, SNOW, true);
  for (let y = 40; y < 48; y++) for (let x = 56; x < 64; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  const cnt = (m) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
  const stone0 = cnt(STONE), snow0 = cnt(SNOW);
  run(700, e);
  const g = e.getGrid(); let minY = ROWS, maxY = -1;
  for (let i = 0; i < g.length; i++) if (g[i] === STONE) { const y = (i / COLS) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  check(`stone + snow conserved (${stone0}/${snow0})`, cnt(STONE) === stone0 && cnt(SNOW) === snow0 && stone0 > 0 && snow0 > 0);
  check(`stone sank through the snow bed (rows ${minY}-${maxY})`, maxY >= ROWS - 3 && minY > 65);
  e.destroy();
}

// A light rigid component in grains should settle without upward bobbing. Powders
// can support it by cancelling gravity, but they must not push it upward.
{
  console.log('light solid component settles in sand without bobbing');
  const SAND = 1, MOSS = 20; // MOSS is a rigid stone-group component, density 0.9 < sand 1.6
  const e = mk();
  for (let x = 25; x < 95; x++) for (let y = 65; y < ROWS; y++) e.paintDisc(x, y, 0, SAND, true);
  for (let y = 40; y < 48; y++) for (let x = 56; x < 64; x++) e.paintDisc(x, y, 0, MOSS, true);
  e.syncComponents();
  const bbox = () => {
    const g = e.getGrid(); let minY = ROWS, maxY = -1, n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] === MOSS) { const y = (i / COLS) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; n++; }
    return { minY, maxY, n };
  };
  run(500, e);
  const a = bbox();
  run(500, e);
  const b = bbox();
  check(`light solid settled at the sand bed (rows ${b.minY}-${b.maxY})`, b.n === 64 && b.minY > 55 && b.maxY < ROWS - 20);
  check(`light solid did not rise in sand (rows ${a.minY}-${a.maxY} -> ${b.minY}-${b.maxY})`, b.minY >= a.minY && b.maxY >= a.maxY);
  e.destroy();
}

// Liquid falling onto the TOP of a light component must not count as buoyant
// immersion. Only side/bottom wetted area can lift an ungrounded solid.
{
  console.log('top-only liquid contact does not lift a light solid');
  const SAND = 1, WATER = 2, MOSS = 20;
  const e = mk();
  for (let x = 25; x < 95; x++) for (let y = 65; y < ROWS; y++) e.paintDisc(x, y, 0, SAND, true);
  for (let y = 40; y < 48; y++) for (let x = 56; x < 64; x++) e.paintDisc(x, y, 0, MOSS, true);
  e.syncComponents();
  const bbox = () => {
    const g = e.getGrid(); let minY = ROWS, maxY = -1, n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] === MOSS) { const y = (i / COLS) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; n++; }
    return { minY, maxY, n };
  };
  run(500, e);
  const settled = bbox();
  for (let x = 56; x < 64; x++) for (let y = 38; y < settled.minY; y++) e.paintDisc(x, y, 0, WATER, true);
  run(120, e);
  const after = bbox();
  check(`top water did not lift moss (rows ${settled.minY}-${settled.maxY} -> ${after.minY}-${after.maxY})`, after.n === settled.n && after.minY >= settled.minY && after.maxY >= settled.maxY);
  e.destroy();
}

// Ice density sits between oil and brine. It should find a buoyant row between
// them without entering a deterministic one-cell up/down cycle while the two
// liquids are still leveling.
{
  console.log('ice settles stably between oil and brine');
  const STONE = 3, OIL = 4, ICE = 12, BRINE = 33;
  const e = mk();
  const L = 24, R = 176, top = 20, floorY = 104;
  for (let y = top; y <= floorY + 2; y++) { e.paintDisc(L - 2, y, 0, STONE, true); e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); e.paintDisc(R + 2, y, 0, STONE, true); }
  for (let x = L - 2; x <= R + 2; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = floorY - 48; y < floorY; y++) e.paintDisc(x, y, 0, BRINE, true);
  run(30, e);
  e.addDiscToIceDraft(100, floorY - 46, 7);
  e.finalizeIceDraft();
  for (let x = L + 3; x <= L + 72; x++) for (let y = floorY - 78; y < floorY - 49; y++) e.paintDisc(x, y, 0, OIL, true);
  const iceCy = () => {
    const g = e.getGrid(); let n = 0, sy = 0;
    for (let i = 0; i < g.length; i++) if (g[i] === ICE) { n++; sy += (i / COLS) | 0; }
    return n ? sy / n : null;
  };
  const ys = [];
  for (let i = 0; i < 360; i++) { e.step(16 * (i + 1)); const y = iceCy(); if (y !== null) ys.push(y); }
  let reversals = 0, lastDir = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = Math.sign(ys[i] - ys[i - 1]);
    if (d && lastDir && d !== lastDir) reversals++;
    if (d) lastDir = d;
  }
  check(`ice stayed present in the oil/brine interface (${ys.length} samples)`, ys.length > 300);
  check(`ice did not jitter vertically while liquids leveled (${reversals} reversals)`, reversals === 0);
  e.destroy();
}

// Dense component solids should keep sinking through an oil-over-brine interface.
// The anti-jitter hold used for buoyant ice must not pin dense components at the
// boundary between two liquids.
{
  console.log('stone sinks through oil over brine');
  const STONE = 3, OIL = 4, BRINE = 33, BRICK = 25;
  const e = mk();
  const L = 45, R = 155, top = 35, floorY = 108;
  for (let y = top; y <= floorY; y++) { e.paintDisc(L, y, 0, BRICK, true); e.paintDisc(R, y, 0, BRICK, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, BRICK, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = 62; y <= 74; y++) e.paintDisc(x, y, 0, OIL, true);
  for (let x = L + 1; x < R; x++) for (let y = 75; y < floorY; y++) e.paintDisc(x, y, 0, BRINE, true);
  for (let y = 50; y <= 55; y++) for (let x = 98; x <= 102; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  const bounds = () => {
    const g = e.getGrid(); let n = 0, minY = ROWS, maxY = -1;
    for (let i = 0; i < g.length; i++) if (g[i] === STONE) { const y = (i / COLS) | 0; n++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { n, minY, maxY };
  };
  run(180, e);
  const b = bounds();
  check(`stone crossed the oil/brine interface and sank into brine (rows ${b.minY}-${b.maxY})`, b.n === 30 && b.minY > 75);
  e.destroy();
}

// Touching static components use true mass-average density. A small stone load on
// a larger ice raft should not, by itself, force the whole raft downward.
{
  console.log('mass-average stone/ice assembly does not use densest-member sinking');
  const STONE = 3, ICE = 12, BRINE = 33, BRICK = 25;
  const e = mk();
  const L = 35, R = 165, top = 28, floorY = 105;
  for (let y = top; y <= floorY + 2; y++) { e.paintDisc(L, y, 0, BRICK, true); e.paintDisc(R, y, 0, BRICK, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, BRICK, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = floorY - 42; y < floorY; y++) e.paintDisc(x, y, 0, BRINE, true);
  run(40, e);
  e.addDiscToIceDraft(100, floorY - 43, 8);
  e.finalizeIceDraft();
  run(240, e);
  const matBounds = (mat) => {
    const g = e.getGrid(); let n = 0, minY = ROWS, maxY = -1;
    for (let i = 0; i < g.length; i++) if (g[i] === mat) { const y = (i / COLS) | 0; n++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { n, minY, maxY };
  };
  const iceBefore = matBounds(ICE);
  for (let y = iceBefore.minY - 3; y <= iceBefore.minY - 1; y++) for (let x = 99; x <= 101; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  run(180, e);
  const stone = matBounds(STONE), ice = matBounds(ICE);
  check(`small stone load did not force the ice raft to the floor (stone rows ${stone.minY}-${stone.maxY}, ice was ${iceBefore.minY}-${iceBefore.maxY})`,
    stone.n === 9 && stone.maxY < ice.minY && ice.maxY <= iceBefore.maxY + 12);
  check(`ice remained present while overloaded (ice rows ${ice.minY}-${ice.maxY})`, ice.n === iceBefore.n);
  e.destroy();
}

// A rigid component displacing brine under oil should push the brine into the
// nearest lighter liquid cell first. The displaced oil then rises to the surface.
// This prevents dense brine from being teleported straight to the air surface.
{
  console.log('component displacement chains dense liquid through lighter liquid');
  const STONE = 3, OIL = 4, BRINE = 33, GOLD_ORE = 24;
  const e = mk();
  const L = 50, R = 150, top = 45, floorY = 100;
  for (let y = top; y <= floorY; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = 60; y <= 69; y++) e.paintDisc(x, y, 0, OIL, true);
  for (let x = L + 1; x < R; x++) for (let y = 70; y <= 95; y++) e.paintDisc(x, y, 0, BRINE, true);
  for (let x = 94; x <= 106; x++) for (let y = 60; y <= 69; y++) e.paintDisc(x, y, 0, GOLD_ORE, true);
  e.syncComponents();
  const bounds = (mat) => {
    const g = e.getGrid(); let n = 0, minY = ROWS, maxY = -1;
    for (let i = 0; i < g.length; i++) if (g[i] === mat) { const y = (i / COLS) | 0; n++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { n, minY, maxY };
  };
  const oil0 = bounds(OIL).n, brine0 = bounds(BRINE).n;
  e.step(16);
  const oil = bounds(OIL), brine = bounds(BRINE);
  check(`oil and brine conserved during component displacement (${oil.n}/${brine.n})`, oil.n === oil0 && brine.n === brine0);
  check(`brine entered the oil layer but not the air surface (top ${brine.minY}, oil top ${oil.minY})`, brine.minY >= oil.minY + 6 && brine.minY < 70);
  e.destroy();
}

// Free rigid bodies use their material density in liquids. In powders, support is
// one-way: dense bodies can keep sinking, while lighter bodies settle without being
// pushed upward.
{
  console.log('free rigid bodies settle in powders without rising');
  const STONE = 3, SNOW = 16, SAND = 1, LAVA = 11, RIGID = 13, GOLD_ORE = 24;
  // Bodies stamp their REAL material into the grid now, so track each body by the
  // material it was spawned with (use one distinct from the terrain to stay unambiguous).
  const bodyBottom = (g, mat) => { let b = -1; for (let i = 0; i < g.length; i++) if (g[i] === mat) b = Math.max(b, (i / COLS) | 0); return b; };
  const bodyCount = (g, mat) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === mat) n++; return n; };
  {
    const e = mk();
    for (let x = 25; x < 95; x++) for (let y = 65; y < ROWS; y++) e.paintDisc(x, y, 0, SNOW, true);
    for (let x = 25; x < 95; x++) e.paintDisc(x, ROWS - 1, 0, STONE, true);
    e.syncComponents();
    e.spawnBox(60, 40, 4, 4, GOLD_ORE); // dense (3.0), and distinct from the STONE floor so it stays trackable after it bakes
    run(800, e);
    const bottom = bodyBottom(e.getGrid(), GOLD_ORE);
    check(`dense body sank through snow to the floor (bottom ${bottom})`, bottom >= ROWS - 4);
    e.destroy();
  }
  {
    const e = mk();
    for (let x = 25; x < 95; x++) for (let y = 65; y < ROWS; y++) e.paintDisc(x, y, 0, SAND, true);
    const idx = e._bodyCount();
    e.spawnBox(60, 40, 4, 4);
    run(500, e);
    const bottom = bodyBottom(e.getGrid(), RIGID), s = e._bodyState(idx);
    check(`default body settled in denser sand (bottom ${bottom})`, bottom > 68 && bottom < ROWS - 20);
    check(`default body has no upward velocity in sand (vy ${s ? s.vy.toFixed(3) : 'missing'})`, s && s.vy >= -0.01);
    e.destroy();
  }
  // A body lighter than a fluid part-submerges into it (buoyant equilibrium)
  // rather than resting on its surface as if it were solid; a body denser than
  // the fluid sinks deeper still. Measured in lava (the only fluid denser than a
  // default body) early, before lava erosion melts much of the body.
  const lavaSink = (mat) => {
    const e = mk();
    const L = 45, R = 115, floorY = 88, lavaTop = 64;
    for (let y = 45; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
    for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
    e.syncComponents();
    for (let x = L + 1; x < R; x++) for (let y = lavaTop; y < floorY; y++) e.paintDisc(x, y, 0, LAVA, true);
    if (mat === undefined) e.spawnBox(80, 45, 4, 4); else e.spawnBox(80, 45, 4, 4, mat);
    run(40, e);
    const g = e.getGrid();
    const tracked = mat === undefined ? RIGID : mat; // a body stamps its own material
    const out = { bottom: bodyBottom(g, tracked), n: bodyCount(g, tracked), lavaTop };
    e.destroy();
    return out;
  };
  {
    const light = lavaSink(undefined);                       // default body, density 1.4 < lava 2.8
    const heavy = lavaSink(GOLD_ORE);                        // gold density 3.0 > lava 2.8
    check(`body lighter than lava part-sinks below the surface, not resting on top (bottom ${light.bottom} > ${light.lavaTop}, cells ${light.n})`, light.n > 0 && light.bottom > light.lavaTop);
    check(`body denser than lava sinks deeper than a lighter one (${heavy.bottom} > ${light.bottom}, cells ${heavy.n})`, heavy.n > 0 && heavy.bottom > light.bottom);
  }
}

// Lava should use the same density/viscosity liquid rules as the other liquids:
// it is slower via MOBILITY, but not exempt from leveling through lighter powders.
{
  console.log('lava sinks through sand and levels by density');
  const SAND = 1, STONE = 3, LAVA = 11;
  const e = mk();
  const L = 35, R = 85, floorY = 78, top = 18;
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = floorY - 14; y < floorY; y++) e.paintDisc(x, y, 0, SAND, true);
  for (let x = L + 1; x <= L + 14; x++) for (let y = floorY - 30; y < floorY - 14; y++) e.paintDisc(x, y, 0, LAVA, true);
  const cnt = (m) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
  const lava0 = cnt(LAVA), sand0 = cnt(SAND);
  let t = 0, settledAt = -1;
  for (let i = 0; i < 14000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`lava/sand scene settles to inert (step ${settledAt})`, settledAt >= 0);
  check(`lava + sand conserved (${lava0}/${sand0})`, cnt(LAVA) === lava0 && cnt(SAND) === sand0 && lava0 > 0 && sand0 > 0);
  const g = e.getGrid(); const tops = [];
  for (let x = L + 1; x < R; x++) {
    for (let y = top; y <= floorY; y++) { if (g[y * COLS + x] === LAVA) { tops.push(y); break; } }
  }
  const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : -1;
  check(`lava under sand is near-flat despite viscosity (top spread ${spread}px over ${tops.length} cols)`, tops.length > 25 && spread >= 0 && spread <= 3);
  e.destroy();
}

// Lava touching snow melts it to water. The next lava-water reaction may harden the
// lava, so sample immediately after one reaction step to pin the melt transform.
{
  console.log('lava melts snow into water');
  const WATER = 2, LAVA = 11, SNOW = 16;
  const e = mk();
  e.paintDisc(60, 50, 0, LAVA, true);
  e.paintDisc(61, 50, 0, SNOW, true);
  e.step(16);
  const g = e.getGrid();
  let water = 0, snow = 0;
  for (let i = 0; i < g.length; i++) { if (g[i] === WATER) water++; else if (g[i] === SNOW) snow++; }
  check(`snow adjacent to lava melted into moving water (water ${water}, snow ${snow})`, water === 1 && snow === 0);
  e.destroy();
}

// A pressured reservoir released through a dam breach must not duplicate liquid.
// This specifically exercises the surface leveller during a "tidal wave" case:
// a tall wall of liquid with a lot of liquid behind it drains into an empty basin.
// The count immediately after the breach is the invariant for every following tick.
{
  console.log('tidal wave liquid release conserves mass');
  const WATER = 2, STONE = 3, OIL = 4, ACID = 10, ICE = 12;
  const runTidalWave = (name, liquid, support) => {
    const e = mk();
    const L = 8, DAM = 96, R = 190, floorY = 112, top = 20;
    for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, support, true); e.paintDisc(DAM, y, 0, support, true); e.paintDisc(R, y, 0, support, true); }
    for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, support, true);
    e.syncComponents();
    for (let x = L + 1; x < DAM; x++) for (let y = 36; y < floorY; y++) e.paintDisc(x, y, 0, liquid, true);
    const cnt = () => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === liquid) n++; return n; };
    let t = 0; for (let i = 0; i < 1500; i++) { t += 16; if (!e.step(t)) break; }
    const before = cnt();
    for (let y = 42; y < floorY; y++) e.eraseDisc(DAM, y, 0);
    const afterBreach = cnt();
    let min = afterBreach, max = afterBreach;
    for (let i = 0; i < 900; i++) {
      t += 16; e.step(t);
      const c = cnt(); min = Math.min(min, c); max = Math.max(max, c);
    }
    check(`${name} breach did not erase liquid (${before} -> ${afterBreach})`, before === afterBreach && before > 0);
    check(`${name} tidal wave conserved liquid (${afterBreach}, min ${min}, max ${max})`, min === afterBreach && max === afterBreach);
    e.destroy();
  };
  runTidalWave('water', WATER, STONE);
  runTidalWave('oil', OIL, STONE);
  runTidalWave('acid', ACID, ICE); // acid dissolves stone; ice is component-registered and non-dissolvable.
}

// Cross-layer density transfer: LAVA resting in the BACKGROUND on bg STONE, with a
// SAND pile in the FOREGROUND over the same region, must SINK into the foreground via
// the cross-layer density swap (lava 2.8 > sand 1.6) — leaving NO lava stranded on the
// bg stone and resolving in the fg with sand resting on top of the lava.
// Regression for: stuckIn() treated a liquid's lateral "displace a lighter loose
// neighbour" as an escape, so bg lava interlocked with bg sand on the stone band was
// judged "not stuck" and never transferred. It now requires a real downward-opening
// side channel, matching settleLiquid, so the stuck lava transfers cross-layer.
{
  console.log('bg lava on stone sinks into fg sand (cross-layer density)');
  const SAND = 1, STONE = 3, LAVA = 11;
  const e = mk();
  // FG basin: grounded stone walls + floor, placed wide so loose cells never drift
  // over a wall column. Centered sand pile sits in it.
  const L = 24, R = 40, floorY = 50;
  for (let y = 30; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = 30; x <= 34; x++) for (let y = floorY - 8; y < floorY; y++) e.paintDisc(x, y, 0, SAND, true);
  // BG: full-width stone band; a few lava cells resting on it over the sand columns.
  const bgTop = floorY - 4;
  for (let y = bgTop; y < ROWS; y++) for (let x = 0; x < COLS; x++) e.paintDiscLayer(1, x, y, 0, STONE, true);
  e.syncComponentsLayer(1);
  for (let x = 30; x <= 34; x++) for (let y = bgTop - 3; y < bgTop; y++) e.paintDiscLayer(1, x, y, 0, LAVA, true);

  const bg = () => e.getGridBg(), fg = () => e.getGrid();
  const cntFg = (m) => { const g = fg(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
  const cntBg = (m) => { const g = bg(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
  const lava0 = cntBg(LAVA), sand0 = cntFg(SAND);
  let t = 0, settledAt = -1; for (let i = 0; i < 4000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`scene settles to inert (step ${settledAt})`, settledAt >= 0);
  // ZERO lava left in the background (none stranded on the bg stone).
  check(`no lava left in the background (${cntBg(LAVA)} of ${lava0})`, cntBg(LAVA) === 0 && lava0 > 0);
  // The lava moved into the foreground (conserved across the swap).
  check(`lava moved into the foreground (${cntFg(LAVA)})`, cntFg(LAVA) === lava0);
  // sand is conserved overall (a few cells may ride along into the bg on a swap);
  // the bulk of the pile stays in the fg resting on the transferred lava.
  check(`sand conserved overall (fg ${cntFg(SAND)} + bg ${cntBg(SAND)} = ${sand0})`, cntFg(SAND) + cntBg(SAND) === sand0 && cntFg(SAND) > sand0 / 2);
  // Vertical ordering at the centre column: sand rests ABOVE lava in the fg (the
  // top-most lava row is strictly below the bottom-most sand row).
  const g = fg(); let sandBot = -1, lavaTop = ROWS;
  for (let y = 0; y < ROWS; y++) { const v = g[y * COLS + 32]; if (v === SAND) sandBot = y; if (v === LAVA && y < lavaTop) lavaTop = y; }
  check(`sand sits on top of lava in the fg (sandBot ${sandBot} < lavaTop ${lavaTop})`, sandBot >= 0 && lavaTop < ROWS && sandBot < lavaTop);
  e.destroy();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
