// Neutronium aggregates into spatial force emitters that attract powders,
// liquids, and free rigid bodies without applying its own force to its body.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { MATERIALS } from '../src/sand/materials.generated.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
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
const materialStats = (engine, mat, centerX, centerY) => {
  const grid = engine.getGrid();
  let count = 0, sumRadius = 0, maxY = -1;
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== mat) continue;
    const x = k % COLS, y = Math.floor(k / COLS);
    count++;
    sumRadius += Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
    maxY = Math.max(maxY, y);
  }
  return { count, meanRadius: count ? sumRadius / count : 0, maxY };
};
const quadrantCounts = (engine, mat, centerX, centerY) => {
  const quadrants = [0, 0, 0, 0];
  const grid = engine.getGrid();
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== mat) continue;
    const x = k % COLS, y = Math.floor(k / COLS);
    const right = x >= centerX ? 1 : 0;
    const bottom = y >= centerY ? 2 : 0;
    quadrants[right + bottom]++;
  }
  return quadrants;
};
const runUntilIdle = (engine, limit) => {
  for (let step = 1; step <= limit; step++) {
    if (!engine.stepWorld()) return step;
  }
  return -1;
};
const createSuspendedSource = () => {
  const engine = createEngineWasm();
  const sourceX = 90, sourceY = 55;
  paintRect(engine, 0, 112, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, 124, sourceY, 126, 111, MAT.STONE);
  paintRect(engine, sourceX, sourceY, 126, sourceY + 2, MAT.STONE);
  engine.paintDisc(sourceX, sourceY, 5, MAT.NEUTRONIUM, true);
  engine.syncComponents();
  return { engine, sourceX, sourceY };
};
const createOpenSuspendedSource = () => {
  const engine = createEngineWasm();
  const sourceX = 90, sourceY = 55;
  paintRect(engine, 0, 112, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, sourceX, sourceY + 5, sourceX, 111, MAT.STONE);
  engine.paintDisc(sourceX, sourceY, 5, MAT.NEUTRONIUM, true);
  engine.syncComponents();
  return { engine, sourceX, sourceY };
};

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

// Loose force motion blends adjacent cell steps according to the exact force
// slope. Lava uses that same force cadence as other liquids, while gas uses the
// opposite weighted heading when neutronium repels it.
{
  const traceLiquid = (mat) => {
    const engine = createEngineWasm();
    paintRect(engine, 0, 102, COLS - 1, ROWS - 1, MAT.STONE);
    engine.paintDisc(110, 86, 15, MAT.NEUTRONIUM, true);
    engine.paintDisc(55, 101, 0, mat, true);
    engine.syncComponents();
    for (let i = 0; i < 4; i++) engine.stepWorld();
    const position = firstCell(engine, mat);
    engine.destroy();
    return position;
  };
  const water = traceLiquid(MAT.WATER);
  const lava = traceLiquid(MAT.LAVA);
  check(`shallow liquid attraction retains its vertical component (${water?.x},${water?.y})`,
    water?.x > 55 && water?.y < 101);
  check(`lava matches the ordinary-liquid force cadence (${lava?.x},${lava?.y})`,
    lava?.x === water?.x && lava?.y === water?.y);

  const engine = createEngineWasm();
  paintRect(engine, 0, 102, COLS - 1, ROWS - 1, MAT.STONE);
  engine.paintDisc(110, 86, 15, MAT.NEUTRONIUM, true);
  engine.paintDisc(55, 74, 0, MAT.METHANE, true);
  engine.syncComponents();
  for (let i = 0; i < 12; i++) engine.stepWorld();
  const methane = firstCell(engine, MAT.METHANE);
  check(`shallow gas repulsion retains its vertical component (${methane?.x},${methane?.y})`,
    methane?.x <= 45 && methane?.y < 74);
  engine.destroy();
}

