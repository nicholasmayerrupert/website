int WorldContextSystem::floorDiv(int value, int divisor) {
  int q = value / divisor, r = value % divisor;
  if (r < 0) q--;
  return q;
}

uint32_t WorldContextSystem::featureId(uint32_t salt, int x, int y) const {
  uint32_t seed = E.L->worldSeed ^ salt
    ^ ((uint32_t)WORLD_GENERATION_VERSION * 0x9e3779b9u)
    ^ ((uint32_t)E.planetId * 0xc2b2ae35u);
  uint32_t id = (uint32_t)(whash2(seed, x, y) * 4294967296.0);
  return id ? id : 1;
}

bool WorldContextSystem::featureApplies(
    GeneratedFeatureFamily family) const {
  return (featureDef(family).generationProfileMask
          & (1u << planetDef(E.planetId).generationProfile)) != 0;
}

bool WorldContextSystem::candidateAccepted(
    const GeneratedFeatureDef& candidate, const WorldBounds& bounds) const {
  for (int family = 0; family < GFF_COUNT; family++) {
    if ((candidate.excludesMask & (1u << family)) == 0) continue;
    const GeneratedFeatureDef& excluded = FEATURES[(size_t)family];
    if (!featureApplies(excluded.family)) continue;
    if ((this->*excluded.overlaps)(excluded, bounds)) return false;
  }
  return true;
}

bool WorldContextSystem::villagePlan(int latticeX, VillagePlan& out) const {
  if (!villageCandidate(latticeX, out)) return false;
  // Reserve the whole street, including roofs, stairs, market, and well.
  // Lower lattice coordinates win conflicts against raw candidates, so the
  // decision is bounded and independent of streaming order or active layer.
  constexpr int CLEARANCE = 12;
  const GeneratedFeatureDef& def = featureDef(GFF_VILLAGE);
  int first = floorDiv(out.left - CLEARANCE - def.overscanX,
                       def.latticeWidth);
  for (int q = first; q < latticeX; q++) {
    VillagePlan neighbor;
    if (villageCandidate(q, neighbor)
        && neighbor.right + CLEARANCE >= out.left) return false;
  }
  return candidateAccepted(def, {out.left, out.top, out.right, out.bottom});
}

bool WorldContextSystem::landmarkPlan(int latticeX, LandmarkPlan& out) const {
  if (!featureApplies(GFF_LANDMARK)) return false;
  uint64_t key = ((uint64_t)(E.L->worldSeed ^ E.content.fingerprint) << 32) | (uint32_t)latticeX;
  auto found = landmarkCache.find(key);
  if (found != landmarkCache.end()) { out = found->second; return out.id != 0; }
  LandmarkPlan result;
  const auto& feature = featureDef(GFF_LANDMARK);
  uint32_t seed = E.L->worldSeed ^ 0x1A6D4A2Bu;
  uint32_t id = featureId(0x1A6D0001u, latticeX, 0);
  Engine::ForegroundTerrainScope foregroundQuery(E.L);
  for (int attempt = 0; attempt < 4 && whash2(seed, latticeX, 17) < .46; attempt++) {
    int cx = latticeX * feature.latticeWidth + 160
      + (int)(whash2(seed, latticeX, attempt) * 320);
    int biome = E.terrain.genBiomeAt(cx);
    LandmarkKind kind = landmarkKindForBiome(biome, id);
    const LandmarkDef& def = LANDMARKS[kind];
    bool wet = biome == BIOME_SWAMP;
    bool skeleton = kind == LM_LEVIATHAN;
    bool followsSlope = skeleton || kind == LM_BONE_CAMP || kind == LM_BONE_LOOKOUT;
    int lo = INT_MAX, hi = INT_MIN;
    std::vector<int> levels;
    bool suitable = true;
    for (int dx = -def.halfWidth - 24; dx <= def.halfWidth + 24; dx += 4) {
      int x = cx + dx, y = E.terrain.genSurfaceAbs(x);
      if (E.terrain.genBiomeAt(x) != biome || (!wet && y >= E.L->gSeaRow)
          || (!skeleton && std::abs(dx) < 24 && E.terrain.genOpenCaveAt(x, y))) { suitable = false; break; }
      lo = imin(lo, y); hi = imax(hi, y); levels.push_back(y);
    }
    if (!suitable || hi - lo > (followsSlope ? 90 : wet ? 24 : 36)) continue;
    std::sort(levels.begin(), levels.end());
    int floor = levels[levels.size() / 2] - 1;
    if (wet) floor = imin(lo - 2, E.L->gSeaRow - 7);
    WorldBounds bounds{cx - def.halfWidth - 26, lo - def.height - 12,
                       cx + def.halfWidth + 26, hi + 64};
    if (!candidateAccepted(feature, bounds)) continue;
    if (E.planetId == PL_FRONTIER) {
      for (const ContentRect& rect : E.content.rectangles) {
        if (rect.right < bounds.left || rect.left > bounds.right) continue;
        int offset = E.content.surfaceOffset(rect.surface);
        if (rect.bottom + offset >= bounds.top && rect.top + offset <= bounds.bottom) {
          suitable = false; break;
        }
      }
    }
    if (!suitable) continue;
    result = {cx, floor, biome, kind, bounds.left, bounds.top, bounds.right, bounds.bottom, id};
    break;
  }
  if (landmarkCache.size() >= 256) landmarkCache.clear();
  landmarkCache.emplace(key, result);
  out = result;
  return out.id != 0;
}

bool WorldContextSystem::overlapsLandmark(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  for (int q = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
       q <= floorDiv(bounds.right + def.overscanX, def.latticeWidth); q++) {
    LandmarkPlan plan;
    if (landmarkPlan(q, plan) && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom})) return true;
  }
  return false;
}


bool WorldContextSystem::villageCandidate(int latticeX, VillagePlan& out) const {
  if (!featureApplies(GFF_VILLAGE)) return false;
  uint32_t seed = E.L->worldSeed ^ 0x57121314u;
  if (whash1(seed ^ 0xA11A6Eu, latticeX) > VILLAGE_CHANCE) return false;
  int count = 5 + (int)(whash1(seed ^ 0xA11A70u, latticeX) * 3);
  // Search a few deterministic sites for a dry, coherent street. A rejected
  // hillside does not discard an otherwise usable settlement district.
  for (int attempt = 0; attempt < 3; attempt++) {
    double pick = attempt == 0 ? whash1(seed ^ 0xA11A6Fu, latticeX)
      : whash2(seed ^ 0xA11A71u, latticeX, attempt);
    int center = latticeX * VILLAGE_LATTICE + 76
      + (int)(pick * (VILLAGE_LATTICE - 152));
    int surface = E.terrain.genSurfaceAbs(center);
    int biome = E.terrain.genBiomeAt(center);
    if (surface >= E.L->gSeaRow || !surfaceBiomeDef(biome).allowsSurfaceStructures) continue;
    int wellX = center + count * 29 + 64;
    int left = center - count * 29 - 30, right = wellX + 12;
    bool suitable = true;
    for (int sample = left; sample < right + 24; sample += 24) {
      int x = imin(sample, right);
      int ground = E.terrain.genSurfaceAbs(x);
      if (E.terrain.genBiomeAt(x) != biome || ground >= E.L->gSeaRow
          || std::abs(ground - surface) > 32) { suitable = false; break; }
    }
    if (!suitable) continue;
    out.latticeX = latticeX;
    out.center = center;
    out.buildingCount = count;
    out.left = left;
    out.right = right;
    out.top = surface - 96;
    out.bottom = surface + 48;
    out.id = featureId(0x711A6E00u, latticeX, 0);
    return true;
  }
  return false;
}

