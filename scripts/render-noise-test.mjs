// Render-noise stability test. The per-cell terrain "grain" (8 brightness shades
// picked from a 64x64 noise tile) must stay LOCKED TO THE TERRAIN across a world
// shift — i.e. a given world cell renders to the same shade no matter where it sits
// in the buffer. The bug this guards: the noise was indexed by BUFFER coords, and
// WORLD_SHIFT_ROWS (96) is not a multiple of the 64 tile, so panning down far
// enough to trigger a vertical shift made the whole grain visibly "reapply"/jump.
//
// The fix keys the noise on ABSOLUTE WORLD coords (worldOffset + buffer). This test
// performs a real vertical shift on a live engine and asserts the rendered color of
// every overlapping (un-changed) world cell is byte-identical before vs after.
//
// Run: node scripts/render-noise-test.mjs   (also part of `npm test`)

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

const COLS = 256, ROWS = 256, SEED = 0xBEEF77; // chunk-aligned (multiples of 32)
const VISR = 96, MARGIN = 40;                  // MARGIN matches CAM_SHIFT_EDGE_MARGIN

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failures++; };

await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

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
// mask. Steam/fire use renderRand() per render so they differ between the two
// passes -> flagged unstable and excluded (they SHOULD flicker). Static terrain and
// the position-deterministic lava sparkle are stable and get compared strictly.
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
  check('grain is byte-identical for every overlapping world cell across the shift',
    mismatch === 0, mismatch ? `${mismatch} cells jumped (first at worldRow ${firstBadWY})` : `(${compared} cells matched)`);
  e.destroy();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
