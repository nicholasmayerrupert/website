// Manifest-driven sequential test runner. The default runs headless suites;
// `--browser` selects browser suites. `--only` filters and `--from` resumes by name.

import { readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BROWSER_SUITES, EXCLUDED_TESTS, UNIT_SUITES } from './test-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_TIMEOUT_MS = 120_000;

const executableTests = readdirSync(resolve(root, 'scripts'))
  .filter((file) => /(?:-test|-e2e|-repro)\.mjs$/.test(file));
const declared = new Map([...UNIT_SUITES, ...BROWSER_SUITES, ...EXCLUDED_TESTS]
  .map((suite) => [suite[1], suite]));
const missing = executableTests.filter((file) => !declared.has(file));
const stale = [...declared.keys()].filter((file) => !executableTests.includes(file));
if (missing.length || stale.length) {
  if (missing.length) console.error(`Test manifest is missing: ${missing.join(', ')}`);
  if (stale.length) console.error(`Test manifest has stale entries: ${stale.join(', ')}`);
  process.exit(2);
}

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const only = argValue('--only');
const from = argValue('--from');
const browser = args.includes('--browser');

let suites = browser ? BROWSER_SUITES : UNIT_SUITES;
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
    stdio: 'inherit',
    detached: true,
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    killTree(child);
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) killTree(child, 'SIGKILL');
    }, 2_000).unref();
  }, timeoutMs);
  child.once('error', (error) => {
    clearTimeout(timeout);
    resolveRun({ status: null, signal: null, error, timedOut });
  });
  child.once('exit', (status, signal) => {
    clearTimeout(timeout);
    resolveRun({ status, signal, error: null, timedOut });
  });
});

for (const [name, file, timeoutMs = DEFAULT_TIMEOUT_MS] of suites) {
  const started = Date.now();
  process.stdout.write(`\n=== ${name} (${file}, timeout ${Math.round(timeoutMs / 1000)}s) ===\n`);
  const r = await runSuite(file, timeoutMs);
  const ms = Date.now() - started;
  const failed = r.status !== 0 || r.timedOut;
  if (r.timedOut) console.error(`TIMEOUT: ${name} exceeded ${Math.round(timeoutMs / 1000)}s`);
  if (r.error) console.error(`Failed to start ${name}: ${r.error.message}`);
  results.push({ name, file, ms, failed, ...r });
}

const failures = results.filter((r) => r.failed);
const totalMs = results.reduce((a, r) => a + r.ms, 0);

console.log('\n──────────────────────────────────────────');
console.log(`${results.length - failures.length}/${results.length} suites passed in ${(totalMs / 1000).toFixed(1)}s`);
for (const r of results) {
  const mark = r.failed ? 'FAIL' : ' ok ';
  console.log(`  [${mark}] ${r.name.padEnd(20)} ${(r.ms / 1000).toFixed(1)}s${r.timedOut ? '  (timeout)' : r.signal ? `  (signal ${r.signal})` : ''}`);
}
if (failures.length) {
  console.error(`\nFAILED: ${failures.map((r) => r.name).join(', ')}`);
  console.error(`Re-run one with: node scripts/run-tests.mjs --only <name>`);
  process.exit(1);
}
