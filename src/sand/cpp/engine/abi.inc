// C ABI surface exported to JavaScript through engineFactory.js.
//
// Keep this file as the narrow bridge contract: JS calls these functions to
// create engines, step/render/stream worlds, forward browser input, read packed
// snapshots, and apply multiplayer state. Gameplay policy belongs in the
// subsystem files below, not in the bridge.
extern "C" {
// ABI version stamp (abi.generated.hpp). initSandWasm() refuses a module whose
// version mismatches the JS manifest — catches a stale committed sandEngine.js.
EMSCRIPTEN_KEEPALIVE int engine_abi_version() { return ABI_VERSION; }
EMSCRIPTEN_KEEPALIVE Engine* engine_create(int cols, int rows, uint32_t seed, int sinks, int infinite) {
  Engine* e = new Engine(cols, rows, seed, sinks != 0);
  if (infinite) e->initInfinite(seed);
  e->markAllDirty();
  return e;
}
EMSCRIPTEN_KEEPALIVE void engine_shift_world(Engine* e, int dx) { e->shiftWorld(dx, 0); }
EMSCRIPTEN_KEEPALIVE void engine_shift_world_xy(Engine* e, int dx, int dy) { e->shiftWorld(dx, dy); }
EMSCRIPTEN_KEEPALIVE int engine_maybe_shift_world(Engine* e, int cameraCellX, int visibleCols, int marginCols) { return e->maybeShiftWorld(cameraCellX, visibleCols, marginCols); }
EMSCRIPTEN_KEEPALIVE int engine_maybe_shift_world_v(Engine* e, int cameraCellY, int visibleRows, int marginRows) { return e->maybeShiftWorldVertical(cameraCellY, visibleRows, marginRows); }
EMSCRIPTEN_KEEPALIVE int engine_world_shift_count(Engine* e) { return e->worldShiftCount; }
EMSCRIPTEN_KEEPALIVE void engine_prefetch_advance(Engine* e, int camCellX, int camCellY, int visCols, int visRows) { e->prefetchAdvance(camCellX, camCellY, visCols, visRows); }
EMSCRIPTEN_KEEPALIVE int engine_shift_fill_hit(Engine* e) { return e->shiftFillHit; }
EMSCRIPTEN_KEEPALIVE int engine_shift_fill_miss(Engine* e) { return e->shiftFillMiss; }
EMSCRIPTEN_KEEPALIVE int engine_world_offset_x(Engine* e) { return e->fg.worldOffsetX; }
EMSCRIPTEN_KEEPALIVE int engine_world_offset_y(Engine* e) { return e->fg.worldOffsetY; }
EMSCRIPTEN_KEEPALIVE int engine_world_surface_at(Engine* e, int worldX) { e->useLayer(&e->fg); return e->fg.infinite ? e->genSurfaceAt(worldX) : 0; }
EMSCRIPTEN_KEEPALIVE void engine_destroy(Engine* e) { delete e; }
EMSCRIPTEN_KEEPALIVE int engine_step(Engine* e) { return e->step() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid(Engine* e) { return e->fg.grid; }
EMSCRIPTEN_KEEPALIVE int engine_dirty_count(Engine* e) { return e->fg.dirtyRenderCount; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_cols(Engine* e) { return e->chunkCols; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_rows(Engine* e) { return e->chunkRows; }
// Dirty-rect generation (C++ owns the coalescing; JS reads the packed rects).
EMSCRIPTEN_KEEPALIVE void engine_build_dirty_rects(Engine* e) { e->useLayer(&e->fg); e->buildDirtyRects(); }
EMSCRIPTEN_KEEPALIVE int engine_dirty_rect_count(Engine* e) { return (int)(e->fg.dirtyRects.size() / 4); }
EMSCRIPTEN_KEEPALIVE int* engine_dirty_rects(Engine* e) { return e->fg.dirtyRects.data(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_dirty(Engine* e) { memset(e->fg.dirtyRender.data(), 0, e->fg.dirtyRender.size()); e->fg.dirtyRenderCount = 0; }
// Material -> RGBA rendering (C++ owns the pixel generation; JS uploads/blits).
EMSCRIPTEN_KEEPALIVE void engine_render_full(Engine* e) { e->useLayer(&e->fg); e->renderFull(); }
EMSCRIPTEN_KEEPALIVE void engine_render_full_layer(Engine* e, int layer) {
  if (layer) { e->useLayer(&e->fg); if (Engine::RENDER_LIGHTING_ENABLED) e->computeLighting(&e->fg); }
  e->useLayer(layer ? &e->bg : &e->fg); e->renderFull(); e->useLayer(&e->fg);
}
EMSCRIPTEN_KEEPALIVE void engine_render_dirty_rects(Engine* e) { e->useLayer(&e->fg); e->renderDirtyRects(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_render_pixels(Engine* e) { return e->fg.renderPixels.data(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_render_pixels_layer(Engine* e, int layer) { return (layer ? e->bg.renderPixels : e->fg.renderPixels).data(); }
EMSCRIPTEN_KEEPALIVE int engine_render_pixels_len(Engine* e) { return (int)e->fg.renderPixels.size(); }
EMSCRIPTEN_KEEPALIVE void engine_set_sky_light(Engine* e, int v) { e->renderSkyLight = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v)); }
EMSCRIPTEN_KEEPALIVE int engine_paint_disc(Engine* e, int cx, int cy, int r, int mat, int ow) { return e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0); }
EMSCRIPTEN_KEEPALIVE int engine_erase_disc(Engine* e, int cx, int cy, int r) { return e->eraseDisc(cx, cy, r); }
// Generic material placement by id (inventory-forward): routes by kind/group so
// any material is placeable without a per-material tool. 0=fg, 1=bg.
EMSCRIPTEN_KEEPALIVE int engine_place_material(Engine* e, int cx, int cy, int r, int mat) { return e->placeMaterialAt(cx, cy, r, (uint8_t)mat); }
EMSCRIPTEN_KEEPALIVE int engine_place_material_layer(Engine* e, int layer, int cx, int cy, int r, int mat) {
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
  out[PF_DIRTY_CHUNKS] = (double)e->perfDirtyChunks;
  out[PF_LIGHT_MS] = e->perfLightMs;
  out[PF_FILL_MS] = e->perfFillMs;
  out[PF_UPLOAD_MS] = e->perfUploadMs;
  out[PF_SHIFT_BUFFERS] = e->perfShiftBuffers;
  out[PF_SHIFT_TRANSLATE] = e->perfShiftTranslate;
  out[PF_SHIFT_REGISTER] = e->perfShiftRegister;
  out[PF_SHIFT_FILL] = e->perfShiftFill;
  out[PF_STEP_GROUND] = e->perfStepGround;
  out[PF_STEP_RIGID] = e->perfStepRigid;
  out[PF_STEP_REACT] = e->perfStepReact;
  out[PF_STEP_CARRY] = e->perfStepCarry;
  out[PF_STEP_SETTLE] = e->perfStepSettle;
  out[PF_STEP_TAIL] = e->perfStepTail;
  out[PF_STEP_JOINT] = e->perfStepJoint;
  out[PF_STEP_LAYERS] = e->perfStepLayers;
  out[PF_STEP_CROSS] = e->perfStepCross;
}
EMSCRIPTEN_KEEPALIVE int engine_tick(Engine* e) { return e->tick; }
// Incremental-grounding controls (testing/diagnostics). verify=1 runs the fast path
// AND a full reflood every step and counts mismatches; forceFull=1 always refloods
// (the byte-identical reference for the checksum test).
EMSCRIPTEN_KEEPALIVE void engine_test_set_grounding_debug(Engine* e, int verify, int forceFull) { e->groundVerify = verify != 0; e->groundForceFull = forceFull != 0; }
EMSCRIPTEN_KEEPALIVE double engine_test_grounding_mismatches(Engine* e) { return (double)e->groundMismatches; }
EMSCRIPTEN_KEEPALIVE double engine_test_grounding_diag(Engine* e, int which) { return which == 0 ? (double)e->gbFast : which == 1 ? (double)e->gbEdge : which == 2 ? (double)e->gbPowder : which == 3 ? (double)e->gbCut : (double)e->gbSpan; }

// drafts / seed
// Draft staging is a SINGLE material-parameterized set. The old per-material
// stone/ice hook pairs (byte-identical bodies) collapsed into these.
// ICE keeps its historical one-row-shorter stage ceiling.
EMSCRIPTEN_KEEPALIVE int engine_add_draft(Engine* e, int cx, int cy, int r, int mat) {
  e->draftMaterial = (uint8_t)mat;
  return e->addDiscToDraft(e->draft, cx, cy, r, mat == ICE ? e->rows - 1 : e->rows);
}
EMSCRIPTEN_KEEPALIVE void engine_finalize_draft(Engine* e, int mat) {
  e->draftMaterial = (uint8_t)mat;
  e->finalizeDraft();
  e->draft.clear();
  e->draftStrokeActive = false;
}
EMSCRIPTEN_KEEPALIVE void engine_clear_draft(Engine* e) { e->draft.clear(); e->draftStrokeActive = false; }
EMSCRIPTEN_KEEPALIVE int engine_draft_snapshot(Engine* e) { e->draftSnapshot.assign(e->draft.begin(), e->draft.end()); return (int)e->draftSnapshot.size(); }
EMSCRIPTEN_KEEPALIVE int* engine_draft_ptr(Engine* e) { return e->draftSnapshot.data(); }
// Creative palette: select any material / seed species / eraser / cube (CreativeKind).
EMSCRIPTEN_KEEPALIVE void engine_set_creative_material(Engine* e, int kind, int value) { e->setCreativeMaterial(kind, value); }
EMSCRIPTEN_KEEPALIVE int engine_get_seed_origin(Engine* e, int cx, int cy, int* out) { int x0, y0; if (!e->getSeedOrigin(cx, cy, x0, y0)) return 0; out[0] = x0; out[1] = y0; return 1; }
EMSCRIPTEN_KEEPALIVE int engine_can_place_seed(Engine* e, int x0, int y0) { return e->canPlaceSeedAt(x0, y0) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_place_seed(Engine* e, int x0, int y0) { return e->placeSeedAt(x0, y0) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_place_seed_typed(Engine* e, int x0, int y0, int pt) { return e->placeSeedAtTyped(x0, y0, (uint8_t)pt) ? 1 : 0; }

// tools / pointer (input policy lives in the engine; JS forwards cell events)
EMSCRIPTEN_KEEPALIVE void engine_set_tool(Engine* e, int tool) { e->setTool(tool); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_down(Engine* e, int cx, int cy, int button) { return e->pointerDown(cx, cy, button); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_draft(Engine* e, int cx, int cy) { return e->pointerDraft(cx, cy); }
EMSCRIPTEN_KEEPALIVE void engine_pointer_buttons(Engine* e, int buttons) { e->pointerButtons(buttons); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_up(Engine* e, int button) { return e->pointerUp(button); }
EMSCRIPTEN_KEEPALIVE int engine_apply_tool(Engine* e, int cx, int cy, double now, int inside, int drawMode) { return e->applyTool(cx, cy, now, inside != 0, drawMode != 0); }
EMSCRIPTEN_KEEPALIVE int engine_draft_is_driftwood(Engine* e) { return e->draftMaterial == DRIFTWOOD ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_seed_draft(Engine* e, int* out) {
  if (!e->draftingSeed || !e->hasSeedOrigin) return 0;
  out[0] = e->seedOriginX; out[1] = e->seedOriginY; out[2] = e->canPlaceSeedAt(e->seedOriginX, e->seedOriginY) ? 1 : 0;
  return 1;
}

// free rigid bodies
EMSCRIPTEN_KEEPALIVE void engine_spawn_body(Engine* e, int* xy, int count) {
  std::vector<std::pair<int, int>> cells; cells.reserve(count);
  for (int i = 0; i < count; i++) cells.push_back({xy[i * 2], xy[i * 2 + 1]});
  e->spawnBody(cells);
}
EMSCRIPTEN_KEEPALIVE void engine_spawn_box(Engine* e, int cx, int cy, int halfW, int halfH, int material) { e->spawnBox(cx, cy, halfW, halfH, (uint8_t)material); }
EMSCRIPTEN_KEEPALIVE void engine_spawn_disc(Engine* e, int cx, int cy, int radius, int material) { e->spawnDisc(cx, cy, radius, (uint8_t)material); }
EMSCRIPTEN_KEEPALIVE int engine_test_body_count(Engine* e) { return (int)e->fg.bodies.size(); }
EMSCRIPTEN_KEEPALIVE int engine_test_body_blocked(Engine* e, int i) { e->useLayer(&e->fg); return (i >= 0 && i < (int)e->fg.bodies.size()) ? e->bodyFootprintBlocked(e->fg.bodies[i]) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_awake(Engine* e, int i) { return (i >= 0 && i < (int)e->fg.bodies.size()) ? (e->fg.bodies[i]->awake ? 1 : 0) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_test_body_material(Engine* e, int i) { return (i >= 0 && i < (int)e->fg.bodies.size()) ? e->fg.bodies[i]->material : -1; }
// Read continuous body pose/motion for tests/tools: [px,py,angle,vx,vy,omega,nPts,maxR].
EMSCRIPTEN_KEEPALIVE int engine_test_body_state(Engine* e, int i, double* out) {
  if (i < 0 || i >= (int)e->fg.bodies.size()) return 0;
  Body* b = e->fg.bodies[i];
  out[0] = b->px; out[1] = b->py; out[2] = b->angle; out[3] = b->vx; out[4] = b->vy; out[5] = b->omega; out[6] = b->nPts; out[7] = b->maxR;
  return 1;
}
// Set continuous body motion (test/tool hook): wakes the body.
EMSCRIPTEN_KEEPALIVE int engine_test_set_body_motion(Engine* e, int i, double vx, double vy, double omega) {
  if (i < 0 || i >= (int)e->fg.bodies.size()) return 0;
  Body* b = e->fg.bodies[i];
  b->vx = vx; b->vy = vy; b->omega = omega; b->awake = true; b->stillTicks = 0;
  return 1;
}
EMSCRIPTEN_KEEPALIVE int engine_test_rigid_rejected(Engine* e) { return e->rigidRejectedCells; }
EMSCRIPTEN_KEEPALIVE int engine_test_rigid_depen(Engine* e) { return e->rigidDepenetrations; }

// players (Terraria-like characters; physics in player.inc)
EMSCRIPTEN_KEEPALIVE int engine_spawn_player(Engine* e, double x, double y) { return e->spawnPlayer(x, y); }
EMSCRIPTEN_KEEPALIVE int engine_spawn_player_surface(Engine* e, int col) { return e->spawnPlayerAtSurface(col); }
EMSCRIPTEN_KEEPALIVE void engine_player_surface_spawn(Engine* e, int col, double* out) { e->playerSurfaceSpawn(col, out); }
EMSCRIPTEN_KEEPALIVE int engine_player_width() { return PLAYER_W; }
EMSCRIPTEN_KEEPALIVE int engine_player_height() { return PLAYER_H; }
EMSCRIPTEN_KEEPALIVE void engine_remove_player(Engine* e, int id) { e->removePlayer(id); }
EMSCRIPTEN_KEEPALIVE void engine_set_player_input(Engine* e, int id, int inputBits, double aimX, double aimY, int selectedTool, int seq) { e->setPlayerInput(id, inputBits, aimX, aimY, selectedTool, (uint32_t)seq); }
EMSCRIPTEN_KEEPALIVE int engine_player_count(Engine* e) { return (int)e->players.size(); }
EMSCRIPTEN_KEEPALIVE int engine_player_snapshot(Engine* e) { return e->buildPlayerSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_player_snapshot_ptr(Engine* e) { return e->playerSnapshot.data(); }
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
EMSCRIPTEN_KEEPALIVE void engine_set_player_state(Engine* e, int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady) { e->setPlayerState(id, x, y, vx, vy, facing, grounded, jumpReady); }

// dropped items + particles (entities; physics in items.inc). spawn_item/_particle
// are test/gameplay hooks; the snapshot lets JS draw or inspect them.
EMSCRIPTEN_KEEPALIVE int engine_spawn_item(Engine* e, int mat, int count, double px, double py, double vx, double vy) { return e->spawnItem((uint8_t)mat, count, px, py, vx, vy); }
EMSCRIPTEN_KEEPALIVE void engine_test_spawn_particle(Engine* e, int mat, double px, double py, double vx, double vy, int life) { e->spawnParticle((uint8_t)mat, px, py, vx, vy, life); }
EMSCRIPTEN_KEEPALIVE int engine_item_count(Engine* e) { return (int)e->items.size(); }
EMSCRIPTEN_KEEPALIVE int engine_item_snapshot(Engine* e) { return e->buildItemSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_item_snapshot_ptr(Engine* e) { return e->itemSnapshot.data(); }

// survival inventory (inventory.inc): authoritative per-player stacks. JS reads the
// snapshot for the HUD and forwards slot-select / move / place intents.
EMSCRIPTEN_KEEPALIVE void engine_set_survival_inventory(Engine* e, int on) { e->survivalInventory = on != 0; }
EMSCRIPTEN_KEEPALIVE void engine_seed_starter_tools(Engine* e, int id) { e->seedStarterTools(id); }
EMSCRIPTEN_KEEPALIVE int engine_add_to_inventory(Engine* e, int id, int mat, int count) { return e->addToInventory(id, (uint8_t)mat, count) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE void engine_set_selected_slot(Engine* e, int id, int slot) { e->setSelectedSlot(id, slot); }
EMSCRIPTEN_KEEPALIVE void engine_cycle_selected_slot(Engine* e, int id, int delta) { e->cycleSelectedSlot(id, delta); }
EMSCRIPTEN_KEEPALIVE void engine_set_selected_footprint(Engine* e, int id, int footprintId) { e->setSelectedFootprint(id, footprintId); }
EMSCRIPTEN_KEEPALIVE int engine_selected_footprint(Engine* e, int id) { return e->selectedFootprintId(id); }
EMSCRIPTEN_KEEPALIVE int engine_survival_footprint_snapshot(Engine* e) { return e->buildSurvivalFootprintSnapshot(); }
EMSCRIPTEN_KEEPALIVE int32_t* engine_survival_footprint_snapshot_ptr(Engine* e) { return e->survivalFootprintSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE void engine_inventory_move(Engine* e, int id, int from, int to) { e->moveSlot(id, from, to); }
EMSCRIPTEN_KEEPALIVE int engine_place_from_selected(Engine* e, int id, int ax, int ay) { return e->placeFromSelected(id, ax, ay) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_inventory_snapshot(Engine* e, int id) { return e->buildInventorySnapshot(id); }
EMSCRIPTEN_KEEPALIVE float* engine_inventory_snapshot_ptr(Engine* e) { return e->invSnapshot.data(); }
// Minecraft cursor model: pick/place/half + throw-out + the carried-stack snapshot.
EMSCRIPTEN_KEEPALIVE void engine_inventory_cursor_pick(Engine* e, int id, int slot, int half) { e->cursorPick(id, slot, half); }
EMSCRIPTEN_KEEPALIVE int engine_inventory_throw_from_cursor(Engine* e, int id, int whole) { return e->throwFromCursor(id, whole) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_cursor_snapshot(Engine* e, int id) { return e->buildCursorSnapshot(id); }
EMSCRIPTEN_KEEPALIVE float* engine_cursor_snapshot_ptr(Engine* e) { return e->cursorSnap.data(); }

// world replication (Phase 6): serialize/apply full snapshots + dirty diffs.
EMSCRIPTEN_KEEPALIVE int engine_serialize_world(Engine* e) { return e->serializeWorld(); }
EMSCRIPTEN_KEEPALIVE int engine_serialize_diff(Engine* e) { return e->serializeDiff(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_net_blob_ptr(Engine* e) { return e->netBlob.data(); }
EMSCRIPTEN_KEEPALIVE void engine_apply_world(Engine* e, uint8_t* buf, int len) { e->applyWorld(buf, len); }
EMSCRIPTEN_KEEPALIVE void engine_apply_diff(Engine* e, uint8_t* buf, int len) { e->applyDiff(buf, len); }
EMSCRIPTEN_KEEPALIVE int engine_grid_hash(Engine* e) { return (int)e->gridHashFNV(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_all_dirty(Engine* e) { e->useLayer(&e->fg); e->clearAllDirty(); e->useLayer(&e->bg); e->clearAllDirty(); e->useLayer(&e->fg); }

// ---- two-layer access (background = layer 1) ----
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid_bg(Engine* e) { return e->bg.grid; }
EMSCRIPTEN_KEEPALIVE void engine_set_bg_enabled(Engine* e, int on) { e->bgEnabled = on != 0; }
// Paint a disc into a specific layer (0=fg, 1=bg). Enables the background on bg paint.
EMSCRIPTEN_KEEPALIVE int engine_paint_disc_layer(Engine* e, int layer, int cx, int cy, int r, int mat, int ow) {
  e->useLayer(layer ? &e->bg : &e->fg);
  if (layer) e->bgEnabled = true;
  int n = e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0);
  e->useLayer(&e->fg);
  return n;
}
EMSCRIPTEN_KEEPALIVE int engine_erase_disc_layer(Engine* e, int layer, int cx, int cy, int r) {
  e->useLayer(layer ? &e->bg : &e->fg);
  if (layer) e->bgEnabled = true;
  int n = e->eraseDisc(cx, cy, r);
  e->useLayer(&e->fg);
  return n;
}
// Register stone/plant/ice components in a layer so raw painted solids become
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
EMSCRIPTEN_KEEPALIVE int engine_gl_init(Engine* e, const char* target) { return e->glInit(target); }
EMSCRIPTEN_KEEPALIVE void engine_gl_resize(Engine* e, int devW, int devH) { e->glResize(devW, devH); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_flags(Engine* e, int gutterOn, int snapOff) { e->glSetFlags(gutterOn, snapOff); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_players(Engine* e, int useExternal, float* data, int count, int ownId) { e->glSetPlayers(useExternal, data, count, ownId); }
EMSCRIPTEN_KEEPALIVE void engine_gl_set_items(Engine* e, int useExternal, float* data, int count) { e->glSetItems(useExternal, data, count); }
EMSCRIPTEN_KEEPALIVE void engine_gl_shift(Engine* e, int dx) { e->glShift(dx); }
EMSCRIPTEN_KEEPALIVE int engine_gl_render_frame(Engine* e, int forceFull) { return e->glRenderFrame(forceFull); }
EMSCRIPTEN_KEEPALIVE void engine_gl_get_offset(Engine* e, int* out) { e->glGetOffset(out); }
EMSCRIPTEN_KEEPALIVE int engine_gl_read_pixels(Engine* e, int x, int y, int w, int h, uint8_t* out) { return e->glReadback(x, y, w, h, out); }

// View camera + input policy (camera.inc): the engine owns the view + input
// semantics; JS forwards raw DOM events and drives the loop.
EMSCRIPTEN_KEEPALIVE void engine_set_viewport(Engine* e, double dpr, int cellDev, int vCols, int vRows) { e->setViewport(dpr, cellDev, vCols, vRows); }
EMSCRIPTEN_KEEPALIVE void engine_camera_set(Engine* e, double x, double y) { e->cameraSet(x, y); }
EMSCRIPTEN_KEEPALIVE void engine_camera_get(Engine* e, double* out) { out[0] = e->camX; out[1] = e->camY; }
EMSCRIPTEN_KEEPALIVE int engine_camera_col_x(Engine* e) { return e->cameraColX(); }
EMSCRIPTEN_KEEPALIVE void engine_camera_pan_frame(Engine* e, double frameDtMs) { e->cameraPanFrame(frameDtMs); }
EMSCRIPTEN_KEEPALIVE void engine_camera_follow_to(Engine* e, double cx, double cy) { e->cameraFollowTo(cx, cy); }
EMSCRIPTEN_KEEPALIVE int engine_stream_world(Engine* e) { return e->streamWorld(); }
EMSCRIPTEN_KEEPALIVE void engine_input_key(Engine* e, int code, int down) { e->inputKey(code, down); }
EMSCRIPTEN_KEEPALIVE void engine_input_clear_keys(Engine* e) { e->inputClearKeys(); }
EMSCRIPTEN_KEEPALIVE int engine_held_keys(Engine* e) { return (int)e->heldKeys; }
EMSCRIPTEN_KEEPALIVE void engine_input_pointer(Engine* e, double cssX, double cssY, int buttons, int inside) { e->inputPointer(cssX, cssY, buttons, inside); }
EMSCRIPTEN_KEEPALIVE void engine_set_play_mode(Engine* e, int on) { e->setPlayModeOn(on); }
EMSCRIPTEN_KEEPALIVE void engine_set_draw_mode(Engine* e, int on) { e->setDrawModeOn(on); }
EMSCRIPTEN_KEEPALIVE int engine_local_input_bits(Engine* e) { return e->localInputBits(); }
EMSCRIPTEN_KEEPALIVE void engine_aim_cell(Engine* e, double* out) { out[0] = e->aimCellX(); out[1] = e->aimCellY(); }
EMSCRIPTEN_KEEPALIVE int engine_apply_local_input(Engine* e, int playerId, double now, int seq) { return e->applyLocalInput(playerId, now, (uint32_t)seq); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_draft_at_aim(Engine* e) { return e->pointerDraftAtAim(); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_down_at_aim(Engine* e, int button) { return e->pointerDownAtAim(button); }
} // extern "C"
