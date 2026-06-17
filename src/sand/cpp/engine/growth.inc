  // ================= GROWTH (growth.js) =================
  bool findWaterTouching(Comp& comp, int count, std::vector<int>& picked) {
    std::vector<int> candidates; std::unordered_set<int> seen;
    auto consider = [&](int nk) { if (grid[nk] != WATER || seen.count(nk)) return; seen.insert(nk); candidates.push_back(nk); };
    for (int k : comp.cells) { uint8_t m = grid[k]; if (m != SEED && m != WOOD) continue; int x = k % cols, y = k / cols; if (x < cols - 2) consider(k + 1); if (x > 1) consider(k - 1); if (y < rows - 1) consider(k + cols); if (y > 1) consider(k - cols); }
    if ((int)candidates.size() < count) return false;
    picked.clear();
    while ((int)picked.size() < count && !candidates.empty()) { int i = (int)(rand() * candidates.size()); picked.push_back(candidates[i]); candidates.erase(candidates.begin() + i); }
    return (int)picked.size() == count;
  }
  void refreshPlantCache(Comp& comp) {
    if (!comp.cacheDirty && !comp.woodCells.empty()) return; // approximates the JS guard
    comp.woodCells.clear(); comp.seedWoodCells.clear();
    for (int k : comp.cells) { uint8_t m = grid[k]; if (m == WOOD) { comp.woodCells.push_back(k); comp.seedWoodCells.push_back(k); } else if (m == SEED) comp.seedWoodCells.push_back(k); }
    auto byRow = [this](int a, int b) { return (a / cols) < (b / cols); };
    std::stable_sort(comp.woodCells.begin(), comp.woodCells.end(), byRow);
    std::stable_sort(comp.seedWoodCells.begin(), comp.seedWoodCells.end(), byRow);
    comp.cacheDirty = false;
  }
  int tryGrowWood(Comp& comp, std::unordered_set<int>& reserved) {
    refreshPlantCache(comp);
    std::vector<int>& sources = !comp.woodCells.empty() ? comp.woodCells : comp.seedWoodCells;
    for (int source : sources) {
      int y = source / cols, x = source - y * cols;
      bool branchReady = comp.woodCount > 16; int branchDir = rand() < 0.5 ? -1 : 1;
      int cand[5][2]; int nc;
      if (branchReady && rand() < 0.55) { cand[0][0] = x + branchDir; cand[0][1] = y - 1; cand[1][0] = x + branchDir * 2; cand[1][1] = y - 1; cand[2][0] = x + branchDir; cand[2][1] = y; cand[3][0] = x; cand[3][1] = y - 1; cand[4][0] = x - branchDir; cand[4][1] = y - 1; nc = 5; }
      else { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; cand[3][0] = x - 1; cand[3][1] = y; cand[4][0] = x + 1; cand[4][1] = y; nc = 5; }
      for (int i = 0; i < nc; i++) { int tx = cand[i][0], ty = cand[i][1]; if (!isInBounds(tx, ty)) continue; int tk = I(tx, ty); if (grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
    }
    return -1;
  }
  bool addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
    if (k < 0 || k >= cols * rows || grid[k] != EMPTY || reserved.count(k)) return false;
    growth.push_back({k, WOOD}); reserved.insert(k); return true;
  }
  void thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
    if (comp.woodCount >= TRUNK_THICKEN_UNTIL_WOOD || rand() > TRUNK_SIDE_FILL_P) return;
    int y = k / cols, x = k - y * cols; const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int tx = x + dirs[i]; if (!isInBounds(tx, y)) continue; if (addWoodIfOpen(I(tx, y), growth, reserved)) break; }
    if (rand() > TRUNK_DOUBLE_SIDE_FILL_P) return;
    for (int i = 0; i < 2; i++) { int tx = x - dirs[i]; if (!isInBounds(tx, y)) continue; if (addWoodIfOpen(I(tx, y), growth, reserved)) break; }
    if (rand() > TRUNK_WIDE_SIDE_FILL_P) return;
    for (int i = 0; i < 2; i++) { int tx = x + dirs[i] * 2; if (!isInBounds(tx, y)) continue; if (addWoodIfOpen(I(tx, y), growth, reserved)) break; }
  }
  int tryGrowLeaf(Comp& comp, std::unordered_set<int>& reserved) {
    refreshPlantCache(comp);
    if (comp.woodCells.empty()) return -1;
    for (int source : comp.woodCells) {
      int y = source / cols, x = source - y * cols;
      int cand[11][2] = {{x, y - 1}, {x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y}, {x + 2, y}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y}, {x + 3, y}};
      int start = (int)(rand() * 11); int step = rand() < 0.5 ? 1 : -1;
      for (int i = 0; i < 11; i++) { int idx = ((start + i * step) % 11 + 11) % 11; int tx = cand[idx][0], ty = cand[idx][1]; if (!isInBounds(tx, ty)) continue; int tk = I(tx, ty); if (grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
    }
    return -1;
  }
  void growPlantComponents() {
    if (L->plantComponents.empty()) return;
    for (auto& comp : L->plantComponents) {
      comp.age++;
      std::vector<int> waterCells;
      if (!findWaterTouching(comp, WATER_PER_GROWTH, waterCells)) continue;
      for (int wk : waterCells) markCellIndex(wk);
      if (rand() > GROWTH_P) continue;
      std::vector<std::pair<int, uint8_t>> growth; std::unordered_set<int> reserved;
      bool shouldGrowWood = comp.woodCount < MAX_WOOD_CELLS && (comp.woodCount < 18 || rand() > LEAF_GROWTH_P);
      if (shouldGrowWood) {
        int firstWood = tryGrowWood(comp, reserved);
        if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) thickenTrunkAround(firstWood, comp, growth, reserved);
        int extraWood = tryGrowWood(comp, reserved);
        if (extraWood >= 0 && rand() < 0.72) addWoodIfOpen(extraWood, growth, reserved);
      }
      if (growth.empty() && comp.woodCount >= 6 && comp.leafCount < MAX_LEAF_CELLS) {
        int leafCount = rand() < 0.35 ? 2 : 1;
        for (int i = 0; i < leafCount; i++) { int leafK = tryGrowLeaf(comp, reserved); if (leafK >= 0) { growth.push_back({leafK, PLANT}); reserved.insert(leafK); } }
      }
      if (growth.empty()) continue;
      for (int wk : waterCells) writeGridIndex(wk, EMPTY);
      for (auto& g : growth) { int targetK = g.first; uint8_t material = g.second; if (grid[targetK] != EMPTY) continue; writeGridIndex(targetK, material); comp.cells.insert(targetK); int y = targetK / cols; if (y > comp.yMax) comp.yMax = y; if (material == WOOD) comp.woodCount++; else comp.leafCount++; comp.cacheDirty = true; }
    }
  }

