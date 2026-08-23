void ExplosivesSystem::buildBlastStencils() {
  auto build = [&](int radius, double power, std::vector<BlastOffset>& stencil,
                   std::vector<BlastGasOffset>& gasStencil) {
    int r2 = radius * radius;
    int inner = imax(1, radius - BLAST_GAS_RING_DEPTH);
    int inner2 = inner * inner;
    stencil.reserve((size_t)(radius * 2 + 1) * (radius * 2 + 1));
    gasStencil.reserve((size_t)(radius * 2 + 1) * BLAST_GAS_RING_DEPTH * 4);
    for (int oy = -radius; oy <= radius; oy++) for (int ox = -radius; ox <= radius; ox++) {
      int dd = ox * ox + oy * oy;
      if (dd > r2) continue;
      double dist = std::sqrt((double)dd);
      double energy = power * (1.0 - dist / radius);
      stencil.push_back({(int16_t)ox, (int16_t)oy, dist, energy});
      if (dd >= inner2) {
        double shell = (dist - (double)inner) / (double)(radius - inner);
        double keepP = BLAST_GAS_INNER_KEEP + (BLAST_GAS_OUTER_KEEP - BLAST_GAS_INNER_KEEP) * shell;
        gasStencil.push_back({(int16_t)ox, (int16_t)oy, keepP});
      }
    }
  };
  build(TNT_BLAST_RADIUS, TNT_BLAST_POWER, tntStencil, tntGasStencil);
  build(METHANE_BLAST_RADIUS, METHANE_BLAST_POWER, methaneStencil, methaneGasStencil);
}

void ExplosivesSystem::queueDetonation(int cell, int fuse) {
  auto& pd = E.L->pendingDetonations;
  auto inserted = pd.emplace(cell, fuse);
  auto it = inserted.first;
  uint8_t material = E.L->grid[cell];
  if (inserted.second) {
    E.audio.emit(SE_FUSE, cell % E.cols, cell / E.cols,
                 fuse <= TNT_CHAIN_FUSE ? 0.45 : 0.8, material);
  } else if (fuse < it->second) {
    it->second = fuse;
    E.audio.emit(SE_FUSE, cell % E.cols, cell / E.cols,
                 fuse <= TNT_CHAIN_FUSE ? 0.45 : 0.8, material);
  }
}
void ExplosivesSystem::shortenFuseBody(Body* b, int fuse,
                                      double sourceX, double sourceY) {
  if (!b) return;
  if (b->jointRole == 2) {
    if (!b->jointPeer) return;
    b = b->jointPeer;
  }
  uint8_t material = E.bodyMaterialWithExplosiveProfile(b, XP_TNT_FUSE);
  if (material == EMPTY) return;
  if (b->fuseTicks <= 0 || b->fuseTicks > fuse) {
    b->fuseTicks = fuse;
    E.rigid.setBodyFusePoint(b, sourceX, sourceY);
    E.audio.emit(SE_FUSE, b->px, b->py,
                 fuse <= TNT_CHAIN_FUSE ? 0.45 : 0.8, material);
  }
  b->awake = true; E.rigid.resetSleepTracking(b);
  if (b->jointRole == 1 && b->jointPeer) {
    b->jointPeer->fuseTicks = b->fuseTicks;
    b->jointPeer->fuseLocalX = b->fuseLocalX;
    b->jointPeer->fuseLocalY = b->fuseLocalY;
    E.rigid.syncJointFollower(b);
  }
}

void ExplosivesSystem::spawnBlastRingGases(const std::vector<BlastWave>& waves,
                                           int waveCap) {
  int count = imin((int)waves.size(), waveCap);
  for (int waveSlot = 0; waveSlot < count; waveSlot++) {
    const BlastWave& wave = waves[(size_t)waveSlot * waves.size() / count];
    int cx = wave.cx, cy = wave.cy, radius = wave.radius;
    int r2 = radius * radius;
    int inner = imax(1, radius - BLAST_GAS_RING_DEPTH);
    int inner2 = inner * inner;
    auto stamp = [&](int ox, int oy, double keepP) {
        int yy = cy + oy; if (yy <= 0 || yy >= E.rows) return;
        int xx = cx + ox; if (xx <= 0 || xx >= E.cols - 1) return;
        int k = E.I(xx, yy);
        if (E.L->grid[k] != EMPTY && !E.isGasMaterial(E.L->grid[k])) return;
        if (whash2(wave.seed ^ 0x6C8E9CF5u, xx, yy) >= keepP) return;
        double g = whash2(wave.seed ^ 0xA511E9B3u, xx, yy);
        uint8_t m = g < TNT_ACRID_FRAC ? ACRID_SMOKE
                  : (g < TNT_ACRID_FRAC + TNT_STEAM_FRAC ? STEAM : FIRE);
        E.writeGridIndexUnsafe(k, m);
        E.L->vacatedStamp[k] = E.tick;
        E.L->blastGasStamp[k] = E.tick;
    };
    const std::vector<BlastGasOffset>* gasStencil = radius == TNT_BLAST_RADIUS ? &tntGasStencil
      : (radius == METHANE_BLAST_RADIUS ? &methaneGasStencil : nullptr);
    if (gasStencil) {
      for (const BlastGasOffset& o : *gasStencil) stamp(o.ox, o.oy, o.keepP);
    } else {
      for (int oy = -radius; oy <= radius; oy++) for (int ox = -radius; ox <= radius; ox++) {
        int dd = ox * ox + oy * oy;
        if (dd < inner2 || dd > r2) continue;
        double dist = std::sqrt((double)dd);
        double shell = (dist - (double)inner) / (double)(radius - inner);
        double keepP = BLAST_GAS_INNER_KEEP + (BLAST_GAS_OUTER_KEEP - BLAST_GAS_INNER_KEEP) * shell;
        stamp(ox, oy, keepP);
      }
    }
  }
}

void ExplosivesSystem::activateBlastRectNow(int x0, int y0, int x1, int y1) {
  x0 = imax(0, x0); x1 = imin(E.cols - 1, x1); y0 = imax(0, y0); y1 = imin(E.rows - 1, y1);
  for (int y = y0; y <= y1; y++) E.activateRowSpanNow(y, x0, x1);
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
    if (!footprintAlreadySolid && !E.rigid.canBodyOccupy(E.L->grid[k], k, density)) return false;
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
      if (E.rigid.canBodyOccupy(E.L->grid[nk], nk, density)) return true;
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

ExplosivesSystem::BlastDebrisEjection ExplosivesSystem::inferBlastDebrisEjection(int cx, int cy) {
  // Sample the undisturbed terrain before carving. A weighted vector toward
  // nearby non-blocking cells is the local open-side normal of a wall, floor,
  // ceiling, or irregular surface. Symmetric open air and fully buried blasts
  // deliberately retain the established upward fallback.
  static constexpr int PROBE_RADIUS = 4;
  static constexpr double MIN_DIRECTIONALITY = 0.18;
  double sumX = 0, sumY = 0, weightSum = 0;
  for (int oy = -PROBE_RADIUS; oy <= PROBE_RADIUS; oy++)
    for (int ox = -PROBE_RADIUS; ox <= PROBE_RADIUS; ox++) {
      int dd = ox * ox + oy * oy;
      if (dd == 0 || dd > PROBE_RADIUS * PROBE_RADIUS) continue;
      int x = cx + ox, y = cy + oy;
      if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows - 1) continue;
      if (E.isBlockingForActor(E.L->grid[E.I(x, y)])) continue;
      double distance = std::sqrt((double)dd);
      double weight = 1.0 / distance;
      sumX += ox / distance * weight;
      sumY += oy / distance * weight;
      weightSum += weight;
    }
  double magnitude = std::hypot(sumX, sumY);
  BlastDebrisEjection result;
  if (weightSum > 0 && magnitude >= weightSum * MIN_DIRECTIONALITY) {
    result.nx = sumX / magnitude;
    result.ny = sumY / magnitude;
    result.terrainGuided = true;
  }
  return result;
}

