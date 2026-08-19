// Shared capped scan for the per-pixel placement/staging economy: walk `offs`
// (nearest-to-center-first) as (ox,oy) offsets from (cx,cy), skip out-of-bounds
// cells and the player's own AABB, and invoke act(k) until `cap` cells acted
// (act returns whether it consumed a cell). getOff maps an element to (ox,oy).
struct ToolDiscBounds {
  int x0 = 1, y0 = 1, x1 = 0, y1 = 0;
};

static ToolDiscBounds clippedToolDiscBounds(
    int cols, int rows, int cx, int cy, int radius, int yMaxExclusive) {
  if (radius < 0) return {};
  int64_t minX = std::max<int64_t>(1, (int64_t)cx - radius);
  int64_t maxX = std::min<int64_t>(cols - 2, (int64_t)cx + radius);
  int64_t minY = std::max<int64_t>(1, (int64_t)cy - radius);
  int64_t maxY = std::min<int64_t>(
    std::min<int64_t>(rows, yMaxExclusive) - 1, (int64_t)cy + radius);
  if (minX > maxX || minY > maxY) return {};
  return {(int)minX, (int)minY, (int)maxX, (int)maxY};
}

template <class Visit>
static void forEachClippedToolDiscCell(
    int cols, int rows, int cx, int cy, int radius, int yMaxExclusive,
    Visit&& visit) {
  ToolDiscBounds bounds = clippedToolDiscBounds(
    cols, rows, cx, cy, radius, yMaxExclusive);
  int64_t radius2 = (int64_t)radius * radius;
  for (int y = bounds.y0; y <= bounds.y1; y++) {
    int64_t dy = (int64_t)y - cy;
    for (int x = bounds.x0; x <= bounds.x1; x++) {
      int64_t dx = (int64_t)x - cx;
      if (dx * dx + dy * dy <= radius2) visit(x, y);
    }
  }
}

template <class Offs, class GetOff, class Act>
int ToolSystem::cappedOffsetScan(int cx, int cy, const Offs& offs, GetOff getOff, int yMaxExcl, int cap, const Player* p, Act act) {
  if (cap <= 0) return 0;
  PlayerCellBox box = playerCellBox(p);
  int done = 0;
  for (const auto& o : offs) {
    if (done >= cap) break;
    std::pair<int, int> d = getOff(o);
    int xx = cx + d.first, yy = cy + d.second;
    if (yy <= 0 || yy >= yMaxExcl || xx <= 0 || xx >= E.cols - 1) continue;
    if (p && box.contains(xx, yy)) continue; // don't build on the player
    if (act(E.I(xx, yy))) done++;
  }
  return done;
}
// Interpolate a stroke from (x0,y0) to (x1,y1): invoke stamp(x,y) every
// `spacing` steps and once at the endpoint, stopping early when wantMore()
// says the budget is spent. A zero-length stroke stamps once.
template <class Stamp, class WantMore>
void ToolSystem::strokeScan(int x0, int y0, int x1, int y1, int spacing, Stamp stamp, WantMore wantMore) {
  int steps = imax(std::abs(x1 - x0), std::abs(y1 - y0));
  if (steps == 0) { stamp(x0, y0); return; }
  for (int i = 0; i <= steps && wantMore(); i += spacing) {
    double t = (double)i / (double)steps;
    stamp((int)std::lround(x0 + (x1 - x0) * t), (int)std::lround(y0 + (y1 - y0) * t));
  }
  if (wantMore()) stamp(x1, y1);
}
// Capped survival placement walks the selected fixed footprint in its
// deterministic center-first order. Optional `p` excludes the player's AABB so
// a footprint that grazes the player can still place its other cells.

