// Liquid mass conservation under density-chain displacement.
// Focuses on resolveLiquidDisplacements: every displaced liquid must land in
// EMPTY/gas, chain into a lighter liquid with a real free fallback, or restore
// into an original vacated source — never disappear.
//
// Run: node scripts/liquid-mass-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 80, ROWS = 60, SEED = 0xF100D;
await initSandWasm();
const mk = () => createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});

const { check, done } = makeChecker('liquid mass conservation (density chain)');

const k = (x, y) => y * COLS + x;
const count = (g, m) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
const stepN = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };

// Stone box: walls + floor + optional ceiling. Interior is [x0+1..x1-1] x [y0+1..y1-1].
function stoneBox(e, x0, x1, y0, y1, { ceiling = true } = {}) {
  for (let y = y0; y <= y1; y++) {
    e.paintDisc(x0, y, 0, MAT.STONE, true);
    e.paintDisc(x1, y, 0, MAT.STONE, true);
  }
  for (let x = x0; x <= x1; x++) {
    e.paintDisc(x, y1, 0, MAT.STONE, true);
    if (ceiling) e.paintDisc(x, y0, 0, MAT.STONE, true);
  }
  // Ground the box by extending walls to world floor so the component doesn't fall.
  for (let y = y1 + 1; y < ROWS; y++) {
    e.paintDisc(x0, y, 0, MAT.STONE, true);
    e.paintDisc(x1, y, 0, MAT.STONE, true);
  }
  e.syncComponents();
}

function fillRect(e, x0, x1, y0, y1, mat) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, mat, true);
}

function snapshot(e, mats) {
  const g = e.getGrid();
  const out = {};
  for (const m of mats) out[m] = count(g, m);
  return out;
}

function conserve(label, before, after, mats) {
  for (const m of mats) {
    check(
      `${label}: ${Object.keys(MAT).find((n) => MAT[n] === m) || m} conserved (${before[m]} -> ${after[m]})`,
      after[m] === before[m] && before[m] > 0,
    );
  }
}

// Run steps while checking conservation every tick; report first loss.
function runConserve(e, mats, steps, label) {
  const before = snapshot(e, mats);
  let firstLoss = null;
  let t = 0;
  for (let i = 0; i < steps; i++) {
    t += 16;
    e.step(t);
    const cur = snapshot(e, mats);
    for (const m of mats) {
      if (cur[m] !== before[m] && firstLoss == null) {
        firstLoss = { step: i, mat: m, before: before[m], after: cur[m] };
      }
    }
  }
  const after = snapshot(e, mats);
  conserve(label, before, after, mats);
  if (firstLoss) {
    check(
      `${label}: no mid-run loss (first @ step ${firstLoss.step}: mat ${firstLoss.mat} ${firstLoss.before}->${firstLoss.after})`,
      false,
    );
  } else {
    check(`${label}: no mid-run loss`, true);
  }
  return { before, after, firstLoss };
}

// --- 1. brine above water in a sealed box (air headspace above stack) ---
{
  console.log('\n1. brine above water (sealed, with headspace)');
  const e = mk();
  const x0 = 20, x1 = 50, y0 = 10, y1 = 45;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  // water bottom layer, brine on top (inverted — denser should sink)
  fillRect(e, x0 + 1, x1 - 1, 30, y1 - 1, MAT.WATER);
  fillRect(e, x0 + 1, x1 - 1, 20, 29, MAT.BRINE);
  runConserve(e, [MAT.WATER, MAT.BRINE], 800, 'brine/water headspace');
  e.destroy();
}

// --- 2. water above oil in a sealed box ---
{
  console.log('\n2. water above oil (sealed, with headspace)');
  const e = mk();
  const x0 = 20, x1 = 50, y0 = 10, y1 = 45;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  fillRect(e, x0 + 1, x1 - 1, 30, y1 - 1, MAT.OIL);
  fillRect(e, x0 + 1, x1 - 1, 20, 29, MAT.WATER);
  runConserve(e, [MAT.WATER, MAT.OIL], 800, 'water/oil headspace');
  e.destroy();
}

// --- 3. brine/water/oil three-layer inverted stack ---
{
  console.log('\n3. brine/water/oil inverted three-layer (sealed, headspace)');
  const e = mk();
  const x0 = 18, x1 = 52, y0 = 8, y1 = 48;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  // bottom oil, mid water, top brine — fully inverted density
  fillRect(e, x0 + 1, x1 - 1, 36, y1 - 1, MAT.OIL);
  fillRect(e, x0 + 1, x1 - 1, 28, 35, MAT.WATER);
  fillRect(e, x0 + 1, x1 - 1, 20, 27, MAT.BRINE);
  runConserve(e, [MAT.OIL, MAT.WATER, MAT.BRINE], 1200, '3-layer inverted headspace');
  e.destroy();
}

// --- 4. same with NO empty/gas cells (fully packed chamber) ---
{
  console.log('\n4. fully packed sealed chamber (no empty/gas)');
  const e = mk();
  const x0 = 22, x1 = 48, y0 = 15, y1 = 42;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  // Fill entire interior: oil bottom, water mid, brine top — zero EMPTY inside.
  fillRect(e, x0 + 1, x1 - 1, 34, y1 - 1, MAT.OIL);
  fillRect(e, x0 + 1, x1 - 1, 26, 33, MAT.WATER);
  fillRect(e, x0 + 1, x1 - 1, y0 + 1, 25, MAT.BRINE);
  // Sanity: interior has no empty
  {
    const g = e.getGrid();
    let empty = 0;
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (g[k(x, y)] === MAT.EMPTY) empty++;
    check(`packed chamber starts with 0 empty interior cells (${empty})`, empty === 0);
  }
  runConserve(e, [MAT.OIL, MAT.WATER, MAT.BRINE], 1200, '3-layer packed no-empty');
  e.destroy();
}