void ExplosivesSystem::spawnBlastDebrisFan(int cx, int cy, uint32_t bseed,
                                           uint8_t debrisMat, int sx0, int sy,
                                           int count, int salt, BlastBatch& bb,
                                           const BlastDebrisEjection& fallback,
                                           int tries) {
  if (tries < count) tries = count;
  double dx = (double)cx - sx0, dy = (double)cy - sy;
  double dl = std::sqrt(dx * dx + dy * dy);
  bool sourceDirected = dl > 0.5;
  bool terrainDirected = !sourceDirected && fallback.terrainGuided;
  bool directed = sourceDirected || terrainDirected;
  double nx = sourceDirected ? dx / dl : fallback.nx;
  double ny = sourceDirected ? dy / dl : fallback.ny;
  double tx = -ny, ty = nx;
  static const int TANGENT[5] = {0, -2, 2, -4, 4};
  int spawned = 0;
  for (int i = 0; i < tries && spawned < count && bb.debrisSpawned < bb.debrisStepCap && (int)E.L->bodies.size() < BLAST_DEBRIS_CAP; i++) {
    double j = whash2(bseed, salt + i, 13);
    int sx, spawnY;
    if (directed) {
      int tangent = TANGENT[i % 5];
      int inset = 3 + i / 5;
      sx = (int)std::lround(sx0 + nx * inset + tx * tangent);
      spawnY = (int)std::lround(sy + ny * inset + ty * tangent);
    } else {
      sx = sx0 + (i * 2 - (tries - 1)) * 2;
      spawnY = sy - 3;
    }
    std::vector<std::pair<int, int>> cells = blastBoxCells(sx, spawnY, 1, 1);
    if (!blastBodyCandidateHasEscape(cells, debrisMat, false)) continue;
    Body* b = E.rigid.finishSpawn(cells, debrisMat, false);
    if (!b) continue;
    b->blastDebris = true;
    if (directed) {
      double speed = BLAST_DEBRIS_SPEED * (0.7 + 0.6 * j);
      b->vx = nx * speed + tx * (j - 0.5);
      b->vy = ny * speed + ty * (j - 0.5) - 0.35;
    } else {
      b->vx = (double)(sx - cx) * 0.16 + (j - 0.5);
      b->vy = -BLAST_DEBRIS_SPEED * (0.7 + 0.6 * j);
    }
    b->awake = true; E.rigid.resetSleepTracking(b);
    bb.debrisSpawned++;
    spawned++;
  }
}

void ExplosivesSystem::buildBlastDamage(const BlastBatch& bb) {
  if (bb.waves.empty()) {
    plannedWidth = plannedHeight = 0;
    plannedDamageCells.clear();
    return;
  }
  plannedX0 = imax(1, bb.minX);
  plannedY0 = imax(1, bb.minY);
  int x1 = imin(E.cols - 2, bb.maxX);
  int y1 = imin(E.rows - 1, bb.maxY);
  plannedWidth = imax(0, x1 - plannedX0 + 1);
  plannedHeight = imax(0, y1 - plannedY0 + 1);
  size_t area = (size_t)plannedWidth * plannedHeight;
  size_t estimatedVisits = 0;
  for (const BlastWave& wave : bb.waves) {
    if (wave.radius == TNT_BLAST_RADIUS) estimatedVisits += tntStencil.size();
    else if (wave.radius == METHANE_BLAST_RADIUS) estimatedVisits += methaneStencil.size();
    else estimatedVisits += (size_t)(wave.radius * 2 + 1) * (wave.radius * 2 + 1);
  }
  plannedDense = area <= estimatedVisits * 2 + 1024;
  if (plannedDense) {
    plannedDamage.resize(area);
    plannedBestWave.assign(area, -1);
  } else {
    size_t n = (size_t)E.cols * E.rows;
    if (plannedDamage.size() < n) plannedDamage.resize(n);
    if (plannedBestWave.size() < n) plannedBestWave.resize(n);
    if (plannedDamageStamp.size() < n) plannedDamageStamp.resize(n);
    if (plannedDamageGen == INT32_MAX) {
      std::fill(plannedDamageStamp.begin(), plannedDamageStamp.end(), 0);
      plannedDamageGen = 1;
    } else {
      plannedDamageGen++;
    }
    plannedDamageCells.clear();
    plannedDamageCells.reserve(imin((int)n, (int)estimatedVisits));
  }

  auto addDamage = [&](int waveIndex, int x, int y, double energy) {
    if (x < plannedX0 || x >= plannedX0 + plannedWidth
        || y < plannedY0 || y >= plannedY0 + plannedHeight) return;
    int index;
    if (plannedDense) {
      index = (y - plannedY0) * plannedWidth + x - plannedX0;
      if (plannedBestWave[index] >= 0
          && (double)plannedDamage[index] >= energy) return;
    } else {
      index = y * E.cols + x;
      if (plannedDamageStamp[index] == plannedDamageGen) {
        if ((double)plannedDamage[index] >= energy) return;
      } else {
        plannedDamageStamp[index] = plannedDamageGen;
        plannedDamageCells.push_back(index);
      }
    }
    plannedDamage[index] = (float)energy;
    plannedBestWave[index] = waveIndex;
  };

  for (int waveIndex = 0; waveIndex < (int)bb.waves.size(); waveIndex++) {
    const BlastWave& wave = bb.waves[waveIndex];
    const std::vector<BlastOffset>* stencil = wave.radius == TNT_BLAST_RADIUS ? &tntStencil
      : (wave.radius == METHANE_BLAST_RADIUS ? &methaneStencil : nullptr);
    if (stencil) {
      double stencilPower = wave.radius == TNT_BLAST_RADIUS
        ? TNT_BLAST_POWER : METHANE_BLAST_POWER;
      if (wave.power == stencilPower) {
        for (const BlastOffset& offset : *stencil)
          addDamage(waveIndex, wave.cx + offset.ox, wave.cy + offset.oy, offset.energy);
      } else {
        for (const BlastOffset& offset : *stencil)
          addDamage(waveIndex, wave.cx + offset.ox, wave.cy + offset.oy,
                    wave.power * (1.0 - offset.dist / wave.radius));
      }
      continue;
    }
    int r2 = wave.radius * wave.radius;
    for (int oy = -wave.radius; oy <= wave.radius; oy++)
      for (int ox = -wave.radius; ox <= wave.radius; ox++) {
        int dd = ox * ox + oy * oy;
        if (dd > r2) continue;
        double dist = std::sqrt((double)dd);
        addDamage(waveIndex, wave.cx + ox, wave.cy + oy,
                  wave.power * (1.0 - dist / wave.radius));
      }
  }
}

