bool CreatureSystem::isProtectedNpc(const Creature& c) const {
  return c.species == CS_IRIS_COMMANDER ||
    (E.planetId == PL_SHIP &&
     (c.species == CS_IRIS_ENGINEER || c.species == CS_SURVEYOR));
}

bool CreatureSystem::inLoadedWindow(const Creature& c, int margin) const {
  double x = c.wx - E.fg.worldOffsetX, y = c.wy - E.fg.worldOffsetY;
  const CreatureSpecies& s = species(c);
  return x + s.w >= -margin && x < E.cols + margin && y + s.h >= -margin && y < E.rows + margin;
}

bool CreatureSystem::boxInsideLoadedWindow(double wx, double wy, int w, int h, int margin) const {
  double x = wx - E.fg.worldOffsetX, y = wy - E.fg.worldOffsetY;
  return x >= margin && y >= margin && x + w <= E.cols - margin && y + h <= E.rows - margin;
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

bool CreatureSystem::boxHitsOtherBody(double wx, double wy, int w, int h,
                                      const Body* ignored) {
  double px = wx - E.fg.worldOffsetX, py = wy - E.fg.worldOffsetY;
  for (Body* body : E.fg.bodies) {
    if (body == ignored || body->jointRole == 2) continue;
    double radius = body->maxR + 1.0;
    if (px >= body->px + radius || px + w <= body->px - radius ||
        py >= body->py + radius || py + h <= body->py - radius) continue;
    bool hit = false;
    E.rigid.forEachBodyCell(body, [&](int x, int y, int) {
      if (!hit && px < x + 1 && px + w > x && py < y + 1 && py + h > y) hit = true;
    });
    if (hit) return true;
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

bool CreatureSystem::boxTouchesMaterial(double wx, double wy, int w, int h,
                                        uint8_t material) const {
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX);
  int x1 = (int)std::floor(wx - E.fg.worldOffsetX + w - 1e-6);
  int y0 = (int)std::floor(wy - E.fg.worldOffsetY);
  int y1 = (int)std::floor(wy - E.fg.worldOffsetY + h - 1e-6);
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++)
    if (x >= 0 && x < E.cols && y >= 0 && y < E.rows &&
        E.fg.grid[E.I(x, y)] == material) return true;
  return false;
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
  // Walkers need dry footing, not merely a solid floor under a flooded body.
  // This also prevents natural surface/cave spawns from starting underwater.
  if (fluidCoverage(wx, wy, s.w, s.h) >= s.fluidThreshold) return false;
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
  for (const CreatureSpawnTelegraph& p : pendingSpawns) {
    if (p.species != speciesId) continue;
    double dx = p.wx - wx, dy = p.wy - wy;
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
  for (const CreatureSpawnTelegraph& p : pendingSpawns) {
    double dx = p.wx - wx, dy = p.wy - wy;
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

// Find a deterministic habitat-valid entry near one player (or the camera when
// no player exists). A normal encounter must clear every live player's
// approximate visible rectangle plus SPAWN_VIEW_MARGIN. The second, explicitly
// requested search is the on-screen fallback used only by the breach telegraph.
bool CreatureSystem::findSpawnNearFocus(uint8_t speciesId, uint32_t salt,
                                        bool requireOffscreen,
                                        double& outWx, double& outWy) const {
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
  auto intersectsVisibleViews = [&](double wx, double wy, double margin) {
    auto intersectsExpanded = [&](double left, double top, double right, double bottom) {
      left -= margin; top -= margin;
      right += margin; bottom += margin;
      return wx < right && wx + s.w > left && wy < bottom && wy + s.h > top;
    };
    double cameraLeft = E.fg.worldOffsetX + E.cam.camX;
    double cameraTop = E.fg.worldOffsetY + E.cam.camY;
    if (intersectsExpanded(cameraLeft, cameraTop,
                           cameraLeft + vw, cameraTop + vh)) return true;
    for (const Player* p : live) {
      double pcx = E.fg.worldOffsetX + p->px + p->w * 0.5;
      double pcy = E.fg.worldOffsetY + p->py + p->h * 0.5;
      double left = pcx - vw * 0.5;
      double top = pcy + PLAYER_H * 0.5 + 4.0 - vh * CAM_SURFACE_VIEW_Y_FRAC;
      if (intersectsExpanded(left, top, left + vw, top + vh)) return true;
    }
    return false;
  };
  auto intersectsVisibleColumns = [&](double wx, double margin) {
    auto overlapsExpanded = [&](double left, double right) {
      return wx < right + margin && wx + s.w > left - margin;
    };
    double cameraLeft = E.fg.worldOffsetX + E.cam.camX;
    if (overlapsExpanded(cameraLeft, cameraLeft + vw)) return true;
    for (const Player* p : live) {
      double pcx = E.fg.worldOffsetX + p->px + p->w * 0.5;
      if (overlapsExpanded(pcx - vw * 0.5, pcx + vw * 0.5)) return true;
    }
    return false;
  };
  uint32_t seed = E.fg.worldSeed ^ 0xC4EA7400u ^ ((uint32_t)speciesId * 0x9e3779b9u) ^ salt;
  for (int attempt = 0; attempt < 64; attempt++) {
    // Armed survival encounters should enter from the simulated bands beside
    // the view. Keep a short radial tail for terrain that offers no valid
    // habitat on either side.
    bool sideEntry = requireOffscreen && speciesId >= CS_DYNAMITEER && attempt < 48;
    double angle = whash2(seed ^ 0x11u, attempt, (int)salt) * 6.283185307179586;
    double ux = sideEntry
      ? (whash2(seed ^ 0x51DEu, (int)salt, attempt) < 0.5 ? -1.0 : 1.0)
      : std::cos(angle);
    double uy = sideEntry ? 0.0 : std::sin(angle);
    double minDist = r.minPlayerDistance;
    double maxDist = r.maxPlayerDistance;
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
      double caveRoll = whash2(seed ^ 0x44u, centerX, attempt);
      double shallowCaveTop = surface + 12;
      bool followFocusDepth = fy > shallowCaveTop + 72;
      wy = followFocusDepth
        ? std::floor(fy - s.h * 0.5 + (caveRoll - 0.5) * 72)
        : shallowCaveTop + (int)(caveRoll * 72);
      bool found = false;
      int scanRadius = followFocusDepth ? 96 : 48;
      for (int d = 0; d < scanRadius && !found; d++) for (int sign : {1, -1}) {
        double cy = wy + sign * d;
        if (boxFitsHabitat(speciesId, wx, cy)) { wy = cy; found = true; break; }
      }
      if (!found) continue;
    }
    if (!boxInsideLoadedWindow(wx, wy, s.w, s.h, 2) ||
        !boxFitsHabitat(speciesId, wx, wy)) continue;
    // Surface/cave/air habitat snapping can substantially change Y after the
    // radial candidate was chosen. Recheck the actual final pose so enemies do
    // not materialize on top of a player despite their spawn safety radius.
    if (!farEnoughFromPlayers(wx + s.w * 0.5, wy + s.h * 0.5, r.minPlayerDistance)) continue;
    if (requireOffscreen) {
      if (sideEntry && intersectsVisibleColumns(wx, SPAWN_VIEW_MARGIN)) continue;
      if (intersectsVisibleViews(wx, wy, SPAWN_VIEW_MARGIN)) continue;
    } else if (!intersectsVisibleViews(wx, wy, 0)) {
      // A warning portal must actually be visible to at least one player. The
      // ten-cell exclusion margin is for unannounced off-screen entries only.
      continue;
    }
    outWx = wx; outWy = wy;
    return true;
  }
  return false;
}

int CreatureSystem::encounterCost(uint8_t speciesId) const {
  if (speciesId == CS_DYNAMITEER) return 2;
  if (speciesId == CS_CAUSTIC_MORTARMAN || speciesId == CS_CLUSTER_WASP) return 3;
  return 4; // bore sentinels and minigunners are the director's heavy picks
}

int CreatureSystem::addCreature(uint8_t speciesId, double wx, double wy, int id) {
  Creature c; c.id = id; c.species = speciesId; c.wx = wx; c.wy = wy;
  c.health = CREATURE_SPECIES[speciesId].maxHealth;
  c.facing = whash1(E.fg.worldSeed ^ 0xC4EA7u, c.id) < 0.5 ? -1 : 1;
  if (speciesId == CS_QUARRY_FOREMAN || speciesId == CS_REACTOR_WARDEN)
    c.attackPattern = (uint8_t)(id % 3);
  creatures.push_back(c);
  return c.id;
}

bool CreatureSystem::queueSpawnTelegraph(uint8_t speciesId, double wx, double wy,
                                         uint32_t salt) {
  const CreatureSpawnRule& r = CREATURE_SPECIES[speciesId].spawn;
  int active = (int)pendingSpawns.size(), activeOfSpecies = 0;
  for (const CreatureSpawnTelegraph& p : pendingSpawns)
    if (p.species == speciesId) activeOfSpecies++;
  for (const Creature& c : creatures) if (c.alive) {
    active++;
    if (c.species == speciesId) activeOfSpecies++;
  }
  if (active >= NATURAL_MOB_CAP || activeOfSpecies >= r.maxActive ||
      localDensity(speciesId, wx, wy, r.densityRadius) >= r.densityCap ||
      localDensityAll(wx, wy, MIXED_DENSITY_RADIUS) >= MIXED_DENSITY_CAP) return false;
  int duration = SPAWN_TELEGRAPH_MIN_TICKS +
    (int)(whash2(E.fg.worldSeed ^ 0xB4EAC100u, speciesId, (int)salt) *
          SPAWN_TELEGRAPH_TICK_SPAN);
  duration = imin(SPAWN_TELEGRAPH_MIN_TICKS + SPAWN_TELEGRAPH_TICK_SPAN - 1,
                  imax(SPAWN_TELEGRAPH_MIN_TICKS, duration));
  pendingSpawns.push_back({nextCreatureId++, speciesId, wx, wy, duration, duration});
  E.audio.emit(SE_SPAWN_BREACH, wx - E.fg.worldOffsetX + CREATURE_SPECIES[speciesId].w * 0.5,
               wy - E.fg.worldOffsetY + CREATURE_SPECIES[speciesId].h * 0.5,
               0.72, STONE, 0);
  return true;
}

// Prefer a normal off-screen entry. When terrain or buffer geometry offers no
// such position, reserve the same population capacity and visibly telegraph the
// best habitat-valid fallback before materializing it.
bool CreatureSystem::spawnNearFocus(uint8_t speciesId, uint32_t salt) {
  double wx = 0, wy = 0;
  if (findSpawnNearFocus(speciesId, salt, true, wx, wy))
    return spawnCreatureNatural(speciesId, wx, wy) != 0;
  if (!findSpawnNearFocus(speciesId, salt ^ 0xB4EAC5u, false, wx, wy)) return false;
  return queueSpawnTelegraph(speciesId, wx, wy, salt);
}

bool CreatureSystem::spawnVisibleBreachNearFocus(uint8_t speciesId,
                                                 uint32_t salt) {
  double wx = 0, wy = 0;
  if (!findSpawnNearFocus(speciesId, salt, false, wx, wy)) return false;
  return queueSpawnTelegraph(speciesId, wx, wy, salt);
}

int CreatureSystem::spawnCreature(uint8_t speciesId, double wx, double wy, bool requireHabitat) {
  if (speciesId >= CS_COUNT || (requireHabitat && !boxFitsHabitat(speciesId, wx, wy))) return 0;
  return addCreature(speciesId, wx, wy, nextCreatureId++);
}

// Population policy belongs only to natural spawning. Eggs and future scripted,
// summoned, or quest spawns call spawnCreature directly; they still contribute
// to these counts, so a high manual population pauses further natural births.
int CreatureSystem::spawnCreatureNatural(uint8_t speciesId, double wx, double wy) {
  if (speciesId >= CS_COUNT || !boxFitsHabitat(speciesId, wx, wy)) return 0;
  const CreatureSpawnRule& r = CREATURE_SPECIES[speciesId].spawn;
  int active = (int)pendingSpawns.size(), activeOfSpecies = 0;
  for (const CreatureSpawnTelegraph& p : pendingSpawns)
    if (p.species == speciesId) activeOfSpecies++;
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

void CreatureSystem::maintainPopulation() {
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
    if (E.fg.infinite && !inLoadedWindow(creatures[i])) {
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
      if (inLoadedWindow(bucket[i])) creatures.push_back(bucket[i]);
      else { if (keep != i) bucket[keep] = bucket[i]; keep++; }
    }
    bucket.resize(keep);
    if (bucket.empty()) dormantRegions.erase(it);
  }
}

void CreatureSystem::updateSpawnTelegraphs() {
  size_t i = 0;
  while (i < pendingSpawns.size()) {
    CreatureSpawnTelegraph& pending = pendingSpawns[i];
    if (--pending.ticksRemaining > 0) { i++; continue; }
    CreatureSpawnTelegraph ready = pending;
    pendingSpawns.erase(pendingSpawns.begin() + i);
    // Placement, habitat, safety, and population policy are all accepted before
    // a breach becomes visible. From that point its id is a real reservation:
    // player movement or later population changes cannot turn the warning into
    // an empty animation.
    addCreature(ready.species, ready.wx, ready.wy, ready.id);
  }
}

void CreatureSystem::updateNaturalPopulation() {
  // The survival director creates at most one encounter per cadence. Threat
  // accrues on the deterministic actor clock and expensive enemies consume more
  // of it; this replaces five independent timers that could all pop at once.
  if (!E.survivalInventory) return;
  if (E.actorTick % ENCOUNTER_THREAT_GAIN_TICKS == 0)
    encounterThreat = imin(ENCOUNTER_THREAT_MAX, encounterThreat + 1);
  if (E.actorTick < encounterNextTick) return;
  encounterNextTick = E.actorTick + ENCOUNTER_CADENCE_TICKS;

  static const uint8_t roster[] = {
    CS_DYNAMITEER, CS_BORE_SENTINEL, CS_CAUSTIC_MORTARMAN,
    CS_CLUSTER_WASP, CS_MINIGUNNER
  };
  uint32_t salt = (uint32_t)E.actorTick ^
    ((uint32_t)std::max(0, E.fg.worldOffsetX) * 2246822519u) ^
    ((uint32_t)std::max(0, E.fg.worldOffsetY) * 3266489917u);
  int start = (int)(whash2(E.fg.worldSeed ^ 0xC4EA7300u,
                            E.actorTick / ENCOUNTER_CADENCE_TICKS,
                            encounterThreat) * 5.0);
  start = imin(4, imax(0, start));
  for (int offset = 0; offset < 5; offset++) {
    uint8_t sid = roster[(start + offset) % 5];
    int cost = encounterCost(sid);
    if (encounterThreat < cost) continue;
    if (!spawnNearFocus(sid, salt ^ ((uint32_t)sid * 1013u))) continue;
    encounterThreat -= cost;
    return;
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

// Find a nearby position that satisfies this species' actual spawn habitat.
// The expanding deterministic scan favors the closest horizontal escape, while
// checking every vertical cell lets walkers find sloped banks and cave floors.
// Results are cached on the creature; this scan normally runs only twice/second.
bool CreatureSystem::findNearbyHabitat(const Creature& c, int maxRadius, double& tx, double& ty) const {
  const CreatureSpecies& s = species(c);
  int bx = (int)std::floor(c.wx), by = (int)std::floor(c.wy);
  auto accepts = [&](int x, int y) {
    if (x < E.fg.worldOffsetX || x + s.w > E.fg.worldOffsetX + E.cols ||
        y < E.fg.worldOffsetY || y + s.h > E.fg.worldOffsetY + E.rows) return false;
    if (!boxFitsHabitat(c.species, x, y)) return false;
    tx = x + s.w * 0.5; ty = y + s.h * 0.5;
    return true;
  };
  for (int radius = 2; radius <= maxRadius; radius += 2) {
    int vertical = std::min(maxRadius, radius + 12);
    for (int side = 0; side < 2; side++) {
      int dir = side == 0 ? (c.facing >= 0 ? 1 : -1) : (c.facing >= 0 ? -1 : 1);
      int x = bx + dir * radius;
      for (int d = 0; d <= vertical; d++) {
        if (accepts(x, by - d)) return true;
        if (d && accepts(x, by + d)) return true;
      }
    }
    // Aquatic habitat may be directly above or below a beached fish rather
    // than beyond a shoreline, so sample the horizontal edges of the ring too.
    if (s.spawn.habitat == CH_WATER) for (int d = 0; d <= radius; d += 2) {
      for (int side = 0; side < 2; side++) {
        int x = bx + (side ? -d : d);
        if (accepts(x, by - radius) || accepts(x, by + radius)) return true;
      }
    }
  }
  return false;
}

void CreatureSystem::refreshWander(Creature& c) {
  if (c.wanderTicks > 0) { c.wanderTicks--; return; }
  uint32_t salt = (uint32_t)c.id * 0x9e3779b9u ^ (uint32_t)E.actorTick;
  c.wanderDir = whash1(E.fg.worldSeed ^ 0xA11CE51u, (int)salt) < 0.5 ? -1 : 1;
  c.wanderTicks = 90 + (int)(whash1(E.fg.worldSeed ^ 0xA11CE77u, (int)salt) * 150);
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
  if (c.habitatScanCooldown > 0) c.habitatScanCooldown--;
  if (c.habitatScanCooldown <= 0) {
    if (!c.hasHabitatGoal || !boxFitsHabitat(c.species, c.habitatX - s.w * 0.5, c.habitatY - s.h * 0.5))
      c.hasHabitatGoal = findNearbyHabitat(c, 56, c.habitatX, c.habitatY);
    c.habitatScanCooldown = 30;
  }
  refreshWander(c);
  double desiredX = c.hasHabitatGoal ? (c.habitatX > c.wx + s.w * 0.5 ? 0.24 : -0.24)
                                     : c.wanderDir * 0.12;
  c.vx += std::max(-0.025, std::min(0.025, desiredX - c.vx));
  c.vy = std::min(2.4, c.vy + E.scaledGravity(0.075));
  c.vx *= c.grounded ? 0.90 : 0.995;
  int flopPeriod = 32 + (c.id % 17);
  if (c.grounded && ((E.actorTick + c.id * 11) % flopPeriod) == 0) {
    double kick = 0.20 + whash1(E.fg.worldSeed ^ 0xF10F00u, c.id + E.actorTick) * 0.18;
    c.facing = c.hasHabitatGoal ? (c.habitatX > c.wx + s.w * 0.5 ? 1 : -1) : c.wanderDir;
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
    if (c.habitatScanCooldown > 0) c.habitatScanCooldown--;
    if (c.habitatScanCooldown <= 0) {
      if (!c.hasHabitatGoal || !boxFitsHabitat(c.species, c.habitatX - s.w * 0.5, c.habitatY - s.h * 0.5))
        c.hasHabitatGoal = findNearbyHabitat(c, 64, c.habitatX, c.habitatY);
      c.habitatScanCooldown = 30;
    }
    refreshWander(c);
    // Dry footing outranks hunting while submerged. Without a visible bank,
    // keep swimming upward and laterally instead of circling in deep water.
    double dx = c.hasHabitatGoal ? c.habitatX - (c.wx + s.w * 0.5) : c.wanderDir;
    double dy = c.hasHabitatGoal ? c.habitatY - (c.wy + s.h * 0.5) : -0.85;
    double d = std::sqrt(dx * dx + dy * dy); if (d < 1e-6) d = 1;
    c.vx += std::max(-s.accel, std::min(s.accel, dx / d * s.swimSpeed - c.vx));
    c.vy += std::max(-s.accel, std::min(s.accel, dy / d * s.swimSpeed - c.vy));
  } else {
    c.hasHabitatGoal = false;
    c.habitatScanCooldown = 0;
    refreshWander(c);
    double avoidX = 0, avoidD2 = s.sightRange * s.sightRange;
    bool avoidsPlayer = false;
    if (!hasTarget && !s.hostile) for (const Player& p : E.psys.players) {
      if (!p.active || !p.alive) continue;
      double px = E.fg.worldOffsetX + p.px + p.w * 0.5;
      double py = E.fg.worldOffsetY + p.py + p.h * 0.5;
      double dx = px - (c.wx + s.w * 0.5), dy = py - (c.wy + s.h * 0.5);
      double d2 = dx * dx + dy * dy;
      if (d2 < avoidD2) { avoidD2 = d2; avoidX = px; avoidsPlayer = true; }
    }
    double wish;
    bool rangedEnemy = c.species == CS_DYNAMITEER || c.species == CS_BORE_SENTINEL ||
      c.species == CS_CAUSTIC_MORTARMAN || c.species == CS_MINIGUNNER ||
      c.species == CS_QUARRY_FOREMAN || c.species == CS_REACTOR_WARDEN;
    if (hasTarget && rangedEnemy) {
      double dx = tx - (c.wx + s.w * 0.5), distance = std::fabs(dx);
      double nearRange = (c.species == CS_DYNAMITEER ||
                          c.species == CS_QUARRY_FOREMAN) ? 28.0
        : c.species == CS_BORE_SENTINEL ? 46.0
        : c.species == CS_CAUSTIC_MORTARMAN ? 36.0
        : (c.species == CS_MINIGUNNER ||
           c.species == CS_REACTOR_WARDEN) ? 38.0 : 10.0;
      double farRange = (c.species == CS_DYNAMITEER ||
                         c.species == CS_QUARRY_FOREMAN) ? 58.0
        : c.species == CS_BORE_SENTINEL ? 88.0
        : c.species == CS_CAUSTIC_MORTARMAN ? 76.0
        : (c.species == CS_MINIGUNNER ||
           c.species == CS_REACTOR_WARDEN) ? 92.0 : 38.0;
      if (c.attackState != CAS_IDLE) wish = 0;
      else if (distance > farRange) wish = dx > 0 ? s.walkSpeed : -s.walkSpeed;
      else if (distance < nearRange) wish = dx > 0 ? -s.walkSpeed : s.walkSpeed;
      else wish = 0;
    } else {
      wish = hasTarget ? (tx > c.wx + s.w * 0.5 ? s.walkSpeed : -s.walkSpeed)
                       : avoidsPlayer ? (avoidX > c.wx + s.w * 0.5 ? -s.walkSpeed : s.walkSpeed)
                       : c.wanderDir * s.walkSpeed * 0.62;
    }
    c.vx += std::max(-s.accel, std::min(s.accel, wish - c.vx));
    if (s.hopPeriod > 0 && c.grounded && ((E.actorTick + c.id * 7) % s.hopPeriod) == 0) c.vy = -s.jumpSpeed;
    c.vy += E.scaledGravity(s.gravity); if (c.vy > 2.4) c.vy = 2.4;
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
  double startX = c.wx, startY = c.wy;
  if (!moveAxis(c.wx, c.vx, true)) {
    // Wide walkers meet a rising bank with their front edge before their feet
    // are dry. Step over a one-cell lip; for a taller bank, kick upward while
    // still swimming so the next tick approaches above the blocking cell.
    double blockedX = c.wx;
    bool climbed = false;
    if (c.hasHabitatGoal || wet < s.fluidThreshold) for (double lift = 0.25; lift <= 1.25; lift += 0.25) {
      c.wx = startX; c.wy = startY - lift;
      if (boxHitsSolid(c.wx, c.wy, s.w, s.h)) break;
      if (moveAxis(c.wx, c.vx, true)) { climbed = true; break; }
    }
    if (!climbed) {
      c.wx = blockedX; c.wy = startY;
      bool supported = c.grounded || boxHitsSolid(c.wx, c.wy + 0.35, s.w, s.h);
      if ((wet < s.fluidThreshold && supported) || c.hasHabitatGoal)
        c.vy = std::min(c.vy, -s.jumpSpeed * (c.hasHabitatGoal ? 0.85 : 1.0));
      if (!hasTarget && wet < s.fluidThreshold) {
        c.wanderDir = c.facing > 0 ? -1 : 1;
        c.wanderTicks = 75;
      }
      c.vx = 0;
    }
  }
  if (!moveAxis(c.wy, c.vy, false)) c.vy = 0;
  c.grounded = boxHitsSolid(c.wx, c.wy + 0.12, s.w, s.h);
}

void CreatureSystem::moveFlying(Creature& c) {
  const CreatureSpecies& s = species(c);
  const bool submerged = fluidCoverage(c.wx, c.wy, s.w, s.h) > 0;
  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  double phase = (E.actorTick + c.id * 43) * 0.025;
  double desiredX, desiredY;
  if (hasTarget && c.species == CS_CLUSTER_WASP) {
    double dx = tx - (c.wx + s.w * 0.5), distance = std::fabs(dx);
    if (c.attackState != CAS_IDLE) desiredX = 0;
    else if (distance > 82) desiredX = dx;
    else if (distance < 48) desiredX = -dx;
    else desiredX = std::cos(phase) * .16;
    // Hover above the target so the carrier opens into a readable rain of
    // bomblets instead of behaving like a contact-melee bird.
    desiredY = (ty - 25.0) - (c.wy + s.h * 0.5);
  } else {
    desiredX = hasTarget ? tx - (c.wx + s.w * 0.5) : std::cos(phase);
    desiredY = hasTarget ? ty - (c.wy + s.h * 0.5) : std::sin(phase * 0.71 + c.id) * 0.55;
  }
  int surface = E.terrain.genSurfaceAbs((int)std::floor(c.wx + s.w * 0.5));
  double altitude = surface - (c.wy + s.h);
  if (submerged) { desiredX *= 0.25; desiredY = -1; }
  else if (altitude < 8) desiredY = -1;
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
      // Water is an entry barrier for a flying bird, but not an exit barrier.
      // If water engulfs one, let it climb through the fluid until clear.
      if (boxHitsSolid(nx, ny, s.w, s.h) || (!submerged && boxTouchesLiquid(nx, ny, s.w, s.h))) return false;
      pos += dir * step; moved += step;
    }
    return true;
  };
  if (!moveAxis(c.wx, c.vx, true)) c.vx *= -0.55;
  if (!moveAxis(c.wy, c.vy, false)) c.vy *= -0.55;
}

static constexpr int DYNAMITE_CHARGE_TICKS = 30;
static constexpr int DYNAMITE_THROW_TICKS = 8;
static constexpr int BORE_CHARGE_TICKS = 90;
static constexpr int BORE_LOCK_TICKS = 30;
static constexpr int BORE_FIRE_TICKS = 6;
static constexpr int BORE_CANNON_DAMAGE = 70;
static constexpr int MORTARMAN_CHARGE_TICKS = 42;
static constexpr int MORTARMAN_FIRE_TICKS = 8;
static constexpr int CLUSTER_WASP_CHARGE_TICKS = 32;
static constexpr int CLUSTER_WASP_FIRE_TICKS = 8;
static constexpr int MINIGUNNER_CHARGE_TICKS = 18;
static constexpr int MINIGUNNER_BURST_TICKS = 150;
static constexpr int MINIGUNNER_SHOT_INTERVAL = 2;

static bool segmentHitsExpandedBox(double x0, double y0, double x1, double y1,
                                   double bx0, double by0, double bx1, double by1, double expand) {
  bx0 -= expand; by0 -= expand; bx1 += expand; by1 += expand;
  double dx = x1 - x0, dy = y1 - y0, t0 = 0, t1 = 1;
  auto clip = [&](double p, double q) {
    if (std::fabs(p) < 1e-9) return q >= 0;
    double r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x0 - bx0) && clip(dx, bx1 - x0) &&
         clip(-dy, y0 - by0) && clip(dy, by1 - y0);
}

void CreatureSystem::updateDynamiteerAttack(Creature& c) {
  const CreatureSpecies& s = species(c);
  if (c.attackState == CAS_FIRING) {
    c.attackProgress = std::max(0.0, 1.0 - c.attackTicks / (double)DYNAMITE_THROW_TICKS);
    if (++c.attackTicks >= DYNAMITE_THROW_TICKS) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    // Keep tracking throughout the short wind-up; if the target vanishes, throw
    // at its last observed position instead of cancelling an already-lit bundle.
    if (hasTarget) { c.attackAimX = tx; c.attackAimY = ty; }
    if (c.attackAimX != 0 || c.attackAimY != 0)
      c.facing = c.attackAimX >= c.wx + s.w * 0.5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)DYNAMITE_CHARGE_TICKS);
    if (c.attackTicks >= DYNAMITE_CHARGE_TICKS) {
      E.projectiles.spawnDynamite(c, c.attackAimX - E.fg.worldOffsetX, c.attackAimY - E.fg.worldOffsetY);
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      c.attackCooldown = s.attackCooldown;
    }
    return;
  }

  if (!hasTarget || c.attackCooldown > 0) return;
  double dx = tx - (c.wx + s.w * 0.5), dy = ty - (c.wy + s.h * 0.5);
  if (dx * dx + dy * dy > s.attackRange * s.attackRange) return;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = dx >= 0 ? 1 : -1;
}

void CreatureSystem::updateCausticMortarmanAttack(Creature& c) {
  const CreatureSpecies& s = species(c);
  if (c.attackState == CAS_FIRING) {
    c.attackProgress = std::max(0.0, 1.0 - c.attackTicks / (double)MORTARMAN_FIRE_TICKS);
    if (++c.attackTicks >= MORTARMAN_FIRE_TICKS) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    if (hasTarget) { c.attackAimX = tx; c.attackAimY = ty; }
    c.facing = c.attackAimX >= c.wx + s.w * .5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)MORTARMAN_CHARGE_TICKS);
    if (c.attackTicks >= MORTARMAN_CHARGE_TICKS) {
      E.projectiles.spawnAcidShell(c, c.attackAimX - E.fg.worldOffsetX,
                                   c.attackAimY - E.fg.worldOffsetY);
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      c.attackCooldown = s.attackCooldown;
    }
    return;
  }

  if (!hasTarget || c.attackCooldown > 0) return;
  double dx = tx - (c.wx + s.w * .5), dy = ty - (c.wy + s.h * .5);
  if (dx * dx + dy * dy > s.attackRange * s.attackRange) return;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = dx >= 0 ? 1 : -1;
}

