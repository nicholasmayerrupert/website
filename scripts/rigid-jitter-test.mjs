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
  const result = { initialBodies, finalBodies: engine._bodyCount(), settledAt };
  engine.destroy();
  return result;
};

for (const seed of [13, 36]) {
  const result = runScene(seed);
  console.log(`seed ${seed}: ${JSON.stringify(result)}`);
  check(`seed ${seed} creates the compound pile (${result.initialBodies} bodies)`,
    result.initialBodies >= 12);
  check(`seed ${seed} fully settles and bakes (${result.finalBodies} bodies, tick ${result.settledAt})`,
    result.finalBodies === 0);
}

const failures = done();
console.log(failures === 0
  ? '\nall checks passed'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