void ExplosivesSystem::carveStaticFuseCluster(const std::vector<int>& cells,
                                              BlastBatch& bb,
                                              BlastBatch* otherBb,
                                              bool massFront) {
  if (cells.empty()) return;
  if (massFront || (int)cells.size() >= TNT_MASS_FRONT_CELLS) {
    bb.debrisStepCap = BLAST_MASS_DEBRIS_STEP_CAP;
    bb.gasWaveCap = TNT_MASS_GAS_WAVES_PER_STEP;
    if (otherBb) {
      otherBb->debrisStepCap = BLAST_MASS_DEBRIS_STEP_CAP;
      otherBb->gasWaveCap = TNT_MASS_GAS_WAVES_PER_STEP;
    }
  }
  std::vector<int> reps;
  if (!massFront && (int)cells.size() <= TNT_COMPACT_FRONT_CELLS) {
    reps.push_back(cells[cells.size() / 2]);
  } else {
    int bucketCols = (E.cols + TNT_CLUSTER_BUCKET - 1) / TNT_CLUSTER_BUCKET;
    int bucketRows = (E.rows + TNT_CLUSTER_BUCKET - 1) / TNT_CLUSTER_BUCKET;
    std::vector<int> repByBucket((size_t)bucketCols * bucketRows, -1);
    reps.reserve(cells.size() / 16 + 1);
    for (int cell : cells) {
      int y = cell / E.cols, x = cell - y * E.cols;
      int bi = (y / TNT_CLUSTER_BUCKET) * bucketCols + (x / TNT_CLUSTER_BUCKET);
      if (repByBucket[bi] < 0) { repByBucket[bi] = cell; reps.push_back(cell); }
    }
  }

  bb.waves.reserve(bb.waves.size() + reps.size());
  if (otherBb) otherBb->waves.reserve(otherBb->waves.size() + reps.size());
  bb.any = true;
  // The entire due front is part of this transaction even when only spatial
  // representatives contribute crater energy.
  for (int cell : cells) {
    if (cell < 0 || cell >= E.cols * E.rows
        || !E.isFuseExplosive(E.L->grid[cell]) || E.isBodyCell(cell))
      continue;
    int y = cell / E.cols, x = cell - y * E.cols;
    if (x - TNT_BLAST_RADIUS < bb.minX) bb.minX = x - TNT_BLAST_RADIUS;
    if (y - TNT_BLAST_RADIUS < bb.minY) bb.minY = y - TNT_BLAST_RADIUS;
    if (x + TNT_BLAST_RADIUS > bb.maxX) bb.maxX = x + TNT_BLAST_RADIUS;
    if (y + TNT_BLAST_RADIUS > bb.maxY) bb.maxY = y + TNT_BLAST_RADIUS;
    bb.forcedStaticFuse.push_back(cell);
  }

  for (int cell : reps) {
    uint8_t material = E.L->grid[cell];
    if (!E.isFuseExplosive(material)) continue;
    carveBlastAcrossLayers(cell % E.cols, cell / E.cols,
                          TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, otherBb,
                          nullptr, material);
  }
}

// Add one durability-gated crater to the shared damage field. No terrain,
// components, bodies, fuses, or effects are changed here. A cell's strongest
// overlapping wave is classified once after every active crater is known.
void ExplosivesSystem::carveBlast(int cx, int cy, int radius, double power, BlastBatch& bb, Body* sourceBody,
                                 uint8_t explosiveMaterial, uint32_t seedSerial) {
  bb.any = true;
  BlastDebrisEjection debrisEjection = inferBlastDebrisEjection(cx, cy);
  if (E.isPocketExplosive(explosiveMaterial))
    bb.debrisStepCap = METHANE_DEBRIS_STEP_CAP;
  if (cx - radius < bb.minX) bb.minX = cx - radius;
  if (cy - radius < bb.minY) bb.minY = cy - radius;
  if (cx + radius > bb.maxX) bb.maxX = cx + radius;
  if (cy + radius > bb.maxY) bb.maxY = cy + radius;
  uint32_t serial = seedSerial == UINT32_MAX ? (uint32_t)E.tick : seedSerial;
  uint32_t bseed = serial * 2654435761u ^ (uint32_t)(cy * E.cols + cx); // per-blast deterministic seed
  bb.waves.emplace_back();
  BlastWave& wave = bb.waves.back();
  wave.cx = cx;
  wave.cy = cy;
  wave.radius = radius;
  wave.seed = bseed;
  wave.power = power;
  wave.explosiveMaterial = explosiveMaterial;
  wave.debrisEjection = debrisEjection;
  wave.debrisSlots.fill(-1);
  if (sourceBody) bb.sourceBodies.insert(sourceBody);
}

