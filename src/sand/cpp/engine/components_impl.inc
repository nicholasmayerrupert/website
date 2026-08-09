// Stone, ice, and plant materials are not loose pixels. They survive a step
// only through component membership, and unregistered component cells are
// erased during cleanup. Tool placement, worldgen, growth, and world shifting
// should route component writes through this subsystem and then sync/register.
void ComponentSystem::prepareAssemblyScratch(size_t gridLen) {
  auto prepareStamp = [&](StampSet& set) {
    set.stamp.assign(gridLen, 0);
    set.gen = 0;
  };
  prepareStamp(asmCells);
  prepareStamp(detachVisited);
  prepareStamp(asmExterior);
  prepareStamp(asmOpenAir);
  asmExteriorValue.resize(gridLen);
  asmOpenAirValue.resize(gridLen);
  asmExteriorRegion.reserve((size_t)(E.cols + E.rows) * 4);
  asmAirFaces.reserve((size_t)(E.cols + E.rows) * 4);
  asmOpenAirPath.reserve((size_t)E.rows);
}

bool ComponentSystem::isKestrelFrameAnchor(const Layer& lay, int x, int y) const {
  if (E.planetId != PL_SHIP || !lay.isBackground) return false;
  int worldX = lay.worldOffsetX + x;
  int worldY = lay.worldOffsetY + y;
  return worldX >= -2 && worldX <= 2 && worldY >= -2 && worldY <= 2;
}

// Rebuild E.L->cellComp[] (cell -> component index) and the cgComps index.
// Shared by the full reflood (computeGrounded) and the incremental refresh
// (incrementalGroundingRefresh). Resets each Comp's grounded flag to false (the
// flood / refresh sets it back). Does NOT touch E.L->groundedCell[].
// O(total component cells).
void ComponentSystem::indexComponents() {
  double t0 = emscripten_get_now();
  Layer* const lay = E.L;
  int32_t* const cc = lay->cellComp.data();
  cgComps.clear();
  for (auto& component : lay->components) {
    component.grounded = component.cells.empty();
    int id = (int)cgComps.size();
    cgComps.push_back(&component);
    for (int k : component.cells) cc[k] = id;
  }
  lay->groundHasDirectedBoundaryComp = false;
  for (int x = 0; x < E.cols && !lay->groundHasDirectedBoundaryComp; x++)
    lay->groundHasDirectedBoundaryComp = cc[x] >= 0;
  for (int y = 1; y < E.rows && !lay->groundHasDirectedBoundaryComp; y++) {
    int k = y * E.cols;
    lay->groundHasDirectedBoundaryComp = cc[k] >= 0 || cc[k + E.cols - 1] >= 0;
  }
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
                && (E.isIceMaterial(lay->grid[rb + x]) || E.isIceMaterial(lay->grid[nk]))) continue;
            uint32_t lo = (uint32_t)(a < b ? a : b), hi = (uint32_t)(a < b ? b : a);
            out.push_back(((uint64_t)lo << 32) | hi);
          }
        }
      }
    };
    scanRect(lay->compAdjPairs, 0, 0, cols, rows);
    // Component ids are dense in [0, count). Two stable counting passes sort
    // (lo, hi) pairs in linear time; blast fronts generate many duplicate edge
    // samples, so comparison-sorting the raw list creates an avoidable spike.
    const size_t count = cgComps.size();
    const size_t pairCount = lay->compAdjPairs.size();
    cgAdjScratch.resize(pairCount);
    cgAdjCounts.assign(count + 1, 0);
    for (uint64_t packed : lay->compAdjPairs) cgAdjCounts[(uint32_t)packed + 1]++;
    for (size_t i = 1; i < cgAdjCounts.size(); i++) cgAdjCounts[i] += cgAdjCounts[i - 1];
    for (uint64_t packed : lay->compAdjPairs)
      cgAdjScratch[cgAdjCounts[(uint32_t)packed]++] = packed;
    cgAdjCounts.assign(count + 1, 0);
    for (uint64_t packed : cgAdjScratch) cgAdjCounts[(uint32_t)(packed >> 32) + 1]++;
    for (size_t i = 1; i < cgAdjCounts.size(); i++) cgAdjCounts[i] += cgAdjCounts[i - 1];
    for (uint64_t packed : cgAdjScratch)
      lay->compAdjPairs[cgAdjCounts[(uint32_t)(packed >> 32)]++] = packed;
    lay->compAdjPairs.erase(std::unique(lay->compAdjPairs.begin(), lay->compAdjPairs.end()), lay->compAdjPairs.end());
  }
  E.invalidateComponentIndexPatches(lay);
  lay->componentIndexExact = true;
  E.perfComponentIndexMs += emscripten_get_now() - t0;
}

bool ComponentSystem::patchComponentIndexAdditions() {
  Layer* const lay = E.L;
  if (!lay->componentIndexPatchOnly || lay->componentIndexPatches.empty()
      || !lay->groundBaseValid
      || lay->groundBaseFlags.size() != lay->components.size()) return false;
  int32_t* const cc = lay->cellComp.data();
  for (const auto& patch : lay->componentIndexPatches) {
    int componentIndex = patch.first;
    int k = patch.second;
    if (componentIndex < 0 || componentIndex >= (int)lay->components.size()
        || k < 0 || k >= E.cols * E.rows
        || !E.isComponentMaterial(lay->grid[k])) return false;
    cc[k] = componentIndex;
  }
  for (const auto& patch : lay->componentIndexPatches) {
    int a = patch.first, k = patch.second;
    int y = k / E.cols, x = k - y * E.cols;
    if (y == 0 || x == 0 || x == E.cols - 1)
      lay->groundHasDirectedBoundaryComp = true;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = x + ox, ny = y + oy;
      if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
      int nk = ny * E.cols + nx;
      int b = cc[nk];
      if (b < 0 || b == a) continue;
      if (lay->infinite && (x == 0 || x == E.cols - 1
                            || nx == 0 || nx == E.cols - 1)
          && (E.isIceMaterial(lay->grid[k])
              || E.isIceMaterial(lay->grid[nk]))) continue;
      uint32_t lo = (uint32_t)(a < b ? a : b);
      uint32_t hi = (uint32_t)(a < b ? b : a);
      uint64_t edge = ((uint64_t)lo << 32) | hi;
      auto it = std::lower_bound(lay->compAdjPairs.begin(),
                                 lay->compAdjPairs.end(), edge);
      if (it == lay->compAdjPairs.end() || *it != edge)
        lay->compAdjPairs.insert(it, edge);
    }
  }
  lay->componentIndexExact = true;
  return true;
}

// Static rigid support is connectivity over the component contact graph.
// Component membership already proves connectivity inside each node, while
// compAdjPairs records every same-layer 8-neighbour contact between nodes.
// Resolve seeded graph roots, then stamp only the resulting component members.
// Free bodies and directed-boundary component sets use the conservative cell
// flood below.
void ComponentSystem::computeStaticGraphGrounded() {
  Layer* const lay = E.L;
  const int count = (int)cgComps.size();
  if (count == 0) return;

  std::vector<int>& parent = cgParent;
  parent.resize(count);
  for (int i = 0; i < count; i++) parent[i] = i;
  for (uint64_t packed : lay->compAdjPairs) {
    int a = (int)(packed >> 32), b = (int)(uint32_t)packed;
    if (a >= 0 && b >= 0 && a < count && b < count) ufUnite(parent, a, b);
  }

  cgVisited.assign(count, 0);
  const int32_t* const cc = lay->cellComp.data();
  const uint8_t* const g = lay->grid;
  auto seedAt = [&](int k) {
    int id = cc[k];
    if (id >= 0 && id < count) cgVisited[ufFind(parent, id)] = 1;
  };

  const int floorBase = (E.rows - 1) * E.cols;
  for (int x = 0; x < E.cols; x++) {
    int k = floorBase + x;
    if (isGroundingRigidCell(*lay, k) && E.isBearingMaterial(g[k])) seedAt(k);
  }
  if (lay->infinite) {
    for (int y = 1; y < E.rows; y++) {
      int kl = y * E.cols + 1;
      int kr = y * E.cols + (E.cols - 2);
      if (isGroundingRigidCell(*lay, kl) && !E.isIceMaterial(g[kl])) seedAt(kl);
      if (isGroundingRigidCell(*lay, kr) && !E.isIceMaterial(g[kr])) seedAt(kr);
    }
    const int topBase = E.cols;
    const int topWorldY = lay->worldOffsetY;
    const bool topMayBeSky = topWorldY < lay->gSeaRow;
    for (int x = 1; x < E.cols - 1; x++) {
      int k = topBase + x;
      if (!isGroundingRigidCell(*lay, k) || E.isIceMaterial(g[k])) continue;
      bool openSkyLeaf = E.isPlantLeaf(g[k]) && topMayBeSky
                      && topWorldY < E.terrain.genSurfaceAbs(lay->worldOffsetX + x);
      if (!openSkyLeaf) seedAt(k);
    }
  }
  for (int worldY = -2; worldY <= 2; worldY++) {
    int y = worldY - lay->worldOffsetY;
    if (y < 0 || y >= E.rows) continue;
    for (int worldX = -2; worldX <= 2; worldX++) {
      int x = worldX - lay->worldOffsetX;
      if (x < 0 || x >= E.cols) continue;
      int k = y * E.cols + x;
      if (isKestrelFrameAnchor(*lay, x, y) && isGroundingRigidCell(*lay, k))
        seedAt(k);
    }
  }

  uint8_t* const grounded = lay->groundedCell.data();
  for (int i = 0; i < count; i++) {
    Comp* c = cgComps[i];
    c->grounded = c->cells.empty() || cgVisited[ufFind(parent, i)] != 0;
    if (c->grounded)
      for (int k : c->cells) grounded[k] = 1;
  }
}

