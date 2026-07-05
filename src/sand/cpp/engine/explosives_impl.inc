// ExplosivesSystem method bodies (need the full Engine definition; see explosives.hpp).

void ExplosivesSystem::queueDetonation(int cell, int fuse) {
  auto& pd = E.L->pendingDetonations;
  if (!pd.count(cell)) pd[cell] = fuse;
}
void ExplosivesSystem::shortenTntBodyFuse(Body* b, int fuse) {
  if (!b || b->material != TNT) return;
  if (b->fuseTicks <= 0 || b->fuseTicks > fuse) b->fuseTicks = fuse;
  b->awake = true; b->stillTicks = 0;
}

void ExplosivesSystem::spawnBlastRingGases(const std::vector<BlastWave>& waves) {
  for (const BlastWave& wave : waves) {
    int cx = wave.cx, cy = wave.cy, radius = wave.radius;
    int r2 = radius * radius;
    int inner = imax(1, radius - BLAST_GAS_RING_DEPTH);
    int inner2 = inner * inner;
    for (int oy = -radius; oy <= radius; oy++) {
      int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue;
      for (int ox = -radius; ox <= radius; ox++) {
        int dd = ox * ox + oy * oy; if (dd < inner2 || dd > r2) continue;
        int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue;
        int k = E.I(xx, yy);
        if (E.L->grid[k] != EMPTY && !E.isGasMaterial(E.L->grid[k])) continue;
        double g = whash2(wave.seed ^ 0xA511E9B3u, xx, yy);
        uint8_t m = g < TNT_ACRID_FRAC ? ACRID_SMOKE : (g < TNT_ACRID_FRAC + TNT_STEAM_FRAC ? STEAM : FIRE);
        E.writeGridIndex(k, m);
        E.L->vacatedStamp[k] = E.tick;
        E.L->blastGasStamp[k] = E.tick;
      }
    }
  }
}

void ExplosivesSystem::activateBlastRectNow(int x0, int y0, int x1, int y1) {
  x0 = imax(0, x0); x1 = imin(E.cols - 1, x1); y0 = imax(0, y0); y1 = imin(E.rows - 1, y1);
  for (int y = y0; y <= y1; y++) {
    if (x0 < E.L->activeRowMin[y]) E.L->activeRowMin[y] = x0;
    if (x1 > E.L->activeRowMax[y]) E.L->activeRowMax[y] = x1;
  }
}

bool ExplosivesSystem::blastBodyCandidateHasEscape(const std::vector<std::pair<int, int>>& cells, uint8_t material, bool footprintAlreadySolid) {
  if (cells.empty()) return false;
  double density = DENSITY[material];
  std::unordered_set<int> footprint; footprint.reserve(cells.size() * 2);
  for (auto& c : cells) {
    int x = c.first, y = c.second;
    if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows - 1) return false;
    int k = E.I(x, y);
    footprint.insert(k);
    if (!footprintAlreadySolid && !E.canBodyOccupy(E.L->grid[k], k, density)) return false;
  }
  static const int OFFS[4] = {-1, 1, 0, 0};
  static const int YOFFS[4] = {0, 0, -1, 1};
  for (auto& c : cells) {
    int x = c.first, y = c.second;
    for (int i = 0; i < 4; i++) {
      int nx = x + OFFS[i], ny = y + YOFFS[i];
      if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows - 1) continue;
      int nk = E.I(nx, ny);
      if (footprint.count(nk)) continue;
      if (E.canBodyOccupy(E.L->grid[nk], nk, density)) return true;
    }
  }
  return false;
}

std::vector<std::pair<int, int>> ExplosivesSystem::blastBoxCells(int cx, int cy, int halfW, int halfH) {
  std::vector<std::pair<int, int>> cells;
  cells.reserve((size_t)imax(0, 2 * halfW) * imax(0, 2 * halfH));
  for (int dx = -halfW; dx < halfW; dx++)
    for (int dy = -halfH; dy < halfH; dy++) {
      int x = cx + dx, y = cy + dy;
      if (x >= 1 && x < E.cols - 1 && y >= 1 && y < E.rows - 1) cells.push_back({x, y});
    }
  return cells;
}

