// Generated-like compound piles with deterministic contact cycles must settle
// and bake without relying on a single hand-tuned body shape.

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
const { check, done } = makeChecker('bounded rigid-pile settling');
const SOLVER_MODE = Number.parseInt(
  process.env.RIGID_SOLVER_MODE ?? '2', 10);

const COLS = 480, ROWS = 340, FLOOR_Y = 304;
const unique = (cells) => [
  ...new Map(cells.map(([x, y]) => [`${x},${y}`, [x, y]])).values(),
];
const rectangle = (width, height) => {
  const cells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) cells.push([x, y]);
  return cells;
};
const beam = (length, thickness, riseA, riseB) => {
  const cells = [];
  let y = 0;
  for (let x = 0; x < length; x++) {
    if (x > 0 && x % riseA === 0) y++;
    if (x > 0 && x % riseB === 0) y--;
    for (let t = 0; t < thickness; t++) cells.push([x, y + t]);
  }
  return unique(cells);
};
const lShape = (width, height, thickness) => {
  const cells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < thickness || y >= height - thickness) cells.push([x, y]);
  return cells;
};
const tee = (width, height, thickness) => {
  const cells = [];
  const stem = Math.floor((width - thickness) / 2);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (y < thickness || (x >= stem && x < stem + thickness))
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
const stair = (steps, tread, thickness) => {
  const cells = [];
  for (let step = 0; step < steps; step++) {
    for (let y = 0; y < thickness; y++)
      for (let x = 0; x < tread; x++)
        cells.push([step * tread + x, step * thickness + y]);
    if (step + 1 < steps)
      for (let y = thickness; y < thickness * 2; y++)
        cells.push([(step + 1) * tread - 1, step * thickness + y]);
  }
  return unique(cells);
};

const largeShapeBuilder = () => {
  const cells = new Map();
  const put = (x, y) => cells.set(`${x},${y}`, [x, y]);
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) put(x, y);
  };
  const line = (x0, y0, x1, y1, thickness = 2) => {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      rect(x0 - thickness, y0 - thickness,
        x0 + thickness, y0 + thickness);
      if (x0 === x1 && y0 === y1) break;
      const twice = error * 2;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  };
  const result = () => {
    const values = [...cells.values()];
    const minX = Math.min(...values.map(([x]) => x));
    const minY = Math.min(...values.map(([, y]) => y));
    return values.map(([x, y]) => [x - minX, y - minY]);
  };
  return { rect, line, result };
};

const largeHouse = (width, height, scale = 1) => {
  const shape = largeShapeBuilder();
  const thickness = Math.max(2, Math.round(3 * scale));
  const base = height - thickness * 2;
  shape.rect(0, base, width, height);
  shape.rect(thickness * 2, Math.round(height * 0.42),
    thickness * 4, base);
  shape.rect(width - thickness * 4, Math.round(height * 0.42),
    width - thickness * 2, base);
  shape.rect(Math.round(width * 0.48), Math.round(height * 0.28),
    Math.round(width * 0.52), base);
  shape.rect(thickness * 2, Math.round(height * 0.62),
    width - thickness * 2, Math.round(height * 0.62) + thickness * 2);
  shape.line(0, Math.round(height * 0.45),
    Math.round(width * 0.5), 0, thickness);
  shape.line(Math.round(width * 0.5), 0, width,
    Math.round(height * 0.45), thickness);
  return shape.result();
};

const largeBridge = (width, height, scale = 1) => {
  const shape = largeShapeBuilder();
  const thickness = Math.max(2, Math.round(3 * scale));
  shape.rect(0, height - thickness * 3, width, height);
  shape.rect(0, 0, thickness * 3, height);
  shape.rect(width - thickness * 3, 0, width, height);
  for (let span = 0; span < 5; span++) {
    const x0 = Math.round(span * width / 5);
    const x1 = Math.round((span + 1) * width / 5);
    if (span % 2)
      shape.line(x0, height - thickness * 4, x1, thickness * 2,
        thickness);
    else
      shape.line(x0, thickness * 2, x1, height - thickness * 4,
        thickness);
  }
  return shape.result();
};

