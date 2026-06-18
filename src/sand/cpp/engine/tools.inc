  // ================= TOOLS (tools.js) =================
  int paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if ((overwrite || grid[k] == EMPTY) && grid[k] != material) { grid[k] = material; changed = 1; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  int eraseDisc(int cx, int cy, int radius) {
    std::vector<int> erasedStone, erasedIce, bodyCellList; bool erasedPlant = false; int changed = 0;
    std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy);
      if (grid[k] == RIGID) { if (bodyById.empty()) for (Body* b : L->bodies) bodyById[b->id] = b; if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = 1; }
      if (grid[k] != EMPTY) { if (grid[k] == STONE) erasedStone.push_back(k); else if (grid[k] == ICE) erasedIce.push_back(k); if (isPlantMaterial(grid[k])) erasedPlant = true; if (grid[k] == RIGID) bodyOwner[k] = -1; grid[k] = EMPTY; changed = 1; }
      if (stoneDraft.erase(k)) changed = 1; if (iceDraft.erase(k)) changed = 1;
    } }
    finishErasedBodies(dirtyBodies, L->bodyCells);
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    splitRigidAfterErase(L->stoneComponents, erasedStone, L->nextStoneId, false);
    splitRigidAfterErase(L->iceComponents, erasedIce, L->nextIceId, true);
    if (erasedPlant && !L->plantComponents.empty()) splitPlantAfterErase();
    return changed;
  }
  // Sum the mining "durability" of the solid cells inside a disc (EMPTY = 0). The
  // player eraser peeks this before mining a disc at the cursor and scales its
  // post-mine cooldown by the result, so harder material mines slower (see player.inc).
  int discDurabilityCost(int cx, int cy, int radius) {
    int cost = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; cost += DURABILITY[grid[I(xx, yy)]]; } }
    return cost;
  }
  int addDiscToDraft(std::unordered_set<int>& draft, int cx, int cy, int radius, int yLimit) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= yLimit) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if (grid[k] == EMPTY && !draft.count(k)) { draft.insert(k); changed = 1; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  void finalizeStoneDraft() {
    if (stoneDraft.empty()) return;
    std::unordered_set<int> cells; int yMax = 0;
    for (int k : stoneDraft) if (grid[k] == EMPTY) { grid[k] = STONE; markCellIndex(k); cells.insert(k); int y = k / cols; if (y > yMax) yMax = y; }
    registerRigidCells(L->stoneComponents, L->nextStoneId, STONE, cells, yMax, false);
  }
  void finalizeIceDraft() {
    if (iceDraft.empty()) return;
    std::unordered_set<int> cells; int yMax = 0;
    for (int k : iceDraft) if (grid[k] == EMPTY) { grid[k] = ICE; markCellIndex(k); cells.insert(k); int y = k / cols; if (y > yMax) yMax = y; }
    registerRigidCells(L->iceComponents, L->nextIceId, ICE, cells, yMax, true);
  }
  void finalizeDriftwoodDraft() {
    if (stoneDraft.empty()) return;
    for (int k : stoneDraft) if (grid[k] == EMPTY) { grid[k] = DRIFTWOOD; markCellIndex(k); }
    registerSeededComponents(0, cols);
  }
  bool getSeedOrigin(int cx, int cy, int& x0, int& y0) {
    x0 = (int)std::floor(cx - SEED_SIZE / 2.0); y0 = (int)std::floor(cy - SEED_SIZE / 2.0);
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    return true;
  }
  bool canPlaceSeedAt(int x0, int y0) {
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) if (grid[I(x, y)] != EMPTY) return false;
    return true;
  }
  bool placeSeedAt(int x0, int y0) {
    if (!canPlaceSeedAt(x0, y0)) return false;
    Comp c; c.id = L->nextPlantId++; c.yMax = 0; c.age = 0; c.cacheDirty = true;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) { int k = I(x, y); grid[k] = SEED; c.cells.push_back(k); if (y > c.yMax) c.yMax = y; } // fresh component, distinct cells
    L->plantComponents.push_back(std::move(c));
    markDirtyRect(x0, y0, x0 + SEED_SIZE - 1, y0 + SEED_SIZE - 1);
    return true;
  }

  // ---- tool / pointer state machine (input policy from createSandGame) ----
  // JS owns browser-coord -> cell translation, button normalization, the RAF
  // loop, and the camera; it forwards cell-space pointer events here. All tool
  // policy (what paints, brush radius, RMB-erase, draft lifecycle, seed, cube,
  // throttle) lives below. The "changed" return flags when the draft preview
  // needs a redraw. RMB arms a momentary eraser that overrides the active tool.
  inline int effectiveTool() { return activeTool; }
  inline bool isPaintTool(int t) { return t == T_SAND || t == T_WATER || t == T_OIL || t == T_FIRE || t == T_ACID || t == T_LAVA; }
  void setTool(int tool) { activeTool = tool; }

  // When the world buffer slides under an active draft, remap the staged cells by
  // the SAME per-cell delta the grid uses (decode x/y, x-=dx, y-=dy, re-encode),
  // mirroring translateComponents/shiftRowMajorU8 so the preview + finalized solid
  // stay pinned to their world location instead of jolting with the buffer. Drafts
  // are shared engine state (used per draftLayer), so this remaps both layers' set.
  void remapDraftForShift(std::unordered_set<int>& draft, int dx, int dy) {
    if (draft.empty()) return;
    std::unordered_set<int> moved; moved.reserve(draft.size());
    for (int k : draft) { int nx = (k % cols) - dx, ny = (k / cols) - dy; if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue; moved.insert(ny * cols + nx); }
    draft.swap(moved);
  }
  void remapDraftsForShift(int dx, int dy) {
    if (!dx && !dy) return;
    remapDraftForShift(stoneDraft, dx, dy);
    remapDraftForShift(iceDraft, dx, dy);
    if (hasSeedOrigin) { seedOriginX -= dx; seedOriginY -= dy; // seed origin is a buffer-space top-left corner; same delta
      if (seedOriginX < 0 || seedOriginX + SEED_SIZE > cols || seedOriginY < 0 || seedOriginY + SEED_SIZE > rows) hasSeedOrigin = false; }
  }

  int updateSeedDraft(int cx, int cy) {
    int nx, ny; bool ok = getSeedOrigin(cx, cy, nx, ny);
    bool changed = (ok != hasSeedOrigin) || (ok && (nx != seedOriginX || ny != seedOriginY));
    hasSeedOrigin = ok; if (ok) { seedOriginX = nx; seedOriginY = ny; }
    return changed ? 1 : 0;
  }
  // Extend whichever draft is active (caller guarantees the pointer is inside).
  // The draft lives in draftLayer (set on pointerDown), so paint into that layer.
  int continueDrafts(int cx, int cy) {
    if (!draftingStone && !draftingIce && !draftingSeed) return 0;
    useLayer(draftLayer ? &bg : &fg);
    int changed = 0;
    if (draftingStone) { if (addDiscToDraft(stoneDraft, cx, cy, draftIsDriftwood ? BRUSH_DRIFTWOOD : BRUSH_STONE, rows)) changed = 1; }
    if (draftingIce) { if (addDiscToDraft(iceDraft, cx, cy, BRUSH_ICE, rows - 1)) changed = 1; }
    if (draftingSeed) { changed |= updateSeedDraft(cx, cy); }
    useLayer(&fg);
    return changed;
  }
  int pointerDraft(int cx, int cy) { return continueDrafts(cx, cy); }

  // LMB acts on the foreground, RMB on the background. Paint/erase tools are
  // continuous (handled in emitHeldTool while held); draft/cube/seed tools act on
  // this press, into the chosen layer.
  int pointerDown(int cx, int cy, int button) {
    if (button != 0 && button != 2) return 0;
    bool toBg = (button == 2);
    if (toBg) { rmbDown = true; bgEnabled = true; } else lmbDown = true;
    int tool = effectiveTool();
    if (isPaintTool(tool) || tool == T_ERASER) return 0; // continuous; emitHeldTool routes the layer
    draftLayer = toBg ? 1 : 0;
    useLayer(toBg ? &bg : &fg);
    int changed = 0;
    switch (tool) {
      case T_STONE: draftingStone = true; draftIsDriftwood = false; if (addDiscToDraft(stoneDraft, cx, cy, BRUSH_STONE, rows)) changed = 1; break;
      case T_DRIFTWOOD: draftingStone = true; draftIsDriftwood = true; if (addDiscToDraft(stoneDraft, cx, cy, BRUSH_DRIFTWOOD, rows)) changed = 1; break;
      case T_ICE: draftingIce = true; if (addDiscToDraft(iceDraft, cx, cy, BRUSH_ICE, rows - 1)) changed = 1; break;
      case T_SEED: draftingSeed = true; changed |= updateSeedDraft(cx, cy); break;
      case T_CUBE: spawnBox(cx, cy, CUBE_HALF, CUBE_HALF, RIGID); break;
      default: break;
    }
    useLayer(&fg);
    return changed;
  }
  // Track button release (mirrors the old buttons==0 reset on move/up).
  void pointerButtons(int buttons) { if (buttons == 0) { rmbDown = false; lmbDown = false; } }
  int pointerUp(int button) {
    if (button == 2) rmbDown = false;
    if (button == 0) lmbDown = false;
    // Finalize the active draft when the button that owns its layer is released.
    bool ownerReleased = (draftLayer == 1) ? (button == 2) : (button == 0);
    if (!ownerReleased) return 0;
    int changed = 0;
    useLayer(draftLayer ? &bg : &fg);
    if (draftingStone) { if (draftIsDriftwood) finalizeDriftwoodDraft(); else finalizeStoneDraft(); draftingStone = false; draftIsDriftwood = false; stoneDraft.clear(); changed = 1; }
    if (draftingIce) { finalizeIceDraft(); draftingIce = false; iceDraft.clear(); changed = 1; }
    if (draftingSeed) { if (hasSeedOrigin) placeSeedAt(seedOriginX, seedOriginY); draftingSeed = false; hasSeedOrigin = false; changed = 1; }
    useLayer(&fg);
    return changed;
  }
  // Apply one continuous tool emit at (cx,cy) on the ACTIVE layer.
  void emitToolAt(int tool, int cx, int cy) {
    switch (tool) {
      case T_ERASER: eraseDisc(cx, cy, BRUSH_ERASE); break;
      case T_WATER: paintDisc(cx, cy, BRUSH_WATER, WATER, false); break;
      case T_OIL: paintDisc(cx, cy, BRUSH_OIL, OIL, false); break;
      case T_FIRE: paintDisc(cx, cy, BRUSH_FIRE, FIRE, false); break;
      case T_ACID: paintDisc(cx, cy, BRUSH_ACID, ACID, false); break;
      case T_LAVA: paintDisc(cx, cy, BRUSH_LAVA, LAVA, false); break;
      case T_SAND: if (grid[cy * cols + cx] == EMPTY) paintDisc(cx, cy, BRUSH_SAND, SAND, false); break;
      default: break;
    }
  }
  // Continuous painting while held, throttled. LMB paints the active tool into the
  // FOREGROUND; RMB paints the same material into the BACKGROUND (the eraser
  // erases its layer). Draft/cube/seed tools act on click (not continuous), and
  // RMB ignores them. Survival-mode player mining is separate (player.inc).
  void emitHeldTool(int cx, int cy, double now, bool inside, bool drawMode) {
    if (!inside || !drawMode) return;
    int tool = activeTool;
    if (!(isPaintTool(tool) || tool == T_ERASER)) return; // drafts/cube/seed act on click
    if (!lmbDown && !rmbDown) return;
    if (now - lastEmitMs < EMIT_INTERVAL_MS) return;
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
    if (lmbDown) { useLayer(&fg); emitToolAt(tool, cx, cy); }
    if (rmbDown) { useLayer(&bg); bgEnabled = true; emitToolAt(tool, cx, cy); useLayer(&fg); }
    lastEmitMs = now;
  }
  // Per fixed step: extend active drafts + apply held painting. Returns 1 if the
  // draft preview changed.
  int applyTool(int cx, int cy, double now, bool inside, bool drawMode) {
    int changed = inside ? continueDrafts(cx, cy) : 0;
    emitHeldTool(cx, cy, now, inside, drawMode);
    return changed;
  }

