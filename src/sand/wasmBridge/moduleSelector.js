import createSandModule from '../wasm/sandEngine.js';

export function selectSandModule() {
  const ua = globalThis.navigator?.userAgent || '';
  const webkit = /AppleWebKit/.test(ua) && !/(Chrome|Chromium|Edg|OPR)/.test(ua);
  // WebKit blocks Vite's nested Emscripten pthread bootstrap under COEP in
  // development. Production emits real hashed worker assets and remains
  // threaded; localhost uses the reliable single-thread module in both realms.
  const threaded = globalThis.crossOriginIsolated === true
    && typeof SharedArrayBuffer !== 'undefined'
    && !(import.meta.env?.DEV && webkit);
  return {
    threaded,
    fallback: createSandModule,
    promise: threaded
      ? import('../wasm/sandEngineThreaded.js').then(({ default: createThreadedModule }) => createThreadedModule())
      : createSandModule(),
  };
}
