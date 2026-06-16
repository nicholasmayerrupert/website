// Deterministic headless benchmark for the WebAssembly sand engine + render fill.
// Run with:
//   node scripts/bench-sand.mjs                       # print results
//   node scripts/bench-sand.mjs --json out.json       # also write raw results
//   node scripts/bench-sand.mjs --compare bench/baseline.json
//   node scripts/bench-sand.mjs --update bench/baseline.json   # (re)write baseline
//
// Measures, over a simulated panning session, the per-operation cost
// distribution (p50/p95/p99/max, in ms) for:
//   - engine.step           (C++ step, measured inside wasm via emscripten_get_now)
//   - shiftWorld (miss)     world streaming that has to generate fresh terrain
//   - shiftWorld (hit)      world streaming that restores cached terrain
//   - fillPixelSpan         full-buffer CPU pixel fill (the render hot path)
//
// The engine is deterministic for a fixed seed, so step/shift costs and the
// terrain checksum are stable run-to-run (modulo CPU noise in the timings).

import { readFileSync, writeFileSync } from 'node:fs';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { makeColorLUT, makeTexture, fillPixelSpan } from '../src/sand/renderCore.js';

// --- args ---
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const comparePath = flag('--compare');
const updatePath = flag('--update');
const jsonPath = flag('--json');

// --- config (mirrors a ~1080p viewport buffer; see createSandGame fit()) ---
const COLS = 768, ROWS = 320, SEED = 0xC0FFEE;
const SHIFT_COLS = 128;        // matches game streaming
const WARMUP_STEPS = 120;
const SHIFTS_EACH_WAY = 16;    // distinct shift bursts to sample
const STEPS_PER_SHIFT = 8;     // sim steps between shifts (settling)

