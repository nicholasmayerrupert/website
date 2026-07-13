import createSandModule from '../wasm/sandEngine.js';

export function selectSandModule() {
  const threaded = globalThis.crossOriginIsolated === true
    && typeof SharedArrayBuffer !== 'undefined';
  return {
    threaded,
    promise: threaded
      ? import('../wasm/sandEngineThreaded.js').then(({ default: createThreadedModule }) => createThreadedModule())
      : createSandModule(),
  };
}
