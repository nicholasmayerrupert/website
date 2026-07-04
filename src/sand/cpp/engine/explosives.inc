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
  // cosmetic flecks are capped per step so a big blast can't flood the particle pool.
  //
  // Determinism: NO rand() — crater shape, fleck/gas choice, and debris velocities all
  // come from whash2 (the rand-free spatial hash). Static fuses live in
  // L->pendingDetonations (cell -> ticks); body fuses in Body::fuseTicks. Expired static
  // fuses detonate in sorted cell order so unordered_map iteration never leaks in.
  static const int    TNT_FUSE_TICKS = 28;   // delay from ignition to blast (~run-away time)
  static const int    TNT_CHAIN_FUSE = 4;    // a TNT caught in a blast chains this fast
  static const int    TNT_BLAST_RADIUS = 22; // crater reach (cells)
  static constexpr double TNT_BLAST_POWER = 20.0; // energy at the centre; falls off to 0 at the rim
  // Debris + shockwave (Phase 3). All deterministic — velocities come from geometry +
  // whash2 (the same rand-free hash the item drops use), never rand().
  static const int    BLAST_DEBRIS_CHUNKS = 1;    // physical rubble chunks ejected per destroyed material source
  static const int    BLAST_DEBRIS_SOURCE_TRIES = 2; // try the old fan positions, but stop after the smaller budget
  static const int    BLAST_FORCED_DEBRIS_CHUNKS = 1; // extra generic blast debris, even in open air
  static constexpr double BLAST_FORCED_DEBRIS_FRAC = 0.50; // generic open-air debris spawns on half of blasts
  static const int    BLAST_DEBRIS_STEP_CAP = 5;  // max chunks a same-tick blast wave can add per layer
  static const int    BLAST_DEBRIS_CAP = 96;      // hard live-body solver ceiling; per-step cap keeps chains paced
  static constexpr double BLAST_DEBRIS_SPEED = 2.2;   // chunk launch speed
  static constexpr double BLAST_PARTICLE_SPEED = 2.6; // cosmetic fleck speed
  static const int    BLAST_PARTICLE_LIFE = 26;
  static const int    BLAST_PARTICLE_CAP = 48;    // hard cap on cosmetic flecks per step (steam carries the visual now)
  static constexpr double BLAST_PUSH = 3.0;       // outward shove given to nearby free bodies
  static constexpr double TWO_PI = 6.283185307179586;
  // TNT aftermath: each destroyed TNT cell leaves exactly one hot gas/fire cell.
  static constexpr double TNT_ACRID_FRAC = 0.70; // acrid smoke dominates the blast cloud
  static constexpr double TNT_STEAM_FRAC = 0.20; // plus some steam; the remaining 10% is fire
  static const int    BLAST_GAS_SEARCH_CAP = 96; // outward gas-shock search limit (cells beyond the blast rim)

  // Per-step accumulator: every crater of a step carves into one of these, then
  // finishBlasts() runs the expensive finalize once (the TNT chain-lag fix).
  struct BlastWave { int cx, cy, radius; uint32_t seed; };
  struct BlastDebrisSource { uint8_t material; int cell; };
  struct BlastBatch {
    std::vector<int> erasedStone, erasedIce;
    bool erasedPlant = false;
    std::vector<std::pair<int, uint8_t>> tntAftermath;
    std::vector<BlastWave> gasShockwaves;
    std::unordered_map<int, Body*> bodyById; bool bodyMapBuilt = false;
    std::unordered_set<Body*> dirtyBodies;
    int minX = 1 << 30, minY = 1 << 30, maxX = -1, maxY = -1; // union dirty rect
    int particles = 0, debrisSpawned = 0;
    bool any = false;
  };

  // Schedule a detonation at a cell (no-op if one is already pending there, so a fuse
  // is never shortened by re-ignition).
  void queueDetonation(int cell, int fuse) {
    auto& pd = L->pendingDetonations;
    if (!pd.count(cell)) pd[cell] = fuse;
  }
  void shortenTntBodyFuse(Body* b, int fuse) {
    if (!b || b->material != TNT) return;
    if (b->fuseTicks <= 0 || b->fuseTicks > fuse) b->fuseTicks = fuse;
    b->awake = true; b->stillTicks = 0;
  }

  int blastGasTarget(int sx, int sy, int cx, int cy, int radius, uint32_t seed,
                     const std::unordered_set<int>& reservedTargets) {
    double dx = (double)(sx - cx), dy = (double)(sy - cy), dist = std::sqrt(dx * dx + dy * dy);
    double ux, uy;
    if (dist > 0.5) { ux = dx / dist; uy = dy / dist; }
    else {
      double a = whash2(seed, sx + 31, sy + 17) * TWO_PI;
      ux = std::cos(a); uy = std::sin(a);
    }
    int tx = (int)std::lround((double)cx + ux * radius);
    int ty = (int)std::lround((double)cy + uy * radius);
    if (tx <= 0 || tx >= cols - 1 || ty <= 0 || ty >= rows) return -1;

    int minD = imax(0, radius - 1); minD *= minD;
    int maxD = radius + BLAST_GAS_SEARCH_CAP; maxD *= maxD;
    int32_t gen = ++L->seenGen;
    int qh = 0, qt = 0, cap = (int)L->groundStack.size();
    auto enqueue = [&](int x, int y) {
      if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows || qt >= cap) return;
      int dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
      if (dd < minD || dd > maxD) return;
      int k = I(x, y); if (L->seenStamp[k] == gen) return;
      L->seenStamp[k] = gen; L->groundStack[qt++] = k;
    };
    enqueue(tx, ty);
    static const int OFFS[8][2] = {{1,0},{-1,0},{0,1},{0,-1},{1,1},{-1,1},{1,-1},{-1,-1}};
    while (qh < qt) {
      int k = L->groundStack[qh++];
      if (!reservedTargets.count(k) && grid[k] == EMPTY) return k;
      if (!reservedTargets.count(k) && !isGasMaterial(grid[k])) continue;
      int y = k / cols, x = k - y * cols;
      for (auto& off : OFFS) enqueue(x + off[0], y + off[1]);
    }
    return -1;
  }

  void pushBlastGasesOutward(const std::vector<BlastWave>& waves) {
    if (waves.empty()) return;
    struct GasMove { int k, target, wave, dd; uint8_t material; };
    std::unordered_map<int, GasMove> byCell;
    for (int wi = 0; wi < (int)waves.size(); wi++) {
      const BlastWave& wave = waves[wi];
      int cx = wave.cx, cy = wave.cy, radius = wave.radius;
      int r2 = radius * radius;
      for (int oy = -radius; oy <= radius; oy++) {
        int yy = cy + oy; if (yy <= 0 || yy >= rows) continue;
        for (int ox = -radius; ox <= radius; ox++) {
          int dd = ox * ox + oy * oy; if (dd > r2) continue;
          int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue;
          int k = I(xx, yy); uint8_t m = grid[k]; if (!isGasMaterial(m)) continue;
          int deepness = r2 - dd;
          auto it = byCell.find(k);
          if (it == byCell.end() || deepness > it->second.dd) byCell[k] = {k, k, wi, deepness, m};
        }
      }
    }
    if (byCell.empty()) return;
    std::vector<GasMove> moves; moves.reserve(byCell.size());
    for (auto& kv : byCell) moves.push_back(kv.second);
    std::sort(moves.begin(), moves.end(), [](const GasMove& a, const GasMove& b) {
      if (a.dd != b.dd) return a.dd > b.dd;
      return a.k < b.k;
    });

    std::unordered_set<int> reservedTargets; reservedTargets.reserve(moves.size() * 2);
    for (auto& mv : moves) {
      if (!isGasMaterial(grid[mv.k])) continue;
      const BlastWave& wave = waves[mv.wave];
      int y = mv.k / cols, x = mv.k - y * cols;
      int target = blastGasTarget(x, y, wave.cx, wave.cy, wave.radius, wave.seed, reservedTargets);
      mv.target = target;
      if (mv.target >= 0) reservedTargets.insert(mv.target);
    }

    for (auto& mv : moves) if (isGasMaterial(grid[mv.k])) writeGridIndex(mv.k, EMPTY);
    for (auto& mv : moves) {
      if (mv.target < 0 || grid[mv.target] != EMPTY) continue;
      writeGridIndex(mv.target, mv.material);
      vacatedStamp[mv.target] = tick;
    }
  }

  void activateBlastRectNow(int x0, int y0, int x1, int y1) {
    x0 = imax(0, x0); x1 = imin(cols - 1, x1); y0 = imax(0, y0); y1 = imin(rows - 1, y1);
    for (int y = y0; y <= y1; y++) {
      if (x0 < activeRowMin[y]) activeRowMin[y] = x0;
      if (x1 > activeRowMax[y]) activeRowMax[y] = x1;
    }
  }

  bool blastBodyCandidateHasEscape(const std::vector<std::pair<int, int>>& cells, uint8_t material, bool footprintAlreadySolid) {
    if (cells.empty()) return false;
    double density = DENSITY[material];
    std::unordered_set<int> footprint; footprint.reserve(cells.size() * 2);
    for (auto& c : cells) {
      int x = c.first, y = c.second;
      if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows - 1) return false;
      int k = I(x, y);
      footprint.insert(k);
      if (!footprintAlreadySolid && !canBodyOccupy(grid[k], k, density)) return false;
    }
    static const int OFFS[4] = {-1, 1, 0, 0};
    static const int YOFFS[4] = {0, 0, -1, 1};
    for (auto& c : cells) {
      int x = c.first, y = c.second;
      for (int i = 0; i < 4; i++) {
        int nx = x + OFFS[i], ny = y + YOFFS[i];
        if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1) continue;
        int nk = I(nx, ny);
        if (footprint.count(nk)) continue;
        if (canBodyOccupy(grid[nk], nk, density)) return true;
      }
    }
    return false;
  }

  std::vector<std::pair<int, int>> blastBoxCells(int cx, int cy, int halfW, int halfH) {
    std::vector<std::pair<int, int>> cells;
    cells.reserve((size_t)imax(0, 2 * halfW) * imax(0, 2 * halfH));
    for (int dx = -halfW; dx < halfW; dx++)
      for (int dy = -halfH; dy < halfH; dy++) {
        int x = cx + dx, y = cy + dy;
        if (x >= 1 && x < cols - 1 && y >= 1 && y < rows - 1) cells.push_back({x, y});
      }
    return cells;
  }

  void spawnBlastDebrisFan(int cx, int cy, uint32_t bseed, uint8_t debrisMat, int sx0, int sy, int count, int salt, BlastBatch& bb, int tries = -1) {
    if (tries < count) tries = count;
    int spawned = 0;
    for (int i = 0; i < tries && spawned < count && bb.debrisSpawned < BLAST_DEBRIS_STEP_CAP && (int)L->bodies.size() < BLAST_DEBRIS_CAP; i++) {
      double j = whash2(bseed, salt + i, 13);
      int sx = sx0 + (i * 2 - (tries - 1)) * 2;
      std::vector<std::pair<int, int>> cells = blastBoxCells(sx, sy - 3, 1, 1);
      if (!blastBodyCandidateHasEscape(cells, debrisMat, false)) continue;
      Body* b = finishSpawn(cells, debrisMat);
      if (!b) continue;
      b->vx = (double)(sx - cx) * 0.16 + (j - 0.5);
      b->vy = -BLAST_DEBRIS_SPEED * (0.7 + 0.6 * j);
      b->awake = true; b->stillTicks = 0;
      bb.debrisSpawned++;
      spawned++;
    }
  }

  // Carve one durability-gated crater centred at (cx,cy) INTO the shared batch (no
  // finalize — that's finishBlasts). A cell at distance d survives iff its DURABILITY
  // exceeds the blast energy there: energy = power*(1 - d/radius). Soft blocks
  // (sand/dirt) are cleared almost to the rim; hard ones (iron ore) only near centre.
  // Destruction is component-safe and body-aware, reusing the eraser/mining primitives.
  void carveBlast(int cx, int cy, int radius, double power, BlastBatch& bb, Body* sourceBody = nullptr) {
    bb.any = true;
    if (cx - radius < bb.minX) bb.minX = cx - radius;
    if (cy - radius < bb.minY) bb.minY = cy - radius;
    if (cx + radius > bb.maxX) bb.maxX = cx + radius;
    if (cy + radius > bb.maxY) bb.maxY = cy + radius;
    int r2 = radius * radius;
    uint32_t bseed = (uint32_t)tick * 2654435761u ^ (uint32_t)(cy * cols + cx); // per-blast deterministic seed
    bb.gasShockwaves.push_back({cx, cy, radius, bseed});
    uint8_t debrisSeen[TABLE]; std::fill(debrisSeen, debrisSeen + TABLE, (uint8_t)0);
    std::vector<BlastDebrisSource> debrisSources;
    for (int oy = -radius; oy <= radius; oy++) {
      int yy = cy + oy; if (yy <= 0 || yy >= rows) continue;
      for (int ox = -radius; ox <= radius; ox++) {
        int dd = ox * ox + oy * oy; if (dd > r2) continue;
        int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue;
        int k = I(xx, yy); uint8_t m = grid[k]; if (!isBlastDamageable(m)) continue;
        double energy = power * (1.0 - std::sqrt((double)dd) / radius);
        if (energy < (double)DURABILITY[m]) continue; // too hard to blow up at this distance
        bool wasTnt = (m == TNT);
        if (wasTnt && dd > 0) {
          if (isBodyCell(k)) {
            if (!bb.bodyMapBuilt) { for (Body* b : L->bodies) bb.bodyById[b->id] = b; bb.bodyMapBuilt = true; }
            auto it = bb.bodyById.find(bodyOwner[k]);
            Body* hitBody = it == bb.bodyById.end() ? nullptr : it->second;
            if (hitBody != sourceBody) {
              shortenTntBodyFuse(hitBody, TNT_CHAIN_FUSE);
              markCellIndex(k);
              continue;
            }
          } else {
            // Keep chained static TNT physically present until its short fuse fires.
            // Erasing it here created stale cell-coordinate blasts a few ticks later.
            queueDetonation(k, TNT_CHAIN_FUSE);
            markCellIndex(k);
            continue;
          }
        }
        // body-material invariant: a body cell goes through the body system, a static
        // cell through the component-split system (see isBodyCell).
        if (isBodyCell(k)) {
          if (!bb.bodyMapBuilt) { for (Body* b : L->bodies) bb.bodyById[b->id] = b; bb.bodyMapBuilt = true; }
          if (!eraseBodyCellIndex(k, bb.bodyById, bb.dirtyBodies)) { grid[k] = EMPTY; bodyOwner[k] = -1; }
        } else {
          // Track each destroyed solid material as a physical-rubble source (never
          // TNT — exploding TNT must be consumed, not scattered as live shrapnel).
          if (m != TNT && isRigidMaterialClass(m) && !debrisSeen[m]) { debrisSeen[m] = 1; debrisSources.push_back({m, k}); }
          uint8_t group = componentGroupOf(m);
          if (group == CG_STONE) bb.erasedStone.push_back(k);
          else if (group == CG_ICE) bb.erasedIce.push_back(k);
          else if (group == CG_PLANT) bb.erasedPlant = true;
          grid[k] = EMPTY;
        }
        markCellIndex(k);
        // Cosmetic flecks of the destroyed material, flung outward (also how loose
        // powders/liquids in the blast get scattered). Capped + sparse so large
        // chains don't flood the item/particle pool.
        if (!isGasMaterial(m) && bb.particles < BLAST_PARTICLE_CAP && (((xx * 7) ^ (yy * 3)) % 8 == 0)) {
          double dist = std::sqrt((double)dd), inv = dist > 0.5 ? 1.0 / dist : 0.0;
          double sp = BLAST_PARTICLE_SPEED * (1.0 - dist / radius) * (0.5 + whash2(bseed, xx, yy));
          spawnParticle(m, xx + 0.5, yy + 0.5, ox * inv * sp, oy * inv * sp - 0.6, BLAST_PARTICLE_LIFE);
          bb.particles++;
        }
        // Record one aftermath cell per consumed TNT pixel. The write happens in
        // finishBlasts(), after component/body cleanup, so carry-forward cannot erase it.
        if (wasTnt) {
          double g = whash2(bseed, xx + 7, yy + 13);
          uint8_t aftermath = g < TNT_ACRID_FRAC ? ACRID_SMOKE : (g < TNT_ACRID_FRAC + TNT_STEAM_FRAC ? STEAM : FIRE);
          bb.tntAftermath.push_back({k, aftermath});
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
    if (whash2(bseed ^ 0xD3B15u, cx, cy) < BLAST_FORCED_DEBRIS_FRAC)
      spawnBlastDebrisFan(cx, cy, bseed, DEBRIS, cx, cy, BLAST_FORCED_DEBRIS_CHUNKS, 97, bb);
    // Eject a few physical rubble chunks of the destroyed solid, flung radially; they
    // tumble and BAKE into static rubble on landing (Phase 1). Capped so a big chain
    // can't flood the body solver.
    for (size_t di = 0; di < debrisSources.size() && bb.debrisSpawned < BLAST_DEBRIS_STEP_CAP && (int)L->bodies.size() < BLAST_DEBRIS_CAP; di++) {
      uint8_t debrisMat = debrisSources[di].material;
      int src = debrisSources[di].cell, sy = src / cols, sx0 = src - sy * cols;
      spawnBlastDebrisFan(cx, cy, bseed, debrisMat, sx0, sy, BLAST_DEBRIS_CHUNKS, (int)di * 17, bb, BLAST_DEBRIS_SOURCE_TRIES);
    }
  }

  void finishBlasts(BlastBatch& bb) {
    if (!bb.any) return;
    finishErasedBodies(bb.dirtyBodies, L->bodyCells);
    splitComponentsAfterDestroy(bb.erasedStone, bb.erasedIce, bb.erasedPlant);
    for (auto& pr : bb.tntAftermath) if (grid[pr.first] == EMPTY) { writeGridIndex(pr.first, pr.second); vacatedStamp[pr.first] = tick; }
    pushBlastGasesOutward(bb.gasShockwaves);
    int gasX0 = bb.minX - BLAST_GAS_SEARCH_CAP, gasY0 = bb.minY - BLAST_GAS_SEARCH_CAP;
    int gasX1 = bb.maxX + BLAST_GAS_SEARCH_CAP, gasY1 = bb.maxY + BLAST_GAS_SEARCH_CAP;
    activateBlastRectNow(gasX0, gasY0, gasX1, gasY1);
    markDirtyRect(gasX0, gasY0, gasX1, gasY1);
  }

  void carveBlastAcrossLayers(int cx, int cy, int radius, double power, BlastBatch& bb, BlastBatch* otherBb, Body* sourceBody = nullptr) {
    Layer* src = L;
    size_t srcAftermath0 = bb.tntAftermath.size();
    carveBlast(cx, cy, radius, power, bb, sourceBody);
    size_t srcAftermath1 = bb.tntAftermath.size();
    if (!bgEnabled || !otherBb) return;
    Layer* other = (src == &fg) ? &bg : &fg;
    useLayer(other);
    size_t otherAftermath0 = otherBb->tntAftermath.size();
    carveBlast(cx, cy, radius, power, *otherBb, nullptr);
    size_t otherAftermath1 = otherBb->tntAftermath.size();
    otherBb->tntAftermath.insert(otherBb->tntAftermath.end(), bb.tntAftermath.begin() + srcAftermath0, bb.tntAftermath.begin() + srcAftermath1);
    useLayer(src);
    bb.tntAftermath.insert(bb.tntAftermath.end(), otherBb->tntAftermath.begin() + otherAftermath0, otherBb->tntAftermath.begin() + otherAftermath1);
  }

  void finishBlastBatches(BlastBatch& bb, BlastBatch* otherBb) {
    Layer* src = L;
    if (bgEnabled && otherBb) {
      Layer* other = (src == &fg) ? &bg : &fg;
      useLayer(other);
      finishBlasts(*otherBb);
      useLayer(src);
    }
    finishBlasts(bb);
  }

  // Single-blast convenience wrapper (one crater, its own finalize).
  void detonate(int cx, int cy, int radius, double power) {
    BlastBatch bb, otherBb; carveBlastAcrossLayers(cx, cy, radius, power, bb, &otherBb); finishBlastBatches(bb, &otherBb);
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
      int minX, maxX; if (!activeRowSpan(y, minX, maxX)) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); uint8_t m = grid[k]; if (m != FIRE && m != LAVA) continue;
        lightTnt(k + 1); lightTnt(k - 1); lightTnt(k + cols); lightTnt(k - cols);
      }
    }
    BlastBatch bb, otherBb;
    // 2) Tick static fuses; carve the expired ones in deterministic (sorted) order.
    if (!L->pendingDetonations.empty()) {
      std::vector<int> fire;
      for (auto& kv : L->pendingDetonations) if (--kv.second <= 0) fire.push_back(kv.first);
      std::sort(fire.begin(), fire.end());
      for (int cell : fire) {
        if (cell >= 0 && cell < cols * rows && grid[cell] == TNT && !isBodyCell(cell))
          carveBlastAcrossLayers(cell % cols, cell / cols, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, &otherBb);
      }
      for (int cell : fire) L->pendingDetonations.erase(cell);
    }
    // 3) Tick body fuses; an expired TNT body detonates at its centre (the blast
    //    consumes its own cells, so finishErasedBodies removes the now-empty body).
    std::vector<std::pair<int, int>> bodyBlasts;
    std::vector<Body*> bodyBlastSources;
    for (Body* b : L->bodies) if (b->material == TNT && b->fuseTicks > 0 && --b->fuseTicks <= 0) {
      bodyBlasts.push_back({(int)std::lround(b->px), (int)std::lround(b->py)});
      bodyBlastSources.push_back(b);
    }
    for (size_t i = 0; i < bodyBlasts.size(); i++)
      carveBlastAcrossLayers(bodyBlasts[i].first, bodyBlasts[i].second, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, &otherBb, bodyBlastSources[i]);
    finishBlastBatches(bb, &otherBb); // one finalize per layer for every crater of this step
  }