void ExplosivesSystem::spawnBlastDebrisFan(int cx, int cy, uint32_t bseed, uint8_t debrisMat, int sx0, int sy, int count, int salt, BlastBatch& bb, int tries) {
  if (tries < count) tries = count;
  int spawned = 0;
  for (int i = 0; i < tries && spawned < count && bb.debrisSpawned < BLAST_DEBRIS_STEP_CAP && (int)E.L->bodies.size() < BLAST_DEBRIS_CAP; i++) {
    double j = whash2(bseed, salt + i, 13);
    int sx = sx0 + (i * 2 - (tries - 1)) * 2;
    std::vector<std::pair<int, int>> cells = blastBoxCells(sx, sy - 3, 1, 1);
    if (!blastBodyCandidateHasEscape(cells, debrisMat, false)) continue;
    Body* b = E.finishSpawn(cells, debrisMat);
    if (!b) continue;
    b->vx = (double)(sx - cx) * 0.16 + (j - 0.5);
    b->vy = -BLAST_DEBRIS_SPEED * (0.7 + 0.6 * j);
    b->awake = true; b->stillTicks = 0;
    bb.debrisSpawned++;
    spawned++;
  }
}

bool ExplosivesSystem::blastEnergyDominated(BlastBatch& bb, int k, double energy) {
  size_t n = (size_t)E.cols * E.rows;
  if (bb.blastEnergyStamp.size() < n) {
    bb.blastEnergyStamp.assign(n, 0);
    bb.blastBestEnergy.assign(n, 0.0f);
  }
  if (bb.blastEnergyStamp[k] == bb.blastEnergyGen && (double)bb.blastBestEnergy[k] >= energy) return true;
  bb.blastEnergyStamp[k] = bb.blastEnergyGen;
  bb.blastBestEnergy[k] = (float)energy;
  return false;
}

void ExplosivesSystem::carveStaticTntCluster(const std::vector<int>& cells, BlastBatch& bb, BlastBatch* otherBb) {
  if (cells.empty()) return;
  int bucketCols = (E.cols + TNT_CLUSTER_BUCKET - 1) / TNT_CLUSTER_BUCKET;
  int bucketRows = (E.rows + TNT_CLUSTER_BUCKET - 1) / TNT_CLUSTER_BUCKET;
  std::vector<int> repByBucket((size_t)bucketCols * bucketRows, -1);
  std::vector<int> reps;
  reps.reserve(cells.size() / 16 + 1);
  for (int cell : cells) {
    int y = cell / E.cols, x = cell - y * E.cols;
    int bi = (y / TNT_CLUSTER_BUCKET) * bucketCols + (x / TNT_CLUSTER_BUCKET);
    if (repByBucket[bi] < 0) { repByBucket[bi] = cell; reps.push_back(cell); }
  }

  bb.any = true;
  for (int cell : cells) {
    if (cell < 0 || cell >= E.cols * E.rows || E.L->grid[cell] != TNT || E.isBodyCell(cell)) continue;
    int y = cell / E.cols, x = cell - y * E.cols;
    if (x - TNT_BLAST_RADIUS < bb.minX) bb.minX = x - TNT_BLAST_RADIUS;
    if (y - TNT_BLAST_RADIUS < bb.minY) bb.minY = y - TNT_BLAST_RADIUS;
    if (x + TNT_BLAST_RADIUS > bb.maxX) bb.maxX = x + TNT_BLAST_RADIUS;
    if (y + TNT_BLAST_RADIUS > bb.maxY) bb.maxY = y + TNT_BLAST_RADIUS;
    bb.erasedStone.push_back(cell);
    E.L->grid[cell] = EMPTY;
    E.markCellIndex(cell);
  }

  for (int cell : reps) {
    int y = cell / E.cols, x = cell - y * E.cols;
    carveBlastAcrossLayers(x, y, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, otherBb);
  }
}

