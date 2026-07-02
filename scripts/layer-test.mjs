// Tests for the two-layer engine (foreground + background) and the cross-layer
// powder/liquid transfer. Runs headless in Node. Run with:
//   node scripts/layer-test.mjs

import { initSandWasm, createEngineWasm, MAT, INPUT } from '../src/sand/engineWasm.js';
import { countMaterials } from './sand-test-util.mjs';

const T = { cube: 0, sand: 1, water: 2, stone: 3, oil: 4, fire: 5, acid: 6, lava: 7, ice: 8, seed: 9, driftwood: 10, eraser: 11 };

await initSandWasm();

const COLS = 60, ROWS = 80;
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, infinite: false, sinksOn: false });
const k = (x, y) => y * COLS + x;
const step = (e, n, dt = 16) => { let t = 0; for (let i = 0; i < n; i++) { t += dt; e.step(t); } };
const countIn = (grid, mat) => { let c = 0; for (let i = 0; i < grid.length; i++) if (grid[i] === mat) c++; return c; };
const rect = (e, layer, x0, x1, y0, y1, mat = MAT.STONE) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) e.paintDiscLayer(layer, x, y, 0, mat, true);
  if (mat === MAT.STONE || mat === MAT.ICE || mat === MAT.WOOD || mat === MAT.PLANT) e.syncComponentsLayer(layer);
};
const bbox = (grid, x0 = 0, x1 = COLS, y0 = 0, y1 = ROWS, mat = MAT.STONE) => {
  let n = 0, minX = x1, maxX = -1, minY = y1, maxY = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (grid[k(x, y)] === mat) {
    n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { n, minX, maxX, minY, maxY };
};

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

// 4b. A gas trapped under a foreground ceiling transfers into an open background
//     cell where it can keep rising.
{
  console.log('transfer: blocked fg gas -> bg');
  const e = mk();
  e.setBgEnabled(true);
  const y = 21;
  for (let x = 26; x <= 34; x++) {
    e.paintDiscLayer(0, x, y - 1, 0, MAT.STONE, true);
    e.paintDiscLayer(0, x, y + 1, 0, MAT.STONE, true);
  }
  e.paintDiscLayer(0, 26, y, 0, MAT.STONE, true);
  e.paintDiscLayer(0, 34, y, 0, MAT.STONE, true);
  for (let yy = y + 1; yy < ROWS; yy++) e.paintDiscLayer(0, 26, yy, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  for (let x = 28; x <= 32; x++) e.paintDisc(x, y, 0, MAT.STEAM, true);
  const fg0 = countIn(e.getGrid(), MAT.STEAM);
  step(e, 1);
  const fgSteam = countIn(e.getGrid(), MAT.STEAM), bgSteam = countIn(e.getGridBg(), MAT.STEAM);
  check('steam started in the foreground pocket', fg0 > 0, `(${fg0})`);
  check('blocked steam moved into the background', bgSteam > 0, `(bg ${bgSteam}, fg ${fgSteam})`);
  check('foreground pocket lost steam to cross-layer transfer', fgSteam < fg0, `(${fg0} -> ${fgSteam})`);
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

// 8. fire crosses layers: a FIRE cell ignites a flammable at the same (x,y) in
//    the OTHER layer.
{
  console.log('cross-layer fire ignites the other layer');
  const e = mk();
  e.setBgEnabled(true);
  stoneFloor(e, 0, 30, 76, 25); // fg floor (so the fed flame has somewhere to sit, no transfer)
  stoneFloor(e, 1, 30, 76, 25); // bg floor (so the oil pool rests under the flame)
  for (let x = 20; x < 40; x++) for (let y = 72; y < 76; y++) e.paintDiscLayer(1, x, y, 0, MAT.OIL, true); // bg oil pool
  const bgOil0 = countIn(e.getGridBg(), MAT.OIL);
  let bgFireSeen = 0;
  for (let i = 0; i < 40; i++) {
    for (let x = 20; x < 40; x++) for (let y = 72; y < 76; y++) e.paintDisc(x, y, 0, MAT.FIRE, true); // sustained fg flame over the oil
    e.step(16 * (i + 1));
    bgFireSeen = Math.max(bgFireSeen, countIn(e.getGridBg(), MAT.FIRE));
  }
  const bgOil1 = countIn(e.getGridBg(), MAT.OIL);
  check('bg oil ignited by fg fire', bgFireSeen > 0 && bgOil1 < bgOil0, `(bg fire seen ${bgFireSeen}, oil ${bgOil0} -> ${bgOil1})`);
}

// 9. RMB places a SOLID (stone) into the background as a persistent component.
{
  console.log('RMB places a solid into the background');
  const e = mk();
  e.setTool(T.stone);
  e.pointerDown(30, ROWS - 2, 2); // RMB down -> start a background stone draft (grounded at the bottom)
  e.pointerUp(2);                 // release -> finalize into the bg
  const bgStone = countIn(e.getGridBg(), MAT.STONE);
  check('RMB placed stone in the background', bgStone > 0, `(${bgStone})`);
  check('RMB left the foreground free of stone', countIn(e.getGrid(), MAT.STONE) === 0);
  step(e, 20);
  check('grounded bg stone persists as a component', countIn(e.getGridBg(), MAT.STONE) === bgStone, `(${countIn(e.getGridBg(), MAT.STONE)})`);
}

// 10. survival player tools: LMB -> foreground, RMB -> background, single-shot
//     solids.
{
  console.log('survival player: LMB->fg, RMB->bg');
  const e = mk();
  stoneFloor(e, 0, 28, 70, 25); // fg ground to stand on
  const id = e.spawnPlayer(26, 60);
  step(e, 30); // land
  const p = e.getPlayer(id);
  const fgStone0 = countIn(e.getGrid(), MAT.STONE); // the fg floor only
  // RMB + stone -> a background stone draft (creative lifecycle): press begins the
  // draft (preview), release finalizes it into the bg layer.
  e.setPlayerInput(id, { bits: INPUT.SECONDARY, tool: T.stone, aimX: p.x + 3, aimY: p.y }); step(e, 1);
  e.setPlayerInput(id, { bits: 0, tool: T.stone, aimX: p.x + 3, aimY: p.y }); step(e, 1); // release -> finalize
  check('player RMB placed stone in the background', countIn(e.getGridBg(), MAT.STONE) > 0, `(${countIn(e.getGridBg(), MAT.STONE)})`);
  check('player RMB added no foreground stone', countIn(e.getGrid(), MAT.STONE) === fgStone0);
  // LMB + sand -> foreground (continuous)
  const fgSand0 = countIn(e.getGrid(), MAT.SAND);
  for (let i = 0; i < 8; i++) { e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.sand, aimX: p.x + 3, aimY: p.y - 3 }); step(e, 1); }
  check('player LMB placed sand in the foreground', countIn(e.getGrid(), MAT.SAND) > fgSand0, `(${fgSand0} -> ${countIn(e.getGrid(), MAT.SAND)})`);
}

// 11. Cross-layer support: a grounded solid in one layer holds up a solid at the
//     SAME cells in the other layer (the user's "stone in front of a bg pillar").
{
  console.log('cross-layer support: bg pillar holds up fg stone');
  const e = mk();
  e.setBgEnabled(true);
  // grounded background pillar reaching the floor at x in [28..32]
  for (let x = 28; x <= 32; x++) for (let y = 55; y < ROWS; y++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(1);
  // floating foreground stone directly IN FRONT of the pillar (no fg ground under it)
  for (let x = 28; x <= 32; x++) for (let y = 55; y <= 62; y++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  const fgBefore = countIn(e.getGrid(), MAT.STONE);
  step(e, 120);
  const fg = e.getGrid();
  check('fg stone count preserved', countIn(fg, MAT.STONE) === fgBefore, `(${fgBefore})`);
  check('fg stone stayed in place (supported by bg)', fg[k(30, 55)] === MAT.STONE && fg[k(30, 62)] === MAT.STONE);
}

// 12. Control: with the background enabled but EMPTY behind it, the same floating
//     fg stone is unsupported and falls — proves the support test isn't trivial.
{
  console.log('cross-layer support: control — unsupported fg stone falls');
  const e = mk();
  e.setBgEnabled(true); // bg live but empty -> no backing
  for (let x = 28; x <= 32; x++) for (let y = 55; y <= 62; y++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  step(e, 120);
  const fg = e.getGrid();
  check('unsupported fg stone left its start rows', fg[k(30, 55)] === MAT.EMPTY);
  check('unsupported fg stone fell to the floor', fg[k(30, ROWS - 1)] === MAT.STONE);
}

// 13. No mutual mid-air float: blocks that support ONLY each other (neither
//     reaches real ground) must both fall — the joint flood bottoms out at terrain.
{
  console.log('cross-layer support: mutual mid-air support does not float');
  const e = mk();
  e.setBgEnabled(true);
  for (let x = 28; x <= 32; x++) for (let y = 30; y <= 37; y++) { e.paintDiscLayer(0, x, y, 0, MAT.STONE, true); e.paintDiscLayer(1, x, y, 0, MAT.STONE, true); }
  e.syncComponentsLayer(0); e.syncComponentsLayer(1);
  step(e, 140);
  const fg = e.getGrid(), bg = e.getGridBg();
  check('fg mutual block did not float', fg[k(30, 30)] === MAT.EMPTY);
  check('bg mutual block did not float', bg[k(30, 30)] === MAT.EMPTY);
  check('both mutual blocks reached the floor', fg[k(30, ROWS - 1)] === MAT.STONE && bg[k(30, ROWS - 1)] === MAT.STONE);
}

// 14. Component-bond support: a small connected overlap patch can transmit real
//     support, but it is not the old brittle 50% total-overlap rule.
{
  console.log('cross-layer support: connected contact patch supports large fg block');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 0, 25, 35, 30, 40);             // 10x10 foreground block, no fg floor
  rect(e, 1, 28, 31, 30, ROWS);           // grounded bg pillar, 3x10 contact patch
  const before = bbox(e.getGrid(), 25, 35, 30, 45);
  step(e, 80);
  const after = bbox(e.getGrid(), 25, 35, 30, 45);
  check('large fg block stayed supported by small connected patch', after.n === before.n && after.minY === before.minY, `(top ${before.minY} -> ${after.minY}, cells ${before.n}->${after.n})`);
}

// 15. A one-cell accidental overlap is below the bond threshold and cannot hold
//     up a large unsupported component.
{
  console.log('cross-layer support: one-cell overlap does not support a large block');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 0, 30, 40, 30, 40);
  rect(e, 1, 29, 30, 30, ROWS); // grounded path outside the fg block
  e.paintDiscLayer(1, 30, 30, 0, MAT.STONE, true); e.syncComponentsLayer(1); // one supported overlap cell
  const before = bbox(e.getGrid(), 30, 40, 30, 45);
  step(e, 30);
  const after = bbox(e.getGrid(), 30, 45, 30, ROWS);
  check('large fg block fell despite one-cell overlap', after.minY > before.minY + 2, `(top ${before.minY} -> ${after.minY})`);
}

// 15b. A tiny (1-3 cell) fg chunk fully backed by grounded background solid stays
//      supported: the bond floor is capped at the chunk's own size, so it bonds
//      instead of falling (fails on the old fixed MIN_CELLS=4 floor).
{
  console.log('cross-layer support: tiny fg chunk supported by grounded bg behind it');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 1, 30, 31, 20, ROWS); // grounded bg column reaching the floor
  rect(e, 0, 30, 31, 20, 23);   // 3-cell fg chunk floating in front of it
  const before = bbox(e.getGrid(), 28, 33, 18, 30);
  step(e, 60);
  const after = bbox(e.getGrid(), 28, 33, 18, 30);
  check('tiny fg chunk stayed supported by grounded bg', after.n === before.n && after.minY === before.minY, `(top ${before.minY} -> ${after.minY}, cells ${before.n}->${after.n})`);
}

// 16. Dynamic carve order: the first-carved layer can go inactive while held by
//     the other layer; when the second support is removed, both layers must move
//     on that same tick.
{
  console.log('cross-layer support: lost support wakes both layers same tick');
  const C = COLS, R = ROWS;
  const e = mk();
  e.setBgEnabled(true);
  const fillBridge = (layer) => {
    rect(e, layer, 8, 52, 15, 30);
    rect(e, layer, 8, 14, 30, R);
    rect(e, layer, 46, 52, 30, R);
  };
  const cutBridge = (layer) => {
    for (let y = 12; y < 32; y++) for (let x = 18; x < 22; x++) e.eraseDiscLayer(layer, x, y, 0);
    for (let y = 12; y < 32; y++) for (let x = 38; x < 42; x++) e.eraseDiscLayer(layer, x, y, 0);
  };
  const slab = (grid) => bbox(grid, 24, 36, 15, R);
  fillBridge(0); fillBridge(1);
  const b0 = slab(e.getGrid()), b1 = slab(e.getGridBg());
  cutBridge(0); step(e, 30);
  cutBridge(1); step(e, 1);
  const fg = slab(e.getGrid()), bg = slab(e.getGridBg());
  check('foreground moved on the first unsupported tick', fg.minY > b0.minY, `(top ${b0.minY} -> ${fg.minY})`);
  check('sleeping background moved on the same tick', bg.minY > b1.minY, `(top ${b1.minY} -> ${bg.minY})`);
  check('same-tick displacement matched', fg.minY - b0.minY === bg.minY - b1.minY, `(fg ${fg.minY - b0.minY}, bg ${bg.minY - b1.minY})`);
}

// 17. Bonded unsupported foreground/background pieces remain coupled while
//     falling, so their relative displacement never drifts over multiple ticks.
{
  console.log('cross-layer support: bonded pieces preserve displacement while falling');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 0, 26, 34, 18, 26);
  rect(e, 1, 26, 34, 18, 26);
  let ok = true, lastDelta = 0;
  for (let i = 0; i < 12; i++) {
    step(e, 1);
    const fg = bbox(e.getGrid(), 20, 40, 18, ROWS), bg = bbox(e.getGridBg(), 20, 40, 18, ROWS);
    lastDelta = fg.minY - bg.minY;
    if (fg.n === 0 || bg.n === 0 || lastDelta !== 0) ok = false;
  }
  check('bonded fg/bg pieces stayed aligned during fall', ok, `(final delta ${lastDelta})`);
}