void CreatureSystem::updateClusterWaspAttack(Creature& c) {
  const CreatureSpecies& s = species(c);
  if (c.attackState == CAS_FIRING) {
    c.attackProgress = std::max(0.0, 1.0 - c.attackTicks / (double)CLUSTER_WASP_FIRE_TICKS);
    if (++c.attackTicks >= CLUSTER_WASP_FIRE_TICKS) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    if (hasTarget) { c.attackAimX = tx; c.attackAimY = ty; }
    c.facing = c.attackAimX >= c.wx + s.w * .5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)CLUSTER_WASP_CHARGE_TICKS);
    if (c.attackTicks >= CLUSTER_WASP_CHARGE_TICKS) {
      E.projectiles.spawnClusterBomb(c, c.attackAimX - E.fg.worldOffsetX,
                                     c.attackAimY - E.fg.worldOffsetY);
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      c.attackCooldown = s.attackCooldown;
    }
    return;
  }

  if (!hasTarget || c.attackCooldown > 0) return;
  double dx = tx - (c.wx + s.w * .5), dy = ty - (c.wy + s.h * .5);
  if (dx * dx + dy * dy > s.attackRange * s.attackRange) return;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = dx >= 0 ? 1 : -1;
}

void CreatureSystem::updateMinigunnerAttack(Creature& c) {
  const CreatureSpecies& s = species(c);
  if (c.attackState == CAS_FIRING) {
    // Commit to the charged line for the entire burst. The long stream remains
    // threatening, but moving out of that line is now a reliable counterplay.
    c.facing = c.attackAimX >= c.wx + s.w * .5 ? 1 : -1;
    if ((c.attackTicks % MINIGUNNER_SHOT_INTERVAL) == 0) {
      E.projectiles.spawnMinigunRound(c,
        c.attackAimX - E.fg.worldOffsetX,
        c.attackAimY - E.fg.worldOffsetY);
    }
    c.attackTicks++;
    c.attackProgress = std::max(0.0,
      1.0 - c.attackTicks / (double)MINIGUNNER_BURST_TICKS);
    if (c.attackTicks >= MINIGUNNER_BURST_TICKS) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    if (hasTarget) { c.attackAimX = tx; c.attackAimY = ty; }
    c.facing = c.attackAimX >= c.wx + s.w * .5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)MINIGUNNER_CHARGE_TICKS);
    if (c.attackTicks >= MINIGUNNER_CHARGE_TICKS) {
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      c.attackCooldown = s.attackCooldown;
    }
    return;
  }

  if (!hasTarget || c.attackCooldown > 0) return;
  double dx = tx - (c.wx + s.w * .5), dy = ty - (c.wy + s.h * .5);
  if (dx * dx + dy * dy > s.attackRange * s.attackRange) return;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = dx >= 0 ? 1 : -1;
}

