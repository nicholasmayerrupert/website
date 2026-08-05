// A component-backed solid remains static while connected to the world, becomes
// one material-preserving rigid body when cut free, then bakes into isolated
// material components that retain the assembly's physical connectivity.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT, MATERIALS } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 100, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('detached solids retain rigid assembly bonds');
const e = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});

const paintRect = (x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, material, true);
  }
};
const count = (material) => {
  let n = 0;
  for (const value of e.getGrid()) if (value === material) n++;
  return n;
};

paintRect(0, ROWS - 2, COLS - 1, ROWS - 1, MAT.STONE);
paintRect(8, 20, 12, ROWS - 3, MAT.STONE);
paintRect(35, 80, 39, ROWS - 3, MAT.STONE);
paintRect(10, 20, 50, 22, MAT.BRICK);
paintRect(40, 10, 52, 19, MAT.WOOD);
e.syncComponents();
e.stepWorld();
check(`structure connected to the floor stays static (bodies ${e._bodyCount()})`,
  e._bodyCount() === 0);

for (let y = 5; y <= 28; y++) e.paintDisc(30, y, 0, MAT.EMPTY, true);
e.syncComponents();
const expectedBrick = count(MAT.BRICK);
const expectedWood = count(MAT.WOOD);
const detachedBrick = 20 * 3;
const detachedWood = 13 * 10;
e.stepWorld();

const spawned = e._bodyState(0);
check(`cut-off mixed solid becomes one body (bodies ${e._bodyCount()})`,
  e._bodyCount() === 1);
check(`body contains both detached materials (${spawned?.nPts ?? 0} cells)`,
  spawned?.nPts === detachedBrick + detachedWood);
check('body begins accelerating downward', !!spawned && spawned.vy > 0);
check('materials are preserved while airborne',
  count(MAT.BRICK) === expectedBrick && count(MAT.WOOD) === expectedWood);

let maxAngle = Math.abs(spawned?.angle ?? 0), bakedAt = -1;
for (let i = 0; i < 1000; i++) {
  e.stepWorld();
  const state = e._bodyState(0);
  if (!state) {
    bakedAt = i;
    break;
  }
  maxAngle = Math.max(maxAngle, Math.abs(state.angle));
}

check(`detached solid rotates on the offset ledge (max angle ${maxAngle.toFixed(2)} rad)`,
  maxAngle > 0.2);
check(`settled mixed-material body bakes (step ${bakedAt})`,
  bakedAt >= 0 && e._bodyCount() === 0);
check('mixed bake preserves both materials',
  Math.abs(count(MAT.BRICK) - expectedBrick) <= 4
    && Math.abs(count(MAT.WOOD) - expectedWood) <= 4);

for (let i = 0; i < 30; i++) e.stepWorld();
check(`mixed bake remains static (bodies ${e._bodyCount()})`,
  e._bodyCount() === 0);
e.destroy();

