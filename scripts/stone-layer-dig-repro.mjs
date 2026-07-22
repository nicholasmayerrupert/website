// Reproducer suite for: digging a moat around overlapping foreground/background
// stone sometimes lets only one layer's detached island fall.
//
// This regression suite is part of the required headless test manifest.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';

const COLS = 96, ROWS = 96;
const T = { eraser: 11 };

await initSandWasm();

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
};

const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x51a7e, infinite: false, sinksOn: false });
const step = (e, n) => { for (let i = 0; i < n; i++) e.step(16 * (i + 1)); };
const idx = (x, y) => y * COLS + x;
let emitNow = 1000;

const stoneRect = (e, layer, x0, x1, y0, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(layer);
};

const stonePocket = (e, layer) => {
  // A grounded arch of stone with an empty chamber below the target island.
  // The arch and side pillars keep the pre-dig mass grounded; after the moat is
  // carved, the center island should drop into the chamber.
  stoneRect(e, layer, 16, 80, 24, 60);
  stoneRect(e, layer, 16, 22, 60, ROWS);
  stoneRect(e, layer, 74, 80, 60, ROWS);
};

const stoneStats = (grid, x0, x1, y0 = 0, y1 = ROWS) => {
  let n = 0, minY = ROWS, maxY = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (grid[idx(x, y)] !== MAT.STONE) continue;
    n++;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { n, minY, maxY };
};

const COMPONENT_MATS = new Set([
  MAT.STONE, MAT.ICE, MAT.DRIFTWOOD, MAT.SANDSTONE, MAT.MOSS,
  MAT.COPPER_ORE, MAT.IRON_ORE, MAT.COAL_ORE, MAT.GOLD_ORE, MAT.BRICK,
  MAT.PINE_WOOD, MAT.CACTUS, MAT.MUSH_STEM, MAT.MUSH_CAP, MAT.VINE,
  MAT.TNT, MAT.DEBRIS, MAT.CRYSTAL, MAT.MYCELIUM, MAT.MYCELIUM_SPORE,
]);

const countOneStepComponentDrops = (before, after, cols, rows) => {
  let total = 0;
  const byMat = new Map();
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols; x++) {
    const k = y * cols + x;
    const m = before[k];
    if (!COMPONENT_MATS.has(m)) continue;
    if (after[k] !== m && before[k + cols] !== m && after[k + cols] === m) {
      total++;
      byMat.set(m, (byMat.get(m) || 0) + 1);
    }
  }
  return { total, byMat };
};

const eraseDiscLayerViaPointer = (e, layer, x, y, r) => {
  const button = layer === 1 ? 2 : 0;
  e.setTool(T.eraser);
  e.pointerDown(x, y, button);
  e.applyTool(x, y, emitNow += 50, true, true);
  e.pointerUp(button);
  e.pointerButtons(0);
  // Brush radius is engine-owned; repeat nearby points for a crisp test moat.
  if (r <= 2) return;
  for (let oy = -r + 2; oy <= r - 2; oy += 2) {
    for (let ox = -r + 2; ox <= r - 2; ox += 2) {
      if (ox * ox + oy * oy > (r - 2) * (r - 2)) continue;
      e.pointerDown(x + ox, y + oy, button);
      e.applyTool(x + ox, y + oy, emitNow += 50, true, true);
      e.pointerUp(button);
      e.pointerButtons(0);
    }
  }
};

const eraseMoat = (e, layer, cx, cy, innerR, outerR, pointerPath) => {
  const outer2 = outerR * outerR;
  const inner2 = innerR * innerR;
  for (let y = cy - outerR; y <= cy + outerR; y++) {
    for (let x = cx - outerR; x <= cx + outerR; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < inner2 || d2 > outer2) continue;
      if (pointerPath) eraseDiscLayerViaPointer(e, layer, x, y, 1);
      else e.eraseDiscLayer(layer, x, y, 1);
    }
  }
};

const eraseRectCell = (e, layer, x, y, pointerPath) => {
  if (pointerPath) eraseDiscLayerViaPointer(e, layer, x, y, 0);
  else e.eraseDiscLayer(layer, x, y, 0);
};