// Grounding is SEPARABLE (this is what makes the rigid part cacheable):
//  - RIGID grounding never flows through loose cells: the vertical rule refuses
//    loose-below -> rigid-above, and 8-adjacency requires rigid on both ends.
//    So the rigid grounded-set depends ONLY on rigid cells + structural seeds.
//  - LOOSE grounding is strictly vertical: a loose cell is grounded iff the
//    cell directly below it is grounded (any class), or it sits on the floor
//    row, or on denser liquid. No loose cell grounds sideways.
// computeGrounded combines computeRigidGrounded with applyLooseOverlay.
bool ComponentSystem::isGroundingRigidCell(const Layer& lay, int k) const {
  if (!E.isRigidMaterialClass(lay.grid[k])) return false;
  // Free bodies support other bodies through the contact solver, but they are
  // not anchors for static terrain. A component resting on a detached body is
  // itself detached and must enter the rigid-body system.
  return lay.bodyOwner[k] < 0;
}
void ComponentSystem::computeRigidGrounded(bool reuseComponentIndex) {
  // Keep hot buffers local so the compiler can preserve alias information.
  Layer* const lay = E.L;
  const uint8_t* const g = lay->grid;
  uint8_t* const grounded = lay->groundedCell.data();
  int32_t* const cc = lay->cellComp.data();
  int32_t* const gstack = lay->groundStack.data();
  // Streaming markers are diagnostic only. Edge support is buffer-relative, so
  // every rigid flood starts from zero rather than trusting a shifted cache.
  (void)lay->groundStreamX0; (void)lay->groundStreamY0;
  lay->groundStreamX0 = lay->groundStreamX1 = lay->groundStreamY0 = lay->groundStreamY1 = -1;
  std::fill(lay->groundedCell.begin(), lay->groundedCell.end(), (uint8_t)0);
  if (!reuseComponentIndex) {
    std::fill(lay->cellComp.begin(), lay->cellComp.end(), -1);
    indexComponents();
  } else {
    // Structurally bearing free-body stamps participate in the grounding flood
    // but never belong to static components. When only their occupancy changed,
    // cellComp and the component adjacency cache remain exact; just rebind the
    // layer-local Comp* view and reset flags instead of rescanning every static
    // cell. Body-owned blast rubble is ignored by the flood.
    cgComps.clear();
    for (auto& component : lay->components) {
      component.grounded = component.cells.empty();
      cgComps.push_back(&component);
    }
  }
  if (groundStackX.size() != (size_t)E.cols * E.rows)
    groundStackX.assign((size_t)E.cols * E.rows, 0);
  bool hasActiveGrowth = lay->myceliumActive;
  if (!hasActiveGrowth)
    for (const Comp& component : lay->components)
      if (component.growing) { hasActiveGrowth = true; break; }
  if (!groundForceFull && !hasActiveGrowth
      && !lay->groundHasDirectedBoundaryComp) {
    computeStaticGraphGrounded();
    return;
  }
  int sp = 0;
  int32_t* gsx = groundStackX.data();
  // Carry x alongside k to avoid division in the flood loop.
  auto groundRigidAt = [&](int k, int x) {
    if (grounded[k]) return;
    grounded[k] = 1;
    int id = cc[k];
    if (id >= 0) cgComps[id]->grounded = true;
    gsx[sp] = x; gstack[sp++] = k;
  };
  int floorBase = (E.rows - 1) * E.cols;
  for (int x = 0; x < E.cols; x++) { int k = floorBase + x; if (isGroundingRigidCell(*lay, k) && E.isBearingMaterial(g[k])) groundRigidAt(k, x); }
  // Streamed-edge support: in the infinite world the left/right/top buffer edges abut
  // UNLOADED world that may itself be grounded. A non-ice rigid cell touching such an
  // edge is assumed supported, so terrain whose real floor-contact has streamed off
  // the buffer does not spuriously fall. Preserve that support for structures,
  // including plant-family wood. Only foliage at a top edge known to be open sky is
  // excluded: sky cannot support a clipped worldgen crown, and seeding those leaves
  // pins its visible outline while the rest of the tree falls. Ice must remain mobile:
  // large icebergs often span a loaded-window edge, and grounding the edge cell
  // disables buoyancy for the whole connected iceberg (even after most of it is
  // erased).
  if (lay->infinite) {
    for (int y = 1; y < E.rows; y++) {
      int kl = y * E.cols + 1;          if (isGroundingRigidCell(*lay, kl) && !E.isIceMaterial(g[kl])) groundRigidAt(kl, 1);
      int kr = y * E.cols + (E.cols - 2); if (isGroundingRigidCell(*lay, kr) && !E.isIceMaterial(g[kr])) groundRigidAt(kr, E.cols - 2);
    }
    int topBase = E.cols; // row y = 1
    int topWorldY = lay->worldOffsetY;
    bool topMayBeSky = topWorldY < lay->gSeaRow;
    for (int x = 1; x < E.cols - 1; x++) {
      int k = topBase + x;
      if (!isGroundingRigidCell(*lay, k) || E.isIceMaterial(g[k])) continue;
      if (!E.isPlantLeaf(g[k])) { groundRigidAt(k, x); continue; }
      bool openSky = topMayBeSky
                  && topWorldY < E.terrain.genSurfaceAbs(lay->worldOffsetX + x);
      if (!openSky) groundRigidAt(k, x);
    }
  }
  for (int worldY = -2; worldY <= 2; worldY++) {
    int y = worldY - lay->worldOffsetY;
    if (y < 0 || y >= E.rows) continue;
    for (int worldX = -2; worldX <= 2; worldX++) {
      int x = worldX - lay->worldOffsetX;
      if (x < 0 || x >= E.cols) continue;
      int k = y * E.cols + x;
      if (isKestrelFrameAnchor(*lay, x, y) && isGroundingRigidCell(*lay, k))
        groundRigidAt(k, x);
    }
  }
  int gridLen = E.cols * E.rows;
  while (sp > 0) {
    --sp; int k = gstack[sp], kx = gsx[sp];
    // Handle vertical support in sentinel columns, which the clamped neighbour
    // scan excludes. Hanging materials are not bearing.
    int above = k - E.cols;
    if (above >= 0 && !grounded[above] && isGroundingRigidCell(*lay, above) && E.isBearingMaterial(g[above])) groundRigidAt(above, kx);
    // Validate neighbour rows without dividing k by E.cols.
    for (int oy = -1; oy <= 1; oy++) {
      int rb = k + oy * E.cols;
      if (rb < E.cols || rb >= gridLen) continue;
      for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = kx + ox; if (nx <= 0 || nx >= E.cols - 1) continue;
        int nk = rb + ox;
        // x=0/cols-1 are artificial infinite-world sentinel walls. They keep
        // media in the loaded window, but must not anchor an adjacent iceberg.
        if (lay->infinite && (kx == 0 || kx == E.cols - 1) && E.isIceMaterial(g[nk])) continue;
        if (!grounded[nk] && isGroundingRigidCell(*lay, nk)) groundRigidAt(nk, nx);
      }
    }
  }
}
// Ground the loose (powder) cells on top of the rigid base: one bottom-up pass.
// A loose cell is grounded iff the cell DIRECTLY below is grounded (chain roots
// on grounded rigid, the floor, or lower loose links), or it is on the floor
// row, or it rests on liquid at least as dense (the buoyant-support seed).
// Loose cells never receive sideways/8-adjacent support and never ground a
// rigid cell. Also records whether the interior contains powder.
//
// Pure loose-only refreshes can restrict the pass to dirty columns.
void ComponentSystem::applyLooseOverlay() {
  Layer* const lay = E.L;
  const uint8_t* const g = lay->grid;
  uint8_t* const grounded = lay->groundedCell.data();
  bool sawPowder = false;
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
        sawPowder = true;
      }
      bool gnd = grounded[k + cols] != 0;
      if (!gnd && interior) {
        uint8_t below = g[k + cols];
        gnd = E.isLiquidMaterial(below) && DENSITY[below] >= DENSITY[g[k]];
      }
      if (gnd) grounded[k] = 1;
    }
  };
  if (useBits) {
    for (int x = 0; x < cols; x++) if (lay->looseDirtyCol[x]) overlayCol(x);
  } else {
    for (int x = x0; x <= x1; x++) overlayCol(x);
  }
  lay->groundSawPowder = sawPowder;
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
      // Keep static rigid joint patches exactly as stamped. A body's rigid
      // material can cover a formerly-grounded loose cell, so body-owned cells
      // must also start from zero.
      if (!E.isRigidMaterialClass(g[k]) || lay->bodyOwner[k] >= 0) grounded[k] = 0;
    }
  };
  int x0 = 0, x1 = cols - 1;
  if (!useBits && lay->looseDirtyX1 >= lay->looseDirtyX0) {
    x0 = lay->looseDirtyX0 < 0 ? 0 : lay->looseDirtyX0;
    x1 = lay->looseDirtyX1 >= cols ? cols - 1 : lay->looseDirtyX1;
  }
  if (useBits) {
    for (int x = 0; x < cols; x++) if (lay->looseDirtyCol[x]) clearLooseCol(x);
  } else {
    for (int x = x0; x <= x1; x++) clearLooseCol(x);
  }
  applyLooseOverlay();
  lay->looseGroundDirty = false;
  lay->looseDirtyX0 = 0; lay->looseDirtyX1 = -1;
  lay->looseDirtyFull = false;
  if ((int)lay->looseDirtyCol.size() == cols)
    std::fill(lay->looseDirtyCol.begin(), lay->looseDirtyCol.end(), (uint8_t)0);
}

void ComponentSystem::normalizeDeferredConnectivity() {
  Layer* const lay = E.L;
  if (lay->deferredSplitIds.empty() && lay->componentTombstones == 0) return;
  lay->componentCarryDirty = true;
  lay->componentRegistryDirty = true;
  E.invalidateComponentIndexPatches(lay);
  auto normalize = [&](std::vector<Comp>& list, std::vector<int>& ids, int& nextId) {
    std::vector<Comp> updated;
    updated.reserve(list.size());
    for (auto& comp : list) {
      if (comp.cells.empty()) continue; // compact deferred empty positional slots
      if (std::find(ids.begin(), ids.end(), comp.id) == ids.end()) {
        updated.push_back(std::move(comp));
        continue;
      }
      splitRemovedSet.reset((size_t)E.cols * E.rows);
      for (int k : comp.cells)
        if (k >= 0 && k < E.cols * E.rows && E.isComponentMaterial(lay->grid[k]))
          splitRemovedSet.add(k);
      bool reused = false;
      for (int seed : comp.cells) {
        if (!splitRemovedSet.has(seed)) continue;
        splitPart.clear(); splitPart.push_back(seed); splitRemovedSet.remove(seed);
        for (size_t qi = 0; qi < splitPart.size(); qi++) {
          int cur = splitPart[qi], y = cur / E.cols, x = cur - y * E.cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            int nx = x + ox, ny = y + oy;
            if (!E.isInBounds(nx, ny)) continue;
            int nk = ny * E.cols + nx;
            if (splitRemovedSet.has(nk)) {
              splitRemovedSet.remove(nk);
              splitPart.push_back(nk);
            }
          }
        }
        Comp c;
        c.id = reused ? nextId++ : comp.id;
        c.plantType = comp.plantType; c.age = comp.age; c.growing = comp.growing;
        c.bakedAssemblyId = comp.bakedAssemblyId;
        c.cacheDirty = comp.cacheDirty;
        c.cells = splitPart; c.yMax = 0;
        bool plant = false, hasSeed = false;
        for (int k : c.cells) {
          c.yMax = imax(c.yMax, k / E.cols);
          uint8_t material = lay->grid[k];
          plant = plant || E.isPlantMaterial(material);
          hasSeed = hasSeed || E.isSeedMaterial(material);
          if (E.isPlantWood(material)) c.woodCount++;
          else if (E.isPlantLeaf(material)) c.leafCount++;
        }
        if (plant) c.growing = hasSeed;
        updated.push_back(std::move(c));
        reused = true;
      }
    }
    list.swap(updated);
    ids.clear();
  };
  normalize(lay->components, lay->deferredSplitIds, lay->nextComponentId);
  lay->componentTombstones = 0;
}

