// Plant and organic growth.
// Trees, cacti, mushrooms, kelp, and vines grow as plant components. Species
// selects trunk/foliage materials and shape; component registration and grounding
// remain in ComponentSystem.
bool GrowthSystem::growStraight() { return gGrowType == PT_PINE || gGrowType == PT_WILLOW || gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM || gGrowType == PT_VINE; }
bool GrowthSystem::compHasSeed(Comp& comp) {
  for (int k : comp.cells) if (E.L->grid[k] == SEED) return true;
  return false;
}
bool GrowthSystem::findWaterTouching(Comp& comp, int count, std::vector<int>& picked) {
  std::vector<int> candidates; std::unordered_set<int> seen;
  auto consider = [&](int nk) { if (E.L->grid[nk] != WATER || seen.count(nk)) return; seen.insert(nk); candidates.push_back(nk); };
  for (int k : comp.cells) { uint8_t m = E.L->grid[k]; if (m != SEED && !E.isPlantWood(m)) continue; int x = k % E.cols, y = k / E.cols; if (x < E.cols - 2) consider(k + 1); if (x > 1) consider(k - 1); if (y < E.rows - 1) consider(k + E.cols); if (y > 1) consider(k - E.cols); }
  if ((int)candidates.size() < count) return false;
  picked.clear();
  while ((int)picked.size() < count && !candidates.empty()) { int i = (int)(E.rand() * candidates.size()); picked.push_back(candidates[i]); candidates.erase(candidates.begin() + i); }
  return (int)picked.size() == count;
}
static inline uint32_t plantGrowthTrait(uint32_t signature, uint32_t slot) {
  uint32_t x = signature + 0x9e3779b9u * (slot + 1u);
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
static inline int oakTargetHeight(uint32_t signature) { return 40 + (int)(plantGrowthTrait(signature, 0) % 9u); }
uint32_t GrowthSystem::plantGrowthSignature(Comp& comp) {
  int seed = comp.cells.empty() ? 0 : comp.cells.front();
  for (int k : comp.cells) if (E.L->grid[k] == SEED) { seed = k; break; }
  int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
  uint32_t wx = (uint32_t)(E.L->worldOffsetX + seedX);
  uint32_t wy = (uint32_t)(E.L->worldOffsetY + seedY);
  return E.L->worldSeed ^ (wx * 0x85ebca6bu) ^ (wy * 0xc2b2ae35u) ^ ((uint32_t)comp.id * 0x27d4eb2du) ^ ((uint32_t)comp.plantType * 0x165667b1u);
}
void GrowthSystem::refreshPlantCache(Comp& comp) {
  if (!comp.cacheDirty && !comp.woodCells.empty()) return; // approximates the JS guard
  comp.woodCells.clear(); comp.seedWoodCells.clear();
  for (int k : comp.cells) { uint8_t m = E.L->grid[k]; if (E.isPlantWood(m)) { comp.woodCells.push_back(k); comp.seedWoodCells.push_back(k); } else if (m == SEED) comp.seedWoodCells.push_back(k); }
  auto byRow = [this](int a, int b) { return (a / E.cols) < (b / E.cols); };
  std::stable_sort(comp.woodCells.begin(), comp.woodCells.end(), byRow);
  std::stable_sort(comp.seedWoodCells.begin(), comp.seedWoodCells.end(), byRow);
  comp.cacheDirty = false;
}
int GrowthSystem::tryGrowWood(Comp& comp, std::unordered_set<int>& reserved) {
  refreshPlantCache(comp);
  std::vector<int>& sources = !comp.woodCells.empty() ? comp.woodCells : comp.seedWoodCells;
  if (gGrowType == PT_VINE) {
    // Vines extend from their lowest segment. The diagonal fallbacks make a soft
    // wandering strand without ever allowing it to turn upward like a tree.
    for (auto it = sources.rbegin(); it != sources.rend(); ++it) {
      int source = *it, y = source / E.cols, x = source - y * E.cols;
      int dir = E.rand() < 0.5 ? -1 : 1;
      int cand[3][2] = {{x, y + 1}, {x + dir, y + 1}, {x - dir, y + 1}};
      for (auto& pos : cand) {
        int tx = pos[0], ty = pos[1];
        if (!E.isInBounds(tx, ty)) continue;
        int tk = E.I(tx, ty);
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
      }
    }
    return -1;
  }
  if (gGrowType == PT_OAK && !sources.empty()) {
    // Oaks establish a tall, gently wandering leader, then fork through the
    // upper third. The stable plan makes each tree distinct without letting
    // early random branches consume the trunk's height budget.
    int seed = sources.back();
    for (int k : comp.cells) if (E.L->grid[k] == SEED) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    uint32_t signature = plantGrowthSignature(comp);
    int targetHeight = oakTargetHeight(signature);
    auto trunkXAt = [&](int height) {
      int drift = 0;
      for (int band = 0; band < height / 6; band++) {
        uint32_t turn = plantGrowthTrait(signature, 70 + band);
        if (turn % 9u < 2u) drift--;
        else if (turn % 9u > 6u) drift++;
        drift = imax(-2, imin(2, drift));
      }
      return seedX + drift;
    };
    auto trunkWoodXAt = [&](int height) {
      int centerX = trunkXAt(height), y = seedY - height;
      const int offsets[3] = {0, -1, 1};
      for (int dx : offsets) {
        int x = centerX + dx;
        if (E.isInBounds(x, y) && E.L->grid[E.I(x, y)] == gWoodMat) return x;
      }
      return centerX;
    };
    int leaderHeight = 0;
    for (int height = 1; height <= targetHeight; height++) {
      int y = seedY - height, centerX = trunkXAt(height);
      if (!E.isInBounds(centerX, y) || E.L->grid[E.I(centerX, y)] != gWoodMat) break;
      leaderHeight = height;
    }
    auto growLeader = [&]() -> int {
      int nextHeight = leaderHeight + 1, centerX = trunkXAt(nextHeight);
      int previousX = trunkXAt(leaderHeight);
      int away = centerX >= previousX ? 1 : -1;
      int cand[3][2] = {{centerX, seedY - nextHeight}, {centerX - away, seedY - nextHeight}, {centerX + away, seedY - nextHeight}};
      for (int i = 0; i < 3; i++) {
        int tx = cand[i][0], ty = cand[i][1];
        if (!E.isInBounds(tx, ty)) continue;
        int tk = E.I(tx, ty);
        if (i == 0 && reserved.count(tk)) return -1;
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
      }
      return -1;
    };
    if (leaderHeight < targetHeight && (leaderHeight < 16 || E.rand() < 0.72)) {
      int leader = growLeader();
      if (leader >= 0) return leader;
    }

    struct OakBranch { int level, left, right, leftRise, rightRise; } branches[5];
    int branchCount = 0;
    for (int bi = 0; bi < 5; bi++) {
      int level = targetHeight - 14 + bi * 3 + (int)(plantGrowthTrait(signature, 10 + bi) % 3u) - 1;
      if (level < 12 || level >= targetHeight) continue;
      OakBranch& b = branches[branchCount++]; b.level = level;
      b.left = 6 + (int)(plantGrowthTrait(signature, 30 + bi * 4) % 6u);
      b.right = 6 + (int)(plantGrowthTrait(signature, 31 + bi * 4) % 6u);
      b.leftRise = 2 + (int)(plantGrowthTrait(signature, 32 + bi * 4) % 3u);
      b.rightRise = 2 + (int)(plantGrowthTrait(signature, 33 + bi * 4) % 3u);
    }
    int start = branchCount ? (int)(E.rand() * branchCount) % branchCount : 0;
    for (int bi = 0; bi < branchCount; bi++) {
      OakBranch& b = branches[(start + bi) % branchCount];
      if (b.level > leaderHeight) continue;
      int firstSide = E.rand() < 0.5 ? 0 : 1;
      for (int si = 0; si < 2; si++) {
        int side = si ? 1 - firstSide : firstSide;
        int dir = side ? 1 : -1, reach = side ? b.right : b.left;
        int rise = imin(side ? b.rightRise : b.leftRise, targetHeight - b.level);
        int baseX = trunkWoodXAt(b.level), baseY = seedY - b.level;
        for (int d = 1; d <= reach; d++) {
          int lift = (d * rise + reach - 1) / reach;
          int tx = baseX + dir * d, ty = baseY - lift;
          if (!E.isInBounds(tx, ty)) break;
          int tk = E.I(tx, ty);
          if (E.L->grid[tk] == gWoodMat || reserved.count(tk)) continue;
          if (E.L->grid[tk] == EMPTY) return tk;
          break;
        }
      }
    }
    if (leaderHeight < targetHeight) return growLeader();
    return -1;
  }
  if ((gGrowType == PT_PINE || gGrowType == PT_WILLOW) && !sources.empty()) {
    // Pines and willows keep a recognizable leader, but it wanders gradually
    // like the oak's organic trunk instead of growing up a ruler-straight line.
    // Their remaining wood still preserves the species silhouette: tapered pine
    // tiers and broad, arching willow limbs.
    int seed = sources.back();
    for (int k : comp.cells) if (E.L->grid[k] == SEED) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    int topY = !comp.woodCells.empty() ? comp.woodCells.front() / E.cols : seedY;
    uint32_t signature = plantGrowthSignature(comp);
    int targetHeight = gGrowType == PT_PINE
      ? 28 + (int)(plantGrowthTrait(signature, 0) % 10u)
      : 40 + (int)(plantGrowthTrait(signature, 0) % 9u);
    auto trunkXAt = [&](int height) {
      int drift = 0, maxDrift = gGrowType == PT_PINE ? 2 : 3;
      for (int band = 0; band < height / 4; band++) {
        uint32_t turn = plantGrowthTrait(signature, 70 + band);
        if (turn % 7u < 2u) drift--;
        else if (turn % 7u > 4u) drift++;
        drift = imax(-maxDrift, imin(maxDrift, drift));
      }
      return seedX + drift;
    };
    auto trunkWoodXAt = [&](int height) {
      int centerX = trunkXAt(height), y = seedY - height;
      const int offsets[3] = {0, -1, 1};
      for (int dx : offsets) {
        int x = centerX + dx;
        if (E.isInBounds(x, y) && E.L->grid[E.I(x, y)] == gWoodMat) return x;
      }
      return centerX;
    };
    // Branch tips can rise above the leader, so recover the leader height by
    // following its expected centerline rather than using the component's top.
    int leaderHeight = 0;
    for (int height = 1; height <= targetHeight; height++) {
      int y = seedY - height, centerX = trunkXAt(height);
      bool found = false;
      if (y >= 0) for (int dx = -1; dx <= 1; dx++) {
        int x = centerX + dx;
        if (E.isInBounds(x, y) && E.L->grid[E.I(x, y)] == gWoodMat) { found = true; break; }
      }
      if (!found) break;
      leaderHeight = height;
    }
    topY = seedY - leaderHeight;
    auto growLeader = [&]() -> int {
      int nextHeight = leaderHeight + 1, centerX = trunkXAt(nextHeight);
      int previousX = trunkXAt(leaderHeight);
      int away = centerX >= previousX ? 1 : -1;
      int cand[3][2] = {{centerX, topY - 1}, {centerX - away, topY - 1}, {centerX + away, topY - 1}};
      for (int i = 0; i < 3; i++) {
        auto& pos = cand[i];
        int tx = pos[0], ty = pos[1];
        if (!E.isInBounds(tx, ty)) continue;
        int tk = E.I(tx, ty);
        if (i == 0 && reserved.count(tk)) return -1; // another addition already extends the leader this tick
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
      }
      return -1;
    };
    if (leaderHeight < targetHeight && (comp.woodCount < 10 || E.rand() < (gGrowType == PT_PINE ? 0.40 : 0.62))) {
      int leader = growLeader();
      if (leader >= 0) return leader;
    }

    if (gGrowType == PT_PINE) {
      // Each pine derives a stable but different branch plan from its seed/world
      // position. Gaps, left/right reach, missing limbs, and gentle bends vary,
      // while the average reach still tapers toward the crown.
      struct PineBranch { int level, left, right, leftBend, rightBend, leftStart, rightStart, leftAttach, rightAttach; } branches[10];
      int branchCount = 0, level = 2 + (int)(plantGrowthTrait(signature, 10) % 3u);
      while (branchCount < 10) {
        level += 2 + (int)(plantGrowthTrait(signature, 11 + branchCount) % 4u);
        if (level > targetHeight) break;
        int baseReach = imax(3, 4 + (targetHeight - level) * 6 / targetHeight);
        PineBranch& b = branches[branchCount]; b.level = level;
        int* reaches[2] = {&b.left, &b.right}; int* bends[2] = {&b.leftBend, &b.rightBend}; int* starts[2] = {&b.leftStart, &b.rightStart}; int* attaches[2] = {&b.leftAttach, &b.rightAttach};
        for (int side = 0; side < 2; side++) {
          uint32_t t = plantGrowthTrait(signature, 40 + branchCount * 7 + side * 3);
          int reach = imax(2, imin(11, baseReach + (int)(t % 5u) - 2));
          if ((t / 7u) % 100u < 12u) reach = 0;          // an occasional missing side
          else if ((t / 13u) % 100u < 24u) reach = imax(2, reach / 2); // or a short, broken-looking limb
          *reaches[side] = reach;
          uint32_t curve = plantGrowthTrait(signature, 41 + branchCount * 7 + side * 3);
          *bends[side] = curve % 10u < 6u ? 1 : curve % 10u == 9u ? -1 : 0; // mostly droop, rarely rise
          *starts[side] = 2 + (int)(plantGrowthTrait(signature, 42 + branchCount * 7 + side * 3) % 3u);
          *attaches[side] = (int)(plantGrowthTrait(signature, 43 + branchCount * 7 + side * 3) % 3u) - 1;
        }
        branchCount++;
      }
      int start = branchCount ? (int)(E.rand() * branchCount) % branchCount : 0;
      for (int bi = 0; bi < branchCount; bi++) {
        PineBranch& b = branches[(start + bi) % branchCount];
        if (b.level > leaderHeight) continue;
        int firstSide = E.rand() < 0.5 ? 0 : 1;
        for (int si = 0; si < 2; si++) {
          int side = si ? 1 - firstSide : firstSide;
          int dir = side ? 1 : -1, reach = side ? b.right : b.left;
          int bend = side ? b.rightBend : b.leftBend, bendStart = side ? b.rightStart : b.leftStart;
          int attach = side ? b.rightAttach : b.leftAttach;
          int branchLevel = imax(2, imin(targetHeight, b.level + attach));
          if (branchLevel > leaderHeight) continue;
          int baseX = trunkWoodXAt(branchLevel), baseY = seedY - branchLevel;
          for (int d = 1; d <= reach; d++) {
            int curve = d > bendStart ? (d - bendStart + 1) / 2 : 0;
            int tx = baseX + dir * d, ty = baseY + bend * curve;
            if (!E.isInBounds(tx, ty)) break;
            int tk = E.I(tx, ty);
            if (E.L->grid[tk] == PINE_WOOD || reserved.count(tk)) continue;
            if (E.L->grid[tk] == EMPTY) return tk;
            break;
          }
        }
      }
    } else {
      // A willow carries a handful of long limbs high on its leader. Foliage
      // later hangs from this upper scaffold instead of budding along the lower
      // trunk like a sapling-shaped column.
      struct WillowBranch { int level, left, right, leftDrop, rightDrop; } branches[5];
      int branchCount = 0;
      for (int bi = 0; bi < 5; bi++) {
        int level = targetHeight - 18 + bi * 4 + (int)(plantGrowthTrait(signature, 10 + bi) % 3u) - 1;
        if (level < targetHeight / 2 || level >= targetHeight) continue;
        WillowBranch& b = branches[branchCount++]; b.level = level;
        b.left = 7 + (int)(plantGrowthTrait(signature, 50 + bi * 4) % 6u);
        b.right = 7 + (int)(plantGrowthTrait(signature, 51 + bi * 4) % 6u);
        b.leftDrop = 1 + (int)(plantGrowthTrait(signature, 52 + bi * 4) % 3u);
        b.rightDrop = 1 + (int)(plantGrowthTrait(signature, 53 + bi * 4) % 3u);
      }
      int start = branchCount ? (int)(E.rand() * branchCount) % branchCount : 0;
      for (int bi = 0; bi < branchCount; bi++) {
        WillowBranch& b = branches[(start + bi) % branchCount];
        if (b.level > leaderHeight) continue;
        int firstSide = E.rand() < 0.5 ? 0 : 1;
        for (int si = 0; si < 2; si++) {
          int side = si ? 1 - firstSide : firstSide;
          int dir = side ? 1 : -1, reach = side ? b.right : b.left;
          if (reach <= 0) continue;
          int branchLevel = b.level;
          if (branchLevel > leaderHeight) continue;
          int baseX = trunkWoodXAt(branchLevel), baseY = seedY - branchLevel;
          bool branchComplete = true;
          for (int d = 1; d <= reach; d++) {
            int lift = imin(3, (d + 1) / 3);
            int droop = d > reach * 2 / 3 ? (d - reach * 2 / 3 + 1) / 2 : 0;
            int tx = baseX + dir * d, ty = baseY - lift + droop;
            if (!E.isInBounds(tx, ty)) { branchComplete = false; break; }
            int tk = E.I(tx, ty);
            if (E.L->grid[tk] == WOOD || reserved.count(tk)) continue;
            if (E.L->grid[tk] == EMPTY) return tk;
            branchComplete = false; break;
          }
          if (!branchComplete) continue;
          int tipX = baseX + dir * reach;
          int tipLift = imin(3, (reach + 1) / 3);
          int tipCurve = reach > reach * 2 / 3 ? (reach - reach * 2 / 3 + 1) / 2 : 0;
          int tipY = baseY - tipLift + tipCurve, tipDrop = side ? b.rightDrop : b.leftDrop;
          for (int drop = 1; drop <= tipDrop; drop++) {
            if (!E.isInBounds(tipX, tipY + drop)) break;
            int tk = E.I(tipX, tipY + drop);
            if (E.L->grid[tk] == WOOD || reserved.count(tk)) continue;
            if (E.L->grid[tk] == EMPTY) return tk;
            break;
          }
        }
      }
    }
    if (leaderHeight < targetHeight) return growLeader();
    return -1;
  }
  if (gGrowType == PT_CACTUS && !comp.woodCells.empty()) {
    // Two staggered arm windows interrupt the tall central column. Repeated calls
    // in one growth tick walk outward, then turn the arm upward at its tip.
    bool armWindow = comp.woodCount >= 9 && comp.woodCount < 27 && (comp.woodCount % 8) >= 4;
    if (armWindow) {
      int dir = ((comp.woodCount / 8) & 1) ? 1 : -1;
      int source = comp.woodCells[imin((int)comp.woodCells.size() - 1, 3 + comp.woodCount / 3)];
      int y = source / E.cols, x = source - y * E.cols;
      for (int d = 1; d <= 3; d++) {
        int tx = x + dir * d;
        if (!E.isInBounds(tx, y)) break;
        int tk = E.I(tx, y);
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
        if (E.L->grid[tk] != CACTUS && !reserved.count(tk)) break;
        if (d == 3 && E.isInBounds(tx, y - 1)) {
          int up = E.I(tx, y - 1);
          if (E.L->grid[up] == EMPTY && !reserved.count(up)) return up;
        }
      }
    }
  }
  bool straight = growStraight();
  for (int source : sources) {
    int y = source / E.cols, x = source - y * E.cols;
    bool branchReady = comp.woodCount > 16; int branchDir = E.rand() < 0.5 ? -1 : 1;
    int cand[5][2]; int nc;
    if (straight) { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; nc = 3; } // strongly vertical: pine/cactus/mushroom
    else if (branchReady && E.rand() < 0.55) { cand[0][0] = x + branchDir; cand[0][1] = y - 1; cand[1][0] = x + branchDir * 2; cand[1][1] = y - 1; cand[2][0] = x + branchDir; cand[2][1] = y; cand[3][0] = x; cand[3][1] = y - 1; cand[4][0] = x - branchDir; cand[4][1] = y - 1; nc = 5; }
    else { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; cand[3][0] = x - 1; cand[3][1] = y; cand[4][0] = x + 1; cand[4][1] = y; nc = 5; }
    for (int i = 0; i < nc; i++) { int tx = cand[i][0], ty = cand[i][1]; if (!E.isInBounds(tx, ty)) continue; int tk = E.I(tx, ty); if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
  }
  return -1;
}
bool GrowthSystem::addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
  if (k < 0 || k >= E.cols * E.rows || E.L->grid[k] != EMPTY || reserved.count(k)) return false;
  growth.push_back({k, gWoodMat}); reserved.insert(k); return true;
}
void GrowthSystem::thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
  if (gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM || gGrowType == PT_VINE) return;
  if (gGrowType == PT_OAK || gGrowType == PT_PINE || gGrowType == PT_WILLOW) {
    // Only thicken a newly-extended leader, never a lateral limb. A broad,
    // irregular base tapers to a single-cell crown so pines and willows gain the
    // oak's visual weight without losing their characteristic outlines.
    int seed = comp.cells.empty() ? k : comp.cells.front();
    for (int ck : comp.cells) if (E.L->grid[ck] == SEED) { seed = ck; break; }
    int seedY = seed / E.cols, y = k / E.cols, x = k - y * E.cols;
    int currentTopY = comp.woodCells.empty() ? seedY : comp.woodCells.front() / E.cols;
    int height = seedY - y, thickHeight = gGrowType == PT_OAK ? 23 : gGrowType == PT_PINE ? 19 : 24;
    if (y >= currentTopY || height > thickHeight) return;
    int firstDir = E.rand() < 0.5 ? -1 : 1;
    auto addSide = [&](int tx) { return E.isInBounds(tx, y) && addWoodIfOpen(E.I(tx, y), growth, reserved); };
    addSide(x + firstDir);
    float oppositeP = gGrowType == PT_OAK ? 0.94f : gGrowType == PT_PINE ? 0.78f : 0.88f;
    if (E.rand() < oppositeP) addSide(x - firstDir);
    float wideBaseP = gGrowType == PT_OAK ? 0.78f : 0.55f;
    if (height <= (gGrowType == PT_OAK ? 8 : 5) && E.rand() < wideBaseP) addSide(x + firstDir * 2);
    return;
  }
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
  if (gGrowType == PT_MUSHROOM) {
    // Build one broad, domed cap around the top of the stem instead of sprinkling
    // cap cells down its full height.
    int source = comp.woodCells.front(), y = source / E.cols, x = source - y * E.cols;
    std::vector<int> candidates;
    for (int dy = -2; dy <= 2; dy++) {
      int radius = 5 - std::abs(dy) * 2;
      for (int dx = -radius; dx <= radius; dx++) {
        int tx = x + dx, ty = y + dy;
        if (!E.isInBounds(tx, ty)) continue;
        int tk = E.I(tx, ty);
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) candidates.push_back(tk);
      }
    }
    if (candidates.empty()) return -1;
    return candidates[(int)(E.rand() * candidates.size()) % candidates.size()];
  }
  if (gGrowType == PT_VINE) {
    // Glowberries bud beside mature lower segments so they read as fruit rather
    // than replacing the strand itself.
    for (auto it = comp.woodCells.rbegin(); it != comp.woodCells.rend(); ++it) {
      int source = *it, y = source / E.cols, x = source - y * E.cols;
      int dir = E.rand() < 0.5 ? -1 : 1;
      int tx[2] = {x + dir, x - dir};
      for (int bx : tx) {
        if (!E.isInBounds(bx, y)) continue;
        int tk = E.I(bx, y);
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
      }
    }
    return -1;
  }
  if (gGrowType == PT_WILLOW) {
    // Grow vertical curtains beneath the willow's lateral wood. Continuing
    // through existing leaves lengthens individual strands instead of packing
    // a generic round canopy around the trunk.
    int seed = comp.woodCells.back();
    for (int k : comp.cells) if (E.L->grid[k] == SEED) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    uint32_t signature = plantGrowthSignature(comp);
    int targetHeight = 40 + (int)(plantGrowthTrait(signature, 0) % 9u);
    int branchSourceY = seedY - targetHeight / 2;
    int start = (int)(E.rand() * comp.woodCells.size()) % comp.woodCells.size();
    int step = E.rand() < 0.5 ? 1 : -1;
    if (E.rand() < 0.18) {
      // Build loose leaf clusters around the upper limbs, borrowing the oak's
      // broken canopy texture before most growth is spent on hanging strands.
      int crownY = comp.woodCells.front() / E.cols;
      for (int ci = 0; ci < (int)comp.woodCells.size(); ci++) {
        int source = comp.woodCells[((start + ci * step) % comp.woodCells.size() + comp.woodCells.size()) % comp.woodCells.size()];
        int y = source / E.cols, x = source - y * E.cols;
        if (y > branchSourceY) continue;
        if (std::abs(x - seedX) < 2 && y > crownY + 7) continue;
        int cand[8][2] = {{x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x, y - 1}, {x - 1, y + 1}, {x + 1, y + 1}, {x, y + 1}};
        int first = (int)(E.rand() * 8.0) % 8;
        for (int i = 0; i < 8; i++) {
          int tx = cand[(first + i) % 8][0], ty = cand[(first + i) % 8][1];
          if (ty > branchSourceY + 1) continue;
          if (!E.isInBounds(tx, ty)) continue;
          int tk = E.I(tx, ty);
          if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
        }
      }
    }
    for (int ci = 0; ci < (int)comp.woodCells.size(); ci++) {
      int source = comp.woodCells[((start + ci * step) % comp.woodCells.size() + comp.woodCells.size()) % comp.woodCells.size()];
      int y = source / E.cols, x = source - y * E.cols;
      if (y > branchSourceY) continue;
      int outward = std::abs(x - seedX);
      if (outward < 6) continue;
      uint32_t strand = plantGrowthTrait(signature,
        (uint32_t)(E.L->worldOffsetX + x) * 31u + (uint32_t)(E.L->worldOffsetY + y) * 17u);
      if (strand % 13u == 0u) continue; // small gaps keep neighboring curtains from merging into a wall
      int maxDrop = imin(18, 7 + (int)(strand % 9u) + outward / 4);
      int sway = (int)((strand >> 8) % 3u) - 1;
      for (int drop = 1; drop <= maxDrop; drop++) {
        int tx = x + (drop > maxDrop / 2 ? sway : 0), ty = y + drop;
        if (!E.isInBounds(tx, ty)) break;
        int tk = E.I(tx, ty);
        if (E.L->grid[tk] == WILLOW_LEAF || reserved.count(tk)) continue;
        if (E.L->grid[tk] == EMPTY) return tk;
        break;
      }
    }
    int crown = comp.woodCells.front(), y = crown / E.cols, x = crown - y * E.cols;
    int cand[6][2] = {{x - 1, y}, {x + 1, y}, {x, y - 1}, {x, y + 1}, {x - 1, y + 1}, {x + 1, y + 1}};
    for (auto& pos : cand) {
      int tx = pos[0], ty = pos[1];
      if (!E.isInBounds(tx, ty)) continue;
      int tk = E.I(tx, ty);
      if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
    }
    return -1;
  }
  if (gGrowType == PT_PINE) {
    // Sample the whole branch skeleton instead of always starting at the crown;
    // needles trace the wide lower tiers as well as the leader.
    int start = (int)(E.rand() * comp.woodCells.size()) % comp.woodCells.size();
    int step = E.rand() < 0.5 ? 1 : -1;
    for (int ci = 0; ci < (int)comp.woodCells.size(); ci++) {
      int source = comp.woodCells[((start + ci * step) % comp.woodCells.size() + comp.woodCells.size()) % comp.woodCells.size()];
      int y = source / E.cols, x = source - y * E.cols;
      int cand[18][2] = {{x, y - 1}, {x, y + 1}, {x - 1, y}, {x + 1, y},
        {x - 1, y - 1}, {x + 1, y - 1}, {x - 1, y + 1}, {x + 1, y + 1},
        {x - 2, y - 1}, {x + 2, y - 1}, {x - 2, y + 1}, {x + 2, y + 1},
        {x - 2, y}, {x + 2, y}, {x - 3, y}, {x + 3, y}, {x, y - 2}, {x, y + 2}};
      int first = (int)(E.rand() * 18.0) % 18;
      for (int i = 0; i < 18; i++) {
        int tx = cand[(first + i) % 18][0], ty = cand[(first + i) % 18][1];
        if (!E.isInBounds(tx, ty)) continue;
        int tk = E.I(tx, ty);
        if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk;
      }
    }
    return -1;
  }
  if (gGrowType == PT_OAK) {
    // Fill an irregular oval around the leader and upper forks. Growing only
    // from existing crown cells keeps every addition connected while producing
    // one large, dense green crown instead of leaves scattered down the trunk.
    int seed = comp.cells.front();
    for (int k : comp.cells) if (E.L->grid[k] == SEED) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    uint32_t signature = plantGrowthSignature(comp);
    int targetHeight = oakTargetHeight(signature);
    int radiusX = 16 + (int)(plantGrowthTrait(signature, 4) % 3u);
    int radiusY = 10 + (int)(plantGrowthTrait(signature, 5) % 3u);
    int centerX = seedX, centerY = seedY - targetHeight + 3;
    std::vector<int> candidates; std::unordered_set<int> seen;
    const int dirs[8][2] = {{-1,-1},{0,-1},{1,-1},{-1,0},{1,0},{-1,1},{0,1},{1,1}};
    for (int source : comp.cells) {
      uint8_t sourceMat = E.L->grid[source];
      if (sourceMat != gWoodMat && sourceMat != gLeafMat) continue;
      int y = source / E.cols, x = source - y * E.cols;
      if (y > centerY + radiusY + 1) continue;
      for (auto& dir : dirs) {
        int tx = x + dir[0], ty = y + dir[1];
        if (!E.isInBounds(tx, ty)) continue;
        int dx = tx - centerX, dy = ty - centerY;
        int shape = dx * dx * radiusY * radiusY + dy * dy * radiusX * radiusX;
        int limit = radiusX * radiusX * radiusY * radiusY;
        if (shape > limit) continue;
        uint32_t edge = plantGrowthTrait(signature, (uint32_t)(tx + E.L->worldOffsetX) * 31u + (uint32_t)(ty + E.L->worldOffsetY) * 17u);
        if (shape * 100 > limit * 76 && edge % 100u < 24u) continue;
        int tk = E.I(tx, ty);
        if (E.L->grid[tk] != EMPTY || reserved.count(tk) || !seen.insert(tk).second) continue;
        candidates.push_back(tk);
      }
    }
    if (candidates.empty()) return -1;
    return candidates[(int)(E.rand() * candidates.size()) % candidates.size()];
  }
  for (int source : comp.woodCells) {
    int y = source / E.cols, x = source - y * E.cols;
    int cand[11][2] = {{x, y - 1}, {x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y}, {x + 2, y}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y}, {x + 3, y}};
    if (gGrowType == PT_MUSHROOM) { int mc[11][2] = {{x, y - 1}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y - 1}, {x + 3, y - 1}, {x - 2, y}, {x + 2, y}, {x - 3, y}, {x + 3, y}}; std::memcpy(cand, mc, sizeof cand); } // wide flat cap
    int start = (int)(E.rand() * 11); int step = E.rand() < 0.5 ? 1 : -1;
    for (int i = 0; i < 11; i++) { int idx = ((start + i * step) % 11 + 11) % 11; int tx = cand[idx][0], ty = cand[idx][1]; if (!E.isInBounds(tx, ty)) continue; int tk = E.I(tx, ty); if (E.L->grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
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
    // Species materials + per-type caps. PT_STANDARD keeps the original caps.
    gGrowType = comp.plantType; gWoodMat = E.plantWoodMat(gGrowType); gLeafMat = E.plantLeafMat(gGrowType);
    uint32_t growthSignature = plantGrowthSignature(comp);
    int maxWood = gGrowType == PT_BUSH ? 14 : gGrowType == PT_MUSHROOM ? 13 : gGrowType == PT_CACTUS ? 34 : gGrowType == PT_VINE ? 40 : gGrowType == PT_OAK ? 220 + (int)(plantGrowthTrait(growthSignature, 2) % 31u) : gGrowType == PT_PINE ? 104 + (int)(plantGrowthTrait(growthSignature, 2) % 30u) : gGrowType == PT_WILLOW ? 205 + (int)(plantGrowthTrait(growthSignature, 2) % 31u) : MAX_WOOD_CELLS;
    int maxLeaf = gGrowType == PT_MUSHROOM ? 28 : gGrowType == PT_BUSH ? 38 : gGrowType == PT_VINE ? 9 : gGrowType == PT_OAK ? 480 + (int)(plantGrowthTrait(growthSignature, 3) % 71u) : gGrowType == PT_PINE ? 230 + (int)(plantGrowthTrait(growthSignature, 3) % 81u) : gGrowType == PT_WILLOW ? 240 + (int)(plantGrowthTrait(growthSignature, 3) % 61u) : MAX_LEAF_CELLS;
    int leafStart = gGrowType == PT_MUSHROOM ? 11 : gGrowType == PT_BUSH ? 3 : gGrowType == PT_VINE ? 8 : gGrowType == PT_OAK ? 36 : (gGrowType == PT_PINE || gGrowType == PT_WILLOW) ? 5 : 6;
    bool leaves = gGrowType != PT_CACTUS;                  // cactus has no foliage
    // Water requirement intentionally disabled for every seed. Restore the old
    // species gate below to make normal trees/bushes drink again; the complete
    // search, wake, and consumption path remains immediately below.
    // bool needsWater = !(gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM || gGrowType == PT_VINE);
    bool needsWater = false;
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
    bool variedTree = gGrowType == PT_PINE || gGrowType == PT_WILLOW;
    bool finishStemFirst = gGrowType == PT_OAK || gGrowType == PT_CACTUS || gGrowType == PT_MUSHROOM || gGrowType == PT_VINE;
    bool shouldGrowWood = comp.woodCount < maxWood && (finishStemFirst || comp.woodCount < leafStart || E.rand() > (variedTree ? 0.44 : LEAF_GROWTH_P));
    bool woodBlocked = false;
    if (shouldGrowWood) {
      int firstWood = tryGrowWood(comp, reserved);
      woodBlocked = firstWood < 0;
      if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) thickenTrunkAround(firstWood, comp, growth, reserved);
      int extraWood = tryGrowWood(comp, reserved);
      if (gGrowType != PT_VINE && extraWood >= 0 && E.rand() < 0.72) addWoodIfOpen(extraWood, growth, reserved);
    }
    bool vineBerriesNow = gGrowType == PT_VINE && !growth.empty() && E.rand() < 0.22;
    bool foliageAlongsideWood = variedTree && !growth.empty() && E.rand() < 0.38;
    bool leafBlocked = false;
    if (leaves && (growth.empty() || vineBerriesNow || foliageAlongsideWood) && comp.woodCount >= leafStart && comp.leafCount < maxLeaf) {
      int leafCount = gGrowType == PT_VINE ? 1 : gGrowType == PT_PINE ? (E.rand() < 0.45 ? 2 : 1) : E.rand() < 0.35 ? 2 : 1;
      leafCount = imin(leafCount, maxLeaf - comp.leafCount);
      int leavesBefore = (int)growth.size();
      for (int i = 0; i < leafCount; i++) { int leafK = tryGrowLeaf(comp, reserved); if (leafK >= 0) { growth.push_back({leafK, gLeafMat}); reserved.insert(leafK); } }
      leafBlocked = (int)growth.size() == leavesBefore;
    }
    if (growth.empty()) {
      if ((woodBlocked || comp.woodCount >= maxWood) && (!leaves || leafBlocked || comp.leafCount >= maxLeaf)) comp.growing = false;
      continue;
    }
    for (int wk : waterCells) E.writeGridIndex(wk, EMPTY);
    // push_back (not a set insert) is safe: the EMPTY guard above means each targetK is written once, so no cell is added to comp.cells twice.
    for (auto& g : growth) { int targetK = g.first; uint8_t material = g.second; if (E.L->grid[targetK] != EMPTY) continue; E.writeGridIndex(targetK, material); comp.cells.push_back(targetK); int y = targetK / E.cols; if (y > comp.yMax) comp.yMax = y; if (E.isPlantWood(material)) comp.woodCount++; else comp.leafCount++; comp.cacheDirty = true; }
  }
}

