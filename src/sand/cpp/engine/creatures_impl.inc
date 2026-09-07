bool CreatureSystem::isProtectedNpc(const Creature& c) const {
  if (c.npcId) return true;
  const CreatureSpecies& definition = species(c);
  return c.shelterCharge > 0 || definition.protection == CPROT_ALWAYS
    || (definition.protection == CPROT_PROTECTED_CREW
        && planetHasGameplayFlag(E.planetId, PGF_PROTECTED_CREW));
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
    if (E.isBlockingForActor(E.fg.grid[E.I(x, y)])) return true;
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
    else if (x >= 0 && x < E.cols && y >= 0 && E.isBlockingForActor(E.fg.grid[E.I(x, y)])) blocked++;
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
      if (MAT_AQUATIC_HABITAT[m]) wet++;
    }
  }
  return total ? (double)wet / total : 0;
}

uint8_t CreatureSystem::contactHazardAtBox(
    double wx, double wy, int w, int h, int cadencePhase) const {
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX);
  int x1 = (int)std::floor(wx - E.fg.worldOffsetX + w - 1e-6);
  int y0 = (int)std::floor(wy - E.fg.worldOffsetY);
  int y1 = (int)std::floor(wy - E.fg.worldOffsetY + h - 1e-6);
  uint8_t selected = CHP_NONE;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
    uint8_t profile = MAT_CONTACT_HAZARD_PROFILE[E.fg.grid[E.I(x, y)]];
    uint8_t cadence = CONTACT_HAZARD_CADENCE[profile];
    if (CONTACT_HAZARD_CREATURE_DAMAGE[profile] == 0 || cadence == 0
        || cadencePhase % cadence != 0) continue;
    if (CONTACT_HAZARD_PRIORITY[profile] > CONTACT_HAZARD_PRIORITY[selected])
      selected = profile;
  }
  return selected;
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
  if (boxTouchesLiquid(wx, wy, s.w, s.h)) return false;
  int footY = (int)std::floor(wy - E.fg.worldOffsetY + s.h + 0.05);
  int x0 = (int)std::floor(wx - E.fg.worldOffsetX), x1 = (int)std::floor(wx - E.fg.worldOffsetX + s.w - 1e-6);
  bool floor = false;
  for (int x = x0; x <= x1; x++) if (x >= 0 && x < E.cols && footY >= 0 && footY < E.rows && E.isBlockingForActor(E.fg.grid[E.I(x, footY)])) { floor = true; break; }
  if (!floor) return false;
  if (s.spawn.habitat == CH_CAVE && E.fg.infinite) {
    int centerX = (int)std::floor(wx + s.w * 0.5);
    if (wy < E.terrain.genSurfaceAbs(centerX) + 10) return false;
  }
  return true;
}

WorldContext CreatureSystem::spawnWorldContext(double wx, double wy) const {
  Engine::ActiveLayerScope layerScope(E, &E.fg);
  WorldContext context = E.worldContext.at(
    (int)std::floor(wx), (int)std::floor(wy));
  return context;
}

bool CreatureSystem::worldRuleAllows(
    const CreatureWorldRule& rule, const WorldContext& context) const {
  if ((context.tags & rule.requiredTags) != rule.requiredTags
      || (context.tags & rule.excludedTags) != 0
      || context.depth < rule.minDepth || context.depth > rule.maxDepth)
    return false;
  uint32_t surfaceBit = context.surfaceBiome >= 0
      && context.surfaceBiome < SURFACE_BIOME_COUNT
    ? 1u << context.surfaceBiome : 0;
  uint32_t caveBit = context.caveBiome >= 0
      && context.caveBiome < CAVE_BIOME_COUNT
    ? 1u << context.caveBiome : 0;
  bool biomeAllowed = (context.tags & WA_UNDERGROUND)
    ? (rule.allowedCaveBiomes & caveBit) != 0
    : (rule.allowedSurfaceBiomes & surfaceBit) != 0;
  return biomeAllowed;
}

bool CreatureSystem::worldRuleAllows(
    uint8_t speciesId, double wx, double wy) const {
  if (speciesId >= CS_THORNBOUND_HART && E.planetId != PL_FRONTIER) return false;
  if (E.planetId == PL_FRONTIER && speciesId < CS_COUNT
      && CREATURE_SPECIES[speciesId].hostile
      && wx >= E.content.repairBounds[0] - 64 && wx <= E.content.repairBounds[2] + 64
      && wy >= E.content.repairBounds[1] - 48 && wy <= E.content.repairBounds[3] + 32)
    return false;
  return speciesId < CS_COUNT
    && worldRuleAllows(
      CREATURE_SPECIES[speciesId].world, spawnWorldContext(wx, wy));
}

int CreatureSystem::worldSpawnWeight(
    uint8_t speciesId, const WorldContext& context) const {
  if (speciesId >= CS_COUNT || (speciesId >= CS_THORNBOUND_HART && E.planetId != PL_FRONTIER)) return 0;
  const CreatureWorldRule& rule = CREATURE_SPECIES[speciesId].world;
  if (!worldRuleAllows(rule, context)) return 0;
  int weight = rule.baseWeight;
  if (rule.preferredTags && (context.tags & rule.preferredTags))
    weight += rule.preferredBonus;
  uint32_t surfaceBit = context.surfaceBiome >= 0
      && context.surfaceBiome < SURFACE_BIOME_COUNT
    ? 1u << context.surfaceBiome : 0;
  uint32_t caveBit = context.caveBiome >= 0
      && context.caveBiome < CAVE_BIOME_COUNT
    ? 1u << context.caveBiome : 0;
  if ((context.tags & WA_UNDERGROUND)
      ? (rule.preferredCaveBiomes & caveBit) != 0
      : (rule.preferredSurfaceBiomes & surfaceBit) != 0)
    weight += rule.preferredBonus;
  return weight;
}