void CreatureSystem::updateBossAttack(Creature& c) {
  const CreatureSpecies& s = species(c);
  bool warden = c.species == CS_REACTOR_WARDEN;
  int chargeTicks = c.attackPattern == 2 ? 78 : (c.attackPattern == 1 ? 52 : 34);
  int fireTicks = c.attackPattern == 0 ? (warden ? 64 : 14) : 18;

  if (c.attackState == CAS_FIRING) {
    if (warden && c.attackPattern == 0 && (c.attackTicks % 4) == 0) {
      double spread = ((c.attackTicks / 4) % 5 - 2) * 2.2;
      E.projectiles.spawnMinigunRound(
        c, c.attackAimX - E.fg.worldOffsetX,
        c.attackAimY - E.fg.worldOffsetY + spread);
    }
    c.attackTicks++;
    c.attackProgress = std::max(0.0, 1.0 - c.attackTicks / (double)fireTicks);
    if (c.attackTicks >= fireTicks) {
      c.attackState = CAS_IDLE;
      c.attackTicks = 0;
      c.attackProgress = 0;
      c.attackPattern = (uint8_t)((c.attackPattern + 1) % 3);
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    if (hasTarget && c.attackTicks < chargeTicks - 18) {
      c.attackAimX = tx;
      c.attackAimY = ty;
    }
    c.facing = c.attackAimX >= c.wx + s.w * .5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)chargeTicks);
    if (c.attackTicks < chargeTicks) return;

    double localTargetX = c.attackAimX - E.fg.worldOffsetX;
    double localTargetY = c.attackAimY - E.fg.worldOffsetY;
    double localX = c.wx - E.fg.worldOffsetX + s.w * .5;
    double localY = c.wy - E.fg.worldOffsetY + s.h * .48;
    if (!warden && c.attackPattern == 0) {
      E.projectiles.spawnDynamite(c, localTargetX - 7, localTargetY);
      E.projectiles.spawnDynamite(c, localTargetX, localTargetY - 3);
      E.projectiles.spawnDynamite(c, localTargetX + 7, localTargetY);
    } else if (!warden && c.attackPattern == 1) {
      E.useLayer(&E.fg);
      E.detonate((int)std::lround(localX), (int)std::lround(localY + s.h * .42),
                 13, 15.0, 0, DEBRIS,
                 (uint32_t)(E.actorTick ^ (c.id * 0x9e3779b9u)));
      E.useLayer(&E.fg);
    } else if (warden && c.attackPattern == 1) {
      E.projectiles.spawnAcidShell(c, localTargetX - 5, localTargetY);
      E.projectiles.spawnClusterBomb(c, localTargetX + 5, localTargetY);
    } else if (c.attackPattern == 2) {
      double dx = c.attackAimX - (E.fg.worldOffsetX + localX);
      double dy = c.attackAimY - (E.fg.worldOffsetY + localY);
      double d = std::hypot(dx, dy);
      if (d < 1e-6) { dx = c.facing; dy = 0; d = 1; }
      dx /= d;
      dy /= d;
      localX += dx * (s.w * .5 + .8);
      localY += dy * (s.h * .35 + .8);
      fireBoreLine(localX, localY, dx, dy, warden ? 58 : 44, 0, c.id);
      E.projectiles.spawnBoreBeam(-c.id, localX, localY, dx, dy);
    }
    c.attackState = CAS_FIRING;
    c.attackTicks = 0;
    c.attackProgress = 1;
    c.attackCooldown = imax(70, s.attackCooldown / 2);
    return;
  }

  if (!hasTarget || c.attackCooldown > 0) return;
  double dx = tx - (c.wx + s.w * .5);
  double dy = ty - (c.wy + s.h * .5);
  if (dx * dx + dy * dy > s.attackRange * s.attackRange) return;
  c.attackState = CAS_CHARGING;
  c.attackTicks = 0;
  c.attackProgress = 0;
  c.attackAimX = tx;
  c.attackAimY = ty;
  c.facing = dx >= 0 ? 1 : -1;
  E.audio.emit(c.attackPattern == 2 ? SE_BORE_CHARGE : SE_CREATURE,
               c.wx - E.fg.worldOffsetX + s.w * .5,
               c.wy - E.fg.worldOffsetY + s.h * .42,
               1.0, c.species, 0);
}

