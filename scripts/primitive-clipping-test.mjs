// Max-radius primitives centered just beyond the loaded window must clip before
// iterating. The valid radius is deliberately set by a tall, narrow engine: an
// unclipped disc scan would examine more than 500 million coordinate pairs.

import { performance } from 'node:perf_hooks';
import { ENGINE_MAX_DIMENSION } from '../src/sand/engineLimits.js';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

const COLS = 32;
const ROWS = ENGINE_MAX_DIMENSION;
const RADIUS = ROWS;
const CX = -RADIUS;
const CY = ROWS >> 1;
const MAX_CLIPPED_MS = 1_000;
const BOX_REPETITIONS = 512;

await initSandWasm();
const { check, done } = makeChecker('primitive clipping bounds');
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 0x434c4950,
  sinksOn: false,
  infinite: false,
}));

// Warm each entry point so the measurements cover the operation, not lazy
// WebAssembly compilation.
engine.paintDisc(-1, -1, 0, MAT.SAND, true);
engine.eraseDisc(-1, -1, 0);
engine.placeMaterial(-1, -1, 0, MAT.STONE);
engine.addDiscToStoneDraft(-1, -1, 0);
engine.spawnDisc(-1, -1, 0, MAT.RIGID);
engine.spawnBox(-1, -1, 1, 1, MAT.RIGID);

const hashBefore = gridHash(engine.getGrid());
const bodiesBefore = engine._bodyCount();

const editStart = performance.now();
const maxPaintChanged = engine.paintDisc(CX, CY, RADIUS, MAT.SAND, true);
const editMs = performance.now() - editStart;
const editResults = [
  maxPaintChanged,
  engine.eraseDisc(-256, CY, 256),
  engine.placeMaterial(-256, CY, 256, MAT.STONE),
  engine.addDiscToStoneDraft(-256, CY, 256),
];

const bodyStart = performance.now();
engine.spawnDisc(CX, CY, RADIUS, MAT.RIGID);
// One unclipped box is only four times the loaded cell count. Repetition makes
// full-extents iteration unambiguously exceed the generous time bound.
for (let i = 0; i < BOX_REPETITIONS; i++)
  engine.spawnBox(-COLS, CY, COLS, ROWS, MAT.RIGID);
const bodyMs = performance.now() - bodyStart;

check('off-screen max-radius edit discs are no-ops',
  editResults.every((changed) => changed === false)
    && gridHash(engine.getGrid()) === hashBefore);
check(`max-radius edit disc clipped in ${editMs.toFixed(2)} ms`,
  editMs < MAX_CLIPPED_MS);
check('off-screen max-size rigid primitives create no bodies',
  engine._bodyCount() === bodiesBefore
    && gridHash(engine.getGrid()) === hashBefore);
check(`max-size rigid disc and ${BOX_REPETITIONS} boxes clipped in ${bodyMs.toFixed(2)} ms`,
  bodyMs < MAX_CLIPPED_MS);

engine.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
