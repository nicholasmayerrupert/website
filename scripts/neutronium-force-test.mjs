// Neutronium aggregates into spatial force emitters that attract powders,
// liquids, and free rigid bodies without applying its own force to its body.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { MATERIALS } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 180, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const createEngineWasm = () => attachTestHooks(createEngineWasmRaw({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
}));
const { check, done } = makeChecker('neutronium spatial forces');

const material = MATERIALS.find((entry) => entry.name === 'NEUTRONIUM');
check('neutronium has stable id 50', MAT.NEUTRONIUM === 50 && material?.id === 50);
check(`neutronium is ultra-dense (${material?.density})`, material?.density === 32);

const paintRect = (engine, x0, y0, x1, y1, mat) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) engine.paintDisc(x, y, 0, mat, true);
  }
};
const paintRectLayer = (engine, layer, x0, y0, x1, y1, mat) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) engine.paintDiscLayer(layer, x, y, 0, mat, true);
  }
};
const firstCellIn = (grid, mat) => {
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] === mat) return { x: k % COLS, y: Math.floor(k / COLS) };
  }
  return null;
};
const firstCell = (engine, mat) => {
  return firstCellIn(engine.getGrid(), mat);
};
const countMaterial = (engine, mat) =>
  [...engine.getGrid()].filter((value) => value === mat).length;

// A source with no affected material keeps the cellular world asleep.
{
  const engine = createEngineWasm();
  paintRect(engine, 0, 100, COLS - 1, ROWS - 1, MAT.STONE);
  engine.paintDisc(90, 99, 2, MAT.NEUTRONIUM, true);
  engine.syncComponents();
  engine.resetDirty();
  check('an isolated source does not keep the world active', engine.stepWorld() === false);
  engine.destroy();
}

// A grounded source draws resting loose cells horizontally, against their
// ordinary gravity-only movement rules.
{
  const engine = createEngineWasm();
  const floorY = 100, sourceX = 90, looseY = floorY - 1;
  paintRect(engine, 0, floorY, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, 0, looseY - 1, COLS - 1, looseY - 1, MAT.STONE);
  engine.paintDisc(sourceX, looseY, 2, MAT.NEUTRONIUM, true);
  engine.paintDisc(40, looseY, 0, MAT.SAND, true);
  engine.paintDisc(140, looseY, 0, MAT.WATER, true);
  engine.syncComponents();
  for (let i = 0; i < 40; i++) engine.stepWorld();
  const sand = firstCell(engine, MAT.SAND);
  const water = firstCell(engine, MAT.WATER);
  check(`sand is pulled right (${sand?.x})`, sand?.x >= 46);
  check(`water is pulled left (${water?.x})`, water?.x <= 134);
  check('loose material is conserved',
    countMaterial(engine, MAT.SAND) === 1
      && countMaterial(engine, MAT.WATER) === 1);
  engine.destroy();
}

// Neutronium in either layer pulls loose material in the other layer.
for (const [sourceLayer, targetLayer, label] of [
  [0, 1, 'foreground neutronium pulls background material'],
  [1, 0, 'background neutronium pulls foreground material'],
]) {
  const engine = createEngineWasm();
  engine.setBgEnabled(true);
  const floorY = 100, sourceX = 90, looseY = floorY - 1;
  paintRectLayer(engine, sourceLayer, 0, floorY, COLS - 1, ROWS - 1, MAT.STONE);
  paintRectLayer(engine, targetLayer, 0, floorY, COLS - 1, ROWS - 1, MAT.STONE);
  paintRectLayer(engine, targetLayer, 0, looseY - 1, COLS - 1, looseY - 1, MAT.STONE);
  engine.paintDiscLayer(sourceLayer, sourceX, looseY, 2, MAT.NEUTRONIUM, true);
  engine.paintDiscLayer(targetLayer, 40, looseY, 0, MAT.SAND, true);
  engine.paintDiscLayer(targetLayer, 140, looseY, 0, MAT.WATER, true);
  engine.syncComponentsLayer(sourceLayer);
  engine.syncComponentsLayer(targetLayer);
  for (let i = 0; i < 40; i++) engine.stepWorld();
  const grid = targetLayer ? engine.getGridBg() : engine.getGrid();
  const sand = firstCellIn(grid, MAT.SAND);
  const water = firstCellIn(grid, MAT.WATER);
  check(`${label}: sand moves right (${sand?.x})`, sand?.x >= 46);
  check(`${label}: water moves left (${water?.x})`, water?.x <= 134);
  engine.destroy();
}