// --- stats helpers ---
const pct = (sorted, p) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
};
const summarize = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return {
    n: s.length,
    mean: +mean.toFixed(4),
    p50: +pct(s, 50).toFixed(4),
    p95: +pct(s, 95).toFixed(4),
    p99: +pct(s, 99).toFixed(4),
    max: +(s[s.length - 1] || 0).toFixed(4),
  };
};
// FNV-1a over the grid: a cheap deterministic terrain checksum.
const checksum = (g) => { let h = 0x811c9dc5; for (let i = 0; i < g.length; i++) { h ^= g[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };

const now = () => performance.now();

await initSandWasm();

const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

// Seed a little edited terrain so shiftWorld has bodies/materials to persist.
for (let i = 0; i < 60; i++) e.paintDisc(50 + (i % 40) * 6, 40 + ((i * 7) % 30), 5, 1, false); // sand
for (let i = 0; i < 40; i++) e.paintDisc(80 + (i % 30) * 7, 30 + ((i * 5) % 20), 5, 2, false); // water

const stepMs = [];
const fillMs = [];
const shiftMissMs = [];
const shiftHitMs = [];

const lut = makeColorLUT();
// Deterministic texture so the bench is reproducible run-to-run.
let rs = 0x9e3779b9 >>> 0;
const detRng = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
const texture = makeTexture(lut, detRng);
const pixels = new Uint32Array(COLS * ROWS);

const stepOnce = () => {
  e.step();
  stepMs.push(e.getPerf().stepMs);
  // The render hot path: full-buffer fill (worst case / forceFullRender path).
  const g = e.getGrid();
  const t = now();
  fillPixelSpan(pixels, g, COLS, 0, 0, COLS - 1, ROWS - 1, lut, texture, detRng);
  fillMs.push(now() - t);
};

// Warm up (worldgen for the initial buffer, JIT, etc).
for (let i = 0; i < WARMUP_STEPS; i++) stepOnce();

// Pan RIGHT into fresh terrain: each shift triggers a worldgen cache-miss.
for (let k = 0; k < SHIFTS_EACH_WAY; k++) {
  for (let i = 0; i < STEPS_PER_SHIFT; i++) stepOnce();
  const t = now();
  e.shiftWorld(SHIFT_COLS);
  shiftMissMs.push(now() - t);
}
// Pan back LEFT over terrain we already generated: cache-hit restores.
const shiftPhases = { buffers: [], translate: [], register: [], fill: [] };
for (let k = 0; k < SHIFTS_EACH_WAY; k++) {
  for (let i = 0; i < STEPS_PER_SHIFT; i++) stepOnce();
  const t = now();
  e.shiftWorld(-SHIFT_COLS);
  shiftHitMs.push(now() - t);
  const p = e.getShiftPerf();
  shiftPhases.buffers.push(p.buffers); shiftPhases.translate.push(p.translate);
  shiftPhases.register.push(p.register); shiftPhases.fill.push(p.fill);
}

const grid = e.getGrid();
const result = {
  config: { COLS, ROWS, SEED, SHIFT_COLS, WARMUP_STEPS, SHIFTS_EACH_WAY, STEPS_PER_SHIFT },
  checksum: checksum(grid),
  worldOffsetX: e.getWorldOffsetX(),
  step: summarize(stepMs),
  fillPixelSpan: summarize(fillMs),
  shiftWorldMiss: summarize(shiftMissMs),
  shiftWorldHit: summarize(shiftHitMs),
  shiftPhases: {
    buffers: summarize(shiftPhases.buffers), translate: summarize(shiftPhases.translate),
    register: summarize(shiftPhases.register), fill: summarize(shiftPhases.fill),
  },
};
e.destroy();

// --- report ---
const fmt = (s) => `mean ${s.mean.toFixed(3)}  p50 ${s.p50.toFixed(3)}  p95 ${s.p95.toFixed(3)}  p99 ${s.p99.toFixed(3)}  max ${s.max.toFixed(3)}  (n=${s.n})`;
console.log(`\nsand engine benchmark  (${COLS}x${ROWS}, seed ${SEED.toString(16)})`);
console.log(`  checksum 0x${result.checksum.toString(16)}  worldOffsetX ${result.worldOffsetX}`);
console.log(`  step            ${fmt(result.step)}`);
console.log(`  fillPixelSpan   ${fmt(result.fillPixelSpan)}`);
console.log(`  shiftWorld miss ${fmt(result.shiftWorldMiss)}`);
console.log(`  shiftWorld hit  ${fmt(result.shiftWorldHit)}`);
const sp = result.shiftPhases;
console.log(`  shift phases (median ms): translate ${sp.translate.p50}  register ${sp.register.p50}  buffers ${sp.buffers.p50}  fill ${sp.fill.p50}`);

if (jsonPath) { writeFileSync(jsonPath, JSON.stringify(result, null, 2)); console.log(`\nwrote ${jsonPath}`); }
if (updatePath) { writeFileSync(updatePath, JSON.stringify(result, null, 2)); console.log(`\nupdated baseline ${updatePath}`); }

let exit = 0;
if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\ncompare vs ${comparePath}`);
  if (base.checksum !== result.checksum) {
    console.log(`  CHECKSUM CHANGED 0x${base.checksum.toString(16)} -> 0x${result.checksum.toString(16)} (behavior changed; not a pure refactor)`);
  } else {
    console.log(`  checksum identical (pure refactor / deterministic)`);
  }
  const rows = [['step', 'p99'], ['fillPixelSpan', 'p99'], ['shiftWorldMiss', 'p99'], ['shiftWorldHit', 'p99'], ['step', 'mean'], ['fillPixelSpan', 'mean']];
  for (const [k, m] of rows) {
    const b = base[k][m], r = result[k][m];
    const d = b ? ((r - b) / b) * 100 : 0;
    const tag = d > 15 ? ' REGRESSION' : d < -10 ? ' improved' : '';
    console.log(`  ${k}.${m}: ${b.toFixed(3)} -> ${r.toFixed(3)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)${tag}`);
    if (d > 15) exit = 1;
  }
}
process.exit(exit);
