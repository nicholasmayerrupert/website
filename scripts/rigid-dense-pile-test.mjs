// Dense irregular piles must dissipate collision energy, stop producing raster
// conflicts, and enter island sleep instead of shaking indefinitely.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const COLS = 240, ROWS = 180, STONE = 3;

await initSandWasm();
const e = createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0xBEEF,
  sinksOn: false,
});

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};
const stoneRect = (x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      e.paintDisc(x, y, 0, STONE, true);
};

stoneRect(0, ROWS - 3, COLS - 1, ROWS - 1);
stoneRect(20, ROWS - 80, 22, ROWS - 4);
stoneRect(COLS - 23, ROWS - 80, COLS - 21, ROWS - 4);
e.syncComponents();

let randomState = 12345;
const random = () => {
  randomState = (randomState * 1103515245 + 12345) & 0x7fffffff;
  return randomState / 0x7fffffff;
};
const randomInt = (a, b) => a + ((random() * (b - a + 1)) | 0);

function irregular(cx, cy) {
  const cells = new Set();
  const add = (x, y) => cells.add(`${x},${y}`);
  const kind = randomInt(0, 4);
  if (kind === 0) {
    const n = randomInt(10, 24);
    for (let i = 0; i < n; i++) add(cx + i, cy);
  } else if (kind === 1) {
    const n = randomInt(10, 24);
    for (let i = 0; i < n; i++) add(cx, cy + i);
  } else if (kind === 2) {
    const n = randomInt(8, 16);
    for (let i = 0; i < n; i++) {
      add(cx, cy + i);
      add(cx + i, cy + n - 1);
    }
  } else if (kind === 3) {
    const radius = randomInt(4, 7);
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++)
        if (dx * dx + dy * dy <= radius * radius) add(cx + dx, cy + dy);
  } else {
    const width = randomInt(6, 12), height = randomInt(4, 9);
    for (let dy = 0; dy < height; dy++)
      for (let dx = 0; dx < width; dx++)
        if (random() > 0.25) add(cx + dx, cy + dy);
  }
  return [...cells].map((cell) => cell.split(',').map(Number));
}

console.log('one hundred irregular bodies settle as a coherent dense pile');
const BODY_COUNT = 100, STEPS = 900;
let spawned = 0, now = 0, settledAt = -1;
let latePeakSpeed = 0, lateRejected = 0, lateDepenetrations = 0;
let activeContacts = 0, activeWarmStarts = 0;
for (let tick = 1; tick <= STEPS; tick++) {
  if (spawned < BODY_COUNT && tick % 4 === 0) {
    e.spawnBody(irregular(
      randomInt(30, COLS - 40),
      randomInt(8, 30),
    ));
    spawned++;
  }
  now += 16;
  e.step(now);

  const solver = e.getRigidSolverDebug();
  if (tick >= 450 && tick <= 550) {
    activeContacts += solver.contacts;
    activeWarmStarts += solver.warmStarted;
  }
  if (tick >= 650) {
    const raster = e.getRigidDebug();
    lateRejected = Math.max(lateRejected, raster.rejectedCells);
    lateDepenetrations = Math.max(lateDepenetrations, raster.depenetrations);
    let awake = 0;
    for (let i = 0; i < e._bodyCount(); i++) {
      awake += e._bodyAwake(i) > 0;
      const state = e._bodyState(i);
      if (tick >= 700)
        latePeakSpeed = Math.max(latePeakSpeed, Math.hypot(state.vx, state.vy));
    }
    if (awake === 0 && settledAt < 0) settledAt = tick;
  }
}

let finalAwake = 0;
for (let i = 0; i < e._bodyCount(); i++) finalAwake += e._bodyAwake(i) > 0;
const warmRatio = activeWarmStarts / Math.max(1, activeContacts);

check(`most bodies remain represented (${e._bodyCount()} >= 75)`, e._bodyCount() >= 75);
check(`contact cache warm-started the active pile (${(warmRatio * 100).toFixed(1)}% >= 80%)`,
  warmRatio >= 0.8);
check(`pile slept by tick 850 (tick ${settledAt})`, settledAt >= 0 && settledAt <= 850);
check(`no bodies remained awake (${finalAwake} == 0)`, finalAwake === 0);
check(`late motion stayed restrained (peak ${latePeakSpeed.toFixed(4)} <= 0.03)`,
  latePeakSpeed <= 0.03);
