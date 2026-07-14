// ItemSystem method bodies (need the full Engine definition; see items.hpp).

// Dropped items and particles.
//
// Entities, NOT grid cells. An IT_ITEM is a Starbound-style surface sprite: it
// falls, rests ON TOP of solids, NEVER stays buried (rises out if covered), passes
// freely through other items (no stacking), and MAGNETS toward a nearby player
// until collected. IT_PARTICLE is cosmetic mining debris. They never write the grid,
// never go through the tile store, and use NO rand() — so worldgen prefetch
// byte-identicality and the sim RNG stream are untouched (determinism invariant).

int ItemSystem::itemCell(const Item& it) { int x = (int)std::floor(it.px), y = (int)std::floor(it.py); return y * E.cols + x; }
// A grid cell is "solid" to an item exactly as it is to a player (settled powder +
// rigids block; liquids/gas/empty do not). Below the buffer = floor.
bool ItemSystem::itemGridSolid(int x, int y) {
  if (y >= E.rows) return true;
  if (y < 0 || x < 0 || x >= E.cols) return false;
  return E.isSolidForPlayer(E.L->grid[E.I(x, y)]);
}
bool ItemSystem::itemCellLiquidAt(int x, int y) {
  if (y < 0 || y >= E.rows || x < 0 || x >= E.cols) return false;
  return E.isLiquidMaterial(E.L->grid[E.I(x, y)]);
}

// Fall vertically, stopping just above the first cell below that supports the item.
// `floats` (dropped/mined items) treats a LIQUID surface as a floor too, so the item
// rests ON TOP of water/oil/acid/lava instead of sinking through it. Cosmetic
// particles pass `floats=false` and still splash down through fluids.
void ItemSystem::moveItemY(Item& it, bool floats) {
  double mag = std::fabs(it.vy); if (mag < 1e-6) return;
  double dir = it.vy > 0 ? 1.0 : -1.0, moved = 0;
  int ix = (int)std::floor(it.px);
  while (moved < mag - 1e-6) {
    double step = (mag - moved < IT_MOVE_SUBSTEP) ? (mag - moved) : IT_MOVE_SUBSTEP;
    double ny = it.py + dir * step;
    int curIy = (int)std::floor(it.py), nextIy = (int)std::floor(ny);
    bool blocked = itemGridSolid(ix, nextIy) || (floats && dir > 0 && itemCellLiquidAt(ix, nextIy));
    if (nextIy != curIy && blocked) {
      if (dir > 0) it.py = nextIy - 1e-3; else it.py = curIy + 1e-3;
      it.vy = 0; return;
    }
    it.py = ny; moved += step;
    if (it.py < 0) { it.py = 0; it.vy = 0; return; }
  }
}
void ItemSystem::moveItemX(Item& it) {
  if (std::fabs(it.vx) < 1e-6) return;
  double mag = std::fabs(it.vx), dir = it.vx > 0 ? 1.0 : -1.0, moved = 0;
  int iy = (int)std::floor(it.py);
  while (moved < mag - 1e-6) {
    double step = (mag - moved < IT_MOVE_SUBSTEP) ? (mag - moved) : IT_MOVE_SUBSTEP;
    double nx = it.px + dir * step;
    int curIx = (int)std::floor(it.px), nextIx = (int)std::floor(nx);
    if ((nextIx != curIx && itemGridSolid(nextIx, iy)) || nx < 0 || nx >= E.cols) { it.vx = 0; return; }
    it.px = nx; moved += step;
  }
  it.vx *= 0.86; if (std::fabs(it.vx) < 0.02) it.vx = 0; // horizontal drift bleeds off
}
// Never buried: if the item's cell is solid (terrain grew/fell over it, or it spawned
// inside one), rise until it reaches an empty cell or the top.
void ItemSystem::unburyItem(Item& it) {
  int x = (int)std::floor(it.px), guard = 0;
  while (it.py > 0 && itemGridSolid(x, (int)std::floor(it.py)) && guard < E.rows) { it.py -= IT_RISE_STEP; guard++; }
  if (it.py < 0) it.py = 0;
}
// Buoyancy: an item submerged in a fluid (spawned underwater, or one a rising fluid
// closed over) floats up to the surface and rests there. Mirrors unburyItem but for
// liquids; together with the liquid-as-floor stop in moveItemY the item settles with
// its cell just above the fluid surface and stays put (no sink-then-pop sawtooth).
void ItemSystem::floatItem(Item& it) {
  int x = (int)std::floor(it.px), guard = 0;
  while (it.py > 0 && itemCellLiquidAt(x, (int)std::floor(it.py)) && guard < E.rows) { it.py -= IT_RISE_STEP; guard++; }
  if (it.py < 0) it.py = 0;
  if (it.vy > 0 && itemCellLiquidAt(x, (int)std::floor(it.py) + 1)) it.vy = 0; // resting on the surface
}
bool ItemSystem::seedItemCanPlant(const Item& it, int& x, int& y) {
  if (it.kind != IT_ITEM || it.material != SEED || it.count == 0) return false;
  x = (int)std::floor(it.px); y = (int)std::floor(it.py);
  if (!E.isInBounds(x, y) || E.L->grid[E.I(x, y)] != EMPTY) return false;
  return itemCellLiquidAt(x, y + 1) || itemCellLiquidAt(x - 1, y) || itemCellLiquidAt(x + 1, y) || itemCellLiquidAt(x, y - 1);
}
// Nearest active/alive player center within IT_MAGNET_R of the item (or null).
Player* ItemSystem::magnetTarget(const Item& it) {
  Player* best = nullptr; double bestD = IT_MAGNET_R * IT_MAGNET_R;
  for (auto& p : E.psys.players) {
    if (!p.active || !p.alive) continue;
    double dx = it.px - (p.px + p.w / 2.0), dy = it.py - (p.py + p.h / 2.0);
    double d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = &p; }
  }
  return best;
}

