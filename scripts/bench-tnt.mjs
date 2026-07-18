// Focused TNT benchmark: detonation spikes, buried-component repair, dual-layer
// duplication, and staged chain cost. Timed regions contain engine.step() only;
// setup, grid hashing, TNT counting, and body counting are deliberately outside them.
import { performance } from 'node:perf_hooks';
import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';

const REPEAT = Math.max(2, Number(process.env.REPEAT || 3) | 0);
const SCENARIO = process.env.SCENARIO || 'all';
const SEED = 0xC0FFEE;
const PHASE_KEYS = [
  'groundingMs', 'componentIndexMs', 'assemblyUnionMs', 'carryMs', 'bodyMs',
  'sandMs', 'liquidMs', 'gasMs', 'reactMs', 'tailMs', 'crossMs',
];

await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));

function countMaterial(grid, material) {
  let count = 0;
  for (const cell of grid) if (cell === material) count++;
  return count;
}

function hashGrid(hash, grid) {
  for (const cell of grid) {
    hash ^= cell;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor((sorted.length - 1) * q)];
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: at(0.50),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
}

function runScenario({ name, cols, rows, side = 1, buried = false, cave = false, bg = false, steps }) {
  const engine = createEngineWasm({ cols, rows, worldSeed: SEED, sinksOn: false, infinite: false });
  engine.setBgEnabled(bg);
  const cx = cols >> 1;
  const cy = buried ? 92 : rows >> 1;
  const x0 = cx - (side >> 1);
  const y0 = cy - (side >> 1);

  if (cave) {
    // Setup is outside the timed region. A single bulk paint plus the final sync
    // builds the same enclosed, grounded component without tens of thousands of
    // JS->Wasm placement calls dominating benchmark runtime.
    engine.paintDisc(cx, cy, Math.max(cols, rows), MAT.STONE, true);
    engine.eraseDisc(cx, cy, 10);
    // Real play keeps a fully simulated, more-solid background behind many
    // foreground caves. Include it when this scenario enables both layers so
    // the benchmark catches joint-grounding invalidation on a cave blast.
    if (bg) engine.paintDiscLayer(1, cx, cy, Math.max(cols, rows), MAT.STONE, true);
  } else if (buried) {
    for (let y = cy + 1; y < rows; y++)
      for (let x = 20; x < cols - 20; x++) engine.placeMaterial(x, y, 0, MAT.STONE);
  }
  for (let y = y0; y < y0 + side; y++)
    for (let x = x0; x < x0 + side; x++) engine.placeMaterial(x, y, 0, MAT.TNT);
  engine.syncComponentsLayer(0);
  if (bg) engine.syncComponentsLayer(1);

  const initialTnt = countMaterial(engine.getGrid(), MAT.TNT);
  let previousTnt = initialTnt;
  let firstBlast = -1;
  let completed = -1;
  let rollingHash = 2166136261 >>> 0;
  const records = [];

  for (let step = 0; step < steps; step++) {
    if (step < 3) {
      const igniteX = side === 1 ? cx + 1 : x0 + side + 1;
      engine.placeMaterial(igniteX, cy, 1, MAT.FIRE);
    }
    const started = performance.now();
    const active = engine.step(step * 16);
    const wallMs = performance.now() - started;
    // An idle engine returns false without replacing the previous perf snapshot.
    // Treat that tick as zero work instead of repeating the last active phases.
    const worldActive = active && engine.getPerf().stepMs > 0;
    const perf = worldActive ? engine.getStepPerf() : {};
    const tnt = countMaterial(engine.getGrid(), MAT.TNT);
    if (firstBlast < 0 && tnt < previousTnt) firstBlast = step;
    if (completed < 0 && tnt === 0) completed = step;
    previousTnt = tnt;
    rollingHash = hashGrid(rollingHash, engine.getGrid());
    if (bg) rollingHash = hashGrid(rollingHash, engine.getGridBg());
    records.push({ step, wallMs, perf, reactMs: perf.reactMs || 0, tnt, bodies: engine._bodyCount() });
  }

  const blastRecords = records.filter(({ step }) => firstBlast >= 0 && step >= firstBlast && step <= (completed >= 0 ? completed : firstBlast));
  const blastAndAftermath = records.filter(({ step }) => firstBlast >= 0 && step >= firstBlast && step <= firstBlast + 5);
  const blastTail = records.filter(({ step }) => firstBlast >= 0 && step >= firstBlast);
  let priorTnt = initialTnt;
  const detonationDrops = [];
  for (const record of records) {
    if (record.tnt < priorTnt) detonationDrops.push(priorTnt - record.tnt);
    priorTnt = record.tnt;
  }
  const aftermathPhases = Object.fromEntries(PHASE_KEYS.map((key) => [
    key,
    blastAndAftermath.reduce((sum, record) => sum + (record.perf[key] || 0), 0),
  ]));
  const tailPhases = Object.fromEntries(PHASE_KEYS.map((key) => [
    key,
    blastTail.reduce((sum, record) => sum + (record.perf[key] || 0), 0),
  ]));
  const peak = blastRecords.reduce((best, record) => record.reactMs > best.reactMs ? record : best, blastRecords[0]);
  engine.destroy();
  return {
    name,
    initialTnt,
    firstBlast,
    completed,
    rollingHash,
    peakReactMs: peak.reactMs,
    peakWallMs: peak.wallMs,
    waveReactMs: blastRecords.reduce((sum, record) => sum + record.reactMs, 0),
    waveWallMs: blastRecords.reduce((sum, record) => sum + record.wallMs, 0),
    blastAndAftermathWallMs: blastAndAftermath.reduce((sum, record) => sum + record.wallMs, 0),
    blastTailWallMs: blastTail.reduce((sum, record) => sum + record.wallMs, 0),
    blastTailBodyMs: blastTail.reduce((sum, record) => sum + (record.perf.bodyMs || 0), 0),
    peakBodies: Math.max(0, ...blastTail.map(({ bodies }) => bodies)),
    aftermathPhases,
    tailPhases,
    detonationSteps: detonationDrops.length,
    maxDetonationDrop: Math.max(0, ...detonationDrops),
  };
}

