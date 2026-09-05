import assert from 'node:assert/strict';
import {
  decodeReplayCapsule,
  encodeReplayCapsule,
  normalizeReplayInit,
  normalizeReplayMessage,
  replayDayPhaseAt,
  REPLAY_FORMAT,
  REPLAY_PREFIX,
  REPLAY_VERSION,
  validateReplayCapsule,
} from '../src/sand/game/replayCapsule.js';
import {
  ABI_FINGERPRINT,
  ABI_VERSION,
  WEATHER,
} from '../src/sand/wasmBridge/abi.generated.js';

const init = normalizeReplayInit({
  cols: 256,
  rows: 192,
  worldSeed: 0x51f7,
  initialViewCols: 128,
  initialViewRows: 96,
  survival: false,
  creativeKind: 0,
  creativeValue: 1,
  tool: 2,
  creatureNaturalSpawning: false,
  planetId: 0,
  weatherId: WEATHER.RAIN,
  gravityScale: 1,
  missionId: 0,
  loadout: [],
  drawMode: true,
  paused: true,
  artificialDelayMs: 100,
});
assert.equal(init.initialViewCols, 128);
assert.equal(init.initialViewRows, 96);
assert.equal(normalizeReplayInit({}).initialViewCols, 0);
assert.equal(normalizeReplayInit({}).initialViewRows, 0);
assert.ok(!('paused' in init));
assert.ok(!('artificialDelayMs' in init));
assert.equal(init.weatherId, WEATHER.RAIN);
assert.equal(init.dayOverridden, false);
assert.equal(init.dayPhase, 5 / 24);
assert.equal(normalizeReplayInit({}).weatherId, WEATHER.CLEAR);
assert.equal(normalizeReplayInit({}).dayOverridden, false);
assert.equal(normalizeReplayInit({
  dayPhase: 0.5,
  dayOverridden: true,
}).dayPhase, 0.5);
assert.equal(normalizeReplayInit({
  planetId: 2,
  weatherId: WEATHER.RAIN,
}).weatherId, WEATHER.CLEAR);

assert.deepEqual(normalizeReplayMessage({ type: 'intent', intent: 'repair-base' }), { type: 'intent', intent: 'repair-base' });

const events = [
  {
    tick: 12,
    message: normalizeReplayMessage({
      type: 'control', buttons: 1, inside: true, drawMode: true,
      worldX: 120, worldY: 80, camWorldX: 4.25, camWorldY: 6.5,
      viewCols: 128, viewRows: 96, suspendStreaming: false,
    }),
  },
  {
    tick: 13,
    message: normalizeReplayMessage({
      type: 'control', buttons: 1, inside: true, drawMode: true,
      worldX: 121, worldY: 80, camWorldX: 4.5, camWorldY: 6.5,
      viewCols: 128, viewRows: 96, suspendStreaming: false,
    }),
  },
  {
    tick: 13,
    message: normalizeReplayMessage({
      type: 'input', input: {
        bits: 9, aimX: 117, aimY: 74, worldAimX: 121, worldAimY: 80,
        tool: 2, seq: 4001, moveX: 0.25, moveY: -0.5,
      },
    }),
  },
  {
    tick: 14,
    message: normalizeReplayMessage({
      type: 'input', input: {
        bits: 0, aimX: 117, aimY: 74, worldAimX: 121, worldAimY: 80,
        tool: 2, seq: 4002,
      },
    }),
  },
  { tick: 15, message: normalizeReplayMessage({ type: 'intent', intent: 'select', slot: 4 }) },
  { tick: 16, message: normalizeReplayMessage({ type: 'intent', intent: 'size', footprint: 3 }) },
  { tick: 17, message: normalizeReplayMessage({ type: 'intent', intent: 'throw', whole: true }) },
  { tick: 18, message: normalizeReplayMessage({ type: 'intent', intent: 'craft', recipe: 2, max: true }) },
  { tick: 19, message: normalizeReplayMessage({ type: 'intent', intent: 'respawn' }) },
  { tick: 20, message: normalizeReplayMessage({ type: 'intent', intent: 'add', material: 7, count: 25 }) },
  { tick: 20, message: normalizeReplayMessage({ type: 'intent', intent: 'move', from: 2, to: 5 }) },
  { tick: 21, message: normalizeReplayMessage({ type: 'intent', intent: 'pick', slot: 3, half: true }) },
  { tick: 22, message: normalizeReplayMessage({ type: 'intent', intent: 'set-player-state', state: { health: 42 } }) },
  {
    tick: 23,
    message: normalizeReplayMessage({
      type: 'edge', kind: 'down', button: 0, buttons: 1,
      inside: true, drawMode: true, worldX: 122, worldY: 81,
    }),
  },
  { tick: 24, message: normalizeReplayMessage({ type: 'config', tool: 3, drawMode: false }) },
  { tick: 24, message: normalizeReplayMessage({ type: 'weather', weatherId: WEATHER.RAIN }) },
  {
    tick: 24,
    message: normalizeReplayMessage({ type: 'day-phase', phase: 0.5, overridden: true }),
  },
  {
    tick: 25,
    message: normalizeReplayMessage({ type: 'day-phase', phase: 0.2, overridden: false }),
  },
  {
    tick: 25,
    message: normalizeReplayMessage({
      type: 'resize', cols: 320, rows: 224, resizeId: 99,
      worldCenterX: 150.5, worldCenterY: 90.5,
    }),
  },
  { tick: 26, message: normalizeReplayMessage({ type: 'test-paint-disc', material: 1, worldX: 50, worldY: 60, radius: 4 }) },
  { tick: 27, message: normalizeReplayMessage({ type: 'test-seed-reaction', material: 2, cap: 20, phase: 1 }) },
  { tick: 28, message: normalizeReplayMessage({ type: 'test-creature-runtime', simulate: true, naturalSpawn: false }) },
  { tick: 29, message: normalizeReplayMessage({ type: 'test-natural-spawn', species: 3, salt: 7, forceBreach: true }) },
  { tick: 30, message: normalizeReplayMessage({ type: 'test-step-actors', steps: 2 }) },
];