const eraseRectMoat = (e, layer, x0, x1, y0, y1, width, pointerPath) => {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inInner = x >= x0 + width && x < x1 - width && y >= y0 + width && y < y1 - width;
      if (inInner) continue;
      eraseRectCell(e, layer, x, y, pointerPath);
    }
  }
};

const runScenario = ({ name, eraseOrder, pointerPath = false, innerR = 9, outerR = 14, steps = 90, report = true }) => {
  console.log(name);
  const e = mk();
  e.setBgEnabled(true);

  // Identical grounded stone pockets in both layers. The island starts attached
  // to the arch, then the circular moat should split it into an ungrounded
  // component with empty space below.
  for (const layer of [0, 1]) stonePocket(e, layer);
  const cx = 48, cy = 48;
  const islandX0 = cx - innerR + 1, islandX1 = cx + innerR;
  const islandY0 = cy - innerR + 1, islandY1 = cy + innerR;
  const beforeFg = stoneStats(e.getGrid(), islandX0, islandX1, islandY0, islandY1);
  const beforeBg = stoneStats(e.getGridBg(), islandX0, islandX1, islandY0, islandY1);

  for (const layer of eraseOrder) eraseMoat(e, layer, cx, cy, innerR, outerR, pointerPath);
  step(e, steps);

  const fg = stoneStats(e.getGrid(), islandX0, islandX1, islandY0 + 4, ROWS);
  const bg = stoneStats(e.getGridBg(), islandX0, islandX1, islandY0 + 4, ROWS);
  const fgFell = fg.minY > beforeFg.minY + 4;
  const bgFell = bg.minY > beforeBg.minY + 4;
  if (report) {
    check('foreground detached island falls', fgFell, `(top ${beforeFg.minY} -> ${fg.minY}, cells ${fg.n})`);
    check('background detached island falls', bgFell, `(top ${beforeBg.minY} -> ${bg.minY}, cells ${bg.n})`);
    check('layers agree on falling state', fgFell === bgFell, `(fg ${fgFell}, bg ${bgFell})`);
  }
  e.destroy();
  return { fgFell, bgFell, beforeFg, beforeBg, fg, bg, innerR, outerR, steps, eraseOrder, pointerPath };
};

runScenario({ name: 'small circle: direct erase both layers', eraseOrder: [0, 1] });
runScenario({ name: 'small circle: pointer erase both layers', eraseOrder: [0, 1], pointerPath: true });

const runRectScenario = ({ name, eraseOrder, pointerPath = false, steps = 120 }) => {
  console.log(name);
  const e = mk();
  e.setBgEnabled(true);
  for (const layer of [0, 1]) stonePocket(e, layer);
  const islandX0 = 41, islandX1 = 56, islandY0 = 41, islandY1 = 56;
  for (const layer of eraseOrder) eraseRectMoat(e, layer, 37, 60, 37, 60, 4, pointerPath);
  const cutFg = stoneStats(e.getGrid(), islandX0, islandX1, islandY0, islandY1);
  const cutBg = stoneStats(e.getGridBg(), islandX0, islandX1, islandY0, islandY1);
  step(e, steps);
  const fg = stoneStats(e.getGrid(), islandX0, islandX1, islandY0, ROWS);
  const bg = stoneStats(e.getGridBg(), islandX0, islandX1, islandY0, ROWS);
  const fgFell = fg.minY > cutFg.minY + 6;
  const bgFell = bg.minY > cutBg.minY + 6;
  check('rect foreground detached island falls', fgFell, `(top ${cutFg.minY} -> ${fg.minY}, cells ${fg.n})`);
  check('rect background detached island falls', bgFell, `(top ${cutBg.minY} -> ${bg.minY}, cells ${bg.n})`);
  check('rect layers agree on falling state', fgFell === bgFell, `(fg ${fgFell}, bg ${bgFell})`);
  e.destroy();
  return { fgFell, bgFell, cutFg, cutBg, fg, bg };
};