// Tool semantics and player/world edits.
//
// This subsystem turns selected tools/materials into component-aware world edits.
// DOM normalization stays in JS; view and pointer policy live in ViewCamera.
void ToolSystem::initSurvivalFootprints() {
  survivalFootprints.clear();
  survivalFootprints.reserve(SURVIVAL_FOOTPRINT_MAX_SIZE);
  auto makeSquare = [&](int id, int size) {
    SurvivalFootprint fp;
    fp.id = (uint8_t)id;
    fp.width = (uint8_t)size;
    fp.height = (uint8_t)size;
    fp.anchorX = (int8_t)(size / 2 - (size % 2 == 0 ? 1 : 0));
    fp.anchorY = (int8_t)(size / 2 - (size % 2 == 0 ? 1 : 0));
    double cx = (double)(size - 1) * 0.5 - fp.anchorX;
    double cy = (double)(size - 1) * 0.5 - fp.anchorY;
    std::vector<SurvivalFootprintCell> cells;
    cells.reserve((size_t)size * (size_t)size);
    for (int y = 0; y < size; y++) {
      for (int x = 0; x < size; x++) {
        SurvivalFootprintCell c;
        c.ox = (int8_t)(x - fp.anchorX);
        c.oy = (int8_t)(y - fp.anchorY);
        cells.push_back(c);
      }
    }
    std::stable_sort(cells.begin(), cells.end(), [&](const SurvivalFootprintCell& a, const SurvivalFootprintCell& b) {
      double dax = (double)a.ox - cx, day = (double)a.oy - cy;
      double dbx = (double)b.ox - cx, dby = (double)b.oy - cy;
      double da = dax * dax + day * day, db = dbx * dbx + dby * dby;
      if (da != db) return da < db;
      if (a.oy != b.oy) return a.oy < b.oy;
      return a.ox < b.ox;
    });
    fp.cells = std::move(cells);
    survivalFootprints.push_back(std::move(fp));
  };
  for (int size = 1; size <= SURVIVAL_FOOTPRINT_MAX_SIZE; size++) makeSquare(size - 1, size);
}
int ToolSystem::survivalFootprintCount() const { return (int)survivalFootprints.size(); }
int ToolSystem::clampSurvivalFootprintId(int id) const {
  if (survivalFootprints.empty()) return 0;
  if (id < 0) return 0;
  if (id >= (int)survivalFootprints.size()) return (int)survivalFootprints.size() - 1;
  return id;
}
const SurvivalFootprint& ToolSystem::getSurvivalFootprint(int id) const { return survivalFootprints[(size_t)clampSurvivalFootprintId(id)]; }
const SurvivalFootprint& ToolSystem::getSurvivalFootprint(const Player& p) const { return getSurvivalFootprint(p.selectedFootprint); }
int ToolSystem::buildSurvivalFootprintSnapshot() {
  survivalFootprintSnapshot.assign((size_t)survivalFootprints.size() * FP_STRIDE, 0);
  for (size_t i = 0; i < survivalFootprints.size(); i++) {
    const SurvivalFootprint& fp = survivalFootprints[i];
    int32_t* o = survivalFootprintSnapshot.data() + i * FP_STRIDE;
    writeSurvivalFootprintSnapshot(o, fp, {
      .cellCount = WriteSurvivalFootprintSnapshotCellCount{
        (int)fp.cells.size()},
    });
  }
  return (int)survivalFootprints.size();
}
void ToolSystem::setSelectedFootprint(Player& p, int id) {
  int next = clampSurvivalFootprintId(id);
  if (p.selectedFootprint == next) return;
  p.selectedFootprint = next;
  p.placeStrokeActive = false;
  E.psys.resetPlayerMine(p);
}
void ToolSystem::setSelectedFootprint(int id, int footprintId) { Player* p = E.psys.findPlayer(id); if (p) setSelectedFootprint(*p, footprintId); }
int ToolSystem::selectedFootprintId(int id) const { const Player* p = nullptr; for (const auto& pp : E.psys.players) if (pp.id == id) { p = &pp; break; } return p ? clampSurvivalFootprintId(p->selectedFootprint) : 0; }
int ToolSystem::survivalFootprintCellCount(const Player& p) const { return (int)getSurvivalFootprint(p).cells.size(); }
void ToolSystem::survivalFootprintBounds(const SurvivalFootprint& fp, int cx, int cy, int& x0, int& y0, int& x1, int& y1) const {
  x0 = cx - fp.anchorX;
  y0 = cy - fp.anchorY;
  x1 = x0 + fp.width - 1;
  y1 = y0 + fp.height - 1;
}
bool ToolSystem::footprintHasMaterialAt(int cx, int cy, const SurvivalFootprint& fp) {
  for (const SurvivalFootprintCell& o : fp.cells) {
    int xx = cx + (int)o.ox, yy = cy + (int)o.oy;
    if (yy <= 0 || yy >= E.rows || xx <= 0 || xx >= E.cols - 1) continue;
    if (E.L->grid[yy * E.cols + xx] != EMPTY) return true;
  }
  return false;
}
// Returns the NUMBER OF CELLS actually written (for the per-pixel inventory economy).
int ToolSystem::paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite) {
  if (!isMaterialId(material)) return 0;
  // FREE_RIGID products need a body owner rather than static component
  // membership. Reuse the structural placement policy after clearing an
  // overwrite footprint.
  if (MAT_PLACEMENT[material] == MP_STRUCTURE
      && !E.isComponentMaterial(material)) {
    if (overwrite) eraseDisc(cx, cy, radius);
    std::vector<std::pair<int, int>> cells;
    forEachClippedToolDiscCell(
      E.cols, E.rows, cx, cy, radius, E.rows, [&](int xx, int yy) {
        if (E.L->grid[E.I(xx, yy)] == EMPTY) cells.push_back({xx, yy});
      });
    finalizeStructuralPlacement(cells, material);
    return (int)cells.size();
  }
  int changed = 0;
  std::vector<int> erasedStructural;
  CellMutationBatch mutations(E, erasedStructural);
  forEachClippedToolDiscCell(
    E.cols, E.rows, cx, cy, radius, E.rows, [&](int xx, int yy) {
      int k = E.I(xx, yy);
      if (!(overwrite || E.L->grid[k] == EMPTY)) return;
      uint8_t old = E.L->grid[k];
      // An explicit loose-cell overwrite resets its per-cell motion state while
      // topology-aware replacement keeps same-material mutations state-neutral.
      if (old == material && MAT_PLACEMENT[material] != MP_STRUCTURE) {
        E.writeGridIndexUnsafe(k, material);
        E.L->clearMotionSpan((size_t)k, 1);
        return;
      }
      bool wrote = E.isComponentMaterial(material)
        ? mutations.replaceWithStatic(k, material)
        : mutations.replaceLoose(k, material);
      if (wrote && old != material) changed++;
  });
  mutations.commitGeneral();
  if (changed) {
    ToolDiscBounds bounds = clippedToolDiscBounds(
      E.cols, E.rows, cx, cy, radius, E.rows);
    E.markDirtyRect(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
  }
  return changed;
}
// Generic material placement by id — the inventory-forward path. Loose media
// paint as cells; structural placement uses its local support/contact state.
// EMPTY erases.
int ToolSystem::placeMaterialAt(int cx, int cy, int radius, uint8_t mat) {
  if (!isMaterialId(mat)) return 0;
  if (MAT_PLACEMENT[mat] == MP_ERASE) return eraseDisc(cx, cy, radius);
  if (MAT_PLACEMENT[mat] == MP_PAINT) return paintDisc(cx, cy, radius, mat, false);
  std::vector<std::pair<int, int>> cells;
  forEachClippedToolDiscCell(
    E.cols, E.rows, cx, cy, radius, E.rows, [&](int xx, int yy) {
      int k = E.I(xx, yy);
      if (E.L->grid[k] == EMPTY) cells.push_back({xx, yy});
    });
  if (cells.empty()) return 0;
  E.L->skyDirty = true;
  finalizeStructuralPlacement(cells, mat);
  return (int)cells.size();
}
// Shared component registration for runtime structural edits. Exact material
// traits supply growth/reaction behavior; physical storage is unified.
void ToolSystem::registerComponentCells(
    uint8_t mat, std::unordered_set<int>& cells, uint8_t plantType) {
  if (cells.empty()) return;
  if (E.isPlantMaterial(mat)) {
    int yMax = 0;
    for (int k : cells) yMax = imax(yMax, k / E.cols);
    E.comps.registerPlantCells(mat, cells, yMax);
  } else {
    E.comps.registerRigidCellsSplit(E.L->components, E.L->nextComponentId, mat, cells,
                              E.isIceMaterial(mat));
  }
  if (mat == MYCELIUM_SPORE) {
    E.L->myceliumActive = true;
    E.L->myceliumSporePresent = true;
  }
  if (E.isSeedMaterial(mat) || mat == MYCELIUM_SPORE) {
    for (auto& component : E.L->components) {
      for (int k : cells) {
        if (std::find(component.cells.begin(), component.cells.end(), k) == component.cells.end()) continue;
        component.growing = true;
        component.cacheDirty = true;
        if (E.isSeedMaterial(mat)) {
          component.plantType = plantType;
        }
        break;
      }
    }
  }
}

// Resolve each connected island from one placement gesture independently.
// Growth origins always enter through the rigid solver. Other structural
// material becomes static on contact or enters as a free body.
void ToolSystem::finalizeStructuralPlacement(
    const std::vector<std::pair<int, int>>& cells, uint8_t mat,
    uint8_t plantType) {
  if (cells.empty() || !isMaterialId(mat)
      || MAT_PLACEMENT[mat] != MP_STRUCTURE) return;
  E.L->skyDirty = true;
  if (!E.isComponentMaterial(mat)) {
    E.rigid.finishSpawn(cells, mat);
    return;
  }
  std::map<int, std::pair<int, int>> ordered;
  for (const auto& cell : cells) {
    if (!E.isInBounds(cell.first, cell.second)) continue;
    ordered[cell.second * E.cols + cell.first] = cell;
  }
  std::unordered_set<int> remaining;
  remaining.reserve(ordered.size() * 2);
  for (const auto& entry : ordered) remaining.insert(entry.first);
  std::vector<int> stack;
  for (const auto& entry : ordered) {
    if (!remaining.erase(entry.first)) continue;
    std::vector<std::pair<int, int>> island;
    stack.clear();
    stack.push_back(entry.first);
    while (!stack.empty()) {
      int k = stack.back();
      stack.pop_back();
      int x = k % E.cols, y = k / E.cols;
      island.push_back({x, y});
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = x + ox, ny = y + oy;
        if (!E.isInBounds(nx, ny)) continue;
        int nk = ny * E.cols + nx;
        if (remaining.erase(nk)) stack.push_back(nk);
      }
    }

    if (E.isSeedMaterial(mat) || mat == MYCELIUM_SPORE) {
      Body* body = E.rigid.finishSpawn(island, mat, false);
      if (body && E.isSeedMaterial(mat)) body->plantType = plantType;
      continue;
    }

    bool touchesStatic = false;
    Layer* peer = E.bgEnabled ? (E.L == &E.fg ? &E.bg : &E.fg) : nullptr;
    for (const auto& cell : island) {
      int k = cell.second * E.cols + cell.first;
      if (peer && peer->bodyOwner[k] < 0
          && E.isComponentMaterial(peer->grid[k]))
        touchesStatic = true;
      for (int oy = -1; oy <= 1 && !touchesStatic; oy++)
        for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = cell.first + ox, ny = cell.second + oy;
          if (!E.isInBounds(nx, ny)) continue;
          int nk = ny * E.cols + nx;
          if (E.L->bodyOwner[nk] < 0 && E.isComponentMaterial(E.L->grid[nk])) {
            touchesStatic = true;
            break;
          }
        }
      if (touchesStatic) break;
    }
    if (!touchesStatic) {
      E.rigid.finishSpawn(island, mat);
      continue;
    }
    if (E.rigid.anchorPlacementToStatic(island, mat, plantType)) continue;

    std::unordered_set<int> staticCells;
    staticCells.reserve(island.size() * 2);
    for (const auto& cell : island) {
      int k = cell.second * E.cols + cell.first;
      if (E.L->grid[k] != EMPTY) continue;
      E.writeGridIndexUnsafe(k, mat);
      staticCells.insert(k);
    }
    registerComponentCells(mat, staticCells, plantType);
  }
}

