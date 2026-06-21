  // ================= GROWTH (growth.js) =================
  // Trees grow as plant components. The SPECIES (comp.plantType) selects the trunk
  // and foliage MATERIAL (gWoodMat/gLeafMat, set per-comp in growPlantComponents)
  // and shape biases. PT_OAK = the original behavior: with gWoodMat=WOOD,
  // gLeafMat=PLANT and no straight/droop bias, every branch + rand() call below is
  // identical to before, so existing growth stays byte-identical.
  bool growStraight() { return gGrowType == PT_PINE || gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM; }
  bool compHasSeed(Comp& comp) {
    for (int k : comp.cells) if (grid[k] == SEED) return true;
    return false;
  }
  bool findWaterTouching(Comp& comp, int count, std::vector<int>& picked) {
    std::vector<int> candidates; std::unordered_set<int> seen;
    auto consider = [&](int nk) { if (grid[nk] != WATER || seen.count(nk)) return; seen.insert(nk); candidates.push_back(nk); };
    for (int k : comp.cells) { uint8_t m = grid[k]; if (m != SEED && !isPlantWood(m)) continue; int x = k % cols, y = k / cols; if (x < cols - 2) consider(k + 1); if (x > 1) consider(k - 1); if (y < rows - 1) consider(k + cols); if (y > 1) consider(k - cols); }
    if ((int)candidates.size() < count) return false;
    picked.clear();
    while ((int)picked.size() < count && !candidates.empty()) { int i = (int)(rand() * candidates.size()); picked.push_back(candidates[i]); candidates.erase(candidates.begin() + i); }
    return (int)picked.size() == count;
  }
  void refreshPlantCache(Comp& comp) {
    if (!comp.cacheDirty && !comp.woodCells.empty()) return; // approximates the JS guard
    comp.woodCells.clear(); comp.seedWoodCells.clear();
    for (int k : comp.cells) { uint8_t m = grid[k]; if (isPlantWood(m)) { comp.woodCells.push_back(k); comp.seedWoodCells.push_back(k); } else if (m == SEED) comp.seedWoodCells.push_back(k); }
    auto byRow = [this](int a, int b) { return (a / cols) < (b / cols); };
    std::stable_sort(comp.woodCells.begin(), comp.woodCells.end(), byRow);
    std::stable_sort(comp.seedWoodCells.begin(), comp.seedWoodCells.end(), byRow);
    comp.cacheDirty = false;
  }
  int tryGrowWood(Comp& comp, std::unordered_set<int>& reserved) {
    refreshPlantCache(comp);
    std::vector<int>& sources = !comp.woodCells.empty() ? comp.woodCells : comp.seedWoodCells;
    bool straight = growStraight();
    for (int source : sources) {
      int y = source / cols, x = source - y * cols;
      bool branchReady = comp.woodCount > 16; int branchDir = rand() < 0.5 ? -1 : 1;
      int cand[5][2]; int nc;
      if (straight) { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; nc = 3; } // strongly vertical: pine/cactus/mushroom
      else if (branchReady && rand() < 0.55) { cand[0][0] = x + branchDir; cand[0][1] = y - 1; cand[1][0] = x + branchDir * 2; cand[1][1] = y - 1; cand[2][0] = x + branchDir; cand[2][1] = y; cand[3][0] = x; cand[3][1] = y - 1; cand[4][0] = x - branchDir; cand[4][1] = y - 1; nc = 5; }
      else { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; cand[3][0] = x - 1; cand[3][1] = y; cand[4][0] = x + 1; cand[4][1] = y; nc = 5; }
      for (int i = 0; i < nc; i++) { int tx = cand[i][0], ty = cand[i][1]; if (!isInBounds(tx, ty)) continue; int tk = I(tx, ty); if (grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
    }
    return -1;
  }
  bool addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
    if (k < 0 || k >= cols * rows || grid[k] != EMPTY || reserved.count(k)) return false;
    growth.push_back({k, gWoodMat}); reserved.insert(k); return true;
  }
  void thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
    if (growStraight()) return; // pine/cactus/mushroom keep a thin trunk
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
      if (gGrowType == PT_WILLOW) { int wc[11][2] = {{x, y + 1}, {x - 1, y + 1}, {x + 1, y + 1}, {x - 1, y}, {x + 1, y}, {x - 2, y + 1}, {x + 2, y + 1}, {x, y + 2}, {x - 1, y + 2}, {x + 1, y + 2}, {x - 2, y}}; std::memcpy(cand, wc, sizeof cand); } // drooping
      else if (gGrowType == PT_PINE) { int pc[11][2] = {{x - 1, y}, {x + 1, y}, {x - 1, y + 1}, {x + 1, y + 1}, {x - 2, y}, {x + 2, y}, {x - 2, y + 1}, {x + 2, y + 1}, {x, y + 1}, {x - 1, y - 1}, {x + 1, y - 1}}; std::memcpy(cand, pc, sizeof cand); } // lateral needles, keep the crown clear so the trunk runs up
      else if (gGrowType == PT_MUSHROOM) { int mc[11][2] = {{x, y - 1}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y - 1}, {x + 3, y - 1}, {x - 2, y}, {x + 2, y}, {x - 3, y}, {x + 3, y}}; std::memcpy(cand, mc, sizeof cand); } // wide flat cap
      int start = (int)(rand() * 11); int step = rand() < 0.5 ? 1 : -1;
      for (int i = 0; i < 11; i++) { int idx = ((start + i * step) % 11 + 11) % 11; int tx = cand[idx][0], ty = cand[idx][1]; if (!isInBounds(tx, ty)) continue; int tk = I(tx, ty); if (grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
    }
    return -1;
  }
  void growPlantComponents() {
    if (L->plantComponents.empty()) return;
    for (auto& comp : L->plantComponents) {
      comp.age++;
      if (!comp.growing) continue;                          // worldgen/restored trees are inert scenery
      if (!compHasSeed(comp)) { comp.growing = false; continue; }
      // species materials + per-type caps (OAK keeps the original literals).
      gGrowType = comp.plantType; gWoodMat = plantWoodMat(gGrowType); gLeafMat = plantLeafMat(gGrowType);
      int maxWood = gGrowType == PT_BUSH ? 14 : gGrowType == PT_MUSHROOM ? 10 : gGrowType == PT_CACTUS ? 26 : MAX_WOOD_CELLS;
      int maxLeaf = gGrowType == PT_MUSHROOM ? 18 : gGrowType == PT_BUSH ? 34 : MAX_LEAF_CELLS;
      int leafStart = gGrowType == PT_MUSHROOM ? 4 : gGrowType == PT_BUSH ? 3 : 6;
      bool leaves = gGrowType != PT_CACTUS;                  // cactus has no foliage
      bool needsWater = !(gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM); // desert/cave flora grow dry
      // Stop (and go inert) once fully grown.
      if (comp.woodCount >= maxWood && (!leaves || comp.leafCount >= maxLeaf)) { comp.growing = false; continue; }
      std::vector<int> waterCells;
      if (needsWater) {
        if (!findWaterTouching(comp, WATER_PER_GROWTH, waterCells)) continue;
        for (int wk : waterCells) markCellIndex(wk);
      } else if (!comp.cells.empty()) {
        markCellIndex(comp.cells[0]); // dry growers keep the layer active until maxed (bounded, then inert)
      }
      if (rand() > GROWTH_P) continue;
      std::vector<std::pair<int, uint8_t>> growth; std::unordered_set<int> reserved;
      bool shouldGrowWood = comp.woodCount < maxWood && (comp.woodCount < 18 || rand() > LEAF_GROWTH_P);
      if (shouldGrowWood) {
        int firstWood = tryGrowWood(comp, reserved);
        if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) thickenTrunkAround(firstWood, comp, growth, reserved);
        int extraWood = tryGrowWood(comp, reserved);
        if (extraWood >= 0 && rand() < 0.72) addWoodIfOpen(extraWood, growth, reserved);
      }
      if (leaves && growth.empty() && comp.woodCount >= leafStart && comp.leafCount < MAX_LEAF_CELLS) {
        int leafCount = rand() < 0.35 ? 2 : 1;
        for (int i = 0; i < leafCount; i++) { int leafK = tryGrowLeaf(comp, reserved); if (leafK >= 0) { growth.push_back({leafK, gLeafMat}); reserved.insert(leafK); } }
      }
      if (growth.empty()) continue;
      for (int wk : waterCells) writeGridIndex(wk, EMPTY);
      // push_back (not a set insert) is safe: the EMPTY guard above means each targetK is written once, so no cell is added to comp.cells twice.
      for (auto& g : growth) { int targetK = g.first; uint8_t material = g.second; if (grid[targetK] != EMPTY) continue; writeGridIndex(targetK, material); comp.cells.push_back(targetK); int y = targetK / cols; if (y > comp.yMax) comp.yMax = y; if (isPlantWood(material)) comp.woodCount++; else comp.leafCount++; comp.cacheDirty = true; }
    }
  }
