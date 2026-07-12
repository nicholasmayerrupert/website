// CreatureSystem method bodies (need the full Engine definition).

bool CreatureSystem::inLoadedWindow(const Creature& c, int margin) const {
  double x = c.wx - E.fg.worldOffsetX, y = c.wy - E.fg.worldOffsetY;
  const CreatureSpecies& s = species(c);
  return x + s.w >= -margin && x < E.cols + margin && y + s.h >= -margin && y < E.rows + margin;
}

bool CreatureSystem::boxHitsSolid(double wx, double wy, int w, int h) const {
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX), x1 = (int)std::floor(wx - E.fg.worldOffsetX + w - 1e-6);
  int y0 = (int)std::floor(wy - E.fg.worldOffsetY), y1 = (int)std::floor(wy - E.fg.worldOffsetY + h - 1e-6);
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    if (y >= E.rows) return true;
    if (x < 0 || x >= E.cols || y < 0) continue;
    if (E.isBlockingForPlayer(E.fg.grid[E.I(x, y)])) return true;
  }
  return false;
}

double CreatureSystem::blockingCoverage(double wx, double wy, int w, int h) const {
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX), x1 = (int)std::floor(wx - E.fg.worldOffsetX + w - 1e-6);
  int y0 = (int)std::floor(wy - E.fg.worldOffsetY), y1 = (int)std::floor(wy - E.fg.worldOffsetY + h - 1e-6);
  int total = 0, blocked = 0;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    total++;
    if (y >= E.rows) blocked++;
    else if (x >= 0 && x < E.cols && y >= 0 && E.isBlockingForPlayer(E.fg.grid[E.I(x, y)])) blocked++;
  }
  return total ? (double)blocked / total : 0;
}

double CreatureSystem::fluidCoverage(double wx, double wy, int w, int h) const {
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX), x1 = (int)std::floor(wx - E.fg.worldOffsetX + w - 1e-6);
  int y0 = (int)std::floor(wy - E.fg.worldOffsetY), y1 = (int)std::floor(wy - E.fg.worldOffsetY + h - 1e-6);
  int total = 0, wet = 0;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    total++;
    if (x >= 0 && x < E.cols && y >= 0 && y < E.rows) {
      uint8_t m = E.fg.grid[E.I(x, y)];
      if (m == WATER || m == BRINE) wet++; // oil/acid/lava are liquids, but not viable swim habitat
    }
  }
  return total ? (double)wet / total : 0;
}

bool CreatureSystem::boxTouchesLiquid(double wx, double wy, int w, int h) const {
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX), x1 = (int)std::floor(wx - E.fg.worldOffsetX + w - 1e-6);
  int y0 = (int)std::floor(wy - E.fg.worldOffsetY), y1 = (int)std::floor(wy - E.fg.worldOffsetY + h - 1e-6);
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    if (x >= 0 && x < E.cols && y >= 0 && y < E.rows && E.isLiquidMaterial(E.fg.grid[E.I(x, y)])) return true;
  }
  return false;
}

bool CreatureSystem::boxFitsHabitat(uint8_t speciesId, double wx, double wy) const {
  const CreatureSpecies& s = CREATURE_SPECIES[speciesId];
  if (boxHitsSolid(wx, wy, s.w, s.h)) return false;
  if (s.spawn.habitat == CH_WATER) return fluidCoverage(wx, wy, s.w, s.h) >= s.fluidThreshold;
  if (s.spawn.habitat == CH_AIR) return !boxTouchesLiquid(wx, wy, s.w, s.h);
  int footY = (int)std::floor(wy - E.fg.worldOffsetY + s.h + 0.05);
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX), x1 = (int)std::floor(wx - E.fg.worldOffsetX + s.w - 1e-6);
  bool floor = false;
  for (int x = x0; x <= x1; x++) if (x >= 0 && x < E.cols && footY >= 0 && footY < E.rows && E.isBlockingForPlayer(E.fg.grid[E.I(x, footY)])) { floor = true; break; }
  if (!floor) return false;
  if (s.spawn.habitat == CH_CAVE && E.fg.infinite) {
    int centerX = (int)std::floor(wx + s.w * 0.5);
    if (wy < E.terrain.genSurfaceAbs(centerX) + 10) return false;
  }
  return true;
}

