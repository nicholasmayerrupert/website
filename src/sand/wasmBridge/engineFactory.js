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
import {
  AMBIENCE_GROUP_COUNT, AMBIENCE_SAMPLE_STRIDE,
} from '../materials.generated.js';
import {
  ABI_VERSION, ABI_FINGERPRINT, OFF, STRIDES, INPUT,
  PLANET, PLANET_COUNT, PLANET_ALL_MASK, PLANET_NAMES, PLANET_BY_NAME,
  PLANET_PRESENTATION, PLANET_PRESENTATION_PROFILE_COUNT,
  PLANET_PRESENTATION_BY_ID,
  BIOME, SURFACE_BIOME_COUNT, SURFACE_BIOME_ALL_MASK,
  CAVE_BIOME, CAVE_BIOME_COUNT, CAVE_BIOME_ALL_MASK,
  BIOME_FAMILY,
  WORLD_AREA, WORLD_FEATURE, WORLD_SITE_ROLE,
} from './abi.generated.js';
import {
  SURFACE_BIOME_DEFS, CAVE_BIOME_DEFS,
  SURFACE_BIOME_SELECTION_ORDER,
  SHALLOW_CAVE_BIOME_SELECTION_ORDER,
  DEEP_CAVE_BIOME_SELECTION_ORDER,
} from './biomes.generated.js';
import {
  withPatchedCanvasWebGLContext,
  withResizableTextDecoder,
} from './resizableBrowserBuffers.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';
import { maxWorldDiffBytes, maxWorldRleBytes } from '../worldPacketValidation.js';
import {
  unpackRecordAt, unpackRecords, unpackSnapshotObjectAt,
} from './recordCodec.js';

export {
  MAT, PLANET, PLANET_COUNT, PLANET_ALL_MASK, PLANET_NAMES, PLANET_BY_NAME,
  PLANET_PRESENTATION, PLANET_PRESENTATION_PROFILE_COUNT,
  PLANET_PRESENTATION_BY_ID,
  BIOME, SURFACE_BIOME_COUNT, SURFACE_BIOME_ALL_MASK,
  CAVE_BIOME, CAVE_BIOME_COUNT, CAVE_BIOME_ALL_MASK,
  BIOME_FAMILY,
  SURFACE_BIOME_DEFS, CAVE_BIOME_DEFS, SURFACE_BIOME_SELECTION_ORDER,
  SHALLOW_CAVE_BIOME_SELECTION_ORDER, DEEP_CAVE_BIOME_SELECTION_ORDER,
  WORLD_AREA, WORLD_FEATURE, WORLD_SITE_ROLE,
};
// Player input bitmask + snapshot layouts come from the generated ABI manifest
// (abi.generated.js) — one schema edit changes both sides.
export { INPUT };

const STREAM_CHUNK_SIZE = 32;

function assertEngineDimensions(cols, rows) {
  const cells = cols * rows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0
      || cols > ENGINE_MAX_DIMENSION || rows > ENGINE_MAX_DIMENSION
      || !Number.isSafeInteger(cells) || cells > ENGINE_MAX_CELLS) {
    throw new RangeError(`invalid sand engine dimensions ${cols}x${rows}`);
  }
  return cells;
}

let modPromise = null;
let M = null; // resolved module + cwrapped fns
let glTargetSeq = 0; // unique key per canvas for emscripten's specialHTMLTargets