void ExplosivesSystem::evaluateBlastPlan(BlastBatch& bb) {
  if (!bb.any) return;
  const size_t n = (size_t)E.cols * E.rows;
  if (plannedRemovalStamp.size() < n) plannedRemovalStamp.resize(n);
  if (plannedRemovalGen == INT32_MAX) {
    std::fill(plannedRemovalStamp.begin(), plannedRemovalStamp.end(), 0);
    plannedRemovalGen = 1;
  } else {
    plannedRemovalGen++;
  }
  auto removalPlanned = [&](int k) {
    return plannedRemovalStamp[k] == plannedRemovalGen;
  };
  auto markRemoval = [&](int k) {
    plannedRemovalStamp[k] = plannedRemovalGen;
  };
  auto ensureBodyMap = [&]() {
    if (bb.bodyMapBuilt) return;
    for (Body* b : E.L->bodies) bb.bodyById[b->id] = b;
    bb.bodyMapBuilt = true;
  };
  auto planStaticCut = [&](int k, uint8_t material, int waveIndex, int dd,
                           bool collectAftermath) {
    if (removalPlanned(k)) return;
    markRemoval(k);
    bb.staticCuts.push_back({k, material});
    if (E.isComponentMaterial(material)) {
      bb.erasedStructural.push_back(k);
    }
    if (collectAftermath && bb.debrisStepCap > 0
        && !E.isFuseExplosive(material) && E.isRigidMaterialClass(material)
        && waveIndex >= 0 && waveIndex < (int)bb.waves.size()) {
      BlastWave& wave = bb.waves[waveIndex];
      static const int SAMPLE_COUNT =
        BLAST_DEBRIS_SAMPLE_SIDE * BLAST_DEBRIS_SAMPLE_SIDE;
      int y = k / E.cols, x = k - y * E.cols;
      int ox = x - wave.cx, oy = y - wave.cy;
      int sampleThird = imax(1, wave.radius / 3);
      int bx = ox < -sampleThird ? 0 : (ox > sampleThird ? 2 : 1);
      int by = oy < -sampleThird ? 0 : (oy > sampleThird ? 2 : 1);
      int sample = (int)material * SAMPLE_COUNT
                 + by * BLAST_DEBRIS_SAMPLE_SIDE + bx;
      int candidateIndex = wave.debrisSlots[sample];
      if (candidateIndex < 0) {
        wave.debrisSlots[sample] = (int16_t)wave.debrisCandidates.size();
        wave.debrisCandidates.push_back({material, k, dd});
      } else if (dd < wave.debrisCandidates[candidateIndex].dd) {
        wave.debrisCandidates[candidateIndex] = {material, k, dd};
      }
    }
  };

  // Dense static fronts are consumed by the transaction but do not become
  // thousands of independent crater effects.
  for (int k : bb.forcedStaticFuse) {
    if (k < 0 || k >= E.cols * E.rows
        || !E.isFuseExplosive(E.L->grid[k]) || E.isBodyCell(k))
      continue;
    planStaticCut(k, E.L->grid[k], -1, 0, false);
  }

  auto evaluateCell = [&](int k, double energy, int waveIndex) {
    if (removalPlanned(k)) return;
    uint8_t material = E.L->grid[k];
    if (E.isGasMaterial(material)) {
      markRemoval(k);
      bb.gasCuts.push_back(k);
      return;
    }
    E.noteLooseGroundTouch(material);
    if (!E.isBlastDamageable(material)
        || energy < (double)DURABILITY[material]) return;
    if (waveIndex < 0 || waveIndex >= (int)bb.waves.size()) return;
    BlastWave& wave = bb.waves[waveIndex];
    int y = k / E.cols, x = k - y * E.cols;
    int ox = x - wave.cx, oy = y - wave.cy;
    int dd = ox * ox + oy * oy;
    bool bodyCell = E.isBodyCell(k);
    Body* hitBody = nullptr;
    if (bodyCell) {
      ensureBodyMap();
      auto it = bb.bodyById.find(E.L->bodyOwner[k]);
      if (it != bb.bodyById.end()) hitBody = it->second;
    }
    if (E.isFuseExplosive(material) && dd > 0) {
      if (bodyCell) {
        if (hitBody && !bb.sourceBodies.count(hitBody)) {
          auto ignition = bb.fuseBodyIgnitions.find(hitBody);
          if (ignition == bb.fuseBodyIgnitions.end()
              || dd < ignition->second.distanceSquared)
            bb.fuseBodyIgnitions[hitBody] = {k, dd};
          return;
        }
      } else {
        bb.staticFuseIgnitions.push_back(k);
        return;
      }
    }
    if (bodyCell) {
      markRemoval(k);
      bb.bodyCuts.push_back(k);
    } else {
      planStaticCut(k, material, waveIndex, dd, true);
    }
    if (bb.emitParticles && bb.particles < BLAST_PARTICLE_CAP
        && (((x * 7) ^ (y * 3)) % 8 == 0)) {
      double dist = std::sqrt((double)dd);
      double inv = dist > 0.5 ? 1.0 / dist : 0.0;
      double speed = BLAST_PARTICLE_SPEED * (1.0 - dist / wave.radius)
                   * (0.5 + whash2(wave.seed, x, y));
      bb.particlePlans.push_back({
        material, x + 0.5, y + 0.5,
        ox * inv * speed, oy * inv * speed - 0.6,
      });
      bb.particles++;
    }
  };
  if (plannedDense) {
    for (int y = 0; y < plannedHeight; y++)
      for (int x = 0; x < plannedWidth; x++) {
        int index = y * plannedWidth + x;
        int waveIndex = plannedBestWave[index];
        if (waveIndex < 0) continue;
        int k = (plannedY0 + y) * E.cols + plannedX0 + x;
        evaluateCell(k, plannedDamage[index], waveIndex);
      }
  } else {
    for (int k : plannedDamageCells)
      evaluateCell(k, plannedDamage[k], plannedBestWave[k]);
  }
}

void ExplosivesSystem::applyBlastCuts(BlastBatch& bb) {
  if (!bb.any) return;
  auto clearCellState = [&](int cell) {
    E.writeGridIndexUnsafe(cell, EMPTY);
    E.L->clearMotionSpan((size_t)cell, 1);
  };
  for (int k : bb.gasCuts) {
    if (E.isGasMaterial(E.L->grid[k])) clearCellState(k);
  }
  for (const BlastCellRemoval& cut : bb.staticCuts) {
    if (!E.isBodyCell(cut.cell) && E.L->grid[cut.cell] == cut.material)
      clearCellState(cut.cell);
  }
  if (!bb.bodyCuts.empty() && !bb.bodyMapBuilt) {
    for (Body* b : E.L->bodies) bb.bodyById[b->id] = b;
    bb.bodyMapBuilt = true;
  }
  for (int k : bb.bodyCuts) {
    if (!E.rigid.eraseBodyCellIndex(k, bb.bodyById, bb.dirtyBodies)) {
      clearCellState(k);
      E.L->bodyOwner[k] = -1;
    }
  }
  std::unordered_set<Body*> dirtyJoints;
  for (Body* body : bb.dirtyBodies)
    if (body->jointRole)
      dirtyJoints.insert(body->jointRole == 1 ? body : body->jointPeer);
  // Set the fuse while every recorded body is still alive. Ordinary bodies can
  // be replaced below by split fragments, which inherit this countdown.
  for (const auto& entry : bb.fuseBodyIgnitions) {
    int cell = entry.second.cell;
    shortenFuseBody(entry.first, TNT_CHAIN_FUSE,
                    cell % E.cols + 0.5, cell / E.cols + 0.5);
  }
  // The mirrored layer has not applied its cuts yet. Ordinary bodies can split
  // now; cross-layer bodies split once the complete two-layer cut is visible.
  E.rigid.finishErasedBodies(bb.dirtyBodies, E.L->bodyCells, false);
  bb.dirtyBodies = std::move(dirtyJoints);
  for (int k : bb.staticFuseIgnitions) {
    if (E.isFuseExplosive(E.L->grid[k]) && !E.isBodyCell(k))
      queueDetonation(k, TNT_CHAIN_FUSE);
  }
}

void ExplosivesSystem::repairBlastStructures(BlastBatch& bb) {
  if (!bb.any) return;
  E.comps.splitRigidAfterBlast(bb.erasedStructural);
}

