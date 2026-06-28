  // Explosives — TNT in two forms (one material id 35):
  //   * an explosive SOLID: TNT placed/baked into the grid (a stone-group component);
  //   * an explosive RIGID BODY: a free body whose material is TNT (cube tool / debris).
  // Both detonate the same way: when a TNT cell touches fire/lava (or another blast),
  // a fuse starts, then a blast carves a DURABILITY-gated crater — "blocks easier to
  // mine are easier to blow up" — and puffs a cloud of steam + acrid smoke. This is the
  // ONE reaction that is body-agnostic: it acts on TNT whether the cell is static or
  // body-owned (a TNT body cell IS TNT in the grid, by the body-material invariant).
  // Everything explosion-related lives here.
  //
  // Performance: the costly part of a blast is the component re-split + grounding
  // reflood + body-finish it triggers. A chain (or several body+static blasts in one
  // step) used to pay that PER detonation; now carveBlast() accumulates every crater of
  // a step into one BlastBatch and finishBlasts() runs the shared finalize ONCE. The
  // steam/smoke puff and cosmetic flecks are both capped per step so a big blast can't
  // flood the gas sim / particle pool.
  //
  // Determinism: NO rand() — crater shape, fleck/gas choice, and debris velocities all
  // come from whash2 (the rand-free spatial hash). Static fuses live in
  // L->pendingDetonations (cell -> ticks); body fuses in Body::fuseTicks. Expired static
  // fuses detonate in sorted cell order so unordered_map iteration never leaks in.
  static const int    TNT_FUSE_TICKS = 28;   // delay from ignition to blast (~run-away time)
  static const int    TNT_CHAIN_FUSE = 4;    // a TNT caught in a blast chains this fast
  static const int    TNT_BLAST_RADIUS = 17; // crater reach (cells) — a bit larger than before
  static constexpr double TNT_BLAST_POWER = 20.0; // energy at the centre; falls off to 0 at the rim
  // Debris + shockwave (Phase 3). All deterministic — velocities come from geometry +
  // whash2 (the same rand-free hash the item drops use), never rand().
  static const int    BLAST_DEBRIS_CHUNKS = 3;    // physical rubble chunks ejected per blast
  static const int    BLAST_DEBRIS_CAP = 24;      // stop ejecting chunks past this many live bodies. A big TNT chain
                                                  // dumps debris faster than 2x2 chunks can settle+bake, and ~100 live
                                                  // bodies jostling never sleep -> never bake -> grind the solver; this
                                                  // bounds the solver cost (the steam/flecks carry the visual scatter).
  static constexpr double BLAST_DEBRIS_SPEED = 2.2;   // chunk launch speed
  static constexpr double BLAST_PARTICLE_SPEED = 2.6; // cosmetic fleck speed
  static const int    BLAST_PARTICLE_LIFE = 26;
  static const int    BLAST_PARTICLE_CAP = 48;    // hard cap on cosmetic flecks per step (steam carries the visual now)
  static constexpr double BLAST_PUSH = 3.0;       // outward shove given to nearby free bodies
  static constexpr double TWO_PI = 6.283185307179586;
  // Steam + acrid-smoke puff. The crater loop runs top-to-bottom, so capping the gas
  // count makes the cloud fill from the TOP of the crater first — it billows upward and
  // vents instead of trapping a slab of slow-decaying steam deep in solid terrain.
  static const int    BLAST_GAS_CAP = 160;        // max gas cells written per blast (a LOT of steam, but bounded)
  static constexpr double BLAST_ACRID_FRAC = 0.12; // of the gassed cells, the share that is acrid smoke ("some")
  static constexpr double BLAST_STEAM_FRAC = 0.68; // ... and the share that is steam ("a lot"); the rest stay void

  // Per-step accumulator: every crater of a step carves into one of these, then
  // finishBlasts() runs the expensive finalize once (the TNT chain-lag fix).
  struct BlastBatch {
    std::vector<int> erasedStone, erasedIce;
    bool erasedPlant = false;
    std::unordered_map<int, Body*> bodyById; bool bodyMapBuilt = false;
    std::unordered_set<Body*> dirtyBodies;
    int minX = 1 << 30, minY = 1 << 30, maxX = -1, maxY = -1; // union dirty rect
    int particles = 0, gasCells = 0;
    bool any = false;
  };

  // Schedule a detonation at a cell (no-op if one is already pending there, so a fuse
  // is never shortened by re-ignition).
  void queueDetonation(int cell, int fuse) {
    auto& pd = L->pendingDetonations;
    if (!pd.count(cell)) pd[cell] = fuse;
  }

  // Carve one durability-gated crater centred at (cx,cy) INTO the shared batch (no
  // finalize — that's finishBlasts). A cell at distance d survives iff its DURABILITY
  // exceeds the blast energy there: energy = power*(1 - d/radius). Soft blocks
  // (sand/dirt) are cleared almost to the rim; hard ones (iron ore) only near centre.
  // Destruction is component-safe and body-aware, reusing the eraser/mining primitives.
  void carveBlast(int cx, int cy, int radius, double power, BlastBatch& bb) {
    bb.any = true;
    if (cx - radius < bb.minX) bb.minX = cx - radius;
    if (cy - radius < bb.minY) bb.minY = cy - radius;
    if (cx + radius > bb.maxX) bb.maxX = cx + radius;
    if (cy + radius > bb.maxY) bb.maxY = cy + radius;
    int r2 = radius * radius;
    uint32_t bseed = (uint32_t)tick * 2654435761u ^ (uint32_t)(cy * cols + cx); // per-blast deterministic seed
    uint8_t debrisMat = EMPTY; // first solid material destroyed -> what the rubble chunks are made of
    for (int oy = -radius; oy <= radius; oy++) {
      int yy = cy + oy; if (yy <= 0 || yy >= rows) continue;
      for (int ox = -radius; ox <= radius; ox++) {
        int dd = ox * ox + oy * oy; if (dd > r2) continue;
        int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue;
        int k = I(xx, yy); uint8_t m = grid[k]; if (m == EMPTY) continue;
        double energy = power * (1.0 - std::sqrt((double)dd) / radius);
        if (energy < (double)DURABILITY[m]) continue; // too hard to blow up at this distance
        if (m == TNT && dd > 0) queueDetonation(k, TNT_CHAIN_FUSE); // chain OTHER TNT a beat later (dd>0 so a blast never re-queues its own centre)
        // body-material invariant: a body cell goes through the body system, a static
        // cell through the component-split system (see isBodyCell).
        if (isBodyCell(k)) {
          if (!bb.bodyMapBuilt) { for (Body* b : L->bodies) bb.bodyById[b->id] = b; bb.bodyMapBuilt = true; }
          if (!eraseBodyCellIndex(k, bb.bodyById, bb.dirtyBodies)) { grid[k] = EMPTY; bodyOwner[k] = -1; }
        } else {
          // Track the first destroyed solid as the rubble-chunk material (never TNT —
          // exploding TNT must be consumed, not scattered as live shrapnel).
          if (isStoneComp(m)) { bb.erasedStone.push_back(k); if (debrisMat == EMPTY && m != TNT) debrisMat = m; }
          else if (isIceComp(m)) { bb.erasedIce.push_back(k); if (debrisMat == EMPTY) debrisMat = m; }
          if (isPlantMaterial(m)) bb.erasedPlant = true;
          grid[k] = EMPTY;
        }
        markCellIndex(k);
        // Cosmetic flecks of the destroyed material, flung outward (also how loose
        // powders/liquids in the blast get scattered). Capped + sparse: the steam puff
        // below now carries the bulk of the visual, so we need far fewer entities.
        if (!isGas(m) && bb.particles < BLAST_PARTICLE_CAP && (((xx * 7) ^ (yy * 3)) % 8 == 0)) {
          double dist = std::sqrt((double)dd), inv = dist > 0.5 ? 1.0 / dist : 0.0;
          double sp = BLAST_PARTICLE_SPEED * (1.0 - dist / radius) * (0.5 + whash2(bseed, xx, yy));
          spawnParticle(m, xx + 0.5, yy + 0.5, ox * inv * sp, oy * inv * sp - 0.6, BLAST_PARTICLE_LIFE);
          bb.particles++;
        }
        // Steam + acrid-smoke puff into the freshly-cleared void (top-biased by the cap).
        if (grid[k] == EMPTY && bb.gasCells < BLAST_GAS_CAP) {
          double g = whash2(bseed, xx + 7, yy + 13);
          if (g < BLAST_ACRID_FRAC) { writeGridIndex(k, ACRID_SMOKE); bb.gasCells++; }
          else if (g < BLAST_ACRID_FRAC + BLAST_STEAM_FRAC) { writeGridIndex(k, STEAM); bb.gasCells++; }
        }
      }
    }
    // Shockwave: shove nearby free bodies outward and wake them.
    for (Body* b : L->bodies) {
      double ddx = b->px - cx, ddy = b->py - cy, bd = std::sqrt(ddx * ddx + ddy * ddy);
      if (bd >= radius || bd < 0.01) continue;
      double f = BLAST_PUSH * (1.0 - bd / radius) / bd;
      b->vx += ddx * f; b->vy += ddy * f; b->awake = true; b->stillTicks = 0;
    }
    // Eject a few physical rubble chunks of the destroyed solid, flung radially; they
    // tumble and BAKE into static rubble on landing (Phase 1). Capped so a big chain
    // can't flood the body solver.
    if (debrisMat != EMPTY && (int)L->bodies.size() < BLAST_DEBRIS_CAP) {
      for (int i = 0; i < BLAST_DEBRIS_CHUNKS; i++) {
        double j = whash2(bseed, i, 13);
        int sx = cx + (i * 2 - (BLAST_DEBRIS_CHUNKS - 1)) * 3; // fan out horizontally just above the crater centre (cleared air)
        Body* b = spawnBox(sx, cy - 3, 1, 1, debrisMat);       // a 2x2 chunk launched up + out; it arcs back down and BAKES into rubble
        if (!b) continue;
        b->vx = (double)(sx - cx) * 0.45 + (j - 0.5);
        b->vy = -BLAST_DEBRIS_SPEED * (0.7 + 0.6 * j);
        b->awake = true; b->stillTicks = 0;
      }
    }
  }

  // Run the expensive finalize once for all craters carved into the batch this step.
  void finishBlasts(BlastBatch& bb) {
    if (!bb.any) return;
    finishErasedBodies(bb.dirtyBodies, L->bodyCells);
    splitRigidAfterErase(L->stoneComponents, bb.erasedStone, L->nextStoneId, false);
    splitRigidAfterErase(L->iceComponents, bb.erasedIce, L->nextIceId, true);
    if (bb.erasedPlant && !L->plantComponents.empty()) splitPlantAfterErase();
    markDirtyRect(bb.minX, bb.minY, bb.maxX, bb.maxY);
  }

  // Single-blast convenience wrapper (one crater, its own finalize).
  void detonate(int cx, int cy, int radius, double power) {
    BlastBatch bb; carveBlast(cx, cy, radius, power, bb); finishBlasts(bb);
  }

  // Step pass (dispatched in step.inc next to the other reactions): light TNT touching
  // fire/lava, tick fuses, and detonate the expired ones — all into a single batch so a
  // chain pays one finalize. Costs nothing when no TNT is present (the scan finds none;
  // both fuse maps are empty), so checksums are unaffected.
  void applyExplosives() {
    // 1) Ignite TNT touching fire/lava. Scanned from the HEAT (fire/lava is always in
    //    the active band) and lighting TNT NEIGHBOURS — mirroring how fire ignites
    //    flammables — so a settled, inert TNT block still lights. The first TNT is all
    //    we need: its blast chains the rest via queueDetonation in carveBlast().
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
    BlastBatch bb;
    // 2) Tick static fuses; carve the expired ones in deterministic (sorted) order.
    if (!L->pendingDetonations.empty()) {
      std::vector<int> fire;
      for (auto& kv : L->pendingDetonations) if (--kv.second <= 0) fire.push_back(kv.first);
      for (int cell : fire) L->pendingDetonations.erase(cell);
      std::sort(fire.begin(), fire.end());
      for (int cell : fire) carveBlast(cell % cols, cell / cols, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb);
    }
    // 3) Tick body fuses; an expired TNT body detonates at its centre (the blast
    //    consumes its own cells, so finishErasedBodies removes the now-empty body).
    std::vector<std::pair<int, int>> bodyBlasts;
    for (Body* b : L->bodies) if (b->material == TNT && b->fuseTicks > 0 && --b->fuseTicks <= 0)
      bodyBlasts.push_back({(int)std::lround(b->px), (int)std::lround(b->py)});
    for (auto& c : bodyBlasts) carveBlast(c.first, c.second, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb);
    finishBlasts(bb); // one finalize for every crater of this step
  }
