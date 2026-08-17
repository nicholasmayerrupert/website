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
  if (!featureApplies(GFF_VILLAGE)) return false;
  uint32_t seed = E.L->worldSeed ^ 0x57121314u;
  if (whash1(seed ^ 0xA11A6Eu, latticeX) > VILLAGE_CHANCE) return false;
  int center = latticeX * VILLAGE_LATTICE + 76
    + (int)(whash1(seed ^ 0xA11A6Fu, latticeX) * 268);
  int surface = E.terrain.genSurfaceAbs(center);
  if (surface >= E.L->gSeaRow) return false;
  int count = 5 + (int)(whash1(seed ^ 0xA11A70u, latticeX) * 3);
  int wellX = center + count * 29 + 12;
  out.latticeX = latticeX;
  out.center = center;
  out.buildingCount = count;
  out.left = center - count * 29 - 30;
  out.right = wellX + 12;
  out.top = surface - 96;
  out.bottom = surface + 48;
  out.id = featureId(0x711A6E00u, latticeX, 0);
  return candidateAccepted(featureDef(GFF_VILLAGE),
                           {out.left, out.top, out.right, out.bottom});
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
  return candidateAccepted(featureDef(GFF_MINE),
                           {out.left, out.top, out.right, out.bottom});
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

bool WorldContextSystem::ruinPlan(
    int latticeX, int latticeY, RuinPlan& out) const {
  if (!featureApplies(GFF_RUIN)) return false;
  uint32_t seed = E.L->worldSeed ^ 0x57121314u;
  if (whash2(seed, latticeX, latticeY) >= 0.25) return false;

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

  if (selectedArchetype.minSurfaceDepth > 0
      && floorY - surfaceY < selectedArchetype.minSurfaceDepth)
    kind = selectedArchetype.shallowFallback;

  WorldBounds ruinBounds{left, top, left + width, floorY};
  if (!candidateAccepted(featureDef(GFF_RUIN), ruinBounds)) return false;
  out.latticeX = latticeX;
  out.latticeY = latticeY;
  out.kind = kind;
  out.left = left;
  out.top = top;
  out.right = left + width;
  out.bottom = floorY;
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
  out.bottom = floorY;
  out.id = featureId(0x0A17C0DEu, latticeX, E.planetId);
  return candidateAccepted(featureDef(GFF_OUTCROP),
                           {out.left, out.top, out.right, out.bottom});
}

bool WorldContextSystem::outcropSlice(
    const OutcropPlan& plan, int dy, OutcropSlice& out) {
  if (dy < 0 || dy > plan.height) return false;
  out = {};
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
                           def.tags, ruin.id, 0, bounds);
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
                           def.tags, deep.id, 0, bounds);
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
