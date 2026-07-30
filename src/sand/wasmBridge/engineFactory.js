// The falling-sand engine, backed by the C++ core in cpp/sand.cpp (compiled to
// wasm/sandEngine.{js,wasm}). createEngineWasm() returns the simulation handle the game
// runtime drives.
//
// The wasm module is instantiated ONCE via initSandWasm(); createEngineWasm() is
// then synchronous. The grid lives in wasm linear memory and is handed to JS
// zero-copy as a HEAPU8 subarray (re-derived each call: the grid pointer swaps
// every step and the heap can move on growth).

import createSandModule from '../wasm/sandEngine.js';
import { MAT } from '../materials.js';
import { ABI_VERSION, OFF, STRIDES, INPUT, PLANET } from './abi.generated.js';

export { MAT, PLANET };
// Player input bitmask + snapshot layouts come from the generated ABI manifest
// (abi.generated.js) — one schema edit changes both sides.
export { INPUT };
export const CHUNK_SIZE = 32;

let modPromise = null;
let M = null; // resolved module + cwrapped fns
let glTargetSeq = 0; // unique key per canvas for emscripten's specialHTMLTargets
let resizableHeapPatched = false;

// Chromium rejects views on a resizable ArrayBuffer; WebKit rejects WebGL views
// backed by growable WASM memory. Copy those backings into an ordinary fixed
// ArrayBuffer before browser APIs see them.

function needsFixedBuffer(value) {
  const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
  return buffer?.resizable === true;
}

function isBufferArg(value) {
  return ArrayBuffer.isView(value)
    || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer);
}

function fixedBufferArg(value) {
  if (value == null) return value;
  if (ArrayBuffer.isView(value)) {
    if (needsFixedBuffer(value)) {
      if (typeof DataView !== 'undefined' && value instanceof DataView) {
        const bytes = new Uint8Array(value.byteLength);
        bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        return new DataView(bytes.buffer);
      }
      const Ctor = value.constructor;
      // Preserve the same TypedArray kind (Uint8Array, Float32Array, …).
      const copy = new Ctor(value.length);
      copy.set(value);
      return copy;
    }
    return value;
  }
  if (needsFixedBuffer(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value));
    return copy.buffer;
  }
  return value;
}

function patchResizableWasmHeapForBrowserGL() {
  if (resizableHeapPatched) return;
  resizableHeapPatched = true;

  // 1) TextDecoder — emscripten UTF8ArrayToString → glShaderSource
  if (typeof TextDecoder !== 'undefined') {
    const proto = TextDecoder.prototype;
    const original = proto.decode;
    if (typeof original === 'function') {
      proto.decode = function decodeResizableSafe(input, options) {
        return original.call(this, fixedBufferArg(input), options);
      };
    }
  }

  // 2) WebGL buffer/texture uploads from HEAP views
  const patchGLProto = (Proto) => {
    if (!Proto || !Proto.prototype) return;
    const p = Proto.prototype;

    const wrapDataArg = (name, dataIndex) => {
      const orig = p[name];
      if (typeof orig !== 'function') return;
      p[name] = function patchedGLMethod(...args) {
        if (args.length > dataIndex) args[dataIndex] = fixedBufferArg(args[dataIndex]);
        return orig.apply(this, args);
      };
    };

    // bufferData(target, srcData|size, usage[, srcOffset[, length]])
    // bufferSubData(target, offset, srcData[, srcOffset[, length]])
    wrapDataArg('bufferData', 1);
    wrapDataArg('bufferSubData', 2);

    // texImage2D / texSubImage2D have many overloads; the pixels arg is last
    // when provided as a TypedArray. Patch by scanning args for WASM-backed views.
    const wrapPixelsScan = (name) => {
      const orig = p[name];
      if (typeof orig !== 'function') return;
      p[name] = function patchedTexMethod(...args) {
        for (let i = 0; i < args.length; i++) {
          if (isBufferArg(args[i])) args[i] = fixedBufferArg(args[i]);
        }
        return orig.apply(this, args);
      };
    };
    wrapPixelsScan('texImage2D');
    // Emscripten's WebGL2 upload overload passes (HEAPU8, srcOffset). Copying
    // that view wholesale copies the entire WASM heap, so one extreme zoom made
    // every later upload copy hundreds of MB even after the grid shrank. The
    // engine uploads RGBA/UNSIGNED_BYTE; retain only the prefix reachable through
    // its current UNPACK_ROW_LENGTH/SKIP_* state and keep the same overload.
    {
      const orig = p.texSubImage2D;
      if (typeof orig === 'function') {
        p.texSubImage2D = function patchedTexSubImage2D(...args) {
          const heap = args[8];
          const srcOffset = args[9] | 0;
          if (args.length >= 10 && ArrayBuffer.isView(heap) && needsFixedBuffer(heap)
              && args[6] === 0x1908 && args[7] === 0x1401) { // RGBA / UNSIGNED_BYTE
            const width = args[4] | 0, height = args[5] | 0;
            const rowLength = this.getParameter(0x0CF2) || width; // UNPACK_ROW_LENGTH
            const skipRows = this.getParameter(0x0CF3) | 0;
            const skipPixels = this.getParameter(0x0CF4) | 0;
            const pixels = Math.max(0, (skipRows + height - 1) * rowLength + skipPixels + width);
            const count = Math.min(heap.length - srcOffset, pixels * 4);
            const fixed = new Uint8Array(Math.max(0, count));
            fixed.set(heap.subarray(srcOffset, srcOffset + count));
            args[8] = fixed;
            args[9] = 0;
            return orig.apply(this, args);
          }
          for (let i = 0; i < args.length; i++) {
            if (isBufferArg(args[i])) args[i] = fixedBufferArg(args[i]);
          }
          return orig.apply(this, args);
        };
      }
    }
    wrapPixelsScan('compressedTexImage2D');
    wrapPixelsScan('compressedTexSubImage2D');

    // readPixels writes INTO the view. Chromium rejects the WebGL2
    // (dstData, dstOffset) form when dstData is a resizable heap (Emscripten's
    // growable memory). Subarray form is fine; heap+offset is not. Copy into a
    // fixed buffer, call, then write back.
    {
      const orig = p.readPixels;
      if (typeof orig === 'function') {
        p.readPixels = function patchedReadPixels(...args) {
          // WebGL2: (x, y, w, h, format, type, dstData, dstOffset)
          if (args.length >= 7 && ArrayBuffer.isView(args[6]) && needsFixedBuffer(args[6])) {
            const heap = args[6];
            const offset = args[7] | 0;
            const w = args[2] | 0, h = args[3] | 0;
            // Engine always reads RGBA/UNSIGNED_BYTE; size is w*h*4 elements.
            const tmp = new Uint8Array(Math.max(0, w * h * 4));
            const ret = orig.call(this, args[0], args[1], w, h, args[4], args[5], tmp);
            // dstOffset is an element index into the typed array (not a byte offset).
            heap.set(tmp, offset);
            return ret;
          }
          // WebGL1 / view form: (…, pixels)
          const last = args.length - 1;
          const dest = args[last];
          if (ArrayBuffer.isView(dest) && needsFixedBuffer(dest)) {
            const copy = fixedBufferArg(dest);
            args[last] = copy;
            const ret = orig.apply(this, args);
            dest.set(copy);
            return ret;
          }
          return orig.apply(this, args);
        };
      }
    }

    // Uniform matrix/vector uploads sometimes pass HEAPF32 views.
    for (const name of Object.getOwnPropertyNames(p)) {
      if (!/^uniform\d/.test(name) && !/^vertexAttrib\d/.test(name)) continue;
      if (name.includes('Pointer')) continue; // pointer APIs take offsets, not views
      const orig = p[name];
      if (typeof orig !== 'function') continue;
      p[name] = function patchedUniform(...args) {
        for (let i = 0; i < args.length; i++) {
          if (ArrayBuffer.isView(args[i])) args[i] = fixedBufferArg(args[i]);
        }
        return orig.apply(this, args);
      };
    }
  };

  if (typeof WebGLRenderingContext !== 'undefined') patchGLProto(WebGLRenderingContext);
  if (typeof WebGL2RenderingContext !== 'undefined') patchGLProto(WebGL2RenderingContext);
}

