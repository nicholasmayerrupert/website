// Exercise exact compound proxies with many concave, convex, short, long, thin,
// thick, solid, and hollow rigid bodies in one deterministic collision scene.

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
const { check, done } = makeChecker('diverse rigid shape stress');

const unique = (cells) => [
  ...new Map(cells.map(([x, y]) => [`${x},${y}`, [x, y]])).values(),
];
const place = (cells, ox, oy) =>
  unique(cells.map(([x, y]) => [x + ox, y + oy]));
const rectangle = (width, height) => {
  const cells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) cells.push([x, y]);
  return cells;
};
const lShape = (size, thickness) => {
  const cells = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (x < thickness || y >= size - thickness) cells.push([x, y]);
  return cells;
};
const tee = (width, height, thickness) => {
  const cells = [];
  const stemX = Math.floor((width - thickness) / 2);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (y < thickness || (x >= stemX && x < stemX + thickness))
        cells.push([x, y]);
  return cells;
};
const uShape = (width, height, thickness) => {
  const cells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < thickness || x >= width - thickness
          || y >= height - thickness)
        cells.push([x, y]);
  return cells;
};
const ring = (width, height, thickness) => {
  const cells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < thickness || x >= width - thickness
          || y < thickness || y >= height - thickness)
        cells.push([x, y]);
  return cells;
};
const cross = (width, height, thickness) => {
  const cells = [];
  const x0 = Math.floor((width - thickness) / 2);
  const y0 = Math.floor((height - thickness) / 2);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((x >= x0 && x < x0 + thickness)
          || (y >= y0 && y < y0 + thickness))
        cells.push([x, y]);
  return cells;
};
const stair = (steps, tread, thickness) => {
  const cells = [];
  for (let step = 0; step < steps; step++)
    for (let y = 0; y < thickness; y++)
      for (let x = 0; x < tread; x++)
        cells.push([step * tread + x, step * thickness + y]);
  for (let step = 0; step + 1 < steps; step++)
    for (let y = 0; y < thickness; y++)
      cells.push([(step + 1) * tread - 1, step * thickness + thickness + y]);
  return unique(cells);
};
const zigzag = (length, thickness) => {
  const cells = [];
  let y = 0;
  for (let x = 0; x < length; x++) {
    if (x > 0 && x % 17 === 0) y++;
    if (x > 0 && x % 29 === 0) y--;
    for (let t = 0; t < thickness; t++) cells.push([x, y + t]);
  }
  return cells;
};
const comb = (width, height, thickness, toothGap) => {
  const cells = rectangle(width, thickness);
  for (let x = 0; x < width; x += toothGap)
    for (let y = thickness; y < height; y++)
      for (let t = 0; t < thickness && x + t < width; t++)
        cells.push([x + t, y]);
  return unique(cells);
};
const disc = (radius) => {
  const cells = [];
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++)
      if (x * x + y * y <= radius * radius) cells.push([x, y]);
  return cells;
};
const diamond = (radius) => {
  const cells = [];
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++)
      if (Math.abs(x) + Math.abs(y) <= radius) cells.push([x, y]);
  return cells;
};
const localPoints = (cells) => {
  const cx = cells.reduce((sum, [x]) => sum + x + 0.5, 0) / cells.length;
  const cy = cells.reduce((sum, [, y]) => sum + y + 0.5, 0) / cells.length;
  return cells.map(([x, y]) => [x + 0.5 - cx, y + 0.5 - cy]);
};
const worldPoints = (points, state) => {
  const cs = Math.cos(state.angle), sn = Math.sin(state.angle);
  return points.map(([x, y]) => [
    state.px + x * cs - y * sn,
    state.py + x * sn + y * cs,
  ]);
};
const paintRectangle = (engine, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};

