// Long contact patches must settle without rocking, rotating endpoints must use
// continuous collision, and blast-damaged cross-layer assemblies retain their
// shared pose while their projected structural union remains connected.

import { initSandWasm, createEngineWasm as createEngineWasmRaw, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const createEngineWasm = (options) => attachTestHooks(createEngineWasmRaw(options));
const { check, done } = makeChecker('large and cross-layer rigid bodies');

const rectangle = (x0, y0, x1, y1) => {
  const cells = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return cells;
};
const lShape = (x0, y0, size, thickness) => {
  const cells = [];
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++)
      if (x < x0 + thickness || y >= y0 + size - thickness)
        cells.push([x, y]);
  return cells;
};
const staticRectangle = (engine, layer, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDiscLayer(layer, x, y, 0, material, true);
};
const speed = (state) =>
  state ? Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR : Infinity;

{
  const cols = 420, rows = 260, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0x1a2b, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  engine.syncComponentsLayer(0);
  engine.spawnBody(rectangle(70, floorY - 8, 349, floorY - 3));
  for (let i = 0; i < 180; i++) engine.stepWorld();
  engine.spawnBody(rectangle(90, 70, 329, 73));

  let sleptAt = -1, latePeak = 0, maxRejected = 0, maxDepenetrations = 0;
  let maxBlockSolves = 0;
  for (let i = 0; i < 1200; i++) {
    engine.stepWorld();
    const lower = engine._bodyState(0);
    const upper = engine._bodyState(1);
    if (i >= 500) latePeak = Math.max(latePeak, speed(lower), speed(upper));
    const diagnostics = engine.getRigidDebug();
    const solver = engine.getRigidSolverDebug();
    maxBlockSolves = Math.max(maxBlockSolves, solver.blockSolves);
    maxRejected = Math.max(maxRejected, diagnostics.rejectedCells);
    maxDepenetrations = Math.max(maxDepenetrations, diagnostics.depenetrations);
    if (!engine._bodyAwake(0) && !engine._bodyAwake(1)) {
      sleptAt = i;
      break;
    }
  }
  const lower = engine._bodyState(0);
  const upper = engine._bodyState(1);
  check(`280-cell support and 240-cell beam remain separate (${upper?.py.toFixed(2)} < ${lower?.py.toFixed(2)})`,
    !!lower && !!upper && upper.py < lower.py - 3);
  check(`long stacked beams sleep (${sleptAt} < 1200)`, sleptAt >= 0);
  check(`long contact has restrained late motion (${latePeak.toFixed(4)} <= 0.03)`,
    latePeak <= 0.03);
  check(`long contact avoids raster phasing (${maxRejected} rejected, ${maxDepenetrations} depenetrations)`,
    maxRejected <= 4 && maxDepenetrations <= 1);
  check(`long manifold used coupled endpoint solves (${maxBlockSolves} > 0)`,
    maxBlockSolves > 0);
  engine.spawnBody(rectangle(10, 20, 15, 25));
  engine._setBodyMotion(2, 3, 0, 0.4);
  engine.stepWorld();
  const islandWork = engine.getRigidSolverDebug();
  check(`isolated fast body does not substep sleeping beams (${islandWork.islandBodySteps} < ${islandWork.globalBodySteps})`,
    islandWork.islandBodySteps < islandWork.globalBodySteps);
  engine.destroy();
}

