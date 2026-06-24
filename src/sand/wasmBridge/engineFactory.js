// The falling-sand engine, backed by the C++ core in cpp/sand.cpp (compiled to
// wasm/sandEngine.js). createEngineWasm() returns the simulation handle the game
// runtime drives.
//
// The wasm module is instantiated ONCE via initSandWasm(); createEngineWasm() is
// then synchronous. The grid lives in wasm linear memory and is handed to JS
// zero-copy as a HEAPU8 subarray (re-derived each call: the grid pointer swaps
// every step and the heap can move on growth).

import createSandModule from '../wasm/sandEngine.js';
import { MAT } from '../materials.js';

export { MAT };
export const CHUNK_SIZE = 32;
export const SEED_SIZE = 1;

// Player input bitmask — mirrors `enum PlayerInput` in cpp/engine/common.hpp.
// Shared by the browser input layer and the network protocol.
export const INPUT = Object.freeze({
  LEFT: 1, RIGHT: 2, JUMP: 4, DOWN: 8, PRIMARY: 16, SECONDARY: 32, RUN: 64,
});

let modPromise = null;
let M = null; // resolved module + cwrapped fns
let glTargetSeq = 0; // unique key per canvas for emscripten's specialHTMLTargets

export function initSandWasm() {
  if (!modPromise) {
    modPromise = createSandModule().then((mod) => {
      const c = (name, ret, args) => mod.cwrap(name, ret, args);
      M = {
        mod,
        create: c('engine_create', 'number', ['number', 'number', 'number', 'number', 'number']),
        shiftWorld: c('engine_shift_world', null, ['number', 'number']),
        shiftWorldXY: c('engine_shift_world_xy', null, ['number', 'number', 'number']),
        maybeShiftWorld: c('engine_maybe_shift_world', 'number', ['number', 'number', 'number', 'number']),
        maybeShiftWorldV: c('engine_maybe_shift_world_v', 'number', ['number', 'number', 'number', 'number']),
        worldShiftCount: c('engine_world_shift_count', 'number', ['number']),
        prefetchAdvance: c('engine_prefetch_advance', null, ['number', 'number', 'number', 'number', 'number']),
        shiftFillHit: c('engine_shift_fill_hit', 'number', ['number']),
        shiftFillMiss: c('engine_shift_fill_miss', 'number', ['number']),
        worldOffsetX: c('engine_world_offset_x', 'number', ['number']),
        worldOffsetY: c('engine_world_offset_y', 'number', ['number']),
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
        placeMaterial: c('engine_place_material', 'number', ['number', 'number', 'number', 'number', 'number']),
        placeMaterialLayer: c('engine_place_material_layer', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
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
        placeSeedTyped: c('engine_place_seed_typed', 'number', ['number', 'number', 'number', 'number']),
        spawnBody: c('engine_spawn_body', null, ['number', 'number', 'number']),
        spawnBox: c('engine_spawn_box', null, ['number', 'number', 'number', 'number', 'number']),
        spawnDisc: c('engine_spawn_disc', null, ['number', 'number', 'number', 'number', 'number']),
        setTool: c('engine_set_tool', null, ['number', 'number']),
        setCreativeMaterial: c('engine_set_creative_material', null, ['number', 'number', 'number']),
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
        spawnPlayer: c('engine_spawn_player', 'number', ['number', 'number', 'number']),
        spawnPlayerSurface: c('engine_spawn_player_surface', 'number', ['number', 'number']),
        playerSurfaceSpawn: c('engine_player_surface_spawn', null, ['number', 'number', 'number']),
        playerWidth: c('engine_player_width', 'number', []),
        playerHeight: c('engine_player_height', 'number', []),
        removePlayer: c('engine_remove_player', null, ['number', 'number']),
        setPlayerInput: c('engine_set_player_input', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        playerCount: c('engine_player_count', 'number', ['number']),
        playerSnapshot: c('engine_player_snapshot', 'number', ['number']),
        playerSnapshotPtr: c('engine_player_snapshot_ptr', 'number', ['number']),
        playerSnapshotStride: c('engine_player_snapshot_stride', 'number', ['number']),
        playerActionCount: c('engine_player_action_count', 'number', ['number']),
        stepPlayerOnly: c('engine_step_player_only', null, ['number', 'number']),
        setPlayerTool: c('engine_set_player_tool', null, ['number', 'number', 'number', 'number']),
        playerMine: c('engine_player_mine', 'number', ['number', 'number', 'number', 'number']),
        setPlayerState: c('engine_set_player_state', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
        spawnItem: c('engine_spawn_item', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        spawnParticle: c('engine_spawn_particle', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        itemCount: c('engine_item_count', 'number', ['number']),
        itemSnapshot: c('engine_item_snapshot', 'number', ['number']),
        itemSnapshotPtr: c('engine_item_snapshot_ptr', 'number', ['number']),
        itemSnapshotStride: c('engine_item_snapshot_stride', 'number', ['number']),
        setSurvivalInventory: c('engine_set_survival_inventory', null, ['number', 'number']),
        seedStarterTools: c('engine_seed_starter_tools', null, ['number', 'number']),
        addToInventory: c('engine_add_to_inventory', 'number', ['number', 'number', 'number', 'number']),
        setSelectedSlot: c('engine_set_selected_slot', null, ['number', 'number', 'number']),
        cycleSelectedSlot: c('engine_cycle_selected_slot', null, ['number', 'number', 'number']),
        inventoryMove: c('engine_inventory_move', null, ['number', 'number', 'number', 'number']),
        placeFromSelected: c('engine_place_from_selected', 'number', ['number', 'number', 'number', 'number']),
        inventorySnapshot: c('engine_inventory_snapshot', 'number', ['number', 'number']),
        inventorySnapshotPtr: c('engine_inventory_snapshot_ptr', 'number', ['number']),
        inventorySnapshotStride: c('engine_inventory_snapshot_stride', 'number', ['number']),
        inventoryCursorPick: c('engine_inventory_cursor_pick', null, ['number', 'number', 'number', 'number']),
        inventoryThrowFromCursor: c('engine_inventory_throw_from_cursor', 'number', ['number', 'number', 'number']),
        cursorSnapshot: c('engine_cursor_snapshot', 'number', ['number', 'number']),
        cursorSnapshotPtr: c('engine_cursor_snapshot_ptr', 'number', ['number']),
        serializeWorld: c('engine_serialize_world', 'number', ['number']),
        serializeDiff: c('engine_serialize_diff', 'number', ['number']),
        netBlobPtr: c('engine_net_blob_ptr', 'number', ['number']),
        applyWorld: c('engine_apply_world', null, ['number', 'number', 'number']),
        applyDiff: c('engine_apply_diff', null, ['number', 'number', 'number']),
        gridHash: c('engine_grid_hash', 'number', ['number']),
        clearAllDirty: c('engine_clear_all_dirty', null, ['number']),
        gridBg: c('engine_grid_bg', 'number', ['number']),
        setBgEnabled: c('engine_set_bg_enabled', null, ['number', 'number']),
        paintDiscLayer: c('engine_paint_disc_layer', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        eraseDiscLayer: c('engine_erase_disc_layer', 'number', ['number', 'number', 'number', 'number', 'number']),
        syncComponentsLayer: c('engine_sync_components_layer', null, ['number', 'number']),
        glInit: c('engine_gl_init', 'number', ['number', 'string']),
        glResize: c('engine_gl_resize', null, ['number', 'number', 'number']),
        glSetFlags: c('engine_gl_set_flags', null, ['number', 'number', 'number']),
        glSetPlayers: c('engine_gl_set_players', null, ['number', 'number', 'number', 'number', 'number']),
        glSetItems: c('engine_gl_set_items', null, ['number', 'number', 'number', 'number']),
        glShift: c('engine_gl_shift', null, ['number', 'number']),
        glRenderFrame: c('engine_gl_render_frame', 'number', ['number', 'number']),
        glGetOffset: c('engine_gl_get_offset', null, ['number', 'number']),
        glReadPixels: c('engine_gl_read_pixels', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        setViewport: c('engine_set_viewport', null, ['number', 'number', 'number', 'number', 'number']),
        cameraSet: c('engine_camera_set', null, ['number', 'number', 'number']),
        cameraGet: c('engine_camera_get', null, ['number', 'number']),
        cameraColX: c('engine_camera_col_x', 'number', ['number']),
        cameraPanFrame: c('engine_camera_pan_frame', null, ['number', 'number']),
        cameraFollowTo: c('engine_camera_follow_to', null, ['number', 'number', 'number']),
        streamWorld: c('engine_stream_world', 'number', ['number']),
        inputKey: c('engine_input_key', null, ['number', 'number', 'number']),
        inputClearKeys: c('engine_input_clear_keys', null, ['number']),
        heldKeys: c('engine_held_keys', 'number', ['number']),
        inputPointer: c('engine_input_pointer', null, ['number', 'number', 'number', 'number', 'number']),
        setPlayMode: c('engine_set_play_mode', null, ['number', 'number']),
        setDrawMode: c('engine_set_draw_mode', null, ['number', 'number']),
        localInputBits: c('engine_local_input_bits', 'number', ['number']),
        aimCell: c('engine_aim_cell', null, ['number', 'number']),
        applyLocalInput: c('engine_apply_local_input', 'number', ['number', 'number', 'number', 'number']),
        pointerDraftAtAim: c('engine_pointer_draft_at_aim', 'number', ['number']),
        pointerDownAtAim: c('engine_pointer_down_at_aim', 'number', ['number', 'number']),
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

  // Scratch buffers in wasm memory: getSeedOrigin (2 ints), seedDraft (3 ints),
  // glGetOffset (2 ints).
  const seedOut = mod._malloc(8);
  const seedDraftOut = mod._malloc(12);
  const glOffOut = mod._malloc(8);
  const camOut = mod._malloc(16); // 2 doubles: cameraGet / aimCell
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
    // These now return the COUNT of cells changed (per-pixel economy); >0 = success.
    paintDisc(cx, cy, r, material, overwrite = false) {
      return M.paintDisc(ptr, cx, cy, r, material, overwrite ? 1 : 0) > 0;
    },
    eraseDisc(cx, cy, r) { return M.eraseDisc(ptr, cx, cy, r) > 0; },
    // Generic placement by material id (inventory-forward): any material is
    // placeable without a per-material tool. layer 0=fg, 1=bg.
    placeMaterial(cx, cy, r, material, layer = 0) {
      return (layer ? M.placeMaterialLayer(ptr, layer, cx, cy, r, material) : M.placeMaterial(ptr, cx, cy, r, material)) > 0;
    },
    setSinksOn(v) { M.setSinks(ptr, v ? 1 : 0); },
    setEmittersOn() {},

    // Tool / pointer input. JS translates browser coords to cells and normalizes
    // buttons; the engine owns all tool policy. The pointer/draft/up calls and
    // applyTool return whether the draft preview changed.
    setTool(tool) { M.setTool(ptr, tool); },
    // Creative palette selection. kind: 0=material id, 1=seed species, 2=eraser, 3=cube.
    setCreativeMaterial(kind, value = 0) { M.setCreativeMaterial(ptr, kind | 0, value | 0); },
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
    // WebGL presentation. The engine owns the cell texture + compositing; JS
    // creates the canvas, registers it as the context target, and drives one
    // frame per RAF. glInit(target) creates the context (the target selector is
    // resolved through emscripten's specialHTMLTargets, so it works inside a
    // shadow root); glRenderFrame uploads dirty cells and composites.
    glInit(canvasEl) {
      // Register the actual <canvas> element under a unique key so emscripten's
      // context creation resolves it via specialHTMLTargets (a plain selector
      // can't reach into a shadow root). The key is stable per canvas so a
      // resize (new engine, same canvas) reuses the existing context.
      let key = canvasEl.__sandGlKey;
      if (!key) {
        key = `#sandgl_${glTargetSeq++}`;
        canvasEl.__sandGlKey = key;
        mod.specialHTMLTargets[key] = canvasEl;
      }
      return M.glInit(ptr, key) === 1;
    },
    glResize(devW, devH) { M.glResize(ptr, devW, devH); },
    // Players to overlay. Host/local draws the engine's own players (own = the
    // local id, blue). A client passes a packed [x,y,w,h,facing,own] Float32Array
    // of host-authoritative snapshot players.
    glSetPlayers(useExternal, packed, ownId) {
      if (useExternal) {
        const len = packed ? packed.length : 0;
        if (len) {
          const buf = mod._malloc(len * 4);
          mod.HEAPF32.set(packed, buf >> 2);
          M.glSetPlayers(ptr, 1, buf, (len / 8) | 0, ownId | 0); // 8 floats per ext player
          mod._free(buf);
        } else {
          M.glSetPlayers(ptr, 1, 0, 0, ownId | 0); // external, but empty (draw none)
        }
      } else {
        M.glSetPlayers(ptr, 0, 0, 0, ownId | 0);
      }
    },
    // Dropped items to overlay. Host/local draws the engine's own items. A client
    // passes a packed [id,kind,material,count,x,y,life] Float32Array of the host's
    // item snapshot; null/empty makes the engine draw its own (single-player).
    glSetItems(packed) {
      if (packed === null || packed === undefined) { M.glSetItems(ptr, 0, 0, 0); return; }
      const len = packed.length;
      if (!len) { M.glSetItems(ptr, 1, 0, 0); return; } // external, but empty (draw none)
      const buf = mod._malloc(len * 4);
      mod.HEAPF32.set(packed, buf >> 2);
      M.glSetItems(ptr, 1, buf, (len / 7) | 0); // 7 floats per item
      mod._free(buf);
    },
    glSetFlags(gutterOn, snapOff) { M.glSetFlags(ptr, gutterOn ? 1 : 0, snapOff ? 1 : 0); },
    glShift(dx) { M.glShift(ptr, dx); },
    glRenderFrame(forceFull) { return M.glRenderFrame(ptr, forceFull ? 1 : 0) === 1; },
    glGetOffset() { M.glGetOffset(ptr, glOffOut); const o = glOffOut >> 2; return { offX: mod.HEAP32[o], offY: mod.HEAP32[o + 1] }; },

    // ---- view camera + input policy (owned by the engine; camera.inc) ----
    setViewport(dpr, cellDev, viewCols, viewRows) { M.setViewport(ptr, dpr, cellDev | 0, viewCols | 0, viewRows | 0); },
    cameraSet(x, y) { M.cameraSet(ptr, x, y); },
    getCam() { M.cameraGet(ptr, camOut); const o = camOut >> 3; return { x: mod.HEAPF64[o], y: mod.HEAPF64[o + 1] }; },
    cameraColX() { return M.cameraColX(ptr); },
    cameraPanFrame(frameDtMs) { M.cameraPanFrame(ptr, frameDtMs); },
    cameraFollowTo(cx, cy) { M.cameraFollowTo(ptr, cx, cy); },
    streamWorld() { return M.streamWorld(ptr); },
    inputKey(code, down) { M.inputKey(ptr, code | 0, down ? 1 : 0); },
    inputClearKeys() { M.inputClearKeys(ptr); },
    getHeldKeys() { return M.heldKeys(ptr); },
    inputPointer(cssX, cssY, buttons, inside) { M.inputPointer(ptr, cssX, cssY, buttons | 0, inside ? 1 : 0); },
    setPlayMode(on) { M.setPlayMode(ptr, on ? 1 : 0); },
    setDrawMode(on) { M.setDrawMode(ptr, on ? 1 : 0); },
    localInputBits() { return M.localInputBits(ptr); },
    getAim() { M.aimCell(ptr, camOut); const o = camOut >> 3; return { x: mod.HEAPF64[o], y: mod.HEAPF64[o + 1] }; },
    applyLocalInput(playerId, now, seq) { return M.applyLocalInput(ptr, playerId | 0, now, seq | 0) === 1; },
    pointerDraftAtAim() { return M.pointerDraftAtAim(ptr) === 1; },
    pointerDownAtAim(button) { return M.pointerDownAtAim(ptr, button | 0) === 1; },
    glReadPixels(x, y, w, h) {
      const n = w * h * 4;
      const buf = mod._malloc(n);
      const ok = M.glReadPixels(ptr, x, y, w, h, buf) === 1;
      const out = ok ? new Uint8ClampedArray(mod.HEAPU8.buffer, buf, n).slice() : new Uint8ClampedArray(n);
      mod._free(buf);
      return out;
    },
    getPerf() { return { stepMs: M.perfStepMs(ptr), dirtyChunks: M.perfDirtyChunks(ptr), phases: {} }; },
    getShiftPerf() { return { buffers: M.perfShiftBuffers(ptr), translate: M.perfShiftTranslate(ptr), register: M.perfShiftRegister(ptr), fill: M.perfShiftFill(ptr) }; },
    getStepPerf() { return { ground: M.perfStepGround(ptr), rigid: M.perfStepRigid(ptr), react: M.perfStepReact(ptr), carry: M.perfStepCarry(ptr), settle: M.perfStepSettle(ptr), tail: M.perfStepTail(ptr) }; },
    getTick() { return M.tick(ptr); },
    syncComponents() { M.syncComponents(ptr); },
    destroy() { mod._free(seedOut); mod._free(seedDraftOut); mod._free(glOffOut); mod._free(camOut); M.destroy(ptr); },

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
    placeSeedTyped(x0, y0, plantType) { return M.placeSeedTyped(ptr, x0, y0, plantType) === 1; },

    // Streaming infinite world (Stage 5)
    getWorldOffsetX() { return M.worldOffsetX(ptr); },
    getWorldOffsetY() { return M.worldOffsetY(ptr); },
    worldSurfaceAt(worldX) { return M.worldSurfaceAt(ptr, worldX); },
    shiftWorld(dx) { M.shiftWorld(ptr, dx); },
    shiftWorldXY(dx, dy) { M.shiftWorldXY(ptr, dx, dy); },
    maybeShiftWorldV(cameraCellY, visibleRows, marginRows) { return M.maybeShiftWorldV(ptr, cameraCellY, visibleRows, marginRows); },
    // Engine decides whether/how far to slide the world window; returns the
    // applied dx (0 if none) so JS can slide its cache and adjust the camera.
    maybeShiftWorld(cameraCellX, visibleCols, marginCols) { return M.maybeShiftWorld(ptr, cameraCellX, visibleCols, marginCols); },
    getWorldShiftCount() { return M.worldShiftCount(ptr); },
    // Predictive worldgen prefetch (test/bench hook): advance the prefetch for the
    // upcoming stream-in band given the camera + viewport, without shifting/GL.
    prefetchAdvance(camCellX, camCellY, visCols, visRows) { M.prefetchAdvance(ptr, camCellX | 0, camCellY | 0, visCols | 0, visRows | 0); },
    getShiftFillStats() { return { hit: M.shiftFillHit(ptr), miss: M.shiftFillMiss(ptr) }; },
    getHeapBytes() { return mod.HEAPU8.length; }, // wasm linear-memory size (debug)

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

    // Players (Terraria-like characters; physics owned by the engine). JS only
    // collects input and reads snapshots to draw the overlay.
    spawnPlayer(x, y) { return M.spawnPlayer(ptr, x, y); },
    spawnPlayerAtSurface(col) { return M.spawnPlayerSurface(ptr, col | 0); },
    getSurfaceSpawn(col) {
      M.playerSurfaceSpawn(ptr, col | 0, camOut);
      const o = camOut >> 3;
      return { x: mod.HEAPF64[o], y: mod.HEAPF64[o + 1] };
    },
    getPlayerSize() { return { w: M.playerWidth(), h: M.playerHeight() }; },
    removePlayer(id) { M.removePlayer(ptr, id); },
    // input: { bits, aimX, aimY, tool, seq }
    setPlayerInput(id, { bits = 0, aimX = 0, aimY = 0, tool = 0, seq = 0 } = {}) {
      M.setPlayerInput(ptr, id, bits | 0, aimX, aimY, tool | 0, seq | 0);
    },
    playerCount() { return M.playerCount(ptr); },
    // Rebuild + read the packed player snapshot zero-copy (re-derived: the build
    // call may grow wasm memory). Returns an array of plain player objects.
    getPlayers() {
      const n = M.playerSnapshot(ptr);
      if (!n) return [];
      const stride = M.playerSnapshotStride(ptr);
      const f = new Float32Array(mod.HEAPF32.buffer, M.playerSnapshotPtr(ptr), n * stride);
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        out[i] = {
          id: f[o] | 0, active: f[o + 1] === 1,
          x: f[o + 2], y: f[o + 3], vx: f[o + 4], vy: f[o + 5],
          w: f[o + 6] | 0, h: f[o + 7] | 0, facing: f[o + 8] | 0,
          grounded: f[o + 9] === 1, tool: f[o + 10] | 0,
          aimX: f[o + 11], aimY: f[o + 12], health: f[o + 13] | 0,
          inputSeq: f[o + 14] >>> 0, alive: f[o + 15] === 1, jumpReady: f[o + 16] === 1,
          animState: f[o + 17] | 0, animFrame: f[o + 18] | 0,
        };
      }
      return out;
    },
    getPlayer(id) { return this.getPlayers().find((p) => p.id === id) || null; },

    // Dropped items + particles (entities; physics owned by the engine). spawnItem
    // returns the new item id; spawnParticle is fire-and-forget cosmetic debris.
    spawnItem(material, count, px, py, vx = 0, vy = 0) { return M.spawnItem(ptr, material | 0, count | 0, px, py, vx, vy); },
    spawnParticle(material, px, py, vx = 0, vy = 0, life = 0) { M.spawnParticle(ptr, material | 0, px, py, vx, vy, life | 0); },
    itemCount() { return M.itemCount(ptr); },

    // Survival inventory (authoritative in the engine). setSurvivalInventory routes
    // player controls through the hotbar; getInventory reads a packed snapshot for
    // the HUD; the rest forward slot intents.
    setSurvivalInventory(on) { M.setSurvivalInventory(ptr, on ? 1 : 0); },
    seedStarterTools(id) { M.seedStarterTools(ptr, id | 0); },
    addToInventory(id, material, count) { return M.addToInventory(ptr, id | 0, material | 0, count | 0) === 1; },
    setSelectedSlot(id, slot) { M.setSelectedSlot(ptr, id | 0, slot | 0); },
    cycleSelectedSlot(id, delta) { M.cycleSelectedSlot(ptr, id | 0, delta | 0); },
    inventoryMove(id, from, to) { M.inventoryMove(ptr, id | 0, from | 0, to | 0); },
    placeFromSelected(id, ax, ay) { return M.placeFromSelected(ptr, id | 0, ax | 0, ay | 0) === 1; },
    // Minecraft cursor model. cursorPick(slot, half) picks/places/swaps the carried
    // stack; throwFromCursor(whole) ejects it into the world (facing dir). getCursor
    // reads the carried stack for the HUD's floating item (null when empty).
    inventoryCursorPick(id, slot, half) { M.inventoryCursorPick(ptr, id | 0, slot | 0, half ? 1 : 0); },
    throwFromCursor(id, whole) { return M.inventoryThrowFromCursor(ptr, id | 0, whole ? 1 : 0) === 1; },
    getCursor(id) {
      if (M.cursorSnapshot(ptr, id | 0) !== 1) return null;
      const f = new Float32Array(mod.HEAPF32.buffer, M.cursorSnapshotPtr(ptr), M.inventorySnapshotStride(ptr));
      return { material: f[0] | 0, isTool: f[1] === 1, toolClass: f[2] | 0, toolTier: f[3] | 0, count: f[4] | 0 };
    },
    getInventory(id) {
      const n = M.inventorySnapshot(ptr, id | 0);
      if (!n) return { slots: [], selected: 0 };
      const stride = M.inventorySnapshotStride(ptr);
      const f = new Float32Array(mod.HEAPF32.buffer, M.inventorySnapshotPtr(ptr), n * stride);
      const slots = new Array(n);
      let selected = 0;
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        slots[i] = { material: f[o] | 0, isTool: f[o + 1] === 1, toolClass: f[o + 2] | 0, toolTier: f[o + 3] | 0, count: f[o + 4] | 0 };
        if (f[o + 5] === 1) selected = i;
      }
      return { slots, selected };
    },
    // Rebuild + read the packed item snapshot zero-copy. Returns plain item objects.
    getItems() {
      const n = M.itemSnapshot(ptr);
      if (!n) return [];
      const stride = M.itemSnapshotStride(ptr);
      const f = new Float32Array(mod.HEAPF32.buffer, M.itemSnapshotPtr(ptr), n * stride);
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        out[i] = { id: f[o] | 0, kind: f[o + 1] | 0, material: f[o + 2] | 0, count: f[o + 3] | 0, x: f[o + 4], y: f[o + 5], life: f[o + 6] | 0 };
      }
      return out;
    },
    getPlayerActionCount() { return M.playerActionCount(ptr); },
    // Prediction: step one player's physics without the world sim; snap a player
    // to an authoritative state before replaying unacknowledged inputs.
    stepPlayerOnly(id) { M.stepPlayerOnly(ptr, id); },
    // Held mining tool (class, tier) + a direct foreground mine hook. Mining drops
    // the destroyed material as an item only when the held tool satisfies its gate.
    setPlayerTool(id, toolClass, toolTier) { M.setPlayerTool(ptr, id, toolClass | 0, toolTier | 0); },
    playerMine(id, ax, ay) { return M.playerMine(ptr, id, ax, ay) === 1; },
    setPlayerState(id, { x, y, vx = 0, vy = 0, facing = 1, grounded = false, jumpReady = false }) {
      M.setPlayerState(ptr, id, x, y, vx, vy, facing | 0, grounded ? 1 : 0, jumpReady ? 1 : 0);
    },

    // World replication (Phase 6). serialize* return a COPY of the bytes (the
    // blob is re-derived each call; copy so callers can hold it). apply* take a
    // Uint8Array and write it into wasm memory. gridHash detects divergence.
    serializeWorld() { const n = M.serializeWorld(ptr); return new Uint8Array(mod.HEAPU8.buffer, M.netBlobPtr(ptr), n).slice(); },
    serializeDiff() { const n = M.serializeDiff(ptr); return new Uint8Array(mod.HEAPU8.buffer, M.netBlobPtr(ptr), n).slice(); },
    applyWorld(bytes) { const buf = mod._malloc(bytes.length); mod.HEAPU8.set(bytes, buf); M.applyWorld(ptr, buf, bytes.length); mod._free(buf); },
    applyDiff(bytes) { if (!bytes.length) return; const buf = mod._malloc(bytes.length); mod.HEAPU8.set(bytes, buf); M.applyDiff(ptr, buf, bytes.length); mod._free(buf); },
    gridHash() { return M.gridHash(ptr) >>> 0; },
    resetDirty() { M.clearAllDirty(ptr); },

    // ---- two-layer access (background = layer 1) ----
    getGridBg() { return new Uint8Array(mod.HEAPU8.buffer, M.gridBg(ptr), cellCount); },
    setBgEnabled(on) { M.setBgEnabled(ptr, on ? 1 : 0); },
    paintDiscLayer(layer, cx, cy, r, material, overwrite = false) { return M.paintDiscLayer(ptr, layer | 0, cx, cy, r, material, overwrite ? 1 : 0); },
    eraseDiscLayer(layer, cx, cy, r) { return M.eraseDiscLayer(ptr, layer | 0, cx, cy, r) > 0; },
    syncComponentsLayer(layer) { M.syncComponentsLayer(ptr, layer | 0); },
    // test hooks
    _bodyCount() { return M.bodyCount(ptr); },
    _bodyBlocked(i) { return M.bodyBlocked(ptr, i); },
    _bodyAwake(i) { return M.bodyAwake(ptr, i); },
  };
}