const cols = 720, rows = 420, floorY = rows - 3;
const engine = createEngineWasm({
  cols,
  rows,
  worldSeed: 0x5a17e55,
  sinksOn: false,
  infinite: false,
});
paintRectangle(engine, 0, floorY, cols - 1, rows - 1, MAT.STONE);
paintRectangle(engine, 26, 215, 30, floorY - 1, MAT.STONE);
paintRectangle(engine, 200, 215, 204, floorY - 1, MAT.STONE);
paintRectangle(engine, 326, 170, 330, floorY - 1, MAT.STONE);
paintRectangle(engine, cols - 30, 170, cols - 26, floorY - 1, MAT.STONE);
engine.syncComponents();

const definitions = [
  ['120x120x8 L', lShape(120, 8), 80, 286],
  ['payload rectangle', rectangle(24, 12), 112, 34],
  ['payload beam', rectangle(70, 4), 94, 72],
  ['payload L', lShape(34, 5), 126, 104],
  ['payload disc', disc(10), 142, 160],
  ['payload ring', ring(32, 24, 4), 118, 205],
  ['solid block', rectangle(34, 22), 360, 24],
  ['long thick bar', rectangle(92, 5), 468, 24],
  ['T', tee(58, 48, 7), 598, 20],
  ['U', uShape(52, 48, 6), 360, 92],
  ['hollow ring', ring(54, 42, 5), 470, 92],
  ['cross', cross(48, 48, 7), 608, 92],
  ['stair', stair(7, 8, 4), 356, 164],
  ['thin zigzag', zigzag(84, 2), 468, 164],
  ['comb', comb(68, 42, 4, 13), 598, 158],
  ['large disc', disc(18), 382, 236],
  ['diamond', diamond(20), 500, 230],
  ['small L', lShape(26, 4), 618, 226],
  ['vertical bar', rectangle(5, 78), 360, 300],
  ['small block', rectangle(9, 9), 454, 286],
  ['small ring', ring(22, 18, 3), 532, 286],
  ['short T', tee(30, 28, 4), 626, 286],
];

const bodies = [];
for (const [name, shape, x, y] of definitions) {
  const cells = place(shape, x, y);
  const index = engine._bodyCount();
  engine.spawnBody(cells);
  bodies.push({
    name,
    index,
    cells,
    points: localPoints(cells),
    nPts: cells.length,
    children: engine._bodyChildCount(index),
  });
}

check(`solid rectangle decomposes to one child `
    + `(${bodies.find((body) => body.name === 'solid block').children} == 1)`,
  bodies.find((body) => body.name === 'solid block').children === 1);
check(`120x120x8 L decomposes to two children `
    + `(${bodies[0].children} == 2)`, bodies[0].children === 2);
check(`hollow and stepped shapes produce nontrivial compounds `
    + `(max ${Math.max(...bodies.map((body) => body.children))} >= 7)`,
  Math.max(...bodies.map((body) => body.children)) >= 7);

for (let i = 1; i < bodies.length; i++) {
  const vx = ((i * 37) % 11 - 5) * 0.055;
  const vy = ((i * 19) % 5) * 0.025;
  const omega = ((i * 23) % 9 - 4) * 0.0025;
  engine._setBodyMotion(i, vx, vy, omega);
}

let childPairs = 0, childManifolds = 0, sweepFallbacks = 0;
let maxChildren = 0, maxRejected = 0, maxDepenetrations = 0;
let latePeakPointSpeed = 0, minimumBodyCount = bodies.length;
for (let tick = 0; tick < 1800; tick++) {
  engine.stepWorld();
  minimumBodyCount = Math.min(minimumBodyCount, engine._bodyCount());
  const solver = engine.getRigidSolverDebug();
  childPairs += solver.childPairs;
  childManifolds += solver.childManifolds;
  sweepFallbacks += solver.sweepFallbacks;
  maxChildren = Math.max(maxChildren, solver.maxChildren);
  if (tick >= 1200) {
    const raster = engine.getRigidDebug();
    maxRejected = Math.max(maxRejected, raster.rejectedCells);
    maxDepenetrations = Math.max(
      maxDepenetrations, raster.depenetrations);
    for (let body = 0; body < engine._bodyCount(); body++) {
      const state = engine._bodyState(body);
      latePeakPointSpeed = Math.max(latePeakPointSpeed,
        Math.hypot(state.vx, state.vy)
          + Math.abs(state.omega) * state.maxR);
    }
  }
}