// Persistent gas is repelled across layers before its normal buoyant movement.
for (const [sourceLayer, targetLayer, label] of [
  [0, 1, 'foreground neutronium repels background gas'],
  [1, 0, 'background neutronium repels foreground gas'],
]) {
  const engine = createEngineWasm();
  engine.setBgEnabled(true);
  const floorY = 100, sourceX = 90, gasY = floorY - 1;
  for (const layer of [sourceLayer, targetLayer]) {
    paintRectLayer(engine, layer, 0, floorY, COLS - 1, ROWS - 1, MAT.STONE);
    paintRectLayer(engine, layer, 0, gasY - 1, COLS - 1, gasY - 1, MAT.STONE);
  }
  engine.paintDiscLayer(sourceLayer, sourceX, gasY, 2, MAT.NEUTRONIUM, true);
  engine.paintDiscLayer(targetLayer, 55, gasY, 0, MAT.METHANE, true);
  engine.syncComponentsLayer(sourceLayer);
  engine.syncComponentsLayer(targetLayer);
  for (let i = 0; i < 40; i++) engine.stepWorld();
  const grid = targetLayer ? engine.getGridBg() : engine.getGrid();
  const methane = firstCellIn(grid, MAT.METHANE);
  check(`${label} (${methane?.x})`, methane?.x <= 49);
  engine.destroy();
}

// Free bodies receive continuous acceleration and wake through the same field.
// Only neutronium cells contribute to a mixed component's force centroid.
{
  const engine = createEngineWasm();
  const floorY = 112, sourceX = 115, sourceY = 68;
  paintRect(engine, 0, floorY, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, sourceX, sourceY + 3, sourceX, floorY - 1, MAT.STONE);
  engine.paintDisc(sourceX, sourceY, 2, MAT.NEUTRONIUM, true);
  engine.syncComponents();
  engine.spawnBox(90, sourceY, 2, 2, MAT.RIGID);
  const before = engine._bodyState(0);
  for (let i = 0; i < 12; i++) engine.stepWorld();
  const after = engine._bodyState(0);
  check(`rigid body moves toward neutronium (${before?.px.toFixed(2)} -> ${after?.px.toFixed(2)})`,
    after && before && after.px > before.px + 2);
  check(`rigid body has rightward velocity (${after?.vx.toFixed(3)})`, after?.vx > 0.1);
  engine.destroy();
}

// Moving sources and targets can occupy different layers with the same body id.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(true);
  engine._spawnBoxLayer(0, 115, 55, 2, 2, MAT.NEUTRONIUM);
  engine._spawnBoxLayer(1, 90, 55, 2, 2, MAT.RIGID);
  const sourceBefore = engine._bodyStateLayer(0, 0);
  const targetBefore = engine._bodyStateLayer(1, 0);
  for (let i = 0; i < 12; i++) engine.stepWorld();
  const sourceAfter = engine._bodyStateLayer(0, 0);
  const targetAfter = engine._bodyStateLayer(1, 0);
  check('cross-layer rigid is pulled by a neutronium body with the same body id',
    targetBefore && targetAfter && targetAfter.px > targetBefore.px + 2);
  check('moving neutronium still excludes its own force',
    sourceBefore && sourceAfter && Math.abs(sourceAfter.px - sourceBefore.px) < 1e-9);
  engine.destroy();
}

// A neutronium body is excluded from its own emitter.
{
  const engine = createEngineWasm();
  engine.spawnBox(70, 20, 2, 2, MAT.NEUTRONIUM);
  const before = engine._bodyState(0);
  for (let i = 0; i < 8; i++) engine.stepWorld();
  const after = engine._bodyState(0);
  check('a neutronium body does not self-accelerate horizontally',
    before && after && Math.abs(after.px - before.px) < 1e-9
      && Math.abs(after.vx) < 1e-9);
  check('the self-excluded body still obeys world gravity', after?.py > before?.py);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
