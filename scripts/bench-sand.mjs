// Deterministic headless benchmark for the WebAssembly sand engine + render fill.
// Run with:
//   node scripts/bench-sand.mjs                       # print results
//   node scripts/bench-sand.mjs --json out.json       # also write raw results
//   node scripts/bench-sand.mjs --compare bench/baseline.json
//   node scripts/bench-sand.mjs --repeat 5            # reduce timing noise
//   node scripts/bench-sand.mjs --scenario all        # run every load scenario
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
const scenarioArg = flag('--scenario') || 'pan-stream';

// --- config (mirrors a ~1080p viewport buffer; see createSandGame fit()) ---
const COLS = 768, ROWS = 320, SEED = 0xC0FFEE;
const SHIFT_COLS = 128;        // matches game streaming
const WARMUP_STEPS = 120;
const SHIFTS_EACH_WAY = 16;    // distinct shift bursts to sample
const STEPS_PER_SHIFT = 8;     // sim steps between shifts (settling)
const SCENARIOS = ['pan-stream', 'liquid-active', 'components-active', 'survival-actions', 'net-apply'];

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
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};
const gitMeta = () => {
  const commit = safeExec('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = spawnSync('git', ['diff', '--quiet']).status !== 0 || spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
  return { commit, dirty };
};
const wasmMeta = () => {
  const path = 'src/sand/wasm/sandEngine.js';
  const st = statSync(path);
  return {
    path,
    bytes: st.size,
    fnv1a: fileHash(path),
    emcc: safeExec('emcc', ['--version'])?.split('\n')[0] || null,
    emccPath: safeExec('which', ['emcc']),
    buildInfo: readJson('src/sand/wasm/build-info.json'),
  };
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
  stepPhases: { ground: [], rigid: [], react: [], carry: [], settle: [], tail: [], joint: [], layers: [], cross: [] },
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

function setupScenario(e, name) {
  const ctx = { name, client: null, playerId: 0, seq: 0 };
  if (name === 'pan-stream') return ctx;
  if (name === 'liquid-active') {
    for (let i = 0; i < 90; i++) e.paintDisc(90 + (i % 45) * 6, 25 + ((i * 5) % 45), 5, 2, false); // water
    for (let i = 0; i < 70; i++) e.paintDisc(110 + (i % 35) * 7, 28 + ((i * 7) % 50), 4, 4, false); // oil
    for (let i = 0; i < 55; i++) e.paintDisc(130 + (i % 30) * 8, 32 + ((i * 11) % 52), 4, 10, false); // acid
    return ctx;
  }
  if (name === 'components-active') {
    for (let i = 0; i < 80; i++) e.addDiscToStoneDraft(70 + (i % 40) * 8, 34 + ((i * 9) % 70), 4);
    e.finalizeStoneDraft();
    for (let i = 0; i < 24; i++) {
      const x = 120 + (i % 12) * 36;
      const y = 52 + ((i * 17) % 70);
      e.placeSeedTyped(x, y, i % 6);
    }
    return ctx;
  }
  if (name === 'survival-actions') {
    e.setSurvivalInventory(true);
    ctx.playerId = e.spawnPlayerAtSurface(Math.floor(COLS / 2));
    e.addToInventory(ctx.playerId, 1, 999); // sand
    e.addToInventory(ctx.playerId, 3, 999); // stone
    e.setSelectedSlot(ctx.playerId, 3);
    return ctx;
  }
  if (name === 'net-apply') {
    ctx.client = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });
    ctx.client.applyWorld(e.serializeWorld());
    ctx.client.resetDirty();
    return ctx;
  }
  throw new Error(`unknown scenario "${name}"`);
}

function beforeStep(e, ctx) {
  if (ctx.name !== 'survival-actions' || !ctx.playerId) return;
  const t = ctx.seq * 16;
  const aimX = Math.floor(COLS / 2) + ((ctx.seq % 24) - 12);
  const aimY = Math.floor(ROWS * 0.45) + ((ctx.seq % 9) - 4);
  e.setPlayerInput(ctx.playerId, { bits: 16, aimX, aimY, tool: 1, seq: ctx.seq });
  e.applyLocalInput(ctx.playerId, t, ctx.seq);
  ctx.seq++;
}

function afterStep(e, ctx) {
  if (ctx.name !== 'net-apply' || !ctx.client) return;
  ctx.client.applyDiff(e.serializeDiff());
}

function destroyScenario(ctx) {
  if (ctx.client) ctx.client.destroy();
}

function runScenario(name) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });
  for (let i = 0; i < 60; i++) e.paintDisc(50 + (i % 40) * 6, 40 + ((i * 7) % 30), 5, 1, false); // sand
  for (let i = 0; i < 40; i++) e.paintDisc(80 + (i % 30) * 7, 30 + ((i * 5) % 20), 5, 2, false); // water
  const ctx = setupScenario(e, name);

  const samples = emptySamples();
  const stepOnce = () => {
    beforeStep(e, ctx);
    e.step();
    afterStep(e, ctx);
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
    scenario: name,
    checksum: checksum(grid),
    worldOffsetX: e.getWorldOffsetX(),
    worldOffsetY: e.getWorldOffsetY(),
    samples,
    summaries: summarizeSamples(samples),
  };
  destroyScenario(ctx);
  e.destroy();
  return out;
}

