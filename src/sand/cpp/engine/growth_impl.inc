// GrowthSystem method bodies (need the full Engine definition; see growth.hpp).

// Plant and organic growth.
//
// Trees, cacti, mushrooms, kelp, and vines grow as plant components. This file
// owns species-specific shape and water/terrain interactions; component
// registration and grounding remain in components.inc.
// Trees grow as plant components. The SPECIES (comp.plantType) selects the trunk
// and foliage MATERIAL (gWoodMat/gLeafMat, set per-comp in growPlantComponents)
// and shape biases. PT_OAK = the original behavior: with gWoodMat=WOOD,
// gLeafMat=PLANT and no straight/droop bias, every branch + E.rand() call below is
// identical to before, so existing growth stays byte-identical.
bool GrowthSystem::growStraight() { return gGrowType == PT_PINE || gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM; }
bool GrowthSystem::compHasSeed(Comp& comp) {
  for (int k : comp.cells) if (E.grid[k] == SEED) return true;
  return false;
}
bool GrowthSystem::findWaterTouching(Comp& comp, int count, std::vector<int>& picked) {
  std::vector<int> candidates; std::unordered_set<int> seen;
  auto consider = [&](int nk) { if (E.grid[nk] != WATER || seen.count(nk)) return; seen.insert(nk); candidates.push_back(nk); };
  for (int k : comp.cells) { uint8_t m = E.grid[k]; if (m != SEED && !E.isPlantWood(m)) continue; int x = k % E.cols, y = k / E.cols; if (x < E.cols - 2) consider(k + 1); if (x > 1) consider(k - 1); if (y < E.rows - 1) consider(k + E.cols); if (y > 1) consider(k - E.cols); }
  if ((int)candidates.size() < count) return false;
  picked.clear();
  while ((int)picked.size() < count && !candidates.empty()) { int i = (int)(E.rand() * candidates.size()); picked.push_back(candidates[i]); candidates.erase(candidates.begin() + i); }
  return (int)picked.size() == count;
}
void GrowthSystem::refreshPlantCache(Comp& comp) {
  if (!comp.cacheDirty && !comp.woodCells.empty()) return; // approximates the JS guard
  comp.woodCells.clear(); comp.seedWoodCells.clear();
  for (int k : comp.cells) { uint8_t m = E.grid[k]; if (E.isPlantWood(m)) { comp.woodCells.push_back(k); comp.seedWoodCells.push_back(k); } else if (m == SEED) comp.seedWoodCells.push_back(k); }
  auto byRow = [this](int a, int b) { return (a / E.cols) < (b / E.cols); };
  std::stable_sort(comp.woodCells.begin(), comp.woodCells.end(), byRow);
  std::stable_sort(comp.seedWoodCells.begin(), comp.seedWoodCells.end(), byRow);
  comp.cacheDirty = false;
}
int GrowthSystem::tryGrowWood(Comp& comp, std::unordered_set<int>& reserved) {
  refreshPlantCache(comp);
  std::vector<int>& sources = !comp.woodCells.empty() ? comp.woodCells : comp.seedWoodCells;
  bool straight = growStraight();
  for (int source : sources) {
    int y = source / E.cols, x = source - y * E.cols;
    bool branchReady = comp.woodCount > 16; int branchDir = E.rand() < 0.5 ? -1 : 1;
    int cand[5][2]; int nc;
    if (straight) { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; nc = 3; } // strongly vertical: pine/cactus/mushroom
    else if (branchReady && E.rand() < 0.55) { cand[0][0] = x + branchDir; cand[0][1] = y - 1; cand[1][0] = x + branchDir * 2; cand[1][1] = y - 1; cand[2][0] = x + branchDir; cand[2][1] = y; cand[3][0] = x; cand[3][1] = y - 1; cand[4][0] = x - branchDir; cand[4][1] = y - 1; nc = 5; }
    else { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; cand[3][0] = x - 1; cand[3][1] = y; cand[4][0] = x + 1; cand[4][1] = y; nc = 5; }
    for (int i = 0; i < nc; i++) { int tx = cand[i][0], ty = cand[i][1]; if (!E.isInBounds(tx, ty)) continue; int tk = E.I(tx, ty); if (E.grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
  }
  return -1;
}
bool GrowthSystem::addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
  if (k < 0 || k >= E.cols * E.rows || E.grid[k] != EMPTY || reserved.count(k)) return false;
  growth.push_back({k, gWoodMat}); reserved.insert(k); return true;
}
void GrowthSystem::thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
  if (growStraight()) return; // pine/cactus/mushroom keep a thin trunk
  if (comp.woodCount >= TRUNK_THICKEN_UNTIL_WOOD || E.rand() > TRUNK_SIDE_FILL_P) return;
  int y = k / E.cols, x = k - y * E.cols; const int* dirs = E.rand() < 0.5 ? Engine::DIRS_LF : Engine::DIRS_RF;
  for (int i = 0; i < 2; i++) { int tx = x + dirs[i]; if (!E.isInBounds(tx, y)) continue; if (addWoodIfOpen(E.I(tx, y), growth, reserved)) break; }
  if (E.rand() > TRUNK_DOUBLE_SIDE_FILL_P) return;
  for (int i = 0; i < 2; i++) { int tx = x - dirs[i]; if (!E.isInBounds(tx, y)) continue; if (addWoodIfOpen(E.I(tx, y), growth, reserved)) break; }
  if (E.rand() > TRUNK_WIDE_SIDE_FILL_P) return;
  for (int i = 0; i < 2; i++) { int tx = x + dirs[i] * 2; if (!E.isInBounds(tx, y)) continue; if (addWoodIfOpen(E.I(tx, y), growth, reserved)) break; }
}
int GrowthSystem::tryGrowLeaf(Comp& comp, std::unordered_set<int>& reserved) {
  refreshPlantCache(comp);
  if (comp.woodCells.empty()) return -1;
  for (int source : comp.woodCells) {
    int y = source / E.cols, x = source - y * E.cols;
    int cand[11][2] = {{x, y - 1}, {x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y}, {x + 2, y}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y}, {x + 3, y}};
    if (gGrowType == PT_WILLOW) { int wc[11][2] = {{x, y + 1}, {x - 1, y + 1}, {x + 1, y + 1}, {x - 1, y}, {x + 1, y}, {x - 2, y + 1}, {x + 2, y + 1}, {x, y + 2}, {x - 1, y + 2}, {x + 1, y + 2}, {x - 2, y}}; std::memcpy(cand, wc, sizeof cand); } // drooping
    else if (gGrowType == PT_PINE) { int pc[11][2] = {{x - 1, y}, {x + 1, y}, {x - 1, y + 1}, {x + 1, y + 1}, {x - 2, y}, {x + 2, y}, {x - 2, y + 1}, {x + 2, y + 1}, {x, y + 1}, {x - 1, y - 1}, {x + 1, y - 1}}; std::memcpy(cand, pc, sizeof cand); } // lateral needles, keep the crown clear so the trunk runs up
    else if (gGrowType == PT_MUSHROOM) { int mc[11][2] = {{x, y - 1}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y - 1}, {x + 3, y - 1}, {x - 2, y}, {x + 2, y}, {x - 3, y}, {x + 3, y}}; std::memcpy(cand, mc, sizeof cand); } // wide flat cap
    int start = (int)(E.rand() * 11); int step = E.rand() < 0.5 ? 1 : -1;
    for (int i = 0; i < 11; i++) { int idx = ((start + i * step) % 11 + 11) % 11; int tx = cand[idx][0], ty = cand[idx][1]; if (!E.isInBounds(tx, ty)) continue; int tk = E.I(tx, ty); if (E.grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
  }
  return -1;
}
void GrowthSystem::growPlantComponents() {
  if (E.L->plantComponents.empty()) return;
  for (auto& comp : E.L->plantComponents) {
    comp.age++;
    if (!comp.growing) continue;                          // worldgen/restored trees are inert scenery
    if (!compHasSeed(comp)) { comp.growing = false; continue; }
    E.L->groundDirty = true; // an actively-growing plant may add cells this step -> full reflood
    // species materials + per-type caps (OAK keeps the original literals).
    gGrowType = comp.plantType; gWoodMat = E.plantWoodMat(gGrowType); gLeafMat = E.plantLeafMat(gGrowType);
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
      for (int wk : waterCells) E.markCellIndex(wk);
    } else if (!comp.cells.empty()) {
      E.markCellIndex(comp.cells[0]); // dry growers keep the layer active until maxed (bounded, then inert)
    }
    if (E.rand() > GROWTH_P) continue;
    std::vector<std::pair<int, uint8_t>> growth; std::unordered_set<int> reserved;
    bool shouldGrowWood = comp.woodCount < maxWood && (comp.woodCount < 18 || E.rand() > LEAF_GROWTH_P);
    if (shouldGrowWood) {
      int firstWood = tryGrowWood(comp, reserved);
      if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) thickenTrunkAround(firstWood, comp, growth, reserved);
      int extraWood = tryGrowWood(comp, reserved);
      if (extraWood >= 0 && E.rand() < 0.72) addWoodIfOpen(extraWood, growth, reserved);
    }
    if (leaves && growth.empty() && comp.woodCount >= leafStart && comp.leafCount < MAX_LEAF_CELLS) {
      int leafCount = E.rand() < 0.35 ? 2 : 1;
      for (int i = 0; i < leafCount; i++) { int leafK = tryGrowLeaf(comp, reserved); if (leafK >= 0) { growth.push_back({leafK, gLeafMat}); reserved.insert(leafK); } }
    }
    if (growth.empty()) continue;
    for (int wk : waterCells) E.writeGridIndex(wk, EMPTY);
    // push_back (not a set insert) is safe: the EMPTY guard above means each targetK is written once, so no cell is added to comp.cells twice.
    for (auto& g : growth) { int targetK = g.first; uint8_t material = g.second; if (E.grid[targetK] != EMPTY) continue; E.writeGridIndex(targetK, material); comp.cells.push_back(targetK); int y = targetK / E.cols; if (y > comp.yMax) comp.yMax = y; if (E.isPlantWood(material)) comp.woodCount++; else comp.leafCount++; comp.cacheDirty = true; }
  }
}