const capsule = {
  format: REPLAY_FORMAT,
  version: REPLAY_VERSION,
  abiVersion: ABI_VERSION,
  abiFingerprint: ABI_FINGERPRINT,
  init,
  turns: 500_000,
  events,
  gates: [
    { start: 0, end: 2, flags: 1 },
    { start: 400_000, end: 400_002, flags: 3 },
  ],
  view: { cameraWorldX: 100, cameraWorldY: 70, viewCols: 128, viewRows: 96, zoom: 1 },
  final: {
    tick: 500_000,
    actorTick: 500_000,
    cols: 320,
    rows: 224,
    gridHash: 0x12345678,
    worldOffsetX: -256,
    worldOffsetY: 128,
    componentCount: 10,
    componentCellCount: 200,
    crossBondCount: 2,
    playerCount: 0,
    itemCount: 0,
    creatureCount: 1,
    projectileCount: 0,
  },
};

const text = await encodeReplayCapsule(capsule);
assert.ok(text.startsWith(REPLAY_PREFIX));
assert.ok(text.length < 1_500, `compact replay text should stay event-sized, got ${text.length}`);
assert.deepEqual(await decodeReplayCapsule(`\n${text}\n`), capsule);

const nativeCompressionStream = globalThis.CompressionStream;
let plainText;
try {
  globalThis.CompressionStream = undefined;
  plainText = await encodeReplayCapsule(capsule);
} finally {
  globalThis.CompressionStream = nativeCompressionStream;
}
assert.ok(plainText.startsWith(`${REPLAY_PREFIX}json:`));
assert.deepEqual(await decodeReplayCapsule(plainText), capsule);

const rawInput = {
  type: 'input',
  input: {
    bits: 4, aimX: 12, aimY: 13, worldAimX: 112, worldAimY: 113,
    tool: 2, seq: 999,
  },
};
assert.deepEqual(normalizeReplayMessage(rawInput), {
  type: 'input', input: { bits: 4, worldAimX: 112, worldAimY: 113, tool: 2 },
});
const survivalControl = normalizeReplayMessage({
  type: 'control', worldX: 10, worldY: 11, buttons: 3, inside: true, drawMode: true,
  camWorldX: 1.25, camWorldY: 2.5, viewCols: 100, viewRows: 80,
  suspendStreaming: false,
}, true);
assert.deepEqual(survivalControl, {
  type: 'control', camWorldX: 1.25, camWorldY: 2.5,
  viewCols: 100, viewRows: 80, suspendStreaming: false,
});
assert.equal(normalizeReplayMessage({ type: 'config', paused: true, artificialDelayMs: 50 }), null);
assert.deepEqual(
  normalizeReplayMessage({ type: 'weather', weatherId: WEATHER.RAIN }),
  { type: 'weather', weatherId: WEATHER.RAIN },
);
assert.deepEqual(
  normalizeReplayMessage({ type: 'day-phase', phase: 1.25, overridden: 1 }),
  { type: 'day-phase', phase: 0.25, overridden: true },
);
assert.deepEqual(
  replayDayPhaseAt(init, events, 0),
  { phase: 5 / 24, overridden: false },
);
assert.deepEqual(
  replayDayPhaseAt(init, events, 24),
  { phase: 0.5, overridden: true },
);
assert.deepEqual(
  replayDayPhaseAt(init, events, 25),
  { phase: 0.2, overridden: false },
);
assert.deepEqual(
  replayDayPhaseAt({ dayPhase: 0.62, dayOverridden: true }, [], 10),
  { phase: 0.62, overridden: true },
);
assert.throws(
  () => validateReplayCapsule({
    ...capsule,
    events: [{ tick: 1, message: { type: 'weather', weatherId: 99 } }],
  }),
  /invalid authority event/,
);
assert.deepEqual(
  normalizeReplayMessage({ type: 'resize', cols: 100, rows: 80, resizeId: 44 }),
  { type: 'resize', cols: 100, rows: 80 },
);