void CreatureSystem::fireBoreLine(double ox, double oy, double dx, double dy, int damage,
                                  int immunePlayerId, int immuneCreatureId) {
  double d = std::hypot(dx, dy);
  if (d < 1e-6) return;
  dx /= d; dy /= d;
  double length = 1e9;
  if (dx > 1e-9) length = std::min(length, (E.cols - 2.0 - ox) / dx);
  else if (dx < -1e-9) length = std::min(length, (1.0 - ox) / dx);
  if (dy > 1e-9) length = std::min(length, (E.rows - 2.0 - oy) / dy);
  else if (dy < -1e-9) length = std::min(length, (1.0 - oy) / dy);
  if (!std::isfinite(length) || length <= 0) return;
  double ex = ox + dx * length, ey = oy + dy * length;

  // Deduplicate the swept footprint with the layer's generation-stamped scratch.
  // The complete cell list is built before eraseStrokeCells can reuse this scratch,
  // so no full-window allocation or clear is needed for each bore shot.
  std::vector<int32_t>& seen = E.fg.seenStamp;
  int32_t seenGen = ++E.fg.seenGen;
  std::vector<int> cells;
  int x0 = E.cols, y0 = E.rows, x1 = 0, y1 = 0;
  int samples = imax(1, (int)std::ceil(length * 2.0));
  cells.reserve((size_t)samples * (CREATURE_BORE_RADIUS * 2 + 1));
  for (int sample = 0; sample <= samples; sample++) {
    double t = length * sample / samples;
    int cx = (int)std::lround(ox + dx * t), cy = (int)std::lround(oy + dy * t);
    for (int yy = -CREATURE_BORE_RADIUS; yy <= CREATURE_BORE_RADIUS; yy++) for (int xx = -CREATURE_BORE_RADIUS; xx <= CREATURE_BORE_RADIUS; xx++) {
      if (xx * xx + yy * yy > CREATURE_BORE_RADIUS * CREATURE_BORE_RADIUS) continue;
      int x = cx + xx, y = cy + yy;
      if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows - 1) continue;
      int k = E.I(x, y); if (seen[k] == seenGen) continue;
      seen[k] = seenGen; cells.push_back(k);
      x0 = imin(x0, x); y0 = imin(y0, y); x1 = imax(x1, x); y1 = imax(y1, y);
    }
  }
  if (!cells.empty()) {
    Layer* restore = E.L;
    E.useLayer(&E.fg); E.eraseStrokeCells(cells, x0, y0, x1, y1);
    if (E.bgEnabled) { E.useLayer(&E.bg); E.eraseStrokeCells(cells, x0, y0, x1, y1); }
    E.useLayer(restore);
  }

  double awx0 = E.fg.worldOffsetX + ox, awy0 = E.fg.worldOffsetY + oy;
  double awx1 = E.fg.worldOffsetX + ex, awy1 = E.fg.worldOffsetY + ey;
  for (Player& p : E.psys.players) if (p.active && p.alive && p.id != immunePlayerId &&
      segmentHitsExpandedBox(awx0, awy0, awx1, awy1,
                             E.fg.worldOffsetX + p.px, E.fg.worldOffsetY + p.py,
                             E.fg.worldOffsetX + p.px + p.w, E.fg.worldOffsetY + p.py + p.h, CREATURE_BORE_RADIUS))
    E.psys.damagePlayer(p, damage, 36, ox, oy);
  for (Creature& other : creatures) {
    if (!other.alive || other.id == immuneCreatureId ||
        isProtectedNpc(other) || other.hurtCooldown > 0) continue;
    const CreatureSpecies& os = species(other);
    if (!segmentHitsExpandedBox(awx0, awy0, awx1, awy1,
                                other.wx, other.wy, other.wx + os.w, other.wy + os.h, CREATURE_BORE_RADIUS)) continue;
    other.health -= damage; other.hurtCooldown = 7;
    E.audio.emit(SE_CREATURE, other.wx - E.fg.worldOffsetX + os.w * 0.5,
                 other.wy - E.fg.worldOffsetY + os.h * 0.5, 0.8, other.species, 0);
  }
  E.audio.emit(SE_BORE_FIRE, ox, oy, 1.0, STONE, 0);
}