void ComponentSystem::computeGrounded() {
  Layer* const lay = E.L;
  // Deferred pieces are equivalent only while the global topology remains
  // proven unchanged. A real rigid reflood is the exact point where that proof
  // expires, so normalize the few tagged logical components before re-indexing.
  if (lay->groundDirty) normalizeDeferredConnectivity();
  size_t totalComps = lay->components.size();
  // Fully stable: rigid base + last loose overlay still match the live grid.
  // Powder's mere presence does NOT force a pass — only looseGroundDirty (a
  // powder/liquid write since the last successful overlay) does.
  if (!groundForceFull && lay->componentIndexExact
      && lay->groundBaseValid && !lay->groundDirty && !lay->groundContentDirty
      && !lay->looseGroundDirty && lay->groundBaseFlags.size() == totalComps) {
    return;
  }
  // Reuse the rigid base when no rigid mutation is pending. The loose overlay
  // is the only liquid-dependent part, so it is recomputed when loose moved;
  // the rigid flood + indexComponents are skipped. Bodies stamp rigid material
  // into the grid without routing through rigid dirty hooks. Body-owned cells
  // are excluded from the static graph, so their motion leaves this base valid.
  bool reuse = !groundForceFull && lay->componentIndexExact
               && lay->groundBaseValid && !lay->groundDirty
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
      for (auto& component : lay->components)
        lay->groundBaseFlags.push_back(component.grounded ? 1 : 0);
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
      for (auto& component : lay->components)
        component.grounded = lay->groundBaseFlags[i++] != 0;
      uint8_t* const grounded = lay->groundedCell.data();
      const uint8_t* const base = lay->groundRigidBase.data();
      for (auto& component : lay->components)
        if (!component.grounded)
          for (int k : component.cells) grounded[k] = 0;
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
      for (auto& component : lay->components)
        component.grounded = lay->groundBaseFlags[i++] != 0;
      lay->looseDirtyFull = true;
      lay->looseDirtyX0 = 0; lay->looseDirtyX1 = E.cols - 1;
    }
    lay->groundBaseReplay = false;
  } else {
    bool patchedComponentIndex = !groundForceFull && lay->groundDirty
      && !lay->groundContentDirty && patchComponentIndexAdditions();
    bool componentIndexExact = patchedComponentIndex
      || (!groundForceFull && lay->componentIndexExact
          && lay->groundBaseFlags.size() == totalComps);
    computeRigidGrounded(componentIndexExact);
    lay->groundRigidBase.assign(lay->groundedCell.begin(), lay->groundedCell.end());
    lay->groundBaseFlags.clear();
    for (auto& component : lay->components)
      lay->groundBaseFlags.push_back(component.grounded ? 1 : 0);
    lay->groundBaseValid = true;
    lay->groundDirty = false;
    lay->groundContentDirty = false;
    E.invalidateComponentIndexPatches(lay);
    lay->componentIndexExact = true;
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
  E.refreshMobileComponentRegistry(lay);
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
    for (auto& component : lay->components)
      nuFlags.push_back(component.grounded ? 1 : 0);
    std::fill(lay->cellComp.begin(), lay->cellComp.end(), -1);
    indexComponents(); // fresh cgComps/cellComp for THIS layer (cached passes leave them stale)
    for (size_t i2 = 0, n2 = (size_t)E.cols * E.rows; i2 < n2; i2++) {
      if (nuCC[i2] != lay->cellComp[i2]) { emscripten_console_error("GROUND CACHE PARITY: cellComp mismatch"); abort(); }
    }
    uint8_t* const grounded = lay->groundedCell.data();
    int32_t* const cc = lay->cellComp.data();
    int32_t* const gstack = lay->groundStack.data();
    std::fill(lay->groundedCell.begin(), lay->groundedCell.end(), (uint8_t)0);
    for (Comp* c : cgComps) c->grounded = c->cells.empty();
    auto canGroundAbove = [&](int below, int above) {
      uint8_t upper = g[above];
      if (!E.isBearingMaterial(upper)) return false;
      if (E.isRigidMaterialClass(upper) && !isGroundingRigidCell(*lay, above)) return false;
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
    for (int x = 0; x < E.cols; x++) {
      int k = floorBase + x;
      if (E.isBearingMaterial(g[k]) && (!E.isRigidMaterialClass(g[k]) || isGroundingRigidCell(*lay, k))) groundCellAt(k, x);
    }
    if (lay->infinite) {
      for (int y = 1; y < E.rows; y++) {
        int kl = y * E.cols + 1;          if (isGroundingRigidCell(*lay, kl) && !E.isIceMaterial(g[kl])) groundCellAt(kl, 1);
        int kr = y * E.cols + (E.cols - 2); if (isGroundingRigidCell(*lay, kr) && !E.isIceMaterial(g[kr])) groundCellAt(kr, E.cols - 2);
      }
      int topBase = E.cols;
      int topWorldY = lay->worldOffsetY;
      bool topMayBeSky = topWorldY < lay->gSeaRow;
      for (int x = 1; x < E.cols - 1; x++) {
        int k = topBase + x;
        if (!isGroundingRigidCell(*lay, k) || E.isIceMaterial(g[k])) continue;
        bool openSkyLeaf = E.isPlantLeaf(g[k]) && topMayBeSky
                        && topWorldY < E.terrain.genSurfaceAbs(lay->worldOffsetX + x);
        if (!openSkyLeaf) groundCellAt(k, x);
      }
    }
    for (int worldY = -2; worldY <= 2; worldY++) {
      int y = worldY - lay->worldOffsetY;
      if (y < 0 || y >= E.rows) continue;
      for (int worldX = -2; worldX <= 2; worldX++) {
        int x = worldX - lay->worldOffsetX;
        if (x < 0 || x >= E.cols) continue;
        int k = y * E.cols + x;
        if (isKestrelFrameAnchor(*lay, x, y)
            && isGroundingRigidCell(*lay, k)) groundCellAt(k, x);
      }
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
      if (isGroundingRigidCell(*lay, k)) {
        for (int oy = -1; oy <= 1; oy++) {
          int rb = k + oy * E.cols;
          if (rb < E.cols || rb >= gridLen) continue;
          for (int ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            int nx = kx + ox; if (nx <= 0 || nx >= E.cols - 1) continue;
            int nk = rb + ox;
            if (lay->infinite && (kx == 0 || kx == E.cols - 1) && E.isIceMaterial(g[nk])) continue;
            if (!grounded[nk] && isGroundingRigidCell(*lay, nk)) groundCellAt(nk, nx);
          }
        }
      }
    }
    for (int k = 0; k < gridLen; k++) {
      if (nu[k] != grounded[k]) {
        char buf[160];
        snprintf(buf, sizeof(buf), "GROUND SPLIT PARITY: k=%d (x=%d,y=%d) mat=%d split=%d ref=%d",
                 k, k % E.cols, k / E.cols, (int)g[k], (int)nu[k], (int)grounded[k]);
        emscripten_console_error(buf);
        abort();
      }
    }
    for (size_t i = 0; i < cgComps.size(); i++) {
      if (nuFlags[i] != (cgComps[i]->grounded ? 1 : 0)) {
        Comp* c = cgComps[i];
        int sample = c->cells.empty() ? -1 : c->cells[0];
        char buf[200];
        snprintf(buf, sizeof(buf),
                 "GROUND SPLIT PARITY: comp=%d cells=%d sample=%d (x=%d,y=%d) graph=%d ref=%d",
                 (int)i, (int)c->cells.size(), sample,
                 sample < 0 ? -1 : sample % E.cols, sample < 0 ? -1 : sample / E.cols,
                 (int)nuFlags[i], c->grounded ? 1 : 0);
        emscripten_console_error(buf);
        abort();
      }
    }
  }
#endif
}

// Rebuild component bookkeeping after a removal that preserved cached grounding.
void ComponentSystem::incrementalGroundingRefresh() {
  if (E.L->componentIndexExact && !E.L->compsReshaped
      && E.L->groundBaseFlags.size() == E.L->components.size()) {
    cgComps.clear();
    for (size_t i = 0; i < E.L->components.size(); i++) {
      Comp& component = E.L->components[i];
      component.grounded = E.L->groundBaseFlags[i] != 0;
      cgComps.push_back(&component);
    }
    return;
  }
  std::fill(E.L->cellComp.begin(), E.L->cellComp.end(), -1);
  indexComponents();                       // rebuilds E.L->cellComp and resets grounded=false
  for (Comp* c : cgComps) {                // a connected component is grounded iff ANY of its cells is
    for (int k : c->cells) if (E.L->groundedCell[k]) { c->grounded = true; break; }
  }
  E.L->compsReshaped = false;
}

// Single-layer dispatch. Debug verification compares the selected path with a
// forced full flood.
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
  bool priorForceFull = groundForceFull;
  groundForceFull = true;
  computeGrounded(); // the trusted cell-flood reference; leaves the live arrays correct
  groundForceFull = priorForceFull;
  for (size_t i = 0, n = (size_t)E.cols * E.rows; i < n; i++) {
    if (gvGrounded[i] != E.L->groundedCell[i] || gvCellComp[i] != E.L->cellComp[i]) { groundMismatches++; break; }
  }
}

// Do all of the rigid cells in `boundary` (the surviving rigid neighbours of the
// removed blob) reconnect through static grounding cells within [x0,x1] x
// [y0,y1], without passing through `removedGen` or a free body? If so, the blob
// is not a cut: every path that used it reroutes through the reconnected boundary.
// A bounded window + visit cap keep it cheap; uncertainty forces a safe reflood.
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
    if (qt >= cap) { gbCutCap++; return false; }
    int cur = q[qh++]; int cy = cur / E.cols, cx = cur - cy * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = cx + ox, ny = cy + oy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      int nk = ny * E.cols + nx;
      int32_t s = E.L->seenStamp[nk];
      if (s == vis || s == removedGen) continue;
      if (!isGroundingRigidCell(*E.L, nk)) continue;
      if (s == inN && ++found == need) return true; // all boundary cells reconnected -> not a cut (early out)
      E.L->seenStamp[nk] = vis; q[qt++] = nk;
    }
  }
  if (found != need) gbCutOpen++;
  return found == need;
}

// Exact fallback for a bounded reconnect that ran out of open material rather
// than visit budget. Removing a blob can split its surviving boundary into
// several static regions without changing grounding when every formerly-grounded
// region still reaches a real base seed. Walk only those boundary regions and
// stop as soon as a floor/stream-edge/frame seed or an already-proven path is reached.
// Free bodies are neither paths nor seeds. A capped/uncertain search returns
// false and keeps the ordinary full reflood.
bool ComponentSystem::blobBoundaryRegionsStayGrounded(const std::vector<int>& boundary, int32_t removedGen) {
  const int gridLen = E.cols * E.rows;
  if ((int)E.L->groundRigidBase.size() != gridLen || boundary.empty()) return false;
  const int VISIT_CAP = 65536;
  int visits = 0;
  int32_t safe = ++E.L->seenGen;
  int* stack = E.L->groundStack.data();
  const uint8_t* grid = E.L->grid;
  // A same-layer region can be grounded only through a component whose support
  // comes from the other layer, so a live joint closure is the relevant prior.
  const uint8_t* prior = jointSupportValid
    ? E.L->groundedCell.data()
    : E.L->groundRigidBase.data();
  auto directSeed = [&](int k, int x, int y) {
    uint8_t m = grid[k];
    if (y == E.rows - 1 && isGroundingRigidCell(*E.L, k)
        && E.isBearingMaterial(m)) return true;
    if (isKestrelFrameAnchor(*E.L, x, y)
        && isGroundingRigidCell(*E.L, k)) return true;
    return E.L->infinite && !E.isIceMaterial(m)
      && (y == 1 || x == 1 || x == E.cols - 2);
  };
  for (int start : boundary) {
    if (E.L->seenStamp[start] == safe) continue;
    int32_t vis = ++E.L->seenGen;
    int sp = 0;
    bool reachedSeed = false;
    bool wasGrounded = false;
    cgIsland.clear();
    E.L->seenStamp[start] = vis;
    stack[sp++] = start;
    while (sp > 0) {
      if (++visits > VISIT_CAP) return false;
      int cur = stack[--sp];
      cgIsland.push_back(cur);
      int cy = cur / E.cols, cx = cur - cy * E.cols;
      if (prior[cur]) wasGrounded = true;
      if (directSeed(cur, cx, cy)) { reachedSeed = true; break; }
      for (int oy = -1; oy <= 1 && !reachedSeed; oy++) {
        int ny = cy + oy;
        if (ny < 1 || ny >= E.rows) continue;
        for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = cx + ox;
          if (nx <= 0 || nx >= E.cols - 1) continue;
          int nk = ny * E.cols + nx;
          int32_t stamp = E.L->seenStamp[nk];
          if (stamp == safe) { reachedSeed = true; break; }
          if (stamp == vis || stamp == removedGen
              || !isGroundingRigidCell(*E.L, nk)) continue;
          E.L->seenStamp[nk] = vis;
          stack[sp++] = nk;
        }
      }
    }
    if (!reachedSeed && wasGrounded) return false;
    // A seeded partial walk and an exhausted previously-ungrounded region are
    // both safe. Reuse the visited cells as terminals for later boundary starts.
    for (int k : cgIsland) E.L->seenStamp[k] = safe;
  }
  return true;
}