// Material arriving from one direction spreads along force tangents once its
// inward path is pressure-blocked, allowing it to wrap around the source.
for (const [label, mat, limit] of [
  ['sand', MAT.SAND, 600],
  ['water', MAT.WATER, 600],
  ['lava', MAT.LAVA, 3000],
]) {
  const { engine, sourceX, sourceY } = createOpenSuspendedSource();
  engine.paintDisc(68, 33, 15, mat, true);
  const before = countMaterial(engine, mat);
  const idleAt = runUntilIdle(engine, limit);
  const quadrants = quadrantCounts(engine, mat, sourceX, sourceY);
  const minimumQuadrant = mat === MAT.SAND ? 10 : 38;
  check(`one-sided ${label} wraps around neutronium (${quadrants.join('/')})`,
    quadrants.every((count) => count >= minimumQuadrant));
  check(`one-sided radial flow conserves ${label}`,
    countMaterial(engine, mat) === before);
  check(`one-sided ${label} flow settles (${idleAt} steps)`,
    idleAt > 0 && idleAt <= limit && engine.stepWorld() === false);
  engine.destroy();
}

// Tangential powder movement uses the same density ordering as direct movement.
// A lighter liquid occupying the only supported tangent is displaced rather
// than acting like a wall to the powder stream.
{
  const { engine } = createSuspendedSource();
  paintRect(engine, 70, 54, 70, 111, MAT.STONE);
  engine.paintDisc(69, 55, 0, MAT.STONE, true);
  engine.paintDisc(69, 56, 0, MAT.STONE, true);
  engine.paintDisc(69, 54, 0, MAT.WATER, true);
  paintRect(engine, 29, 55, 68, 55, MAT.SAND);
  engine.syncComponents();
  engine.stepWorld();
  const grid = engine.getGrid();
  check('sand laterally displaces lighter water under neutronium pressure',
    grid[54 * COLS + 69] === MAT.SAND
      && grid[55 * COLS + 68] === MAT.WATER);
  check('tangential density displacement conserves sand and water',
    countMaterial(engine, MAT.SAND) === 40
      && countMaterial(engine, MAT.WATER) === 1);
  engine.destroy();
}

// Repelled transient gas keeps receiving decay ticks even after the field has
// packed it against an impermeable boundary.
{
  const { engine } = createSuspendedSource();
  paintRect(engine, 89, 74, 126, 76, MAT.STONE);
  engine.paintDisc(90, 75, 0, MAT.EMPTY, true);
  engine.paintDisc(90, 75, 0, MAT.STEAM, true);
  engine.syncComponents();
  const idleAt = runUntilIdle(engine, 400);
  check(`force-blocked transient gas decays before sleeping (${idleAt} steps)`,
    countMaterial(engine, MAT.STEAM) === 0
      && idleAt > 0 && idleAt <= 400 && engine.stepWorld() === false);
  engine.destroy();
}

// A suspended source owns loose-material settling in its strong field. Water
// gathers around it instead of leaking to the floor, then the static scene
// becomes inactive once no force-reducing cell move remains.
{
  const { engine, sourceX, sourceY } = createSuspendedSource();
  engine.paintDisc(sourceX, 41, 8, MAT.WATER, true);
  const before = countMaterial(engine, MAT.WATER);
  const idleAt = runUntilIdle(engine, 600);
  const held = materialStats(engine, MAT.WATER, sourceX, sourceY);
  check(`suspended neutronium holds water radially (max y ${held.maxY})`,
    held.count === before && held.maxY <= sourceY + 8);
  check(`a static neutronium-water scene settles (${idleAt} steps)`,
    idleAt > 0 && idleAt <= 600 && engine.stepWorld() === false);

  const neutroniumCells = [];
  const grid = engine.getGrid();
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] === MAT.NEUTRONIUM)
      neutroniumCells.push([k % COLS, Math.floor(k / COLS)]);
  }
  for (const [x, y] of neutroniumCells)
    engine.paintDisc(x, y, 0, MAT.EMPTY, true);
  engine.syncComponents();
  for (let i = 0; i < 40; i++) engine.stepWorld();
  const released = materialStats(engine, MAT.WATER, sourceX, sourceY);
  check(`removing neutronium releases held water (max y ${released.maxY})`,
    released.count === before && released.maxY > held.maxY + 12);
  engine.destroy();
}