// Carve one durability-gated crater centred at (cx,cy) INTO the shared batch (no
// finalize — that's finishBlasts). A cell at distance d survives iff its DURABILITY
// exceeds the blast energy there: energy = power*(1 - d/radius). Soft blocks
// (sand/dirt) are cleared almost to the rim; hard ones (iron ore) only near centre.
// Destruction is component-safe and body-aware, reusing the eraser/mining primitives.
void ExplosivesSystem::carveBlast(int cx, int cy, int radius, double power, BlastBatch& bb, Body* sourceBody) {
  bb.any = true;
  if (cx - radius < bb.minX) bb.minX = cx - radius;
  if (cy - radius < bb.minY) bb.minY = cy - radius;
  if (cx + radius > bb.maxX) bb.maxX = cx + radius;
  if (cy + radius > bb.maxY) bb.maxY = cy + radius;
  int r2 = radius * radius;
  uint32_t bseed = (uint32_t)E.tick * 2654435761u ^ (uint32_t)(cy * E.cols + cx); // per-blast deterministic seed
  bb.gasShockwaves.push_back({cx, cy, radius, bseed});
  uint8_t debrisSeen[TABLE]; std::fill(debrisSeen, debrisSeen + TABLE, (uint8_t)0);
  std::vector<BlastDebrisSource> debrisSources;
  for (int oy = -radius; oy <= radius; oy++) {
    int yy = cy + oy; if (yy <= 0 || yy >= E.rows) continue;
    for (int ox = -radius; ox <= radius; ox++) {
      int dd = ox * ox + oy * oy; if (dd > r2) continue;
      int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) continue;
      int k = E.I(xx, yy);
      double energy = power * (1.0 - std::sqrt((double)dd) / radius);
      if (blastEnergyDominated(bb, k, energy)) continue;
      uint8_t m = E.L->grid[k];
      if (E.isGasMaterial(m)) {
        E.L->grid[k] = EMPTY;
        E.markCellIndex(k);
        continue;
      }
      if (!E.isBlastDamageable(m)) continue;
      if (energy < (double)DURABILITY[m]) continue; // too hard to blow up at this distance
      bool wasTnt = (m == TNT);
      if (wasTnt && dd > 0) {
        if (E.isBodyCell(k)) {
          if (!bb.bodyMapBuilt) { for (Body* b : E.L->bodies) bb.bodyById[b->id] = b; bb.bodyMapBuilt = true; }
          auto it = bb.bodyById.find(E.L->bodyOwner[k]);
          Body* hitBody = it == bb.bodyById.end() ? nullptr : it->second;
          if (hitBody != sourceBody) {
            shortenTntBodyFuse(hitBody, TNT_CHAIN_FUSE);
            E.markCellIndex(k);
            continue;
          }
        } else {
          // Keep chained static TNT physically present until its short fuse fires.
          // Erasing it here created stale cell-coordinate blasts a few ticks later.
          queueDetonation(k, TNT_CHAIN_FUSE);
          E.markCellIndex(k);
          continue;
        }
      }
      // body-material invariant: a body cell goes through the body system, a static
      // cell through the component-split system (see isBodyCell).
      if (E.isBodyCell(k)) {
        if (!bb.bodyMapBuilt) { for (Body* b : E.L->bodies) bb.bodyById[b->id] = b; bb.bodyMapBuilt = true; }
        if (!E.eraseBodyCellIndex(k, bb.bodyById, bb.dirtyBodies)) { E.L->grid[k] = EMPTY; E.L->bodyOwner[k] = -1; }
      } else {
        // Track each destroyed solid material as a physical-rubble source (never
        // TNT — exploding TNT must be consumed, not scattered as live shrapnel).
        if (m != TNT && E.isRigidMaterialClass(m) && !debrisSeen[m]) { debrisSeen[m] = 1; debrisSources.push_back({m, k}); }
        uint8_t group = E.componentGroupOf(m);
        if (group == CG_STONE) bb.erasedStone.push_back(k);
        else if (group == CG_ICE) bb.erasedIce.push_back(k);
        else if (group == CG_PLANT) bb.erasedPlant = true;
        E.L->grid[k] = EMPTY;
      }
      E.markCellIndex(k);
      // Cosmetic flecks of the destroyed material, flung outward (also how loose
      // powders/liquids in the blast get scattered). Capped + sparse so large
      // chains don't flood the item/particle pool.
      if (!E.isGasMaterial(m) && bb.particles < BLAST_PARTICLE_CAP && (((xx * 7) ^ (yy * 3)) % 8 == 0)) {
        double dist = std::sqrt((double)dd), inv = dist > 0.5 ? 1.0 / dist : 0.0;
        double sp = BLAST_PARTICLE_SPEED * (1.0 - dist / radius) * (0.5 + whash2(bseed, xx, yy));
        E.spawnParticle(m, xx + 0.5, yy + 0.5, ox * inv * sp, oy * inv * sp - 0.6, BLAST_PARTICLE_LIFE);
        bb.particles++;
      }
    }
  }
  // Shockwave: shove nearby free bodies outward and wake them.
  for (Body* b : E.L->bodies) {
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
  for (size_t di = 0; di < debrisSources.size() && bb.debrisSpawned < BLAST_DEBRIS_STEP_CAP && (int)E.L->bodies.size() < BLAST_DEBRIS_CAP; di++) {
    uint8_t debrisMat = debrisSources[di].material;
    int src = debrisSources[di].cell, sy = src / E.cols, sx0 = src - sy * E.cols;
    spawnBlastDebrisFan(cx, cy, bseed, debrisMat, sx0, sy, BLAST_DEBRIS_CHUNKS, (int)di * 17, bb, BLAST_DEBRIS_SOURCE_TRIES);
  }
}