const largeBranched = (width, height, seed) => {
  const shape = largeShapeBuilder();
  const cx = Math.round(width * 0.5), cy = Math.round(height * 0.55);
  shape.rect(cx - 6, cy - 6, cx + 6, cy + 6);
  for (let branch = 0; branch < 9; branch++) {
    const phase = ((seed * 17 + branch * 43) % 628) / 100;
    const reach = 0.35 + ((seed * 13 + branch * 19) % 50) / 100;
    const x = Math.round(cx + Math.cos(phase) * width * reach);
    const y = Math.round(cy + Math.sin(phase) * height * reach);
    shape.line(cx, cy, x, y, 2 + (branch % 3));
    if (branch % 2 === 0)
      shape.line(x, y, x + (branch % 4 - 2) * 12, y - 20, 2);
  }
  return shape.result();
};

const runScene = (seed) => {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const randomInt = (a, b) => a + Math.floor(random() * (b - a + 1));
  const engine = createEngineWasm({
    cols: COLS, rows: ROWS, worldSeed: seed, sinksOn: false, infinite: false,
  });
  engine._setRigidSolverOptions(SOLVER_MODE);
  for (let x = 0; x < COLS; x++) {
    const wave = Math.round(3 * Math.sin(x * 0.075));
    const tooth = (x * 17 + 11) % 31 < 4 ? -randomInt(1, 4) : 0;
    for (let y = FLOOR_Y + wave + tooth; y < ROWS; y++)
      engine.paintDisc(x, y, 0, MAT.STONE, true);
  }

  for (let i = 0; i < 14; i++) {
    const kind = (i + seed) % 6;
    let shape;
    if (kind === 0)
      shape = beam(randomInt(42, 92), randomInt(1, 4),
        randomInt(13, 23), randomInt(29, 43));
    else if (kind === 1)
      shape = lShape(randomInt(24, 48), randomInt(20, 44), randomInt(2, 6));
    else if (kind === 2)
      shape = tee(randomInt(26, 54), randomInt(20, 48), randomInt(2, 6));
    else if (kind === 3)
      shape = ring(randomInt(22, 46), randomInt(18, 38), randomInt(2, 5));
    else if (kind === 4)
      shape = stair(randomInt(4, 8), randomInt(5, 9), randomInt(2, 4));
    else
      shape = rectangle(randomInt(5, 16), randomInt(5, 28));
    const width = Math.max(...shape.map(([x]) => x)) + 1;
    const height = Math.max(...shape.map(([, y]) => y)) + 1;
    const laneX = 55 + (i % 5) * 82;
    const laneY = 12 + Math.floor(i / 5) * 78;
    const ox = Math.max(2, Math.min(COLS - width - 2,
      laneX - Math.floor(width / 2) + randomInt(-22, 22)));
    const oy = Math.max(2, Math.min(FLOOR_Y - height - 12,
      laneY + randomInt(-8, 8)));
    for (const [x, y] of shape)
      engine.paintDisc(x + ox, y + oy, 0, MAT.BRICK, true);
  }
  engine.syncComponents();
  engine.stepWorld();
  const initialBodies = engine._bodyCount();
  for (let body = 0; body < initialBodies; body++)
    engine._setBodyMotion(body,
      (random() - 0.5) * 0.4,
      random() * 0.25,
      (random() - 0.5) * 0.018);

  let settledAt = -1;
  for (let tick = 0; tick < 1400; tick++) {
    engine.stepWorld();
    if (engine._bodyCount() === 0) {
      settledAt = tick;
      break;
    }
  }
  const remaining = [];
  for (let body = 0; body < engine._bodyCount(); body++)
    remaining.push({
      id: engine._bodyIdLayer(0, body),
      awake: engine._bodyAwake(body),
      blocked: engine._bodyBlocked(body),
      terrain: engine._bodyTerrainBlocked(body),
      ...engine._bodyState(body),
    });
  const result = {
    initialBodies, finalBodies: engine._bodyCount(), settledAt, remaining,
  };
  engine.destroy();
  return result;
};

const jitterSeeds = (process.env.JITTER_SEEDS ?? '13,36')
  .split(',').map(Number).filter(Number.isFinite);
for (const seed of jitterSeeds) {
  const result = runScene(seed);
  console.log(`seed ${seed}: ${JSON.stringify(result)}`);
  check(`seed ${seed} creates the compound pile (${result.initialBodies} bodies)`,
    result.initialBodies >= 12);
  check(`seed ${seed} fully settles and bakes (${result.finalBodies} bodies, tick ${result.settledAt})`,
    result.finalBodies === 0);
}

