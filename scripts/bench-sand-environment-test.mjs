import {
  compatibleSandBenchmarkConfig,
  compatibleSandTimingEnvironment,
  sandBenchmarkGateMetric,
} from './bench-sand-environment.mjs';

const metadata = {
  node: 'v22.1.0', platform: 'linux 6.1', arch: 'x64', cpu: 'Test CPU',
  wasm: { buildInfo: { variant: 'production', toolchain: { emcc: 'emcc 6.0.3 (test)' } } },
};
const config = { COLS: 768, ROWS: 320, SEED: 1, SHIFT_COLS: 128, WARMUP_STEPS: 120, SHIFTS_EACH_WAY: 16, STEPS_PER_SHIFT: 8, scenario: 'pan-stream', checksumOnly: false, checksumScope: 'foreground+background' };
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

console.log('sand benchmark environment guard');
check('matching environment is comparable', compatibleSandTimingEnvironment(metadata, structuredClone(metadata)).compatible);
check('OS releases do not invalidate same-platform timing', compatibleSandTimingEnvironment(metadata, { ...metadata, platform: 'linux 6.2' }).compatible);
check('different CPU invalidates timing', !compatibleSandTimingEnvironment(metadata, { ...metadata, cpu: 'Other CPU' }).compatible);
check('different toolchain invalidates timing', !compatibleSandTimingEnvironment(metadata, { ...metadata, wasm: { buildInfo: { variant: 'production', toolchain: { emcc: 'emcc 6.0.2' } } } }).compatible);
check('development builds invalidate production timing', !compatibleSandTimingEnvironment(metadata, { ...metadata, wasm: { buildInfo: { variant: 'dev', toolchain: { emcc: 'emcc 6.0.3 (test)' } } } }).compatible);
check('legacy missing metadata invalidates timing', !compatibleSandTimingEnvironment(metadata, { node: 'v22.1.0', platform: 'linux' }).compatible);
check('matching benchmark config is comparable', compatibleSandBenchmarkConfig(config, structuredClone(config)).compatible);
check('different dimensions invalidate timing', !compatibleSandBenchmarkConfig(config, { ...config, COLS: 512 }).compatible);
check('checksum-only runs do not compare against render-interleaved timing',
  !compatibleSandBenchmarkConfig(config, { ...config, checksumOnly: true }).compatible);

const resultWithRunP99s = (aggregate, values) => ({
  step: { p99: aggregate },
  runs: values.map((p99) => ({ step: { p99 } })),
});
const stableBaseline = resultWithRunP99s(10, [10, 10, 10, 10, 10]);
const isolatedSpike = sandBenchmarkGateMetric(
  stableBaseline,
  resultWithRunP99s(30, [11, 11, 100, 11, 11]),
  'step',
  'p99',
);
check('repeated-run gate ignores one noisy run',
  isolatedSpike.method === 'median-run' && isolatedSpike.baseline === 10 && isolatedSpike.current === 11);
const persistentRegression = sandBenchmarkGateMetric(
  stableBaseline,
  resultWithRunP99s(30, [12, 12, 30, 30, 30]),
  'step',
  'p99',
);
check('repeated-run gate retains a majority regression',
  persistentRegression.method === 'median-run' && persistentRegression.current === 30);
const singleRun = sandBenchmarkGateMetric(
  stableBaseline,
  resultWithRunP99s(25, [25]),
  'step',
  'p99',
);
check('single-run comparisons retain aggregate gating',
  singleRun.method === 'aggregate' && singleRun.baseline === 10 && singleRun.current === 25);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
