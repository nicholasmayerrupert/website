// Component topology repair scales with the topology being changed, both for
// local blast splits and for baking many disconnected material partitions.

import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

const REPEATS = 2;
const CASES = [
  { cols: 512, rows: 384, components: 48_260, hash: 2_361_786_025 },
  { cols: 1536, rows: 1024, components: 390_660, hash: 662_331_986 },
];
const BAKE_CASES = [
  {
    width: 40,
    height: 20,
    components: 847,
    hash: 2_191_850_549,
    idHash: 1_145_644_215,
    repeats: 3,
  },
  {
    width: 160,
    height: 80,
    components: 12_856,
    hash: 705_853_837,
    idHash: 3_397_408_029,
    repeats: 2,
  },
];

await initSandWasm();
const { check, done } = makeChecker('blast component-repair scaling');

const run = ({ cols, rows }) => {
  const engine = attachTestHooks(createEngineWasmRaw({
    cols,
    rows,
    worldSeed: 1,
    sinksOn: false,
    infinite: false,
  }));
  const grid = engine.getGrid();
  grid.fill(MAT.EMPTY);
  for (let y = 2; y < rows - 2; y += 2)
    for (let x = 2; x < cols - 2; x += 2)
      grid[y * cols + x] = MAT.STONE;
  engine.syncComponents();
  const components = engine._componentCount(0);
  const start = performance.now();
  engine._detonateTnt(cols >> 1, rows >> 1);
  const elapsed = performance.now() - start;
  const result = {
    elapsed,
    components,
    componentsAfter: engine._componentCount(0),
    hash: gridHash(engine.getGrid()),
  };
  engine.destroy();
  return result;
};

const results = CASES.map((fixture) =>
  Array.from({ length: REPEATS }, () => run(fixture)));
for (let fixture = 0; fixture < CASES.length; fixture++) {
  const expected = CASES[fixture], runs = results[fixture];
  check(`${expected.cols}x${expected.rows} fixture has ${expected.components} slots`,
    runs.every((result) => result.components === expected.components
      && result.componentsAfter === expected.components));
  check(`${expected.cols}x${expected.rows} blast result is deterministic`,
    runs.every((result) => result.hash === expected.hash));
}

const fastest = (runs) => Math.min(...runs.map((result) => result.elapsed));
const smallMs = fastest(results[0]), largeMs = fastest(results[1]);
check(`local blast work stays bounded as unrelated registry slots grow `
    + `(${largeMs.toFixed(1)} ms vs ${smallMs.toFixed(1)} ms)`,
  largeMs <= smallMs * 2.5 + 50);

const componentIdHash = (engine) => {
  let hash = 0x811c9dc5 >>> 0;
  for (let component = 0; component < engine._componentCount(0); component++) {
    hash ^= engine._componentId(0, component);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

const bakeMaterials = [
  MAT.BRICK,
  MAT.WOOD,
  MAT.IRON_ORE,
  MAT.COPPER_ORE,
];
const runBake = ({ width, height }) => {
  const cols = width + 24, rows = height + 36;
  const x0 = 12, y0 = 8, floorY = y0 + height + 5;
  const engine = attachTestHooks(createEngineWasmRaw({
    cols,
    rows,
    worldSeed: 1,
    sinksOn: false,
    infinite: false,
    gravityScale: 1,
  }));
  const grid = engine.getGrid();
  grid.fill(MAT.EMPTY);
  for (let y = floorY; y < rows; y++)
    for (let x = 0; x < cols; x++)
      grid[y * cols + x] = MAT.STONE;
  for (let y = y0; y < y0 + height; y++)
    for (let x = x0; x < x0 + width; x++)
      grid[y * cols + x] = bakeMaterials[(x & 1) | ((y & 1) << 1)];
  engine.syncComponents();

  let bodyCells = 0, bakedAt = -1, elapsed = Infinity;
  for (let tick = 0; tick < 500; tick++) {
    const bodiesBefore = engine._bodyCount();
    const start = performance.now();
    engine.stepWorld();
    const stepElapsed = performance.now() - start;
    const bodiesAfter = engine._bodyCount();
    if (!bodyCells && bodiesAfter > 0)
      bodyCells = engine._bodyState(0)?.nPts ?? 0;
    if (bodiesBefore > 0 && bodiesAfter === 0) {
      bakedAt = tick;
      elapsed = stepElapsed;
      break;
    }
  }
  const result = {
    bodyCells,
    bakedAt,
    elapsed,
    components: engine._componentCount(0),
    hash: gridHash(engine.getGrid()),
    idHash: componentIdHash(engine),
  };
  engine.destroy();
  return result;
};

const bakeResults = BAKE_CASES.map((fixture) =>
  Array.from({ length: fixture.repeats }, () => runBake(fixture)));
for (let fixture = 0; fixture < BAKE_CASES.length; fixture++) {
  const expected = BAKE_CASES[fixture], runs = bakeResults[fixture];
  check(`${expected.width}x${expected.height} mixed body bakes all partitions`,
    runs.every((result) => result.bodyCells
        === expected.width * expected.height
      && result.bakedAt >= 0
      && result.components === expected.components));
  check(`${expected.width}x${expected.height} bake preserves slot and grid order`,
    runs.every((result) => result.hash === expected.hash
      && result.idHash === expected.idHash));
}

const smallBakeMs = fastest(bakeResults[0]);
const largeBakeMs = fastest(bakeResults[1]);
check(`baked partition allocation stays near linear `
    + `(${largeBakeMs.toFixed(1)} ms vs ${smallBakeMs.toFixed(1)} ms)`,
  largeBakeMs <= smallBakeMs * 48 + 100);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
