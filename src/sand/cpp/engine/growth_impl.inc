// Plant and organic growth.
// Trees, cacti, mushrooms, kelp, and vines grow as plant components. Species
// selects trunk/foliage materials and shape; component registration and grounding
// remain in ComponentSystem.
bool GrowthSystem::growStraight() { return gGrowth->straight; }
bool GrowthSystem::findWaterTouching(Comp& comp, int count, std::vector<int>& picked) {
  std::vector<int> candidates; std::unordered_set<int> seen;
  auto consider = [&](int nk) { if (E.L->grid[nk] != WATER || seen.count(nk)) return; seen.insert(nk); candidates.push_back(nk); };
  for (int k : comp.cells) { uint8_t m = E.L->grid[k]; if (!E.isSeedMaterial(m) && !E.isPlantWood(m)) continue; int x = k % E.cols, y = k / E.cols; if (x < E.cols - 2) consider(k + 1); if (x > 1) consider(k - 1); if (y < E.rows - 1) consider(k + E.cols); if (y > 1) consider(k - E.cols); }
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
static inline int oakTargetHeight(uint32_t signature) { return 48 + (int)(plantGrowthTrait(signature, 0) % 11u); }
uint32_t GrowthSystem::plantGrowthSignature(Comp& comp) {
  int seed = comp.cells.empty() ? 0 : comp.cells.front();
  for (int k : comp.cells) if (E.isSeedMaterial(E.L->grid[k])) { seed = k; break; }
  int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
  uint32_t wx = (uint32_t)(E.L->worldOffsetX + seedX);
  uint32_t wy = (uint32_t)(E.L->worldOffsetY + seedY);
  return E.L->worldSeed ^ (wx * 0x85ebca6bu) ^ (wy * 0xc2b2ae35u) ^ ((uint32_t)comp.id * 0x27d4eb2du) ^ ((uint32_t)comp.plantType * 0x165667b1u);
}
void GrowthSystem::refreshPlantCache(Comp& comp) {
  if (!comp.cacheDirty && !comp.woodCells.empty()) return;
  comp.woodCells.clear(); comp.seedWoodCells.clear();
  for (int k : comp.cells) { uint8_t m = E.L->grid[k]; if (E.isPlantWood(m)) { comp.woodCells.push_back(k); comp.seedWoodCells.push_back(k); } else if (E.isSeedMaterial(m)) comp.seedWoodCells.push_back(k); }
  auto byRow = [this](int a, int b) { return (a / E.cols) < (b / E.cols); };
  std::stable_sort(comp.woodCells.begin(), comp.woodCells.end(), byRow);
  std::stable_sort(comp.seedWoodCells.begin(), comp.seedWoodCells.end(), byRow);
  comp.cacheDirty = false;
}
bool GrowthSystem::willowGravityLeader(
    Comp& comp, int seed, std::vector<int>& leader) {
  leader.clear();
  if (comp.woodCells.empty()) return false;
  int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
  // Recover the longest upward run from the actual raster. Its lower endpoint
  // is the stable bend point after a fall, while an upright tree naturally
  // yields its original trunk. Branch tips cannot steal the leader merely by
  // rising a few cells above it because the longest connected run wins.
  std::unordered_map<int, int> downLength;
  downLength.reserve(comp.woodCells.size() * 2);
  int minX = E.cols, maxX = -1, minY = E.rows, maxY = -1;
  for (auto it = comp.woodCells.rbegin(); it != comp.woodCells.rend(); ++it) {
    int k = *it, y = k / E.cols, x = k - y * E.cols, length = 1;
    minX = imin(minX, x); maxX = imax(maxX, x);
    minY = imin(minY, y); maxY = imax(maxY, y);
    if (y + 1 < E.rows) for (int dx = -1; dx <= 1; dx++) {
      int nx = x + dx;
      if (nx < 0 || nx >= E.cols) continue;
      auto below = downLength.find(E.I(nx, y + 1));
      if (below != downLength.end()) length = imax(length, below->second + 1);
    }
    downLength[k] = length;
  }
  bool fallenSideways = maxX - minX > maxY - minY;
  int maxRun = 0;
  for (const auto& entry : downLength) maxRun = imax(maxRun, entry.second);
  bool startingSideways = fallenSideways && maxRun < 8;
  int top = -1, topScore = startingSideways ? -1 : INT32_MAX;
  for (int k : comp.woodCells) {
    int run = downLength[k];
    if (run + 2 < maxRun) continue;
    int y = k / E.cols;
    int x = k - y * E.cols, dx = x - seedX, dy = y - seedY;
    int score = startingSideways ? dx * dx + dy * dy
                                 : y * 4 + std::abs(dx) * 2;
    if ((startingSideways && score > topScore)
        || (!startingSideways && score < topScore)) {
      top = k;
      topScore = score;
    }
  }
  if (top < 0) return false;
  leader.push_back(top);
  while (downLength[top] > 1) {
    int y = top / E.cols, x = top - y * E.cols;
    int next = -1, want = downLength[top] - 1;
    for (int dx = -1; dx <= 1; dx++) {
      int nx = x + dx;
      if (nx < 0 || nx >= E.cols || y + 1 >= E.rows) continue;
      int candidate = E.I(nx, y + 1);
      auto below = downLength.find(candidate);
      if (below != downLength.end() && below->second == want) {
        next = candidate;
        break;
      }
    }
    if (next < 0) break;
    top = next;
    leader.push_back(top);
  }
  std::reverse(leader.begin(), leader.end());
  return true;
}
int GrowthSystem::tryGrowWood(Comp& comp, std::unordered_set<int>& reserved) {
  refreshPlantCache(comp);
  std::vector<int>& sources = !comp.woodCells.empty() ? comp.woodCells : comp.seedWoodCells;
  if (gGrowth->woodTopology == PGW_VINE) {
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
        if (plantTargetOpen(tk, reserved)) return tk;
      }
    }
    return -1;
  }
  if ((gGrowth->woodTopology == PGW_OAK || gGrowth->woodTopology == PGW_BRANCHING) && !sources.empty()) {
    // Broadleaf trees establish a wandering leader and staggered spreading forks.
    // The stable scaffold reserves room for both limbs and the tapered trunk.
    int seed = sources.back();
    for (int k : comp.cells) if (E.isSeedMaterial(E.L->grid[k])) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    uint32_t signature = plantGrowthSignature(comp);
    bool branching = gGrowth->woodTopology == PGW_BRANCHING;
    int targetHeight = branching ? 38 + (int)(plantGrowthTrait(signature, 0) % 9u) : oakTargetHeight(signature);
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
        if (plantTargetOpen(tk, reserved)) return tk;
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
      int level = targetHeight - (branching ? 26 : 22) + bi * 5 + (int)(plantGrowthTrait(signature, 10 + bi) % 3u) - 1;
      if (level < 12 || level >= targetHeight) continue;
      OakBranch& b = branches[branchCount++]; b.level = level;
      b.left = (branching ? 9 : 12) + (int)(plantGrowthTrait(signature, 30 + bi * 4) % 6u);
      b.right = (branching ? 9 : 12) + (int)(plantGrowthTrait(signature, 31 + bi * 4) % 6u);
      b.leftRise = (branching ? 5 : 3) + (int)(plantGrowthTrait(signature, 32 + bi * 4) % 3u);
      b.rightRise = (branching ? 5 : 3) + (int)(plantGrowthTrait(signature, 33 + bi * 4) % 3u);
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
          if (plantTargetOpen(tk, reserved)) return tk;
          break;
        }
      }
    }
    if (leaderHeight < targetHeight) return growLeader();
    // Complete tapered buttresses from the ground upward, including leader
    // rows placed by the extra growth step.
    for (int height = 1; height < targetHeight - 8; height++) {
      int radius = branching ? (height < 18 ? 1 : 0)
        : (height < 9 ? 3 : height < 30 ? 2 : 1);
      for (int d = 1; d <= radius; d++) for (int dir : {-1, 1}) {
        int x = trunkXAt(height) + d * dir, y = seedY - height;
        if (E.isInBounds(x, y) && plantTargetOpen(E.I(x, y), reserved)) return E.I(x, y);
      }
    }
    return -1;
  }
  if ((gGrowth->woodTopology == PGW_PINE
       || gGrowth->woodTopology == PGW_WILLOW) && !sources.empty()) {
    // Pines and willows keep a recognizable leader, but it wanders gradually
    // like the oak's organic trunk instead of growing up a ruler-straight line.
    // Their remaining wood still preserves the species silhouette: tapered pine
    // tiers and broad, arching willow limbs.
    int seed = sources.back();
    for (int k : comp.cells) if (E.isSeedMaterial(E.L->grid[k])) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    int topY = !comp.woodCells.empty() ? comp.woodCells.front() / E.cols : seedY;
    uint32_t signature = plantGrowthSignature(comp);
    int targetHeight = gGrowth->woodTopology == PGW_PINE
      ? 48 + (int)(plantGrowthTrait(signature, 0) % 16u)
      : 62 + (int)(plantGrowthTrait(signature, 0) % 15u);
    auto trunkXAt = [&](int height) {
      int drift = 0,
          maxDrift = gGrowth->woodTopology == PGW_PINE ? 2 : 3;
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
    bool recovering = gGrowth->woodTopology == PGW_WILLOW && gWillowGravity;
    if (recovering) {
      leaderHeight = (int)gWillowLeader.size() - 1;
      topY = gWillowLeader.back() / E.cols;
    } else {
      topY = seedY - leaderHeight;
    }
    auto growLeader = [&]() -> int {
      if (recovering) {
        int top = gWillowLeader.back();
        int y = top / E.cols, x = top - y * E.cols;
        int nextHeight = leaderHeight + 1, bend = 0;
        if ((nextHeight & 3) == 0) {
          uint32_t turn = plantGrowthTrait(signature, 70 + nextHeight / 4);
          bend = turn % 7u < 2u ? -1 : turn % 7u > 4u ? 1 : 0;
        }
        int offsets[3] = {bend, bend < 0 ? 0 : -1, bend > 0 ? 0 : 1};
        for (int i = 0; i < 3; i++) {
          int tx = x + offsets[i], ty = y - 1;
          if (!E.isInBounds(tx, ty)) continue;
          int tk = E.I(tx, ty);
          if (i == 0 && reserved.count(tk)) return -1;
          if (plantTargetOpen(tk, reserved)) return tk;
        }
        return -1;
      }
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
        if (plantTargetOpen(tk, reserved)) return tk;
      }
      return -1;
    };
    if (leaderHeight < targetHeight
        && (comp.woodCount < 10
            || E.rand() < (gGrowth->woodTopology == PGW_PINE ? 0.40 : 0.62))) {
      int leader = growLeader();
      if (leader >= 0) return leader;
    }

    if (gGrowth->woodTopology == PGW_PINE) {
      // Each pine derives a stable but different branch plan from its seed/world
      // position. Gaps, left/right reach, missing limbs, and gentle bends vary,
      // while the average reach still tapers toward the crown.
      struct PineBranch { int level, left, right, leftBend, rightBend, leftStart, rightStart, leftAttach, rightAttach; } branches[15];
      int branchCount = 0, level = 2 + (int)(plantGrowthTrait(signature, 10) % 3u);
      while (branchCount < 15) {
        level += 3 + (int)(plantGrowthTrait(signature, 11 + branchCount) % 4u);
        if (level > targetHeight) break;
        int baseReach = imax(3, 6 + (targetHeight - level) * 9 / targetHeight);
        PineBranch& b = branches[branchCount]; b.level = level;
        int* reaches[2] = {&b.left, &b.right}; int* bends[2] = {&b.leftBend, &b.rightBend}; int* starts[2] = {&b.leftStart, &b.rightStart}; int* attaches[2] = {&b.leftAttach, &b.rightAttach};
        for (int side = 0; side < 2; side++) {
          uint32_t t = plantGrowthTrait(signature, 40 + branchCount * 7 + side * 3);
          int reach = imax(2, imin(17, baseReach + (int)(t % 5u) - 2));
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
            if (E.L->grid[tk] == gWoodMat || reserved.count(tk)) continue;
            if (plantTargetOpen(tk, reserved)) return tk;
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
        int level = targetHeight - 26 + bi * 6 + (int)(plantGrowthTrait(signature, 10 + bi) % 3u) - 1;
        if (level < targetHeight / 2 || level >= targetHeight) continue;
        WillowBranch& b = branches[branchCount++]; b.level = level;
        b.left = 12 + (int)(plantGrowthTrait(signature, 50 + bi * 4) % 6u);
        b.right = 12 + (int)(plantGrowthTrait(signature, 51 + bi * 4) % 6u);
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
          int baseX, baseY;
          if (recovering) {
            int base = gWillowLeader[branchLevel];
            baseY = base / E.cols;
            baseX = base - baseY * E.cols;
          } else {
            baseX = trunkWoodXAt(branchLevel);
            baseY = seedY - branchLevel;
          }
          bool branchComplete = true;
          for (int d = 1; d <= reach; d++) {
            int lift = imin(3, (d + 1) / 3);
            int droop = d > reach * 2 / 3 ? (d - reach * 2 / 3 + 1) / 2 : 0;
            int tx = baseX + dir * d, ty = baseY - lift + droop;
            if (!E.isInBounds(tx, ty)) { branchComplete = false; break; }
            int tk = E.I(tx, ty);
            if (E.L->grid[tk] == gWoodMat || reserved.count(tk)) continue;
            if (plantTargetOpen(tk, reserved)) return tk;
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
            if (E.L->grid[tk] == gWoodMat || reserved.count(tk)) continue;
            if (plantTargetOpen(tk, reserved)) return tk;
            break;
          }
        }
      }
      if (recovering) {
        // A fall can leave the newly planned limb coordinates occupied by the
        // old crown. Continue from exposed upper wood instead, biased outward
        // and bounded to the willow's normal crown width.
        int frameBase = gWillowLeader.front();
        int frameBaseY = frameBase / E.cols;
        int frameBaseX = frameBase - frameBaseY * E.cols;
        int startCell = (int)(E.rand() * comp.woodCells.size())
          % (int)comp.woodCells.size();
        int step = E.rand() < 0.5 ? 1 : -1;
        for (int ci = 0; ci < (int)comp.woodCells.size(); ci++) {
          int source = comp.woodCells[
            ((startCell + ci * step) % (int)comp.woodCells.size()
              + (int)comp.woodCells.size()) % (int)comp.woodCells.size()];
          int y = source / E.cols, x = source - y * E.cols;
          if (y > frameBaseY - targetHeight / 2) continue;
          int offset = x - frameBaseX;
          if (std::abs(offset) >= 21) continue;
          int dir = offset ? (offset < 0 ? -1 : 1)
                           : (plantGrowthTrait(signature, (uint32_t)source) & 1u ? 1 : -1);
          int cand[3][2] = {{x + dir, y}, {x + dir, y - 1}, {x + dir, y + 1}};
          for (auto& pos : cand) {
            if (!E.isInBounds(pos[0], pos[1])) continue;
            int tk = E.I(pos[0], pos[1]);
            if (plantTargetOpen(tk, reserved)) return tk;
          }
        }
      }
    }
    if (leaderHeight < targetHeight) return growLeader();
    return -1;
  }
  if (gGrowth->woodTopology == PGW_CACTUS && !comp.woodCells.empty()) {
    // Two staggered arm windows interrupt the tall central column. Repeated calls
    // in one growth tick walk outward, then turn the arm upward at its tip.
    bool armWindow = comp.woodCount >= 18 && comp.woodCount < 65 && (comp.woodCount % 16) >= 8;
    if (armWindow) {
      int dir = ((comp.woodCount / 16) & 1) ? 1 : -1;
      int source = comp.woodCells[imin((int)comp.woodCells.size() - 1, 3 + comp.woodCount / 3)];
      int y = source / E.cols, x = source - y * E.cols;
      for (int d = 1; d <= 6; d++) {
        int tx = x + dir * d;
        if (!E.isInBounds(tx, y)) break;
        int tk = E.I(tx, y);
        if (plantTargetOpen(tk, reserved)) return tk;
        if (E.L->grid[tk] != gWoodMat && !reserved.count(tk)) break;
        if (d == 6 && E.isInBounds(tx, y - 1)) {
          int up = E.I(tx, y - 1);
          if (plantTargetOpen(up, reserved)) return up;
        }
      }
    }
  }
  if (gGrowth->woodTopology != PGW_GENERIC
      && gGrowth->woodTopology != PGW_CACTUS)
    __builtin_unreachable();
  bool straight = growStraight();
  for (int source : sources) {
    int y = source / E.cols, x = source - y * E.cols;
    bool branchReady = comp.woodCount > 16; int branchDir = E.rand() < 0.5 ? -1 : 1;
    int cand[5][2]; int nc;
    if (straight) { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; nc = 3; } // strongly vertical: pine/cactus/mushroom
    else if (branchReady && E.rand() < 0.55) { cand[0][0] = x + branchDir; cand[0][1] = y - 1; cand[1][0] = x + branchDir * 2; cand[1][1] = y - 1; cand[2][0] = x + branchDir; cand[2][1] = y; cand[3][0] = x; cand[3][1] = y - 1; cand[4][0] = x - branchDir; cand[4][1] = y - 1; nc = 5; }
    else { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; cand[3][0] = x - 1; cand[3][1] = y; cand[4][0] = x + 1; cand[4][1] = y; nc = 5; }
    for (int i = 0; i < nc; i++) { int tx = cand[i][0], ty = cand[i][1]; if (!E.isInBounds(tx, ty)) continue; int tk = E.I(tx, ty); if (plantTargetOpen(tk, reserved)) return tk; }
  }
  return -1;
}
bool GrowthSystem::plantTargetOpen(
    int k, const std::unordered_set<int>& reserved) {
  if (k < 0 || k >= E.cols * E.rows || E.L->grid[k] != EMPTY
      || reserved.count(k)) return false;
  int y = k / E.cols, x = k - y * E.cols;
  for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    int nx = x + ox, ny = y + oy;
    if (!E.isInBounds(nx, ny)) continue;
    int neighbor = E.I(nx, ny);
    if (reserved.count(neighbor) || gPlantCells.has(neighbor))
      return true;
  }
  return false;
}
bool GrowthSystem::addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
  if (!plantTargetOpen(k, reserved)) return false;
  growth.push_back({k, gWoodMat}); reserved.insert(k); return true;
}
void GrowthSystem::thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
  if (gGrowth->trunkProfile == PGT_NONE) return;
  if (gGrowth->trunkProfile == PGT_TREE) {
    // Only thicken a newly-extended leader, never a lateral limb. A broad,
    // irregular base tapers to a single-cell crown so pines and willows gain the
    // oak's visual weight without losing their characteristic outlines.
    int seed = comp.cells.empty() ? k : comp.cells.front();
    for (int ck : comp.cells) if (E.isSeedMaterial(E.L->grid[ck])) { seed = ck; break; }
    int seedY = seed / E.cols, y = k / E.cols, x = k - y * E.cols;
    int currentTopY = comp.woodCells.empty() ? seedY : comp.woodCells.front() / E.cols;
    int height = seedY - y;
    if (y >= currentTopY || height > gGrowth->thickenHeight) return;
    int firstDir = E.rand() < 0.5 ? -1 : 1;
    auto addSide = [&](int tx) { return E.isInBounds(tx, y) && addWoodIfOpen(E.I(tx, y), growth, reserved); };
    addSide(x + firstDir);
    if (E.rand() < gGrowth->oppositeChance) addSide(x - firstDir);
    if (height <= gGrowth->wideBaseHeight
        && E.rand() < gGrowth->wideBaseChance)
      addSide(x + firstDir * 2);
    return;
  }
  if (gGrowth->trunkProfile != PGT_GENERIC) __builtin_unreachable();
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
  if (gGrowth->leafTopology == PGL_MUSHROOM) {
    // Build one broad, domed cap around the top of the stem instead of sprinkling
    // cap cells down its full height.
    int source = comp.woodCells.front(), y = source / E.cols, x = source - y * E.cols;
    std::vector<int> candidates;
    for (int dy = -4; dy <= 3; dy++) {
      int radius = 9 - std::abs(dy) * 2;
      for (int dx = -radius; dx <= radius; dx++) {
        int tx = x + dx, ty = y + dy;
        if (!E.isInBounds(tx, ty)) continue;
        int tk = E.I(tx, ty);
        if (plantTargetOpen(tk, reserved)) candidates.push_back(tk);
      }
    }
    if (candidates.empty()) return -1;
    return candidates[(int)(E.rand() * candidates.size()) % candidates.size()];
  }
  if (gGrowth->leafTopology == PGL_VINE) {
    // Glowberries bud beside mature lower segments so they read as fruit rather
    // than replacing the strand itself.
    for (auto it = comp.woodCells.rbegin(); it != comp.woodCells.rend(); ++it) {
      int source = *it, y = source / E.cols, x = source - y * E.cols;
      int dir = E.rand() < 0.5 ? -1 : 1;
      int tx[2] = {x + dir, x - dir};
      for (int bx : tx) {
        if (!E.isInBounds(bx, y)) continue;
        int tk = E.I(bx, y);
        if (plantTargetOpen(tk, reserved)) return tk;
      }
    }
    return -1;
  }
  if (gGrowth->leafTopology == PGL_WILLOW) {
    // Grow vertical curtains beneath the willow's lateral wood. Continuing
    // through existing leaves lengthens individual strands instead of packing
    // a generic round canopy around the trunk.
    int seed = comp.woodCells.back();
    for (int k : comp.cells) if (E.isSeedMaterial(E.L->grid[k])) { seed = k; break; }
    uint32_t signature = plantGrowthSignature(comp);
    int targetHeight = 62 + (int)(plantGrowthTrait(signature, 0) % 15u);
    int frameBase = gWillowGravity ? gWillowLeader.front() : seed;
    int frameBaseY = frameBase / E.cols;
    int frameBaseX = frameBase - frameBaseY * E.cols;
    int branchSourceY = frameBaseY - targetHeight / 2;
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
        if (std::abs(x - frameBaseX) < 2 && y > crownY + 7) continue;
        int cand[8][2] = {{x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x, y - 1}, {x - 1, y + 1}, {x + 1, y + 1}, {x, y + 1}};
        int first = (int)(E.rand() * 8.0) % 8;
        for (int i = 0; i < 8; i++) {
          int tx = cand[(first + i) % 8][0], ty = cand[(first + i) % 8][1];
          if (ty > branchSourceY + 1) continue;
          if (!E.isInBounds(tx, ty)) continue;
          int tk = E.I(tx, ty);
          if (plantTargetOpen(tk, reserved)) return tk;
        }
      }
    }
    for (int ci = 0; ci < (int)comp.woodCells.size(); ci++) {
      int source = comp.woodCells[((start + ci * step) % comp.woodCells.size() + comp.woodCells.size()) % comp.woodCells.size()];
      int y = source / E.cols, x = source - y * E.cols;
      if (y > branchSourceY) continue;
      int outward = std::abs(x - frameBaseX);
      if (outward < 6) continue;
      uint32_t strand = plantGrowthTrait(signature,
        (uint32_t)(E.L->worldOffsetX + x) * 31u + (uint32_t)(E.L->worldOffsetY + y) * 17u);
      if (strand % 13u == 0u) continue; // small gaps keep neighboring curtains from merging into a wall
      int maxDrop = imin(25, 11 + (int)(strand % 12u) + outward / 4);
      int sway = (int)((strand >> 8) % 3u) - 1;
      for (int drop = 1; drop <= maxDrop; drop++) {
        int tx = x + (drop > maxDrop / 2 ? sway : 0), ty = y + drop;
        if (!E.isInBounds(tx, ty)) break;
        int tk = E.I(tx, ty);
        if (E.L->grid[tk] == gLeafMat || reserved.count(tk)) continue;
        if (plantTargetOpen(tk, reserved)) return tk;
        break;
      }
    }
    int crown = comp.woodCells.front(), y = crown / E.cols, x = crown - y * E.cols;
    int cand[6][2] = {{x - 1, y}, {x + 1, y}, {x, y - 1}, {x, y + 1}, {x - 1, y + 1}, {x + 1, y + 1}};
    for (auto& pos : cand) {
      int tx = pos[0], ty = pos[1];
      if (!E.isInBounds(tx, ty)) continue;
      int tk = E.I(tx, ty);
      if (plantTargetOpen(tk, reserved)) return tk;
    }
    return -1;
  }
  if (gGrowth->leafTopology == PGL_PINE) {
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
        if (plantTargetOpen(tk, reserved)) return tk;
      }
    }
    return -1;
  }
  if (gGrowth->leafTopology == PGL_OAK) {
    // Overlapping asymmetric lobes follow the spreading scaffold. Small edge
    // gaps and valleys between lobes break up the crown without disconnecting it.
    int seed = comp.cells.front();
    for (int k : comp.cells) if (E.isSeedMaterial(E.L->grid[k])) { seed = k; break; }
    int seedY = seed / E.cols, seedX = seed - seedY * E.cols;
    uint32_t signature = plantGrowthSignature(comp);
    bool branching = gGrowth->woodTopology == PGW_BRANCHING;
    int targetHeight = branching ? 38 + (int)(plantGrowthTrait(signature, 0) % 9u) : oakTargetHeight(signature);
    int centerX = seedX, centerY = seedY - targetHeight + 4;
    struct CrownLobe { int x, y, rx, ry; };
    const CrownLobe oakLobes[] = {{0, 0, 13, 12}, {-17, 7, 12, 10},
      {17, 9, 12, 10}, {-12, -7, 11, 11}, {12, -9, 10, 10},
      {-2, -14, 9, 8}, {0, 14, 15, 9}};
    const CrownLobe seedLobes[] = {{0, -1, 8, 9}, {-12, 9, 8, 8},
      {13, 12, 8, 7}, {-8, 0, 7, 8}, {9, -3, 7, 8},
      {0, -9, 7, 7}, {-3, 19, 9, 7}};
    const CrownLobe* lobes = branching ? seedLobes : oakLobes;
    std::vector<int> candidates; std::unordered_set<int> seen;
    const int dirs[8][2] = {{-1,-1},{0,-1},{1,-1},{-1,0},{1,0},{-1,1},{0,1},{1,1}};
    for (int source : comp.cells) {
      uint8_t sourceMat = E.L->grid[source];
      if (sourceMat != gWoodMat && sourceMat != gLeafMat) continue;
      int y = source / E.cols, x = source - y * E.cols;
      if (y > centerY + 29) continue;
      for (auto& dir : dirs) {
        int tx = x + dir[0], ty = y + dir[1];
        if (!E.isInBounds(tx, ty)) continue;
        int coverage = 1000;
        for (int li = 0; li < 7; li++) {
          const CrownLobe& lobe = lobes[li];
          int jitter = (int)(plantGrowthTrait(signature, 110 + li) % 5u) - 2;
          int dx = tx - centerX - lobe.x - jitter, dy = ty - centerY - lobe.y;
          int shape = dx * dx * lobe.ry * lobe.ry + dy * dy * lobe.rx * lobe.rx;
          int limit = lobe.rx * lobe.rx * lobe.ry * lobe.ry;
          coverage = imin(coverage, shape * 100 / limit);
        }
        if (coverage > 100) continue;
        uint32_t edge = plantGrowthTrait(signature, (uint32_t)(tx + E.L->worldOffsetX) * 31u + (uint32_t)(ty + E.L->worldOffsetY) * 17u);
        if (coverage > 85 && edge % 100u < 18u) continue;
        int tk = E.I(tx, ty);
        if (!plantTargetOpen(tk, reserved) || !seen.insert(tk).second) continue;
        candidates.push_back(tk);
      }
    }
    if (candidates.empty()) return -1;
    return candidates[(int)(E.rand() * candidates.size()) % candidates.size()];
  }
  if (gGrowth->leafTopology != PGL_GENERIC) __builtin_unreachable();
  for (int source : comp.woodCells) {
    int y = source / E.cols, x = source - y * E.cols;
    int cand[11][2] = {{x, y - 1}, {x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y}, {x + 2, y}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y}, {x + 3, y}};
    int start = (int)(E.rand() * 11); int step = E.rand() < 0.5 ? 1 : -1;
    for (int i = 0; i < 11; i++) { int idx = ((start + i * step) % 11 + 11) % 11; int tx = cand[idx][0], ty = cand[idx][1]; if (!E.isInBounds(tx, ty)) continue; int tk = E.I(tx, ty); if (plantTargetOpen(tk, reserved)) return tk; }
  }
  return -1;
}
// Build each eye from its final material raster, so the iris and pupil grow
// with the sclera and remain ordinary, connected plant cells.
void GrowthSystem::growEye(Comp& comp,
    std::vector<std::pair<int, uint8_t>>& growth,
    std::unordered_set<int>& reserved) {
  int seed = comp.cells.front();
  for (int k : comp.cells) if (E.isSeedMaterial(E.L->grid[k])) { seed = k; break; }
  int sx = seed % E.cols, sy = seed / E.cols;
  uint32_t signature = plantGrowthSignature(comp);
  int height = 38 + (int)(plantGrowthTrait(signature, 0) % 20u);
  std::vector<std::pair<int, uint8_t>> targets;
  auto put = [&](int x, int y, uint8_t material) {
    if (!E.isInBounds(x, y)) return;
    int k = E.I(x, y);
    if (E.L->grid[k] == EMPTY) targets.push_back({k, material});
  };
  Engine::stampEyeTree(put, sx, sy, height, signature, 0);
  // Grow from the living edge. Neighbor support favors compact buds while
  // seeded variation lets different sides of each crown develop together.
  for (int burst = 0; burst < 2; burst++) {
    int best = -1;
    double bestScore = -1;
    for (int i = 0; i < (int)targets.size(); i++) {
      int k = targets[i].first;
      if (!plantTargetOpen(k, reserved)) continue;
      int x = k % E.cols, y = k / E.cols, support = 0;
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || !E.isInBounds(x + dx, y + dy)) continue;
        int neighbor = E.I(x + dx, y + dy);
        if (gPlantCells.has(neighbor) || reserved.count(neighbor)) support++;
      }
      double score = whash2(signature ^ ((uint32_t)comp.age * 0x9e3779b9u)
                            ^ (uint32_t)burst, x - sx, y - sy) * (support + 1);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) break;
    growth.push_back(targets[best]);
    reserved.insert(targets[best].first);
  }
  if (growth.empty()) comp.growing = false;
}

