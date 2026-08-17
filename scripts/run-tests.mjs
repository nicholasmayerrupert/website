// Manifest-driven parallel test runner. The default runs headless suites;
// `--browser` selects browser suites. `--only` selects one manifest entry,
// `--from` resumes by name, and `--jobs` overrides the bounded worker count.

import { readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  BROWSER_SUITES, EXCLUDED_TESTS, FOCUSED_SUITES, UNIT_SUITES,
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
  return !Number.isInteger(timeoutMs) || timeoutMs <= 0
    || (concurrency !== 'parallel' && concurrency !== 'exclusive');
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
const valueFlags = new Set(['--only', '--from', '--jobs']);
const booleanFlags = new Set(['--browser', '--verbose', '--list']);
const parsed = new Map();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (valueFlags.has(flag)) {
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) {
      console.error(`${flag} requires a value`);
      process.exit(2);
    }
    parsed.set(flag, value);
  } else if (booleanFlags.has(flag)) {
    parsed.set(flag, true);
  } else {
    console.error(`Unknown argument: ${flag}`);
    process.exit(2);
  }
}
const only = parsed.get('--only') ?? null;
const from = parsed.get('--from') ?? null;
let browser = parsed.has('--browser');
const verbose = parsed.has('--verbose');
const listOnly = parsed.has('--list');
const defaultJobs = browser ? 1 : 2;
const jobsArg = parsed.get('--jobs') ?? process.env.TEST_JOBS;
const jobs = jobsArg === null || jobsArg === undefined ? defaultJobs : Number(jobsArg);
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(`--jobs must be a positive integer (got "${jobsArg}")`);
  process.exit(2);
}

let suites;
if (only) {
  const exact = selectableSuites.filter(([name]) => name === only);
  const matches = exact.length ? exact : selectableSuites.filter(([name, file]) => {
    return name.includes(only) || file.includes(only);
  });
  if (!matches.length) {
    console.error(`--only: no suite matches "${only}"`);
    process.exit(2);
  }
  if (matches.length > 1) {
    console.error(`--only: "${only}" is ambiguous; matches ${matches.map(([name]) => name).join(', ')}`);
    process.exit(2);
  }
  if (from) {
    console.error('--only and --from cannot be combined');
    process.exit(2);
  }
  suites = matches;
  browser = BROWSER_SUITES.includes(matches[0]);
} else {
  suites = browser ? BROWSER_SUITES : UNIT_SUITES;
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
  ['sand WASM provenance', 'write-wasm-build-info.mjs', ['--check', '--allow-dev']],
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
const runSuite = (file, timeoutMs) => new Promise((resolveRun) => {
  const child = spawn(process.execPath, [resolve(root, 'scripts', file)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  activeChildren.add(child);
  const output = [];
  child.stdout.on('data', (chunk) => output.push(['stdout', chunk]));
  child.stderr.on('data', (chunk) => output.push(['stderr', chunk]));
  let timedOut = false;
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    activeChildren.delete(child);
    resolveRun({ ...result, timedOut, output });
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

const printOutput = ({ name, output }) => {
  if (!output.length) return;
  process.stdout.write(`\n--- ${name} output ---\n`);
  for (const [stream, chunk] of output) process[stream].write(chunk);
  const last = output.at(-1)?.[1];
  if (last?.length && last[last.length - 1] !== 10) process.stdout.write('\n');
};

const wallStarted = Date.now();
const workerCount = Math.min(jobs, Math.max(1, suites.length));
let nextSuite = 0;
const exclusiveCount = suites.filter((suite) => suiteSettings(suite).concurrency === 'exclusive').length;
console.log(`Running ${suites.length} ${browser ? 'browser' : 'headless'} suites with ${workerCount} jobs (${exclusiveCount} exclusive)`);

const runOne = async (index) => {
  const [name, file] = suites[index];
  const { timeoutMs } = suiteSettings(suites[index]);
  const started = Date.now();
  console.log(`[RUN ] ${name}`);
  const r = await runSuite(file, timeoutMs);
  const ms = Date.now() - started;
  const failed = r.status !== 0 || r.timedOut;
  const result = { name, file, ms, failed, ...r };
  results[index] = result;
  if (verbose || failed) printOutput(result);
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
if (stoppingSignal) process.exit(stoppingSignal === 'SIGINT' ? 130 : 143);
if (failures.length) {
  console.error(`\nFAILED: ${failures.map((r) => r.name).join(', ')}`);
  console.error(`Re-run one with: node scripts/run-tests.mjs --only <name>`);
  process.exit(1);
}
