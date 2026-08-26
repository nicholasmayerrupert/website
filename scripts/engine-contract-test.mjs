// Engine-boundary regression coverage: active-layer postconditions and the
// role-specific lifecycle of cell-correlated ping-pong buffers.

import {
  createEngineWasm, initSandWasm, MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();

const { check, done } = makeChecker('engine boundary contracts');
const COLS = 128;
const ROWS = 96;
const make = (storageRole = 'full', infinite = false) => attachTestHooks(
  createEngineWasm({
    cols: COLS, rows: ROWS, storageRole, infinite,
    sinksOn: false, worldSeed: 0x51de,
  }),
);
const buffersValid = (engine) =>
  engine._layerBuffersValid(0) && engine._layerBuffersValid(1);
const sameState = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((value, index) => value === b[index]);
const gridFor = (engine, layer) => layer ? engine.getGridBg() : engine.getGrid();
const findMaterialCell = (engine, layer, material) => {
  const grid = gridFor(engine, layer);
  for (let cell = 0; cell < grid.length; cell++) if (grid[cell] === material) return cell;
  return -1;
};
const packedVelocityX = (packed) => {
  let component = packed & 0x7fff;
  if (component & 0x4000) component -= 0x8000;
  return component / 4096;
};
const velocityXAt = (engine, layer, cell) => cell < 0 ? 0
  : packedVelocityX(engine._liquidVelocityGrid(layer)[cell]);
const close = (actual, expected, tolerance = 1 / 4096) =>
  Math.abs(actual - expected) <= tolerance;

{
  const engine = make();
  const playerId = engine.spawnPlayer(32, 20);
  check('special-item ABI rejects ids before uint8 narrowing',
    [-1, Object.keys(ITEM_KIND).length, 255, 256, 261].every((itemKind) =>
      !engine.addSpecialItem(playerId, itemKind, 1)));
  engine.destroy();
}

for (const role of ['full', 'authority', 'presentation']) {
  const engine = make(role);
  check(`${role} allocation has a complete role-specific buffer layout`,
    buffersValid(engine));
  check(`${role} allocation leaves foreground active`, engine._activeLayer() === 0);
  if (role !== 'presentation') {
    engine.paintDiscLayer(0, 30, 20, 2, MAT.SAND, true);
    engine.paintDiscLayer(1, 70, 20, 2, MAT.WATER, true);
    engine.stepWorld();
    check(`${role} ping-pong swap keeps every cell buffer in one phase`,
      buffersValid(engine));
  }
  engine.destroy();
}

{
  const engine = make();
  engine.setBgEnabled(false);
  const x = 40, y = 16, source = y * COLS + x;
  engine.paintDisc(x, y, 0, MAT.WATER, true);
  engine._setLiquidVelocity(0, x, y, 1.75, -0.125);
  engine._fallSpeedGrid()[source] = 211;
  const seededState = engine._motionCellState(0, source);
  check('liquid velocity setup leaves an empty alternate phase state-free',
    seededState[2] !== 0 && seededState[3] === 0);
  engine.stepWorld();
  const destination = findMaterialCell(engine, 0, MAT.WATER);
  check('ordinary loose-cell MOVE carries opted-in liquid velocity',
    destination >= 0 && destination !== source
      && close(velocityXAt(engine, 0, destination), 1.75));
  check('ordinary MOVE resets a channel that does not opt into that operation',
    destination >= 0 && engine._fallSpeedGrid()[destination] !== 211);
  engine.destroy();
}

{
  const engine = make();
  engine.setBgEnabled(false);
  const x = 56, waterY = 62;
  for (let floorX = x - 3; floorX <= x + 3; floorX++)
    engine.paintDisc(floorX, waterY + 1, 0, MAT.STONE, true);
  engine.syncComponents();
  engine.paintDisc(x, waterY, 0, MAT.WATER, true);
  engine.paintDisc(x, waterY - 1, 0, MAT.BRINE, true);
  const source = waterY * COLS + x;
  const brineCell = (waterY - 1) * COLS + x;
  engine._setLiquidVelocity(0, x, waterY, 3, 0);
  const waterState = engine._motionCellState(0, source);
  const brineState = engine._motionCellState(0, brineCell);
  check('density SWAP starts with phase-compatible projected-liquid state',
    waterState[2] !== 0 && waterState[3] === 0
      && brineState[2] === 0 && brineState[3] === 0);
  engine.stepWorld();
  const destination = findMaterialCell(engine, 0, MAT.WATER);
  check('rigid-fluid density SWAP carries velocity through phase-safe writeback',
    destination >= 0 && destination !== source
      && velocityXAt(engine, 0, destination) > 2);
  engine.destroy();
}

{
  const engine = make();
  engine.setBgEnabled(true);
  const x = 68, y = 44;
  for (let floorX = x - 3; floorX <= x + 3; floorX++)
    engine.paintDiscLayer(0, floorX, y + 1, 0, MAT.STONE, true);
  engine.syncComponentsLayer(0);
  engine.paintDiscLayer(0, x, y, 0, MAT.WATER, true);
  engine._setLiquidVelocity(0, x, y, 3, 0);
  engine.stepWorld();
  const destination = findMaterialCell(engine, 1, MAT.WATER);
  check('CROSS_LAYER transfer carries opted-in liquid velocity',
    findMaterialCell(engine, 0, MAT.WATER) < 0 && destination >= 0
      && velocityXAt(engine, 1, destination) > 2.5);
  engine.destroy();
}

{
  const engine = make();
  engine.setBgEnabled(false);
  const x = 72, y = 48, source = y * COLS + x;
  engine.paintDisc(x, y, 0, MAT.WATER, true);
  engine._setLiquidVelocity(0, x, y, 1.5, -0.25);
  const before = engine._liquidVelocityGrid()[source];
  engine._spawnBoxLayer(0, x, y, 1, 1, MAT.STONE);
  const destination = findMaterialCell(engine, 0, MAT.WATER);
  check('BODY_DISPLACE carries liquid velocity through rigid spill relocation',
    before !== 0 && destination >= 0 && destination !== source
      && engine._liquidVelocityGrid()[destination] === before);
  engine.destroy();
}

{
  const engine = make();
  engine.setBgEnabled(false);
  const x = 84, y = 52, cell = y * COLS + x;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (ox === 0 && oy === 0) continue;
    engine.paintDisc(x + ox, y + oy, 0,
      ox === -1 && oy === 0 ? MAT.NEUTRONIUM : MAT.STONE, true);
  }
  engine.syncComponents();
  engine.paintDisc(x, y, 0, MAT.WATER, true);
  engine._setLiquidVelocity(0, x, y, 1.25, 0.25);
  engine.stepWorld();
  check('FORCE_PARK applies the declared reset policy to liquid velocity',
    engine.getGrid()[cell] === MAT.WATER
      && engine._liquidVelocityGrid()[cell] === 0);
  engine.destroy();
}