void ExplosivesSystem::finishBlasts(BlastBatch& bb) {
  if (!bb.any) return;
  E.finishErasedBodies(bb.dirtyBodies, E.L->bodyCells);
  E.splitComponentsAfterDestroy(bb.erasedStone, bb.erasedIce, bb.erasedPlant);
  spawnBlastRingGases(bb.gasShockwaves);
  activateBlastRectNow(bb.minX, bb.minY, bb.maxX, bb.maxY);
  E.markDirtyRect(bb.minX, bb.minY, bb.maxX, bb.maxY);
}

void ExplosivesSystem::carveBlastAcrossLayers(int cx, int cy, int radius, double power, BlastBatch& bb, BlastBatch* otherBb, Body* sourceBody) {
  Layer* src = E.L;
  carveBlast(cx, cy, radius, power, bb, sourceBody);
  if (!E.bgEnabled || !otherBb) return;
  Layer* other = (src == &E.fg) ? &E.bg : &E.fg;
  E.useLayer(other);
  carveBlast(cx, cy, radius, power, *otherBb, nullptr);
  E.useLayer(src);
}

void ExplosivesSystem::finishBlastBatches(BlastBatch& bb, BlastBatch* otherBb) {
  Layer* src = E.L;
  if (E.bgEnabled && otherBb) {
    Layer* other = (src == &E.fg) ? &E.bg : &E.fg;
    E.useLayer(other);
    finishBlasts(*otherBb);
    E.useLayer(src);
  }
  finishBlasts(bb);
}

// Single-blast convenience wrapper (one crater, its own finalize).
void ExplosivesSystem::detonate(int cx, int cy, int radius, double power) {
  BlastBatch bb, otherBb; carveBlastAcrossLayers(cx, cy, radius, power, bb, &otherBb); finishBlastBatches(bb, &otherBb);
}

