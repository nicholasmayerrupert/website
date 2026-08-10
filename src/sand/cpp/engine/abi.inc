// C ABI surface exported to JavaScript through engineFactory.js.
//
// Keep this file as the narrow bridge contract: JS calls these functions to
// create engines, step/render/stream worlds, forward browser input, read packed
// snapshots, and apply multiplayer state. Gameplay policy belongs in the
// subsystem files below, not in the bridge.
static inline bool abiMaterialValid(int material) {
  return material >= 0 && material < MATERIAL_COUNT;
}
static inline bool abiRadiusValid(const Engine* e, int radius) {
  return e && radius >= 0 && radius <= imax(e->cols, e->rows)
      && radius <= 46340;
}
static inline bool abiHalfExtentsValid(
    const Engine* e, int halfW, int halfH) {
  return e && halfW > 0 && halfH > 0
      && halfW <= e->cols && halfH <= e->rows;
}
extern "C" {
// ABI version stamp (abi.generated.hpp). initSandWasm() refuses a module whose
// version mismatches the JS manifest — catches stale committed sandEngine artifacts.
EMSCRIPTEN_KEEPALIVE int engine_abi_version() { return ABI_VERSION; }
EMSCRIPTEN_KEEPALIVE Engine* engine_create(int cols, int rows, uint32_t seed, int sinks, int infinite,
                                          int storageRole, int planetId) {
  if (cols <= 0 || rows <= 0
      || cols > ENGINE_MAX_DIMENSION || rows > ENGINE_MAX_DIMENSION
      || (uint64_t)cols * (uint64_t)rows > ENGINE_MAX_CELLS)
    return nullptr;
  EngineStorageRole role = storageRole == ESR_PRESENTATION ? ESR_PRESENTATION
                         : (storageRole == ESR_AUTHORITY ? ESR_AUTHORITY : ESR_FULL);
  Engine* e = new Engine(cols, rows, seed, sinks != 0, role, planetId);
  if (infinite) {
    if (role == ESR_PRESENTATION) e->initInfinitePresentation(seed);
    else e->initInfinite(seed);
  }
  e->markAllDirty();
  return e;
}
EMSCRIPTEN_KEEPALIVE int engine_get_planet(Engine* e) { return (int)e->planetId; }
EMSCRIPTEN_KEEPALIVE double engine_get_gravity_scale(Engine* e) { return e->gravityScale; }
EMSCRIPTEN_KEEPALIVE void engine_set_gravity_scale(Engine* e, double scale) { e->setGravityScale(scale); }
EMSCRIPTEN_KEEPALIVE void engine_shift_world(Engine* e, int dx) { e->shiftWorld(dx, 0); }
EMSCRIPTEN_KEEPALIVE void engine_shift_world_xy(Engine* e, int dx, int dy) { e->shiftWorld(dx, dy); }
EMSCRIPTEN_KEEPALIVE int engine_maybe_shift_world(Engine* e, int cameraCellX, int visibleCols, int marginCols) { return e->maybeShiftWorld(cameraCellX, visibleCols, marginCols); }
EMSCRIPTEN_KEEPALIVE int engine_maybe_shift_world_v(Engine* e, int cameraCellY, int visibleRows, int marginRows) { return e->maybeShiftWorldVertical(cameraCellY, visibleRows, marginRows); }
EMSCRIPTEN_KEEPALIVE int engine_world_shift_count(Engine* e) { return e->worldShiftCount; }
EMSCRIPTEN_KEEPALIVE void engine_prefetch_advance(Engine* e, int camCellX, int camCellY, int visCols, int visRows) { e->prefetchAdvance(camCellX, camCellY, visCols, visRows); }
EMSCRIPTEN_KEEPALIVE int engine_shift_fill_hit(Engine* e) { return e->shiftFillHit; }
EMSCRIPTEN_KEEPALIVE int engine_shift_fill_miss(Engine* e) { return e->shiftFillMiss; }
EMSCRIPTEN_KEEPALIVE double engine_world_store_bytes(Engine* e) { return (double)e->worldStoreBytes(); }
EMSCRIPTEN_KEEPALIVE int engine_world_stored_tile_count(Engine* e) { return e->worldStoredTileCount(); }
EMSCRIPTEN_KEEPALIVE int engine_world_prefetch_tile_count(Engine* e) { return e->worldPrefetchTileCount(); }
EMSCRIPTEN_KEEPALIVE int engine_world_offset_x(Engine* e) { return e->fg.worldOffsetX; }
EMSCRIPTEN_KEEPALIVE int engine_world_offset_y(Engine* e) { return e->fg.worldOffsetY; }
EMSCRIPTEN_KEEPALIVE int engine_world_surface_at(Engine* e, int worldX) { e->useLayer(&e->fg); return e->fg.infinite ? e->genSurfaceAt(worldX) : 0; }
EMSCRIPTEN_KEEPALIVE int engine_world_surface_abs_at(Engine* e, int worldX) { e->useLayer(&e->fg); return e->fg.infinite ? e->genSurfaceAbs(worldX) : 0; }
EMSCRIPTEN_KEEPALIVE int engine_world_biome_at(Engine* e, int worldX) { e->useLayer(&e->fg); return e->fg.infinite ? e->terrain.genBiomeAt(worldX) : 0; }
EMSCRIPTEN_KEEPALIVE int engine_world_cave_biome_at(Engine* e, int worldX, int worldY) { e->useLayer(&e->fg); return e->fg.infinite ? e->terrain.genCaveBiomeAt(worldX, worldY) : 0; }
EMSCRIPTEN_KEEPALIVE void engine_world_context_at(
    Engine* e, int worldX, int worldY, int* out) {
  e->useLayer(&e->fg);
  if (e->fg.infinite) e->worldContext.writeSnapshot(worldX, worldY, out);
  else memset(out, 0, WC_STRIDE * sizeof(int));
}
EMSCRIPTEN_KEEPALIVE int engine_world_is_cave_at(Engine* e, int layer, int worldX, int worldY) {
  e->useLayer(layer ? &e->bg : &e->fg);
  int result = e->fg.infinite && e->terrain.genOpenCaveAt(worldX, worldY) ? 1 : 0;
  e->useLayer(&e->fg);
  return result;
}
EMSCRIPTEN_KEEPALIVE void engine_destroy(Engine* e) { delete e; }
EMSCRIPTEN_KEEPALIVE int engine_step(Engine* e) { return e->step() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_step_actors(Engine* e) { return e->stepActors() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_step_world(Engine* e) { return e->stepWorld() ? 1 : 0; }
// Semantic authority events + fixed-radius ambience probe. Sound snapshots are
// consumed on read; ambience is sampled from the presentation mirror on demand.
EMSCRIPTEN_KEEPALIVE int engine_sound_event_snapshot(Engine* e) { return e->audio.buildAndDrainSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_sound_event_snapshot_ptr(Engine* e) { return e->audio.snapshotData(); }
EMSCRIPTEN_KEEPALIVE void engine_audio_ambience(Engine* e, double x, double y, int radius, float* out) { e->audio.sampleAmbience(x, y, radius, out); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid(Engine* e) { return e->fg.grid; }
EMSCRIPTEN_KEEPALIVE int engine_dirty_count(Engine* e) { return e->fg.dirtyRenderCount; }
EMSCRIPTEN_KEEPALIVE int engine_cols(Engine* e) { return e->cols; }
EMSCRIPTEN_KEEPALIVE int engine_rows(Engine* e) { return e->rows; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_cols(Engine* e) { return e->chunkCols; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_rows(Engine* e) { return e->chunkRows; }
// Dirty-rect generation (C++ owns the coalescing; JS reads the packed rects).
EMSCRIPTEN_KEEPALIVE void engine_build_dirty_rects(Engine* e) { e->useLayer(&e->fg); e->buildDirtyRects(); }
EMSCRIPTEN_KEEPALIVE int engine_dirty_rect_count(Engine* e) { return (int)(e->fg.dirtyRects.size() / 4); }
EMSCRIPTEN_KEEPALIVE int* engine_dirty_rects(Engine* e) { return e->fg.dirtyRects.data(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_dirty(Engine* e) { memset(e->fg.dirtyRender.data(), 0, e->fg.dirtyRender.size()); e->fg.dirtyRenderCount = 0; }
// Material-to-RGBA buffers used by GL presentation and diagnostics.
EMSCRIPTEN_KEEPALIVE void engine_render_full(Engine* e) { e->useLayer(&e->fg); e->renderer.renderFull(); }
EMSCRIPTEN_KEEPALIVE void engine_render_full_layer(Engine* e, int layer) {
  if (layer) { e->useLayer(&e->fg); if (Renderer::RENDER_LIGHTING_ENABLED) e->renderer.computeLighting(&e->fg); }
  e->useLayer(layer ? &e->bg : &e->fg); e->renderer.renderFull(); e->useLayer(&e->fg);
}
EMSCRIPTEN_KEEPALIVE void engine_render_dirty_rects(Engine* e) { e->useLayer(&e->fg); e->renderer.renderDirtyRects(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_render_pixels(Engine* e) { return e->fg.renderPixels.data(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_render_pixels_layer(Engine* e, int layer) { return (layer ? e->bg.renderPixels : e->fg.renderPixels).data(); }
EMSCRIPTEN_KEEPALIVE void engine_set_sky_light(Engine* e, int v) { e->renderer.renderSkyLight = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v)); }
EMSCRIPTEN_KEEPALIVE int engine_paint_disc(Engine* e, int cx, int cy, int r, int mat, int ow) {
  if (!abiMaterialValid(mat) || !abiRadiusValid(e, r)) return 0;
  e->useLayer(&e->fg);
  return e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0);
}
EMSCRIPTEN_KEEPALIVE int engine_erase_disc(Engine* e, int cx, int cy, int r) {
  if (!abiRadiusValid(e, r)) return 0;
  e->useLayer(&e->fg);
  return e->eraseDisc(cx, cy, r);
}
// Generic material placement by id (inventory-forward): routes by kind/group so
// any material is placeable without a per-material tool. 0=fg, 1=bg.
EMSCRIPTEN_KEEPALIVE int engine_place_material(Engine* e, int cx, int cy, int r, int mat) {
  if (!abiMaterialValid(mat) || !abiRadiusValid(e, r)) return 0;
  e->useLayer(&e->fg);
  return e->placeMaterialAt(cx, cy, r, (uint8_t)mat);
}
EMSCRIPTEN_KEEPALIVE int engine_place_material_layer(Engine* e, int layer, int cx, int cy, int r, int mat) {
  if ((layer != 0 && layer != 1) || !abiMaterialValid(mat)
      || !abiRadiusValid(e, r)) return 0;
  e->useLayer(layer ? &e->bg : &e->fg);
  if (layer) e->bgEnabled = true;
  int n = e->placeMaterialAt(cx, cy, r, (uint8_t)mat);
  e->useLayer(&e->fg);
  return n;
}
EMSCRIPTEN_KEEPALIVE void engine_sync_components(Engine* e) { e->useLayer(&e->fg); e->registerSeededComponents(0, e->cols); }
// One batched perf read (PF_* offsets in abi.generated.hpp) replacing the old
// 18 scalar getters — reading the timers is 1 FFI call instead of ~18.
EMSCRIPTEN_KEEPALIVE void engine_perf_snapshot(Engine* e, double* out) {
  out[PF_STEP_MS] = e->perfStepMs;
  out[PF_ACTOR_MS] = e->perfActorMs;
  out[PF_DIRTY_CHUNKS] = (double)e->perfDirtyChunks;
  out[PF_DIRTY_ROWS] = (double)e->perfDirtyRows;
  out[PF_DIRTY_CELLS] = (double)e->perfDirtyCells;
  out[PF_COMPONENT_COUNT] = (double)e->perfComponentCount;
  out[PF_COMPONENT_CELL_COUNT] = (double)e->perfComponentCellCount;
  out[PF_CROSS_BOND_COUNT] = (double)e->perfCrossBondCount;
  out[PF_LIGHT_MS] = e->perfLightMs;
  out[PF_FILL_MS] = e->perfFillMs;
  out[PF_UPLOAD_MS] = e->perfUploadMs;
  out[PF_SHIFT_SAVE] = e->perfShiftSave;
  out[PF_SHIFT_BUFFERS] = e->perfShiftBuffers;
  out[PF_SHIFT_TRANSLATE] = e->perfShiftTranslate;
  out[PF_SHIFT_REGISTER] = e->perfShiftRegister;
  out[PF_SHIFT_FILL] = e->perfShiftFill;
  out[PF_FORCE_PREPARE_MS] = e->perfForcePrepareMs;
  out[PF_FORCE_WAKE_MS] = e->perfForceWakeMs;
  out[PF_GROUNDING_MS] = e->perfGroundingMs;
  out[PF_CROSS_LAYER_GROUNDING_MS] = e->perfCrossLayerGroundingMs;
  out[PF_COMPONENT_INDEX_MS] = e->perfComponentIndexMs;
  out[PF_ASSEMBLY_UNION_MS] = e->perfAssemblyUnionMs;
  out[PF_CARRY_MS] = e->perfCarryMs;
  out[PF_BODY_MS] = e->perfBodyMs;
  out[PF_SAND_MS] = e->perfSandMs;
  out[PF_LIQUID_MS] = e->perfLiquidMs;
  out[PF_GAS_MS] = e->perfGasMs;
  out[PF_REACT_MS] = e->perfReactMs;
  out[PF_TAIL_MS] = e->perfTailMs;
  out[PF_LIQUID_RELAX_MS] = e->perfLiquidRelaxMs;
  out[PF_LIQUID_SURFACE_MS] = e->perfLiquidSurfaceMs;
  out[PF_LAYERS_MS] = e->perfLayersMs;
  out[PF_CROSS_MS] = e->perfCrossMs;
}
EMSCRIPTEN_KEEPALIVE int engine_tick(Engine* e) { return e->tick; }
EMSCRIPTEN_KEEPALIVE int engine_actor_tick(Engine* e) { return e->actorTick; }
EMSCRIPTEN_KEEPALIVE void engine_set_actor_tick(Engine* e, int tick) { e->actorTick = tick < 0 ? 0 : tick; }
// Incremental-grounding controls (testing/diagnostics). verify=1 runs the fast path
// AND a full reflood every step and counts mismatches; forceFull=1 always refloods
// (the byte-identical reference for the checksum test).
EMSCRIPTEN_KEEPALIVE void engine_test_set_grounding_debug(Engine* e, int verify, int forceFull) { e->comps.groundVerify = verify != 0; e->comps.groundForceFull = forceFull != 0; }
EMSCRIPTEN_KEEPALIVE double engine_test_grounding_mismatches(Engine* e) { return (double)e->comps.groundMismatches; }
EMSCRIPTEN_KEEPALIVE double engine_test_grounding_diag(Engine* e, int which) {
  return which == 0 ? (double)e->comps.gbFast : which == 1 ? (double)e->comps.gbEdge
    : which == 2 ? (double)e->comps.gbPowder : which == 3 ? (double)e->comps.gbCut
    : which == 4 ? (double)e->comps.gbSpan : which == 5 ? (double)e->comps.gbCutCap
    : (double)e->comps.gbCutOpen;
}

// drafts / seed
// One material-parameterized draft set; ice excludes the bottom row.
EMSCRIPTEN_KEEPALIVE int engine_add_draft(Engine* e, int cx, int cy, int r, int mat) {
  if (!abiMaterialValid(mat) || !abiRadiusValid(e, r)) return 0;
  e->tools.draftMaterial = (uint8_t)mat;
  return e->addDiscToDraft(e->tools.draft, cx, cy, r, mat == ICE ? e->rows - 1 : e->rows);
}
EMSCRIPTEN_KEEPALIVE void engine_finalize_draft(Engine* e, int mat) {
  if (!abiMaterialValid(mat)) return;
  e->tools.draftMaterial = (uint8_t)mat;
  e->finalizeDraft();
  e->tools.draft.clear();
  e->tools.draftStrokeActive = false;
}
EMSCRIPTEN_KEEPALIVE int engine_draft_snapshot(Engine* e) { e->tools.draftSnapshot.assign(e->tools.draft.begin(), e->tools.draft.end()); return (int)e->tools.draftSnapshot.size(); }
EMSCRIPTEN_KEEPALIVE int* engine_draft_ptr(Engine* e) { return e->tools.draftSnapshot.data(); }
// Creative palette: select any material / seed species / eraser / cube (CreativeKind).
EMSCRIPTEN_KEEPALIVE void engine_set_creative_material(Engine* e, int kind, int value) { e->setCreativeMaterial(kind, value); }
EMSCRIPTEN_KEEPALIVE int engine_get_seed_origin(Engine* e, int cx, int cy, int* out) { int x0, y0; if (!e->getSeedOrigin(cx, cy, x0, y0)) return 0; out[0] = x0; out[1] = y0; return 1; }
EMSCRIPTEN_KEEPALIVE int engine_place_seed(Engine* e, int x0, int y0) { return e->placeSeedAt(x0, y0) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_place_seed_typed(Engine* e, int x0, int y0, int pt) { return e->placeSeedAtTyped(x0, y0, (uint8_t)pt) ? 1 : 0; }

// Cell-space tool helpers used by tests and compatibility callers.
EMSCRIPTEN_KEEPALIVE void engine_set_tool(Engine* e, int tool) { e->setTool(tool); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_down(Engine* e, int cx, int cy, int button) { return e->pointerDown(cx, cy, button); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_draft(Engine* e, int cx, int cy) { return e->pointerDraft(cx, cy); }
EMSCRIPTEN_KEEPALIVE void engine_pointer_buttons(Engine* e, int buttons) { e->pointerButtons(buttons); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_up(Engine* e, int button) { return e->pointerUp(button); }
EMSCRIPTEN_KEEPALIVE int engine_apply_tool(Engine* e, int cx, int cy, double now, int inside, int drawMode) { return e->applyTool(cx, cy, now, inside != 0, drawMode != 0); }
EMSCRIPTEN_KEEPALIVE int engine_seed_draft(Engine* e, int* out) {
  if (!e->tools.draftingSeed || !e->tools.hasSeedOrigin) return 0;
  out[0] = e->tools.seedOriginX; out[1] = e->tools.seedOriginY; out[2] = e->canPlaceSeedAt(e->tools.seedOriginX, e->tools.seedOriginY) ? 1 : 0;
  return 1;
}

// free rigid bodies
EMSCRIPTEN_KEEPALIVE void engine_spawn_body(Engine* e, int* xy, int count) {
  if (!e || !xy || count <= 0 || count > e->cols * e->rows) return;
  std::vector<std::pair<int, int>> cells; cells.reserve(count);
  for (int i = 0; i < count; i++) {
    int x = xy[i * 2], y = xy[i * 2 + 1];
    if (!e->isInBounds(x, y)) return;
    cells.push_back({x, y});
  }
  e->spawnBody(cells);
}
EMSCRIPTEN_KEEPALIVE void engine_spawn_box(Engine* e, int cx, int cy, int halfW, int halfH, int material) {
  if (!abiMaterialValid(material)
      || !abiHalfExtentsValid(e, halfW, halfH)) return;
  e->useLayer(&e->fg);
  e->spawnBox(cx, cy, halfW, halfH, (uint8_t)material);
}
EMSCRIPTEN_KEEPALIVE void engine_spawn_disc(Engine* e, int cx, int cy, int radius, int material) {
  if (!abiMaterialValid(material) || !abiRadiusValid(e, radius)) return;
  e->useLayer(&e->fg);
  e->spawnDisc(cx, cy, radius, (uint8_t)material);
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_count(Engine* e) { return (int)e->fg.bodies.size(); }
EMSCRIPTEN_KEEPALIVE int engine_test_world_dirty_tile_count(Engine* e) {
  return (int)(e->fg.dirtyWorldTiles.size() + e->bg.dirtyWorldTiles.size());
}
EMSCRIPTEN_KEEPALIVE int engine_test_component_state_count(Engine* e, int layer) {
  Layer& lay = layer ? e->bg : e->fg;
  return (int)lay.componentStateStore.size();
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_blocked(Engine* e, int i) { e->useLayer(&e->fg); return (i >= 0 && i < (int)e->fg.bodies.size()) ? e->bodyFootprintBlocked(e->fg.bodies[i]) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_terrain_blocked(Engine* e, int i) { e->useLayer(&e->fg); return (i >= 0 && i < (int)e->fg.bodies.size()) ? e->bodyTerrainBlocked(e->fg.bodies[i]) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_blocked_layer(
    Engine* e, int layer, int i) {
  Layer& lay = layer ? e->bg : e->fg;
  Engine::ActiveLayerScope layerScope(*e, &lay);
  return i >= 0 && i < (int)lay.bodies.size()
    ? e->bodyFootprintBlocked(lay.bodies[i]) : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_terrain_blocked_layer(
    Engine* e, int layer, int i) {
  Layer& lay = layer ? e->bg : e->fg;
  Engine::ActiveLayerScope layerScope(*e, &lay);
  return i >= 0 && i < (int)lay.bodies.size()
    ? e->bodyTerrainBlocked(lay.bodies[i]) : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_awake(Engine* e, int i) { return (i >= 0 && i < (int)e->fg.bodies.size()) ? (e->fg.bodies[i]->awake ? 1 : 0) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_awake_layer(
    Engine* e, int layer, int i) {
  Layer& lay = layer ? e->bg : e->fg;
  return i >= 0 && i < (int)lay.bodies.size()
    ? (lay.bodies[i]->awake ? 1 : 0) : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_force_diag(Engine* e, int metric) {
  return e->forces.debugMetric(metric);
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_material(Engine* e, int i) { return (i >= 0 && i < (int)e->fg.bodies.size()) ? e->fg.bodies[i]->material : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_child_count(Engine* e, int i) {
  return (i >= 0 && i < (int)e->fg.bodies.size())
    ? (int)e->fg.bodies[i]->collisionRects.size() : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_blast_debris(Engine* e, int i) { return (i >= 0 && i < (int)e->fg.bodies.size()) ? (e->fg.bodies[i]->blastDebris ? 1 : 0) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_count_layer(Engine* e, int layer) {
  return (int)(layer ? e->bg : e->fg).bodies.size();
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_id_layer(Engine* e, int layer, int i) {
  Layer& lay = layer ? e->bg : e->fg;
  return (i >= 0 && i < (int)lay.bodies.size()) ? lay.bodies[i]->id : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_blast_debris_layer(Engine* e, int layer, int i) {
  Layer& lay = layer ? e->bg : e->fg;
  return (i >= 0 && i < (int)lay.bodies.size()) ? (lay.bodies[i]->blastDebris ? 1 : 0) : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_joint_role_layer(Engine* e, int layer, int i) {
  Layer& lay = layer ? e->bg : e->fg;
  return (i >= 0 && i < (int)lay.bodies.size()) ? lay.bodies[i]->jointRole : -1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_body_state_layer(Engine* e, int layer, int i, double* out) {
  Layer& lay = layer ? e->bg : e->fg;
  if (i < 0 || i >= (int)lay.bodies.size()) return 0;
  Body* b = lay.bodies[i];
  out[0] = b->px; out[1] = b->py; out[2] = b->angle; out[3] = b->vx;
  out[4] = b->vy; out[5] = b->omega; out[6] = b->nPts; out[7] = b->maxR;
  out[8] = b->invMass; out[9] = b->invInertia;
  out[10] = b->pvx; out[11] = b->pvy; out[12] = b->pw;
  return 1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_spawn_box_layer(
    Engine* e, int layer, int cx, int cy, int halfW, int halfH, int material) {
  if ((layer != 0 && layer != 1) || !abiMaterialValid(material)
      || !abiHalfExtentsValid(e, halfW, halfH)) return -1;
  e->useLayer(layer ? &e->bg : &e->fg);
  Body* body = e->spawnBox(cx, cy, halfW, halfH, (uint8_t)material);
  e->useLayer(&e->fg);
  return body ? body->id : -1;
}
EMSCRIPTEN_KEEPALIVE uint8_t* engine_test_grounded_ptr(Engine* e, int layer) {
  Layer& lay = layer ? e->bg : e->fg;
  return lay.groundedCell.data();
}
EMSCRIPTEN_KEEPALIVE int32_t* engine_test_body_owner_ptr(Engine* e, int layer) {
  Layer& lay = layer ? e->bg : e->fg;
  return lay.bodyOwner.data();
}
EMSCRIPTEN_KEEPALIVE uint8_t* engine_test_fall_speed_ptr(Engine* e, int layer) {
  Layer& lay = layer ? e->bg : e->fg;
  return lay.fallSpeed;
}
EMSCRIPTEN_KEEPALIVE uint32_t* engine_test_liquid_velocity_ptr(
    Engine* e, int layer) {
  Layer& lay = layer ? e->bg : e->fg;
  return lay.liquidVel;
}
EMSCRIPTEN_KEEPALIVE void engine_test_reset_topology(Engine* e) {
  auto reset = [&](Layer& lay) {
    for (Body* body : lay.bodies) delete body;
    lay.bodies.clear();
    lay.bodyCells.clear();
    lay.passiveBodyCells.clear();
    lay.passiveBodyIds.clear();
    lay.components.clear();
    lay.growingPlantComponents.clear();
    lay.myceliumComponents.clear();
    lay.iceComponents.clear();
    lay.mobileComponents.clear();
    lay.componentRegistryDirty = true;
    lay.componentCarryDirty = true;
    lay.componentIndexPatchOnly = false;
    lay.componentIndexPatches.clear();
    lay.prevCompCells.clear();
    lay.curCompCells.clear();
    lay.prevBodyCells.clear();
    lay.curBodyCells.clear();
    lay.pendingDetonations.clear();
    lay.fuseStore.clear();
    lay.componentStore.clear();
    lay.componentStateStore.clear();
    lay.componentFragmentRefs.clear();
    lay.componentStateGcCandidates.clear();
    std::fill(lay.bodyOwner.begin(), lay.bodyOwner.end(), -1);
    lay.nextComponentId = lay.nextBodyId = 1;
    lay.myceliumActive = false;
    lay.myceliumSporePresent = false;
    lay.groundDirty = lay.groundContentDirty = lay.looseGroundDirty = true;
    lay.sleepingBodySupportDirty = false;
    lay.groundBaseValid = false;
  };
  reset(e->fg);
  reset(e->bg);
  e->itemStore.clear(); e->projectileStore.clear();
  e->storedItemCount = e->storedProjectileCount = 0;
  e->rigid.clearContactCaches();
  e->comps.jointSupportValid = false;
  e->comps.jointSupportSleeping = false;
  e->comps.jointDirty = true;
  e->useLayer(&e->fg);
}
EMSCRIPTEN_KEEPALIVE void engine_test_drop_joint_bond_cache(Engine* e) {
  e->comps.computeGroundedBoth();
  e->fg.crossBondedComp.assign(e->fg.components.size(), 0);
  e->bg.crossBondedComp.assign(e->bg.components.size(), 0);
  e->comps.cgBonds.clear();
  e->comps.jointDirty = false;
  e->comps.jointBondsInvalid = false;
  e->comps.jointDirtyDeferred = false;
  e->useLayer(&e->fg);
}
EMSCRIPTEN_KEEPALIVE int engine_test_set_body_blast_debris(Engine* e, int i, int enabled) {
  if (i < 0 || i >= (int)e->fg.bodies.size()) return 0;
  e->fg.bodies[i]->blastDebris = enabled != 0;
  return 1;
}
EMSCRIPTEN_KEEPALIVE void engine_test_detonate_tnt(Engine* e, int cx, int cy) {
  e->useLayer(&e->fg);
  e->detonate(cx, cy, ExplosivesSystem::TNT_BLAST_RADIUS, ExplosivesSystem::TNT_BLAST_POWER);
}
EMSCRIPTEN_KEEPALIVE int engine_test_apply_blast_impulse(
    Engine* e, int bodyIndex, int cx, int cy, int radius, double power) {
  if (bodyIndex < 0 || bodyIndex >= (int)e->fg.bodies.size()) return 0;
  e->useLayer(&e->fg);
  return e->explosives.applyBlastImpulse(
    e->fg.bodies[bodyIndex], cx, cy, radius, power) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_test_damage_player(Engine* e, int id, int damage,
                                                   double sourceX, double sourceY) {
  Player* p = e->findPlayer(id);
  return p ? e->psys.damagePlayer(*p, damage, 1, sourceX, sourceY) : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_test_collect_dynamic_lights(Engine* e) {
  e->glp.glCollectDynamicLights();
  return (int)e->renderer.dynamicLights.size();
}
// Read continuous body state for tests/tools:
// [px,py,angle,vx,vy,omega,nPts,maxR,invMass,invInertia,
//  pvx,pvy,pw].
EMSCRIPTEN_KEEPALIVE int engine_test_body_state(Engine* e, int i, double* out) {
  if (i < 0 || i >= (int)e->fg.bodies.size()) return 0;
  Body* b = e->fg.bodies[i];
  out[0] = b->px; out[1] = b->py; out[2] = b->angle; out[3] = b->vx;
  out[4] = b->vy; out[5] = b->omega; out[6] = b->nPts; out[7] = b->maxR;
  out[8] = b->invMass; out[9] = b->invInertia;
  out[10] = b->pvx; out[11] = b->pvy; out[12] = b->pw;
  return 1;
}
// Set continuous body motion (test/tool hook): wakes the body.
EMSCRIPTEN_KEEPALIVE int engine_test_set_body_motion(Engine* e, int i, double vx, double vy, double omega) {
  if (i < 0 || i >= (int)e->fg.bodies.size()) return 0;
  Body* b = e->fg.bodies[i];
  b->vx = vx; b->vy = vy; b->omega = omega; b->awake = true;
  e->rigid.resetSleepTracking(b);
  if (b->jointRole == 1) e->rigid.syncJointFollower(b);
  e->useLayer(&e->fg);
  int x = (int)std::lround(b->px), y = (int)std::lround(b->py);
  if (x >= 0 && x < e->cols && y >= 0 && y < e->rows)
    e->markCellIndex(y * e->cols + x);
  return 1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_freeze_body_cell(
    Engine* e, int sourceLayer, int bodyIndex, int targetLayer, int x, int y) {
  Layer& source = sourceLayer ? e->bg : e->fg;
  Layer& target = targetLayer ? e->bg : e->fg;
  if (bodyIndex < 0 || bodyIndex >= (int)source.bodies.size()
      || x < 0 || x >= e->cols || y < 0 || y >= e->rows) return 0;
  int bodyId = source.bodies[bodyIndex]->id;
  std::vector<int> cells{y * e->cols + x};
  e->rigid.freezeCellsOntoBody(source, bodyId, target, cells);
  e->useLayer(&e->fg);
  return 1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_set_liquid_velocity(
    Engine* e, int layer, int x, int y, double vx, double vy) {
  if (x < 0 || x >= e->cols || y < 0 || y >= e->rows) return 0;
  Layer& lay = layer ? e->bg : e->fg;
  int k = y * e->cols + x;
  if (!e->isLiquidMaterial(lay.grid[k])) return 0;
  uint32_t velocity = e->packedLiquidVelocity(vx, vy);
  lay.liquidVel[k] = velocity;
  lay.nextLiquidVel[k] = velocity;
  lay.sleepingBodySupportDirty = true;
  Engine::ActiveLayerScope layerScope(*e, &lay);
  e->markCellIndex(k);
  return 1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_rigid_rejected(Engine* e) { return e->rigid.rigidRejectedCells; }
EMSCRIPTEN_KEEPALIVE int engine_test_rigid_depen(Engine* e) { return e->rigid.rigidDepenetrations; }
EMSCRIPTEN_KEEPALIVE double engine_test_rigid_solver_diag(Engine* e, int field) {
  switch (field) {
    case 0: return e->rigid.rigidSubsteps;
    case 1: return e->rigid.rigidContacts;
    case 2: return e->rigid.rigidWarmStarted;
    case 3: return e->rigid.rigidVelocityIterations;
    case 4: return e->rigid.rigidBiasIterations;
    case 5: return e->rigid.rigidMaxContactDepth;
    case 6: return e->rigid.rigidIslands;
    case 7: return e->rigid.rigidBlockSolves;
    case 8: return e->rigid.rigidIslandBodySteps;
    case 9: return e->rigid.rigidGlobalBodySteps;
    case 10: return e->rigid.rigidChildPairs;
    case 11: return e->rigid.rigidChildManifolds;
    case 12: return e->rigid.rigidSweepFallbacks;
    case 13: return e->rigid.rigidMaxChildren;
    case 14: return e->rigid.fluidNodeCount;
    case 15: return e->rigid.fluidFaceCount;
    case 16: return e->rigid.fluidPressureIterations;
    case 17: return e->rigid.rigidSpillDisplaced;
    case 18: return e->rigid.rigidSpillVisits;
    case 19: return e->rigid.rigidSpillSearches;
    case 20: return e->rigid.fluidCorrectorPasses;
    case 21: return e->rigid.fluidInitialMs;
    case 22: return e->rigid.fluidCorrectorMs;
    case 23: return e->rigid.rigidCoreMs;
    case 24: return e->rigid.rigidClearMs;
    case 25: return e->rigid.rigidDepenMs;
    case 26: return e->rigid.rigidStampMs;
    case 27: return e->rigid.rigidSpillMs;
    case 28: return e->rigid.fluidCorrectorBodyCount;
    case 29: return e->rigid.fluidReferenceMs;
    case 30: return e->rigid.fluidDomainMs;
    case 31: return e->rigid.fluidMatrixMs;
    case 32: return e->rigid.fluidSolveMs;
    case 33: return e->rigid.fluidWritebackMs;
    case 34: return e->rigid.rigidCoherentIslands;
    case 35: return e->rigid.rigidDenseFallbackIslands;
    case 36: return e->rigid.rigidMaxRelativeSpeed;
    case 37: return e->rigid.rigidTerrainRiskBodies;
    case 38: return e->rigid.rigidImpactRiskBodies;
    case 39: return e->rigid.rigidOwnershipConflicts;
    case 40: return e->rigid.rigidPositionCorrections;
    case 41: return e->rigid.rigidRecoveryBodies;
    case 42: return e->rigid.rigidChildTransforms;
    case 43: return e->rigid.rigidVelocityConstraintEvals;
    case 44: return e->rigid.rigidBiasConstraintEvals;
    case 45: return e->rigid.rigidMaxVelocityResidual;
    case 46: return e->rigid.rigidMaxBiasResidual;
    case 47: return e->rigid.rigidMaxPenetrationResidual;
    case 48: return e->rigid.rigidShockIslands;
    case 49: return e->rigid.rigidShockConstraintEvals;
    case 50: return e->rigid.rigidShockFallbacks;
    case 51: return e->rigid.rigidShockMaxLayers;
    case 52: return e->rigid.rigidShockSkipped;
    case 53: return e->rigid.rigidPrepareMs;
    case 54: return e->rigid.rigidFinalizeMs;
    case 55: return e->rigid.rigidContactMs;
    case 56: return e->rigid.rigidSolveMs;
    case 57: return e->rigid.rigidPairContactMs;
    case 58: return e->rigid.rigidTerrainContactMs;
    case 59: return e->rigid.rigidTerrainSamples;
    case 60: return e->rigid.rigidTerrainSamplesSkipped;
    case 61: return e->rigid.rigidGranularBodiesSkipped;
    case 62: return e->rigid.rigidMotionPrepMs;
    case 63: return e->rigid.rigidIntegrateMs;
    case 64: return e->rigid.rigidStepPrepareMs;
    case 65: return e->rigid.rigidContactSetupMs;
    case 66: return e->rigid.rigidStepFinalizeMs;
    case 67: return e->rigid.rigidOccupancyBuildMs;
    case 68: return e->rigid.rigidCadenceMs;
    case 69: return e->rigid.rigidFluidCoupleMs;
    case 70: return e->rigid.rigidFluidReferenceTotalMs;
    case 71: return e->rigid.rigidFluidDomainTotalMs;
    case 72: return e->rigid.rigidFluidMatrixTotalMs;
    case 73: return e->rigid.rigidFluidSolveTotalMs;
    case 74: return e->rigid.rigidFluidWritebackTotalMs;
    case 75: return e->rigid.rigidFluidNodesTotal;
    case 76: return e->rigid.rigidFluidFacesTotal;
    case 77: return e->rigid.rigidFluidIterationsTotal;
    case 78: return e->rigid.rigidFluidDryReferencesSkipped;
    case 79: return e->rigid.rigidBakeMs;
    case 80: return e->rigid.rigidBakedCells;
    case 81: return e->rigid.rigidBakeSupportMs;
    case 82: return e->rigid.rigidBakeRasterMs;
    case 83: return e->rigid.rigidBakeRegisterMs;
    case 84: return e->rigid.rigidRasterCorrections;
    case 85: return e->rigid.rigidRasterProjectionFailures;
    case 86: return e->rigid.rigidRasterMaxCorrection;
    default: return 0;
  }
}
EMSCRIPTEN_KEEPALIVE void engine_test_set_rigid_solver_options(
    Engine* e, int mode, double residualTolerance, int minIterations) {
  e->rigid.solverMode = mode;
  e->rigid.solverResidualTolerance = std::fmax(0.0, residualTolerance);
  e->rigid.solverMinIterations = imax(1, minIterations);
}
EMSCRIPTEN_KEEPALIVE void engine_test_set_rigid_force_full_solve_bodies(
    Engine* e, int bodyCount) {
  e->rigid.forceFullSolveBodies = imax(1, bodyCount);
}
// Synthetic spill probe for outlet-locality regression tests. The rectangle is
// stamped as one body and `source` is treated as loose material displaced from
// inside it; return the selected exterior target index.
EMSCRIPTEN_KEEPALIVE int engine_test_rigid_spill_probe(Engine* e, int sourceX, int sourceY,
                                                       int x0, int y0, int x1, int y1, int material) {
  e->useLayer(&e->fg);
  if (!abiMaterialValid(material) || !e->isInBounds(sourceX, sourceY) || x0 < 1 || y0 < 1 || x1 >= e->cols - 1 || y1 >= e->rows ||
      sourceX < x0 || sourceX > x1 || sourceY < y0 || sourceY > y1) return -1;
  const int bodyId = INT_MAX;
  e->fg.reserveSeenGenerations(RigidBodySystem::SPILL_GENERATION_BUDGET);
  const int32_t footprintGen = e->fg.nextSeenGeneration();
  std::vector<int> footprint;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    int k = y * e->cols + x;
    e->writeGridIndex(k, RIGID);
    e->fg.bodyOwner[k] = bodyId;
    e->fg.rigidSpillFootprint[k] = footprintGen;
    footprint.push_back(k);
  }
  std::vector<Disp> displaced{{(uint8_t)material, sourceY * e->cols + sourceX}};
  e->rigid.spillDisplacedBodyMaterial(displaced, footprint, footprintGen, bodyId, DENSITY[RIGID]);
  for (int k = 0; k < e->cols * e->rows; k++) {
    int y = k / e->cols, x = k - y * e->cols;
    if ((x < x0 || x > x1 || y < y0 || y > y1) && e->fg.grid[k] == material) return k;
  }
  return -1;
}

// players (Terraria-like characters; physics in player.inc)
EMSCRIPTEN_KEEPALIVE int engine_spawn_player(Engine* e, double x, double y) { return e->spawnPlayer(x, y); }
EMSCRIPTEN_KEEPALIVE int engine_spawn_player_surface(Engine* e, int col) { return e->spawnPlayerAtSurface(col); }
EMSCRIPTEN_KEEPALIVE void engine_player_surface_spawn(Engine* e, int col, double* out) { e->playerSurfaceSpawn(col, out); }
EMSCRIPTEN_KEEPALIVE int engine_player_width() { return PLAYER_W; }
EMSCRIPTEN_KEEPALIVE int engine_player_height() { return PLAYER_H; }
EMSCRIPTEN_KEEPALIVE void engine_remove_player(Engine* e, int id) { e->removePlayer(id); }
EMSCRIPTEN_KEEPALIVE void engine_set_player_input(Engine* e, int id, int inputBits, double aimX, double aimY, int selectedTool, int seq, double moveX, double moveY) {
  e->setPlayerInput(id, inputBits, aimX, aimY, selectedTool, (uint32_t)seq, moveX, moveY);
}
EMSCRIPTEN_KEEPALIVE int engine_player_count(Engine* e) { return (int)e->psys.players.size(); }
EMSCRIPTEN_KEEPALIVE int engine_player_snapshot(Engine* e) { return e->psys.buildPlayerSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_player_snapshot_ptr(Engine* e) { return e->psys.snapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_player_action_count(Engine* e) { return e->playerActionCount; }
EMSCRIPTEN_KEEPALIVE void engine_step_player_only(Engine* e, int id) { e->stepPlayerOnly(id); }
// Held mining tool (class/tier) — drives drop gating. Set directly here for tests;
// the inventory sets it from the selected slot in normal play.
EMSCRIPTEN_KEEPALIVE void engine_set_player_tool(Engine* e, int id, int cls, int tier) { Player* p = e->findPlayer(id); if (p) { p->heldToolClass = (uint8_t)cls; p->heldToolTier = (uint8_t)tier; } }
// Mine one disc at (ax,ay) on the foreground for a player (test/gameplay hook).
EMSCRIPTEN_KEEPALIVE int engine_player_mine(Engine* e, int id, int ax, int ay) {
  Player* p = e->findPlayer(id);
  if (!p) return 0;
  return (e->survivalInventory ? e->mineFootprint(*p, ax, ay, &e->fg) : e->mineDisc(*p, ax, ay, &e->fg)) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE double engine_player_mine_progress(Engine* e, int id) { return e->playerMineProgress(id); }
// Locked hold-mine origin for HUD overlays (progress bar). Returns 1 and writes
// (mineX, mineY) into out[0..1] when the player has an active mine lock.
EMSCRIPTEN_KEEPALIVE int engine_player_mine_target(Engine* e, int id, int* out) {
  Player* p = e->findPlayer(id);
  if (!p || !p->mineActive) return 0;
  if (out) { out[0] = p->mineX; out[1] = p->mineY; }
  return 1;
}
EMSCRIPTEN_KEEPALIVE void engine_set_player_state(Engine* e, int id, double x, double y, double vx, double vy,
                                                  int facing, int grounded, int jumpReady,
                                                  double jetpackFuel, int jetpackActive) {
  e->setPlayerState(id, x, y, vx, vy, facing, grounded, jumpReady, jetpackFuel, jetpackActive);
}

// Dropped-item and particle hooks plus the packed replication/render snapshot.
EMSCRIPTEN_KEEPALIVE int engine_spawn_item(Engine* e, int mat, int count, double px, double py, double vx, double vy) {
  return abiMaterialValid(mat) ? e->spawnItem((uint8_t)mat, count, px, py, vx, vy) : -1;
}
EMSCRIPTEN_KEEPALIVE void engine_test_spawn_particle(Engine* e, int mat, double px, double py, double vx, double vy, int life) {
  if (abiMaterialValid(mat)) e->spawnParticle((uint8_t)mat, px, py, vx, vy, life);
}
EMSCRIPTEN_KEEPALIVE int engine_item_count(Engine* e) { return (int)e->itemsys.items.size(); }
EMSCRIPTEN_KEEPALIVE int engine_item_snapshot(Engine* e) { return e->itemsys.buildItemSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_item_snapshot_ptr(Engine* e) { return e->itemsys.snapshot.data(); }

// Material-aware creatures. The spawn/damage entries are intentionally small
// gameplay/test hooks; ordinary population is owned by CreatureSystem rules.
EMSCRIPTEN_KEEPALIVE int engine_spawn_creature(Engine* e, int species, double worldX, double worldY) { return e->creatures.spawnCreature((uint8_t)species, worldX, worldY); }
EMSCRIPTEN_KEEPALIVE int engine_spawn_scripted_creature(Engine* e, int species, double worldX, double worldY) {
  return e->creatures.spawnCreature((uint8_t)species, worldX, worldY, false);
}
EMSCRIPTEN_KEEPALIVE int engine_test_spawn_near_focus(Engine* e, int species, int salt) {
  if (species < 0 || species >= CS_COUNT) return 0;
  return e->creatures.spawnNearFocus((uint8_t)species, (uint32_t)salt) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_test_spawn_world_allowed(
    Engine* e, int species, double worldX, double worldY) {
  if (species < 0 || species >= CS_COUNT) return 0;
  return e->creatures.worldRuleAllows(
    (uint8_t)species, worldX, worldY) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_test_spawn_world_weight(
    Engine* e, int species, double worldX, double worldY) {
  if (species < 0 || species >= CS_COUNT) return 0;
  return e->creatures.worldSpawnWeight(
    (uint8_t)species, worldX, worldY);
}
EMSCRIPTEN_KEEPALIVE int engine_test_spawn_natural_at(
    Engine* e, int species, double worldX, double worldY) {
  if (species < 0 || species >= CS_COUNT) return 0;
  return e->creatures.spawnCreatureNatural(
    (uint8_t)species, worldX, worldY);
}
EMSCRIPTEN_KEEPALIVE int engine_test_spawn_breach_near_focus(Engine* e, int species, int salt) {
  if (species < 0 || species >= CS_COUNT) return 0;
  return e->creatures.spawnVisibleBreachNearFocus(
    (uint8_t)species, (uint32_t)salt) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_damage_creatures(Engine* e, int x, int y, int radius, int damage) {
  if (!abiRadiusValid(e, radius)) return 0;
  return e->damageCreaturesAt(x, y, radius, damage) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_creature_count(Engine* e) { return (int)e->creatures.creatures.size(); }
EMSCRIPTEN_KEEPALIVE int engine_creature_snapshot(Engine* e) { return e->creatures.buildCreatureSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_creature_snapshot_ptr(Engine* e) { return e->creatures.snapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_start_mission(Engine* e, int missionId, int playerId) {
  return e->missions.start(missionId, playerId) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_mission_snapshot(Engine* e) {
  return e->missions.buildMissionSnapshot();
}
EMSCRIPTEN_KEEPALIVE int32_t* engine_mission_snapshot_ptr(Engine* e) {
  return e->missions.missionSnapshot.data();
}
EMSCRIPTEN_KEEPALIVE int engine_objective_snapshot(Engine* e) {
  return e->missions.buildObjectiveSnapshot();
}
EMSCRIPTEN_KEEPALIVE int32_t* engine_objective_snapshot_ptr(Engine* e) {
  return e->missions.objectiveSnapshot.data();
}
EMSCRIPTEN_KEEPALIVE int engine_projectile_snapshot(Engine* e) { return e->projectiles.buildSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_projectile_snapshot_ptr(Engine* e) { return e->projectiles.snapshot.data(); }
EMSCRIPTEN_KEEPALIVE void engine_set_mirror_creatures(Engine* e, float* data, int count, int sourceOffsetX, int sourceOffsetY) {
  e->creatures.creatures.clear();
  e->creatures.creatures.reserve(imax(0, count));
  for (int i = 0; i < count; i++) {
    const float* in = data + i * CSN_STRIDE;
    int species = (int)in[CSN_SPECIES]; if (species < 0 || species >= CS_COUNT) continue;
    Creature c;
    c.id = (int)in[CSN_ID]; c.species = (uint8_t)species;
    c.wx = sourceOffsetX + in[CSN_X]; c.wy = sourceOffsetY + in[CSN_Y];
    c.vx = in[CSN_VX]; c.vy = in[CSN_VY]; c.facing = (int)in[CSN_FACING];
    c.health = (int)in[CSN_HEALTH]; c.alive = in[CSN_ALIVE] != 0; c.animFrame = (uint8_t)in[CSN_ANIM_FRAME];
    c.attackState = (uint8_t)in[CSN_ATTACK_STATE]; c.attackProgress = in[CSN_ATTACK_PROGRESS];
    c.attackPattern = (uint8_t)in[CSN_ATTACK_PATTERN];
    c.attackAimX = sourceOffsetX + in[CSN_AIM_X]; c.attackAimY = sourceOffsetY + in[CSN_AIM_Y];
    c.spawnProgress = in[CSN_SPAWN_PROGRESS];
    e->creatures.creatures.push_back(c);
  }
}

// survival inventory (inventory.inc): authoritative per-player stacks. JS reads the
// snapshot for the HUD and forwards slot-select / move / place intents.
EMSCRIPTEN_KEEPALIVE void engine_set_survival_inventory(Engine* e, int on) { e->survivalInventory = on != 0; }
EMSCRIPTEN_KEEPALIVE void engine_set_creature_runtime(Engine* e, int simulate, int naturalSpawn) {
  e->creaturesEnabled = simulate != 0;
  e->creatureNaturalSpawning = e->creaturesEnabled && naturalSpawn != 0;
}
EMSCRIPTEN_KEEPALIVE void engine_seed_starter_tools(Engine* e, int id) { e->seedStarterTools(id); }
EMSCRIPTEN_KEEPALIVE int engine_add_to_inventory(Engine* e, int id, int mat, int count) {
  return abiMaterialValid(mat) && e->addToInventory(id, (uint8_t)mat, count) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int engine_add_special_item(Engine* e, int id, int itemKind, int count) {
  return e->inv.addSpecialItem(id, (uint8_t)itemKind, count) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE void engine_set_selected_slot(Engine* e, int id, int slot) { e->setSelectedSlot(id, slot); }
EMSCRIPTEN_KEEPALIVE void engine_cycle_selected_slot(Engine* e, int id, int delta) { e->cycleSelectedSlot(id, delta); }
EMSCRIPTEN_KEEPALIVE void engine_set_selected_footprint(Engine* e, int id, int footprintId) { e->setSelectedFootprint(id, footprintId); }
EMSCRIPTEN_KEEPALIVE int engine_selected_footprint(Engine* e, int id) { return e->selectedFootprintId(id); }
EMSCRIPTEN_KEEPALIVE int engine_survival_footprint_snapshot(Engine* e) { return e->buildSurvivalFootprintSnapshot(); }
EMSCRIPTEN_KEEPALIVE int32_t* engine_survival_footprint_snapshot_ptr(Engine* e) { return e->tools.survivalFootprintSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE void engine_inventory_move(Engine* e, int id, int from, int to) { e->moveSlot(id, from, to); }
EMSCRIPTEN_KEEPALIVE int engine_place_from_selected(Engine* e, int id, int ax, int ay) { return e->placeFromSelected(id, ax, ay) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_inventory_snapshot(Engine* e, int id) { return e->buildInventorySnapshot(id); }
EMSCRIPTEN_KEEPALIVE float* engine_inventory_snapshot_ptr(Engine* e) { return e->inv.invSnapshot.data(); }
// Minecraft cursor model: pick/place/half + throw-out + the carried-stack snapshot.
EMSCRIPTEN_KEEPALIVE void engine_inventory_cursor_pick(Engine* e, int id, int slot, int half) { e->cursorPick(id, slot, half); }
EMSCRIPTEN_KEEPALIVE int engine_inventory_throw_from_cursor(Engine* e, int id, int whole) { return e->throwFromCursor(id, whole) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_cursor_snapshot(Engine* e, int id) { return e->buildCursorSnapshot(id); }
EMSCRIPTEN_KEEPALIVE float* engine_cursor_snapshot_ptr(Engine* e) { return e->inv.cursorSnap.data(); }
EMSCRIPTEN_KEEPALIVE int engine_craft_recipe(Engine* e, int playerId, int recipeId, int craftMax) { return e->craftRecipe(playerId, recipeId, craftMax != 0); }
EMSCRIPTEN_KEEPALIVE int engine_crafting_recipe_snapshot(Engine* e) { return e->crafting.buildRecipeSnapshot(); }
EMSCRIPTEN_KEEPALIVE int32_t* engine_crafting_recipe_snapshot_ptr(Engine* e) { return e->crafting.recipeSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_crafting_ingredient_snapshot(Engine* e) { return e->crafting.buildIngredientSnapshot(); }
EMSCRIPTEN_KEEPALIVE int32_t* engine_crafting_ingredient_snapshot_ptr(Engine* e) { return e->crafting.ingredientSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_respawn_player(Engine* e, int playerId) { return e->psys.requestRespawn(playerId) ? 1 : 0; }

// World replication: serialize/apply full snapshots and dirty diffs.
EMSCRIPTEN_KEEPALIVE int engine_serialize_world(Engine* e) { return e->net.serializeWorld(); }
EMSCRIPTEN_KEEPALIVE int engine_serialize_diff(Engine* e) { return e->net.serializeDiff(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_net_blob_ptr(Engine* e) { return e->net.blob.data(); }
EMSCRIPTEN_KEEPALIVE int engine_apply_world(Engine* e, uint8_t* buf, int len) { return e->net.applyWorld(buf, len) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_apply_diff(Engine* e, uint8_t* buf, int len) { return e->net.applyDiff(buf, len) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_apply_world_mirror(Engine* e, uint8_t* buf, int len) { return e->net.applyWorldMirror(buf, len) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_apply_diff_mirror(Engine* e, uint8_t* buf, int len,
                                                   int lightEditX0, int lightEditX1) {
  return e->net.applyDiffMirror(buf, len, lightEditX0, lightEditX1) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE void engine_set_mirror_world_offset(Engine* e, int x, int y) {
  e->fg.worldOffsetX = e->bg.worldOffsetX = x;
  e->fg.worldOffsetY = e->bg.worldOffsetY = y;
  // Keep skyOffset*/skyDown/skyWorldReachY at their previous absolute anchor;
  // the next mirror lighting solve uses them to remap off-screen sky shafts.
  e->fg.skyDirty = e->bg.skyDirty = true;
}
EMSCRIPTEN_KEEPALIVE void engine_set_mirror_world_tick(Engine* e, int tick) { e->tick = tick; }
EMSCRIPTEN_KEEPALIVE void engine_set_mirror_draft(Engine* e, int* cells, int count, int material) {
  if (!e || !abiMaterialValid(material) || count < 0
      || count > e->cols * e->rows || (count > 0 && !cells)) return;
  e->tools.draft.clear();
  for (int i = 0; i < count; i++) {
    int k = cells[i];
    if (k >= 0 && k < e->cols * e->rows) e->tools.draft.insert(k);
  }
  e->tools.draftMaterial = (uint8_t)material;
}
EMSCRIPTEN_KEEPALIVE int engine_grid_hash(Engine* e) { return (int)e->net.gridHashFNV(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_all_dirty(Engine* e) { e->useLayer(&e->fg); e->clearAllDirty(); e->useLayer(&e->bg); e->clearAllDirty(); e->useLayer(&e->fg); }
// A replication consumer has copied the current dirty rectangles. Clear only
// the accumulated packet/render chunks: row scheduler marks are also the
// cellular scheduler's next-active regions and must survive until beginStepDirty().
EMSCRIPTEN_KEEPALIVE void engine_clear_replica_dirty(Engine* e) {
  memset(e->fg.dirtyRender.data(), 0, e->fg.dirtyRender.size()); e->fg.dirtyRenderCount = 0;
  memset(e->bg.dirtyRender.data(), 0, e->bg.dirtyRender.size()); e->bg.dirtyRenderCount = 0;
}
// Authority workers keep a fixed-size live simulation focus even when zoom
// requires a much larger loaded/rendered window. These calls affect scheduling
// only; the persistent and replicated grids remain unchanged.
EMSCRIPTEN_KEEPALIVE void engine_reset_simulation_activity(Engine* e, int preserveReplicaDirty) {
  auto reset = [&](Layer& lay) {
    if (preserveReplicaDirty) {
      e->useLayer(&lay);
      e->foldRowMarksToRender();
    }
    for (auto& spans : lay.rowMarkSpans) spans.clear();
    for (auto& spans : lay.simOnlyRowMarkSpans) spans.clear();
    for (auto& spans : lay.activeRowSpans) spans.clear();
    e->forces.invalidateLooseCandidateCache(&lay);
  };
  reset(e->fg);
  reset(e->bg);
  e->simulationActivityLimited = false;
  e->useLayer(&e->fg);
}
EMSCRIPTEN_KEEPALIVE void engine_activate_simulation_rect(
    Engine* e, int x0, int y0, int x1, int y1) {
  x0 = imax(0, x0); y0 = imax(0, y0);
  x1 = imin(e->cols, x1); y1 = imin(e->rows, y1);
  if (x0 >= x1 || y0 >= y1) return;
  if (x0 > 0 || y0 > 0 || x1 < e->cols || y1 < e->rows)
    e->simulationActivityLimited = true;
  for (Layer* lay : {&e->fg, &e->bg})
    for (int y = y0; y < y1; y++)
      e->markLayerSimRowSpan(lay, y, x0, x1 - 1);
}

// ---- two-layer access (background = layer 1) ----
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid_bg(Engine* e) { return e->bg.grid; }
EMSCRIPTEN_KEEPALIVE void engine_set_bg_enabled(Engine* e, int on) {
  bool enabled = on != 0;
  if (e->bgEnabled != enabled) {
    e->comps.jointSupportValid = false;
    e->comps.jointSupportSleeping = false;
    if (enabled) e->comps.jointDirty = true;
  }
  e->bgEnabled = enabled;
}
// Paint a disc into a specific layer (0=fg, 1=bg). Enables the background on bg paint.
EMSCRIPTEN_KEEPALIVE int engine_paint_disc_layer(Engine* e, int layer, int cx, int cy, int r, int mat, int ow) {
  if ((layer != 0 && layer != 1) || !abiMaterialValid(mat)
      || !abiRadiusValid(e, r)) return 0;
  e->useLayer(layer ? &e->bg : &e->fg);
  if (layer) e->bgEnabled = true;
  int n = e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0);
  e->useLayer(&e->fg);
  return n;
}
EMSCRIPTEN_KEEPALIVE int engine_erase_disc_layer(Engine* e, int layer, int cx, int cy, int r) {
  if ((layer != 0 && layer != 1) || !abiRadiusValid(e, r)) return 0;
  e->useLayer(layer ? &e->bg : &e->fg);
  if (layer) e->bgEnabled = true;
  int n = e->eraseDisc(cx, cy, r);
  e->useLayer(&e->fg);
  return n;
}
// Register structural components in a layer so raw painted solids become
// component-backed (don't flicker). 0=fg, 1=bg.
EMSCRIPTEN_KEEPALIVE void engine_sync_components_layer(Engine* e, int layer) {
  e->useLayer(layer ? &e->bg : &e->fg);
  if (layer) e->bgEnabled = true;
  e->registerSeededComponents(0, e->cols);
  e->useLayer(&e->fg);
}

// WebGL presentation (gl.inc): the engine owns the cell texture + compositing.
// JS creates the canvas, registers it as a context target, and drives one
// glRenderFrame per presented frame.
EMSCRIPTEN_KEEPALIVE int engine_gl_init(Engine* e, const char* target) { return e->glp.glInit(target); }
EMSCRIPTEN_KEEPALIVE void engine_gl_release_context(Engine* e) { e->glp.glReleaseContext(); }
EMSCRIPTEN_KEEPALIVE int engine_gl_context_count() { return sandgl::contextCount(); }
EMSCRIPTEN_KEEPALIVE int engine_gl_restore(Engine* e) { return e->glp.glRestore(); }
EMSCRIPTEN_KEEPALIVE void engine_gl_resize(Engine* e, int devW, int devH) { e->glp.glResize(devW, devH); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_flags(Engine* e, int gutterOn, int snapOff, int animationPaused) { e->glp.glSetFlags(gutterOn, snapOff, animationPaused); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_debug_hitboxes(Engine* e, int on) { e->glp.glSetDebugHitboxes(on); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_players(Engine* e, int useExternal, float* data, int count, int ownId) { e->glp.glSetPlayers(useExternal, data, count, ownId); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_survival_preview(Engine* e, int on, int footprint, int erasing, int locked, int x, int y) { e->glp.glSetSurvivalPreview(on, footprint, erasing, locked, x, y); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_items(Engine* e, int useExternal, float* data, int count) { e->glp.glSetItems(useExternal, data, count); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_creatures(Engine* e, int useExternal, float* data, int count) { e->glp.glSetCreatures(useExternal, data, count); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_projectiles(Engine* e, int useExternal, float* data, int count) { e->glp.glSetProjectiles(useExternal, data, count); }
EMSCRIPTEN_KEEPALIVE void engine_gl_shift(Engine* e, int dx) { e->glShift(dx); }
EMSCRIPTEN_KEEPALIVE int engine_gl_render_frame(Engine* e, int forceFull) { return e->glp.glRenderFrame(forceFull); }
EMSCRIPTEN_KEEPALIVE void engine_gl_get_offset(Engine* e, int* out) { e->glp.glGetOffset(out); }
EMSCRIPTEN_KEEPALIVE int engine_gl_read_pixels(Engine* e, int x, int y, int w, int h, uint8_t* out) { return e->glp.glReadback(x, y, w, h, out); }
EMSCRIPTEN_KEEPALIVE float engine_gl_actor_light(Engine* e, double x, double y, int w, int h) { return e->glp.glActorLight(x, y, w, h); }

// View camera + input policy (camera.inc): the engine owns the view + input
// semantics; JS forwards raw DOM events and drives the loop.
EMSCRIPTEN_KEEPALIVE void engine_set_viewport(Engine* e, double dpr, double cellDev, int vCols, int vRows) { e->setViewport(dpr, cellDev, vCols, vRows); }
// Grow/shrink the loaded sim window while keeping world content (tile/body stores).
EMSCRIPTEN_KEEPALIVE int engine_resize_loaded_window(Engine* e, int newCols, int newRows) {
  return e ? e->resizeLoadedWindow(newCols, newRows) : 0;
}
EMSCRIPTEN_KEEPALIVE void engine_camera_set(Engine* e, double x, double y) { e->cameraSet(x, y); }
EMSCRIPTEN_KEEPALIVE void engine_camera_get(Engine* e, double* out) { out[0] = e->cam.camX; out[1] = e->cam.camY; }
EMSCRIPTEN_KEEPALIVE int engine_camera_col_x(Engine* e) { return e->cameraColX(); }
EMSCRIPTEN_KEEPALIVE void engine_camera_pan_tick(Engine* e) { e->cameraPanTick(); }
EMSCRIPTEN_KEEPALIVE void engine_camera_follow_to(Engine* e, double cx, double cy) { e->cameraFollowTo(cx, cy); }
EMSCRIPTEN_KEEPALIVE int engine_stream_world(Engine* e) { return e->streamWorld(); }
EMSCRIPTEN_KEEPALIVE void engine_input_key(Engine* e, int code, int down) { e->inputKey(code, down); }
EMSCRIPTEN_KEEPALIVE void engine_input_clear_keys(Engine* e) { e->inputClearKeys(); }
EMSCRIPTEN_KEEPALIVE void engine_input_stick(Engine* e, double x, double y) { e->inputStick(x, y); }
EMSCRIPTEN_KEEPALIVE int engine_held_keys(Engine* e) { return (int)e->cam.heldKeys; }
EMSCRIPTEN_KEEPALIVE void engine_input_pointer(Engine* e, double cssX, double cssY, int buttons, int inside) { e->inputPointer(cssX, cssY, buttons, inside); }
EMSCRIPTEN_KEEPALIVE void engine_set_play_mode(Engine* e, int on) { e->setPlayModeOn(on); }
EMSCRIPTEN_KEEPALIVE void engine_set_draw_mode(Engine* e, int on) { e->setDrawModeOn(on); }
EMSCRIPTEN_KEEPALIVE int engine_local_input_bits(Engine* e) { return e->localInputBits(); }
EMSCRIPTEN_KEEPALIVE void engine_aim_cell(Engine* e, double* out) { out[0] = e->aimCellX(); out[1] = e->aimCellY(); }
EMSCRIPTEN_KEEPALIVE int engine_apply_local_input(Engine* e, int playerId, double now, int seq) { return e->applyLocalInput(playerId, now, (uint32_t)seq); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_draft_at_aim(Engine* e) { return e->pointerDraftAtAim(); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_down_at_aim(Engine* e, int button) { return e->pointerDownAtAim(button); }
} // extern "C"
