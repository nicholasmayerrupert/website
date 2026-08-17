// Predictive worldgen must preserve both layers byte-for-byte while turning
// horizontal and vertical stream shifts into cache hits.

import {
  initSandWasm, createEngineWasm, MAT, PLANET,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

// Chunk-aligned buffer (cols/rows multiples of 32) so whole tiles persist — the
// game's buffer is chunk-rounded; a partial-tile buffer never caches, so prefetch
// would be a silent no-op there.
const COLS = 256, ROWS = 256, SEED = 0xBEEF77; // square + chunk-aligned: symmetric runway both axes
const VIS = 96, VISR = 96, MARGIN = 40;        // MARGIN matches CAM_SHIFT_EDGE_MARGIN (prefetch's assumption)

const fnv = (g) => { let h = 0x811c9dc5; for (let i = 0; i < g.length; i++) { h ^= g[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failures++; };

await initSandWasm();
const mk = (options = {}) => attachTestHooks(createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true,
  ...options,
}));

// Drive a one-axis pan of `shiftsWanted` shifts; B runs prefetchAdvance each frame,
// A does not. Compare fg+bg checksums after every shift. Returns the two engines'
// shift-fill stats so the caller can assert prefetch engaged.
function panAxis(axis, shiftsWanted, options = {}) {
  const A = mk(options), B = mk(options);
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

console.log('deep hazard boundaries stay inside a streamed entering band');
{
  const cols = 256, rows = 1024;
  const options = {
    cols, rows, worldSeed: 198, sinksOn: false, infinite: true,
  };
  const synchronous = attachTestHooks(createEngineWasm(options));
  const prefetched = attachTestHooks(createEngineWasm(options));
  const retainedIndexBeforeShift = 974 * cols + 255;
  const retainedBeforeShift = synchronous.getGrid()[retainedIndexBeforeShift];
  for (let i = 0; i < 100
      && prefetched.getWorldStoreStats().prefetchTiles < 256; i++)
    prefetched.prefetchAdvance(100, 512, 96, 96);
  synchronous.shiftWorldXY(128, 0);
  prefetched.shiftWorldXY(128, 0);
  const syncFg = synchronous.getGrid(), prefetchFg = prefetched.getGrid();
  const syncBg = synchronous.getGridBg(), prefetchBg = prefetched.getGridBg();
  let fgMismatches = 0, bgMismatches = 0;
  for (let i = 0; i < syncFg.length; i++) {
    if (syncFg[i] !== prefetchFg[i]) fgMismatches++;
    if (syncBg[i] !== prefetchBg[i]) bgMismatches++;
  }
  const retainedIndexAfterShift = 974 * cols + 127;
  check('seed-198 synchronous and prefetched shifts are byte-identical',
    fgMismatches === 0 && bgMismatches === 0,
    `foreground=${fgMismatches} background=${bgMismatches}`);
  check('hazard sealing does not rewrite the retained edge cell',
    retainedBeforeShift === MAT.STONE
      && syncFg[retainedIndexAfterShift] === retainedBeforeShift,
    `before=${retainedBeforeShift} after=${syncFg[retainedIndexAfterShift]}`);
  const syncStats = synchronous.getShiftFillStats();
  const prefetchStats = prefetched.getShiftFillStats();
  check('seed-198 control used synchronous generation while prefetch used cache',
    syncStats.miss === 2 && prefetchStats.hit === 2 && prefetchStats.miss === 0,
    `sync hit=${syncStats.hit} miss=${syncStats.miss}; prefetch hit=${prefetchStats.hit} miss=${prefetchStats.miss}`);
  synchronous.destroy(); prefetched.destroy();
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

console.log('the shared synchronous/prefetch pipeline covers every planet');
for (const [name, planetId] of Object.entries(PLANET)) {
  const r = panAxis('x', 3, { planetId });
  check(`${name.toLowerCase()} prefetch matches synchronous generation`,
    r.shifts === 3 && r.mism === 0 && r.statsB.miss === 0,
    `shifts=${r.shifts} mismatches=${r.mism} hit=${r.statsB.hit} miss=${r.statsB.miss}`);
}

// A perpendicular world shift changes one absolute coordinate of every pending
// prefetch slice. If a foreground band survives that shift, its early columns
// retain the old vertical origin while its later columns use the new one. The
// cached strip then appears as a tall foreground pillar shifted by one stream
// step, even though the background (generated afterward) remains continuous.
console.log('perpendicular shift invalidates an in-flight foreground prefetch');
{
  const A = mk(), B = mk();
  const triggerX = COLS - VIS - MARGIN;
  const camX = triggerX - 20;
  const camY = ROWS / 2;

  // Begin only the first foreground slice of the upcoming right-hand band.
  B.prefetchAdvance(camX, camY, VIS, VISR);
  // Move the loaded window upward before that band finishes.
  A.shiftWorldXY(0, -96);
  B.shiftWorldXY(0, -96);
  // Finish enough slices for both layers, then consume the cached right band.
  for (let i = 0; i < 16; i++) B.prefetchAdvance(camX, camY, VIS, VISR);
  A.shiftWorldXY(128, 0);
  B.shiftWorldXY(128, 0);

  const af = fnv(A.getGrid()), bf = fnv(B.getGrid());
  const abg = fnv(A.getGridBg()), bbg = fnv(B.getGridBg());
  check('interrupted prefetch stays byte-identical to synchronous foreground',
    af === bf, `control=0x${af.toString(16)} prefetched=0x${bf.toString(16)}`);
  check('interrupted prefetch stays byte-identical to synchronous background',
    abg === bbg, `control=0x${abg.toString(16)} prefetched=0x${bbg.toString(16)}`);
  A.destroy(); B.destroy();
}

console.log('invalid public shifts leave the loaded world untouched');
{
  const e = mk();
  const before = {
    hash: e.gridHash(), x: e.getWorldOffsetX(), y: e.getWorldOffsetY(),
    shifts: e.getWorldShiftCount(),
  };
  e.shiftWorldXY(32, 32);
  e.shiftWorldXY(COLS, 0);
  e.shiftWorldXY(0, -2147483648);
  e.shiftWorldXY(1, 0);
  check('diagonal, oversized, unaligned, and INT_MIN shifts have no side effects',
    e.gridHash() === before.hash
      && e.getWorldOffsetX() === before.x && e.getWorldOffsetY() === before.y
      && e.getWorldShiftCount() === before.shifts);
  e.destroy();
}

// Re-entering a region the camera already left is ALSO a hit (the leaving band was
// saved to the tileStore) — prefetch must coexist with that without clobbering it.
console.log('prefetch coexists with saved (revisited) tiles');
{
  const e = mk();
  // edit some foreground terrain so a leaving band has real saved state
  for (let i = 0; i < 30; i++) e.paintDisc(60 + i * 4, 40 + (i % 12), 3, 1, false);
  const editedHash = fnv(e.getGrid());
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
  const store = e.getWorldStoreStats();
  check('edited tiles use persistent storage', store.persistentTiles > 0,
    `persistent=${store.persistentTiles}, prefetch=${store.prefetchTiles}`);
  check('edited world is exact after leaving and revisiting', fnv(e.getGrid()) === editedHash);
  e.destroy();
}

console.log('pristine exploration keeps only a bounded baseline cache');
{
  const e = mk();
  let cam = MARGIN + 6;
  const trigger = COLS - VIS - MARGIN;
  let shifts = 0, maxBytes = 0, maxPrefetchTiles = 0, maxPersistentTiles = 0;
  while (shifts < 80) {
    e.prefetchAdvance(cam, 0, VIS, VISR);
    cam += 2;
    if (cam < trigger) continue;
    const dx = e.maybeShiftWorld(cam, VIS, MARGIN);
    if (!dx) continue;
    cam -= dx;
    shifts++;
    const stats = e.getWorldStoreStats();
    maxBytes = Math.max(maxBytes, stats.bytes);
    maxPrefetchTiles = Math.max(maxPrefetchTiles, stats.prefetchTiles);
    maxPersistentTiles = Math.max(maxPersistentTiles, stats.persistentTiles);
  }
  check('pristine terrain never enters persistent storage', maxPersistentTiles === 0,
    `max persistent=${maxPersistentTiles}`);
  check('baseline tile cache remains bounded over 80 novel shifts', maxPrefetchTiles <= 512,
    `max prefetch=${maxPrefetchTiles}`);
  check('compressed baseline cache remains compact', maxBytes < 100_000,
    `max bytes=${maxBytes}`);
  e.destroy();
}

console.log('persisted leaving tiles retire loaded-window dirty keys');
{
  const e = mk();
  let edits = 0, maxDirtyAfterShift = 0;
  for (let i = 0; i < 24; i++) {
    if (e.paintDisc(8, 8, 1, MAT.SAND, true)) edits++;
    e.shiftWorld(32);
    maxDirtyAfterShift = Math.max(maxDirtyAfterShift, e._worldDirtyTileCount());
  }
  check('each leaving band received an edit', edits === 24, `edits=${edits}`);
  check('off-screen persistence does not retain dirty keys', maxDirtyAfterShift === 0,
    `max dirty after shift=${maxDirtyAfterShift}`);
  e.destroy();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
