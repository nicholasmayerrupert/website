// ComponentSystem method bodies (need the full Engine definition; see components.hpp).

// Component lifetime and connectivity.
//
// Stone, ice, and plant materials are not loose pixels. They survive a step
// only through component membership, and unregistered component cells are
// erased during cleanup. Tool placement, worldgen, growth, and world shifting
// should route component writes through this subsystem and then sync/register.
// Rebuild E.L->cellComp[] (cell -> component index), the cgComps index, and per-
// component mean density. Shared by the full reflood (computeGrounded) and the
// incremental refresh (incrementalGroundingRefresh). Resets each Comp's grounded
// flag to false (the flood / refresh sets it back). Does NOT touch E.L->groundedCell[].
// O(total component cells).
void ComponentSystem::indexComponents() {
  double t0 = emscripten_get_now();
  Layer* const lay = E.L;
  int32_t* const cc = lay->cellComp.data();
  cgComps.clear();
  cgCompDensity.clear();
#ifdef __EMSCRIPTEN_PTHREADS__
  auto queue = [&](std::vector<Comp>& list) {
    for (auto& c : list) { c.grounded = false; cgComps.push_back(&c); }
  };
  queue(lay->stoneComponents); queue(lay->plantComponents); queue(lay->iceComponents);
  cgCompDensity.resize(cgComps.size());
  E.chunkPool.parallelFor((int)cgComps.size(), [&](int id) {
    Comp& c = *cgComps[id];
    double sum = 0;
    for (int k : c.cells) { cc[k] = id; sum += DENSITY[lay->grid[k]]; }
    cgCompDensity[id] = c.cells.empty() ? 0 : sum / c.cells.size();
  });
#else
  auto idx = [&](std::vector<Comp>& list) {
    for (auto& c : list) {
      c.grounded = false;
      int id = (int)cgComps.size();
      cgComps.push_back(&c);
      double sum = 0;
      for (int k : c.cells) { cc[k] = id; sum += DENSITY[lay->grid[k]]; }
      cgCompDensity.push_back(c.cells.empty() ? 0 : sum / c.cells.size());
    }
  };
  idx(lay->stoneComponents); idx(lay->plantComponents); idx(lay->iceComponents);
#endif
  lay->compAdjPairs.clear();
  if (cgComps.size() > 1) {
    // Four forward neighbours cover 8-connectivity exactly once. Duplicate
    // component edges are collapsed now, when topology changes, rather than in
    // every cross-layer grounding pass triggered by moving loose material.
    const int cols = E.cols, rows = E.rows;
    auto scanRect = [&](std::vector<uint64_t>& out, int x0, int y0, int x1, int y1) {
      for (int y = imax(0, y0); y < imin(rows, y1); y++) {
        int rb = y * cols;
        for (int x = imax(0, x0); x < imin(cols, x1); x++) {
          int a = cc[rb + x]; if (a < 0) continue;
          const int nx[4] = { x + 1, x - 1, x, x + 1 };
          const int ny[4] = { y, y + 1, y + 1, y + 1 };
          for (int ni = 0; ni < 4; ni++) {
            if (nx[ni] < 0 || nx[ni] >= cols || ny[ni] < 0 || ny[ni] >= rows) continue;
            int nk = ny[ni] * cols + nx[ni];
            int b = cc[nk]; if (b < 0 || b == a) continue;
            // Infinite-world sentinel columns may support ordinary terrain but
            // must never anchor icebergs touching the loaded-window edge.
            if (lay->infinite && (x == 0 || x == cols - 1 || nx[ni] == 0 || nx[ni] == cols - 1)
                && (E.isIceComponentMaterial(lay->grid[rb + x]) || E.isIceComponentMaterial(lay->grid[nk]))) continue;
            uint32_t lo = (uint32_t)(a < b ? a : b), hi = (uint32_t)(a < b ? b : a);
            out.push_back(((uint64_t)lo << 32) | hi);
          }
        }
      }
    };
#ifdef __EMSCRIPTEN_PTHREADS__
    int chunks = E.chunkCols * E.chunkRows;
    E.adjChunkPairs.resize(chunks);
    E.chunkPool.parallelFor(chunks, [&](int ci) {
      auto& out = E.adjChunkPairs[ci]; out.clear();
      int cy = ci / E.chunkCols, cx = ci - cy * E.chunkCols;
      scanRect(out, cx * CHUNK_SIZE, cy * CHUNK_SIZE,
               imin(cols, (cx + 1) * CHUNK_SIZE), imin(rows, (cy + 1) * CHUNK_SIZE));
    });
    size_t pairCount = 0;
    for (auto& pairs : E.adjChunkPairs) pairCount += pairs.size();
    lay->compAdjPairs.reserve(pairCount);
    for (auto& pairs : E.adjChunkPairs) lay->compAdjPairs.insert(lay->compAdjPairs.end(), pairs.begin(), pairs.end());
#else
    scanRect(lay->compAdjPairs, 0, 0, cols, rows);
#endif
    std::sort(lay->compAdjPairs.begin(), lay->compAdjPairs.end());
    lay->compAdjPairs.erase(std::unique(lay->compAdjPairs.begin(), lay->compAdjPairs.end()), lay->compAdjPairs.end());
  }
  E.perfComponentIndexMs += emscripten_get_now() - t0;
}
// Grounding is SEPARABLE (this is what makes the rigid part cacheable):
//  - RIGID grounding never flows through loose cells: the vertical rule refuses
//    loose-below -> rigid-above, and 8-adjacency requires rigid on both ends.
//    So the rigid grounded-set depends ONLY on rigid cells + floor/edge seeds.
//  - LOOSE grounding is strictly vertical: a loose cell is grounded iff the
//    cell directly below it is grounded (any class), or it sits on the floor
//    row, or on denser liquid. No loose cell grounds sideways.
// computeGrounded = rigid flood (computeRigidGrounded) + loose overlay
// (applyLooseOverlay). The union is byte-identical to the old single flood
// (dev builds re-run the old algorithm and memcmp — see the parity block).
void ComponentSystem::computeRigidGrounded() {
  // Hot flood: hoist the per-cell buffers into TRUE locals (register-bound;
  // uint8_t stores can't alias them, unlike the old Engine-member mirrors).
  Layer* const lay = E.L;
  const uint8_t* const g = lay->grid;
  uint8_t* const grounded = lay->groundedCell.data();
  int32_t* const cc = lay->cellComp.data();
  int32_t* const gstack = lay->groundStack.data();
  // Stream-aware path: grounding caches were shifted with the grid in shiftLayer.
  // Start from the shifted rigid base, clear the entering band + buffer-edge seed
  // columns/rows (edge support is buffer-relative), then run the normal seed DFS.
  // The DFS is still O(grounded rigid) but we avoid wiping and re-touching the
  // whole window when the shifted base is already correct for floor-connected bulk.
  // groundForceFull always takes the classic full-zero path (equivalence tests).
  // Stream band markers are recorded for diagnostics / future band-limit work.
  // Post-stream always full-zeros then floods: edge seeds are buffer-relative, so
  // a shifted base can leave stale grounded=1 when edge-only support is lost.
  // (Caches are still shifted in shiftLayer so loose overlay can localize after
  // the rigid pass and so we keep the seam metadata.)
  (void)lay->groundStreamX0; (void)lay->groundStreamY0;
  lay->groundStreamX0 = lay->groundStreamX1 = lay->groundStreamY0 = lay->groundStreamY1 = -1;
  std::fill(lay->groundedCell.begin(), lay->groundedCell.end(), (uint8_t)0);
  std::fill(lay->cellComp.begin(), lay->cellComp.end(), -1);
  indexComponents();
#ifdef __EMSCRIPTEN_PTHREADS__
  // Static registered rigid cells are already partitioned into exact connected
  // components, and indexComponents cached every 8-neighbour edge between
  // components. Ground the much smaller component graph, then stamp cells in
  // parallel. Live free bodies are not represented in that graph and retain
  // the classic cell flood below.
  if (!groundForceFull && lay->bodies.empty() && lay->bodyCells.empty()) {
    int nc = (int)cgComps.size();
    std::vector<int> parent(nc), seeded(nc, 0);
    for (int i = 0; i < nc; i++) parent[i] = i;
    for (uint64_t edge : lay->compAdjPairs)
      ufUnite(parent, (int)(edge >> 32), (int)(uint32_t)edge);
    auto seedCell = [&](int k) {
      int id = lay->cellComp[k];
      if (id >= 0) seeded[ufFind(parent, id)] = 1;
    };
    int floorBase = (E.rows - 1) * E.cols;
    for (int x = 0; x < E.cols; x++) {
      int k = floorBase + x;
      if (E.isRigidMaterialClass(g[k]) && E.isBearingMaterial(g[k])) seedCell(k);
    }
    if (lay->infinite) {
      for (int y = 1; y < E.rows; y++) {
        int kl = y * E.cols + 1;
        if (E.isRigidMaterialClass(g[kl]) && !E.isIceComponentMaterial(g[kl])) seedCell(kl);
        int kr = y * E.cols + E.cols - 2;
        if (E.isRigidMaterialClass(g[kr]) && !E.isIceComponentMaterial(g[kr])) seedCell(kr);
      }
      int topBase = E.cols;
      for (int x = 1; x < E.cols - 1; x++) {
        int k = topBase + x;
        if (E.isRigidMaterialClass(g[k]) && !E.isIceComponentMaterial(g[k])) seedCell(k);
      }
    }
    // Union may have attached a seeded root beneath another root after it was
    // marked; fold seeds once more onto canonical roots before stamping.
    for (int i = 0; i < nc; i++) if (seeded[i]) seeded[ufFind(parent, i)] = 1;
    for (int i = 0; i < nc; i++) parent[i] = ufFind(parent, i);
    E.chunkPool.parallelFor(nc, [&](int id) {
      Comp& c = *cgComps[id];
      c.grounded = seeded[parent[id]] != 0;
      if (c.grounded) for (int k : c.cells) grounded[k] = 1;
    });
    return;
  }
#endif
  int sp = 0;
  if (groundStackX.size() != (size_t)E.cols * E.rows) groundStackX.assign((size_t)E.cols * E.rows, 0);
  int32_t* gsx = groundStackX.data();
  // groundRigidAt records the cell's column x alongside k, so the DFS below never
  // recomputes k/E.cols (an integer division per popped rigid cell). Every caller
  // already knows x: the seeds iterate x, and a propagation target's column is
  // derived from its parent (the cell above shares x; an 8-neighbour is nx).
  auto groundRigidAt = [&](int k, int x) {
    if (grounded[k]) return;
    grounded[k] = 1;
    int id = cc[k];
    if (id >= 0) cgComps[id]->grounded = true;
    gsx[sp] = x; gstack[sp++] = k;
  };
  int floorBase = (E.rows - 1) * E.cols;
  for (int x = 0; x < E.cols; x++) { int k = floorBase + x; if (E.isRigidMaterialClass(g[k]) && E.isBearingMaterial(g[k])) groundRigidAt(k, x); }
  // Streamed-edge support: in the infinite world the left/right/top buffer edges abut
  // UNLOADED world that may itself be grounded. A non-ice rigid cell touching such an
  // edge is assumed supported, so terrain whose real floor-contact has streamed off
  // the buffer does not spuriously fall. Ice must remain mobile: large icebergs often
  // span a loaded-window edge, and grounding the edge cell disables buoyancy for the
  // whole connected iceberg (even after most of it is erased).
  if (lay->infinite) {
    for (int y = 1; y < E.rows; y++) {
      int kl = y * E.cols + 1;          if (E.isRigidMaterialClass(g[kl]) && !E.isIceComponentMaterial(g[kl])) groundRigidAt(kl, 1);
      int kr = y * E.cols + (E.cols - 2); if (E.isRigidMaterialClass(g[kr]) && !E.isIceComponentMaterial(g[kr])) groundRigidAt(kr, E.cols - 2);
    }
    int topBase = E.cols; // row y = 1
    for (int x = 1; x < E.cols - 1; x++) { int k = topBase + x; if (E.isRigidMaterialClass(g[k]) && !E.isIceComponentMaterial(g[k])) groundRigidAt(k, x); }
  }
  int gridLen = E.cols * E.rows;
  while (sp > 0) {
    --sp; int k = gstack[sp], kx = gsx[sp];
    // Vertical support at the border columns (x=0 / x=cols-1), where the
    // 8-neighbour scan below is clamped: the old flood's vertical rule had no
    // x guard, so a border floor column still grounds the stack above it.
    // Everywhere else this is a subset of the 8-neighbour scan. The upper cell
    // must be bearing (VINE/GLOWBERRY hang, they don't stack) — matching the
    // old canGroundAbove; rigid-below never triggers its loose exception.
    int above = k - E.cols;
    if (above >= 0 && !grounded[above] && E.isRigidMaterialClass(g[above]) && E.isBearingMaterial(g[above])) groundRigidAt(above, kx);
    // Neighbour-row validity ny in [1, E.rows-1] <=> (k + oy*E.cols) in [E.cols, gridLen):
    // a division-free restatement of the original `ny<=0 || ny>=E.rows` test.
    for (int oy = -1; oy <= 1; oy++) {
      int rb = k + oy * E.cols;
      if (rb < E.cols || rb >= gridLen) continue;
      for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = kx + ox; if (nx <= 0 || nx >= E.cols - 1) continue;
        int nk = rb + ox;
        // x=0/cols-1 are artificial infinite-world sentinel walls. They keep
        // media in the loaded window, but must not anchor an adjacent iceberg.
        if (lay->infinite && (kx == 0 || kx == E.cols - 1) && E.isIceComponentMaterial(g[nk])) continue;
        if (!grounded[nk] && E.isRigidMaterialClass(g[nk])) groundRigidAt(nk, nx);
      }
    }
  }
}
// Ground the loose (powder) cells on top of the rigid base: one bottom-up pass.
// A loose cell is grounded iff the cell DIRECTLY below is grounded (chain roots
// on grounded rigid, the floor, or lower loose links), or it is on the floor
// row, or it rests on liquid at least as dense (the buoyant-support seed).
// Loose cells never receive sideways/8-adjacent support and never ground a
// rigid cell, so this pass is exactly the loose part of the old flood.
// Also records groundSawPowder (same interior window as the old seed scan).
//
// Ground the loose (powder) cells on top of the rigid base: one bottom-up pass.
// A loose cell is grounded iff the cell DIRECTLY below is grounded (chain roots
// on grounded rigid, the floor, or lower loose links), or it is on the floor
// row, or it rests on liquid at least as dense (the buoyant-support seed).
// Loose cells never receive sideways/8-adjacent support and never ground a
// rigid cell, so this pass is exactly the loose part of the old flood.
// Also records groundSawPowder (same interior window as the old seed scan).
//
// When looseDirtyX* is a proper subset of columns, only those columns are
// walked. Callers that memcpied the rigid base must set the span to full width
// (all loose bits were zeroed). Column-local dirt from write paths enables the
// tight span on pure only-loose frames that clear non-dirty columns themselves
// — today the reuse path always full-width memcpys for joint-patch identity.
void ComponentSystem::applyLooseOverlay() {
  Layer* const lay = E.L;
  const uint8_t* const g = lay->grid;
  uint8_t* const grounded = lay->groundedCell.data();
#ifdef __EMSCRIPTEN_PTHREADS__
  std::atomic<bool> sawPowder{false};
#else
  bool sawPowder = false;
#endif
  const int cols = E.cols, rows = E.rows;
  // Prefer sparse dirty-column bitset; fall back to bbox span; then full width.
  const bool useBits = !lay->looseDirtyFull && (int)lay->looseDirtyCol.size() == cols;
  int x0 = 0, x1 = cols - 1;
  if (!useBits && lay->looseDirtyX1 >= lay->looseDirtyX0) {
    x0 = lay->looseDirtyX0 < 0 ? 0 : lay->looseDirtyX0;
    x1 = lay->looseDirtyX1 >= cols ? cols - 1 : lay->looseDirtyX1;
  }
  auto overlayCol = [&](int x) {
    int kFloor = (rows - 1) * cols + x;
    if (E.isLooseSolidMaterial(g[kFloor])) grounded[kFloor] = 1;
    for (int y = rows - 2; y >= 0; y--) {
      int k = y * cols + x;
      if (!E.isLooseSolidMaterial(g[k])) continue;
      bool interior = y >= 1 && x >= 1 && x <= cols - 2;
      if (interior) {
#ifdef __EMSCRIPTEN_PTHREADS__
        sawPowder.store(true, std::memory_order_relaxed);
#else
        sawPowder = true;
#endif
      }
      bool gnd = grounded[k + cols] != 0;
      if (!gnd && interior) {
        uint8_t below = g[k + cols];
        gnd = E.isLiquidMaterial(below) && DENSITY[below] >= DENSITY[g[k]];
      }
      if (gnd) grounded[k] = 1;
    }
  };
#ifdef __EMSCRIPTEN_PTHREADS__
  if (useBits) E.chunkPool.parallelFor(cols, [&](int x) { if (lay->looseDirtyCol[x]) overlayCol(x); });
  else E.chunkPool.parallelFor(x1 - x0 + 1, [&](int i) { overlayCol(x0 + i); });
  lay->groundSawPowder = sawPowder.load(std::memory_order_relaxed);
#else
  if (useBits) {
    for (int x = 0; x < cols; x++) if (lay->looseDirtyCol[x]) overlayCol(x);
  } else {
    for (int x = x0; x <= x1; x++) overlayCol(x);
  }
  lay->groundSawPowder = sawPowder;
#endif
}

