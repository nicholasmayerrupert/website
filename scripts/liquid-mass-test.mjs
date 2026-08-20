// Liquid mass conservation under local density exchange.
// Every liquid/liquid interaction is an adjacent swap, so sealed chambers,
// falling inlets, and mixed interfaces must retain each material exactly.
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

const { check, done } = makeChecker('liquid mass conservation (local density exchange)');

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
  for (let y = ROWS - 2; y < ROWS; y++) {
    for (let x = 5; x < COLS - 5; x++) e.paintDisc(x, y, 0, mat, true);
  }
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

// --- 9. Free-fall / sink through another fluid (local exchange + multi-cell). ---
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

// --- 10. Anti-geyser: water dropped into a deep oil pool produces only a local
//     interface ripple while adjacent exchanges carry it into the oil. ---
{
  console.log('\n10. water into oil: oil does not geyser to the surface');
  const e = mk();
  const L = 15, R = 60, floorY = ROWS - 3, oilTop = 25, oilBot = floorY - 1;
  floorMat(e, MAT.STONE);
  // Deep oil pool with open air above (free surface at oilTop).
  fillRect(e, L, R, oilTop, oilBot, MAT.OIL);
  // Water blob high above the oil — falls in and sinks.
  fillRect(e, 32, 42, 6, 14, MAT.WATER);
  const oil0 = count(e.getGrid(), MAT.OIL);
  const water0 = count(e.getGrid(), MAT.WATER);
  // Sample while water is actively sinking (not only at the end).
  let maxOilAboveSurface = 0;
  let minOilTop = oilTop;
  let t = 0;
  for (let i = 0; i < 180; i++) {
    t += 16;
    e.step(t);
    const g = e.getGrid();
    let oilAbove = 0, top = ROWS;
    for (let y = 0; y < oilTop; y++) {
      for (let x = L; x <= R; x++) {
        const m = g[k(x, y)];
        if (m === MAT.OIL) { oilAbove++; if (y < top) top = y; }
      }
    }
    if (oilAbove > maxOilAboveSurface) maxOilAboveSurface = oilAbove;
    if (top < minOilTop) minOilTop = top;
  }
  const oil1 = count(e.getGrid(), MAT.OIL);
  const water1 = count(e.getGrid(), MAT.WATER);
  check(`anti-geyser: oil conserved (${oil0} -> ${oil1})`, oil1 === oil0 && oil0 > 0);
  check(`anti-geyser: water conserved (${water0} -> ${water1})`, water1 === water0 && water0 > 0);
  // A narrow interface ripple may put a few oil cells above the initial surface,
  // but the bulk of the pool must stay below it.
  check(
    `anti-geyser: oil above free surface stayed small (max ${maxOilAboveSurface}, highest y ${minOilTop})`,
    maxOilAboveSurface <= 20,
  );
  // Density-contrast exchange is deliberately gradual, but the water must enter
  // the oil instead of remaining stranded above the interface.
  {
    const g = e.getGrid();
    let waterInOil = 0, waterAbove = 0;
    for (let y = 0; y <= oilBot; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (g[k(x, y)] !== MAT.WATER) continue;
        if (y >= oilTop) waterInOil++;
        else waterAbove++;
      }
    }
    check(
      `anti-geyser: water entered the oil (${waterInOil} in-pool, ${waterAbove} above)`,
      waterInOil >= water0 * 0.3 && waterInOil > waterAbove,
    );
  }
  e.destroy();
}

