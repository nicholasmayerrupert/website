// Render-noise stability test. The per-cell terrain "grain" (8 brightness shades
// picked from a 64x64 noise tile) must stay LOCKED TO THE TERRAIN across a world
// shift — i.e. a given world cell renders to the same shade no matter where it sits
// in the buffer. The bug this guards: the noise was indexed by BUFFER coords, and
// WORLD_SHIFT_ROWS (96) is not a multiple of the 64 tile, so panning down far
// enough to trigger a vertical shift made the whole grain visibly "reapply"/jump.
// Render-only lighting can legitimately change a small number of pixels near
// exposure edges across a shift, so this checks that mismatches stay sparse rather
// than requiring byte equality for every lit pixel.
//
// The fix keys the noise on ABSOLUTE WORLD coords (worldOffset + buffer). This test
// performs a real vertical shift on a live engine and asserts the rendered color of
// overlapping (un-changed) world cells stays stable apart from sparse lighting
// differences.
//
// Run: node scripts/render-noise-test.mjs   (also part of `npm test`)

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 256, ROWS = 256, SEED = 0xBEEF77; // chunk-aligned (multiples of 32)
const VISR = 96, MARGIN = 40;                  // MARGIN matches CAM_SHIFT_EDGE_MARGIN

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failures++; };

await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

console.log('schema-driven animated textures');
{
  const animated = ['FIRE', 'STEAM', 'ACRID_SMOKE', 'WATER', 'OIL', 'ACID', 'LAVA', 'BRINE'];
  for (const name of animated) {
    const e = createEngineWasm({ cols: 64, rows: 64, worldSeed: SEED, sinksOn: false, infinite: false });
    e.getGrid().fill(MAT[name]);
    e.renderFull();
    const first = new Uint32Array(e.getRenderPixels().slice().buffer);
    let changed = 0;
    // Slow materials intentionally shimmer only every few 12 Hz presentation frames.
    for (let frame = 0; frame < 12 && changed === 0; frame++) {
      e.renderFull();
      const next = new Uint32Array(e.getRenderPixels().slice().buffer);
      for (let i = 0; i < first.length; i++) if (first[i] !== next[i]) changed++;
    }
    check(`${name.toLowerCase()} texture advances`, changed > first.length * 0.01, `(${changed}/${first.length} cells changed)`);
    e.destroy();
  }
  const e = createEngineWasm({ cols: 64, rows: 64, worldSeed: SEED, sinksOn: false, infinite: false });
  e.getGrid().fill(MAT.STONE);
  e.renderFull(); const first = new Uint32Array(e.getRenderPixels().slice().buffer);
  e.renderFull(); const next = new Uint32Array(e.getRenderPixels().slice().buffer);
  let changed = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== next[i]) changed++;
  check('non-animated terrain remains world-locked', changed === 0, `(${changed} cells changed)`);
  e.destroy();
}

console.log('stationary shimmer');
{
  const size = 64;
  const e = createEngineWasm({ cols: size, rows: size, worldSeed: SEED, sinksOn: false, infinite: false });
  e.getGrid().fill(MAT.WATER);
  e.renderFull();
  const before = new Uint32Array(e.getRenderPixels().slice().buffer);
  for (let i = 0; i < 16; i++) e.renderFull();
  const after = new Uint32Array(e.getRenderPixels().slice().buffer);
  let unchanged = 0, changed = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) unchanged++;
    else changed++;
  }
  check('water shimmers in place instead of replacing the whole texture', changed > size && unchanged > size,
    `(${changed} changed, ${unchanged} retained)`);
  e.destroy();
}