void CreatureSystem::fireBore(Creature& c) {
  const CreatureSpecies& s = species(c);
  double ox = c.wx - E.fg.worldOffsetX + s.w * 0.5;
  double oy = c.wy - E.fg.worldOffsetY + s.h * 0.42;
  double dx = c.attackAimX - (E.fg.worldOffsetX + ox);
  double dy = c.attackAimY - (E.fg.worldOffsetY + oy);
  double d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = c.facing; dy = 0; d = 1; }
  dx /= d; dy /= d;
  // Start beyond the sentinel's own hull, then extend to the loaded-window edge.
  ox += dx * (s.w * 0.5 + 0.75); oy += dy * (s.h * 0.35 + 0.75);
  fireBoreLine(ox, oy, dx, dy, s.damage, 0, c.id);
}

void CreatureSystem::fireBore(Player& p) {
  double ox = p.px + p.w * 0.5, oy = p.py + p.h * 0.42;
  double dx = p.aimX - ox, dy = p.aimY - oy;
  double d = std::hypot(dx, dy);
  if (d < 1e-6) { dx = p.facing; dy = 0; d = 1; }
  dx /= d; dy /= d;
  // Move the beam origin just outside whichever side of the player AABB the aim
  // ray exits. This keeps the component cut from starting inside the shooter.
  double exitX = std::fabs(dx) > 1e-9 ? (p.w * 0.5 + 0.75) / std::fabs(dx) : 1e9;
  double exitY = std::fabs(dy) > 1e-9 ? (p.h * 0.5 + 0.75) / std::fabs(dy) : 1e9;
  double exit = std::min(exitX, exitY);
  ox += dx * exit; oy += dy * exit;
  fireBoreLine(ox, oy, dx, dy, BORE_CANNON_DAMAGE, p.id, 0);
  // The terrain/actor cut is immediate and authoritative. Retain its latched ray
  // briefly as a render-only projectile so presentation mirrors show the same
  // thick firing flash that the sentinel's replicated firing state provides.
  E.projectiles.spawnBoreBeam(p.id, ox, oy, dx, dy);
}