int GrowthSystem::myceliumNeighbourCount(int k) {
  int y = k / E.cols, x = k - y * E.cols, n = 0;
  for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    int nx = x + ox, ny = y + oy;
    if (!E.isInBounds(nx, ny)) continue;
    if (E.isMyceliumMaterial(E.L->grid[E.I(nx, ny)])) n++;
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
    if (!E.isMyceliumMaterial(E.L->grid[source])) continue;
    int sourceNeighbours = myceliumNeighbourCount(source);
    if (sourceNeighbours > (branch ? 2 : 1)) continue;
    int y = source / E.cols, x = source - y * E.cols;
    int startDir = (int)(E.rand() * 8.0); if (startDir < 0) startDir = 0; if (startDir > 7) startDir = 7;
    for (int di = 0; di < 8; di++) {
      const int* d = dirs[(startDir + di) & 7];
      int nx = x + d[0], ny = y + d[1];
      if (!E.isInBounds(nx, ny)) continue;
      int nk = E.I(nx, ny);
      if (E.isBodyCell(nk) || E.L->grid[nk] != STONE) continue;
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
  for (int k : comp.cells) if (E.L->grid[k] == MYCELIUM_SPORE) return true;
  return false;
}

bool GrowthSystem::myceliumCompTouchesStone(Comp& comp) {
  for (int k : comp.cells) {
    if (!E.isMyceliumMaterial(E.L->grid[k])) continue;
    int y = k / E.cols, x = k - y * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = x + ox, ny = y + oy;
      if (!E.isInBounds(nx, ny)) continue;
      if (E.L->grid[E.I(nx, ny)] == STONE) return true;
    }
  }
  return false;
}