export function initSandWasm() {
  if (!modPromise) {
    patchResizableWasmHeapForBrowserGL();
    modPromise = createSandModule().then((mod) => {
      const c = (name, ret, args) => mod.cwrap(name, ret, args);
      // Refuse a module whose compiled-in ABI version mismatches the JS
      // manifest — the loud failure for stale committed sandEngine artifacts.
      const wasmAbi = c('engine_abi_version', 'number', [])();
      if (wasmAbi !== ABI_VERSION) {
        throw new Error(`sand wasm ABI version ${wasmAbi} != JS manifest ${ABI_VERSION} — rebuild the wasm (wasm/build.sh) or regenerate (npm run generate:abi)`);
      }
      M = {
        mod,
        create: c('engine_create', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        getPlanet: c('engine_get_planet', 'number', ['number']),
        getGravityScale: c('engine_get_gravity_scale', 'number', ['number']),
        setGravityScale: c('engine_set_gravity_scale', null, ['number', 'number']),
        shiftWorld: c('engine_shift_world', null, ['number', 'number']),
        shiftWorldXY: c('engine_shift_world_xy', null, ['number', 'number', 'number']),
        maybeShiftWorld: c('engine_maybe_shift_world', 'number', ['number', 'number', 'number', 'number']),
        maybeShiftWorldV: c('engine_maybe_shift_world_v', 'number', ['number', 'number', 'number', 'number']),
        worldShiftCount: c('engine_world_shift_count', 'number', ['number']),
        prefetchAdvance: c('engine_prefetch_advance', null, ['number', 'number', 'number', 'number', 'number']),
        shiftFillHit: c('engine_shift_fill_hit', 'number', ['number']),
        shiftFillMiss: c('engine_shift_fill_miss', 'number', ['number']),
        worldStoreBytes: c('engine_world_store_bytes', 'number', ['number']),
        worldStoredTileCount: c('engine_world_stored_tile_count', 'number', ['number']),
        worldPrefetchTileCount: c('engine_world_prefetch_tile_count', 'number', ['number']),
        worldOffsetX: c('engine_world_offset_x', 'number', ['number']),
        worldOffsetY: c('engine_world_offset_y', 'number', ['number']),
        worldSurfaceAt: c('engine_world_surface_at', 'number', ['number', 'number']),
        worldSurfaceAbsAt: c('engine_world_surface_abs_at', 'number', ['number', 'number']),
        worldBiomeAt: c('engine_world_biome_at', 'number', ['number', 'number']),
        worldCaveBiomeAt: c('engine_world_cave_biome_at', 'number', ['number', 'number', 'number']),
        worldIsCaveAt: c('engine_world_is_cave_at', 'number', ['number', 'number', 'number', 'number']),
        destroy: c('engine_destroy', null, ['number']),
        step: c('engine_step', 'number', ['number']),
        stepActors: c('engine_step_actors', 'number', ['number']),
        stepWorld: c('engine_step_world', 'number', ['number']),
        soundEventSnapshot: c('engine_sound_event_snapshot', 'number', ['number']),
        soundEventSnapshotPtr: c('engine_sound_event_snapshot_ptr', 'number', ['number']),
        audioAmbience: c('engine_audio_ambience', null, ['number', 'number', 'number', 'number', 'number']),
        grid: c('engine_grid', 'number', ['number']),
        dirtyCount: c('engine_dirty_count', 'number', ['number']),
        cols: c('engine_cols', 'number', ['number']),
        rows: c('engine_rows', 'number', ['number']),
        chunkCols: c('engine_chunk_cols', 'number', ['number']),
        chunkRows: c('engine_chunk_rows', 'number', ['number']),
        buildDirtyRects: c('engine_build_dirty_rects', null, ['number']),
        dirtyRectCount: c('engine_dirty_rect_count', 'number', ['number']),
        dirtyRects: c('engine_dirty_rects', 'number', ['number']),
        clearDirty: c('engine_clear_dirty', null, ['number']),
        renderFull: c('engine_render_full', null, ['number']),
        renderFullLayer: c('engine_render_full_layer', null, ['number', 'number']),
        renderDirtyRects: c('engine_render_dirty_rects', null, ['number']),
        renderPixels: c('engine_render_pixels', 'number', ['number']),
        renderPixelsLayer: c('engine_render_pixels_layer', 'number', ['number', 'number']),
        renderPixelsLen: c('engine_render_pixels_len', 'number', ['number']),
        setSkyLight: c('engine_set_sky_light', null, ['number', 'number']),
        paintDisc: c('engine_paint_disc', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        eraseDisc: c('engine_erase_disc', 'number', ['number', 'number', 'number', 'number']),
        placeMaterial: c('engine_place_material', 'number', ['number', 'number', 'number', 'number', 'number']),
        placeMaterialLayer: c('engine_place_material_layer', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        syncComponents: c('engine_sync_components', null, ['number']),
        perfSnapshot: c('engine_perf_snapshot', null, ['number', 'number']),
        tick: c('engine_tick', 'number', ['number']),
        actorTick: c('engine_actor_tick', 'number', ['number']),
        setActorTick: c('engine_set_actor_tick', null, ['number', 'number']),
        addDraft: c('engine_add_draft', 'number', ['number', 'number', 'number', 'number', 'number']),
        finalizeDraft: c('engine_finalize_draft', null, ['number', 'number']),
        clearDraft: c('engine_clear_draft', null, ['number']),
        draftSnapshot: c('engine_draft_snapshot', 'number', ['number']),
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
        spawnPlayer: c('engine_spawn_player', 'number', ['number', 'number', 'number']),
        spawnPlayerSurface: c('engine_spawn_player_surface', 'number', ['number', 'number']),
        playerSurfaceSpawn: c('engine_player_surface_spawn', null, ['number', 'number', 'number']),
        playerWidth: c('engine_player_width', 'number', []),
        playerHeight: c('engine_player_height', 'number', []),
        removePlayer: c('engine_remove_player', null, ['number', 'number']),
        setPlayerInput: c('engine_set_player_input', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
        playerCount: c('engine_player_count', 'number', ['number']),
        playerSnapshot: c('engine_player_snapshot', 'number', ['number']),
        playerSnapshotPtr: c('engine_player_snapshot_ptr', 'number', ['number']),
        playerActionCount: c('engine_player_action_count', 'number', ['number']),
        stepPlayerOnly: c('engine_step_player_only', null, ['number', 'number']),
        setPlayerTool: c('engine_set_player_tool', null, ['number', 'number', 'number', 'number']),
        playerMine: c('engine_player_mine', 'number', ['number', 'number', 'number', 'number']),
        playerMineProgress: c('engine_player_mine_progress', 'number', ['number', 'number']),
        playerMineTarget: c('engine_player_mine_target', 'number', ['number', 'number', 'number']),
        setPlayerState: c('engine_set_player_state', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
        spawnItem: c('engine_spawn_item', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        itemCount: c('engine_item_count', 'number', ['number']),
        itemSnapshot: c('engine_item_snapshot', 'number', ['number']),
        itemSnapshotPtr: c('engine_item_snapshot_ptr', 'number', ['number']),
        spawnCreature: c('engine_spawn_creature', 'number', ['number', 'number', 'number', 'number']),
        spawnScriptedCreature: c('engine_spawn_scripted_creature', 'number', ['number', 'number', 'number', 'number']),
        testSpawnNearFocus: c('engine_test_spawn_near_focus', 'number', ['number', 'number', 'number']),
        testSpawnBreachNearFocus: c('engine_test_spawn_breach_near_focus', 'number', ['number', 'number', 'number']),
        damageCreatures: c('engine_damage_creatures', 'number', ['number', 'number', 'number', 'number', 'number']),
        creatureCount: c('engine_creature_count', 'number', ['number']),
        creatureSnapshot: c('engine_creature_snapshot', 'number', ['number']),
        creatureSnapshotPtr: c('engine_creature_snapshot_ptr', 'number', ['number']),
        startMission: c('engine_start_mission', 'number', ['number', 'number', 'number']),
        missionSnapshot: c('engine_mission_snapshot', 'number', ['number']),
        missionSnapshotPtr: c('engine_mission_snapshot_ptr', 'number', ['number']),
        objectiveSnapshot: c('engine_objective_snapshot', 'number', ['number']),
        objectiveSnapshotPtr: c('engine_objective_snapshot_ptr', 'number', ['number']),
        projectileSnapshot: c('engine_projectile_snapshot', 'number', ['number']),
        projectileSnapshotPtr: c('engine_projectile_snapshot_ptr', 'number', ['number']),
        setMirrorCreatures: c('engine_set_mirror_creatures', null, ['number', 'number', 'number', 'number', 'number']),
        setSurvivalInventory: c('engine_set_survival_inventory', null, ['number', 'number']),
        setCreatureRuntime: c('engine_set_creature_runtime', null, ['number', 'number', 'number']),
        seedStarterTools: c('engine_seed_starter_tools', null, ['number', 'number']),
        addToInventory: c('engine_add_to_inventory', 'number', ['number', 'number', 'number', 'number']),
        addSpecialItem: c('engine_add_special_item', 'number', ['number', 'number', 'number', 'number']),
        setSelectedSlot: c('engine_set_selected_slot', null, ['number', 'number', 'number']),
        cycleSelectedSlot: c('engine_cycle_selected_slot', null, ['number', 'number', 'number']),
        setSelectedFootprint: c('engine_set_selected_footprint', null, ['number', 'number', 'number']),
        selectedFootprint: c('engine_selected_footprint', 'number', ['number', 'number']),
        survivalFootprintSnapshot: c('engine_survival_footprint_snapshot', 'number', ['number']),
        survivalFootprintSnapshotPtr: c('engine_survival_footprint_snapshot_ptr', 'number', ['number']),
        inventoryMove: c('engine_inventory_move', null, ['number', 'number', 'number', 'number']),
        placeFromSelected: c('engine_place_from_selected', 'number', ['number', 'number', 'number', 'number']),
        inventorySnapshot: c('engine_inventory_snapshot', 'number', ['number', 'number']),
        inventorySnapshotPtr: c('engine_inventory_snapshot_ptr', 'number', ['number']),
        inventoryCursorPick: c('engine_inventory_cursor_pick', null, ['number', 'number', 'number', 'number']),
        inventoryThrowFromCursor: c('engine_inventory_throw_from_cursor', 'number', ['number', 'number', 'number']),
        cursorSnapshot: c('engine_cursor_snapshot', 'number', ['number', 'number']),
        cursorSnapshotPtr: c('engine_cursor_snapshot_ptr', 'number', ['number']),
        craftRecipe: c('engine_craft_recipe', 'number', ['number', 'number', 'number', 'number']),
        craftingRecipeSnapshot: c('engine_crafting_recipe_snapshot', 'number', ['number']),
        craftingRecipeSnapshotPtr: c('engine_crafting_recipe_snapshot_ptr', 'number', ['number']),
        craftingIngredientSnapshot: c('engine_crafting_ingredient_snapshot', 'number', ['number']),
        craftingIngredientSnapshotPtr: c('engine_crafting_ingredient_snapshot_ptr', 'number', ['number']),
        respawnPlayer: c('engine_respawn_player', 'number', ['number', 'number']),
        serializeWorld: c('engine_serialize_world', 'number', ['number']),
        serializeDiff: c('engine_serialize_diff', 'number', ['number']),
        netBlobPtr: c('engine_net_blob_ptr', 'number', ['number']),
        applyWorld: c('engine_apply_world', null, ['number', 'number', 'number']),
        applyDiff: c('engine_apply_diff', null, ['number', 'number', 'number']),
        applyWorldMirror: c('engine_apply_world_mirror', null, ['number', 'number', 'number']),
        applyDiffMirror: c('engine_apply_diff_mirror', null, ['number', 'number', 'number', 'number', 'number']),
        setMirrorWorldOffset: c('engine_set_mirror_world_offset', null, ['number', 'number', 'number']),
        setMirrorWorldTick: c('engine_set_mirror_world_tick', null, ['number', 'number']),
        setMirrorDraft: c('engine_set_mirror_draft', null, ['number', 'number', 'number', 'number']),
        gridHash: c('engine_grid_hash', 'number', ['number']),
        clearAllDirty: c('engine_clear_all_dirty', null, ['number']),
        clearReplicaDirty: c('engine_clear_replica_dirty', null, ['number']),
        gridBg: c('engine_grid_bg', 'number', ['number']),
        setBgEnabled: c('engine_set_bg_enabled', null, ['number', 'number']),
        paintDiscLayer: c('engine_paint_disc_layer', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        eraseDiscLayer: c('engine_erase_disc_layer', 'number', ['number', 'number', 'number', 'number', 'number']),
        syncComponentsLayer: c('engine_sync_components_layer', null, ['number', 'number']),
        glInit: c('engine_gl_init', 'number', ['number', 'string']),
        glReleaseContext: c('engine_gl_release_context', null, ['number']),
        glContextCount: c('engine_gl_context_count', 'number', []),
        glRestore: c('engine_gl_restore', 'number', ['number']),
        glResize: c('engine_gl_resize', null, ['number', 'number', 'number']),
        glSetFlags: c('engine_gl_set_flags', null, ['number', 'number', 'number', 'number']),
        glSetDebugHitboxes: c('engine_gl_set_debug_hitboxes', null, ['number', 'number']),
        glSetPlayers: c('engine_gl_set_players', null, ['number', 'number', 'number', 'number', 'number']),
        glSetSurvivalPreview: c('engine_gl_set_survival_preview', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        glSetItems: c('engine_gl_set_items', null, ['number', 'number', 'number', 'number']),
        glSetCreatures: c('engine_gl_set_creatures', null, ['number', 'number', 'number', 'number']),
        glSetProjectiles: c('engine_gl_set_projectiles', null, ['number', 'number', 'number', 'number']),
        glShift: c('engine_gl_shift', null, ['number', 'number']),
        glRenderFrame: c('engine_gl_render_frame', 'number', ['number', 'number']),
        glGetOffset: c('engine_gl_get_offset', null, ['number', 'number']),
        glReadPixels: c('engine_gl_read_pixels', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
        glActorLight: c('engine_gl_actor_light', 'number', ['number', 'number', 'number', 'number', 'number']),
        setViewport: c('engine_set_viewport', null, ['number', 'number', 'number', 'number', 'number']),
        resizeLoadedWindow: c('engine_resize_loaded_window', 'number', ['number', 'number', 'number']),
        cameraSet: c('engine_camera_set', null, ['number', 'number', 'number']),
        cameraGet: c('engine_camera_get', null, ['number', 'number']),
        cameraColX: c('engine_camera_col_x', 'number', ['number']),
        cameraPanTick: c('engine_camera_pan_tick', null, ['number']),
        cameraFollowTo: c('engine_camera_follow_to', null, ['number', 'number', 'number']),
        streamWorld: c('engine_stream_world', 'number', ['number']),
        inputKey: c('engine_input_key', null, ['number', 'number', 'number']),
        inputClearKeys: c('engine_input_clear_keys', null, ['number']),
        inputStick: c('engine_input_stick', null, ['number', 'number', 'number']),
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
    }).catch((error) => {
      // A transient fetch/compile failure must not poison every future mount.
      // The Web Component exposes a Retry button which starts a fresh module
      // attempt after the deployment or network recovers.
      M = null;
      modPromise = null;
      throw error;
    });
  }
  return modPromise;
}

export function isSandWasmReady() { return M !== null; }
// Internal accessor for wasmBridge/testHooks.js (test-only cwraps live there,
// out of the browser bundle). Not part of the public engine API.
export function _wasmInternals() { return M; }

// Create one engine instance. Requires initSandWasm() resolved.
export function createEngineWasm({
  cols,
  rows,
  sinksOn = true,
  infinite = false,
  storageRole = 'full',
  planetId = PLANET.EARTH,
  gravityScale,
  worldSeed = (Math.floor(Math.random() * 4294967296) >>> 0),
} = {}) {
  if (!M) throw new Error('initSandWasm() must resolve before createEngineWasm()');
  const cells = cols * rows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0 ||
      cols > 16384 || rows > 16384 || !Number.isSafeInteger(cells) || cells > 0x7fffffff) {
    throw new RangeError(`invalid sand engine dimensions ${cols}x${rows}`);
  }
  if (planetId !== PLANET.EARTH && planetId !== PLANET.MOON &&
      planetId !== PLANET.MARS && planetId !== PLANET.SHIP) {
    throw new RangeError(`invalid sand engine planet ${planetId}`);
  }
  if (gravityScale !== undefined
      && (!Number.isFinite(gravityScale) || gravityScale < 0.05 || gravityScale > 1)) {
    throw new RangeError(`invalid sand engine gravity scale ${gravityScale}`);
  }
  const { mod } = M;
  const role = storageRole === 'presentation' ? 1 : (storageRole === 'authority' ? 2 : 0);
  const ptr = M.create(
    cols, rows, worldSeed >>> 0, sinksOn ? 1 : 0, infinite ? 1 : 0, role, planetId,
  );
  if (gravityScale !== undefined) M.setGravityScale(ptr, gravityScale);
  // Live dims (mutable — resizeLoadedWindow can grow/shrink the buffer).
  let liveCols = cols;
  let liveRows = rows;
  let liveChunkCols = M.chunkCols(ptr);
  let liveChunkRows = M.chunkRows(ptr);
  let cellCount = liveCols * liveRows;
  const wasmView = (Ctor, byteOffset, length, label) => {
    const buffer = mod.HEAPU8.buffer;
    const bytes = length * Ctor.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(byteOffset) || !Number.isSafeInteger(length)
        || byteOffset < 0 || length < 0 || byteOffset + bytes > buffer.byteLength) {
      throw new RangeError(`${label}: invalid WASM view offset=${byteOffset} length=${length} bytes=${bytes} heap=${buffer.byteLength}`);
    }
    return new Ctor(buffer, byteOffset, length);
  };
const renderStrides = Object.freeze({
  player: STRIDES.glPlayerExt,
  item: STRIDES.itemSnapshot,
  creature: STRIDES.creatureSnapshot,
  projectile: STRIDES.projectileSnapshot,
});

  const refreshDims = () => {
    liveCols = M.cols(ptr);
    liveRows = M.rows(ptr);
    liveChunkCols = M.chunkCols(ptr);
    liveChunkRows = M.chunkRows(ptr);
    cellCount = liveCols * liveRows;
    api.cols = liveCols;
    api.rows = liveRows;
    api.chunkCols = liveChunkCols;
    api.chunkRows = liveChunkRows;
  };

  // Fresh views each call: grid swaps every step; ALLOW_MEMORY_GROWTH can detach.
  const gridView = () => new Uint8Array(mod.HEAPU8.buffer, M.grid(ptr), cellCount);
  const emptyRects = new Int32Array(0);
  const chunkTotal = () => liveChunkCols * liveChunkRows;

  // Scratch buffers in wasm memory: getSeedOrigin (2 ints), seedDraft (3 ints),
  // glGetOffset (2 ints).
  const seedOut = mod._malloc(8);
  const seedDraftOut = mod._malloc(12);
  const glOffOut = mod._malloc(8);
  const camOut = mod._malloc(16); // 2 doubles: cameraGet / aimCell
  const perfOut = mod._malloc(STRIDES.perfSnapshot * 8); // doubles for engine_perf_snapshot
  const ambienceOut = mod._malloc(12 * 4); // 4 groups × [amount, worldX, worldY]
  // Grow-only wasm scratch for the per-frame GL player/item uploads — a frame
  // reuses it instead of a _malloc/_free round trip per call.
  let glScratchPtr = 0, glScratchCap = 0;
  let mirrorDraftPtr = 0, mirrorDraftCap = 0, mirrorCreaturePtr = 0, mirrorCreatureCap = 0;
  let glTargetKey = null, glCanvas = null, destroyed = false;
  const glScratch = (floats) => {
    if (floats > glScratchCap) {
      if (glScratchPtr) mod._free(glScratchPtr);
      glScratchCap = Math.max(floats, glScratchCap * 2, 64);
      glScratchPtr = mod._malloc(glScratchCap * 4);
    }
    return glScratchPtr;
  };
  // Packed draft cell INDICES (k = y*cols + x) as a zero-copy view into wasm
  // memory — no Set allocation. Stone and ice share one snapshot buffer, so the
  // returned view is only valid until the next draft snapshot call; the caller
  // must fully consume one draft before requesting the other.
  const draftCells = (count) => (count ? new Int32Array(mod.HEAP32.buffer, M.draftPtr(ptr), count) : emptyRects);

  // Decode one player from the packed snapshot at float offset o into `out`
  // (named offsets from the generated ABI manifest).
  const P = OFF.playerSnapshot;
  const readPlayer = (f, o, out) => {
    out.id = f[o + P.id] | 0; out.active = f[o + P.active] === 1;
    out.x = f[o + P.x]; out.y = f[o + P.y]; out.vx = f[o + P.vx]; out.vy = f[o + P.vy];
    out.w = f[o + P.w] | 0; out.h = f[o + P.h] | 0; out.facing = f[o + P.facing] | 0;
    out.grounded = f[o + P.grounded] === 1; out.tool = f[o + P.tool] | 0;
    out.aimX = f[o + P.aimX]; out.aimY = f[o + P.aimY]; out.health = f[o + P.health] | 0;
    out.inputSeq = f[o + P.inputSeq] >>> 0; out.alive = f[o + P.alive] === 1; out.jumpReady = f[o + P.jumpReady] === 1;
    out.animState = f[o + P.animState] | 0; out.animFrame = f[o + P.animFrame] | 0;
    out.deathTicks = f[o + P.deathTicks] | 0; out.respawnReady = f[o + P.respawnReady] === 1;
    out.bowCharge = f[o + P.bowCharge]; out.heldItemKind = f[o + P.heldItemKind] | 0;
    out.jetpackFuel = f[o + P.jetpackFuel]; out.jetpackActive = f[o + P.jetpackActive] === 1;
    out.shieldHealth = f[o + P.shieldHealth] | 0; out.shieldActive = f[o + P.shieldActive] === 1;
    return out;
  };

  const api = {
    cols: liveCols,
    rows: liveRows,
    chunkCols: liveChunkCols,
    chunkRows: liveChunkRows,
    getPlanet() { return M.getPlanet(ptr); },
    getGravityScale() { return M.getGravityScale(ptr); },
    setGravityScale(scale) {
      if (!Number.isFinite(scale) || scale < 0.05 || scale > 1)
        throw new RangeError(`invalid sand engine gravity scale ${scale}`);
      M.setGravityScale(ptr, scale);
    },
    step() { return M.step(ptr) === 1; },
    stepActors() { return M.stepActors(ptr) === 1; },
    stepWorld() { return M.stepWorld(ptr) === 1; },
    drainSoundEvents() {
      const count = M.soundEventSnapshot(ptr);
      if (!count) return new Float32Array(0);
      return new Float32Array(mod.HEAPF32.buffer, M.soundEventSnapshotPtr(ptr), count * STRIDES.soundEvent).slice();
    },
    sampleAmbience(x, y, radius = 64) {
      M.audioAmbience(ptr, x, y, radius | 0, ambienceOut);
      return new Float32Array(mod.HEAPF32.buffer, ambienceOut, 12).slice();
    },
    getGrid() { return gridView(); },
    // Build the coalesced dirty rects in C++ and hand back a zero-copy view.
    // buildDirtyRects may grow wasm memory (its rect vector), so the HEAP32
    // view is created AFTER the call. dirtyChunkCount/chunkTotal drive the
    // full-vs-incremental repaint decision; rects are [x0,y0,x1,y1) exclusive.
    getRenderDirty() {
      M.buildDirtyRects(ptr);
      const rectCount = M.dirtyRectCount(ptr);
      const rects = rectCount ? new Int32Array(mod.HEAP32.buffer, M.dirtyRects(ptr), rectCount * 4) : emptyRects;
      return { rects, rectCount, dirtyChunkCount: M.dirtyCount(ptr), chunkTotal: chunkTotal() };
    },
    clearRenderDirty() { M.clearDirty(ptr); },
    // Material -> RGBA generation in C++. renderFull/renderDirtyRects write into
    // the engine's pixel buffer; getRenderPixels returns a fresh ImageData-ready
    // view of it (re-derived each call: wasm memory can move on growth).
    renderFull() { M.renderFull(ptr); },
    renderFullLayer(layer) { M.renderFullLayer(ptr, layer ? 1 : 0); },
    renderDirtyRects() { M.renderDirtyRects(ptr); },
    getRenderPixels() { return new Uint8ClampedArray(mod.HEAPU8.buffer, M.renderPixels(ptr), cellCount * 4); },
    getRenderPixelsLayer(layer) { return new Uint8ClampedArray(mod.HEAPU8.buffer, M.renderPixelsLayer(ptr, layer ? 1 : 0), cellCount * 4); },
    setSkyLight(value) { M.setSkyLight(ptr, value | 0); },
    // Edit calls return the number of changed cells; the adapter exposes success.
    paintDisc(cx, cy, r, material, overwrite = false) {
      return M.paintDisc(ptr, cx, cy, r, material, overwrite ? 1 : 0) > 0;
    },
    eraseDisc(cx, cy, r) { return M.eraseDisc(ptr, cx, cy, r) > 0; },
    // Generic placement by material id (inventory-forward): any material is
    // placeable without a per-material tool. layer 0=fg, 1=bg.
    placeMaterial(cx, cy, r, material, layer = 0) {
      return (layer ? M.placeMaterialLayer(ptr, layer, cx, cy, r, material) : M.placeMaterial(ptr, cx, cy, r, material)) > 0;
    },

    // Direct cell-space tool helpers used by tests and compatibility callers.
    // The browser runtime uses the engine-owned camera/aim API below.
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
      glTargetKey = key;
      glCanvas = canvasEl;
      return M.glInit(ptr, key) === 1;
    },
    glRestore() { return M.glRestore(ptr) === 1; },
    glResize(devW, devH) { M.glResize(ptr, devW, devH); },
    glActorLight(x, y, w, h) { return M.glActorLight(ptr, x, y, w | 0, h | 0); },
    // Players to overlay. Host/local draws the engine's own players (own = the
    // local id, blue). A client passes a packed [x,y,w,h,facing,own] Float32Array
    // of host-authoritative snapshot players.
    glSetPlayers(useExternal, packed, ownId) {
      if (useExternal) {
        const len = packed ? packed.length : 0;
        if (len) {
          if (len % renderStrides.player !== 0) throw new Error(`external player buffer length ${len} is not divisible by stride ${renderStrides.player}`);
          const buf = glScratch(len);
          mod.HEAPF32.set(packed, buf >> 2);
          M.glSetPlayers(ptr, 1, buf, (len / renderStrides.player) | 0, ownId | 0);
        } else {
          M.glSetPlayers(ptr, 1, 0, 0, ownId | 0); // external, but empty (draw none)
        }
      } else {
        M.glSetPlayers(ptr, 0, 0, 0, ownId | 0);
      }
    },
    glSetSurvivalPreview(on, footprint, erasing, target = null) {
      M.glSetSurvivalPreview(
        ptr,
        on ? 1 : 0,
        footprint | 0,
        erasing ? 1 : 0,
        target ? 1 : 0,
        target?.x | 0,
        target?.y | 0,
      );
    },
    // Dropped items to overlay. Host/local draws the engine's own items. A client
    // passes a packed [id,kind,material,count,x,y,life] Float32Array of the host's
    // item snapshot; null/empty makes the engine draw its own (single-player).
    glSetItems(packed) {
      if (packed === null || packed === undefined) { M.glSetItems(ptr, 0, 0, 0); return; }
      const len = packed.length;
      if (!len) { M.glSetItems(ptr, 1, 0, 0); return; } // external, but empty (draw none)
      if (len % renderStrides.item !== 0) throw new Error(`external item buffer length ${len} is not divisible by stride ${renderStrides.item}`);
      const buf = glScratch(len);
      mod.HEAPF32.set(packed, buf >> 2);
      M.glSetItems(ptr, 1, buf, (len / renderStrides.item) | 0);
    },
    // Authoritative creature overlay. null selects engine-owned single-player
    // creatures; a Float32Array selects a server snapshot (including empty).
    glSetCreatures(packed) {
      if (packed === null || packed === undefined) { M.glSetCreatures(ptr, 0, 0, 0); return; }
      const len = packed.length;
      if (!len) { M.glSetCreatures(ptr, 1, 0, 0); return; }
      if (len % renderStrides.creature !== 0) throw new Error(`external creature buffer length ${len} is not divisible by stride ${renderStrides.creature}`);
      const buf = glScratch(len);
      mod.HEAPF32.set(packed, buf >> 2);
      M.glSetCreatures(ptr, 1, buf, (len / renderStrides.creature) | 0);
    },
    glSetProjectiles(packed) {
      if (packed === null || packed === undefined) { M.glSetProjectiles(ptr, 0, 0, 0); return; }
      const len = packed.length;
      if (!len) { M.glSetProjectiles(ptr, 1, 0, 0); return; }
      if (len % renderStrides.projectile !== 0) throw new Error(`external projectile buffer length ${len} is not divisible by stride ${renderStrides.projectile}`);
      const buf = glScratch(len); mod.HEAPF32.set(packed, buf >> 2);
      M.glSetProjectiles(ptr, 1, buf, (len / renderStrides.projectile) | 0);
    },
    getRenderStrides() { return renderStrides; },
    glSetFlags(gutterOn, snapOff, animationPaused = false) { M.glSetFlags(ptr, gutterOn ? 1 : 0, snapOff ? 1 : 0, animationPaused ? 1 : 0); },
    glSetDebugHitboxes(on) { M.glSetDebugHitboxes(ptr, on ? 1 : 0); },
    glShift(dx) { M.glShift(ptr, dx); },
    glRenderFrame(forceFull) { return M.glRenderFrame(ptr, forceFull ? 1 : 0) === 1; },
    glGetOffset() { M.glGetOffset(ptr, glOffOut); const o = glOffOut >> 2; return { offX: mod.HEAP32[o], offY: mod.HEAP32[o + 1] }; },

    // ---- view camera + input policy (owned by the engine; camera.inc) ----
    setViewport(dpr, cellDev, viewCols, viewRows) { M.setViewport(ptr, dpr, +cellDev, viewCols | 0, viewRows | 0); },
    // Grow/shrink the loaded sim window while preserving world content. Returns true if dims changed.
    resizeLoadedWindow(newCols, newRows) {
      const ok = M.resizeLoadedWindow(ptr, newCols | 0, newRows | 0) === 1;
      if (ok) refreshDims();
      return ok;
    },
    cameraSet(x, y) { M.cameraSet(ptr, x, y); },
    getCam() { M.cameraGet(ptr, camOut); const o = camOut >> 3; return { x: mod.HEAPF64[o], y: mod.HEAPF64[o + 1] }; },
    cameraColX() { return M.cameraColX(ptr); },
    cameraPanTick() { M.cameraPanTick(ptr); },
    cameraFollowTo(cx, cy) { M.cameraFollowTo(ptr, cx, cy); },
    streamWorld() { return M.streamWorld(ptr); },
    inputKey(code, down) { M.inputKey(ptr, code | 0, down ? 1 : 0); },
    inputClearKeys() { M.inputClearKeys(ptr); },
    inputStick(x, y) { M.inputStick(ptr, +x || 0, +y || 0); },
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
    // One batched FFI read for all perf timers (PF layout from the manifest);
    // the three views below slice it for their callers.
    readPerf() {
      M.perfSnapshot(ptr, perfOut);
      const d = new Float64Array(mod.HEAPF64.buffer, perfOut, STRIDES.perfSnapshot);
      const F = OFF.perfSnapshot;
      return { d, F };
    },
    getPerf() {
      const { d, F } = this.readPerf();
      return {
        stepMs: d[F.stepMs],
        actorMs: d[F.actorMs],
        dirtyChunks: d[F.dirtyChunks],
        dirtyRows: d[F.dirtyRows],
        dirtyCells: d[F.dirtyCells],
        componentCount: d[F.componentCount],
        componentCellCount: d[F.componentCellCount],
        crossBondCount: d[F.crossBondCount],
        lightMs: d[F.lightMs],
        fillMs: d[F.fillMs],
        uploadMs: d[F.uploadMs],
        groundingMs: d[F.groundingMs],
        crossLayerGroundingMs: d[F.crossLayerGroundingMs],
        componentIndexMs: d[F.componentIndexMs],
        assemblyUnionMs: d[F.assemblyUnionMs],
        carryMs: d[F.carryMs],
        bodyMs: d[F.bodyMs],
        sandMs: d[F.sandMs],
        liquidMs: d[F.liquidMs],
        gasMs: d[F.gasMs],
        reactMs: d[F.reactMs],
        tailMs: d[F.tailMs],
        layersMs: d[F.layersMs],
        crossMs: d[F.crossMs],
        phases: {},
      };
    },
    getShiftPerf() { const { d, F } = this.readPerf(); return { buffers: d[F.shiftBuffers], translate: d[F.shiftTranslate], register: d[F.shiftRegister], fill: d[F.shiftFill] }; },
    // Fine phases + legacy aggregate aliases used by bench-sand / profile scripts.
    // Fine keys are the source of truth; legacy keys are stable aliases so older
    // benches keep working after the perfSnapshot v2 expansion.
    getStepPerf() {
      const { d, F } = this.readPerf();
      const grounding = d[F.groundingMs];
      const crossLayer = d[F.crossLayerGroundingMs];
      const assembly = d[F.assemblyUnionMs];
      const body = d[F.bodyMs];
      const sand = d[F.sandMs];
      const liquid = d[F.liquidMs];
      const gas = d[F.gasMs];
      const react = d[F.reactMs];
      const carry = d[F.carryMs];
      const tail = d[F.tailMs];
      const layers = d[F.layersMs];
      const cross = d[F.crossMs];
      return {
        groundingMs: grounding,
        crossLayerGroundingMs: crossLayer,
        componentIndexMs: d[F.componentIndexMs],
        assemblyUnionMs: assembly,
        carryMs: carry,
        bodyMs: body,
        sandMs: sand,
        liquidMs: liquid,
        gasMs: gas,
        reactMs: react,
        tailMs: tail,
        layersMs: layers,
        crossMs: cross,
        // Legacy aggregates (acid-*, profile-shift, older baselines)
        // joint ≈ full computeGroundedBoth wall (base floods + bond/UF work).
        ground: grounding,
        rigid: assembly + body,
        react,
        carry,
        settle: sand + liquid + gas,
        tail,
        joint: grounding + crossLayer,
        layers,
        cross,
      };
    },
    getTick() { return M.tick(ptr); },
    getActorTick() { return M.actorTick(ptr); },
    syncActorTick(tick) { M.setActorTick(ptr, Math.max(0, tick | 0)); },
    syncComponents() { M.syncComponents(ptr); },
    sharedGlContextCount() { return M.glContextCount(); },
    destroy({ releaseGlTarget = false } = {}) {
      if (destroyed) return;
      destroyed = true;
      if (releaseGlTarget && glTargetKey) M.glReleaseContext(ptr);
      if (glScratchPtr) { mod._free(glScratchPtr); glScratchPtr = 0; glScratchCap = 0; }
      if (mirrorDraftPtr) { mod._free(mirrorDraftPtr); mirrorDraftPtr = 0; mirrorDraftCap = 0; }
      if (mirrorCreaturePtr) { mod._free(mirrorCreaturePtr); mirrorCreaturePtr = 0; mirrorCreatureCap = 0; }
      mod._free(seedOut);
      mod._free(seedDraftOut);
      mod._free(glOffOut);
      mod._free(camOut);
      mod._free(perfOut);
      mod._free(ambienceOut);
      M.destroy(ptr);
      if (releaseGlTarget && glTargetKey) {
        delete mod.specialHTMLTargets[glTargetKey];
        if (glCanvas?.__sandGlKey === glTargetKey) delete glCanvas.__sandGlKey;
      }
      glTargetKey = null;
      glCanvas = null;
    },

    // Component drafts + seeds. One material-parameterized draft set; the
    // per-material method names remain for the tests/tools that use them.
    addDiscToStoneDraft(cx, cy, r) { return M.addDraft(ptr, cx, cy, r, MAT.STONE) === 1; },
    addDiscToIceDraft(cx, cy, r) { return M.addDraft(ptr, cx, cy, r, MAT.ICE) === 1; },
    finalizeStoneDraft() { M.finalizeDraft(ptr, MAT.STONE); },
    finalizeIceDraft() { M.finalizeDraft(ptr, MAT.ICE); },
    finalizeDriftwoodDraft() { M.finalizeDraft(ptr, MAT.DRIFTWOOD); },
    clearStoneDraft() { M.clearDraft(ptr); },
    clearIceDraft() { M.clearDraft(ptr); },
    getStoneDraftCells() { return draftCells(M.draftSnapshot(ptr)); },
    getIceDraftCells() { return draftCells(M.draftSnapshot(ptr)); },
    getSeedOrigin(cx, cy) {
      if (M.getSeedOrigin(ptr, cx, cy, seedOut) !== 1) return null;
      const o = seedOut >> 2;
      return [mod.HEAP32[o], mod.HEAP32[o + 1]];
    },
    canPlaceSeedAt(x0, y0) { return M.canPlaceSeed(ptr, x0, y0) === 1; },
    placeSeedAt(x0, y0) { return M.placeSeed(ptr, x0, y0) === 1; },
    placeSeedTyped(x0, y0, plantType) { return M.placeSeedTyped(ptr, x0, y0, plantType) === 1; },

    // Streaming infinite world.
    getWorldOffsetX() { return M.worldOffsetX(ptr); },
    getWorldOffsetY() { return M.worldOffsetY(ptr); },
    worldSurfaceAt(worldX) { return M.worldSurfaceAt(ptr, worldX); },
    worldSurfaceAbsAt(worldX) { return M.worldSurfaceAbsAt(ptr, worldX); },
    worldBiomeAt(worldX) { return M.worldBiomeAt(ptr, worldX); },
    worldCaveBiomeAt(worldX, worldY) { return M.worldCaveBiomeAt(ptr, worldX, worldY); },
    worldIsCaveAt(layer, worldX, worldY) { return M.worldIsCaveAt(ptr, layer ? 1 : 0, worldX, worldY) === 1; },
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
    getWorldStoreStats() {
      return {
        bytes: M.worldStoreBytes(ptr),
        persistentTiles: M.worldStoredTileCount(ptr),
        prefetchTiles: M.worldPrefetchTileCount(ptr),
      };
    },
    getHeapBytes() { return mod.HEAPU8.length; }, // wasm linear-memory size (debug)

    // Free rigid bodies.
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

    // Player physics is engine-owned; JS forwards input and consumes snapshots for
    // replication, UI, and presentation.
    spawnPlayer(x, y) { return M.spawnPlayer(ptr, x, y); },
    spawnPlayerAtSurface(col) { return M.spawnPlayerSurface(ptr, col | 0); },
    getSurfaceSpawn(col) {
      M.playerSurfaceSpawn(ptr, col | 0, camOut);
      const o = camOut >> 3;
      return { x: mod.HEAPF64[o], y: mod.HEAPF64[o + 1] };
    },
    getPlayerSize() { return { w: M.playerWidth(), h: M.playerHeight() }; },
    removePlayer(id) { M.removePlayer(ptr, id); },
    // input: { bits, aimX, aimY, tool, seq, moveX?, moveY? }
    setPlayerInput(id, { bits = 0, aimX = 0, aimY = 0, tool = 0, seq = 0, moveX = NaN, moveY = NaN } = {}) {
      M.setPlayerInput(ptr, id, bits | 0, aimX, aimY, tool | 0, seq | 0,
        Number.isFinite(moveX) ? moveX : NaN, Number.isFinite(moveY) ? moveY : NaN);
    },
    playerCount() { return M.playerCount(ptr); },
    // Rebuild + read the packed player snapshot zero-copy (re-derived: the build
    // call may grow wasm memory). Returns an array of plain player objects.
    getPlayers() {
      const n = M.playerSnapshot(ptr);
      if (!n) return [];
      const stride = STRIDES.playerSnapshot;
      const f = new Float32Array(mod.HEAPF32.buffer, M.playerSnapshotPtr(ptr), n * stride);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = readPlayer(f, i * stride, {});
      return out;
    },
    // Single-player read without rebuilding every player. Pass `out` to reuse an
    // object across frames (the camera-follow path); omit it for a fresh object
    // (predict.js holds before/after snapshots simultaneously).
    getPlayer(id, out) {
      const n = M.playerSnapshot(ptr);
      if (!n) return null;
      const stride = STRIDES.playerSnapshot;
      const f = new Float32Array(mod.HEAPF32.buffer, M.playerSnapshotPtr(ptr), n * stride);
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        if ((f[o] | 0) === id) return readPlayer(f, o, out || {});
      }
      return null;
    },

    // Dropped items (entities; physics owned by the engine). spawnItem returns
    // the receiving stack actor id. Cosmetic particles are a test hook
    // (wasmBridge/testHooks.js).
    spawnItem(material, count, px, py, vx = 0, vy = 0) { return M.spawnItem(ptr, material | 0, count | 0, px, py, vx, vy); },
    itemCount() { return M.itemCount(ptr); },
    spawnCreature(species, worldX, worldY) { return M.spawnCreature(ptr, species | 0, worldX, worldY); },
    spawnScriptedCreature(species, worldX, worldY) {
      return M.spawnScriptedCreature(ptr, species | 0, worldX, worldY);
    },
    _testSpawnNearFocus(species, salt = 0) {
      return M.testSpawnNearFocus(ptr, species | 0, salt | 0) === 1;
    },
    _testSpawnBreachNearFocus(species, salt = 0) {
      return M.testSpawnBreachNearFocus(ptr, species | 0, salt | 0) === 1;
    },
    damageCreatures(x, y, radius, damage) { return M.damageCreatures(ptr, x | 0, y | 0, radius | 0, damage | 0) === 1; },
    creatureCount() { return M.creatureCount(ptr); },
    startMission(missionId, playerId) {
      return M.startMission(ptr, missionId | 0, playerId | 0) === 1;
    },
    getMission() {
      if (M.missionSnapshot(ptr) !== 1) return null;
      const objectiveCount = M.objectiveSnapshot(ptr);
      const header = new Int32Array(
        mod.HEAP32.buffer,
        M.missionSnapshotPtr(ptr),
        STRIDES.missionSnapshot,
      );
      const H = OFF.missionSnapshot;
      const packed = objectiveCount
        ? new Int32Array(
          mod.HEAP32.buffer,
          M.objectiveSnapshotPtr(ptr),
          objectiveCount * STRIDES.objectiveSnapshot,
        )
        : null;
      const O = OFF.objectiveSnapshot;
      const objectives = new Array(objectiveCount);
      for (let i = 0; i < objectiveCount; i++) {
        const o = i * STRIDES.objectiveSnapshot;
        objectives[i] = {
          id: packed[o + O.id] | 0,
          type: packed[o + O.type] | 0,
          state: packed[o + O.state] | 0,
          current: packed[o + O.current] | 0,
          required: packed[o + O.required] | 0,
          worldX: packed[o + O.worldX] | 0,
          worldY: packed[o + O.worldY] | 0,
          targetActorId: packed[o + O.targetActorId] | 0,
          flags: packed[o + O.flags] | 0,
        };
      }
      return {
        revision: header[H.revision] | 0,
        missionId: header[H.missionId] | 0,
        planetId: header[H.planetId] | 0,
        phase: header[H.phase] | 0,
        objectiveCount: header[H.objectiveCount] | 0,
        threatLevel: header[H.threatLevel] | 0,
        extractionX: header[H.extractionX] | 0,
        extractionY: header[H.extractionY] | 0,
        elapsedTicks: header[H.elapsedTicks] | 0,
        recoveredWeaponMask: header[H.recoveredWeaponMask] | 0,
        objectives,
      };
    },

    // Survival inventory (authoritative in the engine). setSurvivalInventory routes
    // player controls through the hotbar; getInventory reads a packed snapshot for
    // the HUD; the rest forward slot intents.
    setSurvivalInventory(on) { M.setSurvivalInventory(ptr, on ? 1 : 0); },
    setCreatureRuntime(simulate, naturalSpawn) { M.setCreatureRuntime(ptr, simulate ? 1 : 0, naturalSpawn ? 1 : 0); },
    seedStarterTools(id) { M.seedStarterTools(ptr, id | 0); },
    addToInventory(id, material, count) { return M.addToInventory(ptr, id | 0, material | 0, count | 0) === 1; },
    addSpecialItem(id, itemKind, count) {
      return M.addSpecialItem(ptr, id | 0, itemKind | 0, count | 0) === 1;
    },
    setSelectedSlot(id, slot) { M.setSelectedSlot(ptr, id | 0, slot | 0); },
    cycleSelectedSlot(id, delta) { M.cycleSelectedSlot(ptr, id | 0, delta | 0); },
    setSelectedFootprint(id, footprintId) { M.setSelectedFootprint(ptr, id | 0, footprintId | 0); },
    getSelectedFootprint(id) { return M.selectedFootprint(ptr, id | 0) | 0; },
    getSurvivalFootprints() {
      const n = M.survivalFootprintSnapshot(ptr);
      if (!n) return [];
      const stride = STRIDES.survivalFootprint;
      const f = new Int32Array(mod.HEAP32.buffer, M.survivalFootprintSnapshotPtr(ptr), n * stride);
      const out = new Array(n);
      const O = OFF.survivalFootprint;
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        out[i] = {
          id: f[o + O.id] | 0,
          width: f[o + O.width] | 0,
          height: f[o + O.height] | 0,
          cellCount: f[o + O.cellCount] | 0,
          anchorX: f[o + O.anchorX] | 0,
          anchorY: f[o + O.anchorY] | 0,
        };
      }
      return out;
    },
    inventoryMove(id, from, to) { M.inventoryMove(ptr, id | 0, from | 0, to | 0); },
    placeFromSelected(id, ax, ay) { return M.placeFromSelected(ptr, id | 0, ax | 0, ay | 0) === 1; },
    // Minecraft cursor model. cursorPick(slot, half) picks/places/swaps the carried
    // stack; throwFromCursor(whole) ejects it into the world (facing dir). getCursor
    // reads the carried stack for the HUD's floating item (null when empty).
    inventoryCursorPick(id, slot, half) { M.inventoryCursorPick(ptr, id | 0, slot | 0, half ? 1 : 0); },
    throwFromCursor(id, whole) { return M.inventoryThrowFromCursor(ptr, id | 0, whole ? 1 : 0) === 1; },
    getCursor(id) {
      if (M.cursorSnapshot(ptr, id | 0) !== 1) return null;
      const f = new Float32Array(mod.HEAPF32.buffer, M.cursorSnapshotPtr(ptr), STRIDES.inventorySlot);
      const O = OFF.inventorySlot;
      return { material: f[O.material] | 0, isTool: f[O.isTool] === 1, toolClass: f[O.toolClass] | 0, toolTier: f[O.toolTier] | 0, count: f[O.count] | 0, plantType: f[O.plantType] | 0, itemKind: f[O.itemKind] | 0 };
    },
    // Cheap change detector for the HUD: hash the packed snapshot (all fields
    // are int-valued) without building the 36 slot objects. Includes the
    // selected footprint so a footprint change refreshes the HUD too.
    inventoryHash(id) {
      const n = M.inventorySnapshot(ptr, id | 0);
      if (!n) return 0;
      const stride = STRIDES.inventorySlot;
      const f = new Float32Array(mod.HEAPF32.buffer, M.inventorySnapshotPtr(ptr), n * stride);
      let h = 2166136261 >>> 0;
      for (let i = 0; i < f.length; i++) h = Math.imul(h ^ (f[i] | 0), 16777619) >>> 0;
      return Math.imul(h ^ (M.selectedFootprint(ptr, id | 0) | 0), 16777619) >>> 0;
    },
    getInventory(id) {
      const n = M.inventorySnapshot(ptr, id | 0);
      if (!n) return { slots: [], selected: 0, selectedFootprint: 0 };
      const stride = STRIDES.inventorySlot;
      const f = new Float32Array(mod.HEAPF32.buffer, M.inventorySnapshotPtr(ptr), n * stride);
      const slots = new Array(n);
      let selected = 0;
      const O = OFF.inventorySlot;
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        slots[i] = { material: f[o + O.material] | 0, isTool: f[o + O.isTool] === 1, toolClass: f[o + O.toolClass] | 0, toolTier: f[o + O.toolTier] | 0, count: f[o + O.count] | 0, plantType: f[o + O.plantType] | 0, itemKind: f[o + O.itemKind] | 0 };
        if (f[o + O.selected] === 1) selected = i;
      }
      return { slots, selected, selectedFootprint: this.getSelectedFootprint(id) };
    },
    craft(id, recipeId, craftMax = false) { return M.craftRecipe(ptr, id | 0, recipeId | 0, craftMax ? 1 : 0) | 0; },
    respawnPlayer(id) { return M.respawnPlayer(ptr, id | 0) === 1; },
    getCraftingRecipes() {
      const nr = M.craftingRecipeSnapshot(ptr), ni = M.craftingIngredientSnapshot(ptr);
      const rf = new Int32Array(mod.HEAP32.buffer, M.craftingRecipeSnapshotPtr(ptr), nr * STRIDES.craftingRecipe);
      const inf = new Int32Array(mod.HEAP32.buffer, M.craftingIngredientSnapshotPtr(ptr), ni * STRIDES.craftingIngredient);
      const R = OFF.craftingRecipe, I = OFF.craftingIngredient, out = new Array(nr);
      for (let n = 0; n < nr; n++) {
        const o = n * STRIDES.craftingRecipe, ingredients = [];
        for (let j = 0; j < rf[o + R.ingredientCount]; j++) {
          const q = (rf[o + R.ingredientStart] + j) * STRIDES.craftingIngredient;
          ingredients.push({ kind: inf[q + I.kind] | 0, value: inf[q + I.value] | 0, count: inf[q + I.count] | 0 });
        }
        out[n] = { id: rf[o + R.id] | 0, outputKind: rf[o + R.outputKind] | 0, outputMaterial: rf[o + R.outputMaterial] | 0, outputTier: rf[o + R.outputTier] | 0, outputCount: rf[o + R.outputCount] | 0, ingredients };
      }
      return out;
    },
    // Rebuild + read the packed item snapshot zero-copy. Returns plain item objects.
    getItems() {
      const n = M.itemSnapshot(ptr);
      if (!n) return [];
      const stride = STRIDES.itemSnapshot;
      const f = new Float32Array(mod.HEAPF32.buffer, M.itemSnapshotPtr(ptr), n * stride);
      const out = new Array(n);
      const O = OFF.itemSnapshot;
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        out[i] = { id: f[o + O.id] | 0, kind: f[o + O.kind] | 0, material: f[o + O.material] | 0, count: f[o + O.count] | 0, x: f[o + O.x], y: f[o + O.y], life: f[o + O.life] | 0, plantType: f[o + O.plantType] | 0, itemKind: f[o + O.itemKind] | 0, isTool: f[o + O.isTool] === 1, toolClass: f[o + O.toolClass] | 0, toolTier: f[o + O.toolTier] | 0 };
      }
      return out;
    },
    // Local presentation uses one compact copy per actor tick. Unlike network
    // item replication, this includes short-lived cosmetic debris.
    getItemSnapshotData() {
      const n = M.itemSnapshot(ptr); if (!n) return new Float32Array();
      return Float32Array.from(new Float32Array(
        mod.HEAPF32.buffer, M.itemSnapshotPtr(ptr), n * STRIDES.itemSnapshot,
      ));
    },
    getProjectiles() {
      const n = M.projectileSnapshot(ptr); if (!n) return [];
      const f = new Float32Array(mod.HEAPF32.buffer, M.projectileSnapshotPtr(ptr), n * STRIDES.projectileSnapshot);
      const O = OFF.projectileSnapshot, out = new Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * STRIDES.projectileSnapshot;
        out[i] = {
          id: f[o + O.id] | 0, owner: f[o + O.owner] | 0,
          x: f[o + O.x], y: f[o + O.y], vx: f[o + O.vx], vy: f[o + O.vy],
          charge: f[o + O.charge], kind: f[o + O.kind] | 0,
          fuse: f[o + O.fuse] | 0, rotation: f[o + O.rotation],
        };
      }
      return out;
    },
    getProjectileSnapshotData() {
      const n = M.projectileSnapshot(ptr); if (!n) return new Float32Array();
      return Float32Array.from(new Float32Array(mod.HEAPF32.buffer, M.projectileSnapshotPtr(ptr), n * STRIDES.projectileSnapshot));
    },
    getCreatures() {
      const n = M.creatureSnapshot(ptr);
      if (!n) return [];
      const stride = STRIDES.creatureSnapshot;
      const f = new Float32Array(mod.HEAPF32.buffer, M.creatureSnapshotPtr(ptr), n * stride);
      const out = new Array(n), O = OFF.creatureSnapshot;
      for (let i = 0; i < n; i++) {
        const o = i * stride;
        out[i] = {
          id: f[o + O.id] | 0, species: f[o + O.species] | 0,
          x: f[o + O.x], y: f[o + O.y], vx: f[o + O.vx], vy: f[o + O.vy],
          w: f[o + O.w] | 0, h: f[o + O.h] | 0, facing: f[o + O.facing] | 0,
          health: f[o + O.health] | 0, maxHealth: f[o + O.maxHealth] | 0,
          alive: f[o + O.alive] === 1, animFrame: f[o + O.animFrame] | 0,
          attackState: f[o + O.attackState] | 0, attackProgress: f[o + O.attackProgress],
          attackPattern: f[o + O.attackPattern] | 0,
          aimX: f[o + O.aimX], aimY: f[o + O.aimY],
          spawnProgress: f[o + O.spawnProgress],
        };
      }
      return out;
    },
    getCreatureSnapshotData() {
      const n = M.creatureSnapshot(ptr);
      if (!n) return new Float32Array();
      return Float32Array.from(new Float32Array(mod.HEAPF32.buffer, M.creatureSnapshotPtr(ptr), n * STRIDES.creatureSnapshot));
    },
    setMirrorCreatures(data, sourceOffsetX, sourceOffsetY) {
      const values = data instanceof Float32Array ? data : new Float32Array(data || 0);
      if (values.length % STRIDES.creatureSnapshot) throw new Error('invalid creature mirror snapshot');
      if (values.length > mirrorCreatureCap) {
        if (mirrorCreaturePtr) mod._free(mirrorCreaturePtr);
        mirrorCreatureCap = Math.max(values.length, mirrorCreatureCap * 2, STRIDES.creatureSnapshot * 8);
        mirrorCreaturePtr = mod._malloc(mirrorCreatureCap * 4);
      }
      if (values.length) mod.HEAPF32.set(values, mirrorCreaturePtr >> 2);
      M.setMirrorCreatures(ptr, mirrorCreaturePtr, values.length / STRIDES.creatureSnapshot, sourceOffsetX | 0, sourceOffsetY | 0);
    },
    getPlayerActionCount() { return M.playerActionCount(ptr); },
    // Prediction: step one player's physics without the world sim; snap a player
    // to an authoritative state before replaying unacknowledged inputs.
    stepPlayerOnly(id) { M.stepPlayerOnly(ptr, id); },
    // Held mining tool (class, tier) + a direct foreground mine hook. Mining drops
    // the destroyed material as an item only when the held tool satisfies its gate.
    setPlayerTool(id, toolClass, toolTier) { M.setPlayerTool(ptr, id, toolClass | 0, toolTier | 0); },
    playerMine(id, ax, ay) { return M.playerMine(ptr, id, ax, ay) === 1; },
    getPlayerMineProgress(id) { return Math.max(0, Math.min(1, M.playerMineProgress(ptr, id | 0) || 0)); },
    // Locked hold-mine cell for HUD overlays; null when not actively mining.
    getPlayerMineTarget(id) {
      if (M.playerMineTarget(ptr, id | 0, glOffOut) !== 1) return null;
      const o = glOffOut >> 2;
      return { x: mod.HEAP32[o] | 0, y: mod.HEAP32[o + 1] | 0 };
    },
    setPlayerState(id, {
      x, y, vx = 0, vy = 0, facing = 1, grounded = false, jumpReady = false,
      jetpackFuel = 1, jetpackActive = false,
    }) {
      M.setPlayerState(ptr, id, x, y, vx, vy, facing | 0, grounded ? 1 : 0,
        jumpReady ? 1 : 0, jetpackFuel, jetpackActive ? 1 : 0);
    },

    // World replication. serialize* returns a copy of the bytes (the
    // blob is re-derived each call; copy so callers can hold it). apply* take a
    // Uint8Array and write it into wasm memory. gridHash detects divergence.
    serializeWorld() { const n = M.serializeWorld(ptr); return wasmView(Uint8Array, M.netBlobPtr(ptr), n, 'serializeWorld').slice(); },
    serializeDiff() { const n = M.serializeDiff(ptr); return wasmView(Uint8Array, M.netBlobPtr(ptr), n, 'serializeDiff').slice(); },
    applyWorld(bytes) { const buf = mod._malloc(bytes.length); mod.HEAPU8.set(bytes, buf); M.applyWorld(ptr, buf, bytes.length); mod._free(buf); },
    applyDiff(bytes) { if (!bytes.length) return; const buf = mod._malloc(bytes.length); mod.HEAPU8.set(bytes, buf); M.applyDiff(ptr, buf, bytes.length); mod._free(buf); },
    applyWorldMirror(bytes, worldOffsetX, worldOffsetY) {
      const buf = mod._malloc(bytes.length);
      mod.HEAPU8.set(bytes, buf);
      M.setMirrorWorldOffset(ptr, worldOffsetX | 0, worldOffsetY | 0);
      M.applyWorldMirror(ptr, buf, bytes.length);
      mod._free(buf);
    },
    applyDiffMirror(bytes, lightEditX0 = 1, lightEditX1 = 0) {
      if (!bytes.length) return;
      const buf = mod._malloc(bytes.length);
      mod.HEAPU8.set(bytes, buf);
      M.applyDiffMirror(ptr, buf, bytes.length, lightEditX0 | 0, lightEditX1 | 0);
      mod._free(buf);
    },
    setMirrorWorldTick(tick) { M.setMirrorWorldTick(ptr, tick | 0); },
    setMirrorDraft(cells, material = 0) {
      const n = cells?.length || 0;
      if (n > mirrorDraftCap) {
        if (mirrorDraftPtr) mod._free(mirrorDraftPtr);
        mirrorDraftCap = Math.max(n, mirrorDraftCap * 2, 64);
        mirrorDraftPtr = mod._malloc(mirrorDraftCap * 4);
      }
      if (n) mod.HEAP32.set(cells, mirrorDraftPtr >> 2);
      M.setMirrorDraft(ptr, mirrorDraftPtr, n, material | 0);
    },
    gridHash() { return M.gridHash(ptr) >>> 0; },
    resetDirty() { M.clearAllDirty(ptr); },
    consumeReplicaDirty() { M.clearReplicaDirty(ptr); },

    // ---- two-layer access (background = layer 1) ----
    getGridBg() { return new Uint8Array(mod.HEAPU8.buffer, M.gridBg(ptr), cellCount); },
    setBgEnabled(on) { M.setBgEnabled(ptr, on ? 1 : 0); },
    paintDiscLayer(layer, cx, cy, r, material, overwrite = false) { return M.paintDiscLayer(ptr, layer | 0, cx, cy, r, material, overwrite ? 1 : 0); },
    eraseDiscLayer(layer, cx, cy, r) { return M.eraseDiscLayer(ptr, layer | 0, cx, cy, r) > 0; },
    syncComponentsLayer(layer) { M.syncComponentsLayer(ptr, layer | 0); },
    // Test/diagnostic hooks (grounding debug, body pokes, particles) live in
    // wasmBridge/testHooks.js — scripts call attachTestHooks(engine). The raw
    // engine pointer is exposed for that module only.
    ptr,
  };
  return api;
}
