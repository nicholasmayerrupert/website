import { createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

// Call initSandWasm before constructing fixtures. Paint through engine APIs so
// both component membership and each layer's simulation scheduling are valid.
export function createFixtureEngine(options = {}) {
  const engine = attachTestHooks(createEngineWasm({
    worldSeed: 1, sinksOn: false, infinite: false, ...options,
  }));
  engine.setBgEnabled(true);
  return engine;
}

export function paintStructuralCells(engine, layer, cells, material) {
  for (const [x, y] of cells) engine.paintDiscLayer(layer, x, y, 0, material, true);
  engine.syncComponentsLayer(layer);
}

export function paintPerforatedPlate(engine, { size, layer = 0, anchored = false }) {
  const cells = [];
  for (let y = 20; y < 20 + size; y++) for (let x = 20; x < 20 + size; x++)
    if (x % 3 !== 0 || y % 3 !== 0) cells.push([x, y]);
  if (anchored) for (let y = 20; y < engine.rows; y++) cells.push([20, y]);
  paintStructuralCells(engine, layer, cells, MAT.STONE);
}
