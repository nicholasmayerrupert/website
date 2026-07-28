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

// 2b. Newly placed structural solids enter the body solver even at a streamed
//     edge. The buffer sentinel must not act as physical support.
{
  console.log('streamed-edge structural bodies (infinite)');
  const e = mk({ infinite: true });
  e.setBgEnabled(false); // isolate streamed-edge support from background tree cross-bonds
  const EDGE_X0 = 1, EDGE_X1 = 13;   // leftmost column x=1 touches the streamed edge
  const FREE_X0 = 40, FREE_X1 = 52;  // open space, touches no edge
  // Place both blocks in empty sky, comfortably above the generated surface (see #5).
  const surf = Math.min(e.worldSurfaceAt(EDGE_X0), e.worldSurfaceAt(FREE_X1));
  const Y0 = Math.max(2, surf - 30), Y1 = Y0 + 8;
  for (let y = Y0; y < Y1; y++) for (let x = EDGE_X0; x < EDGE_X1; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let y = Y0; y < Y1; y++) for (let x = FREE_X0; x < FREE_X1; x++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  const bodyIn = (x0, x1) => {
    for (let i = 0; i < e._bodyCount(); i++) {
      const state = e._bodyState(i);
      if (e._bodyMaterial(i) === MAT.STONE && state?.px >= x0 && state.px < x1)
        return state;
    }
    return null;
  };
  const edgeStart = bodyIn(EDGE_X0, EDGE_X1), freeStart = bodyIn(FREE_X0, FREE_X1);
  run(20, e);
  const edgeAfter = bodyIn(EDGE_X0, EDGE_X1), freeAfter = bodyIn(FREE_X0, FREE_X1);
  check(`edge-touching block entered the rigid solver (${edgeStart?.nPts ?? 0} cells)`,
    edgeStart?.nPts === 96);
  check(`edge-touching block fell (${edgeStart?.py.toFixed(1)} -> ${edgeAfter?.py.toFixed(1)})`,
    edgeStart && edgeAfter && edgeAfter.py > edgeStart.py + 2);
  check(`open-space block fell (${freeStart?.py.toFixed(1)} -> ${freeAfter?.py.toFixed(1)})`,
    freeStart && freeAfter && freeAfter.py > freeStart.py + 2);
  e.destroy();
}

// 2c. Infinite-world edge support keeps streamed terrain stable, but must not
//     ground buoyant ice. Large hand-built icebergs commonly extend through a
//     loaded-window edge; they must continue floating while still edge-connected.
{
  console.log('edge-spanning iceberg remains buoyant (infinite)');
  const e = mk({ infinite: true });
  e.setBgEnabled(false);
  const wallX = 100, floorY = 110;
  for (let y = 20; y < ROWS; y++) e.paintDisc(wallX, y, 0, MAT.BRICK, true);
  for (let x = 1; x <= wallX; x++) e.paintDisc(x, floorY, 0, MAT.BRICK, true);
  e.syncComponents();
  for (let y = 35; y < floorY; y++) for (let x = 1; x < wallX; x++) e.paintDisc(x, y, 0, MAT.BRINE, true);
  for (let y = 80; y <= 86; y++) for (let x = 1; x <= 40; x++) e.paintDisc(x, y, 0, MAT.ICE, true);
  e.syncComponents();
  const iceTop = () => {
    const g = e.getGrid(); let top = ROWS, n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] === MAT.ICE) { top = Math.min(top, (i / COLS) | 0); n++; }
    return { top, n };
  };
  const before = iceTop();
  run(200, e);
  const after = iceTop();
  check(`edge-spanning iceberg rose (top ${before.top} -> ${after.top}, ${before.n}->${after.n} raster cells)`,
    before.n === 280 && Math.abs(after.n - before.n) <= 4 && after.top <= before.top - 8);
  e.destroy();
}