// Refresh the column-local loose overlay without disturbing rigid support bits
// previously added by computeGroundedBoth. Rigid topology and base grounding are
// independent of loose cells, so a pure powder/liquid write cannot invalidate
// the cached cross-layer closure. This is the sleeping-structure path: settled,
// fully-supported components stay asleep while dirty loose columns wake.
void ComponentSystem::refreshLooseOverlayPreservingJoint(Layer* lay) {
  if (!lay->looseGroundDirty) return;
  E.useLayer(lay);
  const uint8_t* const g = lay->grid;
  uint8_t* const grounded = lay->groundedCell.data();
  const int cols = E.cols, rows = E.rows;
  const bool useBits = !lay->looseDirtyFull && (int)lay->looseDirtyCol.size() == cols;
  auto clearLooseCol = [&](int x) {
    for (int y = 0; y < rows; y++) {
      int k = y * cols + x;
      // Keep rigid joint patches exactly as stamped. Everything else in a dirty
      // column is rebuilt by applyLooseOverlay from a clean zero.
      if (!E.isRigidMaterialClass(g[k])) grounded[k] = 0;
    }
  };
  int x0 = 0, x1 = cols - 1;
  if (!useBits && lay->looseDirtyX1 >= lay->looseDirtyX0) {
    x0 = lay->looseDirtyX0 < 0 ? 0 : lay->looseDirtyX0;
    x1 = lay->looseDirtyX1 >= cols ? cols - 1 : lay->looseDirtyX1;
  }
#ifdef __EMSCRIPTEN_PTHREADS__
  if (useBits) E.chunkPool.parallelFor(cols, [&](int x) { if (lay->looseDirtyCol[x]) clearLooseCol(x); });
  else E.chunkPool.parallelFor(x1 - x0 + 1, [&](int i) { clearLooseCol(x0 + i); });
#else
  if (useBits) {
    for (int x = 0; x < cols; x++) if (lay->looseDirtyCol[x]) clearLooseCol(x);
  } else {
    for (int x = x0; x <= x1; x++) clearLooseCol(x);
  }
#endif
  applyLooseOverlay();
  lay->looseGroundDirty = false;
  lay->looseDirtyX0 = 0; lay->looseDirtyX1 = -1;
  lay->looseDirtyFull = false;
  if ((int)lay->looseDirtyCol.size() == cols)
    std::fill(lay->looseDirtyCol.begin(), lay->looseDirtyCol.end(), (uint8_t)0);
}

void ComponentSystem::computeGrounded() {
  Layer* const lay = E.L;
  size_t totalComps = lay->stoneComponents.size() + lay->plantComponents.size() + lay->iceComponents.size();
  // Fully stable: rigid base + last loose overlay still match the live grid.
  // Powder's mere presence does NOT force a pass — only looseGroundDirty (a
  // powder/liquid write since the last successful overlay) does.
  if (!groundForceFull && lay->groundBaseValid && !lay->groundDirty && !lay->groundContentDirty
      && !lay->looseGroundDirty && lay->bodies.empty() && lay->bodyCells.empty()
      && lay->groundBaseFlags.size() == totalComps) {
    return;
  }
  // Reuse the rigid base when no rigid mutation is pending. The loose overlay
  // is the only liquid-dependent part, so it is recomputed when loose moved;
  // the rigid flood + indexComponents are skipped. Bodies stamp rigid material
  // into the grid without routing through the dirty hooks, so any body in the
  // layer disables reuse (moveBodies re-floods every step, as before).
  bool reuse = !groundForceFull && lay->groundBaseValid && !lay->groundDirty
               && lay->bodies.empty() && lay->bodyCells.empty()
               && (lay->groundContentDirty || lay->groundBaseFlags.size() == totalComps);
  if (reuse) {
    if (lay->groundContentDirty) {
      // Comps reshaped but grounding stayed valid (the acid split path): the
      // positional ids in cellComp shifted, so re-index and re-derive the comp
      // flags from the (removal-patched) base, then refresh the flag snapshot.
      if (!lay->groundRigidBase.empty())
        std::memcpy(lay->groundedCell.data(), lay->groundRigidBase.data(), lay->groundRigidBase.size());
      incrementalGroundingRefresh();
      lay->groundBaseFlags.clear();
      auto push = [&](std::vector<Comp>& list) { for (auto& c : list) lay->groundBaseFlags.push_back(c.grounded ? 1 : 0); };
      push(lay->stoneComponents); push(lay->plantComponents); push(lay->iceComponents);
      lay->groundContentDirty = false;
      lay->looseDirtyFull = true;
      lay->looseDirtyX0 = 0; lay->looseDirtyX1 = E.cols - 1;
    } else if (!lay->groundRigidBase.empty()) {
      // Pure loose refresh, pure-perf identity with full base memcpy:
      // 1) restore base grounded flags for every comp
      // 2) clear cells of base-ungrounded comps (drops joint patches that a
      //    full memcpy would drop — bonds re-apply in computeGroundedBoth)
      // 3) for dirty columns only, copy rigid base (zeros loose there)
      // 4) re-overlay only those columns (non-dirty columns keep prior loose)
      size_t i = 0;
      for (auto& c : lay->stoneComponents) c.grounded = lay->groundBaseFlags[i++] != 0;
      for (auto& c : lay->plantComponents) c.grounded = lay->groundBaseFlags[i++] != 0;
      for (auto& c : lay->iceComponents) c.grounded = lay->groundBaseFlags[i++] != 0;
      uint8_t* const grounded = lay->groundedCell.data();
      const uint8_t* const base = lay->groundRigidBase.data();
      auto clearUngrounded = [&](std::vector<Comp>& list) {
        for (auto& c : list) if (!c.grounded) for (int k : c.cells) grounded[k] = 0;
      };
      clearUngrounded(lay->stoneComponents);
      clearUngrounded(lay->plantComponents);
      clearUngrounded(lay->iceComponents);
      const int cols = E.cols, rows = E.rows;
      const bool useBits = !lay->looseDirtyFull && (int)lay->looseDirtyCol.size() == cols;
      auto copyBaseCol = [&](int x) {
        for (int y = 0; y < rows; y++) {
          int k = y * cols + x;
          grounded[k] = base[k];
        }
      };
      if (useBits) {
        for (int x = 0; x < cols; x++) if (lay->looseDirtyCol[x]) copyBaseCol(x);
      } else {
        int x0 = 0, x1 = cols - 1;
        if (lay->looseDirtyX1 >= lay->looseDirtyX0) {
          x0 = lay->looseDirtyX0 < 0 ? 0 : lay->looseDirtyX0;
          x1 = lay->looseDirtyX1 >= cols ? cols - 1 : lay->looseDirtyX1;
        }
        for (int x = x0; x <= x1; x++) copyBaseCol(x);
      }
    } else {
      size_t i = 0;
      for (auto& c : lay->stoneComponents) c.grounded = lay->groundBaseFlags[i++] != 0;
      for (auto& c : lay->plantComponents) c.grounded = lay->groundBaseFlags[i++] != 0;
      for (auto& c : lay->iceComponents) c.grounded = lay->groundBaseFlags[i++] != 0;
      lay->looseDirtyFull = true;
      lay->looseDirtyX0 = 0; lay->looseDirtyX1 = E.cols - 1;
    }
    lay->groundBaseReplay = false;
  } else {
    computeRigidGrounded();
    lay->groundRigidBase.assign(lay->groundedCell.begin(), lay->groundedCell.end());
    lay->groundBaseFlags.clear();
    auto push = [&](std::vector<Comp>& list) { for (auto& c : list) lay->groundBaseFlags.push_back(c.grounded ? 1 : 0); };
    push(lay->stoneComponents); push(lay->plantComponents); push(lay->iceComponents);
    lay->groundBaseValid = true;
    lay->groundDirty = false;
    lay->groundContentDirty = false;
    lay->groundBaseReplay = false;
    lay->looseDirtyFull = true;
    lay->looseDirtyX0 = 0; lay->looseDirtyX1 = E.cols - 1;
  }
  applyLooseOverlay();
  lay->looseGroundDirty = false;
  lay->looseDirtyX0 = 0; lay->looseDirtyX1 = -1;
  lay->looseDirtyFull = false;
  if ((int)lay->looseDirtyCol.size() == E.cols)
    std::fill(lay->looseDirtyCol.begin(), lay->looseDirtyCol.end(), (uint8_t)0);
#ifdef SAND_INVARIANT_CHECKS
  if (!jointSupportValid) {
    // Parity probe: re-run the PRE-SPLIT single-flood algorithm from scratch
    // (fresh index) and require byte-identical grounded[]/cellComp[]/comp
    // flags. On cached passes this also proves the base cache is not stale.
    // A live joint closure may legitimately contain cross-layer support patches,
    // which this single-layer reference cannot reproduce; joint-cache parity is
    // instead covered by the forced-full grounding verification suite.
    const uint8_t* const g = lay->grid;
    std::vector<uint8_t> nu(lay->groundedCell);
    std::vector<int32_t> nuCC(lay->cellComp);
    std::vector<uint8_t> nuFlags; nuFlags.reserve(totalComps);
    auto pushNu = [&](std::vector<Comp>& list) { for (auto& c : list) nuFlags.push_back(c.grounded ? 1 : 0); };
    pushNu(lay->stoneComponents); pushNu(lay->plantComponents); pushNu(lay->iceComponents);
    std::fill(lay->cellComp.begin(), lay->cellComp.end(), -1);
    indexComponents(); // fresh cgComps/cellComp for THIS layer (cached passes leave them stale)
    for (size_t i2 = 0, n2 = (size_t)E.cols * E.rows; i2 < n2; i2++) {
      if (nuCC[i2] != lay->cellComp[i2]) { emscripten_console_error("GROUND CACHE PARITY: cellComp mismatch"); abort(); }
    }
    uint8_t* const grounded = lay->groundedCell.data();
    int32_t* const cc = lay->cellComp.data();
    int32_t* const gstack = lay->groundStack.data();
    std::fill(lay->groundedCell.begin(), lay->groundedCell.end(), (uint8_t)0);
    for (Comp* c : cgComps) c->grounded = false;
    auto canGroundAbove = [&](int below, int above) {
      uint8_t upper = g[above];
      if (!E.isBearingMaterial(upper)) return false;
      uint8_t lower = g[below];
      if (E.isLooseSolidMaterial(lower) && E.isRigidMaterialClass(upper)) return false;
      return true;
    };
    int sp = 0;
    int32_t* gsx = groundStackX.data();
    auto groundCellAt = [&](int k, int x) {
      if (grounded[k]) return;
      grounded[k] = 1;
      int id = cc[k];
      if (id >= 0) cgComps[id]->grounded = true;
      gsx[sp] = x; gstack[sp++] = k;
    };
    int floorBase = (E.rows - 1) * E.cols;
    for (int x = 0; x < E.cols; x++) { int k = floorBase + x; if (E.isBearingMaterial(g[k])) groundCellAt(k, x); }
    if (lay->infinite) {
      for (int y = 1; y < E.rows; y++) {
        int kl = y * E.cols + 1;          if (E.isRigidMaterialClass(g[kl]) && !E.isIceComponentMaterial(g[kl])) groundCellAt(kl, 1);
        int kr = y * E.cols + (E.cols - 2); if (E.isRigidMaterialClass(g[kr]) && !E.isIceComponentMaterial(g[kr])) groundCellAt(kr, E.cols - 2);
      }
      int topBase = E.cols;
      for (int x = 1; x < E.cols - 1; x++) { int k = topBase + x; if (E.isRigidMaterialClass(g[k]) && !E.isIceComponentMaterial(g[k])) groundCellAt(k, x); }
    }
    for (int y = E.rows - 2; y > 0; y--) {
      int rb = y * E.cols;
      for (int x = 1; x < E.cols - 1; x++) {
        int k = rb + x;
        if (E.isLooseSolidMaterial(g[k]) && E.isLiquidMaterial(g[k + E.cols]) && DENSITY[g[k + E.cols]] >= DENSITY[g[k]]) groundCellAt(k, x);
      }
    }
    int gridLen = E.cols * E.rows;
    while (sp > 0) {
      --sp; int k = gstack[sp], kx = gsx[sp];
      int above = k - E.cols;
      if (above >= 0 && !grounded[above] && canGroundAbove(k, above)) groundCellAt(above, kx);
      if (E.isRigidMaterialClass(g[k])) {
        for (int oy = -1; oy <= 1; oy++) {
          int rb = k + oy * E.cols;
          if (rb < E.cols || rb >= gridLen) continue;
          for (int ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            int nx = kx + ox; if (nx <= 0 || nx >= E.cols - 1) continue;
            int nk = rb + ox;
            if (lay->infinite && (kx == 0 || kx == E.cols - 1) && E.isIceComponentMaterial(g[nk])) continue;
            if (!grounded[nk] && E.isRigidMaterialClass(g[nk])) groundCellAt(nk, nx);
          }
        }
      }
    }
    for (int k = 0; k < gridLen; k++) {
      if (nu[k] != grounded[k]) {
        char buf[160];
        snprintf(buf, sizeof(buf), "GROUND SPLIT PARITY: k=%d (x=%d,y=%d) mat=%d split=%d ref=%d", k, k % E.cols, k / E.cols, (int)g[k], (int)nu[k], (int)grounded[k]);
        emscripten_console_error(buf);
        abort();
      }
    }
    for (size_t i = 0; i < cgComps.size(); i++) {
      if (nuFlags[i] != (cgComps[i]->grounded ? 1 : 0)) { emscripten_console_error("GROUND SPLIT PARITY: comp flag mismatch"); abort(); }
    }
  }
#endif
}

// Incremental grounding for the common single-layer, powder-free case: the
// expensive part of computeGrounded is the flood; everything else (lay->cellComp +
// per-component density + grounded flags) is a cheap O(stone) linear pass. When
// no removal disconnected anything (Layer::groundDirty stayed false), the cached
// grounded[] is still the true grounded set (removed cells were patched to 0
// at the dissolve site), so we skip the flood entirely and only rebuild the
// cheap bookkeeping, deriving each component's grounded flag from the cache.
// Produces a byte-identical grounded[]/cc[] to a full reflood (verified).
void ComponentSystem::incrementalGroundingRefresh() {
  std::fill(E.L->cellComp.begin(), E.L->cellComp.end(), -1);
  indexComponents();                       // rebuilds E.L->cellComp + cgCompDensity, resets grounded=false
  for (Comp* c : cgComps) {                // a connected component is grounded iff ANY of its cells is
    for (int k : c->cells) if (E.L->groundedCell[k]) { c->grounded = true; break; }
  }
}

