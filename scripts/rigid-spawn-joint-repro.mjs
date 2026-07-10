// Repro: spawning a free rigid body in a dual-layer generated world can make
// foreground solids that were co-supported by the background slough off.
//
// Run: node scripts/rigid-spawn-joint-repro.mjs
// Optional: SEEDS=5 DEPTHS=3 STEPS=12 node scripts/rigid-spawn-joint-repro.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';

const COLS = 220, ROWS = 160;
const SEEDS = Number(process.env.SEEDS || 12);
const DEPTHS = Number(process.env.DEPTHS || 4);
const SETTLE = Number(process.env.SETTLE || 24);
const WATCH = Number(process.env.WATCH || 16);

await initSandWasm();

const COMPONENT_MATS = new Set([
  MAT.STONE, MAT.ICE, MAT.DRIFTWOOD, MAT.SANDSTONE, MAT.MOSS,
  MAT.COPPER_ORE, MAT.IRON_ORE, MAT.COAL_ORE, MAT.GOLD_ORE, MAT.BRICK,
  MAT.PINE_WOOD, MAT.CACTUS, MAT.MUSH_STEM, MAT.MUSH_CAP, MAT.VINE,
  MAT.TNT, MAT.DEBRIS, MAT.CRYSTAL, MAT.MYCELIUM, MAT.MYCELIUM_SPORE,
  MAT.WOOD, MAT.PLANT, MAT.SEED,
]);

const countOneStepComponentDrops = (before, after, cols, rows) => {
  let total = 0;
  const byMat = new Map();
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols; x++) {
    const k = y * cols + x;
    const m = before[k];
    if (!COMPONENT_MATS.has(m)) continue;
    // Cell moved down one row (same material now below, gone here, not already below).
    if (after[k] !== m && before[k + cols] !== m && after[k + cols] === m) {
      total++;
      byMat.set(m, (byMat.get(m) || 0) + 1);
    }
  }
  return { total, byMat };
};

const matName = (id) => {
  for (const [k, v] of Object.entries(MAT)) if (v === id) return k;
  return String(id);
};

const summarize = (byMat) =>
  [...byMat.entries()].map(([m, n]) => `${matName(m)}:${n}`).join(',') || 'none';

// Co-occupied rigid cells: FG rigid over BG rigid at same index.
const countCoOcc = (fg, bg, cols, rows) => {
  let n = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (COMPONENT_MATS.has(fg[i]) && COMPONENT_MATS.has(bg[i])) n++;
  }
  return n;
};

// Count FG rigid cells that have BG rigid co-occupation (potential joint support).
const countJointSupportedCandidates = (fg, bg, cols, rows) => {
  let n = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (COMPONENT_MATS.has(fg[i]) && COMPONENT_MATS.has(bg[i])) n++;
  }
  return n;
};

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
};

const runCase = (seed, depthShift, doSpawn) => {
  const e = createEngineWasm({
    cols: COLS, rows: ROWS, worldSeed: seed, infinite: true, sinksOn: false,
  });
  // Dual-layer is on by default for infinite worldgen.
  for (let d = 0; d < depthShift; d++) e.shiftWorldXY(0, 96);
  // Also pan a bit horizontally so we are not on the origin seam only.
  e.shiftWorldXY(64, 0);

  for (let i = 0; i < SETTLE; i++) e.step(16 * (i + 1));

  const fg0 = e.getGrid().slice();
  const bg0 = e.getGridBg().slice();
  const co0 = countCoOcc(fg0, bg0, COLS, ROWS);

  if (doSpawn) {
    // Spawn high in the buffer (air / near surface relative to camera).
    // Cube tool size ~ CUBE_HALF=5 → 10x10 body.
    e.spawnBox((COLS / 2) | 0, 24, 5, 5, MAT.RIGID);
  }

  let dropped = 0;
  let peak = 0;
  const peakByMat = new Map();
  for (let i = 0; i < WATCH; i++) {
    const before = e.getGrid().slice();
    e.step(16 * (SETTLE + i + 1));
    const r = countOneStepComponentDrops(before, e.getGrid(), COLS, ROWS);
    // Ignore drops that are just the RIGID body itself falling.
    let rigidOnly = 0;
    if (r.byMat.has(MAT.RIGID)) rigidOnly = r.byMat.get(MAT.RIGID);
    const structural = r.total - rigidOnly;
    dropped += structural;
    if (structural > peak) {
      peak = structural;
      peakByMat.clear();
      for (const [m, n] of r.byMat) if (m !== MAT.RIGID) peakByMat.set(m, n);
    }
  }

  e.destroy();
  return { dropped, peak, peakByMat, co0 };
};

