// Deterministic worst-case rigid benchmark: blast-carved cross-layer terrain,
// irregular RIGID bodies, moving neutronium on both layers, and active water are
// driven into one collision zone. Setup and diagnostic scans are not timed.

import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import {
  BRUTAL_RIGID_SCENE,
  buildBrutalRigidScene,
} from './rigid-brutal-scenario.mjs';

const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const repeats = Math.max(1, Number.parseInt(valueAfter('--repeat', '3'), 10));
const steps = Math.max(30, Number.parseInt(valueAfter('--steps', '300'), 10));
const comparePath = valueAfter('--compare', null);
const updatePath = valueAfter('--update', null);
const json = args.includes('--json');
const FRAME_BUDGET_MS = 1000 / 60;
const WINDOW_STEPS = 30;

const phaseKeys = [
  'forcePrepareMs', 'forceWakeMs', 'groundingMs', 'crossLayerGroundingMs',
  'componentIndexMs', 'assemblyUnionMs', 'carryMs', 'bodyMs', 'liquidMs',
  'reactMs', 'tailMs', 'crossMs',
];
const rigidKeys = [
  'substeps', 'islands', 'islandBodySteps', 'contacts', 'childPairs',
  'childManifolds', 'childTransforms', 'velocityConstraintEvals',
  'biasConstraintEvals', 'fluidNodes', 'fluidFaces', 'positionCorrections',
  'fluidInitialMs', 'fluidCorrectorMs', 'fluidReferenceMs', 'fluidDomainMs',
  'fluidMatrixMs', 'fluidSolveMs', 'fluidWritebackMs',
  'ownershipConflicts', 'recoveryBodies', 'rigidPrepareMs', 'rigidClearMs',
  'rigidCoreMs', 'rigidDepenMs', 'rigidStampMs', 'rigidSpillMs',
  'rigidFinalizeMs', 'rigidContactMs', 'rigidSolveMs',
  'rigidPairContactMs', 'rigidTerrainContactMs',
  'terrainSamples', 'terrainSamplesSkipped',
  'granularBodiesSkipped', 'rigidMotionPrepMs', 'rigidIntegrateMs',
  'rigidStepPrepareMs', 'rigidContactSetupMs', 'rigidStepFinalizeMs',
  'rigidOccupancyBuildMs', 'rigidCadenceMs',
  'rigidFluidCoupleMs',
  'rigidFluidReferenceTotalMs', 'rigidFluidDomainTotalMs',
  'rigidFluidMatrixTotalMs', 'rigidFluidSolveTotalMs',
  'rigidFluidWritebackTotalMs',
  'rigidFluidNodesTotal', 'rigidFluidFacesTotal',
  'rigidFluidIterationsTotal', 'rigidFluidDryReferencesSkipped',
];
const rigidTimingKeys = new Set(rigidKeys.filter((key) => key.endsWith('Ms')));

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * fraction))];
};
const summarize = (values) => ({
  p50: percentile(values, 0.50),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  max: Math.max(0, ...values),
  mean: values.reduce((sum, value) => sum + value, 0)
    / Math.max(1, values.length),
});
const worstWindow = (values, metric) => {
  let worst = 0;
  for (let start = 0; start + WINDOW_STEPS <= values.length; start++)
    worst = Math.max(worst, metric(values.slice(start, start + WINDOW_STEPS)));
  return worst;
};
const hashGrid = (hash, grid) => {
  for (const cell of grid) {
    hash ^= cell;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
};
const fps = (ms) => ms > 0 ? 1000 / ms : Infinity;

await initSandWasm();
const createEngine = (options) =>
  attachTestHooks(createEngineWasmRaw(options));

// Exercise lazy module paths before the measured scene is constructed.
{
  const warm = createEngine({
    cols: 96, rows: 64, worldSeed: BRUTAL_RIGID_SCENE.seed,
    sinksOn: false, infinite: false,
  });
  warm.spawnBox(48, 20, 2, 2, MAT.RIGID);
  for (let tick = 0; tick < 8; tick++) warm.stepWorld();
  warm.renderFullLayer(0);
  warm.destroy();
}

const combined = {
  step: [], engineStep: [], render: [], frameProxy: [],
};
for (const key of phaseKeys) combined[key] = [];
const rigidSamples = Object.fromEntries(rigidKeys.map((key) => [key, []]));
const fingerprints = new Set();
const scenes = [];
const repeatWindows = [];
let activeSamples = 0;
let overBudgetSteps = 0;
let overBudgetFrames = 0;
let maxBacklogMs = 0;
let peakForegroundBodies = 0;
let peakBackgroundBodies = 0;
let peakJointPrimaries = 0;
let peakSmallForegroundBodies = 0;
let peakCompoundForegroundBodies = 0;

for (let repeat = 0; repeat < repeats; repeat++) {
  const engine = createEngine({
    cols: BRUTAL_RIGID_SCENE.cols,
    rows: BRUTAL_RIGID_SCENE.rows,
    worldSeed: BRUTAL_RIGID_SCENE.seed,
    sinksOn: false,
    infinite: false,
  });
  engine.setBgEnabled(true);
  const scene = buildBrutalRigidScene(engine);
  scenes.push(scene);
  const repeatStep = [];
  const repeatFrame = [];
  let backlogMs = 0;

  for (let tick = 0; tick < steps; tick++) {
    const stepStarted = performance.now();
    const active = engine.stepWorld();
    const stepWallMs = performance.now() - stepStarted;
    if (!active) continue;

    const perf = engine.getPerf();
    const phases = engine.getStepPerf();
    const rigid = engine.getRigidSolverDebug();
    const renderStarted = performance.now();
    engine.renderFullLayer(0);
    engine.renderFullLayer(1);
    const renderMs = performance.now() - renderStarted;
    const frameProxyMs = stepWallMs + renderMs;

    combined.step.push(stepWallMs);
    combined.engineStep.push(perf.stepMs);
    combined.render.push(renderMs);
    combined.frameProxy.push(frameProxyMs);
    repeatStep.push(stepWallMs);
    repeatFrame.push(frameProxyMs);
    for (const key of phaseKeys) combined[key].push(phases[key] ?? 0);
    for (const key of rigidKeys) rigidSamples[key].push(rigid[key] ?? 0);
    activeSamples++;
    if (stepWallMs > FRAME_BUDGET_MS) overBudgetSteps++;
    if (frameProxyMs > FRAME_BUDGET_MS) overBudgetFrames++;
    backlogMs = Math.max(0, backlogMs + stepWallMs - FRAME_BUDGET_MS);
    maxBacklogMs = Math.max(maxBacklogMs, backlogMs);

    const foregroundBodies = engine._bodyCountLayer(0);
    const backgroundBodies = engine._bodyCountLayer(1);
    let jointPrimaries = 0;
    for (let body = 0; body < foregroundBodies; body++)
      if (engine._bodyJointRoleLayer(0, body) === 1) jointPrimaries++;
    if (foregroundBodies > peakForegroundBodies
        || jointPrimaries > peakJointPrimaries) {
      let smallForegroundBodies = 0;
      let compoundForegroundBodies = 0;
      for (let body = 0; body < foregroundBodies; body++) {
        const state = engine._bodyStateLayer(0, body);
        if (state?.nPts <= 64) smallForegroundBodies++;
        if (engine._bodyChildCount(body) > 1) compoundForegroundBodies++;
      }
      peakSmallForegroundBodies = Math.max(
        peakSmallForegroundBodies, smallForegroundBodies);
      peakCompoundForegroundBodies = Math.max(
        peakCompoundForegroundBodies, compoundForegroundBodies);
    }
    peakForegroundBodies = Math.max(peakForegroundBodies, foregroundBodies);
    peakBackgroundBodies = Math.max(peakBackgroundBodies, backgroundBodies);
    peakJointPrimaries = Math.max(peakJointPrimaries, jointPrimaries);
  }

  repeatWindows.push({
    stepP50: worstWindow(repeatStep, (values) => percentile(values, 0.50)),
    stepP95: worstWindow(repeatStep, (values) => percentile(values, 0.95)),
    frameP50: worstWindow(repeatFrame, (values) => percentile(values, 0.50)),
  });
  let hash = 2166136261 >>> 0;
  hash = hashGrid(hash, engine.getGrid());
  hash = hashGrid(hash, engine.getGridBg());
  fingerprints.add(`0x${hash.toString(16).padStart(8, '0')}`);
  engine.destroy();
}

const timing = {
  step: summarize(combined.step),
  engineStep: summarize(combined.engineStep),
  dualLayerRenderFill: summarize(combined.render),
  frameProxy: summarize(combined.frameProxy),
  worst30StepP50: percentile(repeatWindows.map((run) => run.stepP50), 0.50),
  worst30StepP95: percentile(repeatWindows.map((run) => run.stepP95), 0.50),
  worst30FrameP50: percentile(repeatWindows.map((run) => run.frameP50), 0.50),
};
const phases = Object.fromEntries(phaseKeys.map((key) => [
  key, summarize(combined[key]),
]));
const rigid = Object.fromEntries(rigidKeys.map((key) => [
  key, summarize(rigidSamples[key]),
]));
const result = {
  meta: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    repeats,
    steps,
    frameBudgetMs: FRAME_BUDGET_MS,
  },
  scene: {
    ...scenes[0],
    peakForegroundBodies,
    peakBackgroundBodies,
    peakJointPrimaries,
    peakSmallForegroundBodies,
    peakCompoundForegroundBodies,
  },
  fingerprints: [...fingerprints],
  activeSamples,
  timing,
  pressure: {
    stepOverBudgetPct: activeSamples ? overBudgetSteps * 100 / activeSamples : 0,
    frameOverBudgetPct: activeSamples ? overBudgetFrames * 100 / activeSamples : 0,
    maxBacklogMs,
    maxBacklogTicks: Math.ceil(maxBacklogMs / FRAME_BUDGET_MS),
  },
  phases,
  rigid,
};