bool WorldContextSystem::villageBuildingPlan(
    const VillagePlan& village, int ordinal, VillageBuildingPlan& out,
    int queryX) const {
  if (ordinal < 0 || ordinal >= village.buildingCount) return false;
  bool hall = ordinal == village.buildingCount / 2;
  int role = ordinal & 3, variant = (ordinal >> 2) & 1;
  int width = hall ? 52
            : role == 0 ? 36 + variant * 4
            : role == 1 ? 44 + variant * 2
            : role == 2 ? 38 + variant * 4
                        : 46 - variant * 2;
  int height = hall ? 30
             : role == 0 ? 24 + variant * 2
             : role == 1 ? 22 + variant * 2
             : role == 2 ? 27 + variant
                         : 24 + variant * 2;
  int center = village.center
    + (ordinal - village.buildingCount / 2) * 58;
  int left = center - width / 2;
  if (queryX != INT_MIN
      && (queryX <= left || queryX >= left + width)) return false;
  int biome = E.terrain.genBiomeAt(center);
  int ground = E.terrain.genSurfaceAbs(center);
  if (ground >= E.L->gSeaRow
      || !surfaceBiomeDef(biome).allowsSurfaceStructures) return false;

  int lo = ground, hi = ground, surfaceSum = 0;
  bool crossesCaveMouth = false;
  {
    Engine::ForegroundTerrainScope foregroundQuery(E.L);
    for (int x = left; x <= left + width; x++) {
      int surface = E.terrain.genSurfaceAbs(x);
      lo = imin(lo, surface);
      hi = imax(hi, surface);
      surfaceSum += surface;
      if (E.terrain.genOpenCaveAt(x, surface)
          || E.terrain.genOpenCaveAt(x, surface + 1)
          || E.terrain.genOpenCaveAt(x, surface + 2))
        crossesCaveMouth = true;
    }
  }
  if (crossesCaveMouth || hi - lo > (hall ? 14 : 11)) return false;

  int floorY = Engine::floorDiv(surfaceSum, width + 1) - 1;
  int wallTop = floorY - height;
  out.ordinal = ordinal;
  out.center = center;
  out.left = left;
  out.wallTop = wallTop;
  out.floorY = floorY;
  out.width = width;
  out.height = height;
  out.roofHeight = hall ? 11 : role == 2 ? 10 : 9;
  out.hall = hall;
  out.biome = biome;
  out.role = hall ? WSR_MEETING_HALL
           : role == 0 ? WSR_HOME
           : role == 1 ? WSR_WORKSHOP
           : role == 2 ? WSR_APOTHECARY : WSR_STOREHOUSE;
  out.parentId = village.id;
  out.id = featureId(0x711B01D0u, village.latticeX, ordinal);
  return true;
}

bool WorldContextSystem::minePlan(int latticeX, MinePlan& out) const {
  if (!featureApplies(GFF_MINE)) return false;
  uint32_t seed = E.L->worldSeed ^ 0x57121314u;
  if (whash1(seed ^ 0xD16D0001u, latticeX) > 0.72) return false;
  int center = latticeX * MINE_LATTICE + 112
    + (int)(whash1(seed ^ 0xD16D0002u, latticeX)
            * (MINE_LATTICE - 224));
  int surface = E.terrain.genSurfaceAbs(center);
  if (surface >= E.L->gSeaRow
      || !surfaceBiomeDef(
        E.terrain.genBiomeAt(center)).allowsSurfaceStructures) return false;

  int width = 152 + (int)(whash1(seed ^ 0xD16D0003u, latticeX) * 57);
  int levels = whash1(seed ^ 0xD16D0004u, latticeX) < 0.38 ? 4 : 3;
  constexpr int LEVEL_GAP = 27;
  int firstFloor = surface + 126
    + (int)(whash1(seed ^ 0xD16D0005u, latticeX) * 64);
  firstFloor = imin(firstFloor,
    TerrainGen::CAVE_BOTTOM - 28 - (levels - 1) * LEVEL_GAP);

  constexpr int HOUSE_WIDTH = 42;
  int houseLeft = center - HOUSE_WIDTH / 2, surfaceSum = 0;
  for (int x = houseLeft; x <= houseLeft + HOUSE_WIDTH; x++)
    surfaceSum += E.terrain.genSurfaceAbs(x);
  int houseFloor = Engine::floorDiv(surfaceSum, HOUSE_WIDTH + 1) - 1;

  out.latticeX = latticeX;
  out.center = center;
  out.width = width;
  out.levels = levels;
  out.firstFloor = firstFloor;
  out.left = center - width / 2;
  out.right = center + width / 2;
  out.top = surface - 36;
  out.bottom = firstFloor + (levels - 1) * LEVEL_GAP;
  out.headhouseLeft = houseLeft;
  out.headhouseRight = houseLeft + HOUSE_WIDTH;
  out.headhouseFloor = houseFloor;
  out.headhouseTop = houseFloor - 25;
  out.shaftLeft = center - width / 4;
  out.shaftRight = center + width / 4;
  out.shaftHalf = 6;
  out.shaftTop = firstFloor - (PLAYER_H + 7);
  out.shaftBottom = firstFloor + (levels - 1) * LEVEL_GAP;
  out.connectorTop = houseFloor - PLAYER_H - 4;
  out.connectorBottom = out.shaftTop;
  for (int level = 0; level < levels; level++) {
    MineLevelPlan& lp = out.level[level];
    lp.floor = firstFloor + level * LEVEL_GAP;
    lp.ceiling = lp.floor - (PLAYER_H + 7);
    int inset = (level & 1) * 10;
    lp.left = out.left + inset;
    lp.right = out.right - inset;
    int stationHalf = level == 0 ? 27 : 21;
    lp.stationLeft = center - stationHalf;
    lp.stationRight = center + stationHalf;
    lp.roomLeft = (level & 1) == 0 ? lp.left + 12 : lp.right - 44;
    lp.roomRight = lp.roomLeft + 31;
    lp.roomTop = lp.ceiling - (PLAYER_H + 5);
    lp.roomBottom = lp.ceiling - 1;
  }
  out.id = featureId(0xD16DCA7Au, latticeX, 0);
  // The entrance, its stairs, and the access shaft reserve surface space.
  // Deep galleries can run beneath settlements without consuming their street.
  return candidateAccepted(featureDef(GFF_MINE),
    {houseLeft - 12, imin(out.top, out.headhouseTop - 9),
     houseLeft + HOUSE_WIDTH + 12, out.connectorBottom});
}