console.log('lava texture');
{
  const size = 64;
  const e = createEngineWasm({ cols: size, rows: size, worldSeed: SEED, sinksOn: false, infinite: false });
  e.getGrid().fill(MAT.LAVA);
  e.renderFull();
  const px = new Uint32Array(e.getRenderPixels().slice().buffer);
  const colors = new Map();
  for (const c of px) colors.set(c, (colors.get(c) || 0) + 1);
  check('lava uses a layered molten palette', colors.size >= 3, `(${colors.size} colors)`);

  // A modulo stripe makes nearly every highlighted cell continue along the same
  // diagonal. The mottled texture should have varied local directions instead.
  const base = [...colors].sort((a, b) => b[1] - a[1])[0][0];
  let highlighted = 0, diagonalContinuation = 0, orthogonalNeighbour = 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const k = y * size + x;
    if (px[k] === base) continue;
    highlighted++;
    if (px[k - size - 1] !== base || px[k + size + 1] !== base) diagonalContinuation++;
    if (px[k - 1] !== base || px[k + 1] !== base || px[k - size] !== base || px[k + size] !== base) orthogonalNeighbour++;
  }
  check('lava highlights form local patches', highlighted > 0 && orthogonalNeighbour / highlighted > 0.55,
    `(${orthogonalNeighbour}/${highlighted} touch orthogonally)`);
  check('lava highlights do not resolve into diagonal stripes', highlighted > 0 && diagonalContinuation / highlighted < 0.85,
    `(${diagonalContinuation}/${highlighted} continue diagonally)`);
  e.destroy();
}

// Pan DOWN until one vertical world-shift fires; return its dy (>0) or 0 if none.
function shiftDownOnce(e) {
  const trigger = ROWS - VISR - MARGIN;
  let cam = MARGIN + 6;
  for (let f = 0; f < 20000; f++) {
    cam += 2;
    if (cam >= trigger) { const d = e.maybeShiftWorldV(cam, VISR, MARGIN); if (d) return d; }
  }
  return 0;
}

// renderFull twice and return a Uint32 copy of the pixels PLUS a per-cell "stable"
// mask. Animated materials can differ between passes and are excluded. Static
// terrain remains keyed to absolute world position and is compared strictly.
function renderStable(e) {
  e.renderFull(); const a = new Uint32Array(e.getRenderPixels().slice().buffer);
  e.renderFull(); const b = new Uint32Array(e.getRenderPixels().slice().buffer);
  const stable = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) stable[i] = a[i] === b[i] ? 1 : 0;
  return { px: a, stable };
}

console.log('render-noise stability across a vertical world-shift (pan down)');
{
  const e = mk();
  const oy0 = e.getWorldOffsetY();
  const before = renderStable(e);
  const g0 = e.getGrid().slice();

  const dy = shiftDownOnce(e);
  const oy1 = e.getWorldOffsetY();
  const after = renderStable(e);
  const g1 = e.getGrid();

  check('a vertical shift fired', dy > 0, `dy=${dy}`);
  check('shift advanced worldOffsetY by a non-multiple of 64 (the trap)', ((oy1 - oy0) & 63) !== 0, `dOffY=${oy1 - oy0}`);

  // Overlap = world rows present in BOTH buffers. In buffer space: a world row WY is
  // at y0 = WY-oy0 before and y1 = WY-oy1 after. Compare cells whose material is
  // unchanged (the slid content) and stable in both renders.
  let compared = 0, mismatch = 0, firstBadWY = -1;
  const loWY = Math.max(oy0, oy1), hiWY = Math.min(oy0 + ROWS, oy1 + ROWS) - 1;
  for (let wy = loWY; wy <= hiWY; wy++) {
    const y0 = wy - oy0, y1 = wy - oy1;
    for (let x = 0; x < COLS; x++) {
      const k0 = y0 * COLS + x, k1 = y1 * COLS + x;
      if (g0[k0] !== g1[k1]) continue;             // content changed here (band edge) — skip
      if (!before.stable[k0] || !after.stable[k1]) continue; // animated cell — skip
      compared++;
      if (before.px[k0] !== after.px[k1]) { mismatch++; if (firstBadWY < 0) firstBadWY = wy; }
    }
  }
  check('meaningful number of overlapping cells compared', compared > 5000, `(${compared})`);
  const mismatchRate = compared ? mismatch / compared : 1;
  check('grain stays stable across the shift apart from sparse render-lighting changes',
    mismatchRate < 0.05,
    mismatch ? `${mismatch}/${compared} cells differed (${(mismatchRate * 100).toFixed(2)}%, first at worldRow ${firstBadWY})` : `(${compared} cells matched)`);
  e.destroy();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
