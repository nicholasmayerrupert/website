// ---------------- C ABI ----------------
extern "C" {
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
EMSCRIPTEN_KEEPALIVE void engine_render_dirty_rects(Engine* e) { e->useLayer(&e->fg); e->renderDirtyRects(); }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_render_pixels(Engine* e) { return e->fg.renderPixels.data(); }
EMSCRIPTEN_KEEPALIVE int engine_render_pixels_len(Engine* e) { return (int)e->fg.renderPixels.size(); }
EMSCRIPTEN_KEEPALIVE int engine_paint_disc(Engine* e, int cx, int cy, int r, int mat, int ow) { return e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0); }
EMSCRIPTEN_KEEPALIVE int engine_erase_disc(Engine* e, int cx, int cy, int r) { return e->eraseDisc(cx, cy, r); }
EMSCRIPTEN_KEEPALIVE void engine_set_sinks(Engine* e, int v) { e->sinksEnabled = v != 0; }
EMSCRIPTEN_KEEPALIVE void engine_sync_components(Engine* e) { e->useLayer(&e->fg); e->registerSeededComponents(0, e->cols); }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_ms(Engine* e) { return e->perfStepMs; }
EMSCRIPTEN_KEEPALIVE int engine_perf_dirty_chunks(Engine* e) { return e->perfDirtyChunks; }
EMSCRIPTEN_KEEPALIVE double engine_perf_shift_buffers(Engine* e) { return e->perfShiftBuffers; }
EMSCRIPTEN_KEEPALIVE double engine_perf_shift_translate(Engine* e) { return e->perfShiftTranslate; }
EMSCRIPTEN_KEEPALIVE double engine_perf_shift_register(Engine* e) { return e->perfShiftRegister; }
EMSCRIPTEN_KEEPALIVE double engine_perf_shift_fill(Engine* e) { return e->perfShiftFill; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_ground(Engine* e) { return e->perfStepGround; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_rigid(Engine* e) { return e->perfStepRigid; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_react(Engine* e) { return e->perfStepReact; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_carry(Engine* e) { return e->perfStepCarry; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_settle(Engine* e) { return e->perfStepSettle; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_tail(Engine* e) { return e->perfStepTail; }
EMSCRIPTEN_KEEPALIVE int engine_tick(Engine* e) { return e->tick; }

// drafts / seed
EMSCRIPTEN_KEEPALIVE int engine_add_stone_draft(Engine* e, int cx, int cy, int r) { return e->addDiscToDraft(e->stoneDraft, cx, cy, r, e->rows); }
EMSCRIPTEN_KEEPALIVE int engine_add_ice_draft(Engine* e, int cx, int cy, int r) { return e->addDiscToDraft(e->iceDraft, cx, cy, r, e->rows - 1); }
EMSCRIPTEN_KEEPALIVE void engine_finalize_stone_draft(Engine* e) { e->finalizeStoneDraft(); }
EMSCRIPTEN_KEEPALIVE void engine_finalize_ice_draft(Engine* e) { e->finalizeIceDraft(); }
EMSCRIPTEN_KEEPALIVE void engine_finalize_driftwood_draft(Engine* e) { e->finalizeDriftwoodDraft(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_stone_draft(Engine* e) { e->stoneDraft.clear(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_ice_draft(Engine* e) { e->iceDraft.clear(); }
EMSCRIPTEN_KEEPALIVE int engine_stone_draft_snapshot(Engine* e) { e->draftSnapshot.assign(e->stoneDraft.begin(), e->stoneDraft.end()); return (int)e->draftSnapshot.size(); }
EMSCRIPTEN_KEEPALIVE int engine_ice_draft_snapshot(Engine* e) { e->draftSnapshot.assign(e->iceDraft.begin(), e->iceDraft.end()); return (int)e->draftSnapshot.size(); }
EMSCRIPTEN_KEEPALIVE int* engine_draft_ptr(Engine* e) { return e->draftSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_get_seed_origin(Engine* e, int cx, int cy, int* out) { int x0, y0; if (!e->getSeedOrigin(cx, cy, x0, y0)) return 0; out[0] = x0; out[1] = y0; return 1; }
EMSCRIPTEN_KEEPALIVE int engine_can_place_seed(Engine* e, int x0, int y0) { return e->canPlaceSeedAt(x0, y0) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_place_seed(Engine* e, int x0, int y0) { return e->placeSeedAt(x0, y0) ? 1 : 0; }

// tools / pointer (input policy lives in the engine; JS forwards cell events)
EMSCRIPTEN_KEEPALIVE void engine_set_tool(Engine* e, int tool) { e->setTool(tool); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_down(Engine* e, int cx, int cy, int button) { return e->pointerDown(cx, cy, button); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_draft(Engine* e, int cx, int cy) { return e->pointerDraft(cx, cy); }
EMSCRIPTEN_KEEPALIVE void engine_pointer_buttons(Engine* e, int buttons) { e->pointerButtons(buttons); }
EMSCRIPTEN_KEEPALIVE int engine_pointer_up(Engine* e, int button) { return e->pointerUp(button); }
EMSCRIPTEN_KEEPALIVE int engine_apply_tool(Engine* e, int cx, int cy, double now, int inside, int drawMode) { return e->applyTool(cx, cy, now, inside != 0, drawMode != 0); }
EMSCRIPTEN_KEEPALIVE int engine_draft_is_driftwood(Engine* e) { return e->draftIsDriftwood ? 1 : 0; }
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
EMSCRIPTEN_KEEPALIVE int engine_body_count(Engine* e) { return (int)e->fg.bodies.size(); }
EMSCRIPTEN_KEEPALIVE int engine_body_blocked(Engine* e, int i) { e->useLayer(&e->fg); return (i >= 0 && i < (int)e->fg.bodies.size()) ? e->bodyFootprintBlocked(e->fg.bodies[i]) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_body_awake(Engine* e, int i) { return (i >= 0 && i < (int)e->fg.bodies.size()) ? (e->fg.bodies[i]->awake ? 1 : 0) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_rigid_rejected(Engine* e) { return e->rigidRejectedCells; }
EMSCRIPTEN_KEEPALIVE int engine_rigid_depen(Engine* e) { return e->rigidDepenetrations; }

// players (Terraria-like characters; physics in player.inc)
EMSCRIPTEN_KEEPALIVE int engine_spawn_player(Engine* e, double x, double y) { return e->spawnPlayer(x, y); }
EMSCRIPTEN_KEEPALIVE void engine_remove_player(Engine* e, int id) { e->removePlayer(id); }
EMSCRIPTEN_KEEPALIVE void engine_set_player_input(Engine* e, int id, int inputBits, double aimX, double aimY, int selectedTool, int seq) { e->setPlayerInput(id, inputBits, aimX, aimY, selectedTool, (uint32_t)seq); }
EMSCRIPTEN_KEEPALIVE int engine_player_count(Engine* e) { return (int)e->players.size(); }
EMSCRIPTEN_KEEPALIVE int engine_player_snapshot(Engine* e) { return e->buildPlayerSnapshot(); }
EMSCRIPTEN_KEEPALIVE float* engine_player_snapshot_ptr(Engine* e) { return e->playerSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_player_snapshot_stride(Engine* e) { return PLAYER_SNAP_STRIDE; }
EMSCRIPTEN_KEEPALIVE int engine_player_action_count(Engine* e) { return e->playerActionCount; }
EMSCRIPTEN_KEEPALIVE void engine_step_player_only(Engine* e, int id) { e->stepPlayerOnly(id); }
EMSCRIPTEN_KEEPALIVE void engine_set_player_state(Engine* e, int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady) { e->setPlayerState(id, x, y, vx, vy, facing, grounded, jumpReady); }

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
