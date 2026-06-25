  // Tool semantics and player/world edits.
  //
  // JS forwards raw input and selected tool/material ids; this file decides what
  // those intents do to the world. Keep component-aware writes here, and keep DOM
  // or pointer policy in camera.inc/JS.
  // Returns the NUMBER OF CELLS actually written (for the per-pixel inventory economy).
  int paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if ((overwrite || grid[k] == EMPTY) && grid[k] != material) { grid[k] = material; changed++; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  // Generic material placement by id — the inventory-forward path. Routes by the
  // material's kind/group so a new material is placeable with NO new tool enum or
  // switch case: powders/liquids/gases paint as loose cells; component materials
  // are written into EMPTY cells and registered into their seeded-component list
  // (stone/ice via registerRigidCellsSplit keyed on the actual material; plant via
  // the flood-fill registrar). EMPTY erases. Returns the NUMBER OF CELLS written.
  int placeMaterialAt(int cx, int cy, int radius, uint8_t mat) {
    if (mat == EMPTY) return eraseDisc(cx, cy, radius);
    if (MAT_KIND[mat] != K_COMPONENT) return paintDisc(cx, cy, radius, mat, false);
    std::unordered_set<int> cells;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue;
      for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue;
        int k = I(xx, yy); if (grid[k] == EMPTY) { grid[k] = mat; markCellIndex(k); cells.insert(k); } } }
    if (cells.empty()) return 0;
    markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    registerComponentCells(mat, cells);
    return (int)cells.size();
  }
  // Shared component registration: route a freshly-written cell set into its seeded
  // list by group (ice / plant / stone). Used by placeMaterialAt, the capped placer,
  // and the generalized creative draft finalize so they all register identically.
  void registerComponentCells(uint8_t mat, std::unordered_set<int>& cells) {
    if (cells.empty()) return;
    switch (MAT_CGROUP[mat]) {
      case CG_ICE:  registerRigidCellsSplit(L->iceComponents, L->nextIceId, mat, cells, true); break;
      case CG_PLANT:
        registerSeededComponents(0, cols); // unbounded flood (a tree/blob is one comp)
        if (mat != SEED) break;
        for (auto& comp : L->plantComponents) {
          for (int k : cells) {
            if (std::find(comp.cells.begin(), comp.cells.end(), k) == comp.cells.end()) continue;
            comp.growing = true;
            comp.cacheDirty = true;
            break;
          }
        }
        break;
      default:      registerRigidCellsSplit(L->stoneComponents, L->nextStoneId, mat, cells, false); break; // stone group
    }
  }
  // Per-pixel placement: write at most `maxCells` cells, NEAREST-TO-CENTER first, so
  // an inventory stack places exactly as many pixels as it can afford. Deterministic
  // (static distance-sorted offset order). Returns cells written. EMPTY erases (no cap).
  // Optional `p` excludes the player's own AABB cell-by-cell (mirrors
  // addDiscToDraftCapped) so a build disc that grazes the player still places its
  // non-overlapping cells instead of being rejected wholesale — you can build right
  // up against yourself and hold to place continuously without trapping the body.
  int placeMaterialAtCapped(int cx, int cy, int radius, uint8_t mat, int maxCells, const Player* p = nullptr) {
    if (mat == EMPTY) return eraseDisc(cx, cy, radius);
    if (maxCells <= 0) return 0;
    int px0 = 0, px1 = -1, py0 = 0, py1 = -1;
    if (p) { px0 = (int)std::floor(p->px); px1 = (int)std::floor(p->px + p->w - 1e-6); py0 = (int)std::floor(p->py); py1 = (int)std::floor(p->py + p->h - 1e-6); }
    const std::vector<std::pair<int, int>>& offs = discOffsets(radius);
    bool comp = MAT_KIND[mat] == K_COMPONENT;
    std::unordered_set<int> cells; int placed = 0;
    for (const auto& o : offs) {
      if (placed >= maxCells) break;
      int xx = cx + o.first, yy = cy + o.second;
      if (yy <= 0 || yy >= rows || xx <= 0 || xx >= cols - 1) continue;
      if (p && xx >= px0 && xx <= px1 && yy >= py0 && yy <= py1) continue; // don't build on the player
      int k = I(xx, yy); if (grid[k] != EMPTY) continue;
      grid[k] = mat; placed++;
      if (comp) { markCellIndex(k); cells.insert(k); }
    }
    if (placed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    if (comp) registerComponentCells(mat, cells);
    return placed;
  }
  // Disc cell offsets ordered by distance from center (cached per radius). Tie-break
  // on (oy,ox) keeps the order stable/deterministic across calls and peers.
  const std::vector<std::pair<int, int>>& discOffsets(int radius) {
    auto it = discOffsetCache.find(radius);
    if (it != discOffsetCache.end()) return it->second;
    std::vector<std::pair<int, int>> offs;
    for (int oy = -radius; oy <= radius; oy++) for (int ox = -radius; ox <= radius; ox++) if (ox * ox + oy * oy <= radius * radius) offs.push_back({ox, oy});
    std::stable_sort(offs.begin(), offs.end(), [](const std::pair<int, int>& a, const std::pair<int, int>& b) {
      int da = a.first * a.first + a.second * a.second, db = b.first * b.first + b.second * b.second;
      if (da != db) return da < db; if (a.second != b.second) return a.second < b.second; return a.first < b.first; });
    return discOffsetCache.emplace(radius, std::move(offs)).first->second;
  }
  // Returns the NUMBER OF GRID CELLS cleared (non-EMPTY -> EMPTY). Body/draft-only
  // erases still mark dirty but don't count toward the cleared total.
  int eraseDisc(int cx, int cy, int radius) {
    std::vector<int> erasedStone, erasedIce, bodyCellList; bool erasedPlant = false; bool changed = false; int cleared = 0;
    std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy);
      if (grid[k] == RIGID) { if (bodyById.empty()) for (Body* b : L->bodies) bodyById[b->id] = b; if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = true; }
      if (grid[k] != EMPTY) { if (isStoneComp(grid[k])) erasedStone.push_back(k); else if (isIceComp(grid[k])) erasedIce.push_back(k); if (isPlantMaterial(grid[k])) erasedPlant = true; if (grid[k] == RIGID) bodyOwner[k] = -1; grid[k] = EMPTY; changed = true; cleared++; }
      if (draft.erase(k)) changed = true;
    } }
    finishErasedBodies(dirtyBodies, L->bodyCells);
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    splitRigidAfterErase(L->stoneComponents, erasedStone, L->nextStoneId, false);
    splitRigidAfterErase(L->iceComponents, erasedIce, L->nextIceId, true);
    if (erasedPlant && !L->plantComponents.empty()) splitPlantAfterErase();
    return cleared;
  }
  // Batched eraser for continuous creative strokes: collect the whole swept brush
  // footprint, then split affected components once. This avoids doing flood-fill
  // cleanup for every interpolated brush stamp while the pointer is held.
  int eraseStrokeCells(const std::unordered_set<int>& cells, int x0, int y0, int x1, int y1) {
    if (cells.empty()) return 0;
    std::vector<int> erasedStone, erasedIce; bool erasedPlant = false, changed = false; int cleared = 0;
    std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
    for (int k : cells) {
      if (grid[k] == RIGID) { if (bodyById.empty()) for (Body* b : L->bodies) bodyById[b->id] = b; if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = true; }
      if (grid[k] != EMPTY) { if (isStoneComp(grid[k])) erasedStone.push_back(k); else if (isIceComp(grid[k])) erasedIce.push_back(k); if (isPlantMaterial(grid[k])) erasedPlant = true; if (grid[k] == RIGID) bodyOwner[k] = -1; grid[k] = EMPTY; changed = true; cleared++; }
      if (draft.erase(k)) changed = true;
    }
    finishErasedBodies(dirtyBodies, L->bodyCells);
    if (changed) markDirtyRect(x0, y0, x1, y1);
    splitRigidAfterErase(L->stoneComponents, erasedStone, L->nextStoneId, false);
    splitRigidAfterErase(L->iceComponents, erasedIce, L->nextIceId, true);
    if (erasedPlant && !L->plantComponents.empty()) splitPlantAfterErase();
    return cleared;
  }
  int clearMineDamageDisc(int cx, int cy, int radius) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if (L->mineDamage[k]) { L->mineDamage[k] = 0; changed = 1; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  void clearAllMineDamage() {
    bool any = false;
    for (uint8_t v : L->mineDamage) if (v) { any = true; break; }
    if (!any) return;
    std::fill(L->mineDamage.begin(), L->mineDamage.end(), 0);
    markAllDirty();
  }
  int mineDamageDisc(int cx, int cy, int radius, const Player& miner, bool scaledSpeed) {
    lastMinedCells.clear(); // this call's destroyed (material, cell) pairs -> mineDisc drops
    std::vector<int> erasedStone, erasedIce; bool erasedPlant = false; int changed = 0;
    std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); uint8_t m = grid[k]; if (m == EMPTY) { if (L->mineDamage[k]) { L->mineDamage[k] = 0; changed = 1; } continue; }
      uint16_t dur = (uint16_t)DURABILITY[m] * 16u;
      if (dur > 0) {
        if (L->mineDamage[k] == 0 || L->mineDamage[k] > dur) L->mineDamage[k] = dur;
        uint16_t power = 16;
        if (scaledSpeed) {
          uint8_t heldClass = miner.heldToolClass <= TC_HAND ? miner.heldToolClass : TC_HAND;
          uint8_t heldTier = miner.heldToolTier <= TT_GOLD ? miner.heldToolTier : TT_GOLD;
          uint8_t mineClass = MAT_TOOLCLASS[m] <= TC_HAND ? MAT_TOOLCLASS[m] : TC_NONE;
          power = (uint16_t)TOOL_CLASS_SPEED[heldClass * TOOL_CLASS_COUNT + mineClass] * TOOL_TIER_SPEED[heldTier] * 16u / (10000u * MINING_PROGRESS_DIVISOR);
          if (power == 0) power = 1;
        }
        L->mineDamage[k] = L->mineDamage[k] > power ? L->mineDamage[k] - power : 0;
        changed = 1;
        if (L->mineDamage[k] > 0) continue;
      }
      if (m == RIGID) { if (bodyById.empty()) for (Body* b : L->bodies) bodyById[b->id] = b; if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = 1; }
      if (isStoneComp(m)) erasedStone.push_back(k); else if (isIceComp(m)) erasedIce.push_back(k);
      if (isPlantMaterial(m)) erasedPlant = true;
      if (m == RIGID) bodyOwner[k] = -1;
      lastMinedCells.push_back({m, k}); // record what was destroyed for drop resolution
      grid[k] = EMPTY; L->mineDamage[k] = 0; changed = 1;
      if (draft.erase(k)) changed = 1;
    } }
    finishErasedBodies(dirtyBodies, L->bodyCells);
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    splitRigidAfterErase(L->stoneComponents, erasedStone, L->nextStoneId, false);
    splitRigidAfterErase(L->iceComponents, erasedIce, L->nextIceId, true);
    if (erasedPlant && !L->plantComponents.empty()) splitPlantAfterErase();
    return changed;
  }
  int addDiscToDraft(std::unordered_set<int>& draft, int cx, int cy, int radius, int yLimit) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= yLimit) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if (grid[k] == EMPTY && !draft.count(k)) { draft.insert(k); changed = 1; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  // Survival draft: stage up to `maxAdd` NEW empty cells (nearest-center first) into the
  // draft, skipping the player's own AABB (so you don't build on yourself). Returns the
  // number staged — the caller consumes that many inventory units as the preview grows.
  int addDiscToDraftCapped(std::unordered_set<int>& d, int cx, int cy, int radius, int yLimit, int maxAdd, const Player* p) {
    if (maxAdd <= 0) return 0;
    int px0 = 0, px1 = -1, py0 = 0, py1 = -1;
    if (p) { px0 = (int)std::floor(p->px); px1 = (int)std::floor(p->px + p->w - 1e-6); py0 = (int)std::floor(p->py); py1 = (int)std::floor(p->py + p->h - 1e-6); }
    int added = 0;
    const std::vector<std::pair<int, int>>& offs = discOffsets(radius);
    for (const auto& o : offs) {
      if (added >= maxAdd) break;
      int xx = cx + o.first, yy = cy + o.second;
      if (yy <= 0 || yy >= yLimit || xx <= 0 || xx >= cols - 1) continue;
      if (p && xx >= px0 && xx <= px1 && yy >= py0 && yy <= py1) continue; // don't build on the player
      int k = I(xx, yy);
      if (grid[k] == EMPTY && !d.count(k)) { d.insert(k); added++; }
    }
    if (added) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return added;
  }
  // Brush radius for a creative material (preserves the historical per-material sizes;
  // FIRE/DRIFTWOOD draw a tighter 1-radius, everything else 2).
  int brushFor(uint8_t m) { return (m == FIRE || m == DRIFTWOOD) ? 1 : 2; }
  // Finalize the single component draft: write draftMaterial into the staged EMPTY
  // cells and register them into the right seeded-component list by group (so stone,
  // ice, driftwood, ores — ANY component — drop as connected pieces identically).
  void finalizeDraft() {
    if (draft.empty()) return;
    std::unordered_set<int> cells;
    for (int k : draft) if (grid[k] == EMPTY) { grid[k] = draftMaterial; markCellIndex(k); cells.insert(k); }
    registerComponentCells(draftMaterial, cells);
  }
  bool getSeedOrigin(int cx, int cy, int& x0, int& y0) {
    x0 = SEED_SIZE == 1 ? cx : (int)std::floor(cx - SEED_SIZE / 2.0);
    y0 = SEED_SIZE == 1 ? cy : (int)std::floor(cy - SEED_SIZE / 2.0);
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    return true;
  }
  bool canPlaceSeedAt(int x0, int y0) {
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) if (grid[I(x, y)] != EMPTY) return false;
    return true;
  }
  bool placeSeedAt(int x0, int y0) { return placeSeedAtTyped(x0, y0, PT_OAK); }
  // Place a seed of a given species. The comp carries the plantType so growth.inc
  // dispatches the right shape/material; the grown wood material then re-encodes
  // the type so it survives streaming.
  bool placeSeedAtTyped(int x0, int y0, uint8_t pt) {
    if (!canPlaceSeedAt(x0, y0)) return false;
    Comp c; c.id = L->nextPlantId++; c.yMax = 0; c.age = 0; c.cacheDirty = true; c.plantType = pt; c.growing = true;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) { int k = I(x, y); grid[k] = SEED; c.cells.push_back(k); if (y > c.yMax) c.yMax = y; } // fresh component, distinct cells
    L->plantComponents.push_back(std::move(c));
    markDirtyRect(x0 - 1, y0 - 1, x0 + SEED_SIZE, y0 + SEED_SIZE);
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
  // The creative pointer flow routes by `creativeMode`. setTool keeps the legacy Tool
  // enum working (survival eraser + back-compat) by mapping it onto the creative brush.
  void setTool(int tool) {
    activeTool = tool;
    switch (tool) {
      case T_ERASER: creativeMode = CM_ERASE; break;
      case T_CUBE: creativeMode = CM_CUBE; break;
      case T_SEED: creativeMode = CM_SEED; creativeSeed = PT_OAK; break;
      case T_STONE: creativeMode = CM_DRAFT; draftMaterial = STONE; break;
      case T_ICE: creativeMode = CM_DRAFT; draftMaterial = ICE; break;
      case T_DRIFTWOOD: creativeMode = CM_DRAFT; draftMaterial = DRIFTWOOD; break;
      case T_SAND: creativeMode = CM_PAINT; creativeMaterial = SAND; break;
      case T_WATER: creativeMode = CM_PAINT; creativeMaterial = WATER; break;
      case T_OIL: creativeMode = CM_PAINT; creativeMaterial = OIL; break;
      case T_FIRE: creativeMode = CM_PAINT; creativeMaterial = FIRE; break;
      case T_ACID: creativeMode = CM_PAINT; creativeMaterial = ACID; break;
      case T_LAVA: creativeMode = CM_PAINT; creativeMaterial = LAVA; break;
    }
  }
  // The searchable creative palette path: select ANY material, seed species, eraser,
  // or cube. Routes by the material's kind — components draft (live preview), the rest
  // paint; EMPTY/RIGID map to the eraser/cube.
  void setCreativeMaterial(int kind, int value) {
    switch (kind) {
      case CK_MATERIAL: {
        uint8_t m = (uint8_t)value;
        if (m == EMPTY) creativeMode = CM_ERASE;
        else if (m == RIGID) creativeMode = CM_CUBE;
        else if (m == SEED) { creativeMode = CM_SEED; creativeSeed = PT_OAK; creativeMaterial = m; }
        else if (MAT_KIND[m] == K_COMPONENT) { creativeMode = CM_DRAFT; draftMaterial = m; creativeMaterial = m; }
        else { creativeMode = CM_PAINT; creativeMaterial = m; }
        break;
      }
      case CK_SEED: creativeMode = CM_SEED; creativeSeed = (uint8_t)value; break;
      case CK_ERASER: creativeMode = CM_ERASE; break;
      case CK_CUBE: creativeMode = CM_CUBE; break;
    }
  }

  // When the world buffer slides under an active draft, remap the staged cells by
  // the SAME per-cell delta the grid uses (decode x/y, x-=dx, y-=dy, re-encode),
  // mirroring translateComponents/shiftRowMajorU8 so the preview + finalized solid
  // stay pinned to their world location instead of jolting with the buffer.
  void remapDraftForShift(std::unordered_set<int>& d, int dx, int dy) {
    if (d.empty()) return;
    std::unordered_set<int> moved; moved.reserve(d.size());
    for (int k : d) { int nx = (k % cols) - dx, ny = (k / cols) - dy; if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue; moved.insert(ny * cols + nx); }
    d.swap(moved);
  }
  void remapDraftsForShift(int dx, int dy) {
    if (!dx && !dy) return;
    remapDraftForShift(draft, dx, dy);
    if (hasSeedOrigin) { seedOriginX -= dx; seedOriginY -= dy; // seed origin is a buffer-space top-left corner; same delta
      if (seedOriginX < 0 || seedOriginX + SEED_SIZE > cols || seedOriginY < 0 || seedOriginY + SEED_SIZE > rows) hasSeedOrigin = false; }
  }
  void remapEmitStrokeForShift(int dx, int dy) {
    if (!emitStrokeActive || (!dx && !dy)) return;
    lastEmitCx -= dx; lastEmitCy -= dy;
    if (lastEmitCx < 0 || lastEmitCx >= cols || lastEmitCy < 0 || lastEmitCy >= rows) emitStrokeActive = false;
  }

  int updateSeedDraft(int cx, int cy) {
    int nx, ny; bool ok = getSeedOrigin(cx, cy, nx, ny);
    bool changed = (ok != hasSeedOrigin) || (ok && (nx != seedOriginX || ny != seedOriginY));
    hasSeedOrigin = ok; if (ok) { seedOriginX = nx; seedOriginY = ny; }
    return changed ? 1 : 0;
  }
  // Extend the active component draft / seed preview into draftLayer.
  int continueDrafts(int cx, int cy) {
    if (!drafting && !draftingSeed) return 0;
    useLayer(draftLayer ? &bg : &fg);
    int changed = 0;
    if (drafting) { if (addDiscToDraft(draft, cx, cy, brushFor(draftMaterial), draftMaterial == ICE ? rows - 1 : rows)) changed = 1; }
    if (draftingSeed) { changed |= updateSeedDraft(cx, cy); }
    useLayer(&fg);
    return changed;
  }
  int pointerDraft(int cx, int cy) { return continueDrafts(cx, cy); }

  // LMB acts on the foreground, RMB on the background. Paint/erase are continuous
  // (emitHeldTool while held); draft/cube/seed act on this press into the chosen layer.
  int pointerDown(int cx, int cy, int button) {
    if (button != 0 && button != 2) return 0;
    bool toBg = (button == 2);
    if (toBg) { rmbDown = true; bgEnabled = true; } else lmbDown = true;
    if (creativeMode == CM_PAINT || creativeMode == CM_ERASE) return 0; // continuous
    draftLayer = toBg ? 1 : 0;
    useLayer(toBg ? &bg : &fg);
    int changed = 0;
    switch (creativeMode) {
      case CM_DRAFT: drafting = true; if (addDiscToDraft(draft, cx, cy, brushFor(draftMaterial), draftMaterial == ICE ? rows - 1 : rows)) changed = 1; break;
      case CM_SEED: draftingSeed = true; changed |= updateSeedDraft(cx, cy); break;
      case CM_CUBE: spawnBox(cx, cy, CUBE_HALF, CUBE_HALF, RIGID); break;
      default: break;
    }
    useLayer(&fg);
    return changed;
  }
  // Track button release (mirrors the old buttons==0 reset on move/up). Releasing
  // all buttons ends the active stroke, so the NEXT press starts a fresh stroke
  // instead of interpolating a paint/erase line from the previous stroke's last
  // emit cell (which would draw across whatever lies between two separate clicks).
  void pointerButtons(int buttons) { if (buttons == 0) { rmbDown = false; lmbDown = false; emitStrokeActive = false; } }
  int pointerUp(int button) {
    if (button == 2) rmbDown = false;
    if (button == 0) lmbDown = false;
    if (!lmbDown && !rmbDown) emitStrokeActive = false; // stroke ended -> next press restarts it
    bool ownerReleased = (draftLayer == 1) ? (button == 2) : (button == 0);
    if (!ownerReleased) return 0;
    int changed = 0;
    useLayer(draftLayer ? &bg : &fg);
    if (drafting) { finalizeDraft(); drafting = false; draft.clear(); changed = 1; }
    if (draftingSeed) { if (hasSeedOrigin) placeSeedAtTyped(seedOriginX, seedOriginY, creativeSeed); draftingSeed = false; hasSeedOrigin = false; changed = 1; }
    useLayer(&fg);
    return changed;
  }
  // Apply one continuous paint/erase emit at (cx,cy) on the ACTIVE layer.
  void emitToolAt(int cx, int cy) {
    if (creativeMode == CM_ERASE) { eraseDisc(cx, cy, BRUSH_ERASE); return; }
    if (creativeMode != CM_PAINT) return;
    uint8_t m = creativeMaterial;
    if (MAT_KIND[m] == K_POWDER && grid[I(cx, cy)] != EMPTY) return; // don't stack powder on a filled cell
    paintDisc(cx, cy, brushFor(m), m, false);
  }
  // Apply the brush along the LINE from (x0,y0) to (x1,y1) on one layer, so a fast
  // pointer drag between throttled emits paints/erases a continuous stroke instead of
  // leaving gaps. Disc centers are spaced ~brush-radius apart so they overlap.
  void emitStrokeLayer(int x0, int y0, int x1, int y1, bool toBg) {
    useLayer(toBg ? &bg : &fg);
    int rad = (creativeMode == CM_ERASE) ? BRUSH_ERASE : brushFor(creativeMaterial);
    int spacing = imax(1, rad);
    int steps = imax(std::abs(x1 - x0), std::abs(y1 - y0));
    if (creativeMode == CM_ERASE) {
      std::unordered_set<int> cells;
      int minX = imin(x0, x1) - rad, minY = imin(y0, y1) - rad, maxX = imax(x0, x1) + rad, maxY = imax(y0, y1) + rad;
      int centers = steps == 0 ? 1 : (steps / spacing) + 2;
      cells.reserve((size_t)centers * (size_t)(rad * 2 + 1) * (size_t)(rad * 2 + 1));
      auto addDisc = [&](int cx, int cy) {
        for (int oy = -rad; oy <= rad; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -rad; ox <= rad; ox++) { if (ox * ox + oy * oy > rad * rad) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; cells.insert(I(xx, yy)); } }
      };
      if (steps == 0) addDisc(x0, y0);
      else {
        for (int i = 0; i <= steps; i += spacing) {
          double t = (double)i / steps;
          addDisc((int)std::lround(x0 + (x1 - x0) * t), (int)std::lround(y0 + (y1 - y0) * t));
        }
        addDisc(x1, y1);
      }
      eraseStrokeCells(cells, minX, minY, maxX, maxY);
    } else if (steps == 0) emitToolAt(x0, y0);
    else {
      for (int i = 0; i <= steps; i += spacing) {
        double t = (double)i / steps;
        emitToolAt((int)std::lround(x0 + (x1 - x0) * t), (int)std::lround(y0 + (y1 - y0) * t));
      }
      emitToolAt(x1, y1); // always include the endpoint
    }
    if (toBg) useLayer(&fg);
  }
  // Continuous painting while held, throttled. LMB paints the foreground; RMB the
  // background. Draft/cube/seed act on click. Survival mining is separate (player.inc).
  void emitHeldTool(int cx, int cy, double now, bool inside, bool drawMode) {
    if (!inside || !drawMode || !(creativeMode == CM_PAINT || creativeMode == CM_ERASE) || (!lmbDown && !rmbDown)) {
      emitStrokeActive = false; // stroke ended (released / left / non-continuous tool)
      return;
    }
    if (now - lastEmitMs < EMIT_INTERVAL_MS) return;
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
    // Interpolate from the previous emit cell; on a fresh stroke start at the current cell.
    int sx = emitStrokeActive ? lastEmitCx : cx, sy = emitStrokeActive ? lastEmitCy : cy;
    if (lmbDown) emitStrokeLayer(sx, sy, cx, cy, false);
    if (rmbDown) { bgEnabled = true; emitStrokeLayer(sx, sy, cx, cy, true); }
    lastEmitCx = cx; lastEmitCy = cy; emitStrokeActive = true;
    lastEmitMs = now;
  }
  // Per fixed step: extend active drafts + apply held painting. Returns 1 if the
  // draft preview changed.
  int applyTool(int cx, int cy, double now, bool inside, bool drawMode) {
    int changed = inside ? continueDrafts(cx, cy) : 0;
    emitHeldTool(cx, cy, now, inside, drawMode);
    return changed;
  }
