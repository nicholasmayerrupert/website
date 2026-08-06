// Focused spatial-force benchmark: loose liquids and rigid piles around static,
// ordinary moving, large moving, and dense interacting neutronium sources.

import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { buildCrossLayerSliverScene } from './rigid-sliver-scenario.mjs';

const COLS = 768;
const ROWS = 320;
const SEED = 0xC0FFEE;
const WARMUP = 8;
const WINDOW_STEPS = 30;
const valueAfter = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const sampleSteps = Math.max(
  1, Number.parseInt(valueAfter('--steps', '180'), 10),
);
const repeatArg = process.argv.indexOf('--repeat');
const repeats = repeatArg >= 0
  ? Math.max(1, Number.parseInt(process.argv[repeatArg + 1] ?? '3', 10))
  : 3;
const solverModeArg = process.argv.indexOf('--solver-mode');
const solverOptions = solverModeArg < 0 ? null : {
  mode: Number.parseInt(process.argv[solverModeArg + 1] ?? '2', 10),
  tolerance: Number.parseFloat(valueAfter('--solver-tolerance', '0.0001')),
  minIterations: Math.max(
    1,
    Number.parseInt(valueAfter('--solver-min-iterations', '4'), 10),
  ),
};
const forceFullSolveBodiesArg = process.argv.indexOf(
  '--force-full-solve-bodies',
);
const forceFullSolveBodies = forceFullSolveBodiesArg < 0 ? null : Math.max(
  1,
  Number.parseInt(process.argv[forceFullSolveBodiesArg + 1] ?? '6', 10),
);

await initSandWasm();

const createEngine = () => attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: SEED,
  sinksOn: false,
  infinite: false,
}));

const paintRect = (engine, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};

const addFloor = (engine) => {
  paintRect(engine, 0, ROWS - 5, COLS - 1, ROWS - 1, MAT.STONE);
};

const addStaticSource = (engine, sourceX = 390, sourceY = 145) => {
  paintRect(engine, sourceX, sourceY, sourceX, ROWS - 6, MAT.STONE);
  engine.paintDisc(sourceX, sourceY, 7, MAT.NEUTRONIUM, true);
};

const addLavaCloud = (engine) => {
  paintRect(engine, 260, 78, 339, 137, MAT.LAVA);
};

const addRigidPile = (engine) => {
  for (let i = 0; i < 48; i++) {
    const x = 255 + (i % 8) * 19;
    const y = 45 + Math.floor(i / 8) * 16;
    engine.spawnBox(x, y, 2, 2, MAT.RIGID);
  }
};

const addStableContactRow = (engine) => {
  addFloor(engine);
  paintRect(engine, 20, ROWS - 3, COLS - 21, ROWS - 3, MAT.NEUTRONIUM);
  engine.syncComponents();
  for (let i = 0; i < 48; i++)
    engine.spawnBox(90 + i * 12, ROWS - 11, 2, 2, MAT.RIGID);
};

const addDenseBodyField = (engine, material) => {
  for (let i = 0; i < 128; i++) {
    const x = Math.round(256 - 15 * 7.5 + (i % 16) * 15);
    const y = 35 + Math.floor(i / 16) * 7;
    engine.spawnBox(x, y, 2, 2, material);
    engine._setBodyMotion(
      i,
      ((i * 17) % 7 - 3) * 0.03,
      ((i * 11) % 5 - 2) * 0.02,
      ((i % 3) - 1) * 0.002,
    );
  }
};

const addTinyIrregularField = (engine) => {
  const shapes = [
    [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]],
    [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  ];
  for (let i = 0; i < 128; i++) {
    const x = 304 + (i % 16) * 10;
    const y = 28 + Math.floor(i / 16) * 10;
    engine.spawnBody(shapes[i % shapes.length]
      .map(([dx, dy]) => [x + dx, y + dy]));
  }
};

const setups = {
  'static-lava': (engine) => {
    addFloor(engine);
    addStaticSource(engine);
    addLavaCloud(engine);
    engine.syncComponents();
  },
  'moving-196-lava': (engine) => {
    addLavaCloud(engine);
    engine.spawnBox(390, 145, 7, 7, MAT.NEUTRONIUM);
    engine._setBodyMotion(0, -0.12, -0.15, 0.002);
  },
  'moving-900-lava': (engine) => {
    addLavaCloud(engine);
    engine.spawnBox(390, 145, 15, 15, MAT.NEUTRONIUM);
    engine._setBodyMotion(0, -0.12, -0.15, 0.002);
  },
  'rigid-48': (engine) => {
    addFloor(engine);
    addRigidPile(engine);
    engine.syncComponents();
  },
  'static-rigid-48': (engine) => {
    addFloor(engine);
    addStaticSource(engine);
    addRigidPile(engine);
    engine.syncComponents();
  },
  'stable-contact-48': (engine) => {
    addStableContactRow(engine);
  },
  'moving-rigid-48': (engine) => {
    addFloor(engine);
    engine.syncComponents();
    engine.spawnBox(410, 145, 7, 7, MAT.NEUTRONIUM);
    addRigidPile(engine);
    engine._setBodyMotion(0, -0.12, -0.15, 0.002);
  },
  'dense-rigid-128': (engine) => {
    addDenseBodyField(engine, MAT.RIGID);
  },
  'dense-neutronium-128': (engine) => {
    addDenseBodyField(engine, MAT.NEUTRONIUM);
  },
  'static-tiny-irregular-128': (engine) => {
    addFloor(engine);
    addStaticSource(engine, 384, 205);
    engine.syncComponents();
    addTinyIrregularField(engine);
  },
  'cross-layer-slivers': (engine) => {
    buildCrossLayerSliverScene(engine, {
      left: 204,
      right: 564,
      top: 18,
      bottom: 156,
      floorY: ROWS - 5,
      sourceX: 384,
      sourceY: ROWS - 40,
      cutSpacing: 10,
    });
  },
};
const scenarioArg = valueAfter('--scenario', 'all');
if (scenarioArg !== 'all' && !setups[scenarioArg]) {
  throw new Error(
    `unknown scenario ${scenarioArg}; expected ${Object.keys(setups).join(', ')}`,
  );
}
const selectedSetups = scenarioArg === 'all'
  ? Object.entries(setups)
  : [[scenarioArg, setups[scenarioArg]]];