// --- 11. Equal-mass stationary and moving brine inlets. A moving inlet may
//     leave a small wake, but it must not carry a tall oil crest with it. ---
{
  console.log('\n11. moving brine inlet does not carry an oil crest');
  const sourceCols = 120, sourceRows = 100;
  const oilLeft = 15, oilRight = 104, oilTop = 45, oilBottom = 94;
  const sourceY = 18, injectionCount = 120;

  function runInlet(mode) {
    const e = createEngineWasm({
      cols: sourceCols,
      rows: sourceRows,
      worldSeed: SEED,
      sinksOn: false,
      infinite: false,
    });
    const sourceK = (x, y) => y * sourceCols + x;
    for (let y = oilBottom + 1; y < sourceRows; y++) {
      for (let x = 5; x < sourceCols - 5; x++) {
        e.paintDisc(x, y, 0, MAT.STONE, true);
      }
    }
    e.syncComponents();
    for (let y = oilTop; y <= oilBottom; y++) {
      for (let x = oilLeft; x <= oilRight; x++) {
        e.paintDisc(x, y, 0, MAT.OIL, true);
      }
    }

    const initialOil = count(e.getGrid(), MAT.OIL);
    let accepted = 0, time = 0, maxOilAbove = 0, maxOilRise = 0;
    const sampleCrest = () => {
      const g = e.getGrid();
      let above = 0, highestY = sourceRows;
      for (let y = 0; y < oilTop; y++) {
        for (let x = oilLeft; x <= oilRight; x++) {
          if (g[sourceK(x, y)] !== MAT.OIL) continue;
          above++;
          if (y < highestY) highestY = y;
        }
      }
      maxOilAbove = Math.max(maxOilAbove, above);
      if (highestY < sourceRows) {
        maxOilRise = Math.max(maxOilRise, oilTop - highestY);
      }
    };

    for (let i = 0; i < injectionCount; i++) {
      const phase = i <= 60 ? i : 120 - i;
      const sourceX = mode === 'stationary'
        ? 60
        : mode === 'right' ? 30 + phase : 90 - phase;
      if (e.getGrid()[sourceK(sourceX, sourceY)] === MAT.EMPTY) {
        e.paintDisc(sourceX, sourceY, 0, MAT.BRINE, true);
        accepted++;
      }
      time += 16;
      e.step(time);
      sampleCrest();
    }
    for (let i = 0; i < 120; i++) {
      time += 16;
      e.step(time);
      sampleCrest();
    }

    const result = {
      accepted,
      brine: count(e.getGrid(), MAT.BRINE),
      oil: count(e.getGrid(), MAT.OIL),
      initialOil,
      maxOilAbove,
      maxOilRise,
    };
    e.destroy();
    return result;
  }

  const stationary = runInlet('stationary');
  const right = runInlet('right');
  const left = runInlet('left');
  const runs = [stationary, right, left];
  check(
    `inlets accepted and retained equal brine mass (${runs.map((r) => `${r.accepted}/${r.brine}`).join(', ')})`,
    runs.every((r) => r.accepted === injectionCount && r.brine === injectionCount),
  );
  check(
    `inlets conserved oil (${runs.map((r) => `${r.initialOil}->${r.oil}`).join(', ')})`,
    runs.every((r) => r.oil === r.initialOil),
  );
  const movingMaxAbove = Math.max(right.maxOilAbove, left.maxOilAbove);
  const movingMaxRise = Math.max(right.maxOilRise, left.maxOilRise);
  check(
    `moving crest stayed comparable to stationary (oil above ${stationary.maxOilAbove} stationary, ${right.maxOilAbove}/${left.maxOilAbove} moving)`,
    movingMaxAbove <= stationary.maxOilAbove + 20
      && movingMaxRise <= stationary.maxOilRise + 3,
  );
  check(
    `moving inlet is direction-symmetric (rise ${right.maxOilRise}/${left.maxOilRise}, oil above ${right.maxOilAbove}/${left.maxOilAbove})`,
    Math.abs(right.maxOilRise - left.maxOilRise) <= 1
      && Math.abs(right.maxOilAbove - left.maxOilAbove) <= 20,
  );
}

// --- 12. Light powder on denser liquid remains conserved through local swaps. ---
{
  console.log('\n12. light powder floats on denser liquid (no mass loss)');
  {
    const e = mk();
    floorMat(e, MAT.STONE);
    fillRect(e, 20, 55, 35, ROWS - 3, MAT.WATER);
    fillRect(e, 25, 50, 28, 34, MAT.SNOW); // snow on top of water
    runConserve(e, [MAT.SNOW, MAT.WATER], 250, 'snow on water');
    e.destroy();
  }
  {
    const e = mk();
    floorMat(e, MAT.STONE);
    fillRect(e, 25, 50, 35, 42, MAT.SNOW); // snow bed
    fillRect(e, 20, 55, 20, 34, MAT.WATER); // water dumped on snow
    runConserve(e, [MAT.SNOW, MAT.WATER], 250, 'water on snow');
    e.destroy();
  }
  {
    // Sand is denser than water — still must conserve (control / no regression).
    const e = mk();
    floorMat(e, MAT.STONE);
    fillRect(e, 20, 55, 35, ROWS - 3, MAT.WATER);
    fillRect(e, 25, 50, 28, 34, MAT.SAND);
    runConserve(e, [MAT.SAND, MAT.WATER], 250, 'sand on water');
    e.destroy();
  }
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