// Decide whether ONE 8-connected blob of just-removed rigid cells (grid already
// cleared at each) keeps the grounding cache valid. A removal changes another cell's
// grounding only by disconnecting it from a SEED (floor / streamed buffer edge /
// Kestrel frame / powder-on-dense-liquid). The blob is safe when it is (a) compact
// (small bbox) and clear of fixed seeds, (b) free of powder in its neighbourhood, and
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
    if (isKestrelFrameAnchor(*E.L, x, y)) return false;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 - bx0 > SPAN || by1 - by0 > SPAN) { gbSpan++; return false; }
  if (bx0 <= MARGIN || bx1 >= E.cols - 1 - MARGIN || by0 <= MARGIN || by1 >= E.rows - 1 - MARGIN) { gbEdge++; return false; }
  // Gather the blob's surviving static neighbours (deduped via the inN stamp);
  // bail on any nearby powder because its grounding rules are not modelled here.
  // Other removed components are already empty, and free bodies do not anchor
  // static terrain, so neither can pollute this blob's boundary.
  int32_t inN = ++E.L->seenGen;
  cgBlobN.clear();
  for (int r : blob) {
    int ry = r / E.cols, rx = r - ry * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nk = (ry + oy) * E.cols + (rx + ox);
      uint8_t m = E.L->grid[nk];
      if (E.isLooseSolidMaterial(m)) { gbPowder++; return false; }
      if (isGroundingRigidCell(*E.L, nk)
          && E.L->seenStamp[nk] != gen && E.L->seenStamp[nk] != inN) {
        E.L->seenStamp[nk] = inN;
        cgBlobN.push_back(nk);
      }
    }
  }
  if ((int)cgBlobN.size() > 1) {  // 0/1 external connection: the blob is a pendant, removing it disconnects nothing else
    int x0 = imax(1, bx0 - W), x1 = imin(E.cols - 2, bx1 + W);
    int y0 = imax(1, by0 - W), y1 = imin(E.rows - 2, by1 + W);
    long openBefore = gbCutOpen;
    if (!blobBoundaryReconnects(cgBlobN, inN, x0, y0, x1, y1, gen)) {
      if (gbCutOpen > openBefore && blobBoundaryRegionsStayGrounded(cgBlobN, gen)) gbCutOpen--;
      else { gbCut++; return false; }
    }
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

int ComponentSystem::compCount(Layer& lay) { return (int)lay.components.size(); }

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

// Produce one layer's independent grounding base. computeGrounded selects the
// cheapest valid cache tier; computeGroundedBoth adds joint support afterward.
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
  const uint8_t* gr = lay.groundedCell.data();
  auto wake = [&](int k) {
    E.markLayerCell(&lay, k);
  };
  // The support arrays contain bytes restricted to 0/1. Compare eight cells at
  // once, then resolve the rare 1->0 transitions against live component/body
  // membership. This preserves the exact per-cell wake semantics without
  // walking every member of every component on each joint grounding pass.
  constexpr uint64_t BYTE_LOW_BITS = 0x0101010101010101ull;
  const size_t n = (size_t)E.cols * E.rows;
  size_t base = 0;
  for (; base + sizeof(uint64_t) <= n; base += sizeof(uint64_t)) {
    uint64_t before, after;
    std::memcpy(&before, prev.data() + base, sizeof(before));
    std::memcpy(&after, gr + base, sizeof(after));
    uint64_t lost = before & ~after & BYTE_LOW_BITS;
    while (lost) {
      int byte = __builtin_ctzll(lost) >> 3;
      int k = (int)base + byte;
      if (lay.cellComp[k] >= 0 || lay.bodyOwner[k] >= 0) wake(k);
      lost &= lost - 1;
    }
  }
  for (; base < n; base++) {
    if (prev[base] && !gr[base]
        && (lay.cellComp[base] >= 0 || lay.bodyOwner[base] >= 0))
      wake((int)base);
  }
}
void ComponentSystem::computeGroundedBoth() {
  // Wall-time split: base floods -> groundingMs; bond scan + UF -> crossLayerGroundingMs.
  // indexComponents inside base floods already accumulates componentIndexMs.
  double tJoint0 = emscripten_get_now();
  // Snapshot prev grounded only when rigid grounding may change (wake needs the
  // 1->0 transition). A pure loose-overlay refresh cannot unground rigid cells.
  auto rigidMayChange = [&](Layer& lay) {
    return lay.groundDirty || lay.groundContentDirty || !lay.groundBaseValid
      || !lay.componentIndexExact;
  };
  auto staticMayChange = [](Layer& lay) {
    return lay.groundDirty || lay.groundContentDirty || !lay.groundBaseValid
      || !lay.componentIndexExact;
  };
  // Pure loose motion cannot alter rigid base grounding, component adjacency, or
  // cross-layer co-occupation. When no unsupported bond groups remain, preserve
  // the settled joint closure and rebuild only dirty loose columns. Residual
  // bonded assemblies keep the classic rebuild: its grouping/order participates
  // in deterministic component motion even when cell topology is unchanged.
  if (!groundForceFull && jointSupportValid && cgBonds.empty()
      && !jointDirty && !jointBondsInvalid
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
        || (int)lay.groundBaseFlags.size() != (int)lay.components.size()) {
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
    for (auto& component : lay.components)
      component.grounded = lay.groundBaseFlags[i++] != 0;
  };
  bool rf = rigidMayChange(E.fg), rb = rigidMayChange(E.bg);
  bool sf = staticMayChange(E.fg), sb = staticMayChange(E.bg);
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
    auto prepLayer = [&](Layer& lay, bool rigidDirty, bool staticDirty) {
      if (staticDirty) lay.groundDirty = true;
      else if (!rigidDirty) {
        if (!lay.looseGroundDirty && !lay.groundContentDirty) wipeJointPatchesKeepLoose(lay);
        else { lay.looseGroundDirty = true; lay.looseDirtyFull = true; lay.looseDirtyX0 = 0; lay.looseDirtyX1 = E.cols - 1; }
      }
    };
    prepLayer(E.fg, rf, sf);
    prepLayer(E.bg, rb, sb);
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
    E.refreshMobileComponentRegistry(&E.fg);
    E.refreshMobileComponentRegistry(&E.bg);
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
    return E.isIceMaterial(fgG[k]) == E.isIceMaterial(bgG[k]);
  };
  auto bondPair = [&](int fi, int bi) {
    cgBonds.push_back({fi, bi, true});
    E.fg.crossBondedComp[fi] = 1;
    E.bg.crossBondedComp[bi] = 1;
  };
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

  if (cgBonds.empty()) {
    if (prevFg) wakeCellsThatLostGrounding(E.fg, cgPrevFg);
    if (prevBg) wakeCellsThatLostGrounding(E.bg, cgPrevBg);
    E.useLayer(&E.fg);
    jointSupportValid = true;
    jointSupportSleeping = false;
    E.refreshMobileComponentRegistry(&E.fg);
    E.refreshMobileComponentRegistry(&E.bg);
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
  // Apply cached same-layer adjacency to the bonded component groups.
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
  for (int i = 0; i < nf; i++) if (E.fg.crossBondedComp[i] && rootGrounded[ufFind(groundParent, i)]) {
    Comp* c = compById(E.fg, i); c->grounded = true;
    for (int k : c->cells) E.fg.groundedCell[k] = 1;
  }
  for (int i = 0; i < nb; i++) if (E.bg.crossBondedComp[i] && rootGrounded[ufFind(groundParent, nf + i)]) {
    Comp* c = compById(E.bg, i); c->grounded = true;
    for (int k : c->cells) E.bg.groundedCell[k] = 1;
  }

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
  E.refreshMobileComponentRegistry(&E.fg);
  E.refreshMobileComponentRegistry(&E.bg);
  E.perfCrossLayerGroundingMs += emscripten_get_now() - tCross0;
}

// Map a layer-local cellComp id back to its component.
Comp* ComponentSystem::compById(Layer& lay, int id) {
  if (id < 0 || id >= (int)lay.components.size()) return nullptr;
  return &lay.components[id];
}

bool ComponentSystem::compIdIsPlant(Layer& lay, int id) {
  Comp* component = compById(lay, id);
  if (!component) return false;
  for (int k : component->cells)
    if (E.isPlantMaterial(lay.grid[k])) return true;
  return false;
}

// Side/bottom face contact of a cell set against a grid (top faces excluded on
// purpose: top liquid never creates support/lift). Used only to decide whether a
// previously baked body still has accepted support or must re-enter the body
// solver; cross-layer groups accumulate the contact from both layers.
template <class Cells>
void ComponentSystem::accumulateFaceContact(const uint8_t* g, const Cells& cells, FaceContact& c) {
  // Iteration order of `cells` feeds the double accumulators below; only the
  // per-neighbour membership test moves to the stamp mirror.
  // The caller may pass a probe set shifted past the grid edge (motionDecision's
  // `shifted`); OOB members must be skipped entirely — even computing x/y from a
  // negative k and calling asmCells.has(nk) is a memory-safety hazard.
  const int gridLen = E.cols * E.rows;
  asmCells.reset((size_t)gridLen);
  int minX = E.cols, minY = E.rows, maxX = -1, maxY = -1;
  for (int k : cells) if (k >= 0 && k < gridLen) {
    asmCells.add(k);
    int y = k / E.cols, x = k - y * E.cols;
    minX = imin(minX, x); minY = imin(minY, y);
    maxX = imax(maxX, x); maxY = imax(maxY, y);
  }
  auto materialAt = [&](int k) { return g[k]; };
  // Only media outside the assembly can support or buoy it. A cave enclosed by
  // the moving cells is cargo space: its liquid cannot lift the surrounding
  // shell. Connectivity ignores all other terrain because it is classifying
  // the assembly's own inside/outside, not fluid reachability in the world.
  asmExterior.reset((size_t)gridLen);
  if (asmExteriorValue.size() < (size_t)gridLen) asmExteriorValue.resize((size_t)gridLen);
  auto isExteriorMedium = [&](int start) {
    if (start < 0 || start >= gridLen || asmCells.has(start)) return false;
    int sy = start / E.cols, sx = start - sy * E.cols;
    if (sx < minX || sx > maxX || sy < minY || sy > maxY) return true;
    if (asmExterior.has(start)) return asmExteriorValue[start] == 1;

    asmExteriorRegion.clear();
    asmExteriorRegion.push_back(start);
    asmExterior.add(start);
    asmExteriorValue[start] = 2;
    bool exterior = false;
    static const int dx[8] = {-1, 0, 1, -1, 1, -1, 0, 1};
    static const int dy[8] = {-1, -1, -1, 0, 0, 1, 1, 1};
    for (size_t qi = 0; qi < asmExteriorRegion.size() && !exterior; qi++) {
      int k = asmExteriorRegion[qi], y = k / E.cols, x = k - y * E.cols;
      if (x == minX || x == maxX || y == minY || y == maxY) {
        exterior = true;
        break;
      }
      for (int i = 0; i < 8; i++) {
        int nx = x + dx[i], ny = y + dy[i];
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
          exterior = true;
          break;
        }
        int nk = ny * E.cols + nx;
        if (asmCells.has(nk)) continue;
        if (asmExterior.has(nk)) {
          if (asmExteriorValue[nk] == 1) exterior = true;
          continue;
        }
        asmExterior.add(nk);
        asmExteriorValue[nk] = 2;
        asmExteriorRegion.push_back(nk);
      }
    }
    uint8_t result = exterior ? 1 : 0;
    for (int k : asmExteriorRegion) asmExteriorValue[k] = result;
    return exterior;
  };
  asmAirFaces.clear();
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
        if (isExteriorMedium(nk)) {
          c.liquidFaces++;
          c.liquidDensityArea += DENSITY[m];
          if (offs[i] == E.cols) c.bottomLiquidFaces++;
        }
      } else if (E.isLooseSolidMaterial(m)) {
        if (offs[i] == E.cols) {
          c.bottomPowderFaces++;
          c.bottomPowderDensityArea += DENSITY[m];
        }
      } else if (m == EMPTY || E.isGasMaterial(m)) {
        asmAirFaces.push_back(nk);
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
    if (E.isLiquidMaterial(left) && isExteriorMedium(start - 1)) { sideDensity += DENSITY[left]; liquidSides++; }
    if (E.isLiquidMaterial(right) && isExteriorMedium(end + 1)) { sideDensity += DENSITY[right]; liquidSides++; }
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
      if (!E.isLiquidMaterial(m) || !isExteriorMedium(below)) continue;
      c.displacedArea += 0.5;
      c.displacedLiquidMass += 0.5 * DENSITY[m];
    }
  }

  // Open-air visibility only affects buoyancy. In particular, dry plant
  // fragments produced by fire must not raycast to the top of the world from
  // every exposed face. When liquid is present, cache vertical runs so a wide
  // or irregular floating assembly resolves each visited cell once per probe.
  if (c.liquidFaces == 0 || asmAirFaces.empty()) return;
  asmOpenAir.reset((size_t)gridLen);
  if (asmOpenAirValue.size() < (size_t)gridLen) asmOpenAirValue.resize((size_t)gridLen);
  asmOpenAirPath.reserve((size_t)E.rows);
  for (int start : asmAirFaces) {
    int ak = start;
    bool visible = false;
    asmOpenAirPath.clear();
    for (;;) {
      if (asmOpenAir.has(ak)) {
        visible = asmOpenAirValue[ak] != 0;
        break;
      }
      uint8_t am = materialAt(ak);
      if (am != EMPTY && !E.isGasMaterial(am)) break;
      asmOpenAirPath.push_back(ak);
      if (ak < E.cols * 2) {
        visible = true;
        break;
      }
      ak -= E.cols;
    }
    const uint8_t result = visible ? 1 : 0;
    for (int pathK : asmOpenAirPath) {
      asmOpenAir.add(pathK);
      asmOpenAirValue[pathK] = result;
    }
    asmOpenAir.add(ak);
    asmOpenAirValue[ak] = result;
    if (visible) c.openAirFaces++;
  }
}

