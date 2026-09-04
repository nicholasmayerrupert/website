// Manifest-driven parallel test runner. The default runs headless suites;
// Selections share one preflight and scheduler. Full output is saved as artifacts;
// the console reports concise failures and periodic progress.

import { closeSync, mkdirSync, openSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  BROWSER_SUITES, EXCLUDED_TESTS, FOCUSED_SUITES, UNIT_SUITES, TEST_GROUPS,
} from './test-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_TIMEOUT_MS = 120_000;
const suiteSettings = ([, , rawSettings]) => {
  return {
    timeoutMs: rawSettings?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    concurrency: rawSettings?.concurrency ?? 'parallel',
  };
};

const scriptFiles = readdirSync(resolve(root, 'scripts'));
const executableTests = scriptFiles
  .filter((file) => /(?:-test|-e2e|-repro)\.mjs$/.test(file));
const aggregateSuites = [...UNIT_SUITES, ...BROWSER_SUITES];
const selectableSuites = [...aggregateSuites, ...FOCUSED_SUITES];
const declared = new Map([...selectableSuites, ...EXCLUDED_TESTS]
  .map((suite) => [suite[1], suite]));
const missing = executableTests.filter((file) => !declared.has(file));
const stale = [...declared.keys()].filter((file) => !scriptFiles.includes(file));
if (missing.length || stale.length) {
  if (missing.length) console.error(`Test manifest is missing: ${missing.join(', ')}`);
  if (stale.length) console.error(`Test manifest has stale entries: ${stale.join(', ')}`);
  process.exit(2);
}
const malformed = selectableSuites.filter((suite) => {
  const { timeoutMs, concurrency } = suiteSettings(suite);
  const args = suite[2]?.args;
  return !Number.isInteger(timeoutMs) || timeoutMs <= 0
    || (concurrency !== 'parallel' && concurrency !== 'exclusive')
    || (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')));
});
if (malformed.length) {
  console.error(`Test manifest has invalid metadata: ${malformed.map(([name]) => name).join(', ')}`);
  process.exit(2);
}
const duplicateNames = selectableSuites
  .map(([name]) => name)
  .filter((name, index, names) => names.indexOf(name) !== index);
if (duplicateNames.length) {
  console.error(`Test manifest has duplicate keys: ${[...new Set(duplicateNames)].join(', ')}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const valueFlags = new Set(['--only', '--group', '--from', '--jobs', '--artifacts', '--compare-ref', '--wasm']);
const booleanFlags = new Set(['--browser', '--verbose', '--list', '--help']);
const parsed = new Map();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (valueFlags.has(flag)) {
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) {
      console.error(`${flag} requires a value`);
      process.exit(2);
    }
    if (flag === '--only' || flag === '--group')
      parsed.set(flag, [...(parsed.get(flag) || []), ...value.split(',')]);
    else if (parsed.has(flag)) {
      console.error(`Duplicate argument: ${flag}`);
      process.exit(2);
    } else parsed.set(flag, value);
  } else if (booleanFlags.has(flag)) {
    parsed.set(flag, true);
  } else {
    console.error(`Unknown argument: ${flag}`);
    process.exit(2);
  }
}
if (parsed.has('--help')) {
  console.log(`Usage: node scripts/run-tests.mjs [options]
  --only NAME[,NAME]    Select suites; repeatable, exact names preferred
  --group NAME[,NAME]   Select subsystem groups; repeatable
  --browser            Default to all browser suites
  --from NAME          Resume the default aggregate at a suite
  --jobs N             Parallel jobs; exclusive suites still run alone
  --list               List selected suites without running preflight
  --verbose            Stream full suite output
  --artifacts DIR      Save logs and summary.json in DIR
  --compare-ref REF    Compare selected suites with a clean Git revision
  --wasm FILE          Use an alternate source-current headless WASM loader
Groups: ${Object.keys(TEST_GROUPS).join(', ')}`);
  process.exit(0);
}
const only = parsed.get('--only') || [];
const groups = parsed.get('--group') || [];
const from = parsed.get('--from') ?? null;
const verbose = parsed.has('--verbose');
const listOnly = parsed.has('--list');
let suites;
if (only.length || groups.length) {
  const selected = new Set();
  for (const query of only) {
    const exact = selectableSuites.filter(([name]) => name === query);
    const matches = exact.length ? exact : selectableSuites.filter(([name, file]) =>
      name.includes(query) || file.includes(query));
    if (!query || matches.length !== 1) {
      console.error(matches.length > 1
        ? `--only: "${query}" is ambiguous; matches ${matches.map(([name]) => name).join(', ')}`
        : `--only: no suite matches "${query}"`);
      process.exit(2);
    }
    selected.add(matches[0][0]);
  }
  for (const group of groups) {
    if (!Object.hasOwn(TEST_GROUPS, group)) {
      console.error(`Unknown group "${group}". Groups: ${Object.keys(TEST_GROUPS).join(', ')}`);
      process.exit(2);
    }
    for (const name of TEST_GROUPS[group]) {
      if (!selectableSuites.some(([key]) => key === name))
        throw new Error(`Group ${group} names missing suite ${name}`);
      selected.add(name);
    }
  }
  if (from) { console.error('--from cannot be combined with --only or --group'); process.exit(2); }
  suites = selectableSuites.filter(([name]) => selected.has(name));
} else suites = parsed.has('--browser') ? BROWSER_SUITES : UNIT_SUITES;
const isBrowser = (suite) => BROWSER_SUITES.some(([, file]) => file === suite[1]);
const hasBrowser = suites.some(isBrowser);
const kind = hasBrowser ? (suites.every(isBrowser) ? 'browser' : 'mixed') : 'headless';
const jobs = Number(parsed.get('--jobs') ?? process.env.TEST_JOBS ?? (hasBrowser ? 1 : 2));
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(`--jobs must be a positive integer (got "${jobs}")`);
  process.exit(2);
}
if (from) {
  const i = suites.findIndex(([name]) => name === from);
  if (i < 0) {
    console.error(`--from: no suite named "${from}"`);
    process.exit(2);
  }
  suites = suites.slice(i);
}
if (listOnly) {
  for (const suite of suites) {
    const [name, file] = suite;
    const { timeoutMs, concurrency } = suiteSettings(suite);
    console.log(`${name}\t${file}\t${concurrency}\t${timeoutMs}`);
  }
  process.exit(0);
}

const artifactDir = resolve(root, parsed.get('--artifacts')
  || `.sand-artifacts/tests/${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
mkdirSync(artifactDir, { recursive: true });
if (parsed.has('--compare-ref')) {
  if (parsed.has('--wasm')) {
    console.error('--compare-ref and --wasm cannot be combined');
    process.exit(2);
  }
  const { compareRevision } = await import('./test-compare.mjs');
  process.exit(await compareRevision({ root, ref: parsed.get('--compare-ref'), suites,
    artifactDir, jobs, verbose }));
}
const wasmLoader = parsed.get('--wasm') ? resolve(root, parsed.get('--wasm')) : null;
if (wasmLoader && hasBrowser) {
  console.error('--wasm currently supports headless suites only');
  process.exit(2);
}

// Tests import the committed WASM directly. Tests must execute generated tables
// and an artifact built from the checked-out engine sources.
// Invoke the underlying check scripts directly so this preflight never recurses
// through npm or performs a rebuild.
const preflightChecks = [
  ['generated materials', 'generate-materials.mjs', ['--check']],
  ['generated reactions', 'generate-reactions.mjs', ['--check']],
  ['generated ABI', 'generate-abi.mjs', ['--check']],
  ['generated biomes', 'generate-biomes.mjs', ['--check']],
  ['sand engine source contracts', 'check-sand-contracts.mjs', []],
  ['sand WASM provenance', 'write-wasm-build-info.mjs', ['--check', '--allow-dev', ...(wasmLoader ? ['--allow-profile', wasmLoader] : [])]],
];
console.log('Checking generated sources and sand WASM provenance...');
for (const [label, file, checkArgs] of preflightChecks) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', file), ...checkArgs], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(`${label}: ${result.error.message}`);
    console.error(`Test preflight failed: ${label}`);
    process.exit(result.status || 1);
  }
}
console.log('Test preflight passed');

const results = new Array(suites.length);
const activeChildren = new Set();
let stoppingSignal = null;
const killTree = (child, signal = 'SIGTERM') => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else {
      // Browser suites may launch a detached npm/Vite process group so normal
      // cleanup can terminate it reliably. On timeout, collect descendants
      // before killing the suite and signal every resulting process group.
      const ps = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
      const children = new Map();
      for (const line of (ps.stdout || '').trim().split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
      }
      const descendants = [];
      const visit = (pid) => { for (const next of children.get(pid) || []) { visit(next); descendants.push(next); } };
      visit(child.pid);
      for (const pid of descendants) {
        try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
      }
      process.kill(-child.pid, signal);
    }
  } catch { /* process already exited */ }
};
const runSuite = (name, file, timeoutMs, suiteArgs = []) => new Promise((resolveRun) => {
  const logPath = resolve(artifactDir, `${name}.log`);
  const log = openSync(logPath, 'w');
  let tail = '';
  const child = spawn(process.execPath, [...(wasmLoader ? ['--import', resolve(root, 'scripts/sand-wasm-loader.mjs')] : []), resolve(root, 'scripts', file), ...suiteArgs], {
    cwd: root,
    env: { ...process.env, SAND_TEST_ARTIFACTS: resolve(artifactDir, name), ...(wasmLoader ? { SAND_WASM_LOADER: wasmLoader } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  activeChildren.add(child);
  const capture = (stream, chunk) => {
    writeSync(log, chunk);
    tail = (tail + chunk.toString()).slice(-16384);
    if (verbose) process[stream].write(chunk);
  };
  child.stdout.on('data', (chunk) => capture('stdout', chunk));
  child.stderr.on('data', (chunk) => capture('stderr', chunk));
  const heartbeat = setInterval(() => console.log(`[ ...] ${name} still running; log: ${logPath}`), 30000);
  heartbeat.unref();
  let timedOut = false;
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    clearInterval(heartbeat);
    closeSync(log);
    activeChildren.delete(child);
    resolveRun({ ...result, timedOut, tail, logPath });
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    killTree(child);
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) killTree(child, 'SIGKILL');
    }, 2_000).unref();
  }, timeoutMs);
  child.once('error', (error) => {
    finish({ status: null, signal: null, error });
  });
  child.once('close', (status, signal) => {
    finish({ status, signal, error: null });
  });
});

