// Pan-stutter benchmark — measures the periodic frame-time SPIKE you feel when
// panning the camera sideways. Run with:
//   node scripts/bench-pan-stutter.mjs
//   node scripts/bench-pan-stutter.mjs --compare bench/pan-stutter-baseline.json
//   node scripts/bench-pan-stutter.mjs --update  bench/pan-stutter-baseline.json
//
// WHY this exists: a steady pan steps the sim every frame (cheap), but every
// WORLD_SHIFT_COLS cells the loaded world window slides one chunk — shiftWorld()
// re-streams a band of terrain AND re-indexes every component of BOTH layers.
// That work lands entirely on ONE frame, so at 60fps it shows up as a hitch
// roughly once a second. This bench reproduces a real game loop (step + a
// camera-driven shift) and reports the per-frame time distribution, separating
// the rare "shift frames" from the common "step frames" so the spike is explicit.
//
// The engine is deterministic for a fixed seed, so the terrain checksum is stable
// run-to-run; --compare flags both a checksum change and a frame-time regression.

import { readFileSync, writeFileSync } from 'node:fs';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const comparePath = flag('--compare');
const updatePath = flag('--update');

// ~1080p viewport buffer (mirrors createSandGame fit()); a two-layer infinite world.
const COLS = 768, ROWS = 320, SEED = 0xC0FFEE;
const VISIBLE = 342;            // visible columns (≈1366px / 4px cells)
const MARGIN = 48;              // shift margin (cells from the edge)
const PAN_CELLS_PER_FRAME = 3;  // steady pan speed (cells/frame) -> a shift every ~43 frames
const FRAMES = 2400;            // ~40s at 60fps (enough shift samples for a stable median)

const now = () => performance.now();
const pct = (s, p) => s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))] : 0;
const summarize = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, mean: +mean.toFixed(4), p50: +pct(s, 50).toFixed(4), p95: +pct(s, 95).toFixed(4), p99: +pct(s, 99).toFixed(4), max: +(s[s.length - 1] || 0).toFixed(4) };
};
const checksum = (g) => { let h = 0x811c9dc5; for (let i = 0; i < g.length; i++) { h ^= g[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };

await initSandWasm();
const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });
// A little edited terrain so the shift has materials/bodies to persist.
for (let i = 0; i < 60; i++) e.paintDisc(50 + (i % 40) * 6, 40 + ((i * 7) % 30), 5, 1, false); // sand
for (let i = 0; i < 40; i++) e.paintDisc(80 + (i % 30) * 7, 30 + ((i * 5) % 20), 5, 2, false); // water
for (let i = 0; i < 120; i++) e.step(); // warm up worldgen + JIT

const frameMs = [], stepFrameMs = [], shiftFrameMs = [];
let camX = MARGIN + 4;          // virtual camera left column, panning right
let shifts = 0;
for (let f = 0; f < FRAMES; f++) {
  const t0 = now();
  e.step();
  camX += PAN_CELLS_PER_FRAME;
  // Same rule as the game loop: slide the window when the camera nears the edge.
  let dx = 0;
  if (camX >= COLS - VISIBLE - MARGIN) { dx = e.maybeShiftWorld(camX, VISIBLE, MARGIN); }
  const dt = now() - t0;
  frameMs.push(dt);
  if (dx) { camX -= dx; shifts++; shiftFrameMs.push(dt); } else stepFrameMs.push(dt);
}

const result = {
  config: { COLS, ROWS, SEED, VISIBLE, MARGIN, PAN_CELLS_PER_FRAME, FRAMES },
  checksum: checksum(e.getGrid()),
  shifts,
  frame: summarize(frameMs),
  stepFrame: summarize(stepFrameMs),
  shiftFrame: summarize(shiftFrameMs),
};
e.destroy();

const fmt = (s) => `mean ${s.mean.toFixed(2)}  p50 ${s.p50.toFixed(2)}  p95 ${s.p95.toFixed(2)}  p99 ${s.p99.toFixed(2)}  max ${s.max.toFixed(2)}  (n=${s.n})`;
console.log(`\npan-stutter benchmark  (${COLS}x${ROWS}, seed ${SEED.toString(16)}, ${result.shifts} shifts over ${FRAMES} frames)`);
console.log(`  checksum 0x${result.checksum.toString(16)}`);
console.log(`  all frames    ${fmt(result.frame)}`);
console.log(`  step frames   ${fmt(result.stepFrame)}`);
console.log(`  SHIFT frames  ${fmt(result.shiftFrame)}   <- the stutter`);
// Headline = MEDIAN shift-frame cost (robust to host noise; the few-sample p99/max
// is a single jittery outlier on this shared box). A 60fps frame budget is 16.7ms;
// a shift frame that fits inside that won't drop a frame, so the pan stays smooth.
const med = result.shiftFrame.p50;
const verdict = med <= 16.7 ? 'fits a 60fps frame -> smooth' : med <= 33 ? 'spills one frame -> minor hitch' : 'multi-frame stall -> visible stutter';
console.log(`  median shift-frame ${med.toFixed(1)}ms  (vs ${result.stepFrame.p50.toFixed(1)}ms median normal frame)  -> ${verdict}`);

if (updatePath) { writeFileSync(updatePath, JSON.stringify(result, null, 2)); console.log(`\nupdated baseline ${updatePath}`); }
let exit = 0;
if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\ncompare vs ${comparePath}`);
  console.log(base.checksum === result.checksum ? '  checksum identical' : `  CHECKSUM CHANGED 0x${base.checksum.toString(16)} -> 0x${result.checksum.toString(16)}`);
  for (const [k, m] of [['shiftFrame', 'p99'], ['shiftFrame', 'max'], ['frame', 'p99'], ['stepFrame', 'mean']]) {
    const b = base[k][m], r = result[k][m], d = b ? ((r - b) / b) * 100 : 0;
    const tag = d > 15 ? ' REGRESSION' : d < -10 ? ' improved' : '';
    console.log(`  ${k}.${m}: ${b.toFixed(2)} -> ${r.toFixed(2)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)${tag}`);
    if (d > 15) exit = 1;
  }
}
process.exit(exit);