// A baked mixed rectangle must not merge its masonry partition into the
// same-material floor. Cutting it into two pieces and removing the floor should
// produce exactly two bodies whose pivots are their own mass centroids.
{
  const C = 120, R = 130, floorY = 108;
  const split = createEngineWasm({
    cols: C, rows: R, worldSeed: 71, sinksOn: false, infinite: false,
  });
  for (let y = floorY; y < R; y++)
    for (let x = 0; x < C; x++)
      split.paintDisc(x, y, 0, MAT.BRICK, true);
  for (let y = 22; y <= 35; y++) for (let x = 30; x <= 89; x++) {
    const material = (x + y) % 5 < 2 ? MAT.WOOD : MAT.BRICK;
    split.paintDisc(x, y, 0, material, true);
  }
  for (const x of [30, 31, 88, 89])
    for (let y = 36; y < floorY; y++)
      split.paintDisc(x, y, 0, MAT.BRICK, true);
  split.syncComponents();
  split.stepWorld();
  for (const x of [29, 30, 31, 32, 87, 88, 89, 90])
    for (let y = 36; y < floorY; y++)
      split.paintDisc(x, y, 0, MAT.EMPTY, true);
  split.syncComponents();
  split.stepWorld();
  check('mixed rectangle detaches as one body before baking',
    split._bodyCount() === 1);
  split._setBodyMotion(0, 0, 0, 0.012);
  let rectangleBaked = false;
  for (let i = 0; i < 900; i++) {
    split.stepWorld();
    if (split._bodyCount() === 0) {
      rectangleBaked = true;
      break;
    }
  }
  check('mixed rectangle bakes into static components', rectangleBaked);

  const grid = split.getGrid();
  let minX = C, maxX = -1, minY = R, maxY = -1;
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== MAT.BRICK && grid[k] !== MAT.WOOD) continue;
    const x = k % C, y = (k / C) | 0;
    if (y >= floorY) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cutX = (minX + maxX) >> 1;
  for (let y = minY - 1; y <= maxY + 1; y++)
    for (let x = cutX - 1; x <= cutX + 1; x++)
      split.paintDisc(x, y, 0, MAT.EMPTY, true);
  for (let y = floorY; y < R; y++)
    for (let x = minX - 2; x <= maxX + 2; x++)
      split.paintDisc(x, y, 0, MAT.EMPTY, true);
  split.syncComponents();

  const beforeSplit = split.getGrid();
  const centroidX = (left) => {
    let weightedX = 0, mass = 0;
    for (let k = 0; k < beforeSplit.length; k++) {
      const material = beforeSplit[k];
      if (material !== MAT.BRICK && material !== MAT.WOOD) continue;
      const x = k % C, y = (k / C) | 0;
      if (y >= floorY || (left ? x >= cutX - 1 : x <= cutX + 1)) continue;
      const cellMass = MATERIALS[material].density;
      weightedX += (x + 0.5) * cellMass;
      mass += cellMass;
    }
    return weightedX / mass;
  };
  const expectedPivots = [centroidX(true), centroidX(false)];
  split.stepWorld();
  const states = Array.from({ length: split._bodyCount() },
    (_, i) => split._bodyState(i)).filter(Boolean).sort((a, b) => a.px - b.px);
  check(`cut baked assembly separates into two bodies (${states.length})`,
    states.length === 2);
  check('split-body pivots are their local mass centroids',
    states.length === 2
      && Math.abs(states[0].px - expectedPivots[0]) < 1e-6
      && Math.abs(states[1].px - expectedPivots[1]) < 1e-6);
  split.destroy();
}

// Static structures and body damage both use 8-neighbor connectivity. A chip
// must not reinterpret an intentional diagonal material bond as a fracture.
{
  const diagonal = createEngineWasm({
    cols: 80, rows: 100, worldSeed: 19, sinksOn: false, infinite: false,
  });
  for (let y = 20; y <= 22; y++) for (let x = 30; x <= 32; x++)
    diagonal.paintDisc(x, y, 0, MAT.BRICK, true);
  for (let y = 23; y <= 25; y++) for (let x = 33; x <= 35; x++)
    diagonal.paintDisc(x, y, 0, MAT.WOOD, true);
  diagonal.syncComponents();
  diagonal.stepWorld();
  check('diagonally bonded mixed structure starts as one body',
    diagonal._bodyCount() === 1 && diagonal._bodyState(0)?.nPts === 18);
  diagonal.paintDisc(30, 20, 0, MAT.EMPTY, true);
  diagonal.stepWorld();
  check(`chipping a diagonal material bond keeps one body (${diagonal._bodyCount()})`,
    diagonal._bodyCount() === 1 && diagonal._bodyState(0)?.nPts === 17);
  diagonal.destroy();
}

const naturallyLoose = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false,
});
for (let y = 10; y <= 13; y++) {
  for (let x = 45; x <= 48; x++) naturallyLoose.paintDisc(x, y, 0, MAT.STONE, true);
}
naturallyLoose.syncComponents();
naturallyLoose.stepWorld();
const naturalBody = naturallyLoose._bodyState(0);
check(`naturally unsupported solid enters the rigid solver (bodies ${naturallyLoose._bodyCount()}, vy ${naturalBody?.vy.toFixed(3)})`,
  naturallyLoose._bodyCount() === 1 && naturalBody?.nPts === 16 && naturalBody.vy > 0);