int ToolSystem::placeMaterialAtFootprintCapped(int cx, int cy, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p) {
  if (!isMaterialId(mat) || MAT_PLACEMENT[mat] == MP_ERASE
      || maxCells <= 0) return 0;
  bool structural = MAT_PLACEMENT[mat] == MP_STRUCTURE;
  std::vector<std::pair<int, int>> cells;
  std::vector<int> removed;
  CellMutationBatch mutations(E, removed);
  int placed = cappedOffsetScan(cx, cy, fp.cells, [](const SurvivalFootprintCell& o) { return std::pair<int, int>((int)o.ox, (int)o.oy); }, E.rows, maxCells, p,
    [&](int k) {
      if (E.L->grid[k] != EMPTY) return false;
      if (structural) cells.push_back({k % E.cols, k / E.cols});
      else if (!mutations.replaceLoose(k, mat)) return false;
      return true;
    });
  if (placed) {
    int x0, y0, x1, y1;
    survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1);
    E.markDirtyRect(x0, y0, x1, y1);
  }
  mutations.commitGeneral();
  if (structural) finalizeStructuralPlacement(cells, mat);
  return placed;
}
// ---- shared destroy/erase plumbing ----
// Destroy the (non-EMPTY) cell at k with material m: a body cell routes to the
// body eraser, a static cell is classified for the component split and cleared.
// body-material invariant: body cells hold their real material; the body system
// erases them, the component-split system erases static cells.
void ToolSystem::destroyCellAt(int k, uint8_t m, std::vector<int>& erasedStructural,
                   std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirtyBodies) {
  auto clearCellState = [&](int cell) {
    E.writeGridIndexUnsafe(cell, EMPTY);
    E.L->clearMotionSpan((size_t)cell, 1);
  };
  E.noteLooseGroundTouch(m);
  if (E.isBodyCell(k)) {
    if (bodyById.empty()) for (Body* b : E.L->bodies) bodyById[b->id] = b;
    if (!E.rigid.eraseBodyCellIndex(k, bodyById, dirtyBodies)) {
      clearCellState(k);
      E.L->bodyOwner[k] = -1;
    }
  } else {
    if (E.isComponentMaterial(m)) erasedStructural.push_back(k);
    clearCellState(k);
  }
}
// Component-split epilogue shared by every destroy path (eraser, stroke
// eraser, both mining paths).
void ToolSystem::splitComponentsAfterDestroy(std::vector<int>& erasedStructural) {
  E.comps.splitRigidAfterErase(E.L->components, erasedStructural, E.L->nextComponentId, false);
}
// Returns the NUMBER OF GRID CELLS cleared (non-EMPTY -> EMPTY). Body/draft-only
// erases still mark dirty but don't count toward the cleared total.
int ToolSystem::eraseDisc(int cx, int cy, int radius) {
  std::vector<int> erasedStructural; bool changed = false; int cleared = 0;
  std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
  forEachClippedToolDiscCell(
    E.cols, E.rows, cx, cy, radius, E.rows, [&](int xx, int yy) {
      int k = E.I(xx, yy);
      if (E.isBodyCell(k)) { destroyCellAt(k, E.L->grid[k], erasedStructural, bodyById, dirtyBodies); changed = true; }
      else if (E.L->grid[k] != EMPTY) { destroyCellAt(k, E.L->grid[k], erasedStructural, bodyById, dirtyBodies); changed = true; cleared++; }
      if (draft.erase(k)) changed = true;
    });
  E.rigid.finishErasedBodies(dirtyBodies, E.L->bodyCells);
  if (changed) {
    ToolDiscBounds bounds = clippedToolDiscBounds(
      E.cols, E.rows, cx, cy, radius, E.rows);
    E.markDirtyRect(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
  }
  splitComponentsAfterDestroy(erasedStructural);
  return cleared;
}
// Batched eraser for continuous creative strokes: collect the whole swept brush
// footprint, then split affected components once. This avoids doing flood-fill
// cleanup for every interpolated brush stamp while the pointer is held.
int ToolSystem::eraseStrokeCells(const std::vector<int>& cells, int x0, int y0, int x1, int y1) {
  if (cells.empty()) return 0;
  std::vector<int> erasedStructural; bool changed = false; int cleared = 0;
  std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
  for (int k : cells) {
    if (E.isBodyCell(k)) { destroyCellAt(k, E.L->grid[k], erasedStructural, bodyById, dirtyBodies); changed = true; }
    else if (E.L->grid[k] != EMPTY) { destroyCellAt(k, E.L->grid[k], erasedStructural, bodyById, dirtyBodies); changed = true; cleared++; }
    if (draft.erase(k)) changed = true;
  }
  E.rigid.finishErasedBodies(dirtyBodies, E.L->bodyCells);
  if (changed) { E.L->skyDirty = true; E.markDirtyRect(x0, y0, x1, y1); }
  splitComponentsAfterDestroy(erasedStructural);
  return cleared;
}
int ToolSystem::clearMineDamageDisc(int cx, int cy, int radius) {
  int changed = 0;
  for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue; int k = E.I(xx, yy); if (E.L->mineDamage[k]) { E.L->mineDamage[k] = 0; changed = 1; } } }
  if (changed) E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
  return changed;
}
int ToolSystem::clearMineDamageFootprint(int cx, int cy, const SurvivalFootprint& fp) {
  int changed = 0;
  for (const SurvivalFootprintCell& o : fp.cells) {
    int xx = cx + (int)o.ox, yy = cy + (int)o.oy;
    if (yy <= 0 || yy >= E.rows || xx <= 0 || xx >= E.cols - 1) continue;
    int k = E.I(xx, yy);
    if (E.L->mineDamage[k]) { E.L->mineDamage[k] = 0; changed = 1; }
  }
  if (changed) {
    int x0, y0, x1, y1;
    survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1);
    E.markDirtyRect(x0, y0, x1, y1);
  }
  return changed;
}
void ToolSystem::clearAllMineDamage() {
  bool any = false;
  for (uint32_t v : E.L->mineDamage) if (v) { any = true; break; }
  if (!any) { E.L->mineDamageAny = false; return; }
  std::fill(E.L->mineDamage.begin(), E.L->mineDamage.end(), 0);
  E.L->mineDamageAny = false;
  E.markAllDirty();
}
uint32_t ToolSystem::mineDurationFor(uint8_t m, uint32_t areaScale) const {
  return (uint32_t)DURABILITY[m] * 16u * imax(1, (int)areaScale);
}
uint32_t ToolSystem::minePowerFor(uint8_t m, const Player& miner, bool scaledSpeed, uint32_t speedMultiplier) const {
  uint32_t power = 16;
  if (scaledSpeed) {
    // Clamp to valid enum range (TOOL_CLASS_COUNT includes dig). Unknown classes
    // fall back to hand so a stale net packet can't OOB the speed table.
    uint8_t heldClass = miner.heldToolClass < TOOL_CLASS_COUNT ? miner.heldToolClass : TC_HAND;
    uint8_t heldTier = miner.heldToolTier <= TT_GOLD ? miner.heldToolTier : TT_GOLD;
    uint8_t mineClass = MAT_TOOLCLASS[m] < TOOL_CLASS_COUNT ? MAT_TOOLCLASS[m] : TC_NONE;
    // Dig is a universal tool: classPercent row is flat, so only DURABILITY
    // (via mineDurationFor) and tool tier affect dig time — not material type.
    power = (uint32_t)TOOL_CLASS_SPEED[heldClass * TOOL_CLASS_COUNT + mineClass] * TOOL_TIER_SPEED[heldTier] * 16u / (10000u * MINING_PROGRESS_DIVISOR);
    if (power == 0) power = 1;
    power *= imax(1, (int)speedMultiplier);
  }
  return power;
}
double ToolSystem::playerMineProgress(int id) {
  Player* p = E.psys.findPlayer(id);
  if (!p || !p->mineActive) return 0.0;
  double best = 0.0;
  auto consider = [&](int xx, int yy, uint32_t areaScale) {
    if (yy <= 0 || yy >= E.rows || xx <= 0 || xx >= E.cols - 1) return;
    int k = E.I(xx, yy);
    uint8_t m = E.L->grid[k];
    if (m == EMPTY || E.L->mineDamage[k] == 0) return;
    uint32_t dur = mineDurationFor(m, areaScale);
    if (dur == 0) return;
    uint32_t rem = E.L->mineDamage[k] > dur ? dur : E.L->mineDamage[k];
    double progress = 1.0 - (double)rem / (double)dur;
    if (progress > best) best = progress;
  };
  auto scanActiveLayer = [&]() {
    if (p->mineFootprint >= 0) {
      const SurvivalFootprint& fp = getSurvivalFootprint(p->mineFootprint);
      uint32_t areaScale = (uint32_t)imax(1, (int)fp.cells.size());
      for (const SurvivalFootprintCell& o : fp.cells) consider(p->mineX + (int)o.ox, p->mineY + (int)o.oy, areaScale);
    } else {
      for (int oy = -P_MINE_R; oy <= P_MINE_R; oy++) {
        for (int ox = -P_MINE_R; ox <= P_MINE_R; ox++) {
          if (ox * ox + oy * oy > P_MINE_R * P_MINE_R) continue;
          consider(p->mineX + ox, p->mineY + oy, 1);
        }
      }
    }
  };
  if (p->mineLayer == 2) {
    { Engine::ActiveLayerScope active(E, &E.fg); scanActiveLayer(); }
    { Engine::ActiveLayerScope active(E, &E.bg); scanActiveLayer(); }
  } else {
    Engine::ActiveLayerScope active(E, p->mineLayer ? &E.bg : &E.fg);
    scanActiveLayer();
  }
  return best;
}
// One mining hit on cell k (material m != EMPTY): apply damage scaled by the
// footprint area + tool speed; when the cell breaks, record the drop, destroy
// it (body-material invariant handled by destroyCellAt), and unstage it from
// the draft. Returns true when anything changed (it always does for m != EMPTY).
bool ToolSystem::mineDamageCellStep(int k, uint8_t m, const Player& miner, bool scaledSpeed, uint32_t areaScale, uint32_t speedMultiplier,
                        std::vector<int>& erasedStructural,
                        std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirtyBodies) {
  uint32_t dur = mineDurationFor(m, areaScale);
  if (dur > 0) {
    if (E.L->mineDamage[k] == 0 || E.L->mineDamage[k] > dur) E.L->mineDamage[k] = dur;
    E.L->mineDamageAny = true;
    uint32_t power = minePowerFor(m, miner, scaledSpeed, speedMultiplier);
    E.L->mineDamage[k] = E.L->mineDamage[k] > power ? E.L->mineDamage[k] - power : 0;
    if (E.L->mineDamage[k] > 0) return true;
  }
  uint8_t pt = E.materialEncodesPlantType(m) ? E.plantTypeFromMaterial(m) : PT_STANDARD;
  if (E.isPlantLeaf(m)) for (const Comp& c : E.L->components) {
    if (std::find(c.cells.begin(), c.cells.end(), k) != c.cells.end()) { pt = c.plantType; break; }
  }
  lastMinedCells.push_back({m, k, pt});
  destroyCellAt(k, m, erasedStructural, bodyById, dirtyBodies);
  E.L->mineDamage[k] = 0;
  draft.erase(k);
  return true;
}
int ToolSystem::mineDamageDisc(int cx, int cy, int radius, const Player& miner, bool scaledSpeed) {
  lastMinedCells.clear(); // this call's destroyed (material, cell) pairs -> mineDisc drops
  std::vector<int> erasedStructural; int changed = 0;
  std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
  for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue; int k = E.I(xx, yy); uint8_t m = E.L->grid[k]; if (m == EMPTY) { if (E.L->mineDamage[k]) { E.L->mineDamage[k] = 0; changed = 1; } continue; }
    if (mineDamageCellStep(k, m, miner, scaledSpeed, 1, 1, erasedStructural, bodyById, dirtyBodies)) changed = 1;
  } }
  E.rigid.finishErasedBodies(dirtyBodies, E.L->bodyCells);
  if (!lastMinedCells.empty()) E.L->skyDirty = true;
  if (changed) E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
  splitComponentsAfterDestroy(erasedStructural);
  return changed;
}
int ToolSystem::mineDamageFootprint(int cx, int cy, const SurvivalFootprint& fp, const Player& miner, bool scaledSpeed) {
  lastMinedCells.clear();
  std::vector<int> erasedStructural; int changed = 0;
  std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
  uint32_t areaScale = (uint32_t)imax(1, (int)fp.cells.size());
  uint32_t speedMultiplier = SURVIVAL_MINING_SPEED_MULTIPLIER;
  if (miner.heldToolClass == TC_DIG) speedMultiplier *= SURVIVAL_DIG_TOOL_SPEED_MULTIPLIER;
  for (const SurvivalFootprintCell& o : fp.cells) {
    int xx = cx + (int)o.ox, yy = cy + (int)o.oy;
    if (yy <= 0 || yy >= E.rows || xx <= 0 || xx >= E.cols - 1) continue;
    int k = E.I(xx, yy);
    uint8_t m = E.L->grid[k];
    if (m == EMPTY) {
      if (E.L->mineDamage[k]) { E.L->mineDamage[k] = 0; changed = 1; }
      continue;
    }
    if (mineDamageCellStep(k, m, miner, scaledSpeed, areaScale, speedMultiplier, erasedStructural, bodyById, dirtyBodies)) changed = 1;
  }
  E.rigid.finishErasedBodies(dirtyBodies, E.L->bodyCells);
  if (changed) {
    int x0, y0, x1, y1;
    survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1);
    if (!lastMinedCells.empty()) E.L->skyDirty = true;
    E.markDirtyRect(x0, y0, x1, y1);
  }
  splitComponentsAfterDestroy(erasedStructural);
  return changed;
}
int ToolSystem::addDiscToDraft(std::unordered_set<int>& cells, int cx, int cy, int radius, int yLimit) {
  int changed = 0;
  forEachClippedToolDiscCell(
    E.cols, E.rows, cx, cy, radius, yLimit, [&](int xx, int yy) {
      int k = E.I(xx, yy);
      if (E.L->grid[k] == EMPTY && !cells.count(k)) {
        cells.insert(k);
        changed = 1;
      }
    });
  if (changed) {
    ToolDiscBounds bounds = clippedToolDiscBounds(
      E.cols, E.rows, cx, cy, radius, yLimit);
    E.markDirtyRect(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
  }
  return changed;
}
int ToolSystem::addDiscStrokeToDraft(std::unordered_set<int>& d, int x0, int y0, int x1, int y1, int radius, int yLimit) {
  int changed = 0;
  strokeScan(x0, y0, x1, y1, imax(1, radius),
    [&](int x, int y) { changed |= addDiscToDraft(d, x, y, radius, yLimit); },
    [] { return true; });
  return changed;
}
int ToolSystem::addFootprintToDraftCapped(std::unordered_set<int>& d, int cx, int cy, const SurvivalFootprint& fp, int yLimit, int maxAdd, const Player* p) {
  int added = cappedOffsetScan(cx, cy, fp.cells, [](const SurvivalFootprintCell& o) { return std::pair<int, int>((int)o.ox, (int)o.oy); }, yLimit, maxAdd, p,
    [&](int k) { if (E.L->grid[k] != EMPTY || d.count(k)) return false; d.insert(k); return true; });
  if (added) {
    int x0, y0, x1, y1;
    survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1);
    E.markDirtyRect(x0, y0, x1, y1);
  }
  return added;
}
int ToolSystem::footprintStrokeSpacing(const SurvivalFootprint& fp) const {
  return imax(1, imin((int)fp.width, (int)fp.height));
}
int ToolSystem::addFootprintStrokeToDraftCapped(std::unordered_set<int>& d, int x0, int y0, int x1, int y1, const SurvivalFootprint& fp, int yLimit, int maxAdd, const Player* p) {
  if (maxAdd <= 0) return 0;
  int added = 0, remaining = maxAdd;
  strokeScan(x0, y0, x1, y1, footprintStrokeSpacing(fp),
    [&](int x, int y) { if (remaining <= 0) return; int n = addFootprintToDraftCapped(d, x, y, fp, yLimit, remaining, p); added += n; remaining -= n; },
    [&] { return remaining > 0; });
  return added;
}
int ToolSystem::placeMaterialAtFootprintStrokeCapped(int x0, int y0, int x1, int y1, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p) {
  if (maxCells <= 0) return 0;
  int placed = 0, remaining = maxCells;
  strokeScan(x0, y0, x1, y1, footprintStrokeSpacing(fp),
    [&](int x, int y) { if (remaining <= 0) return; int n = placeMaterialAtFootprintCapped(x, y, fp, mat, remaining, p); placed += n; remaining -= n; },
    [&] { return remaining > 0; });
  return placed;
}
// Fire and driftwood use a tighter brush than other creative materials.
int ToolSystem::brushFor(uint8_t m) { return (m == FIRE || m == DRIFTWOOD) ? 1 : 2; }
// Finalize a structural draft according to the support/contact state of each
// connected island.
void ToolSystem::finalizeDraft() {
  if (draft.empty()) return;
  std::vector<std::pair<int, int>> cells;
  cells.reserve(draft.size());
  for (int k : draft)
    if (E.L->grid[k] == EMPTY) cells.push_back({k % E.cols, k / E.cols});
  if (!cells.empty()) {
    E.L->skyDirty = true;
    finalizeStructuralPlacement(cells, draftMaterial);
  }
}
// Seeds occupy one cell.
bool ToolSystem::getSeedOrigin(int cx, int cy, int& x0, int& y0) {
  x0 = cx;
  y0 = cy;
  return x0 > 0 && y0 > 0 && x0 + 1 < E.cols && y0 + 1 <= E.rows;
}
bool ToolSystem::canPlaceSeedAt(int x0, int y0) {
  if (x0 <= 0 || y0 <= 0 || x0 + 1 >= E.cols || y0 + 1 > E.rows) return false;
  return E.L->grid[E.I(x0, y0)] == EMPTY;
}
bool ToolSystem::placeSeedAt(int x0, int y0) { return placeSeedAtTyped(x0, y0, PT_STANDARD); }
// Every seed enters through the rigid solver. Growth starts only after the seed
// reaches a stable raster and bakes into the component system.
bool ToolSystem::placeSeedAtTyped(int x0, int y0, uint8_t pt) {
  if (!canPlaceSeedAt(x0, y0)) return false;
  Body* body = E.rigid.finishSpawn({{x0, y0}}, E.plantSeedMat(pt), false);
  if (!body) return false;
  body->plantType = pt;
  E.L->skyDirty = true;
  E.markDirtyRect(x0 - 1, y0 - 1, x0 + 1, y0 + 1);
  return true;
}
bool ToolSystem::placeMyceliumSporeAt(int x0, int y0) {
  if (!canPlaceSeedAt(x0, y0)) return false;
  if (!E.rigid.finishSpawn({{x0, y0}}, MYCELIUM_SPORE, false)) return false;
  E.L->skyDirty = true;
  E.markDirtyRect(x0 - 1, y0 - 1, x0 + 1, y0 + 1);
  return true;
}

