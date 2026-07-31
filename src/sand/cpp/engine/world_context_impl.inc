int WorldContextSystem::floorDiv(int value, int divisor) {
  int q = value / divisor, r = value % divisor;
  if (r < 0) q--;
  return q;
}

uint32_t WorldContextSystem::featureId(uint32_t salt, int x, int y) const {
  uint32_t seed = E.L->worldSeed ^ salt
    ^ ((uint32_t)TerrainGen::WORLDGEN_VERSION * 0x9e3779b9u)
    ^ ((uint32_t)VERSION * 0x85ebca6bu)
    ^ ((uint32_t)E.planetId * 0xc2b2ae35u);
  uint32_t id = (uint32_t)(whash2(seed, x, y) * 4294967296.0);
  return id ? id : 1;
}

bool WorldContextSystem::villagePlan(int latticeX, VillagePlan& out) const {
  if (E.planetId != PL_EARTH) return false;
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
  return true;
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
  if (ground >= E.L->gSeaRow || biome == BIOME_ROCKY) return false;

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
  if (E.planetId != PL_EARTH) return false;
  uint32_t seed = E.L->worldSeed ^ 0x57121314u;
  if (whash1(seed ^ 0xD16D0001u, latticeX) > 0.72) return false;
  int center = latticeX * MINE_LATTICE + 112
    + (int)(whash1(seed ^ 0xD16D0002u, latticeX)
            * (MINE_LATTICE - 224));
  int surface = E.terrain.genSurfaceAbs(center);
  if (surface >= E.L->gSeaRow
      || E.terrain.genBiomeAt(center) == BIOME_ROCKY) return false;

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
  out.id = featureId(0xD16DCA7Au, latticeX, 0);
  return true;
}

