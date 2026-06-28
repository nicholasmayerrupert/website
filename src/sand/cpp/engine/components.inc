  // Component lifetime and connectivity.
  //
  // Stone, ice, and plant materials are not loose pixels. They survive a step
  // only through component membership, and unregistered component cells are
  // erased during cleanup. Tool placement, worldgen, growth, and world shifting
  // should route component writes through this subsystem and then sync/register.
  // Rebuild cellComp[] (cell -> component index), the cgComps index, and per-
  // component mean density. Shared by the full reflood (computeGrounded) and the
  // incremental refresh (incrementalGroundingRefresh). Resets each Comp's grounded
  // flag to false (the flood / refresh sets it back). Does NOT touch groundedCell[].
  // O(total component cells).
  void indexComponents() {
    cgComps.clear();
    cgCompDensity.clear();
    auto idx = [&](std::vector<Comp>& list) {
      for (auto& c : list) {
        c.grounded = false;
        int id = (int)cgComps.size();
        cgComps.push_back(&c);
        double sum = 0;
        for (int k : c.cells) { cellComp[k] = id; sum += DENSITY[grid[k]]; }
        cgCompDensity.push_back(c.cells.empty() ? 0 : sum / c.cells.size());
      }
    };
    idx(L->stoneComponents); idx(L->plantComponents); idx(L->iceComponents);
  }
  void computeGrounded() {
    std::fill(groundedCell, groundedCell + (size_t)cols * rows, (uint8_t)0);
    std::fill(cellComp, cellComp + (size_t)cols * rows, -1);
    indexComponents();
    bool sawPowder = false;
    auto canGroundAbove = [&](int below, int above) {
      uint8_t upper = grid[above];
      if (!isBearingMaterial(upper)) return false;
      uint8_t lower = grid[below];
      // Powders support other bearing loose cells, but they are a buoyant medium
      // for rigid solids. Rigid-on-powder is handled by moveRigidAssemblies with
      // density-based displacement/buoyancy, not by marking the rigid component
      // grounded at the powder surface.
      if (MAT_KIND[lower] == K_POWDER && isRigidMaterial(upper)) return false;
      return true;
    };
    int sp = 0;
    if (groundStackX.size() != (size_t)cols * rows) groundStackX.assign((size_t)cols * rows, 0);
    int32_t* gsx = groundStackX.data();
    // groundCellAt records the cell's column x alongside k, so the DFS below never
    // recomputes k/cols (an integer division per popped rigid cell). Every caller
    // already knows x: the seeds iterate x, and a propagation target's column is
    // derived from its parent (the cell above shares x; an 8-neighbour is nx).
    auto groundCellAt = [&](int k, int x) {
      if (groundedCell[k]) return;
      groundedCell[k] = 1;
      int id = cellComp[k];
      if (id >= 0) cgComps[id]->grounded = true;
      gsx[sp] = x; groundStack[sp++] = k;
    };
    int floorBase = (rows - 1) * cols;
    for (int x = 0; x < cols; x++) { int k = floorBase + x; if (isBearingMaterial(grid[k])) groundCellAt(k, x); }
    // Streamed-edge support: in the infinite world the left/right/top buffer edges abut
    // UNLOADED world that may itself be grounded. A rigid cell touching such an edge is
    // assumed supported, so a structure whose real floor-contact has streamed off the
    // buffer does not spuriously fall (it reconnects when the region streams back in).
    if (L->infinite) {
      for (int y = 1; y < rows; y++) {
        int kl = y * cols + 1;          if (isRigidMaterial(grid[kl])) groundCellAt(kl, 1);
        int kr = y * cols + (cols - 2); if (isRigidMaterial(grid[kr])) groundCellAt(kr, cols - 2);
      }
      int topBase = cols; // row y = 1
      for (int x = 1; x < cols - 1; x++) { int k = topBase + x; if (isRigidMaterial(grid[k])) groundCellAt(k, x); }
    }
    for (int y = rows - 2; y > 0; y--) {
      int rb = y * cols;
      for (int x = 1; x < cols - 1; x++) {
        int k = rb + x;
        if (MAT_KIND[grid[k]] == K_POWDER) {
          sawPowder = true;
          if (isLiquid(grid[k + cols]) && DENSITY[grid[k + cols]] >= DENSITY[grid[k]]) groundCellAt(k, x);
        }
      }
    }
    int gridLen = cols * rows;
    while (sp > 0) {
      --sp; int k = groundStack[sp], kx = gsx[sp];
      int above = k - cols;
      if (above >= 0 && !groundedCell[above] && canGroundAbove(k, above)) groundCellAt(above, kx);
      if (isRigidMaterial(grid[k])) {
        // Neighbour-row validity ny in [1, rows-1] <=> (k + oy*cols) in [cols, gridLen):
        // a division-free restatement of the original `ny<=0 || ny>=rows` test.
        for (int oy = -1; oy <= 1; oy++) {
          int rb = k + oy * cols;
          if (rb < cols || rb >= gridLen) continue;
          for (int ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            int nx = kx + ox; if (nx <= 0 || nx >= cols - 1) continue;
            int nk = rb + ox;
            if (!groundedCell[nk] && isRigidMaterial(grid[nk])) groundCellAt(nk, nx);
          }
        }
      }
    }
    // The cache is now fresh. Stay "dirty" (force a full reflood next step too)
    // while any powder is present: powder grounding (line above) depends on the
    // liquid beneath it, and liquids move without routing through the component
    // hooks that set groundDirty, so we can't safely skip the flood with powder
    // around. Powder-free scenes (e.g. acid eating stone) go clean and can skip.
    L->groundSawPowder = sawPowder;
    L->groundDirty = sawPowder;
  }

  // Incremental grounding for the common single-layer, powder-free case: the
  // expensive part of computeGrounded is the flood; everything else (cellComp +
  // per-component density + grounded flags) is a cheap O(stone) linear pass. When
  // no removal disconnected anything (Layer::groundDirty stayed false), the cached
  // groundedCell[] is still the true grounded set (removed cells were patched to 0
  // at the dissolve site), so we skip the flood entirely and only rebuild the
  // cheap bookkeeping, deriving each component's grounded flag from the cache.
  // Produces a byte-identical groundedCell[]/cellComp[] to a full reflood (verified).
  void incrementalGroundingRefresh() {
    std::fill(cellComp, cellComp + (size_t)cols * rows, -1);
    indexComponents();                       // rebuilds cellComp + cgCompDensity, resets grounded=false
    for (Comp* c : cgComps) {                // a connected component is grounded iff ANY of its cells is
      for (int k : c->cells) if (groundedCell[k]) { c->grounded = true; break; }
    }
  }

  // Single-layer grounding entry point (the cross-layer path uses computeGrounded
  // directly via computeGroundedBoth). Picks the full reflood or the incremental
  // refresh, and when groundVerify is on, runs BOTH and asserts byte-equality so a
  // wrong fast path can never silently desync — it shows up as a test failure.
  void ensureGroundedSingleLayer() {
    bool full = groundForceFull || bgEnabled || L->groundDirty;
    // Skip the whole pass when nothing that affects grounding changed since the last
    // one: powder-free (powder grounding tracks liquids outside the component hooks),
    // no structural change (groundDirty), and no acid fast-path removal
    // (groundContentDirty). Every rigid mutation EITHER sets groundDirty or is the
    // acid fast-path removal (which sets groundContentDirty), so when all three are
    // clear the cached cellComp[]/groundedCell[]/comp.grounded are byte-identical to a
    // fresh incremental refresh — re-running it (an O(all rigid cells) pass) is pure
    // waste. This is what keeps a big INERT rigid mass cheap: a resting acid pool held
    // in an ice tub, say, while acid bores stone elsewhere. The boring keeps the LAYER
    // active every step, but only the steps that actually edit rigid content pay the
    // O(stone+ice) grounding cost; idle/non-dissolving steps reuse the cache for free.
    if (!full && !groundVerify && !L->groundSawPowder && !L->groundContentDirty) return;
    L->groundContentDirty = false;
    if (!groundVerify) {
      if (full) computeGrounded(); else incrementalGroundingRefresh();
      return;
    }
    if (full) computeGrounded(); else incrementalGroundingRefresh();
    gvGrounded.assign(groundedCell, groundedCell + (size_t)cols * rows);
    gvCellComp.assign(cellComp, cellComp + (size_t)cols * rows);
    computeGrounded(); // the trusted reference; leaves the live arrays correct regardless
    for (size_t i = 0, n = (size_t)cols * rows; i < n; i++) {
      if (gvGrounded[i] != groundedCell[i] || gvCellComp[i] != cellComp[i]) { groundMismatches++; break; }
    }
  }

  // Do all of the rigid cells in `boundary` (the surviving rigid neighbours of the
  // removed blob) reconnect to one another through rigid material within [x0,x1] x
  // [y0,y1], WITHOUT passing through any cell stamped `removedGen`? If so, the blob is
  // not a cut: every path that used the blob reroutes through the reconnected
  // boundary, so removing it disconnects nothing. A bounded window + visit cap keep
  // it cheap; failing to connect (or exceeding the cap) is treated as a cut, which is
  // always safe (the caller refloods).
  bool blobBoundaryReconnects(const std::vector<int>& boundary, int32_t inN, int x0, int y0, int x1, int y1, int32_t removedGen) {
    int32_t vis = ++L->seenGen;
    // Early-exit means a genuine reconnection finds all boundary cells quickly, so the
    // cap only bounds the wasted work of a check that is going to FAIL (a real cut):
    // keep it modest so a failing check costs far less than the reflood it precedes.
    int* q = groundStack; const int cap = 8000;
    int qh = 0, qt = 0;
    int need = (int)boundary.size(), found = 1; // boundary[0] is the BFS seed
    L->seenStamp[boundary[0]] = vis; q[qt++] = boundary[0];
    while (qh < qt) {
      if (qt >= cap) return false;
      int cur = q[qh++]; int cy = cur / cols, cx = cur - cy * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = cx + ox, ny = cy + oy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        int nk = ny * cols + nx;
        int32_t s = L->seenStamp[nk];
        if (s == vis || s == removedGen) continue;
        if (!isRigidMaterial(grid[nk])) continue;
        if (s == inN && ++found == need) return true; // all boundary cells reconnected -> not a cut (early out)
        L->seenStamp[nk] = vis; q[qt++] = nk;
      }
    }
    return found == need;
  }

  // Decide whether ONE 8-connected blob of just-removed rigid cells (grid already
  // cleared at each) keeps the grounding cache valid. A removal changes another cell's
  // grounding only by disconnecting it from a SEED (floor / streamed buffer edge /
  // powder-on-dense-liquid). The blob is safe when it is (a) compact (small bbox) and
  // clear of the edge/floor seed margin, (b) free of powder in its neighbourhood, and
  // (c) such that every surviving rigid neighbour of the blob reconnects to the others
  // without the blob. Then removing it disconnects nothing and the only grounding
  // change is the removed cells themselves. Does NOT patch groundedCell -- the caller
  // (removalsKeepGroundingValid) patches once every component of the batch is cleared,
  // so a later failing component still leaves the cache untouched for the reflood.
  bool blobKeepsGroundingValid(const std::vector<int>& blob) {
    const int MARGIN = 2;  // stay clear of the floor (row rows-1) and streamed edges
    const int SPAN = 128;  // max blob extent for the fast path; wider spreads reflood
    const int W = 8;       // reconnect-search margin around the blob bbox
    int32_t gen = ++L->seenGen;
    int bx0 = cols, by0 = rows, bx1 = -1, by1 = -1;
    for (int k : blob) {
      L->seenStamp[k] = gen;
      int y = k / cols, x = k - y * cols;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    if (bx1 - bx0 > SPAN || by1 - by0 > SPAN) { gbSpan++; return false; }
    if (bx0 <= MARGIN || bx1 >= cols - 1 - MARGIN || by0 <= MARGIN || by1 >= rows - 1 - MARGIN) { gbEdge++; return false; }
    // Gather the blob's surviving rigid neighbours (deduped via the inN stamp); bail
    // on any powder nearby (powder/liquid grounding nuance not modelled here). Removed
    // cells of OTHER components are already empty in the grid, so they are skipped by
    // the isRigidMaterial test and never pollute this blob's boundary.
    int32_t inN = ++L->seenGen;
    cgBlobN.clear();
    for (int r : blob) {
      int ry = r / cols, rx = r - ry * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nk = (ry + oy) * cols + (rx + ox);
        uint8_t m = grid[nk];
        if (MAT_KIND[m] == K_POWDER) { gbPowder++; return false; }
        if (isRigidMaterial(m) && L->seenStamp[nk] != gen && L->seenStamp[nk] != inN) { L->seenStamp[nk] = inN; cgBlobN.push_back(nk); }
      }
    }
    if ((int)cgBlobN.size() > 1) {  // 0/1 external connection: the blob is a pendant, removing it disconnects nothing else
      int x0 = imax(1, bx0 - W), x1 = imin(cols - 2, bx1 + W);
      int y0 = imax(1, by0 - W), y1 = imin(rows - 2, by1 + W);
      if (!blobBoundaryReconnects(cgBlobN, inN, x0, y0, x1, y1, gen)) { gbCut++; return false; }
    }
    gbFast++;
    return true;
  }

  // Decide whether a batch of just-removed rigid cells keeps the grounding cache valid,
  // by partitioning it into 8-connected components and requiring EVERY component to
  // independently pass blobKeepsGroundingValid. Checking per-component is essential and
  // sound: the cells must be checked as a blob, not one at a time (two ADJACENT removals
  // can together sever a bridge that neither severs alone -- the co-removed neighbour,
  // already cleared, otherwise looks like plain empty space and hides it), but distinct
  // 8-connected components are by definition non-adjacent, so no component can hide a
  // bridge running through another's cells. Any path through a removed cell reroutes
  // locally around its own component using surviving material; disjoint components never
  // share that reroute. This lets a wide erosion front (e.g. a broad acid pool) split
  // into many small blobs that each fast-path, instead of the whole batch bailing on its
  // overall span. groundedCell stays a pure function of the grid -- verified byte-for-byte
  // against a full reflood every step under groundVerify (see the grounding test).
  bool removalsKeepGroundingValid(const std::vector<int>& removed) {
    if (removed.empty()) return true;
    // seenStamp marks each removed cell's partition state: `present` = a removed cell
    // not yet claimed by a component, `taken` = already swept into one. blobKeeps...
    // re-stamps a component's own cells (with a fresh gen) but only after we have
    // finished sweeping that component, so the outer scan still sees later components.
    int32_t present = ++L->seenGen;
    for (int k : removed) L->seenStamp[k] = present;
    int32_t taken = ++L->seenGen;
    for (int seed : removed) {
      if (L->seenStamp[seed] != present) continue; // already pulled into an earlier component
      cgRemovedComp.clear();
      int qt = 0; groundStack[qt++] = seed; L->seenStamp[seed] = taken;
      for (int qh = 0; qh < qt; qh++) {
        int cur = groundStack[qh]; cgRemovedComp.push_back(cur);
        int cy = cur / cols, cx = cur - cy * cols;
        for (int oy = -1; oy <= 1; oy++) { int ny = cy + oy; if (ny < 0 || ny >= rows) continue;
          for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = cx + ox; if (nx < 0 || nx >= cols) continue;
            int nk = ny * cols + nx;
            if (L->seenStamp[nk] == present) { L->seenStamp[nk] = taken; groundStack[qt++] = nk; }
          }
        }
      }
      if (!blobKeepsGroundingValid(cgRemovedComp)) return false; // a real cut/edge/powder/span -> reflood
    }
    for (int k : removed) groundedCell[k] = 0; // every component safe: only the removed cells lose grounding
    return true;
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
  // Produce one layer's BASE grounding (independent of the cross-layer step), either
  // by a full flood or by reusing the cached base from a prior flood. The reuse path
  // is taken only when the layer's rigid topology is provably unchanged: groundDirty
  // false (every add/split/remove/move/freeze/registration sets it) AND no acid
  // fast-path removal (groundContentDirty) AND a valid cache. Because computeGrounded
  // ends with groundDirty = sawPowder, a layer holding powder ALWAYS refloods; only a
  // powder-free, edit-free layer (the dry stone background during a pan) reuses. The
  // reused groundedCell/comp.grounded are byte-identical to a fresh flood (groundedCell
  // is a pure function of the grid; cellComp is written ONLY by grounding so it stays
  // valid untouched between passes). This halves computeGroundedBoth's cost in the
  // common two-layer pan case (the bg flood was ~half the joint-grounding time).
  void groundLayerBase(Layer* lay, std::vector<uint8_t>& baseCache, bool& baseValid, std::vector<uint8_t>& gbCache) {
    useLayer(lay);
    int cc = (int)(lay->stoneComponents.size() + lay->plantComponents.size() + lay->iceComponents.size());
    bool full = groundForceFull || lay->groundDirty || lay->groundContentDirty || !baseValid || (int)gbCache.size() != cc;
    if (full) {
      computeGrounded();
      lay->groundContentDirty = false;
      baseCache.assign(lay->groundedCell.begin(), lay->groundedCell.end());
      gbCache.clear(); gbCache.reserve(cc);
      for (auto& c : lay->stoneComponents) gbCache.push_back(c.grounded ? 1 : 0);
      for (auto& c : lay->plantComponents) gbCache.push_back(c.grounded ? 1 : 0);
      for (auto& c : lay->iceComponents) gbCache.push_back(c.grounded ? 1 : 0);
      baseValid = true;
    } else {
      std::copy(baseCache.begin(), baseCache.end(), lay->groundedCell.begin());
      size_t i = 0;
      for (auto& c : lay->stoneComponents) c.grounded = gbCache[i++] != 0;
      for (auto& c : lay->plantComponents) c.grounded = gbCache[i++] != 0;
      for (auto& c : lay->iceComponents) c.grounded = gbCache[i++] != 0;
    }
  }

  void computeGroundedBoth() {
    cgPrevFg.assign(fg.groundedCell.begin(), fg.groundedCell.end());
    cgPrevBg.assign(bg.groundedCell.begin(), bg.groundedCell.end());
    // Each layer's base grounding: full flood when its rigid topology changed, else a
    // cheap cache reuse. cgFgBase/cgBgBase are populated here (the cross-layer machinery
    // below reads them as the independent base snapshots).
    groundLayerBase(&fg, cgFgBase, cgFgBaseValid, cgFgGroundedBase);
    groundLayerBase(&bg, cgBgBase, cgBgBaseValid, cgBgGroundedBase);

    int nf = compCount(fg), nb = compCount(bg);
    fg.crossBondedComp.assign(nf, 0);
    bg.crossBondedComp.assign(nb, 0);
    cgBonds.clear();

    // Common settled-terrain case: every component already grounded by its own
    // layer's flood. Then the whole cross-layer machinery below is provably a no-op
    // — directGroundSmall only ever touches UNGROUNDED comps, and with none
    // ungrounded no bond patch can form (a bond needs an ungrounded endpoint). So
    // skip it, AND skip the two full-grid base snapshots (cgFgBase/cgBgBase) that
    // only directGroundSmall + the pair-overlap test read. fg.groundedCell is
    // untouched by bg's flood, so deferring those copies to the ungrounded path
    // below is byte-identical to taking them here. Only wakeLost (re-waking cells
    // that lost grounding) still must run.
    bool anyUngrounded = false;
    for (int i = 0; i < nf && !anyUngrounded; i++) if (!compById(fg, i)->grounded) anyUngrounded = true;
    for (int i = 0; i < nb && !anyUngrounded; i++) if (!compById(bg, i)->grounded) anyUngrounded = true;
    if (!anyUngrounded) {
      auto wakeLostQuick = [&](Layer& lay, const std::vector<uint8_t>& prev) {
        const uint8_t* gr = lay.groundedCell.data(); const uint8_t* g = lay.grid;
        int32_t* rmn = lay.rowMarkMin.data(); int32_t* rmx = lay.rowMarkMax.data();
        for (int y = 0; y < rows; y++) {
          int rb = y * cols, mn = rmn[y], mx = rmx[y];
          for (int x = 0; x < cols; x++) { int k = rb + x; if (prev[k] && !gr[k] && isRigidMaterial(g[k])) { if (x < mn) mn = x; if (x > mx) mx = x; } }
          rmn[y] = mn; rmx[y] = mx;
        }
      };
      wakeLostQuick(fg, cgPrevFg); wakeLostQuick(bg, cgPrevBg);
      useLayer(&fg);
      return;
    }
    // cgFgBase/cgBgBase already hold each layer's base grounding (groundLayerBase).

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
    fg.groundDirty = true; bg.groundDirty = true; // cross-layer assembly may move -> reflood both
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
    // Plan a one-cell descent of `own` in `lay`. An assembly descends into EMPTY
    // (or its own) cells, and — like the single-layer translateAssembly — shoves
    // aside loose powder/liquid directly beneath its shell instead of being
    // pinned by it. Without this a sand/water-FILLED bonded shell (a stone circle
    // mirrored in both layers, filled with sand) could never move: its own contents
    // sit directly below the top arc and block the move, so it floats forever.
    // Displaced contents are relocated into the cells the assembly vacates (its
    // per-column tops); if they can't fit there, we decline the move (status quo).
    // Gas is simply overrun (it dissipates), matching translateAssembly.
    auto planLayerMove = [&](Layer& lay, const std::unordered_set<int>& own, double density,
                             std::vector<std::pair<int, uint8_t>>& relocate) -> bool {
      (void)density;
      relocate.clear();
      for (int k : own) {
        int nk = k + cols, ny = nk / cols;
        if (ny < 1 || ny >= rows) return false;
        if (own.count(nk)) continue;
        uint8_t below = lay.grid[nk];
        if (below == EMPTY || isGas(below)) continue;
        bool displaceable = isBuoyantMedium(below);
        if (!displaceable) return false;
        relocate.push_back({0, below}); // dest cell assigned below (after vacated cells are known)
      }
      // Vacated cells (own cells with no own cell above) become empty after the move
      // and receive the displaced material. Count must cover every displaced cell.
      int slots = 0;
      for (int k : own) if (!own.count(k - cols)) slots++;
      if ((int)relocate.size() > slots) return false;
      int ri = 0;
      for (int k : own) { if (ri >= (int)relocate.size()) break; if (!own.count(k - cols)) relocate[ri++].first = k; }
      return true;
    };
    auto applyLayer = [&](Layer& lay, const std::vector<int>& ids, const std::unordered_set<int>& cells, const std::vector<CellMat>& mats, const std::vector<std::pair<int, uint8_t>>& relocate) {
      useLayer(&lay);
      for (int k : cells) if (!cells.count(k - cols)) writeGridIndex(k, EMPTY);
      for (auto& cm : mats) writeGridIndex(cm.k + cols, cm.m);
      for (auto& r : relocate) writeGridIndex(r.first, r.second); // displaced contents into vacated tops
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

    std::vector<std::pair<int, uint8_t>> fgReloc, bgReloc;
    for (JointGroup* g : order) {
      if (g->grounded || g->fgComps.empty() || g->bgComps.empty()) continue;
      collect(fg, g->fgComps, fgCells, fgMats);
      collect(bg, g->bgComps, bgCells, bgMats);
      // Mean density of the whole bonded assembly (both layers) is passed through
      // for parity with the single-layer movement API; loose media are displaced
      // generally and buoyancy is resolved in the per-layer assembly path.
      double sum = 0; int n = 0;
      for (auto& cm : fgMats) { sum += DENSITY[cm.m]; n++; }
      for (auto& cm : bgMats) { sum += DENSITY[cm.m]; n++; }
      double density = n ? sum / n : 0;
      // Both layers must be able to descend (the assembly moves as one unit); if
      // either is blocked by non-displaceable material, the assembly stays put.
      if (!planLayerMove(fg, fgCells, density, fgReloc) || !planLayerMove(bg, bgCells, density, bgReloc)) continue;
      applyLayer(fg, g->fgComps, fgCells, fgMats, fgReloc);
      applyLayer(bg, g->bgComps, bgCells, bgMats, bgReloc);
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
      auto componentDisplaceableForAssembly = [&](uint8_t m) {
        return m == EMPTY || isGas(m) || isBuoyantMedium(m);
      };
      for (int k : cells) { int leadK = k + dir; int leadY = leadK / cols; if (leadY < 1 || leadY >= rows) return false; if (cells.count(leadK)) continue; if (!componentDisplaceableForAssembly(grid[leadK])) return false; }
      struct Disp { uint8_t material; int from; };
      std::vector<Disp> displaced; std::vector<int> vacated;
      for (int k : cells) { int leadK = k + dir; uint8_t lead = grid[leadK]; if (!cells.count(leadK) && lead != EMPTY && componentDisplaceableForAssembly(lead)) displaced.push_back({lead, leadK}); if (!cells.count(k - dir)) vacated.push_back(k); }
      int liquidDisplacedCount = 0, powderDisplacedCount = 0;
      for (auto& d : displaced) { if (isLiquid(d.material)) liquidDisplacedCount++; else if (MAT_KIND[d.material] == K_POWDER) powderDisplacedCount++; }
      // Liquids and powders are relocated volume-preservingly by a spill BFS
      // (each percolates through its own pool to a free surface cell), exactly like a
      // free body's displacement (spillDisplacedBodyMaterial). A heavy assembly sinking
      // into sand thus pushes the sand out to nearby free room — raising the surface
      // around it — instead of teleporting it onto the assembly's own back (the old
      // vacated-cell dump, which heaped sand into a column on top of the descending
      // block). GAS keeps the original vacated-cell dump (it dissipates anyway), so gas
      // handling is left exactly as before — only powder routing changes here.
      std::vector<int> liquidTargets, powderTargets;
      if (liquidDisplacedCount > 0 || powderDisplacedCount > 0) {
        // Cells the assembly is about to occupy — a spill target must not be one of
        // them. Built lazily here (only when liquid/powder is displaced) so a large
        // slab falling through air/empty skips O(area) hash-set work/step.
        std::unordered_set<int> movedCells;
        for (int k : cells) movedCells.insert(k + dir);
        int offs[4]; if (dir > 0) { offs[0] = -1; offs[1] = 1; offs[2] = cols; offs[3] = -cols; } else { offs[0] = -1; offs[1] = 1; offs[2] = -cols; offs[3] = cols; }
        int gridLen = cols * rows;
        std::unordered_set<int> reserved; // EMPTY cells already claimed (shared by both passes)
        // One BFS per phase. Liquids traverse EMPTY/liquid (unchanged); powders ALSO
        // traverse powder so displaced sand can rise through its own grounded pool to
        // the free surface. Liquids reserve FIRST with the original traversal, so their
        // targets stay byte-identical to before; powders then claim what remains.
        auto runSpill = [&](bool wantPowder, int need, std::vector<int>& out) -> bool {
          if (need <= 0) return true;
          std::unordered_set<int> seen; std::vector<int> queue;
          auto canVisit = [&](int k) { if (k < 0 || k >= gridLen || seen.count(k)) return false; int y = k / cols, x = k - y * cols; if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return false; if (cells.count(k) || movedCells.count(k)) return false; uint8_t m = grid[k]; return m == EMPTY || isLiquid(m) || (wantPowder && MAT_KIND[m] == K_POWDER); };
          auto enqueue = [&](int k) { if (!canVisit(k)) return; seen.insert(k); queue.push_back(k); };
          for (auto& d : displaced) { bool isPow = MAT_KIND[d.material] == K_POWDER; if (wantPowder ? !isPow : !isLiquid(d.material)) continue; for (int off : offs) enqueue(d.from + off); }
          for (size_t qi = 0; qi < queue.size() && (int)out.size() < need; qi++) {
            int k = queue[qi];
            if (grid[k] == EMPTY) { if (!reserved.count(k)) { reserved.insert(k); out.push_back(k); } continue; }
            for (int off : offs) enqueue(k + off);
          }
          return (int)out.size() >= need;
        };
        if (!runSpill(false, liquidDisplacedCount, liquidTargets)) return false; // liquids first -> byte-identical targets
        if (!runSpill(true, powderDisplacedCount, powderTargets)) return false;  // powders claim remaining EMPTY cells
      }
      struct Move { Comp* comp; bool isPlant; std::vector<std::pair<int, uint8_t>> mats; int wood, leaf; };
      std::vector<Move> moves;
      for (int ci : grp->comps) {
        Comp* comp = all[ci]; bool isPlant = ci >= nStone && ci < nStonePlant;
        std::vector<std::pair<int, uint8_t>> mats; int wood = 0, leaf = 0;
        for (int k : comp->cells) { uint8_t m = matOf(ci, k); mats.push_back({k + dir, m}); if (isPlant) { if (isPlantWood(m)) wood++; else if (isPlantLeaf(m)) leaf++; } }
        moves.push_back({comp, isPlant, std::move(mats), wood, leaf});
      }
      L->groundDirty = true; // an assembly is relocating -> grounding changes -> full reflood
      for (int k : cells) writeGridIndex(k, EMPTY);
      for (auto& mv : moves) {
        std::vector<int> newCells; newCells.reserve(mv.mats.size());
        for (auto& pr : mv.mats) { writeGridIndex(pr.first, pr.second); newCells.push_back(pr.first); } // mats are distinct (k+dir over distinct k)
        mv.comp->cells = std::move(newCells);
        mv.comp->yMax = imax(0, imin(rows - 1, mv.comp->yMax + dy));
        if (mv.isPlant) { mv.comp->woodCount = mv.wood; mv.comp->leafCount = mv.leaf; mv.comp->cacheDirty = true; }
      }
      // Relocate every displaced cell: liquids -> liquidTargets, powders -> powderTargets
      // (both reserved above), gas -> the vacated-cell dump. A powder STILL advances the
      // shared vacated cursor (without writing there) so gas keeps landing in
      // byte-identical cells while the powder goes to its spill target instead.
      int di = 0, si = 0, pi = 0;
      for (auto& d : displaced) {
        if (isLiquid(d.material)) { writeGridIndex(liquidTargets[si++], d.material); continue; }
        while (di < (int)vacated.size() && grid[vacated[di]] != EMPTY) di++;
        if (MAT_KIND[d.material] == K_POWDER) { writeGridIndex(powderTargets[pi++], d.material); if (di < (int)vacated.size()) di++; }
        else if (di < (int)vacated.size()) writeGridIndex(vacated[di++], d.material); // gas
      }
      return true;
    };

    // measureMediumImmersion returns via out-params; returns false if "null".
    auto measureMediumImmersion = [&](std::unordered_set<int>& cells, int& wetCells, int& exposedCells, int& bottomExposed, int& bottomMedium, double& mediumDensityOut) -> bool {
      wetCells = 0; exposedCells = 0; bottomExposed = 0; bottomMedium = 0;
      double mediumDensity = 0; int mediumContacts = 0;
      for (int k : cells) {
        int y = k / cols, x = k - y * cols; bool wet = false, exposed = false;
        if (x > 1 && !cells.count(k - 1)) { exposed = true; uint8_t m = grid[k - 1]; if (isBuoyantMedium(m)) { wet = true; mediumDensity += DENSITY[m]; mediumContacts++; } }
        if (x < cols - 2 && !cells.count(k + 1)) { exposed = true; uint8_t m = grid[k + 1]; if (isBuoyantMedium(m)) { wet = true; mediumDensity += DENSITY[m]; mediumContacts++; } }
        if (y > 1 && !cells.count(k - cols)) { exposed = true; }
        if (y < rows - 1 && !cells.count(k + cols)) { exposed = true; bottomExposed++; uint8_t m = grid[k + cols]; if (isBuoyantMedium(m)) { wet = true; bottomMedium++; mediumDensity += DENSITY[m]; mediumContacts++; } }
        if (exposed) exposedCells++; if (wet) wetCells++;
      }
      if (mediumContacts == 0) return false;
      int requiredWet = imax(1, (int)std::ceil(std::sqrt((double)cells.size()) * BUOY_WET_PERIMETER_FRAC));
      if (wetCells < requiredWet) return false;
      mediumDensityOut = mediumDensity / mediumContacts;
      return true;
    };

    for (Group* grp : order) {
      if (grp->grounded) continue;
      std::unordered_set<int> cells;
      for (int ci : grp->comps) for (int k : all[ci]->cells) cells.insert(k);
      double weight = 0; int xMin = cols, xMax = 0;
      for (int ci : grp->comps) for (int k : all[ci]->cells) { weight += DENSITY[matOf(ci, k)]; int x = k - (k / cols) * cols; if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      int wetCells, exposedCells, bottomExposed, bottomMedium; double mediumDensity;
      if (!measureMediumImmersion(cells, wetCells, exposedCells, bottomExposed, bottomMedium, mediumDensity)) { translateAssembly(grp, cells, cols); continue; }
      double avgDensity = weight / cells.size();
      if (avgDensity > mediumDensity) { translateAssembly(grp, cells, cols); continue; }
      double targetWetCells = exposedCells * (avgDensity / mediumDensity) * BUOY_DRAFT_SCALE;
      double imbalance = wetCells - targetWetCells;
      double band = std::fmax(BUOY_BAND_MIN, (xMax - xMin + 1) * BUOY_BAND_FRAC);
      bool buoyantSupport = bottomExposed > 0 && bottomMedium >= bottomExposed * BUOY_SUPPORT_FRAC;
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
    L->groundDirty = true; // bulk component rebuild (sync/tools/worldgen/shift) -> full reflood
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
      for (int k : L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components (skip both seeding and flood-merge)
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
      for (int k : L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components
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
      for (int k : L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components
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
    L->groundDirty = true; // adds rigid cells (lava harden / tool placement) -> full reflood
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

  // Plant analogue of registerRigidCells, used when a free plant-family body (a wood
  // log, etc.) bakes into terrain on rest. Delegates the cell/merge bookkeeping to
  // registerRigidCells (so a baked log fuses with an adjacent same-material tree), then
  // re-derives the plant-comp fields (species + wood/leaf counts) from the resulting
  // cell set. The baked plant is inert scenery (growing=false), like worldgen flora.
  void registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax) {
    registerRigidCells(L->plantComponents, L->nextPlantId, mat, cells, yMax, false);
    Comp& c = L->plantComponents.back();
    c.woodCount = 0; c.leafCount = 0; c.age = 0; c.growing = false; c.cacheDirty = true; c.plantType = PT_OAK;
    for (int k : c.cells) { uint8_t m = grid[k]; if (isPlantWood(m)) { c.woodCount++; if (c.plantType == PT_OAK) c.plantType = plantTypeFromWood(m); } else if (isPlantLeaf(m)) c.leafCount++; }
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
    L->groundDirty = true; // plant cells removed/split -> full reflood
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
  // markGroundDirty=true (the default, used by tools-erase and ice-melt) forces a
  // full grounding reflood next pass. Acid passes false and instead runs its own
  // cut-vertex check (noteAcidRemovals) to keep the grounding cache valid when a
  // dissolve doesn't disconnect anything.
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache, bool markGroundDirty = true) {
    if (markGroundDirty && !erased.empty()) L->groundDirty = true;
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
      if (survivors.empty()) { L->compsReshaped = true; continue; } // comp fully erased -> ids shift
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
        if (reused) L->compsReshaped = true; // a 2nd+ surviving piece -> a split: ids shift
        Comp c; c.id = reused ? nextId++ : comp.id; c.yMax = 0; c.cacheDirty = iceCache;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; }
        c.cells = std::move(part); updated.push_back(std::move(c));
        reused = true;
      }
    }
    list = std::move(updated);
  }
