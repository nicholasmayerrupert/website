  // Explosives — TNT in two forms (one material id 35):
  //   * an explosive SOLID: TNT placed/baked into the grid (a stone-group component);
  //   * an explosive RIGID BODY: a free body whose material is TNT (cube tool / debris).
  // Both detonate the same way: when a TNT cell touches fire/lava (or another blast),
  // a fuse starts, then detonate() carves a DURABILITY-gated crater — "blocks easier
  // to mine are easier to blow up". This is the ONE reaction that is body-agnostic: it
  // acts on TNT whether the cell is static or body-owned (a TNT body cell IS TNT in the
  // grid, by the body-material invariant). Everything explosion-related lives here.
  //
  // Determinism: detonate() and the fuse logic use NO rand() (Phase 2). Static fuses
  // live in L->pendingDetonations (cell -> ticks); body fuses in Body::fuseTicks.
  // Expired static fuses are detonated in sorted cell order so unordered_map iteration
  // order never leaks into the sim.
  static const int    TNT_FUSE_TICKS = 28;   // delay from ignition to blast (~run-away time)
  static const int    TNT_CHAIN_FUSE = 4;    // a TNT caught in a blast chains this fast
  static const int    TNT_BLAST_RADIUS = 14; // crater reach (cells)
  static constexpr double TNT_BLAST_POWER = 20.0; // energy at the centre; falls off to 0 at the rim

  // Schedule a detonation at a cell (no-op if one is already pending there, so a fuse
  // is never shortened by re-ignition).
  void queueDetonation(int cell, int fuse) {
    auto& pd = L->pendingDetonations;
    if (!pd.count(cell)) pd[cell] = fuse;
  }

  // Carve a durability-gated crater centred at (cx,cy). A cell at distance d survives
  // iff its DURABILITY exceeds the blast energy there: energy = power*(1 - d/radius).
  // Soft blocks (sand/dirt, durability 1-2) are cleared almost to the rim; hard ones
  // (iron ore 14, brick 12) only near the centre. Destruction is component-safe and
  // body-aware, reusing the same primitives as the eraser/mining paths.
  void detonate(int cx, int cy, int radius, double power) {
    std::vector<int> erasedStone, erasedIce; bool erasedPlant = false;
    std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
    int r2 = radius * radius;
    for (int oy = -radius; oy <= radius; oy++) {
      int yy = cy + oy; if (yy <= 0 || yy >= rows) continue;
      for (int ox = -radius; ox <= radius; ox++) {
        int dd = ox * ox + oy * oy; if (dd > r2) continue;
        int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue;
        int k = I(xx, yy); uint8_t m = grid[k]; if (m == EMPTY) continue;
        double energy = power * (1.0 - std::sqrt((double)dd) / radius);
        if (energy < (double)DURABILITY[m]) continue; // too hard to blow up at this distance
        if (m == TNT) queueDetonation(k, TNT_CHAIN_FUSE); // chain: nearby TNT detonates a beat later
        // body-material invariant: a body cell goes through the body system, a static
        // cell through the component-split system (see isBodyCell).
        if (isBodyCell(k)) {
          if (bodyById.empty()) for (Body* b : L->bodies) bodyById[b->id] = b;
          if (!eraseBodyCellIndex(k, bodyById, dirtyBodies)) { grid[k] = EMPTY; bodyOwner[k] = -1; }
        } else {
          if (isStoneComp(m)) erasedStone.push_back(k); else if (isIceComp(m)) erasedIce.push_back(k);
          if (isPlantMaterial(m)) erasedPlant = true;
          grid[k] = EMPTY;
        }
        markCellIndex(k);
        // PHASE 3 will eject debris chunks / particles here, by (ox,oy) direction.
      }
    }
    finishErasedBodies(dirtyBodies, L->bodyCells);
    splitRigidAfterErase(L->stoneComponents, erasedStone, L->nextStoneId, false);
    splitRigidAfterErase(L->iceComponents, erasedIce, L->nextIceId, true);
    if (erasedPlant && !L->plantComponents.empty()) splitPlantAfterErase();
    // PHASE 3 will push nearby free bodies + fling loose powders/liquids here.
    markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
  }

  // Step pass (dispatched in step.inc next to the other reactions): light TNT touching
  // fire/lava, tick fuses, and detonate the expired ones. Costs nothing when no TNT is
  // present (the scan finds none; both fuse maps are empty), so checksums are unaffected.
  void applyExplosives() {
    // 1) Ignite TNT touching fire/lava. Scanned from the HEAT (fire/lava is always in
    //    the active band) and lighting TNT NEIGHBOURS — mirroring how fire ignites
    //    flammables — so a settled, inert TNT block still lights. The first TNT is all
    //    we need: its blast chains the rest via queueDetonation in detonate().
    std::unordered_map<int, Body*> bodyById; bool builtBodies = false;
    auto lightTnt = [&](int k) {
      if (grid[k] != TNT) return;
      if (isBodyCell(k)) {
        int id = bodyOwner[k];
        if (!builtBodies) { for (Body* b : L->bodies) bodyById[b->id] = b; builtBodies = true; }
        auto it = bodyById.find(id);
        if (it != bodyById.end() && it->second->fuseTicks == 0) it->second->fuseTicks = TNT_FUSE_TICKS;
      } else queueDetonation(k, TNT_FUSE_TICKS);
    };
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); uint8_t m = grid[k]; if (m != FIRE && m != LAVA) continue;
        lightTnt(k + 1); lightTnt(k - 1); lightTnt(k + cols); lightTnt(k - cols);
      }
    }
    // 2) Tick static fuses; detonate the expired ones in deterministic (sorted) order.
    if (!L->pendingDetonations.empty()) {
      std::vector<int> fire;
      for (auto& kv : L->pendingDetonations) if (--kv.second <= 0) fire.push_back(kv.first);
      for (int cell : fire) L->pendingDetonations.erase(cell);
      std::sort(fire.begin(), fire.end());
      for (int cell : fire) detonate(cell % cols, cell / cols, TNT_BLAST_RADIUS, TNT_BLAST_POWER);
    }
    // 3) Tick body fuses; an expired TNT body detonates at its centre (the blast
    //    consumes its own cells, so finishErasedBodies removes the now-empty body).
    std::vector<std::pair<int, int>> bodyBlasts;
    for (Body* b : L->bodies) if (b->material == TNT && b->fuseTicks > 0 && --b->fuseTicks <= 0)
      bodyBlasts.push_back({(int)std::lround(b->px), (int)std::lround(b->py)});
    for (auto& c : bodyBlasts) detonate(c.first, c.second, TNT_BLAST_RADIUS, TNT_BLAST_POWER);
  }
