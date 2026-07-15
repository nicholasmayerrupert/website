function createFallbackModule() {
  return import('../wasm/sandEngine.js')
    .then(({ default: createSandModule }) => createSandModule());
}

let threadedModulePromise = null;

function canUseThreadedModule() {
  const ua = globalThis.navigator?.userAgent || '';
  const webkit = /AppleWebKit/.test(ua) && !/(Chrome|Chromium|Edg|OPR)/.test(ua);
  // WebKit blocks Vite's nested Emscripten pthread bootstrap under COEP in
  // development. Production emits real hashed worker assets and remains
  // threaded; localhost uses the reliable single-thread module in both realms.
  return globalThis.crossOriginIsolated === true
    && typeof SharedArrayBuffer !== 'undefined'
    && globalThis.__sandForceSingleThread !== true
    && !(import.meta.env?.DEV && webkit);
}

function loadThreadedModule() {
  if (!threadedModulePromise) threadedModulePromise = import('../wasm/sandEngineThreaded.js');
  return threadedModulePromise;
}

export function preloadThreadedSandModule() {
  if (!canUseThreadedModule()) return;
  // Initialization owns the visible warning + fallback. Attach a handler now
  // so an early network failure cannot become a global unhandled rejection.
  loadThreadedModule().catch(() => {});
}

export function selectSandModule() {
  const threaded = canUseThreadedModule();
  return {
    threaded,
    fallback: createFallbackModule,
    promise: threaded
      ? loadThreadedModule().then(({ default: createThreadedModule }) => createThreadedModule())
      : createFallbackModule(),
  };
}