bool WorldContextSystem::offworldFacilityPlan(
    int latticeX, OffworldFacilityPlan& out) const {
  const PlanetDef& planet = planetDef(E.planetId);
  PlanetGenerationProfile profile = planet.generationProfile;
  uint32_t salt = planet.facilitySalt;
  if (whash1(E.L->worldSeed ^ salt, latticeX) < .20) return false;
  int center = latticeX * OFFWORLD_FACILITY_LATTICE + 126
    + (int)std::lround(
      whash1(E.L->worldSeed ^ salt ^ 0x51u, latticeX) * 168.0);
  uint32_t profileBit = 1u << profile;
  int eligibleCount = 0;
  for (const OffworldFacilityArchetypeDef& archetype
       : OFFWORLD_FACILITY_ARCHETYPES)
    if (archetype.generationProfileMask & profileBit) eligibleCount++;
  if (eligibleCount == 0) return false;
  int selected = imin(eligibleCount - 1, (int)(
    whash1(E.L->worldSeed ^ salt ^ 0x52u, latticeX) * eligibleCount));
  const OffworldFacilityArchetypeDef* archetype = nullptr;
  for (const OffworldFacilityArchetypeDef& candidate
       : OFFWORLD_FACILITY_ARCHETYPES) {
    if ((candidate.generationProfileMask & profileBit) == 0) continue;
    if (selected-- == 0) { archetype = &candidate; break; }
  }
  if (!archetype) return false;
  int halfWidth = archetype->halfWidth;
  int highestSurface = E.terrain.genSurfaceAbs(center);
  for (int x = center - halfWidth; x <= center + halfWidth; x += 8)
    highestSurface = imin(highestSurface, E.terrain.genSurfaceAbs(x));
  int deckY = highestSurface - 2;
  int facilityTop = deckY + OFFWORLD_FACILITY_DECK_SPACING;
  int facilityBottom = facilityTop + archetype->undergroundDepth;
  int facilityHalf = halfWidth - 9;

  out.latticeX = latticeX;
  out.center = center;
  out.kind = archetype->kind;
  out.left = center - halfWidth;
  out.right = center + halfWidth;
  out.top = deckY - archetype->aboveDeckReach;
  out.bottom = facilityBottom;
  out.deckY = deckY;
  out.facilityLeft = center - facilityHalf;
  out.facilityRight = center + facilityHalf;
  out.facilityTop = facilityTop;
  out.facilityBottom = facilityBottom;
  out.roomDeckCount = 0;
  out.dividerCount = 0;
  for (int floor = facilityTop + OFFWORLD_FACILITY_FIRST_ROOM_OFFSET;
       floor < facilityBottom - OFFWORLD_FACILITY_BOTTOM_ROOM_CLEARANCE;
       floor += OFFWORLD_FACILITY_DECK_SPACING)
    out.roomDeckFloor[out.roomDeckCount++] = floor;
  for (int floor = facilityTop + OFFWORLD_FACILITY_DECK_SPACING;
       floor < facilityBottom; floor += OFFWORLD_FACILITY_DECK_SPACING)
    out.dividerFloor[out.dividerCount++] = floor;
  out.id = featureId(0xB453CA7Au, latticeX,
                     archetype->selectionOrdinal);
  return candidateAccepted(featureDef(GFF_OFFWORLD_FACILITY),
                           {out.left, out.top, out.right, out.bottom});
}

bool WorldContextSystem::overlapsConstruction(const WorldBounds& bounds) const {
  for (const GeneratedFeatureDef& def : FEATURES) {
    if (def.family == GFF_OUTCROP || !featureApplies(def.family)) continue;
    if ((this->*def.overlaps)(def, bounds)) return true;
  }
  return false;
}

bool WorldContextSystem::ruinPlan(int latticeX, int latticeY, RuinPlan& out) const {
  if (ruinCacheSeed != E.L->worldSeed || ruinCacheContent != E.content.fingerprint) {
    ruinCache.clear(); ruinCacheSeed = E.L->worldSeed; ruinCacheContent = E.content.fingerprint;
  }
  uint64_t key = ((uint64_t)(uint32_t)latticeX << 32) | (uint32_t)latticeY;
  auto found = ruinCache.find(key);
  if (found != ruinCache.end()) { out = found->second; return out.id != 0; }
  RuinPlan plan;
  if (ruinCandidate(latticeX, latticeY, plan)) {
    WorldBounds footprint{plan.left - 3, plan.top - 3, plan.right + 3, plan.bottom};
    constexpr int neighborsX = (RuinPlan::MAX_WIDTH + RUIN_CANDIDATE_JITTER_MAX + 6 + RUIN_LATTICE - 1) / RUIN_LATTICE;
    constexpr int neighborsY = (RuinPlan::MAX_HEIGHT + RuinPlan::FOUNDATION_DEPTH
      + RUIN_FLOOR_SEARCH_REACH * 2 + RUIN_CANDIDATE_JITTER_MAX + 6 + RUIN_LATTICE - 1) / RUIN_LATTICE;
    for (int dy = -neighborsY; dy <= neighborsY && plan.id; dy++) for (int dx = -neighborsX; dx <= neighborsX && plan.id; dx++) {
      if (!dx && !dy) continue;
      RuinPlan other;
      if (ruinCandidate(latticeX + dx, latticeY + dy, other) && other.id < plan.id
          && footprint.overlaps({other.left - 3, other.top - 3, other.right + 3, other.bottom})) plan.id = 0;
    }
  }
  if (ruinCache.size() >= 512) ruinCache.clear();
  ruinCache.emplace(key, plan); out = plan; return out.id != 0;
}

