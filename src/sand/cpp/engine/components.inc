  // Component lifetime and connectivity.
  //
  // Stone, ice, and plant materials are not loose pixels. They survive a step
  // only through component membership, and unregistered component cells are
  // erased during cleanup. Tool placement, worldgen, growth, and world shifting
  // should route component writes through this subsystem and then sync/register.
  void computeGrounded() {
    std::fill(groundedCell, groundedCell + (size_t)cols * rows, (uint8_t)0);
    std::fill(cellComp, cellComp + (size_t)cols * rows, -1);
    std::vector<Comp*> comps;
    std::vector<double> compDensity;
    auto indexComps = [&](std::vector<Comp>& list) {
      for (auto& c : list) {
        c.grounded = false;
        int id = (int)comps.size();
        comps.push_back(&c);
        double sum = 0;
        for (int k : c.cells) { cellComp[k] = id; sum += DENSITY[grid[k]]; }
        compDensity.push_back(c.cells.empty() ? 0 : sum / c.cells.size());
      }
    };
    indexComps(L->stoneComponents); indexComps(L->plantComponents); indexComps(L->iceComponents);
    auto effectiveRigidDensityAt = [&](int k) {
      int id = cellComp[k];
      return id >= 0 ? compDensity[id] : (double)DENSITY[grid[k]];
    };
    auto canGroundAbove = [&](int below, int above) {
      uint8_t upper = grid[above];
      if (!isBearingMaterial(upper)) return false;
      uint8_t lower = grid[below];
      if (MAT_KIND[lower] == K_POWDER && isRigidMaterial(upper) && DENSITY[lower] < effectiveRigidDensityAt(above)) return false;
      return true;
    };
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
    for (int y = rows - 2; y > 0; y--) {
      int rb = y * cols;
      for (int x = 1; x < cols - 1; x++) {
        int k = rb + x;
        if (MAT_KIND[grid[k]] == K_POWDER && isLiquid(grid[k + cols]) && DENSITY[grid[k + cols]] >= DENSITY[grid[k]]) groundCellAt(k);
      }
    }
    while (sp > 0) {
      int k = groundStack[--sp];
      int above = k - cols;
      if (above >= 0 && !groundedCell[above] && canGroundAbove(k, above)) groundCellAt(above);
      if (isRigidMaterial(grid[k])) {
        int ky = k / cols, kx = k - ky * cols;
        for (int oy = -1; oy <= 1; oy++) { int ny = ky + oy; if (ny <= 0 || ny >= rows) continue; int rb = ny * cols; for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = kx + ox; if (nx <= 0 || nx >= cols - 1) continue; int nk = rb + nx; if (!groundedCell[nk] && isRigidMaterial(grid[nk])) groundCellAt(nk); } }
      }
    }
  }

  int compCount(Layer& lay) { return (int)(lay.stoneComponents.size() + lay.plantComponents.size() + lay.iceComponents.size()); }

  // Union same-layer 8-adjacent components into `parent` (and `groundParent` when
  // non-null), restricted to the components reachable from a cross-layer bonded
  // comp. This replaces the old O(cols*rows) full-grid uniteLayerAdj pass that ran
  // up to 4x per step. Cross-layer bond unions + the global grounded scan are done
  // by the caller; here we only add same-layer adjacency.
  //
  // We seed from each layer's UNGROUNDED cross-bonded comps and walk same-layer
  // adjacency. computeGrounded floods grounding across 8-adjacency, so an
  // ungrounded rigid cell never borders a grounded one — every comp discovered by
  // the walk is therefore ungrounded too, and the walk stays inside the floating
  // region instead of scanning the whole grounded terrain mass. A grounded bonded
  // endpoint needs no walk: its bond union (caller) + grounded scan already make
  // its class grounded; whether its same-layer neighbours get marked cross-bonded
  // is unobservable (grounded comps never move and are skipped everywhere).
  void unionCrossBondedClusters(std::vector<int>& parent, std::vector<int>* groundParent, int nf, int nb) {
    int total = nf + nb;
    if ((int)cgCompStamp.size() < total) cgCompStamp.assign(total, 0);
    auto find = [&](std::vector<int>& p, int a) { while (p[a] != a) { p[a] = p[p[a]]; a = p[a]; } return a; };
    auto unite = [&](std::vector<int>& p, int a, int b) { int ra = find(p, a), rb = find(p, b); if (ra != rb) p[ra] = rb; };
    int32_t gen = ++cgCompGen;
    cgWorkQueue.clear();
    auto seed = [&](Layer& lay, int offset, int count) {
      for (int i = 0; i < count; i++) {
        if (i >= (int)lay.crossBondedComp.size() || !lay.crossBondedComp[i]) continue;
        if (compById(lay, i)->grounded) continue;
        int gid = offset + i;
        if (cgCompStamp[gid] == gen) continue;
        cgCompStamp[gid] = gen; cgWorkQueue.push_back(gid);
      }
    };
    seed(fg, 0, nf); seed(bg, nf, nb);
    for (size_t qi = 0; qi < cgWorkQueue.size(); qi++) {
      int gid = cgWorkQueue[qi];
      bool isFg = gid < nf; Layer& lay = isFg ? fg : bg; int offset = isFg ? 0 : nf;
      Comp* c = compById(lay, gid - offset);
      const int32_t* cc = lay.cellComp.data();
      for (int k : c->cells) {
        int y = k / cols, x = k - y * cols;
        for (int oy = -1; oy <= 1; oy++) { int ny = y + oy; if (ny < 0 || ny >= rows) continue; int rb = ny * cols;
          for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox; if (nx < 0 || nx >= cols) continue;
            int nid = cc[rb + nx]; if (nid < 0) continue; int ngid = offset + nid;
            unite(parent, gid, ngid);
            if (groundParent) unite(*groundParent, gid, ngid);
            if (cgCompStamp[ngid] != gen) { cgCompStamp[ngid] = gen; cgWorkQueue.push_back(ngid); }
          }
        }
      }
    }
  }

  // Cross-layer grounding (runs once per step when the background is live). Each
  // layer is grounded independently first; cross-layer contact then creates
  // transient component bonds only when a connected overlap patch is large enough.
  // A bonded assembly is grounded only if one member has ordinary same-layer/floor
  // support. Unsupported overlaps therefore fall together instead of pinning each
  // other, and tiny accidental overlaps do not transmit support.
  void computeGroundedBoth() {
    cgPrevFg.assign(fg.groundedCell.begin(), fg.groundedCell.end());
    cgPrevBg.assign(bg.groundedCell.begin(), bg.groundedCell.end());
    useLayer(&fg); computeGrounded();
    cgFgBase.assign(fg.groundedCell.begin(), fg.groundedCell.end());
    useLayer(&bg); computeGrounded();
    cgBgBase.assign(bg.groundedCell.begin(), bg.groundedCell.end());

    int nf = compCount(fg), nb = compCount(bg);
    fg.crossBondedComp.assign(nf, 0);
    bg.crossBondedComp.assign(nb, 0);
    cgBonds.clear();

    // Tiny (< MIN_CELLS) chunks can never reach the bond patch threshold, so a
    // 1-3 cell stone bit in front of solid background used to fall. They also
    // don't need the coupled-assembly move machinery (they just shouldn't fall) —
    // routing them through bonds made churny terrain re-run that machinery every
    // step. Instead ground a tiny ungrounded comp directly when a majority of its
    // cells are backed by GROUNDED other-layer rigid. Uses the independent base
    // grounding snapshots (cgFgBase/cgBgBase) so it never chains or lets two
    // ungrounded chunks float on each other; cheap (O(tiny-comp cells)).
    auto directGroundSmall = [&](Layer& lay, int count, const std::vector<uint8_t>& otherBase, const uint8_t* otherGrid) {
      for (int i = 0; i < count; i++) {
        Comp* c = compById(lay, i);
        if (c->grounded || (int)c->cells.size() >= CROSS_LAYER_BOND_MIN_CELLS) continue;
        int backed = 0;
        for (int k : c->cells) if (otherBase[k] && isRigidMaterial(otherGrid[k])) backed++;
        if (backed * 2 >= (int)c->cells.size()) { c->grounded = true; for (int k : c->cells) lay.groundedCell[k] = 1; }
      }
    };
    directGroundSmall(fg, nf, cgBgBase, bg.grid);
    directGroundSmall(bg, nb, cgFgBase, fg.grid);

    bool anyUnsupported = false;
    for (int i = 0; i < nf && !anyUnsupported; i++) if (!compById(fg, i)->grounded) anyUnsupported = true;
    for (int i = 0; i < nb && !anyUnsupported; i++) if (!compById(bg, i)->grounded) anyUnsupported = true;

    auto wakeLost = [&](Layer& lay, const std::vector<uint8_t>& prev) {
      const uint8_t* gr = lay.groundedCell.data(); const uint8_t* g = lay.grid;
      int32_t* rmn = lay.rowMarkMin.data(); int32_t* rmx = lay.rowMarkMax.data();
      for (int y = 0; y < rows; y++) {
        int rb = y * cols, mn = rmn[y], mx = rmx[y];
        for (int x = 0; x < cols; x++) { int k = rb + x; if (prev[k] && !gr[k] && isRigidMaterial(g[k])) { if (x < mn) mn = x; if (x > mx) mx = x; } }
        rmn[y] = mn; rmx[y] = mx;
      }
    };
    if (!anyUnsupported) {
      wakeLost(fg, cgPrevFg); wakeLost(bg, cgPrevBg);
      useLayer(&fg);
      return;
    }

    std::vector<int> fgArea(nf, 0), bgArea(nb, 0);
    for (int i = 0; i < nf; i++) fgArea[i] = (int)compById(fg, i)->cells.size();
    for (int i = 0; i < nb; i++) bgArea[i] = (int)compById(bg, i)->cells.size();

    std::unordered_map<int64_t, std::vector<int>> pairCells;
    for (int fi = 0; fi < nf; fi++) {
      Comp* fc = compById(fg, fi);
      if (fc->grounded) continue;
      for (int k : fc->cells) {
        int bi = bg.cellComp[k];
        if (bi < 0 || !isRigidMaterial(bg.grid[k])) continue;
        int64_t key = ((int64_t)fi << 32) | (uint32_t)bi;
        pairCells[key].push_back(k);
      }
    }
    for (int bi = 0; bi < nb; bi++) {
      Comp* bc = compById(bg, bi);
      if (bc->grounded) continue;
      for (int k : bc->cells) {
        int fi = fg.cellComp[k];
        if (fi < 0 || !isRigidMaterial(fg.grid[k]) || !compById(fg, fi)->grounded) continue;
        int64_t key = ((int64_t)fi << 32) | (uint32_t)bi;
        pairCells[key].push_back(k);
      }
    }

    // Largest-connected-overlap test, stamp-flooded (no per-pair hash sets): a cell
    // of this pair's overlap is "present" iff seen[k] == gen; consuming it sets 0.
    std::vector<int32_t>& seen = fg.seenStamp;
    std::vector<int>& stack = cgStack;
    for (auto& kv : pairCells) {
      int fi = (int)(kv.first >> 32), bi = (int)(uint32_t)kv.first;
      int required = imax(CROSS_LAYER_BOND_MIN_CELLS, (int)std::ceil(CROSS_LAYER_BOND_AREA_FRAC * (double)imin(fgArea[fi], bgArea[bi])));
      if ((int)kv.second.size() < required) continue;
      int32_t gen = ++fg.seenGen;
      for (int k : kv.second) seen[k] = gen;
      int largest = 0;
      for (int start : kv.second) {
        if (seen[start] != gen) continue;
        seen[start] = 0; stack.clear(); stack.push_back(start);
        int patch = 0;
        while (!stack.empty()) {
          int k = stack.back(); stack.pop_back(); patch++;
          int y = k / cols, x = k - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            int nx = x + ox, ny = y + oy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            int nk = ny * cols + nx;
            if (seen[nk] == gen) { seen[nk] = 0; stack.push_back(nk); }
          }
        }
        if (patch > largest) largest = patch;
      }
      if (largest >= required) {
        cgBonds.push_back({fi, bi, true});
        fg.crossBondedComp[fi] = 1;
        bg.crossBondedComp[bi] = 1;
      } else if (largest > 0 && !compById(fg, fi)->grounded && !compById(bg, bi)->grounded) {
        cgBonds.push_back({fi, bi, false});
        fg.crossBondedComp[fi] = 1;
        bg.crossBondedComp[bi] = 1;
      }
    }

    if (cgBonds.empty()) {
      wakeLost(fg, cgPrevFg); wakeLost(bg, cgPrevBg);
      useLayer(&fg);
      return;
    }

    std::vector<int>& parent = cgParent; std::vector<int>& groundParent = cgGroundParent;
    parent.assign(nf + nb, 0); groundParent.assign(nf + nb, 0);
    for (int i = 0; i < nf + nb; i++) parent[i] = groundParent[i] = i;
    auto find = [&](std::vector<int>& p, int a) { while (p[a] != a) { p[a] = p[p[a]]; a = p[a]; } return a; };
    auto unite = [&](std::vector<int>& p, int a, int b) { int ra = find(p, a), rb = find(p, b); if (ra != rb) p[ra] = rb; };
    for (auto& b : cgBonds) {
      unite(parent, b.fgComp, nf + b.bgComp);
      if (b.supportsGround) unite(groundParent, b.fgComp, nf + b.bgComp);
    }
    // Same-layer adjacency: bounded walk from ungrounded bonded comps instead of
    // the old O(cols*rows) full-grid scan (the panning-perf regression).
    unionCrossBondedClusters(parent, &groundParent, nf, nb);
    std::vector<uint8_t> rootBonded(nf + nb, 0);
    for (auto& b : cgBonds) rootBonded[find(parent, b.fgComp)] = 1;
    std::fill(fg.crossBondedComp.begin(), fg.crossBondedComp.end(), (uint8_t)0);
    std::fill(bg.crossBondedComp.begin(), bg.crossBondedComp.end(), (uint8_t)0);
    for (int i = 0; i < nf; i++) if (rootBonded[find(parent, i)]) fg.crossBondedComp[i] = 1;
    for (int i = 0; i < nb; i++) if (rootBonded[find(parent, nf + i)]) bg.crossBondedComp[i] = 1;
    std::vector<uint8_t> rootGrounded(nf + nb, 0);
    for (int i = 0; i < nf; i++) if (compById(fg, i)->grounded) rootGrounded[find(groundParent, i)] = 1;
    for (int i = 0; i < nb; i++) if (compById(bg, i)->grounded) rootGrounded[find(groundParent, nf + i)] = 1;
    for (int i = 0; i < nf; i++) if (fg.crossBondedComp[i] && rootGrounded[find(groundParent, i)]) {
      Comp* c = compById(fg, i); c->grounded = true;
      for (int k : c->cells) fg.groundedCell[k] = 1;
    }
    for (int i = 0; i < nb; i++) if (bg.crossBondedComp[i] && rootGrounded[find(groundParent, nf + i)]) {
      Comp* c = compById(bg, i); c->grounded = true;
      for (int k : c->cells) bg.groundedCell[k] = 1;
    };

    // Re-wake whatever lost grounding this step (only the 1->0 transition;
    // already-ungrounded cells stay active from their own motion/edits).
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

  bool compIdIsPlant(Layer& lay, int id) {
    int ns = (int)lay.stoneComponents.size();
    if (id < ns) return false;
    id -= ns;
    return id < (int)lay.plantComponents.size();
  }

  void moveCrossLayerBondedAssemblies() {
    int nf = compCount(fg), nb = compCount(bg);
    if (cgBonds.empty() || nf == 0 || nb == 0) return;
    std::vector<int>& parent = cgParent;
    parent.assign(nf + nb, 0);
    for (int i = 0; i < nf + nb; i++) parent[i] = i;
    auto find = [&](int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    auto unite = [&](int a, int b) { int ra = find(a), rb = find(b); if (ra != rb) parent[ra] = rb; };
    for (auto& b : cgBonds) unite(b.fgComp, nf + b.bgComp);
    // Bounded same-layer union-find (replaces the old full-grid uniteLayerAdj),
    // seeded from ungrounded cross-bonded comps; operates on cgParent so the
    // helper's internal find/unite share this same array.
    unionCrossBondedClusters(parent, nullptr, nf, nb);

    struct JointGroup { std::vector<int> fgComps, bgComps; bool grounded = false; int maxY = 0; };
    std::unordered_map<int, JointGroup> groups;
    for (int i = 0; i < nf; i++) if (i < (int)fg.crossBondedComp.size() && fg.crossBondedComp[i]) {
      int r = find(i); JointGroup& g = groups[r]; g.fgComps.push_back(i);
      Comp* c = compById(fg, i); if (c->grounded) g.grounded = true; if (c->yMax > g.maxY) g.maxY = c->yMax;
    }
    for (int i = 0; i < nb; i++) if (i < (int)bg.crossBondedComp.size() && bg.crossBondedComp[i]) {
      int r = find(nf + i); JointGroup& g = groups[r]; g.bgComps.push_back(i);
      Comp* c = compById(bg, i); if (c->grounded) g.grounded = true; if (c->yMax > g.maxY) g.maxY = c->yMax;
    }
    std::vector<JointGroup*> order; order.reserve(groups.size());
    for (auto& kv : groups) order.push_back(&kv.second);
    std::sort(order.begin(), order.end(), [](JointGroup* a, JointGroup* b) { return a->maxY > b->maxY; });

    std::unordered_set<int> fgCells, bgCells;
    struct CellMat { int k; uint8_t m; };
    std::vector<CellMat> fgMats, bgMats;
    auto collect = [&](Layer& lay, const std::vector<int>& ids, std::unordered_set<int>& cells, std::vector<CellMat>& mats) {
      cells.clear(); mats.clear();
      for (int id : ids) {
        Comp* c = compById(lay, id);
        for (int k : c->cells) { cells.insert(k); mats.push_back({k, lay.grid[k]}); }
      }
    };
    auto canMoveLayer = [&](Layer& lay, const std::unordered_set<int>& own) {
      for (int k : own) {
        int nk = k + cols, ny = nk / cols;
        if (ny < 1 || ny >= rows) return false;
        if (own.count(nk)) continue;
        if (lay.grid[nk] != EMPTY) return false;
      }
      return true;
    };
    auto applyLayer = [&](Layer& lay, const std::vector<int>& ids, const std::unordered_set<int>& cells, const std::vector<CellMat>& mats) {
      useLayer(&lay);
      for (int k : cells) if (!cells.count(k - cols)) writeGridIndex(k, EMPTY);
      for (auto& cm : mats) writeGridIndex(cm.k + cols, cm.m);
      for (int id : ids) {
        Comp* c = compById(lay, id);
        bool isPlant = compIdIsPlant(lay, id);
        int wood = 0, leaf = 0, ym = 0;
        for (int& k : c->cells) {
          k += cols;
          int y = k / cols; if (y > ym) ym = y;
          if (isPlant) { uint8_t m = lay.grid[k]; if (isPlantWood(m)) wood++; else if (isPlantLeaf(m)) leaf++; }
        }
        c->yMax = ym;
        if (isPlant) { c->woodCount = wood; c->leafCount = leaf; c->cacheDirty = true; }
      }
    };

    for (JointGroup* g : order) {
      if (g->grounded || g->fgComps.empty() || g->bgComps.empty()) continue;
      collect(fg, g->fgComps, fgCells, fgMats);
      collect(bg, g->bgComps, bgCells, bgMats);
      if (!canMoveLayer(fg, fgCells) || !canMoveLayer(bg, bgCells)) continue;
      applyLayer(fg, g->fgComps, fgCells, fgMats);
      applyLayer(bg, g->bgComps, bgCells, bgMats);
    }
    useLayer(&fg);
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
      for (auto& c : list) { if (!c.grounded && (!jointGroundReady || gi >= (int)L->crossBondedComp.size() || !L->crossBondedComp[gi])) { localOf[gi] = (int)all.size(); all.push_back(&c); } gi++; }
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

    // Read the live grid for stone-group and plant comps so a falling component
    // keeps its real material (ore stays ore, not STONE). Ice comps are pure ICE.
    auto matOf = [&](int i, int k) -> uint8_t { return i < nStonePlant ? grid[k] : ICE; };

    auto translateAssembly = [&](Group* grp, std::unordered_set<int>& cells, int dir) -> bool {
      int dy = dir > 0 ? 1 : -1;
      double assemblyDensity = 0;
      int assemblyCells = 0;
      for (int ci : grp->comps) for (int k : all[ci]->cells) { assemblyDensity += DENSITY[matOf(ci, k)]; assemblyCells++; }
      assemblyDensity = assemblyCells > 0 ? assemblyDensity / assemblyCells : 0;
      auto componentDisplaceableForAssembly = [&](uint8_t m) {
        if (m == EMPTY || isGas(m) || isLiquid(m)) return true;
        return MAT_KIND[m] == K_POWDER && DENSITY[m] < assemblyDensity;
      };
      std::unordered_set<int> movedCells;
      for (int k : cells) { int leadK = k + dir; int leadY = leadK / cols; if (leadY < 1 || leadY >= rows) return false; if (cells.count(leadK)) continue; if (!componentDisplaceableForAssembly(grid[leadK])) return false; }
      for (int k : cells) movedCells.insert(k + dir);
      struct Disp { uint8_t material; int from; };
      std::vector<Disp> displaced; std::vector<int> vacated;
      for (int k : cells) { int leadK = k + dir; uint8_t lead = grid[leadK]; if (!cells.count(leadK) && lead != EMPTY && componentDisplaceableForAssembly(lead)) displaced.push_back({lead, leadK}); if (!cells.count(k - dir)) vacated.push_back(k); }
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
        for (int k : comp->cells) { uint8_t m = matOf(ci, k); mats.push_back({k + dir, m}); if (isPlant) { if (isPlantWood(m)) wood++; else if (isPlantLeaf(m)) leaf++; } }
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
  // Component-group membership for the seeded-component floods (generated from the
  // schema `componentGroup`). The stone group floods each material as its OWN id
  // (an ore vein is its own island, not merged with surrounding stone), so it uses
  // floodTargetMat rather than a group-membership predicate.
  uint8_t floodTargetMat = 0;                                  // set before a per-material stone flood
  bool isFloodTargetMat(uint8_t m) { return m == floodTargetMat; }
  bool isIceGroup(uint8_t m) { return MAT_CGROUP[m] == CG_ICE; }
  bool isPlantMat(uint8_t m) { return MAT_CGROUP[m] == CG_PLANT; }

  void registerSeededComponents(int colStart, int colEnd) { registerSeededComponents(colStart, colEnd, 0, rows); }
  // Register stone/plant/ice components for unseen material in the buffer rect
  // [colStart,colEnd) x [rowStart,rowEnd). A streamed-in vertical band passes a row
  // range (cols-wide); a horizontal band passes a col range (rows-tall).
  void registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd) {
    // Reused generation-stamped scratch (allocated once in Layer::alloc): a cell
    // is "seen" iff seenStamp[k] == gen. Each of the three blocks bumps gen, so
    // the "clear" between materials costs O(1) instead of zeroing cols*rows.
    std::vector<int32_t>& seen = L->seenStamp;
    // STONE group (chunk-bounded). Each same-id region floods as its own island,
    // so a vein of ore inside stone is a distinct component (and stays a distinct
    // material when it falls — see matOf in moveRigidAssemblies). New ores/blocks
    // with componentGroup "stone" register here automatically.
    {
      int32_t gen = ++L->seenGen;
      for (auto& comp : L->stoneComponents) for (int k : comp.cells) seen[k] = gen;
      for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] == gen || MAT_CGROUP[grid[k]] != CG_STONE) continue;
        std::vector<int> cells; int yMax;
        floodTargetMat = grid[k];
        floodComponent(sx, sy, seen, gen, true, cells, yMax, &Engine::isFloodTargetMat);
        Comp c; c.id = L->nextStoneId++; c.cells = std::move(cells); c.yMax = yMax; L->stoneComponents.push_back(std::move(c));
      }
    }
    // PLANT group (unbounded — a whole tree is one component). New plant-family
    // flora with componentGroup "plant" register here automatically.
    {
      int32_t gen = ++L->seenGen;
      for (auto& comp : L->plantComponents) for (int k : comp.cells) seen[k] = gen;
      for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] == gen || MAT_CGROUP[grid[k]] != CG_PLANT) continue;
        std::vector<int> cells; int yMax;
        floodComponent(sx, sy, seen, gen, false, cells, yMax, &Engine::isPlantMat);
        Comp c; c.id = L->nextPlantId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
        // Re-derive the species from the trunk material (so a streamed-in / restored
        // tree keeps its type — the cells ARE the persistence) and count generically.
        for (int kk : cells) { uint8_t m = grid[kk]; if (isPlantWood(m)) { c.woodCount++; if (c.plantType == PT_OAK) c.plantType = plantTypeFromWood(m); } else if (isPlantLeaf(m)) c.leafCount++; }
        c.cells = std::move(cells); L->plantComponents.push_back(std::move(c));
      }
    }
    // ICE group (unbounded).
    {
      int32_t gen = ++L->seenGen;
      for (auto& comp : L->iceComponents) for (int k : comp.cells) seen[k] = gen;
      for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] == gen || MAT_CGROUP[grid[k]] != CG_ICE) continue;
        std::vector<int> cells; int yMax;
        floodComponent(sx, sy, seen, gen, false, cells, yMax, &Engine::isIceGroup);
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

  // Split the freshly-placed `cells` into 8-connected groups and register each as
  // its OWN component (each still merges with adjacent EXISTING same-material comps
  // inside registerRigidCells). A fast cursor leaves air gaps between brush stamps,
  // so one draft can drop several physically-disconnected blobs. Lumping them into a
  // SINGLE component (plain registerRigidCells) makes the whole thing inherit the
  // grounded flag of any one supported blob — computeGrounded sets comp->grounded
  // from any grounded cell, and moveRigidAssemblies only moves !grounded comps — so
  // floating blobs never fall. Splitting first lets each disconnected blob be judged
  // for support on its own, matching driftwood (which registers through the flood-fill
  // registerSeededComponents). 8-connectivity mirrors computeGrounded/moveRigidAssemblies
  // so the split agrees with how the physics later groups and grounds these cells.
  void registerRigidCellsSplit(std::vector<Comp>& list, int& nextId, uint8_t mat,
                               std::unordered_set<int>& cells, bool iceCache) {
    if (cells.empty()) return;
    std::unordered_set<int> remaining(cells.begin(), cells.end());
    std::vector<int> stack;
    while (!remaining.empty()) {
      int seed = *remaining.begin(); remaining.erase(remaining.begin());
      std::unordered_set<int> group; int yMax = 0;
      stack.clear(); stack.push_back(seed);
      while (!stack.empty()) {
        int k = stack.back(); stack.pop_back();
        group.insert(k); int y = k / cols, x = k - y * cols; if (y > yMax) yMax = y;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          int nk = ny * cols + nx; auto it = remaining.find(nk);
          if (it != remaining.end()) { remaining.erase(it); stack.push_back(nk); }
        }
      }
      registerRigidCells(list, nextId, mat, group, yMax, iceCache);
    }
  }

  // split a plant-family component list keeping only cells still of plant material
  void splitPlantAfterErase() {
    std::vector<Comp> updated;
    std::vector<int32_t>& seen = L->seenStamp;
    std::vector<int> part;
    for (auto& comp : L->plantComponents) {
      int32_t remGen = ++L->seenGen;
      for (int k : comp.cells) if (isPlantMaterial(grid[k])) seen[k] = remGen;
      bool reused = false;
      for (int seed : comp.cells) {
        if (seen[seed] != remGen) continue;
        part.clear(); part.push_back(seed); seen[seed] = 0; // part doubles as the BFS queue; seen[] dedups
        for (size_t qi = 0; qi < part.size(); qi++) {
          int cur = part[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (seen[nk] == remGen) { seen[nk] = 0; part.push_back(nk); } }
        }
        Comp c; c.id = reused ? L->nextPlantId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
        c.plantType = comp.plantType; c.growing = comp.growing; // a cut tree keeps species + growth on both halves
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; if (isPlantWood(grid[k])) c.woodCount++; else if (isPlantLeaf(grid[k])) c.leafCount++; }
        c.cells = std::move(part); updated.push_back(std::move(c)); reused = true;
      }
    }
    L->plantComponents = std::move(updated);
  }
  // split stone/ice after erase: remove erased cells, re-flood
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache) {
    if (erased.empty() || list.empty()) return;
    std::vector<int32_t>& seen = L->seenStamp;
    int32_t erasedGen = ++L->seenGen;
    for (int k : erased) seen[k] = erasedGen;
    std::vector<Comp> updated;
    std::vector<int> survivors, part;
    for (auto& comp : list) {
      bool touched = false;
      survivors.clear(); survivors.reserve(comp.cells.size());
      for (int k : comp.cells) { if (seen[k] == erasedGen) touched = true; else survivors.push_back(k); }
      if (!touched) { updated.push_back(std::move(comp)); continue; }
      if (survivors.empty()) continue;
      int32_t remGen = ++L->seenGen;
      for (int k : survivors) seen[k] = remGen;
      bool reused = false;
      for (int start : survivors) {
        if (seen[start] != remGen) continue;
        part.clear(); part.push_back(start); seen[start] = 0; // part doubles as the BFS queue
        for (size_t qi = 0; qi < part.size(); qi++) {
          int cur = part[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (seen[nk] == remGen) { seen[nk] = 0; part.push_back(nk); } }
        }
        Comp c; c.id = reused ? nextId++ : comp.id; c.yMax = 0; c.cacheDirty = iceCache;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; }
        c.cells = std::move(part); updated.push_back(std::move(c));
        reused = true;
      }
    }
    list = std::move(updated);
  }
