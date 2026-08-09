// Blast pressure is integrated over a body's exposed raster so response
// depends on mass and hit geometry, including edge-only and off-centre hits.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('rigid blast impulse');

const makeEngine = () => {
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: 180,
    rows: 120,
    worldSeed: 0xB1A57,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(false);
  return engine;
};

const squareImpulse = (halfSize, power = 20) => {
  const engine = makeEngine();
  engine.spawnBox(80, 60, halfSize, halfSize, MAT.RIGID);
  const before = engine._bodyState(0);
  engine._applyBlastImpulse(0, 70, 60, 22, power);
  const after = engine._bodyState(0);
  engine.destroy();
  return {
    speed: Math.hypot(after.vx, after.vy),
    momentum: Math.hypot(after.vx, after.vy) / before.invMass,
  };
};

const framedSquareImpulse = (filled) => {
  const engine = makeEngine();
  const cells = [];
  for (let y = 50; y <= 70; y++) for (let x = 70; x <= 90; x++) {
    if (filled || x === 70 || x === 90 || y === 50 || y === 70)
      cells.push([x, y]);
  }
  engine.spawnBody(cells);
  const before = engine._bodyState(0);
  engine._applyBlastImpulse(0, 45, 60, 80, 20);
  const after = engine._bodyState(0);
  const momentum = Math.hypot(after.vx, after.vy) / before.invMass;
  engine.destroy();
  return momentum;
};

{
  const small = squareImpulse(1);
  const large = squareImpulse(4);
  check(`larger mass accelerates less (${small.speed.toFixed(5)} > ${large.speed.toFixed(5)})`,
    small.speed > large.speed * 1.25);
  check(`larger exposed surface receives more total impulse (${large.momentum.toFixed(5)} > ${small.momentum.toFixed(5)})`,
    large.momentum > small.momentum);
}

{
  const frame = framedSquareImpulse(false);
  const solid = framedSquareImpulse(true);
  check(`equal exposed outlines receive equal impulse despite different filled area (${frame.toFixed(5)} vs ${solid.toFixed(5)})`,
    Math.abs(frame - solid) < 1e-6);
}

{
  const low = squareImpulse(2, 10);
  const high = squareImpulse(2, 20);
  check(`blast power scales rigid impulse (${low.speed.toFixed(5)} -> ${high.speed.toFixed(5)})`,
    Math.abs(high.speed / low.speed - 2) < 1e-9);
}

{
  const engine = makeEngine();
  engine.spawnBox(80, 60, 12, 2, MAT.RIGID);
  const before = engine._bodyState(0);
  engine._applyBlastImpulse(0, 54, 60, 16, 20);
  const after = engine._bodyState(0);
  check(`wave catches a body edge outside its COM radius (COM distance ${(before.px - 54).toFixed(2)}, vx ${after.vx.toFixed(5)})`,
    before.px - 54 > 16 && after.vx > 1e-5);
  engine.destroy();
}

{
  const engine = makeEngine();
  engine.spawnBox(100, 60, 2, 8, MAT.RIGID);
  engine._applyBlastImpulse(0, 88, 50, 24, 20);
  const body = engine._bodyState(0);
  check(`off-centre pressure produces torque (omega ${body.omega.toFixed(6)})`,
    Math.abs(body.omega) > 1e-4);
  engine.destroy();
}

{
  const engine = makeEngine();
  engine.setBgEnabled(true);
  for (let y = 30; y <= 45; y++) {
    for (let x = 18; x <= 58; x++)
      engine.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    for (let x = 54; x <= 112; x++)
      engine.paintDiscLayer(1, x, y, 0, MAT.BRICK, true);
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();
  const joint = engine._bodyCountLayer(0) === 1
    && engine._bodyCountLayer(1) === 1
    && engine._bodyJointRoleLayer(0, 0) === 1
    && engine._bodyJointRoleLayer(1, 0) === 2;
  const before = engine._bodyStateLayer(0, 0);
  engine._applyBlastImpulse(0, 118, 38, 24, 20);
  const after = engine._bodyStateLayer(0, 0);
  check('cross-layer blast fixture creates one physical joint', joint);
  check(`pressure on a background-only joint edge reaches the leader (vx ${after?.vx.toFixed(5)})`,
    joint && before && after && after.vx < before.vx - 1e-5);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