bool WorldContextSystem::ruinCandidate(
    int latticeX, int latticeY, RuinPlan& out) const {
  if (!featureApplies(GFF_RUIN)) return false;
  uint32_t seed = E.L->worldSeed ^ 0x57121314u;
  if (whash2(seed, latticeX, latticeY) >= 0.32) return false;

  int left = latticeX * RUIN_LATTICE
    + (int)(whash2(seed ^ 0xA1u, latticeX, latticeY) * 6);
  int candidateY = latticeY * RUIN_LATTICE
    + (int)(whash2(seed ^ 0xB2u, latticeX, latticeY) * 6);
  int width = RUIN_BASE_MIN_WIDTH
    + (int)(whash2(seed ^ 0xC3u, latticeX, latticeY)
            * RUIN_BASE_WIDTH_VARIATION);
  int height = RUIN_BASE_MIN_HEIGHT
    + (int)(whash2(seed ^ 0xD4u, latticeX, latticeY)
            * RUIN_BASE_HEIGHT_VARIATION);

  Engine::ForegroundTerrainScope foregroundQuery(E.L);
  int caveBiome = E.terrain.genCaveBiomeAt(
    left + width / 2, candidateY + height / 2);
  CaveBiomeProfile caveProfile = caveBiomeDef(caveBiome).profile;
  double pick = whash2(seed ^ 0x9001u, latticeX, latticeY);
  RuinKind kind = RK_COUNT;
  for (const RuinArchetypeDef& archetype : RUIN_ARCHETYPES) {
    if (archetype.preferredCaveProfile == caveProfile
        && pick < archetype.preferredChance) {
      kind = archetype.kind;
      break;
    }
  }
  if (kind == RK_COUNT) {
    int neutralCount = 0;
    for (const RuinArchetypeDef& archetype : RUIN_ARCHETYPES)
      if (archetype.neutralPool) neutralCount++;
    int selected = imin(neutralCount - 1, (int)(
      whash2(seed ^ 0x9002u, latticeX, latticeY) * neutralCount));
    for (const RuinArchetypeDef& archetype : RUIN_ARCHETYPES) {
      if (!archetype.neutralPool) continue;
      if (selected-- == 0) { kind = archetype.kind; break; }
    }
  }
  const RuinArchetypeDef& selectedArchetype =
    RUIN_ARCHETYPES[(size_t)kind];
  width += selectedArchetype.widthAdd;
  height += selectedArchetype.heightAdd;
  if (selectedArchetype.sizeProfile == RSP_SHRINE) {
    width = RUIN_SHRINE_MIN_WIDTH
      + (int)(whash2(seed ^ 0xC4u, latticeX, latticeY)
              * RUIN_SHRINE_WIDTH_VARIATION);
    height = imax(PLAYER_H + 3, width / 2 + 3);
  }

  int centerX = left + width / 2, floorY = INT_MIN;
  for (int radius = 0;
       radius <= RuinPlan::FLOOR_SEARCH_REACH && floorY == INT_MIN;
       radius++) {
    for (int side = 0; side < (radius == 0 ? 1 : 2); side++) {
      int y = candidateY
        + (radius == 0 ? 0 : (side == 0 ? -radius : radius));
      if (E.terrain.genOpenCaveAt(centerX, y)
          && !E.terrain.genOpenCaveAt(centerX, y + 1)) {
        floorY = y;
        break;
      }
    }
  }
  if (floorY == INT_MIN) return false;
  int top = floorY - height + 1;
  int surfaceY = E.terrain.genSurfaceAbs(centerX);
  if (top < surfaceY + 30 || floorY > E.terrain.caveBottomAbs()) return false;
  // The complete vault stays below the surface, including hillside entrances.
  for (int x = left; x <= left + width; x += 4)
    if (top < E.terrain.genSurfaceAbs(x) + 30) return false;
  if (top < E.terrain.genSurfaceAbs(left + width) + 30) return false;

  if (selectedArchetype.minSurfaceDepth > 0
      && floorY - surfaceY < selectedArchetype.minSurfaceDepth)
    kind = selectedArchetype.shallowFallback;

  WorldBounds ruinBounds{left, top, left + width, floorY + RuinPlan::FOUNDATION_DEPTH};
  if (!candidateAccepted(featureDef(GFF_RUIN), ruinBounds)) return false;
  out.latticeX = latticeX;
  out.latticeY = latticeY;
  out.kind = kind;
  out.left = left;
  out.top = top;
  out.right = left + width;
  out.bottom = floorY + RuinPlan::FOUNDATION_DEPTH;
  out.floorY = floorY;
  out.surfaceY = surfaceY;
  out.id = featureId(0x2A11C0DEu, latticeX, latticeY);
  return true;
}

bool WorldContextSystem::deepStructurePlan(
    int gridX, int gridY, DeepStructurePlan& out) const {
  if (!featureApplies(GFF_DEEP_STRUCTURE) || gridY < 0)
    return false;
  uint32_t seed = E.L->worldSeed ^ 0xD33A900u;
  if (whash2(seed ^ 0x01u, gridX, gridY) > 0.64) return false;

  Engine::ForegroundTerrainScope foregroundQuery(E.L);
  TerrainGen::DeepCavernPlan cavern = E.terrain.deepCavernPlan(gridX, gridY);
  int biome = E.terrain.genCaveBiomeAt(cavern.centerX, cavern.centerY);
  const CaveBiomeDef& biomeDef = caveBiomeDef(biome);
  if (!biomeDef.deep) return false;

  int width = DeepStructurePlan::MIN_WIDTH
    + (int)(whash2(seed ^ 0x02u, gridX, gridY)
      * DeepStructurePlan::WIDTH_VARIATION);
  int height = DeepStructurePlan::MIN_HEIGHT
    + (int)(whash2(seed ^ 0x03u, gridX, gridY)
      * DeepStructurePlan::HEIGHT_VARIATION);
  width = imin(width, cavern.radiusX * 2 - 24);
  int floorY = INT_MIN;
  CaveDeepFloorPolicy floorPolicy =
    caveProfileHandler(biomeDef.profile).deepFloor;
  if (floorPolicy == CDFP_MAGMA_LAKE) {
    floorY = cavern.centerY + cavern.radiusY / 4 - 3;
  } else if (floorPolicy == CDFP_SEARCH) {
    for (int y = cavern.centerY;
         y <= cavern.centerY + cavern.radiusY
              + DeepStructurePlan::FLOOR_SEARCH_EXTRA; y++) {
      if (E.terrain.genOpenCaveAt(cavern.centerX, y)
          && !E.terrain.genOpenCaveAt(cavern.centerX, y + 1)) {
        floorY = y;
        break;
      }
    }
  } else {
    __builtin_trap();
  }
  if (floorY == INT_MIN) return false;

  out.gridX = gridX;
  out.gridY = gridY;
  out.caveBiome = biome;
  out.cavernCenterX = cavern.centerX;
  out.cavernCenterY = cavern.centerY;
  out.cavernRadiusX = cavern.radiusX;
  out.cavernRadiusY = cavern.radiusY;
  out.naveLeft = cavern.centerX - width / 2;
  out.naveTop = floorY - height + 1;
  out.naveRight = out.naveLeft + width - 1;
  out.left = out.naveLeft - DeepStructurePlan::SIDE_PORTAL_REACH;
  out.top = out.naveTop;
  out.right = out.naveRight + DeepStructurePlan::SIDE_PORTAL_REACH;
  out.bottom = floorY + DeepStructurePlan::BUTTRESS_DEPTH;
  out.floorY = floorY;
  out.id = featureId(0xD33AC17Au, gridX, gridY);
  return candidateAccepted(featureDef(GFF_DEEP_STRUCTURE),
                           {out.left, out.top, out.right, out.bottom});
}

