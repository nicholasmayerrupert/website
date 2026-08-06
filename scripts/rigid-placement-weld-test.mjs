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
  const target = findBackgroundOnlyBodyCell(engine);
  check('static-contact scene exposes a background-only joint cell', target !== null);
  if (target) {
    engine.paintDiscLayer(0, target.x - 1, target.y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(0);
    check('TNT beside static structure still places',
      engine.placeMaterial(target.x, target.y, 0, MAT.TNT, 0));
    const k = target.y * COLS + target.x;
    check('body overlap takes precedence over static registration',
      engine.getGrid()[k] === MAT.TNT && engine._bodyOwnerGrid(0)[k] >= 0);
    check('static-adjacent placement remains one physical joint',
      engine._bodyCountLayer(0) === 1 && engine._bodyCountLayer(1) === 1);
  }
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
