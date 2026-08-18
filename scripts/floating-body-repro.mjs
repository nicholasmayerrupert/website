// Deterministic TNT/collision regression for a rigid body beside a wall after
// its supporting terrain is destroyed.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

await initSandWasm();

const COLS = 120;
const ROWS = 180;
const FLOOR_Y = ROWS - 3;
const BODY_X = 54;
const BODY_Y = 72;
const PLATFORM_Y = 80;
const BLAST_X = 54;
const BLAST_Y = 96;

const makeEngine = (wallX) => {
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: 1,
    sinksOn: false,
    infinite: false,
  }));
  const grid = engine.getGrid();
  for (let y = 1; y < ROWS; y++)
    grid[y * COLS + wallX] = MAT.NEUTRONIUM;
  for (let x = 50; x <= 57; x++)
    grid[PLATFORM_Y * COLS + x] = MAT.STONE;
  for (let y = PLATFORM_Y; y < ROWS; y++)
    grid[y * COLS + BLAST_X] = MAT.STONE;
  for (let x = 0; x < COLS; x++) {
    for (let y = FLOOR_Y; y < ROWS; y++)
      grid[y * COLS + x] = MAT.STONE;
  }
  engine.syncComponents();
  engine.stepWorld();
  engine.spawnBox(BODY_X, BODY_Y, 8, 8, MAT.RIGID);
  return engine;
};

const findBody = (engine, id) => {
  for (let index = 0; index < engine._bodyCountLayer(0); index++)
    if (engine._bodyIdLayer(0, index) === id) return index;
  return -1;
};

const directSupportCount = (engine, id) => {
  const owners = engine._bodyOwnerGrid(0);
  const grid = engine.getGrid();
  let count = 0;
  for (let k = 0; k < owners.length - COLS; k++) {
    if (owners[k] !== id || owners[k + COLS] === id) continue;
    if (owners[k + COLS] >= 0 || grid[k + COLS] !== MAT.EMPTY) count++;
  }
  return count;
};

const compactState = (state) => state && ({
  px: state.px,
  py: state.py,
  angle: state.angle,
  vx: state.vx,
  vy: state.vy,
  omega: state.omega,
  stillTicks: state.stillTicks,
  sleepSupports: state.sleepSupports,
  stampRecoveryTotal: state.stampRecoveryTotal,
});

const eraseWall = (engine, wallX) => {
  for (let y = 1; y < FLOOR_Y; y++)
    engine.paintDisc(wallX, y, 0, MAT.EMPTY, true);
  engine.syncComponents();
};

const runCase = (wallX, removeWallBeforeBlast = false) => {
  const engine = makeEngine(wallX);
  const bodyId = engine._bodyIdLayer(0, 0);
  let sleptAt = -1;
  for (let tick = 0; tick < 100; tick++) {
    engine.stepWorld();
    const index = findBody(engine, bodyId);
    if (index >= 0 && !engine._bodyAwakeLayer(0, index)) {
      sleptAt = tick;
      break;
    }
  }
  const before = engine._bodyStateLayer(0, findBody(engine, bodyId));
  if (removeWallBeforeBlast) eraseWall(engine, wallX);
  engine._detonateTnt(BLAST_X, BLAST_Y);

  let firstNoDirectSupport = -1;
  let wokeAt = -1;
  let resleptAt = -1;
  let directSupportAtResleep = -1;
  let firstUnsupportedSleep = -1;
  let unsupportedSleepTicks = 0;
  let maxStampRecoveryTotal = 0;
  let maxBodyOverlap = 0;
  let maxTerrainOverlap = 0;
  let maxPy = before.py;
  let after = null;
  for (let tick = 0; tick < 120; tick++) {
    engine.stepWorld();
    const index = findBody(engine, bodyId);
    if (index < 0) break;
    const state = engine._bodyStateLayer(0, index);
    const awake = engine._bodyAwakeLayer(0, index) > 0;
    const directSupport = directSupportCount(engine, bodyId);
    if (directSupport === 0 && firstNoDirectSupport < 0)
      firstNoDirectSupport = tick;
    if (awake && wokeAt < 0) wokeAt = tick;
    if (wokeAt >= 0 && !awake && resleptAt < 0) {
      resleptAt = tick;
      directSupportAtResleep = directSupport;
    }
    if (!awake && directSupport === 0) {
      if (firstUnsupportedSleep < 0) firstUnsupportedSleep = tick;
      unsupportedSleepTicks++;
    }
    maxStampRecoveryTotal = Math.max(
      maxStampRecoveryTotal, state.stampRecoveryTotal);
    maxBodyOverlap = Math.max(
      maxBodyOverlap, engine._bodyBlockedLayer(0, index));
    maxTerrainOverlap = Math.max(
      maxTerrainOverlap, engine._bodyTerrainBlockedLayer(0, index));
    maxPy = Math.max(maxPy, state.py);
    after = state;
  }

  const result = {
    wallX,
    bodyId,
    sleptAt,
    firstNoDirectSupport,
    wokeAt,
    resleptAt,
    directSupportAtResleep,
    firstUnsupportedSleep,
    unsupportedSleepTicks,
    maxDownwardTravel: maxPy - before.py,
    maxStampRecoveryTotal,
    maxBodyOverlap,
    maxTerrainOverlap,
    before: compactState(before),
    after: compactState(after),
  };
  engine.destroy();
  return result;
};

const reproduction = runCase(64);
const control = runCase(64, true);
const checks = {
  body_slept_before_blast: reproduction.sleptAt >= 0,
  tnt_removed_every_direct_support: reproduction.firstNoDirectSupport >= 0,
  body_woke_on_blast: reproduction.wokeAt === 0,
  body_never_slept_unsupported: reproduction.firstUnsupportedSleep < 0
    && reproduction.unsupportedSleepTicks === 0,
  wall_case_falls: reproduction.maxDownwardTravel > 20,
  wall_case_resleeps_on_real_support: reproduction.resleptAt >= 0
    && reproduction.directSupportAtResleep > 0,
  no_raster_recovery_or_overlap: reproduction.maxStampRecoveryTotal === 0
    && reproduction.maxBodyOverlap === 0
    && reproduction.maxTerrainOverlap === 0,
  no_wall_control_falls: control.maxDownwardTravel > 50,
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({
  ok,
  fixture: {
    seed: 1,
    body: [BODY_X, BODY_Y],
    platformY: PLATFORM_Y,
    blast: [BLAST_X, BLAST_Y],
    reproductionWallX: 64,
    controlWallRemovedBeforeBlast: true,
  },
  checks,
  reproduction,
  control,
}, null, 2));
process.exitCode = ok ? 0 : 1;
