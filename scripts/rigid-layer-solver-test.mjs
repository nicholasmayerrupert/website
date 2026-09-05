// Layer-local collision masks share dynamics only when the engine creates a
// joint body. Equal body IDs in different layers are independent identities.
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('world rigid layer ownership');
const cols = 180, rows = 180;
const create = () => {
  const engine = attachTestHooks(createEngineWasm({ cols, rows, worldSeed: 17, sinksOn: false }));
  engine.setBgEnabled(true);
  return engine;
};
const rect = (x0, y0, x1, y1) => {
  const cells = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return cells;
};
{
  const engine = create();
  engine._spawnBoxLayer(0, 90, 35, 4, 4, MAT.RIGID);
  engine._spawnBoxLayer(1, 90, 35, 4, 4, MAT.RIGID);
  check('fixture reuses the same numeric ID in separate layers',
    engine._bodyIdLayer(0, 0) === engine._bodyIdLayer(1, 0));
  let contacts = 0;
  for (let tick = 0; tick < 20; tick++) {
    engine.stepWorld();
    contacts += engine.getRigidSolverDebug().contacts;
  }
  const fg = engine._bodyStateLayer(0, 0), bg = engine._bodyStateLayer(1, 0);
  check('overlapping unrelated layers generate no contacts', contacts === 0);
  check(`both bodies advance equally under gravity (${fg.py}/${bg.py}, ${fg.vy}/${bg.vy})`,
    fg.py > 40 && Math.abs(fg.py - bg.py) < 1e-9
      && Math.abs(fg.vy - bg.vy) < 1e-9);
  engine.destroy();
}
for (const obstacle of ['terrain', 'body']) {
  const engine = create();
  const masks = [rect(40, 35, 75, 39), rect(40, 35, 44, 70)];
  for (let layer = 0; layer < 2; layer++) {
    const grid = layer ? engine.getGridBg() : engine.getGrid();
    for (const [x, y] of masks[layer].slice(1)) grid[y * cols + x] = MAT.BRICK;
    engine.syncComponentsLayer(layer);
  }
  for (let layer = 0; layer < 2; layer++) {
    const [x, y] = masks[layer][0];
    engine.paintDiscLayer(layer, x, y, 0, MAT.BRICK, true);
  }
  engine.stepWorld();
  check('asymmetric fixture creates a joint object',
    engine._bodyJointRoleLayer(0, 0) === 1 && engine._bodyJointRoleLayer(1, 0) === 2);
  // Background obstacles intersect only the foreground arm's silhouette.
  if (obstacle === 'terrain') {
    const bgGrid = engine.getGridBg();
    for (const [x, y] of rect(60, 46, 70, rows - 1)) bgGrid[y * cols + x] = MAT.STONE;
    engine.syncComponentsLayer(1);
  } else {
    engine._spawnBoxLayer(1, 64, 38, 3, 3, MAT.RIGID);
  }
  const before = engine._bodyStateLayer(0, 0);
  let contacts = 0, terrain = 0;
  for (let tick = 0; tick < 20; tick++) {
    engine.stepWorld();
    contacts += engine.getRigidSolverDebug().contacts;
    terrain = Math.max(terrain, engine._bodyTerrainBlockedLayer(0, 0),
      engine._bodyTerrainBlockedLayer(1, 0));
  }
  const after = engine._bodyStateLayer(0, 0);
  check(`a foreground-only arm passes a background ${obstacle} without contact`, contacts === 0);
  check(`the joint keeps falling through the other layer’s empty mask (${after.py - before.py}, angle ${after.angle - before.angle})`,
    after.py - before.py > 5 && Math.abs(after.angle - before.angle) < 1e-9);
  check('each physical layer remains clear of its own terrain', terrain === 0);
  engine.destroy();
}
process.exitCode = done();