{
  const cols = 960, rows = 608, floorY = 560, seed = 8;
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const engine = createEngineWasm({
    cols, rows, worldSeed: seed, sinksOn: false, infinite: false,
  });
  engine._setRigidSolverOptions(SOLVER_MODE);
  for (let x = 0; x < cols; x++) {
    const top = floorY + Math.round(Math.sin(x * 0.031) * 16)
      - ((x * 29 + seed) % 97 < 9 ? 24 : 0);
    for (let y = top; y < rows; y++)
      engine.paintDisc(x, y, 0, MAT.STONE, true);
  }
  engine.syncComponents();

  for (let body = 0; body < 12; body++) {
    const kind = (seed + body) % 3;
    const width = kind === 0 ? 120 + (body % 3) * 28
      : kind === 1 ? 150 + (body % 3) * 35 : 100 + (body % 4) * 20;
    const height = kind === 0 ? 95 + (body % 4) * 18
      : kind === 1 ? 65 + (body % 3) * 18 : 100 + (body % 3) * 22;
    const cells = kind === 0
      ? largeHouse(width, height, 1 + (body % 2) * 0.3)
      : kind === 1
        ? largeBridge(width, height, 1 + (body % 2) * 0.25)
        : largeBranched(width, height, seed * 31 + body);
    const lane = body % 4;
    const level = Math.floor(body / 4);
    const ox = 35 + lane * 225 + Math.round((random() - 0.5) * 45);
    const oy = 20 + level * 145 + Math.round((random() - 0.5) * 25);
    const widthCells = Math.max(...cells.map(([x]) => x)) + 1;
    const heightCells = Math.max(...cells.map(([, y]) => y)) + 1;
    const safeX = Math.max(1, Math.min(cols - widthCells - 1, ox));
    const safeY = Math.max(1, Math.min(floorY - heightCells - 1, oy));
    engine.spawnBody(cells.map(([x, y]) => [x + safeX, y + safeY]));
  }
  for (let body = 0; body < 12; body++)
    engine._setBodyMotion(body,
      (random() - 0.5) * 0.7,
      random() * 0.35,
      (random() - 0.5) * 0.018);

  let maxChildren = 0, maxRadius = 0, settledAt = -1;
  const windows = new Map();
  for (let tick = 0; tick < 1800; tick++) {
    engine.stepWorld();
    let awakeNow = 0;
    for (let body = 0; body < engine._bodyCount(); body++) {
      maxChildren = Math.max(maxChildren, engine._bodyChildCount(body));
      const bodyState = engine._bodyState(body);
      maxRadius = Math.max(maxRadius, bodyState?.maxR ?? 0);
      const bodyAwake = engine._bodyAwake(body);
      awakeNow += bodyAwake;
      if (tick < 1400 || !bodyAwake) continue;
      const id = engine._bodyIdLayer(0, body);
      const window = windows.get(id) ?? {
        minX: bodyState.px, maxX: bodyState.px,
        minY: bodyState.py, maxY: bodyState.py,
        minAngle: bodyState.angle, maxAngle: bodyState.angle,
        radius: bodyState.maxR,
      };
      window.minX = Math.min(window.minX, bodyState.px);
      window.maxX = Math.max(window.maxX, bodyState.px);
      window.minY = Math.min(window.minY, bodyState.py);
      window.maxY = Math.max(window.maxY, bodyState.py);
      window.minAngle = Math.min(window.minAngle, bodyState.angle);
      window.maxAngle = Math.max(window.maxAngle, bodyState.angle);
      windows.set(id, window);
    }
    if (awakeNow === 0) {
      settledAt = tick;
      break;
    }
  }
  const awake = [...Array(engine._bodyCount()).keys()]
    .reduce((count, body) => count + engine._bodyAwake(body), 0);
  const visibleSpan = Math.max(0, ...[...windows.values()].map((window) =>
    Math.hypot(window.maxX - window.minX, window.maxY - window.minY)
      + (window.maxAngle - window.minAngle) * window.radius));
  check(`large structural pile exercises complex compound bodies `
      + `(${maxChildren} children, radius ${maxRadius.toFixed(1)})`,
    maxChildren >= 500 && maxRadius >= 200);
  check(`large structural pile settles without a visible contact cycle `
      + `(${awake} awake at tick ${settledAt}, `
      + `${visibleSpan.toFixed(2)}-cell late span)`,
    settledAt >= 0 && awake === 0 && visibleSpan <= 2);
  engine.destroy();
}

const failures = done();
console.log(failures === 0
  ? '\nall checks passed'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