// Mobile actors sample the same nearest-neutronium field once per actor tick.
// Player controls, hostile walking, and ambient flight retain their collision
// paths while the shared acceleration pulls each AABB toward the source.
{
  const { engine } = createSuspendedSource();
  const playerId = engine.spawnPlayer(55, 72);
  const enemyId = engine.spawnScriptedCreature(CREATURE.MINIGUNNER, 55, 82);
  const birdId = engine.spawnScriptedCreature(CREATURE.BIRD, 55, 68);
  engine.setCreatureRuntime(true, false);
  const playerBefore = engine.getPlayer(playerId);
  const creaturesBefore = engine.getCreatures();
  const enemyBefore = creaturesBefore.find((entry) => entry.id === enemyId);
  const birdBefore = creaturesBefore.find((entry) => entry.id === birdId);
  engine.stepWorld();
  for (let tick = 0; tick < 10; tick++) engine.stepActors();
  const playerAfter = engine.getPlayer(playerId);
  const creaturesAfter = engine.getCreatures();
  const enemyAfter = creaturesAfter.find((entry) => entry.id === enemyId);
  const birdAfter = creaturesAfter.find((entry) => entry.id === birdId);
  check(`neutronium pulls the player (${playerBefore?.x.toFixed(1)} -> ${playerAfter?.x.toFixed(1)})`,
    playerBefore && playerAfter && playerAfter.x > playerBefore.x + 4
      && playerAfter.vx > 0.2);
  check(`neutronium pulls a hostile enemy (${enemyBefore?.x.toFixed(1)} -> ${enemyAfter?.x.toFixed(1)})`,
    enemyBefore && enemyAfter && enemyAfter.x > enemyBefore.x + 3
      && enemyAfter.vx > 0.15);
  check(`neutronium pulls an ambient flying creature (${birdBefore?.x.toFixed(1)} -> ${birdAfter?.x.toFixed(1)})`,
    birdBefore && birdAfter && birdAfter.x > birdBefore.x + 3
      && birdAfter.vx > 0.15);
  engine.destroy();
}

// Radial density sorting places denser sand inside the water shell. Both
// materials remain conserved and the resulting static arrangement goes idle.
{
  const { engine, sourceX, sourceY } = createSuspendedSource();
  for (let y = 34; y <= 48; y++) {
    for (let x = 76; x <= 104; x++) {
      const mat = ((x + y) & 1) ? MAT.SAND : MAT.WATER;
      engine.paintDisc(x, y, 0, mat, true);
    }
  }
  const sandBefore = countMaterial(engine, MAT.SAND);
  const waterBefore = countMaterial(engine, MAT.WATER);
  const idleAt = runUntilIdle(engine, 320);
  const sand = materialStats(engine, MAT.SAND, sourceX, sourceY);
  const water = materialStats(engine, MAT.WATER, sourceX, sourceY);
  check(`sand sorts inside water (${sand.meanRadius.toFixed(2)} < ${water.meanRadius.toFixed(2)})`,
    sand.meanRadius < water.meanRadius);
  check('radially sorted sand and water are conserved',
    sand.count === sandBefore && water.count === waterBefore);
  check(`a static mixed scene settles (${idleAt} steps)`,
    idleAt > 0 && idleAt <= 320 && engine.stepWorld() === false);
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

// A long static source pulls toward its nearby surface instead of funneling a
// target sideways toward the component center.
{
  const engine = createEngineWasm();
  paintRect(engine, 0, 112, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, 125, 70, 125, 111, MAT.STONE);
  paintRect(engine, 55, 70, 125, 72, MAT.NEUTRONIUM);
  engine.paintDisc(60, 40, 0, MAT.SAND, true);
  engine.syncComponents();
  for (let i = 0; i < 24; i++) engine.stepWorld();
  const sand = firstCell(engine, MAT.SAND);
  check(`long static neutronium attracts toward its nearest surface (${sand?.x},${sand?.y})`,
    sand && Math.abs(sand.x - 60) <= 2 && sand.y > 50);
  engine.destroy();
}

// A long moving source uses its transformed occupied cells. The cross-layer
// target above its left end accelerates downward without steering to the body's
// center, while same-layer body-id exclusion remains independent.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(true);
  engine._spawnBoxLayer(0, 90, 70, 30, 2, MAT.NEUTRONIUM);
  engine._spawnBoxLayer(1, 65, 40, 1, 1, MAT.RIGID);
  const targetBefore = engine._bodyStateLayer(1, 0);
  for (let i = 0; i < 8; i++) engine.stepWorld();
  const targetAfter = engine._bodyStateLayer(1, 0);
  check('long rigid neutronium attracts toward its nearest transformed cell',
    targetBefore && targetAfter
      && Math.abs(targetAfter.px - targetBefore.px) < 1
      && targetAfter.py > targetBefore.py + 4);
  engine.destroy();
}

