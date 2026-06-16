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
      if (grid[k] == RIGID) { if (bodyById.empty()) for (Body* b : bodies) bodyById[b->id] = b; if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = 1; }
      if (grid[k] != EMPTY) { if (grid[k] == STONE) erasedStone.push_back(k); else if (grid[k] == ICE) erasedIce.push_back(k); if (isPlantMaterial(grid[k])) erasedPlant = true; if (grid[k] == RIGID) bodyOwner[k] = -1; grid[k] = EMPTY; changed = 1; }
      if (stoneDraft.erase(k)) changed = 1; if (iceDraft.erase(k)) changed = 1;
    } }
    finishErasedBodies(dirtyBodies, bodyCells);
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    splitRigidAfterErase(stoneComponents, erasedStone, nextStoneId, false);
    splitRigidAfterErase(iceComponents, erasedIce, nextIceId, true);
    if (erasedPlant && !plantComponents.empty()) splitPlantAfterErase();
    return changed;
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
    registerRigidCells(stoneComponents, nextStoneId, STONE, cells, yMax, false);
  }
  void finalizeIceDraft() {
    if (iceDraft.empty()) return;
    std::unordered_set<int> cells; int yMax = 0;
    for (int k : iceDraft) if (grid[k] == EMPTY) { grid[k] = ICE; markCellIndex(k); cells.insert(k); int y = k / cols; if (y > yMax) yMax = y; }
    registerRigidCells(iceComponents, nextIceId, ICE, cells, yMax, true);
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
    Comp c; c.id = nextPlantId++; c.yMax = 0; c.age = 0; c.cacheDirty = true;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) { int k = I(x, y); grid[k] = SEED; c.cells.insert(k); if (y > c.yMax) c.yMax = y; }
    plantComponents.push_back(std::move(c));
    markDirtyRect(x0, y0, x0 + SEED_SIZE - 1, y0 + SEED_SIZE - 1);
    return true;
  }

