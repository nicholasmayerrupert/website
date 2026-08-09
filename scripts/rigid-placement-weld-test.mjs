// Structural placement must weld to the physical two-layer rigid it overlaps,
// even when the active layer has no stamped body cell at the placement point.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 132;
const ROWS = 96;
const close = (actual, expected, tolerance = 1e-9) =>
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
const momentum = (state) => {
  const mass = 1 / state.invMass;
  const px = mass * state.vx;
  const py = mass * state.vy;
  return {
    px,
    py,
    angular: state.omega / state.invInertia
      + state.px * py - state.py * px,
  };
};

await initSandWasm();
const { check, done } = makeChecker('rigid placement weld');

const createScene = () => {
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: 0x77656c64,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(true);
  for (let y = 24; y <= 43; y++) {
    for (let x = 18; x <= 55; x++)
      engine.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    for (let x = 52; x <= 110; x++)
      engine.paintDiscLayer(1, x, y, 0, MAT.BRICK, true);
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();
  return engine;
};

const findBackgroundOnlyBodyCell = (engine) => {
  const foregroundOwners = engine._bodyOwnerGrid(0);
  const backgroundOwners = engine._bodyOwnerGrid(1);
  const foreground = engine.getGrid();
  for (let y = 27; y <= 40; y++) for (let x = 70; x <= 104; x++) {
    const k = y * COLS + x;
    if (backgroundOwners[k] < 0 || foreground[k] !== MAT.EMPTY) continue;
    let foregroundBodyNearby = false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (foregroundOwners[(y + oy) * COLS + x + ox] >= 0)
        foregroundBodyNearby = true;
    }
    if (!foregroundBodyNearby) return { x, y };
  }
  return null;
};

const findForegroundOnlyBodyCell = (engine) => {
  const foregroundOwners = engine._bodyOwnerGrid(0);
  const backgroundOwners = engine._bodyOwnerGrid(1);
  const background = engine.getGridBg();
  for (let y = 27; y <= 40; y++) for (let x = 22; x <= 48; x++) {
    const k = y * COLS + x;
    if (foregroundOwners[k] < 0 || background[k] !== MAT.EMPTY) continue;
    let backgroundBodyNearby = false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (backgroundOwners[(y + oy) * COLS + x + ox] >= 0)
        backgroundBodyNearby = true;
    }
    if (!backgroundBodyNearby) return { x, y };
  }
  return null;
};

{
  const engine = createScene();
  const target = findBackgroundOnlyBodyCell(engine);
  check('scene creates one detached joint body',
    engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 1
      && engine._bodyJointRoleLayer(0, 0) === 1
      && engine._bodyJointRoleLayer(1, 0) === 2);
  check('scene exposes a background-only part of the joint', target !== null);
  if (target) {
    check('TNT placement succeeds',
      engine.placeMaterial(target.x, target.y, 0, MAT.TNT, 0));
    check('overlapping placement remains one physical joint',
      engine._bodyCountLayer(0) === 1
        && engine._bodyCountLayer(1) === 1
        && engine._bodyJointRoleLayer(0, 0) === 1
        && engine._bodyJointRoleLayer(1, 0) === 2);
    const k = target.y * COLS + target.x;
    check('placed TNT belongs to the foreground joint body',
      engine.getGrid()[k] === MAT.TNT && engine._bodyOwnerGrid(0)[k] >= 0);
  }
  engine.destroy();
}

{
  const engine = createScene();
  const target = findForegroundOnlyBodyCell(engine);
  check('follower-fuse scene exposes a foreground-only joint cell', target !== null);
  if (target) {
    const placed = engine.placeMaterial(target.x, target.y, 0, MAT.TNT, 1);
    const targetCell = target.y * COLS + target.x;
    check('background-only TNT welds onto the non-TNT leader\'s follower',
      placed
        && engine.getGrid()[targetCell] !== MAT.TNT
        && engine.getGridBg()[targetCell] === MAT.TNT
        && engine._bodyOwnerGrid(1)[targetCell] >= 0);
    const background = engine.getGridBg();
    const findTnt = () => {
      for (let k = 0; k < background.length; k++) {
        if (background[k] === MAT.TNT)
          return { x: k % COLS, y: Math.floor(k / COLS) };
      }
      return null;
    };
    let detonated = false;
    for (let tick = 0; tick < 45; tick++) {
      const tnt = findTnt();
      if (!tnt) { detonated = true; break; }
      engine.placeMaterial(tnt.x + 1, tnt.y, 0, MAT.FIRE, 1);
      engine.stepWorld();
    }
    check('TNT ignited on the follower detonates through the physical leader',
      detonated);
  }
  engine.destroy();
}

{
  const engine = createScene();
  const target = findBackgroundOnlyBodyCell(engine);
  check('static-contact scene exposes a background-only joint cell', target !== null);
  if (target) {
    for (let y = target.y; y < ROWS; y++)
      engine.paintDiscLayer(0, target.x - 1, y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(0);
    check('TNT beside static structure still places',
      engine.placeMaterial(target.x, target.y, 0, MAT.TNT, 0));
    const k = target.y * COLS + target.x;
    check('static contact anchors the placed TNT',
      engine.getGrid()[k] === MAT.TNT && engine._bodyOwnerGrid(0)[k] < 0);
    check('static contact immediately bakes the touched joint',
      engine._bodyCountLayer(0) === 0 && engine._bodyCountLayer(1) === 0);
    engine.stepWorld();
    check('anchored TNT and both rigid layers remain static',
      engine.getGrid()[k] === MAT.TNT
        && engine._bodyCountLayer(0) === 0
        && engine._bodyCountLayer(1) === 0);
  }
  engine.destroy();
}

{
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: 0x6d6f6d65,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(false);
  engine._spawnBoxLayer(0, 50, 45, 3, 2, MAT.RIGID);
  engine._setBodyMotion(0, 1.2, -0.35, 0.11);
  const before = momentum(engine._bodyState(0));
  check('single-layer moving-body weld places adjacent TNT',
    engine.placeMaterial(53, 45, 0, MAT.TNT, 0));
  const afterState = engine._bodyState(0);
  const after = afterState ? momentum(afterState) : null;
  check('single-layer placement weld stays one moving body',
    engine._bodyCount() === 1 && afterState !== null);
  check('single-layer placement weld conserves linear momentum',
    after && close(after.px, before.px) && close(after.py, before.py));
  check('single-layer placement weld conserves angular momentum',
    after && close(after.angular, before.angular));
  engine.destroy();
}

{
  const engine = createScene();
  const target = findBackgroundOnlyBodyCell(engine);
  check('moving-joint scene exposes a background-only weld target', target !== null);
  if (target) {
    engine._setBodyMotion(0, -0.8, 0.45, -0.075);
    const before = momentum(engine._bodyStateLayer(0, 0));
    check('moving joint accepts a foreground placement on its peer raster',
      engine.placeMaterial(target.x, target.y, 0, MAT.TNT, 0));
    const afterState = engine._bodyStateLayer(0, 0);
    const after = afterState ? momentum(afterState) : null;
    check('joint placement weld conserves linear momentum',
      after && close(after.px, before.px) && close(after.py, before.py));
    check('joint placement weld conserves angular momentum',
      after && close(after.angular, before.angular));
  }
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