// A long target uses its nearby exposed cells when its center lies beyond the
// source reach.
{
  const engine = createEngineWasm();
  paintRect(engine, 0, 112, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, 20, 56, 20, 111, MAT.STONE);
  engine.paintDisc(20, 55, 0, MAT.NEUTRONIUM, true);
  engine.syncComponents();
  engine.spawnBox(102, 55, 75, 1, MAT.RIGID);
  const before = engine._bodyState(0);
  engine.stepWorld();
  const after = engine._bodyState(0);
  check('a long rigid target is attracted through its nearby end',
    before && after && after.px < before.px - 0.05 && after.vx < -0.05);
  engine.destroy();
}

// A changed field beside an exposed cell wakes a long sleeping target even when
// the center occupies a different force bin.
{
  const engine = createEngineWasm();
  paintRect(engine, 0, 112, COLS - 1, ROWS - 1, MAT.STONE);
  engine.syncComponents();
  engine.spawnBox(102, 108, 75, 2, MAT.RIGID);
  let sleepTick = -1;
  for (let step = 1; step <= 80; step++) {
    engine.stepWorld();
    if (!engine._bodyAwake(0)) {
      sleepTick = step;
      break;
    }
  }
  paintRect(engine, 20, 109, 20, 111, MAT.STONE);
  engine.paintDisc(20, 108, 0, MAT.NEUTRONIUM, true);
  engine.syncComponents();
  engine.stepWorld();
  const after = engine._bodyState(0);
  check(`a nearby field wakes a long rigid target (slept at ${sleepTick})`,
    sleepTick > 0 && engine._bodyAwake(0) === 1 && after?.vx < -0.05);
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

// Force-compressed persistent gas conserves every cell when neighboring gas
// blocks its preferred movement direction.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(false);
  paintRect(engine, 0, 100, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, 118, 28, 120, 99, MAT.STONE);
  paintRect(engine, 90, 28, 120, 30, MAT.STONE);
  engine.paintDisc(90, 33, 2, MAT.NEUTRONIUM, true);
  paintRect(engine, 72, 48, 108, 72, MAT.METHANE);
  engine.syncComponents();
  const before = countMaterial(engine, MAT.METHANE);
  for (let i = 0; i < 80; i++) engine.stepWorld();
  const after = countMaterial(engine, MAT.METHANE);
  check(`force-compressed methane is conserved (${before} -> ${after})`,
    before > 0 && after === before);
  engine.destroy();
}

// Free bodies receive continuous acceleration and wake through the same field.
// Only neutronium cells contribute to a mixed component's force geometry.
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