const scenarios = [
  { name: 'single-open', cols: 512, rows: 256, steps: 40 },
  { name: 'single-open-dual-layer', cols: 512, rows: 256, bg: true, steps: 40 },
  { name: 'single-buried-stone', cols: 384, rows: 224, buried: true, steps: 40 },
  { name: 'single-cave-stone', cols: 384, rows: 224, cave: true, steps: 40 },
  { name: 'single-cave-stone-dual-layer', cols: 384, rows: 224, cave: true, bg: true, steps: 40 },
  { name: 'chain-25x25', cols: 260, rows: 220, side: 25, steps: 70 },
  { name: 'chain-49x49', cols: 260, rows: 220, side: 49, steps: 90 },
  { name: 'chain-49-wide-stone-bed', cols: 260, rows: 220, side: 49, buried: true, steps: 90 },
];

// Warm lazy WASM/runtime paths before collecting samples.
runScenario({ name: 'warmup', cols: 96, rows: 80, steps: 35 });

console.log(`TNT benchmark (${REPEAT} repeats; fallback WASM)`);
for (const scenario of scenarios.filter(({ name }) => SCENARIO === 'all' || name === SCENARIO)) {
  const runs = [];
  for (let repeat = 0; repeat < REPEAT; repeat++) runs.push(runScenario(scenario));
  const hashes = [...new Set(runs.map(({ rollingHash }) => rollingHash.toString(16).padStart(8, '0')))];
  const peakReact = summary(runs.map(({ peakReactMs }) => peakReactMs));
  const peakWall = summary(runs.map(({ peakWallMs }) => peakWallMs));
  const waveReact = summary(runs.map(({ waveReactMs }) => waveReactMs));
  const waveWall = summary(runs.map(({ waveWallMs }) => waveWallMs));
  const blastAndAftermathWall = summary(runs.map(({ blastAndAftermathWallMs }) => blastAndAftermathWallMs));
  const blastTailWall = summary(runs.map(({ blastTailWallMs }) => blastTailWallMs));
  const blastTailBody = summary(runs.map(({ blastTailBodyMs }) => blastTailBodyMs));
  const first = runs[0];
  const phaseSummary = PHASE_KEYS
    .map((key) => [key.replace(/Ms$/, ''), summary(runs.map(({ aftermathPhases }) => aftermathPhases[key])).p50])
    .filter(([, value]) => value >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key} ${value.toFixed(3)}`)
    .join('  ');
  const tailPhaseSummary = PHASE_KEYS
    .map((key) => [key.replace(/Ms$/, ''), summary(runs.map(({ tailPhases }) => tailPhases[key])).p50])
    .filter(([, value]) => value >= 0.10)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key} ${value.toFixed(3)}`)
    .join('  ');
  console.log(`\n${scenario.name}: TNT ${first.initialTnt}, wave ${first.firstBlast}..${first.completed}, hash ${hashes.join(',')}${hashes.length === 1 ? '' : ' UNSTABLE'}`);
  console.log(`  cold wave   react ${first.waveReactMs.toFixed(3)}  wall ${first.waveWallMs.toFixed(3)} ms`);
  console.log(`  peak react  p50 ${peakReact.p50.toFixed(3)}  p95 ${peakReact.p95.toFixed(3)}  mean ${peakReact.mean.toFixed(3)} ms`);
  console.log(`  peak wall   p50 ${peakWall.p50.toFixed(3)}  p95 ${peakWall.p95.toFixed(3)}  mean ${peakWall.mean.toFixed(3)} ms`);
  console.log(`  wave react  p50 ${waveReact.p50.toFixed(3)}  p95 ${waveReact.p95.toFixed(3)}  mean ${waveReact.mean.toFixed(3)} ms`);
  console.log(`  wave wall   p50 ${waveWall.p50.toFixed(3)}  p95 ${waveWall.p95.toFixed(3)}  mean ${waveWall.mean.toFixed(3)} ms`);
  console.log(`  blast +5   p50 ${blastAndAftermathWall.p50.toFixed(3)}  p95 ${blastAndAftermathWall.p95.toFixed(3)}  mean ${blastAndAftermathWall.mean.toFixed(3)} ms`);
  console.log(`  full tail  p50 ${blastTailWall.p50.toFixed(3)}  p95 ${blastTailWall.p95.toFixed(3)}  body ${blastTailBody.p50.toFixed(3)} ms`);
  console.log(`  rubble     peak ${first.peakBodies} bodies`);
  console.log(`  front steps ${first.detonationSteps}  max cells ${first.maxDetonationDrop}`);
  console.log(`  +5 phases  ${phaseSummary}`);
  console.log(`  tail phases ${tailPhaseSummary}`);
}