int ComponentSystem::motionDecision(const FaceContact& c, size_t cellCount, double solidMass) {
  double avgDensity = solidMass / cellCount;
  // Granular support is finite bearing capacity, not buoyancy: only downward
  // contact contributes, and the entire assembly's mass loads that footprint.
  // Side-buried sand therefore cannot lift or pin an overloaded solid.
  bool powderSupports = c.bottomPowderFaces > 0
    && solidMass <= c.bottomPowderDensityArea * R_GRANULAR_BEARING_DEPTH + 1e-6;
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

void ComponentSystem::trimTrailingComponentTombstones(Layer& lay) {
  while (!lay.components.empty() && lay.components.back().cells.empty()) {
    lay.components.pop_back();
    if (lay.componentTombstones > 0) lay.componentTombstones--;
  }
  lay.groundBaseFlags.resize(lay.components.size());
  lay.crossBondedComp.resize(lay.components.size());
}

// Stable component slots make structural edits proportional to the edited
// topology. The caller has already patched cellComp for every changed member.
// Remove only incident graph edges, discover the changed slots' new contacts,
// and leave every untouched component index intact.
void ComponentSystem::patchStableComponentTopology(
    Layer& lay, const std::vector<int>& changedSlots) {
  std::vector<uint8_t> changed(lay.components.size(), 0);
  for (int slot : changedSlots)
    if (slot >= 0 && slot < (int)changed.size()) changed[slot] = 1;
  lay.compAdjPairs.erase(
    std::remove_if(lay.compAdjPairs.begin(), lay.compAdjPairs.end(),
      [&](uint64_t packed) {
        int a = (int)(packed >> 32), b = (int)(uint32_t)packed;
        return (a >= 0 && a < (int)changed.size() && changed[a])
          || (b >= 0 && b < (int)changed.size() && changed[b]);
      }),
    lay.compAdjPairs.end());

  trimTrailingComponentTombstones(lay);
  lay.groundBaseFlags.resize(lay.components.size(), 0);
  lay.crossBondedComp.resize(lay.components.size(), 0);

  std::vector<uint64_t> edges;
  const int32_t* const cc = lay.cellComp.data();
  for (int slot : changedSlots) {
    if (slot < 0 || slot >= (int)lay.components.size()) continue;
    for (int k : lay.components[slot].cells) {
      int y = k / E.cols, x = k - y * E.cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx, other = cc[nk];
        if (other < 0 || other == slot || other >= (int)lay.components.size()) continue;
        if (lay.infinite && (x == 0 || x == E.cols - 1
                            || nx == 0 || nx == E.cols - 1)
            && (E.isIceMaterial(lay.grid[k]) || E.isIceMaterial(lay.grid[nk]))) continue;
        uint32_t lo = (uint32_t)imin(slot, other);
        uint32_t hi = (uint32_t)imax(slot, other);
        edges.push_back(((uint64_t)lo << 32) | hi);
      }
    }
  }
  std::sort(edges.begin(), edges.end());
  edges.erase(std::unique(edges.begin(), edges.end()), edges.end());
  for (uint64_t edge : edges) {
    auto it = std::lower_bound(lay.compAdjPairs.begin(), lay.compAdjPairs.end(), edge);
    if (it == lay.compAdjPairs.end() || *it != edge)
      lay.compAdjPairs.insert(it, edge);
  }

  lay.groundHasDirectedBoundaryComp = false;
  for (int x = 0; x < E.cols && !lay.groundHasDirectedBoundaryComp; x++)
    lay.groundHasDirectedBoundaryComp = cc[x] >= 0;
  for (int y = 1; y < E.rows && !lay.groundHasDirectedBoundaryComp; y++) {
    int k = y * E.cols;
    lay.groundHasDirectedBoundaryComp = cc[k] >= 0 || cc[k + E.cols - 1] >= 0;
  }
  lay.componentIndexExact = true;
  lay.compsReshaped = false;
}

// Blast repair has one topology path. The pre-cut cell index is exact; each
// touched slot is rebuilt into its real connected pieces, with the first piece
// retaining the slot and additional pieces using tombstones or appended slots.
void ComponentSystem::splitRigidAfterBlast(const std::vector<int>& erased) {
  if (erased.empty()) return;
#ifdef SAND_INVARIANT_CHECKS
  if (!E.L->componentIndexExact) {
    emscripten_console_error("BLAST REPAIR REQUIRES AN EXACT COMPONENT INDEX");
    abort();
  }
#endif
  Layer& lay = *E.L;
  const bool groundingPreserved = !groundForceFull
    && lay.groundBaseValid && !lay.groundDirty && !lay.groundContentDirty
    && removalsKeepGroundingValid(erased);
  lay.componentRegistryDirty = true;
  lay.componentIndexPatchOnly = false;
  lay.componentIndexPatches.clear();

  splitTouched.assign(lay.components.size(), 0);
  std::vector<int> touchedSlots;
  for (int k : erased) {
    if (k < 0 || k >= E.cols * E.rows) continue;
    int slot = lay.cellComp[k];
    if (slot >= 0 && slot < (int)lay.components.size() && !splitTouched[slot]) {
      splitTouched[slot] = 1;
      touchedSlots.push_back(slot);
    }
    lay.cellComp[k] = -1;
    lay.groundedCell[k] = 0;
    lay.next[k] = lay.grid[k];
    if (lay.groundBaseValid && k < (int)lay.groundRigidBase.size())
      lay.groundRigidBase[k] = 0;
  }

  std::vector<int> changedSlots = touchedSlots;
  const int gridLen = E.cols * E.rows;
  for (int slot : touchedSlots) {
    Comp source = std::move(lay.components[slot]);
    const bool baseGrounded = groundingPreserved
      && slot < (int)lay.groundBaseFlags.size()
      && lay.groundBaseFlags[slot];
    int32_t survivorGen = ++lay.seenGen;
    for (int k : source.cells)
      if (k >= 0 && k < gridLen && E.isComponentMaterial(lay.grid[k]))
        lay.seenStamp[k] = survivorGen;

    auto makeFragment = [&](std::vector<int>& cells, int id) {
      Comp fragment;
      fragment.id = id;
      fragment.plantType = source.plantType;
      fragment.age = source.age;
      fragment.growing = source.growing;
      fragment.bakedAssemblyId = source.bakedAssemblyId;
      fragment.cacheDirty = source.cacheDirty;
      fragment.grounded = baseGrounded;
      fragment.cells = std::move(cells);
      bool plant = false, hasSeed = false;
      for (int k : fragment.cells) {
        fragment.yMax = imax(fragment.yMax, k / E.cols);
        uint8_t material = lay.grid[k];
        plant = plant || E.isPlantMaterial(material);
        hasSeed = hasSeed || E.isSeedMaterial(material);
        if (E.isPlantWood(material)) fragment.woodCount++;
        else if (E.isPlantLeaf(material)) fragment.leafCount++;
      }
      if (plant) fragment.growing = hasSeed;
      return fragment;
    };
    auto freeSlot = [&]() {
      for (int i = 0; i < (int)lay.components.size(); i++)
        if (lay.components[i].cells.empty() && !splitTouched[i]) return i;
      lay.components.push_back({});
      lay.groundBaseFlags.push_back(1);
      lay.crossBondedComp.push_back(0);
      splitTouched.push_back(0);
      return (int)lay.components.size() - 1;
    };

    bool first = true;
    for (int seed : source.cells) {
      if (seed < 0 || seed >= gridLen || lay.seenStamp[seed] != survivorGen) continue;
      splitPart.clear();
      splitPart.push_back(seed);
      lay.seenStamp[seed] = 0;
      for (size_t qi = 0; qi < splitPart.size(); qi++) {
        int k = splitPart[qi], y = k / E.cols, x = k - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          int nk = ny * E.cols + nx;
          if (lay.seenStamp[nk] != survivorGen) continue;
          lay.seenStamp[nk] = 0;
          splitPart.push_back(nk);
        }
      }
      int previousSize = (int)lay.components.size();
      int target = first ? slot : freeSlot();
      int id = first ? source.id : lay.nextComponentId++;
      if (!first && target < previousSize && lay.componentTombstones > 0)
        lay.componentTombstones--;
      lay.components[target] = makeFragment(splitPart, id);
      lay.groundBaseFlags[target] = baseGrounded ? 1 : 0;
      lay.crossBondedComp[target] = 0;
      for (int k : lay.components[target].cells) lay.cellComp[k] = target;
      if (!first) changedSlots.push_back(target);
      first = false;
    }
    if (first) {
      lay.components[slot] = {};
      lay.components[slot].grounded = true;
      lay.groundBaseFlags[slot] = 1;
      lay.crossBondedComp[slot] = 0;
      lay.componentTombstones++;
    }
  }

  patchStableComponentTopology(lay, changedSlots);
  lay.groundDirty = !groundingPreserved;
  lay.groundContentDirty = false;
  lay.blastSparseCarryReady = !lay.componentCarryDirty;
  if (E.bgEnabled) {
    jointDirty = true;
    jointBondsInvalid = true;
    jointSupportSleeping = false;
  }
}

