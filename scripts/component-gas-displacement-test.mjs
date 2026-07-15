// Falling component solids must swap displaced gas into the nearest trailing
// air cell. In particular, a long horizontal rod must not teleport gas from
// one end to the other (or erase it for a cross-layer-bonded assembly).
//
// Run: node scripts/component-gas-displacement-test.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 200, ROWS = 90, ROD_Y = 30, X0 = 30, X1 = 170, GAS_X = 42;
await initSandWasm();
const { check, done } = makeChecker('component gas displacement');

const makeEngine = (bgEnabled = false) => {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
  e.setBgEnabled(bgEnabled);
  return e;
};
const placeRod = (e, layer) => {
  for (let x = X0; x <= X1; x++) e.placeMaterial(x, ROD_Y, 0, MAT.STONE, layer);
  // Short teeth keep the gas from taking its ordinary same-row random walk
  // before the cross-layer mover runs at the end of the tick.
  e.placeMaterial(GAS_X - 1, ROD_Y + 1, 0, MAT.STONE, layer);
  e.placeMaterial(GAS_X + 1, ROD_Y + 1, 0, MAT.STONE, layer);
  e.syncComponentsLayer(layer);
};
const gasCells = (grid) => {
  const cells = [];
  for (let k = 0; k < grid.length; k++) if (grid[k] === MAT.STEAM) cells.push([k % COLS, (k / COLS) | 0]);
  return cells;
};

// Single-layer assembly: movement happens before the loose-gas pass.
{
  const e = makeEngine();
  placeRod(e, 0);
  e.placeMaterial(GAS_X, ROD_Y + 1, 0, MAT.STEAM);
  e.step(16);
  const gas = gasCells(e.getGrid());
  check(`single-layer gas is conserved (${JSON.stringify(gas)})`, gas.length === 1);
  check(
    `single-layer gas swaps into the same-column wake (${JSON.stringify(gas)})`,
    gas.length === 1 && gas[0][0] === GAS_X && gas[0][1] === ROD_Y,
  );
  e.destroy();
}

// Fully overlapping rods are cross-layer bonded and use the joint mover after
// both loose passes. Gas in either layer must receive the same local swap.
{
  const e = makeEngine(true);
  placeRod(e, 0);
  placeRod(e, 1);
  e.placeMaterial(GAS_X, ROD_Y + 1, 0, MAT.STEAM, 0);
  e.placeMaterial(GAS_X, ROD_Y + 1, 0, MAT.STEAM, 1);
  e.step(16);
  const fgGas = gasCells(e.getGrid());
  const bgGas = gasCells(e.getGridBg());
  check(`cross-layer fg gas is conserved (${JSON.stringify(fgGas)})`, fgGas.length === 1);
  check(`cross-layer bg gas is conserved (${JSON.stringify(bgGas)})`, bgGas.length === 1);
  check(
    `cross-layer gas swaps locally in both layers (fg ${JSON.stringify(fgGas)}, bg ${JSON.stringify(bgGas)})`,
    fgGas.length === 1 && bgGas.length === 1
      && fgGas[0][0] === GAS_X && fgGas[0][1] === ROD_Y
      && bgGas[0][0] === GAS_X && bgGas[0][1] === ROD_Y,
  );
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