naturallyLoose.destroy();

// A rotating structural body landing across uneven static terrain must keep its
// complete raster outside the ground until it bakes.
{
  const C = 140, R = 150;
  const rough = createEngineWasm({
    cols: C, rows: R, worldSeed: 51, sinksOn: false, infinite: false,
  });
  const surface = [
    130, 129, 128, 128, 129, 129, 128, 128, 128, 128,
    128, 128, 128, 128, 128, 128, 128, 128, 128, 127,
    127, 127, 126, 126, 126, 126, 125, 125, 125, 125,
    125, 126, 126, 126, 126, 126, 126,
  ];
  for (let x = 0; x < C; x++) {
    const top = x >= 45 && x < 82 ? surface[x - 45] : 140;
    for (let y = top; y < R; y++)
      rough.paintDisc(x, y, 0, MAT.STONE, true);
  }
  for (let y = 123; y < 140; y++)
    rough.paintDisc(44, y, 0, MAT.STONE, true);
  for (let y = 119; y < 140; y++) for (let x = 80; x <= 81; x++)
    rough.paintDisc(x, y, 0, MAT.STONE, true);

  const bodyRows = [
    [[76, 76], [79, 79]], [[72, 74], [76, 85]], [[70, 87]],
    [[68, 89]], [[67, 89]], [[66, 91]], [[65, 92]], [[65, 93]],
    [[64, 93]], [[63, 93]], [[63, 94]], [[63, 94]], [[63, 94]],
    [[63, 94]], [[63, 94]], [[64, 93]], [[64, 93]], [[64, 93]],
    [[64, 92]], [[65, 92]], [[66, 90]], [[66, 66], [68, 89]],
    [[68, 88]], [[70, 86]], [[73, 83], [85, 85]],
    [[77, 77], [80, 80]],
  ];
  for (let row = 0; row < bodyRows.length; row++)
    for (const [x0, x1] of bodyRows[row])
      for (let x = x0; x <= x1; x++)
        rough.paintDisc(x, 22 + row, 0, MAT.BRICK, true);
  rough.syncComponents();
  rough.stepWorld();
  const spawned = rough._bodyCount() === 1;
  if (spawned)
    rough._setBodyMotion(0, -0.0959774743532762,
      1.9588832577690483, 0.032843969429377465);

  let structuralPrevious = rough._bodyState(0);
  let structuralTouching = false, structuralFrozenTicks = 0;
  let structuralLongestInterruptedFreeze = 0, structuralMaxContactStep = 0;
  let maxBlocked = 0, maxRejected = 0, baked = false;
  for (let tick = 0; tick < 240; tick++) {
    rough.stepWorld();
    maxRejected = Math.max(maxRejected,
      rough.getRigidDebug().rejectedCells);
    if (rough._bodyCount() === 0) {
      baked = true;
      break;
    }
    const state = rough._bodyState(0);
    structuralTouching = structuralTouching
      || rough.getRigidSolverDebug().contacts > 0;
    const centerStep = Math.hypot(
      state.px - structuralPrevious.px,
      state.py - structuralPrevious.py);
    const poseStep = centerStep
      + Math.abs(state.angle - structuralPrevious.angle) * state.maxR;
    if (structuralTouching)
      structuralMaxContactStep = Math.max(structuralMaxContactStep, poseStep);
    if (rough._bodyAwake(0) && poseStep < 1e-4) {
      structuralFrozenTicks++;
    } else if (rough._bodyAwake(0)) {
      structuralLongestInterruptedFreeze = Math.max(
        structuralLongestInterruptedFreeze, structuralFrozenTicks);
      structuralFrozenTicks = 0;
    }
    structuralPrevious = state;
    maxBlocked = Math.max(maxBlocked, rough._bodyBlocked(0));
  }
  check('rough-ground structural fixture enters the rigid solver', spawned);
  check(`rough-ground body keeps a complete terrain-clear raster `
      + `(${maxBlocked} blocked, ${maxRejected} rejected)`,
    maxBlocked === 0 && maxRejected === 0);
  check(`component rigid keeps rolling on rough ground (`
      + `${structuralLongestInterruptedFreeze} interrupted frozen ticks)`,
    structuralTouching && structuralLongestInterruptedFreeze === 0);
  check(`component rolling remains continuous (largest contact step `
      + `${structuralMaxContactStep.toFixed(3)})`,
    structuralMaxContactStep < 3);
  check('rough-ground body settles and bakes', baked);
  rough.destroy();

  // Rough-terrain raster adjustment is the same for permanent and component
  // bodies: preserve the solved roll and translate the contact clear.
  const rolling = createEngineWasm({
    cols: C, rows: R, worldSeed: 51, sinksOn: false, infinite: false,
  });
  for (let x = 0; x < C; x++) {
    const top = x >= 45 && x < 82 ? surface[x - 45] : 140;
    for (let y = top; y < R; y++)
      rolling.paintDisc(x, y, 0, MAT.STONE, true);
  }
  for (let y = 123; y < 140; y++)
    rolling.paintDisc(44, y, 0, MAT.STONE, true);
  for (let y = 119; y < 140; y++) for (let x = 80; x <= 81; x++)
    rolling.paintDisc(x, y, 0, MAT.STONE, true);
  rolling.syncComponents();
  const rollingCells = [];
  for (let row = 0; row < bodyRows.length; row++)
    for (const [x0, x1] of bodyRows[row])
      for (let x = x0; x <= x1; x++) rollingCells.push([x - 4, 22 + row]);
  rolling.spawnBody(rollingCells);
  rolling._setBodyMotion(0, -0.3, 1.2, -0.03284);

  let previous = rolling._bodyState(0);
  let touching = false, frozenTicks = 0, longestFreeze = 0;
  let maxContactStep = 0, rollingMaxBlocked = 0;
  let rollingMaxRejected = 0, sleptAt = -1;
  for (let tick = 0; tick < 300; tick++) {
    rolling.stepWorld();
    const state = rolling._bodyState(0);
    rollingMaxBlocked = Math.max(rollingMaxBlocked, rolling._bodyBlocked(0));
    rollingMaxRejected = Math.max(
      rollingMaxRejected, rolling.getRigidDebug().rejectedCells);
    touching = touching || rolling.getRigidSolverDebug().contacts > 0;
    const centerStep = Math.hypot(state.px - previous.px, state.py - previous.py);
    const poseStep = centerStep
      + Math.abs(state.angle - previous.angle) * state.maxR;
    if (touching) maxContactStep = Math.max(maxContactStep, poseStep);
    if (rolling._bodyAwake(0) && poseStep < 1e-4) frozenTicks++;
    else frozenTicks = 0;
    longestFreeze = Math.max(longestFreeze, frozenTicks);
    if (!rolling._bodyAwake(0) && sleptAt < 0) sleptAt = tick;
    previous = state;
  }
  check(`generic rigid keeps rolling on rough ground (${longestFreeze} frozen ticks)`,
    touching && longestFreeze === 0);
  check(`rough-ground rolling remains continuous (largest contact step ${maxContactStep.toFixed(3)})`,
    maxContactStep < 2);
  check(`generic rigid keeps a terrain-clear raster `
      + `(${rollingMaxBlocked} blocked, ${rollingMaxRejected} rejected)`,
    rollingMaxBlocked === 0 && rollingMaxRejected === 0);
  check(`generic rigid settles after rolling (step ${sleptAt})`, sleptAt >= 0);
  rolling.destroy();

  // Raster clearance follows the terrain normal. A shorter sideways escape
  // must not repeatedly undo motion along a shallow slope while the solver
  // still reports meaningful tangential velocity.
  const shallow = createEngineWasm({
    cols: 150, rows: 130, worldSeed: 51, sinksOn: false, infinite: false,
  });
  for (let x = 0; x < 150; x++) {
    const roughness = (x * 17 + 3) % 7 < 1 ? -1 : 0;
    const top = Math.round(108 - 0.08 * (x - 75)) + roughness;
    for (let y = top; y < 130; y++)
      shallow.paintDisc(x, y, 0, MAT.STONE, true);
  }
  shallow.syncComponents();
  shallow.spawnBox(75, 45, 9, 1, MAT.RIGID);
  shallow._setBodyMotion(0, 0.13, 1.1, -0.027);

  let shallowPrevious = shallow._bodyState(0);
  let correctionTicks = 0, stalledCorrectionTicks = 0;
  let longestCorrectionStall = 0;
  for (let tick = 0; tick < 120; tick++) {
    shallow.stepWorld();
    const state = shallow._bodyState(0);
    const centerStep = Math.hypot(
      state.px - shallowPrevious.px, state.py - shallowPrevious.py);
    const poseStep = centerStep
      + Math.abs(state.angle - shallowPrevious.angle) * state.maxR;
    const pointSpeed = Math.hypot(state.vx, state.vy)
      + Math.abs(state.omega) * state.maxR;
    const adjusted = shallow.getRigidDebug().depenetrations > 0;
    if (adjusted) correctionTicks++;
    if (adjusted && pointSpeed > 0.15 && poseStep < 0.03)
      stalledCorrectionTicks++;
    else stalledCorrectionTicks = 0;
    longestCorrectionStall = Math.max(
      longestCorrectionStall, stalledCorrectionTicks);
    shallowPrevious = state;
  }
  check(`rough-ground correction preserves tangential travel (`
      + `${longestCorrectionStall} stalled ticks across ${correctionTicks} corrections)`,
    correctionTicks > 0 && longestCorrectionStall === 0);
  shallow.destroy();
}