void ComponentSystem::detachComponentGroups(Layer& lay,
                                            const std::vector<std::vector<int>>& groups) {
  if (groups.empty()) return;
  Engine::ActiveLayerScope layerScope(E, &lay);
#ifdef SAND_INVARIANT_CHECKS
  if (!lay.componentIndexExact) {
    emscripten_console_error("BODY EXTRACTION REQUIRES AN EXACT COMPONENT INDEX");
    abort();
  }
#endif

  struct PendingBody {
    std::vector<std::pair<int, int>> cells;
    std::vector<uint8_t> materials;
    int fuseTicks = 0;
    uint8_t plantType = PT_STANDARD;
  };
  std::vector<PendingBody> pending;
  std::unordered_set<int> detached;
  for (const auto& ids : groups) {
    std::vector<int> cells;
    for (int slot : ids) {
      Comp* component = compById(lay, slot);
      if (!component || detached.count(slot)) continue;
      detached.insert(slot);
      for (int k : component->cells) {
        if (k < 0 || k >= E.cols * E.rows || E.isBodyCell(k)) continue;
        cells.push_back(k);
      }
    }
    if (cells.empty()) continue;

    // A cross-layer support group can connect several pieces only through its
    // peer layer. Once detached, each layer-local connected piece is its own
    // body; keeping disconnected masks together would make them bake back as
    // one artificial component.
    std::sort(cells.begin(), cells.end());
    cells.erase(std::unique(cells.begin(), cells.end()), cells.end());
    asmCells.reset((size_t)E.cols * E.rows);
    detachVisited.reset((size_t)E.cols * E.rows);
    for (int k : cells) asmCells.add(k);
    for (int seed : cells) {
      if (detachVisited.has(seed)) continue;
      PendingBody body;
      std::vector<int> queue{seed};
      detachVisited.add(seed);
      for (size_t qi = 0; qi < queue.size(); qi++) {
        int k = queue[qi], y = k / E.cols, x = k - y * E.cols;
        body.cells.push_back({x, y});
        body.materials.push_back(lay.grid[k]);
        int slot = lay.cellComp[k];
        if (E.isSeedMaterial(lay.grid[k]) && slot >= 0 && slot < (int)lay.components.size())
          body.plantType = lay.components[slot].plantType;
        auto fuse = lay.pendingDetonations.find(k);
        if (fuse != lay.pendingDetonations.end()) {
          if (!body.fuseTicks || fuse->second < body.fuseTicks)
            body.fuseTicks = fuse->second;
          lay.pendingDetonations.erase(fuse);
        }
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          int nk = ny * E.cols + nx;
          if (!asmCells.has(nk) || detachVisited.has(nk)) continue;
          detachVisited.add(nk);
          queue.push_back(nk);
        }
      }
      pending.push_back(std::move(body));
    }
  }
  if (pending.empty()) return;
  lay.componentCarryDirty = true;
  lay.componentRegistryDirty = true;
  lay.blastSparseCarryReady = false;
  lay.componentIndexPatchOnly = false;
  lay.componentIndexPatches.clear();

  std::vector<int> changedSlots;
  changedSlots.reserve(detached.size());
  for (int slot : detached) {
    if (slot < 0 || slot >= (int)lay.components.size()) continue;
    for (int k : lay.components[slot].cells) {
      if (k < 0 || k >= E.cols * E.rows) continue;
      lay.cellComp[k] = -1;
      lay.groundedCell[k] = 0;
      if (lay.groundBaseValid && k < (int)lay.groundRigidBase.size())
        lay.groundRigidBase[k] = 0;
    }
    lay.components[slot] = {};
    lay.components[slot].grounded = true;
    if (slot < (int)lay.groundBaseFlags.size()) lay.groundBaseFlags[slot] = 1;
    if (slot < (int)lay.crossBondedComp.size()) lay.crossBondedComp[slot] = 0;
    lay.componentTombstones++;
    changedSlots.push_back(slot);
  }
  patchStableComponentTopology(lay, changedSlots);

  for (PendingBody& source : pending) {
    E.rigid.wakeBodiesTouchingCells(lay, source.cells);
    Body* body = E.rigid.spawnBodyImpl(source.cells, source.materials);
    if (!body) continue;
    body->fuseTicks = source.fuseTicks;
    body->plantType = source.plantType;
    for (size_t i = 0; i < source.cells.size(); i++) {
      int k = source.cells[i].second * E.cols + source.cells[i].first;
      lay.bodyOwner[k] = body->id;
      lay.bodyCells.push_back(k);
      E.markCellIndex(k);
    }
  }

  lay.sleepingBodySupportDirty = true;
  lay.myceliumActive = false;
  lay.myceliumSporePresent = false;
  for (const Comp& component : lay.components) {
    if (component.growing) lay.myceliumActive = true;
    for (int k : component.cells)
      if (lay.grid[k] == MYCELIUM_SPORE) { lay.myceliumSporePresent = true; break; }
  }
}

void ComponentSystem::detachCrossLayerComponentGroups(
    const std::vector<std::pair<std::vector<int>, std::vector<int>>>& groups) {
  if (groups.empty()) return;
#ifdef SAND_INVARIANT_CHECKS
  if (!E.fg.componentIndexExact || !E.bg.componentIndexExact) {
    emscripten_console_error("JOINT BODY EXTRACTION REQUIRES EXACT COMPONENT INDEXES");
    abort();
  }
#endif
  struct PendingJoint {
    std::vector<std::pair<int, int>> fgCells, bgCells;
    std::vector<uint8_t> fgMaterials, bgMaterials;
    int fuseTicks = 0;
    uint8_t fgPlantType = PT_STANDARD, bgPlantType = PT_STANDARD;
  };
  std::vector<PendingJoint> pending;
  std::unordered_set<int> detachedFg, detachedBg;
  auto collect = [&](Layer& lay, const std::vector<int>& ids,
                     const std::unordered_set<int>& detached,
                     std::unordered_set<int>& groupSlots,
                     std::vector<std::pair<int, int>>& cells,
                     std::vector<uint8_t>& materials,
                     uint8_t& plantType) {
    std::vector<std::pair<int, uint8_t>> indexed;
    for (int slot : ids) {
      Comp* component = compById(lay, slot);
      if (!component || component->cells.empty() || detached.count(slot)
          || groupSlots.count(slot))
        continue;
      groupSlots.insert(slot);
      for (int k : component->cells) {
        if (k < 0 || k >= E.cols * E.rows || lay.bodyOwner[k] >= 0) continue;
        indexed.push_back({k, lay.grid[k]});
        if (E.isSeedMaterial(lay.grid[k])) plantType = component->plantType;
      }
    }
    std::sort(indexed.begin(), indexed.end(),
              [](const auto& a, const auto& b) { return a.first < b.first; });
    indexed.erase(std::unique(indexed.begin(), indexed.end(),
                              [](const auto& a, const auto& b) {
                                return a.first == b.first;
                              }),
                  indexed.end());
    cells.reserve(indexed.size());
    materials.reserve(indexed.size());
    for (const auto& cell : indexed) {
      cells.push_back({cell.first % E.cols, cell.first / E.cols});
      materials.push_back(cell.second);
    }
  };
  for (const auto& group : groups) {
    PendingJoint joint;
    std::unordered_set<int> groupFg, groupBg;
    collect(E.fg, group.first, detachedFg, groupFg, joint.fgCells,
            joint.fgMaterials, joint.fgPlantType);
    collect(E.bg, group.second, detachedBg, groupBg, joint.bgCells,
            joint.bgMaterials, joint.bgPlantType);
    if (!joint.fgCells.empty() && !joint.bgCells.empty()) {
      detachedFg.insert(groupFg.begin(), groupFg.end());
      detachedBg.insert(groupBg.begin(), groupBg.end());
      auto takeFuses = [&](Layer& lay,
                           const std::vector<std::pair<int, int>>& cells) {
        for (const auto& cell : cells) {
          int k = cell.second * E.cols + cell.first;
          auto fuse = lay.pendingDetonations.find(k);
          if (fuse == lay.pendingDetonations.end()) continue;
          if (!joint.fuseTicks || fuse->second < joint.fuseTicks)
            joint.fuseTicks = fuse->second;
          lay.pendingDetonations.erase(fuse);
        }
      };
      takeFuses(E.fg, joint.fgCells);
      takeFuses(E.bg, joint.bgCells);
      pending.push_back(std::move(joint));
    }
  }
  if (pending.empty()) return;

  E.fg.componentCarryDirty = true;
  E.bg.componentCarryDirty = true;
  E.fg.blastSparseCarryReady = false;
  E.bg.blastSparseCarryReady = false;
  E.fg.componentRegistryDirty = true;
  E.bg.componentRegistryDirty = true;
  E.fg.componentIndexPatchOnly = E.bg.componentIndexPatchOnly = false;
  E.fg.componentIndexPatches.clear();
  E.bg.componentIndexPatches.clear();

  auto retire = [&](Layer& lay, const std::unordered_set<int>& detached) {
    std::vector<int> changedSlots;
    changedSlots.reserve(detached.size());
    for (int slot : detached) {
      if (slot < 0 || slot >= (int)lay.components.size()) continue;
      for (int k : lay.components[slot].cells) {
        if (k < 0 || k >= E.cols * E.rows) continue;
        lay.cellComp[k] = -1;
        lay.groundedCell[k] = 0;
        if (lay.groundBaseValid && k < (int)lay.groundRigidBase.size())
          lay.groundRigidBase[k] = 0;
      }
      lay.components[slot] = {};
      lay.components[slot].grounded = true;
      if (slot < (int)lay.groundBaseFlags.size()) lay.groundBaseFlags[slot] = 1;
      if (slot < (int)lay.crossBondedComp.size()) lay.crossBondedComp[slot] = 0;
      lay.componentTombstones++;
      changedSlots.push_back(slot);
    }
    patchStableComponentTopology(lay, changedSlots);
  };
  retire(E.fg, detachedFg);
  retire(E.bg, detachedBg);

  for (PendingJoint& source : pending) {
    E.rigid.wakeBodiesTouchingCells(E.fg, source.fgCells);
    E.rigid.wakeBodiesTouchingCells(E.bg, source.bgCells);
    Body* leader = E.rigid.spawnJointBodyImpl(
      source.fgCells, source.fgMaterials, source.bgCells, source.bgMaterials);
    if (!leader || !leader->jointPeer) continue;
    Body* follower = leader->jointPeer;
    leader->fuseTicks = follower->fuseTicks = source.fuseTicks;
    leader->plantType = source.fgPlantType;
    follower->plantType = source.bgPlantType;
    for (const auto& cell : source.fgCells) {
      int k = cell.second * E.cols + cell.first;
      E.fg.bodyOwner[k] = leader->id;
      E.fg.bodyCells.push_back(k);
      E.useLayer(&E.fg);
      E.markCellIndex(k);
    }
    for (const auto& cell : source.bgCells) {
      int k = cell.second * E.cols + cell.first;
      E.bg.bodyOwner[k] = follower->id;
      E.bg.passiveBodyCells.push_back(k);
      E.useLayer(&E.bg);
      E.markCellIndex(k);
    }
  }

  auto refresh = [&](Layer& lay) {
    lay.sleepingBodySupportDirty = true;
    lay.myceliumActive = false;
    lay.myceliumSporePresent = false;
    for (const Comp& component : lay.components) {
      if (component.growing) lay.myceliumActive = true;
      for (int k : component.cells)
        if (lay.grid[k] == MYCELIUM_SPORE) {
          lay.myceliumSporePresent = true;
          break;
        }
    }
  };
  refresh(E.fg);
  refresh(E.bg);
  cgBonds.erase(std::remove_if(cgBonds.begin(), cgBonds.end(), [&](const CrossLayerBond& bond) {
    return detachedFg.count(bond.fgComp) || detachedBg.count(bond.bgComp);
  }), cgBonds.end());
  E.useLayer(&E.fg);
}

void ComponentSystem::moveCrossLayerBondedAssemblies() {
  const int nf = compCount(E.fg), nb = compCount(E.bg);
  if (cgBonds.empty() || nf == 0 || nb == 0) return;

  std::vector<int>& parent = cgParent;
  parent.resize(nf + nb);
  for (int i = 0; i < nf + nb; i++) parent[i] = i;
  for (const auto& bond : cgBonds) {
    if (bond.fgComp < 0 || bond.fgComp >= nf
        || bond.bgComp < 0 || bond.bgComp >= nb) continue;
    ufUnite(parent, bond.fgComp, nf + bond.bgComp);
  }
  unionCrossBondedClusters(parent, nullptr, nf, nb);

  struct JointGroup {
    std::vector<int> fgComps, bgComps;
    bool grounded = false;
    int maxY = 0;
    int minComp = INT_MAX;
  };
  std::unordered_map<int, JointGroup> groups;
  auto add = [&](Layer& lay, int componentIndex, int parentIndex,
                 std::vector<int> JointGroup::*members) {
    JointGroup& group = groups[ufFind(parent, parentIndex)];
    (group.*members).push_back(componentIndex);
    Comp* component = compById(lay, componentIndex);
    group.grounded = group.grounded || component->grounded;
    group.maxY = imax(group.maxY, component->yMax);
    group.minComp = imin(group.minComp, parentIndex);
  };
  for (int i = 0; i < nf; i++)
    if (i < (int)E.fg.crossBondedComp.size() && E.fg.crossBondedComp[i])
      add(E.fg, i, i, &JointGroup::fgComps);
  for (int i = 0; i < nb; i++)
    if (i < (int)E.bg.crossBondedComp.size() && E.bg.crossBondedComp[i])
      add(E.bg, i, nf + i, &JointGroup::bgComps);

  std::vector<JointGroup*> order;
  order.reserve(groups.size());
  for (auto& entry : groups) order.push_back(&entry.second);
  std::sort(order.begin(), order.end(), [](JointGroup* a, JointGroup* b) {
    if (a->maxY != b->maxY) return a->maxY > b->maxY;
    return a->minComp < b->minComp;
  });

  std::vector<std::pair<std::vector<int>, std::vector<int>>> detachGroups;
  for (JointGroup* group : order) {
    if (group->grounded) continue;
    if (group->fgComps.empty() || group->bgComps.empty()) continue;

    std::vector<int> fgCells, bgCells;
    double mass = 0;
    for (int id : group->fgComps) {
      Comp* component = compById(E.fg, id);
      fgCells.insert(fgCells.end(), component->cells.begin(),
                     component->cells.end());
      for (int k : component->cells) mass += DENSITY[E.fg.grid[k]];
    }
    for (int id : group->bgComps) {
      Comp* component = compById(E.bg, id);
      bgCells.insert(bgCells.end(), component->cells.begin(),
                     component->cells.end());
      for (int k : component->cells) mass += DENSITY[E.bg.grid[k]];
    }
    FaceContact contact;
    accumulateFaceContact(E.fg.grid, fgCells, contact);
    accumulateFaceContact(E.bg.grid, bgCells, contact);
    const size_t cellCount = fgCells.size() + bgCells.size();
    if (motionDecision(contact, cellCount, mass) == 0) continue;
    detachGroups.push_back({group->fgComps, group->bgComps});
  }

  if (!detachGroups.empty()) {
    detachCrossLayerComponentGroups(detachGroups);
    cgBonds.clear();
    E.fg.crossBondedComp.clear();
    E.bg.crossBondedComp.clear();
  }
  E.useLayer(&E.fg);
}

