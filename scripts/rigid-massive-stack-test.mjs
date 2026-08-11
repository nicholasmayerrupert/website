// Wide structure-scale stacks exercise Box2D compound contacts and final raster
// reconciliation at the largest supported body dimensions.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const createEngineWasm = (options) =>
  attachTestHooks(createEngineWasmRaw(options));
const { check, done } = makeChecker('massive irregular rigid stacks');
const COLS = 960, ROWS = 1160, FLOOR_Y = 1090;

const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const makeShape = (width, height, seed) => {
  const random = makeRandom(seed);
  const cells = new Map();
  const put = (x, y) => {
    if (x >= 0 && x < width && y >= 0 && y < height)
      cells.set(`${x},${y}`, [x, y]);
  };
  const disc = (cx, cy, radius) => {
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) put(x, y);
  };
  const line = (x0, y0, x1, y1, radius) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step++) {
      const t = step / Math.max(1, steps);
      disc(Math.round(x0 + (x1 - x0) * t),
        Math.round(y0 + (y1 - y0) * t), radius);
    }
  };
  const cx = Math.round(width * (0.42 + random() * 0.16));
  const cy = Math.round(height * (0.40 + random() * 0.20));
  disc(cx, cy, 7);
  line(4, Math.round(height * 0.72), width - 5,
    Math.round(height * 0.72 + (random() - 0.5) * 20), 3);
  for (let branch = 0; branch < 15; branch++) {
    const side = branch & 1 ? 1 : -1;
    const x = side > 0
      ? Math.round(width * (0.58 + random() * 0.40))
      : Math.round(width * random() * 0.42);
    const y = Math.round(5 + random() * (height - 10));
    line(cx, cy, x, y, 2 + (branch % 4));
    if (branch % 3 === 0)
      line(x, y, Math.max(2, Math.min(width - 3,
        x + (random() - 0.5) * 90)),
      Math.max(2, Math.min(height - 3,
        y + (random() - 0.5) * 80)), 2);
  }
  return [...cells.values()];
};

const runCase = (seed, bodyCount) => {
  const random = makeRandom(seed ^ 0x51ac);
  const engine = createEngineWasm({
    cols: COLS, rows: ROWS, worldSeed: seed,
    sinksOn: false, infinite: false,
  });
  for (let x = 0; x < COLS; x++) {
    const top = FLOOR_Y + Math.round(12 * Math.sin(x * 0.039 + seed))
      - ((x * 19 + seed) % 83 < 13 ? 22 : 0);
    for (let y = top; y < ROWS; y++)
      engine.paintDisc(x, y, 0, MAT.STONE, true);
  }
  engine.syncComponents();

  let y = 24;
  for (let body = 0; body < bodyCount; body++) {
    const width = 650 + Math.floor(random() * 220);
    const height = bodyCount > 8
      ? 54 + Math.floor(random() * 18)
      : bodyCount > 6
        ? 88 + Math.floor(random() * 28)
      : 125 + Math.floor(random() * 45);
    const shape = makeShape(width, height, seed * 31 + body);
    const x = Math.round((COLS - width) * 0.5
      + (random() - 0.5) * 70);
    engine.spawnBody(shape.map(([cellX, cellY]) =>
      [cellX + x, cellY + y]));
    engine._setBodyMotion(body,
      (random() - 0.5) * 0.9,
      0.1 + random() * 0.45,
      (random() - 0.5) * 0.045);
    y += height + (bodyCount > 8 ? 10 : 18);
  }

  let maxChildren = 0, maxRadius = 0, maxBlocked = 0;
  let maxTerrainBlocked = 0, maxConflicts = 0, maxRejected = 0;
  let settledAt = -1;
  let maxPositionCorrections = 0;
  let maxContacts = 0, maxIslands = 0, maxGlobalBodySteps = 0;
  let maxRasterFailures = 0;
  for (let tick = 0; tick < 1200; tick++) {
    engine.stepWorld();
    let awake = 0;
    for (let body = 0; body < engine._bodyCount(); body++) {
      const state = engine._bodyState(body);
      awake += engine._bodyAwake(body) > 0;
      maxChildren = Math.max(maxChildren, engine._bodyChildCount(body));
      maxRadius = Math.max(maxRadius, state.maxR);
      maxBlocked = Math.max(maxBlocked, engine._bodyBlocked(body));
      maxTerrainBlocked = Math.max(maxTerrainBlocked,
        engine._bodyTerrainBlocked(body));
    }
    const rigid = engine.getRigidDebug();
    const solver = engine.getRigidSolverDebug();
    maxRejected = Math.max(maxRejected, rigid.rejectedCells);
    maxConflicts = Math.max(maxConflicts, solver.ownershipConflicts);
    maxPositionCorrections = Math.max(
      maxPositionCorrections, solver.positionCorrections);
    maxContacts = Math.max(maxContacts, solver.contacts);
    maxIslands = Math.max(maxIslands, solver.islands);
    maxGlobalBodySteps = Math.max(
      maxGlobalBodySteps, solver.globalBodySteps);
    maxRasterFailures = Math.max(
      maxRasterFailures, solver.rasterProjectionFailures);
    if (awake === 0) {
      settledAt = tick;
      break;
    }
  }
  const finalAwake = [...Array(engine._bodyCount()).keys()]
    .reduce((count, body) => count + (engine._bodyAwake(body) > 0), 0);
  let finalBlocked = 0, finalTerrainBlocked = 0, finalPeakPointSpeed = 0;
  for (let body = 0; body < engine._bodyCount(); body++) {
    const state = engine._bodyState(body);
    finalPeakPointSpeed = Math.max(finalPeakPointSpeed,
      Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR);
    finalBlocked += Math.max(0, engine._bodyBlocked(body));
    finalTerrainBlocked += Math.max(0, engine._bodyTerrainBlocked(body));
  }
  const result = { seed, bodies: engine._bodyCount(), finalAwake,
    requestedBodies: bodyCount, settledAt, maxBlocked, maxTerrainBlocked,
    finalBlocked, finalTerrainBlocked,
    maxPositionCorrections, maxChildren, maxRadius,
    maxConflicts, maxRejected, maxContacts, maxIslands,
    maxGlobalBodySteps, maxRasterFailures, finalPeakPointSpeed };
  engine.destroy();
  return result;
};