void CreatureSystem::dropWeapon(const Creature& c) {
  uint8_t itemKind = (c.species == CS_DYNAMITEER ||
                      c.species == CS_QUARRY_FOREMAN) ? IK_DYNAMITE_SATCHEL
                   : c.species == CS_BORE_SENTINEL ? IK_BORE_CANNON
                   : c.species == CS_CAUSTIC_MORTARMAN ? IK_ACID_MORTAR
                   : c.species == CS_CLUSTER_WASP ? IK_CLUSTER_LAUNCHER
                   : (c.species == CS_MINIGUNNER ||
                      c.species == CS_REACTOR_WARDEN) ? IK_MINIGUN
                   : IK_MATERIAL;
  if (itemKind == IK_MATERIAL) return;
  const CreatureSpecies& s = species(c);
  InvSlot weapon; weapon.itemKind = itemKind; weapon.count = weaponPickupAmmo(itemKind);
  E.itemsys.spawnStack(weapon,
                       c.wx - E.fg.worldOffsetX + s.w * 0.5,
                       c.wy - E.fg.worldOffsetY + s.h * 0.45,
                       c.facing * 0.65, -1.0, IT_PICKUP_DELAY);
}

void CreatureSystem::killCreature(Creature& c) {
  if (!c.alive) return;
  if (isProtectedNpc(c)) {
    c.health = species(c).maxHealth;
    c.deathTicks = 0;
    return;
  }
  c.health = 0;
  E.missions.onCreatureKilled(c);
  dropWeapon(c);
  c.alive = false;
  c.deathTicks = 18;
}