// Tool and pointer state machine. The engine maps normalized pointer input to
// aim cells and owns brush, draft, seed, cube, and throttle policy. A true return
// value means the draft preview changed.
int ToolSystem::effectiveTool() { return activeTool; }
bool ToolSystem::isPaintTool(int t) { return t == T_SAND || t == T_WATER || t == T_OIL || t == T_FIRE || t == T_ACID || t == T_LAVA; }
// The creative pointer flow routes by `creativeMode`. setTool maps the compact
// Tool enum used by survival and embedders onto the creative brush policy.
void ToolSystem::setTool(int tool) {
  activeTool = tool;
  switch (tool) {
    case T_ERASER: creativeMode = CM_ERASE; break;
    case T_CUBE: creativeMode = CM_CUBE; break;
    case T_SEED: creativeMode = CM_SEED; creativeSeed = PT_STANDARD; break;
    case T_STONE: creativeMode = CM_DRAFT; draftMaterial = STONE; break;
    case T_ICE: creativeMode = CM_DRAFT; draftMaterial = ICE; break;
    case T_DRIFTWOOD: creativeMode = CM_DRAFT; draftMaterial = DRIFTWOOD; break;
    case T_SAND: creativeMode = CM_PAINT; creativeMaterial = SAND; break;
    case T_WATER: creativeMode = CM_PAINT; creativeMaterial = WATER; break;
    case T_OIL: creativeMode = CM_PAINT; creativeMaterial = OIL; break;
    case T_FIRE: creativeMode = CM_PAINT; creativeMaterial = FIRE; break;
    case T_ACID: creativeMode = CM_PAINT; creativeMaterial = ACID; break;
    case T_LAVA: creativeMode = CM_PAINT; creativeMaterial = LAVA; break;
  }
}
// The searchable creative palette path selects any material, seed species,
// eraser, or cube. MAT_PLACEMENT routes structural drafts, loose paint, and
// erasure; seed metadata selects the species-aware seed flow.
void ToolSystem::setCreativeMaterial(int kind, int value) {
  switch (kind) {
    case CK_MATERIAL: {
      if (!isMaterialId(value)) return;
      uint8_t m = (uint8_t)value;
      if (MAT_PLACEMENT[m] == MP_ERASE) creativeMode = CM_ERASE;
      else if (E.isSeedMaterial(m)) { creativeMode = CM_SEED; creativeSeed = E.plantTypeFromMaterial(m); creativeMaterial = m; }
      else if (m == MYCELIUM_SPORE) { creativeMode = CM_MYCELIUM_SPORE; creativeMaterial = m; }
      else if (MAT_PLACEMENT[m] == MP_STRUCTURE) { creativeMode = CM_DRAFT; draftMaterial = m; creativeMaterial = m; }
      else { creativeMode = CM_PAINT; creativeMaterial = m; }
      // Remember the last SOLID for the CUBE tool so it spawns a body of that material.
      // Any component (stone/ore/brick/ice/TNT, and the plant family: wood/plant/
      // driftwood/cactus/…) qualifies, plus the permanent RIGID. Powders/liquids/gases
      // can't be free bodies (settle would flow a powder body's cells apart). Stone &
      // ice bodies bake into terrain on rest (bodySolidifies); the rest — like the
      // driftwood-style materials stay free bodies and keep tumbling or floating.
      if (MAT_PLACEMENT[m] == MP_STRUCTURE) cubeMaterial = m;
      break;
    }
    case CK_SEED:
      if (value < 0 || value >= PLANT_SPECIES_COUNT) return;
      creativeMode = CM_SEED; creativeSeed = (uint8_t)value;
      creativeMaterial = E.plantSeedMat(creativeSeed); break;
    case CK_ERASER: creativeMode = CM_ERASE; break;
    case CK_CUBE: creativeMode = CM_CUBE; break;
    case CK_CREATURE:
      if (value >= 0 && value < CS_COUNT) { creativeMode = CM_CREATURE; creativeCreature = (uint8_t)value; }
      break;
  }
}