// 18. A collision under only one layer stops the whole bonded assembly instead of
//     letting the other layer continue through empty space.
{
  console.log('cross-layer support: one-layer obstacle stops bonded assembly');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 0, 26, 34, 18, 24);
  rect(e, 1, 26, 34, 18, 24);
  rect(e, 0, 26, 34, 31, ROWS); // foreground-only grounded obstacle
  step(e, 40);
  const fg = bbox(e.getGrid(), 26, 34, 18, 31), bg = bbox(e.getGridBg(), 26, 34, 18, 31);
  check('foreground piece stopped above the obstacle', fg.maxY === 30, `(maxY ${fg.maxY})`);
  check('background piece stopped with the foreground', bg.maxY === 30, `(maxY ${bg.maxY})`);
}

// 19. Seeded, slightly irregular cuts reproduce the hand-drawn separation case:
//     carve one layer, let it sleep while cross-supported, then carve the other
//     with different edge noise. Both bonded slabs must still fall together.
{
  console.log('cross-layer support: seeded irregular cuts keep bonded slabs together');
  const rand = (seed) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let ok = true, details = [];
  for (const seed of [0x51a7e, 0x9e3779b9, 0x12345678]) {
    const e = mk();
    e.setBgEnabled(true);
    const fillBridge = (layer) => {
      rect(e, layer, 8, 52, 15, 30);
      rect(e, layer, 8, 14, 30, ROWS);
      rect(e, layer, 46, 52, 30, ROWS);
    };
    const noisyCuts = (layer, s) => {
      const r = rand(s);
      for (const [a, b] of [[18, 22], [38, 42]]) {
        for (let y = 12; y < 33; y++) {
          const drift = Math.floor(r() * 3) - 1;
          for (let x = a + drift; x < b + drift; x++) e.eraseDiscLayer(layer, x, y, 0);
          if (r() < 0.35) e.eraseDiscLayer(layer, a - 1 + drift, y, 0);
          if (r() < 0.35) e.eraseDiscLayer(layer, b + drift, y, 0);
        }
      }
    };
    const slab = (grid) => bbox(grid, 24, 36, 15, ROWS);
    fillBridge(0); fillBridge(1);
    const b0 = slab(e.getGrid()), b1 = slab(e.getGridBg());
    noisyCuts(0, seed); step(e, 30);
    noisyCuts(1, seed ^ 0xa5a5a5a5); step(e, 90);
    const fg = slab(e.getGrid()), bg = slab(e.getGridBg());
    const fgDy = fg.minY - b0.minY, bgDy = bg.minY - b1.minY;
    const pass = fgDy > 8 && bgDy > 8 && fgDy === bgDy;
    if (!pass) ok = false;
    details.push(`${seed.toString(16)}:${fgDy}/${bgDy}`);
  }
  check('seeded irregular cut slabs fell with identical displacement', ok, `(${details.join(', ')})`);
}