bool ExplosivesSystem::applyBlastImpulse(Body* body, int cx, int cy,
                                         int radius, double power) {
  if (!body || body->jointRole == 2 || radius <= 0 || power <= 0
      || body->invMass <= 0) return false;

  // Pressure acts on the exposed raster cells, not at the centre of mass. This
  // lets a wave catch the end of a long body and gives an asymmetric hit the
  // angular impulse generated by its actual lever arm. Joint exposure is tested
  // against the ownership union of both layers.
  Body* follower = body->jointRole == 1 ? body->jointPeer : nullptr;
  Layer* followerLayer = E.L == &E.fg ? &E.bg : &E.fg;
  E.rigid.ensureBodyRaster(body);
  if (follower) E.rigid.ensureBodyRaster(follower);
  auto occupied = [&](int cell) {
    if (E.L->bodyOwner[cell] == body->id) return true;
    return follower && followerLayer->bodyOwner[cell] == follower->id;
  };
  double impulseX = 0, impulseY = 0, angularImpulse = 0;
  double powerScale = power / TNT_BLAST_POWER;
  auto accumulateMember = [&](Body* member, Layer* layer, bool dedupeLeader) {
    for (const BodyRasterCell& raster : member->rasterBoundaryFootprint) {
      int cell = raster.y * E.cols + raster.x;
      if (layer->bodyOwner[cell] != member->id
          || (dedupeLeader && E.L->bodyOwner[cell] == body->id))
        continue;
      int x = raster.x, y = raster.y;
      bool exposed = x == 0 || x + 1 == E.cols
        || y == 0 || y + 1 == E.rows
        || !occupied(cell - 1) || !occupied(cell + 1)
        || !occupied(cell - E.cols) || !occupied(cell + E.cols);
      if (!exposed) continue;
      double dx = x - cx, dy = y - cy;
      double distance2 = dx * dx + dy * dy;
      if (distance2 >= (double)radius * radius || distance2 < 0.0001)
        continue;
      double distance = std::sqrt(distance2);
      double pressureImpulse = BLAST_PUSH * powerScale
                             * (1.0 - distance / radius);
      double cellImpulseX = dx * pressureImpulse / distance;
      double cellImpulseY = dy * pressureImpulse / distance;
      impulseX += cellImpulseX;
      impulseY += cellImpulseY;
      double leverX = x + 0.5 - body->px;
      double leverY = y + 0.5 - body->py;
      angularImpulse += leverX * cellImpulseY - leverY * cellImpulseX;
    }
  };
  accumulateMember(body, E.L, false);
  if (follower) accumulateMember(follower, followerLayer, true);
  if (impulseX == 0 && impulseY == 0 && angularImpulse == 0) return false;
  body->vx += impulseX * body->invMass;
  body->vy += impulseY * body->invMass;
  body->omega += angularImpulse * body->invInertia;
  body->awake = true;
  E.rigid.resetSleepTracking(body);
  if (body->jointRole == 1) E.rigid.syncJointFollower(body);
  return true;
}

void ExplosivesSystem::applyBlastAftermath(BlastBatch& bb) {
  if (!bb.any) return;
  if (bb.emitParticles)
    for (const BlastParticlePlan& particle : bb.particlePlans)
      E.itemsys.spawnParticle(particle.material, particle.x, particle.y,
                              particle.vx, particle.vy, BLAST_PARTICLE_LIFE);

  static const int SAMPLE_COUNT = BLAST_DEBRIS_SAMPLE_SIDE * BLAST_DEBRIS_SAMPLE_SIDE;
  for (BlastWave& wave : bb.waves) {
    // Every impulse observes the completed cut and repair. Processing waves in
    // order accumulates impulses on bodies and rubble emitted by earlier waves.
    for (Body* b : E.L->bodies) {
      double reach = b->maxR + 1.0;
      if (b->jointRole == 2
          || b->px + reach <= wave.cx - wave.radius
          || b->px - reach >= wave.cx + wave.radius
          || b->py + reach <= wave.cy - wave.radius
          || b->py - reach >= wave.cy + wave.radius) continue;
      if (applyBlastImpulse(b, wave.cx, wave.cy, wave.radius, wave.power)
          && E.bodyContainsExplosiveProfile(b, XP_TNT_FUSE))
        shortenFuseBody(b, TNT_CHAIN_FUSE,
                        wave.cx + 0.5, wave.cy + 0.5);
    }

    int localDebrisCap = bb.debrisStepCap;
    int sourceLimit = imax(0, localDebrisCap - bb.debrisSpawned);
    std::vector<BlastDebrisSource> debrisSources;
    debrisSources.reserve((size_t)sourceLimit);
    uint8_t firstSample[TABLE] = {};
    for (uint8_t material : DEFINED_MATERIAL_IDS) {
      if ((int)debrisSources.size() >= sourceLimit) break;
      int bestCandidate = -1, bestSample = -1;
      for (int sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex++) {
        int sample = material * SAMPLE_COUNT + sampleIndex;
        int candidate = wave.debrisSlots[sample];
        if (candidate >= 0
            && (bestCandidate < 0
                || wave.debrisCandidates[candidate].dd
                  < wave.debrisCandidates[bestCandidate].dd)) {
          bestCandidate = candidate;
          bestSample = sampleIndex;
        }
      }
      if (bestCandidate >= 0) {
        firstSample[material] = (uint8_t)bestSample;
        debrisSources.push_back({
          (uint8_t)material,
          wave.debrisCandidates[bestCandidate].cell,
        });
      }
    }
    for (int sampleIndex = 0;
         sampleIndex < SAMPLE_COUNT && (int)debrisSources.size() < sourceLimit;
         sampleIndex++)
      for (uint8_t material : DEFINED_MATERIAL_IDS) {
        if ((int)debrisSources.size() >= sourceLimit) break;
        int sample = material * SAMPLE_COUNT + sampleIndex;
        int candidate = wave.debrisSlots[sample];
        if (candidate >= 0 && sampleIndex != firstSample[material])
          debrisSources.push_back({
            (uint8_t)material,
            wave.debrisCandidates[candidate].cell,
          });
      }

    for (size_t i = 0;
         i < debrisSources.size() && bb.debrisSpawned < localDebrisCap
           && (int)E.L->bodies.size() < BLAST_DEBRIS_CAP;
         i++) {
      uint8_t material = debrisSources[i].material;
      int source = debrisSources[i].cell;
      int sourceY = source / E.cols, sourceX = source - sourceY * E.cols;
      int tries = E.isPocketExplosive(wave.explosiveMaterial)
        ? METHANE_DEBRIS_SOURCE_TRIES : BLAST_DEBRIS_SOURCE_TRIES;
      spawnBlastDebrisFan(wave.cx, wave.cy, wave.seed, material,
                          sourceX, sourceY, BLAST_DEBRIS_CHUNKS, (int)i * 17,
                          bb, wave.debrisEjection, tries);
    }
    if (!E.isPocketExplosive(wave.explosiveMaterial)
        && bb.debrisSpawned < localDebrisCap
        && whash2(wave.seed ^ 0xD3B15u, wave.cx, wave.cy)
             < BLAST_FORCED_DEBRIS_FRAC)
      spawnBlastDebrisFan(wave.cx, wave.cy, wave.seed, DEBRIS,
                          wave.cx, wave.cy, BLAST_FORCED_DEBRIS_CHUNKS, 97,
                          bb, wave.debrisEjection, BLAST_FORCED_DEBRIS_TRIES);
  }
  if (bb.emitGas) spawnBlastRingGases(bb.waves, bb.gasWaveCap);
  activateBlastRectNow(bb.minX, bb.minY, bb.maxX, bb.maxY);
  E.markDirtyRect(bb.minX, bb.minY, bb.maxX, bb.maxY);
}