bool WorldContextSystem::outcropPlan(int latticeX, OutcropPlan& out) const {
  const PlanetDef& planet = planetDef(E.planetId);
  PlanetGenerationProfile profile = planet.generationProfile;
  const OutcropProfileDef& outcropProfile =
    OUTCROP_PROFILES[(size_t)profile];
  if (outcropProfile.style == OCS_NONE) return false;
  uint32_t salt = planet.outcropSalt;
  if (whash1(E.L->worldSeed ^ salt, latticeX) < .43) return false;
  int center = latticeX * OUTCROP_LATTICE + 18
    + (int)std::lround(
      whash1(E.L->worldSeed ^ salt ^ 0x11u, latticeX) * 56.0);
  int floorY = E.terrain.genSurfaceAbs(center) - 1;
  int height = 8 + (int)std::lround(
    whash1(E.L->worldSeed ^ salt ^ 0x12u, latticeX) * 17.0);
  out.latticeX = latticeX;
  out.center = center;
  out.floorY = floorY;
  out.biome = E.terrain.genBiomeAt(center);
  if (profile == PGP_EARTH) {
    const SurfaceBiomeDef& def = surfaceBiomeDef(out.biome);
    if (whash1(E.L->worldSeed ^ salt ^ 0x21u, latticeX) > def.formationChance
        || floorY >= E.L->gSeaRow - 1) return false;
    height = imax(3, (int)std::lround(def.formationHeight
      * (0.55 + whash1(E.L->worldSeed ^ salt ^ 0x22u, latticeX) * 0.45)));
    // Both layers use the foreground entrance map. Formations root in bedrock
    // without plugging cave mouths or standing above unsupported slopes.
    Engine::ForegroundTerrainScope foregroundQuery(E.L);
    for (int x = center - 14; x <= center + 14; x++) {
      int surface = E.terrain.genSurfaceAbs(x);
      if (std::abs(surface - floorY) > 12 || E.terrain.genOpenCaveAt(x, surface)
          || E.terrain.genOpenCaveAt(x, surface + 2)) return false;
    }
    if (overlapsVillage(featureDef(GFF_VILLAGE), {center - 32, floorY - height, center + 32, floorY + 24})
        || overlapsMine(featureDef(GFF_MINE), {center - 32, floorY - height, center + 32, floorY + 24})) return false;
    if (def.formationStyle == SFS_FOSSIL) {
      floorY += imax(2, height / 5);
      out.floorY = floorY;
    }
  }
  out.height = height;
  out.style = outcropProfile.style;
  out.lean = outcropProfile.style == OCS_MINERAL_SPIRE
    ? (whash1(E.L->worldSeed ^ salt ^ 0x13u, latticeX) < .5 ? -1 : 1)
    : 0;
  out.shardHeight = outcropProfile.style == OCS_MINERAL_SPIRE
    ? imax(5, height * 2 / 3) : 0;
  out.halfBase = outcropProfile.style == OCS_WEATHERED_HOODOO
    ? 6 + height / 5 : 0;
  out.left = center - OutcropPlan::BOUND_HALF_WIDTH;
  out.top = floorY - height;
  out.right = center + OutcropPlan::BOUND_HALF_WIDTH;
  out.bottom = floorY + (profile == PGP_EARTH ? OutcropPlan::BOUND_VERTICAL_REACH : 0);
  out.id = featureId(0x0A17C0DEu, latticeX, E.planetId);
  return candidateAccepted(featureDef(GFF_OUTCROP),
                           {out.left, out.top, out.right, out.bottom});
}

bool WorldContextSystem::outcropSlice(
    const OutcropPlan& plan, int dy, OutcropSlice& out) {
  if (dy < 0 || dy > plan.height) return false;
  out = {};
  if (plan.style == OCS_BIOME_FORMATION) {
    const SurfaceBiomeDef& def = surfaceBiomeDef(plan.biome);
    double t = (double)dy / imax(1, plan.height);
    int half = 0;
    int center = plan.center;
    if (def.formationStyle == SFS_FOSSIL) {
      half = 25;
    } else if (def.formationStyle == SFS_BOULDER) {
      half = imax(1, (int)std::lround((plan.height + 3) * std::sqrt(1.0 - t * t)));
    } else if (def.formationStyle == SFS_STACK) {
      half = dy < plan.height / 3 ? 9 : dy < plan.height * 3 / 4 ? 5 : 8;
    } else {
      half = imax(0, (int)std::lround((1.0 - t) * 6));
      center += (plan.latticeX % 2 ? -1 : 1) * dy / 7;
    }
    out.left = center - half;
    out.right = center + half;
    return true;
  }
  if (plan.lean) {
    int spine = plan.center + plan.lean * dy / 5;
    int half = imax(0, 4 - dy * 4 / imax(1, plan.height));
    out.left = spine - half;
    out.right = spine + half;
    out.hasShard = dy <= plan.shardHeight;
    out.shardX = plan.center - plan.lean * (6 + dy / 7);
    return true;
  }
  int half = dy < plan.height / 3 ? plan.halfBase
           : dy < plan.height * 2 / 3
             ? imax(3, plan.halfBase - 4)
             : imax(2, plan.halfBase - 2);
  int notch = dy > plan.height / 3 && dy < plan.height * 2 / 3 ? 2 : 0;
  out.left = plan.center - half;
  out.right = plan.center + half;
  if (notch) {
    out.hollowLeft = plan.center - notch + 1;
    out.hollowRight = plan.center + notch - 1;
  }
  return true;
}

