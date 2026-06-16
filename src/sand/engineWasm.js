// The falling-sand engine, backed by the C++ core in cpp/sand.cpp (compiled to
// wasm/sandEngine.js). createEngineWasm() returns the simulation handle the game
// runtime drives.
//
// The wasm module is instantiated ONCE via initSandWasm(); createEngineWasm() is
// then synchronous. The grid lives in wasm linear memory and is handed to JS
// zero-copy as a HEAPU8 subarray (re-derived each call: the grid pointer swaps
// every step and the heap can move on growth).

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
        dirtyCount: c('engine_dirty_count', 'number', ['number']),
        chunkCols: c('engine_chunk_cols', 'number', ['number']),
        chunkRows: c('engine_chunk_rows', 'number', ['number']),
        buildDirtyRects: c('engine_build_dirty_rects', null, ['number']),
        dirtyRectCount: c('engine_dirty_rect_count', 'number', ['number']),
        dirtyRects: c('engine_dirty_rects', 'number', ['number']),
        clearDirty: c('engine_clear_dirty', null, ['number']),
        renderFull: c('engine_render_full', null, ['number']),
        renderDirtyRects: c('engine_render_dirty_rects', null, ['number']),
        renderPixels: c('engine_render_pixels', 'number', ['number']),
        renderPixelsLen: c('engine_render_pixels_len', 'number', ['number']),
        paintDisc: c('engine_paint_disc', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        eraseDisc: c('engine_erase_disc', 'number', ['number', 'number', 'number', 'number']),
        setSinks: c('engine_set_sinks', null, ['number', 'number']),
        syncComponents: c('engine_sync_components', null, ['number']),
        perfStepMs: c('engine_perf_step_ms', 'number', ['number']),
        perfDirtyChunks: c('engine_perf_dirty_chunks', 'number', ['number']),
        perfShiftBuffers: c('engine_perf_shift_buffers', 'number', ['number']),
        perfShiftTranslate: c('engine_perf_shift_translate', 'number', ['number']),
        perfShiftRegister: c('engine_perf_shift_register', 'number', ['number']),
        perfShiftFill: c('engine_perf_shift_fill', 'number', ['number']),
        perfStepGround: c('engine_perf_step_ground', 'number', ['number']),
        perfStepRigid: c('engine_perf_step_rigid', 'number', ['number']),
        perfStepReact: c('engine_perf_step_react', 'number', ['number']),
        perfStepCarry: c('engine_perf_step_carry', 'number', ['number']),
        perfStepSettle: c('engine_perf_step_settle', 'number', ['number']),
        perfStepTail: c('engine_perf_step_tail', 'number', ['number']),
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
        spawnBody: c('engine_spawn_body', null, ['number', 'number', 'number']),
        spawnBox: c('engine_spawn_box', null, ['number', 'number', 'number', 'number', 'number']),
        spawnDisc: c('engine_spawn_disc', null, ['number', 'number', 'number', 'number', 'number']),
        setTool: c('engine_set_tool', null, ['number', 'number']),
        pointerDown: c('engine_pointer_down', 'number', ['number', 'number', 'number', 'number']),
        pointerDraft: c('engine_pointer_draft', 'number', ['number', 'number', 'number']),
        pointerButtons: c('engine_pointer_buttons', null, ['number', 'number']),
        pointerUp: c('engine_pointer_up', 'number', ['number', 'number']),
        applyTool: c('engine_apply_tool', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        draftIsDriftwood: c('engine_draft_is_driftwood', 'number', ['number']),
        seedDraft: c('engine_seed_draft', 'number', ['number', 'number']),
        bodyCount: c('engine_body_count', 'number', ['number']),
        bodyBlocked: c('engine_body_blocked', 'number', ['number', 'number']),
        bodyAwake: c('engine_body_awake', 'number', ['number', 'number']),
        rigidRejected: c('engine_rigid_rejected', 'number', ['number']),
        rigidDepen: c('engine_rigid_depen', 'number', ['number']),
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
  const emptyRects = new Int32Array(0);
  const chunkTotal = chunkCols * chunkRows;

  // Scratch buffers in wasm memory: getSeedOrigin (2 ints), seedDraft (3 ints).
  const seedOut = mod._malloc(8);
  const seedDraftOut = mod._malloc(12);
  // Packed draft cell INDICES (k = y*cols + x) as a zero-copy view into wasm
  // memory — no Set allocation. Stone and ice share one snapshot buffer, so the
  // returned view is only valid until the next draft snapshot call; the caller
  // must fully consume one draft before requesting the other.
  const draftCells = (count) => (count ? new Int32Array(mod.HEAP32.buffer, M.draftPtr(ptr), count) : emptyRects);

  return {
    cols,
    rows,
    chunkCols,
    chunkRows,
    step() { return M.step(ptr) === 1; },
    getGrid() { return gridView(); },
    // Build the coalesced dirty rects in C++ and hand back a zero-copy view.
    // buildDirtyRects may grow wasm memory (its rect vector), so the HEAP32
    // view is created AFTER the call. dirtyChunkCount/chunkTotal drive the
    // full-vs-incremental repaint decision; rects are [x0,y0,x1,y1) exclusive.
    getRenderDirty() {
      M.buildDirtyRects(ptr);
      const rectCount = M.dirtyRectCount(ptr);
      const rects = rectCount ? new Int32Array(mod.HEAP32.buffer, M.dirtyRects(ptr), rectCount * 4) : emptyRects;
      return { rects, rectCount, dirtyChunkCount: M.dirtyCount(ptr), chunkTotal };
    },
    clearRenderDirty() { M.clearDirty(ptr); },
    // Material -> RGBA generation in C++. renderFull/renderDirtyRects write into
    // the engine's pixel buffer; getRenderPixels returns a fresh ImageData-ready
    // view of it (re-derived each call: wasm memory can move on growth).
    renderFull() { M.renderFull(ptr); },
    renderDirtyRects() { M.renderDirtyRects(ptr); },
    getRenderPixels() { return new Uint8ClampedArray(mod.HEAPU8.buffer, M.renderPixels(ptr), cellCount * 4); },
    paintDisc(cx, cy, r, material, overwrite = false) {
      return M.paintDisc(ptr, cx, cy, r, material, overwrite ? 1 : 0) === 1;
    },
    eraseDisc(cx, cy, r) { return M.eraseDisc(ptr, cx, cy, r) === 1; },
    setSinksOn(v) { M.setSinks(ptr, v ? 1 : 0); },
    setEmittersOn() {},

    // Tool / pointer input. JS translates browser coords to cells and normalizes
    // buttons; the engine owns all tool policy. The pointer/draft/up calls and
    // applyTool return whether the draft preview changed.
    setTool(tool) { M.setTool(ptr, tool); },
    pointerDown(cx, cy, button) { return M.pointerDown(ptr, cx, cy, button) === 1; },
    pointerDraft(cx, cy) { return M.pointerDraft(ptr, cx, cy) === 1; },
    pointerButtons(buttons) { M.pointerButtons(ptr, buttons); },
    pointerUp(button) { return M.pointerUp(ptr, button) === 1; },
    applyTool(cx, cy, now, inside, drawMode) { return M.applyTool(ptr, cx, cy, now, inside ? 1 : 0, drawMode ? 1 : 0) === 1; },
    isDraftDriftwood() { return M.draftIsDriftwood(ptr) === 1; },
    getSeedDraft() {
      if (M.seedDraft(ptr, seedDraftOut) !== 1) return null;
      const o = seedDraftOut >> 2;
      return { x: mod.HEAP32[o], y: mod.HEAP32[o + 1], valid: mod.HEAP32[o + 2] === 1 };
    },
    getPerf() { return { stepMs: M.perfStepMs(ptr), dirtyChunks: M.perfDirtyChunks(ptr), phases: {} }; },
    getShiftPerf() { return { buffers: M.perfShiftBuffers(ptr), translate: M.perfShiftTranslate(ptr), register: M.perfShiftRegister(ptr), fill: M.perfShiftFill(ptr) }; },
    getStepPerf() { return { ground: M.perfStepGround(ptr), rigid: M.perfStepRigid(ptr), react: M.perfStepReact(ptr), carry: M.perfStepCarry(ptr), settle: M.perfStepSettle(ptr), tail: M.perfStepTail(ptr) }; },
    getTick() { return M.tick(ptr); },
    syncComponents() { M.syncComponents(ptr); },
    destroy() { mod._free(seedOut); mod._free(seedDraftOut); M.destroy(ptr); },

    // Component drafts + seeds (Stage 3)
    addDiscToStoneDraft(cx, cy, r) { return M.addStoneDraft(ptr, cx, cy, r) === 1; },
    addDiscToIceDraft(cx, cy, r) { return M.addIceDraft(ptr, cx, cy, r) === 1; },
    finalizeStoneDraft() { M.finalizeStoneDraft(ptr); },
    finalizeIceDraft() { M.finalizeIceDraft(ptr); },
    finalizeDriftwoodDraft() { M.finalizeDriftwoodDraft(ptr); },
    clearStoneDraft() { M.clearStoneDraft(ptr); },
    clearIceDraft() { M.clearIceDraft(ptr); },
    getStoneDraftCells() { return draftCells(M.stoneDraftSnapshot(ptr)); },
    getIceDraftCells() { return draftCells(M.iceDraftSnapshot(ptr)); },
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

    // Free rigid bodies (Stage 4)
    spawnBody(cells) {
      const nn = cells.length;
      if (!nn) return null;
      const buf = mod._malloc(nn * 8);
      const base = buf >> 2;
      for (let i = 0; i < nn; i++) { mod.HEAP32[base + i * 2] = cells[i][0]; mod.HEAP32[base + i * 2 + 1] = cells[i][1]; }
      M.spawnBody(ptr, buf, nn);
      mod._free(buf);
      return {}; // opaque handle; the engine owns the body
    },
    // Primitive bodies built engine-side (no coordinate array marshalling).
    spawnBox(cx, cy, halfW, halfH, material = MAT.RIGID) { M.spawnBox(ptr, cx, cy, halfW, halfH, material); },
    spawnDisc(cx, cy, radius, material = MAT.RIGID) { M.spawnDisc(ptr, cx, cy, radius, material); },
    getBodies() { return []; }, // render reads RIGID cells from the grid; bodies need no JS mirror
    bodyFootprintBlocked() { return 0; },
    getRigidDebug() { return { rejectedCells: M.rigidRejected(ptr), depenetrations: M.rigidDepen(ptr) }; },
    // test hooks
    _bodyCount() { return M.bodyCount(ptr); },
    _bodyBlocked(i) { return M.bodyBlocked(ptr, i); },
    _bodyAwake(i) { return M.bodyAwake(ptr, i); },
  };
}
