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

  const manifestKeys = new Set([...UNIT_SUITES, ...BROWSER_SUITES, ...FOCUSED_SUITES]
    .map(([key]) => key));
  const standalonePackageTests = new Set(['test:life', 'test:life:e2e']);
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('test:') || name === 'test:all' || name === 'test:browser') continue;
    const selected = command.match(/node scripts\/run-tests\.mjs --only ([^ ]+)/)?.[1];
    if (selected) assert.ok(manifestKeys.has(selected), `${name} selects manifest key ${selected}`);
    else assert.ok(standalonePackageTests.has(name), `${name} must use the focused test runner`);
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

  console.log('test runner selection and preflight ordering passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
