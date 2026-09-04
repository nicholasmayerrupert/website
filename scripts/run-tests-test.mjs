import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_SUITES, FOCUSED_SUITES, UNIT_SUITES,
} from './test-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'sand-test-runner-'));
const fixtureScripts = resolve(fixtureRoot, 'scripts');
mkdirSync(fixtureScripts);

try {
  copyFileSync(resolve(root, 'scripts/run-tests.mjs'), resolve(fixtureScripts, 'run-tests.mjs'));
  writeFileSync(resolve(fixtureScripts, 'test-manifest.mjs'), `
export const UNIT_SUITES = [
  ['test-runner', 'probe-test.mjs'],
  ['sand', 'sand-test.mjs'],
  ['sand-bench-env', 'sand-bench-environment-test.mjs'],
  ['rigid-a', 'rigid-a-test.mjs'],
  ['rigid-b', 'rigid-b-test.mjs'],
];
export const BROWSER_SUITES = [];
export const FOCUSED_SUITES = [];
export const EXCLUDED_TESTS = [];
export const TEST_GROUPS = { rigid: ['rigid-a', 'rigid-b'] };
`);

  const tracePath = resolve(fixtureRoot, 'trace.txt');
  const testFiles = [
    'sand-test.mjs',
    'sand-bench-environment-test.mjs',
    'rigid-a-test.mjs',
    'rigid-b-test.mjs',
  ];
  for (const file of testFiles) writeFileSync(resolve(fixtureScripts, file), '');
  writeFileSync(resolve(fixtureScripts, 'probe-test.mjs'), `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.RUN_TESTS_TRACE, 'suite\\n');
console.log(\`runner probe MAX_CASES=\${process.env.MAX_CASES ?? ''}\`);
`);

  const preflights = [
    ['generate-materials.mjs', 'materials'],
    ['generate-reactions.mjs', 'reactions'],
    ['generate-abi.mjs', 'abi'],
    ['generate-biomes.mjs', 'biomes'],
    ['check-sand-contracts.mjs', 'contracts'],
    ['write-wasm-build-info.mjs', 'provenance'],
  ];
  for (const [file, label] of preflights) {
    writeFileSync(resolve(fixtureScripts, file), `
import { appendFileSync } from 'node:fs';
${file === 'write-wasm-build-info.mjs' ? `
if (!process.argv.includes('--check') || !process.argv.includes('--allow-dev')) {
  console.error('test runner must opt into source-current dev artifacts');
  process.exit(2);
}
` : ''}
appendFileSync(process.env.RUN_TESTS_TRACE, '${label}\\n');
`);
  }

  const runner = resolve(fixtureScripts, 'run-tests.mjs');
  const run = (args, env = {}) => spawnSync(process.execPath, [runner, ...args], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  const exact = run(['--only', 'sand', '--list']);
  assert.equal(exact.status, 0, exact.stderr);
  assert.deepEqual(exact.stdout.trim().split('\n').map((line) => line.split('\t')[0]), ['sand']);

  const unknown = run(['--only', 'not-a-manifest-key', '--list']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no suite matches/);
  assert.doesNotMatch(unknown.stdout, /Checking generated sources/);

  const ambiguous = run(['--only', 'rigid', '--list']);
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.stderr, /is ambiguous/);
  assert.doesNotMatch(ambiguous.stdout, /Checking generated sources/);

  const multiple = run(['--only', 'sand,rigid-a', '--only', 'rigid-b,sand', '--list']);
  assert.equal(multiple.status, 0, multiple.stderr);
  assert.deepEqual(multiple.stdout.trim().split('\n').map((line) => line.split('\t')[0]),
    ['sand', 'rigid-a', 'rigid-b']);
  const grouped = run(['--group', 'rigid', '--only', 'sand', '--list']);
  assert.equal(grouped.status, 0, grouped.stderr);
  assert.equal(grouped.stdout, multiple.stdout);
  assert.equal(run(['--group', 'missing', '--list']).status, 2);
  assert.equal(run(['--jobs', '1', '--jobs', '2', '--list']).status, 2);

  const ordered = run(['--only', 'test-runner', '--verbose'], {
    MAX_CASES: '12',
    RUN_TESTS_TRACE: tracePath,
  });
  assert.equal(ordered.status, 0, `${ordered.stdout}\n${ordered.stderr}`);
  assert.deepEqual(readFileSync(tracePath, 'utf8').trim().split('\n'), [
    'materials', 'reactions', 'abi', 'biomes', 'contracts', 'provenance', 'suite',
  ]);
  const preflightPassed = ordered.stdout.indexOf('Test preflight passed');
  const suiteStarted = ordered.stdout.indexOf('[RUN ] test-runner');
  const probe = ordered.stdout.indexOf('runner probe MAX_CASES=12');
  assert.ok(preflightPassed >= 0 && preflightPassed < suiteStarted,
    'preflight completes before the suite starts');
  assert.ok(suiteStarted < probe, 'the selected suite inherits command-specific environment');

  const artifacts = resolve(fixtureRoot, 'artifacts');
  writeFileSync(resolve(fixtureScripts, 'rigid-a-test.mjs'), `
console.log(JSON.stringify({ details: 'x'.repeat(100000) }));
console.log('FAIL expected one rebuild, received 701; seed=1 tick=1');
process.exitCode = 1;
`);
  const failed = run(['--only', 'rigid-a', '--artifacts', artifacts], { RUN_TESTS_TRACE: tracePath });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /FAIL expected one rebuild/);
  assert.ok(failed.stdout.length < 5000, 'console output stays bounded');
  assert.ok(readFileSync(resolve(artifacts, 'rigid-a.log')).length > 100000,
    'full diagnostics survive in the artifact');
  const summary = JSON.parse(readFileSync(resolve(artifacts, 'summary.json'), 'utf8'));
  assert.equal(summary.suites[0].failed, true);
  assert.equal(summary.suites[0].status, 1);
  assert.match(summary.suites[0].rerun, /--only rigid-a/);

  const fixtureManifestPath = resolve(fixtureScripts, 'test-manifest.mjs');
  writeFileSync(fixtureManifestPath, readFileSync(fixtureManifestPath, 'utf8')
    .replace("['rigid-a', 'rigid-a-test.mjs']",
      "['rigid-a', 'rigid-a-test.mjs', { concurrency: 'exclusive' }]")
    .replace("['rigid-b', 'rigid-b-test.mjs']",
      "['rigid-b', 'rigid-b-test.mjs', { timeoutMs: 1000 }]"));
  for (const file of testFiles) writeFileSync(resolve(fixtureScripts, file), `
import { appendFileSync } from 'node:fs';
const event = (phase) => appendFileSync(process.env.RUN_TESTS_TRACE,
  JSON.stringify({ name: ${JSON.stringify(file)}, phase }) + '\\n');
event('start');
await new Promise((done) => setTimeout(done, 100));
event('finish');
`);
  writeFileSync(tracePath, '');
  const scheduled = run(['--only', 'sand,sand-bench-env,rigid-a,rigid-b', '--jobs', '2'],
    { RUN_TESTS_TRACE: tracePath });
  assert.equal(scheduled.status, 0, scheduled.stdout + scheduled.stderr);
  const active = new Set();
  const events = readFileSync(tracePath, 'utf8').split('\n').filter((line) => line.startsWith('{')).map(JSON.parse);
  assert.equal(events.length, 8);
  for (const event of events) {
    if (event.phase === 'finish') { active.delete(event.name); continue; }
    if (event.name === 'rigid-a-test.mjs') assert.equal(active.size, 0);
    else assert.ok(!active.has('rigid-a-test.mjs'), 'exclusive work cannot overlap another selected suite');
    active.add(event.name);
  }
  writeFileSync(resolve(fixtureScripts, 'rigid-b-test.mjs'),
    "console.log('last operation: release'); setInterval(() => {}, 1000);");
  const timed = run(['--only', 'rigid-b', '--artifacts', artifacts], { RUN_TESTS_TRACE: tracePath });
  assert.equal(timed.status, 1);
  assert.match(timed.stderr, /TIMEOUT: rigid-b/);
  assert.equal(JSON.parse(readFileSync(resolve(artifacts, 'summary.json'), 'utf8')).suites[0].timedOut, true);
  assert.match(readFileSync(resolve(artifacts, 'rigid-b.log'), 'utf8'), /last operation: release/);

  const manifestKeys = new Set([...UNIT_SUITES, ...BROWSER_SUITES, ...FOCUSED_SUITES]
    .map(([key]) => key));
  const standalonePackageTests = new Set(['test:life', 'test:life:e2e']);
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('test:') || name === 'test:all' || name === 'test:browser') continue;
    const selected = command.match(/node scripts\/run-tests\.mjs --only ([^ ]+)/)?.[1];
    if (selected) {
      for (const key of selected.split(',')) {
        assert.ok(manifestKeys.has(key), `${name} selects manifest key ${key}`);
      }
    } else assert.ok(standalonePackageTests.has(name), `${name} must use the focused test runner`);
  }

  const provenanceRoot = resolve(fixtureRoot, 'provenance');
  for (const directory of [
    'scripts', 'src/sand/cpp', 'src/sand/wasm', 'wasm',
  ]) mkdirSync(resolve(provenanceRoot, directory), { recursive: true });
  copyFileSync(resolve(root, 'scripts/write-wasm-build-info.mjs'),
    resolve(provenanceRoot, 'scripts/write-wasm-build-info.mjs'));
  for (const [path, contents] of [
    ['src/sand/cpp/sand.cpp', 'int sand_source = 1;\n'],
    ['src/sand/materials.schema.json', '{}\n'],
    ['src/sand/reactions.schema.json', '{}\n'],
    ['src/sand/abi.schema.json', '{}\n'],
    ['src/sand/biomes.schema.json', '{}\n'],
    ['src/sand/wasm/sandEngine.js', 'export default true;\n'],
    ['src/sand/wasm/sandEngine.wasm', 'fixture wasm bytes\n'],
    ['wasm/build.mjs', '// fixture build\n'],
    ['wasm/emscripten.mjs', '// fixture toolchain\n'],
    ['wasm/emscripten-version.txt', 'fixture\n'],
    ['scripts/generate-biomes.mjs', '// fixture generator\n'],
    ['scripts/generate-reactions.mjs', '// fixture generator\n'],
  ]) writeFileSync(resolve(provenanceRoot, path), contents);
  const provenance = (...args) => spawnSync(process.execPath, [
    resolve(provenanceRoot, 'scripts/write-wasm-build-info.mjs'), ...args,
  ], { cwd: provenanceRoot, encoding: 'utf8' });

  const writeDev = provenance('--dev');
  assert.equal(writeDev.status, 0, `${writeDev.stdout}\n${writeDev.stderr}`);
  const acceptDev = provenance('--check', '--allow-dev');
  assert.equal(acceptDev.status, 0, `${acceptDev.stdout}\n${acceptDev.stderr}`);
  const rejectDev = provenance('--check');
  assert.equal(rejectDev.status, 1);
  assert.match(rejectDev.stderr, /build variant is dev, not production/);

  writeFileSync(resolve(provenanceRoot, 'src/sand/cpp/sand.cpp'),
    'int sand_source = 2;\n');
  const rejectStaleDev = provenance('--check', '--allow-dev');
  assert.equal(rejectStaleDev.status, 1);
  assert.match(rejectStaleDev.stderr, /compiled source hash is stale/);

  const writeProduction = provenance();
  assert.equal(writeProduction.status, 0,
    `${writeProduction.stdout}\n${writeProduction.stderr}`);
  const acceptProduction = provenance('--check');
  assert.equal(acceptProduction.status, 0,
    `${acceptProduction.stdout}\n${acceptProduction.stderr}`);

  const writeProfile = provenance('--profile');
  assert.equal(writeProfile.status, 0, writeProfile.stderr);
  assert.equal(provenance('--check').status, 1);
  assert.equal(provenance('--check', '--allow-dev').status, 1);
  assert.equal(provenance('--check', '--allow-profile').status, 0);

  console.log('test runner selection and preflight ordering passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