void ComponentSystem::moveRigidAssemblies() {
  const int totalComps = (int)E.L->components.size();
  if (totalComps == 0 || E.L->mobileComponents.empty()) return;

  std::vector<Comp*> mobile;
  std::vector<int> globalIds;
  std::vector<int> localOf(totalComps, -1);
  for (int componentIndex : E.L->mobileComponents) {
    if (componentIndex < 0 || componentIndex >= totalComps) continue;
    Comp& component = E.L->components[componentIndex];
    if (component.grounded
        || (jointGroundReady
            && componentIndex < (int)E.L->crossBondedComp.size()
            && E.L->crossBondedComp[componentIndex]))
      continue;
    localOf[componentIndex] = (int)mobile.size();
    mobile.push_back(&component);
    globalIds.push_back(componentIndex);
  }
  const int count = (int)mobile.size();
  if (count == 0) return;

  std::vector<int> parent(count);
  for (int i = 0; i < count; i++) parent[i] = i;
  std::vector<uint8_t> anchored(count, 0);
  for (int i = 0; i < count; i++) {
    for (int k : mobile[i]->cells) {
      int y = k / E.cols, x = k - y * E.cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = x + ox, ny = y + oy;
        if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows) continue;
        int neighbour = E.L->cellComp[ny * E.cols + nx];
        if (neighbour < 0 || neighbour >= totalComps) continue;
        int local = localOf[neighbour];
        if (local >= 0) ufUnite(parent, i, local);
        else anchored[i] = 1;
      }
    }
  }

  struct Group {
    std::vector<int> comps;
    bool grounded = false;
    int maxY = 0;
    int minComp = INT_MAX;
  };
  std::unordered_map<int, Group> groups;
  for (int i = 0; i < count; i++) {
    Group& group = groups[ufFind(parent, i)];
    group.comps.push_back(i);
    group.grounded = group.grounded || anchored[i] || mobile[i]->grounded;
    group.maxY = imax(group.maxY, mobile[i]->yMax);
    group.minComp = imin(group.minComp, globalIds[i]);
  }

  std::vector<Group*> order;
  order.reserve(groups.size());
  for (auto& entry : groups) order.push_back(&entry.second);
  std::sort(order.begin(), order.end(), [](Group* a, Group* b) {
    if (a->maxY != b->maxY) return a->maxY > b->maxY;
    return a->minComp < b->minComp;
  });

  std::vector<std::vector<int>> detachGroups;
  for (Group* group : order) {
    if (group->grounded) continue;

    std::vector<int> cells;
    for (int index : group->comps)
      cells.insert(cells.end(), mobile[index]->cells.begin(),
                   mobile[index]->cells.end());

    if (E.bgEnabled) {
      Layer& peer = E.L == &E.fg ? E.bg : E.fg;
      bool peerOverlap = false;
      for (int k : cells) {
        uint8_t own = E.L->grid[k], other = peer.grid[k];
        if (peer.bodyOwner[k] < 0
            && E.isRigidMaterialClass(own)
            && E.isRigidMaterialClass(other)
            && E.isIceMaterial(own) == E.isIceMaterial(other)) {
          peerOverlap = true;
          break;
        }
      }
      if (peerOverlap) {
        E.fg.groundDirty = true;
        E.bg.groundDirty = true;
        jointSupportValid = false;
        jointSupportSleeping = false;
        jointBondsInvalid = true;
        jointDirty = true;
        continue;
      }
    }

    double mass = 0;
    for (int k : cells) mass += DENSITY[E.L->grid[k]];
    FaceContact contact;
    accumulateFaceContact(E.L->grid, cells, contact);
    if (motionDecision(contact, cells.size(), mass) == 0) continue;

    std::vector<int> ids;
    ids.reserve(group->comps.size());
    for (int index : group->comps) ids.push_back(globalIds[index]);
    detachGroups.push_back(std::move(ids));
  }
  if (!detachGroups.empty()) detachComponentGroups(*E.L, detachGroups);
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
// Registration partitions are selected from exact material behavior within the
// unified registry. Rock-like terrain stays chunk-bounded for streaming cost,
// while flora and ice use their material-specific floods.
bool ComponentSystem::isFloodTargetMat(uint8_t m) { return m == floodTargetMat; }
bool ComponentSystem::isIceMat(uint8_t m) { return E.isIceMaterial(m); }
bool ComponentSystem::isPlantMat(uint8_t m) { return E.isPlantMaterial(m); }

void ComponentSystem::registerSeededComponents(int colStart, int colEnd) { registerSeededComponents(colStart, colEnd, 0, E.rows); }
// Register structural components for unseen material in the buffer rect
// [colStart,colEnd) x [rowStart,rowEnd). A streamed-in vertical band passes a row
// range (E.cols-wide); a horizontal band passes a col range (E.rows-tall).
void ComponentSystem::registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd) {
  E.L->groundDirty = true; // bulk component rebuild (sync/tools/worldgen/shift) -> full reflood
  E.L->componentCarryDirty = true;
  E.L->componentRegistryDirty = true;
  E.invalidateComponentIndexPatches(E.L);
  // Reused generation-stamped scratch (allocated once in Layer::alloc): a cell
  // is "seen" iff seenStamp[k] == gen. One generation covers every registration
  // behavior because each flood has a disjoint material predicate. Existing
  // component/body membership is stamped once, independent of material count.
  // New cells also seed prevCompCells: if a freshly generated/restored component
  // moves on its first tick, carry must clear its old footprint from next[].
  std::vector<int32_t>& seen = E.L->seenStamp;
  int32_t gen = ++E.L->seenGen;
  for (auto& comp : E.L->components)
    for (int k : comp.cells) seen[k] = gen;
  for (int k : E.L->bodyCells) seen[k] = gen;
  for (int k : E.L->passiveBodyCells) seen[k] = gen;
  // Rock-like materials (chunk-bounded). Each same-id region floods as its own island,
  // so a vein of ore inside stone is a distinct component (and stays a distinct
  // material when it falls — see matOf in moveRigidAssemblies). New non-plant,
  // non-ice structural component materials register here automatically.
  {
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx;
      uint8_t material = E.L->grid[k];
      if (seen[k] == gen || !E.isComponentMaterial(material)
          || E.isPlantMaterial(material) || E.isIceMaterial(material)) continue;
      std::vector<int> cells; int yMax;
      floodTargetMat = E.L->grid[k];
      floodComponent(sx, sy, seen, gen, true, cells, yMax, &ComponentSystem::isFloodTargetMat);
      E.L->prevCompCells.insert(E.L->prevCompCells.end(), cells.begin(), cells.end());
      Comp c; c.id = E.L->nextComponentId++; c.cells = std::move(cells); c.yMax = yMax;
      c.growing = floodTargetMat == MYCELIUM_SPORE;
      if (floodTargetMat == NEUTRONIUM) {
        E.L->forceSourcePresent = true;
        E.fg.forceWakePending = E.bg.forceWakePending = true;
      }
      if (c.growing) {
        E.L->myceliumActive = true;
        E.L->myceliumSporePresent = true;
      }
      E.L->components.push_back(std::move(c));
    }
  }
  // Plant-family materials are unbounded so a whole tree is one partition.
  {
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || !E.isPlantMaterial(E.L->grid[k])) continue;
      std::vector<int> cells; int yMax;
      floodComponent(sx, sy, seen, gen, false, cells, yMax, &ComponentSystem::isPlantMat);
      Comp c; c.id = E.L->nextComponentId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
      // Re-derive species from encoded seed/trunk/foliage materials and count cells.
      for (int kk : cells) { uint8_t m = E.L->grid[kk]; if (E.isPlantWood(m)) c.woodCount++; else if (E.isPlantLeaf(m)) c.leafCount++; if (E.materialEncodesPlantType(m)) c.plantType = E.plantTypeFromMaterial(m); }
      E.L->prevCompCells.insert(E.L->prevCompCells.end(), cells.begin(), cells.end());
      c.cells = std::move(cells); E.L->components.push_back(std::move(c));
    }
  }
  // Ice is unbounded so material-specific freezing can extend one partition.
  {
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || !E.isIceMaterial(E.L->grid[k])) continue;
      std::vector<int> cells; int yMax;
      floodComponent(sx, sy, seen, gen, false, cells, yMax, &ComponentSystem::isIceMat);
      E.L->prevCompCells.insert(E.L->prevCompCells.end(), cells.begin(), cells.end());
      Comp c; c.id = E.L->nextComponentId++; c.cells = std::move(cells); c.yMax = yMax; c.cacheDirty = true; E.L->components.push_back(std::move(c));
    }
  }
}