const legacyCapsule = {
  ...capsule,
  version: 2,
  events: [{
    tick: 12,
    message: {
      type: 'input',
      input: {
        bits: 1, aimX: 12, aimY: 13, worldAimX: 112, worldAimY: 113,
        tool: 2, seq: 55,
      },
    },
  }],
};
const legacyPacked = {
  ...legacyCapsule,
  events: legacyCapsule.events.map((event) => [event.tick, event.message]),
  gates: legacyCapsule.gates.map((gate) => [gate.start, gate.end, gate.flags]),
};
const legacyText = `SAND-REPLAY-2:${JSON.stringify(legacyPacked)}`;
assert.deepEqual(await decodeReplayCapsule(legacyText), legacyCapsule);

const busyEvents = [];
for (let tick = 0; tick < 3_600; tick++) {
  busyEvents.push({
    tick,
    message: normalizeReplayMessage({
      type: 'control', camWorldX: 100 + tick * 0.125,
      camWorldY: 50 + Math.sin(tick / 30), viewCols: 256, viewRows: 192,
      suspendStreaming: false,
    }, true),
  });
  busyEvents.push({
    tick,
    message: normalizeReplayMessage({
      type: 'input', input: {
        bits: 8, aimX: 120, aimY: 80,
        worldAimX: 220 + tick, worldAimY: 130, tool: 2, seq: tick + 1,
      },
    }, true),
  });
}
const busyCapsule = {
  ...capsule,
  init: { ...init, survival: true },
  turns: 3_600,
  events: busyEvents,
  gates: [],
  final: { ...capsule.final, tick: 3_600, actorTick: 3_600 },
};
const busyText = await encodeReplayCapsule(busyCapsule);
assert.ok(busyText.startsWith(`${REPLAY_PREFIX}gzip:`));
assert.ok(busyText.length < 100_000, `one busy minute should stay below 100 KB, got ${busyText.length}`);
assert.deepEqual(await decodeReplayCapsule(busyText), busyCapsule);

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
assert.throws(
  () => validateReplayCapsule({
    ...capsule,
    init: { ...init, planetId: 2, weatherId: WEATHER.RAIN },
  }),
  /weather is invalid for its planet/,
);
assert.throws(
  () => validateReplayCapsule({ ...capsule, abiFingerprint: 1 }),
  /incompatible sand engine build/,
);
assert.equal(
  validateReplayCapsule({ ...capsule, abiFingerprint: 1 }, { requireCompatibleAbi: false }).abiFingerprint,
  1,
);
await assert.rejects(() => decodeReplayCapsule('SAND-REPLAY-1:{}'), /SAND-REPLAY-3/);

console.log(`replay capsule v3 compact round trip: ok (${busyText.length} bytes / busy minute)`);

assert.throws(() => validateReplayCapsule({ ...capsule, init: { ...capsule.init, contentHash: (capsule.init.contentHash ^ 1) >>> 0 } }), /different authored game content/);
const sceneCapsule = { ...capsule, events: [{ tick: 1, message: { type: 'intent', intent: 'preview-scene', worldX: -480, worldY: 298 } }] };
assert.deepEqual((await decodeReplayCapsule(await encodeReplayCapsule(sceneCapsule))).events, sceneCapsule.events);
assert.throws(() => validateReplayCapsule({ ...sceneCapsule, events: [{ tick: 1, message: { type: 'intent', intent: 'preview-scene', worldX: NaN, worldY: 298 } }] }), /invalid authority event/);