// Keep memory + per-step cost bounded: evict the oldest PARTICLE first, then the
// oldest ITEM (front of the append-ordered vector).
void ItemSystem::ensureItemCapacity() {
  if ((int)items.size() < IT_MAX_ITEMS) return;
  for (size_t i = 0; i < items.size(); i++) if (items[i].kind == IT_PARTICLE) { items.erase(items.begin() + i); return; }
  for (size_t i = 0; i < items.size(); i++) if (items[i].kind == IT_ITEM) { items.erase(items.begin() + i); return; }
}
int ItemSystem::spawnItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType) {
  ensureItemCapacity();
  Item it; it.id = nextItemId++; it.kind = IT_ITEM; it.material = mat;
  it.plantType = plantType;
  it.count = (uint8_t)(count < 1 ? 1 : (count > 255 ? 255 : count));
  it.px = px; it.py = py; it.vx = vx; it.vy = vy; it.pickupDelay = IT_PICKUP_DELAY;
  items.push_back(it); return it.id;
}
// Thrown items get a longer pickup delay so they escape the magnet before homing back.
int ItemSystem::throwItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType) {
  int id = spawnItem(mat, count, px, py, vx, vy, plantType);
  items.back().pickupDelay = IT_THROW_PICKUP_DELAY;
  return id;
}
void ItemSystem::spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life) {
  ensureItemCapacity();
  Item it; it.id = nextItemId++; it.kind = IT_PARTICLE; it.material = mat; it.count = 1;
  it.px = px; it.py = py; it.vx = vx; it.vy = vy; it.life = life > 0 ? life : IT_PARTICLE_LIFE;
  items.push_back(it);
}
// Compact out dead entities (spent particles + picked-up items with count 0).
void ItemSystem::cullItems() {
  size_t w = 0;
  for (size_t i = 0; i < items.size(); i++) {
    Item& it = items[i];
    bool dead = (it.kind == IT_PARTICLE && it.life <= 0) || (it.kind == IT_ITEM && it.count == 0);
    if (dead) continue;
    if (w != i) items[w] = items[i];
    w++;
  }
  items.resize(w);
}