void CreatureSystem::crushCreature(Creature& c) {
  killCreature(c);
}

void CreatureSystem::updateBoreSentinelAttack(Creature& c) {
  const CreatureSpecies& s = species(c);
  if (c.attackState == CAS_FIRING) {
    c.attackProgress = 1;
    if (++c.attackTicks >= BORE_FIRE_TICKS) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    // Track for most of the charge, then leave a clearly committed line for the
    // final beat so the player can escape before terrain and actors are cut.
    if (hasTarget && c.attackTicks < BORE_CHARGE_TICKS - BORE_LOCK_TICKS) {
      c.attackAimX = tx; c.attackAimY = ty;
    }
    c.facing = c.attackAimX >= c.wx + s.w * 0.5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)BORE_CHARGE_TICKS);
    if (c.attackTicks >= BORE_CHARGE_TICKS) {
      fireBore(c);
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      c.attackCooldown = s.attackCooldown;
    }
    return;
  }

  if (!hasTarget || c.attackCooldown > 0) return;
  double dx = tx - (c.wx + s.w * 0.5), dy = ty - (c.wy + s.h * 0.5);
  if (dx * dx + dy * dy > s.attackRange * s.attackRange) return;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = dx >= 0 ? 1 : -1;
  E.audio.emit(SE_BORE_CHARGE, c.wx - E.fg.worldOffsetX + s.w * 0.5,
               c.wy - E.fg.worldOffsetY + s.h * 0.42, 0.9, STONE, 0);
}

void CreatureSystem::attackTarget(Creature& c) {
  if (c.species == CS_QUARRY_FOREMAN ||
      c.species == CS_REACTOR_WARDEN) { updateBossAttack(c); return; }
  if (c.species == CS_DYNAMITEER) { updateDynamiteerAttack(c); return; }
  if (c.species == CS_BORE_SENTINEL) { updateBoreSentinelAttack(c); return; }
  if (c.species == CS_CAUSTIC_MORTARMAN) { updateCausticMortarmanAttack(c); return; }
  if (c.species == CS_CLUSTER_WASP) { updateClusterWaspAttack(c); return; }
  if (c.species == CS_MINIGUNNER) { updateMinigunnerAttack(c); return; }
  const CreatureSpecies& s = species(c); if (c.attackCooldown > 0 || s.damage <= 0) return;
  double tx, ty; Creature* prey = nullptr; Player* player = nullptr;
  if (!targetPoint(c, tx, ty, &prey, &player)) return;
  auto inMeleeRange = [&](double bx, double by, int bw, int bh) {
    double gx = std::max(0.0, std::max(bx - (c.wx + s.w), c.wx - (bx + bw)));
    double gy = std::max(0.0, std::max(by - (c.wy + s.h), c.wy - (by + bh)));
    return gx * gx + gy * gy <= s.attackRange * s.attackRange;
  };
  bool hit = false;
  if (prey) {
    const CreatureSpecies& ps = species(*prey);
    hit = inMeleeRange(prey->wx, prey->wy, ps.w, ps.h);
    if (hit && !isProtectedNpc(*prey)) prey->health -= s.damage;
  }
  if (player) {
    hit = inMeleeRange(E.fg.worldOffsetX + player->px, E.fg.worldOffsetY + player->py, player->w, player->h);
    if (hit) {
      double sourceX = c.wx - E.fg.worldOffsetX + s.w * .5;
      double sourceY = c.wy - E.fg.worldOffsetY + s.h * .5;
      E.psys.damagePlayer(*player, s.damage, 30, sourceX, sourceY);
    }
  }
  if (hit) c.attackCooldown = s.attackCooldown;
}