const fmt = (summary) => `p50 ${summary.p50.toFixed(3)}  p95 ${summary.p95.toFixed(3)}`
  + `  p99 ${summary.p99.toFixed(3)}  max ${summary.max.toFixed(3)}`;
console.log('brutal cross-layer rigid benchmark');
console.log(`  scene ${BRUTAL_RIGID_SCENE.cols}x${BRUTAL_RIGID_SCENE.rows}: `
  + `${result.scene.bodies.foreground} fg / ${result.scene.bodies.background} bg bodies, `
  + `${result.scene.bodies.jointPrimaries} joint primaries, `
  + `${result.scene.bodies.compoundChildren} compound children `
  + `(max ${result.scene.bodies.maxChildren}), ${result.scene.neutroniumCells} neutronium cells, `
  + `${result.scene.waterCells} water cells`);
console.log(`  final fingerprint ${result.fingerprints.join(', ')}`
  + `${result.fingerprints.length === 1 ? '' : ' UNSTABLE'}`);
console.log(`  step wall        ${fmt(timing.step)} ms`);
console.log(`  engine step      ${fmt(timing.engineStep)} ms`);
console.log(`  dual render fill ${fmt(timing.dualLayerRenderFill)} ms`);
console.log(`  CPU frame proxy  ${fmt(timing.frameProxy)} ms `
  + `(p95 ${fps(timing.frameProxy.p95).toFixed(1)} FPS, `
  + `p99 ${fps(timing.frameProxy.p99).toFixed(1)} FPS)`);