// Single-layer grounding entry point (the cross-layer path uses computeGrounded
// directly via computeGroundedBoth). Picks the full reflood or the incremental
// refresh, and when groundVerify is on, runs BOTH and asserts byte-equality so a
// wrong fast path can never silently desync — it shows up as a test failure.
void ComponentSystem::ensureGroundedSingleLayer() {
  // Skip the whole pass when nothing that affects grounding changed since the
  // last one: no loose/liquid motion (looseGroundDirty), no structural change
  // (groundDirty), and no acid fast-path removal (groundContentDirty). Powder
  // sitting still no longer forces a per-pass refresh. When all are clear the
  // cached E.L->cellComp[]/groundedCell[]/comp.grounded are the exact grounding
  // of the current grid. Otherwise run computeGrounded(), whose internal tiers
  // do the cheapest valid thing (skip / rigid-base reuse + overlay / full flood).
  //
  // Dual-layer + valid joint: never single-layer re-flood rigid. That peels
  // cross-support stamps (free-body frames often hit this path when step()
  // skipped computeGroundedBoth). Loose-only dirt refreshes in place.
  if (!groundForceFull && E.bgEnabled && jointSupportValid
      && !E.L->groundDirty && !E.L->groundContentDirty) {
    if (!groundVerify) {
      refreshLooseOverlayPreservingJoint(E.L);
      return;
    }
  }
  bool needPass = groundForceFull || E.bgEnabled || E.L->groundDirty || E.L->groundContentDirty || E.L->looseGroundDirty;
  if (!needPass && !groundVerify) return;
  if (!groundVerify) { computeGrounded(); return; }
  computeGrounded(); // production path (cache tiers allowed)
  gvGrounded.assign(E.L->groundedCell.begin(), E.L->groundedCell.end());
  gvCellComp.assign(E.L->cellComp.begin(), E.L->cellComp.end());
  E.L->groundBaseValid = false; // force the reference below to a real full flood
  computeGrounded(); // the trusted reference; leaves the live arrays correct regardless
  for (size_t i = 0, n = (size_t)E.cols * E.rows; i < n; i++) {
    if (gvGrounded[i] != E.L->groundedCell[i] || gvCellComp[i] != E.L->cellComp[i]) { groundMismatches++; break; }
  }
}