// 2d. Splitting a concave iceberg creates several leading/trailing vertical
//     runs. Its displaced brine must use every trailing vacancy when the
//     preferred below-source matching lacks enough capacity; otherwise the
//     detached submerged half is permanently pinned.
{
  console.log('concave iceberg fragment rises immediately after an underwater split');
  const e = mk();
  e.setBgEnabled(false);
  const floorY = 112;
  for (let y = 15; y < ROWS; y++) { e.paintDisc(12, y, 0, MAT.BRICK, true); e.paintDisc(188, y, 0, MAT.BRICK, true); }
  for (let x = 12; x <= 188; x++) e.paintDisc(x, floorY, 0, MAT.BRICK, true);
  e.syncComponents();
  for (let y = 25; y < floorY; y++) for (let x = 13; x < 188; x++) e.paintDisc(x, y, 0, MAT.BRINE, true);
  for (let y = 32; y <= 37; y++) for (let x = 13; x <= 82; x++) e.paintDisc(x, y, 0, MAT.ICE, true);
  for (let y = 37; y <= 55; y++) for (let x = 78; x <= 82; x++) e.paintDisc(x, y, 0, MAT.ICE, true);
  let seed = 1, x = 80, y = 55;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 180; i++) {
    e.paintDisc(x, y, 1, MAT.ICE, true);
    const turn = random();
    if (turn < 0.38) y = Math.min(88, y + 1);
    else if (turn < 0.48) y = Math.max(55, y - 1);
    else x = Math.max(25, Math.min(135, x + (random() < 0.5 ? -1 : 1)));
  }
  e.syncComponents();
  for (let cutY = 45; cutY <= 51; cutY++) for (let cutX = 15; cutX < 185; cutX++) e.eraseDisc(cutX, cutY, 0);
  const iceStats = () => {
    const grid = e.getGrid(); let n = 0, maxY = -1;
    for (let i = 0; i < grid.length; i++) if (grid[i] === MAT.ICE) { n++; maxY = Math.max(maxY, (i / COLS) | 0); }
    return { n, maxY };
  };
  const before = iceStats();
  run(120, e);
  const after = iceStats();
  check(`split concave fragment responded to buoyancy (bottom ${before.maxY} -> ${after.maxY})`,
    Math.abs(before.n - after.n) <= 4 && after.maxY <= before.maxY - 3);
  e.destroy();
}

// 2e. A fully submerged sparse/tendril-shaped iceberg has the same density as
//     a compact one and must rise intact under continuous rigid-body buoyancy.
{
  console.log('fully submerged sparse iceberg is shape-independently buoyant');
  const e = mk();
  e.setBgEnabled(false);
  const floorY = 112;
  for (let y = 10; y < ROWS; y++) { e.paintDisc(8, y, 0, MAT.BRICK, true); e.paintDisc(191, y, 0, MAT.BRICK, true); }
  for (let x = 8; x <= 191; x++) e.paintDisc(x, floorY, 0, MAT.BRICK, true);
  e.syncComponents();
  for (let y = 18; y < floorY; y++) for (let x = 9; x < 191; x++) e.paintDisc(x, y, 0, MAT.BRINE, true);
  let seed = 1, x = 100, y = 45;
  const cells = new Set();
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 180; i++) {
    cells.add(`${x},${y}`);
    if (random() < 0.18) { cells.add(`${x + 1},${y}`); cells.add(`${x},${y + 1}`); }
    const turn = random();
    if (turn < 0.42) y = Math.min(96, y + 1);
    else if (turn < 0.55) y = Math.max(35, y - 1);
    else x = Math.max(60, Math.min(140, x + (random() < 0.5 ? -1 : 1)));
  }
  for (const cell of cells) { const [cx, cy] = cell.split(',').map(Number); e.paintDisc(cx, cy, 0, MAT.ICE, true); }
  e.syncComponents();
  const iceCells = () => {
    const out = []; const grid = e.getGrid();
    for (let i = 0; i < grid.length; i++) if (grid[i] === MAT.ICE) out.push(i);
    return out;
  };
  const before = iceCells();
  const beforeTop = Math.min(...before.map((k) => (k / COLS) | 0));
  const bodyIceCells = () => {
    let total = 0;
    for (let i = 0; i < e._bodyCount(); i++)
      if (e._bodyMaterial(i) === MAT.ICE) total += e._bodyState(i).nPts;
    return total;
  };
  run(120, e);
  const after = iceCells();
  const afterTop = Math.min(...after.map((k) => (k / COLS) | 0));
  check(`sparse submerged iceberg rose intact (${beforeTop} -> ${afterTop}, ${before.length} cells)`,
    bodyIceCells() === before.length && afterTop <= beforeTop - 3);
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