// Structural placement onto either half of detached two-layer terrain keeps
// the shared pose intact, including when the new material emits strong forces.
for (const [label, sourceLayer] of [['foreground', 0], ['background', 1]]) {
  const engine = createEngineWasm();
  engine.setBgEnabled(true);
  paintRectLayer(engine, 0, 35, 24, 74, 44, MAT.STONE);
  paintRectLayer(engine, 1, 35, 24, 74, 44, MAT.BRICK);
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();
  check(`${label} placement starts with bonded terrain`,
    engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 1
      && engine._bodyJointRoleLayer(0, 0) === 1
      && engine._bodyJointRoleLayer(1, 0) === 2);
  check(`${label} neutronium placement attaches`,
    engine.placeMaterial(77, 34, 2, MAT.NEUTRONIUM, sourceLayer));
  check(`${label} placement preserves the terrain joint`,
    engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 1
      && engine._bodyJointRoleLayer(0, 0) === 1
      && engine._bodyJointRoleLayer(1, 0) === 2);
  for (let i = 0; i < 24; i++) engine.stepWorld();
  const fg = engine._bodyStateLayer(0, 0);
  const bg = engine._bodyStateLayer(1, 0);
  const sharedPose = fg && bg
    && ['px', 'py', 'angle', 'vx', 'vy', 'omega']
      .every((field) => Math.abs(fg[field] - bg[field]) < 1e-9);
  check(`${label} neutronium cannot pull the two layers apart`, sharedPose);
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

// A rigid body pressed into stable support by an unchanged neutronium field can
// keep its contact island asleep. Editing the field wakes it again.
{
  const engine = createEngineWasm();
  paintRect(engine, 0, 112, COLS - 1, ROWS - 1, MAT.STONE);
  paintRect(engine, 20, 114, COLS - 21, 114, MAT.NEUTRONIUM);
  engine.syncComponents();
  engine.spawnBox(90, 106, 2, 2, MAT.RIGID);
  let sleepTick = -1;
  for (let step = 1; step <= 100; step++) {
    engine.stepWorld();
    if (!engine._bodyAwake(0)) {
      sleepTick = step;
      break;
    }
  }
  let stayedAsleep = sleepTick > 0;
  for (let step = 0; step < 40; step++) {
    engine.stepWorld();
    stayedAsleep &&= engine._bodyAwake(0) === 0;
  }
  check(`a stable neutronium contact island sleeps (tick ${sleepTick})`,
    sleepTick > 0 && stayedAsleep);
  paintRect(engine, 20, 114, COLS - 21, 114, MAT.STONE);
  engine.syncComponents();
  engine.stepWorld();
  check('changing the neutronium field wakes the sleeping island',
    engine._bodyAwake(0) === 1);
  engine.destroy();
}

// Equal moving sources use a stable identity tie-break instead of applying
// reciprocal attraction, so the dominant source cannot change every tick.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(false);
  engine.spawnBox(80, 25, 2, 2, MAT.NEUTRONIUM);
  engine.spawnBox(100, 25, 2, 2, MAT.NEUTRONIUM);
  const olderBefore = engine._bodyState(0);
  const newerBefore = engine._bodyState(1);
  for (let i = 0; i < 5; i++) engine.stepWorld();
  const olderAfter = engine._bodyState(0);
  const newerAfter = engine._bodyState(1);
  check('equal neutronium bodies choose one stable dominant source',
    olderBefore && olderAfter && newerBefore && newerAfter
      && Math.abs(olderAfter.px - olderBefore.px) < 1e-9
      && Math.abs(olderAfter.vx) < 1e-9
      && newerAfter.px < newerBefore.px - 2);
  engine.destroy();
}

// Dominance uses physical size across layers rather than layer-local body ids.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(true);
  engine._spawnBoxLayer(0, 84, 25, 1, 1, MAT.NEUTRONIUM);
  engine._spawnBoxLayer(1, 96, 28, 4, 3, MAT.NEUTRONIUM);
  const smallBefore = engine._bodyStateLayer(0, 0);
  const largeBefore = engine._bodyStateLayer(1, 0);
  for (let i = 0; i < 4; i++) engine.stepWorld();
  const smallAfter = engine._bodyStateLayer(0, 0);
  const largeAfter = engine._bodyStateLayer(1, 0);
  check('larger neutronium dominates a smaller body across layers',
    smallBefore && smallAfter && largeBefore && largeAfter
      && smallAfter.px > smallBefore.px + 2
      && Math.abs(largeAfter.px - largeBefore.px) < 1e-9
      && Math.abs(largeAfter.vx) < 1e-9);
  engine.destroy();
}

