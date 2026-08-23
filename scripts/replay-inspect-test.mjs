import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeReplayCapsule,
  encodeReplayCapsule,
  normalizeReplayInit,
  normalizeReplayMessage,
  REPLAY_FORMAT,
  REPLAY_PREFIX,
  REPLAY_VERSION,
  validateReplayCapsule,
} from '../src/sand/game/replayCapsule.js';
import {
  formatReplayInspectText,
  summarizeReplayCapsule,
} from '../src/sand/game/replayInspect.js';
import {
  ABI_FINGERPRINT,
  ABI_VERSION,
  WEATHER,
} from '../src/sand/wasmBridge/abi.generated.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const init = normalizeReplayInit({
  cols: 256,
  rows: 192,
  worldSeed: 0x51f7,
  survival: false,
  creativeKind: 0,
  creativeValue: 1,
  tool: 2,
  planetId: 0,
  weatherId: WEATHER.RAIN,
  gravityScale: 1,
  missionId: 0,
  loadout: [{ itemKind: 0, count: 12, material: 2 }],
  drawMode: true,
});

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
      worldX: 140, worldY: 80, camWorldX: 4.5, camWorldY: 6.5,
      viewCols: 128, viewRows: 96, suspendStreaming: false,
    }),
  },
  { tick: 14, message: normalizeReplayMessage({ type: 'config', tool: 3 }) },
  { tick: 15, message: normalizeReplayMessage({ type: 'weather', weatherId: WEATHER.RAIN }) },
  { tick: 16, message: normalizeReplayMessage({ type: 'intent', intent: 'select', slot: 4 }) },
  {
    tick: 20,
    message: normalizeReplayMessage({
      type: 'test-paint-disc', material: 2, worldX: 50, worldY: 60, radius: 4,
    }),
  },
];

const capsule = {
  format: REPLAY_FORMAT,
  version: REPLAY_VERSION,
  abiVersion: ABI_VERSION,
  abiFingerprint: ABI_FINGERPRINT,
  init,
  turns: 40,
  events,
  gates: [],
  view: {},
  final: {
    tick: 40,
    actorTick: 40,
    cols: 256,
    rows: 192,
    gridHash: 0x12345678,
    worldOffsetX: -16,
    worldOffsetY: 8,
  },
};

const summary = summarizeReplayCapsule(capsule, { source: 'issue.sand-replay' });
assert.equal(summary.abi.matches, true);
assert.equal(summary.init.mode, 'creative');
assert.equal(summary.init.planet, 'earth');
assert.equal(summary.init.weather, 'rain');
assert.equal(summary.init.tool, 'water');
assert.equal(summary.init.creative, 'material:sand');
assert.ok(summary.init.loadout[0].includes('water'));
assert.equal(summary.turns, 40);
assert.equal(summary.eventCounts.config, 1);
assert.ok(summary.tools.includes('stone'));
assert.ok(summary.suggested.at.includes(0));
assert.ok(summary.suggested.at.includes(40));
assert.ok(summary.suggested.at.includes(14));
assert.ok(summary.suggested.cells.some((cell) => cell.x === 120 && cell.y === 80));
assert.match(summary.suggested.microscope, /--at /);
assert.match(summary.suggested.microscope, /--cell /);
assert.match(summary.suggested.microscope, /--around-anomalies 6/);

const text = formatReplayInspectText(summary);
assert.match(text, /abi: MATCH/);
assert.match(text, /planet: earth/);
assert.match(text, /weather: rain/);
assert.match(text, /tool: water/);
assert.match(text, /npm run replay:microscope/);

const encoded = await encodeReplayCapsule(capsule);
const decoded = await decodeReplayCapsule(encoded);
assert.deepEqual(summarizeReplayCapsule(decoded).init.tool, 'water');

const nativeCompression = globalThis.CompressionStream;
let plain;
try {
  globalThis.CompressionStream = undefined;
  plain = await encodeReplayCapsule(capsule);
} finally {
  globalThis.CompressionStream = nativeCompression;
}
assert.ok(plain.startsWith(`${REPLAY_PREFIX}json:`));
const packed = JSON.parse(plain.slice(`${REPLAY_PREFIX}json:`.length));
packed[1] = 0xdead;
const mismatchedText = `${REPLAY_PREFIX}json:${JSON.stringify(packed)}`;
await assert.rejects(() => decodeReplayCapsule(mismatchedText), /incompatible sand engine build/);
const mismatched = await decodeReplayCapsule(mismatchedText, { requireCompatibleAbi: false });
assert.equal(mismatched.abiFingerprint, 0xdead);
const mismatchedSummary = summarizeReplayCapsule(mismatched, { source: 'old.sand-replay' });
assert.equal(mismatchedSummary.abi.matches, false);
assert.equal(mismatchedSummary.init.planet, 'earth');
assert.match(formatReplayInspectText(mismatchedSummary), /abi: MISMATCH/);
assert.match(formatReplayInspectText(mismatchedSummary), /Do not run microscope/);

const dir = mkdtempSync(join(tmpdir(), 'sand-replay-inspect-'));
const file = join(dir, 'issue.sand-replay');
writeFileSync(file, encoded);
const cli = spawnSync(process.execPath, [resolve(root, 'scripts/replay-inspect.mjs'), file], {
  encoding: 'utf8', cwd: root,
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /planet: earth/);
assert.match(cli.stdout, /tool: water/);
assert.match(cli.stdout, /abi: MATCH/);

const jsonCli = spawnSync(process.execPath, [
  resolve(root, 'scripts/replay-inspect.mjs'), file, '--json',
], { encoding: 'utf8', cwd: root });
assert.equal(jsonCli.status, 0, jsonCli.stderr);
const json = JSON.parse(jsonCli.stdout);
assert.equal(json.init.planet, 'earth');
assert.equal(json.abi.matches, true);

const mismatchFile = join(dir, 'old.sand-replay');
writeFileSync(mismatchFile, mismatchedText);
const mismatchCli = spawnSync(process.execPath, [
  resolve(root, 'scripts/replay-inspect.mjs'), mismatchFile,
], { encoding: 'utf8', cwd: root });
assert.equal(mismatchCli.status, 0, mismatchCli.stderr);
assert.match(mismatchCli.stdout, /abi: MISMATCH/);
assert.match(mismatchCli.stdout, /planet: earth/);

validateReplayCapsule(capsule);
console.log('replay inspect: ok');