const phaseKeys = [
  'forcePrepareMs', 'forceWakeMs', 'bodyMs', 'liquidMs', 'tailMs',
  'liquidRelaxMs', 'liquidSurfaceMs',
];
const rigidWorkKeys = [
  'substeps', 'islandBodySteps', 'contacts', 'childPairs', 'childManifolds',
  'childTransforms', 'velocityIterations', 'velocityConstraintEvals',
  'biasConstraintEvals', 'shockIslands', 'shockConstraintEvals',
  'shockFallbacks', 'positionCorrections', 'ownershipConflicts',
];
const rigidTimingKeys = [
  'rigidPrepareMs', 'rigidClearMs', 'rigidCoreMs', 'rigidDepenMs',
  'rigidStampMs', 'rigidSpillMs', 'rigidFinalizeMs',
];
const rigidKeys = [...rigidWorkKeys, ...rigidTimingKeys];

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

const summarize = (values) => ({
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
});

const worstWindowP50 = (values) => {
  let worst = 0;
  for (let start = 0; start + WINDOW_STEPS <= values.length; start++)
    worst = Math.max(worst, percentile(
      values.slice(start, start + WINDOW_STEPS), 0.5,
    ));
  return worst;
};

const runScenario = (setup) => {
  const combined = { stepMs: [] };
  for (const key of phaseKeys) combined[key] = [];
  const rigid = Object.fromEntries(rigidKeys.map((key) => [key, []]));
  const repeatWindows = [];
  let activeSteps = 0;
  for (let repeat = 0; repeat < repeats; repeat++) {
    const engine = createEngine();
    setup(engine);
    if (solverOptions) engine._setRigidSolverOptions(
      solverOptions.mode,
      solverOptions.tolerance,
      solverOptions.minIterations,
    );
    if (forceFullSolveBodies)
      engine._setRigidForceFullSolveBodies(forceFullSolveBodies);
    for (let i = 0; i < WARMUP; i++) engine.stepWorld();
    const repeatSteps = [];
    for (let i = 0; i < sampleSteps; i++) {
      if (!engine.stepWorld()) break;
      const perf = engine.getPerf();
      const phases = engine.getStepPerf();
      const solver = engine.getRigidSolverDebug();
      combined.stepMs.push(perf.stepMs);
      repeatSteps.push(perf.stepMs);
      for (const key of phaseKeys) combined[key].push(phases[key] ?? 0);
      for (const key of rigidKeys) rigid[key].push(solver[key] ?? 0);
      activeSteps++;
    }
    repeatWindows.push(worstWindowP50(repeatSteps));
    engine.destroy();
  }
  return {
    activeSteps,
    step: summarize(combined.stepMs),
    worstWindowP50: percentile(repeatWindows, 0.5),
    phases: Object.fromEntries(
      phaseKeys.map((key) => [key, summarize(combined[key])]),
    ),
    rigid: Object.fromEntries(
      rigidKeys.map((key) => [key, summarize(rigid[key])]),
    ),
  };
};

const started = performance.now();
const results = {};
for (const [name, setup] of selectedSetups) {
  const result = runScenario(setup);
  results[name] = result;
  const s = result.step;
  const phase = phaseKeys.map((key) =>
    `${key.replace(/Ms$/, '')} ${result.phases[key].p50.toFixed(3)}`,
  ).join('  ');
  console.log(`\n${name} (${result.activeSteps} active samples)`);
  console.log(
    `  step p50 ${s.p50.toFixed(3)}  p95 ${s.p95.toFixed(3)}`
    + `  p99 ${s.p99.toFixed(3)}  worst-${WINDOW_STEPS} p50`
    + ` ${result.worstWindowP50.toFixed(3)} ms`,
  );
  console.log(`  phase p50 (ms): ${phase}`);
  console.log(`  rigid mean: ${rigidKeys.map((key) => {
    const digits = rigidTimingKeys.includes(key) ? 3 : 1;
    return `${key} ${result.rigid[key].mean.toFixed(digits)}`;
  }).join('  ')}`);
  console.log(`  rigid p95: ${rigidKeys.map((key) => {
    const digits = rigidTimingKeys.includes(key) ? 3 : 0;
    return `${key} ${result.rigid[key].p95.toFixed(digits)}`;
  }).join('  ')}`);
}
console.log(`\nwall ${(performance.now() - started).toFixed(0)} ms, ${repeats} repeats`);

if (process.argv.includes('--json'))
  console.log(JSON.stringify({
    cols: COLS, rows: ROWS, repeats, sampleSteps, results,
  }));