int CreatureSystem::localDensity(uint8_t speciesId, double wx, double wy, int radius) const {
  double r2 = (double)radius * radius; int n = 0;
  for (const Creature& c : creatures) {
    if (!c.alive || c.species != speciesId) continue;
    double dx = c.wx - wx, dy = c.wy - wy;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return n;
}

int CreatureSystem::localDensityAll(double wx, double wy, int radius) const {
  double r2 = (double)radius * radius; int n = 0;
  for (const Creature& c : creatures) {
    if (!c.alive) continue;
    double dx = c.wx - wx, dy = c.wy - wy;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return n;
}

bool CreatureSystem::farEnoughFromPlayers(double wx, double wy, int minDistance) const {
  double d2 = (double)minDistance * minDistance;
  for (const Player& p : E.psys.players) if (p.active && p.alive) {
    double px = E.fg.worldOffsetX + p.px + p.w * 0.5, py = E.fg.worldOffsetY + p.py + p.h * 0.5;
    double dx = px - wx, dy = py - wy;
    if (dx * dx + dy * dy < d2) return false;
  }
  return true;
}

// Continuous populations spawn in a band around a player (or the camera when
// no player exists, as on /fps). This makes successful spawns observable while
// min/max distance plus local/global caps keep them from appearing on top of the
// player or filling the buffer.
bool CreatureSystem::spawnNearFocus(uint8_t speciesId, uint32_t salt) {
  const CreatureSpecies& s = CREATURE_SPECIES[speciesId];
  const CreatureSpawnRule& r = s.spawn;
  double fx, fy;
  double vw = E.cam.viewportCols > 0 ? E.cam.viewportCols : E.cols * 0.5;
  double vh = E.cam.viewportRows > 0 ? E.cam.viewportRows : E.rows * 0.5;
  std::vector<const Player*> live;
  for (const Player& p : E.psys.players) if (p.active && p.alive) live.push_back(&p);
  if (!live.empty()) {
    const Player* p = live[salt % live.size()];
    fx = E.fg.worldOffsetX + p->px + p->w * 0.5;
    fy = E.fg.worldOffsetY + p->py + p->h * 0.5;
  } else {
    fx = E.fg.worldOffsetX + E.cam.camX + vw * 0.5;
    fy = E.fg.worldOffsetY + E.cam.camY + vh * 0.5;
  }
  double viewLeft = E.fg.worldOffsetX + E.cam.camX, viewTop = E.fg.worldOffsetY + E.cam.camY;
  double viewRight = viewLeft + vw, viewBottom = viewTop + vh;
  auto edgeDistance = [&](double ux, double uy) {
    double tx = 1e9, ty = 1e9;
    if (ux > 1e-6) tx = (viewRight - fx) / ux;
    else if (ux < -1e-6) tx = (viewLeft - fx) / ux;
    if (uy > 1e-6) ty = (viewBottom - fy) / uy;
    else if (uy < -1e-6) ty = (viewTop - fy) / uy;
    return std::max(0.0, std::min(tx, ty));
  };
  auto outsideInnerHalf = [&](double cx, double cy) {
    double dx = cx - fx, dy = cy - fy, d = std::sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return false;
    return d + 1e-6 >= edgeDistance(dx / d, dy / d) * 0.5;
  };
  uint32_t seed = E.fg.worldSeed ^ 0xC4EA7400u ^ ((uint32_t)speciesId * 0x9e3779b9u) ^ salt;
  for (int attempt = 0; attempt < 36; attempt++) {
    double angle = whash2(seed ^ 0x11u, attempt, (int)salt) * 6.283185307179586;
    double ux = std::cos(angle), uy = std::sin(angle);
    double edge = edgeDistance(ux, uy);
    double minDist = std::max((double)r.minPlayerDistance, edge * 0.5);
    double maxDist = std::min((double)r.maxPlayerDistance, edge - std::max(s.w, s.h));
    if (maxDist < minDist) maxDist = minDist;
    double dist = minDist + whash2(seed ^ 0x22u, (int)salt, attempt) * (maxDist - minDist);
    double wx = fx + ux * dist - s.w * 0.5;
    double wy = fy + uy * dist - s.h * 0.5;
    int centerX = (int)std::floor(wx + s.w * 0.5);
    int surface = E.terrain.genSurfaceAbs(centerX);
    if (r.habitat == CH_SURFACE) {
      wy = surface - s.h - 2;
      for (int down = 0; down <= 5; down++) if (boxFitsHabitat(speciesId, wx, wy + down)) { wy += down; break; }
    } else if (r.habitat == CH_AIR) {
      double altitude = 10 + whash2(seed ^ 0x33u, attempt, centerX) * 34;
      wy = surface - s.h - altitude;
    } else if (r.habitat == CH_CAVE) {
      int depth = 12 + (int)(whash2(seed ^ 0x44u, centerX, attempt) * 72);
      wy = surface + depth;
      bool found = false;
      for (int d = 0; d < 48 && !found; d++) for (int sign : {1, -1}) {
        double cy = wy + sign * d;
        if (boxFitsHabitat(speciesId, wx, cy)) { wy = cy; found = true; break; }
      }
      if (!found) continue;
    }
    Creature probe; probe.species = speciesId; probe.wx = wx; probe.wy = wy;
    if (!inLoadedWindow(probe, 0) || !boxFitsHabitat(speciesId, wx, wy)) continue;
    if (!outsideInnerHalf(wx + s.w * 0.5, wy + s.h * 0.5)) continue;
    if (spawnCreatureNatural(speciesId, wx, wy)) return true;
  }
  return false;
}

int CreatureSystem::spawnCreature(uint8_t speciesId, double wx, double wy, bool requireHabitat) {
  if (speciesId >= CS_COUNT || (requireHabitat && !boxFitsHabitat(speciesId, wx, wy))) return 0;
  Creature c; c.id = nextCreatureId++; c.species = speciesId; c.wx = wx; c.wy = wy;
  c.health = CREATURE_SPECIES[speciesId].maxHealth;
  c.facing = whash1(E.fg.worldSeed ^ 0xC4EA7u, c.id) < 0.5 ? -1 : 1;
  creatures.push_back(c);
  return c.id;
}

// Population policy belongs only to natural spawning. Eggs and future scripted,
// summoned, or quest spawns call spawnCreature directly; they still contribute
// to these counts, so a high manual population pauses further natural births.
int CreatureSystem::spawnCreatureNatural(uint8_t speciesId, double wx, double wy) {
  if (speciesId >= CS_COUNT || !boxFitsHabitat(speciesId, wx, wy)) return 0;
  const CreatureSpawnRule& r = CREATURE_SPECIES[speciesId].spawn;
  int active = 0, activeOfSpecies = 0;
  for (const Creature& c : creatures) if (c.alive) { active++; if (c.species == speciesId) activeOfSpecies++; }
  if (active >= NATURAL_MOB_CAP || activeOfSpecies >= r.maxActive ||
      localDensity(speciesId, wx, wy, r.densityRadius) >= r.densityCap ||
      localDensityAll(wx, wy, MIXED_DENSITY_RADIUS) >= MIXED_DENSITY_CAP) return 0;
  return spawnCreature(speciesId, wx, wy, false);
}

bool CreatureSystem::spawnCandidate(uint8_t speciesId, int regionX, int regionY, uint32_t salt) {
  const CreatureSpecies& s = CREATURE_SPECIES[speciesId];
  const CreatureSpawnRule& r = s.spawn;
  uint32_t seed = E.fg.worldSeed ^ 0xC4EA7000u ^ ((uint32_t)speciesId * 0x9e3779b9u) ^ salt;
  for (int attempt = 0; attempt < 18; attempt++) {
    double rx = whash2(seed ^ 0x11u, regionX, regionY * 37 + attempt);
    double ry = whash2(seed ^ 0x22u, regionX * 41 + attempt, regionY);
    double wx = regionX * r.regionSize + 4 + rx * (r.regionSize - s.w - 8);
    double wy;
    int surface = E.terrain.genSurfaceAbs((int)std::floor(wx + s.w * 0.5));
    if (r.habitat == CH_SURFACE) wy = surface - s.h - 1;
    else if (r.habitat == CH_AIR) wy = surface - s.h - 10 - ry * 34;
    else if (r.habitat == CH_CAVE) wy = surface + 12 + ry * 72;
    else wy = regionY * r.regionSize + 4 + ry * (r.regionSize - s.h - 8);
    Creature probe; probe.species = speciesId; probe.wx = wx; probe.wy = wy;
    if (!inLoadedWindow(probe, 0) || !farEnoughFromPlayers(wx + s.w * 0.5, wy + s.h * 0.5, r.minPlayerDistance)) continue;
    if (spawnCreatureNatural(speciesId, wx, wy)) return true;
  }
  return false;
}

void CreatureSystem::spawnRegion(uint8_t speciesId, int regionX, int regionY) {
  const CreatureSpawnRule& r = CREATURE_SPECIES[speciesId].spawn;
  uint64_t key = ((uint64_t)speciesId << 56) |
                 (((uint64_t)(uint32_t)regionX & 0x0fffffffu) << 28) |
                 ((uint32_t)regionY & 0x0fffffffu);
  if (!spawnedRegions.insert(key).second) return;
  double roll = whash2(E.fg.worldSeed ^ 0xC4EA7100u ^ speciesId, regionX, regionY);
  if (roll >= r.chance) return;
  int count = 1 + (int)(whash2(E.fg.worldSeed ^ 0xC4EA7200u ^ speciesId, regionX, regionY) * r.maxPerRegion);
  if (count > r.maxPerRegion) count = r.maxPerRegion;
  for (int i = 0; i < count; i++) spawnCandidate(speciesId, regionX, regionY, (uint32_t)i * 1013u);
}

void CreatureSystem::updatePopulation() {
  const int HIBERNATE_REGION = 128;
  auto regionKey = [&](int rx, int ry) {
    return ((uint64_t)(uint32_t)rx << 32) | (uint32_t)ry;
  };
  // Hibernate off-window entities. They retain absolute pose/health and restore
  // when their area is loaded again. Restoration is not a new spawn and is never
  // rejected by the natural population cap.
  size_t w = 0;
  for (size_t i = 0; i < creatures.size(); i++) {
    if (!creatures[i].alive && creatures[i].deathTicks <= 0) continue;
    if (!inLoadedWindow(creatures[i], 80)) {
      if (creatures[i].alive) {
        int rx = (int)std::floor(creatures[i].wx / HIBERNATE_REGION);
        int ry = (int)std::floor(creatures[i].wy / HIBERNATE_REGION);
        dormantRegions[regionKey(rx, ry)].push_back(creatures[i]);
      }
      continue;
    }
    if (w != i) creatures[w] = creatures[i];
    w++;
  }
  creatures.resize(w);

  int hx0 = (int)std::floor((double)(E.fg.worldOffsetX - 24) / HIBERNATE_REGION);
  int hy0 = (int)std::floor((double)(E.fg.worldOffsetY - 24) / HIBERNATE_REGION);
  int hx1 = (int)std::floor((double)(E.fg.worldOffsetX + E.cols + 23) / HIBERNATE_REGION);
  int hy1 = (int)std::floor((double)(E.fg.worldOffsetY + E.rows + 23) / HIBERNATE_REGION);
  for (int ry = hy0; ry <= hy1; ry++) for (int rx = hx0; rx <= hx1; rx++) {
    auto it = dormantRegions.find(regionKey(rx, ry)); if (it == dormantRegions.end()) continue;
    std::vector<Creature>& bucket = it->second; size_t keep = 0;
    for (size_t i = 0; i < bucket.size(); i++) {
      if (inLoadedWindow(bucket[i], 24)) creatures.push_back(bucket[i]);
      else { if (keep != i) bucket[keep] = bucket[i]; keep++; }
    }
    bucket.resize(keep);
    if (bucket.empty()) dormantRegions.erase(it);
  }

  for (uint8_t sid = 0; sid < CS_COUNT; sid++) {
    const CreatureSpawnRule& r = CREATURE_SPECIES[sid].spawn;
    if (r.mode == CSM_CONTINUOUS) {
      if (r.intervalTicks > 0 && E.actorTick % r.intervalTicks == 0) {
        uint32_t salt = (uint32_t)E.actorTick ^ ((uint32_t)sid * 1013u);
        // Seed one representative immediately when its habitat exists; only
        // replenishment uses the low recurring probability/cadence.
        if (E.actorTick == 0 || whash2(E.fg.worldSeed ^ 0xC4EA7300u, E.actorTick, sid) < r.chance)
          spawnNearFocus(sid, salt);
      }
      continue;
    }
    int rx0 = (int)std::floor((double)E.fg.worldOffsetX / r.regionSize);
    int ry0 = (int)std::floor((double)E.fg.worldOffsetY / r.regionSize);
    int rx1 = (int)std::floor((double)(E.fg.worldOffsetX + E.cols - 1) / r.regionSize);
    int ry1 = (int)std::floor((double)(E.fg.worldOffsetY + E.rows - 1) / r.regionSize);
    for (int ry = ry0; ry <= ry1; ry++) for (int rx = rx0; rx <= rx1; rx++) spawnRegion(sid, rx, ry);
  }
}

void CreatureSystem::acquireTarget(Creature& c) {
  const CreatureSpecies& s = species(c);
  c.targetKind = CT_NONE; c.targetId = 0;
  double best = s.sightRange * s.sightRange;
  if (s.targetMask & CT_PREY) for (Creature& other : creatures) {
    if (!other.alive || other.id == c.id || !(s.preyMask & (1u << other.species))) continue;
    double dx = other.wx - c.wx, dy = other.wy - c.wy, d = dx * dx + dy * dy;
    if (d < best) { best = d; c.targetKind = CT_PREY; c.targetId = other.id; }
  }
  if (s.targetMask & CT_PLAYER) for (Player& p : E.psys.players) {
    if (!p.active || !p.alive) continue;
    double px = E.fg.worldOffsetX + p.px, py = E.fg.worldOffsetY + p.py;
    if (s.locomotion == CL_AQUATIC && fluidCoverage(px, py, p.w, p.h) < P_LIQUID_SWIM_COVERAGE) continue;
    double dx = px - c.wx, dy = py - c.wy, d = dx * dx + dy * dy;
    if (d < best) { best = d; c.targetKind = CT_PLAYER; c.targetId = p.id; }
  }
  c.scanCooldown = s.scanInterval;
}

bool CreatureSystem::targetPoint(const Creature& c, double& tx, double& ty, Creature** prey, Player** player) {
  if (prey) *prey = nullptr; if (player) *player = nullptr;
  if (c.targetKind == CT_PREY) for (Creature& o : creatures) if (o.id == c.targetId && o.alive) {
    tx = o.wx + species(o).w * 0.5; ty = o.wy + species(o).h * 0.5; if (prey) *prey = &o; return true;
  }
  if (c.targetKind == CT_PLAYER) { Player* p = E.psys.findPlayer(c.targetId); if (p && p->active && p->alive) {
    tx = E.fg.worldOffsetX + p->px + p->w * 0.5; ty = E.fg.worldOffsetY + p->py + p->h * 0.5; if (player) *player = p; return true;
  }}
  return false;
}

void CreatureSystem::steerAquatic(Creature& c) {
  const CreatureSpecies& s = species(c);
  double tx = 0, ty = 0; Creature* prey = nullptr; Player* player = nullptr;
  bool hasTarget = targetPoint(c, tx, ty, &prey, &player);
  double desiredX, desiredY;
  if (hasTarget) {
    double dx = tx - (c.wx + s.w * 0.5), dy = ty - (c.wy + s.h * 0.5), d = std::sqrt(dx * dx + dy * dy);
    desiredX = d > 1e-6 ? dx / d * s.swimSpeed : 0; desiredY = d > 1e-6 ? dy / d * s.swimSpeed : 0;
  } else {
    // Smooth deterministic wander; no shared sim RNG draws.
    double phase = (E.actorTick + c.id * 47) * 0.031;
    desiredX = std::cos(phase) * s.swimSpeed * 0.72;
    desiredY = std::sin(phase * 0.63 + c.id) * s.swimSpeed * 0.42;
  }
  c.vx += std::max(-s.accel, std::min(s.accel, desiredX - c.vx));
  c.vy += std::max(-s.accel, std::min(s.accel, desiredY - c.vy));
  if (std::fabs(c.vx) > 0.02) c.facing = c.vx > 0 ? 1 : -1;
}

void CreatureSystem::moveAquatic(Creature& c) {
  const CreatureSpecies& s = species(c);
  auto tryAxis = [&](double& pos, double delta, bool xAxis) {
    double moved = 0, mag = std::fabs(delta), dir = delta >= 0 ? 1.0 : -1.0;
    while (moved < mag - 1e-6) {
      double step = std::min(0.25, mag - moved), nx = c.wx, ny = c.wy;
      if (xAxis) nx = pos + dir * step; else ny = pos + dir * step;
      // Aquatic locomotion treats the water boundary as collision: a fish never
      // voluntarily leaves its supported material, even for a target.
      if (boxHitsSolid(nx, ny, s.w, s.h) || fluidCoverage(nx, ny, s.w, s.h) < s.fluidThreshold) return false;
      pos += dir * step; moved += step;
    }
    return true;
  };
  if (!tryAxis(c.wx, c.vx, true)) c.vx *= -0.45;
  if (!tryAxis(c.wy, c.vy, false)) c.vy *= -0.45;
}

void CreatureSystem::moveBeachedAquatic(Creature& c) {
  const CreatureSpecies& s = species(c);
  // Out of viable water, fish become ordinary gravity-driven bodies. Grounded
  // fish periodically kick in a seeded direction; this can carry them down a
  // bank and back into water without consuming the simulation RNG stream.
  c.vy = std::min(2.4, c.vy + 0.075);
  c.vx *= c.grounded ? 0.82 : 0.995;
  int flopPeriod = 32 + (c.id % 17);
  if (c.grounded && ((E.actorTick + c.id * 11) % flopPeriod) == 0) {
    double kick = 0.20 + whash1(E.fg.worldSeed ^ 0xF10F00u, c.id + E.actorTick) * 0.18;
    c.facing = whash1(E.fg.worldSeed ^ 0xF10F11u, c.id + E.actorTick) < 0.5 ? -1 : 1;
    c.vx = c.facing * kick;
    c.vy = -0.58 - whash1(E.fg.worldSeed ^ 0xF10F22u, c.id + E.actorTick) * 0.28;
  }
  auto moveAxis = [&](double& pos, double delta, bool xAxis) {
    double moved = 0, mag = std::fabs(delta), dir = delta >= 0 ? 1.0 : -1.0;
    while (moved < mag - 1e-6) {
      double step = std::min(0.25, mag - moved), nx = c.wx, ny = c.wy;
      if (xAxis) nx = pos + dir * step; else ny = pos + dir * step;
      if (boxHitsSolid(nx, ny, s.w, s.h)) return false;
      pos += dir * step; moved += step;
    }
    return true;
  };
  if (!moveAxis(c.wx, c.vx, true)) c.vx *= -0.25;
  if (!moveAxis(c.wy, c.vy, false)) c.vy = 0;
  c.grounded = boxHitsSolid(c.wx, c.wy + 0.12, s.w, s.h);
}

void CreatureSystem::moveAmphibious(Creature& c) {
  const CreatureSpecies& s = species(c);
  double wet = fluidCoverage(c.wx, c.wy, s.w, s.h);
  double tx = 0, ty = 0; bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (wet >= s.fluidThreshold) {
    double dx = hasTarget ? tx - (c.wx + s.w * 0.5) : std::sin((E.actorTick + c.id * 29) * 0.025);
    double dy = hasTarget ? ty - (c.wy + s.h * 0.5) : std::cos((E.actorTick + c.id * 17) * 0.021);
    double d = std::sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1;
    c.vx += std::max(-s.accel, std::min(s.accel, dx / d * s.swimSpeed - c.vx));
    c.vy += std::max(-s.accel, std::min(s.accel, dy / d * s.swimSpeed - c.vy));
  } else {
    double wish = hasTarget ? (tx > c.wx + s.w * 0.5 ? s.walkSpeed : -s.walkSpeed)
                            : (std::sin((E.actorTick + c.id * 37) * 0.012) > 0 ? s.walkSpeed * 0.45 : -s.walkSpeed * 0.45);
    c.vx += std::max(-s.accel, std::min(s.accel, wish - c.vx));
    if (s.hopPeriod > 0 && c.grounded && ((E.actorTick + c.id * 7) % s.hopPeriod) == 0) c.vy = -s.jumpSpeed;
    c.vy += s.gravity; if (c.vy > 2.4) c.vy = 2.4;
  }
  if (std::fabs(c.vx) > 0.02) c.facing = c.vx > 0 ? 1 : -1;
  auto moveAxis = [&](double& pos, double delta, bool xAxis) {
    double moved = 0, mag = std::fabs(delta), dir = delta >= 0 ? 1.0 : -1.0;
    while (moved < mag - 1e-6) {
      double step = std::min(0.25, mag - moved), nx = c.wx, ny = c.wy;
      if (xAxis) nx = pos + dir * step; else ny = pos + dir * step;
      if (boxHitsSolid(nx, ny, s.w, s.h)) return false;
      pos += dir * step; moved += step;
    }
    return true;
  };
  if (!moveAxis(c.wx, c.vx, true)) {
    if (wet < s.fluidThreshold && c.grounded) c.vy = -s.jumpSpeed;
    c.vx = 0;
  }
  if (!moveAxis(c.wy, c.vy, false)) c.vy = 0;
  c.grounded = boxHitsSolid(c.wx, c.wy + 0.12, s.w, s.h);
}

void CreatureSystem::moveFlying(Creature& c) {
  const CreatureSpecies& s = species(c);
  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  double phase = (E.actorTick + c.id * 43) * 0.025;
  double desiredX = hasTarget ? tx - (c.wx + s.w * 0.5) : std::cos(phase);
  double desiredY = hasTarget ? ty - (c.wy + s.h * 0.5) : std::sin(phase * 0.71 + c.id) * 0.55;
  int surface = E.terrain.genSurfaceAbs((int)std::floor(c.wx + s.w * 0.5));
  double altitude = surface - (c.wy + s.h);
  if (altitude < 8) desiredY = -1;
  else if (altitude > 52) desiredY = 1;
  double d = std::sqrt(desiredX * desiredX + desiredY * desiredY); if (d < 1e-6) d = 1;
  desiredX = desiredX / d * s.swimSpeed; desiredY = desiredY / d * s.swimSpeed;
  c.vx += std::max(-s.accel, std::min(s.accel, desiredX - c.vx));
  c.vy += std::max(-s.accel, std::min(s.accel, desiredY - c.vy));
  if (std::fabs(c.vx) > 0.02) c.facing = c.vx > 0 ? 1 : -1;
  auto moveAxis = [&](double& pos, double delta, bool xAxis) {
    double moved = 0, mag = std::fabs(delta), dir = delta >= 0 ? 1.0 : -1.0;
    while (moved < mag - 1e-6) {
      double step = std::min(0.25, mag - moved), nx = c.wx, ny = c.wy;
      if (xAxis) nx = pos + dir * step; else ny = pos + dir * step;
      if (boxHitsSolid(nx, ny, s.w, s.h) || boxTouchesLiquid(nx, ny, s.w, s.h)) return false;
      pos += dir * step; moved += step;
    }
    return true;
  };
  if (!moveAxis(c.wx, c.vx, true)) c.vx *= -0.55;
  if (!moveAxis(c.wy, c.vy, false)) c.vy *= -0.55;
}

void CreatureSystem::attackTarget(Creature& c) {
  const CreatureSpecies& s = species(c); if (c.attackCooldown > 0 || s.damage <= 0) return;
  double tx, ty; Creature* prey = nullptr; Player* player = nullptr;
  if (!targetPoint(c, tx, ty, &prey, &player)) return;
  auto inMeleeRange = [&](double bx, double by, int bw, int bh) {
    double gx = std::max(0.0, std::max(bx - (c.wx + s.w), c.wx - (bx + bw)));
    double gy = std::max(0.0, std::max(by - (c.wy + s.h), c.wy - (by + bh)));
    return gx * gx + gy * gy <= s.attackRange * s.attackRange;
  };
  bool hit = false;
  if (prey) { const CreatureSpecies& ps = species(*prey); hit = inMeleeRange(prey->wx, prey->wy, ps.w, ps.h); if (hit) prey->health -= s.damage; }
  if (player) {
    hit = inMeleeRange(E.fg.worldOffsetX + player->px, E.fg.worldOffsetY + player->py, player->w, player->h);
    if (hit && player->hurtCooldown <= 0) {
      player->health -= s.damage;
      player->hurtCooldown = 30;
      if (player->health <= 0) E.psys.respawnPlayer(*player);
    }
  }
  if (hit) c.attackCooldown = s.attackCooldown;
}

void CreatureSystem::updateCreatures() {
  if (!E.creaturesEnabled) return;
  if (E.creatureNaturalSpawning) updatePopulation();
  for (Creature& c : creatures) {
    if (!c.alive) { c.deathTicks--; continue; }
    if (c.health <= 0) { c.health = 0; c.alive = false; c.deathTicks = 18; continue; }
    if (c.scanCooldown > 0) c.scanCooldown--; else acquireTarget(c);
    if (c.attackCooldown > 0) c.attackCooldown--;
    if (c.hurtCooldown > 0) c.hurtCooldown--;
    if (species(c).locomotion == CL_AQUATIC) {
      if (fluidCoverage(c.wx, c.wy, species(c).w, species(c).h) >= species(c).fluidThreshold) {
        c.grounded = false;
        steerAquatic(c);
        moveAquatic(c);
      } else moveBeachedAquatic(c);
    }
    else if (species(c).locomotion == CL_FLYING) moveFlying(c);
    else moveAmphibious(c);
    // Terrain can settle or be placed through an entity after movement. Mere
    // floor contact is outside the AABB and harmless; sustained burial over at
    // least half the body deals one point every half-second at 60 actor Hz.
    if (((E.actorTick + c.id * 7) % 30) == 0 &&
        blockingCoverage(c.wx, c.wy, species(c).w, species(c).h) >= 0.5) c.health--;
    attackTarget(c);
    // Four authored poses per species. Tie pose selection to locomotion where
    // it matters so feet, wings, and body arcs describe the actual movement
    // instead of every creature sharing the same two-frame global blink.
    if (c.species == CS_BIRD) {
      c.animFrame = (uint8_t)(((E.actorTick / 3) + c.id) & 3);
    } else if (c.species == CS_HARE) {
      if (c.vy < -0.18) c.animFrame = 1;       // launch: long rear-leg extension
      else if (c.vy > 0.18) c.animFrame = 3;  // descent: forelegs reach for ground
      else if (!c.grounded) c.animFrame = 2;  // compact silhouette at the apex
      else c.animFrame = 0;                   // settled crouch
    } else if (species(c).locomotion == CL_AQUATIC) {
      int cadence = std::fabs(c.vx) + std::fabs(c.vy) > 0.42 ? 3 : 5;
      c.animFrame = (uint8_t)(((E.actorTick / cadence) + c.id) & 3);
    } else {
      bool moving = std::fabs(c.vx) > 0.035;
      c.animFrame = moving ? (uint8_t)(((E.actorTick / 5) + c.id) & 3) : 0;
    }
  }
}

bool CreatureSystem::damageAtPoint(int x, int y, int radius, int damage) {
  double wx = E.fg.worldOffsetX + x + 0.5, wy = E.fg.worldOffsetY + y + 0.5;
  bool hit = false; double r2 = (double)radius * radius;
  for (Creature& c : creatures) {
    if (!c.alive || c.hurtCooldown > 0) continue;
    const CreatureSpecies& s = species(c);
    double nx = std::max(c.wx, std::min(wx, c.wx + s.w));
    double ny = std::max(c.wy, std::min(wy, c.wy + s.h));
    double dx = wx - nx, dy = wy - ny;
    if (dx * dx + dy * dy <= r2) { c.health -= damage; c.hurtCooldown = 7; hit = true; }
  }
  return hit;
}

int CreatureSystem::buildCreatureSnapshot() {
  snapshot.assign(creatures.size() * CSN_STRIDE, 0.0f);
  for (size_t i = 0; i < creatures.size(); i++) {
    const Creature& c = creatures[i]; const CreatureSpecies& s = species(c);
    float* o = snapshot.data() + i * CSN_STRIDE;
    o[CSN_ID] = (float)c.id; o[CSN_SPECIES] = (float)c.species;
    o[CSN_X] = (float)(c.wx - E.fg.worldOffsetX); o[CSN_Y] = (float)(c.wy - E.fg.worldOffsetY);
    o[CSN_VX] = (float)c.vx; o[CSN_VY] = (float)c.vy; o[CSN_W] = (float)s.w; o[CSN_H] = (float)s.h;
    o[CSN_FACING] = (float)c.facing; o[CSN_HEALTH] = (float)c.health; o[CSN_MAX_HEALTH] = (float)s.maxHealth;
    o[CSN_ALIVE] = c.alive ? 1.0f : 0.0f; o[CSN_ANIM_FRAME] = (float)c.animFrame;
  }
  return (int)creatures.size();
}