int CreatureSystem::worldSpawnWeight(
    uint8_t speciesId, double wx, double wy) const {
  return speciesId < CS_COUNT
    ? worldSpawnWeight(speciesId, spawnWorldContext(wx, wy)) : 0;
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
    if (!c.alive || !species(c).countsTowardNaturalCap) continue;
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
    bool sideEntry =
      requireOffscreen && isEncounterSpecies(speciesId) && attempt < 48;
    double angle = whash2(seed ^ 0x11u, attempt, (int)salt) * 6.283185307179586;
    double ux = sideEntry
      ? (whash2(seed ^ 0x51DEu, (int)salt, attempt) < 0.5 ? -1.0 : 1.0)
      : std::cos(angle);
    double uy = sideEntry ? 0.0 : std::sin(angle);
    double minDist = r.minPlayerDistance;
    if (E.missions.missionId == MI_GREENFALL_RECOVERY && E.missions.active())
      minDist = std::max(48.0, minDist);
    double maxDist = E.missions.missionId == MI_GREENFALL_RECOVERY && E.missions.active()
      ? std::max(minDist + 24, (double)r.maxPlayerDistance) : r.maxPlayerDistance;
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
    if (!worldRuleAllows(
          speciesId, wx + s.w * 0.5, wy + s.h * 0.5)) continue;
    // Surface/cave/air habitat snapping can substantially change Y after the
    // radial candidate was chosen. Recheck the actual final pose so enemies do
    // not materialize on top of a player despite their spawn safety radius.
    if (!farEnoughFromPlayers(wx + s.w * 0.5, wy + s.h * 0.5, (int)minDist)) continue;
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
  return speciesId < CS_COUNT ? CREATURE_SPECIES[speciesId].encounterCost : 0;
}

bool CreatureSystem::hasRecordCapacity() const {
  return creatures.size() + pendingSpawns.size()
    < (size_t)CREATURE_MAX_RECORDS;
}

int CreatureSystem::addCreature(uint8_t speciesId, double wx, double wy, int id) {
  if (speciesId >= CS_COUNT || !hasRecordCapacity()) return 0;
  Creature c; c.id = id; c.species = speciesId; c.wx = wx; c.wy = wy;
  c.health = CREATURE_SPECIES[speciesId].maxHealth;
  c.facing = whash1(E.fg.worldSeed ^ 0xC4EA7u, c.id) < 0.5 ? -1 : 1;
  if (creatureBehavior(CREATURE_SPECIES[speciesId]).initializeAttackPattern)
    c.attackPattern = (uint8_t)(id % 3);
  creatures.push_back(c);
  return c.id;
}