// Do all of the rigid cells in `boundary` (the surviving rigid neighbours of the
// removed blob) reconnect to one another through rigid material within [x0,x1] x
// [y0,y1], WITHOUT passing through any cell stamped `removedGen`? If so, the blob is
// not a cut: every path that used the blob reroutes through the reconnected
// boundary, so removing it disconnects nothing. A bounded window + visit cap keep
// it cheap; failing to connect (or exceeding the cap) is treated as a cut, which is
// always safe (the caller refloods).
bool ComponentSystem::blobBoundaryReconnects(const std::vector<int>& boundary, int32_t inN, int x0, int y0, int x1, int y1, int32_t removedGen) {
  int32_t vis = ++E.L->seenGen;
  // Early-exit means a genuine reconnection finds all boundary cells quickly, so the
  // cap only bounds the wasted work of a check that is going to FAIL (a real cut):
  // keep it modest so a failing check costs far less than the reflood it precedes.
  int* q = E.L->groundStack.data(); const int cap = 8000;
  int qh = 0, qt = 0;
  int need = (int)boundary.size(), found = 1; // boundary[0] is the BFS seed
  E.L->seenStamp[boundary[0]] = vis; q[qt++] = boundary[0];
  while (qh < qt) {
    if (qt >= cap) return false;
    int cur = q[qh++]; int cy = cur / E.cols, cx = cur - cy * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = cx + ox, ny = cy + oy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      int nk = ny * E.cols + nx;
      int32_t s = E.L->seenStamp[nk];
      if (s == vis || s == removedGen) continue;
      if (!E.isRigidMaterialClass(E.L->grid[nk])) continue;
      if (s == inN && ++found == need) return true; // all boundary cells reconnected -> not a cut (early out)
      E.L->seenStamp[nk] = vis; q[qt++] = nk;
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
// change is the removed cells themselves. Does NOT patch E.L->groundedCell -- the caller
// (removalsKeepGroundingValid) patches once every component of the batch is cleared,
// so a later failing component still leaves the cache untouched for the reflood.
bool ComponentSystem::blobKeepsGroundingValid(const std::vector<int>& blob) {
  const int MARGIN = 2;  // stay clear of the floor (row E.rows-1) and streamed edges
  const int SPAN = 128;  // max blob extent for the fast path; wider spreads reflood
  const int W = 8;       // reconnect-search margin around the blob bbox
  int32_t gen = ++E.L->seenGen;
  int bx0 = E.cols, by0 = E.rows, bx1 = -1, by1 = -1;
  for (int k : blob) {
    E.L->seenStamp[k] = gen;
    int y = k / E.cols, x = k - y * E.cols;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 - bx0 > SPAN || by1 - by0 > SPAN) { gbSpan++; return false; }
  if (bx0 <= MARGIN || bx1 >= E.cols - 1 - MARGIN || by0 <= MARGIN || by1 >= E.rows - 1 - MARGIN) { gbEdge++; return false; }
  // Gather the blob's surviving rigid neighbours (deduped via the inN stamp); bail
  // on any powder nearby (powder/liquid grounding nuance not modelled here). Removed
  // cells of OTHER components are already empty in the grid, so they are skipped by
  // the isRigidMaterial test and never pollute this blob's boundary.
  int32_t inN = ++E.L->seenGen;
  cgBlobN.clear();
  for (int r : blob) {
    int ry = r / E.cols, rx = r - ry * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nk = (ry + oy) * E.cols + (rx + ox);
      uint8_t m = E.L->grid[nk];
      if (E.isLooseSolidMaterial(m)) { gbPowder++; return false; }
      if (E.isRigidMaterialClass(m) && E.L->seenStamp[nk] != gen && E.L->seenStamp[nk] != inN) { E.L->seenStamp[nk] = inN; cgBlobN.push_back(nk); }
    }
  }
  if ((int)cgBlobN.size() > 1) {  // 0/1 external connection: the blob is a pendant, removing it disconnects nothing else
    int x0 = imax(1, bx0 - W), x1 = imin(E.cols - 2, bx1 + W);
    int y0 = imax(1, by0 - W), y1 = imin(E.rows - 2, by1 + W);
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
// overall span. E.L->groundedCell stays a pure function of the grid -- verified byte-for-byte
// against a full reflood every step under groundVerify (see the grounding test).
bool ComponentSystem::removalsKeepGroundingValid(const std::vector<int>& removed) {
  if (removed.empty()) return true;
  // seenStamp marks each removed cell's partition state: `present` = a removed cell
  // not yet claimed by a component, `taken` = already swept into one. blobKeeps...
  // re-stamps a component's own cells (with a fresh gen) but only after we have
  // finished sweeping that component, so the outer scan still sees later components.
  int32_t present = ++E.L->seenGen;
  for (int k : removed) E.L->seenStamp[k] = present;
  int32_t taken = ++E.L->seenGen;
  for (int seed : removed) {
    if (E.L->seenStamp[seed] != present) continue; // already pulled into an earlier component
    cgRemovedComp.clear();
    int qt = 0; E.L->groundStack[qt++] = seed; E.L->seenStamp[seed] = taken;
    for (int qh = 0; qh < qt; qh++) {
      int cur = E.L->groundStack[qh]; cgRemovedComp.push_back(cur);
      int cy = cur / E.cols, cx = cur - cy * E.cols;
      for (int oy = -1; oy <= 1; oy++) { int ny = cy + oy; if (ny < 0 || ny >= E.rows) continue;
        for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = cx + ox; if (nx < 0 || nx >= E.cols) continue;
          int nk = ny * E.cols + nx;
          if (E.L->seenStamp[nk] == present) { E.L->seenStamp[nk] = taken; E.L->groundStack[qt++] = nk; }
        }
      }
    }
    if (!blobKeepsGroundingValid(cgRemovedComp)) return false; // a real cut/edge/powder/span -> reflood
  }
  for (int k : removed) { E.L->groundedCell[k] = 0; if (E.L->groundBaseValid) E.L->groundRigidBase[k] = 0; } // every component safe: only the removed cells lose grounding (patch the base cache too)
  return true;
}

int ComponentSystem::compCount(Layer& lay) { return (int)(lay.stoneComponents.size() + lay.plantComponents.size() + lay.iceComponents.size()); }

// Union same-layer 8-adjacent components into `parent` (and `groundParent` when
// non-null), restricted to the components reachable from a cross-layer bonded
// comp. This replaces the old O(E.cols*E.rows) full-grid uniteLayerAdj pass that ran
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
void ComponentSystem::unionCrossBondedClusters(std::vector<int>& parent, std::vector<int>* groundParent, int nf, int nb) {
  auto uniteCached = [&](Layer& lay, int offset, int count) {
    for (uint64_t packed : lay.compAdjPairs) {
      int a = (int)(packed >> 32), b = (int)(uint32_t)packed;
      if (a < 0 || b < 0 || a >= count || b >= count) continue;
      int ag = offset + a, bg = offset + b;
      ufUnite(parent, ag, bg);
      if (groundParent) ufUnite(*groundParent, ag, bg);
    }
  };
  uniteCached(E.fg, 0, nf);
  uniteCached(E.bg, nf, nb);
}

// Cross-layer grounding (runs once per step when the background is live). Each
// layer is grounded independently first; any same-(x,y) rigid-rigid co-occupation
// between components then creates a transient cross-layer bond. Support is
// transitive across bonds: if either bonded component is base-grounded (floor /
// edge / powder-on-liquid), every component in the groundParent cluster is
// grounded. Unsupported bonded clusters fall together instead of pinning each
// other mid-air. A single contact cell is enough — no size / fraction heuristics.
// Produce one layer's BASE grounding (independent of the cross-layer step), either
// by a full flood or by reusing the cached base from a prior flood. The reuse path
// is taken only when the layer's rigid topology is provably unchanged: groundDirty
// false (every add/split/remove/move/freeze/registration sets it) AND no acid
// fast-path removal (groundContentDirty) AND a valid cache. Because computeGrounded
// ends with groundDirty = sawPowder, a layer holding powder ALWAYS refloods; only a
// powder-free, edit-free layer (the dry stone background during a pan) reuses. The
// reused E.L->groundedCell/comp.grounded are byte-identical to a fresh flood (E.L->groundedCell
// is a pure function of the grid; E.L->cellComp is written ONLY by grounding so it stays
// valid untouched between passes). This halves computeGroundedBoth's cost in the
// common two-layer pan case (the bg flood was ~half the joint-grounding time).
void ComponentSystem::groundLayerBase(Layer* lay) {
  // computeGrounded's internal tiers do the caching (rigid-base reuse +
  // per-pass loose overlay). Result is the layer's INDEPENDENT grounding;
  // computeGroundedBoth may then patch cross-layer support on top.
  E.useLayer(lay);
  computeGrounded();
}

// Re-widen the settle band over cells that LOST grounding this pass (prev
// grounded, now not) so they start falling next step. Shared by the fast and
// full grounding paths.
void ComponentSystem::wakeCellsThatLostGrounding(Layer& lay, const std::vector<uint8_t>& prev) {
  // Only rigid component/body cells can lose structural grounding. Scanning the
  // full grid was O(cols*rows) per layer per joint pass; the component lists are
  // the same set of candidates (unregistered rigid cells are erased each step).
  const uint8_t* gr = lay.groundedCell.data();
  int32_t* rmn = lay.rowMarkMin.data(); int32_t* rmx = lay.rowMarkMax.data();
  auto wake = [&](int k) {
    if (!prev[k] || gr[k]) return;
    int y = k / E.cols, x = k - y * E.cols;
    if (x < rmn[y]) rmn[y] = x;
    if (x > rmx[y]) rmx[y] = x;
  };
  for (auto& c : lay.stoneComponents) for (int k : c.cells) wake(k);
  for (auto& c : lay.plantComponents) for (int k : c.cells) wake(k);
  for (auto& c : lay.iceComponents) for (int k : c.cells) wake(k);
  for (int k : lay.bodyCells) wake(k);
}
void ComponentSystem::computeGroundedBoth() {
  // Wall-time split: base floods -> groundingMs; bond scan + UF -> crossLayerGroundingMs.
  // indexComponents inside base floods already accumulates componentIndexMs.
  double tJoint0 = emscripten_get_now();
  // Snapshot prev grounded only when rigid grounding may change (wake needs the
  // 1->0 transition). A pure loose-overlay refresh cannot unground rigid cells.
  auto rigidMayChange = [](Layer& lay) {
    return lay.groundDirty || lay.groundContentDirty || !lay.groundBaseValid
           || !lay.bodies.empty() || !lay.bodyCells.empty();
  };
  auto structureCanSelfActivate = [](Layer& lay) {
    if (lay.myceliumActive) return true;
    for (const auto& c : lay.plantComponents) if (c.growing) return true;
    return false;
  };
  if (structureCanSelfActivate(E.fg) || structureCanSelfActivate(E.bg)) {
    // Runtime-grown structures have deterministic transition order tied to the
    // classic per-tick joint rebuild. Once observed, keep this engine on that
    // path; ordinary generated terrain never sets this flag. Free bodies only
    // suppress sleeping while they actually exist (via rigidMayChange below).
    jointSleepBlocked = true;
  }
  // Pure loose motion cannot alter rigid base grounding, component adjacency, or
  // cross-layer co-occupation. When no unsupported bond groups remain, preserve
  // the settled joint closure and rebuild only dirty loose columns. Residual
  // bonded assemblies keep the classic rebuild: its grouping/order participates
  // in deterministic component motion even when cell topology is unchanged.
  if (!groundForceFull && !jointSleepBlocked && jointSupportValid && cgBonds.empty()
      && !jointDirty && !jointBondsInvalid
      && !structureCanSelfActivate(E.fg) && !structureCanSelfActivate(E.bg)
      && !rigidMayChange(E.fg) && !rigidMayChange(E.bg)) {
    refreshLooseOverlayPreservingJoint(&E.fg);
    refreshLooseOverlayPreservingJoint(&E.bg);
    E.useLayer(&E.fg);
    jointSupportSleeping = true;
    E.perfGroundingMs += emscripten_get_now() - tJoint0;
    return;
  }
  // Joint may have stamped cross-layer support into groundedCell on a prior pass.
  // Dirty layer full-refloods; clean layer must not early-return with stale joint
  // patches — force a base-replay (memcpy groundRigidBase + full loose overlay)
  // which is byte-identical to a full flood when that layer's rigid topology is
  // unchanged, without a second rigid DFS.
  // Wipe joint patches on a clean layer by stamping rigid cells from groundRigidBase
  // (leave loose bits alone — topology unchanged so prior overlay is still valid).
  // Byte-identical to a full base memcpy + re-overlay when loose is stable.
  auto wipeJointPatchesKeepLoose = [&](Layer& lay) {
    if (!lay.groundBaseValid || lay.groundRigidBase.empty()
        || (int)lay.groundBaseFlags.size() != (int)(lay.stoneComponents.size() + lay.plantComponents.size() + lay.iceComponents.size())) {
      lay.groundDirty = true;
      return;
    }
    const uint8_t* const g = lay.grid;
    const uint8_t* const base = lay.groundRigidBase.data();
    uint8_t* const grounded = lay.groundedCell.data();
    const int n = E.cols * E.rows;
    for (int k = 0; k < n; k++) {
      if (E.isRigidMaterialClass(g[k])) grounded[k] = base[k];
    }
    size_t i = 0;
    for (auto& c : lay.stoneComponents) c.grounded = lay.groundBaseFlags[i++] != 0;
    for (auto& c : lay.plantComponents) c.grounded = lay.groundBaseFlags[i++] != 0;
    for (auto& c : lay.iceComponents) c.grounded = lay.groundBaseFlags[i++] != 0;
  };
  bool rf = rigidMayChange(E.fg), rb = rigidMayChange(E.bg);
  // A cached sleeping pass deliberately kept joint patches in place. If a
  // later mutation requires a real joint rebuild, the dirty layer refloods and
  // the clean peer restores its independent rigid-base snapshot below. The old
  // both-dirty fallback doubled fire/acid grounding cost at extreme zoom even
  // when only one layer changed.
  if (jointSupportSleeping) {
    jointSupportSleeping = false;
  }
  // jointDirty / jointBondsInvalid: co-occupation may have changed without
  // either layer's rigid-base dirt (erase/acid on one layer's contact cells).
  // Peel joint stamps from BOTH layers so the bond scan starts from independent
  // bases — otherwise the "clean" peer keeps stale grounded=1 forever.
  bool jointInv = jointDirty || jointBondsInvalid;
  // Wake snapshots BEFORE wipe/flood: a joint rebuild can drop joint-stamped
  // support on EITHER layer even when that layer's rigid topology is unchanged
  // (peer wipe / bond loss). Snapshot whenever we already had a joint closure
  // or either base may change — missing the peer was the "BG freezes mid-air
  // after FG contact erase" bug (ungrounded but never woken into moveRigidAssemblies).
  bool prevFg = jointSupportValid || rf || jointInv;
  bool prevBg = jointSupportValid || rb || jointInv;
  if (prevFg) cgPrevFg.assign(E.fg.groundedCell.begin(), E.fg.groundedCell.end());
  if (prevBg) cgPrevBg.assign(E.bg.groundedCell.begin(), E.bg.groundedCell.end());
  if (rf || rb || jointInv) {
    auto prepLayer = [&](Layer& lay, bool rigidDirty) {
      if (rigidDirty) lay.groundDirty = true;
      else if (!lay.looseGroundDirty && !lay.groundContentDirty) wipeJointPatchesKeepLoose(lay);
      else { lay.looseGroundDirty = true; lay.looseDirtyFull = true; lay.looseDirtyX0 = 0; lay.looseDirtyX1 = E.cols - 1; }
    };
    prepLayer(E.fg, rf);
    prepLayer(E.bg, rb);
  }
  // Each layer's base grounding: full flood when its rigid topology changed, else a
  // cheap cache reuse / full skip inside computeGrounded.
  groundLayerBase(&E.fg);
  groundLayerBase(&E.bg);
  E.perfGroundingMs += emscripten_get_now() - tJoint0;
  double tCross0 = emscripten_get_now();

  int nf = compCount(E.fg), nb = compCount(E.bg);
  E.fg.crossBondedComp.assign(nf, 0);
  E.bg.crossBondedComp.assign(nb, 0);
  cgBonds.clear();

  // Common settled-terrain case: every component already grounded by its own
  // layer's flood. Cross-layer bonds only matter when at least one component is
  // still ungrounded (a bond needs an ungrounded endpoint to change anything).
  // Only wakeCellsThatLostGrounding still must run in the all-grounded case.
  bool anyUngrounded = false;
  for (int i = 0; i < nf && !anyUngrounded; i++) if (!compById(E.fg, i)->grounded) anyUngrounded = true;
  for (int i = 0; i < nb && !anyUngrounded; i++) if (!compById(E.bg, i)->grounded) anyUngrounded = true;
  if (!anyUngrounded) {
    if (prevFg) wakeCellsThatLostGrounding(E.fg, cgPrevFg);
    if (prevBg) wakeCellsThatLostGrounding(E.bg, cgPrevBg);
    E.useLayer(&E.fg);
    jointSupportValid = true;
    jointSupportSleeping = false;
    E.perfCrossLayerGroundingMs += emscripten_get_now() - tCross0;
    return;
  }

  // Bond compatible fg/bg component pairs that co-occupy at least one cell.
  // Ice bonds only to ice: otherwise an iceberg passing over invisible grounded
  // background terrain becomes structurally anchored and bypasses buoyancy.
  // Scan only ungrounded endpoints (a fully base-grounded pair needs no bond).
  // One compatible contact cell is enough to transmit support.
  const int32_t* const bgCC = E.bg.cellComp.data();
  const uint8_t* const bgG = E.bg.grid;
  const int32_t* const fgCC = E.fg.cellComp.data();
  const uint8_t* const fgG = E.fg.grid;
  auto bondCompatibleAt = [&](int k) {
    return E.isIceComponentMaterial(fgG[k]) == E.isIceComponentMaterial(bgG[k]);
  };
  auto bondPair = [&](int fi, int bi) {
    cgBonds.push_back({fi, bi, true});
    E.fg.crossBondedComp[fi] = 1;
    E.bg.crossBondedComp[bi] = 1;
  };
#ifdef __EMSCRIPTEN_PTHREADS__
  cgBondCandidatesFg.resize(nf);
  E.chunkPool.parallelFor(nf, [&](int fi) {
    auto& out = cgBondCandidatesFg[fi]; out.clear();
    Comp* fc = compById(E.fg, fi); if (fc->grounded) return;
    for (int k : fc->cells) {
      int bi = bgCC[k];
      if (bi < 0 || bi >= nb || !E.isRigidMaterialClass(bgG[k]) || !bondCompatibleAt(k)) continue;
      if (std::find(out.begin(), out.end(), bi) == out.end()) out.push_back(bi);
    }
  });
  for (int fi = 0; fi < nf; fi++) for (int bi : cgBondCandidatesFg[fi]) bondPair(fi, bi);
  cgBondCandidatesBg.resize(nb);
  E.chunkPool.parallelFor(nb, [&](int bi) {
    auto& out = cgBondCandidatesBg[bi]; out.clear();
    Comp* bc = compById(E.bg, bi); if (bc->grounded) return;
    for (int k : bc->cells) {
      int fi = fgCC[k];
      if (fi < 0 || fi >= nf || !E.isRigidMaterialClass(fgG[k]) || !bondCompatibleAt(k)) continue;
      if (!compById(E.fg, fi)->grounded || std::find(out.begin(), out.end(), fi) != out.end()) continue;
      out.push_back(fi);
    }
  });
  for (int bi = 0; bi < nb; bi++) for (int fi : cgBondCandidatesBg[bi]) bondPair(fi, bi);
#else
  cgBondSeenBg.assign(nb, -1);
  for (int fi = 0; fi < nf; fi++) {
    Comp* fc = compById(E.fg, fi);
    if (fc->grounded) continue;
    for (int k : fc->cells) {
      int bi = bgCC[k];
      if (bi < 0 || bi >= nb || !E.isRigidMaterialClass(bgG[k]) || !bondCompatibleAt(k)) continue;
      if (cgBondSeenBg[bi] == fi) continue;
      cgBondSeenBg[bi] = fi;
      bondPair(fi, bi);
    }
  }
  cgBondSeenFg.assign(nf, -1);
  for (int bi = 0; bi < nb; bi++) {
    Comp* bc = compById(E.bg, bi);
    if (bc->grounded) continue;
    for (int k : bc->cells) {
      int fi = fgCC[k];
      if (fi < 0 || fi >= nf || !E.isRigidMaterialClass(fgG[k]) || !bondCompatibleAt(k)) continue;
      if (!compById(E.fg, fi)->grounded || cgBondSeenFg[fi] == bi) continue;
      cgBondSeenFg[fi] = bi;
      bondPair(fi, bi);
    }
  }
#endif

  if (cgBonds.empty()) {
    if (prevFg) wakeCellsThatLostGrounding(E.fg, cgPrevFg);
    if (prevBg) wakeCellsThatLostGrounding(E.bg, cgPrevBg);
    E.useLayer(&E.fg);
    jointSupportValid = true;
    jointSupportSleeping = false;
    E.perfCrossLayerGroundingMs += emscripten_get_now() - tCross0;
    return;
  }

  std::vector<int>& parent = cgParent; std::vector<int>& groundParent = cgGroundParent;
  parent.assign(nf + nb, 0); groundParent.assign(nf + nb, 0);
  for (int i = 0; i < nf + nb; i++) parent[i] = groundParent[i] = i;
  for (auto& b : cgBonds) {
    ufUnite(parent, b.fgComp, nf + b.bgComp);
    // Every contact bond transmits support: if either endpoint (or any same-layer
    // neighbour united below) is base-grounded, the whole cluster is grounded.
    ufUnite(groundParent, b.fgComp, nf + b.bgComp);
  }
  // Same-layer adjacency: bounded walk from ungrounded bonded comps instead of
  // the old O(E.cols*E.rows) full-grid scan (the panning-perf regression).
  unionCrossBondedClusters(parent, &groundParent, nf, nb);
  std::vector<uint8_t> rootBonded(nf + nb, 0);
  for (auto& b : cgBonds) rootBonded[ufFind(parent, b.fgComp)] = 1;
  std::fill(E.fg.crossBondedComp.begin(), E.fg.crossBondedComp.end(), (uint8_t)0);
  std::fill(E.bg.crossBondedComp.begin(), E.bg.crossBondedComp.end(), (uint8_t)0);
  for (int i = 0; i < nf; i++) if (rootBonded[ufFind(parent, i)]) E.fg.crossBondedComp[i] = 1;
  for (int i = 0; i < nb; i++) if (rootBonded[ufFind(parent, nf + i)]) E.bg.crossBondedComp[i] = 1;
  std::vector<uint8_t> rootGrounded(nf + nb, 0);
  for (int i = 0; i < nf; i++) if (compById(E.fg, i)->grounded) rootGrounded[ufFind(groundParent, i)] = 1;
  for (int i = 0; i < nb; i++) if (compById(E.bg, i)->grounded) rootGrounded[ufFind(groundParent, nf + i)] = 1;
#ifdef __EMSCRIPTEN_PTHREADS__
  for (int i = 0; i < nf + nb; i++) groundParent[i] = ufFind(groundParent, i);
  E.chunkPool.parallelFor(nf + nb, [&](int i) {
    if (i < nf) {
      if (!E.fg.crossBondedComp[i] || !rootGrounded[groundParent[i]]) return;
      Comp* c = compById(E.fg, i); c->grounded = true;
      for (int k : c->cells) E.fg.groundedCell[k] = 1;
    } else {
      int bi = i - nf;
      if (!E.bg.crossBondedComp[bi] || !rootGrounded[groundParent[i]]) return;
      Comp* c = compById(E.bg, bi); c->grounded = true;
      for (int k : c->cells) E.bg.groundedCell[k] = 1;
    }
  });
#else
  for (int i = 0; i < nf; i++) if (E.fg.crossBondedComp[i] && rootGrounded[ufFind(groundParent, i)]) {
    Comp* c = compById(E.fg, i); c->grounded = true;
    for (int k : c->cells) E.fg.groundedCell[k] = 1;
  }
  for (int i = 0; i < nb; i++) if (E.bg.crossBondedComp[i] && rootGrounded[ufFind(groundParent, nf + i)]) {
    Comp* c = compById(E.bg, i); c->grounded = true;
    for (int k : c->cells) E.bg.groundedCell[k] = 1;
  }
#endif

  // Idle-structure release: once every component is grounded (base or via bonds),
  // drop the transient bond list so step() can skip joint next tick. Support is
  // already stamped into groundedCell/comp.grounded; topology/jointDirty will
  // force a re-joint if bonds can break. Leaving bonds would force joint every
  // step and (historically) re-dirty both layers even when nothing moved.
  bool stillUngrounded = false;
  for (int i = 0; i < nf && !stillUngrounded; i++) if (!compById(E.fg, i)->grounded) stillUngrounded = true;
  for (int i = 0; i < nb && !stillUngrounded; i++) if (!compById(E.bg, i)->grounded) stillUngrounded = true;
  if (!stillUngrounded) {
    cgBonds.clear();
    std::fill(E.fg.crossBondedComp.begin(), E.fg.crossBondedComp.end(), (uint8_t)0);
    std::fill(E.bg.crossBondedComp.begin(), E.bg.crossBondedComp.end(), (uint8_t)0);
  }

  // Re-wake whatever lost grounding this step (only the 1->0 transition;
  // already-ungrounded cells stay active from their own motion/edits).
  // Cross-layer bond support only ADDS grounding (never clears base-grounded
  // cells), so the prev snapshot from before groundLayerBase is still correct.
  if (prevFg) wakeCellsThatLostGrounding(E.fg, cgPrevFg);
  if (prevBg) wakeCellsThatLostGrounding(E.bg, cgPrevBg);
  E.useLayer(&E.fg);
  jointSupportValid = true;
  jointSupportSleeping = false;
  E.perfCrossLayerGroundingMs += emscripten_get_now() - tCross0;
}

// Map a E.L->cellComp id (assigned by computeGrounded in stone|plant|ice order) back
// to its Comp* in the SAME layer.
Comp* ComponentSystem::compById(Layer& lay, int id) {
  size_t ns = lay.stoneComponents.size();
  if ((size_t)id < ns) return &lay.stoneComponents[id];
  id -= (int)ns;
  size_t np = lay.plantComponents.size();
  if ((size_t)id < np) return &lay.plantComponents[id];
  return &lay.iceComponents[id - (int)np];
}

bool ComponentSystem::compIdIsPlant(Layer& lay, int id) {
  int ns = (int)lay.stoneComponents.size();
  if (id < ns) return false;
  id -= ns;
  return id < (int)lay.plantComponents.size();
}

// Match a displaced leading-face cell to the nearest unclaimed trailing-face
// vacancy by Manhattan distance. Only trailing candidates are indexed: the old
// BFS flooded up to the entire grid once per displaced cell, making a wide or
// concave iceberg O(face * grid area). Row sets preserve spatial matching while
// bounding a lookup to O(rows * log(face)); erasing the winner keeps targets
// unique without another grid search.
int ComponentSystem::nearestVacatedTarget(int source, int dir, int minTargetY, bool sourceSideOnly,
                                          std::vector<std::set<int>>& vacatedByRow) {
  int sourceY = source / E.cols, sourceX = source - sourceY * E.cols;
  int firstY = dir > 0 ? imax(1, minTargetY)
                       : (sourceSideOnly ? imax(sourceY + 1, minTargetY) : imax(1, minTargetY));
  int lastY = dir > 0 ? sourceY - 1 : E.rows - 1;
  int best = -1, bestDist = INT_MAX;
  for (int y = firstY; y <= lastY; y++) {
    auto& xs = vacatedByRow[y];
    if (xs.empty()) continue;
    int dy = std::abs(y - sourceY);
    if (dy > bestDist) continue;
    auto consider = [&](std::set<int>::iterator it) {
      if (it == xs.end()) return;
      int dist = dy + std::abs(*it - sourceX);
      int k = y * E.cols + *it;
      int bestY = best < 0 ? -1 : best / E.cols;
      bool earlierBfsTie = best >= 0 && (dir > 0 ? y < bestY : y > bestY);
      if (dist < bestDist || (dist == bestDist && (earlierBfsTie || (y == bestY && k < best)))) {
        best = k; bestDist = dist;
      }
    };
    auto right = xs.lower_bound(sourceX);
    consider(right);
    if (right != xs.begin()) consider(std::prev(right));
  }
  if (best < 0) return -1;
  vacatedByRow[best / E.cols].erase(best % E.cols);
  return best;
}

// Side/bottom face contact of a cell set against a grid (top faces excluded on
// purpose: top liquid never creates support/lift). Shared by the single-layer
// buoyancy decision (moveRigidAssemblies) and the cross-layer descend decision
// (moveCrossLayerBondedAssemblies) — the latter accumulates over both layers
// and ignores the `faces` total.
void ComponentSystem::accumulateFaceContact(const uint8_t* g, const std::unordered_set<int>& cells, FaceContact& c,
                                            const std::unordered_map<int, uint8_t>* planned) {
  // Iteration order of `cells` feeds the double accumulators below, so the set
  // stays; only the per-neighbour membership test moves to the stamp mirror.
  // The caller may pass a probe set shifted past the grid edge (motionDecision's
  // `shifted`); OOB members must be skipped entirely — even computing x/y from a
  // negative k and calling asmCells.has(nk) is a memory-safety hazard.
  const int gridLen = E.cols * E.rows;
  asmCells.reset((size_t)gridLen);
  for (int k : cells) if (k >= 0 && k < gridLen) asmCells.add(k);
  auto materialAt = [&](int k) {
    uint8_t m = g[k];
    if (planned) {
      auto it = planned->find(k);
      if (it != planned->end()) m = it->second;
    }
    return m;
  };
  std::vector<int> airFaces;
  for (int k : cells) {
    if (k < 0 || k >= gridLen) continue;
    int y = k / E.cols, x = k - y * E.cols;
    const int offs[3] = { -1, 1, E.cols };
    for (int i = 0; i < 3; i++) {
      int nk = k + offs[i], nx = x + (offs[i] == -1 ? -1 : offs[i] == 1 ? 1 : 0), ny = y + (offs[i] == E.cols ? 1 : 0);
      if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows) continue;
      if (nk < 0 || nk >= gridLen || asmCells.has(nk)) continue;
      uint8_t m = materialAt(nk);
      c.faces++;
      if (E.isLiquidMaterial(m)) {
        c.liquidFaces++;
        c.liquidDensityArea += DENSITY[m];
        if (offs[i] == E.cols) c.bottomLiquidFaces++;
      } else if (E.isLooseSolidMaterial(m)) {
        c.powderFaces++;
        c.powderDensityArea += DENSITY[m];
        if (offs[i] == E.cols) c.bottomPowderFaces++;
      } else if (m == EMPTY || E.isGasMaterial(m)) {
        airFaces.push_back(nk);
      }
    }
  }

  // Buoyancy is displaced liquid mass, not wetted-perimeter fraction. For each
  // horizontal run of assembly cells, liquid at either end means the whole run
  // occupies that liquid level. An underside-only contact contributes half a
  // cell, placing the discrete waterline on the boundary between grid rows.
  // This remains O(area) and is invariant to long horizontal/diagonal geometry.
  if (c.liquidFaces > 0) for (int start : cells) {
    if (start < 0 || start >= gridLen) continue;
    int y = start / E.cols, x = start - y * E.cols;
    if (x <= 0 || x >= E.cols - 1 || (x > 1 && asmCells.has(start - 1))) continue;
    int end = start;
    while ((end - y * E.cols) < E.cols - 2 && asmCells.has(end + 1)) end++;
    int runLength = end - start + 1;
    double sideDensity = 0;
    int liquidSides = 0;
    uint8_t left = materialAt(start - 1), right = materialAt(end + 1);
    if (E.isLiquidMaterial(left)) { sideDensity += DENSITY[left]; liquidSides++; }
    if (E.isLiquidMaterial(right)) { sideDensity += DENSITY[right]; liquidSides++; }
    if (liquidSides > 0) {
      double density = sideDensity / liquidSides;
      c.displacedArea += runLength;
      c.displacedLiquidMass += runLength * density;
      continue;
    }
    for (int k = start; k <= end; k++) {
      int below = k + E.cols;
      if (below >= gridLen || asmCells.has(below)) continue;
      uint8_t m = materialAt(below);
      if (!E.isLiquidMaterial(m)) continue;
      c.displacedArea += 0.5;
      c.displacedLiquidMass += 0.5 * DENSITY[m];
    }
  }

  // Open-air visibility only affects buoyancy. In particular, dry plant
  // fragments produced by fire must not raycast to the top of the world from
  // every exposed face. When liquid is present, cache vertical runs so a wide
  // or irregular floating assembly resolves each visited cell once per probe.
  if (c.liquidFaces == 0 || airFaces.empty()) return;
  std::unordered_map<int, uint8_t> openAir;
  openAir.reserve(airFaces.size() * 2);
  std::vector<int> path;
  path.reserve((size_t)E.rows);
  for (int start : airFaces) {
    int ak = start;
    bool visible = false;
    path.clear();
    for (;;) {
      auto cached = openAir.find(ak);
      if (cached != openAir.end()) {
        visible = cached->second != 0;
        break;
      }
      uint8_t am = materialAt(ak);
      if (am != EMPTY && !E.isGasMaterial(am)) break;
      path.push_back(ak);
      if (ak < E.cols * 2) {
        visible = true;
        break;
      }
      ak -= E.cols;
    }
    const uint8_t result = visible ? 1 : 0;
    for (int pathK : path) openAir.emplace(pathK, result);
    openAir.emplace(ak, result);
    if (visible) c.openAirFaces++;
  }

}

int ComponentSystem::motionDecision(const FaceContact& c, size_t cellCount, double solidMass) {
  double avgDensity = solidMass / cellCount;
  bool powderSupports = false;
  if (c.powderFaces > 0) {
    double powderDensity = c.powderDensityArea / c.powderFaces;
    powderSupports = c.bottomPowderFaces > 0 && avgDensity <= powderDensity + 1e-6;
  }
  if (c.liquidFaces > 0) {
    double liquidDensity = c.liquidDensityArea / c.liquidFaces;
    // A completely submerged body's displaced volume is its full cell volume,
    // so Archimedes reduces exactly to the density comparison here. This also
    // avoids making the result depend on how many boundary faces a sparse shape
    // happens to expose.
    if (c.bottomLiquidFaces > 0 && c.openAirFaces == 0
        && avgDensity < liquidDensity - 1e-6) return -1;
    // In cell units g is common to both terms, so the net vertical force is
    // displaced-liquid mass minus solid mass.
    double netForce = c.displacedLiquidMass - solidMass;
    // The free surface is resolved only to whole cells. Its unknown position
    // within the raster row is represented by the half-cell underside term in
    // accumulateFaceContact. Treat half of one neighbouring liquid cell's mass
    // as the corresponding numerical equilibrium tolerance.
    double rasterEquilibriumBand = 0.5 * liquidDensity;
    if (netForce > rasterEquilibriumBand + 1e-6 && c.bottomLiquidFaces > 0) return -1;
    if (c.bottomLiquidFaces > 0 && netForce >= -rasterEquilibriumBand - 1e-6) return 0;
    return powderSupports ? 0 : 1;
  }
  if (powderSupports) return 0;
  return 1;
}

void ComponentSystem::moveCrossLayerBondedAssemblies() {
  int nf = compCount(E.fg), nb = compCount(E.bg);
  if (cgBonds.empty() || nf == 0 || nb == 0) return;
  // Do NOT pre-dirty both layers: a fully-grounded (or blocked) bonded cluster
  // may run this path without relocating anything. Dirt only when a group moves.
  std::vector<int>& parent = cgParent;
  parent.assign(nf + nb, 0);
  for (int i = 0; i < nf + nb; i++) parent[i] = i;
  for (auto& b : cgBonds) {
    if (b.fgComp < 0 || b.fgComp >= nf || b.bgComp < 0 || b.bgComp >= nb) continue;
    ufUnite(parent, b.fgComp, nf + b.bgComp);
  }
  // Bounded same-layer union-find (replaces the old full-grid uniteLayerAdj),
  // seeded from ungrounded cross-bonded comps; operates on cgParent so the
  // helper's internal find/unite share this same array.
  unionCrossBondedClusters(parent, nullptr, nf, nb);

  struct JointGroup { std::vector<int> fgComps, bgComps; bool grounded = false; int maxY = 0; };
  std::unordered_map<int, JointGroup> groups;
  for (int i = 0; i < nf; i++) if (i < (int)E.fg.crossBondedComp.size() && E.fg.crossBondedComp[i]) {
    int r = ufFind(parent, i); JointGroup& g = groups[r]; g.fgComps.push_back(i);
    Comp* c = compById(E.fg, i); if (c->grounded) g.grounded = true; if (c->yMax > g.maxY) g.maxY = c->yMax;
  }
  for (int i = 0; i < nb; i++) if (i < (int)E.bg.crossBondedComp.size() && E.bg.crossBondedComp[i]) {
    int r = ufFind(parent, nf + i); JointGroup& g = groups[r]; g.bgComps.push_back(i);
    Comp* c = compById(E.bg, i); if (c->grounded) g.grounded = true; if (c->yMax > g.maxY) g.maxY = c->yMax;
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
  struct LayerMovePlan {
    std::vector<std::pair<int, uint8_t>> relocate;
    std::unordered_set<int> shifted;
    std::unordered_map<int, uint8_t> materials;
  };
  // Build the exact one-cell result for one half of a joint assembly. The same
  // plan feeds both the post-move buoyancy probe and the eventual writes, so the
  // anti-jitter decision cannot observe a different world from the mover.
  auto planLayerMove = [&](Layer& lay, const std::unordered_set<int>& own, int dir,
                           LayerMovePlan& plan) -> bool {
    plan.relocate.clear(); plan.shifted.clear(); plan.materials.clear();
    struct PendingRelocate { int source; uint8_t material; };
    std::vector<PendingRelocate> pending;
    std::vector<int> vacated;
    for (int k : own) {
      int nk = k + dir;
      if (nk < E.cols || nk >= E.cols * E.rows) return false;
      if (own.count(nk)) continue;
      uint8_t lead = lay.grid[nk];
      if (lead == EMPTY || E.isGasMaterial(lead)) continue;
      if (!E.isBuoyantMedium(lead)) return false;
      pending.push_back({nk, lead});
    }
    for (int k : own) if (!own.count(k - dir)) vacated.push_back(k);
    if (pending.size() > vacated.size()) return false;
    const int gridLen = E.cols * E.rows;
    asmCells.reset((size_t)gridLen);
    trVacated.reset((size_t)gridLen);
    trReserved.reset((size_t)gridLen);
    for (int k : own) asmCells.add(k);
    for (int k : vacated) trVacated.add(k);
    std::vector<std::set<int>> vacatedByRow(E.rows);
    for (int k : vacated) vacatedByRow[k / E.cols].insert(k % E.cols);
    std::unordered_map<uint8_t, std::vector<int>> sourceRows;
    for (const auto& p : pending) sourceRows[p.material].push_back(p.source / E.cols);
    std::unordered_map<uint8_t, int> contactFloorRow;
    for (auto& entry : sourceRows) {
      auto& rows = entry.second;
      std::sort(rows.begin(), rows.end());
      contactFloorRow[entry.first] = rows[(rows.size() * 3) / 4];
    }
    std::sort(pending.begin(), pending.end(), [](const PendingRelocate& a, const PendingRelocate& b) {
      return a.source < b.source;
    });
    for (const auto& p : pending) {
      int minTargetY = dir < 0 && E.isLiquidMaterial(p.material) ? contactFloorRow[p.material] : 0;
      int target = nearestVacatedTarget(p.source, dir, minTargetY, true, vacatedByRow);
      // The contact floor is a preference, not a hard capacity limit. Concave
      // assemblies can have several vertical runs and fewer trailing vacancies
      // below the median contact row than displaced leading-face cells. Use the
      // remaining upper vacancies before declaring an otherwise valid rise pinned.
      if (target < 0 && minTargetY > 0) target = nearestVacatedTarget(p.source, dir, minTargetY, false, vacatedByRow);
      if (target < 0) return false;
      trReserved.add(target);
      plan.relocate.push_back({target, p.material});
    }
    plan.shifted.reserve(own.size()); plan.materials.reserve(own.size() * 2 + plan.relocate.size());
    for (int k : own) plan.materials[k] = EMPTY;
    for (int k : own) { plan.shifted.insert(k + dir); plan.materials[k + dir] = lay.grid[k]; }
    for (auto& r : plan.relocate) plan.materials[r.first] = r.second;
    return true;
  };
  auto applyLayer = [&](Layer& lay, const std::vector<int>& ids, const std::unordered_set<int>& cells,
                        const std::vector<CellMat>& mats, const LayerMovePlan& plan, int dir) {
    E.useLayer(&lay);
    for (int k : cells) E.writeGridIndex(k, EMPTY);
    for (auto& cm : mats) E.writeGridIndex(cm.k + dir, cm.m);
    for (auto& r : plan.relocate) E.writeGridIndex(r.first, r.second);
    for (int id : ids) {
      Comp* c = compById(lay, id);
      bool isPlant = compIdIsPlant(lay, id);
      int wood = 0, leaf = 0, ym = 0;
      for (int& k : c->cells) {
        k += dir;
        int y = k / E.cols; if (y > ym) ym = y;
        if (isPlant) { uint8_t m = lay.grid[k]; if (E.isPlantWood(m)) wood++; else if (E.isPlantLeaf(m)) leaf++; }
      }
      c->yMax = ym;
      if (isPlant) { c->woodCount = wood; c->leafCount = leaf; c->cacheDirty = true; }
    }
  };

  LayerMovePlan fgPlan, bgPlan;
  for (JointGroup* g : order) {
    if (g->grounded || g->fgComps.empty() || g->bgComps.empty()) continue;
    collect(E.fg, g->fgComps, fgCells, fgMats);
    collect(E.bg, g->bgComps, bgCells, bgMats);
    double sum = 0;
    for (auto& cm : fgMats) sum += DENSITY[cm.m];
    for (auto& cm : bgMats) sum += DENSITY[cm.m];
    FaceContact before;
    accumulateFaceContact(E.fg.grid, fgCells, before);
    accumulateFaceContact(E.bg.grid, bgCells, before);
    int decision = motionDecision(before, fgCells.size() + bgCells.size(), sum);
    if (decision == 0) continue;
    int dir = decision > 0 ? E.cols : -E.cols;
    // A joint moves only when both layer-local halves can execute the same plan.
    if (!planLayerMove(E.fg, fgCells, dir, fgPlan) || !planLayerMove(E.bg, bgCells, dir, bgPlan)) continue;
    FaceContact after;
    accumulateFaceContact(E.fg.grid, fgPlan.shifted, after, &fgPlan.materials);
    accumulateFaceContact(E.bg.grid, bgPlan.shifted, after, &bgPlan.materials);
    if (motionDecision(after, fgPlan.shifted.size() + bgPlan.shifted.size(), sum) == -decision) continue;
    applyLayer(E.fg, g->fgComps, fgCells, fgMats, fgPlan, dir);
    applyLayer(E.bg, g->bgComps, bgCells, bgMats, bgPlan, dir);
    int8_t moveDir = dir < 0 ? -1 : 1;
    for (int id : g->fgComps) compById(E.fg, id)->buoyancyDirection = moveDir;
    for (int id : g->bgComps) compById(E.bg, id)->buoyancyDirection = moveDir;
    // Assembly relocated: both layers need a full joint re-flood next step.
    E.fg.groundDirty = true; E.bg.groundDirty = true;
  }
  E.useLayer(&E.fg);
}

void ComponentSystem::moveRigidAssemblies() {
  // Only UNGROUNDED assemblies can move (fall/float) — grounded terrain stays
  // put (the per-group loop below `continue`s on grounded). computeGrounded
  // floods grounded-ness through rigid contact, so an ungrounded component is
  // never 8-connected to a grounded one. So we process only ungrounded
  // components here, making the whole pass O(ungrounded cells) instead of
  // O(all stone) every step. `E.L->cellComp` (from computeGrounded) holds GLOBAL
  // comp indices in stone|plant|ice order; localOf maps those to our filtered
  // ungrounded `all` array (or -1 for grounded/none).
  int totalComps = (int)(E.L->stoneComponents.size() + E.L->plantComponents.size() + E.L->iceComponents.size());
  if (totalComps == 0) return;
  std::vector<Comp*> all;
  std::vector<int> localOf(totalComps, -1);
  int gi = 0;
  auto addList = [&](std::vector<Comp>& list, bool ice) {
    for (auto& c : list) {
      if (c.grounded && c.buoyancyDirection > 0 && !c.cells.empty()) {
        double x = 0, y = 0;
        for (int k : c.cells) { x += k % E.cols; y += k / E.cols; }
        E.audio.emit(SE_SOLID_LAND, x / c.cells.size(), y / c.cells.size(),
                     std::min(1.6, 0.28 + std::sqrt((double)c.cells.size()) * 0.065),
                     ice ? ICE : E.L->grid[c.cells[0]]);
        c.buoyancyDirection = 0;
      }
      if (!c.grounded && (!jointGroundReady || gi >= (int)E.L->crossBondedComp.size() || !E.L->crossBondedComp[gi])) {
        localOf[gi] = (int)all.size(); all.push_back(&c);
      }
      gi++;
    }
  };
  addList(E.L->stoneComponents, false); int nStone = (int)all.size();
  addList(E.L->plantComponents, false); int nStonePlant = (int)all.size();
  addList(E.L->iceComponents, true);
  int n = (int)all.size();
  if (n == 0) return; // everything is grounded (settled) -> nothing to move
  for (auto* comp : all) { int ym = 0; for (int k : comp->cells) { int y = k / E.cols; if (y > ym) ym = y; } comp->yMax = ym; }
  std::vector<int> parent(n); for (int i = 0; i < n; i++) parent[i] = i;
  // anchored[i]: this ungrounded comp is 8-adjacent to a GROUNDED comp, so it
  // is attached to supported terrain and must not move. (In the original full
  // union-find such a comp joined a grounded group and was skipped; this
  // reproduces that exactly while only scanning ungrounded cells.)
  std::vector<uint8_t> anchored(n, 0);
  for (int i = 0; i < n; i++) for (int k : all[i]->cells) {
    if (k < 0 || k >= E.cols * E.rows) continue;
    int y = k / E.cols, x = k - y * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = x + ox, ny = y + oy;
      if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows) continue;
      int gj = E.L->cellComp[ny * E.cols + nx];
      // cellComp can lag a re-index if a prior erase split comps without a full
      // flood; never index localOf with a stale id (WASM OOB / segfault).
      if (gj < 0 || gj >= totalComps) continue;
      int j = localOf[gj];
      if (j >= 0) ufUnite(parent, i, j);
      else anchored[i] = 1;
    }
  }
  struct Group { std::vector<int> comps; bool grounded = false; int maxY = 0; };
  std::unordered_map<int, Group> groups;
  for (int i = 0; i < n; i++) { int r = ufFind(parent, i); Group& g = groups[r]; g.comps.push_back(i); if (all[i]->grounded || anchored[i]) g.grounded = true; if (all[i]->yMax > g.maxY) g.maxY = all[i]->yMax; }
  std::vector<Group*> order; order.reserve(groups.size());
  for (auto& kv : groups) order.push_back(&kv.second);
  std::sort(order.begin(), order.end(), [](Group* a, Group* b) { return a->maxY > b->maxY; });

  // Read the live grid for stone-group and plant comps so a falling component
  // keeps its real material (ore stays ore, not STONE). Ice comps are pure ICE.
  auto matOf = [&](int i, int k) -> uint8_t { return i < nStonePlant ? E.L->grid[k] : ICE; };

  auto translateAssembly = [&](Group* grp, std::unordered_set<int>& cells, int dir,
                               int decision, double solidMass, bool fullySubmerged) -> bool {
    int dy = dir > 0 ? 1 : -1;
    bool hasIce = false;
    for (int ci : grp->comps) if (ci >= nStonePlant) { hasIce = true; break; }
    const int gridLen = E.cols * E.rows;
    auto emitBlockedLanding = [&]() {
      bool wasFalling = decision > 0;
      for (int ci : grp->comps) wasFalling = wasFalling && all[ci]->buoyancyDirection > 0;
      if (!wasFalling || cells.empty()) return;
      double x = 0, y = 0;
      for (int k : cells) { x += k % E.cols; y += k / E.cols; }
      int ci = grp->comps[0], k = all[ci]->cells[0];
      E.audio.emit(SE_SOLID_LAND, x / cells.size(), y / cells.size(),
                   std::min(1.6, 0.28 + std::sqrt((double)cells.size()) * 0.065),
                   matOf(ci, k));
      for (int groupCi : grp->comps) all[groupCi]->buoyancyDirection = 0;
    };
    // Membership mirror of `cells` (iteration below stays on the set — its
    // order feeds displaced/vacated order and thus every relocation write).
    asmCells.reset((size_t)gridLen);
    for (int k : cells) asmCells.add(k);
    auto componentDisplaceableForAssembly = [&](uint8_t m) {
      return m == EMPTY || E.isGasMaterial(m) || E.isBuoyantMedium(m);
    };
    for (int k : cells) {
      int leadK = k + dir; int leadY = leadK / E.cols;
      if (leadY < 1 || leadY >= E.rows) { emitBlockedLanding(); return false; }
      if (asmCells.has(leadK)) continue;
      uint8_t lead = E.L->grid[leadK];
      if (!componentDisplaceableForAssembly(lead)) { emitBlockedLanding(); return false; }
    }
    struct Disp { uint8_t material; int from; };
    std::vector<Disp> displaced; std::vector<int> vacated;
    for (int k : cells) {
      int leadK = k + dir; uint8_t lead = E.L->grid[leadK];
      if (!asmCells.has(leadK) && lead != EMPTY && componentDisplaceableForAssembly(lead)) displaced.push_back({lead, leadK});
      int trailK = k - dir; // may be out of bounds at the world edge (the old set .count was safe on any int; the stamp array is not)
      if (trailK < 0 || trailK >= gridLen || !asmCells.has(trailK)) vacated.push_back(k);
    }
    int liquidDisplacedCount = 0, powderDisplacedCount = 0;
    for (auto& d : displaced) { if (E.isLiquidMaterial(d.material)) liquidDisplacedCount++; else if (E.isLooseSolidMaterial(d.material)) powderDisplacedCount++; }
    // Liquids and powders are relocated volume-preservingly. Liquids use a
    // density chain: dense fluid claims nearby lighter fluid first, then that
    // lighter fluid continues the same search until the chain reaches a surface.
    // The cells the assembly vacates are valid free volume for this planning
    // step; large slanted solids otherwise need too many distant surface cells
    // and can pin in full liquid stacks. Powders use a spill BFS to nearby free
    // room. GAS keeps the original vacated-cell dump.
    struct LiquidWrite { int target; uint8_t material; };
    std::vector<LiquidWrite> liquidWrites;
    std::vector<int> powderTargets;
    trReserved.reset(gridLen); // cells already claimed by liquid/powder relocation (queried even when nothing is displaced)
    if (liquidDisplacedCount > 0 || powderDisplacedCount > 0) {
      // Cells the assembly is about to occupy — a spill target must not be one of
      // them. Built lazily here (only when liquid/powder is displaced) so a large
      // slab falling through air/empty skips the O(area) stamp fill per step.
      trMoved.reset(gridLen);
      for (int k : cells) trMoved.add(k + dir);
      trVacated.reset(gridLen);
      for (int k : vacated) trVacated.add(k);
      std::vector<std::set<int>> vacatedByRow(E.rows);
      for (int k : vacated) vacatedByRow[k / E.cols].insert(k % E.cols);
      int offs[4]; if (dir > 0) { offs[0] = -1; offs[1] = 1; offs[2] = E.cols; offs[3] = -E.cols; } else { offs[0] = -1; offs[1] = 1; offs[2] = -E.cols; offs[3] = E.cols; }
      auto plannedMaterialAt = [&](int k) -> uint8_t { return trVacated.has(k) ? EMPTY : E.L->grid[k]; };
      // Bound the total volume-preserving liquid search for this one assembly move.
      // Each displaced liquid cell BFS-floods the reachable liquid body to find a
      // surface; for a large rigid slab sinking through a big ENCLOSED pool (e.g.
      // acid/water quenching a lava lake into a sinking STONE island) that is
      // O(displaced * poolArea) per step and froze the E.tick for seconds. Once the
      // shared budget is spent, planLiquidChain fails over to planVacatedLiquidDump —
      // the volume the slab just vacated directly above it, which is the natural
      // destination for a fully-immersed slab anyway. Small slabs / shallow pools
      // never approach the cap, so their realistic surface-seeking flow is unchanged.
      const long LIQUID_PLAN_VISIT_BUDGET = 100000;
      long liquidPlanVisits = 0;
      auto planLiquidChain = [&](uint8_t startMaterial, int startFrom) -> bool {
        size_t writeBase = liquidWrites.size();
        std::vector<int> claimed;
        auto fail = [&]() {
          liquidWrites.resize(writeBase);
          for (int k : claimed) trReserved.remove(k);
          return false;
        };
        uint8_t moving = startMaterial;
        int origin = startFrom;
        for (int chain = 0; chain < TABLE + 2; chain++) {
          trSeen.reset((size_t)gridLen); std::vector<int> queue;
          auto canVisit = [&](int k) {
            if (liquidPlanVisits >= LIQUID_PLAN_VISIT_BUDGET) return false; // budget spent -> stop flooding, fall back to vacated dump
            if (k < 0 || k >= gridLen || trSeen.has(k) || trReserved.has(k)) return false;
            int y = k / E.cols, x = k - y * E.cols;
            if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false;
            // Search the external fluid domain. Vacated component cells are
            // reserved fallback volume, not shortcuts or surface targets;
            // traversing them makes displaced liquid erupt through the top wake.
            if (trMoved.has(k) || asmCells.has(k)) return false;
            uint8_t m = plannedMaterialAt(k);
            return m == EMPTY || E.isLiquidMaterial(m);
          };
          auto enqueue = [&](int k) { if (!canVisit(k)) return; trSeen.add(k); queue.push_back(k); liquidPlanVisits++; };
          for (int off : offs) enqueue(origin + off);
          for (size_t qi = 0; qi < queue.size();) {
            size_t levelEnd = queue.size();
            int lighterTarget = -1, emptyTarget = -1;
            for (; qi < levelEnd; qi++) {
              int k = queue[qi];
              uint8_t m = plannedMaterialAt(k);
              if (E.isLiquidMaterial(m) && DENSITY[m] < DENSITY[moving]) {
                if (lighterTarget < 0) lighterTarget = k;
                continue;
              }
              if (m == EMPTY) {
                if (emptyTarget < 0) emptyTarget = k;
                continue;
              }
              for (int off : offs) enqueue(k + off);
            }
            int target = lighterTarget >= 0 ? lighterTarget : emptyTarget;
            if (target < 0) continue;
            uint8_t displacedLiquid = plannedMaterialAt(target);
            liquidWrites.push_back({target, moving});
            trReserved.add(target);
            claimed.push_back(target);
            if (E.isLiquidMaterial(displacedLiquid)) {
              moving = displacedLiquid;
              origin = target;
              break;
            }
            return true;
          }
          if (queue.empty()) return fail();
        }
        return fail();
      };
      std::array<int, TABLE> minLiquidTargetY{};
      if (dir < 0) {
        std::array<std::vector<int>, TABLE> sourceRows;
        for (const auto& d : displaced) if (E.isLiquidMaterial(d.material)) sourceRows[d.material].push_back(d.from / E.cols);
        for (int m = 0; m < TABLE; m++) if (!sourceRows[m].empty()) {
          auto& rows = sourceRows[m];
          std::sort(rows.begin(), rows.end());
          minLiquidTargetY[m] = rows[rows.size() / 2];
        }
      }
      auto planVacatedLiquidDump = [&](uint8_t material, int source) {
        int target = nearestVacatedTarget(source, dir, minLiquidTargetY[material], true, vacatedByRow);
        if (target < 0 && minLiquidTargetY[material] > 0)
          target = nearestVacatedTarget(source, dir, minLiquidTargetY[material], false, vacatedByRow);
        if (target < 0) return false;
        liquidWrites.push_back({target, material});
        trReserved.add(target);
        return true;
      };
      std::vector<uint8_t> liquidPlaced(displaced.size(), 0);
      // A descending wide face can displace hundreds of same-material cells.
      // Resolve external free volume with one multi-source BFS per material;
      // per-cell searches exhausted the shared budget and dumped the
      // remainder into distant top-wake vacancies. Mixed-liquid chains and
      // genuinely enclosed residuals continue through the exact fallback below.
      if (dir > 0 && liquidDisplacedCount > 0) {
        std::vector<int> indices;
        for (int i = 0; i < (int)displaced.size(); i++) {
          if (E.isLiquidMaterial(displaced[i].material) && !liquidPlaced[i]) indices.push_back(i);
        }
        std::sort(indices.begin(), indices.end(), [&](int a, int b) {
          uint8_t am = displaced[a].material, bm = displaced[b].material;
          if (DENSITY[am] != DENSITY[bm]) return DENSITY[am] > DENSITY[bm];
          if (am != bm) return am < bm;
          return displaced[a].from < displaced[b].from;
        });
        for (size_t gi = 0; gi < indices.size();) {
          uint8_t material = displaced[indices[gi]].material;
          size_t gj = gi + 1;
          while (gj < indices.size() && displaced[indices[gj]].material == material) gj++;
          int need = (int)(gj - gi);
          trSeen.reset((size_t)gridLen);
          std::vector<int> queue, targets;
          auto canVisit = [&](int k) {
            if (k < 0 || k >= gridLen || trSeen.has(k) || trReserved.has(k)) return false;
            int y = k / E.cols, x = k - y * E.cols;
            if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false;
            if (trMoved.has(k) || asmCells.has(k)) return false;
            uint8_t m = plannedMaterialAt(k);
            return m == EMPTY || m == material;
          };
          auto enqueue = [&](int k) { if (!canVisit(k)) return; trSeen.add(k); queue.push_back(k); };
          for (size_t i = gi; i < gj; i++) for (int off : offs) enqueue(displaced[indices[i]].from + off);
          int visitBudget = imin(gridLen, imax(4096, need * 128));
          int visits = 0;
          for (size_t qi = 0; qi < queue.size() && (int)targets.size() < need && visits < visitBudget;) {
            size_t levelEnd = queue.size();
            for (; qi < levelEnd && visits < visitBudget; qi++, visits++) {
              int k = queue[qi];
              uint8_t m = plannedMaterialAt(k);
              if (m == EMPTY && !trReserved.has(k)) {
                trReserved.add(k);
                targets.push_back(k);
                if ((int)targets.size() >= need) break;
              }
              for (int off : offs) enqueue(k + off);
            }
          }
          int placed = imin(need, (int)targets.size());
          for (int i = 0; i < placed; i++) {
            int di = indices[gi + i];
            liquidWrites.push_back({targets[i], displaced[di].material});
            liquidPlaced[di] = 1;
          }
          gi = gj;
        }
      }
      bool exactRiseFallback = false;
      for (int di = 0; di < (int)displaced.size(); di++) {
        auto& d = displaced[di];
        if (!E.isLiquidMaterial(d.material)) continue;
        if (liquidPlaced[di]) continue;
        // A rising submerged assembly leaves volume directly beneath itself;
        // fill that trailing volume first so it does not create an artificial
        // cavity and immediately fall back. A descending assembly keeps the
        // surface-seeking density chain, with vacated volume as its fallback.
        bool placed = dir < 0
          ? (planVacatedLiquidDump(d.material, d.from) || planLiquidChain(d.material, d.from))
          : (planLiquidChain(d.material, d.from) || (!hasIce && planVacatedLiquidDump(d.material, d.from)));
        if (!placed) {
          if (dir < 0 && fullySubmerged) { exactRiseFallback = true; break; }
          return false;
        }
      }
      if (exactRiseFallback) {
        // Greedy spatial matching can consume another vertical run's only
        // vacancy and falsely pin a sparse or concave rising body. Roll the
        // incomplete plan back and use the guaranteed bijection: each vertical
        // solid run has exactly one leading liquid cell and one trailing cell.
        liquidWrites.clear();
        trReserved.reset(gridLen);
        std::fill(liquidPlaced.begin(), liquidPlaced.end(), 0);
        for (int i = 0; i < (int)displaced.size(); i++) {
          const auto& d = displaced[i];
          if (!E.isLiquidMaterial(d.material)) continue;
          int target = d.from - dir;
          while (target - dir >= 0 && target - dir < gridLen && asmCells.has(target - dir)) target -= dir;
          if (!trVacated.has(target) || trReserved.has(target)) return false;
          liquidWrites.push_back({target, d.material});
          trReserved.add(target);
          liquidPlaced[i] = 1;
        }
      }

      auto runPowderSpill = [&](int need, std::vector<int>& out) -> bool {
        if (need <= 0) return true;
        trSeen.reset((size_t)gridLen); std::vector<int> queue;
        auto canVisit = [&](int k) { if (k < 0 || k >= gridLen || trSeen.has(k) || trReserved.has(k)) return false; int y = k / E.cols, x = k - y * E.cols; if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false; if (trMoved.has(k) || (asmCells.has(k) && !trVacated.has(k))) return false; uint8_t m = plannedMaterialAt(k); return m == EMPTY || E.isLiquidMaterial(m) || E.isLooseSolidMaterial(m); };
        auto enqueue = [&](int k) { if (!canVisit(k)) return; trSeen.add(k); queue.push_back(k); };
        for (auto& d : displaced) { if (!E.isLooseSolidMaterial(d.material)) continue; for (int off : offs) enqueue(d.from + off); }
        for (size_t qi = 0; qi < queue.size() && (int)out.size() < need; qi++) {
          int k = queue[qi];
          if (plannedMaterialAt(k) == EMPTY) { if (!trReserved.has(k)) { trReserved.add(k); out.push_back(k); } continue; }
          for (int off : offs) enqueue(k + off);
        }
        return (int)out.size() >= need;
      };
      if (!runPowderSpill(powderDisplacedCount, powderTargets)) return false;
    }
    // Materialize the exact post-translation overlay before mutating the grid.
    // The equilibrium probe reads this same plan (including liquid-chain and
    // powder spill targets), eliminating stale-grid and approximate-vacated-cell
    // disagreements for irregular submerged assemblies.
    std::unordered_map<int, uint8_t> planned;
    planned.reserve(cells.size() * 2 + liquidWrites.size() + powderTargets.size());
    std::unordered_set<int> shifted; shifted.reserve(cells.size());
    for (int k : cells) planned[k] = EMPTY;
    for (int ci : grp->comps) for (int k : all[ci]->cells) {
      shifted.insert(k + dir);
      planned[k + dir] = matOf(ci, k);
    }
    for (auto& w : liquidWrites) planned[w.target] = w.material;
    int plannedPowder = 0;
    for (auto& d : displaced) if (E.isLooseSolidMaterial(d.material)) {
      planned[powderTargets[plannedPowder++]] = d.material;
    }
    FaceContact postMove;
    accumulateFaceContact(E.L->grid, shifted, postMove, &planned);
    int postDecision = motionDecision(postMove, shifted.size(), solidMass);
    if (postDecision == -decision) return false;
    bool landed = false;
    if (decision > 0 && postDecision == 0) {
      for (int k : shifted) {
        int below = k + E.cols;
        if (below >= gridLen || shifted.count(below)) continue;
        auto it = planned.find(below);
        uint8_t support = it == planned.end() ? E.L->grid[below] : it->second;
        if (support != EMPTY && !E.isGasMaterial(support) && !E.isLiquidMaterial(support)) {
          landed = true;
          break;
        }
      }
    }
    double landX = 0, landY = 0;
    for (int k : shifted) { landX += k % E.cols; landY += k / E.cols; }
    if (!shifted.empty()) { landX /= shifted.size(); landY /= shifted.size(); }
    uint8_t landMaterial = EMPTY;
    if (!grp->comps.empty() && !all[grp->comps[0]]->cells.empty()) {
      int ci = grp->comps[0], k = all[ci]->cells[0];
      landMaterial = matOf(ci, k);
    }

    struct Move { Comp* comp; bool isPlant; std::vector<std::pair<int, uint8_t>> mats; int wood, leaf; };
    std::vector<Move> moves;
    for (int ci : grp->comps) {
      Comp* comp = all[ci]; bool isPlant = ci >= nStone && ci < nStonePlant;
      std::vector<std::pair<int, uint8_t>> mats; int wood = 0, leaf = 0;
      for (int k : comp->cells) { uint8_t m = matOf(ci, k); mats.push_back({k + dir, m}); if (isPlant) { if (E.isPlantWood(m)) wood++; else if (E.isPlantLeaf(m)) leaf++; } }
      moves.push_back({comp, isPlant, std::move(mats), wood, leaf});
    }
    std::vector<std::pair<int, int>> movedFuses;
    if (!E.L->pendingDetonations.empty()) {
      movedFuses.reserve(E.L->pendingDetonations.size());
      for (int k : cells) {
        auto it = E.L->pendingDetonations.find(k);
        if (it == E.L->pendingDetonations.end()) continue;
        movedFuses.push_back({k + dir, it->second});
        E.L->pendingDetonations.erase(it);
      }
    }
    E.L->groundDirty = true; // an assembly is relocating -> grounding changes -> full reflood
    for (int k : cells) E.writeGridIndex(k, EMPTY);
    for (auto& mv : moves) {
      std::vector<int> newCells; newCells.reserve(mv.mats.size());
      for (auto& pr : mv.mats) { E.writeGridIndex(pr.first, pr.second); newCells.push_back(pr.first); } // mats are distinct (k+dir over distinct k)
      mv.comp->cells = std::move(newCells);
      mv.comp->yMax = imax(0, imin(E.rows - 1, mv.comp->yMax + dy));
      if (mv.isPlant) { mv.comp->woodCount = mv.wood; mv.comp->leafCount = mv.leaf; mv.comp->cacheDirty = true; }
    }
    // The loose pass and surface leveler run later this tick. Keep genuinely
    // empty trailing cells unavailable until the next tick so displaced liquid
    // placed outside the footprint cannot immediately sweep back through the
    // iceberg's top wake after the relocation planner has finished.
    if (hasIce) for (int k : vacated) E.L->assemblyWakeStamp[k] = E.tick;
    for (auto& pr : movedFuses) {
      auto it = E.L->pendingDetonations.find(pr.first);
      if (it == E.L->pendingDetonations.end() || pr.second < it->second) E.L->pendingDetonations[pr.first] = pr.second;
    }
    // Relocate every displaced cell: liquids use liquidWrites, powders -> powderTargets,
    // gas -> the vacated-cell dump. A powder STILL advances the
    // shared vacated cursor (without writing there) so gas keeps landing in
    // byte-identical cells while the powder goes to its spill target instead.
    int di = 0, pi = 0;
    for (auto& d : displaced) {
      if (E.isLiquidMaterial(d.material)) continue;
      while (di < (int)vacated.size() && (E.L->grid[vacated[di]] != EMPTY || trReserved.has(vacated[di]))) di++;
      if (E.isLooseSolidMaterial(d.material)) {
        int target = powderTargets[pi++]; E.writeGridIndex(target, d.material); E.L->assemblyRelocatedCells.push_back(target);
        if (di < (int)vacated.size()) di++;
      } else if (di < (int)vacated.size()) {
        int target = vacated[di++]; E.writeGridIndex(target, d.material); E.L->assemblyRelocatedCells.push_back(target); // gas
      }
    }
    for (auto& w : liquidWrites) { E.writeGridIndex(w.target, w.material); E.L->assemblyRelocatedCells.push_back(w.target); }
#ifdef SAND_INVARIANT_CHECKS
    {
      // Dev probe: no relocation target may land inside ANY component's cells.
      std::unordered_set<int> allCompCells;
      for (auto& c : E.L->stoneComponents) for (int k : c.cells) allCompCells.insert(k);
      for (auto& c : E.L->plantComponents) for (int k : c.cells) allCompCells.insert(k);
      for (auto& c : E.L->iceComponents) for (int k : c.cells) allCompCells.insert(k);
      auto probe = [&](int t, uint8_t m, const char* what) {
        if (!allCompCells.count(t)) return;
        char buf[200];
        snprintf(buf, sizeof(buf), "TRANSLATE PROBE: %s wrote mat=%d into comp cell k=%d (x=%d,y=%d) dir=%d vacated=%d",
                 what, (int)m, t, t % E.cols, t / E.cols, dir > 0 ? 1 : -1, (int)std::count(vacated.begin(), vacated.end(), t));
        emscripten_console_error(buf);
        abort();
      };
      for (auto& w : liquidWrites) probe(w.target, w.material, "liquidWrite");
      for (size_t i2 = 0; i2 < powderTargets.size(); i2++) probe(powderTargets[i2], 0, "powderSpill");
    }
#endif
    int8_t moveDir = landed ? 0 : (dir < 0 ? -1 : 1);
    for (int ci : grp->comps) all[ci]->buoyancyDirection = moveDir;
    if (landed) E.audio.emit(SE_SOLID_LAND, landX, landY,
                             std::min(1.6, 0.28 + std::sqrt((double)shifted.size()) * 0.065),
                             landMaterial);
    return true;
  };

  for (Group* grp : order) {
    if (grp->grounded) continue;
    std::unordered_set<int> cells;
    for (int ci : grp->comps) for (int k : all[ci]->cells) cells.insert(k);
    double weight = 0;
    for (int ci : grp->comps) {
      for (int k : all[ci]->cells) {
        double d = DENSITY[matOf(ci, k)];
        weight += d;
      }
    }
    FaceContact current;
    accumulateFaceContact(E.L->grid, cells, current);
    int decision = motionDecision(current, cells.size(), weight);
    if (decision == 0) continue;
    int dirK = decision > 0 ? E.cols : -E.cols;
    bool fullySubmerged = current.liquidFaces > 0 && current.openAirFaces == 0;
    translateAssembly(grp, cells, dirK, decision, weight, fullySubmerged);
  }
}

