import { MAT } from '../src/sand/materials.js';
import {
  FIRST_UNDEFINED_MATERIAL_ID, MAT_DEFINED, TABLE_SIZE, isMaterialId,
} from '../src/sand/materials.generated.js';
import {
  applyDiffMessage,
  applyWorldMessage,
  bytesToB64,
  validateWorldMessage,
} from '../src/sand/net/worldSync.js';
import {
  isValidWorldDiff,
  isValidWorldRle,
  worldRleHash,
} from '../src/sand/worldPacketValidation.js';
import { prepareMirrorShift } from '../src/sand/worker/mirrorShift.js';
import { createEngineWasm, initSandWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('world packet validation');
const HAS_UNDEFINED_MATERIAL_BYTE = FIRST_UNDEFINED_MATERIAL_ID >= 0
  && FIRST_UNDEFINED_MATERIAL_ID < TABLE_SIZE;
check('material byte validity supports sparse and full catalogues',
  HAS_UNDEFINED_MATERIAL_BYTE
    ? !isMaterialId(FIRST_UNDEFINED_MATERIAL_ID)
    : MAT_DEFINED.length === TABLE_SIZE
      && MAT_DEFINED.every((defined) => defined === 1));

const world = Uint8Array.of(
  4, 0, 0, 0, MAT.SAND,
  4, 0, 0, 0, MAT.EMPTY,
);
check('two-layer RLE accepts defined materials', isValidWorldRle(world, 4));
check('two-layer RLE rejects truncation', !isValidWorldRle(world.subarray(0, 5), 4));
const invalidWorldMaterial = world.slice();
if (HAS_UNDEFINED_MATERIAL_BYTE)
  invalidWorldMaterial[4] = FIRST_UNDEFINED_MATERIAL_ID;
else
  invalidWorldMaterial[0] = 0;
check(HAS_UNDEFINED_MATERIAL_BYTE
  ? 'two-layer RLE rejects undefined material slots'
  : 'two-layer RLE rejects malformed runs at full material capacity',
  !isValidWorldRle(invalidWorldMaterial, 4));
const invalidBackgroundWorldMaterial = world.slice();
if (HAS_UNDEFINED_MATERIAL_BYTE)
  invalidBackgroundWorldMaterial[9] = FIRST_UNDEFINED_MATERIAL_ID;
else
  invalidBackgroundWorldMaterial[5] = 0;
check('two-layer RLE validates the background after a valid foreground',
  !isValidWorldRle(invalidBackgroundWorldMaterial, 4));

const diff = Uint8Array.of(
  1, 0,
  0, 0, 0, 0, 1, 0, 1, 0, MAT.WATER,
  0, 0,
);
check('two-layer diff accepts a bounded material rectangle', isValidWorldDiff(diff, 2, 2));
const invalidDiffMaterial = diff.slice();
if (HAS_UNDEFINED_MATERIAL_BYTE)
  invalidDiffMaterial[10] = FIRST_UNDEFINED_MATERIAL_ID;
else
  invalidDiffMaterial[6] = 0;
check(HAS_UNDEFINED_MATERIAL_BYTE
  ? 'two-layer diff rejects undefined material slots'
  : 'two-layer diff rejects malformed rectangles at full material capacity',
  !isValidWorldDiff(invalidDiffMaterial, 2, 2));
const invalidBackgroundDiffMaterial = Uint8Array.of(
  0, 0,
  1, 0,
  0, 0, 0, 0, 1, 0, 1, 0,
  HAS_UNDEFINED_MATERIAL_BYTE ? FIRST_UNDEFINED_MATERIAL_ID : MAT.WATER,
);
if (!HAS_UNDEFINED_MATERIAL_BYTE) invalidBackgroundDiffMaterial[8] = 0;
check('two-layer diff validates the background after a valid foreground',
  !isValidWorldDiff(invalidBackgroundDiffMaterial, 2, 2));
check('two-layer diff rejects truncation', !isValidWorldDiff(diff.subarray(0, -1), 2, 2));

{
  const foreground = Uint8Array.of(1, 2, 3, 4);
  const background = Uint8Array.of(5, 6, 7, 8);
  let offset = null;
  const mirror = {
    cols: 2,
    rows: 2,
    getGrid: () => foreground,
    getGridBg: () => background,
    setMirrorWorldOffset(x, y) { offset = [x, y]; },
  };
  const shift = {
    cols: 2, rows: 2, shiftDx: 1, shiftDy: 0,
    worldOffsetX: 12, worldOffsetY: -4,
  };
  check('invalid shift diff is rejected before either mirror layer moves',
    !prepareMirrorShift(mirror, shift, invalidBackgroundDiffMaterial)
      && foreground.join(',') === '1,2,3,4'
      && background.join(',') === '5,6,7,8'
      && offset === null);
  check('diagonal shift is rejected before either mirror layer moves',
    !prepareMirrorShift(mirror, { ...shift, shiftDy: 1 }, diff)
      && foreground.join(',') === '1,2,3,4'
      && background.join(',') === '5,6,7,8'
      && offset === null);
  const oversizedDiff = Uint8Array.of(
    9, 0,
    ...Array.from({ length: 9 }, () => [
      0, 0, 0, 0, 1, 0, 1, 0, MAT.WATER,
    ]).flat(),
    0, 0,
  );
  check('oversized shift diff is rejected before either mirror layer moves',
    isValidWorldDiff(oversizedDiff, 2, 2)
      && !prepareMirrorShift(mirror, shift, oversizedDiff)
      && foreground.join(',') === '1,2,3,4'
      && background.join(',') === '5,6,7,8'
      && offset === null);
  check('validated shift moves both mirror layers into the new frame',
    prepareMirrorShift(mirror, shift, diff)
      && foreground.join(',') === '2,0,4,0'
      && background.join(',') === '6,0,8,0'
      && offset?.join(',') === '12,-4');
}

const message = {
  cols: 2, rows: 2, data: bytesToB64(world), hash: worldRleHash(world, 4),
};
check('world envelope validates its decoded packet', validateWorldMessage(message) !== null);
check('world envelope verifies its advertised hash before a rebuild',
  validateWorldMessage(message, { verifyHash: true }) !== null
    && validateWorldMessage({ ...message, hash: message.hash ^ 1 }, { verifyHash: true }) === null);
check(HAS_UNDEFINED_MATERIAL_BYTE
  ? 'world envelope rejects an undefined material'
  : 'world envelope rejects malformed runs at full material capacity',
  validateWorldMessage({ ...message, data: bytesToB64(invalidWorldMaterial) }) === null);

let worldCalls = 0;
const rejectingWorldEngine = {
  cols: 2,
  rows: 2,
  applyWorld() { worldCalls++; return false; },
  gridHash: () => message.hash,
};
check('native world rejection propagates to the caller',
  !applyWorldMessage(rejectingWorldEngine, message) && worldCalls === 1);
check('direct malformed world calls stop at the JS boundary',
  !applyWorldMessage(rejectingWorldEngine, {
    ...message, data: bytesToB64(invalidWorldMaterial),
  }) && worldCalls === 1);
check('explicitly prevalidated bytes still propagate native rejection',
  !applyWorldMessage(rejectingWorldEngine, message, {
    validatedBytes: invalidWorldMaterial,
  }) && worldCalls === 2);

let diffCalls = 0;
const rejectingDiffEngine = {
  cols: 2,
  rows: 2,
  applyDiff() { diffCalls++; return false; },
  gridHash: () => message.hash,
};
check('native diff rejection propagates to the caller',
  !applyDiffMessage(rejectingDiffEngine, { data: bytesToB64(diff), hash: message.hash })
    && diffCalls === 1);
check('native validation rejects a malformed decoded diff',
  !applyDiffMessage(rejectingDiffEngine, {
    data: bytesToB64(invalidDiffMaterial), hash: message.hash,
  }) && diffCalls === 2);

await initSandWasm();
const native = createEngineWasm({
  cols: 32, rows: 32, worldSeed: 0x5041434b, sinksOn: false, infinite: false,
});
const nativeHash = native.gridHash();
const nativeWorld = native.serializeWorld();
let backgroundOffset = 0, filled = 0;
while (filled < native.cols * native.rows) {
  const run = (nativeWorld[backgroundOffset]
    | (nativeWorld[backgroundOffset + 1] << 8)
    | (nativeWorld[backgroundOffset + 2] << 16)
    | (nativeWorld[backgroundOffset + 3] << 24)) >>> 0;
  filled += run;
  backgroundOffset += 5;
}
const nativeBadBackgroundWorld = nativeWorld.slice();
if (HAS_UNDEFINED_MATERIAL_BYTE)
  nativeBadBackgroundWorld[backgroundOffset + 4] = FIRST_UNDEFINED_MATERIAL_ID;
else
  nativeBadBackgroundWorld.fill(0, backgroundOffset, backgroundOffset + 4);
check('native world rejection is transactional when only the background is invalid',
  native.applyWorld(nativeBadBackgroundWorld) === false && native.gridHash() === nativeHash);
check('native diff rejection is transactional when only the background is invalid',
  native.applyDiff(invalidBackgroundDiffMaterial) === false && native.gridHash() === nativeHash);
native.destroy();

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
