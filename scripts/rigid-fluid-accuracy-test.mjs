// Deterministic regressions for adaptive rigid-fluid coupling.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const COLS = 180;
const ROWS = 130;
const STONE = 3;
const WATER = 2;
const OIL = 4;
const WOOD = 8;
const ICE = 12;
const RIGID = 13;
const BRINE = 33;

await initSandWasm();

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};
const makeEngine = () => createEngineWasm({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x51A7E,
  sinksOn: false,
});
const run = (engine, steps, start = 0) => {
  let now = start;
  for (let i = 0; i < steps; i++) {
    now += 16;
    engine.step(now);
  }
  return now;
};
const paintRect = (engine, x0, y0, x1, y1, material) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      engine.paintDisc(x, y, 0, material, true);
};
const buildPool = (engine) => {
  paintRect(engine, 24, 112, 155, 115, STONE);
  paintRect(engine, 24, 42, 27, 111, STONE);
  paintRect(engine, 152, 42, 155, 111, STONE);
  engine.syncComponents();
  paintRect(engine, 28, 48, 151, 111, WATER);
};
const countMaterial = (engine, material) => {
  let count = 0;
  for (const value of engine.getGrid()) if (value === material) count++;
  return count;
};

{
  console.log('mixed-material ice coupling stays local to the bodies that contain ice');
  const measureDomain = (ordinary, mixed) => {
    const engine = makeEngine();
    engine.setBgEnabled(false);
    paintRect(engine, 2, 38, COLS - 3, 108, WATER);
    if (ordinary) engine.spawnBox(45, 72, 2, 2, RIGID);
    let mixedBody = -1, grew = false;
    if (mixed) {
      mixedBody = engine._bodyCount();
      engine.spawnBox(135, 72, 2, 2, STONE);
      const before = engine._bodyState(mixedBody)?.nPts ?? 0;
      engine._freezeBodyCell(0, mixedBody, 0, 137, 72);
      grew = (engine._bodyState(mixedBody)?.nPts ?? 0) === before + 1;
    }
    engine.stepWorld();
    const nodes = engine.getRigidSolverDebug().fluidNodes;
    engine.destroy();
    return { nodes, grew };
  };
  const ordinary = measureDomain(true, false);
  const mixed = measureDomain(false, true);
  const combined = measureDomain(true, true);
  check('stone body accepted one frozen water cell as mixed material',
    mixed.grew && combined.grew);
  check(`mixed stone/ice body gets the ice pressure domain (${mixed.nodes} > ${ordinary.nodes})`,
    mixed.nodes > ordinary.nodes + 20);
  check(`ice does not enlarge an unrelated body's domain (${combined.nodes} vs ${ordinary.nodes} + ${mixed.nodes})`,
    Math.abs(combined.nodes - ordinary.nodes - mixed.nodes) <= 4);
}

{
  console.log('ice crosses an oil/brine interface with a bounded local domain');
  const engine = makeEngine();
  engine.setBgEnabled(false);
  paintRect(engine, 18, 20, 20, 116, STONE);
  paintRect(engine, 159, 20, 161, 116, STONE);
  paintRect(engine, 18, 116, 161, 118, STONE);
  engine.syncComponents();
  paintRect(engine, 21, 76, 158, 115, BRINE);
  paintRect(engine, 21, 50, 158, 75, OIL);
  let now = run(engine, 80);
  const oilBefore = countMaterial(engine, OIL);
  const brineBefore = countMaterial(engine, BRINE);
  engine.addDiscToIceDraft(90, 32, 7);
  engine.finalizeIceDraft();

  let maxNodes = 0, maxSurfaceHump = 0;
  let humpStep = 0, humpBodyY = 0;
  for (let step = 0; step < 140; step++) {
    now = run(engine, 1, now);
    maxNodes = Math.max(maxNodes,
      engine.getRigidSolverDebug().fluidNodes);
    const grid = engine.getGrid();
    const liquidTops = [];
    for (let x = 21; x <= 158; x++) {
      let top = ROWS;
      for (let y = 20; y < 116; y++) {
        const material = grid[y * COLS + x];
        if (material === OIL || material === BRINE) {
          top = y;
          break;
        }
      }
      liquidTops.push(top);
    }
    const far = [
      ...liquidTops.slice(0, 40),
      ...liquidTops.slice(-40),
    ].sort((a, b) => a - b);
    const farSurface = far[(far.length / 2) | 0];
    const nearSurface = Math.min(...liquidTops.slice(55, 83));
    const surfaceHump = farSurface - nearSurface;
    if (surfaceHump > maxSurfaceHump) {
      maxSurfaceHump = surfaceHump;
      humpStep = step;
      humpBodyY = engine._bodyState(0).py;
    }
  }
  const body = engine._bodyState(0);
  check(`mixed-liquid pressure domain stayed local (${maxNodes} nodes)`,
    maxNodes > 0 && maxNodes < 2500);
  check(`displaced liquid kept a flat free surface (${maxSurfaceHump} rows at step ${humpStep}, body y ${humpBodyY.toFixed(2)})`,
    maxSurfaceHump <= 2);
  check(`ice settled at the density interface (y ${body.py.toFixed(2)})`,
    body.py > 65 && body.py < 85 && Math.abs(body.vy) < 0.05);
  check(`oil volume was conserved (${oilBefore} == ${countMaterial(engine, OIL)})`,
    countMaterial(engine, OIL) === oilBefore);
  check(`brine volume was conserved (${brineBefore} == ${countMaterial(engine, BRINE)})`,
    countMaterial(engine, BRINE) === brineBefore);
  engine.destroy();
}

