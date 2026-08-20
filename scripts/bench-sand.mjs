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
//   - stepPhases            fine per-step phase breakdown (grounding / carry / sand / …)
//   - stepVolume            dirty rows/cells + component/bond counts that drive cost
//   - shiftWorld (miss)     world streaming that has to generate fresh terrain
//   - shiftWorld (hit)      world streaming that restores cached terrain (+ phase split)
//   - renderFull            full-buffer material->RGBA fill in wasm (render hot path)
//
// The engine is deterministic for a fixed seed, so step/shift costs and the
// terrain checksum are stable run-to-run (modulo CPU noise in the timings).
// See src/sand/PERF.md for phase ownership when a metric regresses.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import {
  compatibleSandBenchmarkConfig,
  compatibleSandTimingEnvironment,
  sandBenchmarkGateMetric,
} from './bench-sand-environment.mjs';
import { commandPath } from '../wasm/emscripten.mjs';

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
if (comparePath && updatePath)
  throw new Error('--compare and --update cannot be used in the same run');

// --- config (defaults mirror a ~1080p viewport buffer; override for zoom sweeps) ---
const COLS = Math.max(64, Number(flag('--cols') || 768) | 0);
const ROWS = Math.max(64, Number(flag('--rows') || 320) | 0);
const SEED = 0xC0FFEE;
const SHIFT_COLS = 128;        // matches game streaming
const WARMUP_STEPS = 120;
const SHIFTS_EACH_WAY = 16;    // distinct shift bursts to sample
const STEPS_PER_SHIFT = 8;     // sim steps between shifts (settling)
const SCENARIOS = ['pan-stream', 'liquid-active', 'components-active', 'survival-actions', 'net-apply'];
const CHECKSUM_SCOPE = 'foreground+background';

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
const fileHash = (path) => {
  const bytes = readFileSync(path);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
const safeExec = (cmd, argv = []) => {
  try { return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};
const benchSourcePrefixes = [
  'src/sand/cpp/',
  'src/sand/materials.schema.json',
  'src/sand/materials.generated.js',
];
const dirtyInBenchSources = () => {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' });
  if (status.status !== 0) return true;
  return status.stdout.split('\n').some((line) => {
    const path = line.slice(3).trim();
    return path && benchSourcePrefixes.some((prefix) => path === prefix || path.startsWith(prefix));
  });
};
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};
const gitMeta = () => {
  const commit = safeExec('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = dirtyInBenchSources();
  return { commit, dirty };
};
const wasmMeta = () => {
  const loaderPath = 'src/sand/wasm/sandEngine.js';
  const path = 'src/sand/wasm/sandEngine.wasm';
  const st = statSync(path);
  return {
    path,
    bytes: st.size,
    fnv1a: fileHash(path),
    loader: {
      path: loaderPath,
      bytes: statSync(loaderPath).size,
      fnv1a: fileHash(loaderPath),
    },
    emcc: safeExec('emcc', ['--version'])?.split('\n')[0] || null,
    emccPath: commandPath('emcc'),
    buildInfo: readJson('src/sand/wasm/build-info.json'),
  };
};
const requireCurrentProductionWasm = () => {
  const provenance = spawnSync(
    process.execPath, ['scripts/write-wasm-build-info.mjs', '--check'], { encoding: 'utf8' },
  );
  if (provenance.status !== 0) {
    const detail = (provenance.stderr || provenance.stdout || '').trim();
    throw new Error(`benchmark comparison/update requires a current production WASM build: ${detail}`);
  }
};
const metadata = () => ({
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${platform()} ${release()}`,
  arch: arch(),
  cpu: cpus()[0]?.model || null,
  git: gitMeta(),
  wasm: wasmMeta(),
});

const now = () => performance.now();

if (comparePath || updatePath) requireCurrentProductionWasm();
await initSandWasm();

// Fine step phases from getStepPerf() (perfSnapshot v2). Order is roughly the
// pipeline order; componentIndexMs nests inside groundingMs.
const STEP_PHASE_KEYS = [
  'forcePrepareMs', 'forceWakeMs',
  'groundingMs', 'crossLayerGroundingMs', 'componentIndexMs',
  'assemblyUnionMs', 'carryMs', 'bodyMs',
  'sandMs', 'liquidMs', 'gasMs',
  'reactMs', 'tailMs', 'liquidRelaxMs', 'liquidSurfaceMs',
  'layersMs', 'crossMs',
  // Legacy aggregates (derived in getStepPerf) for older baselines / scripts.
  'ground', 'rigid', 'react', 'carry', 'settle', 'tail', 'joint', 'layers', 'cross',
];
// Volume counters that explain *why* a phase is expensive (not just how long).
const STEP_VOLUME_KEYS = [
  'dirtyChunks', 'dirtyRows', 'dirtyCells',
  'componentCount', 'componentCellCount', 'crossBondCount',
];
const SHIFT_PHASE_KEYS = ['save', 'buffers', 'translate', 'register', 'fill'];

const emptySamples = () => ({
  stepMs: [], renderMs: [], shiftMissMs: [], shiftHitMs: [],
  stepPhases: Object.fromEntries(STEP_PHASE_KEYS.map((k) => [k, []])),
  stepVolume: Object.fromEntries(STEP_VOLUME_KEYS.map((k) => [k, []])),
  shiftPhases: Object.fromEntries(SHIFT_PHASE_KEYS.map((k) => [k, []])),
  dirtyChunks: [], heapBytes: [], shiftHits: [], shiftMisses: [],
});
const addSamples = (to, from) => {
  for (const k of ['stepMs', 'renderMs', 'shiftMissMs', 'shiftHitMs', 'dirtyChunks', 'heapBytes', 'shiftHits', 'shiftMisses']) to[k].push(...from[k]);
  for (const k of STEP_PHASE_KEYS) to.stepPhases[k].push(...from.stepPhases[k]);
  for (const k of STEP_VOLUME_KEYS) to.stepVolume[k].push(...from.stepVolume[k]);
  for (const k of SHIFT_PHASE_KEYS) to.shiftPhases[k].push(...from.shiftPhases[k]);
};
const summarizeSamples = (samples) => ({
  step: summarize(samples.stepMs),
  renderFull: summarize(samples.renderMs),
  shiftWorldMiss: summarize(samples.shiftMissMs),
  shiftWorldHit: summarize(samples.shiftHitMs),
  stepPhases: Object.fromEntries(Object.entries(samples.stepPhases).map(([k, v]) => [k, summarize(v)])),
  stepVolume: Object.fromEntries(Object.entries(samples.stepVolume).map(([k, v]) => [k, summarize(v)])),
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
    e.setCreatureRuntime(true, true);
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
    for (const k of STEP_PHASE_KEYS) samples.stepPhases[k].push(stepPerf[k] ?? 0);
    for (const k of STEP_VOLUME_KEYS) samples.stepVolume[k].push(perf[k] ?? 0);
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

  const out = {
    scenario: name,
    checksum: e.gridHash(),
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
    config: { COLS, ROWS, SEED, SHIFT_COLS, WARMUP_STEPS, SHIFTS_EACH_WAY, STEPS_PER_SHIFT, repeat, checksumOnly, scenario: name, checksumScope: CHECKSUM_SCOPE },
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
  config: { repeat, checksumOnly, scenario: 'all', scenarios: SCENARIOS, checksumScope: CHECKSUM_SCOPE },
  metadata: metadata(),
  scenarios: scenarioResults,
} : scenarioResults[scenarioArg];
const completedRuns = scenarioArg === 'all' ? Object.values(result.scenarios) : [result];
const allChecksumsStable = completedRuns.every((run) => run.checksumStable);

// --- report ---
const fmt = (s) => `mean ${s.mean.toFixed(3)}  p50 ${s.p50.toFixed(3)}  p95 ${s.p95.toFixed(3)}  p99 ${s.p99.toFixed(3)}  max ${s.max.toFixed(3)}  (n=${s.n})`;
const fmtP50 = (s) => (s ? s.p50.toFixed(3) : '-');
// Fine keys printed as the actionable ms breakdown (legacy aggregates are secondary).
const FINE_PHASE_KEYS = [
  'forcePrepareMs', 'forceWakeMs',
  'groundingMs', 'crossLayerGroundingMs', 'componentIndexMs',
  'assemblyUnionMs', 'carryMs', 'bodyMs',
  'sandMs', 'liquidMs', 'gasMs',
  'reactMs', 'tailMs', 'liquidRelaxMs', 'liquidSurfaceMs',
  'layersMs', 'crossMs',
];
const PHASE_HINTS = {
  forcePrepareMs: 'forces_impl.inc emitter/bin/nearest-field preparation',
  forceWakeMs: 'forces_impl.inc affected-bin loose/body wake scans',
  groundingMs: 'components.inc computeGrounded / groundLayerBase',
  crossLayerGroundingMs: 'components.inc computeGroundedBoth bond scan + UF',
  componentIndexMs: 'components.inc indexComponents (nested in grounding)',
  assemblyUnionMs: 'rigid.inc moveRigidAssemblies + cross-layer assembly move',
  carryMs: 'step.inc component/body carry-forward',
  bodyMs: 'rigid.inc moveBodies',
  sandMs: 'core.inc settleSand + density interface',
  liquidMs: 'core.inc ordinary liquid movement',
  gasMs: 'core.inc riseFire / riseSteam',
  reactMs: 'reactions.inc / explosives / growth',
  tailMs: 'step.inc swap + liquid relax/level/sinks',
  liquidRelaxMs: 'core.inc post-swap liquid gap relaxation (nested in tail)',
  liquidSurfaceMs: 'core.inc post-swap free-surface leveling (nested in tail)',
  layersMs: 'step.inc both stepLayer() wall time',
  crossMs: 'step.inc post-layer joint refresh + cross react/transfer',
  joint: 'groundingMs + crossLayerGroundingMs (total joint grounding)',
  settle: 'sandMs + liquidMs + gasMs',
  rigid: 'assemblyUnionMs + bodyMs',
  step: 'step.inc, reactions.inc, growth.inc, rigid.inc, player.inc',
  renderFull: 'render.inc and material render tables',
  shiftWorldMiss: 'worldgen.inc fresh-band generation and component registration',
  shiftWorldHit: 'worldgen chunk store restore path and component translation',
};
function printPhaseLine(label, stp, keys) {
  const parts = keys.map((k) => {
    const s = stp[k];
    if (!s) return null;
    return `${k.replace(/Ms$/, '')} ${fmtP50(s)}`;
  }).filter(Boolean);
  console.log(`  ${label}: ${parts.join('  ')}`);
}
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
  const sp = r.shiftPhases, stp = r.stepPhases, vol = r.stepVolume || {};
  // Primary: fine phase medians (what is consuming ms inside step).
  printPhaseLine('step phases p50 (ms)', stp, FINE_PHASE_KEYS);
  // p95 for the usually-dominant buckets so spikes are visible without a full dump.
  const hot = ['forcePrepareMs', 'forceWakeMs', 'groundingMs', 'crossLayerGroundingMs', 'carryMs', 'sandMs', 'liquidMs', 'reactMs', 'layersMs', 'crossMs'];
  console.log(`  step phases p95 (ms): ${hot.map((k) => `${k.replace(/Ms$/, '')} ${stp[k] ? stp[k].p95.toFixed(3) : '-'}`).join('  ')}`);
  // Legacy aggregates (still in JSON) for scripts that still think in old names.
  console.log(`  step aggregates p50: joint ${fmtP50(stp.joint)}  settle ${fmtP50(stp.settle)}  rigid ${fmtP50(stp.rigid)}  [joint mean ${stp.joint?.mean ?? '-'} p95 ${stp.joint?.p95 ?? '-'}]`);
  console.log(`  shift hit phases (median ms): save ${fmtP50(sp.save)}  translate ${fmtP50(sp.translate)}  register ${fmtP50(sp.register)}  buffers ${fmtP50(sp.buffers)}  fill ${fmtP50(sp.fill)}`);
  console.log(`  volume p50: dirtyChunks ${fmtP50(vol.dirtyChunks ?? r.dirtyChunks)}  dirtyRows ${fmtP50(vol.dirtyRows)}  dirtyCells ${fmtP50(vol.dirtyCells)}  comps ${fmtP50(vol.componentCount)}  compCells ${fmtP50(vol.componentCellCount)}  xBonds ${fmtP50(vol.crossBondCount)}`);
  console.log(`  dirty chunks p95 ${r.dirtyChunks.p95}  heap ${(r.heapBytes.p50 / (1024 * 1024)).toFixed(1)}MB  shift fill hit/miss p50 ${r.shiftFill.hit.p50}/${r.shiftFill.miss.p50}`);
}
if (scenarioArg === 'all') for (const name of scenarioNames) printOne(result.scenarios[name]);
else printOne(result);

if (jsonPath) { writeFileSync(jsonPath, JSON.stringify(result, null, 2)); console.log(`\nwrote ${jsonPath}`); }
if (updatePath) {
  if (repeat < 2) throw new Error('baseline updates require --repeat 2 or greater');
  if (!allChecksumsStable)
    throw new Error('refusing to update a baseline with unstable checksums');
  writeFileSync(updatePath, JSON.stringify(result, null, 2));
  console.log(`\nupdated baseline ${updatePath}`);
}

let exit = allChecksumsStable ? 0 : 1;
if (!allChecksumsStable)
  console.log('\nCHECKSUM UNSTABLE: repeated deterministic runs produced different results');
if (comparePath) {
  if (scenarioArg === 'all') {
    console.log('\ncompare skipped for --scenario all; compare individual scenario baselines instead.');
    process.exit(exit);
  }
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\ncompare vs ${comparePath}`);
  const baseChecksumScope = base.config?.checksumScope || 'foreground';
  const resultChecksumScope = result.config?.checksumScope || CHECKSUM_SCOPE;
  if (baseChecksumScope !== resultChecksumScope) {
    console.log(`  CHECKSUM SCOPE CHANGED ${baseChecksumScope} -> ${resultChecksumScope}; values are not directly comparable`);
    exit = 1;
  } else if (base.checksum !== result.checksum) {
    console.log(`  CHECKSUM CHANGED 0x${base.checksum.toString(16)} -> 0x${result.checksum.toString(16)} (behavior changed; not a pure refactor)`);
    console.log(`    inspect: worldgen.inc, generated material tables, C++ toolchain/WASM rebuild provenance`);
    exit = 1;
  } else {
    console.log(`  checksum identical (pure refactor / deterministic)`);
  }
  if (!result.checksumStable) {
    console.log(`  CHECKSUM UNSTABLE across repeats: ${result.checksums.map((h) => `0x${h.toString(16)}`).join(', ')}`);
    exit = 1;
  }
  const environment = compatibleSandTimingEnvironment(result.metadata, base.metadata);
  const config = compatibleSandBenchmarkConfig(result.config, base.config);
  const timingComparable = environment.compatible && config.compatible;
  if (!timingComparable) {
    console.log('  timing comparison skipped (checksum and volume checks remain active):');
    for (const reason of [...environment.reasons, ...config.reasons]) console.log(`    - ${reason}`);
    console.log('    re-record a baseline on this host/toolchain with --update before judging timings');
  } else {
    const rows = checksumOnly ? [['step', 'mean']] : [['step', 'p99'], ['renderFull', 'p99'], ['shiftWorldMiss', 'p99'], ['shiftWorldHit', 'p99'], ['step', 'mean'], ['renderFull', 'mean']];
    for (const [k, m] of rows) {
      if (!base[k] || !result[k]) continue;
      const rawB = base[k][m], rawR = result[k][m];
      const gate = sandBenchmarkGateMetric(base, result, k, m);
      const b = gate.baseline, r = gate.current;
      const d = b ? ((r - b) / b) * 100 : 0;
      const tag = d > 15 ? ' REGRESSION' : d < -10 ? ' improved' : '';
      if (gate.method === 'median-run') {
        const rawD = rawB ? ((rawR - rawB) / rawB) * 100 : 0;
        console.log(`  ${k}.${m} raw: ${rawB.toFixed(3)} -> ${rawR.toFixed(3)}  (${rawD >= 0 ? '+' : ''}${rawD.toFixed(1)}%)`);
        console.log(`    median-run gate: ${b.toFixed(3)} -> ${r.toFixed(3)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)${tag}`);
      } else {
        console.log(`  ${k}.${m}: ${b.toFixed(3)} -> ${r.toFixed(3)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)${tag}`);
      }
      if (d > 15) {
        console.log(`    inspect: ${PHASE_HINTS[k] || 'owning subsystem'}`);
        exit = 1;
      }
    }
  }
  // Fine phase + volume deltas: only compare fine keys (apples-to-apples). Old
  // baselines used per-layer overwrite timers; fine phases now accumulate both
  // layers, so legacy ground/carry/settle/react numbers are not comparable.
  // Soft threshold only (does not fail the compare) — phase noise is higher
  // than wall-time p99.
  const basePh = base.stepPhases || {};
  const resPh = result.stepPhases || {};
  const phaseRows = FINE_PHASE_KEYS.filter((k) => basePh[k] && resPh[k]);
  if (timingComparable && phaseRows.length) {
    console.log('  step phase p50 deltas (informational):');
    for (const k of phaseRows) {
      const b = basePh[k].p50, r = resPh[k].p50;
      const d = b ? ((r - b) / b) * 100 : (r ? 100 : 0);
      const abs = r - b;
      // Flag only when both relative and absolute look real (ms-scale work).
      const tag = (d > 25 && abs > 0.15) ? '  << hot' : (d < -20 && abs < -0.15) ? '  cooler' : '';
      console.log(`    ${k}: ${b.toFixed(3)} -> ${r.toFixed(3)}  (${abs >= 0 ? '+' : ''}${abs.toFixed(3)}ms, ${d >= 0 ? '+' : ''}${d.toFixed(1)}%)${tag}`);
      if (tag.includes('hot')) console.log(`      inspect: ${PHASE_HINTS[k] || k}`);
    }
  } else if (timingComparable && Object.keys(resPh).length) {
    console.log('  step phase p50 (current run — baseline predates fine phases; re-record with --update to enable phase deltas):');
    for (const k of FINE_PHASE_KEYS) {
      if (!resPh[k]) continue;
      console.log(`    ${k}: ${resPh[k].p50.toFixed(3)}`);
    }
  }
  const baseShiftPh = base.shiftPhases || {};
  const resShiftPh = result.shiftPhases || {};
  const shiftPhaseRows = SHIFT_PHASE_KEYS.filter((k) => baseShiftPh[k] && resShiftPh[k]);
  if (timingComparable && shiftPhaseRows.length) {
    console.log('  shift hit phase p50 deltas (informational):');
    for (const k of shiftPhaseRows) {
      const b = baseShiftPh[k].p50, r = resShiftPh[k].p50;
      const d = b ? ((r - b) / b) * 100 : (r ? 100 : 0);
      const abs = r - b;
      console.log(`    ${k}: ${b.toFixed(3)} -> ${r.toFixed(3)}  (${abs >= 0 ? '+' : ''}${abs.toFixed(3)}ms, ${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`);
    }
  }
  const baseVol = base.stepVolume || {};
  const resVol = result.stepVolume || {};
  const volRows = STEP_VOLUME_KEYS.filter((k) => baseVol[k] && resVol[k]);
  if (volRows.length) {
    console.log('  step volume p50 deltas (informational):');
    for (const k of volRows) {
      const b = baseVol[k].p50, r = resVol[k].p50;
      const d = b ? ((r - b) / b) * 100 : (r ? 100 : 0);
      console.log(`    ${k}: ${b.toFixed(1)} -> ${r.toFixed(1)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`);
    }
  } else if (Object.keys(resVol).length) {
    console.log('  step volume p50 (current run only — baseline has no stepVolume; re-record with --update):');
    for (const k of STEP_VOLUME_KEYS) {
      if (!resVol[k]) continue;
      console.log(`    ${k}: ${resVol[k].p50.toFixed(1)}`);
    }
  }
}
process.exit(exit);
