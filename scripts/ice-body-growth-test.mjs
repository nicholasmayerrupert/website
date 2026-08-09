import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT, MATERIALS } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100, SEED = 0xC0FFEE;
const { check, done } = makeChecker('rigid ice growth stays attached');

await initSandWasm();
const createEngine = () => attachTestHooks(createEngineWasmRaw({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false,
}));
const step = (engine, count) => {
  for (let i = 1; i <= count; i++) engine.step(i * 16);
};
const close = (actual, expected, tolerance = 1e-9) =>
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
const iceOwnership = (engine, layer) => {
  const grid = layer ? engine.getGridBg() : engine.getGrid();
  const owners = engine._bodyOwnerGrid(layer);
  let cells = 0, ownerless = 0;
  const bodyIds = new Set();
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== MAT.ICE) continue;
    cells++;
    if (owners[k] < 0) ownerless++;
    else bodyIds.add(owners[k]);
  }
  return { cells, ownerless, bodyIds };
};

{
  const engine = createEngine();
  engine.setBgEnabled(false);
  engine._spawnBoxLayer(0, 60, 52, 2, 2, MAT.ICE);
  const waterX = 62, waterY = 51;
  engine.paintDisc(waterX, waterY, 0, MAT.WATER, true);
  const waterVx = 0.25, waterVy = -0.125;
  engine._setLiquidVelocity(0, waterX, waterY, waterVx, waterVy);
  engine._setBodyMotion(0, 1.25, -0.4, 0.13);
  const before = engine._bodyState(0);
  const bodyMass = 1 / before.invMass;
  const waterMass = MATERIALS[MAT.WATER].density;
  const bodyMomentumX = bodyMass * before.vx;
  const bodyMomentumY = bodyMass * before.vy;
  const momentumX = bodyMomentumX + waterMass * waterVx;
  const momentumY = bodyMomentumY + waterMass * waterVy;
  const angularMomentum = before.omega / before.invInertia
    + before.px * bodyMomentumY - before.py * bodyMomentumX
    + (waterX + 0.5) * waterMass * waterVy
    - (waterY + 0.5) * waterMass * waterVx;

  engine._freezeBodyCell(0, 0, 0, waterX, waterY);
  const after = engine._bodyState(0);
  const afterMass = 1 / after.invMass;
  const afterMomentumX = afterMass * after.vx;
  const afterMomentumY = afterMass * after.vy;
  const afterAngularMomentum = after.omega / after.invInertia
    + after.px * afterMomentumY - after.py * afterMomentumX;
  check('direct ice accretion adds the adjacent water cell',
    after.nPts === before.nPts + 1);
  check('ice accretion conserves linear momentum',
    close(afterMomentumX, momentumX) && close(afterMomentumY, momentumY));
  check('ice accretion conserves angular momentum',
    close(afterAngularMomentum, angularMomentum));
  engine.destroy();
}

// A settled static boundary keeps retrying its probabilistic freeze reaction.
{
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(false);
  for (let y = 82; y < ROWS; y++)
    for (let x = 45; x <= 75; x++)
      engine.paintDisc(x, y, 0, MAT.STONE, true);
  engine.paintDisc(62, 81, 0, MAT.STONE, true);
  engine.syncComponents();
  engine.paintDisc(60, 81, 0, MAT.ICE, true);
  engine.syncComponents();
  engine.paintDisc(61, 81, 0, MAT.WATER, true);
  const firstStepActive = engine.stepWorld();
  check('settled ice/water boundary survives an unsuccessful freeze roll',
    firstStepActive && engine.getGrid()[81 * COLS + 61] === MAT.WATER);
  for (let tick = 1; tick < 500; tick++) engine.stepWorld();
  let ice = 0;
  for (const material of engine.getGrid()) if (material === MAT.ICE) ice++;
  check('settled ice/water boundary retries until water freezes', ice >= 2);
  engine.destroy();
}

{
  const engine = createEngine();
  engine.setBgEnabled(false);
  for (let y = 15; y < 90; y++) for (let x = 10; x < 110; x++)
    engine.paintDisc(x, y, 0, MAT.WATER, true);
  engine._spawnBoxLayer(0, 60, 52, 4, 4, MAT.ICE);
  engine._setBodyMotion(0, 0, 0, 0.04);
  step(engine, 80);

  const ice = iceOwnership(engine, 0);
  const body = engine._bodyState(0);
  check('same-layer freezing enlarges the rotating source body',
    engine._bodyCount() === 1 && body?.nPts > 64 && Math.abs(body.angle) > 0.05);
  check('same-layer growth creates no detached ice',
    ice.ownerless === 0 && ice.bodyIds.size === 1);
  engine.destroy();
}