// `seen[k] == gen` means visited. The caller bumps the generation (gen++) to
// "clear" the whole buffer in O(1) instead of reallocating/zeroing E.cols*E.rows.
void ComponentSystem::floodComponent(int sx, int sy, std::vector<int32_t>& seen, int32_t gen, bool bounded, std::vector<int>& outCells, int& outYMax,
                    bool (ComponentSystem::*matCheck)(uint8_t)) {
  int bx = bounded ? sx >> CHUNK_SHIFT : 0, by = bounded ? sy >> CHUNK_SHIFT : 0;
  int k0 = sy * E.cols + sx;
  outCells.clear(); outCells.push_back(k0); outYMax = sy; seen[k0] = gen; // seen[] dedups -> push_back never repeats
  for (size_t qi = 0; qi < outCells.size(); qi++) {
    int cur = outCells[qi]; int y = cur / E.cols, x = cur - y * E.cols; if (y > outYMax) outYMax = y;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
      if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows) continue;
      if (bounded && ((nx >> CHUNK_SHIFT) != bx || (ny >> CHUNK_SHIFT) != by)) continue;
      int nk = ny * E.cols + nx; if (seen[nk] == gen || !(this->*matCheck)(E.L->grid[nk])) continue;
      seen[nk] = gen; outCells.push_back(nk);
    }
  }
}
// Component-group membership for the seeded-component floods (generated from the
// schema `componentGroup`). The stone group floods each material as its OWN id
// (an ore vein is its own island, not merged with surrounding stone), so it uses
// floodTargetMat rather than a group-membership predicate.
bool ComponentSystem::isFloodTargetMat(uint8_t m) { return m == floodTargetMat; }
bool ComponentSystem::isIceGroup(uint8_t m) { return MAT_CGROUP[m] == CG_ICE; }
bool ComponentSystem::isPlantMat(uint8_t m) { return MAT_CGROUP[m] == CG_PLANT; }

