// Public compatibility entrypoint for the C++/WASM sand engine.
//
// The implementation lives in wasmBridge/ so the runtime-facing import remains
// stable while the bridge can be split into focused internals.

export {
  CHUNK_SIZE,
  INPUT,
  MAT,
  SEED_SIZE,
  createEngineWasm,
  initSandWasm,
  isSandWasmReady,
} from './wasmBridge/engineFactory.js';
