import assert from 'node:assert/strict';
import {
  decodeReplayCapsule,
  encodeReplayCapsule,
  REPLAY_FORMAT,
  REPLAY_PREFIX,
  REPLAY_VERSION,
  validateReplayCapsule,
} from '../src/sand/game/replayCapsule.js';
import {
  ABI_FINGERPRINT,
  ABI_VERSION,
} from '../src/sand/wasmBridge/abi.generated.js';

const capsule = {
  format: REPLAY_FORMAT,
  version: REPLAY_VERSION,
  abiVersion: ABI_VERSION,
  abiFingerprint: ABI_FINGERPRINT,
  init: { cols: 256, rows: 192, worldSeed: 0x51f7, survival: false },
  turns: 500_000,
  events: [
    {
      tick: 12,
      message: {
        type: 'control', buttons: 1, inside: true, worldX: 120, worldY: 80,
      },
    },
    {
      tick: 28,
      message: {
        type: 'control', buttons: 0, inside: true, worldX: 120, worldY: 80,
      },
    },
    { tick: 500_000, message: { type: 'config', paused: true } },
  ],
  gates: [
    { start: 0, end: 2, flags: 1 },
    { start: 400_000, end: 400_002, flags: 3 },
  ],
  view: { cameraWorldX: 100, cameraWorldY: 70, zoom: 1 },
  final: {
    tick: 500_000,
    actorTick: 500_000,
    cols: 256,
    rows: 192,
    gridHash: 0x12345678,
    worldOffsetX: -256,
    worldOffsetY: 128,
  },
};

const text = encodeReplayCapsule(capsule);
assert.ok(text.startsWith(`${REPLAY_PREFIX}{`));
assert.ok(text.includes('"turns":500000'));
assert.ok(text.includes('"events":[[12,'));
assert.ok(!text.includes('gzip:'));
assert.ok(text.length < 1_000, `plain replay text should stay event-sized, got ${text.length}`);
assert.deepEqual(decodeReplayCapsule(`\n${text}\n`), capsule);

const overlappingGates = {
  ...capsule,
  gates: [
    { start: 10, end: 20, flags: 1 },
    { start: 19, end: 21, flags: 2 },
  ],
};
assert.throws(
  () => validateReplayCapsule(overlappingGates),
  /invalid transport gate range/,
);
assert.throws(() => decodeReplayCapsule('SAND-REPLAY-1:{}'), /SAND-REPLAY-2/);

console.log('replay capsule plain-JSON round trip and sparse timeline: ok');