void ExplosivesSystem::damageActors(int cx, int cy, int radius, double power,
                                   int immunePlayerId, double damageScale,
                                   bool bypassCooldown, int immuneCreatureId) {
  const double blastX = cx + 0.5, blastY = cy + 0.5;
  auto hit = [&](double x, double y, double w, double h, int salt,
                 int hurtCooldown, double& vx, double& vy) {
    double nearestX = std::max(x, std::min(blastX, x + w));
    double nearestY = std::max(y, std::min(blastY, y + h));
    double dx = nearestX - blastX, dy = nearestY - blastY;
    double distance = std::hypot(dx, dy);
    if (distance > radius || (!bypassCooldown && hurtCooldown > 0)) return 0;
    double falloff = std::max(0.0, 1.0 - distance / std::max(1, radius));
    int damage = imax(1, (int)std::ceil(power * 5.0 * damageScale * falloff));
    // A cluster volley may damage on every staggered blast, but its shared
    // cooldown still limits knockback so the first puff cannot launch a target
    // out of the remaining pattern before the damage has a chance to add up.
    if (hurtCooldown <= 0) {
      double centreDx = x + w * .5 - blastX, centreDy = y + h * .5 - blastY;
      double centreDistance = std::hypot(centreDx, centreDy);
      if (centreDistance < 1e-6) { centreDx = (salt & 1) ? 1.0 : -1.0; centreDy = -0.35; centreDistance = std::hypot(centreDx, centreDy); }
      double impulse = .25 + power * .045 * falloff;
      vx += centreDx / centreDistance * impulse;
      vy += centreDy / centreDistance * impulse - impulse * .18;
    }
    return damage;
  };

  for (Player& p : E.psys.players) {
    if (!p.active || !p.alive || p.id == immunePlayerId) continue;
    int impactCooldown = imax(p.hurtCooldown, p.shieldHurtCooldown);
    int damage = hit(p.px, p.py, p.w, p.h, p.id, impactCooldown, p.vx, p.vy);
    if (damage <= 0) continue;
    E.psys.damagePlayer(p, damage, 12, blastX, blastY, bypassCooldown);
  }

  for (Creature& c : E.creatures.creatures) {
    if (!c.alive || c.id == immuneCreatureId ||
        E.creatures.isProtectedNpc(c)) continue;
    const CreatureSpecies& s = E.creatures.species(c);
    double localX = c.wx - E.fg.worldOffsetX, localY = c.wy - E.fg.worldOffsetY;
    int damage = hit(localX, localY, s.w, s.h, c.id, c.hurtCooldown, c.vx, c.vy);
    if (damage <= 0) continue;
    c.health -= damage;
    c.hurtCooldown = 12;
    E.audio.emit(SE_CREATURE, localX + s.w * .5, localY + s.h * .5,
                 std::min(1.2, .5 + damage / 60.0), c.species, 0);
  }
}

void ExplosivesSystem::carveBlastAcrossLayers(int cx, int cy, int radius, double power,
                                             BlastBatch& bb, BlastBatch* otherBb,
                                             Body* sourceBody, uint8_t explosiveMaterial,
                                             int immunePlayerId, uint32_t seedSerial,
                                             uint8_t soundEvent,
                                             double actorDamageScale,
                                             bool bypassActorCooldown,
                                             int immuneCreatureId) {
  Layer* src = E.L;
  Engine::ActiveLayerScope layerScope(E, src);
  E.audio.emit(soundEvent, cx, cy, std::min(2.5, power / TNT_BLAST_POWER),
               explosiveMaterial, src == &E.bg ? 1 : 0);
  damageActors(cx, cy, radius, power, immunePlayerId, actorDamageScale,
               bypassActorCooldown, immuneCreatureId);
  carveBlast(cx, cy, radius, power, bb, sourceBody, explosiveMaterial, seedSerial);
  if (!E.bgEnabled || !otherBb) return;
  Layer* other = (src == &E.fg) ? &E.bg : &E.fg;
  {
    Engine::ActiveLayerScope otherLayer(E, other);
    carveBlast(cx, cy, radius, power, *otherBb, nullptr, explosiveMaterial, seedSerial);
  }
  // Cross-layer structural damage, support repair, and shock are mirrored.
  // Gas, particles, and physical rubble belong to the source layer.
  otherBb->debrisStepCap = 0;
  otherBb->emitGas = false;
  otherBb->emitParticles = false;
}

void ExplosivesSystem::finishBlastBatches(BlastBatch& bb, BlastBatch* otherBb) {
  Layer* src = E.L;
  Engine::ActiveLayerScope layerScope(E, src);
  Layer* other = E.bgEnabled && otherBb ? (src == &E.fg ? &E.bg : &E.fg) : nullptr;
  // Every blast transaction starts from one exact component graph. Normal step
  // ordering already satisfies this; direct ABI/actor detonations establish it
  // here before any cut is classified.
  if (!src->componentIndexExact || (other && !other->componentIndexExact)) {
    if (other) {
      E.fg.groundDirty = E.bg.groundDirty = true;
      E.comps.computeGroundedBoth();
      E.comps.jointGroundReady = true;
      E.comps.jointDirty = false;
      E.comps.jointBondsInvalid = false;
    } else {
      src->groundDirty = true;
      E.comps.ensureGroundedSingleLayer();
    }
  }
  if (!bb.waves.empty()) buildBlastDamage(bb);
  else if (otherBb) buildBlastDamage(*otherBb);
  // Plan both layers from the same pre-cut snapshot, then advance the
  // transaction phase for both before starting the next phase.
  if (other) {
    Engine::ActiveLayerScope otherLayer(E, other);
    evaluateBlastPlan(*otherBb);
  }
  evaluateBlastPlan(bb);
  if (other) {
    Engine::ActiveLayerScope otherLayer(E, other);
    applyBlastCuts(*otherBb);
  }
  applyBlastCuts(bb);
  if (other) {
    Engine::ActiveLayerScope otherLayer(E, other);
    repairBlastStructures(*otherBb);
  }
  repairBlastStructures(bb);
  std::unordered_set<Body*> dirtyJoints;
  auto collectDirtyJoints = [&](const BlastBatch& batch) {
    for (Body* body : batch.dirtyBodies)
      if (body && body->jointRole)
        dirtyJoints.insert(body->jointRole == 1 ? body : body->jointPeer);
  };
  collectDirtyJoints(bb);
  if (other) collectDirtyJoints(*otherBb);
  if (!dirtyJoints.empty()) {
    Engine::ActiveLayerScope foreground(E, &E.fg);
    E.rigid.finishErasedJointBodies(dirtyJoints);
  }
  if (other) {
    Engine::ActiveLayerScope otherLayer(E, other);
    applyBlastAftermath(*otherBb);
  }
  applyBlastAftermath(bb);
}

// Single-blast convenience wrapper (one crater, its own finalize).
void ExplosivesSystem::detonate(int cx, int cy, int radius, double power,
                               int immunePlayerId, uint8_t explosiveMaterial,
                               uint32_t seedSerial, uint8_t soundEvent,
                               double actorDamageScale,
                               bool bypassActorCooldown,
                               int immuneCreatureId) {
  BlastBatch bb, otherBb;
  carveBlastAcrossLayers(cx, cy, radius, power, bb, &otherBb, nullptr,
                        explosiveMaterial, immunePlayerId, seedSerial, soundEvent,
                        actorDamageScale, bypassActorCooldown, immuneCreatureId);
  finishBlastBatches(bb, &otherBb);
}