// --- 5. same with ONE empty bubble available ---
{
  console.log('\n5. sealed chamber with one empty bubble');
  const e = mk();
  const x0 = 22, x1 = 48, y0 = 15, y1 = 42;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  fillRect(e, x0 + 1, x1 - 1, 34, y1 - 1, MAT.OIL);
  fillRect(e, x0 + 1, x1 - 1, 26, 33, MAT.WATER);
  fillRect(e, x0 + 1, x1 - 1, y0 + 1, 25, MAT.BRINE);
  // One bubble near the dense/light interface
  e.paintDisc(35, 27, 0, MAT.EMPTY, true);
  {
    const g = e.getGrid();
    let empty = 0;
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (g[k(x, y)] === MAT.EMPTY) empty++;
    check(`one-bubble chamber has exactly 1 empty (${empty})`, empty === 1);
  }
  runConserve(e, [MAT.OIL, MAT.WATER, MAT.BRINE], 1200, '3-layer one-bubble');
  e.destroy();
}

// --- 6. stress: many simultaneous brine→water→oil chains in a narrow packed tube ---
{
  console.log('\n6. narrow packed tube (forces long chain, few free cells)');
  const e = mk();
  const x0 = 30, x1 = 36, y0 = 5, y1 = 50;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  // 5-wide interior, packed inverted columns
  fillRect(e, x0 + 1, x1 - 1, 40, y1 - 1, MAT.OIL);
  fillRect(e, x0 + 1, x1 - 1, 28, 39, MAT.WATER);
  fillRect(e, x0 + 1, x1 - 1, y0 + 1, 27, MAT.BRINE);
  runConserve(e, [MAT.OIL, MAT.WATER, MAT.BRINE], 1500, 'narrow packed tube');
  e.destroy();
}

// --- 7. steam (gas) present: displacing into gas must not drop liquid volume ---
{
  console.log('\n7. water into oil with steam pocket');
  const e = mk();
  const x0 = 20, x1 = 50, y0 = 12, y1 = 45;
  stoneBox(e, x0, x1, y0, y1, { ceiling: true });
  fillRect(e, x0 + 1, x1 - 1, 28, y1 - 1, MAT.OIL);
  fillRect(e, x0 + 1, x1 - 1, 18, 27, MAT.WATER);
  // steam pocket in the oil
  fillRect(e, 30, 34, 32, 36, MAT.STEAM);
  // Don't require steam conservation (may dissipate); liquids must hold.
  runConserve(e, [MAT.WATER, MAT.OIL], 800, 'water/oil + steam pocket');
  e.destroy();
}

// Stone floor for non-acid liquids. Acid uses ICE (non-dissolvable) so
// volume isn't eaten by dissolve+decay; water must not use ICE (freezes).
function floorMat(e, mat) {
  for (let x = 5; x < COLS - 5; x++) e.paintDisc(x, ROWS - 2, 0, mat, true);
  e.syncComponents();
}

// --- 8. Free-fall through empty space: multi-cell liquid falls must not ghost-
//     duplicate via stale double-buffer cells outside the dirty pad. ---
{
  console.log('\n8. free-fall through empty (no count increase)');
  const cases = [
    [MAT.WATER, MAT.STONE],
    [MAT.OIL, MAT.STONE],
    [MAT.BRINE, MAT.STONE],
    [MAT.ACID, MAT.ICE],
  ];
  for (const [mat, floor] of cases) {
    const e = mk();
    floorMat(e, floor);
    // Compact blob from high so multi-cell density-scaled fall engages.
    fillRect(e, 30, 40, 4, 12, mat);
    const name = Object.keys(MAT).find((n) => MAT[n] === mat) || String(mat);
    runConserve(e, [mat], 100, `free-fall ${name}`);
    e.destroy();
  }
}

// --- 9. Free-fall / sink through another fluid (density chain + multi-cell). ---
{
  console.log('\n9. fall/sink through another fluid (no count increase)');
  // denser into lighter
  {
    const e = mk();
    floorMat(e, MAT.STONE);
    fillRect(e, 20, 55, 35, ROWS - 3, MAT.OIL);   // deep oil pool
    fillRect(e, 28, 42, 6, 16, MAT.WATER);          // water blob above, must sink
    runConserve(e, [MAT.WATER, MAT.OIL], 100, 'water through oil');
    e.destroy();
  }
  {
    const e = mk();
    floorMat(e, MAT.STONE);
    fillRect(e, 20, 55, 35, ROWS - 3, MAT.WATER);
    fillRect(e, 28, 42, 6, 16, MAT.BRINE);
    runConserve(e, [MAT.BRINE, MAT.WATER], 100, 'brine through water');
    e.destroy();
  }
  {
    const e = mk();
    floorMat(e, MAT.ICE);
    fillRect(e, 20, 55, 35, ROWS - 3, MAT.OIL);
    fillRect(e, 28, 42, 6, 16, MAT.ACID);
    runConserve(e, [MAT.ACID, MAT.OIL], 100, 'acid through oil');
    e.destroy();
  }
  // Columns falling side-by-side in empty air (no acid — would need ICE floor,
  // which freezes water). Separate free-fall ACID case covers acid.
  {
    const e = mk();
    floorMat(e, MAT.STONE);
    fillRect(e, 12, 16, 3, 10, MAT.WATER);
    fillRect(e, 28, 32, 3, 10, MAT.OIL);
    fillRect(e, 44, 48, 3, 10, MAT.BRINE);
    runConserve(e, [MAT.WATER, MAT.OIL, MAT.BRINE], 100, 'three liquids free-fall');
    e.destroy();
  }
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
