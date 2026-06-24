// Deterministic headless benchmark for the WebAssembly sand engine + render fill.
// Run with:
//   node scripts/bench-sand.mjs                       # print results
//   node scripts/bench-sand.mjs --json out.json       # also write raw results
//   node scripts/bench-sand.mjs --compare bench/baseline.json
//   node scripts/bench-sand.mjs --repeat 5            # reduce timing noise
//   node scripts/bench-sand.mjs --checksum-only       # deterministic behavior check
//   node scripts/bench-sand.mjs --update bench/baseline.json   # (re)write baseline
//
// Measures, over a simulated panning session, the per-operation cost
// distribution (p50/p95/p99/max, in ms) for:
//   - engine.step           (C++ step, measured inside wasm via emscripten_get_now)
//   - shiftWorld (miss)     world streaming that has to generate fresh terrain
//   - shiftWorld (hit)      world streaming that restores cached terrain
//   - renderFull            full-buffer material->RGBA fill in wasm (render hot path)
//
// The engine is deterministic for a fixed seed, so step/shift costs and the
// terrain checksum are stable run-to-run (modulo CPU noise in the timings).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

// --- args ---
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(name);
const comparePath = flag('--compare');
const updatePath = flag('--update');
const jsonPath = flag('--json');
const repeat = Math.max(1, Number(flag('--repeat') || 1) | 0);
const checksumOnly = hasFlag('--checksum-only');

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
const fileHash = (path) => {
  const bytes = readFileSync(path);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
const safeExec = (cmd, argv = []) => {
  try { return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};
const gitMeta = () => {
  const commit = safeExec('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = spawnSync('git', ['diff', '--quiet']).status !== 0 || spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
  return { commit, dirty };
};
const wasmMeta = () => {
  const path = 'src/sand/wasm/sandEngine.js';
  const st = statSync(path);
  return { path, bytes: st.size, fnv1a: fileHash(path), emcc: safeExec('emcc', ['--version'])?.split('\n')[0] || null, emccPath: safeExec('which', ['emcc']) };
};
const metadata = () => ({
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${platform()} ${release()}`,
  git: gitMeta(),
  wasm: wasmMeta(),
});

const now = () => performance.now();

await initSandWasm();

const emptySamples = () => ({
  stepMs: [], renderMs: [], shiftMissMs: [], shiftHitMs: [],
  stepPhases: { ground: [], rigid: [], react: [], carry: [], settle: [], tail: [] },
  shiftPhases: { buffers: [], translate: [], register: [], fill: [] },
  dirtyChunks: [], heapBytes: [], shiftHits: [], shiftMisses: [],
});
const addSamples = (to, from) => {
  for (const k of ['stepMs', 'renderMs', 'shiftMissMs', 'shiftHitMs', 'dirtyChunks', 'heapBytes', 'shiftHits', 'shiftMisses']) to[k].push(...from[k]);
  for (const k of Object.keys(to.stepPhases)) to.stepPhases[k].push(...from.stepPhases[k]);
  for (const k of Object.keys(to.shiftPhases)) to.shiftPhases[k].push(...from.shiftPhases[k]);
};
const summarizeSamples = (samples) => ({
  step: summarize(samples.stepMs),
  renderFull: summarize(samples.renderMs),
  shiftWorldMiss: summarize(samples.shiftMissMs),
  shiftWorldHit: summarize(samples.shiftHitMs),
  stepPhases: Object.fromEntries(Object.entries(samples.stepPhases).map(([k, v]) => [k, summarize(v)])),
  shiftPhases: Object.fromEntries(Object.entries(samples.shiftPhases).map(([k, v]) => [k, summarize(v)])),
  dirtyChunks: summarize(samples.dirtyChunks),
  heapBytes: summarize(samples.heapBytes),
  shiftFill: { hit: summarize(samples.shiftHits), miss: summarize(samples.shiftMisses) },
});

function runScenario() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });
  for (let i = 0; i < 60; i++) e.paintDisc(50 + (i % 40) * 6, 40 + ((i * 7) % 30), 5, 1, false); // sand
  for (let i = 0; i < 40; i++) e.paintDisc(80 + (i % 30) * 7, 30 + ((i * 5) % 20), 5, 2, false); // water

  const samples = emptySamples();
  const stepOnce = () => {
    e.step();
    const perf = e.getPerf();
    const stepPerf = e.getStepPerf();
    samples.stepMs.push(perf.stepMs);
    samples.dirtyChunks.push(perf.dirtyChunks);
    samples.heapBytes.push(e.getHeapBytes());
    for (const k of Object.keys(samples.stepPhases)) samples.stepPhases[k].push(stepPerf[k]);
    if (!checksumOnly) {
      const t = now();
      e.renderFull();
      samples.renderMs.push(now() - t);
    }
  };

  for (let i = 0; i < WARMUP_STEPS; i++) stepOnce();
  for (let k = 0; k < SHIFTS_EACH_WAY; k++) {
    for (let i = 0; i < STEPS_PER_SHIFT; i++) stepOnce();
    const t = now();
    e.shiftWorld(SHIFT_COLS);
    if (!checksumOnly) samples.shiftMissMs.push(now() - t);
    const stats = e.getShiftFillStats();
    samples.shiftHits.push(stats.hit); samples.shiftMisses.push(stats.miss);
  }
  for (let k = 0; k < SHIFTS_EACH_WAY; k++) {
    for (let i = 0; i < STEPS_PER_SHIFT; i++) stepOnce();
    const t = now();
    e.shiftWorld(-SHIFT_COLS);
    if (!checksumOnly) samples.shiftHitMs.push(now() - t);
    const p = e.getShiftPerf();
    for (const k2 of Object.keys(samples.shiftPhases)) samples.shiftPhases[k2].push(p[k2]);
    const stats = e.getShiftFillStats();
    samples.shiftHits.push(stats.hit); samples.shiftMisses.push(stats.miss);
  }

  const grid = e.getGrid();
  const out = {
    checksum: checksum(grid),
    worldOffsetX: e.getWorldOffsetX(),
    worldOffsetY: e.getWorldOffsetY(),
    samples,
    summaries: summarizeSamples(samples),
  };
  e.destroy();
  return out;
}

const runs = [];
const combined = emptySamples();
for (let i = 0; i < repeat; i++) {
  const run = runScenario();
  runs.push({
    index: i + 1,
    checksum: run.checksum,
    worldOffsetX: run.worldOffsetX,
    worldOffsetY: run.worldOffsetY,
    ...run.summaries,
  });
  addSamples(combined, run.samples);
}

const checksums = [...new Set(runs.map((r) => r.checksum))];
const result = {
  config: { COLS, ROWS, SEED, SHIFT_COLS, WARMUP_STEPS, SHIFTS_EACH_WAY, STEPS_PER_SHIFT, repeat, checksumOnly },
  metadata: metadata(),
  checksum: runs[0].checksum,
  checksumStable: checksums.length === 1,
  checksums,
  worldOffsetX: runs[0].worldOffsetX,
  worldOffsetY: runs[0].worldOffsetY,
  ...summarizeSamples(combined),
  runs,
};

// --- report ---
const fmt = (s) => `mean ${s.mean.toFixed(3)}  p50 ${s.p50.toFixed(3)}  p95 ${s.p95.toFixed(3)}  p99 ${s.p99.toFixed(3)}  max ${s.max.toFixed(3)}  (n=${s.n})`;
console.log(`\nsand engine benchmark  (${COLS}x${ROWS}, seed ${SEED.toString(16)})`);
console.log(`  checksum 0x${result.checksum.toString(16)}${result.checksumStable ? '' : ' (UNSTABLE ACROSS REPEATS)'}  worldOffset ${result.worldOffsetX},${result.worldOffsetY}`);
console.log(`  meta git ${result.metadata.git.commit}${result.metadata.git.dirty ? ' dirty' : ''}  wasm ${result.metadata.wasm.bytes} bytes fnv 0x${result.metadata.wasm.fnv1a.toString(16)}`);
console.log(`  step            ${fmt(result.step)}`);
if (!checksumOnly) {
  console.log(`  renderFull      ${fmt(result.renderFull)}`);
  console.log(`  shiftWorld miss ${fmt(result.shiftWorldMiss)}`);
  console.log(`  shiftWorld hit  ${fmt(result.shiftWorldHit)}`);
}
const sp = result.shiftPhases, stp = result.stepPhases;
console.log(`  step phases (median ms): ground ${stp.ground.p50}  rigid ${stp.rigid.p50}  react ${stp.react.p50}  carry ${stp.carry.p50}  settle ${stp.settle.p50}  tail ${stp.tail.p50}`);
console.log(`  shift phases (median ms): translate ${sp.translate.p50}  register ${sp.register.p50}  buffers ${sp.buffers.p50}  fill ${sp.fill.p50}`);
console.log(`  dirty chunks p95 ${result.dirtyChunks.p95}  heap ${(result.heapBytes.p50 / (1024 * 1024)).toFixed(1)}MB  shift fill hit/miss p50 ${result.shiftFill.hit.p50}/${result.shiftFill.miss.p50}`);

if (jsonPath) { writeFileSync(jsonPath, JSON.stringify(result, null, 2)); console.log(`\nwrote ${jsonPath}`); }
if (updatePath) { writeFileSync(updatePath, JSON.stringify(result, null, 2)); console.log(`\nupdated baseline ${updatePath}`); }

let exit = 0;
if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\ncompare vs ${comparePath}`);
  if (base.checksum !== result.checksum) {
    console.log(`  CHECKSUM CHANGED 0x${base.checksum.toString(16)} -> 0x${result.checksum.toString(16)} (behavior changed; not a pure refactor)`);
    console.log(`    inspect: worldgen.inc, generated material tables, C++ toolchain/WASM rebuild provenance`);
  } else {
    console.log(`  checksum identical (pure refactor / deterministic)`);
  }
  if (!result.checksumStable) {
    console.log(`  CHECKSUM UNSTABLE across repeats: ${result.checksums.map((h) => `0x${h.toString(16)}`).join(', ')}`);
    exit = 1;
  }
  const rows = checksumOnly ? [['step', 'mean']] : [['step', 'p99'], ['renderFull', 'p99'], ['shiftWorldMiss', 'p99'], ['shiftWorldHit', 'p99'], ['step', 'mean'], ['renderFull', 'mean']];
  const hints = {
    step: 'step.inc, reactions.inc, growth.inc, rigid.inc, player.inc',
    renderFull: 'render.inc and material render tables',
    shiftWorldMiss: 'worldgen.inc fresh-band generation and component registration',
    shiftWorldHit: 'worldgen chunk store restore path and component translation',
  };
  for (const [k, m] of rows) {
    if (!base[k] || !result[k]) continue;
    const b = base[k][m], r = result[k][m];
    const d = b ? ((r - b) / b) * 100 : 0;
    const tag = d > 15 ? ' REGRESSION' : d < -10 ? ' improved' : '';
    console.log(`  ${k}.${m}: ${b.toFixed(3)} -> ${r.toFixed(3)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)${tag}`);
    if (d > 15) {
      console.log(`    inspect: ${hints[k] || 'owning subsystem'}`);
      exit = 1;
    }
  }
}
process.exit(exit);