// A sleeping body on a static platform must enter free fall in the same solver
// tick when a support cut converts that platform into a body. Their relative
// separation stays fixed through the initial free-fall transition.
{
  const C = 160, R = 190;
  const stacked = createEngineWasm({
    cols: C, rows: R, worldSeed: 29, sinksOn: false, infinite: false,
  });
  const rect = (x0, y0, x1, y1, material) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        stacked.paintDisc(x, y, 0, material, true);
  };
  rect(0, R - 3, C - 1, R - 1, MAT.STONE);
  rect(77, 100, 83, R - 4, MAT.STONE);
  rect(35, 88, 125, 99, MAT.BRICK);
  stacked.syncComponents();
  stacked.stepWorld();
  stacked.spawnBox(80, 83, 10, 5, MAT.RIGID);
  for (let i = 0; i < 200; i++) stacked.stepWorld();
  check('payload sleeps on the supported platform',
    stacked._bodyCount() === 1 && stacked._bodyAwake(0) === 0);

  rect(74, 125, 86, 145, MAT.EMPTY);
  stacked.syncComponents();
  stacked.stepWorld();
  const payloadStart = stacked._bodyState(0);
  const platformStart = stacked._bodyState(1);
  const startSeparation = platformStart && payloadStart
    ? platformStart.py - payloadStart.py
    : Infinity;
  for (let i = 0; i < 12; i++) stacked.stepWorld();
  const payloadEnd = stacked._bodyState(0);
  const platformEnd = stacked._bodyState(1);
  const endSeparation = platformEnd && payloadEnd
    ? platformEnd.py - payloadEnd.py
    : -Infinity;
  check(`detached platform keeps contact with its payload (separation drift `
      + `${Math.abs(endSeparation - startSeparation).toFixed(3)})`,
    stacked._bodyCount() === 2
      && Math.abs(endSeparation - startSeparation) < 0.1);
  stacked.destroy();
}