// 3c. Fire cutting a broad plant component creates many dry rigid fragments.
// They must keep burning and settling without making buoyancy's open-air probe
// part of the dry-component hot path.
{
  console.log('fire burns through a fragmented plant component');
  const e = mk();
  for (let x = 35; x <= 165; x++) {
    for (let y = 45; y <= 49; y++) e.paintDisc(x, y, 0, MAT.WOOD, true);
    if (x % 4 !== 0) for (let y = 50; y <= 82; y++) e.paintDisc(x, y, 0, MAT.PLANT, true);
  }
  e.syncComponents();
  const plantCount = () => {
    const c = counts(e.getGrid());
    return c[MAT.WOOD] + c[MAT.PLANT] + c[MAT.SEED] + c[MAT.DRIFTWOOD];
  };
  const before = plantCount();
  let peakFire = 0, t = 0;
  for (let s = 0; s < 240; s++) {
    if (s < 100) for (let x = 35; x <= 165; x += 2) e.paintDisc(x, 47, 0, MAT.FIRE, true);
    t += 16;
    e.step(t);
    peakFire = Math.max(peakFire, counts(e.getGrid())[MAT.FIRE]);
  }
  const after = plantCount();
  check(`fragmented plant ignited (peak fire ${peakFire})`, peakFire > 20);
  check(`fire consumed the fragmented plant (${before} -> ${after})`, after < before - 100);
  e.destroy();
}

// 3d. Acrid smoke that is boxed in (can't vent) dissolves quickly instead of
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
  for (let x = 60; x <= 100; x++) e.paintDisc(x, 110, 0, MAT.STONE, true);
  e.paintDisc(82, 82, 0, MAT.STONE, true);
  e.paintDisc(81, 81, 0, MAT.MYCELIUM_SPORE, true);
  e.syncComponents();
  run(400, e);
  const c = counts(e.getGrid());
  check(`diagonal spore converted the diagonal stone (${c[MAT.MYCELIUM] || 0})`, (c[MAT.MYCELIUM] || 0) >= 1);
  check(`diagonal spore retained its colony core (${c[MAT.MYCELIUM_SPORE] || 0})`, (c[MAT.MYCELIUM_SPORE] || 0) >= 1);
  e.destroy();
}