// Step pass (dispatched in step.inc next to the other reactions): light TNT touching
// fire/lava, E.tick fuses, and detonate the expired ones — all into a single batch so a
// chain pays one finalize. Costs nothing when no TNT is present (the scan finds none;
// both fuse maps are empty), so checksums are unaffected.
void ExplosivesSystem::applyExplosives() {
  if (!E.L->pendingDetonations.empty()) {
    for (auto it = E.L->pendingDetonations.begin(); it != E.L->pendingDetonations.end(); ) {
      int k = it->first;
      if (k < 0 || k >= E.cols * E.rows || E.L->grid[k] != TNT || E.isBodyCell(k)) it = E.L->pendingDetonations.erase(it);
      else ++it;
    }
  }
  // 1) Ignite TNT touching fire/lava. Scanned from the HEAT (fire/lava is always in
  //    the active band) and lighting TNT NEIGHBOURS — mirroring how fire ignites
  //    flammables — so a settled, inert TNT block still lights. The first TNT is all
  //    we need: its blast chains the rest via queueDetonation in carveBlast().
  std::unordered_map<int, Body*> bodyById; bool builtBodies = false;
  auto lightTnt = [&](int igniter, int k) {
    if (E.L->grid[k] != TNT) return;
    if (E.L->grid[igniter] == FIRE && E.L->blastGasStamp[igniter] >= 0 && E.tick - E.L->blastGasStamp[igniter] <= TNT_FUSE_TICKS) return;
    if (E.isBodyCell(k)) {
      int id = E.L->bodyOwner[k];
      if (!builtBodies) { for (Body* b : E.L->bodies) bodyById[b->id] = b; builtBodies = true; }
      auto it = bodyById.find(id);
      if (it != bodyById.end() && it->second->fuseTicks == 0) it->second->fuseTicks = TNT_FUSE_TICKS;
    } else queueDetonation(k, TNT_FUSE_TICKS);
  };
  for (int y = 1; y < E.rows - 1; y++) {
    int minX, maxX; if (!E.activeRowSpan(y, minX, maxX)) continue;
    for (int x = minX; x <= maxX; x++) {
      int k = E.I(x, y); uint8_t m = E.L->grid[k]; if (m != FIRE && m != LAVA) continue;
      lightTnt(k, k + 1); lightTnt(k, k - 1); lightTnt(k, k + E.cols); lightTnt(k, k - E.cols);
    }
  }
  BlastBatch bb, otherBb;
  // 2) Tick static fuses; carve the expired ones in deterministic (sorted) order.
  if (!E.L->pendingDetonations.empty()) {
    std::vector<int> fire;
    for (auto& kv : E.L->pendingDetonations) if (--kv.second <= 0) fire.push_back(kv.first);
    std::sort(fire.begin(), fire.end());
    std::vector<int> staticFire;
    staticFire.reserve(fire.size());
    for (int cell : fire) {
      if (cell >= 0 && cell < E.cols * E.rows && E.L->grid[cell] == TNT && !E.isBodyCell(cell)) staticFire.push_back(cell);
    }
    if ((int)staticFire.size() >= TNT_CLUSTER_FAST_THRESHOLD) {
      carveStaticTntCluster(staticFire, bb, &otherBb);
    } else {
      for (int cell : staticFire)
        carveBlastAcrossLayers(cell % E.cols, cell / E.cols, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, &otherBb);
    }
    for (int cell : fire) E.L->pendingDetonations.erase(cell);
  }
  // 3) Tick body fuses; an expired TNT body detonates at its centre (the blast
  //    consumes its own cells, so finishErasedBodies removes the now-empty body).
  std::vector<std::pair<int, int>> bodyBlasts;
  std::vector<Body*> bodyBlastSources;
  for (Body* b : E.L->bodies) if (b->material == TNT && b->fuseTicks > 0 && --b->fuseTicks <= 0) {
    bodyBlasts.push_back({(int)std::lround(b->px), (int)std::lround(b->py)});
    bodyBlastSources.push_back(b);
  }
  for (size_t i = 0; i < bodyBlasts.size(); i++)
    carveBlastAcrossLayers(bodyBlasts[i].first, bodyBlasts[i].second, TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, &otherBb, bodyBlastSources[i]);
  finishBlastBatches(bb, &otherBb); // one finalize per layer for every crater of this step
}