// When the world buffer slides under an active draft, remap the staged cells by
// the same per-cell delta as the grid and component shift so the preview and
// finalized solid stay pinned to their world location.
void ToolSystem::remapDraftForShift(std::unordered_set<int>& d, int dx, int dy) {
  if (d.empty()) return;
  std::unordered_set<int> moved; moved.reserve(d.size());
  for (int k : d) { int nx = (k % E.cols) - dx, ny = (k / E.cols) - dy; if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue; moved.insert(ny * E.cols + nx); }
  d.swap(moved);
}
void ToolSystem::remapDraftsForShift(int dx, int dy) {
  if (!dx && !dy) return;
  remapDraftForShift(draft, dx, dy);
  if (draftStrokeActive) {
    lastDraftCx -= dx; lastDraftCy -= dy;
    if (lastDraftCx < 0 || lastDraftCx >= E.cols || lastDraftCy < 0 || lastDraftCy >= E.rows) draftStrokeActive = false;
  }
  if (hasSeedOrigin) { seedOriginX -= dx; seedOriginY -= dy; // seed origin is a buffer-space cell; same delta
    if (seedOriginX < 0 || seedOriginX + 1 > E.cols || seedOriginY < 0 || seedOriginY + 1 > E.rows) hasSeedOrigin = false; }
}
void ToolSystem::remapEmitStrokeForShift(int dx, int dy) {
  if (!emitStrokeActive || (!dx && !dy)) return;
  lastEmitCx -= dx; lastEmitCy -= dy;
  if (lastEmitCx < 0 || lastEmitCx >= E.cols || lastEmitCy < 0 || lastEmitCy >= E.rows) emitStrokeActive = false;
}