void ComponentSystem::registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) {
  if (cells.empty()) return;
  E.L->componentCarryDirty = true;
  E.L->componentRegistryDirty = true;
  E.invalidateComponentIndexPatches(E.L);
  if (mat == NEUTRONIUM) {
    E.L->forceSourcePresent = true;
    E.fg.forceWakePending = E.bg.forceWakePending = true;
  }
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
      if (regOwnerStamp.has(nk)) {
        Comp& owner = list[regOwnerVal[nk]];
        // Baked partitions retain their object boundary. New world/tool/reaction
        // cells may support them through the contact graph, but cannot merge
        // into their material component and silently enlarge the old body.
        if (owner.bakedAssemblyId == 0) touchingIds.insert(owner.id);
      }
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

// Plant analogue of registerRigidCells for ordinary runtime placement and
// growth registration. Re-derive species and counters from the merged cell set.
void ComponentSystem::registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax) {
  registerRigidCells(E.L->components, E.L->nextComponentId, mat, cells, yMax, false);
  Comp& c = E.L->components.back();
  c.woodCount = 0; c.leafCount = 0; c.age = 0; c.growing = false; c.cacheDirty = true; c.plantType = PT_STANDARD;
  for (int k : c.cells) { uint8_t m = E.L->grid[k]; if (E.isPlantWood(m)) c.woodCount++; else if (E.isPlantLeaf(m)) c.leafCount++; if (E.materialEncodesPlantType(m)) c.plantType = E.plantTypeFromMaterial(m); }
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

// Register a baked body's supplied cells without merging them into adjacent
// terrain. Callers group connected plant-family materials so a seeded plant
// keeps one growth frontier; other structural cells retain material partitions.
void ComponentSystem::registerBakedCells(
    const std::vector<int>& cells, int assemblyId, bool iceCache,
    uint8_t plantType) {
  if (cells.empty()) return;
  Layer& lay = *E.L;
  const bool stableSlots = lay.componentIndexExact
    && lay.groundBaseFlags.size() == lay.components.size()
    && lay.crossBondedComp.size() == lay.components.size();
  E.L->componentCarryDirty = true;
  E.L->componentRegistryDirty = true;
  if (stableSlots) {
    lay.componentIndexPatchOnly = false;
    lay.componentIndexPatches.clear();
  } else {
    E.invalidateComponentIndexPatches(E.L);
  }
  E.L->groundDirty = true;
  regCells.reset((size_t)E.cols * E.rows);
  for (int k : cells) regCells.add(k);
  std::vector<int> stack;
  stack.reserve(cells.size());
  std::vector<int> changedSlots;
  for (int seed : cells) {
    if (!regCells.has(seed)) continue;
    regCells.remove(seed);
    Comp component;
    component.id = E.L->nextComponentId++;
    component.bakedAssemblyId = assemblyId;
    component.cacheDirty = iceCache;
    component.plantType = plantType;
    bool hasPlant = false, hasSeed = false, hasSpore = false;
    stack.clear();
    stack.push_back(seed);
    while (!stack.empty()) {
      int k = stack.back();
      stack.pop_back();
      component.cells.push_back(k);
      int y = k / E.cols, x = k - y * E.cols;
      component.yMax = imax(component.yMax, y);
      uint8_t material = E.L->grid[k];
      hasPlant = hasPlant || E.isPlantMaterial(material);
      hasSeed = hasSeed || E.isSeedMaterial(material);
      hasSpore = hasSpore || material == MYCELIUM_SPORE;
      if (E.isPlantWood(material)) {
        component.woodCount++;
      } else if (E.isPlantLeaf(material)) {
        component.leafCount++;
      }
      if (E.materialEncodesPlantType(material))
        component.plantType = E.plantTypeFromMaterial(material);
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx;
        if (!regCells.has(nk)) continue;
        regCells.remove(nk);
        stack.push_back(nk);
      }
    }
    component.cacheDirty = component.cacheDirty || hasPlant;
    component.growing = hasSeed || hasSpore;
    if (hasSpore) {
      E.L->myceliumActive = true;
      E.L->myceliumSporePresent = true;
    }
    if (!stableSlots) {
      lay.components.push_back(std::move(component));
      continue;
    }
    int slot = -1;
    for (int i = 0; i < (int)lay.components.size(); i++)
      if (lay.components[i].cells.empty()) { slot = i; break; }
    if (slot < 0) {
      slot = (int)lay.components.size();
      lay.components.push_back({});
      lay.groundBaseFlags.push_back(0);
      lay.crossBondedComp.push_back(0);
    } else if (lay.componentTombstones > 0) {
      lay.componentTombstones--;
    }
    lay.components[slot] = std::move(component);
    lay.groundBaseFlags[slot] = 0;
    lay.crossBondedComp[slot] = 0;
    for (int k : lay.components[slot].cells) lay.cellComp[k] = slot;
    changedSlots.push_back(slot);
  }
  if (stableSlots) patchStableComponentTopology(lay, changedSlots);
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
  if (erased && !erased->empty()) {
    E.L->componentCarryDirty = true;
    E.L->componentRegistryDirty = true;
    E.invalidateComponentIndexPatches(E.L);
  }
  // A deferred joint refresh leaves jointGroundReady set until both layers have
  // stepped. The post-layer phase then rebuilds the shared support closure before
  // cross-layer assembly motion.
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
  if (erased) {
    splitRemovedSet.reset((size_t)E.cols * E.rows);
    for (int k : *erased)
      if (k >= 0 && k < E.cols * E.rows) splitRemovedSet.add(k);
  }
  if (erased && indexedOffset >= 0) {
    touchedByIndex.assign(E.L->components.size(), 0);
    for (int k : *erased) {
      int ci = E.L->cellComp[k] - indexedOffset;
      if (ci < 0 || ci >= (int)E.L->components.size()) { touchedByIndex.clear(); break; }
      touchedByIndex[ci] = 1;
    }
  }
  updated.reserve(E.L->components.size() + (erased ? erased->size() : 0));
  for (size_t compIndex = 0; compIndex < E.L->components.size(); compIndex++) {
    auto& comp = E.L->components[compIndex];
    if (!touchedByIndex.empty() && !touchedByIndex[compIndex]) { updated.push_back(std::move(comp)); continue; }
    bool plantComponent = false;
    for (int k : comp.cells)
      if (E.isPlantMaterial(E.L->grid[k]) || (erased && splitRemovedSet.has(k))) {
        plantComponent = true;
        break;
      }
    if (!plantComponent) { updated.push_back(std::move(comp)); continue; }
    bool componentChanged = false;
    for (int k : comp.cells)
      if (!E.isPlantMaterial(E.L->grid[k])) { componentChanged = true; break; }
    if (localConnectivityFastPath && erased) {
      splitSurvivors.clear(); splitErased.clear();
      for (int k : comp.cells) {
        if (E.isPlantMaterial(E.L->grid[k])) splitSurvivors.push_back(k);
        else splitErased.push_back(k);
      }
      if (splitErased.empty()) { updated.push_back(std::move(comp)); continue; }
      if (comp.grounded && componentRemovalLocallyConnected(splitErased, splitSurvivors,
                                                             indexedOffset >= 0 ? indexedOffset + (int)compIndex : -1)) {
        comp.cells.swap(splitSurvivors); comp.yMax = comp.woodCount = comp.leafCount = 0; comp.cacheDirty = true; comp.growing = false;
        for (int k : comp.cells) { uint8_t m = E.L->grid[k]; int y = k / E.cols; comp.yMax = imax(comp.yMax, y); if (E.isPlantWood(m)) comp.woodCount++; else if (E.isPlantLeaf(m)) comp.leafCount++; else if (E.isSeedMaterial(m)) comp.growing = true; }
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
      Comp c; c.id = reused ? E.L->nextComponentId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
      c.plantType = comp.plantType; c.growing = comp.growing;
      c.bakedAssemblyId = comp.bakedAssemblyId;
      bool hasSeed = false;
      for (int k : part) { uint8_t m = E.L->grid[k]; int y = k / E.cols; if (y > c.yMax) c.yMax = y; if (E.isPlantWood(m)) c.woodCount++; else if (E.isPlantLeaf(m)) c.leafCount++; else if (E.isSeedMaterial(m)) hasSeed = true; }
      if (componentChanged) c.growing = hasSeed;
      c.cells = part; updated.push_back(std::move(c)); reused = true;
    }
    if (!reused) E.L->compsReshaped = true;
  }
  E.L->components = std::move(updated);
}

// Fire usually nibbles leaves or an exposed face without disconnecting any
// surviving support. Keep that common case local: split only components named
// by the exact cellComp index, prove the removed blobs are not cuts, patch the
// cached cells, and request only an index refresh. Acid retains its established
// split order; real cuts on either path retain the full grounding reflood.
void ComponentSystem::finishPlantErosion(std::vector<int>& erased, bool indexedExact, bool deferJointRefresh) {
  if (erased.empty()) return;
  E.L->compsReshaped = false;
  splitPlantAfterErase(&erased, indexedExact ? 0 : -1, false, deferJointRefresh, deferJointRefresh);
  if (!indexedExact || !removalsKeepGroundingValid(erased)) {
    E.L->groundDirty = true;
    return;
  }
  for (int k : erased) E.L->cellComp[k] = -1;
  E.L->groundContentDirty = true;
}

// Split static structural components after an erase.
// markGroundDirty=true (the default, used by tools-erase and ice-melt) forces a
// full grounding reflood next pass. Callers with an exact component index may
// request a bounded connectivity proof before falling back to the full component
// flood; grounding-cache validity remains a separate caller decision.
void ComponentSystem::splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased,
                                           int& nextId, bool iceCache, bool markGroundDirty,
                                           int indexedOffset, ConnectivitySplitMode splitMode) {
  // Dirty joints for the NEXT step when bg is live. Even acid pure-bore
  // (markGroundDirty=false) must force a recompute — but do NOT clear
  // jointGroundReady mid-step. step() grounds jointly, then stepLayer(fg) then
  // stepLayer(bg). Acid transferred into the first layer can dissolve there and
  // used to clear jointGroundReady before the second layer moved; that layer
  // then ran ensureGroundedSingleLayer (no cross-support) and crept down one
  // cell per dissolve until co-occupation was lost and it free-fell.
  if (E.bgEnabled && !erased.empty()) { jointBondsInvalid = true; jointDirty = true; }
  if (!erased.empty()) {
    E.L->componentCarryDirty = true;
    E.L->componentRegistryDirty = true;
    E.invalidateComponentIndexPatches(E.L);
  }
  if (markGroundDirty && !erased.empty()) E.L->groundDirty = true;
  if (erased.empty() || list.empty()) return;
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
  bool removedBefore = false;
  for (size_t compIndex = 0; compIndex < list.size(); compIndex++) {
    auto& comp = list[compIndex];
    if (!touchedByIndex.empty() && !touchedByIndex[compIndex]) {
      if (removedBefore) E.L->compsReshaped = true;
      updated.push_back(std::move(comp)); continue;
    }
    bool touched = false;
    std::vector<int>& removedCells = splitErased;
    survivors.clear(); survivors.reserve(comp.cells.size()); removedCells.clear();
    for (int k : comp.cells) {
      if (splitRemovedSet.has(k)) {
        touched = true;
        removedCells.push_back(k);
      } else {
        survivors.push_back(k);
      }
    }
    if (!touched) {
      if (removedBefore) E.L->compsReshaped = true;
      updated.push_back(std::move(comp)); continue;
    }
    // Compact an erased slot and invalidate only if a later positional
    // component really shifts.
    if (survivors.empty()) { removedBefore = true; continue; }
    if (removedBefore) E.L->compsReshaped = true;
    int indexedComp = indexedOffset >= 0 ? indexedOffset + (int)compIndex : -1;
    bool baseGrounded = indexedComp >= 0
      && indexedComp < (int)E.L->groundBaseFlags.size()
      && E.L->groundBaseFlags[indexedComp];
    // Joint-only support can disappear in the post-reaction cross-layer pass;
    // keep its established flood order so a same-tick fall stays deterministic.
    if (splitMode == ConnectivitySplitMode::LOCAL_EXACT && baseGrounded
        && componentRemovalLocallyConnected(removedCells, survivors,
                                            indexedComp)) {
      std::vector<int>& deferred = E.L->deferredSplitIds;
      if (std::find(deferred.begin(), deferred.end(), comp.id) == deferred.end())
        deferred.push_back(comp.id);
      comp.cells.swap(survivors);
      comp.yMax = 0;
      comp.cacheDirty = iceCache;
      bool plantComponent = false;
      for (int k : comp.cells)
        if (E.isPlantMaterial(E.L->grid[k])) { plantComponent = true; break; }
      if (plantComponent) { comp.woodCount = comp.leafCount = 0; comp.growing = false; }
      for (int k : comp.cells) {
        uint8_t material = E.L->grid[k];
        comp.yMax = imax(comp.yMax, k / E.cols);
        if (!plantComponent) continue;
        if (E.isPlantWood(material)) comp.woodCount++;
        else if (E.isPlantLeaf(material)) comp.leafCount++;
        else if (E.isSeedMaterial(material)) comp.growing = true;
      }
      updated.push_back(std::move(comp));
      continue;
    }
    splitMembers.reset((size_t)E.cols * E.rows);
    for (int k : survivors) splitMembers.add(k);
    bool reused = false;
    for (int start : survivors) {
      if (!splitMembers.has(start)) continue;
      part.clear(); part.push_back(start); splitMembers.remove(start);
      for (size_t qi = 0; qi < part.size(); qi++) {
        int cur = part[qi]; int y = cur / E.cols, x = cur - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx; if (splitMembers.has(nk)) { splitMembers.remove(nk); part.push_back(nk); } }
      }
      if (reused) E.L->compsReshaped = true; // a 2nd+ surviving piece -> a split: ids shift
      Comp c; c.id = reused ? nextId++ : comp.id; c.yMax = 0; c.cacheDirty = iceCache;
      c.plantType = comp.plantType;
      c.age = comp.age;
      c.growing = comp.growing;
      c.bakedAssemblyId = comp.bakedAssemblyId;
      bool plantComponent = false, hasSeed = false;
      for (int k : part) {
        int y = k / E.cols; if (y > c.yMax) c.yMax = y;
        uint8_t material = E.L->grid[k];
        plantComponent = plantComponent || E.isPlantMaterial(material);
        if (E.isPlantWood(material)) c.woodCount++;
        else if (E.isPlantLeaf(material)) c.leafCount++;
        else if (E.isSeedMaterial(material)) hasSeed = true;
      }
      if (plantComponent) c.growing = hasSeed;
      c.cells = part; updated.push_back(std::move(c));
      reused = true;
    }
  }
  list.swap(updated);
  updated.clear();
}