// 14. Liquids cross layers into space the player digs out. A sealed foreground
//     basin of water with a SOLID background behind it; digging a background drain
//     shaft (background-only, no foreground action) must let the water pour into
//     the new channel on its own AND the scene must re-settle to inert (no churn).
{
  console.log('liquid drains into a dug-out background channel + re-settles');
  const e = mk();
  e.setBgEnabled(true);
  const cx = 30, W = 4, top = 30, floorY = 50;
  // fg basin: U of registered stone (walls + floor)
  for (let y = top - 1; y <= floorY; y++) { e.paintDiscLayer(0, cx - W - 1, y, 0, MAT.STONE, true); e.paintDiscLayer(0, cx + W + 1, y, 0, MAT.STONE, true); }
  for (let x = cx - W - 1; x <= cx + W + 1; x++) e.paintDiscLayer(0, x, floorY, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  // bg: solid registered block behind the basin and below (so water can't cross yet)
  for (let x = cx - W - 1; x <= cx + W + 1; x++) for (let y = top - 1; y <= ROWS - 1; y++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(1);
  // fill + settle the basin
  for (let y = top; y <= floorY - 1; y++) for (let x = cx - W; x <= cx + W; x++) e.paintDiscLayer(0, x, y, 0, MAT.WATER, true);
  let t = 0; for (let i = 0; i < 2000; i++) { t += 16; if (!e.step(t)) break; }
  const fg0 = countIn(e.getGrid(), MAT.WATER);
  check('foreground basin water settled', fg0 > 30, `(${fg0})`);
  const bgWaterBelow = () => { const g = e.getGridBg(); let n = 0; for (let y = floorY; y < ROWS; y++) for (let x = cx - 6; x <= cx + 6; x++) if (g[y * COLS + x] === MAT.WATER) n++; return n; };
  check('no background water before the dig', bgWaterBelow() === 0);
  // dig a BACKGROUND drain shaft (RMB eraser path = background-only)
  e.setTool(T.eraser);
  for (let y = floorY; y <= ROWS - 2; y++) { e.pointerDown(cx, y, 2); e.applyTool(cx, y, (t += 50), true, true); e.pointerUp(2); e.pointerButtons(0); }
  // step with NO foreground interaction
  for (let i = 0; i < 400; i++) { t += 16; e.step(t); }
  const bgDrained = bgWaterBelow(), fgLeft = countIn(e.getGrid(), MAT.WATER);
  check('water poured into the dug background channel on its own', bgDrained > 10, `(${bgDrained})`);
  check('foreground basin drained', fgLeft < fg0, `(${fg0} -> ${fgLeft})`);
  let settledAt = -1; for (let i = 0; i < 2500; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check('drained scene re-settles to inert (no churn)', settledAt >= 0, `(step ${settledAt})`);
}

// 15. Cross-layer two-fluid: a foreground water column stuck above a background OIL
//     column (with open background below it) drains into the background, displacing
//     the lighter oil — conserved, no oscillation, settles to inert.
{
  console.log('cross-layer: fg water drains through/displaces bg oil (two-fluid)');
  const e = mk();
  e.setBgEnabled(true);
  const cx = 30, hw = 2, fy = 40;
  stoneFloor(e, 1, cx, 70, hw);                                   // deep bg floor -> open space below the bg oil
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = fy; y <= fy + 6; y++) e.paintDiscLayer(1, x, y, 0, MAT.OIL, true); // bg oil column (3 wide)
  stoneFloor(e, 0, cx, fy + 7, hw);                              // fg floor just below the water -> water stuck in fg
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = fy; y <= fy + 6; y++) e.paintDisc(x, y, 0, MAT.WATER, true);       // fg water column (3 wide)
  const water = () => countIn(e.getGrid(), MAT.WATER) + countIn(e.getGridBg(), MAT.WATER);
  const oil = () => countIn(e.getGrid(), MAT.OIL) + countIn(e.getGridBg(), MAT.OIL);
  const w0 = water(), o0 = oil();
  let settledAt = -1; for (let i = 0; i < 800; i++) { if (!e.step(16 * (i + 1))) { settledAt = i; break; } }
  check('water + oil conserved across layers', water() === w0 && oil() === o0 && w0 > 0 && o0 > 0, `(w ${w0}->${water()}, o ${o0}->${oil()})`);
  check('foreground water reached the background (drained past the oil)', countIn(e.getGridBg(), MAT.WATER) > 0);
  check(`cross-layer two-fluid scene settles to inert (no oscillation, step ${settledAt})`, settledAt >= 0);
}

// 16. Cross-layer powder-vs-liquid swap: a foreground LAVA column stuck directly
//     above a background SAND column (with open background below it). Lava (2.8) is
//     denser than sand (1.6), so the generic loose-density swap fires across layers:
//     lava sinks into the background, sand rises into the foreground — conserved, no
//     oscillation, settles to inert. This is the powder-OR-liquid generalization of
//     the liquid-vs-liquid swap (case 15): the actor is a liquid, the target a powder.
{
  console.log('cross-layer: fg lava displaces bg sand (powder vs liquid, density)');
  const e = mk();
  e.setBgEnabled(true);
  const cx = 30, fy = 40;
  stoneFloor(e, 1, cx, 70, 2);                                    // deep bg floor -> open space below the bg sand
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = fy; y <= fy + 6; y++) e.paintDiscLayer(1, x, y, 0, MAT.SAND, true); // bg sand column (3 wide)
  stoneFloor(e, 0, cx, fy + 7, 2);                               // fg floor just below the lava -> lava stuck in fg
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = fy; y <= fy + 6; y++) e.paintDisc(x, y, 0, MAT.LAVA, true);        // fg lava column (3 wide)
  const lava = () => countIn(e.getGrid(), MAT.LAVA) + countIn(e.getGridBg(), MAT.LAVA);
  const sand = () => countIn(e.getGrid(), MAT.SAND) + countIn(e.getGridBg(), MAT.SAND);
  const l0 = lava(), s0 = sand();
  let settledAt = -1; for (let i = 0; i < 1200; i++) { if (!e.step(16 * (i + 1))) { settledAt = i; break; } }
  check('lava + sand conserved across layers', lava() === l0 && sand() === s0 && l0 > 0 && s0 > 0, `(lava ${l0}->${lava()}, sand ${s0}->${sand()})`);
  check('foreground lava reached the background (displaced the sand)', countIn(e.getGridBg(), MAT.LAVA) > 0, `(bg lava ${countIn(e.getGridBg(), MAT.LAVA)})`);
  check('sand rose into the foreground (swapped up)', countIn(e.getGrid(), MAT.SAND) > 0, `(fg sand ${countIn(e.getGrid(), MAT.SAND)})`);
  check(`cross-layer powder/liquid swap settles to inert (no oscillation, step ${settledAt})`, settledAt >= 0);
}