console.log(`  worst-${WINDOW_STEPS} step p50/p95 `
  + `${timing.worst30StepP50.toFixed(3)}/${timing.worst30StepP95.toFixed(3)} ms, `
  + `frame p50 ${timing.worst30FrameP50.toFixed(3)} ms`);
console.log(`  60 Hz pressure: step ${result.pressure.stepOverBudgetPct.toFixed(1)}% / `
  + `frame ${result.pressure.frameOverBudgetPct.toFixed(1)}% over budget, `
  + `max simulated backlog ${result.pressure.maxBacklogMs.toFixed(1)} ms `
  + `(${result.pressure.maxBacklogTicks} ticks)`);
console.log(`  peaks: ${peakForegroundBodies} fg / ${peakBackgroundBodies} bg bodies, `
  + `${peakJointPrimaries} joint primaries, ${peakSmallForegroundBodies} small fg, `
  + `${peakCompoundForegroundBodies} compound fg`);
const hotPhases = phaseKeys
  .map((key) => [key.replace(/Ms$/, ''), phases[key].p95])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([key, value]) => `${key} ${value.toFixed(3)}`)
  .join('  ');
console.log(`  phase p95 (ms): ${hotPhases}`);
console.log(`  rigid mean: ${rigidKeys.map((key) => {
  const digits = rigidTimingKeys.has(key) ? 3 : 1;
  return `${key} ${rigid[key].mean.toFixed(digits)}`;
}).join('  ')}`);
console.log(`  rigid p95: ${rigidKeys.map((key) => {
  const digits = rigidTimingKeys.has(key) ? 3 : 0;
  return `${key} ${rigid[key].p95.toFixed(digits)}`;
}).join('  ')}`);