void ComponentSystem::registerSeededComponents(int colStart, int colEnd) { registerSeededComponents(colStart, colEnd, 0, E.rows); }
// Register stone/plant/ice components for unseen material in the buffer rect
// [colStart,colEnd) x [rowStart,rowEnd). A streamed-in vertical band passes a row
// range (E.cols-wide); a horizontal band passes a col range (E.rows-tall).
void ComponentSystem::registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd) {
  E.L->groundDirty = true; // bulk component rebuild (sync/tools/worldgen/shift) -> full reflood
  // Reused generation-stamped scratch (allocated once in Layer::alloc): a cell
  // is "seen" iff seenStamp[k] == gen. Each of the three blocks bumps gen, so
  // the "clear" between materials costs O(1) instead of zeroing E.cols*E.rows.
  std::vector<int32_t>& seen = E.L->seenStamp;
  // STONE group (chunk-bounded). Each same-id region floods as its own island,
  // so a vein of ore inside stone is a distinct component (and stays a distinct
  // material when it falls — see matOf in moveRigidAssemblies). New ores/blocks
  // with componentGroup "stone" register here automatically.
  {
    int32_t gen = ++E.L->seenGen;
    for (auto& comp : E.L->stoneComponents) for (int k : comp.cells) seen[k] = gen;
    for (int k : E.L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components (skip both seeding and flood-merge)
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || MAT_CGROUP[E.L->grid[k]] != CG_STONE) continue;
      std::vector<int> cells; int yMax;
      floodTargetMat = E.L->grid[k];
      floodComponent(sx, sy, seen, gen, true, cells, yMax, &ComponentSystem::isFloodTargetMat);
      Comp c; c.id = E.L->nextStoneId++; c.cells = std::move(cells); c.yMax = yMax;
      c.growing = floodTargetMat == MYCELIUM_SPORE;
      if (c.growing) E.L->myceliumActive = true;
      E.L->stoneComponents.push_back(std::move(c));
    }
  }
  // PLANT group (unbounded — a whole tree is one component). New plant-family
  // flora with componentGroup "plant" register here automatically.
  {
    int32_t gen = ++E.L->seenGen;
    for (auto& comp : E.L->plantComponents) for (int k : comp.cells) seen[k] = gen;
    for (int k : E.L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || MAT_CGROUP[E.L->grid[k]] != CG_PLANT) continue;
      std::vector<int> cells; int yMax;
      floodComponent(sx, sy, seen, gen, false, cells, yMax, &ComponentSystem::isPlantMat);
      Comp c; c.id = E.L->nextPlantId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
      // Re-derive the species from the trunk material (so a streamed-in / restored
      // tree keeps its type — the cells ARE the persistence) and count generically.
      for (int kk : cells) { uint8_t m = E.L->grid[kk]; if (E.isPlantWood(m)) { c.woodCount++; if (c.plantType == PT_OAK) c.plantType = E.plantTypeFromWood(m); } else if (E.isPlantLeaf(m)) c.leafCount++; }
      c.cells = std::move(cells); E.L->plantComponents.push_back(std::move(c));
    }
  }
  // ICE group (unbounded).
  {
    int32_t gen = ++E.L->seenGen;
    for (auto& comp : E.L->iceComponents) for (int k : comp.cells) seen[k] = gen;
    for (int k : E.L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || MAT_CGROUP[E.L->grid[k]] != CG_ICE) continue;
      std::vector<int> cells; int yMax;
      floodComponent(sx, sy, seen, gen, false, cells, yMax, &ComponentSystem::isIceGroup);
      Comp c; c.id = E.L->nextIceId++; c.cells = std::move(cells); c.yMax = yMax; c.cacheDirty = true; E.L->iceComponents.push_back(std::move(c));
    }
  }
}