// 17. Cross-layer powder-vs-liquid swap, the other ordering: a foreground SAND
//     column stuck directly above a background WATER column. Sand (1.6) is denser
//     than water (1.0), so the generic swap fires: sand sinks into the background,
//     water rises into the foreground — conserved, settles to inert.
{
  console.log('cross-layer: fg sand displaces bg water (powder vs liquid, density)');
  const e = mk();
  e.setBgEnabled(true);
  const cx = 30, fy = 40;
  stoneFloor(e, 1, cx, 70, 2);                                    // deep bg floor -> open space below the bg water
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = fy; y <= fy + 6; y++) e.paintDiscLayer(1, x, y, 0, MAT.WATER, true); // bg water column (3 wide)
  stoneFloor(e, 0, cx, fy + 7, 2);                               // fg floor just below the sand -> sand stuck in fg
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = fy; y <= fy + 6; y++) e.paintDisc(x, y, 0, MAT.SAND, true);         // fg sand column (3 wide)
  const sand = () => countIn(e.getGrid(), MAT.SAND) + countIn(e.getGridBg(), MAT.SAND);
  const water = () => countIn(e.getGrid(), MAT.WATER) + countIn(e.getGridBg(), MAT.WATER);
  const s0 = sand(), w0 = water();
  let settledAt = -1; for (let i = 0; i < 1200; i++) { if (!e.step(16 * (i + 1))) { settledAt = i; break; } }
  check('sand + water conserved across layers', sand() === s0 && water() === w0 && s0 > 0 && w0 > 0, `(sand ${s0}->${sand()}, water ${w0}->${water()})`);
  check('foreground sand reached the background (displaced the water)', countIn(e.getGridBg(), MAT.SAND) > 0, `(bg sand ${countIn(e.getGridBg(), MAT.SAND)})`);
  check(`cross-layer sand/water swap settles to inert (no oscillation, step ${settledAt})`, settledAt >= 0);
}

// Worldgen trees spawn in the BACKGROUND only. Tree trunks are WOOD (the only
// worldgen WOOD source; surface grass is PLANT, so count WOOD to isolate trees).
// Manual placement is a separate path and is unaffected.
{
  console.log('worldgen: trees only in the background');
  const woodIn = (g) => countIn(g, MAT.WOOD);
  let fgWood = 0, bgWood = 0, sawTrees = false;
  for (const seed of [0x55aa55, 0x9e3779b9, 0x777, 0x1234]) {
    const e = createEngineWasm({ cols: 256, rows: 256, worldSeed: seed >>> 0, sinksOn: false, infinite: true });
    const fw = woodIn(e.getGrid()), bw = woodIn(e.getGridBg());
    fgWood += fw; bgWood += bw; if (bw > 0) sawTrees = true;
    e.destroy();
  }
  check('a tree-bearing seed generated trees in the background', sawTrees, `(bg WOOD ${bgWood})`);
  check('no worldgen tree trunks in the foreground', fgWood === 0, `(fg WOOD ${fgWood})`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