const sceneValid = peakJointPrimaries >= 40
  && peakSmallForegroundBodies >= 100
  && peakCompoundForegroundBodies >= 80
  && peakBackgroundBodies >= 60
  && result.scene.waterCells >= 40_000
  && result.scene.neutroniumCells >= 1_000;
if (!sceneValid) console.error('\ninvalid brutal scene composition');

if (updatePath) {
  writeFileSync(updatePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nupdated baseline ${updatePath}`);
}

let exitCode = result.fingerprints.length === 1 && sceneValid ? 0 : 1;
if (comparePath) {
  const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\ncompare vs ${comparePath}`);
  const metrics = [
    ['step p50', baseline.timing.step.p50, timing.step.p50],
    ['step p95', baseline.timing.step.p95, timing.step.p95],
    ['step p99', baseline.timing.step.p99, timing.step.p99],
    ['frame p95', baseline.timing.frameProxy.p95, timing.frameProxy.p95],
    ['worst-30 p50', baseline.timing.worst30StepP50, timing.worst30StepP50],
    ['body p95', baseline.phases.bodyMs.p95, phases.bodyMs.p95],
    ['contacts mean', baseline.rigid.contacts.mean, rigid.contacts.mean],
    ['constraint evals mean',
      baseline.rigid.velocityConstraintEvals.mean
        + baseline.rigid.biasConstraintEvals.mean,
      rigid.velocityConstraintEvals.mean + rigid.biasConstraintEvals.mean],
  ];
  for (const [name, before, after] of metrics) {
    const delta = before ? (after / before - 1) * 100 : 0;
    console.log(`  ${name.padEnd(22)} ${before.toFixed(3)} -> `
      + `${after.toFixed(3)}  ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`);
  }
  const baselineFingerprint = baseline.fingerprints?.join(',');
  const currentFingerprint = result.fingerprints.join(',');
  if (baselineFingerprint !== currentFingerprint) {
    console.error(`  fingerprint mismatch ${baselineFingerprint} -> ${currentFingerprint}`);
    exitCode = 1;
  }
}

if (json) console.log(JSON.stringify(result));
process.exitCode = exitCode;
