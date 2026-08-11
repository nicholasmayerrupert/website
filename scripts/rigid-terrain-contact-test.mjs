// Large, terrain-carved masks must land on uneven ground without penetrating,
// persistent jitter, or raster damage.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('large rigid terrain contact');

const makeEngine = () => attachTestHooks(createEngineWasmRaw({
  cols: 480,
  rows: 340,
  worldSeed: 0x726f7567,
  sinksOn: false,
  infinite: false,
}));

const paintGround = (engine) => {
  for (let x = 0; x < 480; x++) {
    const wave = Math.round(3 * Math.sin(x * 0.12));
    const tooth = (x * 19 + 7) % 23 < 3 ? -2 : 0;
    const top = 292 + wave + tooth;
    for (let y = top; y < 340; y++)
      engine.paintDisc(x, y, 0, MAT.STONE, true);
  }
  engine.syncComponents();
};

const carvedBody = (centerX, topY, width = 230, height = 92) => {
  const cells = [];
  const left = centerX - Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const chamberA = ((x - width * 0.28) / (width * 0.18)) ** 2
        + ((y - height * 0.43) / (height * 0.28)) ** 2 < 1;
      const chamberB = ((x - width * 0.70) / (width * 0.21)) ** 2
        + ((y - height * 0.42) / (height * 0.25)) ** 2 < 1;
      const bottomNotch = y > height * 0.68
        && Math.abs(x - width * 0.5) < (y - height * 0.68) * 1.15;
      const scallop = y > height * 0.80
        && (x + Math.floor(y / 3)) % 29 < 9;
      if (!chamberA && !chamberB && !bottomNotch && !scallop)
        cells.push([left + x, topY + y]);
    }
  }
  return cells;
};

const runCase = (bodies) => {
  const engine = makeEngine();
  paintGround(engine);
  for (const body of bodies) {
    engine.spawnBody(carvedBody(body.x, body.y, body.width, body.height));
    engine._setBodyMotion(engine._bodyCount() - 1,
      body.vx ?? 0, body.vy ?? 0, body.omega ?? 0);
  }

  let firstContact = -1;
  let peakCells = 0;
  let peakChildren = 0;
  let maxTerrainBlocked = 0;
  let maxRejected = 0;
  let maxDepenetrations = 0;
  let latePeakSpeed = 0;
  let lateAwakeTicks = 0;
  let lateTerrainBlockedTicks = 0;
  for (let tick = 0; tick < 620; tick++) {
    engine.stepWorld();
    const rigid = engine.getRigidDebug();
    const solver = engine.getRigidSolverDebug();
    let terrainBlocked = 0;
    let speed = 0;
    let awake = 0;
    for (let body = 0; body < engine._bodyCount(); body++) {
      const state = engine._bodyState(body);
      peakCells = Math.max(peakCells, state?.nPts ?? 0);
      peakChildren = Math.max(peakChildren, engine._bodyChildCount(body));
      terrainBlocked += Math.max(0, engine._bodyTerrainBlocked(body));
      speed = Math.max(speed,
        Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR);
      awake += engine._bodyAwake(body) > 0;
    }
    if (firstContact < 0 && solver.contacts > 0) firstContact = tick;
    maxTerrainBlocked = Math.max(maxTerrainBlocked, terrainBlocked);
    maxRejected = Math.max(maxRejected, rigid.rejectedCells);
    maxDepenetrations = Math.max(maxDepenetrations, rigid.depenetrations);
    if (tick >= 430) {
      latePeakSpeed = Math.max(latePeakSpeed, speed);
      lateAwakeTicks += awake > 0;
      lateTerrainBlockedTicks += terrainBlocked > 0;
    }
  }
  engine.destroy();
  return {
    firstContact,
    peakCells,
    peakChildren,
    maxTerrainBlocked,
    maxRejected,
    maxDepenetrations,
    latePeakSpeed,
    lateAwakeTicks,
    lateTerrainBlockedTicks,
  };
};

const single = runCase([
  { x: 240, y: 45, vy: 0.4, omega: 0.006 },
]);
check(`12k-cell carved body uses detailed collision geometry `
    + `(${single.peakCells} cells, ${single.peakChildren} children)`,
  single.peakCells >= 12000 && single.peakChildren >= 180);
check(`single carved body reaches rough ground (tick ${single.firstContact})`,
  single.firstContact >= 0);