// 5. a dropped cube settles on terrain without disintegrating or clipping.
{
  console.log('free rigid body');
  // Use a controlled slope: the populated infinite surface now legitimately
  // contains roofs, wells, and lanterns, none of which belong in this body-only
  // integrity fixture.
  const e = mk({ infinite: false });
  for (let x = 5; x < COLS - 5; x++) {
    const top = 76 + ((x - 5) >> 4);
    for (let y = top; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  }
  e.finalizeStoneDraft();
  e.spawnBox(COLS / 2, 40, 5, 5); // 10x10 box, built engine-side
  run(260, e);
  const n = rigidCells(e.getGrid());
  // The cube lands on sloped terrain and rolls a quarter turn before it
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
  // Surface levelling keeps the settled ramp within three cells.
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
  const SAND = 1, MOSS = 20; // MOSS is a structural component, density 0.9 < sand 1.6
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

// Granular support is load-per-footprint, not buoyancy. A short wood block can
// rest on sand, while much more of the same light material concentrated over the
// same eight-cell footprint must overload it and sink. Sand can resist downward
// motion, but never pushes either block back upward.
{
  console.log('sand support depends on solid load per footprint');
  const SAND = 1, WOOD = 8;
  const runWoodLoad = (height) => {
    const e = mk();
    for (let x = 25; x < 95; x++) for (let y = 65; y < ROWS; y++) e.paintDisc(x, y, 0, SAND, true);
    for (let y = 55 - height; y < 55; y++) for (let x = 56; x < 64; x++) e.paintDisc(x, y, 0, WOOD, true);
    e.syncComponents();
    const bounds = () => {
      const g = e.getGrid(); let minY = ROWS, maxY = -1, n = 0;
      for (let i = 0; i < g.length; i++) if (g[i] === WOOD) {
        const y = (i / COLS) | 0; n++; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { minY, maxY, n };
    };
    run(500, e);
    const settled = bounds();
    run(120, e);
    const later = bounds();
    e.destroy();
    return { settled, later };
  };
  const small = runWoodLoad(8), large = runWoodLoad(30);
  check(`small wood load stayed on the sand surface (rows ${small.later.minY}-${small.later.maxY})`,
    small.later.n === 64 && small.later.minY > 55 && small.later.maxY < 70);
  check(`large concentrated wood load sank through the sand (rows ${large.later.minY}-${large.later.maxY})`,
    large.later.n === 240 && large.later.minY > 65 && large.later.maxY >= ROWS - 2);
  check(`sand never pushed either wood load upward`,
    small.later.minY >= small.settled.minY && large.later.minY >= large.settled.minY);
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

// Cave air is exterior to a detached island even when the cave roof blocks a
// vertical path to the world top. Lava enclosed by the island is cargo, not an
// external fluid that can buoy the surrounding stone shell upward.
{
  console.log('lava-filled cave island does not rise');
  const BRICK = 25, STONE = 3, LAVA = 11;
  const e = mk();
  const roomL = 20, roomR = 180, roofY = 10, floorY = 110;
  for (let y = roofY; y <= floorY; y++) {
    e.paintDisc(roomL, y, 0, BRICK, true);
    e.paintDisc(roomR, y, 0, BRICK, true);
  }
  for (let x = roomL; x <= roomR; x++) {
    e.paintDisc(x, roofY, 0, BRICK, true);
    e.paintDisc(x, floorY, 0, BRICK, true);
  }
  for (let y = 30; y <= 79; y++) for (let x = 55; x <= 144; x++) {
    if (x === 55 || x === 144 || y === 30 || y === 79) e.paintDisc(x, y, 0, STONE, true);
  }
  e.syncComponents();
  for (let y = 31; y < 79; y++) for (let x = 56; x < 144; x++) {
    e.paintDisc(x, y, 0, LAVA, true);
  }
  const stoneTop = () => {
    const g = e.getGrid(); let top = ROWS, n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] === STONE) {
      top = Math.min(top, (i / COLS) | 0);
      n++;
    }
    return { top, n };
  };
  const before = stoneTop();
  run(80, e);
  const after = stoneTop();
  check(`lava-filled island did not rise (top ${before.top} -> ${after.top})`,
    before.n > 0 && after.n === before.n && after.top >= before.top);
  e.destroy();
}

// A fully submerged ice component must rise. Use brine so this buoyancy fixture
// is independent of ICE's water-freezing reaction. The reverse-direction
// anti-jitter probe must see the liquid that the planned move restores into
// vacated cells, not the component's stale pre-move ICE cells.
{
  console.log('fully submerged ice rises through brine');
  const STONE = 3, ICE = 12, BRINE = 33;
  const e = mk();
  const L = 45, R = 155, top = 18, floorY = 106;
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = L + 1; x < R; x++) for (let y = 35; y < floorY; y++) e.paintDisc(x, y, 0, BRINE, true);
  run(40, e);
  for (let y = 82; y <= 88; y++) for (let x = 97; x <= 103; x++) e.paintDisc(x, y, 0, ICE, true);
  e.syncComponents();
  const iceTop = () => {
    const g = e.getGrid(); let y0 = ROWS;
    for (let i = 0; i < g.length; i++) if (g[i] === ICE) y0 = Math.min(y0, (i / COLS) | 0);
    return y0;
  };
  const before = iceTop();
  const ys = [before];
  for (let i = 0; i < 400; i++) { e.step(16 * (i + 1)); ys.push(iceTop()); }
  const after = ys.at(-1);
  const tailRows = new Set(ys.slice(-30));
  check(`submerged ice rose (top row ${before} -> ${after})`, before === 82 && after < before - 8);
  check(`rising ice stabilized within two raster rows (${tailRows.size} tail rows)`,
    tailRows.size <= 2);
  e.destroy();
}

// A wide, uneven raft with a deep appendage exercises multiple disconnected
// vertical runs and many simultaneous liquid relocation targets. This is the
// shape class that used to alternate one row up/down while fully submerged.
{
  console.log('irregular submerged ice rises and settles without shimmer');
  const STONE = 3, ICE = 12, BRINE = 33;
  const e = mk();
  const L = 35, R = 165, top = 16, floorY = 108;
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
  for (let x = L; x <= R; x++) e.paintDisc(x, floorY, 0, STONE, true);
  e.syncComponents();
  for (let x = 55; x <= 145; x++) for (let y = 70; y <= 73; y++) e.addDiscToIceDraft(x, y, 0);
  for (let x = 58; x <= 142; x++) for (let y = 74; y <= 74 + ((x * 7) % 4); y++) e.addDiscToIceDraft(x, y, 0);
  for (let y = 74; y <= 98; y++) {
    const cx = 100 + Math.round(Math.sin(y * 0.7) * 3);
    for (let x = cx - 2; x <= cx + 2; x++) e.addDiscToIceDraft(x, y, 0);
  }
  for (let x = 86; x <= 114; x++) {
    for (let y = 84; y <= 84 + Math.abs(x - 100) % 3; y++)
      e.addDiscToIceDraft(x, y, 0);
  }
  e.finalizeIceDraft();
  let iceBodyIndex = -1;
  for (let i = 0; i < e._bodyCount(); i++)
    if (e._bodyMaterial(i) === ICE) {
      iceBodyIndex = i;
      break;
    }
  const staged = e.getGrid();
  for (let x = L + 1; x < R; x++) for (let y = 27; y < floorY; y++) {
    if (staged[y * COLS + x] === 0) e.paintDisc(x, y, 0, BRINE, true);
  }
  const iceTop = () => {
    const g = e.getGrid(); let y0 = ROWS, n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] === ICE) { y0 = Math.min(y0, (i / COLS) | 0); n++; }
    return { y: y0, n };
  };
  const before = iceTop(), g0 = e.getGrid();
  let faces = 0, wetFaces = 0, bottomWet = 0;
  for (let k = 0; k < g0.length; k++) if (g0[k] === ICE) {
    for (const off of [-1, 1, COLS]) if (g0[k + off] !== ICE) {
      faces++; if (g0[k + off] === BRINE) { wetFaces++; if (off === COLS) bottomWet++; }
    }
  }
  check(`irregular ice starts fully wetted (${wetFaces}/${faces}, bottom ${bottomWet})`, wetFaces === faces && bottomWet > 0);
  const ys = [before.y], bodyYs = [];
  const reservoirSurface = (grid) => {
    const tops = [];
    for (let x = L + 1; x < R; x++) {
      let hasIce = false, topY = ROWS;
      for (let y = 1; y < floorY; y++) {
        const m = grid[y * COLS + x];
        if (m === ICE) hasIce = true;
        if (m === BRINE) topY = Math.min(topY, y);
      }
      if (!hasIce && topY < ROWS) tops.push(topY);
    }
    tops.sort((a, b) => a - b);
    return tops[(tops.length / 2) | 0];
  };
  let eruptedBrine = 0; const eruptionSamples = [];
  for (let i = 0; i < 700; i++) {
    const previous = Uint8Array.from(e.getGrid());
    const surface = reservoirSurface(previous);
    e.step(16 * (i + 1));
    const current = e.getGrid();
    for (let k = 0; k < current.length; k++) {
      if (previous[k] === ICE && current[k] === BRINE && ((k / COLS) | 0) < surface - 1) {
        eruptedBrine++;
        if (eruptionSamples.length < 20) eruptionSamples.push(`${i}:${k % COLS},${(k / COLS) | 0}<${surface}`);
      }
    }
    ys.push(iceTop().y);
    bodyYs.push(e._bodyState(iceBodyIndex).py);
  }
  const after = iceTop();
  const bodyTail = bodyYs.slice(-120);
  const finalBody = e._bodyState(iceBodyIndex);
  const tailHeave = Math.max(...bodyTail) - Math.min(...bodyTail);
  check(`irregular ice rose toward the surface (top ${before.y} -> ${after.y}, best ${Math.min(...ys)}, raster cells ${before.n}->${after.n})`, after.n >= before.n * 0.99 && after.y < before.y - 20);
  check(`irregular ice does not flood its top wake (${eruptedBrine} edge cells${eruptionSamples.length ? `; ${eruptionSamples.join(' ')}` : ''})`, eruptedBrine <= 8);
  check(`irregular ice vertical motion remained bounded (heave ${tailHeave.toFixed(2)}, vy ${finalBody.vy.toFixed(3)})`,
    tailHeave <= 2 && Math.abs(finalBody.vy) < 0.03);
  e.destroy();
}

