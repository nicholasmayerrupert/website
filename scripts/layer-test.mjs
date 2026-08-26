// Tests for the two-layer engine (foreground + background) and the cross-layer
// powder/liquid transfer. Runs headless in Node. Run with:
//   node scripts/layer-test.mjs

import { initSandWasm, createEngineWasm, MAT, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { MF, MAT_FLAGS } from '../src/sand/materials.generated.js';
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

// A cross-layer write is authoritative world state in both layers. Streaming the
// destination tile away and back must restore the transferred material instead
// of the procedural background that was cached before the transfer.
{
  console.log('transfer: background destination survives streaming');
  const cols = 256, rows = 256, x = 48, y = 48;
  const e = createEngineWasm({ cols, rows, worldSeed: 2, sinksOn: false, infinite: true });
  e.setBgEnabled(true);
  for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) {
    e.paintDiscLayer(0, xx, yy, 0, MAT.EMPTY, true);
    e.paintDiscLayer(1, xx, yy, 0, MAT.EMPTY, true);
  }
  for (let yy = y + 1; yy < rows; yy++) for (let xx = x - 1; xx <= x + 1; xx++)
    e.paintDiscLayer(0, xx, yy, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  e.paintDiscLayer(0, x, y, 0, MAT.SAND, true);
  e.stepWorld();
  check('stream fixture transferred into background',
    e.getGrid()[y * cols + x] === MAT.EMPTY
      && e.getGridBg()[y * cols + x] === MAT.SAND);
  e.shiftWorldXY(128, 0);
  e.shiftWorldXY(-128, 0);
  check('streaming restores the transferred background cell',
    e.getGridBg()[y * cols + x] === MAT.SAND);
  e.destroy();
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

// 6. A presentation mirror receives only per-tick dirty chunks. Falling tree
// tips must not be left behind when the authority's ping-pong grids converge.
{
  console.log('presentation diff: falling worldgen trees clear vacated tips');
  const opts = { cols: 160, rows: 100, worldSeed: 168, sinksOn: false, infinite: true };
  const host = createEngineWasm({ ...opts, storageRole: 'authority' });
  const mirror = createEngineWasm({ ...opts, storageRole: 'presentation' });
  mirror.applyWorldMirror(host.serializeWorld(), host.getWorldOffsetX(), host.getWorldOffsetY());
  host.consumeReplicaDirty(); mirror.resetDirty();
  let mismatch = null;
  for (let i = 0; i < 20 && !mismatch; i++) {
    host.step(16 * (i + 1));
    mirror.applyDiffMirror(host.serializeDiff());
    host.consumeReplicaDirty();
    const grids = [[host.getGrid(), mirror.getGrid(), 'fg'], [host.getGridBg(), mirror.getGridBg(), 'bg']];
    for (const [authoritative, presented, layer] of grids) {
      const cell = authoritative.findIndex((v, k0) => v !== presented[k0]);
      if (cell >= 0) { mismatch = { tick: i + 1, layer, cell, authoritative: authoritative[cell], presented: presented[cell] }; break; }
    }
  }
  check('falling tree diffs keep the presentation grid synchronized', mismatch === null, mismatch && `(${JSON.stringify(mismatch)})`);
  host.destroy(); mirror.destroy();
}

// 6c. The initial infinite-world buffer can clip tall generated foliage at its
// top edge. That edge is deterministic open sky here, so crown leaves must not
// inherit unloaded-world support and pin a non-physical outline in place. Stone
// and wood structures retain the general streamed-edge support rule.
{
  console.log('worldgen tree crowns are not grounded by an open-sky top edge');
  const cols = 200, rows = 120;
  const e = createEngineWasm({ cols, rows, worldSeed: 6, sinksOn: false, infinite: true });
  const plantStats = () => {
    const grid = e.getGridBg();
    let n = 0, top = rows, topEdge = 0;
    for (let cell = 0; cell < grid.length; cell++) {
      if ((MAT_FLAGS[grid[cell]] & MF.plantFamily) === 0) continue;
      const y = (cell / cols) | 0;
      n++; top = Math.min(top, y);
      if (y <= 1) topEdge++;
    }
    return { n, top, topEdge };
  };
  const before = plantStats();
  step(e, 12);
  const after = plantStats();
  check('fixture starts with a crown clipped by the top edge',
    before.n > 0 && before.top === 0 && before.topEdge > 0,
    `(${before.n} cells, ${before.topEdge} at edge)`);
  check('open-sky crown falls without leaving its top outline',
    after.n === before.n && after.top > before.top && after.topEdge === 0,
    `(${before.top}/${before.n} -> ${after.top}/${after.n}, edge ${after.topEdge})`);
  e.destroy();

  const supported = createEngineWasm({ cols, rows, worldSeed: 14, sinksOn: false, infinite: true });
  const stoneX = 80, woodX = 120, topRow = 1;
  supported.paintDiscLayer(0, stoneX, topRow, 0, MAT.STONE, true);
  supported.paintDiscLayer(0, woodX, topRow, 0, MAT.WOOD, true);
  supported.syncComponentsLayer(0);
  step(supported, 12);
  const fg = supported.getGrid();
  check('open-sky edge support remains intact for streamed structures',
    fg[topRow * cols + stoneX] === MAT.STONE && fg[topRow * cols + woodX] === MAT.WOOD,
    `(stone ${fg[topRow * cols + stoneX]}, wood ${fg[topRow * cols + woodX]})`);
  supported.destroy();
}

// 6d. Streaming translates both ping-pong grids and the registered components.
// The previous-component footprint used by carry must move with them as well:
// otherwise a falling streamed tree can leave an unregistered crown pixel that
// reaches the presentation mirror for one frame before a later dirty rect clears it.
{
  console.log('presentation diff: streamed falling trees clear vacated crowns');
  const opts = { cols: 160, rows: 100, worldSeed: 10, sinksOn: false, infinite: true };
  const host = createEngineWasm({ ...opts, storageRole: 'authority' });
  const mirror = createEngineWasm({ ...opts, storageRole: 'presentation' });
  mirror.applyWorldMirror(host.serializeWorld(), host.getWorldOffsetX(), host.getWorldOffsetY());
  host.consumeReplicaDirty(); mirror.resetDirty();

  host.shiftWorldXY(-32, 0);
  mirror.applyWorldMirror(host.serializeWorld(), host.getWorldOffsetX(), host.getWorldOffsetY());
  host.consumeReplicaDirty(); mirror.resetDirty();

  let mismatch = null, pineMoved = false;
  let previousBg = Uint8Array.from(host.getGridBg());
  const pineBefore = countIn(previousBg, MAT.PINE_NEEDLES);
  for (let i = 0; i < 12 && !mismatch; i++) {
    host.step(16 * (i + 1));
    const currentBg = host.getGridBg();
    pineMoved = pineMoved || currentBg.some((m, k0) =>
      m !== previousBg[k0] && (m === MAT.PINE_NEEDLES || previousBg[k0] === MAT.PINE_NEEDLES));
    mirror.applyDiffMirror(host.serializeDiff());
    host.consumeReplicaDirty();
    const grids = [[host.getGrid(), mirror.getGrid(), 'fg'], [currentBg, mirror.getGridBg(), 'bg']];
    for (const [authoritative, presented, layer] of grids) {
      const cell = authoritative.findIndex((v, k0) => v !== presented[k0]);
      if (cell >= 0) { mismatch = { tick: i + 1, layer, cell, authoritative: authoritative[cell], presented: presented[cell] }; break; }
    }
    previousBg = Uint8Array.from(currentBg);
  }
  check('streamed fixture contains pine foliage', pineBefore > 0, `(${pineBefore})`);
  check('streamed pine foliage moves after the shift', pineMoved);
  check('streamed falling tree diffs keep the presentation grid synchronized',
    mismatch === null, mismatch && `(${JSON.stringify(mismatch)})`);
  host.destroy(); mirror.destroy();
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

// 14. Component-bond support: any same-(x,y) rigid contact transmits support.
//     A small connected overlap patch holds a large block on the other layer.
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

// 15. A single contact cell is enough: if either piece is supported, both are.
//     (Old size/fraction heuristics used to drop large blocks on 1-cell overlap.)
{
  console.log('cross-layer support: one-cell overlap supports a large block');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 0, 30, 40, 30, 40);
  rect(e, 1, 29, 30, 30, ROWS); // grounded path outside the fg block
  e.paintDiscLayer(1, 30, 30, 0, MAT.STONE, true); e.syncComponentsLayer(1); // one supported overlap cell
  const before = bbox(e.getGrid(), 30, 40, 30, 45);
  step(e, 80);
  const after = bbox(e.getGrid(), 30, 40, 30, 45);
  check('large fg block stayed supported by one-cell overlap', after.n === before.n && after.minY === before.minY, `(top ${before.minY} -> ${after.minY}, cells ${before.n}->${after.n})`);
}

// 15b. A tiny (1-3 cell) fg chunk fully backed by grounded background solid stays
//      supported via any-contact cross-layer bonds.
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

// 15c. User repro: long background stone held by a ONE-CELL foreground contact;
//      acid (or erase) eats the background FAR from the intersection. Any contact
//      must keep the whole beam supported — the old MIN_CELLS/AREA_FRAC heuristics
//      dropped large pieces when the overlap patch was small.
{
  console.log('cross-layer support: far-side dissolve keeps one-cell-supported bg beam');
  const e = mk();
  e.setBgEnabled(true);
  // Grounded fg pillar top meets the beam at exactly one cell (12,45).
  // Beam is y in [42,46); pillar starts at y=45 so co-occupation is only (12,45).
  rect(e, 0, 12, 13, 45, ROWS);
  rect(e, 1, 12, 45, 42, 46); // long 33×4 beam
  const before = bbox(e.getGridBg(), 12, 45, 42, 46);
  step(e, 30);
  const settled = bbox(e.getGridBg(), 12, 45, 42, 46);
  check('bg beam starts supported by one-cell fg contact', settled.n === before.n && settled.minY === before.minY,
    `(top ${before.minY} -> ${settled.minY}, cells ${before.n}->${settled.n})`);
  // Deterministic far-side carve (same topology change acid produces, without RNG):
  // erase the right end of the beam, well away from x=12 contact.
  for (let y = 42; y < 46; y++) for (let x = 38; x < 45; x++) e.eraseDiscLayer(1, x, y, 0);
  step(e, 80);
  const afterErase = bbox(e.getGridBg(), 12, 38, 42, 50);
  check('bg beam stayed up after far-side erase', afterErase.n > 15 && afterErase.minY <= settled.minY + 1,
    `(top ${settled.minY} -> ${afterErase.minY}, cells ${afterErase.n})`);
  // Acid also at the far end of whatever remains — contact must still hold.
  for (let i = 0; i < 12; i++) e.paintDiscLayer(1, 36, 41, 1, MAT.ACID, true);
  step(e, 300);
  const afterAcid = bbox(e.getGridBg(), 12, 38, 42, 55);
  check('bg beam still present after far-side acid', afterAcid.n > 10, `(cells ${afterAcid.n})`);
  check('bg beam did not fall through after far-side acid', afterAcid.minY <= settled.minY + 1,
    `(top ${settled.minY} -> ${afterAcid.minY})`);
}

// 15d. Control for 15c: without the foreground pillar the same beam falls.
{
  console.log('cross-layer support: unsupported bg beam falls (control)');
  const e = mk();
  e.setBgEnabled(true);
  rect(e, 1, 12, 45, 42, 46);
  const before = bbox(e.getGridBg(), 12, 45, 42, 46);
  step(e, 120);
  const after = bbox(e.getGridBg(), 12, 45, 42, ROWS);
  check('unsupported bg beam fell', after.minY > before.minY + 4, `(top ${before.minY} -> ${after.minY})`);
}

// 15f. Dual-layer stone that loses support becomes one shared-pose body and
//      accelerates smoothly even while acid is still dissolving cells.
{
  console.log('cross-layer support: dual-layer slab falls smoothly after acid cuts support');
  const C = 80, R = 60;
  const e = createEngineWasm({ cols: C, rows: R, infinite: false, sinksOn: false, worldSeed: 1 });
  e.setBgEnabled(true);
  const kk = (x, y) => y * C + x;
  // Floor both layers.
  for (let y = R - 3; y < R; y++) for (let x = 0; x < C; x++) {
    e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  // Dual-layer slab at y=20..27, held by a dual-layer pillar at x=10..14 down to floor.
  for (let y = 20; y < 28; y++) for (let x = 20; x < 50; x++) {
    e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  for (let y = 28; y < R - 3; y++) for (let x = 10; x < 15; x++) {
    e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  // Connect pillar to slab.
  for (let y = 20; y < 28; y++) for (let x = 10; x < 20; x++) {
    e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  e.syncComponentsLayer(0); e.syncComponentsLayer(1);
  step(e, 30);
  const slabTop = () => {
    const g = e.getGrid();
    let minY = R;
    for (let y = 0; y < R - 3; y++) for (let x = 20; x < 50; x++) if (g[kk(x, y)] === MAT.STONE && y < minY) minY = y;
    return minY;
  };
  const t0 = slabTop();
  check('dual-layer slab starts supported', t0 === 20, `(top ${t0})`);
  // Cut the pillar with continuous acid (both layers) so support dies while acid is active.
  for (let i = 0; i < 500; i++) {
    if (i % 2 === 0) {
      e.paintDiscLayer(0, 12, 35, 2, MAT.ACID, true);
      e.paintDiscLayer(1, 12, 35, 2, MAT.ACID, true);
    }
    e.step(16 * (i + 1));
  }
  const t1 = slabTop();
  check('dual-layer slab fell after pillar cut', t1 > t0 + 8, `(top ${t0} -> ${t1})`);

  // Fresh scene: instantaneous pillar erase, measure fall cadence.
  // While falling, keep acid active nearby (jointDirty every few steps) — the
  // stutter bug skipped moveCrossLayer on every acid step.
  const e2 = createEngineWasm({ cols: C, rows: R, infinite: false, sinksOn: false, worldSeed: 2 });
  e2.setBgEnabled(true);
  for (let y = R - 3; y < R; y++) for (let x = 0; x < C; x++) {
    e2.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e2.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  for (let y = 15; y < 25; y++) for (let x = 25; x < 55; x++) {
    e2.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e2.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  for (let y = 25; y < R - 3; y++) for (let x = 30; x < 35; x++) {
    e2.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e2.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  e2.syncComponentsLayer(0); e2.syncComponentsLayer(1);
  step(e2, 20);
  for (let y = 25; y < R - 3; y++) for (let x = 30; x < 35; x++) {
    e2.eraseDiscLayer(0, x, y, 0);
    e2.eraseDiscLayer(1, x, y, 0);
  }
  const top2 = () => {
    const g = e2.getGrid();
    let minY = R;
    for (let y = 0; y < R - 3; y++) for (let x = 25; x < 55; x++) if (g[kk(x, y)] === MAT.STONE && y < minY) minY = y;
    return minY;
  };
  let prev = top2();
  const deltas = [];
  for (let i = 0; i < 40; i++) {
    // Acid off to the side (not eating the slab top, which would fake stalls).
    if (i % 2 === 0) {
      e2.paintDiscLayer(0, 10, 40, 2, MAT.ACID, true);
      e2.paintDiscLayer(1, 10, 40, 2, MAT.ACID, true);
    }
    e2.step(16 * (i + 1));
    const t = top2();
    deltas.push(t - prev);
    prev = t;
    if (t >= R - 6) break; // near floor
  }
  // Mid-air prefix: stop at the first zero after we've already dropped several cells.
  let dropped = 0;
  const air = [];
  for (const d of deltas) {
    if (d === 0 && dropped >= 10) break;
    air.push(d);
    dropped += d;
  }
  check('dual-layer free-fall made progress', dropped >= 15, `(cells dropped ${dropped}, airSteps ${air.length})`);
  // A rotating body's topmost raster row can move back by one cell even while
  // its centre of mass continues downward.
  check('dual-layer body trace has only bounded raster corrections',
    air.every((d) => d >= -1), `(deltas ${air.slice(0, 24).join(',')})`);
  check('dual-layer body accelerates after release',
    air.some((d) => d > 1), `(deltas ${air.slice(0, 24).join(',')})`);
  e2.destroy();
  e.destroy();
}

// Acid cutting the middle of a background beam must not disturb its remote
// three-column support bond to grounded foreground terrain.
{
  console.log('cross-layer support: mid-beam acid does not drop 3-col-overlap bg slab');
  const C = 220, R = 80;
  const e = createEngineWasm({ cols: C, rows: R, infinite: false, sinksOn: false, worldSeed: 1 });
  e.setBgEnabled(true);
  const kk = (x, y) => y * C + x;
  const bgTop = () => {
    const g = e.getGridBg();
    let minY = R, n = 0;
    // Only the elevated slab (above the floor band).
    for (let y = 0; y < 50; y++) for (let x = 117; x < 217; x++) if (g[kk(x, y)] === MAT.STONE) { n++; if (y < minY) minY = y; }
    return { minY, n };
  };
  // FG floor (so transferred acid has somewhere to pool / dissolve — the real-play path).
  for (let y = 50; y < R; y++) for (let x = 0; x < C; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  // FG 100×5 at y=30..34, connected to the floor by a thin column far from overlap.
  for (let y = 30; y < 35; y++) for (let x = 20; x < 120; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  for (let y = 35; y < 50; y++) for (let x = 25; x < 28; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  // BG 100×5; overlap only x=117,118,119 (3 columns × 5 rows).
  for (let y = 30; y < 35; y++) for (let x = 117; x < 217; x++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(1);
  step(e, 40);
  const settled = bgTop();
  check('bg slab starts supported (3-col overlap)', settled.minY === 30 && settled.n === 500, `(top ${settled.minY}, n ${settled.n})`);
  // Continuous acid drip mid-BG (x=167), far from the x=117..119 contact.
  // Acid transfers into empty FG cells and pools on the FG floor — that used to
  // clear jointGroundReady mid-step before BG moved.
  for (let i = 0; i < 400; i++) {
    if (i % 3 === 0) e.paintDiscLayer(1, 167, 28, 1, MAT.ACID, true);
    e.step(16 * (i + 1));
  }
  const after = bgTop();
  // May lose cells to acid, but the slab must not creep down / free-fall.
  check('bg slab still at original height after mid-beam acid', after.minY === settled.minY,
    `(top ${settled.minY} -> ${after.minY}, n ${settled.n}->${after.n})`);
  check('bg slab mostly intact (not free-fallen to floor)', after.n > 300 && after.minY < 40,
    `(n ${after.n}, top ${after.minY})`);
  e.destroy();
}

// Erasing every foreground contact wakes the newly unsupported background beam.
{
  console.log('cross-layer support: erase FG contact wakes unsupported bg beam');
  const C = 220, R = 80;
  const e = createEngineWasm({ cols: C, rows: R, infinite: false, sinksOn: false, worldSeed: 1 });
  e.setBgEnabled(true);
  const kk = (x, y) => y * C + x;
  const bgTop = () => {
    const g = e.getGridBg();
    let minY = R, n = 0;
    for (let y = 0; y < 50; y++) for (let x = 115; x < 215; x++) if (g[kk(x, y)] === MAT.STONE) {
      n++; if (y < minY) minY = y;
    }
    return { minY, n };
  };
  for (let y = 50; y < R; y++) for (let x = 0; x < C; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  for (let y = 30; y < 35; y++) for (let x = 20; x < 120; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  for (let y = 35; y < 50; y++) for (let x = 25; x < 28; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
  for (let y = 30; y < 35; y++) for (let x = 115; x < 215; x++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(1);
  step(e, 40);
  const settled = bgTop();
  check('bg beam starts supported before contact erase', settled.minY === 30 && settled.n === 500,
    `(top ${settled.minY}, n ${settled.n})`);
  // Remove every FG cell in the 5×5 co-occupation patch; leave BG untouched.
  for (let y = 30; y < 35; y++) for (let x = 115; x < 120; x++) e.eraseDiscLayer(0, x, y, 0);
  step(e, 8);
  const after = bgTop();
  check('bg beam falls within a few steps after FG contact erase', after.minY >= settled.minY + 2,
    `(top ${settled.minY} -> ${after.minY})`);
  check('bg beam still has most of its stone while falling', after.n > 400,
    `(n ${after.n})`);
  e.destroy();
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
  cutBridge(1); step(e, 8);
  const fg = slab(e.getGrid()), bg = slab(e.getGridBg());
  check('foreground accelerates after both supports are cut', fg.minY > b0.minY, `(top ${b0.minY} -> ${fg.minY})`);
  check('sleeping background wakes with the foreground', bg.minY > b1.minY, `(top ${b1.minY} -> ${bg.minY})`);
  check('early layer displacement remains close',
    Math.abs((fg.minY - b0.minY) - (bg.minY - b1.minY)) <= 1,
    `(fg ${fg.minY - b0.minY}, bg ${bg.minY - b1.minY})`);
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

// 20. Fully overlapping ice is a normal cross-layer joint. A large irregular
//     raft must use combined buoyancy, rise in lockstep, and settle without a
//     one-cell alternating shimmer.
{
  console.log('bonded cross-layer ice rises and settles in lockstep');
  const C = 100, R0 = 110;
  const e = createEngineWasm({
    cols: C, rows: R0, infinite: false, sinksOn: false, worldSeed: 1,
  });
  e.setBgEnabled(true);
  const L = 12, R = 88, top = 12, floorY = 98;
  const fillRect = (layer, mat, x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDiscLayer(layer, x, y, 0, mat, true);
  };
  const matBounds = (grid, mat) => {
    let n = 0, minY = R0, maxY = -1;
    for (let i = 0; i < grid.length; i++) if (grid[i] === mat) { const y = (i / C) | 0; n++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { n, minY, maxY };
  };
  for (const layer of [0, 1]) {
    fillRect(layer, MAT.BRICK, L, L, top, floorY);
    fillRect(layer, MAT.BRICK, R, R, top, floorY);
    fillRect(layer, MAT.BRICK, L, R, floorY, R0 - 1);
    e.syncComponentsLayer(layer);
    fillRect(layer, MAT.BRINE, L + 1, R - 1, 24, floorY - 1);
    fillRect(layer, MAT.ICE, 27, 73, 65, 68);
    for (let x = 30; x <= 70; x++) fillRect(layer, MAT.ICE, x, x, 69, 69 + ((x * 5) % 4));
    for (let y = 69; y <= 88; y++) {
      const cx = 50 + Math.round(Math.sin(y * 0.8) * 2);
      fillRect(layer, MAT.ICE, cx - 2, cx + 2, y, y);
    }
    e.syncComponentsLayer(layer);
  }
  const fgBefore = matBounds(e.getGrid(), MAT.ICE), bgBefore = matBounds(e.getGridBg(), MAT.ICE);
  const reservoirSurface = (grid) => {
    const tops = [];
    for (let x = L + 1; x < R; x++) {
      let hasIce = false, topY = R0;
      for (let y = 1; y < floorY; y++) {
        const m = grid[y * C + x];
        if (m === MAT.ICE) hasIce = true;
        if (m === MAT.BRINE) topY = Math.min(topY, y);
      }
      if (!hasIce && topY < R0) tops.push(topY);
    }
    tops.sort((a, b) => a - b);
    return tops[(tops.length / 2) | 0];
  };
  const ys = [fgBefore.minY]; let aligned = fgBefore.minY === bgBefore.minY && fgBefore.maxY === bgBefore.maxY;
  let eruptedBrine = 0;
  let t = 0;
  for (let i = 0; i < 1000; i++) {
    const previousFg = Uint8Array.from(e.getGrid()), previousBg = Uint8Array.from(e.getGridBg());
    const fgSurface = reservoirSurface(previousFg), bgSurface = reservoirSurface(previousBg);
    t += 16; e.step(t);
    const currentFg = e.getGrid(), currentBg = e.getGridBg();
    for (let k = 0; k < currentFg.length; k++) {
      const y = (k / C) | 0;
      if (previousFg[k] === MAT.ICE && currentFg[k] === MAT.BRINE && y < fgSurface - 1) eruptedBrine++;
      if (previousBg[k] === MAT.ICE && currentBg[k] === MAT.BRINE && y < bgSurface - 1) eruptedBrine++;
    }
    const fg = matBounds(currentFg, MAT.ICE), bg = matBounds(currentBg, MAT.ICE);
    ys.push(fg.minY);
    if (fg.n !== bg.n || fg.minY !== bg.minY || fg.maxY !== bg.maxY) aligned = false;
  }
  const fgIce = matBounds(e.getGrid(), MAT.ICE), bgIce = matBounds(e.getGridBg(), MAT.ICE);
  let reversals = 0, lastDir = 0;
  for (let i = 1; i < ys.length; i++) {
    const dir = Math.sign(ys[i] - ys[i - 1]);
    if (dir && lastDir && dir !== lastDir) reversals++;
    if (dir) lastDir = dir;
  }
  const tail = ys.slice(-120);
  let tailTransitions = 0;
  for (let i = 1; i < tail.length; i++)
    if (tail[i] !== tail[i - 1]) tailTransitions++;
  const tailSpan = Math.max(...tail) - Math.min(...tail);
  check('bonded ice started aligned and non-empty', fgBefore.minY === bgBefore.minY && fgBefore.n > 0);
  check('bonded ice rose toward the surface', fgIce.minY < fgBefore.minY - 20,
    `(fg ${fgBefore.minY}-${fgBefore.maxY} -> ${fgIce.minY}-${fgIce.maxY})`);
  check('bonded ice stayed aligned across both layers', aligned && fgIce.n === bgIce.n);
  check(`bonded ice does not flood its top wake (${eruptedBrine} edge cells across both layers)`, eruptedBrine <= 32);
  check(`bonded ice corrections remain finite (${reversals} reversals)`, reversals <= 10);
  check(`bonded ice settles without raster shimmer (${tailSpan} row span, ${tailTransitions} tail transitions)`,
    tailSpan <= 1 && tailTransitions <= 2);
  e.destroy();
}

// 20b. Background terrain is visually behind foreground ice, not an anchor for
//      it. Mixed ice/stone co-occupation must not suppress foreground buoyancy;
//      same-material ice/ice bonding remains covered by the test above.
{
  console.log('foreground ice floats past grounded background terrain');
  const C = 100, R0 = 110;
  const e = createEngineWasm({ cols: C, rows: R0, infinite: false, sinksOn: false });
  e.setBgEnabled(true);
  const L = 12, R = 88, floorY = 98;
  const fillRect = (layer, mat, x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDiscLayer(layer, x, y, 0, mat, true);
  };
  for (const layer of [0, 1]) {
    fillRect(layer, MAT.BRICK, L, L, 12, floorY);
    fillRect(layer, MAT.BRICK, R, R, 12, floorY);
    fillRect(layer, MAT.BRICK, L, R, floorY, R0 - 1);
    e.syncComponentsLayer(layer);
    fillRect(layer, MAT.BRINE, L + 1, R - 1, 24, floorY - 1);
  }
  // Grounded only in the background, directly behind the foreground iceberg.
  fillRect(1, MAT.BRICK, 50, 50, 65, floorY);
  e.syncComponentsLayer(1);
  fillRect(0, MAT.ICE, 27, 73, 65, 75);
  e.syncComponentsLayer(0);
  const iceTop = () => {
    const grid = e.getGrid(); let top = R0, n = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] === MAT.ICE) { top = Math.min(top, (i / C) | 0); n++; }
    return { top, n };
  };
  const before = iceTop();
  step(e, 800);
  const after = iceTop();
  check('foreground ice ignored grounded background stone and rose',
    before.n === 517 && Math.abs(after.n - before.n) <= 2 && after.top < before.top - 20,
    `(top ${before.top} -> ${after.top}, cells ${after.n})`);
  e.destroy();
}

// 21. Large slanted solids displace many liquid cells at once. The displaced
//     oil/brine must be allowed to occupy the cells vacated by the descending
//     solid; otherwise a dense diagonal stone slab can pin at the liquid
//     interface despite having no solid blocker below it.
{
  console.log('large diagonal stone sinks through oil/brine stack');
  const C = 220, R0 = 150;
  const e = createEngineWasm({ cols: C, rows: R0, infinite: false, sinksOn: false });
  const L = 35, R = 185, top = 30, floorY = 122;
  const fillRect = (mat, x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDiscLayer(0, x, y, 0, mat, true);
  };
  const drawDiagonalStone = (cx, cy, len, thick, slope = 0.55) => {
    for (let i = -len; i <= len; i++) {
      const x = Math.round(cx + i), y = Math.round(cy + i * slope);
      for (let oy = -thick; oy <= thick; oy++) for (let ox = -thick; ox <= thick; ox++) {
        if (ox * ox + oy * oy <= thick * thick) e.paintDiscLayer(0, x + ox, y + oy, 0, MAT.STONE, true);
      }
    }
  };
  const matBounds = (grid, mat) => {
    let n = 0, minY = R0, maxY = -1;
    for (let i = 0; i < grid.length; i++) if (grid[i] === mat) { const y = (i / C) | 0; n++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { n, minY, maxY };
  };
  const countStoneBelowFloor = () => {
    const g = e.getGrid(); let n = 0;
    for (let y = floorY; y < R0; y++) for (let x = L + 1; x < R; x++) if (g[y * C + x] === MAT.STONE) n++;
    return n;
  };
  fillRect(MAT.BRICK, L, L, top, R0 - 1);
  fillRect(MAT.BRICK, R, R, top, R0 - 1);
  fillRect(MAT.BRICK, L, R, floorY, R0 - 1);
  e.syncComponentsLayer(0);
  fillRect(MAT.BRINE, L + 1, R - 1, floorY - 38, floorY - 1);
  fillRect(MAT.OIL, L + 1, R - 1, floorY - 70, floorY - 39);
  step(e, 40);
  drawDiagonalStone(110, 36, 38, 6);
  e.syncComponentsLayer(0);
  const before = matBounds(e.getGrid(), MAT.STONE);
  step(e, 180);
  const after = matBounds(e.getGrid(), MAT.STONE);
  check('diagonal stone was placed above the liquid stack', before.n > 1000 && before.maxY < floorY - 50, `(${before.n}, y ${before.minY}-${before.maxY})`);
  check('diagonal stone sank to the basin floor', after.maxY >= floorY - 3 && countStoneBelowFloor() === 0,
    `(stone ${before.minY}-${before.maxY} -> ${after.minY}-${after.maxY}, below floor ${countStoneBelowFloor()})`);
  e.destroy();
}

// Water crosses into a newly dug background drain and settles without churn.
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

// Foreground water displaces lighter background oil and settles without loss.
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

// Denser foreground lava swaps with lighter background sand and settles without loss.
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

// Denser foreground sand swaps with lighter background water and settles without loss.
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

// Worldgen trees spawn in the BACKGROUND only. Constructed settlements now use
// foreground timber above ground, so use canopy-exclusive tree materials rather
// than treating every WOOD cell as a trunk.
{
  console.log('worldgen: trees only in the background');
  const treeMats = new Set([MAT.PINE_NEEDLES, MAT.WILLOW_LEAF, MAT.BUSH_LEAF, MAT.CACTUS]);
  let fgTree = 0, bgTree = 0, sawTrees = false;
  for (const seed of [0x55aa55, 0x9e3779b9, 0x777, 0x1234]) {
    const e = createEngineWasm({ cols: 256, rows: 256, worldSeed: seed >>> 0, sinksOn: false, infinite: true });
    const fg = e.getGrid(), bg = e.getGridBg(), ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
    let ft = 0, bt = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      if (oy + y >= e.worldSurfaceAbsAt(ox + x)) continue;
      ft += treeMats.has(fg[y * 256 + x]);
      bt += treeMats.has(bg[y * 256 + x]);
    }
    fgTree += ft; bgTree += bt; if (bt > 0) sawTrees = true;
    e.destroy();
  }
  check('a tree-bearing seed generated canopies in the background', sawTrees, `(bg tree cells ${bgTree})`);
  check('no worldgen canopy materials in the foreground', fgTree === 0, `(fg tree cells ${fgTree})`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