bool CreatureSystem::queueSpawnTelegraph(uint8_t speciesId, double wx, double wy,
                                         uint32_t salt) {
  if (speciesId >= CS_COUNT || !hasRecordCapacity()) return false;
  const CreatureSpawnRule& r = CREATURE_SPECIES[speciesId].spawn;
  int active = (int)pendingSpawns.size(), activeOfSpecies = 0;
  for (const CreatureSpawnTelegraph& p : pendingSpawns)
    if (p.species == speciesId) activeOfSpecies++;
  for (const Creature& c : creatures) if (c.alive) {
    if (species(c).countsTowardNaturalCap) active++;
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
  if (E.missions.missionId == MI_GREENFALL_RECOVERY && E.missions.active()) {
    const CreatureSpecies& s = CREATURE_SPECIES[speciesId];
    if (!farEnoughFromPlayers(wx + s.w * .5, wy + s.h * .5, 48)) return false;
    double dx = wx + s.w * .5 - E.missions.extractionX;
    double dy = wy + s.h * .5 - E.missions.extractionY;
    if (dx * dx + dy * dy < 32 * 32) return false;
    duration = imax(duration, 120);
  }
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

bool CreatureSystem::safeGroundSpawnAt(uint8_t species, int localX,
                                       int localY, const Creature* ignore) const {
  static constexpr int HAZARD_MARGIN = 4;
  const CreatureSpecies& policy = CREATURE_SPECIES[species];
  int x0 = localX, x1 = localX + policy.w - 1;
  int y0 = localY, y1 = localY + policy.h - 1;
  if (x0 - HAZARD_MARGIN < 1 || x1 + HAZARD_MARGIN >= E.cols - 1 ||
      y0 - HAZARD_MARGIN < 1 || y1 + HAZARD_MARGIN + 1 >= E.rows - 1)
    return false;
  auto dangerous = [&](uint8_t material) {
    return E.isSpawnHazard(material);
  };
  for (int y = y0 - HAZARD_MARGIN; y <= y1 + HAZARD_MARGIN; y++)
    for (int x = x0 - HAZARD_MARGIN; x <= x1 + HAZARD_MARGIN; x++)
      if (dangerous(E.fg.grid[E.I(x, y)])) return false;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    uint8_t material = E.fg.grid[E.I(x, y)];
    if (E.isBlockingForActor(material) || E.isLiquidMaterial(material))
      return false;
  }
  int support = 0;
  for (int x = x0; x <= x1; x++) {
    int k = E.I(x, y1 + 1);
    uint8_t material = E.fg.grid[k];
    if (E.isBlockingForActor(material) && !dangerous(material) &&
        E.fg.bodyOwner[k] < 0 && E.fg.groundedCell[k])
      support++;
  }
  if (support < imax(2, (policy.w + 1) / 2)) return false;

  double worldX = E.fg.worldOffsetX + localX;
  double worldY = E.fg.worldOffsetY + localY;
  for (const Creature& creature : E.creatures.creatures) {
    if (!creature.alive || &creature == ignore) continue;
    const CreatureSpecies& other = E.creatures.species(creature);
    if (worldX < creature.wx + other.w && worldX + policy.w > creature.wx &&
        worldY < creature.wy + other.h && worldY + policy.h > creature.wy)
      return false;
  }
  for (const Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    if (localX < player.px + player.w && localX + policy.w > player.px &&
        localY < player.py + player.h && localY + policy.h > player.py)
      return false;
  }
  return true;
}

bool CreatureSystem::findGroundSpawn(uint8_t species, double worldX,
                                         double worldY, double& spawnWorldX,
                                         double& spawnWorldY, int rangeX, int rangeY, const Creature* ignore) const {
  Engine::ActiveLayerScope active(E, &E.fg);
  E.comps.ensureGroundedSingleLayer();
  int baseX = (int)std::lround(worldX - E.fg.worldOffsetX);
  int baseY = (int)std::lround(worldY - E.fg.worldOffsetY);
  int bestDistance2 = INT_MAX, bestX = 0, bestY = 0;
  auto consider = [&](int x, int y) {
    int dx = x - baseX, dy = y - baseY;
    int distance2 = dx * dx + dy * dy;
    if (distance2 >= bestDistance2 || !safeGroundSpawnAt(species, x, y, ignore))
      return;
    bestDistance2 = distance2;
    bestX = x;
    bestY = y;
  };
  const int NEAR_X = rangeX, NEAR_Y = rangeY;
  for (int ax = 0; ax <= NEAR_X; ax++) {
    for (int xs = 0; xs < (ax == 0 ? 1 : 2); xs++) {
      int x = baseX + (ax == 0 ? 0 : (xs == 0 ? -ax : ax));
      for (int ay = 0; ay <= NEAR_Y; ay++) {
        int distance2 = ax * ax + ay * ay;
        if (distance2 >= bestDistance2) continue;
        for (int ys = 0; ys < (ay == 0 ? 1 : 2); ys++)
          consider(x, baseY + (ay == 0 ? 0 : (ys == 0 ? -ay : ay)));
      }
    }
  }
  if (bestDistance2 == INT_MAX) return false;
  spawnWorldX = E.fg.worldOffsetX + bestX;
  spawnWorldY = E.fg.worldOffsetY + bestY;
  return true;
}

int CreatureSystem::spawnCreature(uint8_t speciesId, double wx, double wy, bool requireHabitat) {
  if (speciesId >= CS_COUNT || !hasRecordCapacity()
      || (requireHabitat && !boxFitsHabitat(speciesId, wx, wy))) return 0;
  return addCreature(speciesId, wx, wy, nextCreatureId++);
}

// Population policy belongs only to natural spawning. Eggs and future scripted,
// summoned, or quest spawns call spawnCreature directly; they still contribute
// to these counts, so a high manual population pauses further natural births.
int CreatureSystem::spawnCreatureNatural(uint8_t speciesId, double wx, double wy) {
  if (speciesId >= CS_COUNT || !boxFitsHabitat(speciesId, wx, wy)) return 0;
  const CreatureSpecies& definition = CREATURE_SPECIES[speciesId];
  if (!worldRuleAllows(
        speciesId, wx + definition.w * 0.5, wy + definition.h * 0.5)) return 0;
  const CreatureSpawnRule& r = CREATURE_SPECIES[speciesId].spawn;
  int active = (int)pendingSpawns.size(), activeOfSpecies = 0, ambient = 0;
  for (const CreatureSpawnTelegraph& p : pendingSpawns)
    if (p.species == speciesId) activeOfSpecies++;
  for (const Creature& c : creatures) if (c.alive) {
    if (CREATURE_SPECIES[c.species].countsTowardNaturalCap) active++;
    if (isAmbientSpecies(c.species)) ambient++;
    if (c.species == speciesId) activeOfSpecies++;
  }
  if (active >= NATURAL_MOB_CAP
      || (isAmbientSpecies(speciesId) && ambient >= AMBIENT_MOB_CAP)
      || activeOfSpecies >= r.maxActive ||
      localDensity(speciesId, wx, wy, r.densityRadius) >= r.densityCap ||
      localDensityAll(wx, wy, MIXED_DENSITY_RADIUS) >= MIXED_DENSITY_CAP) return 0;
  return spawnCreature(speciesId, wx, wy, false);
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
      if (inLoadedWindow(bucket[i]) && hasRecordCapacity())
        creatures.push_back(bucket[i]);
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
    if (E.missions.missionId == MI_GREENFALL_RECOVERY && E.missions.active()) {
      const CreatureSpecies& s = CREATURE_SPECIES[ready.species];
      if (!boxFitsHabitat(ready.species, ready.wx, ready.wy) ||
          !farEnoughFromPlayers(ready.wx + s.w * .5, ready.wy + s.h * .5, 36)) {
        E.missions.extractionThreatWave = imax(0, E.missions.extractionThreatWave - 1);
        E.missions.nextThreatActorTick = E.actorTick + 120;
        continue;
      }
    }
    int id = addCreature(ready.species, ready.wx, ready.wy, ready.id);
    if (id && E.missions.missionId == MI_GREENFALL_RECOVERY && E.missions.active())
      creatures.back().attackCooldown = 90;
  }
}