void CreatureSystem::updateCreatures() {
  if (!E.creaturesEnabled) return;
  maintainPopulation();
  updateSpawnTelegraphs();
  if (E.creatureNaturalSpawning) updateNaturalPopulation();
  for (Creature& c : creatures) {
    if (!c.alive) { c.deathTicks--; continue; }
    if (isProtectedNpc(c)) c.health = species(c).maxHealth;
    if (c.health <= 0) {
      killCreature(c);
      continue;
    }
    if (c.scanCooldown > 0) c.scanCooldown--; else acquireTarget(c);
    if (c.attackCooldown > 0) c.attackCooldown--;
    if (c.hurtCooldown > 0) c.hurtCooldown--;
    if (species(c).locomotion == CL_AQUATIC) {
      if (fluidCoverage(c.wx, c.wy, species(c).w, species(c).h) >= species(c).fluidThreshold) {
        c.hasHabitatGoal = false;
        c.habitatScanCooldown = 0;
        c.grounded = false;
        steerAquatic(c);
        moveAquatic(c);
      } else moveBeachedAquatic(c);
    }
    else if (species(c).locomotion == CL_FLYING) moveFlying(c);
    else if (species(c).locomotion == CL_AMPHIBIOUS) moveAmphibious(c);
    else { c.vx = 0; c.vy = 0; c.grounded = true; }
    // Terrain can settle or be placed through an entity after movement. Mere
    // floor contact is outside the AABB and harmless; sustained burial over at
    // least half the body deals one point every half-second at 60 actor Hz.
    if (((E.actorTick + c.id * 7) % 30) == 0 &&
        blockingCoverage(c.wx, c.wy, species(c).w, species(c).h) >= 0.5) c.health--;
    if (((E.actorTick + c.id * 7) % ACID_CONTACT_INTERVAL) == 0 &&
        boxTouchesMaterial(c.wx, c.wy, species(c).w, species(c).h, ACID))
      c.health -= ACID_CONTACT_DAMAGE;
    attackTarget(c);
    // Four authored poses per species. Tie pose selection to locomotion where
    // it matters so feet, wings, and body arcs describe the actual movement
    // instead of every creature sharing the same two-frame global blink.
    if (c.species == CS_DYNAMITEER || c.species == CS_QUARRY_FOREMAN) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.52 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = std::fabs(c.vx) > 0.035 ? (uint8_t)(((E.actorTick / 5) + c.id) & 1) : 0;
    } else if (c.species == CS_BORE_SENTINEL) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.50 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = std::fabs(c.vx) > 0.025 ? (uint8_t)(((E.actorTick / 7) + c.id) & 1) : 0;
    } else if (c.species == CS_CAUSTIC_MORTARMAN) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.55 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = std::fabs(c.vx) > 0.025 ? (uint8_t)(((E.actorTick / 7) + c.id) & 1) : 0;
    } else if (c.species == CS_CLUSTER_WASP) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.55 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = (uint8_t)(((E.actorTick / 3) + c.id) & 3);
    } else if (c.species == CS_MINIGUNNER ||
               c.species == CS_REACTOR_WARDEN) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.52 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = (uint8_t)(2 + ((E.actorTick / 2) & 1));
      else c.animFrame = std::fabs(c.vx) > 0.02 ? (uint8_t)(((E.actorTick / 7) + c.id) & 1) : 0;
    } else if (c.species == CS_BIRD) {
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
    if (isProtectedNpc(c)) c.health = species(c).maxHealth;
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
    if (dx * dx + dy * dy <= r2) {
      if (!isProtectedNpc(c)) {
        c.health -= damage;
        c.hurtCooldown = 7;
      }
      hit = true;
      E.audio.emit(SE_CREATURE, c.wx - E.fg.worldOffsetX + s.w * 0.5,
                   c.wy - E.fg.worldOffsetY + s.h * 0.5, 0.65, c.species, 0);
    }
  }
  return hit;
}

int CreatureSystem::buildCreatureSnapshot() {
  snapshot.assign((creatures.size() + pendingSpawns.size()) * CSN_STRIDE, 0.0f);
  for (size_t i = 0; i < creatures.size(); i++) {
    const Creature& c = creatures[i]; const CreatureSpecies& s = species(c);
    float* o = snapshot.data() + i * CSN_STRIDE;
    o[CSN_ID] = (float)c.id; o[CSN_SPECIES] = (float)c.species;
    o[CSN_X] = (float)(c.wx - E.fg.worldOffsetX); o[CSN_Y] = (float)(c.wy - E.fg.worldOffsetY);
    o[CSN_VX] = (float)c.vx; o[CSN_VY] = (float)c.vy; o[CSN_W] = (float)s.w; o[CSN_H] = (float)s.h;
    o[CSN_FACING] = (float)c.facing; o[CSN_HEALTH] = (float)c.health; o[CSN_MAX_HEALTH] = (float)s.maxHealth;
    o[CSN_ALIVE] = c.alive ? 1.0f : 0.0f; o[CSN_ANIM_FRAME] = (float)c.animFrame;
    o[CSN_ATTACK_STATE] = (float)c.attackState; o[CSN_ATTACK_PROGRESS] = (float)c.attackProgress;
    o[CSN_AIM_X] = (float)(c.attackAimX - E.fg.worldOffsetX); o[CSN_AIM_Y] = (float)(c.attackAimY - E.fg.worldOffsetY);
    o[CSN_SPAWN_PROGRESS] = (float)c.spawnProgress;
    o[CSN_ATTACK_PATTERN] = (float)c.attackPattern;
  }
  for (size_t i = 0; i < pendingSpawns.size(); i++) {
    const CreatureSpawnTelegraph& p = pendingSpawns[i];
    const CreatureSpecies& s = CREATURE_SPECIES[p.species];
    float* o = snapshot.data() + (creatures.size() + i) * CSN_STRIDE;
    o[CSN_ID] = (float)p.id; o[CSN_SPECIES] = (float)p.species;
    o[CSN_X] = (float)(p.wx - E.fg.worldOffsetX);
    o[CSN_Y] = (float)(p.wy - E.fg.worldOffsetY);
    o[CSN_W] = (float)s.w; o[CSN_H] = (float)s.h;
    o[CSN_FACING] = 1.0f; o[CSN_MAX_HEALTH] = (float)s.maxHealth;
    // Keep zero reserved for ordinary materialized actors. The first warning
    // frame is therefore already distinguishable on mirrors and the wire.
    int elapsed = p.totalTicks - p.ticksRemaining;
    o[CSN_SPAWN_PROGRESS] = (float)std::max(1.0 / p.totalTicks,
      std::min(1.0, (elapsed + 1.0) / p.totalTicks));
  }
  return (int)(creatures.size() + pendingSpawns.size());
}