{
  console.log('fast wet motion receives a post-advection pressure correction');
  const engine = makeEngine();
  buildPool(engine);
  let now = run(engine, 100);
  const waterBefore = countMaterial(engine, WATER);
  engine.spawnBox(90, 32, 5, 5, RIGID);
  engine._setBodyMotion(0, 0, 3, 0);
  let correctors = 0;
  let bodyRasterStateClean = true, bodyStateCell = -1;
  for (let i = 0; i < 90; i++) {
    now = run(engine, 1, now);
    correctors += engine.getRigidSolverDebug().fluidCorrectorPasses;
    const owners = engine._bodyOwnerGrid();
    const velocities = engine._liquidVelocityGrid();
    for (let k = 0; k < owners.length; k++) {
      if (owners[k] < 0 || velocities[k] === 0) continue;
      bodyRasterStateClean = false;
      bodyStateCell = k;
      break;
    }
  }
  const waterAfter = countMaterial(engine, WATER);
  check(`strong entry used the adaptive corrector (${correctors} passes)`,
    correctors > 0);
  check(`pressure correction conserved liquid volume (${waterAfter} == ${waterBefore})`,
    waterAfter === waterBefore);
  check(`body raster rejected projected liquid state (cell ${bodyStateCell})`,
    bodyRasterStateClean);
  engine.destroy();
}

{
  console.log('ordinary wet motion stays on the single pressure pass');
  const engine = makeEngine();
  buildPool(engine);
  let now = run(engine, 100);
  engine.spawnBox(90, 75, 5, 5, RIGID);
  engine._setBodyMotion(0, 0.2, 0, 0);
  now = run(engine, 1, now);
  const correctors = engine.getRigidSolverDebug().fluidCorrectorPasses;
  check(`sub-cell travel skipped the corrector (${correctors} passes)`,
    correctors === 0);
  engine.destroy();
}

{
  console.log('a new current wakes a fluid-supported sleeping body');
  const engine = makeEngine();
  buildPool(engine);
  let now = run(engine, 100);
  engine.spawnBox(90, 35, 7, 4, WOOD);
  for (let i = 0; i < 900 && engine._bodyAwake(0) !== 0; i++)
    now = run(engine, 1, now);
  check('wood reached a sleeping buoyant equilibrium',
    engine._bodyAwake(0) === 0);

  const grid = engine.getGrid();
  const owners = engine._bodyOwnerGrid();
  let wetNeighbor = -1;
  let currentVelocity = [0, 0];
  for (const offsets of [[-1, 1], [-COLS, COLS]]) {
    for (let k = 0; k < owners.length && wetNeighbor < 0; k++) {
      if (owners[k] < 0) continue;
      const x = k % COLS;
      const y = (k / COLS) | 0;
      for (const offset of offsets) {
        const neighbor = k + offset;
        if (neighbor < 0 || neighbor >= grid.length) continue;
        const nx = neighbor % COLS;
        const ny = (neighbor / COLS) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (grid[neighbor] === WATER && owners[neighbor] < 0) {
          wetNeighbor = neighbor;
          currentVelocity = Math.abs(offset) === 1 ? [1.5, 0] : [0, 1.5];
          break;
        }
      }
    }
  }
  check('sleeping body has an exposed wet face', wetNeighbor >= 0);
  if (wetNeighbor >= 0) {
    const x = wetNeighbor % COLS;
    const y = (wetNeighbor / COLS) | 0;
    engine._setLiquidVelocity(0, x, y, ...currentVelocity);
    now = run(engine, 1, now);
    const state = engine._bodyState(0);
    check(`current woke the body (awake ${engine._bodyAwake(0)})`,
      engine._bodyAwake(0) === 1);
    const projectedVelocity = state.vx * currentVelocity[0]
      + state.vy * currentVelocity[1];
    check(`current transferred momentum (v ${state.vx.toFixed(5)},${state.vy.toFixed(5)})`,
      Math.abs(projectedVelocity) > 1e-4);
  }
  engine.destroy();
}

console.log(failures ? `\n${failures} checks FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