void CreatureSystem::updateVillageResidents() {
  if (!planetHasGameplayFlag(E.planetId, PGF_VILLAGE_RESIDENTS)
      || E.actorTick % ENCOUNTER_CADENCE_TICKS != 0)
    return;
  int residents = 0;
  for (const Creature& c : creatures)
    if (c.alive && c.species == CS_VILLAGER) residents++;
  if (residents >= VILLAGE_RESIDENT_CAP) return;

  Engine::ActiveLayerScope layerScope(E, &E.fg);
  auto floorDiv = [](int value, int divisor) {
    int q = value / divisor, r = value % divisor;
    if (r < 0) q--;
    return q;
  };
  int lattice = WorldContextSystem::VILLAGE_LATTICE;
  int q0 = floorDiv(E.fg.worldOffsetX - 300, lattice);
  int q1 = floorDiv(E.fg.worldOffsetX + E.cols + 300, lattice);
  const CreatureSpecies& villager = CREATURE_SPECIES[CS_VILLAGER];

  auto placeResident = [&](uint64_t siteKey, const int* candidates,
                           int candidateCount, bool indoors) {
    if (residents >= VILLAGE_RESIDENT_CAP
        || spawnedVillageResidentSites.count(siteKey)) return;
    for (int i = 0; i < candidateCount; i += 2) {
      double wx = candidates[i] - villager.w * .5;
      double wy = candidates[i + 1] - villager.h;
      if (!boxInsideLoadedWindow(wx, wy, villager.w, villager.h, 2)
          || !boxFitsHabitat(CS_VILLAGER, wx, wy)) continue;
      WorldContext context = E.worldContext.at(
        (int)std::floor(wx + villager.w * .5),
        (int)std::floor(wy + villager.h * .5));
      if ((context.tags & WA_SETTLEMENT) == 0
          || ((context.tags & WA_INDOOR) != 0) != indoors) continue;
      if (!addCreature(CS_VILLAGER, wx, wy, nextCreatureId)) return;
      nextCreatureId++;
      spawnedVillageResidentSites.insert(siteKey);
      residents++;
      return;
    }
  };

  for (int q = q0; q <= q1 && residents < VILLAGE_RESIDENT_CAP; q++) {
    VillagePlan village;
    if (!E.worldContext.villagePlan(q, village)
        || village.right < E.fg.worldOffsetX
        || village.left >= E.fg.worldOffsetX + E.cols) continue;

    int outdoorCandidates[16] = {};
    int outdoorCount = 0;
    int span = imax(1, village.right - village.left - 16);
    int start = 8 + (int)(whash1(
      E.fg.worldSeed ^ 0x711A6E51u, q) * span);
    for (int attempt = 0; attempt < 8; attempt++) {
      int x = village.left + 8 + (start + attempt * 37) % span;
      int surface = E.terrain.genSurfaceAbs(x);
      outdoorCandidates[outdoorCount++] = x;
      outdoorCandidates[outdoorCount++] = surface;
    }
    placeResident((uint64_t)village.id << 1,
                  outdoorCandidates, outdoorCount, false);

    for (int ordinal = 0;
         ordinal < village.buildingCount && residents < VILLAGE_RESIDENT_CAP;
         ordinal++) {
      VillageBuildingPlan building;
      if (!E.worldContext.villageBuildingPlan(village, ordinal, building))
        continue;
      int quarter = imax(5, building.width / 4);
      int indoorCandidates[] = {
        building.center, building.floorY,
        building.center - quarter, building.floorY,
        building.center + quarter, building.floorY,
        building.left + 6, building.floorY,
        building.left + building.width - 6, building.floorY,
      };
      placeResident(((uint64_t)building.id << 1) | 1u,
                    indoorCandidates,
                    (int)(sizeof(indoorCandidates) / sizeof(int)), true);
    }
  }
}