// Buoyancy is proportional to displaced area, not wetted perimeter. A long,
// shallow strip has a large bottom edge, so the old face-ratio approximation
// could hold it up with only its underside or first row touching the water.
for (const tc of [
  { label: 'long horizontal ice strip', diagonal: false, bonded: false },
  { label: 'bonded shallow diagonal ice strips', diagonal: true, bonded: true },
]) {
  console.log(`${tc.label} reaches its density-based draft`);
  const e = mk();
  const L = 15, R = 185, floorY = 108;
  const layers = tc.bonded ? [0, 1] : [0];
  for (const layer of layers) {
    for (let y = 12; y < ROWS; y++) {
      e.paintDiscLayer(layer, L, y, 0, MAT.BRICK, true);
      e.paintDiscLayer(layer, R, y, 0, MAT.BRICK, true);
    }
    for (let x = L; x <= R; x++) e.paintDiscLayer(layer, x, floorY, 0, MAT.BRICK, true);
    e.syncComponentsLayer(layer);
    for (let y = 58; y < floorY; y++) for (let x = L + 1; x < R; x++) {
      e.paintDiscLayer(layer, x, y, 0, MAT.BRINE, true);
    }
  }
  run(40, e);
  for (const layer of layers) {
    if (tc.diagonal) {
      for (let x = 35; x <= 165; x++) {
        const cy = 30 + Math.round((x - 35) * 0.12);
        for (let oy = -1; oy <= 1; oy++) e.paintDiscLayer(layer, x, cy + oy, 0, MAT.ICE, true);
      }
    } else {
      for (let y = 31; y <= 34; y++) for (let x = 35; x <= 165; x++) {
        e.paintDiscLayer(layer, x, y, 0, MAT.ICE, true);
      }
    }
    e.syncComponentsLayer(layer);
  }
  const gridFor = (layer) => layer ? e.getGridBg() : e.getGrid();
  const iceStats = (grid) => {
    let n = 0, minY = ROWS, maxY = -1, sumY = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] === MAT.ICE) {
      const y = (i / COLS) | 0;
      n++; sumY += y; minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { n, minY, maxY, cy: n ? sumY / n : -1 };
  };
  const waterline = (grid) => {
    const tops = [];
    for (let x = L + 2; x <= R - 2; x++) {
      let hasIce = false, top = ROWS;
      for (let y = 1; y < floorY; y++) {
        const m = grid[y * COLS + x];
        if (m === MAT.ICE) hasIce = true;
        if (m === MAT.BRINE) top = Math.min(top, y);
      }
      if (!hasIce && top < ROWS) tops.push(top);
    }
    tops.sort((a, b) => a - b);
    return tops[(tops.length / 2) | 0];
  };
  const before = iceStats(gridFor(0));
  let iceBodyIndex = -1;
  for (let i = 0; i < e._bodyCount(); i++)
    if (e._bodyMaterial(i) === MAT.ICE) {
      iceBodyIndex = i;
      break;
    }
  const bodyYs = [];
  let aligned = true;
  for (let i = 0; i < 700; i++) {
    e.step(16 * (i + 1));
    if (iceBodyIndex < 0) {
      for (let body = 0; body < e._bodyCount(); body++)
        if (e._bodyMaterial(body) === MAT.ICE) {
          iceBodyIndex = body;
          break;
        }
    }
    const fg = iceStats(gridFor(0));
    bodyYs.push(e._bodyState(iceBodyIndex).py);
    if (tc.bonded) {
      const bg = iceStats(gridFor(1));
      if (fg.n !== bg.n || fg.minY !== bg.minY || fg.maxY !== bg.maxY || fg.cy !== bg.cy) aligned = false;
    }
  }
  const after = iceStats(gridFor(0)), surface = waterline(gridFor(0));
  let submerged = 0;
  for (let i = 0; i < gridFor(0).length; i++) {
    if (gridFor(0)[i] === MAT.ICE && ((i / COLS) | 0) >= surface) submerged++;
  }
  check(`${tc.label} fell from air into the pool (center ${before.cy.toFixed(1)} -> ${after.cy.toFixed(1)})`, after.cy > before.cy + 15);
  const bodyHeight = after.maxY - after.minY + 1;
  const draftOk = submerged >= after.n * 0.6 && after.cy <= surface + bodyHeight + 3;
  check(`${tc.label} reached a density-based surface draft (center ${after.cy.toFixed(1)}, ${submerged}/${after.n} cells at/below row ${surface})`, draftOk);
  const bodyTail = bodyYs.slice(-120);
  const finalBody = e._bodyState(iceBodyIndex);
  const tailHeave = Math.max(...bodyTail) - Math.min(...bodyTail);
  check(`${tc.label} vertical motion remained bounded (heave ${tailHeave.toFixed(2)}, vy ${finalBody.vy.toFixed(3)})`,
    tailHeave <= 2 && Math.abs(finalBody.vy) < 0.03);
  if (tc.bonded) check(`${tc.label} stayed aligned across layers`, aligned);
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
  for (let y = top; y < ROWS; y++) { e.paintDisc(L - 2, y, 0, STONE, true); e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); e.paintDisc(R + 2, y, 0, STONE, true); }
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
  const tail = ys.slice(-120);
  check(`ice stayed present in the oil/brine interface (${ys.length} samples)`, ys.length > 300);
  check(`ice corrections end while liquids level (${reversals} reversals, ${new Set(tail).size} tail positions)`, new Set(tail).size === 1);
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
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, BRICK, true); e.paintDisc(R, y, 0, BRICK, true); }
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
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, BRICK, true); e.paintDisc(R, y, 0, BRICK, true); }
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
  let iceBody = null;
  for (let i = 0; i < e._bodyCount(); i++) {
    if (e._bodyMaterial(i) === ICE) {
      iceBody = e._bodyState(i);
      break;
    }
  }
  const loadX = Math.round(iceBody.px);
  for (let y = iceBefore.minY - 3; y <= iceBefore.minY - 1; y++)
    for (let x = loadX - 1; x <= loadX + 1; x++)
      e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  const weldedAtPlacement = e._bodyCount() === 1;
  run(180, e);
  const stone = matBounds(STONE), ice = matBounds(ICE);
  const mergedBody = e._bodyCount() === 1 ? e._bodyState(0) : null;
  check(`small stone load stayed welded to the rotating ice raft (${mergedBody?.nPts ?? 0} cells)`,
    weldedAtPlacement && mergedBody !== null && stone.n > 0 && ice.n > 0);
  check(`mass-average raft stayed above the pool floor (stone rows ${stone.minY}-${stone.maxY}, ice rows ${ice.minY}-${ice.maxY})`,
    Math.max(stone.maxY, ice.maxY) < floorY - 10);
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
  for (let y = top; y < ROWS; y++) { e.paintDisc(L, y, 0, STONE, true); e.paintDisc(R, y, 0, STONE, true); }
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
  // Setup geometry (y increases downward): oil [60,69], brine [70,95], gold in oil band.
  const OIL_TOP = 60, OIL_BOT = 69, BRINE_TOP = 70;
  const oil0 = bounds(OIL), brine0 = bounds(BRINE), gold0 = bounds(GOLD_ORE);
  run(40, e);
  const oil = bounds(OIL), brine = bounds(BRINE), gold = bounds(GOLD_ORE);
  check(`oil and brine conserved during component displacement (${oil.n}/${brine.n})`, oil.n === oil0.n && brine.n === brine0.n);
  // Gold must actually sink into the brine region (otherwise no displacement to test).
  check(
    `gold sank into the brine region (gold rows ${gold.minY}-${gold.maxY}, brine was top ${BRINE_TOP})`,
    gold.n === gold0.n && gold.maxY >= BRINE_TOP && gold.minY > OIL_TOP,
  );
  // Stratification: free surface of oil stays above free surface of brine (no swap).
  check(
    `oil remains stratified above brine (oil top ${oil.minY} < brine top ${brine.minY})`,
    oil.minY < brine.minY,
  );
  // Anti-teleport: dense brine must not be ejected into open air above the oil surface.
  // Use the live oil free surface (moves as the column settles) plus a margin so a
  // single interface cell of noise cannot pass as "air surface".
  check(
    `brine did not teleport above the oil free surface (brine top ${brine.minY} >= oil top ${oil.minY} + 4)`,
    brine.minY >= oil.minY + 4,
  );
  // Interface stays contiguous: oil bottom and brine top should not open a huge gap
  // (teleport-to-air would leave brine far above oil.maxY; total column sink keeps them near).
  check(
    `oil/brine interface stayed contiguous after displacement (oil bot ${oil.maxY}, brine top ${brine.minY})`,
    brine.minY <= oil.maxY + 3,
  );
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

// Disconnected lava cells can quench in the same reaction batch. They must become
// separate stone components: a grounded fragment must not pin a floating one.
{
  console.log('disconnected lava quench fragments fall independently');
  const e = mk();
  const x = 60, floorY = 100, floatingY = 20;
  for (let y = floorY; y < ROWS; y++) for (let xx = 0; xx < COLS; xx++) e.paintDisc(xx, y, 0, MAT.STONE, true);
  e.syncComponents();
  for (const y of [floatingY, floorY - 1]) {
    e.paintDisc(x, y, 0, MAT.LAVA, true);
    e.paintDisc(x + 1, y, 0, MAT.WATER, true);
  }
  run(20, e);
  let floatingStoneY = ROWS;
  for (let y = 0; y < floorY; y++) if (e.getGrid()[y * COLS + x] === MAT.STONE) { floatingStoneY = y; break; }
  check(`floating quenched stone fell independently (row ${floatingY} -> ${floatingStoneY})`, floatingStoneY > floatingY + 10);
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
