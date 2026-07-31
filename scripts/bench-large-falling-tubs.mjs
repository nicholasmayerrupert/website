// Large transient workloads for falling liquid and co-falling rigid cargo.
//
//   node scripts/bench-large-falling-tubs.mjs [water|tub|cargo|all]

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';

const createEngineWasm = (options) =>
  attachTestHooks(createEngineWasmRaw(options));
const COLS = 640;
const ROWS = 520;
const WARMUP = Number.parseInt(process.env.WARMUP_TICKS ?? '5', 10);
const STEPS = Number.parseInt(process.env.MEASURE_TICKS ?? '90', 10);
const requested = process.argv[2] ?? 'all';
const traceSlow = process.env.TRACE_SLOW === '1';
const traceOverMs = Number.parseFloat(process.env.TRACE_OVER_MS ?? '33.33');
const failOverMs = Number.parseFloat(process.env.FAIL_OVER_MS ?? 'Infinity');
let failedBudget = false;
let failedValidation = false;

const percentile = (values, fraction) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(
    ordered.length - 1,
    Math.floor(ordered.length * fraction),
  )] ?? 0;
};
const mean = (values) =>
  values.reduce((total, value) => total + value, 0) / values.length;
const countMaterial = (engine, material) => {
  let count = 0;
  for (const value of engine.getGrid()) if (value === material) count++;
  return count;
};
const checksum = (engine) => {
  let value = 0x811c9dc5;
  for (const material of engine.getGrid()) {
    value ^= material;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return `0x${value.toString(16).padStart(8, '0')}`;
};

await initSandWasm();

const makeEngine = () => {
  const engine = createEngineWasm({
    cols: COLS,
    rows: ROWS,
    worldSeed: 0xFA11,
    sinksOn: false,
    infinite: false,
  });
  engine.setBgEnabled(false);
  return engine;
};
const paintRect = (engine, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};
const tubCells = () => {
  const cells = [];
  for (let y = 40; y <= 260; y++) {
    for (let x = 80; x <= 560; x++) {
      if (y >= 253 || x <= 87 || x >= 553) cells.push([x, y]);
    }
  }
  return cells;
};
const createTub = (engine, cargo) => {
  engine.spawnBody(tubCells());
  engine.stepWorld();
  paintRect(engine, 88, 92, 552, 252, MAT.WATER);
  if (cargo) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 12; col++) {
        const material = (row + col) % 3 === 0 ? MAT.RIGID : MAT.WOOD;
        engine.spawnBox(110 + col * 38, 104 + row * 18, 6, 4, material);
      }
    }
  }
};

