import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runScenario({ scenario = 'placement', sizes, steps = 92,
  seed = scenario === 'placement' ? 1 : 1401181199, repeat = 1,
  timeoutMs = 30000, wasm, profile = false,
  artifacts = `.sand-artifacts/scenarios/${Date.now()}-${process.pid}` } = {}) {
  if (!['placement', 'aftermath'].includes(scenario)) throw new Error(`Unknown scenario ${scenario}`);
  sizes = sizes?.length ? sizes : [40, 80];
  if (sizes.some((size) => !Number.isInteger(size) || size < 20 || size > 480))
    throw new Error('Sizes must be integers from 20 through 480');
  for (const [name, value] of Object.entries({ steps, repeat, timeoutMs }))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('seed must be an unsigned 32-bit integer');
  const directory = resolve(artifacts);
  mkdirSync(directory, { recursive: true });
  const root = fileURLToPath(new URL('..', import.meta.url));
  const loader = resolve(wasm || resolve(root, 'src/sand/wasm/sandEngine.js'));
  execFileSync(process.execPath, ['scripts/write-wasm-build-info.mjs', '--check',
    ...(wasm ? ['--allow-dev', '--allow-profile'] : []), loader], { cwd: root });
  const engine = JSON.parse(readFileSync(resolve(dirname(loader), 'build-info.json'), 'utf8'));
  const config = { scenario, sizes, steps, seed, repeat, timeoutMs, wasm: loader, profile, engine };
  writeFileSync(resolve(directory, 'config.json'), JSON.stringify(config, null, 2));
  const results = [];
  for (let repetition = 0; repetition < repeat; repetition++) {
    let last = { phase: 'initializing' }, timer, progress;
    const events = [];
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { scenario, sizes, steps, seed, profile },
      execArgv: wasm ? ['--import', fileURLToPath(new URL('./sand-wasm-loader.mjs', import.meta.url))] : [],
      env: { ...process.env, ...(wasm ? { SAND_WASM_LOADER: resolve(wasm) } : {}) },
    });
    try {
      const result = await new Promise((resolveRun, reject) => {
        let completed = false;
        const arm = () => {
          clearTimeout(timer);
          timer = setTimeout(() => reject(new Error(
            `Scenario stalled for ${timeoutMs} ms: ${JSON.stringify(last)}`)), timeoutMs);
        };
        arm();
        progress = setInterval(() => console.log(`Running ${scenario}: ${JSON.stringify(last)}`), 5000);
        worker.on('message', (message) => {
          arm();
          if (message.done) { completed = true; resolveRun(message); return; }
          last = message;
          if (!message.phase) events.push(message);
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (!completed) reject(new Error(`Scenario exited with ${code}: ${JSON.stringify(last)}`));
        });
      });
      if (result.profile) writeFileSync(resolve(directory, `${scenario}-${repetition}.cpuprofile`), JSON.stringify(result.profile));
      const samples = new Map();
      for (const event of events) {
        const key = event.releaseMs !== undefined ? `release-${event.size}-${event.moving ? 'moving' : 'static'}`
          : event.worldMs !== undefined ? 'step-world' : null;
        if (!key) continue;
        if (!samples.has(key)) samples.set(key, []);
        samples.get(key).push(event.releaseMs ?? event.worldMs);
      }
      const metrics = [...samples].map(([operation, values]) => {
        values.sort((a, b) => a - b);
        const percentile = (p) => values[Math.floor((values.length - 1) * p)];
        return { operation, count: values.length, p50: percentile(0.5),
          p95: percentile(0.95), p99: percentile(0.99), max: values.at(-1) };
      });
      results.push({ repetition, metrics, events });
      console.log(JSON.stringify({ scenario, repetition, metrics }));
    } catch (error) {
      writeFileSync(resolve(directory, 'failure.json'), JSON.stringify({ config, repetition, last, events, error: error.message }, null, 2));
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(progress);
      await worker.terminate();
    }
  }
  writeFileSync(resolve(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Artifacts: ${directory}`);
  return results;
}

if (!isMainThread) {
  let session;
  const post = (method) => new Promise((resolveCall, reject) =>
    session.post(method, (error, result) => error ? reject(error) : resolveCall(result)));
  if (workerData.profile) {
    const { Session } = await import('node:inspector');
    session = new Session();
    session.connect();
    await post('Profiler.enable');
    await post('Profiler.start');
  }
  const scenarios = await import('./tnt-scenarios.mjs');
  await scenarios[workerData.scenario]({ ...workerData, report: (event) => parentPort.postMessage(event) });
  const profile = session ? (await post('Profiler.stop')).profile : undefined;
  session?.disconnect();
  parentPort.postMessage({ done: true, profile });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const flags = { '--scenario': 'scenario', '--sizes': 'sizes', '--steps': 'steps',
    '--seed': 'seed', '--repeat': 'repeat', '--timeout-ms': 'timeoutMs',
    '--wasm': 'wasm', '--artifacts': 'artifacts' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--profile') { options.profile = true; continue; }
    if (!flags[flag] || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`Expected an option/value pair: ${flag}`);
    const value = args[++index];
    options[flags[flag]] = flag === '--sizes' ? value.split(',').map(Number)
      : ['--steps', '--seed', '--repeat', '--timeout-ms'].includes(flag) ? Number(value) : value;
  }
  await runScenario(options);
}