{
  const cols = 420, rows = 300, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0x9876, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  engine.syncComponentsLayer(0);
  const localPoints = [];
  for (let body = 0; body < 10; body++) {
    const cells = [];
    let y = 250 - body * 18;
    for (let i = 0; i < 120; i++) {
      if (i > 0 && i % 23 === 0) y++;
      if (i > 0 && i % 37 === 0) y--;
      cells.push([70 + (body % 2) * 60 + i, y]);
    }
    const cx = cells.reduce((sum, cell) => sum + cell[0] + 0.5, 0) / cells.length;
    const cy = cells.reduce((sum, cell) => sum + cell[1] + 0.5, 0) / cells.length;
    localPoints.push(cells.map(([x, cellY]) => [x + 0.5 - cx, cellY + 0.5 - cy]));
    engine.spawnBody(cells);
  }
  for (let i = 0; i < 1400; i++) engine.stepWorld();
  const finalStates = localPoints.map((_, body) => engine._bodyState(body));
  const childCounts = localPoints.map((_, body) => engine._bodyChildCount(body));
  const worldPoints = localPoints.map((points, body) => {
    const state = finalStates[body];
    const cs = Math.cos(state.angle), sn = Math.sin(state.angle);
    return points.map(([x, y]) => [
      state.px + x * cs - y * sn,
      state.py + x * sn + y * cs,
    ]);
  });
  const deepOverlapThreshold = 0.4;
  let deepOverlaps = 0, minimumDistance = Infinity, minimumPair = '';
  for (let a = 0; a < worldPoints.length; a++) {
    for (let b = a + 1; b < worldPoints.length; b++) {
      let pairDistance2 = Infinity;
      for (const first of worldPoints[a]) {
        for (const second of worldPoints[b]) {
          const dx = first[0] - second[0], dy = first[1] - second[1];
          pairDistance2 = Math.min(pairDistance2, dx * dx + dy * dy);
        }
      }
      const pairDistance = Math.sqrt(pairDistance2);
      if (pairDistance < minimumDistance) {
        minimumDistance = pairDistance;
        minimumPair = `${a}/${b}`;
      }
      if (pairDistance < deepOverlapThreshold) deepOverlaps++;
    }
  }
  const [minimumA, minimumB] = minimumPair.split('/').map(Number);
  check(`staggered jagged beams do not phase through one another `
      + `(${deepOverlaps} overlaps < ${deepOverlapThreshold}, `
      + `minimum ${minimumDistance.toFixed(3)} `
      + `at ${minimumPair}, angles ${finalStates[minimumA].angle.toFixed(3)}/`
      + `${finalStates[minimumB].angle.toFixed(3)}, children `
      + `${childCounts[minimumA]}/${childCounts[minimumB]})`,
    deepOverlaps === 0);
  engine.destroy();
}

{
  const cols = 420, rows = 280, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0xb987, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  engine.syncComponentsLayer(0);

  const lower = [], upper = [];
  for (let x = 70; x < 350; x++) {
    lower.push([x, 250]);
    upper.push([x, 180]);
  }
  for (let y = 240; y < 250; y++) lower.push([70, y]);
  for (let y = 181; y <= 190; y++) upper.push([349, y]);
  const toLocalPoints = (cells) => {
    const cx = cells.reduce((sum, cell) => sum + cell[0] + 0.5, 0) / cells.length;
    const cy = cells.reduce((sum, cell) => sum + cell[1] + 0.5, 0) / cells.length;
    return cells.map(([x, y]) => [x + 0.5 - cx, y + 0.5 - cy]);
  };
  const localPoints = [toLocalPoints(lower), toLocalPoints(upper)];
  engine.spawnBody(lower);
  for (let i = 0; i < 180; i++) engine.stepWorld();
  engine.spawnBody(upper);
  for (let i = 0; i < 300; i++) engine.stepWorld();

  const worldPoints = localPoints.map((points, body) => {
    const state = engine._bodyState(body);
    const cs = Math.cos(state.angle), sn = Math.sin(state.angle);
    return points.map(([x, y]) => [
      state.px + x * cs - y * sn,
      state.py + x * sn + y * cs,
    ]);
  });
  let minimumDistance2 = Infinity;
  for (const first of worldPoints[0]) {
    for (const second of worldPoints[1]) {
      const dx = first[0] - second[0], dy = first[1] - second[1];
      minimumDistance2 = Math.min(minimumDistance2, dx * dx + dy * dy);
    }
  }
  const minimumDistance = Math.sqrt(minimumDistance2);
  check(`opposing sparse kinks make real contact (${minimumDistance.toFixed(3)} <= 1.5)`,
    minimumDistance <= 1.5);
  engine.destroy();
}