{
  const engine = createEngine();
  engine.setBgEnabled(false);
  for (let x = 5; x < 115; x++)
    for (let y = 82; y < ROWS; y++)
      engine.paintDisc(x, y, 0, MAT.STONE, true);
  engine.syncComponents();
  for (let y = 68; y < 82; y++)
    for (let x = 15; x < 105; x++)
      engine.paintDisc(x, y, 0, MAT.WATER, true);

  engine._spawnBoxLayer(0, 60, 74, 4, 2, MAT.ICE);
  engine._setBodyMotion(0, 0, 0, 0.025);
  let maxDepenetrations = 0;
  let peakIceCells = 0;
  let previousBodyCells = 0;
  let lastGrowthTick = -1;
  let bakeTick = -1;
  for (let tick = 0; tick < 300; tick++) {
    engine.stepWorld();
    maxDepenetrations = Math.max(maxDepenetrations,
      engine.getRigidDebug().depenetrations);
    peakIceCells = Math.max(peakIceCells,
      iceOwnership(engine, 0).cells);
    const body = engine._bodyState(0);
    if (body?.nPts > previousBodyCells) lastGrowthTick = tick;
    if (body) previousBodyCells = body.nPts;
    else if (bakeTick < 0) bakeTick = tick;
  }

  check(`rotated grounded ice accretes without terrain depenetration `
      + `(${maxDepenetrations} corrections)`,
    peakIceCells > 32 && maxDepenetrations === 0);
  check('supported ice bakes while its freezing boundary is active',
    engine._bodyCount() === 0 && bakeTick >= 0
      && bakeTick - lastGrowthTick <= 20
      && iceOwnership(engine, 0).ownerless === peakIceCells);
  engine.destroy();
}

{
  const engine = createEngine();
  engine.setBgEnabled(true);
  for (let y = 15; y < ROWS; y++)
    for (let x = 45; x < 75; x++)
      engine.paintDiscLayer(1, x, y, 0, MAT.WATER, true);
  for (let y = 15; y < ROWS; y++)
    engine.paintDiscLayer(1, 60, y, 0, MAT.STONE, true);
  engine.syncComponentsLayer(1);
  engine._spawnBoxLayer(0, 60, 52, 4, 4, MAT.ICE);
  step(engine, 20);

  check('cross-layer accretion does not promote through blocking terrain',
    engine._bodyCountLayer(0) === 1 && engine._bodyCountLayer(1) === 0
      && engine._bodyJointRoleLayer(0, 0) === 0
      && iceOwnership(engine, 1).cells === 0);
  engine.destroy();
}

for (const sourceLayer of [0, 1]) {
  const targetLayer = 1 - sourceLayer;
  const engine = createEngine();
  engine.setBgEnabled(true);
  for (let y = 15; y < 90; y++) for (let x = 10; x < 110; x++)
    engine.paintDiscLayer(targetLayer, x, y, 0, MAT.WATER, true);
  engine._spawnBoxLayer(sourceLayer, 60, 52, 4, 4, MAT.ICE);
  step(engine, 80);

  const sourceIce = iceOwnership(engine, sourceLayer);
  const targetIce = iceOwnership(engine, targetLayer);
  const fgId = engine._bodyIdLayer(0, 0);
  const bgId = engine._bodyIdLayer(1, 0);
  check(`layer ${sourceLayer} body promotes to one shared-pose body`,
    engine._bodyCountLayer(0) === 1 && engine._bodyCountLayer(1) === 1
      && engine._bodyJointRoleLayer(0, 0) === 1
      && engine._bodyJointRoleLayer(1, 0) === 2
      && fgId === bgId);
  check(`layer ${sourceLayer} cross-layer growth remains body-owned`,
    targetIce.cells > 0 && sourceIce.ownerless === 0 && targetIce.ownerless === 0
      && sourceIce.bodyIds.size === 1 && targetIce.bodyIds.size === 1);
  engine.destroy();
}

process.exitCode = done() ? 1 : 0;
