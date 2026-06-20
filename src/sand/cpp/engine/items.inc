  // ================= DROPPED ITEMS + PARTICLES (items.inc) =================
  // Entities, NOT grid cells: they fall, rest on solid grid + on each other, fall
  // slower in liquid, and (IT_ITEM) get vacuumed into a nearby player's inventory
  // (pickupItems, wired in inventory.inc). They never write the grid, never go
  // through the tile store, and use NO rand() — so worldgen prefetch byte-identicality
  // and the sim RNG stream are untouched (determinism + inertness invariants hold).

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
  // Entering cell (x,y) is blocked by a solid grid cell OR a cell already claimed by
  // another RESTING item (itemOcc, rebuilt each step) — that is what makes items pile
  // up instead of sinking through one another to the floor.
  inline bool itemBlocked(int x, int y) { return itemGridSolid(x, y) || itemOcc.count(I(x, y)) != 0; }

  void moveItemY(Item& it) {
    it.resting = false;
    double mag = std::fabs(it.vy); if (mag < 1e-6) return;
    double dir = it.vy > 0 ? 1.0 : -1.0, moved = 0;
    int ix = (int)std::floor(it.px);
    while (moved < mag - 1e-6) {
      double step = (mag - moved < IT_MOVE_SUBSTEP) ? (mag - moved) : IT_MOVE_SUBSTEP;
      double ny = it.py + dir * step;
      int curIy = (int)std::floor(it.py), nextIy = (int)std::floor(ny);
      if (nextIy != curIy && itemBlocked(ix, nextIy)) {
        if (dir > 0) { it.py = nextIy - 1e-3; it.resting = true; } // sit just above the solid
        else { it.py = curIy + 1e-3; }                            // bonk a ceiling
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
    it.vx *= 0.86; if (std::fabs(it.vx) < 0.02) it.vx = 0; // horizontal drift bleeds off (particles)
  }

  // Keep memory + per-step cost bounded: evict the oldest PARTICLE first, then the
  // oldest ITEM (front of the append-ordered vector). Particles are always cheaper to lose.
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
  void spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life) {
    ensureItemCapacity();
    Item it; it.id = nextItemId++; it.kind = IT_PARTICLE; it.material = mat; it.count = 1;
    it.px = px; it.py = py; it.vx = vx; it.vy = vy; it.life = life > 0 ? life : IT_PARTICLE_LIFE;
    items.push_back(it);
  }
  // Separate resting items that ended up sharing a cell (e.g. dropped at the same
  // spot, or settled together onto the floor): push duplicates upward one cell at a
  // time so a pile forms. Bounded by the column height; never pushes into a solid.
  void resolveItemStacking() {
    std::unordered_set<int> occ;
    for (auto& it : items) {
      if (it.kind != IT_ITEM || !it.resting) continue;
      int ix = (int)std::floor(it.px), iy = (int)std::floor(it.py), guard = 0;
      while (iy > 0 && occ.count(iy * cols + ix) && !itemGridSolid(ix, iy - 1) && guard < IT_MAX_ITEMS) { iy--; guard++; }
      it.py = iy + 1e-3;
      occ.insert(iy * cols + ix);
    }
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
    itemOcc.clear();
    for (auto& it : items) if (it.kind == IT_ITEM && it.resting) itemOcc.insert(itemCell(it));
    for (auto& it : items) {
      if (it.pickupDelay > 0) it.pickupDelay--;
      bool inLiquid = itemCellLiquidAt((int)std::floor(it.px), (int)std::floor(it.py));
      double g = inLiquid ? IT_LIQUID_GRAVITY : IT_GRAVITY;
      double mx = inLiquid ? IT_LIQUID_MAX_FALL : IT_MAX_FALL;
      it.vy += g; if (it.vy > mx) it.vy = mx;
      if (inLiquid) { it.vx *= IT_LIQUID_DRAG; it.vy *= IT_LIQUID_DRAG; }
      if (it.kind == IT_ITEM) itemOcc.erase(itemCell(it)); // don't let an item block itself
      moveItemY(it);
      moveItemX(it);
      if (it.kind == IT_ITEM && it.resting) itemOcc.insert(itemCell(it));
    }
    resolveItemStacking();
    for (auto& it : items) if (it.kind == IT_PARTICLE) it.life--;
    pickupItems();
    cullItems();
  }

  // Auto-vacuum pickup: each ready IT_ITEM goes to the nearest active player within
  // IT_PICKUP_R; absorbed items are zeroed and culled. Particles never pick up. Pure
  // distance math (no rand()).
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