// A shared solid mask keeps fossil cavities identical in both simulated layers
// and in semantic feature queries. Every silhouette has grounded lower cells.
bool WorldContextSystem::fossilCellAt(const OutcropPlan& plan, int dx, int dy) {
  if (dy < 0 || dy > plan.height) return false;
  const int h = plan.height;
  const int form = plan.id % 3;
  if (form == 0) {
    double x = dx + (plan.id & 8 ? 1 : -1) * dy * .13;
    double cy = h * .53, ry = h * .47, rx = h * .66;
    double ex = x / rx, ey = (dy - cy) / ry;
    bool cranium = ex * ex + ey * ey <= 1;
    bool jaw = dy <= h * .28 && std::abs(x) <= h * .33 + dy * .2;
    if (!cranium && !jaw) return false;
    double sx = (std::abs(x) - h * .28) / (h * (x < 0 ? .16 : .14));
    double sy = (dy - h * .57 - x * .12) / (h * .16);
    if (sx * sx + sy * sy < 1) return false;
    if (dy > h * .29 && dy < h * .47 && std::abs(x) < (h * .48 - dy) * .45) return false;
    if (dy > h * .27 && dy < h * .4 && std::abs(x) > h * .47) return false;
    // A broken dental line stays enclosed by the cheekbones and lower jaw.
    if (dy > h * .17 && dy < h * .24 && std::abs(x) < h * .28
        && ((int)std::floor(x) + h * 2) % 3 != 0) return false;
    return true;
  }
  if (form == 1) {
    // Separate ribs curve down into individual buried feet.
    if (dy <= 2) return fossilCellAt(plan, dx, 3);
    for (int rib = -1; rib <= 1; rib++) {
      int height = h - std::abs(rib) * 4;
      if (dy > height) continue;
      double t = (double)dy / height;
      int radius = (int)std::lround(10 * std::sqrt(1 - t * t));
      double lowerT = (double)(dy - 1) / height;
      int lowerRadius = (int)std::lround(10 * std::sqrt(1 - lowerT * lowerT));
      int x = std::abs(dx - rib * 11);
      if (x <= lowerRadius && x >= imax(0, radius - 2)) return true;
    }
    return false;
  }
  if (plan.id & 8) {
    // Leaning timber stakes, lashed crossbars, and pointed bone caps.
    for (int stake = -1; stake <= 1; stake++) {
      int height = h - std::abs(stake) * 5;
      int x = stake * 10 + stake * dy / 10;
      int half = dy > height - 4 ? imax(0, (height - dy) / 2) : 2;
      if (dy <= height && std::abs(dx - x) <= half) return true;
    }
    return dy >= h / 3 && dy <= h / 3 + 1 && std::abs(dx) <= 13;
  }
  int spine = (plan.latticeX % 2 ? -1 : 1) * dy / 8;
  int half = dy < 3 ? 7 : dy >= h - 2 ? 2 : dy % 5 < 3 ? 5 : 1;
  return std::abs(dx - spine) <= half;
}

bool WorldContextSystem::overlapsVillage(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  int first = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
  int last = floorDiv(bounds.right + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    VillagePlan plan;
    if (villagePlan(q, plan)
        && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom}))
      return true;
  }
  return false;
}

bool WorldContextSystem::overlapsMine(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  int first = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
  int last = floorDiv(bounds.right + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    MinePlan plan;
    if (minePlan(q, plan)
        && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom}))
      return true;
  }
  return false;
}

bool WorldContextSystem::overlapsRuin(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  int firstX = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
  int lastX = floorDiv(bounds.right + def.overscanX, def.latticeWidth);
  int firstY = floorDiv(bounds.top - def.overscanY, def.latticeHeight);
  int lastY = floorDiv(bounds.bottom + def.overscanY, def.latticeHeight);
  for (int gy = firstY; gy <= lastY; gy++) {
    for (int gx = firstX; gx <= lastX; gx++) {
      RuinPlan plan;
      if (ruinPlan(gx, gy, plan)
          && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom}))
        return true;
    }
  }
  return false;
}

bool WorldContextSystem::overlapsDeepStructure(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  int firstX = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
  int lastX = floorDiv(bounds.right + def.overscanX, def.latticeWidth);
  int firstY = imax(0, floorDiv(
    bounds.top - TerrainGen::CAVE_BOTTOM - def.overscanY,
    def.latticeHeight));
  int lastY = imax(0, floorDiv(
    bounds.bottom - TerrainGen::CAVE_BOTTOM + def.overscanY,
    def.latticeHeight));
  for (int gy = firstY; gy <= lastY; gy++) {
    for (int gx = firstX; gx <= lastX; gx++) {
      DeepStructurePlan plan;
      if (deepStructurePlan(gx, gy, plan)
          && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom}))
        return true;
    }
  }
  return false;
}

bool WorldContextSystem::overlapsOutcrop(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  int first = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
  int last = floorDiv(bounds.right + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    OutcropPlan plan;
    if (outcropPlan(q, plan)
        && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom}))
      return true;
  }
  return false;
}

bool WorldContextSystem::overlapsOffworldFacility(
    const GeneratedFeatureDef& def, const WorldBounds& bounds) const {
  int first = floorDiv(bounds.left - def.overscanX, def.latticeWidth);
  int last = floorDiv(bounds.right + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    OffworldFacilityPlan plan;
    if (offworldFacilityPlan(q, plan)
        && bounds.overlaps({plan.left, plan.top, plan.right, plan.bottom}))
      return true;
  }
  return false;
}

bool WorldContextSystem::mineContains(
    const MinePlan& mine, int worldX, int worldY,
    WorldSiteRole& role, WorldBounds& bounds) const {
  if (worldX > mine.headhouseLeft && worldX < mine.headhouseRight
      && worldY > mine.headhouseTop && worldY < mine.headhouseFloor) {
    role = WSR_MINE_HEADHOUSE;
    bounds = {mine.headhouseLeft, mine.headhouseTop - 9,
              mine.headhouseRight, mine.headhouseFloor};
    return true;
  }

  for (int level = 0; level < mine.levels; level++) {
    const MineLevelPlan& lp = mine.level[level];
    bool gallery = worldX >= lp.left && worldX <= lp.right
      && worldY >= lp.ceiling && worldY < lp.floor;
    bool station = worldX >= lp.stationLeft && worldX <= lp.stationRight
      && worldY >= lp.ceiling - 5 && worldY < lp.floor;
    bool sideRoom = worldX >= lp.roomLeft && worldX <= lp.roomRight
      && worldY >= lp.roomTop && worldY <= lp.roomBottom;
    if (gallery || station || sideRoom) {
      role = WSR_MINE_GALLERY;
      bounds = sideRoom
        ? WorldBounds{lp.roomLeft, lp.roomTop,
                      lp.roomRight, lp.roomBottom}
        : station
          ? WorldBounds{lp.stationLeft, lp.ceiling - 5,
                        lp.stationRight, lp.floor - 1}
          : WorldBounds{lp.left, lp.ceiling, lp.right, lp.floor - 1};
      return true;
    }
  }

  for (int shaftX : {mine.shaftLeft, mine.shaftRight}) {
    if (worldX >= shaftX - mine.shaftHalf
        && worldX <= shaftX + mine.shaftHalf
        && worldY >= mine.shaftTop && worldY < mine.shaftBottom) {
      role = WSR_MINE_GALLERY;
      bounds = {shaftX - mine.shaftHalf, mine.shaftTop,
                shaftX + mine.shaftHalf, mine.shaftBottom - 1};
      return true;
    }
  }
  if (worldX >= mine.center - mine.shaftHalf
      && worldX <= mine.center + mine.shaftHalf
      && worldY >= mine.connectorTop && worldY <= mine.connectorBottom) {
    role = WSR_MINE_GALLERY;
    bounds = {mine.center - mine.shaftHalf, mine.connectorTop,
              mine.center + mine.shaftHalf, mine.connectorBottom};
    return true;
  }
  return false;
}