runRectScenario({ name: 'rect moat: direct erase both layers', eraseOrder: [0, 1] });
runRectScenario({ name: 'rect moat: pointer erase both layers', eraseOrder: [0, 1], pointerPath: true });

{
  console.log('rect moat control: foreground only');
  const e = mk();
  e.setBgEnabled(false);
  stonePocket(e, 0);
  eraseRectMoat(e, 0, 37, 60, 37, 60, 4, false);
  const cut = stoneStats(e.getGrid(), 41, 56, 41, 56);
  step(e, 120);
  const fg = stoneStats(e.getGrid(), 41, 56, 41, ROWS);
  check('single-layer detached island falls', fg.minY > cut.minY + 6, `(top ${cut.minY} -> ${fg.minY}, cells ${fg.n})`);
  e.destroy();
}

{
  console.log('large creative circle: overlapping fg/bg island');
  const cols = 220, rows = 180, cx = 110, cy = 88, innerR = 62, outerR = 72;
  const e = createEngineWasm({ cols, rows, worldSeed: 0x51a7e, infinite: false, sinksOn: false });
  e.setBgEnabled(true);
  const k = (x, y) => y * cols + x;
  const stats = (grid) => {
    let n = 0, minY = rows, maxY = -1;
    for (let y = cy - innerR; y <= cy + innerR; y++) for (let x = cx - innerR; x <= cx + innerR; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > (innerR - 2) * (innerR - 2)) continue;
      if (grid[k(x, y)] !== MAT.STONE) continue;
      n++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { n, minY, maxY };
  };
  for (const layer of [0, 1]) {
    for (let y = 12; y < rows - 1; y++) for (let x = 12; x < cols - 12; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    e.syncComponentsLayer(layer);
  }
  const beforeFg = stats(e.getGrid()), beforeBg = stats(e.getGridBg());
  for (let y = cy - outerR; y <= cy + outerR; y++) for (let x = cx - outerR; x <= cx + outerR; x++) {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d2 < innerR * innerR || d2 > outerR * outerR) continue;
    e.eraseDiscLayer(0, x, y, 2);
    e.eraseDiscLayer(1, x, y, 2);
  }
  for (let i = 0; i < 180; i++) e.step(16 * (i + 1));
  const fg = stats(e.getGrid()), bg = stats(e.getGridBg());
  const fgFell = fg.minY > beforeFg.minY + 8;
  const bgFell = bg.minY > beforeBg.minY + 8;
  check('large foreground island falls', fgFell, `(top ${beforeFg.minY} -> ${fg.minY}, cells ${fg.n})`);
  check('large background island falls', bgFell, `(top ${beforeBg.minY} -> ${bg.minY}, cells ${bg.n})`);
  check('large creative layers agree', fgFell === bgFell, `(fg ${fgFell}, bg ${bgFell})`);
  e.destroy();
}

{
  console.log('large creative circle: slightly mismatched fg/bg cuts');
  const cols = 220, rows = 180, cx = 110, cy = 88;
  const e = createEngineWasm({ cols, rows, worldSeed: 0x51a7e, infinite: false, sinksOn: false });
  e.setBgEnabled(true);
  const k = (x, y) => y * cols + x;
  const statRadius = 54;
  const stats = (grid) => {
    let n = 0, minY = rows, maxY = -1;
    for (let y = cy - statRadius; y <= cy + statRadius; y++) for (let x = cx - statRadius; x <= cx + statRadius; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > statRadius * statRadius) continue;
      if (grid[k(x, y)] !== MAT.STONE) continue;
      n++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { n, minY, maxY };
  };
  const eraseAnnulus = (layer, innerR, outerR) => {
    for (let y = cy - outerR; y <= cy + outerR; y++) for (let x = cx - outerR; x <= cx + outerR; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < innerR * innerR || d2 > outerR * outerR) continue;
      e.eraseDiscLayer(layer, x, y, 2);
    }
  };
  for (const layer of [0, 1]) {
    for (let y = 12; y < rows - 1; y++) for (let x = 12; x < cols - 12; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    e.syncComponentsLayer(layer);
  }
  const beforeFg = stats(e.getGrid()), beforeBg = stats(e.getGridBg());
  eraseAnnulus(0, 62, 72); // foreground cut seen by the player
  eraseAnnulus(1, 56, 66); // background cut is close, but not identical
  for (let i = 0; i < 180; i++) e.step(16 * (i + 1));
  const fg = stats(e.getGrid()), bg = stats(e.getGridBg());
  const fgFell = fg.minY > beforeFg.minY + 8;
  const bgFell = bg.minY > beforeBg.minY + 8;
  console.log(`  info mismatched static cut outcome: fg ${fgFell} top ${beforeFg.minY}->${fg.minY}, bg ${bgFell} top ${beforeBg.minY}->${bg.minY}`);
  check('mismatched static cut kept both islands materialized', fg.n > 0 && bg.n > 0, `(fg cells ${fg.n}, bg cells ${bg.n})`);
  e.destroy();
}