// A topology-changing TNT crater must force an exact support reflood. The
// surviving cap is well clear of the floor after the pillar is removed, so its
// largest remnant must enter the body solver instead of retaining a stale
// grounded flag.
{
  const C = 120, R = 140;
  const blastCut = createEngineWasm({
    cols: C, rows: R, worldSeed: 17, sinksOn: false, infinite: false,
  });
  const rect = (x0, y0, x1, y1, material) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        blastCut.paintDisc(x, y, 0, material, true);
  };
  rect(0, R - 3, C - 1, R - 1, MAT.STONE);
  rect(48, 45, 52, R - 4, MAT.STONE);
  rect(20, 30, 85, 49, MAT.IRON_ORE);
  blastCut.syncComponents();
  blastCut.stepWorld();
  blastCut._detonateTnt(50, 75);
  blastCut.stepWorld();
  let largest = 0;
  for (let i = 0; i < blastCut._bodyCount(); i++)
    largest = Math.max(largest, blastCut._bodyState(i)?.nPts ?? 0);
  check(`TNT-separated cap becomes a rigid body (largest ${largest} cells)`,
    largest > 1000);
  blastCut.destroy();
}

// Loose material resting on top is cargo, not support. It must neither keep the
// blast-separated cap in the static component graph nor cancel the body's
// gravity once the cap is airborne.
{
  const C = 120, R = 220;
  const runLoadedBlast = (withDirt) => {
    const engine = createEngineWasm({
      cols: C, rows: R, worldSeed: 31, sinksOn: false, infinite: false,
    });
    const rect = (x0, y0, x1, y1, material) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          engine.paintDisc(x, y, 0, material, true);
    };
    rect(0, R - 3, C - 1, R - 1, MAT.STONE);
    rect(48, 45, 52, R - 4, MAT.STONE);
    rect(20, 30, 85, 49, MAT.STONE);
    if (withDirt) rect(20, 24, 85, 29, MAT.DIRT);
    engine.syncComponents();
    engine.stepWorld();
    engine._detonateTnt(50, 75);
    engine.stepWorld();
    const largestState = () => {
      let largest = null;
      for (let i = 0; i < engine._bodyCount(); i++) {
        const state = engine._bodyState(i);
        if (state && (!largest || state.nPts > largest.nPts)) largest = state;
      }
      return largest;
    };
    const start = largestState();
    for (let i = 0; i < 18; i++) engine.stepWorld();
    const end = largestState();
    const result = {
      spawned: !!start && start.nPts > 1000,
      nPts: start?.nPts ?? 0,
      dy: start && end ? end.py - start.py : -Infinity,
      vy: end?.vy ?? -Infinity,
    };
    engine.destroy();
    return result;
  };
  const bare = runLoadedBlast(false);
  const loaded = runLoadedBlast(true);
  check(`dirt-covered TNT island is classified as detached (${loaded.nPts} cells)`,
    loaded.spawned);
  check(`dirt above does not slow the detached fall (dy ${loaded.dy.toFixed(2)}/${bare.dy.toFixed(2)}, `
    + `vy ${loaded.vy.toFixed(2)}/${bare.vy.toFixed(2)})`,
  loaded.dy >= bare.dy * 0.9 && loaded.vy >= bare.vy * 0.9);
}