void GrowthSystem::growPlantComponents() {
  E.ensureComponentRegistries();
  for (int componentIndex : E.L->growingPlantComponents) {
    Comp& comp = E.L->components[componentIndex];
    if (!comp.growing) continue;
    comp.age++;
    if (!E.componentHasSeed(*E.L, comp)) { comp.growing = false; continue; }
    gPlantCells.reset((size_t)E.cols * E.rows);
    for (int k : comp.cells) gPlantCells.add(k);
    gSpecies = comp.plantType;
    gGrowth = &plantGrowthProfileForSpecies(gSpecies);
    gWoodMat = E.plantWoodMat(gSpecies);
    gLeafMat = E.plantLeafMat(gSpecies);
    gWillowGravity = false;
    gWillowLeader.clear();
    if (gGrowth->gravityRecovery && comp.gravityGrowth) {
      refreshPlantCache(comp);
      int willowSeed = comp.cells.front();
      for (int k : comp.cells)
        if (E.isSeedMaterial(E.L->grid[k])) { willowSeed = k; break; }
      gWillowGravity = willowGravityLeader(comp, willowSeed, gWillowLeader);
    }
    uint32_t growthSignature = plantGrowthSignature(comp);
    int maxWood = gGrowth->maxWoodBase
      + (gGrowth->maxWoodVariation
         ? (int)(plantGrowthTrait(growthSignature, 2)
                 % gGrowth->maxWoodVariation)
         : 0);
    int maxLeaf = gGrowth->maxLeafBase
      + (gGrowth->maxLeafVariation
         ? (int)(plantGrowthTrait(growthSignature, 3)
                 % gGrowth->maxLeafVariation)
         : 0);
    int leafStart = gGrowth->leafStart;
    bool leaves = gGrowth->leaves;
    // Plant growth is currently independent of nearby water.
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
    bool woodBlocked = false, leafBlocked = false;
    if (gGrowth->woodTopology == PGW_EYE) {
      growEye(comp, growth, reserved);
    } else {
      bool shouldGrowWood = comp.woodCount < maxWood
        && (gGrowth->finishStemFirst || comp.woodCount < leafStart
            || E.rand() > gGrowth->woodLeafChance);
      if (shouldGrowWood) {
        int firstWood = tryGrowWood(comp, reserved);
        woodBlocked = firstWood < 0;
        if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) thickenTrunkAround(firstWood, comp, growth, reserved);
        int extraWood = tryGrowWood(comp, reserved);
        if (gGrowth->extraWood && extraWood >= 0 && E.rand() < 0.72)
          addWoodIfOpen(extraWood, growth, reserved);
      }
      bool vineBerriesNow = gGrowth->vineBerriesChance > 0
        && !growth.empty() && E.rand() < gGrowth->vineBerriesChance;
      bool foliageAlongsideWood = gGrowth->foliageAlongsideWoodChance > 0
        && !growth.empty()
        && E.rand() < gGrowth->foliageAlongsideWoodChance;
      if (leaves && (growth.empty() || vineBerriesNow || foliageAlongsideWood) && comp.woodCount >= leafStart && comp.leafCount < maxLeaf) {
        int leafCount = 1;
        switch (gGrowth->leafBurst) {
          case PGB_SINGLE: leafCount = 1; break;
          case PGB_PINE: leafCount = E.rand() < 0.45 ? 2 : 1; break;
          case PGB_DEFAULT: leafCount = E.rand() < 0.35 ? 2 : 1; break;
        }
        leafCount = imin(leafCount, maxLeaf - comp.leafCount);
        int leavesBefore = (int)growth.size();
        for (int i = 0; i < leafCount; i++) { int leafK = tryGrowLeaf(comp, reserved); if (plantTargetOpen(leafK, reserved)) { growth.push_back({leafK, gLeafMat}); reserved.insert(leafK); } }
        leafBlocked = (int)growth.size() == leavesBefore;
      }
    }
    if (growth.empty()) {
      if ((woodBlocked || comp.woodCount >= maxWood) && (!leaves || leafBlocked || comp.leafCount >= maxLeaf)) comp.growing = false;
      continue;
    }
    E.L->componentCarryDirty = true;
    for (int wk : waterCells) E.writeGridIndexUnsafe(wk, EMPTY);
    // push_back (not a set insert) is safe: the EMPTY guard above means each targetK is written once, so no cell is added to comp.cells twice.
    for (auto& g : growth) { int targetK = g.first; uint8_t material = g.second; if (E.L->grid[targetK] != EMPTY) continue; E.writeGridIndexUnsafe(targetK, material); comp.cells.push_back(targetK); E.noteComponentIndexAddition(componentIndex, targetK); int y = targetK / E.cols; if (y > comp.yMax) comp.yMax = y; if (E.isPlantWood(material)) comp.woodCount++; else comp.leafCount++; comp.cacheDirty = true; }
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
  E.ensureComponentRegistries();
  for (int componentIndex : E.L->myceliumComponents) {
    Comp& comp = E.L->components[componentIndex];
    if (!myceliumCompHasSpore(comp)) continue;
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
  if (E.L->components.empty()) {
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
  for (int componentIndex : E.L->myceliumComponents) {
    Comp& comp = E.L->components[componentIndex];
    if (!comp.growing || !myceliumCompHasSpore(comp)) continue;
    comp.age++;
    if (!myceliumCompHasSpore(comp) || comp.age > MYCELIUM_MAX_AGE || (int)comp.cells.size() >= MYCELIUM_MAX_CELLS) { comp.growing = false; continue; }
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
    E.writeGridIndexUnsafe(g.targetK, MYCELIUM);
    converted.push_back(g.targetK);
  }
  if (converted.empty()) return;

  E.L->componentCarryDirty = true;

  E.comps.splitRigidAfterErase(E.L->components, converted, E.L->nextComponentId, false);
  for (const MycGrowth& g : growth) {
    if (E.L->grid[g.targetK] != MYCELIUM) continue;
    for (auto& comp : E.L->components) {
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
