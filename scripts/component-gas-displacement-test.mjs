// Structural bodies sweep through gas without receiving support, but relocate
// persistent gas instead of deleting it. The rule is identical for ordinary
// and cross-layer bodies.
//
// Run: node scripts/component-gas-displacement-test.mjs

import { initSandWasm, createEngineWasm as createEngineWasmRaw, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 200, ROWS = 90, ROD_Y = 30, X0 = 30, X1 = 170, GAS_X = 42;
const GAS_Y = ROD_Y + 1;
await initSandWasm();
const { check, done } = makeChecker('structural body gas sweep');

const makeEngine = (bgEnabled = false) => {
  const e = attachTestHooks(createEngineWasmRaw({
    cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false,
  }));
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
  for (let k = 0; k < grid.length; k++) if (grid[k] === MAT.METHANE) cells.push([k % COLS, (k / COLS) | 0]);
  return cells;
};

// Single-layer body.
{
  const e = makeEngine();
  placeRod(e, 0);
  e.placeMaterial(GAS_X, GAS_Y, 0, MAT.METHANE);
  let crossed = false;
  for (let i = 0; i < 12; i++) {
    e.step((i + 1) * 16);
    crossed ||= e._bodyOwnerGrid()[GAS_Y * COLS + GAS_X] >= 0;
  }
  const gas = gasCells(e.getGrid());
  check(`single-layer body relocated the gas (${JSON.stringify(gas)})`,
    crossed && gas.length === 1
      && (gas[0][0] !== GAS_X || gas[0][1] !== GAS_Y)
      && e._bodyOwnerGrid()[gas[0][1] * COLS + gas[0][0]] < 0);
  e.destroy();
}

// Fully overlapping rods become one cross-layer body and apply the same rule.
{
  const e = makeEngine(true);
  placeRod(e, 0);
  placeRod(e, 1);
  e.placeMaterial(GAS_X, GAS_Y, 0, MAT.METHANE, 0);
  e.placeMaterial(GAS_X, GAS_Y, 0, MAT.METHANE, 1);
  let crossedFg = false, crossedBg = false;
  for (let i = 0; i < 12; i++) {
    e.step((i + 1) * 16);
    crossedFg ||= e._bodyOwnerGrid(0)[GAS_Y * COLS + GAS_X] >= 0;
    crossedBg ||= e._bodyOwnerGrid(1)[GAS_Y * COLS + GAS_X] >= 0;
  }
  const fgGas = gasCells(e.getGrid());
  const bgGas = gasCells(e.getGridBg());
  check(`cross-layer body relocated gas in both layers (fg ${JSON.stringify(fgGas)}, bg ${JSON.stringify(bgGas)})`,
    crossedFg && crossedBg && fgGas.length === 1 && bgGas.length === 1
      && (fgGas[0][0] !== GAS_X || fgGas[0][1] !== GAS_Y)
      && (bgGas[0][0] !== GAS_X || bgGas[0][1] !== GAS_Y)
      && e._bodyOwnerGrid(0)[fgGas[0][1] * COLS + fgGas[0][0]] < 0
      && e._bodyOwnerGrid(1)[bgGas[0][1] * COLS + bgGas[0][0]] < 0);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
