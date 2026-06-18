  // ================= COMPONENTS (components.js) =================
  void computeGrounded() {
    std::fill(groundedCell, groundedCell + (size_t)cols * rows, (uint8_t)0);
    std::fill(cellComp, cellComp + (size_t)cols * rows, -1);
    std::vector<Comp*> comps;
    auto indexComps = [&](std::vector<Comp>& list) {
      for (auto& c : list) { c.grounded = false; int id = (int)comps.size(); comps.push_back(&c); for (int k : c.cells) cellComp[k] = id; }
    };
    indexComps(L->stoneComponents); indexComps(L->plantComponents); indexComps(L->iceComponents);
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
    // Streamed-edge support: in the infinite world the left/right/top buffer edges abut
    // UNLOADED world that may itself be grounded. A rigid cell touching such an edge is
    // assumed supported, so a structure whose real floor-contact has streamed off the
    // buffer does not spuriously fall (it reconnects when the region streams back in).
    if (L->infinite) {
      for (int y = 1; y < rows; y++) {
        int kl = y * cols + 1;          if (isRigidMaterial(grid[kl])) groundCellAt(kl);
        int kr = y * cols + (cols - 2); if (isRigidMaterial(grid[kr])) groundCellAt(kr);
      }
      int topBase = cols; // row y = 1
      for (int x = 1; x < cols - 1; x++) { int k = topBase + x; if (isRigidMaterial(grid[k])) groundCellAt(k); }
    }
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

  // Cross-layer grounding (runs once per step when the background is live). A solid
  // unsupported within its OWN layer can still be held up when it is backed by
  // GROUNDED solid at the same cells in the other layer — the user's "stone painted
  // in front of a grounded bg pillar". Two coupled problems make the naive version
  // wrong, and both are fixed here:
  //
  //  (1) MISMATCHED CUTS. A single mutual flood through cross-layer edges lets a
  //      grounded rim in one layer reach across and pin the OTHER layer's detached
  //      island. When a body spanning both layers is freed by two hand-drawn moats
  //      (never pixel-identical), one layer's leftover grounded rim overlaps the
  //      other's island edge and holds it up, so only one layer falls. We instead
  //      ground each layer INDEPENDENTLY (computeGrounded, preserving the
  //      stone|plant|ice comp indexing moveRigidAssemblies maps from), then decide
  //      cross-support per CONNECTED ISLAND: an island (the 8-connected cluster of a
  //      layer's self-ungrounded rigid cells — exactly what moveRigidAssemblies
  //      moves as one) is held only when a MAJORITY of its cells are backed by
  //      independently-grounded other-layer solid. A slab flush against a wall holds;
  //      an island that merely grazes a grounded rim falls. Snapshots keep the two
  //      directions symmetric and order-independent.
  //
  //  (2) STALE SETTLED ISLANDS. A solid held up only by the other layer settles and
  //      goes inactive; its layer's beginStepDirty() then stays false and
  //      moveRigidAssemblies() never re-runs. When the player LATER carves away the
  //      other layer's support, the island is recomputed as ungrounded but would
  //      never move — it floats. (This is why the layer carved SECOND fell while the
  //      first stayed.) wakeLost() re-marks every cell that went grounded->ungrounded
  //      so its layer re-activates this same step and the freed island falls.
  //
  // Uses no RNG, so it never perturbs the sim stream.
  void computeGroundedBoth() {
    size_t n = (size_t)cols * rows;
    // (2) snapshot last step's grounding before computeGrounded overwrites it.
    cgPrevFg.assign(fg.groundedCell.begin(), fg.groundedCell.end());
    cgPrevBg.assign(bg.groundedCell.begin(), bg.groundedCell.end());
    // (1) self-ground each layer, then snapshot those independent masks.
    useLayer(&fg); computeGrounded();
    cgFgBase.assign(fg.groundedCell.begin(), fg.groundedCell.end());
    useLayer(&bg); computeGrounded();
    cgBgBase.assign(bg.groundedCell.begin(), bg.groundedCell.end());
    cgVisited.assign(n, 0);
    auto crossSupport = [&](Layer& target, const uint8_t* otherGrid, const std::vector<uint8_t>& selfBase, const std::vector<uint8_t>& otherBase) {
      const uint8_t* tg = target.grid;
      std::fill(cgVisited.begin(), cgVisited.end(), (uint8_t)0);
      for (size_t s = 0; s < n; s++) {
        if (cgVisited[s] || selfBase[s] || !isRigidMaterial(tg[s])) continue;
        cgIsland.clear(); cgStack.clear();
        cgStack.push_back((int)s); cgVisited[s] = 1;
        size_t backed = 0;
        while (!cgStack.empty()) {
          int k = cgStack.back(); cgStack.pop_back();
          cgIsland.push_back(k);
          if (otherBase[k] && isRigidMaterial(otherGrid[k])) backed++;
          int y = k / cols, x = k - y * cols;
          for (int oy = -1; oy <= 1; oy++) { int ny = y + oy; if (ny < 0 || ny >= rows) continue; int rb = ny * cols;
            for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox; if (nx < 0 || nx >= cols) continue;
              int nk = rb + nx; if (cgVisited[nk] || selfBase[nk] || !isRigidMaterial(tg[nk])) continue;
              cgVisited[nk] = 1; cgStack.push_back(nk); } }
        }
        if (backed * 2 < cgIsland.size()) continue; // island not majority-backed -> falls
        for (int k : cgIsland) {
          target.groundedCell[k] = 1;
          int id = target.cellComp[k];
          if (id >= 0) compById(target, id)->grounded = true;
        }
      }
    };
    crossSupport(fg, bg.grid, cgFgBase, cgBgBase);
    crossSupport(bg, fg.grid, cgBgBase, cgFgBase);
    // (2) re-wake whatever lost grounding this step (only the 1->0 transition;
    // already-ungrounded cells stay active from their own motion/edits).
    auto wakeLost = [&](Layer& lay, const std::vector<uint8_t>& prev) {
      const uint8_t* gr = lay.groundedCell.data(); const uint8_t* g = lay.grid;
      int32_t* rmn = lay.rowMarkMin.data(); int32_t* rmx = lay.rowMarkMax.data();
      for (int y = 0; y < rows; y++) {
        int rb = y * cols, mn = rmn[y], mx = rmx[y];
        for (int x = 0; x < cols; x++) { int k = rb + x; if (prev[k] && !gr[k] && isRigidMaterial(g[k])) { if (x < mn) mn = x; if (x > mx) mx = x; } }
        rmn[y] = mn; rmx[y] = mx;
      }
    };
    wakeLost(fg, cgPrevFg); wakeLost(bg, cgPrevBg);
    useLayer(&fg);
  }

  // Map a cellComp id (assigned by computeGrounded in stone|plant|ice order) back
  // to its Comp* in the SAME layer.
  Comp* compById(Layer& lay, int id) {
    size_t ns = lay.stoneComponents.size();
    if ((size_t)id < ns) return &lay.stoneComponents[id];
    id -= (int)ns;
    size_t np = lay.plantComponents.size();
    if ((size_t)id < np) return &lay.plantComponents[id];
    return &lay.iceComponents[id - (int)np];
  }

  void moveRigidAssemblies() {
    // Only UNGROUNDED assemblies can move (fall/float) — grounded terrain stays
    // put (the per-group loop below `continue`s on grounded). computeGrounded
    // floods grounded-ness through rigid contact, so an ungrounded component is
    // never 8-connected to a grounded one. So we process only ungrounded
    // components here, making the whole pass O(ungrounded cells) instead of
    // O(all stone) every step. `cellComp` (from computeGrounded) holds GLOBAL
    // comp indices in stone|plant|ice order; localOf maps those to our filtered
    // ungrounded `all` array (or -1 for grounded/none).
    int totalComps = (int)(L->stoneComponents.size() + L->plantComponents.size() + L->iceComponents.size());
    if (totalComps == 0) return;
    std::vector<Comp*> all;
    std::vector<int> localOf(totalComps, -1);
    int gi = 0;
    auto addList = [&](std::vector<Comp>& list) {
      for (auto& c : list) { if (!c.grounded) { localOf[gi] = (int)all.size(); all.push_back(&c); } gi++; }
    };
    addList(L->stoneComponents); int nStone = (int)all.size();
    addList(L->plantComponents); int nStonePlant = (int)all.size();
    addList(L->iceComponents);
    int n = (int)all.size();
    if (n == 0) return; // everything is grounded (settled) -> nothing to move
    for (auto* comp : all) { int ym = 0; for (int k : comp->cells) { int y = k / cols; if (y > ym) ym = y; } comp->yMax = ym; }
    std::vector<int> parent(n); for (int i = 0; i < n; i++) parent[i] = i;
    // anchored[i]: this ungrounded comp is 8-adjacent to a GROUNDED comp, so it
    // is attached to supported terrain and must not move. (In the original full
    // union-find such a comp joined a grounded group and was skipped; this
    // reproduces that exactly while only scanning ungrounded cells.)
    std::vector<uint8_t> anchored(n, 0);
    auto find = [&](int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (int i = 0; i < n; i++) for (int k : all[i]->cells) {
      int y = k / cols, x = k - y * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (nx < 1 || nx >= cols - 1 || ny < 1 || ny >= rows) continue; int gj = cellComp[ny * cols + nx]; if (gj >= 0) { int j = localOf[gj]; if (j >= 0) { int ri = find(i), rj = find(j); if (ri != rj) parent[ri] = rj; } else { anchored[i] = 1; } } }
    }
    struct Group { std::vector<int> comps; bool grounded = false; int maxY = 0; };
    std::unordered_map<int, Group> groups;
    for (int i = 0; i < n; i++) { int r = find(i); Group& g = groups[r]; g.comps.push_back(i); if (all[i]->grounded || anchored[i]) g.grounded = true; if (all[i]->yMax > g.maxY) g.maxY = all[i]->yMax; }
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
        std::vector<int> newCells; newCells.reserve(mv.mats.size());
        for (auto& pr : mv.mats) { writeGridIndex(pr.first, pr.second); newCells.push_back(pr.first); } // mats are distinct (k+dir over distinct k)
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

  // `seen[k] == gen` means visited. The caller bumps the generation (gen++) to
  // "clear" the whole buffer in O(1) instead of reallocating/zeroing cols*rows.
  void floodComponent(int sx, int sy, std::vector<int32_t>& seen, int32_t gen, bool bounded, std::vector<int>& outCells, int& outYMax,
                      bool (Engine::*matCheck)(uint8_t)) {
    int bx = bounded ? sx >> CHUNK_SHIFT : 0, by = bounded ? sy >> CHUNK_SHIFT : 0;
    int k0 = sy * cols + sx;
    outCells.clear(); outCells.push_back(k0); outYMax = sy; seen[k0] = gen; // seen[] dedups -> push_back never repeats
    for (size_t qi = 0; qi < outCells.size(); qi++) {
      int cur = outCells[qi]; int y = cur / cols, x = cur - y * cols; if (y > outYMax) outYMax = y;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
        if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows) continue;
        if (bounded && ((nx >> CHUNK_SHIFT) != bx || (ny >> CHUNK_SHIFT) != by)) continue;
        int nk = ny * cols + nx; if (seen[nk] == gen || !(this->*matCheck)(grid[nk])) continue;
        seen[nk] = gen; outCells.push_back(nk);
      }
    }
  }
  bool isStone(uint8_t m) { return m == STONE; }
  bool isIce(uint8_t m) { return m == ICE; }
  bool isPlantMat(uint8_t m) { return isPlantMaterial(m); }

  void registerSeededComponents(int colStart, int colEnd) { registerSeededComponents(colStart, colEnd, 0, rows); }
  // Register stone/plant/ice components for unseen material in the buffer rect
  // [colStart,colEnd) x [rowStart,rowEnd). A streamed-in vertical band passes a row
  // range (cols-wide); a horizontal band passes a col range (rows-tall).
  void registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd) {
    // Reused generation-stamped scratch (allocated once in Layer::alloc): a cell
    // is "seen" iff seenStamp[k] == gen. Each of the three blocks bumps gen, so
    // the "clear" between materials costs O(1) instead of zeroing cols*rows.
    std::vector<int32_t>& seen = L->seenStamp;
    // STONE (chunk-bounded)
    {
      int32_t gen = ++L->seenGen;
      for (auto& comp : L->stoneComponents) for (int k : comp.cells) seen[k] = gen;
      for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] == gen || grid[k] != STONE) continue;
        std::vector<int> cells; int yMax;
        floodComponent(sx, sy, seen, gen, true, cells, yMax, &Engine::isStone);
        Comp c; c.id = L->nextStoneId++; c.cells = std::move(cells); c.yMax = yMax; L->stoneComponents.push_back(std::move(c));
      }
    }
    // PLANT family
    {
      int32_t gen = ++L->seenGen;
      for (auto& comp : L->plantComponents) for (int k : comp.cells) seen[k] = gen;
      for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] == gen || !isPlantMaterial(grid[k])) continue;
        std::vector<int> cells; int yMax;
        floodComponent(sx, sy, seen, gen, false, cells, yMax, &Engine::isPlantMat);
        Comp c; c.id = L->nextPlantId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
        for (int kk : cells) { if (grid[kk] == WOOD) c.woodCount++; else if (grid[kk] == PLANT) c.leafCount++; }
        c.cells = std::move(cells); L->plantComponents.push_back(std::move(c));
      }
    }
    // ICE
    {
      int32_t gen = ++L->seenGen;
      for (auto& comp : L->iceComponents) for (int k : comp.cells) seen[k] = gen;
      for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] == gen || grid[k] != ICE) continue;
        std::vector<int> cells; int yMax;
        floodComponent(sx, sy, seen, gen, false, cells, yMax, &Engine::isIce);
        Comp c; c.id = L->nextIceId++; c.cells = std::move(cells); c.yMax = yMax; c.cacheDirty = true; L->iceComponents.push_back(std::move(c));
      }
    }
  }

  void registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) {
    if (cells.empty()) return;
    // Find which existing components the new cells touch. Comp.cells is a vector
    // now, so a linear .count() per neighbor would be O(cells * comps * size); use
    // a cell->component-index map built LAZILY (only once a same-material neighbor
    // actually exists), keeping the common "placed in open space" case allocation-free.
    std::unordered_set<int> touchingIds;
    std::unordered_map<int, int> owner; bool ownerBuilt = false;
    for (int k : cells) {
      int y = k / cols, x = k - y * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx;
        if (grid[nk] != mat || cells.count(nk)) continue;
        if (!ownerBuilt) { for (size_t i = 0; i < list.size(); i++) for (int c : list[i].cells) owner[c] = (int)i; ownerBuilt = true; }
        auto it = owner.find(nk); if (it != owner.end()) touchingIds.insert(list[it->second].id);
      }
    }
    Comp newComp; newComp.id = nextId++; newComp.cells.assign(cells.begin(), cells.end()); newComp.yMax = yMax; newComp.cacheDirty = iceCache;
    if (!touchingIds.empty()) {
      std::vector<Comp> keep;
      for (auto& comp : list) {
        if (touchingIds.count(comp.id)) { for (int k : comp.cells) { newComp.cells.push_back(k); int y = k / cols; if (y > newComp.yMax) newComp.yMax = y; } }
        else keep.push_back(std::move(comp));
      }
      list = std::move(keep);
    }
    list.push_back(std::move(newComp));
  }

  // split a plant-family component list keeping only cells still of plant material
  void splitPlantAfterErase() {
    std::vector<Comp> updated;
    for (auto& comp : L->plantComponents) {
      std::unordered_set<int> remaining;
      for (int k : comp.cells) if (isPlantMaterial(grid[k])) remaining.insert(k);
      bool reused = false;
      while (!remaining.empty()) {
        int start = *remaining.begin();
        std::vector<int> part; part.push_back(start); remaining.erase(start); // part doubles as the BFS queue; remaining.erase dedups
        for (size_t qi = 0; qi < part.size(); qi++) {
          int cur = part[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (remaining.count(nk)) { remaining.erase(nk); part.push_back(nk); } }
        }
        Comp c; c.id = reused ? L->nextPlantId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; if (grid[k] == WOOD) c.woodCount++; else if (grid[k] == PLANT) c.leafCount++; }
        c.cells = std::move(part); updated.push_back(std::move(c)); reused = true;
      }
    }
    L->plantComponents = std::move(updated);
  }
  // split stone/ice after erase: remove erased cells, re-flood
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache) {
    if (erased.empty() || list.empty()) return;
    std::unordered_set<int> erasedSet(erased.begin(), erased.end());
    std::vector<Comp> updated;
    for (auto& comp : list) {
      bool touched = false;
      std::vector<int> survivors; survivors.reserve(comp.cells.size());
      for (int k : comp.cells) { if (erasedSet.count(k)) touched = true; else survivors.push_back(k); }
      if (!touched) { updated.push_back(std::move(comp)); continue; }
      if (survivors.empty()) continue;
      std::unordered_set<int> remaining(survivors.begin(), survivors.end());
      while (!remaining.empty()) {
        int start = *remaining.begin();
        std::vector<int> part; part.push_back(start); remaining.erase(start); // part doubles as the BFS queue
        for (size_t qi = 0; qi < part.size(); qi++) {
          int cur = part[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (remaining.count(nk)) { remaining.erase(nk); part.push_back(nk); } }
        }
        Comp c; c.id = nextId++; c.yMax = 0; c.cacheDirty = iceCache;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; }
        c.cells = std::move(part); updated.push_back(std::move(c));
      }
    }
    list = std::move(updated);
  }