void ItemSystem::updateItems() {
  if (items.empty()) return;
  E.useLayer(&E.fg);
  for (auto& it : items) {
    if (it.pickupDelay > 0) it.pickupDelay--;
    if (it.kind == IT_PARTICLE) {
      it.vy += IT_GRAVITY; if (it.vy > IT_MAX_FALL) it.vy = IT_MAX_FALL;
      moveItemY(it); moveItemX(it);
      continue;
    }
    // Magnet: PURE PURSUIT toward a nearby player — the velocity points straight at
    // the player every step (no accumulated sideways momentum), so items zip in and
    // never orbit. Free flight (ignores terrain) and clamped so it can't overshoot.
    Player* mag = it.pickupDelay == 0 ? magnetTarget(it) : nullptr;
    if (mag) {
      double dx = (mag->px + mag->w / 2.0) - it.px, dy = (mag->py + mag->h / 2.0) - it.py;
      double d = std::sqrt(dx * dx + dy * dy);
      if (d > 1e-6) {
        double speed = std::min(IT_MAGNET_MAX_SPEED, d);
        it.vx = dx / d * speed; it.vy = dy / d * speed;
        it.px += it.vx; it.py += it.vy;
      }
      continue;
    }
    // Free-fall + settle on the surface; never buried.
    bool inLiquid = itemCellLiquidAt((int)std::floor(it.px), (int)std::floor(it.py));
    double g = inLiquid ? IT_LIQUID_GRAVITY : IT_GRAVITY;
    double mx = inLiquid ? IT_LIQUID_MAX_FALL : IT_MAX_FALL;
    it.vy += g; if (it.vy > mx) it.vy = mx;
    if (inLiquid) { it.vx *= IT_LIQUID_DRAG; it.vy *= IT_LIQUID_DRAG; }
    moveItemY(it, /*floats=*/true);
    moveItemX(it);
    unburyItem(it);
    floatItem(it);
    int px, py;
    if (seedItemCanPlant(it, px, py) && E.placeSeedAtTyped(px, py, it.plantType)) {
      if (--it.count > 0) it.pickupDelay = IT_PICKUP_DELAY;
    }
  }
  for (auto& it : items) if (it.kind == IT_PARTICLE) it.life--;
  pickupItems();
  cullItems();
}

// Auto-vacuum pickup: each ready IT_ITEM within the (small) collect radius of a
// player goes to its inventory; absorbed items are zeroed and culled. The magnet
// above feeds items into this radius. Particles never pick up. Pure distance math.
void ItemSystem::pickupItems() {
  if (E.psys.players.empty() || items.empty()) return;
  for (auto& it : items) {
    if (it.kind != IT_ITEM || it.count == 0 || it.pickupDelay > 0) continue;
    Player* best = nullptr; double bestD = IT_PICKUP_R * IT_PICKUP_R;
    for (auto& p : E.psys.players) {
      if (!p.active || !p.alive) continue;
      double dx = it.px - (p.px + p.w / 2.0), dy = it.py - (p.py + p.h / 2.0);
      double d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = &p; }
    }
    if (best && E.addToInventory(*best, it.material, it.count, it.plantType)) {
      E.audio.emit(SE_PICKUP, it.px, it.py, std::min(1.2, 0.5 + it.count * 0.04), it.material, 0);
      it.count = 0;
    }
  }
}

// Pack all items into snapshot as flat float32 records (stride IS_STRIDE).
int ItemSystem::buildItemSnapshot() {
  snapshot.assign(items.size() * IS_STRIDE, 0.0f);
  for (size_t i = 0; i < items.size(); i++) {
    const Item& it = items[i];
    float* o = snapshot.data() + i * IS_STRIDE;
    o[IS_ID] = (float)it.id; o[IS_KIND] = (float)it.kind; o[IS_MATERIAL] = (float)it.material; o[IS_COUNT] = (float)it.count;
    o[IS_X] = (float)it.px; o[IS_Y] = (float)it.py; o[IS_LIFE] = (float)it.life;
    o[IS_PLANT_TYPE] = (float)it.plantType;
  }
  return (int)items.size();
}