{
  const cols = 280, rows = 300, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0xd987, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  staticRectangle(engine, 0, 72, 220, 79, floorY - 1, MAT.STONE);
  staticRectangle(engine, 0, 180, 220, 187, floorY - 1, MAT.STONE);
  engine.syncComponentsLayer(0);

  engine.spawnBody(lShape(70, 100, 120, 8));
  for (let i = 0; i < 180; i++) engine.stepWorld();
  engine.spawnBody(rectangle(154, 120, 159, 125));
  for (let i = 0; i < 500; i++) engine.stepWorld();

  const dropped = engine._bodyState(1);
  check(`body dropped onto the remote arm of an 8x120 L stays above the deep floor `
      + `(y ${dropped?.py.toFixed(2)} < ${floorY - 20})`,
    !!dropped && dropped.py < floorY - 20);
  engine.destroy();
}

{
  const cols = 320, rows = 240, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0xc987, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  engine.syncComponentsLayer(0);
  engine.spawnBody(rectangle(40, 232, 280, 234));
  for (let i = 0; i < 150; i++) engine.stepWorld();

  const hanger = [];
  for (let x = 90; x <= 230; x++) hanger.push([x, 205]);
  for (let y = 206; y <= 231; y++) hanger.push([90, y]);
  engine.spawnBody(hanger);
  let maxAngle = 0, latePeak = 0;
  for (let i = 0; i < 500; i++) {
    engine.stepWorld();
    const state = engine._bodyState(1);
    maxAngle = Math.max(maxAngle, Math.abs(state.angle));
    if (i >= 200) latePeak = Math.max(latePeak, speed(state));
  }
  const final = engine._bodyState(1);
  check(`sparse hanger pivots on its occupied foot `
      + `(${maxAngle.toFixed(3)} rad, y ${final.py.toFixed(2)})`,
    maxAngle >= 0.15 && final.py >= 218);
  check(`sparse hanger settles without shaking `
      + `(awake ${engine._bodyAwake(1)}, late speed ${latePeak.toFixed(4)})`,
    engine._bodyAwake(1) === 0 && latePeak <= 0.03);
  engine.destroy();
}

{
  const cols = 420, rows = 280, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0xa987, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  staticRectangle(engine, 0, 55, 0, 59, floorY - 1, MAT.STONE);
  staticRectangle(engine, 0, 360, 0, 364, floorY - 1, MAT.STONE);
  staticRectangle(engine, 0, 55, 184, 69, floorY - 1, MAT.STONE);
  staticRectangle(engine, 0, 350, 184, 364, floorY - 1, MAT.STONE);
  engine.syncComponentsLayer(0);

  const smallBodies = 14;
  const spawnSmall = (body) => {
    const x = 78 + body * 20;
    engine.spawnBody(rectangle(x, 30, x + 2, 32));
  };
  for (let body = 0; body < smallBodies / 2; body++) spawnSmall(body);

  const beam = [];
  let beamY = 180;
  for (let x = 60; x < 360; x++) {
    if (x > 60 && x % 47 === 0) beamY++;
    if (x > 60 && x % 71 === 0) beamY--;
    beam.push([x, beamY]);
  }
  engine.spawnBody(beam);
  const beamIndex = smallBodies / 2;
  for (let i = 0; i < 180; i++) engine.stepWorld();

  for (let body = smallBodies / 2; body < smallBodies; body++)
    spawnSmall(body);
  for (let i = 0; i < 900; i++) engine.stepWorld();

  const finalBeam = engine._bodyState(beamIndex);
  let passedThrough = 0;
  for (let body = 0; body <= smallBodies; body++) {
    if (body === beamIndex) continue;
    const state = engine._bodyState(body);
    if (!state || state.py > finalBeam.py + 4) passedThrough++;
  }
  check(`small bodies remain above a long jagged body (${passedThrough} passed through)`,
    passedThrough === 0);
  engine.destroy();
}