bool WorldContextSystem::offworldFacilityPlan(
    int latticeX, OffworldFacilityPlan& out) const {
  if (E.planetId != PL_MOON && E.planetId != PL_MARS) return false;
  uint32_t salt = E.planetId == PL_MOON ? 0xB4531001u : 0xB4531002u;
  if (whash1(E.L->worldSeed ^ salt, latticeX) < .20) return false;
  int center = latticeX * OFFWORLD_FACILITY_LATTICE + 126
    + (int)std::lround(
      whash1(E.L->worldSeed ^ salt ^ 0x51u, latticeX) * 168.0);
  int kind = imin(2, (int)(
    whash1(E.L->worldSeed ^ salt ^ 0x52u, latticeX) * 3.0));
  int halfWidth = E.planetId == PL_MOON
    ? (kind == 1 ? 100 : 92) : (kind == 0 ? 104 : 96);
  int highestSurface = E.terrain.genSurfaceAbs(center);
  for (int x = center - halfWidth; x <= center + halfWidth; x += 8)
    highestSurface = imin(highestSurface, E.terrain.genSurfaceAbs(x));
  int deckY = highestSurface - 2;
  int facilityTop = deckY + 34;
  int facilityBottom = facilityTop + (kind == 2 ? 102 : 116);
  int facilityHalf = halfWidth - 9;

  out.latticeX = latticeX;
  out.center = center;
  out.kind = kind;
  out.left = center - halfWidth;
  out.right = center + halfWidth;
  out.top = deckY - 96;
  out.bottom = facilityBottom;
  out.deckY = deckY;
  out.facilityLeft = center - facilityHalf;
  out.facilityRight = center + facilityHalf;
  out.facilityTop = facilityTop;
  out.facilityBottom = facilityBottom;
  out.id = featureId(0xB453CA7Au, latticeX, kind);
  return true;
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

  if (E.planetId == PL_EARTH) {
    int villageCell = floorDiv(worldX, VILLAGE_LATTICE);
    for (int q = villageCell - 1; q <= villageCell + 1; q++) {
      VillagePlan village;
      if (!villagePlan(q, village)
          || worldX < village.left || worldX > village.right
          || worldY < village.top
          || worldY > village.bottom) continue;
      context.tags |= WA_STRUCTURE | WA_SETTLEMENT;
      context.featureKind = WF_VILLAGE;
      context.siteRole = WSR_NONE;
      context.featureId = village.id;
      context.parentFeatureId = 0;
      context.left = village.left;
      context.top = village.top;
      context.right = village.right;
      context.bottom = village.bottom;
      for (int ordinal = 0; ordinal < village.buildingCount; ordinal++) {
        VillageBuildingPlan building;
        if (!villageBuildingPlan(village, ordinal, building, worldX)
            || worldY <= building.wallTop
            || worldY >= building.floorY) continue;
        context.tags |= WA_BUILDING | WA_INDOOR;
        context.featureKind = WF_VILLAGE_BUILDING;
        context.siteRole = building.role;
        context.featureId = building.id;
        context.parentFeatureId = building.parentId;
        context.left = building.left - 2;
        context.top = building.wallTop - building.roofHeight
          - (building.hall ? 13 : building.role == WSR_WORKSHOP ? 7 : 0);
        context.right = building.left + building.width + 2;
        context.bottom = building.floorY;
        return context;
      }
    }

    int mineCell = floorDiv(worldX, MINE_LATTICE);
    for (int q = mineCell - 1; q <= mineCell + 1; q++) {
      MinePlan mine;
      if (!minePlan(q, mine)
          || worldX < mine.left || worldX > mine.right
          || worldY < mine.top || worldY > mine.bottom) continue;
      context.tags |= WA_STRUCTURE | WA_MINE;
      context.featureKind = WF_MINE;
      context.featureId = mine.id;
      context.parentFeatureId = 0;
      context.left = mine.left;
      context.top = mine.top;
      context.right = mine.right;
      context.bottom = mine.bottom;
      if (worldX > mine.headhouseLeft && worldX < mine.headhouseRight
          && worldY > mine.headhouseTop && worldY < mine.headhouseFloor) {
        context.tags |= WA_BUILDING | WA_INDOOR;
        context.siteRole = WSR_MINE_HEADHOUSE;
        context.left = mine.headhouseLeft;
        context.top = mine.headhouseTop - 9;
        context.right = mine.headhouseRight;
        context.bottom = mine.headhouseFloor;
      } else {
        context.siteRole = WSR_MINE_GALLERY;
      }
      return context;
    }
    return context;
  }

  if (E.planetId == PL_MOON || E.planetId == PL_MARS) {
    int cell = floorDiv(worldX, OFFWORLD_FACILITY_LATTICE);
    for (int q = cell - 1; q <= cell + 1; q++) {
      OffworldFacilityPlan facility;
      if (!offworldFacilityPlan(q, facility)
          || worldX < facility.left || worldX > facility.right
          || worldY < facility.top || worldY > facility.bottom) continue;
      context.tags |= WA_STRUCTURE | WA_FACILITY;
      context.featureKind = WF_OFFWORLD_FACILITY;
      context.siteRole = WSR_FACILITY;
      context.featureId = facility.id;
      context.left = facility.left;
      context.top = facility.top;
      context.right = facility.right;
      context.bottom = facility.bottom;
      if (worldX >= facility.facilityLeft
          && worldX <= facility.facilityRight
          && worldY >= facility.facilityTop
          && worldY <= facility.facilityBottom)
        context.tags |= WA_BUILDING | WA_INDOOR;
      return context;
    }
  }
  return context;
}

void WorldContextSystem::writeSnapshot(int worldX, int worldY, int* out) const {
  WorldContext context = at(worldX, worldY);
  out[WC_SURFACE_BIOME] = context.surfaceBiome;
  out[WC_CAVE_BIOME] = context.caveBiome;
  out[WC_SURFACE_Y] = context.surfaceY;
  out[WC_DEPTH] = context.depth;
  out[WC_TAGS] = (int)context.tags;
  out[WC_FEATURE_KIND] = context.featureKind;
  out[WC_SITE_ROLE] = context.siteRole;
  out[WC_FEATURE_ID] = (int)context.featureId;
  out[WC_PARENT_FEATURE_ID] = (int)context.parentFeatureId;
  out[WC_LEFT] = context.left;
  out[WC_TOP] = context.top;
  out[WC_RIGHT] = context.right;
  out[WC_BOTTOM] = context.bottom;
}
