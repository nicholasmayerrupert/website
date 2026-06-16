// ---------------- C ABI ----------------
extern "C" {
EMSCRIPTEN_KEEPALIVE Engine* engine_create(int cols, int rows, uint32_t seed, int sinks, int infinite) {
  Engine* e = new Engine(cols, rows, seed, sinks != 0);
  if (infinite) e->initInfinite(seed);
  e->markAllDirty();
  return e;
}
EMSCRIPTEN_KEEPALIVE void engine_shift_world(Engine* e, int dx) { e->shiftWorld(dx); }
EMSCRIPTEN_KEEPALIVE int engine_world_offset_x(Engine* e) { return e->worldOffsetX; }
EMSCRIPTEN_KEEPALIVE int engine_world_surface_at(Engine* e, int worldX) { return e->infinite ? e->genSurfaceAt(worldX) : 0; }
EMSCRIPTEN_KEEPALIVE void engine_destroy(Engine* e) { delete e; }
EMSCRIPTEN_KEEPALIVE int engine_step(Engine* e) { return e->step() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid(Engine* e) { return e->grid; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_dirty(Engine* e) { return e->dirtyRender.data(); }
EMSCRIPTEN_KEEPALIVE int engine_dirty_count(Engine* e) { return e->dirtyRenderCount; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_cols(Engine* e) { return e->chunkCols; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_rows(Engine* e) { return e->chunkRows; }
EMSCRIPTEN_KEEPALIVE void engine_fold_dirty(Engine* e) { e->foldRowMarksToRender(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_dirty(Engine* e) { memset(e->dirtyRender.data(), 0, e->dirtyRender.size()); e->dirtyRenderCount = 0; }
EMSCRIPTEN_KEEPALIVE int engine_paint_disc(Engine* e, int cx, int cy, int r, int mat, int ow) { return e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0); }
EMSCRIPTEN_KEEPALIVE int engine_erase_disc(Engine* e, int cx, int cy, int r) { return e->eraseDisc(cx, cy, r); }
EMSCRIPTEN_KEEPALIVE void engine_set_sinks(Engine* e, int v) { e->sinksEnabled = v != 0; }
EMSCRIPTEN_KEEPALIVE void engine_sync_components(Engine* e) { e->registerSeededComponents(0, e->cols); }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_ms(Engine* e) { return e->perfStepMs; }
EMSCRIPTEN_KEEPALIVE int engine_perf_dirty_chunks(Engine* e) { return e->perfDirtyChunks; }
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

// free rigid bodies
EMSCRIPTEN_KEEPALIVE void engine_spawn_body(Engine* e, int* xy, int count) {
  std::vector<std::pair<int, int>> cells; cells.reserve(count);
  for (int i = 0; i < count; i++) cells.push_back({xy[i * 2], xy[i * 2 + 1]});
  e->spawnBody(cells);
}
EMSCRIPTEN_KEEPALIVE int engine_body_count(Engine* e) { return (int)e->bodies.size(); }
EMSCRIPTEN_KEEPALIVE int engine_body_blocked(Engine* e, int i) { return (i >= 0 && i < (int)e->bodies.size()) ? e->bodyFootprintBlocked(e->bodies[i]) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_body_awake(Engine* e, int i) { return (i >= 0 && i < (int)e->bodies.size()) ? (e->bodies[i]->awake ? 1 : 0) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_rigid_rejected(Engine* e) { return e->rigidRejectedCells; }
} // extern "C"
