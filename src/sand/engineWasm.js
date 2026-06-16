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
        create: c('engine_create', 'number', ['number', 'number', 'number', 'number', 'number']),
        shiftWorld: c('engine_shift_world', null, ['number', 'number']),
        worldOffsetX: c('engine_world_offset_x', 'number', ['number']),
        worldSurfaceAt: c('engine_world_surface_at', 'number', ['number', 'number']),
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
        syncComponents: c('engine_sync_components', null, ['number']),
        perfStepMs: c('engine_perf_step_ms', 'number', ['number']),
        perfDirtyChunks: c('engine_perf_dirty_chunks', 'number', ['number']),
        tick: c('engine_tick', 'number', ['number']),
        addStoneDraft: c('engine_add_stone_draft', 'number', ['number', 'number', 'number', 'number']),
        addIceDraft: c('engine_add_ice_draft', 'number', ['number', 'number', 'number', 'number']),
        finalizeStoneDraft: c('engine_finalize_stone_draft', null, ['number']),
        finalizeIceDraft: c('engine_finalize_ice_draft', null, ['number']),
        finalizeDriftwoodDraft: c('engine_finalize_driftwood_draft', null, ['number']),
        clearStoneDraft: c('engine_clear_stone_draft', null, ['number']),
        clearIceDraft: c('engine_clear_ice_draft', null, ['number']),
        stoneDraftSnapshot: c('engine_stone_draft_snapshot', 'number', ['number']),
        iceDraftSnapshot: c('engine_ice_draft_snapshot', 'number', ['number']),
        draftPtr: c('engine_draft_ptr', 'number', ['number']),
        getSeedOrigin: c('engine_get_seed_origin', 'number', ['number', 'number', 'number', 'number']),
        canPlaceSeed: c('engine_can_place_seed', 'number', ['number', 'number', 'number']),
        placeSeed: c('engine_place_seed', 'number', ['number', 'number', 'number']),
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
  infinite = false,
  worldSeed = (Math.floor((rng() || Math.random()) * 4294967296) >>> 0),
} = {}) {
  if (!M) throw new Error('initSandWasm() must resolve before createEngineWasm()');
  const { mod } = M;
  const ptr = M.create(cols, rows, worldSeed >>> 0, sinksOn ? 1 : 0, infinite ? 1 : 0);
  const chunkCols = M.chunkCols(ptr);
  const chunkRows = M.chunkRows(ptr);
  const cellCount = cols * rows;

  // Fresh views each call: grid swaps every step; ALLOW_MEMORY_GROWTH can detach.
  const gridView = () => new Uint8Array(mod.HEAPU8.buffer, M.grid(ptr), cellCount);
  const dirtyView = () => new Uint8Array(mod.HEAPU8.buffer, M.dirty(ptr), chunkCols * chunkRows);

  // Scratch buffer in wasm memory for getSeedOrigin (2 ints).
  const seedOut = mod._malloc(8);
  const draftSet = (count) => {
    const base = M.draftPtr(ptr) >> 2;
    const view = new Int32Array(mod.HEAP32.buffer, base << 2, count);
    const s = new Set();
    for (let i = 0; i < count; i++) s.add(view[i]);
    return s;
  };

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
    syncComponents() { M.syncComponents(ptr); },
    destroy() { mod._free(seedOut); M.destroy(ptr); },

    // Component drafts + seeds (Stage 3)
    addDiscToStoneDraft(cx, cy, r) { return M.addStoneDraft(ptr, cx, cy, r) === 1; },
    addDiscToIceDraft(cx, cy, r) { return M.addIceDraft(ptr, cx, cy, r) === 1; },
    finalizeStoneDraft() { M.finalizeStoneDraft(ptr); },
    finalizeIceDraft() { M.finalizeIceDraft(ptr); },
    finalizeDriftwoodDraft() { M.finalizeDriftwoodDraft(ptr); },
    clearStoneDraft() { M.clearStoneDraft(ptr); },
    clearIceDraft() { M.clearIceDraft(ptr); },
    getStoneDraftCells() { return draftSet(M.stoneDraftSnapshot(ptr)); },
    getIceDraftCells() { return draftSet(M.iceDraftSnapshot(ptr)); },
    getSeedOrigin(cx, cy) {
      if (M.getSeedOrigin(ptr, cx, cy, seedOut) !== 1) return null;
      const o = seedOut >> 2;
      return [mod.HEAP32[o], mod.HEAP32[o + 1]];
    },
    canPlaceSeedAt(x0, y0) { return M.canPlaceSeed(ptr, x0, y0) === 1; },
    placeSeedAt(x0, y0) { return M.placeSeed(ptr, x0, y0) === 1; },

    // Streaming infinite world (Stage 5)
    getWorldOffsetX() { return M.worldOffsetX(ptr); },
    worldSurfaceAt(worldX) { return M.worldSurfaceAt(ptr, worldX); },
    shiftWorld(dx) { M.shiftWorld(ptr, dx); },

    // --- Stubs until Stage 4 free rigid bodies (host must not crash) ---
    spawnBody() { return null; },
    getBodies() { return []; },
    bodyFootprintBlocked() { return 0; },
    getRigidDebug() { return { rejectedCells: 0, depenetrations: 0 }; },
  };
}
