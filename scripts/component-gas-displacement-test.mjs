// Structural bodies sweep through gas without receiving support or treating it
// as a conserved displaced medium. The rule is identical for ordinary and
// cross-layer bodies.
//
// Run: node scripts/component-gas-displacement-test.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 200, ROWS = 90, ROD_Y = 30, X0 = 30, X1 = 170, GAS_X = 42;
await initSandWasm();
const { check, done } = makeChecker('structural body gas sweep');

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

// Single-layer body.
{
  const e = makeEngine();
  placeRod(e, 0);
  e.placeMaterial(GAS_X, ROD_Y + 1, 0, MAT.STEAM);
  for (let i = 0; i < 12; i++) e.step((i + 1) * 16);
  const gas = gasCells(e.getGrid());
  check(`single-layer body swept the gas (${JSON.stringify(gas)})`, gas.length === 0);
  e.destroy();
}

// Fully overlapping rods become one cross-layer body and apply the same rule.
{
  const e = makeEngine(true);
  placeRod(e, 0);
  placeRod(e, 1);
  e.placeMaterial(GAS_X, ROD_Y + 1, 0, MAT.STEAM, 0);
  e.placeMaterial(GAS_X, ROD_Y + 1, 0, MAT.STEAM, 1);
  for (let i = 0; i < 12; i++) e.step((i + 1) * 16);
  const fgGas = gasCells(e.getGrid());
  const bgGas = gasCells(e.getGridBg());
  check(`cross-layer body swept gas in both layers (fg ${JSON.stringify(fgGas)}, bg ${JSON.stringify(bgGas)})`,
    fgGas.length === 0 && bgGas.length === 0);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