int ToolSystem::updateSeedDraft(int cx, int cy) {
  int nx, ny; bool ok = getSeedOrigin(cx, cy, nx, ny);
  bool changed = (ok != hasSeedOrigin) || (ok && (nx != seedOriginX || ny != seedOriginY));
  hasSeedOrigin = ok; if (ok) { seedOriginX = nx; seedOriginY = ny; }
  return changed ? 1 : 0;
}
// Extend the active component draft / seed preview into draftLayer.
int ToolSystem::continueDrafts(int cx, int cy) {
  if (!drafting && !draftingSeed) return 0;
  Engine::ActiveLayerScope active(E, draftLayer ? &E.bg : &E.fg);
  int changed = 0;
  if (drafting) {
    int sx = draftStrokeActive ? lastDraftCx : cx, sy = draftStrokeActive ? lastDraftCy : cy;
    if (addDiscStrokeToDraft(draft, sx, sy, cx, cy, brushFor(draftMaterial), draftMaterial == ICE ? E.rows - 1 : E.rows)) changed = 1;
    lastDraftCx = cx; lastDraftCy = cy; draftStrokeActive = true;
  }
  if (draftingSeed) { changed |= updateSeedDraft(cx, cy); }
  return changed;
}
int ToolSystem::pointerDraft(int cx, int cy) { return continueDrafts(cx, cy); }