const states = bodies.map((body) => engine._bodyState(body.index));
let retainedGeometry = true, finitePoses = true, finalAwake = 0;
for (let i = 0; i < bodies.length; i++) {
  const state = states[i];
  retainedGeometry &&= !!state && state.nPts === bodies[i].nPts;
  finitePoses &&= !!state
    && [state.px, state.py, state.angle, state.vx, state.vy, state.omega]
      .every(Number.isFinite)
    && state.px > -150 && state.px < cols + 150
    && state.py > -150 && state.py < rows + 150;
  finalAwake += engine._bodyAwake(i) > 0;
}
const mainWorldPoints = worldPoints(bodies[0].points, states[0]);
const mainBottomTop = Math.min(...mainWorldPoints
  .filter((_, index) => bodies[0].cells[index][1] >= 398)
  .map(([, y]) => y)) - 0.5;
const payloadBottom = Math.max(...bodies.slice(1, 6).flatMap((body, index) =>
  worldPoints(body.points, states[index + 1]).map(([, y]) => y)));

let minimumDistance = Infinity, minimumPair = '';
const buckets = new Map();
const bucketSize = 0.4;
for (let body = 0; body < bodies.length; body++) {
  if (!states[body]) continue;
  for (const [x, y] of worldPoints(bodies[body].points, states[body])) {
    const bx = Math.floor(x / bucketSize);
    const by = Math.floor(y / bucketSize);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const neighbors = buckets.get(`${bx + dx},${by + dy}`);
        if (!neighbors) continue;
        for (const other of neighbors) {
          if (other.body === body) continue;
          const distance = Math.hypot(x - other.x, y - other.y);
          if (distance < minimumDistance) {
            minimumDistance = distance;
            minimumPair = `${bodies[other.body].name}/${bodies[body].name}`;
          }
        }
      }
    const key = `${bx},${by}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push({ body, x, y });
    buckets.set(key, bucket);
  }
}
const overlapSummary = Number.isFinite(minimumDistance)
  ? `minimum ${minimumDistance.toFixed(3)} at ${minimumPair}`
  : `no cross-body cell centres within ${bucketSize}`;

check(`all ${bodies.length} bodies survived the simultaneous scene `
    + `(minimum/final ${minimumBodyCount}/${engine._bodyCount()})`,
  minimumBodyCount === bodies.length && engine._bodyCount() === bodies.length);
check('every body retained its exact occupied-cell count', retainedGeometry);
check('all final poses and velocities are finite and bounded', finitePoses);
check(`compound SAT exercised child pairs and manifolds `
    + `(${childPairs}/${childManifolds})`,
  childPairs > 1000 && childManifolds > 100);
check(`legacy sweep remained available for CCD (${sweepFallbacks} > 0)`,
  sweepFallbacks > 0);
check(`the scene exercised high-complexity compounds (${maxChildren} >= 7)`,
  maxChildren >= 7);
check(`all payload geometry remained above the 120x8 L support arm `
    + `(${payloadBottom.toFixed(2)} <= ${mainBottomTop.toFixed(2)})`,
  payloadBottom <= mainBottomTop + 0.25);
check(`no pair ended in a deep cell-centre overlap `
    + `(${overlapSummary})`,
  minimumDistance >= 0.3);
check(`most bodies settled (${finalAwake} awake <= 3)`, finalAwake <= 3);
check(`late point motion stayed bounded `
    + `(${latePeakPointSpeed.toFixed(4)} <= 0.12)`,
  latePeakPointSpeed <= 0.12);
check(`late raster conflicts stayed bounded (${maxRejected} <= 12)`,
  maxRejected <= 12);
check(`late terrain depenetrations stayed bounded (${maxDepenetrations} <= 2)`,
  maxDepenetrations <= 2);

engine.destroy();
const failures = done();
console.log(failures === 0
  ? '\nall checks passed'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