// Dense equal-size fields use the nearest eligible older body while preserving
// the body-id dominance order.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(false);
  for (let i = 0; i < 64; i++) {
    engine.spawnBox(
      10 + (i % 8) * 12,
      10 + Math.floor(i / 8) * 13,
      1, 1, MAT.NEUTRONIUM,
    );
  }
  const oldestBefore = engine._bodyState(0);
  const newestBefore = engine._bodyState(63);
  engine.stepWorld();
  const oldestAfter = engine._bodyState(0);
  const newestAfter = engine._bodyState(63);
  check('dense neutronium keeps exact nearest-source dominance',
    oldestBefore && oldestAfter && newestBefore && newestAfter
      && Math.abs(oldestAfter.vx) < 1e-9
      && newestAfter.px < newestBefore.px
      && newestAfter.vx < 0);
  engine.destroy();
}

// Between moving neutronium bodies, the larger source dominates the smaller
// target. Offset contacts can keep compacting without the small body's field
// launching the dominant mass sideways or upward.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(false);
  engine.spawnBox(84, 25, 1, 1, MAT.NEUTRONIUM);
  engine.spawnBox(96, 28, 4, 3, MAT.NEUTRONIUM);
  const smallBefore = engine._bodyState(0);
  const largeBefore = engine._bodyState(1);
  for (let i = 0; i < 4; i++) engine.stepWorld();
  const smallApproaching = engine._bodyState(0);
  const largeBeforeContact = engine._bodyState(1);
  check('a larger neutronium body attracts a smaller one',
    smallBefore && smallApproaching
      && smallApproaching.px > smallBefore.px + 2);
  check('the smaller neutronium body does not pull the larger one back',
    largeBefore && largeBeforeContact
      && Math.abs(largeBeforeContact.px - largeBefore.px) < 1e-9
      && Math.abs(largeBeforeContact.vx) < 1e-9);
  for (let i = 4; i < 20; i++) engine.stepWorld();
  const smallAfter = engine._bodyState(0);
  const largeAfter = engine._bodyState(1);
  const initialCenterY = smallBefore && largeBefore
    ? (smallBefore.py * smallBefore.nPts + largeBefore.py * largeBefore.nPts)
      / (smallBefore.nPts + largeBefore.nPts)
    : 0;
  const initialSeparation = smallBefore && largeBefore
    ? Math.hypot(smallBefore.px - largeBefore.px,
      smallBefore.py - largeBefore.py)
    : 0;
  const settledCenterY = smallAfter && largeAfter
    ? (smallAfter.py * smallAfter.nPts + largeAfter.py * largeAfter.nPts)
      / (smallAfter.nPts + largeAfter.nPts)
    : 0;
  const settledSeparation = smallAfter && largeAfter
    ? Math.hypot(smallAfter.px - largeAfter.px,
      smallAfter.py - largeAfter.py)
    : Infinity;
  check('offset neutronium pieces keep falling after they meet',
    largeBefore && largeAfter && settledCenterY > initialCenterY
      && settledSeparation < initialSeparation * 0.5
      && largeAfter.vy > 0 && Math.abs(largeAfter.vx) < 0.75);
  engine.destroy();
}

// Sustained attraction through a stack must preserve a separate raster for
// every moving body. A shared owner cell means the later body's visible cell was
// dropped while stamping, even when the velocity solver recovers next tick.
{
  const engine = createEngineWasm();
  engine.setBgEnabled(false);
  paintRect(engine, 0, 110, COLS - 1, ROWS - 1, MAT.STONE);
  engine.syncComponents();
  for (const [x, y, radius] of [
    [90, 92, 7], [90, 65, 5], [90, 43, 4], [90, 25, 3], [90, 10, 2],
  ]) {
    engine.spawnBox(x, y, radius, radius, MAT.NEUTRONIUM);
  }
  let ownershipConflicts = 0;
  for (let step = 0; step < 240; step++) {
    engine.stepWorld();
    ownershipConflicts += engine.getRigidSolverDebug().ownershipConflicts;
  }
  check(
    `force-compressed neutronium bodies keep separate rasters `
      + `(${ownershipConflicts} ownership conflicts)`,
    ownershipConflicts === 0,
  );
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