{
  console.log('large creative pocket: foreground overlaps grounded background rim');
  const cols = 180, rows = 140;
  const e = createEngineWasm({ cols, rows, worldSeed: 0x51a7e, infinite: false, sinksOn: false });
  e.setBgEnabled(true);
  const k = (x, y) => y * cols + x;
  const stats = (grid, x0, x1, y0, y1) => {
    let n = 0, minY = rows, maxY = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (grid[k(x, y)] !== MAT.STONE) continue;
      n++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { n, minY, maxY };
  };
  const fillPocket = (layer) => {
    for (let y = 16; y < 72; y++) for (let x = 18; x < 162; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    for (let y = 72; y < rows - 1; y++) {
      for (let x = 18; x < 30; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
      for (let x = 150; x < 162; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    }
    e.syncComponentsLayer(layer);
  };
  const eraseRectRing = (layer, x0, x1, y0, y1, width) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const inner = x >= x0 + width && x < x1 - width && y >= y0 + width && y < y1 - width;
      if (!inner) e.eraseDiscLayer(layer, x, y, 1);
    }
  };
  for (const layer of [0, 1]) fillPocket(layer);
  const beforeFg = stats(e.getGrid(), 56, 124, 38, 62);
  const beforeBg = stats(e.getGridBg(), 68, 112, 42, 58);
  eraseRectRing(0, 50, 130, 32, 68, 6);
  eraseRectRing(1, 62, 118, 36, 64, 6);
  for (let i = 0; i < 180; i++) e.step(16 * (i + 1));
  const fg = stats(e.getGrid(), 56, 124, 38, rows);
  const bg = stats(e.getGridBg(), 68, 112, 42, rows);
  const fgFell = fg.minY > beforeFg.minY + 6;
  const bgFell = bg.minY > beforeBg.minY + 6;
  console.log(`  info grounded-rim static outcome: fg ${fgFell} top ${beforeFg.minY}->${fg.minY}, bg ${bgFell} top ${beforeBg.minY}->${bg.minY}`);
  check('grounded-rim static case kept both islands materialized', fg.n > 0 && bg.n > 0, `(fg cells ${fg.n}, bg cells ${bg.n})`);
  e.destroy();
}

// DYNAMIC carving: the real-play sequence — carve ONE layer, let the sim run so a
// cross-supported island settles (goes inactive), THEN carve the other layer. The
// freed island must still fall even though its layer went idle. This is the actual
// reported bug ("only one layer falls; whichever I carve SECOND drops, the first
// stays"), which a carve-both-then-step test cannot catch. Geometry: a ceiling slab
// spanning both layers, held by two side pillars, with a big VOID below; two
// vertical cuts isolate the middle slab, which must drop into the void in BOTH
// layers regardless of carve order, and even when the two cuts are slightly
// mismatched (hand-drawn moats never align pixel-perfectly).
{
  const C = 140, R = 160, kk = (x, y) => y * C + x;
  const mkBig = () => createEngineWasm({ cols: C, rows: R, worldSeed: 0x51a7e, infinite: false, sinksOn: false });
  const fillBody = (e, l) => {
    for (let y = 20; y < 60; y++) for (let x = 10; x < 130; x++) e.paintDiscLayer(l, x, y, 0, MAT.STONE, true);
    for (let y = 60; y < R - 1; y++) { for (let x = 10; x < 22; x++) e.paintDiscLayer(l, x, y, 0, MAT.STONE, true); for (let x = 118; x < 130; x++) e.paintDiscLayer(l, x, y, 0, MAT.STONE, true); }
    e.syncComponentsLayer(l);
  };
  const vcut = (e, l, cx0, cx1) => { for (let y = 16; y < 64; y++) for (let x = cx0; x < cx1; x++) e.eraseDiscLayer(l, x, y, 1); };
  const slab = (g) => { let n = 0, minY = R; for (let y = 20; y < R; y++) for (let x = 55; x < 85; x++) { if (g[kk(x, y)] === MAT.STONE) { n++; if (y < minY) minY = y; } } return { n, minY }; };
  const stepN = (e, n) => { for (let i = 0; i < n; i++) e.step(16 * (i + 1)); };
  const dynScenario = (name, carveFirst, carveSecond) => {
    console.log(name);
    const e = mkBig(); e.setBgEnabled(true);
    fillBody(e, 0); fillBody(e, 1);
    const b0 = slab(e.getGrid()), b1 = slab(e.getGridBg());
    carveFirst(e); stepN(e, 60);      // first layer carved; cross-supported slab settles
    carveSecond(e); stepN(e, 200);    // second layer carved; both must now fall
    const fg = slab(e.getGrid()), bg = slab(e.getGridBg());
    const fgFell = fg.minY > b0.minY + 10, bgFell = bg.minY > b1.minY + 10;
    check('foreground slab falls', fgFell, `(top ${b0.minY} -> ${fg.minY})`);
    check('background slab falls', bgFell, `(top ${b1.minY} -> ${bg.minY})`);
    check('both layers fall regardless of carve order', fgFell && bgFell, `(fg ${fgFell}, bg ${bgFell})`);
    e.destroy();
  };
  // exact-aligned cuts at columns [34,40) and [100,106)
  const cutA = (e, l) => { vcut(e, l, 34, 40); vcut(e, l, 100, 106); };
  // bg cuts shifted +2 px — the hand-drawn mismatch that used to pin a layer
  const cutMis = (e, l) => { const d = l ? 2 : 0; vcut(e, l, 34 + d, 40 + d); vcut(e, l, 100 - d, 106 - d); };
  dynScenario('dynamic: carve fg, settle, then carve bg (aligned)', e => cutA(e, 0), e => cutA(e, 1));
  dynScenario('dynamic: carve bg, settle, then carve fg (aligned)', e => cutA(e, 1), e => cutA(e, 0));
  dynScenario('dynamic: carve fg, settle, then carve bg (mismatched)', e => cutMis(e, 0), e => cutMis(e, 1));
  dynScenario('dynamic: carve bg, settle, then carve fg (mismatched)', e => cutMis(e, 1), e => cutMis(e, 0));
}

// GENERATED WORLD: after a downward stream, topology-dirty foreground cave
// components overlap grounded background stone. Joint grounding must run before
// moveRigidAssemblies; otherwise chunks visibly slough down for a few ticks before
// background support catches them.
{
  console.log('generated world: streamed foreground stays adhered to background');
  const C = 220, R = 160;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 153, infinite: true, sinksOn: false });
  e.shiftWorldXY(0, 96);
  let dropped = 0;
  for (let i = 0; i < 8; i++) {
    const before = e.getGrid().slice();
    e.step(16 * (i + 1));
    const r = countOneStepComponentDrops(before, e.getGrid(), C, R);
    dropped += r.total;
  }
  check('streamed foreground components do not slough before cross-layer support', dropped === 0, `(one-step drops ${dropped})`);
  e.destroy();
}

console.log(failures === 0 ? '\nno layer-detach failure reproduced' : `\n${failures} reproduced failure(s)`);
process.exit(failures === 0 ? 0 : 1);