int GrowthSystem::myceliumNeighbourCount(int k) {
  int y = k / E.cols, x = k - y * E.cols, n = 0;
  for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    int nx = x + ox, ny = y + oy;
    if (!E.isInBounds(nx, ny)) continue;
    if (E.isMyceliumMaterial(E.grid[E.I(nx, ny)])) n++;
  }
  return n;
}

bool GrowthSystem::myceliumFindStoneTarget(Comp& comp, int& targetK) {
  targetK = -1;
  if (comp.cells.empty()) return false;
  const int dirs[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{1,1},{-1,1},{1,-1},{-1,-1}};
  int startCell = comp.cells.empty() ? 0 : (int)(E.rand() * comp.cells.size());
  if (startCell < 0) startCell = 0;
  if (startCell >= (int)comp.cells.size()) startCell = (int)comp.cells.size() - 1;
  int step = E.rand() < 0.5 ? 1 : -1;
  bool sawStone = false;
  bool branch = E.rand() < 0.10;
  for (int ci = 0; ci < (int)comp.cells.size(); ci++) {
    int idx = ((startCell + ci * step) % (int)comp.cells.size() + (int)comp.cells.size()) % (int)comp.cells.size();
    int source = comp.cells[idx];
    if (!E.isMyceliumMaterial(E.grid[source])) continue;
    int sourceNeighbours = myceliumNeighbourCount(source);
    if (sourceNeighbours > (branch ? 2 : 1)) continue;
    int y = source / E.cols, x = source - y * E.cols;
    int startDir = (int)(E.rand() * 8.0); if (startDir < 0) startDir = 0; if (startDir > 7) startDir = 7;
    for (int di = 0; di < 8; di++) {
      const int* d = dirs[(startDir + di) & 7];
      int nx = x + d[0], ny = y + d[1];
      if (!E.isInBounds(nx, ny)) continue;
      int nk = E.I(nx, ny);
      if (E.isBodyCell(nk) || E.grid[nk] != STONE) continue;
      int targetNeighbours = myceliumNeighbourCount(nk);
      if (targetNeighbours > (branch ? 2 : 1)) continue;
      sawStone = true;
      if (targetK < 0) targetK = nk;
    }
    if (targetK >= 0) break;
  }
  return sawStone;
}

