  // ================= COMPONENTS (components.js) =================
  void computeGrounded() {
    std::fill(groundedCell.begin(), groundedCell.end(), 0);
    std::fill(cellComp.begin(), cellComp.end(), -1);
    std::vector<Comp*> comps;
    auto indexComps = [&](std::vector<Comp>& list) {
      for (auto& c : list) { c.grounded = false; int id = (int)comps.size(); comps.push_back(&c); for (int k : c.cells) cellComp[k] = id; }
    };
    indexComps(stoneComponents); indexComps(plantComponents); indexComps(iceComponents);
    int sp = 0;
    auto groundCellAt = [&](int k) {
      if (groundedCell[k]) return;
      groundedCell[k] = 1;
      int id = cellComp[k];
      if (id >= 0) comps[id]->grounded = true;
      groundStack[sp++] = k;
    };
    int floorBase = (rows - 1) * cols;
    for (int x = 0; x < cols; x++) { int k = floorBase + x; if (isBearingMaterial(grid[k])) groundCellAt(k); }
    for (int y = rows - 2; y > 0; y--) { int rb = y * cols; for (int x = 1; x < cols - 1; x++) { int k = rb + x; if (grid[k] == SAND && grid[k + cols] == LAVA) groundCellAt(k); } }
    while (sp > 0) {
      int k = groundStack[--sp];
      int above = k - cols;
      if (above >= 0 && !groundedCell[above] && isBearingMaterial(grid[above])) groundCellAt(above);
      if (isRigidMaterial(grid[k])) {
        int ky = k / cols, kx = k - ky * cols;
        for (int oy = -1; oy <= 1; oy++) { int ny = ky + oy; if (ny <= 0 || ny >= rows) continue; int rb = ny * cols; for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = kx + ox; if (nx <= 0 || nx >= cols - 1) continue; int nk = rb + nx; if (!groundedCell[nk] && isRigidMaterial(grid[nk])) groundCellAt(nk); } }
      }
    }
  }

  void moveRigidAssemblies() {
    std::vector<Comp*> all;
    for (auto& c : stoneComponents) all.push_back(&c);
    int nStone = (int)all.size();
    for (auto& c : plantComponents) all.push_back(&c);
    int nStonePlant = (int)all.size();
    for (auto& c : iceComponents) all.push_back(&c);
    int n = (int)all.size();
    if (n == 0) return;
    for (auto* comp : all) { int ym = 0; for (int k : comp->cells) { int y = k / cols; if (y > ym) ym = y; } comp->yMax = ym; }
    std::vector<int> parent(n); for (int i = 0; i < n; i++) parent[i] = i;
    auto find = [&](int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (int i = 0; i < n; i++) for (int k : all[i]->cells) {
      int y = k / cols, x = k - y * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (nx < 1 || nx >= cols - 1 || ny < 1 || ny >= rows) continue; int j = cellComp[ny * cols + nx]; if (j >= 0) { int ri = find(i), rj = find(j); if (ri != rj) parent[ri] = rj; } }
    }
    struct Group { std::vector<int> comps; bool grounded = false; int maxY = 0; };
    std::unordered_map<int, Group> groups;
    for (int i = 0; i < n; i++) { int r = find(i); Group& g = groups[r]; g.comps.push_back(i); if (all[i]->grounded) g.grounded = true; if (all[i]->yMax > g.maxY) g.maxY = all[i]->yMax; }
    std::vector<Group*> order; order.reserve(groups.size());
    for (auto& kv : groups) order.push_back(&kv.second);
    std::sort(order.begin(), order.end(), [](Group* a, Group* b) { return a->maxY > b->maxY; });

    auto matOf = [&](int i, int k) -> uint8_t { return i < nStone ? STONE : (i < nStonePlant ? grid[k] : ICE); };

    auto translateAssembly = [&](Group* grp, std::unordered_set<int>& cells, int dir) -> bool {
      int dy = dir > 0 ? 1 : -1;
      std::unordered_set<int> movedCells;
      for (int k : cells) { int leadK = k + dir; int leadY = leadK / cols; if (leadY < 1 || leadY >= rows) return false; if (cells.count(leadK)) continue; if (!componentDisplaceable(grid[leadK])) return false; }
      for (int k : cells) movedCells.insert(k + dir);
      struct Disp { uint8_t material; int from; };
      std::vector<Disp> displaced; std::vector<int> vacated;
      for (int k : cells) { int leadK = k + dir; uint8_t lead = grid[leadK]; if (!cells.count(leadK) && lead != EMPTY && componentDisplaceable(lead)) displaced.push_back({lead, leadK}); if (!cells.count(k - dir)) vacated.push_back(k); }
      int liquidDisplacedCount = 0; for (auto& d : displaced) if (isLiquid(d.material)) liquidDisplacedCount++;
      std::vector<int> sideSpillTargets;
      if (liquidDisplacedCount > 0) {
        std::unordered_set<int> seen, reserved; std::vector<int> queue;
        int offs[4]; if (dir > 0) { offs[0] = -1; offs[1] = 1; offs[2] = cols; offs[3] = -cols; } else { offs[0] = -1; offs[1] = 1; offs[2] = -cols; offs[3] = cols; }
        int gridLen = cols * rows;
        auto canVisit = [&](int k) { if (k < 0 || k >= gridLen || seen.count(k)) return false; int y = k / cols, x = k - y * cols; if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return false; if (cells.count(k) || movedCells.count(k)) return false; uint8_t m = grid[k]; return m == EMPTY || isLiquid(m); };
        auto enqueue = [&](int k) { if (!canVisit(k)) return; seen.insert(k); queue.push_back(k); };
        for (auto& d : displaced) { if (!isLiquid(d.material)) continue; for (int off : offs) enqueue(d.from + off); }
        for (size_t qi = 0; qi < queue.size() && (int)sideSpillTargets.size() < liquidDisplacedCount; qi++) {
          int k = queue[qi];
          if (grid[k] == EMPTY) { if (!reserved.count(k)) { reserved.insert(k); sideSpillTargets.push_back(k); } continue; }
          for (int off : offs) enqueue(k + off);
        }
        if ((int)sideSpillTargets.size() < liquidDisplacedCount) return false;
      }
      struct Move { Comp* comp; bool isPlant; std::vector<std::pair<int, uint8_t>> mats; int wood, leaf; };
      std::vector<Move> moves;
      for (int ci : grp->comps) {
        Comp* comp = all[ci]; bool isPlant = ci >= nStone && ci < nStonePlant;
        std::vector<std::pair<int, uint8_t>> mats; int wood = 0, leaf = 0;
        for (int k : comp->cells) { uint8_t m = matOf(ci, k); mats.push_back({k + dir, m}); if (isPlant) { if (m == WOOD) wood++; else if (m == PLANT) leaf++; } }
        moves.push_back({comp, isPlant, std::move(mats), wood, leaf});
      }
      for (int k : cells) writeGridIndex(k, EMPTY);
      for (auto& mv : moves) {
        std::unordered_set<int> newCells;
        for (auto& pr : mv.mats) { writeGridIndex(pr.first, pr.second); newCells.insert(pr.first); }
        mv.comp->cells = std::move(newCells);
        mv.comp->yMax = imax(0, imin(rows - 1, mv.comp->yMax + dy));
        if (mv.isPlant) { mv.comp->woodCount = mv.wood; mv.comp->leafCount = mv.leaf; mv.comp->cacheDirty = true; }
      }
      int di = 0, si = 0;
      for (auto& d : displaced) {
        if (isLiquid(d.material)) { writeGridIndex(sideSpillTargets[si++], d.material); continue; }
        while (di < (int)vacated.size() && grid[vacated[di]] != EMPTY) di++;
        if (di < (int)vacated.size()) writeGridIndex(vacated[di++], d.material);
      }
      return true;
    };

    // measureLiquidImmersion returns via out-params; returns false if "null".
    auto measureLiquidImmersion = [&](std::unordered_set<int>& cells, int& wetCells, int& exposedCells, int& bottomExposed, int& bottomLiquid, double& liquidDensityOut) -> bool {
      wetCells = 0; exposedCells = 0; bottomExposed = 0; bottomLiquid = 0;
      double liquidDensity = 0; int liquidContacts = 0;
      for (int k : cells) {
        int y = k / cols, x = k - y * cols; bool wet = false, exposed = false;
        if (x > 1 && !cells.count(k - 1)) { exposed = true; uint8_t m = grid[k - 1]; if (isLiquid(m)) { wet = true; liquidDensity += DENSITY[m]; liquidContacts++; } }
        if (x < cols - 2 && !cells.count(k + 1)) { exposed = true; uint8_t m = grid[k + 1]; if (isLiquid(m)) { wet = true; liquidDensity += DENSITY[m]; liquidContacts++; } }
        if (y > 1 && !cells.count(k - cols)) { exposed = true; }
        if (y < rows - 1 && !cells.count(k + cols)) { exposed = true; bottomExposed++; uint8_t m = grid[k + cols]; if (isLiquid(m)) { wet = true; bottomLiquid++; liquidDensity += DENSITY[m]; liquidContacts++; } }
        if (exposed) exposedCells++; if (wet) wetCells++;
      }
      if (liquidContacts == 0) return false;
      int requiredWet = imax(1, (int)std::ceil(std::sqrt((double)cells.size()) * BUOY_WET_PERIMETER_FRAC));
      if (wetCells < requiredWet) return false;
      liquidDensityOut = liquidDensity / liquidContacts;
      return true;
    };

    for (Group* grp : order) {
      if (grp->grounded) continue;
      std::unordered_set<int> cells;
      for (int ci : grp->comps) for (int k : all[ci]->cells) cells.insert(k);
      double weight = 0; int xMin = cols, xMax = 0;
      for (int ci : grp->comps) for (int k : all[ci]->cells) { weight += DENSITY[matOf(ci, k)]; int x = k - (k / cols) * cols; if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      int wetCells, exposedCells, bottomExposed, bottomLiquid; double liquidDensity;
      if (!measureLiquidImmersion(cells, wetCells, exposedCells, bottomExposed, bottomLiquid, liquidDensity)) { translateAssembly(grp, cells, cols); continue; }
      double avgDensity = weight / cells.size();
      if (avgDensity > liquidDensity) { translateAssembly(grp, cells, cols); continue; }
      double targetWetCells = exposedCells * (avgDensity / liquidDensity) * BUOY_DRAFT_SCALE;
      double imbalance = wetCells - targetWetCells;
      double band = std::fmax(BUOY_BAND_MIN, (xMax - xMin + 1) * BUOY_BAND_FRAC);
      bool buoyantSupport = bottomExposed > 0 && bottomLiquid >= bottomExposed * BUOY_SUPPORT_FRAC;
      if (imbalance < -band) translateAssembly(grp, cells, cols);
      else if (imbalance > band) { if (buoyantSupport) translateAssembly(grp, cells, -cols); else translateAssembly(grp, cells, cols); }
    }
  }

  void floodComponent(int sx, int sy, std::vector<uint8_t>& seen, bool bounded, std::unordered_set<int>& outCells, int& outYMax,
                      bool (Engine::*matCheck)(uint8_t)) {
    int bx = bounded ? sx >> CHUNK_SHIFT : 0, by = bounded ? sy >> CHUNK_SHIFT : 0;
    int k0 = sy * cols + sx;
    outCells.clear(); outCells.insert(k0); outYMax = sy; seen[k0] = 1;
    std::vector<int> queue; queue.push_back(k0);
    for (size_t qi = 0; qi < queue.size(); qi++) {
      int cur = queue[qi]; int y = cur / cols, x = cur - y * cols; if (y > outYMax) outYMax = y;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
        if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows) continue;
        if (bounded && ((nx >> CHUNK_SHIFT) != bx || (ny >> CHUNK_SHIFT) != by)) continue;
        int nk = ny * cols + nx; if (seen[nk] || !(this->*matCheck)(grid[nk])) continue;
        seen[nk] = 1; outCells.insert(nk); queue.push_back(nk);
      }
    }
  }
  bool isStone(uint8_t m) { return m == STONE; }
  bool isIce(uint8_t m) { return m == ICE; }
  bool isPlantMat(uint8_t m) { return isPlantMaterial(m); }

  void registerSeededComponents(int colStart, int colEnd) {
    size_t n = (size_t)cols * rows;
    // STONE (chunk-bounded)
    {
      std::vector<uint8_t> seen(n, 0);
      for (auto& comp : stoneComponents) for (int k : comp.cells) seen[k] = 1;
      for (int sy = 0; sy < rows; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] || grid[k] != STONE) continue;
        std::unordered_set<int> cells; int yMax;
        floodComponent(sx, sy, seen, true, cells, yMax, &Engine::isStone);
        Comp c; c.id = nextStoneId++; c.cells = std::move(cells); c.yMax = yMax; stoneComponents.push_back(std::move(c));
      }
    }
    // PLANT family
    {
      std::vector<uint8_t> seen(n, 0);
      for (auto& comp : plantComponents) for (int k : comp.cells) seen[k] = 1;
      for (int sy = 0; sy < rows; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] || !isPlantMaterial(grid[k])) continue;
        std::unordered_set<int> cells; int yMax;
        floodComponent(sx, sy, seen, false, cells, yMax, &Engine::isPlantMat);
        Comp c; c.id = nextPlantId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
        for (int kk : cells) { if (grid[kk] == WOOD) c.woodCount++; else if (grid[kk] == PLANT) c.leafCount++; }
        c.cells = std::move(cells); plantComponents.push_back(std::move(c));
      }
    }
    // ICE
    {
      std::vector<uint8_t> seen(n, 0);
      for (auto& comp : iceComponents) for (int k : comp.cells) seen[k] = 1;
      for (int sy = 0; sy < rows; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] || grid[k] != ICE) continue;
        std::unordered_set<int> cells; int yMax;
        floodComponent(sx, sy, seen, false, cells, yMax, &Engine::isIce);
        Comp c; c.id = nextIceId++; c.cells = std::move(cells); c.yMax = yMax; c.cacheDirty = true; iceComponents.push_back(std::move(c));
      }
    }
  }

  void registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) {
    if (cells.empty()) return;
    std::unordered_set<int> touchingIds;
    for (int k : cells) {
      int y = k / cols, x = k - y * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx;
        if (grid[nk] != mat || cells.count(nk)) continue;
        for (auto& comp : list) if (comp.cells.count(nk)) { touchingIds.insert(comp.id); break; }
      }
    }
    Comp newComp; newComp.id = nextId++; newComp.cells = cells; newComp.yMax = yMax; newComp.cacheDirty = iceCache;
    if (!touchingIds.empty()) {
      std::vector<Comp> keep;
      for (auto& comp : list) {
        if (touchingIds.count(comp.id)) { for (int k : comp.cells) { newComp.cells.insert(k); int y = k / cols; if (y > newComp.yMax) newComp.yMax = y; } }
        else keep.push_back(std::move(comp));
      }
      list = std::move(keep);
    }
    list.push_back(std::move(newComp));
  }

  // split a plant-family component list keeping only cells still of plant material
  void splitPlantAfterErase() {
    std::vector<Comp> updated;
    for (auto& comp : plantComponents) {
      std::unordered_set<int> remaining;
      for (int k : comp.cells) if (isPlantMaterial(grid[k])) remaining.insert(k);
      bool reused = false;
      while (!remaining.empty()) {
        int start = *remaining.begin();
        std::vector<int> queue; queue.push_back(start);
        std::unordered_set<int> part; part.insert(start); remaining.erase(start);
        for (size_t qi = 0; qi < queue.size(); qi++) {
          int cur = queue[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (remaining.count(nk)) { remaining.erase(nk); part.insert(nk); queue.push_back(nk); } }
        }
        Comp c; c.id = reused ? nextPlantId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; if (grid[k] == WOOD) c.woodCount++; else if (grid[k] == PLANT) c.leafCount++; }
        c.cells = std::move(part); updated.push_back(std::move(c)); reused = true;
      }
    }
    plantComponents = std::move(updated);
  }
  // split stone/ice after erase: remove erased cells, re-flood
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache) {
    if (erased.empty() || list.empty()) return;
    std::vector<Comp> updated;
    for (auto& comp : list) {
      bool touched = false;
      for (int k : erased) if (comp.cells.erase(k)) touched = true;
      if (!touched) { updated.push_back(std::move(comp)); continue; }
      if (comp.cells.empty()) continue;
      std::unordered_set<int> remaining = comp.cells;
      while (!remaining.empty()) {
        int start = *remaining.begin();
        std::vector<int> queue; queue.push_back(start);
        std::unordered_set<int> part; part.insert(start); remaining.erase(start);
        for (size_t qi = 0; qi < queue.size(); qi++) {
          int cur = queue[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (remaining.count(nk)) { remaining.erase(nk); part.insert(nk); queue.push_back(nk); } }
        }
        Comp c; c.id = nextId++; c.yMax = 0; c.cacheDirty = iceCache;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; }
        c.cells = std::move(part); updated.push_back(std::move(c));
      }
    }
    list = std::move(updated);
  }