{
  const engine = make('full', true);
  const verifyRoundTrip = (label, x, y, dx, dy, value) => {
    const cell = y * COLS + x;
    for (const layer of [0, 1]) {
      engine.paintDiscLayer(layer, x, y, 0, MAT.WATER, true);
      engine._setMotionSentinel(layer, cell, value);
    }
    const before = [0, 1].map((layer) => engine._motionCellState(layer, cell));
    engine.shiftWorldXY(dx, dy);
    engine.shiftWorldXY(-dx, -dy);
    const after = [0, 1].map((layer) => engine._motionCellState(layer, cell));
    check(`${label} stream-out/store/restore retains every channel and both phases`,
      before.every((state, layer) => sameState(state, after[layer])));
  };
  verifyRoundTrip('horizontal', 12, 48, 32, 0, 0x12345678);
  verifyRoundTrip('vertical', 72, 12, 0, 32, 0x34567812);

  const x = 60;
  const y = 52;
  const cell = y * COLS + x;
  const oldWorldX = engine.getWorldOffsetX() + x;
  const oldWorldY = engine.getWorldOffsetY() + y;
  for (const layer of [0, 1]) {
    engine.paintDiscLayer(layer, x, y, 0, MAT.WATER, true);
    engine._setMotionSentinel(layer, cell, 0x23456712);
  }
  const beforeResize = [0, 1].map((layer) => engine._motionCellState(layer, cell));
  check('loaded-window resize succeeds for lifecycle preservation',
    engine.resizeLoadedWindow(160, 128));
  const resizedX = oldWorldX - engine.getWorldOffsetX();
  const resizedY = oldWorldY - engine.getWorldOffsetY();
  const resizedCell = resizedY * 160 + resizedX;
  const afterResize = [0, 1].map((layer) =>
    engine._motionCellState(layer, resizedCell));
  check('resize overlap retains every channel and both phases',
    beforeResize.every((state, layer) => sameState(state, afterResize[layer])));
  engine.destroy();
}