const caseSeed = Number.parseInt(process.env.CASE_SEED ?? '', 10);
const cases = [[3, 6], [11, 6], [12, 8]]
  .filter(([seed]) => !Number.isFinite(caseSeed) || seed === caseSeed);
const results = cases.map(([seed, bodyCount]) => runCase(seed, bodyCount));
for (const result of results)
  console.log(`  seed ${result.seed}/${result.requestedBodies}: `
    + `${result.settledAt} ticks, ${result.maxChildren} children, `
    + `radius ${result.maxRadius.toFixed(1)}, `
    + `${result.maxBlocked}/${result.maxTerrainBlocked} blocked, `
    + `${result.maxConflicts}/${result.maxRejected} conflicts/rejected, `
    + `${result.maxPositionCorrections} projections, `
    + `${result.maxRasterFailures} failed projections, `
    + `${result.maxContacts} Box2D contacts, `
    + `${result.finalBlocked}/${result.finalTerrainBlocked} final blocked, `
    + `${result.finalPeakPointSpeed.toFixed(4)} final speed`);
check('every scene creates all requested structure-scale bodies',
  results.every((result) => result.bodies === result.requestedBodies
    && result.maxChildren >= 300 && result.maxRadius >= 400));
check('every massive stack sleeps or becomes quiescent within 1200 ticks',
  results.every((result) => result.settledAt >= 0
    || result.finalPeakPointSpeed <= 0.05));
check('Box2D solves contacts and islands for every massive stack',
  results.every((result) => result.maxContacts > 0
    && result.maxIslands > 0
    && result.maxGlobalBodySteps >= result.requestedBodies));
check('massive stacks finish with terrain-clear, disjoint rasters',
  results.every((result) => result.finalBlocked <= 1
    && result.finalTerrainBlocked === 0));
check('massive stack lattice reconciliation remains bounded',
  results.every((result) => result.maxBlocked <= 32
    && result.maxTerrainBlocked === 0
    && result.maxConflicts <= 32 && result.maxRejected <= 32
    && result.maxRasterFailures <= 2));
process.exitCode = done();