const stopChildren = (signal) => {
  stoppingSignal = signal;
  console.error(`\n${signal}: stopping ${activeChildren.size} active suite(s)...`);
  for (const child of activeChildren) killTree(child);
  setTimeout(() => {
    for (const child of activeChildren) killTree(child, 'SIGKILL');
  }, 2_000).unref();
};
process.once('SIGINT', () => stopChildren('SIGINT'));
process.once('SIGTERM', () => stopChildren('SIGTERM'));

const printOutput = ({ name, tail, logPath }) => {
  const lines = tail.split('\n').filter((line) => line.length < 800);
  const assertions = lines.filter((line) => /(?:^|\s)(?:FAIL\b|(?:Assertion|Type|Reference|Range|Syntax|Timeout)?Error:|TIMEOUT\b)/.test(line));
  console.log(`\n${name}:\n${(assertions.length ? assertions : lines.slice(-20)).join('\n')}`);
  console.log(`Full output: ${logPath}`);
};

const wallStarted = Date.now();
const workerCount = Math.min(jobs, Math.max(1, suites.length));
let nextSuite = 0;
const exclusiveCount = suites.filter((suite) => suiteSettings(suite).concurrency === 'exclusive').length;
console.log(`Running ${suites.length} ${kind} suites with ${workerCount} jobs (${exclusiveCount} exclusive)`);