{
  const engine = make('full', true);
  engine.paintDiscLayer(1, 40, 30, 1, MAT.STONE, true);
  check('background paint restores the foreground ABI postcondition',
    engine._activeLayer() === 0);
  engine.syncComponentsLayer(1);
  check('background component sync restores the foreground ABI postcondition',
    engine._activeLayer() === 0);
  engine.renderFullLayer(1);
  check('background render restores the foreground ABI postcondition',
    engine._activeLayer() === 0);
  engine.worldIsCaveAt(1, 0, 100);
  check('background world query restores the foreground ABI postcondition',
    engine._activeLayer() === 0);
  engine._spawnBoxLayer(1, 60, 20, 2, 2, MAT.STONE);
  check('background body spawn restores the foreground ABI postcondition',
    engine._activeLayer() === 0);
  engine.eraseDiscLayer(1, 40, 30, 1);
  check('background erase restores the foreground ABI postcondition',
    engine._activeLayer() === 0);

  engine.shiftWorldXY(32, 0);
  check('stream shift preserves cell-buffer layout and foreground postcondition',
    buffersValid(engine) && engine._activeLayer() === 0);
  check('loaded-window resize succeeds', engine.resizeLoadedWindow(160, 128));
  check('simulation resize reallocates every registered cell buffer',
    buffersValid(engine) && engine._activeLayer() === 0);
  engine.destroy();
}

{
  const engine = make();
  const x = 42, y = 34, cell = y * COLS + x;
  for (const layer of [0, 1]) {
    engine.paintDiscLayer(layer, x, y, 0, MAT.WATER, true);
    engine._setMotionSentinel(layer, cell, 0x32547618 + layer);
  }
  const cleared = [0, 1].map((layer) =>
    engine.eraseDiscLayer(layer, x, y, 0));
  check('shared erase/mining destruction clears every channel in both phases',
    cleared.every(Boolean)
      && gridFor(engine, 0)[cell] === MAT.EMPTY
      && gridFor(engine, 1)[cell] === MAT.EMPTY
      && engine._motionCellZero(0, cell)
      && engine._motionCellZero(1, cell));
  engine.destroy();
}

{
  const authority = make('authority', true);
  const mirror = make('presentation', true);
  check('presentation full snapshot applies', mirror.applyWorldMirror(
    authority.serializeWorld(),
    authority.getWorldOffsetX(), authority.getWorldOffsetY(),
  ));
  check('presentation snapshot keeps its read-only buffer profile',
    buffersValid(mirror) && mirror._activeLayer() === 0);
  authority.resetDirty();
  authority.paintDiscLayer(1, 32, 24, 1, MAT.SAND, true);
  check('presentation diff applies', mirror.applyDiffMirror(authority.serializeDiff()));
  check('presentation diff keeps simulation side buffers unallocated',
    buffersValid(mirror) && mirror._activeLayer() === 0);
  check('presentation resize succeeds', mirror.resizeLoadedWindow(160, 128));
  check('presentation resize rebuilds only its render buffer profile',
    buffersValid(mirror) && mirror._activeLayer() === 0);
  authority.destroy();
  mirror.destroy();
}

const failures = done();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