bool GrowthSystem::myceliumCompHasSpore(Comp& comp) {
  for (int k : comp.cells) if (E.grid[k] == MYCELIUM_SPORE) return true;
  return false;
}

bool GrowthSystem::myceliumCompTouchesStone(Comp& comp) {
  for (int k : comp.cells) {
    if (!E.isMyceliumMaterial(E.grid[k])) continue;
    int y = k / E.cols, x = k - y * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = x + ox, ny = y + oy;
      if (!E.isInBounds(nx, ny)) continue;
      if (E.grid[E.I(nx, ny)] == STONE) return true;
    }
  }
  return false;
}

void GrowthSystem::refreshDormantMyceliumComponents() {
  bool active = false;
  for (auto& comp : E.L->stoneComponents) {
    if (!myceliumCompHasSpore(comp)) { comp.growing = false; continue; }
    if ((int)comp.cells.size() >= MYCELIUM_MAX_CELLS) { comp.growing = false; continue; }
    if (!comp.growing && myceliumCompTouchesStone(comp)) { comp.growing = true; comp.age = 0; }
    if (comp.growing) active = true;
  }
  E.L->myceliumActive = active;
}

void GrowthSystem::growMyceliumComponents() {
  if (E.L->stoneComponents.empty()) { E.L->myceliumActive = false; return; }
  refreshDormantMyceliumComponents();
  if (!E.L->myceliumActive) return;
  struct MycGrowth { int compId; int targetK; };
  std::vector<MycGrowth> growth;
  std::unordered_set<int> reserved;
  bool anyGrowing = false;
  for (auto& comp : E.L->stoneComponents) {
    if (!comp.growing) continue;
    comp.age++;
    if (!myceliumCompHasSpore(comp) || comp.age > MYCELIUM_MAX_AGE || (int)comp.cells.size() >= MYCELIUM_MAX_CELLS) { comp.growing = false; continue; }
    E.L->groundDirty = true; // an active colony may add rigid cells this step
    if (!comp.cells.empty()) E.markCellIndex(comp.cells[0]); // keep the colony awake while it is still active
    int targetK = -1;
    bool sawStone = myceliumFindStoneTarget(comp, targetK);
    if (!sawStone) { comp.growing = false; continue; }
    anyGrowing = true;
    if (targetK < 0 || reserved.count(targetK)) continue;
    if (E.rand() > MYCELIUM_GROWTH_P) continue;
    reserved.insert(targetK);
    growth.push_back({comp.id, targetK});
  }
  if (!anyGrowing) E.L->myceliumActive = false;
  if (growth.empty()) return;

  std::vector<int> converted;
  converted.reserve(growth.size());
  for (const MycGrowth& g : growth) {
    if (E.grid[g.targetK] != STONE || E.isBodyCell(g.targetK)) continue;
    E.writeGridIndex(g.targetK, MYCELIUM);
    converted.push_back(g.targetK);
  }
  if (converted.empty()) return;

  E.splitRigidAfterErase(E.L->stoneComponents, converted, E.L->nextStoneId, false);
  for (const MycGrowth& g : growth) {
    if (E.grid[g.targetK] != MYCELIUM) continue;
    for (auto& comp : E.L->stoneComponents) {
      if (comp.id != g.compId) continue;
      if (std::find(comp.cells.begin(), comp.cells.end(), g.targetK) != comp.cells.end()) break;
      comp.cells.push_back(g.targetK);
      int y = g.targetK / E.cols;
      if (y > comp.yMax) comp.yMax = y;
      comp.growing = (int)comp.cells.size() < MYCELIUM_MAX_CELLS && comp.age <= MYCELIUM_MAX_AGE;
      if (comp.growing) E.L->myceliumActive = true;
      break;
    }
  }
  E.L->skyDirty = true;
  E.L->groundDirty = true;
}