{
  const cols = 420, rows = 260, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0x2b3c, sinksOn: false, infinite: false,
  });
  staticRectangle(engine, 0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  engine.syncComponentsLayer(0);
  engine.spawnBody(rectangle(294, 151, 301, floorY - 1));
  for (let i = 0; i < 140; i++) engine.stepWorld();
  const targetStart = engine._bodyState(0);
  engine.spawnBody(rectangle(80, 120, 299, 120));
  engine._setBodyMotion(1, 0, 0, 0.03);
  let maxTargetMotion = 0, maxDepenetrations = 0;
  for (let i = 0; i < 45; i++) {
    engine.stepWorld();
    const target = engine._bodyState(0);
    maxTargetMotion = Math.max(maxTargetMotion,
      Math.hypot(target.px - targetStart.px, target.py - targetStart.py)
        + Math.abs(target.angle - targetStart.angle));
    maxDepenetrations = Math.max(
      maxDepenetrations, engine.getRigidDebug().depenetrations);
  }
  check(`220-cell rotating endpoint transfers its impact (${maxTargetMotion.toFixed(3)} > 0.02)`,
    maxTargetMotion > 0.02);
  check(`rotating long-body CCD avoids raster fallback (${maxDepenetrations} <= 1)`,
    maxDepenetrations <= 1);
  engine.destroy();
}

{
  const cols = 160, rows = 180, floorY = rows - 3;
  const engine = createEngineWasm({
    cols, rows, worldSeed: 0x3c4d, sinksOn: false, infinite: false,
  });
  engine.setBgEnabled(true);
  for (const layer of [0, 1])
    staticRectangle(engine, layer, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  staticRectangle(engine, 0, 25, 30, 80, 59, MAT.BRICK);
  staticRectangle(engine, 1, 80, 30, 135, 59, MAT.CLAY);
  for (const layer of [0, 1])
    staticRectangle(engine, layer, 78, 60, 82, floorY - 1, MAT.BRICK);
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();
  for (const layer of [0, 1]) {
    staticRectangle(engine, layer, 74, 60, 86, floorY - 1, MAT.EMPTY);
    engine.syncComponentsLayer(layer);
  }
  engine.stepWorld();

  const findRole = (layer, role) => {
    for (let i = 0; i < engine._bodyCountLayer(layer); i++)
      if (engine._bodyJointRoleLayer(layer, i) === role) return i;
    return -1;
  };
  check('adjacent-layer structure initially detaches as one joint body',
    findRole(0, 1) >= 0 && findRole(1, 2) >= 0);

  for (let y = 30; y <= 59; y++)
    engine.paintDiscLayer(0, 80, y, 0, MAT.EMPTY, true);
  engine.stepWorld();
  let leader = findRole(0, 1), follower = findRole(1, 2);
  check('removing exact overlap keeps projected adjacent layers bonded',
    leader >= 0 && follower >= 0);

  engine._detonateTnt(38, 42);
  let locked = true, moved = false;
  const startY = engine._bodyStateLayer(0, findRole(0, 1))?.py ?? Infinity;
  for (let i = 0; i < 40; i++) {
    engine.stepWorld();
    leader = findRole(0, 1);
    follower = findRole(1, 2);
    const fg = engine._bodyStateLayer(0, leader);
    const bg = engine._bodyStateLayer(1, follower);
    if (!fg || !bg) {
      locked = false;
      break;
    }
    moved ||= fg.py > startY + 0.5;
    if (Math.abs(fg.px - bg.px) > 1e-9
        || Math.abs(fg.py - bg.py) > 1e-9
        || Math.abs(fg.angle - bg.angle) > 1e-9) {
      locked = false;
      break;
    }
  }
  check('TNT-damaged adjacent layers retain one moving pose', locked && moved);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