// Foreground/background pieces created by the same structural detachment share
// one pose. This is creation-time membership, not a global cross-layer weld.
{
  const C = 120, R = 170;
  const paired = createEngineWasm({
    cols: C, rows: R, worldSeed: 23, sinksOn: false, infinite: false,
  });
  paired.setBgEnabled(true);
  const rect = (layer, x0, y0, x1, y1, material) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        paired.paintDiscLayer(layer, x, y, 0, material, true);
  };
  for (const layer of [0, 1]) {
    rect(layer, 0, R - 3, C - 1, R - 1, MAT.STONE);
    rect(layer, 48, 45, 52, R - 4, MAT.STONE);
  }
  rect(0, 18, 30, 84, 49, MAT.IRON_ORE);
  rect(1, 24, 27, 90, 52, MAT.BRICK);
  paired.syncComponentsLayer(0);
  paired.syncComponentsLayer(1);
  paired.stepWorld();
  paired._detonateTnt(50, 78);
  paired.stepWorld();

  const findRole = (layer, role) => {
    for (let i = 0; i < paired._bodyCountLayer(layer); i++)
      if (paired._bodyJointRoleLayer(layer, i) === role) return i;
    return -1;
  };
  const leader = findRole(0, 1);
  const follower = findRole(1, 2);
  check(`one blast created an explicit cross-layer rigid pair (${leader}/${follower})`,
    leader >= 0 && follower >= 0);
  let locked = leader >= 0 && follower >= 0;
  const startPy = paired._bodyStateLayer(0, leader)?.py ?? Infinity;
  let moved = false;
  let pairDetail = '';
  for (let i = 0; i < 14 && locked; i++) {
    paired.stepWorld();
    const currentLeader = findRole(0, 1);
    const currentFollower = findRole(1, 2);
    const fg = paired._bodyStateLayer(0, currentLeader);
    const bg = paired._bodyStateLayer(1, currentFollower);
    if (!fg || !bg) { locked = false; break; }
    pairDetail = `step ${i}: pose Δ ${Math.abs(fg.px - bg.px).toExponential(2)},`
      + `${Math.abs(fg.py - bg.py).toExponential(2)},${Math.abs(fg.angle - bg.angle).toExponential(2)} `
      + `motion Δ ${Math.abs(fg.vx - bg.vx).toExponential(2)},`
      + `${Math.abs(fg.vy - bg.vy).toExponential(2)},${Math.abs(fg.omega - bg.omega).toExponential(2)}`;
    moved ||= fg.py > startPy + 0.25;
    locked = Math.abs(fg.px - bg.px) < 1e-9
      && Math.abs(fg.py - bg.py) < 1e-9
      && Math.abs(fg.angle - bg.angle) < 1e-9
      && Math.abs(fg.vx - bg.vx) < 1e-9
      && Math.abs(fg.vy - bg.vy) < 1e-9
      && Math.abs(fg.omega - bg.omega) < 1e-9;
  }
  check(`blast-created foreground/background halves share one moving pose (${pairDetail})`,
    locked && moved);
  for (let i = 0; i < 700; i++) {
    paired.stepWorld();
  }
  const countMaterial = (grid, material) => {
    let total = 0;
    for (const value of grid) if (value === material) total++;
    return total;
  };
  check('heterogeneous cross-layer pair bakes in both layers',
    findRole(0, 1) < 0 && findRole(1, 2) < 0
      && countMaterial(paired.getGrid(), MAT.IRON_ORE) > 500
      && countMaterial(paired.getGridBg(), MAT.BRICK) > 500);
  paired.destroy();

  const separate = createEngineWasm({
    cols: 80, rows: 100, worldSeed: 29, sinksOn: false, infinite: false,
  });
  separate.setBgEnabled(true);
  separate._spawnBoxLayer(0, 25, 15, 3, 3, MAT.RIGID);
  separate._spawnBoxLayer(1, 55, 25, 4, 2, MAT.RIGID);
  separate.stepWorld();
  const fg = separate._bodyStateLayer(0, 0);
  const bg = separate._bodyStateLayer(1, 0);
  check('independently spawned cross-layer rigids remain independent',
    separate._bodyJointRoleLayer(0, 0) === 0
      && separate._bodyJointRoleLayer(1, 0) === 0
      && fg && bg && Math.abs(fg.px - bg.px) > 20);
  separate.destroy();
}

