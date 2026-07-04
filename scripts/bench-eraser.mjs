// Targeted benchmark for creative erasing over component-backed stone.
// Run with:
//   node scripts/bench-eraser.mjs
//   npm run bench:eraser

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';

const COLS = 320, ROWS = 220;
const T = { eraser: 11 };
const now = () => performance.now();
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))] || 0;
const summarize = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, mean, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] || 0 };
};
const fmt = (v) => v.toFixed(3).padStart(7);
const print = (name, s) => {
  console.log(`${name.padEnd(24)} mean ${fmt(s.mean)}  p50 ${fmt(s.p50)}  p95 ${fmt(s.p95)}  p99 ${fmt(s.p99)}  max ${fmt(s.max)}  n=${s.n}`);
};

await initSandWasm();

const fillStone = (e, layer = 0) => {
  for (let y = 12; y < ROWS - 1; y++) {
    for (let x = 12; x < COLS - 12; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
  }
  e.syncComponentsLayer(layer);
};

const runDirect = ({ layers = 1, radius = 3, points = 180 }) => {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, infinite: false, sinksOn: false });
  e.setBgEnabled(layers > 1);
  fillStone(e, 0);
  if (layers > 1) fillStone(e, 1);
  const samples = [];
  let cleared = 0;
  for (let i = 0; i < points; i++) {
    const x = 24 + (i * 7) % (COLS - 48);
    const y = 24 + Math.floor(i / 4) * 3 % (ROWS - 48);
    const t = now();
    for (let layer = 0; layer < layers; layer++) cleared += e.eraseDiscLayer(layer, x, y, radius) ? 1 : 0;
    samples.push(now() - t);
  }
  e.destroy();
  return { summary: summarize(samples), cleared };
};

const runHeldCreative = ({ layers = 1, emits = 140, stride = 4 }) => {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, infinite: false, sinksOn: false });
  e.setBgEnabled(layers > 1);
  fillStone(e, 0);
  if (layers > 1) fillStone(e, 1);
  e.setTool(T.eraser);
  const samples = [];
  let tMs = 1000;
  const y = Math.floor(ROWS * 0.5);
  e.pointerDown(24, y, 0);
  if (layers > 1) e.pointerDown(24, y + 24, 2);
  for (let i = 0; i < emits; i++) {
    const x = 24 + ((i * stride) % (COLS - 48));
    const cy = y + Math.floor(i / 55) * 16;
    const t = now();
    e.applyTool(x, cy, tMs += 25, true, true);
    samples.push(now() - t);
  }
  e.pointerUp(0);
  if (layers > 1) e.pointerUp(2);
  e.destroy();
  return { summary: summarize(samples) };
};

const directFg = runDirect({ layers: 1 });
const directBoth = runDirect({ layers: 2 });
const heldFg = runHeldCreative({ layers: 1 });
const heldBoth = runHeldCreative({ layers: 2 });

console.log(`eraser benchmark (${COLS}x${ROWS}, component stone field)`);
print('direct erase fg', directFg.summary);
print('direct erase fg+bg', directBoth.summary);
print('held creative fg', heldFg.summary);
print('held creative fg+bg', heldBoth.summary);