check(`single carved body has bounded raster reconciliation `
    + `(${single.maxTerrainBlocked} blocked, ${single.maxRejected} rejected, `
    + `${single.maxDepenetrations} depenetrations)`,
  single.maxTerrainBlocked === 0 && single.maxRejected === 0
    && single.maxDepenetrations <= 1 && single.lateTerrainBlockedTicks === 0);
check(`single carved body sleeps without late jitter `
    + `(${single.latePeakSpeed.toFixed(6)} peak, `
    + `${single.lateAwakeTicks} awake ticks)`,
  single.latePeakSpeed <= 0.001 && single.lateAwakeTicks === 0);

const pair = runCase([
  { x: 185, y: 30, width: 190, height: 76, vx: 0.08, omega: 0.005 },
  { x: 295, y: 112, width: 170, height: 70, vx: -0.06, omega: -0.006 },
]);
check(`two irregular bodies reach contact (tick ${pair.firstContact})`,
  pair.firstContact >= 0);
check(`interacting bodies have bounded raster reconciliation `
    + `(${pair.maxTerrainBlocked} blocked, ${pair.maxRejected} rejected, `
    + `${pair.maxDepenetrations} depenetrations)`,
  pair.maxTerrainBlocked <= 8 && pair.maxRejected <= 8
    && pair.maxDepenetrations <= 1 && pair.lateTerrainBlockedTicks === 0);
check(`interacting bodies settle without persistent jitter `
    + `(${pair.latePeakSpeed.toFixed(6)} peak, ${pair.lateAwakeTicks} awake ticks)`,
  pair.latePeakSpeed <= 0.001 && pair.lateAwakeTicks === 0);

{
  const cols = 480, rows = 340, floorY = 292;
  const engine = makeEngine();
  engine.setBgEnabled(true);
  for (let y = floorY; y < rows; y++)
    for (let x = 0; x < cols; x++)
      engine.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  engine.syncComponentsLayer(1);
  for (const [x, y] of carvedBody(240, 45)) {
    engine.paintDiscLayer(0, x, y, 0, MAT.BRICK, true);
    engine.paintDiscLayer(1, x, y, 0, MAT.IRON_ORE, true);
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();

  const findRole = (layer, role) => {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++)
      if (engine._bodyJointRoleLayer(layer, body) === role) return body;
    return -1;
  };
  let leader = findRole(0, 1);
  const follower = findRole(1, 2);
  check('large irregular assembly starts as one cross-layer body',
    leader >= 0 && follower >= 0);
  check('background follower excludes its own stamped raster from terrain',
    follower >= 0 && engine._bodyTerrainBlockedLayer(1, follower) === 0);
  if (leader >= 0) engine._setBodyMotion(leader, 0.12, 0.35, 0.006);

  let firstContact = -1;
  let maxTerrainBlocked = 0;
  let maxRejected = 0;
  let maxDepenetrations = 0;
  let maxBakedCells = 0;
  for (let tick = 0; tick < 620; tick++) {
    engine.stepWorld();
    const solver = engine.getRigidSolverDebug();
    const rigid = engine.getRigidDebug();
    if (firstContact < 0 && solver.contacts > 0) firstContact = tick;
    maxRejected = Math.max(maxRejected, rigid.rejectedCells);
    maxDepenetrations = Math.max(maxDepenetrations, rigid.depenetrations);
    maxBakedCells = Math.max(maxBakedCells, solver.rigidBakedCells);
    leader = findRole(0, 1);
    if (leader >= 0)
      maxTerrainBlocked = Math.max(maxTerrainBlocked,
        engine._bodyTerrainBlocked(leader));
  }
  check(`cross-layer body reaches background-only ground (tick ${firstContact})`,
    firstContact >= 0);
  check(`cross-layer body has bounded background raster reconciliation `
      + `(${maxTerrainBlocked} blocked, ${maxRejected} rejected, `
      + `${maxDepenetrations} depenetrations)`,
    maxTerrainBlocked === 0 && maxRejected === 0 && maxDepenetrations <= 1);
  check(`cross-layer body settles on background-only ground `
      + `(${maxBakedCells} baked cells)`,
    maxBakedCells >= 24000
      && engine._bodyCountLayer(0) === 0
      && engine._bodyCountLayer(1) === 0);
  engine.destroy();
}