console.log('rigid-spawn joint slough repro (generated dual-layer world)\n');

// Baseline: no spawn — structural drops should be ~0 after settle.
{
  console.log('baseline: settle only (no spawn)');
  let worst = 0, worstMeta = null;
  for (let s = 0; s < Math.min(SEEDS, 6); s++) {
    const seed = 1000 + s * 97;
    for (let d = 0; d < Math.min(DEPTHS, 3); d++) {
      const r = runCase(seed, d, false);
      if (r.dropped > worst) {
        worst = r.dropped;
        worstMeta = { seed, d, ...r };
      }
    }
  }
  check(
    'settle-only structural drops small',
    worst < 30,
    worstMeta
      ? `(worst ${worst} seed=${worstMeta.seed} depth=${worstMeta.d} mats=${summarize(worstMeta.peakByMat)} co=${worstMeta.co0})`
      : `(worst ${worst})`,
  );
}

// Treatment: spawn rigid body after settle.
{
  console.log('treatment: spawn rigid box after settle');
  let worst = 0, worstMeta = null;
  let hits = 0;
  const hitsList = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 97;
    for (let d = 0; d < DEPTHS; d++) {
      const r = runCase(seed, d, true);
      if (r.dropped > worst) {
        worst = r.dropped;
        worstMeta = { seed, d, ...r };
      }
      // A clear slough: dozens of component cells dropping in one step after spawn.
      if (r.peak >= 40 || r.dropped >= 80) {
        hits++;
        hitsList.push({ seed, d, dropped: r.dropped, peak: r.peak, mats: summarize(r.peakByMat), co: r.co0 });
      }
    }
  }
  console.log(`  scanned ${SEEDS * DEPTHS} (seed,depth) cases; hits=${hits}`);
  if (hitsList.length) {
    for (const h of hitsList.slice(0, 12)) {
      console.log(`    hit seed=${h.seed} depth=${h.d} dropped=${h.dropped} peak=${h.peak} mats=${h.mats} co=${h.co}`);
    }
  }
  check(
    'spawn does not cause FG structural slough',
    hits === 0 && worst < 80,
    worstMeta
      ? `(worst dropped=${worst} peak=${worstMeta.peak} seed=${worstMeta.seed} depth=${worstMeta.d} mats=${summarize(worstMeta.peakByMat)} co=${worstMeta.co0})`
      : `(worst ${worst})`,
  );
}

// Variant: spawn after a second horizontal stream (more cave topology).
{
  console.log('variant: stream, settle, spawn');
  let hits = 0;
  let worst = 0, worstMeta = null;
  for (let s = 0; s < SEEDS; s++) {
    const seed = 2000 + s * 131;
    const e = createEngineWasm({
      cols: COLS, rows: ROWS, worldSeed: seed, infinite: true, sinksOn: false,
    });
    for (let d = 0; d < 3; d++) e.shiftWorldXY(0, 96);
    e.shiftWorldXY(128, 0);
    for (let i = 0; i < SETTLE; i++) e.step(16 * (i + 1));
    e.spawnBox((COLS / 2) | 0, 30, 5, 5, MAT.RIGID);
    let dropped = 0, peak = 0;
    const peakByMat = new Map();
    for (let i = 0; i < WATCH; i++) {
      const before = e.getGrid().slice();
      e.step(16 * (SETTLE + i + 1));
      const r = countOneStepComponentDrops(before, e.getGrid(), COLS, ROWS);
      const rigidOnly = r.byMat.get(MAT.RIGID) || 0;
      const structural = r.total - rigidOnly;
      dropped += structural;
      if (structural > peak) {
        peak = structural;
        peakByMat.clear();
        for (const [m, n] of r.byMat) if (m !== MAT.RIGID) peakByMat.set(m, n);
      }
    }
    e.destroy();
    if (dropped > worst) {
      worst = dropped;
      worstMeta = { seed, dropped, peak, peakByMat };
    }
    if (peak >= 40 || dropped >= 80) {
      hits++;
      console.log(`    hit seed=${seed} dropped=${dropped} peak=${peak} mats=${summarize(peakByMat)}`);
    }
  }
  check(
    'stream+spawn does not cause FG structural slough',
    hits === 0 && worst < 80,
    worstMeta
      ? `(worst dropped=${worst} peak=${worstMeta.peak} seed=${worstMeta.seed} mats=${summarize(worstMeta.peakByMat)})`
      : `(worst ${worst})`,
  );
}

console.log(failures === 0 ? '\nno rigid-spawn joint slough reproduced' : `\n${failures} failure(s) — bug reproduced`);
process.exit(failures === 0 ? 0 : 1);
