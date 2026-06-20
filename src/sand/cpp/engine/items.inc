  // ================= DROPPED ITEMS + PARTICLES (items.inc) =================
  // Entities, NOT grid cells. An IT_ITEM is a Starbound-style surface sprite: it
  // falls, rests ON TOP of solids, NEVER stays buried (rises out if covered), passes
  // freely through other items (no stacking), and MAGNETS toward a nearby player
  // until collected. IT_PARTICLE is cosmetic mining debris. They never write the grid,
  // never go through the tile store, and use NO rand() — so worldgen prefetch
  // byte-identicality and the sim RNG stream are untouched (determinism invariant).

  inline int itemCell(const Item& it) { int x = (int)std::floor(it.px), y = (int)std::floor(it.py); return y * cols + x; }
  // A grid cell is "solid" to an item exactly as it is to a player (settled powder +
  // rigids block; liquids/gas/empty do not). Below the buffer = floor.
  inline bool itemGridSolid(int x, int y) {
    if (y >= rows) return true;
    if (y < 0 || x < 0 || x >= cols) return false;
    return isSolidForPlayer(grid[I(x, y)]);
  }
  inline bool itemCellLiquidAt(int x, int y) {
    if (y < 0 || y >= rows || x < 0 || x >= cols) return false;
    return isLiquid(grid[I(x, y)]);
  }

  // Fall vertically, stopping just above the first solid cell below (never clips in).
  void moveItemY(Item& it) {
    double mag = std::fabs(it.vy); if (mag < 1e-6) return;
    double dir = it.vy > 0 ? 1.0 : -1.0, moved = 0;
    int ix = (int)std::floor(it.px);
    while (moved < mag - 1e-6) {
      double step = (mag - moved < IT_MOVE_SUBSTEP) ? (mag - moved) : IT_MOVE_SUBSTEP;
      double ny = it.py + dir * step;
      int curIy = (int)std::floor(it.py), nextIy = (int)std::floor(ny);
      if (nextIy != curIy && itemGridSolid(ix, nextIy)) {
        if (dir > 0) it.py = nextIy - 1e-3; else it.py = curIy + 1e-3;
        it.vy = 0; return;
      }
      it.py = ny; moved += step;
      if (it.py < 0) { it.py = 0; it.vy = 0; return; }
    }
  }
  void moveItemX(Item& it) {
    if (std::fabs(it.vx) < 1e-6) return;
    double mag = std::fabs(it.vx), dir = it.vx > 0 ? 1.0 : -1.0, moved = 0;
    int iy = (int)std::floor(it.py);
    while (moved < mag - 1e-6) {
      double step = (mag - moved < IT_MOVE_SUBSTEP) ? (mag - moved) : IT_MOVE_SUBSTEP;
      double nx = it.px + dir * step;
      int curIx = (int)std::floor(it.px), nextIx = (int)std::floor(nx);
      if ((nextIx != curIx && itemGridSolid(nextIx, iy)) || nx < 0 || nx >= cols) { it.vx = 0; return; }
      it.px = nx; moved += step;
    }
    it.vx *= 0.86; if (std::fabs(it.vx) < 0.02) it.vx = 0; // horizontal drift bleeds off
  }
  // Never buried: if the item's cell is solid (terrain grew/fell over it, or it spawned
  // inside one), rise until it reaches an empty cell or the top.
  void unburyItem(Item& it) {
    int x = (int)std::floor(it.px), guard = 0;
    while (it.py > 0 && itemGridSolid(x, (int)std::floor(it.py)) && guard < rows) { it.py -= IT_RISE_STEP; guard++; }
    if (it.py < 0) it.py = 0;
  }
  // Nearest active/alive player center within IT_MAGNET_R of the item (or null).
  Player* magnetTarget(const Item& it) {
    Player* best = nullptr; double bestD = IT_MAGNET_R * IT_MAGNET_R;
    for (auto& p : players) {
      if (!p.active || !p.alive) continue;
      double dx = it.px - (p.px + p.w / 2.0), dy = it.py - (p.py + p.h / 2.0);
      double d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = &p; }
    }
    return best;
  }

  // Keep memory + per-step cost bounded: evict the oldest PARTICLE first, then the
  // oldest ITEM (front of the append-ordered vector).
  void ensureItemCapacity() {
    if ((int)items.size() < IT_MAX_ITEMS) return;
    for (size_t i = 0; i < items.size(); i++) if (items[i].kind == IT_PARTICLE) { items.erase(items.begin() + i); return; }
    for (size_t i = 0; i < items.size(); i++) if (items[i].kind == IT_ITEM) { items.erase(items.begin() + i); return; }
  }
  int spawnItem(uint8_t mat, int count, double px, double py, double vx, double vy) {
    ensureItemCapacity();
    Item it; it.id = nextItemId++; it.kind = IT_ITEM; it.material = mat;
    it.count = (uint8_t)(count < 1 ? 1 : (count > 255 ? 255 : count));
    it.px = px; it.py = py; it.vx = vx; it.vy = vy; it.pickupDelay = IT_PICKUP_DELAY;
    items.push_back(it); return it.id;
  }
  // Thrown items get a longer pickup delay so they escape the magnet before homing back.
  int throwItem(uint8_t mat, int count, double px, double py, double vx, double vy) {
    int id = spawnItem(mat, count, px, py, vx, vy);
    items.back().pickupDelay = IT_THROW_PICKUP_DELAY;
    return id;
  }
  void spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life) {
    ensureItemCapacity();
    Item it; it.id = nextItemId++; it.kind = IT_PARTICLE; it.material = mat; it.count = 1;
    it.px = px; it.py = py; it.vx = vx; it.vy = vy; it.life = life > 0 ? life : IT_PARTICLE_LIFE;
    items.push_back(it);
  }
  // Compact out dead entities (spent particles + picked-up items with count 0).
  void cullItems() {
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

  void updateItems() {
    if (items.empty()) return;
    useLayer(&fg);
    for (auto& it : items) {
      if (it.pickupDelay > 0) it.pickupDelay--;
      if (it.kind == IT_PARTICLE) {
        it.vy += IT_GRAVITY; if (it.vy > IT_MAX_FALL) it.vy = IT_MAX_FALL;
        moveItemY(it); moveItemX(it);
        continue;
      }
      // Magnet: home toward a nearby player (free flight, ignores terrain so it can't
      // get stuck), clamped so it never overshoots the player.
      Player* mag = it.pickupDelay == 0 ? magnetTarget(it) : nullptr;
      if (mag) {
        double dx = (mag->px + mag->w / 2.0) - it.px, dy = (mag->py + mag->h / 2.0) - it.py;
        double d = std::sqrt(dx * dx + dy * dy);
        if (d > 1e-6) { it.vx += IT_MAGNET_ACCEL * dx / d; it.vy += IT_MAGNET_ACCEL * dy / d; }
        double sp = std::sqrt(it.vx * it.vx + it.vy * it.vy);
        double cap = std::min(IT_MAGNET_MAX_SPEED, d); // don't fly past the player
        if (sp > cap && sp > 1e-6) { it.vx *= cap / sp; it.vy *= cap / sp; }
        it.px += it.vx; it.py += it.vy;
        continue;
      }
      // Free-fall + settle on the surface; never buried.
      bool inLiquid = itemCellLiquidAt((int)std::floor(it.px), (int)std::floor(it.py));
      double g = inLiquid ? IT_LIQUID_GRAVITY : IT_GRAVITY;
      double mx = inLiquid ? IT_LIQUID_MAX_FALL : IT_MAX_FALL;
      it.vy += g; if (it.vy > mx) it.vy = mx;
      if (inLiquid) { it.vx *= IT_LIQUID_DRAG; it.vy *= IT_LIQUID_DRAG; }
      moveItemY(it);
      moveItemX(it);
      unburyItem(it);
    }
    for (auto& it : items) if (it.kind == IT_PARTICLE) it.life--;
    pickupItems();
    cullItems();
  }

  // Auto-vacuum pickup: each ready IT_ITEM within the (small) collect radius of a
  // player goes to its inventory; absorbed items are zeroed and culled. The magnet
  // above feeds items into this radius. Particles never pick up. Pure distance math.
  void pickupItems() {
    if (players.empty() || items.empty()) return;
    for (auto& it : items) {
      if (it.kind != IT_ITEM || it.count == 0 || it.pickupDelay > 0) continue;
      Player* best = nullptr; double bestD = IT_PICKUP_R * IT_PICKUP_R;
      for (auto& p : players) {
        if (!p.active || !p.alive) continue;
        double dx = it.px - (p.px + p.w / 2.0), dy = it.py - (p.py + p.h / 2.0);
        double d = dx * dx + dy * dy;
        if (d <= bestD) { bestD = d; best = &p; }
      }
      if (best && addToInventory(*best, it.material, it.count)) it.count = 0;
    }
  }

  // Pack all items into itemSnapshot as flat float32 records (stride ITEM_SNAP_STRIDE).
  int buildItemSnapshot() {
    itemSnapshot.assign(items.size() * ITEM_SNAP_STRIDE, 0.0f);
    for (size_t i = 0; i < items.size(); i++) {
      const Item& it = items[i];
      float* o = itemSnapshot.data() + i * ITEM_SNAP_STRIDE;
      o[0] = (float)it.id; o[1] = (float)it.kind; o[2] = (float)it.material; o[3] = (float)it.count;
      o[4] = (float)it.px; o[5] = (float)it.py; o[6] = (float)it.life;
    }
    return (int)items.size();
  }
