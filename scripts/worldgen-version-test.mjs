// A worldgen compatibility version names both raster output and semantic plans.
// Any intentional change updates the C++ version and the corresponding golden;
// an unversioned output change or a version bump without a golden fails loudly.

import {
  initSandWasm, createEngineWasm, PLANET_COUNT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

const GOLDEN_BY_VERSION = Object.freeze({
  4: 0x713a6ff7,
  5: 0xb4143f84,
});
const SEEDS = [0, 0xBED, 0xC0FFEE];
const WINDOWS = [
  [0, 0],
  [128, 0],
  [128, 0],
  [0, 96],
  [-128, 0],
  [0, 96],
];
const CONTEXT_DEPTHS = [
  -64, -32, -8, 0, 16, 48, 96, 144,
  192, 256, 384, 640, 760, 900, 1200, 1500,
];

let fingerprint = 0x811c9dc5;
function hashByte(value) {
  fingerprint ^= value & 0xff;
  fingerprint = Math.imul(fingerprint, 0x01000193) >>> 0;
}
function hashU32(value) {
  const unsigned = value >>> 0;
  hashByte(unsigned);
  hashByte(unsigned >>> 8);
  hashByte(unsigned >>> 16);
  hashByte(unsigned >>> 24);
}
function hashBytes(values) {
  for (const value of values) hashByte(value);
}
function hashContext(context) {
  hashU32(context.biomeFamily);
  hashU32(context.biome);
  hashU32(context.surfaceY);
  hashU32(context.depth);
  hashU32(context.tags);
  hashU32(context.featureKind);
  hashU32(context.siteRole);
  hashU32(context.featureId);
  hashU32(context.parentFeatureId);
  hashU32(context.bounds.left);
  hashU32(context.bounds.top);
  hashU32(context.bounds.right);
  hashU32(context.bounds.bottom);
}

await initSandWasm();
const { check, done } = makeChecker('worldgen compatibility version');
let version = null;
for (let planetId = 0; planetId < PLANET_COUNT; planetId++) {
  for (const seed of SEEDS) {
    const engine = createEngineWasm({
      cols: 160,
      rows: 128,
      worldSeed: seed,
      planetId,
      sinksOn: false,
      infinite: true,
    });
    try {
      const engineVersion = engine.getWorldGenerationVersion();
      if (version === null) version = engineVersion;
      check(`planet ${planetId} seed ${seed} reports one generation version`,
        engineVersion === version);
      hashU32(engineVersion);
      hashU32(planetId);
      hashU32(seed);
      for (const [dx, dy] of WINDOWS) {
        if (dx || dy) engine.shiftWorldXY(dx, dy);
        hashU32(engine.getWorldOffsetX());
        hashU32(engine.getWorldOffsetY());
        hashBytes(engine.getGrid());
        hashBytes(engine.getGridBg());
      }
      for (let worldX = -4096; worldX <= 4096; worldX += 71) {
        const surface = engine.worldSurfaceAbsAt(worldX);
        hashU32(worldX);
        hashU32(surface);
        for (const depth of CONTEXT_DEPTHS)
          hashContext(engine.worldContextAt(worldX, surface + depth));
      }
    } finally {
      engine.destroy();
    }
  }
}

const expected = GOLDEN_BY_VERSION[version];
check(`generation version ${version} has a committed compatibility golden`,
  Number.isInteger(expected));
check(`version ${version} raster + context fingerprint is 0x${fingerprint.toString(16).padStart(8, '0')}`,
  fingerprint === expected);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