void CreatureSystem::updateNaturalPopulation() {
  if (!E.survivalInventory) return;
  updateVillageResidents();

  double focusX = E.fg.worldOffsetX + E.cam.camX
    + (E.cam.viewportCols > 0 ? E.cam.viewportCols : E.cols * .5) * .5;
  double focusY = E.fg.worldOffsetY + E.cam.camY
    + (E.cam.viewportRows > 0 ? E.cam.viewportRows : E.rows * .5) * .5;
  for (const Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    focusX = E.fg.worldOffsetX + player.px + player.w * .5;
    focusY = E.fg.worldOffsetY + player.py + player.h * .5;
    break;
  }
  WorldContext focusContext = spawnWorldContext(focusX, focusY);
  uint32_t salt = (uint32_t)E.actorTick ^
    ((uint32_t)E.fg.worldOffsetX * 2246822519u) ^
    ((uint32_t)E.fg.worldOffsetY * 3266489917u);

  // Wildlife enters quietly and has a small reserved share of the natural
  // population. Habitats still decide whether the weighted biome pick can
  // actually materialize near the player.
  if (E.actorTick >= ambientNextTick) {
    ambientNextTick = E.actorTick + AMBIENT_CADENCE_TICKS;
    std::array<int, AMBIENT_CREATURE_SPECIES.size()> weights{};
    int totalWeight = 0;
    for (size_t i = 0; i < AMBIENT_CREATURE_SPECIES.size(); i++) {
      weights[i] = worldSpawnWeight(AMBIENT_CREATURE_SPECIES[i], focusContext);
      totalWeight += weights[i];
    }
    if (totalWeight > 0) {
      int pick = imin(totalWeight - 1, (int)(
        whash2(E.fg.worldSeed ^ 0xC4EA7350u,
               E.actorTick / AMBIENT_CADENCE_TICKS,
               (int)focusContext.featureId) * totalWeight));
      int start = 0;
      while (start + 1 < (int)AMBIENT_CREATURE_SPECIES.size()
             && pick >= weights[(size_t)start]) {
        pick -= weights[start];
        start++;
      }
      for (int offset = 0; offset < (int)AMBIENT_CREATURE_SPECIES.size(); offset++) {
        int index = (start + offset) % (int)AMBIENT_CREATURE_SPECIES.size();
        if (weights[index] <= 0) continue;
        uint8_t sid = AMBIENT_CREATURE_SPECIES[(size_t)index];
        double wx = 0, wy = 0;
        if (!findSpawnNearFocus(
              sid, salt ^ ((uint32_t)sid * 9151u), true, wx, wy)) continue;
        if (spawnCreatureNatural(sid, wx, wy)) break;
      }
    }
  }

  // The survival director creates at most one combat encounter per cadence.
  // Threat accrues on the deterministic actor clock and expensive enemies
  // consume more of it.
  if (E.actorTick % ENCOUNTER_THREAT_GAIN_TICKS == 0)
    encounterThreat = imin(ENCOUNTER_THREAT_MAX, encounterThreat + 1);
  if (E.actorTick < encounterNextTick) return;
  encounterNextTick = E.actorTick + ENCOUNTER_CADENCE_TICKS;

  int totalWeight = 0;
  std::array<int, ENCOUNTER_CREATURE_SPECIES.size()> weights{};
  for (size_t i = 0; i < ENCOUNTER_CREATURE_SPECIES.size(); i++) {
    weights[i] = worldSpawnWeight(ENCOUNTER_CREATURE_SPECIES[i], focusContext);
    totalWeight += weights[i];
  }
  if (totalWeight <= 0) return;
  int pick = imin(totalWeight - 1, (int)(
    whash2(E.fg.worldSeed ^ 0xC4EA7300u,
           E.actorTick / ENCOUNTER_CADENCE_TICKS,
           encounterThreat) * totalWeight));
  int start = 0;
  while (start + 1 < (int)ENCOUNTER_CREATURE_SPECIES.size()
         && pick >= weights[(size_t)start]) {
    pick -= weights[start];
    start++;
  }
  for (int offset = 0; offset < (int)ENCOUNTER_CREATURE_SPECIES.size(); offset++) {
    int index = (start + offset) % (int)ENCOUNTER_CREATURE_SPECIES.size();
    if (weights[index] <= 0) continue;
    uint8_t sid = ENCOUNTER_CREATURE_SPECIES[(size_t)index];
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

void CreatureSystem::applySpatialForce(Creature& c) {
  const CreatureSpecies& s = species(c);
  double forceX, forceY;
  double x = c.wx - E.fg.worldOffsetX + s.w * 0.5;
  double y = c.wy - E.fg.worldOffsetY + s.h * 0.5;
  if (!E.forces.sampleActor(x, y, forceX, forceY)) return;
  static constexpr double MAX_FORCE_SPEED = 3.0;
  c.vx = std::max(-MAX_FORCE_SPEED,
                  std::min(MAX_FORCE_SPEED, c.vx + forceX));
  c.vy = std::max(-MAX_FORCE_SPEED,
                  std::min(MAX_FORCE_SPEED, c.vy + forceY));
}

static double accelerateToward(double current, double target, double acceleration) {
  return current + std::max(-acceleration,
                            std::min(acceleration, target - current));
}

template <typename Blocked>
static bool moveCreatureAxis(Creature& c, double& position, double delta,
                             bool xAxis, Blocked&& blocked) {
  double moved = 0;
  double magnitude = std::fabs(delta);
  double direction = delta >= 0 ? 1.0 : -1.0;
  while (moved < magnitude - 1e-6) {
    double step = std::min(0.25, magnitude - moved);
    double nextX = c.wx, nextY = c.wy;
    if (xAxis) nextX = position + direction * step;
    else nextY = position + direction * step;
    if (blocked(nextX, nextY)) return false;
    position += direction * step;
    moved += step;
  }
  return true;
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
  c.vx = accelerateToward(c.vx, desiredX, s.accel);
  c.vy = accelerateToward(c.vy, desiredY, s.accel);
  if (std::fabs(c.vx) > 0.02) c.facing = c.vx > 0 ? 1 : -1;
}

void CreatureSystem::moveAquatic(Creature& c) {
  const CreatureSpecies& s = species(c);
  applySpatialForce(c);
  auto blocked = [&](double nextX, double nextY) {
    // Aquatic locomotion treats the water boundary as collision: a fish never
    // voluntarily leaves its supported material, even for a target.
    return boxHitsSolid(nextX, nextY, s.w, s.h)
      || fluidCoverage(nextX, nextY, s.w, s.h) < s.fluidThreshold;
  };
  if (!moveCreatureAxis(c, c.wx, c.vx, true, blocked)) c.vx *= -0.45;
  if (!moveCreatureAxis(c, c.wy, c.vy, false, blocked)) c.vy *= -0.45;
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
  c.vx = accelerateToward(c.vx, desiredX, 0.025);
  c.vy = std::min(2.4, c.vy + E.scaledGravity(0.075));
  c.vx *= c.grounded ? 0.90 : 0.995;
  int flopPeriod = 32 + (c.id % 17);
  if (c.grounded && ((E.actorTick + c.id * 11) % flopPeriod) == 0) {
    double kick = 0.20 + whash1(E.fg.worldSeed ^ 0xF10F00u, c.id + E.actorTick) * 0.18;
    c.facing = c.hasHabitatGoal ? (c.habitatX > c.wx + s.w * 0.5 ? 1 : -1) : c.wanderDir;
    c.vx = c.facing * kick;
    c.vy = -0.58 - whash1(E.fg.worldSeed ^ 0xF10F22u, c.id + E.actorTick) * 0.28;
  }
  applySpatialForce(c);
  auto blocked = [&](double nextX, double nextY) {
    return boxHitsSolid(nextX, nextY, s.w, s.h);
  };
  if (!moveCreatureAxis(c, c.wx, c.vx, true, blocked)) c.vx *= -0.25;
  if (!moveCreatureAxis(c, c.wy, c.vy, false, blocked)) c.vy = 0;
  c.grounded = boxHitsSolid(c.wx, c.wy + 0.12, s.w, s.h);
}

void CreatureSystem::moveAmphibious(Creature& c) {
  CreatureSpecies s = species(c);
  if (c.roamRadius) {
    s.walkSpeed = .10; s.swimSpeed = .18; s.accel = .025;
    s.gravity = .065; s.jumpSpeed = .7; s.fluidThreshold = .35;
  }
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
    c.vx = accelerateToward(c.vx, dx / d * s.swimSpeed, s.accel);
    c.vy = accelerateToward(c.vy, dy / d * s.swimSpeed, s.accel);
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
    const CreatureBehaviorProfileDef& behavior = creatureBehavior(s);
    bool rangedEnemy = behavior.farRange > 0;
    if (hasTarget && rangedEnemy) {
      double dx = tx - (c.wx + s.w * 0.5), distance = std::fabs(dx);
      if (c.attackState != CAS_IDLE) wish = 0;
      else if (distance > behavior.farRange) wish = dx > 0 ? s.walkSpeed : -s.walkSpeed;
      else if (distance < behavior.nearRange) wish = dx > 0 ? -s.walkSpeed : s.walkSpeed;
      else wish = 0;
    } else {
      wish = hasTarget ? (tx > c.wx + s.w * 0.5 ? s.walkSpeed : -s.walkSpeed)
                       : avoidsPlayer ? (avoidX > c.wx + s.w * 0.5 ? -s.walkSpeed : s.walkSpeed)
                       : c.wanderDir * s.walkSpeed * 0.62;
    }
    if (c.roamRadius) {
      // Residents pause near visitors and turn before an unsupported edge.
      if (c.wx < c.homeX - c.roamRadius) c.wanderDir = 1;
      if (c.wx > c.homeX + c.roamRadius) c.wanderDir = -1;
      bool visitor = false;
      for (const Player& p : E.psys.players) {
        if (!p.active || !p.alive) continue;
        double dx = E.fg.worldOffsetX + p.px - c.wx, dy = E.fg.worldOffsetY + p.py - c.wy;
        if (dx * dx + dy * dy < 24 * 24) { visitor = true; c.facing = dx > 0 ? 1 : -1; }
      }
      double ahead = c.wx + c.wanderDir * 3;
      if (c.grounded && !boxHitsSolid(ahead, c.wy + 1, s.w, s.h)) {
        c.wanderDir = -c.wanderDir; c.wanderTicks = 90;
      }
      wish = visitor || c.wanderTicks < 45 ? 0 : c.wanderDir * s.walkSpeed;
    }
    // Released researchers wait for extraction instead of fleeing their rescuer.
    if (c.missionActor && c.species == CS_SURVEYOR &&
        E.missions.missionId == MI_GREENFALL_RECOVERY) wish = 0;
    c.vx = accelerateToward(c.vx, wish, s.accel);
    if (s.hopPeriod > 0 && c.grounded && ((E.actorTick + c.id * 7) % s.hopPeriod) == 0) c.vy = -s.jumpSpeed;
    c.vy += E.scaledGravity(s.gravity); if (c.vy > 2.4) c.vy = 2.4;
  }
  applySpatialForce(c);
  if (std::fabs(c.vx) > 0.02) c.facing = c.vx > 0 ? 1 : -1;
  auto blocked = [&](double nextX, double nextY) {
    return boxHitsSolid(nextX, nextY, s.w, s.h);
  };
  double startX = c.wx, startY = c.wy;
  if (!moveCreatureAxis(c, c.wx, c.vx, true, blocked)) {
    // Wide walkers meet a rising bank with their front edge before their feet
    // are dry. Step over a one-cell lip; for a taller bank, kick upward while
    // still swimming so the next tick approaches above the blocking cell.
    double blockedX = c.wx;
    bool climbed = false;
    if (c.hasHabitatGoal || wet < s.fluidThreshold) for (double lift = 0.25; lift <= 1.25; lift += 0.25) {
      c.wx = startX; c.wy = startY - lift;
      if (boxHitsSolid(c.wx, c.wy, s.w, s.h)) break;
      if (moveCreatureAxis(c, c.wx, c.vx, true, blocked)) { climbed = true; break; }
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
  if (!moveCreatureAxis(c, c.wy, c.vy, false, blocked)) c.vy = 0;
  c.grounded = boxHitsSolid(c.wx, c.wy + 0.12, s.w, s.h);
}

void CreatureSystem::moveFlying(Creature& c) {
  const CreatureSpecies& s = species(c);
  const bool submerged = fluidCoverage(c.wx, c.wy, s.w, s.h) > 0;
  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  double phase = (E.actorTick + c.id * 43) * 0.025;
  double desiredX, desiredY;
  if (hasTarget && creatureBehavior(s).flyingMovement == CFM_CLUSTER) {
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
  c.vx = accelerateToward(c.vx, desiredX, s.accel);
  c.vy = accelerateToward(c.vy, desiredY, s.accel);
  applySpatialForce(c);
  if (std::fabs(c.vx) > 0.02) c.facing = c.vx > 0 ? 1 : -1;
  auto blocked = [&](double nextX, double nextY) {
    // Water is an entry barrier for a flying bird, but not an exit barrier.
    // If water engulfs one, let it climb through the fluid until clear.
    return boxHitsSolid(nextX, nextY, s.w, s.h)
      || (!submerged && boxTouchesLiquid(nextX, nextY, s.w, s.h));
  };
  if (!moveCreatureAxis(c, c.wx, c.vx, true, blocked)) c.vx *= -0.55;
  if (!moveCreatureAxis(c, c.wy, c.vy, false, blocked)) c.vy *= -0.55;
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

void CreatureSystem::updateChargedProjectileAttack(
    Creature& c, CreatureAttackHandler attack, int chargeTicks, int firingTicks) {
  const CreatureSpecies& s = species(c);
  if (c.attackState == CAS_FIRING) {
    c.attackProgress = std::max(0.0, 1.0 - c.attackTicks / (double)firingTicks);
    if (++c.attackTicks >= firingTicks) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
    }
    return;
  }

  double tx = 0, ty = 0;
  bool hasTarget = targetPoint(c, tx, ty, nullptr, nullptr);
  if (c.attackState == CAS_CHARGING) {
    // Keep tracking throughout the wind-up. If the target vanishes, fire at its
    // last observed position instead of cancelling the committed attack.
    if (hasTarget) { c.attackAimX = tx; c.attackAimY = ty; }
    if (attack != CAH_DYNAMITEER || c.attackAimX != 0 || c.attackAimY != 0)
      c.facing = c.attackAimX >= c.wx + s.w * 0.5 ? 1 : -1;
    c.attackTicks++;
    c.attackProgress = std::min(1.0, c.attackTicks / (double)chargeTicks);
    if (c.attackTicks >= chargeTicks) {
      double targetX = c.attackAimX - E.fg.worldOffsetX;
      double targetY = c.attackAimY - E.fg.worldOffsetY;
      switch (attack) {
        case CAH_DYNAMITEER:
          E.projectiles.spawnDynamite(c, targetX, targetY);
          break;
        case CAH_CAUSTIC_MORTARMAN:
          E.projectiles.spawnAcidShell(c, targetX, targetY);
          break;
        case CAH_CLUSTER_WASP:
          E.projectiles.spawnClusterBomb(c, targetX, targetY);
          break;
        default:
          __builtin_trap();
      }
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
  bool relayGuard = c.missionActor && E.missions.missionId == MI_GREENFALL_RECOVERY;
  int chargeTicks = relayGuard ? 60 : MINIGUNNER_CHARGE_TICKS;
  int burstTicks = relayGuard ? 48 : MINIGUNNER_BURST_TICKS;
  if (c.attackState == CAS_FIRING) {
    // The burst commits to its charged line, allowing a block or sidestep.
    c.facing = c.attackAimX >= c.wx + s.w * .5 ? 1 : -1;
    if ((c.attackTicks % MINIGUNNER_SHOT_INTERVAL) == 0) {
      E.projectiles.spawnMinigunRound(c,
        c.attackAimX - E.fg.worldOffsetX,
        c.attackAimY - E.fg.worldOffsetY);
    }
    c.attackTicks++;
    c.attackProgress = std::max(0.0,
      1.0 - c.attackTicks / (double)burstTicks);
    if (c.attackTicks >= burstTicks) {
      if (relayGuard) c.attackCooldown = 120;
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
    c.attackProgress = std::min(1.0, c.attackTicks / (double)chargeTicks);
    if (c.attackTicks >= chargeTicks) {
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
  bool warden = creatureBehavior(s).telegraph == CTH_WARDEN;
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
      Engine::ActiveLayerScope active(E, &E.fg);
      E.explosives.detonate((int)std::lround(localX), (int)std::lround(localY + s.h * .42),
                 13, 15.0, 0, DEBRIS,
                 (uint32_t)(E.actorTick ^ (c.id * 0x9e3779b9u)));
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
  int32_t seenGen = E.fg.nextSeenGeneration();
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
    { Engine::ActiveLayerScope active(E, &E.fg); E.tools.eraseStrokeCells(cells, x0, y0, x1, y1); }
    if (E.bgEnabled) {
      Engine::ActiveLayerScope active(E, &E.bg);
      E.tools.eraseStrokeCells(cells, x0, y0, x1, y1);
    }
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
  if (E.planetId == PL_FRONTIER) {
    if (!species(c).hostile) return;
    InvSlot item; item.itemKind = IK_GEAR;
    int roll = (c.id * 17 + c.species * 7) % 12;
    item.definitionId = roll < 8 ? 320 + roll % 2 : 100 + (c.species % 6) * 6 + roll % 6;
    item.count = 1;
    E.itemsys.spawnStack(item, c.wx - E.fg.worldOffsetX + species(c).w * .5, c.wy - E.fg.worldOffsetY, 0, -.4, 12, false);
    return;
  }
  uint8_t itemKind = creatureBehavior(species(c)).dropItem;
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
  if (!c.alive || isProtectedNpc(c) || c.hurtCooldown > 0) return;
  int damage = imin(ACTOR_CRUSH_DAMAGE, c.health - 1);
  if (damage <= 0) return;
  c.health -= damage;
  c.hurtCooldown = ACTOR_CRUSH_COOLDOWN;
  const CreatureSpecies& s = species(c);
  E.audio.emit(SE_CREATURE, c.wx - E.fg.worldOffsetX + s.w * 0.5,
               c.wy - E.fg.worldOffsetY + s.h * 0.5, 0.65, c.species, 0);
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
  if (E.planetId == PL_FRONTIER && species(c).hostile) { E.combat.enemyAttack(c); return; }
  const CreatureSpecies& s = species(c);
  switch (creatureBehavior(s).attack) {
    case CAH_DYNAMITEER:
      updateChargedProjectileAttack(
        c, CAH_DYNAMITEER, DYNAMITE_CHARGE_TICKS, DYNAMITE_THROW_TICKS);
      return;
    case CAH_BORE_SENTINEL: updateBoreSentinelAttack(c); return;
    case CAH_CAUSTIC_MORTARMAN:
      updateChargedProjectileAttack(
        c, CAH_CAUSTIC_MORTARMAN, MORTARMAN_CHARGE_TICKS, MORTARMAN_FIRE_TICKS);
      return;
    case CAH_CLUSTER_WASP:
      updateChargedProjectileAttack(
        c, CAH_CLUSTER_WASP, CLUSTER_WASP_CHARGE_TICKS, CLUSTER_WASP_FIRE_TICKS);
      return;
    case CAH_MINIGUNNER: updateMinigunnerAttack(c); return;
    case CAH_BOSS: updateBossAttack(c); return;
    case CAH_GENERIC: break;
    default: __builtin_trap();
  }
  if (c.attackCooldown > 0 || s.damage <= 0) return;
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
    if (!c.alive) {
      c.deathTicks--;
      if (c.rescueProgress >= 1) c.rescueProgress = 2.0 - std::max(0, c.deathTicks) / 30.0;
      continue;
    }
    if (c.rescueProgress > 0 && E.actorTick - c.rescueLastTick > 6)
      c.rescueProgress = std::max(0.0, c.rescueProgress - 1.0 / 36.0);
    if (c.shelterCharge > 0) {
      if (E.missions.missionId == MI_GREENFALL_RECOVERY &&
          !E.missions.objectives.empty() && E.missions.objectives[0].state == OS_COMPLETE)
        c.shelterCharge = std::max(0.0, c.shelterCharge - 1.0 / 45.0);
      c.health = species(c).maxHealth;
      c.vx = c.vy = 0;
      c.animFrame = 0;
      continue;
    }
    if (isProtectedNpc(c)) c.health = species(c).maxHealth;
    if (c.health <= 0) {
      killCreature(c);
      continue;
    }
    bool encounterEngaged = true;
    if (c.missionActor && species(c).hostile &&
        E.missions.missionId == MI_GREENFALL_RECOVERY) {
      const Player* player = E.psys.findPlayer(E.missions.playerId);
      encounterEngaged = player &&
        std::fabs(E.fg.worldOffsetX + player->px + player->w * .5 -
                  c.wx - species(c).w * .5) <= 80 &&
        std::fabs(E.fg.worldOffsetY + player->py + player->h * .5 -
                  c.wy - species(c).h * .5) <= 24;
      // Relay guards engage within the player's gallery, including through rubble.
      if (!encounterEngaged) {
        c.attackState = CAS_IDLE;
        c.attackTicks = 0;
        c.attackProgress = 0;
        c.attackCooldown = imax(c.attackCooldown, 60);
      }
    }
    if (c.scanCooldown > 0) c.scanCooldown--; else acquireTarget(c);
    if (c.missionActor && E.missions.missionId == MI_GREENFALL_RECOVERY &&
        c.targetKind == CT_NONE)
      c.attackCooldown = imax(c.attackCooldown, 60);
    if (c.attackCooldown > 0) c.attackCooldown--;
    if (c.hurtCooldown > 0) c.hurtCooldown--;
    double priorX = c.wx;
    if (c.burnTicks > 0) { c.burnTicks--; if (c.burnTicks % 30 == 0) c.health -= 3; }
    if (c.slowTicks > 0) c.slowTicks--;
    if (c.rootTicks > 0) c.rootTicks--;
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
    else if (species(c).locomotion == CL_AMPHIBIOUS || c.roamRadius) moveAmphibious(c);
    else { c.vx = 0; c.vy = 0; c.grounded = true; }
    if (c.rootTicks > 0) { c.wx = priorX; c.vx = 0; }
    else if (c.slowTicks > 0) { c.wx = priorX + (c.wx-priorX)*.35; c.vx *= .35; }
    // Terrain can settle or be placed through an entity after movement. Mere
    // floor contact is outside the AABB and harmless; sustained burial over at
    // least half the body deals one point every half-second at 60 actor Hz.
    if (((E.actorTick + c.id * 7) % 30) == 0 &&
        blockingCoverage(c.wx, c.wy, species(c).w, species(c).h) >= 0.5) c.health--;
    uint8_t contactHazard = contactHazardAtBox(
      c.wx, c.wy, species(c).w, species(c).h, E.actorTick + c.id * 7);
    if (contactHazard != CHP_NONE)
      c.health -= CONTACT_HAZARD_CREATURE_DAMAGE[contactHazard];
    if (encounterEngaged && !c.rootTicks) attackTarget(c);
    // Four authored poses per species. Tie pose selection to locomotion where
    // it matters so feet, wings, and body arcs describe the actual movement
    // instead of every creature sharing the same two-frame global blink.
    const CreatureBehaviorProfileDef& behavior = creatureBehavior(species(c));
    if (behavior.animation == CAP_DYNAMITE) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.52 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = std::fabs(c.vx) > 0.035 ? (uint8_t)(((E.actorTick / 5) + c.id) & 1) : 0;
    } else if (behavior.animation == CAP_BORE) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.50 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = std::fabs(c.vx) > 0.025 ? (uint8_t)(((E.actorTick / 7) + c.id) & 1) : 0;
    } else if (behavior.animation == CAP_MORTAR) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.55 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = std::fabs(c.vx) > 0.025 ? (uint8_t)(((E.actorTick / 7) + c.id) & 1) : 0;
    } else if (behavior.animation == CAP_WASP) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.55 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = 3;
      else c.animFrame = (uint8_t)(((E.actorTick / 3) + c.id) & 3);
    } else if (behavior.animation == CAP_MINIGUN) {
      if (c.attackState == CAS_CHARGING) c.animFrame = c.attackProgress < 0.52 ? 1 : 2;
      else if (c.attackState == CAS_FIRING) c.animFrame = (uint8_t)(2 + ((E.actorTick / 2) & 1));
      else c.animFrame = std::fabs(c.vx) > 0.02 ? (uint8_t)(((E.actorTick / 7) + c.id) & 1) : 0;
    } else if (species(c).renderBob == CRB_BIRD) {
      c.animFrame = (uint8_t)(((E.actorTick / 3) + c.id) & 3);
    } else if (species(c).renderBob == CRB_HARE) {
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
  assert(creatures.size() + pendingSpawns.size()
         <= (size_t)CREATURE_MAX_RECORDS);
  snapshot.assign((creatures.size() + pendingSpawns.size()) * CSN_STRIDE, 0.0f);
  for (size_t i = 0; i < creatures.size(); i++) {
    const Creature& c = creatures[i]; const CreatureSpecies& s = species(c);
    float* o = snapshot.data() + i * CSN_STRIDE;
    writeCreatureSnapshot(o, c, {
      .x = WriteCreatureSnapshotX{
        (float)(c.wx - E.fg.worldOffsetX)},
      .y = WriteCreatureSnapshotY{
        (float)(c.wy - E.fg.worldOffsetY)},
      .w = WriteCreatureSnapshotW{s.w},
      .h = WriteCreatureSnapshotH{s.h},
      .maxHealth = WriteCreatureSnapshotMaxHealth{s.maxHealth},
      .aimX = WriteCreatureSnapshotAimX{
        (float)(c.attackAimX - E.fg.worldOffsetX)},
      .aimY = WriteCreatureSnapshotAimY{
        (float)(c.attackAimY - E.fg.worldOffsetY)},
    });
  }
  for (size_t i = 0; i < pendingSpawns.size(); i++) {
    const CreatureSpawnTelegraph& p = pendingSpawns[i];
    const CreatureSpecies& s = CREATURE_SPECIES[p.species];
    float* o = snapshot.data() + (creatures.size() + i) * CSN_STRIDE;
    // Keep zero reserved for ordinary materialized actors. The first warning
    // frame is therefore already distinguishable on mirrors and the wire.
    int elapsed = p.totalTicks - p.ticksRemaining;
    writeCreatureTelegraphSnapshot(o, p, {
      .x = WriteCreatureTelegraphSnapshotX{
        (float)(p.wx - E.fg.worldOffsetX)},
      .y = WriteCreatureTelegraphSnapshotY{
        (float)(p.wy - E.fg.worldOffsetY)},
      .w = WriteCreatureTelegraphSnapshotW{s.w},
      .h = WriteCreatureTelegraphSnapshotH{s.h},
      .maxHealth = WriteCreatureTelegraphSnapshotMaxHealth{s.maxHealth},
      .spawnProgress = WriteCreatureTelegraphSnapshotSpawnProgress{
        (float)std::max(1.0 / p.totalTicks,
          std::min(1.0, (elapsed + 1.0) / p.totalTicks))},
    });
  }
  return (int)(creatures.size() + pendingSpawns.size());
}