// Step pass (dispatched in step.inc next to the other reactions): heat-sensitive
// profiles route to their specialized fuse or pocket handler. Expired fuse fronts
// share one blast batch, damage transaction, and finalize.
void ExplosivesSystem::applyExplosives() {
  if (!E.L->pendingDetonations.empty()) {
    for (auto it = E.L->pendingDetonations.begin(); it != E.L->pendingDetonations.end(); ) {
      int k = it->first;
      if (k < 0 || k >= E.cols * E.rows
          || !E.isFuseExplosive(E.L->grid[k]) || E.isBodyCell(k))
        it = E.L->pendingDetonations.erase(it);
      else ++it;
    }
  }
  // Heat sources are indexed by the reaction pass, so settled explosive cells do
  // not need to keep their own simulation span active while waiting for ignition.
  std::unordered_map<int, Body*> bodyById; bool builtBodies = false;
  auto lightFuseExplosive = [&](int igniter, int k) {
    if ((unsigned)igniter >= (unsigned)(E.cols * E.rows)
        || (unsigned)k >= (unsigned)(E.cols * E.rows)) return;
    if (!E.isFuseExplosive(E.L->grid[k])) return;
    if (E.L->grid[igniter] == FIRE && E.L->blastGasStamp[igniter] >= 0 && E.tick - E.L->blastGasStamp[igniter] <= TNT_FUSE_TICKS) return;
    if (E.isBodyCell(k)) {
      int id = E.L->bodyOwner[k];
      if (!builtBodies) { for (Body* b : E.L->bodies) bodyById[b->id] = b; builtBodies = true; }
      auto it = bodyById.find(id);
      if (it != bodyById.end() && it->second->fuseTicks == 0)
        shortenFuseBody(it->second, TNT_FUSE_TICKS,
                        k % E.cols + 0.5, k / E.cols + 0.5);
    } else queueDetonation(k, TNT_FUSE_TICKS);
  };
  const std::vector<int>* heatCells = &E.reactions.activeHeatCells();
  if (E.L->heatAddedAfterPrepare) {
    addedHeatCells.clear();
    auto besideExplosive = [&](int k, int x, int y) {
      auto explosive = [&](int q) {
        return E.isHeatSensitiveExplosive(E.L->grid[q]);
      };
      return (x + 1 < E.cols && explosive(k + 1))
          || (x > 0 && explosive(k - 1))
          || (y + 1 < E.rows && explosive(k + E.cols))
          || (y > 0 && explosive(k - E.cols));
    };
    for (int y = 1; y < E.rows - 1; y++) {
      E.forEachActiveSpan(y, 1, E.cols - 2, true, [&](int minX, int maxX) {
        for (int x = minX; x <= maxX; x++) {
          int k = E.I(x, y); uint8_t m = E.L->grid[k];
          if (E.isHeatSource(m) && besideExplosive(k, x, y))
            addedHeatCells.push_back(k);
        }
      });
    }
    heatCells = &addedHeatCells;
  }
  for (int k : *heatCells) {
    uint8_t m = E.L->grid[k]; if (!E.isHeatSource(m)) continue;
    int y = k / E.cols, x = k - y * E.cols;
    if (x + 1 < E.cols) lightFuseExplosive(k, k + 1);
    if (x > 0) lightFuseExplosive(k, k - 1);
    if (y + 1 < E.rows) lightFuseExplosive(k, k + E.cols);
    if (y > 0) lightFuseExplosive(k, k - E.cols);
  }
  BlastBatch bb, otherBb;

  // Pocket-profile gas is consumed in one deterministic flood and represented by
  // a bounded number of spatial blast fronts.
  auto ignitePocketExplosive = [&](int seed) {
    if (seed < 0 || seed >= E.cols * E.rows
        || !E.isPocketExplosive(E.L->grid[seed])) return;
    uint8_t explosiveMaterial = E.L->grid[seed];
    std::vector<int> queue, reps;
    queue.reserve(256); reps.reserve(METHANE_BLAST_FRONT_CAP * 2);
    std::unordered_set<int> repBuckets;
    queue.push_back(seed); E.writeGridIndexUnsafe(seed, FIRE);
    for (size_t qi = 0; qi < queue.size(); qi++) {
      int k = queue[qi], y = k / E.cols, x = k - y * E.cols;
      int bucket = (y / METHANE_BLAST_REP_SPACING) * ((E.cols + METHANE_BLAST_REP_SPACING - 1) / METHANE_BLAST_REP_SPACING)
                 + x / METHANE_BLAST_REP_SPACING;
      if (repBuckets.insert(bucket).second) reps.push_back(k);
      auto visit = [&](int nk) {
        if (!E.isPocketExplosive(E.L->grid[nk])) return;
        E.writeGridIndexUnsafe(nk, FIRE); queue.push_back(nk);
      };
      if (x > 0) visit(k - 1); if (x + 1 < E.cols) visit(k + 1);
      if (y > 0) visit(k - E.cols); if (y + 1 < E.rows) visit(k + E.cols);
    }
    if ((int)queue.size() < METHANE_BLAST_MIN_CELLS) return;
    int fronts = imin(METHANE_BLAST_FRONT_CAP,
                      imax(1, (int)queue.size() / METHANE_BLAST_CELLS_PER_FRONT));
    fronts = imin(fronts, (int)reps.size());
    for (int i = 0; i < fronts; i++) {
      int cell = reps[(size_t)i * reps.size() / fronts];
      carveBlastAcrossLayers(cell % E.cols, cell / E.cols,
                            METHANE_BLAST_RADIUS, METHANE_BLAST_POWER,
                            bb, &otherBb, nullptr, explosiveMaterial);
    }
  };
  for (int k : *heatCells) {
    uint8_t m = E.L->grid[k]; if (!E.isHeatSource(m)) continue;
    int y = k / E.cols, x = k - y * E.cols;
    if (x + 1 < E.cols) ignitePocketExplosive(k + 1);
    if (x > 0) ignitePocketExplosive(k - 1);
    if (y + 1 < E.rows) ignitePocketExplosive(k + E.cols);
    if (y > 0) ignitePocketExplosive(k - E.cols);
  }

  // 2) Tick static fuses; broad due fronts consume a fixed number of spatial
  //    buckets per step. Cell and bucket order is deterministic.
  int scheduledStaticFuseCells = 0;
  if (!E.L->pendingDetonations.empty()) {
    std::vector<int> fire;
    for (auto& kv : E.L->pendingDetonations) {
      if (--kv.second <= 0) fire.push_back(kv.first);
    }
    std::sort(fire.begin(), fire.end());
    std::vector<int> dueStatic;
    dueStatic.reserve(fire.size());
    for (int cell : fire) {
      if (cell >= 0 && cell < E.cols * E.rows
          && E.isFuseExplosive(E.L->grid[cell]) && !E.isBodyCell(cell))
        dueStatic.push_back(cell);
    }
    std::vector<int> staticFire;
    bool massFront = (int)dueStatic.size() >= TNT_MASS_FRONT_CELLS;
    if (massFront) {
      int bucketCols = (E.cols + TNT_CLUSTER_BUCKET - 1) / TNT_CLUSTER_BUCKET;
      std::unordered_set<int> uniqueBuckets;
      for (int cell : dueStatic) {
        int y = cell / E.cols, x = cell - y * E.cols;
        uniqueBuckets.insert((y / TNT_CLUSTER_BUCKET) * bucketCols + x / TNT_CLUSTER_BUCKET);
      }
      if ((int)uniqueBuckets.size() > TNT_MASS_FRONT_BUCKETS_PER_STEP) {
        int firstBucket = INT_MAX;
        for (int bucket : uniqueBuckets) firstBucket = imin(firstBucket, bucket);
        int firstBucketRow = firstBucket / bucketCols;
        int firstBucketCol = firstBucket - firstBucketRow * bucketCols;
        std::unordered_set<int> selected;
        for (int i = 0; i < TNT_MASS_FRONT_BUCKETS_PER_STEP; i++) {
          int bestBucket = -1, bestDistance = INT_MAX;
          for (int bucket : uniqueBuckets) {
            if (selected.count(bucket)) continue;
            int row = bucket / bucketCols;
            int col = bucket - row * bucketCols;
            int dr = row - firstBucketRow;
            int dc = col - firstBucketCol;
            int distance = dr * dr + dc * dc;
            if (distance < bestDistance
                || (distance == bestDistance && bucket < bestBucket)) {
              bestBucket = bucket;
              bestDistance = distance;
            }
          }
          selected.insert(bestBucket);
        }
        staticFire.reserve(dueStatic.size()
                           * TNT_MASS_FRONT_BUCKETS_PER_STEP
                           / uniqueBuckets.size());
        for (int cell : dueStatic) {
          int y = cell / E.cols, x = cell - y * E.cols;
          int bucket = (y / TNT_CLUSTER_BUCKET) * bucketCols + x / TNT_CLUSTER_BUCKET;
          if (selected.count(bucket)) staticFire.push_back(cell);
        }
      } else {
        staticFire.swap(dueStatic);
      }
    } else {
      staticFire.swap(dueStatic);
    }
    scheduledStaticFuseCells = (int)staticFire.size();
    if ((int)staticFire.size() >= TNT_CLUSTER_FAST_THRESHOLD) {
      carveStaticFuseCluster(staticFire, bb, &otherBb, massFront);
    } else {
      for (int cell : staticFire) {
        uint8_t material = E.L->grid[cell];
        carveBlastAcrossLayers(cell % E.cols, cell / E.cols,
                              TNT_BLAST_RADIUS, TNT_BLAST_POWER, bb, &otherBb,
                              nullptr, material);
      }
    }
    for (int cell : staticFire) E.L->pendingDetonations.erase(cell);
  }
  // 3) Tick body fuses. Compact expired fronts detonate together; broad fronts
  //    share the static fuse budget and defer their remaining bodies one tick.
  struct DueBodyBlast {
    Body* body;
    int x, y, fuseCells;
    uint8_t material;
    double fuseX, fuseY, bestDistance;
    int bestLayer, bestCell;
  };
  std::vector<DueBodyBlast> dueBodyBlasts;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2 || b->fuseTicks <= 0) continue;
    uint8_t explosiveMaterial =
      E.bodyMaterialWithExplosiveProfile(b, XP_TNT_FUSE);
    int fuseCells = E.isFuseExplosive(b->material) && b->cellMaterials.empty()
      ? b->nPts : 0;
    if (!b->cellMaterials.empty())
      for (uint8_t material : b->cellMaterials)
        if (E.isFuseExplosive(material)) fuseCells++;
    for (uint8_t material : b->jointPeerMaterials)
      if (E.isFuseExplosive(material)) fuseCells++;
    if (!fuseCells || explosiveMaterial == EMPTY) {
      b->fuseTicks = 0;
      continue;
    }
    if (--b->fuseTicks > 0) continue;
    double fuseX, fuseY;
    E.rigid.bodyFusePoint(b, fuseX, fuseY);
    int blastX = (int)std::lround(b->px);
    int blastY = (int)std::lround(b->py);
    dueBodyBlasts.push_back({
      b, blastX, blastY, fuseCells, explosiveMaterial,
      fuseX, fuseY, 1e30, 2, INT_MAX,
    });
  }
  if (!dueBodyBlasts.empty()) {
    std::unordered_map<int, size_t> ownDueById, peerDueById;
    ownDueById.reserve(dueBodyBlasts.size() * 2);
    peerDueById.reserve(dueBodyBlasts.size() * 2);
    for (size_t i = 0; i < dueBodyBlasts.size(); i++) {
      Body* body = dueBodyBlasts[i].body;
      ownDueById.emplace(body->id, i);
      if (body->jointRole == 1 && body->jointPeer)
        peerDueById.emplace(body->jointPeer->id, i);
    }
    auto considerFuseCells = [&](Layer& layer, const std::vector<int>& cells,
                                 const std::unordered_map<int, size_t>& dueById,
                                 int layerIndex) {
      for (int k : cells) {
        if (k < 0 || k >= E.cols * E.rows) continue;
        auto found = dueById.find(layer.bodyOwner[k]);
        if (found == dueById.end() || !E.isFuseExplosive(layer.grid[k]))
          continue;
        DueBodyBlast& blast = dueBodyBlasts[found->second];
        int y = k / E.cols, x = k - y * E.cols;
        double dx = x + 0.5 - blast.fuseX;
        double dy = y + 0.5 - blast.fuseY;
        double distance = dx * dx + dy * dy;
        if (distance < blast.bestDistance
            || (distance == blast.bestDistance
                && (layerIndex < blast.bestLayer
                    || (layerIndex == blast.bestLayer
                        && k < blast.bestCell)))) {
          blast.bestDistance = distance;
          blast.bestLayer = layerIndex;
          blast.bestCell = k;
          blast.x = x;
          blast.y = y;
          blast.material = layer.grid[k];
        }
      }
    };
    considerFuseCells(*E.L, E.L->bodyCells, ownDueById,
                      E.L == &E.bg ? 1 : 0);
    if (!peerDueById.empty()) {
      Layer& peerLayer = E.L == &E.fg ? E.bg : E.fg;
      considerFuseCells(peerLayer, peerLayer.passiveBodyCells, peerDueById,
                        E.L == &E.fg ? 1 : 0);
    }
  }
  int dueFuseCells = 0;
  for (const DueBodyBlast& blast : dueBodyBlasts)
    dueFuseCells += blast.fuseCells;
  int scheduledFuseCells = scheduledStaticFuseCells;
  bool bodyBudgetClosed = scheduledFuseCells
    >= TNT_FRONT_CELLS_PER_STEP;
  bool pacedBodyFront = dueFuseCells + scheduledStaticFuseCells
    >= TNT_MASS_FRONT_CELLS;
  for (const DueBodyBlast& blast : dueBodyBlasts) {
    if (pacedBodyFront && !bodyBudgetClosed && scheduledFuseCells > 0
        && scheduledFuseCells + blast.fuseCells
             > TNT_FRONT_CELLS_PER_STEP)
      bodyBudgetClosed = true;
    if (bodyBudgetClosed) {
      blast.body->fuseTicks = 1;
      continue;
    }
    scheduledFuseCells += blast.fuseCells;
    carveBlastAcrossLayers(blast.x, blast.y, TNT_BLAST_RADIUS,
                          TNT_BLAST_POWER, bb, &otherBb, blast.body,
                          blast.material);
    // Fuse-profile cells outside the crater continue as a short-fuse body or
    // fragment so large rigid charges advance as a staged front.
    blast.body->fuseTicks = TNT_CHAIN_FUSE;
    E.rigid.setBodyFusePoint(blast.body, blast.x + 0.5, blast.y + 0.5);
    if (blast.body->jointRole == 1 && blast.body->jointPeer) {
      blast.body->jointPeer->fuseTicks = blast.body->fuseTicks;
      blast.body->jointPeer->fuseLocalX = blast.body->fuseLocalX;
      blast.body->jointPeer->fuseLocalY = blast.body->fuseLocalY;
    }
  }
  finishBlastBatches(bb, &otherBb); // one finalize per layer for every crater of this step
}