check(`late raster conflicts stayed bounded (${lateRejected} <= 20)`, lateRejected <= 20);
check(`late terrain depenetrations stayed bounded (${lateDepenetrations} <= 2)`,
  lateDepenetrations <= 2);

e.destroy();

console.log('\nmixed long and short bodies settle without visible shimmer');
const mixedCols = 320, mixedRows = 230, mixedFloorY = mixedRows - 3;
const mixed = createEngineWasm({
  cols: mixedCols,
  rows: mixedRows,
  worldSeed: 0x51A7,
  sinksOn: false,
});
const mixedStoneRect = (x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      mixed.paintDisc(x, y, 0, STONE, true);
};
mixedStoneRect(0, mixedFloorY, mixedCols - 1, mixedRows - 1);
mixedStoneRect(18, mixedRows - 150, 22, mixedFloorY - 1);
mixedStoneRect(mixedCols - 23, mixedRows - 150,
  mixedCols - 19, mixedFloorY - 1);
mixed.syncComponents();

let mixedRandomState = 0x51A7;
const mixedRandom = () => {
  mixedRandomState = (mixedRandomState * 1103515245 + 12345) & 0x7fffffff;
  return mixedRandomState / 0x7fffffff;
};
const mixedRandomInt = (a, b) =>
  a + ((mixedRandom() * (b - a + 1)) | 0);
const mixedBody = (body) => {
  if (body % 3 !== 0) {
    const size = mixedRandomInt(3, 6);
    const x0 = mixedRandomInt(35, mixedCols - 35 - size);
    const y0 = mixedRandomInt(8, 45);
    const cells = [];
    for (let y = y0; y < y0 + size; y++)
      for (let x = x0; x < x0 + size; x++) cells.push([x, y]);
    return cells;
  }
  const length = mixedRandomInt(60, 100);
  const x0 = mixedRandomInt(35, mixedCols - 35 - length);
  let y = mixedRandomInt(8, 45);
  const cells = [];
  for (let x = x0; x < x0 + length; x++) {
    if (x > x0 && (x - x0) % 23 === 0) y++;
    if (x > x0 && (x - x0) % 37 === 0) y--;
    cells.push([x, y]);
  }
  return cells;
};

const mixedBodyCount = 36, mixedSteps = 1200;
let mixedSpawned = 0, mixedSettledAt = -1;
let mixedLatePeak = 0, mixedLateRejected = 0, mixedLateDepenetrations = 0;
for (let tick = 1; tick <= mixedSteps; tick++) {
  if (mixedSpawned < mixedBodyCount && tick % 4 === 0) {
    mixed.spawnBody(mixedBody(mixedSpawned));
    const body = mixed._bodyCount() - 1;
    mixed._setBodyMotion(body,
      (mixedRandom() - 0.5) * 0.8,
      mixedRandom() * 0.4,
      (mixedRandom() - 0.5) * 0.05);
    mixedSpawned++;
  }
  mixed.stepWorld();
  if (tick < 650) continue;
  const raster = mixed.getRigidDebug();
  mixedLateRejected = Math.max(mixedLateRejected, raster.rejectedCells);
  mixedLateDepenetrations = Math.max(
    mixedLateDepenetrations, raster.depenetrations);
  let awake = 0;
  for (let body = 0; body < mixed._bodyCount(); body++) {
    awake += mixed._bodyAwake(body) > 0;
    const state = mixed._bodyState(body);
    mixedLatePeak = Math.max(mixedLatePeak,
      Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR);
  }
  if (awake === 0 && mixedSettledAt < 0) mixedSettledAt = tick;
}

let mixedFinalAwake = 0;
for (let body = 0; body < mixed._bodyCount(); body++)
  mixedFinalAwake += mixed._bodyAwake(body) > 0;
check(`mixed pile slept by tick 1000 (tick ${mixedSettledAt})`,
  mixedSettledAt >= 0 && mixedSettledAt <= 1000);
check(`mixed pile has no awake bodies (${mixedFinalAwake} == 0)`,
  mixedFinalAwake === 0);
check(`mixed pile late point motion stayed restrained `
    + `(${mixedLatePeak.toFixed(4)} <= 0.05)`,
  mixedLatePeak <= 0.05);
check(`mixed pile late raster conflicts stayed bounded `
    + `(${mixedLateRejected} <= 20)`,
  mixedLateRejected <= 20);
check(`mixed pile late terrain depenetrations stayed bounded `
    + `(${mixedLateDepenetrations} <= 2)`,
  mixedLateDepenetrations <= 2);
mixed.destroy();

if (failures) {
  console.error(`\n${failures} checks FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
