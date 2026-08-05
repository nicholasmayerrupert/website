// Occupied rigid cells represent filled unit squares in both raster and
// collision geometry, so mass properties include each square's intrinsic
// moment of inertia as well as its offset from the body centroid.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const close = (actual, expected, tolerance = 1e-12) =>
  Math.abs(actual - expected) <= tolerance;

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols: 64,
  rows: 64,
  worldSeed: 0x1a37,
  sinksOn: false,
  infinite: false,
}));

const shapes = [
  {
    label: 'one filled cell',
    cells: [[16, 16]],
    inertiaUnits: 1 / 6,
  },
  {
    label: 'three-cell rod',
    cells: [[24, 16], [25, 16], [26, 16]],
    inertiaUnits: 2.5,
  },
  {
    label: 'two-by-two block',
    cells: [[36, 16], [37, 16], [36, 17], [37, 17]],
    inertiaUnits: 8 / 3,
  },
];

let failures = 0;
let cellMass = 0;
for (const shape of shapes) {
  engine.spawnBody(shape.cells);
  const state = engine._bodyState(engine._bodyCount() - 1);
  if (!cellMass) cellMass = 1 / state.invMass;
  const expectedInvMass = 1 / (cellMass * shape.cells.length);
  const expectedInvInertia = 1 / (cellMass * shape.inertiaUnits);
  const massOk = close(state.invMass, expectedInvMass);
  const inertiaOk = close(state.invInertia, expectedInvInertia);
  if (!massOk || !inertiaOk) failures++;
  console.log(`${massOk && inertiaOk ? 'ok  ' : 'FAIL'} ${shape.label}: `
    + `invMass ${state.invMass.toFixed(12)}, `
    + `invInertia ${state.invInertia.toFixed(12)}`);
}

engine.destroy();
if (failures) process.exit(1);
console.log('\nall rigid inertia checks passed');
