import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
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