static void preferFeatureMatch(
    GeneratedFeatureMatch& best, const GeneratedFeatureDef& def,
    int specificity,
    WorldFeatureKind kind, WorldSiteRole role, uint32_t tags,
    uint32_t id, uint32_t parentId, WorldBounds bounds) {
  if (best.found) {
    const GeneratedFeatureDef& incumbent =
      WorldContextSystem::featureDef(best.family);
    if (compareGeneratedFeatureOwnership(
          def, specificity, id, incumbent, best.specificity, best.id) <= 0)
      return;
  }
  best = {true, def.family, def.priority, specificity,
          kind, role, tags, id, parentId, bounds};
}

bool WorldContextSystem::queryLandmark(
    const GeneratedFeatureDef& def, int worldX, int worldY, GeneratedFeatureMatch& best) const {
  for (int q = floorDiv(worldX - def.overscanX, def.latticeWidth);
       q <= floorDiv(worldX + def.overscanX, def.latticeWidth); q++) {
    LandmarkPlan plan;
    if (landmarkPlan(q, plan) && worldX >= plan.left && worldX <= plan.right
        && worldY >= plan.top && worldY <= plan.bottom)
      preferFeatureMatch(best, def, 0, def.kind, def.role, def.tags, plan.id, 0,
        {plan.left, plan.top, plan.right, plan.bottom});
  }
  return best.found;
}

bool WorldContextSystem::queryVillage(
    const GeneratedFeatureDef& def, int worldX, int worldY,
    GeneratedFeatureMatch& best) const {
  int first = floorDiv(worldX - def.overscanX, def.latticeWidth);
  int last = floorDiv(worldX + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    VillagePlan village;
    if (!villagePlan(q, village)) continue;
    WorldBounds bounds{village.left, village.top,
                       village.right, village.bottom};
    if (!bounds.contains(worldX, worldY)) continue;
    preferFeatureMatch(best, def, 0, def.kind, def.role,
                       def.tags, village.id, 0, bounds);
    for (int ordinal = 0; ordinal < village.buildingCount; ordinal++) {
      VillageBuildingPlan building;
      if (!villageBuildingPlan(village, ordinal, building, worldX)
          || worldY <= building.wallTop || worldY >= building.floorY)
        continue;
      WorldBounds buildingBounds{
        building.left - 2,
        building.wallTop - building.roofHeight
          - (building.hall ? 13
             : building.role == WSR_WORKSHOP ? 7 : 0),
        building.left + building.width + 2,
        building.floorY,
      };
      preferFeatureMatch(best, def, 100, WF_VILLAGE_BUILDING, building.role,
                         def.tags | WA_BUILDING | WA_INDOOR,
                         building.id, building.parentId, buildingBounds);
    }
  }
  return best.found;
}

bool WorldContextSystem::queryMine(
    const GeneratedFeatureDef& def, int worldX, int worldY,
    GeneratedFeatureMatch& best) const {
  int first = floorDiv(worldX - def.overscanX, def.latticeWidth);
  int last = floorDiv(worldX + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    MinePlan mine;
    WorldSiteRole role;
    WorldBounds bounds;
    if (!minePlan(q, mine)
        || !mineContains(mine, worldX, worldY, role, bounds)) continue;
    bool headhouse = role == WSR_MINE_HEADHOUSE;
    preferFeatureMatch(best, def, headhouse ? 100 : 0, def.kind, role,
                       def.tags | (headhouse ? WA_BUILDING | WA_INDOOR : 0),
                       mine.id, 0, bounds);
  }
  return best.found;
}

bool WorldContextSystem::queryRuin(
    const GeneratedFeatureDef& def, int worldX, int worldY,
    GeneratedFeatureMatch& best) const {
  int surfaceY = E.terrain.genSurfaceAbs(worldX);
  if (worldY < surfaceY + 20 || worldY > TerrainGen::CAVE_BOTTOM + 64)
    return false;
  int firstX = floorDiv(worldX - def.overscanX, def.latticeWidth);
  int lastX = floorDiv(worldX + def.overscanX, def.latticeWidth);
  int firstY = floorDiv(worldY - def.overscanY, def.latticeHeight);
  int lastY = floorDiv(worldY + def.overscanY, def.latticeHeight);
  for (int gy = firstY; gy <= lastY; gy++) {
    for (int gx = firstX; gx <= lastX; gx++) {
      RuinPlan ruin;
      if (!ruinPlan(gx, gy, ruin)) continue;
      WorldBounds bounds{ruin.left, ruin.top, ruin.right, ruin.bottom};
      if (bounds.contains(worldX, worldY))
        preferFeatureMatch(best, def, 0, def.kind, def.role,
                           worldY <= ruin.floorY ? def.tags : WA_STRUCTURE,
                           ruin.id, 0, bounds);
    }
  }
  return best.found;
}

bool WorldContextSystem::queryDeepStructure(
    const GeneratedFeatureDef& def, int worldX, int worldY,
    GeneratedFeatureMatch& best) const {
  if (worldY < TerrainGen::DEEP_BLEND_TOP) return false;
  int firstX = floorDiv(worldX - def.overscanX, def.latticeWidth);
  int lastX = floorDiv(worldX + def.overscanX, def.latticeWidth);
  int firstY = imax(0, floorDiv(
    worldY - TerrainGen::CAVE_BOTTOM - def.overscanY,
    def.latticeHeight));
  int lastY = imax(0, floorDiv(
    worldY - TerrainGen::CAVE_BOTTOM + def.overscanY,
    def.latticeHeight));
  for (int gy = firstY; gy <= lastY; gy++) {
    for (int gx = firstX; gx <= lastX; gx++) {
      DeepStructurePlan deep;
      if (!deepStructurePlan(gx, gy, deep)) continue;
      WorldBounds bounds{deep.left, deep.top, deep.right, deep.bottom};
      if (bounds.contains(worldX, worldY))
        preferFeatureMatch(best, def, 0, def.kind, def.role,
                           worldY <= deep.floorY ? def.tags : WA_STRUCTURE,
                           deep.id, 0, bounds);
    }
  }
  return best.found;
}

bool WorldContextSystem::queryOutcrop(
    const GeneratedFeatureDef& def, int worldX, int worldY,
    GeneratedFeatureMatch& best) const {
  int first = floorDiv(worldX - def.overscanX, def.latticeWidth);
  int last = floorDiv(worldX + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    OutcropPlan plan;
    if (!outcropPlan(q, plan)) continue;
    int dy = plan.floorY - worldY;
    OutcropSlice slice;
    bool contains = outcropSlice(plan, dy, slice) && slice.contains(worldX);
    bool fossil = plan.style == OCS_BIOME_FORMATION
      && surfaceBiomeDef(plan.biome).formationStyle == SFS_FOSSIL;
    if (fossil && dy >= 0) contains = fossilCellAt(plan, worldX - plan.center, dy);
    if (plan.style == OCS_BIOME_FORMATION && dy < 0) {
      outcropSlice(plan, 0, slice);
      int soil = E.terrain.genSoilDepthAt(worldX, E.terrain.genBiomeAt(worldX));
      contains = slice.contains(worldX) && worldY <= E.terrain.genSurfaceAbs(worldX)
        + TerrainGen::GEN_SKIN + soil;
      if (fossil) contains = contains && fossilCellAt(plan, worldX - plan.center, 0);
      if (fossil && plan.id % 3 != 1) contains = contains && worldY >= E.terrain.genSurfaceAbs(worldX);
    }
    if (plan.style == OCS_WEATHERED_HOODOO && dy == 0
        && worldX >= plan.center - plan.halfBase - 3
        && worldX <= plan.center + plan.halfBase + 3)
      contains = true;
    if (contains)
      preferFeatureMatch(best, def, 0, def.kind, def.role,
                         def.tags, plan.id, 0,
                         {plan.left, plan.top, plan.right, plan.bottom});
  }
  return best.found;
}