void ComponentSystem::registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) {
  if (cells.empty()) return;
  E.L->groundDirty = true; // adds rigid cells (lava harden / tool placement) -> full reflood
  // Find which existing components the new cells touch. Comp.cells is a vector
  // now, so a linear .count() per neighbor would be O(cells * comps * size); use
  // a cell->component-index stamp map built LAZILY (only once a same-material
  // neighbor actually exists), keeping the common "placed in open space" case cheap.
  // (`touchingIds` and the maps are membership-only; merge order comes from
  // iterating `list` below, so the swap to stamps is order-neutral.)
  const size_t gridLen = (size_t)(E.cols * E.rows);
  regCells.reset(gridLen);
  for (int k : cells) regCells.add(k);
  std::unordered_set<int> touchingIds;
  bool ownerBuilt = false;
  for (int k : cells) {
    int y = k / E.cols, x = k - y * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx;
      if (E.L->grid[nk] != mat || regCells.has(nk)) continue;
      if (!ownerBuilt) {
        regOwnerStamp.reset(gridLen);
        if (regOwnerVal.size() < gridLen) regOwnerVal.resize(gridLen);
        for (size_t i = 0; i < list.size(); i++) for (int c : list[i].cells) { regOwnerStamp.add(c); regOwnerVal[c] = (int32_t)i; }
        ownerBuilt = true;
      }
      if (regOwnerStamp.has(nk)) touchingIds.insert(list[regOwnerVal[nk]].id);
    }
  }
  Comp newComp; newComp.id = nextId++; newComp.cells.assign(cells.begin(), cells.end()); newComp.yMax = yMax; newComp.cacheDirty = iceCache;
  if (!touchingIds.empty()) {
    std::vector<Comp> keep;
    for (auto& comp : list) {
      if (touchingIds.count(comp.id)) { for (int k : comp.cells) { newComp.cells.push_back(k); int y = k / E.cols; if (y > newComp.yMax) newComp.yMax = y; } }
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
void ComponentSystem::registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax) {
  registerRigidCells(E.L->plantComponents, E.L->nextPlantId, mat, cells, yMax, false);
  Comp& c = E.L->plantComponents.back();
  c.woodCount = 0; c.leafCount = 0; c.age = 0; c.growing = false; c.cacheDirty = true; c.plantType = PT_OAK;
  for (int k : c.cells) { uint8_t m = E.L->grid[k]; if (E.isPlantWood(m)) { c.woodCount++; if (c.plantType == PT_OAK) c.plantType = E.plantTypeFromWood(m); } else if (E.isPlantLeaf(m)) c.leafCount++; }
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
void ComponentSystem::registerRigidCellsSplit(std::vector<Comp>& list, int& nextId, uint8_t mat,
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
      group.insert(k); int y = k / E.cols, x = k - y * E.cols; if (y > yMax) yMax = y;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx; auto it = remaining.find(nk);
        if (it != remaining.end()) { remaining.erase(it); stack.push_back(nk); }
      }
    }
    registerRigidCells(list, nextId, mat, group, yMax, iceCache);
  }
}

