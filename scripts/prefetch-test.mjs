// Worldgen-prefetch tests. The predictive prefetch generates the upcoming
// stream-in band into the tileStore ahead of the shift so the shift can skip the
// expensive fillRect (the periodic pan hitch). These guard the two properties that
// make it safe + worthwhile:
//
//  1) DETERMINISM: a world streamed WITH prefetch is byte-identical (fg AND bg) to
//     one streamed WITHOUT it. Prefetch must change only WHEN worldgen runs, never
//     WHAT it produces — otherwise the host/client diverge and replication breaks.
//  2) EFFECTIVENESS: prefetch actually turns the shifts into cache HITS (the shift
//     frame skips fillRect), in BOTH axes (panning right and panning down).
//
// Run: node scripts/prefetch-test.mjs   (also part of `npm test`)

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

// Chunk-aligned buffer (cols/rows multiples of 32) so whole tiles persist — the
// game's buffer is chunk-rounded; a partial-tile buffer never caches, so prefetch
// would be a silent no-op there.
const COLS = 256, ROWS = 256, SEED = 0xBEEF77; // square + chunk-aligned: symmetric runway both axes
const VIS = 96, VISR = 96, MARGIN = 40;        // MARGIN matches CAM_SHIFT_EDGE_MARGIN (prefetch's assumption)

const fnv = (g) => { let h = 0x811c9dc5; for (let i = 0; i < g.length; i++) { h ^= g[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failures++; };

await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

// Drive a one-axis pan of `shiftsWanted` shifts; B runs prefetchAdvance each frame,
// A does not. Compare fg+bg checksums after every shift. Returns the two engines'
// shift-fill stats so the caller can assert prefetch engaged.
function panAxis(axis, shiftsWanted) {
  const A = mk(), B = mk();
  const PAN = 2; // cells/frame
  let cam = MARGIN + 6;           // panning toward the far (right/bottom) edge
  const trigger = (axis === 'x' ? COLS - VIS : ROWS - VISR) - MARGIN;
  let shifts = 0, mism = 0, firstMismatchShift = -1;
  for (let f = 0; f < 6000 && shifts < shiftsWanted; f++) {
    // B prefetches ahead (cam on the panned axis, fixed on the other).
    if (axis === 'x') B.prefetchAdvance(cam, 0, VIS, VISR); else B.prefetchAdvance(0, cam, VIS, VISR);
    cam += PAN;
    let dA = 0, dB = 0;
    if (cam >= trigger) {
      if (axis === 'x') { dA = A.maybeShiftWorld(cam, VIS, MARGIN); dB = B.maybeShiftWorld(cam, VIS, MARGIN); }
      else { dA = A.maybeShiftWorldV(cam, VISR, MARGIN); dB = B.maybeShiftWorldV(cam, VISR, MARGIN); }
    }
    if (dA || dB) {
      cam -= (axis === 'x' ? dA : dB);
      shifts++;
      const af = fnv(A.getGrid()), bf = fnv(B.getGrid());
      const abg = fnv(A.getGridBg()), bbg = fnv(B.getGridBg());
      if (af !== bf || abg !== bbg) { mism++; if (firstMismatchShift < 0) firstMismatchShift = shifts; }
    }
  }
  const statsA = A.getShiftFillStats(), statsB = B.getShiftFillStats();
  A.destroy(); B.destroy();
  return { shifts, mism, firstMismatchShift, statsA, statsB };
}

console.log('prefetch determinism — horizontal pan (right into novel terrain)');
{
  const r = panAxis('x', 8);
  check(`completed ${r.shifts} horizontal shifts`, r.shifts >= 6, `(${r.shifts})`);
  check('WITH-prefetch grid byte-identical to WITHOUT (fg+bg, every shift)', r.mism === 0,
    r.mism ? `first divergence at shift ${r.firstMismatchShift}` : `(${r.shifts} shifts matched)`);
  // A explores novel terrain with no prefetch -> every shift is a fillRect miss.
  // B prefetched the band -> every shift is a cache hit (miss stays 0).
  check('prefetch turned shifts into cache HITS (miss==0)', r.statsB.miss === 0, `B hit=${r.statsB.hit} miss=${r.statsB.miss}`);
  check('prefetch actually engaged (hits > 0)', r.statsB.hit > 0, `B hit=${r.statsB.hit}`);
  check('control: WITHOUT prefetch the same shifts were fillRect misses', r.statsA.miss > 0, `A hit=${r.statsA.hit} miss=${r.statsA.miss}`);
}

console.log('prefetch determinism — vertical pan (down into novel terrain)');
{
  const r = panAxis('y', 8);
  check(`completed ${r.shifts} vertical shifts`, r.shifts >= 6, `(${r.shifts})`);
  check('WITH-prefetch grid byte-identical to WITHOUT (fg+bg, every shift)', r.mism === 0,
    r.mism ? `first divergence at shift ${r.firstMismatchShift}` : `(${r.shifts} shifts matched)`);
  check('prefetch turned vertical shifts into cache HITS (miss==0)', r.statsB.miss === 0, `B hit=${r.statsB.hit} miss=${r.statsB.miss}`);
  check('prefetch actually engaged (hits > 0)', r.statsB.hit > 0, `B hit=${r.statsB.hit}`);
}

// Re-entering a region the camera already left is ALSO a hit (the leaving band was
// saved to the tileStore) — prefetch must coexist with that without clobbering it.
console.log('prefetch coexists with saved (revisited) tiles');
{
  const e = mk();
  // edit some foreground terrain so a leaving band has real saved state
  for (let i = 0; i < 30; i++) e.paintDisc(60 + i * 4, 40 + (i % 12), 3, 1, false);
  let cam = MARGIN + 6; const trigger = COLS - VIS - MARGIN;
  let shifts = 0;
  // pan right a few shifts, then pan back left over the saved bands
  for (let dir of [1, 1, 1, -1, -1, -1]) {
    for (let f = 0; f < 2000; f++) {
      e.prefetchAdvance(cam, 0, VIS, VISR);
      cam += dir * 2;
      let d = 0;
      if (dir > 0 && cam >= trigger) d = e.maybeShiftWorld(cam, VIS, MARGIN);
      else if (dir < 0 && cam <= MARGIN) d = e.maybeShiftWorld(cam, VIS, MARGIN);
      if (d) { cam -= d; shifts++; break; }
    }
  }
  check(`completed ${shifts} back-and-forth shifts without divergence/crash`, shifts >= 5, `(${shifts})`);
  const s = e.getShiftFillStats();
  check('all shifts were cache hits (prefetch + saved tiles)', s.miss === 0, `hit=${s.hit} miss=${s.miss}`);
  e.destroy();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