const runOne = async (index) => {
  const [name, file, settings] = suites[index];
  const { timeoutMs } = suiteSettings(suites[index]);
  const started = Date.now();
  console.log(`[RUN ] ${name}`);
  const r = await runSuite(name, file, timeoutMs, settings?.args);
  const ms = Date.now() - started;
  const failed = r.status !== 0 || r.timedOut;
  const result = { name, file, ms, failed, ...r };
  results[index] = result;
  if (failed && !verbose) printOutput(result);
  if (r.timedOut) console.error(`TIMEOUT: ${name} exceeded ${Math.round(timeoutMs / 1000)}s`);
  if (r.error) console.error(`Failed to start ${name}: ${r.error.message}`);
  console.log(`[${failed ? 'FAIL' : ' ok '}] ${name} ${(ms / 1000).toFixed(1)}s`);
};

const active = new Set();
const startParallel = (index) => {
  const running = runOne(index).finally(() => active.delete(running));
  active.add(running);
};
while (!stoppingSignal && (nextSuite < suites.length || active.size)) {
  if (nextSuite < suites.length
      && suiteSettings(suites[nextSuite]).concurrency === 'exclusive') {
    if (active.size) await Promise.all(active);
    if (stoppingSignal) break;
    await runOne(nextSuite++);
    continue;
  }
  while (nextSuite < suites.length && active.size < workerCount
      && suiteSettings(suites[nextSuite]).concurrency !== 'exclusive') {
    startParallel(nextSuite++);
  }
  if (active.size) await Promise.race(active);
}
if (active.size) await Promise.all(active);

const completed = results.filter(Boolean);
const failures = completed.filter((r) => r.failed);
const totalMs = completed.reduce((a, r) => a + r.ms, 0);
const wallMs = Date.now() - wallStarted;

console.log('\n──────────────────────────────────────────');
console.log(`${completed.length - failures.length}/${suites.length} suites passed in ${(wallMs / 1000).toFixed(1)}s wall (${(totalMs / 1000).toFixed(1)}s aggregate)`);
for (const r of completed) {
  const mark = r.failed ? 'FAIL' : ' ok ';
  console.log(`  [${mark}] ${r.name.padEnd(20)} ${(r.ms / 1000).toFixed(1)}s${r.timedOut ? '  (timeout)' : r.signal ? `  (signal ${r.signal})` : ''}`);
}
const report = {
  parameters: Object.fromEntries(['SEED', 'STEPS', 'COLS', 'ROWS', 'RIGID_SOLVER_MODE', 'MAX_CASES']
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])),
  suites: completed.map(({ name, file, ms, failed, status, signal, timedOut, logPath }) =>
    ({ name, file, ms, failed, status, signal, timedOut, logPath,
      rerun: `node scripts/run-tests.mjs --only ${name}` })),
  interrupted: stoppingSignal,
  wallMs,
};
writeFileSync(resolve(artifactDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Artifacts: ${artifactDir}`);
if (stoppingSignal) process.exit(stoppingSignal === 'SIGINT' ? 130 : 143);
if (failures.length) {
  console.error(`\nFAILED: ${failures.map((r) => r.name).join(', ')}`);
  console.error(`Re-run one with: node scripts/run-tests.mjs --only <name>`);
  process.exit(1);
}
