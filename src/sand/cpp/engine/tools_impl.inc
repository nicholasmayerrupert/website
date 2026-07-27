// Shared capped scan for the per-pixel placement/staging economy: walk `offs`
// (nearest-to-center-first) as (ox,oy) offsets from (cx,cy), skip out-of-bounds
// cells and the player's own AABB, and invoke act(k) until `cap` cells acted
// (act returns whether it consumed a cell). getOff maps an element to (ox,oy).
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
// Per-pixel placement: write at most `maxCells` cells, NEAREST-TO-CENTER first, so
// an inventory stack places exactly as many pixels as it can afford. Deterministic
// (static distance-sorted offset order). Returns cells written. EMPTY erases (no cap).
// Optional `p` excludes the player's own AABB cell-by-cell (mirrors
// addDiscToDraftCapped) so a build disc that grazes the player still places its
// non-overlapping cells instead of being rejected wholesale — you can build right
// up against yourself and hold to place continuously without trapping the body.

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
    o[FP_ID] = fp.id;
    o[FP_WIDTH] = fp.width;
    o[FP_HEIGHT] = fp.height;
    o[FP_CELL_COUNT] = (int32_t)fp.cells.size();
    o[FP_ANCHOR_X] = fp.anchorX;
    o[FP_ANCHOR_Y] = fp.anchorY;
  }
  return (int)survivalFootprints.size();
}
void ToolSystem::setSelectedFootprint(Player& p, int id) {
  int next = clampSurvivalFootprintId(id);
  if (p.selectedFootprint == next) return;
  p.selectedFootprint = next;
  p.placeStrokeActive = false;
  E.resetPlayerMine(p);
}
void ToolSystem::setSelectedFootprint(int id, int footprintId) { Player* p = E.findPlayer(id); if (p) setSelectedFootprint(*p, footprintId); }
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
  int changed = 0;
  std::vector<int> erasedStructural;
  std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
  bool destroyedAny = false;
  for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue; int k = E.I(xx, yy); if ((overwrite || E.L->grid[k] == EMPTY) && E.L->grid[k] != material) {
    uint8_t old = E.L->grid[k];
    // Overwriting a component or body cell must free it from its owner first,
    // or the comp/body keeps an invisible phantom cell (the component-cell
    // destroy invariant — found by the --dev validator via overwrite paints).
    if (old != EMPTY && (E.isComponentMaterial(old) || E.isBodyCell(k))) {
      destroyCellAt(k, old, erasedStructural, bodyById, dirtyBodies);
      destroyedAny = true;
    }
    E.noteLooseGroundTouch2(old, material);
    E.L->grid[k] = material; changed++;
  } } }
  if (destroyedAny) {
    E.finishErasedBodies(dirtyBodies, E.L->bodyCells);
    splitComponentsAfterDestroy(erasedStructural);
  }
  if (changed) E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
  return changed;
}
// Generic material placement by id — the inventory-forward path. Loose media
// paint as cells; structural materials spawn as bodies and fall until they make
// grounded contact and bake. EMPTY erases.
int ToolSystem::placeMaterialAt(int cx, int cy, int radius, uint8_t mat) {
  if (mat == EMPTY) return eraseDisc(cx, cy, radius);
  if (!E.isComponentMaterial(mat)) return paintDisc(cx, cy, radius, mat, false);
  std::vector<std::pair<int, int>> cells;
  for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue;
    for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue;
      int k = E.I(xx, yy); if (E.L->grid[k] == EMPTY) cells.push_back({xx, yy}); } }
  if (cells.empty()) return 0;
  E.L->skyDirty = true;
  E.finishSpawn(cells, mat);
  return (int)cells.size();
}
// Shared component registration for runtime structural edits. Exact material
// traits supply growth/reaction behavior; physical storage is unified.
void ToolSystem::registerComponentCells(uint8_t mat, std::unordered_set<int>& cells) {
  if (cells.empty()) return;
  if (mat == SEED || mat == MYCELIUM_SPORE) E.comps.jointSleepBlocked = true;
  E.registerRigidCellsSplit(E.L->components, E.L->nextComponentId, mat, cells,
                            E.isIceMaterial(mat));
  if (mat == MYCELIUM_SPORE) {
    E.L->myceliumActive = true;
    E.L->myceliumSporePresent = true;
  }
  if (mat == SEED || mat == MYCELIUM_SPORE) {
    for (auto& component : E.L->components) {
      for (int k : cells) {
        if (std::find(component.cells.begin(), component.cells.end(), k) == component.cells.end()) continue;
        component.growing = true;
        component.cacheDirty = true;
        if (mat == SEED) component.requiresCellGrounding = true;
        break;
      }
    }
  }
}
int ToolSystem::placeMaterialAtCapped(int cx, int cy, int radius, uint8_t mat, int maxCells, const Player* p) {
  if (mat == EMPTY) return eraseDisc(cx, cy, radius);
  bool comp = E.isComponentMaterial(mat);
  std::vector<std::pair<int, int>> cells;
  int placed = cappedOffsetScan(cx, cy, discOffsets(radius), [](const std::pair<int, int>& o) { return o; }, E.rows, maxCells, p,
    [&](int k) {
      if (E.L->grid[k] != EMPTY) return false;
      if (comp) cells.push_back({k % E.cols, k / E.cols});
      else E.writeGridIndex(k, mat);
      return true;
    });
  if (placed) { E.L->skyDirty = true; E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius); }
  if (comp) E.finishSpawn(cells, mat);
  return placed;
}
int ToolSystem::placeMaterialAtFootprintCapped(int cx, int cy, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p) {
  bool comp = E.isComponentMaterial(mat);
  std::vector<std::pair<int, int>> cells;
  int placed = cappedOffsetScan(cx, cy, fp.cells, [](const SurvivalFootprintCell& o) { return std::pair<int, int>((int)o.ox, (int)o.oy); }, E.rows, maxCells, p,
    [&](int k) {
      if (E.L->grid[k] != EMPTY) return false;
      if (comp) cells.push_back({k % E.cols, k / E.cols});
      else E.writeGridIndex(k, mat);
      return true;
    });
  if (placed) {
    int x0, y0, x1, y1;
    survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1);
    E.markDirtyRect(x0, y0, x1, y1);
  }
  if (comp) E.finishSpawn(cells, mat);
  return placed;
}
// Disc cell offsets ordered by distance from center (cached per radius). Tie-break
// on (oy,ox) keeps the order stable/deterministic across calls and peers.
const std::vector<std::pair<int, int>>& ToolSystem::discOffsets(int radius) {
  auto it = discOffsetCache.find(radius);
  if (it != discOffsetCache.end()) return it->second;
  std::vector<std::pair<int, int>> offs;
  for (int oy = -radius; oy <= radius; oy++) for (int ox = -radius; ox <= radius; ox++) if (ox * ox + oy * oy <= radius * radius) offs.push_back({ox, oy});
  std::stable_sort(offs.begin(), offs.end(), [](const std::pair<int, int>& a, const std::pair<int, int>& b) {
    int da = a.first * a.first + a.second * a.second, db = b.first * b.first + b.second * b.second;
    if (da != db) return da < db; if (a.second != b.second) return a.second < b.second; return a.first < b.first; });
  return discOffsetCache.emplace(radius, std::move(offs)).first->second;
}
// ---- shared destroy/erase plumbing ----
// Destroy the (non-EMPTY) cell at k with material m: a body cell routes to the
// body eraser, a static cell is classified for the component split and cleared.
// body-material invariant: body cells hold their real material; the body system
// erases them, the component-split system erases static cells.
void ToolSystem::destroyCellAt(int k, uint8_t m, std::vector<int>& erasedStructural,
                   std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirtyBodies) {
  E.noteLooseGroundTouch(m);
  if (E.isBodyCell(k)) {
    if (bodyById.empty()) for (Body* b : E.L->bodies) bodyById[b->id] = b;
    if (!E.eraseBodyCellIndex(k, bodyById, dirtyBodies)) { E.L->grid[k] = EMPTY; E.L->bodyOwner[k] = -1; }
  } else {
    if (E.isComponentMaterial(m)) erasedStructural.push_back(k);
    E.L->grid[k] = EMPTY;
  }
}
// Component-split epilogue shared by every destroy path (eraser, stroke
// eraser, both mining paths).
void ToolSystem::splitComponentsAfterDestroy(std::vector<int>& erasedStructural) {
  E.splitRigidAfterErase(E.L->components, erasedStructural, E.L->nextComponentId, false);
}
// Returns the NUMBER OF GRID CELLS cleared (non-EMPTY -> EMPTY). Body/draft-only
// erases still mark dirty but don't count toward the cleared total.
int ToolSystem::eraseDisc(int cx, int cy, int radius) {
  std::vector<int> erasedStructural; bool changed = false; int cleared = 0;
  std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
  for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue; int k = E.I(xx, yy);
    if (E.isBodyCell(k)) { destroyCellAt(k, E.L->grid[k], erasedStructural, bodyById, dirtyBodies); changed = true; }
    else if (E.L->grid[k] != EMPTY) { destroyCellAt(k, E.L->grid[k], erasedStructural, bodyById, dirtyBodies); changed = true; cleared++; }
    if (draft.erase(k)) changed = true;
  } }
  E.finishErasedBodies(dirtyBodies, E.L->bodyCells);
  if (changed) E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
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
  E.finishErasedBodies(dirtyBodies, E.L->bodyCells);
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
  Player* p = E.findPlayer(id);
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
    E.useLayer(&E.fg);
    scanActiveLayer();
    E.useLayer(&E.bg);
    scanActiveLayer();
  } else {
    E.useLayer(p->mineLayer ? &E.bg : &E.fg);
    scanActiveLayer();
  }
  E.useLayer(&E.fg);
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
  uint8_t pt = PT_OAK;
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
  E.finishErasedBodies(dirtyBodies, E.L->bodyCells);
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
  E.finishErasedBodies(dirtyBodies, E.L->bodyCells);
  if (changed) {
    int x0, y0, x1, y1;
    survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1);
    if (!lastMinedCells.empty()) E.L->skyDirty = true;
    E.markDirtyRect(x0, y0, x1, y1);
  }
  splitComponentsAfterDestroy(erasedStructural);
  return changed;
}
int ToolSystem::addDiscToDraft(std::unordered_set<int>& draft, int cx, int cy, int radius, int yLimit) {
  int changed = 0;
  for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= yLimit) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue; int k = E.I(xx, yy); if (E.L->grid[k] == EMPTY && !draft.count(k)) { draft.insert(k); changed = 1; } } }
  if (changed) E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
  return changed;
}
// Survival draft: stage up to `maxAdd` NEW empty cells (nearest-center first) into the
// draft, skipping the player's own AABB (so you don't build on yourself). Returns the
// number staged — the caller consumes that many inventory units as the preview grows.
int ToolSystem::addDiscToDraftCapped(std::unordered_set<int>& d, int cx, int cy, int radius, int yLimit, int maxAdd, const Player* p) {
  int added = cappedOffsetScan(cx, cy, discOffsets(radius), [](const std::pair<int, int>& o) { return o; }, yLimit, maxAdd, p,
    [&](int k) { if (E.L->grid[k] != EMPTY || d.count(k)) return false; d.insert(k); return true; });
  if (added) E.markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
  return added;
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
// Finalize a structural draft as one body. The body keeps its exact material,
// falls through the rigid solver, and later bakes on grounded contact.
void ToolSystem::finalizeDraft() {
  if (draft.empty()) return;
  std::vector<std::pair<int, int>> cells;
  cells.reserve(draft.size());
  for (int k : draft)
    if (E.L->grid[k] == EMPTY) cells.push_back({k % E.cols, k / E.cols});
  if (!cells.empty()) {
    E.L->skyDirty = true;
    E.finishSpawn(cells, draftMaterial);
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
// Place a seed of a given species. The comp carries the plantType so growth.inc
// dispatches the right shape/material; the grown wood material then re-encodes
// the type so it survives streaming.
bool ToolSystem::placeSeedAtTyped(int x0, int y0, uint8_t pt) {
  if (!canPlaceSeedAt(x0, y0)) return false;
  // Growth runs before joint grounding and can finish a newly placed seed in
  // that first tick. Latch here so the sleeping path cannot miss the transient.
  E.comps.jointSleepBlocked = true;
  Comp c; c.id = E.L->nextComponentId++; c.yMax = 0; c.age = 0; c.cacheDirty = true; c.plantType = pt; c.growing = true; c.requiresCellGrounding = true;
  { int k = E.I(x0, y0); E.L->grid[k] = SEED; c.cells.push_back(k); c.yMax = y0; } // fresh component, one cell
  E.L->components.push_back(std::move(c));
  E.L->skyDirty = true;
  E.markDirtyRect(x0 - 1, y0 - 1, x0 + 1, y0 + 1);
  return true;
}
bool ToolSystem::placeMyceliumSporeAt(int x0, int y0) {
  if (!canPlaceSeedAt(x0, y0)) return false;
  E.comps.jointSleepBlocked = true;
  Comp c; c.id = E.L->nextComponentId++; c.yMax = y0; c.age = 0; c.growing = true;
  int k = E.I(x0, y0);
  E.L->grid[k] = MYCELIUM_SPORE;
  c.cells.push_back(k);
  E.L->components.push_back(std::move(c));
  E.L->myceliumActive = true;
  E.L->myceliumSporePresent = true;
  E.L->groundDirty = true;
  E.L->skyDirty = true;
  E.markDirtyRect(x0 - 1, y0 - 1, x0 + 1, y0 + 1);
  return true;
}

// Tool and pointer state machine. The engine maps normalized pointer input to
// aim cells and owns brush, draft, seed, cube, and throttle policy. A true return
// value means the draft preview changed.
int ToolSystem::effectiveTool() { return activeTool; }
bool ToolSystem::isPaintTool(int t) { return t == T_SAND || t == T_WATER || t == T_OIL || t == T_FIRE || t == T_ACID || t == T_LAVA; }
// The creative pointer flow routes by `creativeMode`. setTool keeps the legacy Tool
// enum working (survival eraser + back-compat) by mapping it onto the creative brush.
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
// The searchable creative palette path: select ANY material, seed species, eraser,
// or cube. Routes by the material's kind — components and RIGID draft (live
// preview), the rest paint; EMPTY maps to the eraser.
void ToolSystem::setCreativeMaterial(int kind, int value) {
  switch (kind) {
    case CK_MATERIAL: {
      uint8_t m = (uint8_t)value;
      if (m == EMPTY) creativeMode = CM_ERASE;
      else if (m == RIGID) { creativeMode = CM_DRAFT; draftMaterial = RIGID; creativeMaterial = m; }
      else if (m == SEED) { creativeMode = CM_SEED; creativeSeed = PT_STANDARD; creativeMaterial = m; }
      else if (m == MYCELIUM_SPORE) { creativeMode = CM_MYCELIUM_SPORE; creativeMaterial = m; }
      else if (E.isComponentMaterial(m)) { creativeMode = CM_DRAFT; draftMaterial = m; creativeMaterial = m; }
      else { creativeMode = CM_PAINT; creativeMaterial = m; }
      // Remember the last SOLID for the CUBE tool so it spawns a body of that material.
      // Any component (stone/ore/brick/ice/TNT, and the plant family: wood/plant/
      // driftwood/cactus/…) qualifies, plus the permanent RIGID. Powders/liquids/gases
      // can't be free bodies (settle would flow a powder body's cells apart). Stone &
      // ice bodies bake into terrain on rest (bodySolidifies); the rest — like the
      // existing driftwood float — stay free bodies (a wood body tumbles/floats forever).
      if (m == RIGID || E.isComponentMaterial(m)) cubeMaterial = m;
      break;
    }
    case CK_SEED: creativeMode = CM_SEED; creativeSeed = (uint8_t)value; break;
    case CK_ERASER: creativeMode = CM_ERASE; break;
    case CK_CUBE: creativeMode = CM_CUBE; break;
    case CK_CREATURE:
      if (value >= 0 && value < CS_COUNT) { creativeMode = CM_CREATURE; creativeCreature = (uint8_t)value; }
      break;
  }
}

// When the world buffer slides under an active draft, remap the staged cells by
// the SAME per-cell delta the grid uses (decode x/y, x-=dx, y-=dy, re-encode),
// mirroring translateComponents/shiftRowMajorU8 so the preview + finalized solid
// stay pinned to their world location instead of jolting with the buffer.
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
  E.useLayer(draftLayer ? &E.bg : &E.fg);
  int changed = 0;
  if (drafting) {
    int sx = draftStrokeActive ? lastDraftCx : cx, sy = draftStrokeActive ? lastDraftCy : cy;
    if (addDiscStrokeToDraft(draft, sx, sy, cx, cy, brushFor(draftMaterial), draftMaterial == ICE ? E.rows - 1 : E.rows)) changed = 1;
    lastDraftCx = cx; lastDraftCy = cy; draftStrokeActive = true;
  }
  if (draftingSeed) { changed |= updateSeedDraft(cx, cy); }
  E.useLayer(&E.fg);
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
  E.useLayer(toBg ? &E.bg : &E.fg);
  int changed = 0;
  switch (creativeMode) {
    case CM_DRAFT:
      drafting = true; lastDraftCx = cx; lastDraftCy = cy; draftStrokeActive = true;
      if (addDiscToDraft(draft, cx, cy, brushFor(draftMaterial), draftMaterial == ICE ? E.rows - 1 : E.rows)) changed = 1;
      break;
    case CM_SEED:
    case CM_MYCELIUM_SPORE: draftingSeed = true; changed |= updateSeedDraft(cx, cy); break;
    case CM_CUBE:
      if (E.spawnBox(cx, cy, CUBE_HALF, CUBE_HALF, cubeMaterial))
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
  E.useLayer(&E.fg);
  return changed;
}
// Track button release (mirrors the old buttons==0 reset on move/up). Releasing
// all buttons ends the active stroke, so the NEXT press starts a fresh stroke
// instead of interpolating a paint/erase line from the previous stroke's last
// emit cell (which would draw across whatever lies between two separate clicks).
void ToolSystem::pointerButtons(int buttons) { if (buttons == 0) { rmbDown = false; lmbDown = false; emitStrokeActive = false; } }
int ToolSystem::pointerUp(int button) {
  if (button == 2) rmbDown = false;
  if (button == 0) lmbDown = false;
  if (!lmbDown && !rmbDown) emitStrokeActive = false; // stroke ended -> next press restarts it
  bool ownerReleased = (draftLayer == 1) ? (button == 2) : (button == 0);
  if (!ownerReleased) return 0;
  int changed = 0;
  E.useLayer(draftLayer ? &E.bg : &E.fg);
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
                               creativeMode == CM_MYCELIUM_SPORE ? MYCELIUM_SPORE : SEED, draftLayer);
    }
    draftingSeed = false; hasSeedOrigin = false; changed = 1;
  }
  E.useLayer(&E.fg);
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
  E.useLayer(toBg ? &E.bg : &E.fg);
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
  if (toBg) E.useLayer(&E.fg);
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