void GrowthSystem::refreshDormantMyceliumComponents() {
  bool active = false;
  bool present = false;
  for (auto& comp : E.L->stoneComponents) {
    if (!myceliumCompHasSpore(comp)) { comp.growing = false; continue; }
    present = true;
    if ((int)comp.cells.size() >= MYCELIUM_MAX_CELLS) { comp.growing = false; continue; }
    if (!comp.growing && myceliumCompTouchesStone(comp)) { comp.growing = true; comp.age = 0; }
    if (comp.growing) active = true;
  }
  E.L->myceliumSporePresent = present;
  E.L->myceliumActive = active;
}

void GrowthSystem::growMyceliumComponents() {
  if (!E.L->myceliumSporePresent) { E.L->myceliumActive = false; return; }
  if (E.L->stoneComponents.empty()) {
    E.L->myceliumActive = false;
    E.L->myceliumSporePresent = false;
    return;
  }
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
    if (E.L->grid[g.targetK] != STONE || E.isBodyCell(g.targetK)) continue;
    E.writeGridIndex(g.targetK, MYCELIUM);
    converted.push_back(g.targetK);
  }
  if (converted.empty()) return;

  E.splitRigidAfterErase(E.L->stoneComponents, converted, E.L->nextStoneId, false);
  for (const MycGrowth& g : growth) {
    if (E.L->grid[g.targetK] != MYCELIUM) continue;
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