// split a plant-family component list keeping only cells still of plant material
bool ComponentSystem::componentRemovalLocallyConnected(const std::vector<int>& erased, const std::vector<int>& survivors, int indexedComp) {
  if (erased.empty() || survivors.empty()) return false;
  const int SPAN = 128, MARGIN = 8, CAP = 8000;
  if (indexedComp < 0) {
    splitMembers.reset((size_t)E.cols * E.rows);
    for (int k : survivors) splitMembers.add(k);
  }
  auto isMember = [&](int k) {
    return indexedComp >= 0
      ? E.L->cellComp[k] == indexedComp && E.isComponentMaterial(E.L->grid[k])
      : splitMembers.has(k);
  };
  int32_t present = ++E.L->seenGen;
  for (int k : erased) E.L->seenStamp[k] = present;
  int32_t taken = ++E.L->seenGen;
  for (int seed : erased) {
    if (E.L->seenStamp[seed] != present) continue;
    splitBlob.clear();
    int qh = 0, qt = 0;
    E.L->groundStack[qt++] = seed; E.L->seenStamp[seed] = taken;
    int bx0 = E.cols, by0 = E.rows, bx1 = -1, by1 = -1;
    while (qh < qt) {
      int cur = E.L->groundStack[qh++]; splitBlob.push_back(cur);
      int cy = cur / E.cols, cx = cur - cy * E.cols;
      bx0 = imin(bx0, cx); bx1 = imax(bx1, cx); by0 = imin(by0, cy); by1 = imax(by1, cy);
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = cx + ox, ny = cy + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx;
        if (E.L->seenStamp[nk] == present) { E.L->seenStamp[nk] = taken; E.L->groundStack[qt++] = nk; }
      }
    }
    if (bx1 - bx0 > SPAN || by1 - by0 > SPAN) return false;
    int32_t boundaryGen = ++E.L->seenGen;
    splitBoundary.clear();
    for (int cur : splitBlob) {
      int cy = cur / E.cols, cx = cur - cy * E.cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = cx + ox, ny = cy + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx;
        if (isMember(nk) && E.L->seenStamp[nk] != boundaryGen) {
          E.L->seenStamp[nk] = boundaryGen; splitBoundary.push_back(nk);
        }
      }
    }
    if (splitBoundary.size() <= 1) continue;
    int x0 = imax(0, bx0 - MARGIN), x1 = imin(E.cols - 1, bx1 + MARGIN);
    int y0 = imax(0, by0 - MARGIN), y1 = imin(E.rows - 1, by1 + MARGIN);
    int32_t visited = ++E.L->seenGen;
    qh = 0; qt = 0;
    int found = 1, need = (int)splitBoundary.size();
    E.L->groundStack[qt++] = splitBoundary[0]; E.L->seenStamp[splitBoundary[0]] = visited;
    while (qh < qt && found < need) {
      if (qt >= CAP) return false;
      int cur = E.L->groundStack[qh++]; int cy = cur / E.cols, cx = cur - cy * E.cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = cx + ox, ny = cy + oy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        int nk = ny * E.cols + nx;
        if (!isMember(nk) || E.L->seenStamp[nk] == visited) continue;
        if (E.L->seenStamp[nk] == boundaryGen) found++;
        E.L->seenStamp[nk] = visited; E.L->groundStack[qt++] = nk;
      }
    }
    if (found != need) return false;
  }
  return true;
}

void ComponentSystem::splitPlantAfterErase(std::vector<int>* erased, int indexedOffset, bool markGroundDirty, bool localConnectivityFastPath, bool deferJointRefresh) {
  // Dirty joints for the NEXT step, but leave jointGroundReady set: clearing it
  // mid-step lets the other layer's stepLayer re-run single-layer grounding and
  // drop cross-supported stone before this tick finishes (acid often transfers
  // to the opposite layer and dissolves there first).
  if (E.bgEnabled) {
    if (deferJointRefresh) jointDirtyDeferred = true;
    else { jointBondsInvalid = true; jointDirty = true; }
  }
  if (markGroundDirty) E.L->groundDirty = true;
  std::vector<Comp> updated;
  std::vector<int32_t>& seen = E.L->seenStamp;
  std::vector<int> part;
  std::vector<uint8_t>& touchedByIndex = splitTouched;
  touchedByIndex.clear();
  if (erased && indexedOffset >= 0) {
    touchedByIndex.assign(E.L->plantComponents.size(), 0);
    for (int k : *erased) {
      int ci = E.L->cellComp[k] - indexedOffset;
      if (ci < 0 || ci >= (int)E.L->plantComponents.size()) { touchedByIndex.clear(); break; }
      touchedByIndex[ci] = 1;
    }
  }
  updated.reserve(E.L->plantComponents.size() + (erased ? erased->size() : 0));
  for (size_t compIndex = 0; compIndex < E.L->plantComponents.size(); compIndex++) {
    auto& comp = E.L->plantComponents[compIndex];
    if (!touchedByIndex.empty() && !touchedByIndex[compIndex]) { updated.push_back(std::move(comp)); continue; }
    if (localConnectivityFastPath && erased) {
      splitSurvivors.clear(); splitErased.clear();
      for (int k : comp.cells) {
        if (E.isPlantMaterial(E.L->grid[k])) splitSurvivors.push_back(k);
        else splitErased.push_back(k);
      }
      if (splitErased.empty()) { updated.push_back(std::move(comp)); continue; }
      if (comp.grounded && componentRemovalLocallyConnected(splitErased, splitSurvivors,
                                                             indexedOffset >= 0 ? indexedOffset + (int)compIndex : -1)) {
        comp.cells.swap(splitSurvivors); comp.yMax = comp.woodCount = comp.leafCount = 0; comp.cacheDirty = true;
        for (int k : comp.cells) { int y = k / E.cols; comp.yMax = imax(comp.yMax, y); if (E.isPlantWood(E.L->grid[k])) comp.woodCount++; else if (E.isPlantLeaf(E.L->grid[k])) comp.leafCount++; }
        updated.push_back(std::move(comp)); continue;
      }
      // The caller requested the cache-preserving path, but this component needs
      // a real rebuild. Even if it remains one piece, its positional metadata and
      // grounded flag must be refreshed before the cache can be reused.
      E.L->compsReshaped = true;
    }
    int32_t remGen = ++E.L->seenGen;
    for (int k : comp.cells) if (E.isPlantMaterial(E.L->grid[k])) seen[k] = remGen;
    bool reused = false;
    for (int seed : comp.cells) {
      if (seen[seed] != remGen) continue;
      part.clear(); part.push_back(seed); seen[seed] = 0; // part doubles as the BFS queue; seen[] dedups
      for (size_t qi = 0; qi < part.size(); qi++) {
        int cur = part[qi]; int y = cur / E.cols, x = cur - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx; if (seen[nk] == remGen) { seen[nk] = 0; part.push_back(nk); } }
      }
      if (reused) E.L->compsReshaped = true;
      Comp c; c.id = reused ? E.L->nextPlantId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
      c.plantType = comp.plantType; c.growing = comp.growing; // a cut tree keeps species + growth on both halves
      for (int k : part) { int y = k / E.cols; if (y > c.yMax) c.yMax = y; if (E.isPlantWood(E.L->grid[k])) c.woodCount++; else if (E.isPlantLeaf(E.L->grid[k])) c.leafCount++; }
      c.cells = std::move(part); updated.push_back(std::move(c)); reused = true;
    }
    if (!reused) E.L->compsReshaped = true;
  }
  E.L->plantComponents = std::move(updated);
}

// Fire usually nibbles leaves or an exposed face without disconnecting any
// surviving support. Keep that common case local: split only components named
// by the exact cellComp index, prove the removed blobs are not cuts, patch the
// cached cells, and request only an index refresh. Acid retains its established
// split order; real cuts on either path retain the full grounding reflood.
void ComponentSystem::finishPlantErosion(std::vector<int>& erased, bool indexedExact, bool deferJointRefresh) {
  if (erased.empty()) return;
  int plantOffset = (int)E.L->stoneComponents.size();
  E.L->compsReshaped = false;
  splitPlantAfterErase(&erased, indexedExact ? plantOffset : -1, false, deferJointRefresh, deferJointRefresh);
  if (!indexedExact || !removalsKeepGroundingValid(erased)) {
    E.L->groundDirty = true;
    return;
  }
  for (int k : erased) E.L->cellComp[k] = -1;
  E.L->groundContentDirty = true;
}

// split stone/ice after erase: remove erased cells, re-flood
// markGroundDirty=true (the default, used by tools-erase and ice-melt) forces a
// full grounding reflood next pass. Acid passes false and instead runs its own
// cut-vertex check (noteAcidRemovals) to keep the grounding cache valid when a
// dissolve doesn't disconnect anything.
void ComponentSystem::splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache, bool markGroundDirty, int indexedOffset, bool localConnectivityFastPath) {
  // Dirty joints for the NEXT step when bg is live. Even acid pure-bore
  // (markGroundDirty=false) must force a recompute — but do NOT clear
  // jointGroundReady mid-step. step() grounds jointly, then stepLayer(fg) then
  // stepLayer(bg). Acid transferred into the first layer can dissolve there and
  // used to clear jointGroundReady before the second layer moved; that layer
  // then ran ensureGroundedSingleLayer (no cross-support) and crept down one
  // cell per dissolve until co-occupation was lost and it free-fell.
  if (E.bgEnabled && !erased.empty()) { jointBondsInvalid = true; jointDirty = true; }
  if (markGroundDirty && !erased.empty()) E.L->groundDirty = true;
  if (erased.empty() || list.empty()) return;
  std::vector<int32_t>& seen = E.L->seenStamp;
  splitRemovedSet.reset((size_t)E.cols * E.rows);
  for (int k : erased) splitRemovedSet.add(k);
  std::vector<uint8_t>& touchedByIndex = splitTouched;
  touchedByIndex.clear();
  if (indexedOffset >= 0) {
    touchedByIndex.assign(list.size(), 0);
    for (int k : erased) {
      int ci = E.L->cellComp[k] - indexedOffset;
      // A non-negative indexedOffset is the caller's guarantee that cellComp is
      // current. Stale reaction-time indexes use -1 and retain the full scan.
      if (ci < 0 || ci >= (int)list.size()) {
        touchedByIndex.clear(); break;
      }
      touchedByIndex[ci] = 1;
    }
  }
  std::vector<Comp>& updated = splitUpdated; updated.clear(); updated.reserve(list.size() + erased.size());
  std::vector<int>& survivors = splitSurvivors;
  std::vector<int>& part = splitPart;
  for (size_t compIndex = 0; compIndex < list.size(); compIndex++) {
    auto& comp = list[compIndex];
    if (!touchedByIndex.empty() && !touchedByIndex[compIndex]) { updated.push_back(std::move(comp)); continue; }
    bool touched = false;
    std::vector<int>& removedCells = splitErased;
    survivors.clear(); survivors.reserve(comp.cells.size()); removedCells.clear();
    for (int k : comp.cells) { if (splitRemovedSet.has(k)) { touched = true; removedCells.push_back(k); } else survivors.push_back(k); }
    if (!touched) { updated.push_back(std::move(comp)); continue; }
    if (survivors.empty()) { E.L->compsReshaped = true; continue; } // comp fully erased -> ids shift
    if (localConnectivityFastPath && comp.grounded && componentRemovalLocallyConnected(removedCells, survivors,
                                                                                       indexedOffset >= 0 ? indexedOffset + (int)compIndex : -1)) {
      comp.cells.swap(survivors); comp.yMax = 0; comp.cacheDirty = iceCache;
      for (int k : comp.cells) comp.yMax = imax(comp.yMax, k / E.cols);
      updated.push_back(std::move(comp)); continue;
    }
    if (localConnectivityFastPath) E.L->compsReshaped = true;
    int32_t remGen = ++E.L->seenGen;
    for (int k : survivors) seen[k] = remGen;
    bool reused = false;
    for (int start : survivors) {
      if (seen[start] != remGen) continue;
      part.clear(); part.push_back(start); seen[start] = 0; // part doubles as the BFS queue
      for (size_t qi = 0; qi < part.size(); qi++) {
        int cur = part[qi]; int y = cur / E.cols, x = cur - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx; if (seen[nk] == remGen) { seen[nk] = 0; part.push_back(nk); } }
      }
      if (reused) E.L->compsReshaped = true; // a 2nd+ surviving piece -> a split: ids shift
      Comp c; c.id = reused ? nextId++ : comp.id; c.yMax = 0; c.cacheDirty = iceCache;
      for (int k : part) { int y = k / E.cols; if (y > c.yMax) c.yMax = y; }
      c.cells = std::move(part); updated.push_back(std::move(c));
      reused = true;
    }
  }
  list.swap(updated);
  updated.clear();
}
