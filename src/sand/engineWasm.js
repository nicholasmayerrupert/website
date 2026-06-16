// Drop-in WebAssembly engine: same public shape as createEngine() in engine.js,
// backed by the C++ core in cpp/sand.cpp (compiled to wasm/sandEngine.js).
//
// The wasm module is instantiated ONCE via initSandWasm(); createEngineWasm()
// is then synchronous. The grid lives in wasm linear memory and is handed to JS
// zero-copy as a HEAPU8 subarray (re-derived each call: the grid pointer swaps
// every step and the heap can move on growth).
//
// STAGE 1: core CA + paint/erase for non-component materials. Component drafts,
// seeds, rigid bodies, reactions, growth, and streaming are stubbed until the
// matching C++ stage lands (so the host never crashes), and clearly marked.

import createSandModule from './wasm/sandEngine.js';
import { MAT } from './materials.js';

export { MAT };
export const CHUNK_SIZE = 32;
export const SEED_SIZE = 2;

let modPromise = null;
let M = null; // resolved module + cwrapped fns

export function initSandWasm() {
  if (!modPromise) {
    modPromise = createSandModule().then((mod) => {
      const c = (name, ret, args) => mod.cwrap(name, ret, args);
      M = {
        mod,
        create: c('engine_create', 'number', ['number', 'number', 'number', 'number']),
        destroy: c('engine_destroy', null, ['number']),
        step: c('engine_step', 'number', ['number']),
        grid: c('engine_grid', 'number', ['number']),
        dirty: c('engine_dirty', 'number', ['number']),
        dirtyCount: c('engine_dirty_count', 'number', ['number']),
        chunkCols: c('engine_chunk_cols', 'number', ['number']),
        chunkRows: c('engine_chunk_rows', 'number', ['number']),
        foldDirty: c('engine_fold_dirty', null, ['number']),
        clearDirty: c('engine_clear_dirty', null, ['number']),
        paintDisc: c('engine_paint_disc', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        eraseDisc: c('engine_erase_disc', 'number', ['number', 'number', 'number', 'number']),
        setSinks: c('engine_set_sinks', null, ['number', 'number']),
        perfStepMs: c('engine_perf_step_ms', 'number', ['number']),
        perfDirtyChunks: c('engine_perf_dirty_chunks', 'number', ['number']),
        tick: c('engine_tick', 'number', ['number']),
      };
      return M;
    });
  }
  return modPromise;
}

export function isSandWasmReady() { return M !== null; }

// Mirror createEngine({...}) from engine.js. Requires initSandWasm() resolved.
export function createEngineWasm({
  cols,
  rows,
  rng = Math.random,
  emittersOn = true, // eslint-disable-line no-unused-vars
  sinksOn = true,
  infinite = false, // eslint-disable-line no-unused-vars
  worldSeed = (Math.floor((rng() || Math.random()) * 4294967296) >>> 0),
} = {}) {
  if (!M) throw new Error('initSandWasm() must resolve before createEngineWasm()');
  const { mod } = M;
  const ptr = M.create(cols, rows, worldSeed >>> 0, sinksOn ? 1 : 0);
  const chunkCols = M.chunkCols(ptr);
  const chunkRows = M.chunkRows(ptr);
  const cellCount = cols * rows;

  // Fresh views each call: grid swaps every step; ALLOW_MEMORY_GROWTH can detach.
  const gridView = () => new Uint8Array(mod.HEAPU8.buffer, M.grid(ptr), cellCount);
  const dirtyView = () => new Uint8Array(mod.HEAPU8.buffer, M.dirty(ptr), chunkCols * chunkRows);

  const noopSet = new Set();
  return {
    cols,
    rows,
    chunkCols,
    chunkRows,
    step() { return M.step(ptr) === 1; },
    getGrid() { return gridView(); },
    getRenderDirty() {
      M.foldDirty(ptr);
      return { dirtyRender: dirtyView(), dirtyRenderCount: M.dirtyCount(ptr), chunkCols, chunkRows };
    },
    clearRenderDirty() { M.clearDirty(ptr); },
    paintDisc(cx, cy, r, material, overwrite = false) {
      return M.paintDisc(ptr, cx, cy, r, material, overwrite ? 1 : 0) === 1;
    },
    eraseDisc(cx, cy, r) { return M.eraseDisc(ptr, cx, cy, r) === 1; },
    setSinksOn(v) { M.setSinks(ptr, v ? 1 : 0); },
    setEmittersOn() {},
    getPerf() { return { stepMs: M.perfStepMs(ptr), dirtyChunks: M.perfDirtyChunks(ptr), phases: {} }; },
    getTick() { return M.tick(ptr); },
    destroy() { M.destroy(ptr); },

    // --- Stubs until later C++ stages (host must not crash) ---
    getWorldOffsetX() { return 0; },
    worldSurfaceAt() { return 0; },
    shiftWorld() {},
    getSeedOrigin() { return null; },
    canPlaceSeedAt() { return false; },
    placeSeedAt() { return false; },
    addDiscToStoneDraft() { return false; },
    finalizeStoneDraft() {},
    finalizeDriftwoodDraft() {},
    clearStoneDraft() {},
    getStoneDraftCells() { return noopSet; },
    addDiscToIceDraft() { return false; },
    finalizeIceDraft() {},
    clearIceDraft() {},
    getIceDraftCells() { return noopSet; },
    spawnBody() { return null; },
    getBodies() { return []; },
    bodyFootprintBlocked() { return 0; },
    getRigidDebug() { return { rejectedCells: 0, depenetrations: 0 }; },
    syncComponents() {},
  };
}
