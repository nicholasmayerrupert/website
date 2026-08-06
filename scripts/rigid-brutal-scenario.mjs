import { MAT } from '../src/sand/materials.js';
import { buildCrossLayerSliverScene } from './rigid-sliver-scenario.mjs';

export const BRUTAL_RIGID_SCENE = Object.freeze({
  cols: 768,
  rows: 384,
  seed: 0xB407A1,
  centerX: 384,
  collisionY: 314,
});

const irregularShapes = [
  [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2], [3, 2]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [3, 1], [3, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [3, 2], [4, 2]],
  [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2], [3, 2], [3, 3]],
];

const countMaterial = (grid, material) => {
  let count = 0;
  for (const cell of grid) if (cell === material) count++;
  return count;
};

const countBodies = (engine) => {
  let jointPrimaries = 0;
  let compoundChildren = 0;
  let maxChildren = 0;
  for (let body = 0; body < engine._bodyCountLayer(0); body++) {
    if (engine._bodyJointRoleLayer(0, body) === 1) jointPrimaries++;
    const children = Math.max(0, engine._bodyChildCount(body));
    compoundChildren += children;
    maxChildren = Math.max(maxChildren, children);
  }
  return {
    foreground: engine._bodyCountLayer(0),
    background: engine._bodyCountLayer(1),
    jointPrimaries,
    compoundChildren,
    maxChildren,
  };
};

const addIrregularBodies = (engine) => {
  for (let i = 0; i < 72; i++) {
    const shape = irregularShapes[i % irregularShapes.length];
    const x = 222 + (i % 12) * 29 + ((i * 7) % 3);
    const y = 164 + Math.floor(i / 12) * 18 + ((i * 11) % 3);
    engine.spawnBody(shape.map(([dx, dy]) => [x + dx, y + dy]));
  }
};

const addNeutroniumBodies = (engine) => {
  for (let layer = 0; layer < 2; layer++) {
    const count = layer ? 24 : 32;
    for (let i = 0; i < count; i++) {
      const x = 252 + (i % 8) * 38 + layer * 7 + ((i * 13) % 5);
      const y = 260 + Math.floor(i / 8) * 25 + layer * 5;
      const half = 1 + (i % 3);
      engine._spawnBoxLayer(layer, x, y, half, half, MAT.NEUTRONIUM);
    }
  }
};

const addWater = (engine) => {
  const pools = [
    [270, 230, 29], [330, 248, 31], [392, 229, 28], [454, 250, 31],
    [514, 232, 29], [300, 302, 27], [360, 320, 28], [426, 304, 29],
    [486, 321, 27],
  ];
  for (let layer = 0; layer < 2; layer++) {
    for (const [x, y, radius] of pools)
      engine.paintDiscLayer(layer, x + layer * 5, y, radius, MAT.WATER, false);
  }
};

const driveForegroundBodies = (engine) => {
  const { centerX, collisionY } = BRUTAL_RIGID_SCENE;
  for (let body = 0; body < engine._bodyCountLayer(0); body++) {
    const state = engine._bodyStateLayer(0, body);
    if (!state) continue;
    const vx = Math.max(-2.4, Math.min(2.4,
      (centerX - state.px) * 0.011)) + ((body * 17) % 7 - 3) * 0.055;
    const vy = Math.max(-0.4, Math.min(2.2,
      (collisionY - state.py) * 0.009)) + (body % 5) * 0.035;
    const omega = ((body * 23) % 13 - 6) * 0.0035;
    engine._setBodyMotion(body, vx, vy, omega);
  }
};

export function buildBrutalRigidScene(engine) {
  const { cols, rows, centerX } = BRUTAL_RIGID_SCENE;
  const floorY = rows - 5;
  buildCrossLayerSliverScene(engine, {
    left: 124,
    right: 644,
    top: 18,
    bottom: 145,
    floorY,
    sourceX: centerX,
    sourceY: 342,
    cutSpacing: 9,
    backgroundCutOffset: 1,
  });

  // Blast-carved sliver edges exercise the compound hierarchy with the same
  // concave fragments and rubble produced by destructive play.
  for (const [x, y] of [
    [218, 68], [320, 116], [448, 70], [558, 116],
  ]) engine._detonateTnt(x, y);

  addIrregularBodies(engine);
  addNeutroniumBodies(engine);
  addWater(engine);
  driveForegroundBodies(engine);

  return {
    cols,
    rows,
    bodies: countBodies(engine),
    waterCells: countMaterial(engine.getGrid(), MAT.WATER)
      + countMaterial(engine.getGridBg(), MAT.WATER),
    neutroniumCells: countMaterial(engine.getGrid(), MAT.NEUTRONIUM)
      + countMaterial(engine.getGridBg(), MAT.NEUTRONIUM),
  };
}
