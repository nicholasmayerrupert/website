import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function compareRevision({ root, ref, suites, artifactDir, jobs, verbose }) {
  const revision = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`],
    { cwd: root, encoding: 'utf8' }).trim();
  const checkout = mkdtempSync(join(tmpdir(), 'sand-test-compare-'));
  const archive = resolve(artifactDir, 'revision.tar');
  let interrupted = false;
  const noteInterrupt = () => { interrupted = true; };
  process.on('SIGINT', noteInterrupt);
  process.on('SIGTERM', noteInterrupt);
  const run = (cwd, names, output) => new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['scripts/run-tests.mjs',
      '--only', names.join(','), '--jobs', String(jobs), '--artifacts', output,
      ...(verbose ? ['--verbose'] : [])], { cwd, stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('close', (code) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolveRun(code ?? 1);
    });
  });
  try {
    execFileSync('git', ['archive', '--format=tar', '--output', archive, revision], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', checkout]);
    rmSync(archive);
    symlinkSync(resolve(root, 'node_modules'), join(checkout, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir');
    const oldManifest = await import(pathToFileURL(join(checkout, 'scripts/test-manifest.mjs')));
    const oldSuites = [...oldManifest.UNIT_SUITES, ...oldManifest.BROWSER_SUITES,
      ...(oldManifest.FOCUSED_SUITES || [])];
    const available = suites.filter(([name]) => oldSuites.some(([key]) => key === name));
    const baselineDir = resolve(artifactDir, 'baseline');
    const currentDir = resolve(artifactDir, 'current');
    mkdirSync(baselineDir, { recursive: true });
    console.log(`Comparing working tree with ${ref} (${revision.slice(0, 12)})`);
    const baselineResults = [];
    for (const [name, file] of available) {
      const logPath = resolve(baselineDir, `${name}.log`);
      writeFileSync(logPath, '');
      const started = Date.now();
      let suiteStarted = false, outputTail = '';
      const status = await new Promise((resolveRun, reject) => {
        const child = spawn(process.execPath,
          ['scripts/run-tests.mjs', '--only', name, '--verbose'],
          { cwd: checkout, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
          appendFileSync(logPath, chunk);
          outputTail = (outputTail + chunk.toString()).slice(-4096);
          suiteStarted ||= outputTail.includes(`[RUN ] ${name}`);
          if (verbose) process.stdout.write(chunk);
        });
        const progress = setInterval(() => console.log(`Baseline ${name} still running: ${logPath}`), 30000);
        progress.unref();
        const stop = () => child.kill('SIGTERM');
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        child.once('error', reject);
        child.once('close', (code) => {
          clearInterval(progress);
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
          resolveRun(code ?? 1);
        });
      });
      console.log(`Baseline ${name}: ${status === 0 ? 'pass' : 'FAIL'} (${logPath})`);
      baselineResults.push({ name, file, status, failed: status !== 0,
        incomplete: !suiteStarted, ms: Date.now() - started, logPath });
      if (interrupted) return 130;
    }
    writeFileSync(resolve(baselineDir, 'summary.json'), JSON.stringify({ suites: baselineResults }, null, 2));
    const currentStatus = await run(root, suites.map(([name]) => name), currentDir);
    const reportAt = (directory) => {
      const path = join(directory, 'summary.json');
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).suites : [];
    };
    const baseline = reportAt(baselineDir), current = reportAt(currentDir);
    const results = suites.map(([name]) => {
      const before = baseline.find((suite) => suite.name === name);
      const after = current.find((suite) => suite.name === name);
      const status = !after ? 'current run incomplete'
        : !before ? 'no baseline result'
          : before.incomplete ? 'baseline run incomplete'
          : after.failed ? (before.failed ? 'fails in both' : 'new failure')
            : before.failed ? 'now passes' : 'passes in both';
      console.log(`${name}: ${status}`);
      return { name, status, baseline: before, current: after };
    });
    writeFileSync(resolve(artifactDir, 'comparison.json'),
      `${JSON.stringify({ revision, results }, null, 2)}\n`);
    console.log(`Comparison: ${resolve(artifactDir, 'comparison.json')}`);
    return interrupted ? 130 : currentStatus;
  } finally {
    process.removeListener('SIGINT', noteInterrupt);
    process.removeListener('SIGTERM', noteInterrupt);
    rmSync(checkout, { recursive: true, force: true });
    rmSync(archive, { force: true });
  }
}