export function initSandWasm() {
  if (!modPromise) {
    modPromise = createSandModule().then((mod) => {
      const c = (name, ret, args) => mod.cwrap(name, ret, args);
      // Refuse a module whose compiled-in ABI version mismatches the JS
      // manifest — the loud failure for stale committed sandEngine artifacts.
      const wasmAbi = c('engine_abi_version', 'number', [])();
      if (wasmAbi !== ABI_VERSION) {
        throw new Error(`sand wasm ABI version ${wasmAbi} != JS manifest ${ABI_VERSION} — rebuild the wasm (npm run build:sand) or regenerate (npm run generate:abi)`);
      }
      const wasmFingerprint = c('engine_abi_fingerprint', 'number', [])();
      if (wasmFingerprint !== ABI_FINGERPRINT) {
        throw new Error(`sand wasm ABI fingerprint ${wasmFingerprint.toString(16)} != JS manifest ${ABI_FINGERPRINT.toString(16)} — rebuild the wasm (npm run build:sand)`);
      }
      M = {
        mod,
        create: c('engine_create', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        worldGenerationVersion: c('engine_world_generation_version', 'number', []),
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
        worldBiomeSample: c('engine_world_biome_sample', null,
          ['number', 'number', 'number', 'number']),
        worldContextAt: c('engine_world_context_at', null,
          ['number', 'number', 'number', 'number']),
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
        draftSnapshot: c('engine_draft_snapshot', 'number', ['number']),
        draftPtr: c('engine_draft_ptr', 'number', ['number']),
        getSeedOrigin: c('engine_get_seed_origin', 'number', ['number', 'number', 'number', 'number']),
        placeSeed: c('engine_place_seed', 'number', ['number', 'number', 'number']),
        placeSeedTyped: c('engine_place_seed_typed', 'number', ['number', 'number', 'number', 'number']),
        spawnBody: c('engine_spawn_body', null, ['number', 'number', 'number']),
        spawnBox: c('engine_spawn_box', null, ['number', 'number', 'number', 'number', 'number', 'number']),
        spawnDisc: c('engine_spawn_disc', null, ['number', 'number', 'number', 'number', 'number']),
        setTool: c('engine_set_tool', null, ['number', 'number']),
        setCreativeMaterial: c('engine_set_creative_material', null, ['number', 'number', 'number']),
        pointerDown: c('engine_pointer_down', 'number', ['number', 'number', 'number', 'number']),
        pointerDraft: c('engine_pointer_draft', 'number', ['number', 'number', 'number']),
        pointerButtons: c('engine_pointer_buttons', null, ['number', 'number']),
        pointerUp: c('engine_pointer_up', 'number', ['number', 'number']),
        applyTool: c('engine_apply_tool', 'number', ['number', 'number', 'number', 'number', 'number', 'number']),
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
        applyWorld: c('engine_apply_world', 'number', ['number', 'number', 'number']),
        applyDiff: c('engine_apply_diff', 'number', ['number', 'number', 'number']),
        applyWorldMirror: c('engine_apply_world_mirror', 'number', ['number', 'number', 'number']),
        applyDiffMirror: c('engine_apply_diff_mirror', 'number', ['number', 'number', 'number', 'number', 'number']),
        setMirrorWorldOffset: c('engine_set_mirror_world_offset', null, ['number', 'number', 'number']),
        setMirrorWorldTick: c('engine_set_mirror_world_tick', null, ['number', 'number']),
        setMirrorDraft: c('engine_set_mirror_draft', null, ['number', 'number', 'number', 'number']),
        gridHash: c('engine_grid_hash', 'number', ['number']),
        clearAllDirty: c('engine_clear_all_dirty', null, ['number']),
        clearReplicaDirty: c('engine_clear_replica_dirty', null, ['number']),
        resetSimulationActivity: c('engine_reset_simulation_activity', null, ['number', 'number']),
        activateSimulationRect: c('engine_activate_simulation_rect', null, ['number', 'number', 'number', 'number', 'number']),
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
  assertEngineDimensions(cols, rows);
  if (!Number.isInteger(planetId) || planetId < 0 || planetId >= PLANET_COUNT) {
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
  if (!ptr) throw new Error('sand engine allocation failed');
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
  const mallocOrThrow = (bytes, label) => {
    const allocation = mod._malloc(bytes);
    if (!allocation) throw new Error(`${label}: WASM allocation failed for ${bytes} bytes`);
    return allocation;
  };
  const withTemporaryBytes = (bytes, label, apply) => {
    const allocation = mallocOrThrow(bytes.length, label);
    try {
      mod.HEAPU8.set(bytes, allocation);
      return apply(allocation);
    } finally {
      mod._free(allocation);
    }
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
  const fixedScratch = [];
  const fixedAlloc = (bytes, label) => {
    const allocation = mallocOrThrow(bytes, label);
    fixedScratch.push(allocation);
    return allocation;
  };
  let seedOut, seedDraftOut, glOffOut, camOut, perfOut, ambienceOut,
    biomeSampleOut, worldContextOut;
  try {
    seedOut = fixedAlloc(8, 'seed result');
    seedDraftOut = fixedAlloc(12, 'seed draft result');
    glOffOut = fixedAlloc(8, 'GL offset result');
    camOut = fixedAlloc(16, 'camera result'); // 2 doubles: cameraGet / aimCell
    perfOut = fixedAlloc(STRIDES.perfSnapshot * 8, 'performance result');
    ambienceOut = fixedAlloc(
      AMBIENCE_GROUP_COUNT * AMBIENCE_SAMPLE_STRIDE * 4,
      'ambience result',
    );
    biomeSampleOut = fixedAlloc(STRIDES.biomeSample * 4, 'biome sample result');
    worldContextOut = fixedAlloc(STRIDES.worldContext * 4, 'world context result');
  } catch (error) {
    for (const allocation of fixedScratch) mod._free(allocation);
    M.destroy(ptr);
    throw error;
  }
  // Grow-only wasm scratch for the per-frame GL player/item uploads — a frame
  // reuses it instead of a _malloc/_free round trip per call.
  let glScratchPtr = 0, glScratchCap = 0;
  let mirrorDraftPtr = 0, mirrorDraftCap = 0, mirrorCreaturePtr = 0, mirrorCreatureCap = 0;
  let glTargetKey = null, glCanvas = null, glDevW = 0, glDevH = 0;
  let destroyed = false;
  const glScratch = (floats) => {
    if (floats > glScratchCap) {
      const nextCap = Math.max(floats, glScratchCap * 2, 64);
      const nextPtr = mallocOrThrow(nextCap * 4, 'GL actor scratch');
      if (glScratchPtr) mod._free(glScratchPtr);
      glScratchCap = nextCap;
      glScratchPtr = nextPtr;
    }
    return glScratchPtr;
  };
  // Packed draft cell INDICES (k = y*cols + x) as a zero-copy view into wasm
  // memory — no Set allocation. Stone and ice share one snapshot buffer, so the
  // returned view is only valid until the next draft snapshot call; the caller
  // must fully consume one draft before requesting the other.
  const draftCells = (count) => (count ? new Int32Array(mod.HEAP32.buffer, M.draftPtr(ptr), count) : emptyRects);

  const readPlayer = (packed, offset, out) => unpackRecordAt(
    packed, 'playerSnapshot', offset / STRIDES.playerSnapshot, out,
  );

  const api = {
    cols: liveCols,
    rows: liveRows,
    chunkCols: liveChunkCols,
    chunkRows: liveChunkRows,
    getPlanet() { return M.getPlanet(ptr); },
    getWorldGenerationVersion() { return M.worldGenerationVersion(); },
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
      return new Float32Array(
        mod.HEAPF32.buffer, ambienceOut,
        AMBIENCE_GROUP_COUNT * AMBIENCE_SAMPLE_STRIDE,
      ).slice();
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
      return withPatchedCanvasWebGLContext(
        canvasEl,
        () => M.glInit(ptr, key) === 1,
      );
    },
    glRestore() {
      return withResizableTextDecoder(() => M.glRestore(ptr) === 1);
    },
    glResize(devW, devH) {
      M.glResize(ptr, devW, devH);
      glDevW = devW | 0;
      glDevH = devH | 0;
    },
    glActorLight(x, y, w, h) { return M.glActorLight(ptr, x, y, w | 0, h | 0); },
    // Players to overlay. Host/local draws the engine's own players (own = the
    // local id, blue). A client passes host-authoritative records packed with the
    // generated glPlayerExt layout.
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
    // passes records packed with the generated itemSnapshot layout; null/empty
    // makes the engine draw its own (single-player).
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
      assertEngineDimensions(newCols, newRows);
      assertEngineDimensions(
        Math.ceil(newCols / STREAM_CHUNK_SIZE) * STREAM_CHUNK_SIZE,
        Math.ceil(newRows / STREAM_CHUNK_SIZE) * STREAM_CHUNK_SIZE,
      );
      const ok = M.resizeLoadedWindow(ptr, newCols, newRows) === 1;
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
      if (![x, y, w, h].every(Number.isInteger)
          || x < 0 || y < 0 || w < 0 || h < 0) {
        throw new RangeError(`invalid GL readback rectangle ${x},${y} ${w}x${h}`);
      }
      if (w > glDevW || h > glDevH
          || x > glDevW - w || y > glDevH - h) {
        throw new RangeError(`GL readback rectangle ${x},${y} ${w}x${h} exceeds ${glDevW}x${glDevH}`);
      }
      const n = w * h * 4;
      if (!Number.isSafeInteger(n) || n > 0x7fffffff) {
        throw new RangeError(`invalid GL readback size ${w}x${h}`);
      }
      if (!n) return new Uint8ClampedArray();
      const buf = mallocOrThrow(n, 'GL readback');
      try {
        const ok = M.glReadPixels(ptr, x, y, w, h, buf) === 1;
        return ok
          ? new Uint8ClampedArray(mod.HEAPU8.buffer, buf, n).slice()
          : new Uint8ClampedArray(n);
      } finally {
        mod._free(buf);
      }
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
        forcePrepareMs: d[F.forcePrepareMs],
        forceWakeMs: d[F.forceWakeMs],
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
        liquidRelaxMs: d[F.liquidRelaxMs],
        liquidSurfaceMs: d[F.liquidSurfaceMs],
        layersMs: d[F.layersMs],
        crossMs: d[F.crossMs],
        phases: {},
      };
    },
    getShiftPerf() {
      const { d, F } = this.readPerf();
      return {
        save: d[F.shiftSave], buffers: d[F.shiftBuffers],
        translate: d[F.shiftTranslate], register: d[F.shiftRegister],
        fill: d[F.shiftFill],
      };
    },
    // Fine phases + legacy aggregate aliases used by bench-sand / profile scripts.
    // Fine keys are the source of truth; legacy keys are stable aliases so older
    // benches keep working after the perfSnapshot v2 expansion.
    getStepPerf() {
      const { d, F } = this.readPerf();
      const forcePrepare = d[F.forcePrepareMs];
      const forceWake = d[F.forceWakeMs];
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
      const liquidRelax = d[F.liquidRelaxMs];
      const liquidSurface = d[F.liquidSurfaceMs];
      const layers = d[F.layersMs];
      const cross = d[F.crossMs];
      return {
        forcePrepareMs: forcePrepare,
        forceWakeMs: forceWake,
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
        liquidRelaxMs: liquidRelax,
        liquidSurfaceMs: liquidSurface,
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
      mod._free(biomeSampleOut);
      mod._free(worldContextOut);
      M.destroy(ptr);
      if (releaseGlTarget && glTargetKey) {
        delete mod.specialHTMLTargets[glTargetKey];
        if (glCanvas?.__sandGlKey === glTargetKey) delete glCanvas.__sandGlKey;
      }
      glTargetKey = null;
      glCanvas = null;
    },

    // Component drafts + seeds.
    addDiscToStoneDraft(cx, cy, r) { return M.addDraft(ptr, cx, cy, r, MAT.STONE) === 1; },
    addDiscToIceDraft(cx, cy, r) { return M.addDraft(ptr, cx, cy, r, MAT.ICE) === 1; },
    finalizeStoneDraft() { M.finalizeDraft(ptr, MAT.STONE); },
    finalizeIceDraft() { M.finalizeDraft(ptr, MAT.ICE); },
    getStoneDraftCells() { return draftCells(M.draftSnapshot(ptr)); },
    getSeedOrigin(cx, cy) {
      if (M.getSeedOrigin(ptr, cx, cy, seedOut) !== 1) return null;
      const o = seedOut >> 2;
      return [mod.HEAP32[o], mod.HEAP32[o + 1]];
    },
    placeSeedAt(x0, y0) { return M.placeSeed(ptr, x0, y0) === 1; },
    placeSeedTyped(x0, y0, plantType) { return M.placeSeedTyped(ptr, x0, y0, plantType) === 1; },

    // Streaming infinite world.
    getWorldOffsetX() { return M.worldOffsetX(ptr); },
    getWorldOffsetY() { return M.worldOffsetY(ptr); },
    worldSurfaceAt(worldX) { return M.worldSurfaceAt(ptr, worldX); },
    worldSurfaceAbsAt(worldX) { return M.worldSurfaceAbsAt(ptr, worldX); },
    worldBiomeSample(worldX, worldY) {
      M.worldBiomeSample(ptr, worldX | 0, worldY | 0, biomeSampleOut);
      const values = new Int32Array(
        mod.HEAP32.buffer, biomeSampleOut, STRIDES.biomeSample);
      const B = OFF.biomeSample;
      return {
        owner: {
          family: values[B.ownerFamily],
          biome: values[B.ownerBiome],
        },
        neighbor: {
          family: values[B.neighborFamily],
          biome: values[B.neighborBiome],
        },
        blend: values[B.blend] / 255,
      };
    },
    worldContextAt(worldX, worldY) {
      M.worldContextAt(ptr, worldX | 0, worldY | 0, worldContextOut);
      const values = new Int32Array(
        mod.HEAP32.buffer, worldContextOut, STRIDES.worldContext);
      const W = OFF.worldContext;
      return {
        biomeFamily: values[W.biomeFamily],
        biome: values[W.biome],
        surfaceY: values[W.surfaceY],
        depth: values[W.depth],
        tags: values[W.tags] >>> 0,
        featureKind: values[W.featureKind],
        siteRole: values[W.siteRole],
        featureId: values[W.featureId] >>> 0,
        parentFeatureId: values[W.parentFeatureId] >>> 0,
        bounds: {
          left: values[W.left],
          top: values[W.top],
          right: values[W.right],
          bottom: values[W.bottom],
        },
      };
    },
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
      const bytes = nn * 8;
      if (!Number.isSafeInteger(bytes) || nn > cellCount) {
        throw new RangeError(`invalid rigid body cell count ${nn}`);
      }
      const buf = mallocOrThrow(bytes, 'rigid body cells');
      try {
        const base = buf >> 2;
        for (let i = 0; i < nn; i++) {
          const x = cells[i]?.[0], y = cells[i]?.[1];
          if (!Number.isInteger(x) || !Number.isInteger(y)
              || x < 0 || x >= liveCols || y < 0 || y >= liveRows) {
            throw new RangeError(`invalid rigid body cell ${x},${y}`);
          }
          mod.HEAP32[base + i * 2] = x;
          mod.HEAP32[base + i * 2 + 1] = y;
        }
        M.spawnBody(ptr, buf, nn);
      } finally {
        mod._free(buf);
      }
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
      return unpackSnapshotObjectAt(f, 'inventoryStack', 0);
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
        slots[i] = unpackSnapshotObjectAt(f, 'inventoryStack', i);
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
      return unpackRecords(f, 'itemSnapshot');
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
      return unpackRecords(f, 'projectileSnapshot');
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
      return unpackRecords(f, 'creatureSnapshot');
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
        const nextCap = Math.max(values.length, mirrorCreatureCap * 2, STRIDES.creatureSnapshot * 8);
        const nextPtr = mallocOrThrow(nextCap * 4, 'creature mirror snapshot');
        if (mirrorCreaturePtr) mod._free(mirrorCreaturePtr);
        mirrorCreatureCap = nextCap;
        mirrorCreaturePtr = nextPtr;
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
    applyWorld(bytes) {
      if (!(bytes instanceof Uint8Array)
          || bytes.length === 0
          || bytes.length > maxWorldRleBytes(cellCount)) return false;
      return withTemporaryBytes(bytes, 'world snapshot', (buf) => (
        M.applyWorld(ptr, buf, bytes.length) === 1
      ));
    },
    applyDiff(bytes) {
      if (!(bytes instanceof Uint8Array)
          || bytes.length === 0
          || bytes.length > maxWorldDiffBytes(cellCount)) return false;
      return withTemporaryBytes(bytes, 'world diff', (buf) => (
        M.applyDiff(ptr, buf, bytes.length) === 1
      ));
    },
    applyWorldMirror(bytes, worldOffsetX, worldOffsetY) {
      if (!(bytes instanceof Uint8Array)
          || bytes.length === 0
          || bytes.length > maxWorldRleBytes(cellCount)) return false;
      const oldOffsetX = M.worldOffsetX(ptr);
      const oldOffsetY = M.worldOffsetY(ptr);
      return withTemporaryBytes(bytes, 'mirror world snapshot', (buf) => {
        M.setMirrorWorldOffset(ptr, worldOffsetX | 0, worldOffsetY | 0);
        const applied = M.applyWorldMirror(ptr, buf, bytes.length) === 1;
        if (!applied) M.setMirrorWorldOffset(ptr, oldOffsetX, oldOffsetY);
        return applied;
      });
    },
    applyDiffMirror(bytes, lightEditX0 = 1, lightEditX1 = 0) {
      if (!(bytes instanceof Uint8Array)
          || bytes.length === 0
          || bytes.length > maxWorldDiffBytes(cellCount)) return false;
      return withTemporaryBytes(bytes, 'mirror world diff', (buf) => (
        M.applyDiffMirror(ptr, buf, bytes.length, lightEditX0 | 0, lightEditX1 | 0) === 1
      ));
    },
    setMirrorWorldOffset(worldOffsetX, worldOffsetY) {
      M.setMirrorWorldOffset(ptr, worldOffsetX | 0, worldOffsetY | 0);
    },
    setMirrorWorldTick(tick) { M.setMirrorWorldTick(ptr, tick | 0); },
    setMirrorDraft(cells, material = 0) {
      const n = cells?.length || 0;
      if (n > mirrorDraftCap) {
        const nextCap = Math.max(n, mirrorDraftCap * 2, 64);
        const nextPtr = mallocOrThrow(nextCap * 4, 'mirror draft');
        if (mirrorDraftPtr) mod._free(mirrorDraftPtr);
        mirrorDraftCap = nextCap;
        mirrorDraftPtr = nextPtr;
      }
      if (n) mod.HEAP32.set(cells, mirrorDraftPtr >> 2);
      M.setMirrorDraft(ptr, mirrorDraftPtr, n, material | 0);
    },
    gridHash() { return M.gridHash(ptr) >>> 0; },
    resetDirty() { M.clearAllDirty(ptr); },
    consumeReplicaDirty() { M.clearReplicaDirty(ptr); },
    resetSimulationActivity(preserveReplicaDirty = false) {
      M.resetSimulationActivity(ptr, preserveReplicaDirty ? 1 : 0);
    },
    activateSimulationRect(x0, y0, x1, y1) {
      M.activateSimulationRect(ptr, x0 | 0, y0 | 0, x1 | 0, y1 | 0);
    },

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