const measure = (name, setup, expectedBodies = 0) => {
  const engine = makeEngine();
  setup(engine);
  for (let i = 0; i < WARMUP; i++) engine.stepWorld();
  const waterBefore = countMaterial(engine, MAT.WATER);
  const timing = {
    step: [], body: [], liquid: [], carry: [], tail: [],
    fluidInitial: [], fluidCorrector: [],
    rigidCore: [], rigidClear: [], rigidDepen: [], rigidStamp: [], rigidSpill: [],
    substeps: [], bodySteps: [], contacts: [], childPairs: [], sweepFallbacks: [],
    velocityIterations: [], biasIterations: [],
    correctorBodies: [],
  };
  let maxNodes = 0;
  let maxFaces = 0;
  let maxIterations = 0;
  let maxSpillVisits = 0;
  let correctors = 0;
  let maxRejectedCells = 0;
  let maxDepenetrations = 0;
  let minBodyCount = Infinity;
  const slowTicks = [];
  let maxHeapBytes = engine.getHeapBytes();
  for (let tick = 0; tick < STEPS; tick++) {
    engine.stepWorld();
    const step = engine.getPerf().stepMs;
    const phases = engine.getStepPerf();
    const rigid = engine.getRigidSolverDebug();
    const integrity = engine.getRigidDebug();
    timing.step.push(step);
    timing.body.push(phases.bodyMs ?? 0);
    timing.liquid.push(phases.liquidMs ?? 0);
    timing.carry.push(phases.carryMs ?? 0);
    timing.tail.push(phases.tailMs ?? 0);
    timing.fluidInitial.push(rigid.fluidInitialMs);
    timing.fluidCorrector.push(rigid.fluidCorrectorMs);
    timing.rigidCore.push(rigid.rigidCoreMs);
    timing.rigidClear.push(rigid.rigidClearMs);
    timing.rigidDepen.push(rigid.rigidDepenMs);
    timing.rigidStamp.push(rigid.rigidStampMs);
    timing.rigidSpill.push(rigid.rigidSpillMs);
    timing.substeps.push(rigid.substeps);
    timing.bodySteps.push(rigid.islandBodySteps);
    timing.contacts.push(rigid.contacts);
    timing.childPairs.push(rigid.childPairs);
    timing.sweepFallbacks.push(rigid.sweepFallbacks);
    timing.velocityIterations.push(rigid.velocityIterations);
    timing.biasIterations.push(rigid.biasIterations);
    timing.correctorBodies.push(rigid.fluidCorrectorBodies);
    maxNodes = Math.max(maxNodes, rigid.fluidNodes);
    maxFaces = Math.max(maxFaces, rigid.fluidFaces);
    maxIterations = Math.max(maxIterations, rigid.fluidIterations);
    maxSpillVisits = Math.max(maxSpillVisits, rigid.spillVisits);
    correctors += rigid.fluidCorrectorPasses;
    maxRejectedCells = Math.max(
      maxRejectedCells, integrity.rejectedCells);
    maxDepenetrations = Math.max(
      maxDepenetrations, integrity.depenetrations);
    minBodyCount = Math.min(minBodyCount, engine._bodyCount());
    maxHeapBytes = Math.max(maxHeapBytes, engine.getHeapBytes());
    if (traceSlow && step > traceOverMs) {
      slowTicks.push({
        tick,
        step,
        body: phases.bodyMs ?? 0,
        grounding: phases.groundingMs ?? 0,
        assembly: phases.assemblyUnionMs ?? 0,
        react: phases.reactMs ?? 0,
        sand: phases.sandMs ?? 0,
        liquid: phases.liquidMs ?? 0,
        gas: phases.gasMs ?? 0,
        carry: phases.carryMs ?? 0,
        tail: phases.tailMs ?? 0,
        cross: phases.crossMs ?? 0,
        fluidInitial: rigid.fluidInitialMs,
        fluidCorrector: rigid.fluidCorrectorMs,
        correctorBodies: rigid.fluidCorrectorBodies,
        nodes: rigid.fluidNodes,
        faces: rigid.fluidFaces,
        iterations: rigid.fluidIterations,
        reference: rigid.fluidReferenceMs,
        domain: rigid.fluidDomainMs,
        matrix: rigid.fluidMatrixMs,
        solve: rigid.fluidSolveMs,
        writeback: rigid.fluidWritebackMs,
        contacts: rigid.contacts,
        fallbacks: rigid.sweepFallbacks,
        spill: rigid.spillVisits,
      });
    }
  }
  const waterAfter = countMaterial(engine, MAT.WATER);
  if (!Number.isFinite(minBodyCount)) minBodyCount = 0;
  const over16 = timing.step.filter((value) => value > 16.67).length;
  const over33 = timing.step.filter((value) => value > 33.33).length;
  const overBudget = timing.step.filter((value) => value > failOverMs).length;
  failedBudget ||= overBudget > 0;
  const body = engine._bodyState(0);
  const finalBodyCount = engine._bodyCount();
  if (expectedBodies
      && (minBodyCount !== expectedBodies
          || finalBodyCount !== expectedBodies))
    failedValidation = true;
  console.log(`\n${name} (${COLS}x${ROWS}, ${STEPS} measured ticks)`);
  console.log(
    `  step   mean ${mean(timing.step).toFixed(2)}`
    + `  p50 ${percentile(timing.step, 0.5).toFixed(2)}`
    + `  p95 ${percentile(timing.step, 0.95).toFixed(2)}`
    + `  p99 ${percentile(timing.step, 0.99).toFixed(2)} ms`,
  );
  console.log(
    `  phases p50 body ${percentile(timing.body, 0.5).toFixed(2)}`
    + `  liquid ${percentile(timing.liquid, 0.5).toFixed(2)}`
    + `  carry ${percentile(timing.carry, 0.5).toFixed(2)}`
    + `  tail ${percentile(timing.tail, 0.5).toFixed(2)} ms`,
  );
  console.log(
    `  fluid p50 initial ${percentile(timing.fluidInitial, 0.5).toFixed(2)}`
    + `  corrector ${percentile(timing.fluidCorrector, 0.5).toFixed(2)}`
    + `  corrector p95 ${percentile(timing.fluidCorrector, 0.95).toFixed(2)} ms`,
  );
  console.log(
    `  rigid p50 core ${percentile(timing.rigidCore, 0.5).toFixed(2)}`
    + `  clear ${percentile(timing.rigidClear, 0.5).toFixed(2)}`
    + `  depen ${percentile(timing.rigidDepen, 0.5).toFixed(2)}`
    + `  stamp ${percentile(timing.rigidStamp, 0.5).toFixed(2)}`
    + `  spill ${percentile(timing.rigidSpill, 0.5).toFixed(2)} ms`,
  );
  console.log(
    `  collision p50 substeps/body-steps ${percentile(timing.substeps, 0.5)}`
    + `/${percentile(timing.bodySteps, 0.5)}`
    + `  contacts ${percentile(timing.contacts, 0.5)}`
    + `  child-pairs ${percentile(timing.childPairs, 0.5)}`
    + `  fallbacks ${percentile(timing.sweepFallbacks, 0.5)}`
    + `  iterations ${percentile(timing.velocityIterations, 0.5)}`
    + `+${percentile(timing.biasIterations, 0.5)}`,
  );
  console.log(
    `  slow ticks >16.67ms ${over16}/${STEPS}`
    + `  >33.33ms ${over33}/${STEPS}`
    + (Number.isFinite(failOverMs)
      ? `  budget misses ${overBudget}/${STEPS}` : ''),
  );
  console.log(
    `  rigid max nodes/faces/iters ${maxNodes}/${maxFaces}/${maxIterations}`
    + `  spill ${maxSpillVisits}  correctors ${correctors}`
    + `  bodies p50 ${percentile(timing.correctorBodies, 0.5)}`
    + `  heap ${(maxHeapBytes / 1048576).toFixed(1)}MB`,
  );
  console.log(
    `  integrity bodies ${minBodyCount}/${finalBodyCount}`
    + `  rejected max ${maxRejectedCells}`
    + `  depenetrations max ${maxDepenetrations}`,
  );
  console.log(
    `  water ${waterBefore} -> ${waterAfter}`
    + `  tub y ${body?.py.toFixed(1) ?? 'n/a'}  checksum ${checksum(engine)}`,
  );
  for (const sample of slowTicks) {
    console.log(
      `  slow ${sample.tick}: ${sample.step.toFixed(2)}ms`
      + ` body ${sample.body.toFixed(2)}`
      + ` ground ${sample.grounding.toFixed(2)}`
      + ` asm ${sample.assembly.toFixed(2)}`
      + ` react ${sample.react.toFixed(2)}`
      + ` sand ${sample.sand.toFixed(2)}`
      + ` liquid ${sample.liquid.toFixed(2)}`
      + ` gas ${sample.gas.toFixed(2)}`
      + ` carry ${sample.carry.toFixed(2)}`
      + ` tail ${sample.tail.toFixed(2)}`
      + ` cross ${sample.cross.toFixed(2)}`
      + ` fluid ${sample.fluidInitial.toFixed(2)}`
      + `+${sample.fluidCorrector.toFixed(2)}`
      + ` (${sample.correctorBodies} bodies)`
      + ` nodes ${sample.nodes}/${sample.faces}/${sample.iterations}`
      + ` refs/domain/matrix/solve/write ${sample.reference.toFixed(2)}`
      + `/${sample.domain.toFixed(2)}`
      + `/${sample.matrix.toFixed(2)}`
      + `/${sample.solve.toFixed(2)}`
      + `/${sample.writeback.toFixed(2)}`
      + ` contacts ${sample.contacts}`
      + ` fallbacks ${sample.fallbacks}`
      + ` spill ${sample.spill}`,
    );
  }
  engine.destroy();
};

if (requested === 'all' || requested === 'water')
  measure('falling water', (engine) => {
    paintRect(engine, 110, 40, 529, 219, MAT.WATER);
  });
if (requested === 'all' || requested === 'tub')
  measure('falling water tub', (engine) => createTub(engine, false), 1);
if (requested === 'all' || requested === 'cargo')
  measure('falling water tub with 96 rigid bodies',
    (engine) => createTub(engine, true), 97);
if (failedBudget || failedValidation) process.exitCode = 1;