// A furnished generated hall contains many adjacent masonry, timber, mineral,
// and plant partitions. Its cross-layer object bond must survive a rotated fall
// and rest without decomposing into per-material components.
{
  const C = 220, R = 160;
  const generated = createEngineWasm({
    cols: C, rows: R, worldSeed: 0xBED, sinksOn: false, infinite: true,
  });
  generated.shiftWorldXY(128, 0);
  generated.shiftWorldXY(128, 0);
  const hall = [];
  for (let layer = 0; layer < 2; layer++) {
    const grid = layer ? generated.getGridBg() : generated.getGrid();
    const cells = [];
    for (let y = 10; y <= 52; y++) for (let x = 50; x <= 105; x++) {
      const material = grid[y * C + x];
      if (material !== MAT.EMPTY) cells.push([x, y, material]);
    }
    hall.push(cells);
  }
  generated.destroy();

  const house = createEngineWasm({
    cols: C, rows: R, worldSeed: 37, sinksOn: false, infinite: false,
  });
  house.setBgEnabled(true);
  for (let layer = 0; layer < 2; layer++) {
    for (const [x, y, material] of hall[layer])
      house.paintDiscLayer(layer, x, y, 0, material, true);
    for (let y = 53; y < R - 3; y++)
      for (const x of [61, 62, 63, 96, 97, 98])
        house.paintDiscLayer(layer, x, y, 0, MAT.BRICK, true);
    for (let y = R - 3; y < R; y++)
      for (let x = 0; x < C; x++)
        house.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    house.syncComponentsLayer(layer);
  }
  house.stepWorld();
  check('furnished hall fixture starts as one static cross-layer structure',
    house._bodyCountLayer(0) === 0 && house._bodyCountLayer(1) === 0);

  for (let layer = 0; layer < 2; layer++) {
    for (let y = 53; y < R - 3; y++)
      for (const x of [60, 61, 62, 63, 64, 95, 96, 97, 98, 99])
        house.paintDiscLayer(layer, x, y, 0, MAT.EMPTY, true);
    house.syncComponentsLayer(layer);
  }
  house.stepWorld();
  check('cut hall becomes one foreground/background rigid pair',
    house._bodyCountLayer(0) === 1 && house._bodyCountLayer(1) === 1
      && house._bodyJointRoleLayer(0, 0) === 1
      && house._bodyJointRoleLayer(1, 0) === 2);
  house._setBodyMotion(0, 0, 0, 0.01);

  let cohesive = true, maxAngle = 0, bakedAt = -1;
  for (let i = 0; i < 260; i++) {
    house.stepWorld();
    const fgCount = house._bodyCountLayer(0);
    const bgCount = house._bodyCountLayer(1);
    if (fgCount === 0 && bgCount === 0) {
      bakedAt = i;
      break;
    }
    if (fgCount !== 1 || bgCount !== 1
        || house._bodyJointRoleLayer(0, 0) !== 1
        || house._bodyJointRoleLayer(1, 0) !== 2) {
      cohesive = false;
      break;
    }
    const fg = house._bodyStateLayer(0, 0);
    const bg = house._bodyStateLayer(1, 0);
    if (!fg || !bg
        || Math.abs(fg.px - bg.px) > 1e-9
        || Math.abs(fg.py - bg.py) > 1e-9
        || Math.abs(fg.angle - bg.angle) > 1e-9) {
      cohesive = false;
      break;
    }
    maxAngle = Math.max(maxAngle, Math.abs(fg.angle));
  }
  check(`rotated furnished hall stays one assembly (max angle ${maxAngle.toFixed(2)} rad)`,
    cohesive && maxAngle > 0.1);
  check(`rotated furnished hall bakes without material fragments (step ${bakedAt})`,
    cohesive && bakedAt >= 0
      && house._bodyCountLayer(0) === 0
      && house._bodyCountLayer(1) === 0);
  for (let layer = 0; layer < 2; layer++) {
    for (let y = R - 3; y < R; y++)
      for (let x = 0; x < C; x++)
        house.paintDiscLayer(layer, x, y, 0, MAT.EMPTY, true);
    house.syncComponentsLayer(layer);
  }
  house.stepWorld();
  if ((house._bodyStateLayer(0, 0)?.vy ?? 0) <= 0) house.stepWorld();
  const redetached = house._bodyStateLayer(0, 0);
  check('baked furnished hall re-detaches as one foreground/background assembly',
    house._bodyCountLayer(0) === 1 && house._bodyCountLayer(1) === 1
      && house._bodyJointRoleLayer(0, 0) === 1
      && house._bodyJointRoleLayer(1, 0) === 2
      && redetached?.vy > 0);
  house.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