function runBenchmark(name) {
  const runs = [];
  const combined = emptySamples();
  for (let i = 0; i < repeat; i++) {
    const run = runScenario(name);
    runs.push({
      index: i + 1,
      scenario: name,
      checksum: run.checksum,
      worldOffsetX: run.worldOffsetX,
      worldOffsetY: run.worldOffsetY,
      ...run.summaries,
    });
    addSamples(combined, run.samples);
  }
  const checksums = [...new Set(runs.map((r) => r.checksum))];
  return {
    scenario: name,
    config: { COLS, ROWS, SEED, SHIFT_COLS, WARMUP_STEPS, SHIFTS_EACH_WAY, STEPS_PER_SHIFT, repeat, checksumOnly, scenario: name },
    metadata: metadata(),
    checksum: runs[0].checksum,
    checksumStable: checksums.length === 1,
    checksums,
    worldOffsetX: runs[0].worldOffsetX,
    worldOffsetY: runs[0].worldOffsetY,
    ...summarizeSamples(combined),
    runs,
  };
}

const scenarioNames = scenarioArg === 'all' ? SCENARIOS : [scenarioArg];
for (const name of scenarioNames) if (!SCENARIOS.includes(name)) throw new Error(`unknown scenario "${name}". expected one of: ${SCENARIOS.join(', ')}, all`);
const scenarioResults = Object.fromEntries(scenarioNames.map((name) => [name, runBenchmark(name)]));
const result = scenarioArg === 'all' ? {
  config: { repeat, checksumOnly, scenario: 'all', scenarios: SCENARIOS },
  metadata: metadata(),
  scenarios: scenarioResults,
} : scenarioResults[scenarioArg];

// --- report ---
const fmt = (s) => `mean ${s.mean.toFixed(3)}  p50 ${s.p50.toFixed(3)}  p95 ${s.p95.toFixed(3)}  p99 ${s.p99.toFixed(3)}  max ${s.max.toFixed(3)}  (n=${s.n})`;
function printOne(r) {
  console.log(`\nsand engine benchmark:${r.scenario}  (${COLS}x${ROWS}, seed ${SEED.toString(16)})`);
  console.log(`  checksum 0x${r.checksum.toString(16)}${r.checksumStable ? '' : ' (UNSTABLE ACROSS REPEATS)'}  worldOffset ${r.worldOffsetX},${r.worldOffsetY}`);
  console.log(`  meta git ${r.metadata.git.commit}${r.metadata.git.dirty ? ' dirty' : ''}  wasm ${r.metadata.wasm.bytes} bytes fnv 0x${r.metadata.wasm.fnv1a.toString(16)}`);
  if (r.metadata.wasm.buildInfo) {
    const b = r.metadata.wasm.buildInfo;
    console.log(`  wasm build ${b.source?.commit || 'unknown'}${b.source?.dirty ? ' dirty' : ' clean'}  ${b.toolchain?.emcc || 'emcc unknown'}`);
  }
  console.log(`  step            ${fmt(r.step)}`);
  if (!checksumOnly) {
    console.log(`  renderFull      ${fmt(r.renderFull)}`);
    console.log(`  shiftWorld miss ${fmt(r.shiftWorldMiss)}`);
    console.log(`  shiftWorld hit  ${fmt(r.shiftWorldHit)}`);
  }
  const sp = r.shiftPhases, stp = r.stepPhases;
  console.log(`  step phases (median ms): ground ${stp.ground.p50}  rigid ${stp.rigid.p50}  react ${stp.react.p50}  carry ${stp.carry.p50}  settle ${stp.settle.p50}  tail ${stp.tail.p50}`);
  console.log(`  step()-level (median ms): joint ${stp.joint.p50}  layers(fg+bg) ${stp.layers.p50}  cross ${stp.cross.p50}  [joint mean ${stp.joint.mean} p95 ${stp.joint.p95}]`);
  console.log(`  shift phases (median ms): translate ${sp.translate.p50}  register ${sp.register.p50}  buffers ${sp.buffers.p50}  fill ${sp.fill.p50}`);
  console.log(`  dirty chunks p95 ${r.dirtyChunks.p95}  heap ${(r.heapBytes.p50 / (1024 * 1024)).toFixed(1)}MB  shift fill hit/miss p50 ${r.shiftFill.hit.p50}/${r.shiftFill.miss.p50}`);
}
if (scenarioArg === 'all') for (const name of scenarioNames) printOne(result.scenarios[name]);
else printOne(result);

if (jsonPath) { writeFileSync(jsonPath, JSON.stringify(result, null, 2)); console.log(`\nwrote ${jsonPath}`); }
if (updatePath) { writeFileSync(updatePath, JSON.stringify(result, null, 2)); console.log(`\nupdated baseline ${updatePath}`); }

let exit = 0;
if (comparePath) {
  if (scenarioArg === 'all') {
    console.log('\ncompare skipped for --scenario all; compare individual scenario baselines instead.');
    process.exit(0);
  }
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