{
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: 240,
    rows: 200,
    worldSeed: 29,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(true);
  for (let layer = 0; layer < 2; layer++) {
    for (let y = 175; y < 200; y++)
      for (let x = 0; x < 240; x++)
        engine.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(layer);
  }
  engine._spawnBoxLayer(1, 120, 150, 60, 2, MAT.RIGID);

  const shape = [];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 48; x++) {
      if (x < 4 || y >= 14 || (x > 18 && x < 23 && y > 3))
        shape.push([96 + x, 60 + y]);
    }
  }
  for (const [x, y] of shape) {
    engine.paintDiscLayer(0, x, y, 0, MAT.BRICK, true);
    engine.paintDiscLayer(1, x, y, 0, MAT.IRON_ORE, true);
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();

  const findRole = (layer, role) => {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++)
      if (engine._bodyJointRoleLayer(layer, body) === role) return body;
    return -1;
  };
  let leader = findRole(0, 1);
  const follower = findRole(1, 2);
  check('cross-layer irregular body starts above a rigid support',
    leader >= 0 && follower >= 0);

  let latePeakSpeed = 0;
  let latePeakCorrection = 0;
  for (let tick = 0; tick < 500; tick++) {
    engine.stepWorld();
    leader = findRole(0, 1);
    if (leader < 0) continue;
    const state = engine._bodyStateLayer(0, leader);
    const speed = Math.hypot(state.vx, state.vy)
      + Math.abs(state.omega) * state.maxR;
    const correction = Math.hypot(state.pvx, state.pvy, state.pw * state.maxR);
    if (tick >= 350) {
      latePeakSpeed = Math.max(latePeakSpeed, speed);
      latePeakCorrection = Math.max(latePeakCorrection, correction);
    }
  }
  check(`cross-layer body settles on another rigid without shaking `
      + `(${latePeakSpeed.toFixed(6)} speed, `
      + `${latePeakCorrection.toFixed(6)} correction)`,
    latePeakSpeed <= 0.25 && latePeakCorrection <= 0.25
      && engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 2);
  engine.destroy();
}

{
  const cols = 480, rows = 340, floorY = 292;
  const engine = makeEngine();
  engine.setBgEnabled(true);
  for (let x = 0; x < cols; x++) {
    const top = floorY + Math.round(3 * Math.sin(x * 0.12))
      + ((x * 19 + 7) % 23 < 3 ? -2 : 0);
    for (let y = top; y < rows; y++) {
      engine.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
      engine.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
    }
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);

  // The foreground contributes only a one-cell floor; the background carries
  // the large bonded structure and most of the joint body's mass.
  for (let x = 90; x <= 389; x++)
    engine.paintDiscLayer(0, x, 105, 0, MAT.BRICK, true);
  for (let y = 35; y <= 105; y++)
    for (let x = 90; x <= 389; x++)
      engine.paintDiscLayer(1, x, y, 0, MAT.CLAY, true);
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();

  const findLeader = () => {
    for (let body = 0; body < engine._bodyCountLayer(0); body++)
      if (engine._bodyJointRoleLayer(0, body) === 1) return body;
    return -1;
  };
  const leader = findLeader();
  check('thin-floor/background-heavy structure starts as one cross-layer body',
    leader >= 0);
  if (leader >= 0) engine._setBodyMotion(leader, -0.8, 0.5, 0.025);

  let firstContact = -1;
  let maxBlocked = 0;
  let maxRejected = 0;
  let maxDepenetrations = 0;
  for (let tick = 0; tick < 100; tick++) {
    engine.stepWorld();
    const solver = engine.getRigidSolverDebug();
    const rigid = engine.getRigidDebug();
    if (firstContact < 0 && solver.contacts > 0) firstContact = tick;
    const currentLeader = findLeader();
    if (currentLeader >= 0)
      maxBlocked = Math.max(maxBlocked, engine._bodyBlocked(currentLeader));
    maxRejected = Math.max(maxRejected, rigid.rejectedCells);
    maxDepenetrations = Math.max(maxDepenetrations, rigid.depenetrations);
  }
  check(`thin-floor/background-heavy body reaches rough ground (tick ${firstContact})`,
    firstContact >= 0);
  check(`thin-floor/background-heavy body never enters ground `
      + `(${maxBlocked} blocked, ${maxRejected} rejected, `
      + `${maxDepenetrations} depenetrations)`,
    maxBlocked === 0 && maxRejected === 0 && maxDepenetrations <= 1);
  engine.destroy();
}

process.exitCode = done();