// LMB acts on the foreground, RMB on the background. Paint/erase are continuous
// (emitHeldTool while held); draft/cube/seed act on this press into the chosen layer.
int ToolSystem::pointerDown(int cx, int cy, int button) {
  if (button != 0 && button != 2) return 0;
  bool toBg = (button == 2);
  if (toBg) { rmbDown = true; E.bgEnabled = true; } else lmbDown = true;
  if (creativeMode == CM_PAINT || creativeMode == CM_ERASE) return 0; // continuous
  draftLayer = toBg ? 1 : 0;
  Engine::ActiveLayerScope active(E, toBg ? &E.bg : &E.fg);
  int changed = 0;
  switch (creativeMode) {
    case CM_DRAFT:
      drafting = true; lastDraftCx = cx; lastDraftCy = cy; draftStrokeActive = true;
      if (addDiscToDraft(draft, cx, cy, brushFor(draftMaterial), draftMaterial == ICE ? E.rows - 1 : E.rows)) changed = 1;
      break;
    case CM_SEED:
    case CM_MYCELIUM_SPORE: draftingSeed = true; changed |= updateSeedDraft(cx, cy); break;
    case CM_CUBE:
      if (E.rigid.spawnBox(cx, cy, CUBE_HALF, CUBE_HALF, cubeMaterial))
        E.audio.emit(SE_PLACE, cx, cy, 1.0, cubeMaterial, toBg ? 1 : 0);
      break; // RIGID by default; a selected component solid spawns a material body that bakes or reacts
    case CM_CREATURE: {
      const CreatureSpecies& s = CREATURE_SPECIES[creativeCreature];
      double wx = E.fg.worldOffsetX + cx - s.w * 0.5;
      double wy = E.fg.worldOffsetY + cy - s.h * 0.5;
      E.creatures.spawnCreature(creativeCreature, wx, wy, false);
      E.audio.emit(SE_CREATURE, cx, cy, 0.55, creativeCreature, toBg ? 1 : 0);
      break;
    }
    default: break;
  }
  return changed;
}
// Releasing all buttons ends the active stroke, so the next press starts
// fresh instead of interpolating a paint/erase line from the previous stroke.
void ToolSystem::pointerButtons(int buttons) { if (buttons == 0) { rmbDown = false; lmbDown = false; emitStrokeActive = false; } }
int ToolSystem::pointerUp(int button) {
  if (button == 2) rmbDown = false;
  if (button == 0) lmbDown = false;
  if (!lmbDown && !rmbDown) emitStrokeActive = false; // stroke ended -> next press restarts it
  bool ownerReleased = (draftLayer == 1) ? (button == 2) : (button == 0);
  if (!ownerReleased) return 0;
  int changed = 0;
  Engine::ActiveLayerScope active(E, draftLayer ? &E.bg : &E.fg);
  if (drafting) {
    uint8_t placedMaterial = draftMaterial;
    finalizeDraft(); drafting = false; draftStrokeActive = false; draft.clear(); changed = 1;
    E.audio.emit(SE_PLACE, lastDraftCx, lastDraftCy, 0.9, placedMaterial, draftLayer);
  }
  if (draftingSeed) {
    if (hasSeedOrigin) {
      bool placed = creativeMode == CM_MYCELIUM_SPORE
        ? placeMyceliumSporeAt(seedOriginX, seedOriginY)
        : placeSeedAtTyped(seedOriginX, seedOriginY, creativeSeed);
      if (placed) E.audio.emit(SE_PLACE, seedOriginX, seedOriginY, 0.6,
                               creativeMode == CM_MYCELIUM_SPORE ? MYCELIUM_SPORE : E.plantSeedMat(creativeSeed), draftLayer);
    }
    draftingSeed = false; hasSeedOrigin = false; changed = 1;
  }
  return changed;
}
// Apply one continuous paint/erase emit at (cx,cy) on the ACTIVE layer.
void ToolSystem::emitToolAt(int cx, int cy) {
  if (creativeMode == CM_ERASE) { eraseDisc(cx, cy, BRUSH_ERASE); return; }
  if (creativeMode != CM_PAINT) return;
  uint8_t m = creativeMaterial;
  if (E.isLooseSolidMaterial(m) && E.L->grid[E.I(cx, cy)] != EMPTY) return; // don't stack powder on a filled cell
  paintDisc(cx, cy, brushFor(m), m, false);
}
// Apply the brush along the LINE from (x0,y0) to (x1,y1) on one layer, so a fast
// pointer drag between throttled emits paints/erases a continuous stroke instead of
// leaving gaps. Erase uses an exact capsule footprint, avoiding stamp aliasing when
// the camera is moving and avoiding per-cell hash-table churn.
void ToolSystem::emitStrokeLayer(int x0, int y0, int x1, int y1, bool toBg) {
  Engine::ActiveLayerScope active(E, toBg ? &E.bg : &E.fg);
  int rad = (creativeMode == CM_ERASE) ? BRUSH_ERASE : brushFor(creativeMaterial);
  int spacing = imax(1, rad);
  if (creativeMode == CM_ERASE) {
    std::vector<int> cells;
    int minX = imax(1, imin(x0, x1) - rad), minY = imax(1, imin(y0, y1) - rad);
    int maxX = imin(E.cols - 2, imax(x0, x1) + rad), maxY = imin(E.rows - 1, imax(y0, y1) + rad);
    if (maxX >= minX && maxY >= minY) {
      cells.reserve((size_t)(maxX - minX + 1) * (size_t)(maxY - minY + 1));
      double vx = (double)(x1 - x0), vy = (double)(y1 - y0);
      double len2 = vx * vx + vy * vy, r2 = (double)rad * rad + 0.25;
      for (int yy = minY; yy <= maxY; yy++) for (int xx = minX; xx <= maxX; xx++) {
        double dx = (double)xx - x0, dy = (double)yy - y0;
        double t = len2 > 0 ? (dx * vx + dy * vy) / len2 : 0.0;
        if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
        double px = x0 + vx * t, py = y0 + vy * t;
        double ex = (double)xx - px, ey = (double)yy - py;
        if (ex * ex + ey * ey <= r2) cells.push_back(E.I(xx, yy));
      }
    }
    eraseStrokeCells(cells, minX, minY, maxX, maxY);
  } else {
    strokeScan(x0, y0, x1, y1, spacing, [&](int x, int y) { emitToolAt(x, y); }, [] { return true; });
  }
}
// Continuous painting while held, throttled. LMB paints the foreground; RMB the
// background. Draft/cube/seed act on click. Survival mining is separate (player.inc).
void ToolSystem::emitHeldTool(int cx, int cy, double now, bool inside, bool drawMode) {
  if (!inside || !drawMode || !(creativeMode == CM_PAINT || creativeMode == CM_ERASE) || (!lmbDown && !rmbDown)) {
    emitStrokeActive = false; // stroke ended (released / left / non-continuous tool)
    return;
  }
  if (now - lastEmitMs < EMIT_INTERVAL_MS) return;
  if (cx < 0 || cx >= E.cols || cy < 0 || cy >= E.rows) return;
  // Interpolate from the previous emit cell; on a fresh stroke start at the current cell.
  int sx = emitStrokeActive ? lastEmitCx : cx, sy = emitStrokeActive ? lastEmitCy : cy;
  if (lmbDown) emitStrokeLayer(sx, sy, cx, cy, false);
  if (rmbDown) { E.bgEnabled = true; emitStrokeLayer(sx, sy, cx, cy, true); }
  uint8_t eventType = creativeMode == CM_ERASE ? SE_BREAK : SE_PLACE;
  uint8_t eventMaterial = creativeMode == CM_ERASE ? EMPTY : creativeMaterial;
  if (lmbDown) E.audio.emit(eventType, cx, cy, 0.35, eventMaterial, 0);
  if (rmbDown) E.audio.emit(eventType, cx, cy, 0.28, eventMaterial, 1);
  lastEmitCx = cx; lastEmitCy = cy; emitStrokeActive = true;
  lastEmitMs = now;
}
// Per fixed step: extend active drafts + apply held painting. Returns 1 if the
// draft preview changed.
int ToolSystem::applyTool(int cx, int cy, double now, bool inside, bool drawMode) {
  if (!inside && drafting) draftStrokeActive = false;
  int changed = inside ? continueDrafts(cx, cy) : 0;
  emitHeldTool(cx, cy, now, inside, drawMode);
  return changed;
}
