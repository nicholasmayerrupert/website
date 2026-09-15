// Buoyancy follows the force field through the same pressure solve for every material.
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('rigid spatial fluid pressure');
const SIZE = 180;
const run = (engine, steps) => {
  for (let step = 0; step < steps; step++) engine.stepWorld();
};
const waterAndIce = (engine) => {
  let count = 0;
  const grid = engine.getGrid(), owners = engine._bodyOwnerGrid();
  for (let k = 0; k < grid.length; k++)
    if (grid[k] === MAT.WATER || (grid[k] === MAT.ICE && owners[k] < 0)) count++;
  for (let body = 0; body < engine._bodyCount(); body++)
    if (engine._bodyMaterial(body) === MAT.ICE) count += engine._bodyState(body).nPts;
  return count;
};
const pool = (turn = 0, source = true, cols = SIZE) => {
  const engine = attachTestHooks(createEngineWasm({
    cols, rows: SIZE, worldSeed: 0x51A7E, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(false);
  const rotate = (x, y) => turn === 0 ? [x, y]
    : turn === 1 ? [SIZE - 1 - y, x]
      : turn === 2 ? [SIZE - 1 - x, SIZE - 1 - y] : [y, SIZE - 1 - x];
  const depth = (body) => turn === 0 ? body.py
    : turn === 1 ? SIZE - body.px : turn === 2 ? SIZE - body.py : body.px;
  const rect = (x0, y0, x1, y1, material) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      engine.paintDisc(...rotate(x, y), 0, material, true);
  };
  rect(0, 112, cols - 1, 179, MAT.STONE);
  rect(24, 0, 27, 179, MAT.STONE);
  rect(152, 0, 155, 179, MAT.STONE);
  rect(60, 106, 120, 111, source ? MAT.NEUTRONIUM : MAT.STONE);
  engine.syncComponents();
  rect(28, 48, 151, 105, MAT.WATER);
  run(engine, 100);
  return { engine, rotate, depth, rect };
};

for (const [turn, direction] of ['down', 'left', 'up', 'right'].entries()) {
  for (const [material, name, floats] of [
    [MAT.ICE, 'ice', true], [MAT.WOOD, 'wood', true], [MAT.STONE, 'stone', false],
  ]) {
    const { engine, rotate, depth } = pool(turn);
    engine.spawnBox(...rotate(90, 75), 4, 4, material);
    const start = depth(engine._bodyState(0));
    const volume = waterAndIce(engine);
    let end = start;
    for (let step = 0; step < 120; step++) {
      engine.stepWorld();
      const body = engine._bodyState(0);
      if (body) end = depth(body);
    }
    check(`${name} ${floats ? 'rises against' : 'sinks with'} ${direction} attraction (${start.toFixed(2)} -> ${end.toFixed(2)})`,
      floats ? !!engine._bodyState(0) && end < start - 1 : end > start + 12);
    check(`${name}/${direction} conserves water including frozen cells (${volume} -> ${waterAndIce(engine)})`, waterAndIce(engine) === volume);
    engine.destroy();
  }
}

{
  const { engine } = pool();
  engine.addDiscToIceDraft(90, 32, 6);
  engine.finalizeIceDraft();
  const volume = waterAndIce(engine);
  run(engine, 220);
  const body = engine._bodyState(0);
  check(`dropped ice stays above the neutronium bed (y ${body?.py.toFixed(2)})`,
    body && body.py < 80);
  check(`dropping and growing ice conserves water/ice volume (${volume} -> ${waterAndIce(engine)})`, waterAndIce(engine) === volume);
  engine.destroy();
}

{
  const control = pool(0, false, 380);
  const distant = pool(0, false, 380);
  distant.engine.paintDisc(300, 109, 3, MAT.NEUTRONIUM, true);
  distant.engine.syncComponents();
  for (const { engine } of [control, distant]) engine.spawnBox(90, 75, 4, 4, MAT.WOOD);
  let identical = true;
  for (let step = 0; step < 100; step++) {
    control.engine.stepWorld(); distant.engine.stepWorld();
    identical &&= JSON.stringify(control.engine._bodyState(0))
      === JSON.stringify(distant.engine._bodyState(0));
  }
  check('a distant emitter leaves ordinary pool motion exactly unchanged', identical);
  control.engine.destroy(); distant.engine.destroy();
}

{
  const { engine, rect } = pool();
  engine.spawnBox(90, 75, 4, 4, MAT.WOOD);
  run(engine, 60);
  rect(60, 106, 120, 111, MAT.STONE);
  engine.syncComponents();
  // Remove the supporting liquid to expose the restored planetary acceleration.
  const grid = engine.getGrid();
  for (let k = 0; k < grid.length; k++)
    if (grid[k] === MAT.WATER) engine.paintDisc(k % SIZE, (k / SIZE) | 0, 0, MAT.EMPTY, true);
  engine._setBodyMotion(0, 0, 0, 0);
  engine.stepWorld();
  const body = engine._bodyState(0);
  check(`removing the field restores ordinary gravity immediately (vy ${body?.vy})`,
    body && body.vy > 0.03 && body.vy <= 0.061);
  engine.destroy();
}

{
  const engine = attachTestHooks(createEngineWasm({
    cols: SIZE, rows: SIZE, worldSeed: 0x51A7E, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(false);
  const rect = (x0, y0, x1, y1, material) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
  };
  rect(0, 112, 179, 179, MAT.STONE);
  rect(24, 0, 27, 179, MAT.STONE);
  rect(152, 0, 155, 179, MAT.STONE);
  rect(60, 106, 120, 111, MAT.NEUTRONIUM);
  engine.syncComponents();
  const starts = [];
  for (let body = 0; body < 12; body++) {
    const y = 65 + Math.floor(body / 6) * 22;
    engine.spawnBox(44 + (body % 6) * 18, y, 3, 3, MAT.WOOD);
    starts.push(engine._bodyState(body).py);
  }
  const grid = engine.getGrid();
  for (let y = 48; y < 112; y++) for (let x = 28; x < 152; x++)
    if (grid[y * SIZE + x] === MAT.EMPTY) engine.paintDisc(x, y, 0, MAT.WATER, true);
  const volume = waterAndIce(engine);
  run(engine, 90);
  check('every body rises in a crowded spatial-force pool', starts.every((start, index) => {
    const body = engine._bodyState(index);
    return body && body.py < start - 1;
  }));
  check('crowded spatial-force pool conserves water', waterAndIce(engine) === volume);
  engine.destroy();
}

const failures = done();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