bool WorldContextSystem::queryOffworldFacility(
    const GeneratedFeatureDef& def, int worldX, int worldY,
    GeneratedFeatureMatch& best) const {
  int first = floorDiv(worldX - def.overscanX, def.latticeWidth);
  int last = floorDiv(worldX + def.overscanX, def.latticeWidth);
  for (int q = first; q <= last; q++) {
    OffworldFacilityPlan facility;
    if (!offworldFacilityPlan(q, facility)) continue;
    WorldBounds bounds{facility.left, facility.top,
                       facility.right, facility.bottom};
    if (!bounds.contains(worldX, worldY)) continue;
    bool indoor = worldX >= facility.facilityLeft
        && worldX <= facility.facilityRight
        && worldY >= facility.facilityTop
        && worldY <= facility.facilityBottom;
    preferFeatureMatch(best, def, indoor ? 100 : 0, def.kind, def.role,
                       def.tags | (indoor ? WA_BUILDING | WA_INDOOR : 0),
                       facility.id, 0, bounds);
  }
  return best.found;
}

WorldContext WorldContextSystem::at(int worldX, int worldY) const {
  Engine::ForegroundTerrainScope foregroundQuery(E.L);
  WorldContext context;
  context.surfaceBiome = E.terrain.genBiomeAt(worldX);
  context.caveBiome = E.terrain.genCaveBiomeAt(worldX, worldY);
  context.surfaceY = E.terrain.genSurfaceAbs(worldX);
  context.depth = worldY - context.surfaceY;
  context.tags = context.depth > 10 ? WA_UNDERGROUND : WA_SURFACE;
  if (worldY >= TerrainGen::DEEP_BLEND_TOP) context.tags |= WA_DEEP;

  GeneratedFeatureMatch best;
  uint32_t profileBit = 1u << planetDef(E.planetId).generationProfile;
  for (const GeneratedFeatureDef& feature : FEATURES) {
    if ((feature.generationProfileMask & profileBit) == 0) continue;
    (this->*feature.query)(feature, worldX, worldY, best);
  }

  if (best.found) {
    context.tags |= best.tags;
    context.featureKind = best.kind;
    context.siteRole = best.role;
    context.featureId = best.id;
    context.parentFeatureId = best.parentId;
    context.left = best.bounds.left;
    context.top = best.bounds.top;
    context.right = best.bounds.right;
    context.bottom = best.bounds.bottom;
  }
  return context;
}

void WorldContextSystem::writeSnapshot(int worldX, int worldY, int* out) const {
  WorldContext context = at(worldX, worldY);
  writeWorldContextSnapshot(out, context);
}

void stampVillageGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillVillageGeneratedFeature(
    feature, colStart, colEnd, rowStart, rowEnd);
}

void stampLandmarkGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillLandmarkGeneratedFeature(feature, colStart, colEnd, rowStart, rowEnd);
}

void stampMineGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillMineGeneratedFeature(
    feature, colStart, colEnd, rowStart, rowEnd);
}

void stampRuinGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillRuinGeneratedFeature(
    feature, colStart, colEnd, rowStart, rowEnd);
}

void stampDeepGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillDeepGeneratedFeature(
    feature, colStart, colEnd, rowStart, rowEnd);
}

void stampOutcropGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillOutcropGeneratedFeature(
    feature, colStart, colEnd, rowStart, rowEnd);
}

void stampFacilityGeneratedFeature(
    Engine& engine, const GeneratedFeatureDef& feature,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillFacilityGeneratedFeature(
    feature, colStart, colEnd, rowStart, rowEnd);
}

void runSpaceshipGenerationStage(
    Engine& engine, const WorldGenerationStageDef&,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillSpaceship(colStart, colEnd, rowStart, rowEnd);
}

void runCaveDressingGenerationStage(
    Engine& engine, const WorldGenerationStageDef& stage,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillCaveFeatures(colStart, colEnd, rowStart, rowEnd,
                          stage.overscanX, stage.overscanY);
}

void runDeepCaveDressingGenerationStage(
    Engine& engine, const WorldGenerationStageDef& stage,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillDeepCaveFeatures(colStart, colEnd, rowStart, rowEnd,
                              stage.overscanX, stage.overscanY);
}

void runOceanFloraGenerationStage(
    Engine& engine, const WorldGenerationStageDef& stage,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillOceanFlora(colStart, colEnd, rowStart, rowEnd,
                        stage.overscanX);
}

void runGeneratedFeatureStage(
    Engine& engine, const WorldGenerationStageDef& stage,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  uint32_t profileBit = 1u << planetDef(engine.planetId).generationProfile;
  uint8_t layerBit = engine.L->isBackground
    ? GFL_BACKGROUND : GFL_FOREGROUND;
  uint32_t pending = 0;
  for (int i = 0; i < GFF_COUNT; i++) {
    const GeneratedFeatureDef& feature = WorldContextSystem::FEATURES[i];
    if (feature.stage != stage.featureStage
        || (feature.generationProfileMask & profileBit) == 0
        || (feature.layerMask & layerBit) == 0)
      continue;
    pending |= 1u << i;
  }
  while (pending) {
    int next = -1;
    for (int i = 0; i < GFF_COUNT; i++) {
      if ((pending & (1u << i)) == 0) continue;
      if (next < 0 || compareGeneratedFeatureOwnership(
            WorldContextSystem::FEATURES[i], 0, 0,
            WorldContextSystem::FEATURES[next], 0, 0) < 0)
        next = i;
    }
    const GeneratedFeatureDef& feature = WorldContextSystem::FEATURES[next];
    feature.stamp(engine, feature, colStart, colEnd, rowStart, rowEnd);
    pending &= ~(1u << next);
  }
}

void runHazardBoundaryGenerationStage(
    Engine& engine, const WorldGenerationStageDef&,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.sealHazardBoundaries(colStart, colEnd, rowStart, rowEnd);
}

void runTreeGenerationStage(
    Engine& engine, const WorldGenerationStageDef& stage,
    int colStart, int colEnd, int rowStart, int rowEnd) {
  engine.fillTrees(colStart, colEnd, rowStart, rowEnd,
                   stage.overscanX, stage.overscanY);
}
