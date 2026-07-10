// Test runner: runs every suite in the manifest sequentially (several boot the
// wasm engine, so parallelism would eat RAM), reports ALL failures instead of
// aborting at the first one, and exits non-zero if any failed.
//
//   node scripts/run-tests.mjs                 run everything
//   node scripts/run-tests.mjs --only rigid    run suites whose name/file contains "rigid"
//   node scripts/run-tests.mjs --from players  start at the "players" suite (mid-run resume)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Same order as the old `&&` chain in package.json. Order matters only for
// human diffing of runs; suites are independent.
const SUITES = [
  ['tooltier', 'tooltier-test.mjs'],
  ['items', 'item-test.mjs'],
  ['mining', 'mining-drop-test.mjs'],
  ['mining-speed', 'mining-speed-test.mjs'],
  ['mine-lock', 'mine-lock-test.mjs'],
  ['inventory', 'inventory-test.mjs'],
  ['inv-bridge', 'inventory-bridge-test.mjs'],
  ['creative', 'creative-place-test.mjs'],
  ['throw', 'throw-test.mjs'],
  ['mat-flags', 'materials-flags-test.mjs'],
  ['mat-behavior', 'material-behavior-test.mjs'],
  ['liquid-mass', 'liquid-mass-test.mjs'],
  ['biomes', 'worldgen-biome-test.mjs'],
  ['structures', 'worldgen-structures-test.mjs'],
  ['flora', 'flora-test.mjs'],
  ['sand', 'sand-test.mjs'],
  ['rigid-collision', 'rigid-collision-test.mjs'],
  ['rigid-topple', 'rigid-topple-test.mjs'],
  ['rigidmat', 'rigidmat-test.mjs'],
  ['explosives', 'explosives-test.mjs'],
  ['grounding', 'grounding-incremental-test.mjs'],
  ['pure-perf', 'pure-perf-checksum-test.mjs'],
  ['timing', 'timing-test.mjs'],
  ['players', 'player-test.mjs'],
  ['anim', 'player-anim-test.mjs'],
  ['net', 'net-test.mjs'],
  ['net-protocol', 'net-protocol-test.mjs'],
  ['server', 'server-roundtrip-test.mjs'],
  ['layer', 'layer-test.mjs'],
  ['stacked-logs', 'stacked-logs-test.mjs'],
  ['xlayer-fall', 'xlayer-bonded-fall-test.mjs'],
  ['rigid-spawn-joint', 'rigid-spawn-joint-repro.mjs'],
  ['prefetch', 'prefetch-test.mjs'],
  ['render', 'render-noise-test.mjs'],
  ['viewport-sizing', 'viewport-sizing-test.mjs'],
  // resize-window-test.mjs is not in scripts/ (entry removed; re-add when the suite lands)
  ['lighting', 'render-lighting-test.mjs'],
  ['stone-airgap', 'stone-airgap-test.mjs'],
  ['stone-layers', 'stone-layer-dig-repro.mjs'],
  ['component-erase', 'component-erase-test.mjs'],
  ['acid-stuck', 'acid-stuck-test.mjs'],
  ['hold-place', 'hold-place-test.mjs'],
  ['item-float', 'item-float-test.mjs'],
];

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const only = argValue('--only');
const from = argValue('--from');

let suites = SUITES;
if (from) {
  const i = suites.findIndex(([name]) => name === from);
  if (i < 0) {
    console.error(`--from: no suite named "${from}"`);
    process.exit(2);
  }
  suites = suites.slice(i);
}
if (only) {
  suites = suites.filter(([name, file]) => name.includes(only) || file.includes(only));
  if (!suites.length) {
    console.error(`--only: no suite matches "${only}"`);
    process.exit(2);
  }
}

const results = [];
for (const [name, file] of suites) {
  const started = Date.now();
  process.stdout.write(`\n=== ${name} (${file}) ===\n`);
  const r = spawnSync('node', [resolve(root, 'scripts', file)], {
    cwd: root,
    stdio: 'inherit',
  });
  const ms = Date.now() - started;
  const failed = r.status !== 0;
  results.push({ name, file, ms, failed, status: r.status, signal: r.signal });
}

const failures = results.filter((r) => r.failed);
const totalMs = results.reduce((a, r) => a + r.ms, 0);

console.log('\n──────────────────────────────────────────');
console.log(`${results.length - failures.length}/${results.length} suites passed in ${(totalMs / 1000).toFixed(1)}s`);
for (const r of results) {
  const mark = r.failed ? 'FAIL' : ' ok ';
  console.log(`  [${mark}] ${r.name.padEnd(16)} ${(r.ms / 1000).toFixed(1)}s${r.signal ? `  (signal ${r.signal})` : ''}`);
}
if (failures.length) {
  console.error(`\nFAILED: ${failures.map((r) => r.name).join(', ')}`);
  console.error(`Re-run one with: node scripts/run-tests.mjs --only <name>`);
  process.exit(1);
}
