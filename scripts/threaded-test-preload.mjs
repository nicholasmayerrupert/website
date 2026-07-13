// Opt Node test processes into the pthread WASM module. Keep navigator's core
// count aligned with emscripten_num_logical_cores() so the prewarmed worker pool
// matches the C++ scheduler's adaptive worker count.
import { availableParallelism } from 'node:os';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { hardwareConcurrency: Math.max(2, Number(process.env.SAND_TEST_CORES) || availableParallelism()) },
});
globalThis.crossOriginIsolated = true;
