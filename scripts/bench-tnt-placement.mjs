// Isolate TNT draft finalization against static and moving perforated solids.
// Usage: node scripts/bench-tnt-placement.mjs [40 80 160 240]
// Report release cost and verify one reconstruction per touched moving body.
import { performance } from 'node:perf_hooks';
import {
  initSandWasm, createEngineWasm, MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { CREATIVE_KIND } from '../src/sand/wasmBridge/abi.generated.js';

const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [40, 80];
if (sizes.some((size) => !Number.isInteger(size) || size < 20 || size > 480))
  throw new Error('Fixture sizes must be integers from 20 through 480.');

await initSandWasm();

for (const size of sizes) {
  for (const moving of [false, true]) {
    const cols = size + 40, rows = size + 60;
    const engine = attachTestHooks(createEngineWasm({
      cols, rows, worldSeed: 1, sinksOn: false,
      infinite: false, storageRole: 'authority',
    }));
    try {
      const grid = engine.getGrid();
      grid.fill(MAT.EMPTY);
      for (let y = 20; y < 20 + size; y++)
        for (let x = 20; x < 20 + size; x++)
          if (x % 3 !== 0 || y % 3 !== 0)
            grid[y * cols + x] = MAT.STONE;
      // A narrow connection to the floor holds the static control in place.
      if (!moving)
        for (let y = 20; y < rows; y++) grid[y * cols + 20] = MAT.STONE;
      engine.syncComponents();
      engine.stepWorld();
      const bodiesBefore = engine._bodyCount();
      if (bodiesBefore !== (moving ? 1 : 0))
        throw new Error(`Unexpected fixture topology: ${bodiesBefore} bodies`);
      const idBefore = moving ? engine._bodyIdLayer(0, 0) : null;
      const tickBefore = engine.getTick();

      engine.setCreativeMaterial(CREATIVE_KIND.MATERIAL, MAT.TNT);
      const draftStarted = performance.now();
      let first = true;
      for (let y = 22; y < 18 + size; y += 3) {
        const endpoints = y % 2 ? [22, 17 + size] : [17 + size, 22];
        for (const x of endpoints) {
          if (first) {
            engine.pointerDown(x, y, 0);
            first = false;
          } else engine.pointerDraft(x, y);
        }
      }
      const draftMs = performance.now() - draftStarted;
      const draftCells = engine.getStoneDraftCells().length;
      console.log(JSON.stringify({ size, moving, draftCells, phase: 'release-start' }));
      const releaseStarted = performance.now();
      engine.pointerUp(0);
      const releaseMs = performance.now() - releaseStarted;
      const bodiesAfter = engine._bodyCount();
      const idAfter = moving && bodiesAfter === 1 ? engine._bodyIdLayer(0, 0) : null;
      let tntCells = 0;
      for (const cell of engine.getGrid()) if (cell === MAT.TNT) tntCells++;
      if (bodiesAfter !== bodiesBefore || engine.getTick() !== tickBefore
          || tntCells !== draftCells)
        throw new Error('Placement changed the fixture topology, tick, or cell count unexpectedly.');
      if (moving && idAfter - idBefore !== 1)
        throw new Error('One placement gesture reconstructed the same body more than once.');
      console.log(JSON.stringify({
        size, moving, draftCells, tntCells, bodiesBefore, bodiesAfter,
        bodyReplacements: moving ? idAfter - idBefore : 0,
        draftMs, releaseMs,
      }));
    } finally {
      engine.destroy();
    }
  }
}
