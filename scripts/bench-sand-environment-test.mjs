import { compatibleSandBenchmarkConfig, compatibleSandTimingEnvironment } from './bench-sand-environment.mjs';

const metadata = {
  node: 'v22.1.0', platform: 'linux 6.1', arch: 'x64', cpu: 'Test CPU',
  wasm: { buildInfo: { toolchain: { emcc: 'emcc 6.0.3 (test)' } } },
};
const config = { COLS: 768, ROWS: 320, SEED: 1, SHIFT_COLS: 128, WARMUP_STEPS: 120, SHIFTS_EACH_WAY: 16, STEPS_PER_SHIFT: 8, scenario: 'pan-stream' };
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

console.log('sand benchmark environment guard');
check('matching environment is comparable', compatibleSandTimingEnvironment(metadata, structuredClone(metadata)).compatible);
check('OS releases do not invalidate same-platform timing', compatibleSandTimingEnvironment(metadata, { ...metadata, platform: 'linux 6.2' }).compatible);
check('different CPU invalidates timing', !compatibleSandTimingEnvironment(metadata, { ...metadata, cpu: 'Other CPU' }).compatible);
check('different toolchain invalidates timing', !compatibleSandTimingEnvironment(metadata, { ...metadata, wasm: { buildInfo: { toolchain: { emcc: 'emcc 6.0.2' } } } }).compatible);
check('legacy missing metadata invalidates timing', !compatibleSandTimingEnvironment(metadata, { node: 'v22.1.0', platform: 'linux' }).compatible);
check('matching benchmark config is comparable', compatibleSandBenchmarkConfig(config, structuredClone(config)).compatible);
check('different dimensions invalidate timing', !compatibleSandBenchmarkConfig(config, { ...config, COLS: 512 }).compatible);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
