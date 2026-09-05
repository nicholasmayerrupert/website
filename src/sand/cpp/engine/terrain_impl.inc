int TerrainGen::floorDiv(int value, int divisor) {
  int q = value / divisor, r = value % divisor;
  if (r < 0) q--;
  return q;
}

double TerrainGen::genTemperatureAt(int worldX) {
  double broad = wfbm2(E.L->worldSeed ^ 0x7A11D2u, worldX * BIOME_FREQ, 5.5, 4, 0.52);
  double local = wfbm2(E.L->worldSeed ^ 0x7A11D3u, worldX * BIOME_FREQ * 3.1, 1.7, 2, 0.5);
  double altitude = std::fmax(0.0, (double)(SEA_LEVEL - genSurfaceAbs(worldX)) / 92.0);
  return std::fmax(0.0, std::fmin(1.0, broad * 0.78 + local * 0.22 - altitude * 0.24));
}

double TerrainGen::genMoistureAt(int worldX) {
  double broad = wfbm2(E.L->worldSeed ^ 0xB10B10u, worldX * BIOME_FREQ * 0.82, 2.5, 4, 0.52);
  double pockets = wfbm2(E.L->worldSeed ^ 0xB10B11u, worldX * BIOME_FREQ * 3.7, 9.5, 2, 0.5);
  double coast = 1.0 - std::fmin(1.0, std::fabs((double)(genSurfaceAbs(worldX) - SEA_LEVEL)) / 54.0);
  return std::fmax(0.0, std::fmin(1.0, broad * 0.72 + pockets * 0.18 + coast * 0.10));
}

int TerrainGen::classifyBiomeAt(int worldX) {
  double temperature = genTemperatureAt(worldX);
  double moisture = genMoistureAt(worldX);
  int surface = genSurfaceAbs(worldX);
  double altitude = std::fmax(0.0, (double)(SEA_LEVEL - surface) / 92.0);
  double rugged = wridged2(E.L->worldSeed ^ 0xB10B12u, worldX * BIOME_FREQ * 2.2, 4.0, 3, 0.52);

  for (Biome biome : SURFACE_BIOME_SELECTION_ORDER) {
    const SurfaceBiomeDef& def = surfaceBiomeDef(biome);
    if (surfaceBiomeClimateMatches(def, temperature, moisture, altitude, rugged,
                                   surface - SEA_LEVEL))
      return biome;
  }
  __builtin_unreachable();
}

// Ecotones occupy a narrow band around raw climate boundaries. Four-column
// deterministic patches borrow the neighbouring biome, producing a readable
// transition without per-pixel speckle or a single hard material seam.
int TerrainGen::genBiomeAt(int worldX) {
  const PlanetDef& planet = planetDef(E.planetId);
  PlanetGenerationProfile profile = planet.generationProfile;
  const BiomeGenerationProfileSelection& selection =
    biomeGenerationProfileSelection(profile);
  if (selection.surfaceMode == SBSE_REGIONAL) {
    uint32_t salt = planet.worldSeedSalt;
    int region = floorDiv(worldX, 1536);
    double pick = whash1(E.L->worldSeed ^ salt ^ 0xB10B10u, region);
    return selectRegionalSurfaceBiome(profile, pick);
  }
  if (selection.surfaceMode != SBSE_CLIMATE) __builtin_unreachable();
  uint32_t key = E.L->worldSeed ^ ((uint32_t)worldX * 0x9e3779b9u);
  BiomeCacheEntry& cached = biomeCache[key & (BIOME_CACHE_SIZE - 1)];
  if (cached.seed == E.L->worldSeed && cached.x == worldX) return cached.value;

  int center = classifyBiomeAt(worldX);
  int left = classifyBiomeAt(worldX - 24);
  int right = classifyBiomeAt(worldX + 24);
  int alternate = left != center ? left : (right != center ? right : center);
  if (left == right && left != center) alternate = left;
  if (alternate != center) {
    int patch = floorDiv(worldX, 4);
    double chance = left != center && right != center ? 0.48 : 0.28;
    if (whash1(E.L->worldSeed ^ 0xEC070E01u, patch) < chance) center = alternate;
  }

  cached.seed = E.L->worldSeed;
  cached.x = worldX;
  cached.value = (uint8_t)center;
  return center;
}
// Terrain top in ABSOLUTE world-Y (centred at worldY=0; smaller = higher). Smooth
// multi-octave hills/valleys; valleys below the sea row flood (handled in genCellAt).
int TerrainGen::genSurfaceAbs(int worldX) {
  const PlanetDef& planet = planetDef(E.planetId);
  if (planet.generationProfile == PGP_SHIP) return 16;
  if (planet.generationProfile == PGP_MOON
      || planet.generationProfile == PGP_MARS) {
    uint32_t planetSeed = E.L->worldSeed ^ planet.worldSeedSalt;
    uint32_t key = planetSeed ^ ((uint32_t)worldX * 0x85ebca6bu);
    SurfaceCacheEntry& cached = surfaceCache[key & (SURFACE_CACHE_SIZE - 1)];
    if (cached.seed == planetSeed && cached.x == worldX) return cached.value;

    double surface = 0;
    if (planet.generationProfile == PGP_MOON) {
      double broad = wfbm2(planetSeed ^ 0x10A71u, worldX * 0.0028, 2.1, 4, 0.52);
      double rubble = wridged2(planetSeed ^ 0x10A72u, worldX * 0.014, 8.5, 3, 0.52);
      surface = (broad - 0.5) * 54.0 + (rubble - 0.5) * 15.0;
      constexpr int CRATER_CELL = 112;
      int cell = floorDiv(worldX, CRATER_CELL);
      for (int c = cell - 1; c <= cell + 1; c++) {
        double choose = whash1(planetSeed ^ 0xC2A7E2u, c);
        if (choose < 0.28) continue;
        int center = c * CRATER_CELL + 18
          + (int)std::lround(whash1(planetSeed ^ 0xC2A7E3u, c) * (CRATER_CELL - 36));
        double radius = 17.0 + whash1(planetSeed ^ 0xC2A7E4u, c) * 30.0;
        double distance = std::fabs((double)worldX - center);
        if (distance >= radius + 4.0) continue;
        double t = distance / radius;
        if (t < 1.0) {
          double bowl = (1.0 - t * t)
            * (7.0 + whash1(planetSeed ^ 0xC2A7E5u, c) * 17.0);
          surface += bowl;
        }
        double rimDistance = std::fabs(distance - radius) / 4.0;
        if (rimDistance < 1.0)
          surface -= (1.0 - rimDistance) * (3.0 + choose * 5.0);
      }
    } else if (planet.generationProfile == PGP_MARS) {
      double continent = wfbm2(planetSeed ^ 0xA11CEu, worldX * 0.0017, 4.2, 4, 0.52);
      double mesas = wridged2(planetSeed ^ 0xA11CFu, worldX * 0.0048, 11.0, 4, 0.5);
      double gullies = wridged2(planetSeed ^ 0xA11D0u, worldX * 0.017, 3.0, 2, 0.55);
      surface = -(continent - 0.5) * 96.0
        - std::fmax(0.0, mesas - 0.52) * 58.0
        + std::fmax(0.0, gullies - 0.68) * 42.0;
    }
    int value = (int)std::lround(surface);
    cached.seed = planetSeed;
    cached.x = worldX;
    cached.value = value;
    return value;
  }
  if (planet.generationProfile != PGP_EARTH) __builtin_unreachable();
  uint32_t key = E.L->worldSeed ^ ((uint32_t)worldX * 0x85ebca6bu);
  SurfaceCacheEntry& cached = surfaceCache[key & (SURFACE_CACHE_SIZE - 1)];
  if (cached.seed == E.L->worldSeed && cached.x == worldX) return cached.value;

  // A very-low-frequency continental silhouette gives the world long mountain
  // ranges and broad ocean basins. Mid-frequency hills ride on top, while a
  // softly gated ridged field raises dramatic highlands without introducing a
  // hard step where the discrete surface biome changes.
  double continental = wfbm2(E.L->worldSeed ^ 0xC0171E57u, worldX * SURFACE_FREQ * 0.12, 7.3, 4, 0.52);
  double n = wfbm2(E.L->worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
  double hills = wfbm2(E.L->worldSeed ^ 0x9e3779b9u, worldX * SURFACE_FREQ * 0.27, 3.1, 4, 0.5);
  double ridges = wridged2(E.L->worldSeed ^ 0x61D6E5u, worldX * SURFACE_FREQ * 0.42, 17.0, 3, 0.52);
  double cuts = wridged2(E.L->worldSeed ^ 0xA5116Eu, worldX * SURFACE_FREQ * 1.55, 11.0, 2, 0.55);
  double highland = std::fmax(0.0, (continental - 0.53) / 0.30);
  if (highland > 1.0) highland = 1.0;
  double amp = SURFACE_AMPLITUDE * (0.68 + hills * 0.55 + highland * 0.42);
  double macro = -(continental - 0.5) * SURFACE_AMPLITUDE * 1.55;
  double peaks = -highland * ridges * SURFACE_AMPLITUDE * 1.65;
  int value = (int)std::lround(macro - (n - 0.5) * 2 * amp + peaks
                             + (cuts - 0.45) * SURFACE_AMPLITUDE * 0.18);
  if (E.planetId == PL_FRONTIER) {
    // The expedition starts on a dry terrace beneath the western highlands.
    double distance = std::abs(worldX);
    double blend = std::clamp((distance - 336.0) / 160.0, 0.0, 1.0);
    blend = blend * blend * (3.0 - 2.0 * blend);
    value = (int)std::lround(16.0 + (value - 16.0) * blend);
    double mountain = std::fmax(0.0, 1.0 - std::abs(worldX - 900) / 400.0);
    value -= (int)std::lround(230.0 * mountain * mountain * (3.0 - 2.0 * mountain));
  }
  cached.seed = E.L->worldSeed;
  cached.x = worldX;
  cached.value = value;
  return value;
}
// Terrain top as a BUFFER row in the current window (may be <0 or >=E.rows when the
// surface has scrolled off; genCellAt's `y < surf` test handles that as all-sky /
// all-underground). Used by spawn + tree placement.
int TerrainGen::genSurfaceAt(int worldX) { return genSurfaceAbs(worldX) - E.L->worldOffsetY; }
int TerrainGen::genSoilDepth(int biome) {
  const SurfaceBiomeDef& def = surfaceBiomeDef(biome);
  return E.L->gSoil * def.soilScale + def.soilAdd;
}
int TerrainGen::genSoilDepthAt(int worldX, int biome) {
  int total = genSoilDepth(biome);
  int samples = 1;
  for (int dx : {-16, 16}) {
    int other = genBiomeAt(worldX + dx);
    if (other == biome) continue;
    total += genSoilDepth(other);
    samples++;
  }
  return imax(0, (int)std::lround((double)total / samples));
}
uint8_t TerrainGen::genSkinMat(int biome, int slope, bool underwater) {
  if (underwater) return STONE;                // solid seabed (loose powder under water just avalanches)
  const SurfaceBiomeDef& def = surfaceBiomeDef(biome);
  return slope <= 2 ? def.flatSkin : def.steepSkin;
}
// Material of the mantle between the surface skin and deep stone. `d` is depth
// within the soil band.
uint8_t TerrainGen::genSoilMat(int biome, int d, int soil) {
  const SurfaceBiomeDef& def = surfaceBiomeDef(biome);
  bool inBase = def.soilBaseNumerator > 0
    && d >= soil * def.soilBaseNumerator / def.soilBaseDenominator;
  return inBase ? def.soilBase : def.soilTop;
}
int TerrainGen::genCaveTopAbs(int worldX) {
  int biome = genBiomeAt(worldX), soil = genSoilDepthAt(worldX, biome);
  return genSurfaceAbs(worldX) + GEN_SKIN + soil + CAVE_SURFACE_BUFFER;
}
int TerrainGen::genCaveBiomeAt(int worldX, int worldY) {
  const PlanetDef& planet = planetDef(E.planetId);
  PlanetGenerationProfile profile = planet.generationProfile;
  CaveBiomeSelectionMode mode =
    biomeGenerationProfileSelection(profile).caveMode;
  if (mode == CBSE_FALLBACK) return CAVE_BIOME_FALLBACK;
  if (mode == CBSE_ABSOLUTE_DEPTH_BANDS) {
    double pick = wfbm2(E.L->gCaveSeed ^ planet.caveBiomeSalt,
                         worldX * .0019, worldY * .0021, 3, .52);
    return selectCaveBiome(profile, worldY >= DEEP_BLEND_TOP, pick);
  }
  if (mode != CBSE_BLENDED_DEPTH_BANDS) __builtin_unreachable();
  if (worldY >= DEEP_BLEND_TOP) {
    double transition = (double)(worldY - DEEP_BLEND_TOP)
                      / (double)(DEEP_BLEND_BOTTOM - DEEP_BLEND_TOP);
    transition = std::fmax(0.0, std::fmin(1.0, transition));
    int bx = floorDiv(worldX, 72), by = floorDiv(worldY, 72);
    if (transition >= 1.0 || whash2(E.L->gCaveSeed ^ 0xD33F810u, bx, by) < transition) {
      double warp = (wfbm2(E.L->gCaveSeed ^ 0xD33F811u,
                            worldX * 0.0011, worldY * 0.0013, 2, 0.5) - 0.5) * 180.0;
      double pick = wfbm2(E.L->gCaveSeed ^ 0xD33F812u,
                           (worldX + warp) * 0.00155, (worldY - warp) * 0.00135, 3, 0.5);
      // fBm clusters around 0.5, so equal numeric quartiles would make the two
      // middle biomes dominate. These calibrated cuts keep all four broad realms
      // common while preserving their smoothly warped borders.
      return selectCaveBiome(profile, true, pick);
    }
  }
  if (worldY < genCaveTopAbs(worldX) + 18) return CAVE_BIOME_FALLBACK;
  double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
  if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
  double wx = worldX + (wfbm2(E.L->gCaveSeed ^ 0xB107u, worldX * 0.0029, worldY * 0.0024, 2, 0.5) - 0.5) * 128.0;
  double wy = worldY + (wfbm2(E.L->gCaveSeed ^ 0xB108u, worldX * 0.0023, worldY * 0.0029, 2, 0.5) - 0.5) * 112.0;
  double pick = wfbm2(E.L->gCaveSeed ^ 0xB109u, wx * 0.00175, wy * 0.00205, 3, 0.5);
  return selectCaveBiome(profile, false, pick);
}
// Caves combine Minecraft-style density fields: broad "cheese" voids plus
// contour-line "spaghetti/noodle" tunnels. Terraria-like detail passes decorate
// the resulting cave floors/walls later, rather than carving independent rooms.
TerrainGen::CaveRegionPlan TerrainGen::cavePlan(int region) {
  uint32_t layerSeed = E.L->gCaveSeed;
  uint32_t key = layerSeed ^ ((uint32_t)region * 0x27d4eb2du);
  CavePlanCacheEntry& cached = cavePlanCache[key & (CAVE_PLAN_CACHE_SIZE - 1)];
  if (cached.seed == layerSeed && cached.region == region) return cached.plan;

  int base = region * CAVE_REGION_WIDTH;
  auto roll = [&](uint32_t salt) { return whash1(layerSeed ^ salt, region); };
  CaveRegionPlan plan;
  int preferredX = base + 40 + (int)(roll(0x101u) * (CAVE_REGION_WIDTH - 80));
  int bestScore = INT_MIN, inward = roll(0x102u) < 0.5 ? -1 : 1;
  // Put the mouth on a real slope when possible: the outside starts on lower
  // ground and the passage heads beneath the higher side of the hill.
  for (int dx = -32; dx <= 32; dx += 8) {
    int candidate = imax(base + 28, imin(base + CAVE_REGION_WIDTH - 28, preferredX + dx));
    int ground = genSurfaceAbs(candidate);
    for (int dir : {-1, 1}) {
      int rise = ground - genSurfaceAbs(candidate + dir * 18);
      int score = rise * 6 - std::abs(dx);
      if (score > bestScore) {
        bestScore = score;
        plan.entryX = candidate;
        inward = dir;
      }
    }
  }
  plan.entryY = genSurfaceAbs(plan.entryX);
  plan.mouthX = plan.entryX + inward * (14 + (int)(roll(0x103u) * 8));
  plan.mouthY = imax(plan.entryY + 5, genSurfaceAbs(plan.mouthX) + 5);
  plan.upperX = imax(base + 24, imin(base + CAVE_REGION_WIDTH - 24,
                    plan.mouthX + inward * (12 + (int)(roll(0x104u) * 20))));
  plan.upperY = imax(plan.mouthY + 24, plan.entryY + 48 + (int)(roll(0x105u) * 30));
  plan.middleX = base + 34 + (int)(roll(0x106u) * (CAVE_REGION_WIDTH - 68));
  plan.middleY = imax(plan.upperY + 54, 196 + (int)(roll(0x107u) * 68));
  plan.deepX = base + 34 + (int)(roll(0x108u) * (CAVE_REGION_WIDTH - 68));
  // The guaranteed upper route ends inside the normal/deep overlap and meets
  // its deep-cavern connector there.
  plan.deepY = imin(CAVE_BOTTOM - 16,
                    imax(plan.middleY + 112,
                         DEEP_BLEND_TOP + 16 + (int)(roll(0x109u) * 64)));

  cached.seed = layerSeed;
  cached.region = region;
  cached.plan = plan;
  return plan;
}

TerrainGen::DeepCavernPlan TerrainGen::deepCavernPlan(int gx, int gy) {
  uint32_t seed = E.L->gCaveSeed ^ 0xD33C400u;
  uint32_t key = seed ^ ((uint32_t)gx * 0x9e3779b9u) ^ ((uint32_t)gy * 0x85ebca6bu);
  DeepPlanCacheEntry& cached = deepPlanCache[key & (DEEP_PLAN_CACHE_SIZE - 1)];
  if (cached.seed == seed && cached.gx == gx && cached.gy == gy) return cached.plan;
  DeepCavernPlan plan;
  int baseX = gx * DEEP_CAVERN_WIDTH;
  int baseY = CAVE_BOTTOM + gy * DEEP_CAVERN_HEIGHT;
  plan.centerX = baseX + DEEP_CAVERN_CENTER_X_MARGIN
               + (int)(whash2(seed ^ 0x01u, gx, gy)
                 * (DEEP_CAVERN_WIDTH - 2 * DEEP_CAVERN_CENTER_X_MARGIN));
  plan.centerY = baseY + DEEP_CAVERN_CENTER_Y_MARGIN
               + (int)(whash2(seed ^ 0x02u, gx, gy)
                 * (DEEP_CAVERN_HEIGHT - 2 * DEEP_CAVERN_CENTER_Y_MARGIN));
  plan.radiusX = DEEP_CAVERN_MIN_RADIUS_X
               + (int)(whash2(seed ^ 0x03u, gx, gy)
                 * DEEP_CAVERN_RADIUS_X_VARIATION);
  plan.radiusY = DEEP_CAVERN_MIN_RADIUS_Y
               + (int)(whash2(seed ^ 0x04u, gx, gy)
                 * DEEP_CAVERN_RADIUS_Y_VARIATION);
  cached.seed = seed;
  cached.gx = gx;
  cached.gy = gy;
  cached.plan = plan;
  return plan;
}

bool TerrainGen::taperedSegmentContains(int x, int y, int ax, int ay, int bx, int by,
                                        double startRadius, double endRadius, uint32_t salt) {
  double reach = std::fmax(startRadius, endRadius) + 1.1;
  if (x < std::min(ax, bx) - reach || x > std::max(ax, bx) + reach
      || y < std::min(ay, by) - reach || y > std::max(ay, by) + reach) return false;
  double vx = bx - ax, vy = by - ay;
  double wx = x - ax, wy = y - ay;
  double vv = vx * vx + vy * vy;
  double t = vv > 0 ? (wx * vx + wy * vy) / vv : 0.0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  double cx = ax + vx * t, cy = ay + vy * t;
  int band = (int)std::floor(t * 12.0);
  double rough = (whash1(E.L->gCaveSeed ^ salt, band) - 0.5) * 2.2;
  double radius = startRadius + (endRadius - startRadius) * t + rough;
  radius = std::fmax(4.5, radius);
  double dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// Every foreground macro-region owns a player-clear route from its surface to
// the deep cave band, plus horizontal links to its neighbours. Noise caves add
// local variety around this connected graph. Background terrain omits the route
// graph and contains only rare enclosed chambers.
bool TerrainGen::descentContains(int x, int y, int ax, int ay, int bx, int by,
                                 uint32_t salt) {
  if (y < ay - 24 || y > by + 24
      || x < std::min(ax, bx) - 82 || x > std::max(ax, bx) + 82) return false;
  int steps = imax(1, (by - ay + 47) / 48);
  auto nodeX = [&](int i) {
    int xAtNode = (int)std::lround(ax + (bx - ax) * ((double)i / steps));
    if (i > 0 && i < steps) xAtNode += (i & 1 ? 1 : -1) *
      (38 + (int)(whash1(E.L->gCaveSeed ^ salt, i) * 20));
    return xAtNode;
  };
  // Only nearby segments can cover this row. The margin includes turning rooms
  // and the full rough tunnel radius, preserving the exact geometric union.
  int first = imax(1, (int)std::floor((y - ay - 24.0) * steps / (by - ay)));
  int last = imin(steps, (int)std::ceil((y - ay + 24.0) * steps / (by - ay)) + 1);
  int previousX = nodeX(first - 1), previousY = ay + (by - ay) * (first - 1) / steps;
  for (int i = first; i <= last; i++) {
    int nextX = nodeX(i);
    int nextY = ay + (by - ay) * i / steps;
    if (taperedSegmentContains(x, y, previousX, previousY, nextX, nextY,
                               10.5, 11.5, salt + i)) return true;
    // Wide turning chambers provide room to land, build, and change direction.
    double dx = (x - nextX) / 23.0, dy = (y - nextY) / 16.0;
    if (dx * dx + dy * dy < 1.0) return true;
    previousX = nextX; previousY = nextY;
  }
  return false;
}

bool TerrainGen::genIsBackboneCave(int worldX, int worldY) {
  if (E.L->isBackground || worldY >= DEEP_BLEND_BOTTOM) return false;
  int region = floorDiv(worldX, CAVE_REGION_WIDTH);
  for (int r = region - 1; r <= region + 1; r++) {
    CaveRegionPlan p = cavePlan(r);
    if (taperedSegmentContains(worldX, worldY, p.entryX, p.entryY,
                               p.mouthX, p.mouthY, 6.5, 7.0, 0xE101u)) return true;
    if (taperedSegmentContains(worldX, worldY, p.mouthX, p.mouthY,
                               p.upperX, p.upperY, 7.0, 9.5, 0xE102u)) return true;
    if (descentContains(worldX, worldY, p.upperX, p.upperY,
                         p.middleX, p.middleY, 0xE103u)) return true;
    if (descentContains(worldX, worldY, p.middleX, p.middleY,
                         p.deepX, p.deepY, 0xE104u)) return true;
    CaveRegionPlan next = cavePlan(r + 1);
    if (taperedSegmentContains(worldX, worldY, p.middleX, p.middleY,
                               next.middleX, next.middleY, 10.5, 10.5, 0xE105u)) return true;
    if (taperedSegmentContains(worldX, worldY, p.deepX, p.deepY,
                               next.deepX, next.deepY, 10.5, 10.5, 0xE106u)) return true;
  }
  return false;
}

bool TerrainGen::genIsDeepCave(int worldX, int worldY) {
  if (worldY < DEEP_BLEND_TOP) return false;
  if (E.L->isBackground) {
    // Upper caves already supply the occasional rounded background recess during
    // the overlap. Below it, keep the abyss wholly solid: monuments provide the
    // visual depth here without paying for or exposing a second tunnel map.
    return false;
  }

  int gx = floorDiv(worldX, DEEP_CAVERN_WIDTH);
  int gy = floorDiv(worldY - CAVE_BOTTOM, DEEP_CAVERN_HEIGHT);
  uint32_t shapeSeed = E.L->gCaveSeed ^ 0xD33C410u;
  auto bentConnectionContains = [&](const DeepCavernPlan& a, const DeepCavernPlan& b,
                                    double startRadius, double endRadius, uint32_t salt) {
    constexpr int MAX_BEND_REACH = 106;
    if (worldX < std::min(a.centerX, b.centerX) - MAX_BEND_REACH
        || worldX > std::max(a.centerX, b.centerX) + MAX_BEND_REACH
        || worldY < std::min(a.centerY, b.centerY) - MAX_BEND_REACH
        || worldY > std::max(a.centerY, b.centerY) + MAX_BEND_REACH) return false;
    double vx = b.centerX - a.centerX, vy = b.centerY - a.centerY;
    double length = std::sqrt(vx * vx + vy * vy);
    double bend = (whash2(shapeSeed ^ salt, a.centerX, a.centerY) - 0.5)
                * std::fmin(92.0, length * 0.42);
    int mx = (a.centerX + b.centerX) / 2
           + (int)std::round(length > 0 ? -vy / length * bend : 0.0);
    int my = (a.centerY + b.centerY) / 2
           + (int)std::round(length > 0 ? vx / length * bend : 0.0);
    double midRadius = (startRadius + endRadius) * 0.58;
    return taperedSegmentContains(worldX, worldY, a.centerX, a.centerY, mx, my,
                                  startRadius, midRadius, salt)
        || taperedSegmentContains(worldX, worldY, mx, my, b.centerX, b.centerY,
                                  midRadius, endRadius, salt ^ 0x9e3779b9u);
  };
  for (int yy = imax(0, gy - 1); yy <= gy + 1; yy++) {
    for (int xx = gx - 1; xx <= gx + 1; xx++) {
      DeepCavernPlan plan = deepCavernPlan(xx, yy);
      int dx = worldX - plan.centerX, dy = worldY - plan.centerY;
      if (std::abs(dx) <= plan.radiusX + 18 && std::abs(dy) <= plan.radiusY + 18) {
        double warpX = (valueNoise2D(shapeSeed ^ 0x51u, worldX * 0.018, worldY * 0.021) - 0.5) * 24.0;
        double warpY = (valueNoise2D(shapeSeed ^ 0x52u, worldX * 0.020, worldY * 0.017) - 0.5) * 20.0;
        double nx = (dx + warpX) / (double)plan.radiusX;
        double ny = (dy + warpY) / (double)plan.radiusY;
        double rough = valueNoise2D(shapeSeed ^ ((uint32_t)xx * 0x9e3779b9u)
                                              ^ ((uint32_t)yy * 0x85ebca6bu),
                                    worldX * 0.027, worldY * 0.033);
        if (nx * nx + ny * ny <= 0.91 + (rough - 0.5) * 0.56) return true;

        // Two smaller offset lobes break the repeated oval silhouette while
        // remaining part of the same navigable chamber.
        for (int lobe = 0; lobe < 2; lobe++) {
          int lx = plan.centerX + (int)((whash2(shapeSeed ^ (0x60u + lobe), xx, yy) - 0.5)
                                        * plan.radiusX * 0.95);
          int ly = plan.centerY + (int)((whash2(shapeSeed ^ (0x70u + lobe), xx, yy) - 0.5)
                                        * plan.radiusY * 0.85);
          double lnx = (worldX - lx) / (plan.radiusX * (0.42 + lobe * 0.08));
          double lny = (worldY - ly) / (plan.radiusY * (0.50 - lobe * 0.06));
          if (lnx * lnx + lny * lny < 1.0) return true;
        }
      }

      // Every chamber connects to its right and lower neighbours. The jittered
      // centers and unequal radii hide the lattice while guaranteeing that the
      // abyss remains one navigable cavern system at arbitrary depth.
      DeepCavernPlan right = deepCavernPlan(xx + 1, yy);
      uint32_t rightSalt = 0xD33C420u ^ ((uint32_t)xx * 0x45d9f3bu) ^ ((uint32_t)yy * 0x119de1f3u);
      if (bentConnectionContains(plan, right, 8.5, 10.5, rightSalt)) return true;
      DeepCavernPlan below = deepCavernPlan(xx, yy + 1);
      uint32_t belowSalt = 0xD33C421u ^ ((uint32_t)xx * 0x27d4eb2du) ^ ((uint32_t)yy * 0x165667b1u);
      if (bentConnectionContains(plan, below, 9.5, 11.5, belowSalt)) return true;
    }
  }

  // Broad warped hollows dissolve the graph's underlying lattice and continue
  // the noisy upper-cave language into the abyss.
  double warp = (valueNoise2D(shapeSeed ^ 0x80u, worldX * 0.0048, worldY * 0.0041) - 0.5) * 110.0;
  double hollow = wfbm2(shapeSeed ^ 0x81u,
                         (worldX + warp) * 0.0038, (worldY - warp) * 0.0032, 2, 0.5);
  if (hollow > 0.700) return true;

  // The upper cave backbone and first deep chamber row share an overlapping,
  // player-clear connector.
  int region = floorDiv(worldX, CAVE_REGION_WIDTH);
  for (int r = region - 1; r <= region; r++) {
    CaveRegionPlan upper = cavePlan(r);
    DeepCavernPlan lower = deepCavernPlan(floorDiv(upper.deepX, DEEP_CAVERN_WIDTH), 0);
    uint32_t salt = 0xD33C430u ^ ((uint32_t)r * 0x9e3779b9u);
    DeepCavernPlan upperPoint{upper.deepX, upper.deepY, 0, 0};
    if (bentConnectionContains(upperPoint, lower, 6.4, 11.5, salt)) return true;
  }
  return false;
}

bool TerrainGen::genIsEntranceWall(int worldX, int worldY) {
  if (E.L->isBackground) return false;
  int localSurface = genSurfaceAbs(worldX);
  if (worldY < localSurface - 2 || worldY > localSurface + 120) return false;
  int region = floorDiv(worldX, CAVE_REGION_WIDTH);
  for (int r = region - 1; r <= region; r++) {
    CaveRegionPlan p = cavePlan(r);
    if (worldY < p.entryY - 1 || worldY > p.entryY + 22) continue;
    bool outer = taperedSegmentContains(worldX, worldY, p.entryX, p.entryY,
                                         p.mouthX, p.mouthY, 8.5, 9.0, 0xE101u);
    bool inner = taperedSegmentContains(worldX, worldY, p.entryX, p.entryY,
                                         p.mouthX, p.mouthY, 6.5, 7.0, 0xE101u);
    // The stone sleeve occupies only solid terrain, leaving junctions with the
    // adjoining backbone segment fully open.
    if (outer && !inner && !genOpenCaveAt(worldX, worldY)) return true;
  }
  return false;
}

bool TerrainGen::genIsCave(int worldX, int worldY) {
  PlanetGenerationProfile profile = planetDef(E.planetId).generationProfile;
  if (profile == PGP_SHIP) return false;
  if (profile == PGP_MOON || profile == PGP_MARS) {
    uint32_t seed = E.L->gCaveSeed ^ (E.L->isBackground ? 0x80000000u : 0u);
    uint32_t key = seed ^ ((uint32_t)worldX * 0x85ebca6bu)
      ^ ((uint32_t)worldY * 0xc2b2ae35u);
    CaveCacheEntry& cached = caveCache[key & (CAVE_CACHE_SIZE - 1)];
    if (cached.seed == seed && cached.x == worldX && cached.y == worldY)
      return cached.value != 0;

    bool result = !E.L->isBackground && genIsBackboneCave(worldX, worldY);
    if (!result) {
      double warp = (valueNoise2D(seed ^ 0x771u,
        worldX * 0.006, worldY * 0.005) - 0.5) * 46.0;
      if (profile == PGP_MOON) {
        double tube = std::fabs(valueNoise2D(seed ^ 0x772u,
          (worldX + warp) * 0.012, worldY * 0.0065) - 0.5);
        double chamber = wfbm2(seed ^ 0x773u,
          worldX * 0.0062, worldY * 0.0054, 2, 0.52);
        result = E.L->isBackground
          ? chamber > 0.815
          : tube < 0.048 || chamber > 0.755;
      } else if (profile == PGP_MARS) {
        double canyon = std::fabs(valueNoise2D(seed ^ 0x774u,
          (worldX + warp) * 0.007, worldY * 0.014) - 0.5);
        double chamber = wfbm2(seed ^ 0x775u,
          worldX * 0.0055, worldY * 0.0068, 2, 0.52);
        result = E.L->isBackground
          ? chamber > 0.805
          : canyon < 0.062 || chamber > 0.748;
      }
    }
    cached.seed = seed;
    cached.x = worldX;
    cached.y = worldY;
    cached.value = result ? 1 : 0;
    return result;
  }
  if (profile != PGP_EARTH) __builtin_unreachable();
  uint32_t seed = E.L->gCaveSeed ^ (E.L->isBackground ? 0x80000000u : 0u);
  uint32_t key = seed ^ ((uint32_t)worldX * 0x85ebca6bu) ^ ((uint32_t)worldY * 0xc2b2ae35u);
  CaveCacheEntry& cached = caveCache[key & (CAVE_CACHE_SIZE - 1)];
  if (cached.seed == seed && cached.x == worldX && cached.y == worldY) return cached.value != 0;

  constexpr int UPPER_CAVE_FADE_BOTTOM = DEEP_BLEND_BOTTOM + 160;
  constexpr int BACKGROUND_FADE_TOP = DEEP_BLEND_TOP - 224;
  constexpr int BACKGROUND_SOLID_Y = DEEP_BLEND_TOP;
  bool result = false;
  if (E.L->isBackground && worldY < BACKGROUND_SOLID_Y) {
    // Rare background recesses stay inside separated lattice cells, bounding
    // their size and preventing neighbouring voids from merging into broad cuts.
    constexpr int CELL_W = 128, CELL_H = 112;
    int gx = floorDiv(worldX, CELL_W), gy = floorDiv(worldY, CELL_H);
    uint32_t chamberSeed = E.L->gCaveSeed ^ 0xBACC610u;
    if (whash2(chamberSeed ^ 0x01u, gx, gy) < 0.12) {
      int cx = gx * CELL_W + CELL_W / 2
             + (int)std::lround((whash2(chamberSeed ^ 0x02u, gx, gy) - 0.5) * 32.0);
      int cy = gy * CELL_H + CELL_H / 2
             + (int)std::lround((whash2(chamberSeed ^ 0x03u, gx, gy) - 0.5) * 28.0);
      double radiusX = 14.0 + whash2(chamberSeed ^ 0x04u, gx, gy) * 14.0;
      double radiusY = 11.0 + whash2(chamberSeed ^ 0x05u, gx, gy) * 13.0;
      double nx = (worldX - cx) / radiusX;
      double ny = (worldY - cy) / radiusY;
      double shear = (whash2(chamberSeed ^ 0x06u, gx, gy) - 0.5) * 0.45;
      double curve = (whash2(chamberSeed ^ 0x09u, gx, gy) - 0.5) * 0.55;
      nx += ny * shear + (ny * ny - 0.35) * curve;
      double rough = (valueNoise2D(chamberSeed ^ 0x07u, worldX * 0.055, worldY * 0.055) - 0.5) * 0.62
                   + (valueNoise2D(chamberSeed ^ 0x08u, worldX * 0.130, worldY * 0.110) - 0.5) * 0.28;
      double notchSide = whash2(chamberSeed ^ 0x0Au, gx, gy) < 0.5 ? -1.0 : 1.0;
      double notchY = (whash2(chamberSeed ^ 0x0Bu, gx, gy) - 0.5) * 0.70;
      double notchX = nx - notchSide * 0.82, notchDy = ny - notchY;
      bool notch = notchX * notchX + notchDy * notchDy < 0.13;
      // Recesses taper out before the upper/deep overlap, leaving its background
      // continuously solid.
      double solidify = std::fmax(0.0, std::fmin(1.0,
        (double)(worldY - BACKGROUND_FADE_TOP)
        / (double)(BACKGROUND_SOLID_Y - BACKGROUND_FADE_TOP)));
      result = !notch && nx * nx + ny * ny < (0.78 + rough) * (1.0 - solidify);
    }
  } else if (!E.L->isBackground && worldY < DEEP_BLEND_BOTTOM) {
    result = genIsBackboneCave(worldX, worldY);
  }
  if (!result && worldY < UPPER_CAVE_FADE_BOTTOM && !E.L->isBackground) {
    double warpX = (wfbm2(E.L->gCaveSeed ^ 0xCA71u, worldX * 0.010, worldY * 0.010, 1, 0.5) - 0.5) * 18.0;
    double warpY = (wfbm2(E.L->gCaveSeed ^ 0xCA72u, worldX * 0.009, worldY * 0.011, 1, 0.5) - 0.5) * 14.0;
    double sx = worldX + warpX, sy = worldY + warpY;
    double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
    if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
    double cheese = wfbm2(E.L->gCaveSeed ^ 0x55u, sx * CAVE_FREQ * 0.52, sy * CAVE_FREQ * 0.42, 3, 0.5);
    double spaghetti = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x5A6Eu, sx * CAVE_FREQ * 1.55, sy * CAVE_FREQ * 0.82, 2, 0.5) - 0.5);
    double chamberThresh = 0.710 - depthFrac * 0.025;
    double spaghettiWidth = 0.048 + depthFrac * 0.012;
    double deepFade = std::fmax(0.0, std::fmin(1.0,
      (double)(worldY - DEEP_BLEND_TOP) / (double)(UPPER_CAVE_FADE_BOTTOM - DEEP_BLEND_TOP)));
    chamberThresh += deepFade * 0.13;
    spaghettiWidth *= 1.0 - deepFade * 0.78;
    result = cheese > chamberThresh || spaghetti < spaghettiWidth;
  }
  if (!result && worldY >= DEEP_BLEND_TOP) result = genIsDeepCave(worldX, worldY);
  cached.seed = seed;
  cached.x = worldX;
  cached.y = worldY;
  cached.value = result ? 1 : 0;
  return result;
}
bool TerrainGen::genOpenCaveAt(int worldX, int worldY) {
  PlanetGenerationProfile profile = planetDef(E.planetId).generationProfile;
  if (profile == PGP_MOON || profile == PGP_MARS || profile == PGP_SHIP) {
    int surface = genSurfaceAbs(worldX);
    if (!E.L->isBackground && worldY >= surface
        && genIsBackboneCave(worldX, worldY)) return true;
    return worldY >= surface + 12 && genIsCave(worldX, worldY);
  }
  if (profile != PGP_EARTH) __builtin_unreachable();
  if (!E.L->isBackground && worldY >= genSurfaceAbs(worldX) && genIsBackboneCave(worldX, worldY)) return true;
  return worldY >= genCaveTopAbs(worldX) && genIsCave(worldX, worldY);
}
// Solid stone that sits one cell from a carved cave (a cave-wall surface). Pure
// noise (samples genIsCave at the 4 neighbours), so it stays deterministic. The
// caller has already checked this cell is in the carved cave zone and is stone.
bool TerrainGen::genIsCaveWall(int worldX, int worldY) {
  return genIsCave(worldX + 1, worldY) || genIsCave(worldX - 1, worldY)
      || genIsCave(worldX, worldY + 1) || genIsCave(worldX, worldY - 1);
}
// Ore veins: sparse winding clusters of ore embedded in the deep stone (returns
// STONE where there's no vein). Pure in (seed, worldX, worldY) so prefetch stays
// byte-identical; ore is solid-in-solid so it's inert and grounds like stone.
// Biome + depth bias WHICH ore. gPocketSeed is per-layer (fg only places ore).
uint8_t TerrainGen::genOreFor(int biome, int worldX, int worldY) {
  int depth = worldY - genSurfaceAbs(worldX);
  if (depth < 18) return STONE;

  // Two compact starter lodes near the original spawn make the first upgrades
  // dependable without flattening the broader geological distribution.
  for (int i = 0; i < 2; i++) {
    uint32_t salt = 0x57A27000u + (uint32_t)i * 0x101u;
    int cx = -112 + i * 128 + (int)(whash1(E.L->worldSeed ^ salt, i) * 72);
    int cy = genSurfaceAbs(cx) + 34 + i * 24;
    double dx = (worldX - cx) / (i == 0 ? 13.0 : 11.0);
    double dy = (worldY - cy) / 7.0;
    if (dx * dx + dy * dy <= 1.0) return i == 0 ? COAL_ORE : COPPER_ORE;
  }

  double v = wridged2(E.L->gPocketSeed ^ 0x0a5eu, worldX * ORE_FREQ, worldY * ORE_FREQ, 2, 0.5);
  double depth01 = std::fmax(0.0, std::fmin(1.0, (depth - 24) / 480.0));
  if (v < ORE_THRESH - depth01 * 0.025) return STONE;
  double sel = wfbm2(E.L->gPocketSeed ^ 0x5e1eu, worldX * ORE_FREQ * 0.7, worldY * ORE_FREQ * 0.7, 2, 0.5);
  double geology = wfbm2(E.L->worldSeed ^ 0x6E0106u, worldX * 0.0017, worldY * 0.0012, 3, 0.5);
  if (depth > 300 && sel > 0.88 - depth01 * 0.08 && geology > 0.48) return GOLD_ORE;
  if (depth > 105 && sel > 0.57 - depth01 * 0.16 + (geology < 0.42 ? 0.08 : 0.0)) return IRON_ORE;
  if (depth > 38 && (sel > 0.40 || geology > 0.62
                     || surfaceBiomeDef(biome).copperRich)) return COPPER_ORE;
  return COAL_ORE;
}
// CAVE_BOTTOM is the midpoint of the broad normal/deep transition and the
// reference depth for progression and structure placement.
int TerrainGen::caveBottomAbs() { return CAVE_BOTTOM; }

uint8_t TerrainGen::genDeepRockAt(int worldX, int worldY) {
  if (worldY < DEEP_BLEND_TOP) return STONE;
  if (worldY >= DEEP_BLEND_BOTTOM) return DEEPSTONE;

  // A slowly wandering boundary and 2x2 rock patches distribute mixed strata
  // across 224 vertical cells. Stone islands taper out with increasing depth.
  int bx = floorDiv(worldX, 32);
  double tx = (double)(worldX - bx * 32) / 32.0;
  double boundaryNoise = wlerp(whash1(E.L->worldSeed ^ 0xD33A001u, bx),
                               whash1(E.L->worldSeed ^ 0xD33A001u, bx + 1),
                               wfade(tx));
  double boundary = CAVE_BOTTOM + (boundaryNoise - 0.5) * 88.0;
  double mix = (worldY - (boundary - 112.0)) / 224.0;
  mix = std::fmax(0.0, std::fmin(1.0, mix));
  double patch = whash2(E.L->worldSeed ^ 0xD33A002u,
                        floorDiv(worldX, 2), floorDiv(worldY, 2));
  return patch < mix ? DEEPSTONE : STONE;
}
uint8_t TerrainGen::genCellAt(int worldX, int surf, int slope, int biome, int soil, int y) {
  const PlanetDef& planet = planetDef(E.planetId);
  PlanetGenerationProfile profile = planet.generationProfile;
  if (profile == PGP_SHIP) return EMPTY;
  if (profile == PGP_MOON || profile == PGP_MARS) {
    if (y < surf) return EMPTY;
    int depth = y - surf;
    int worldY = E.L->worldOffsetY + y;
    if (genOpenCaveAt(worldX, worldY)) return EMPTY;
    int bx = floorDiv(worldX, 2), by = floorDiv(worldY, 2);
    double pocket = whash2(E.L->gPocketSeed ^ 0x0FF0123u, bx, by);
    const OffworldBiomeDef& planetBiome =
      offworldBiomeDef(planet.offworldMaterialProfile, biome);
    auto pocketMatches = [&](double cut, bool above) {
      return above ? pocket > cut : pocket < cut;
    };
    if (profile == PGP_MOON) {
      if (depth == 0)
        return slope <= 3 ? planetBiome.surfaceFlat : planetBiome.surfaceSteep;
      if (depth < 7) {
        if (planetBiome.shallowOverride != EMPTY
            && depth < planetBiome.overrideDepth)
          return planetBiome.shallowOverride;
        if (planetBiome.shallowPocket != EMPTY
            && pocketMatches(planetBiome.shallowPocketCut,
                             planetBiome.shallowPocketAbove))
          return planetBiome.shallowPocket;
        return planetBiome.shallow;
      }
      if (!E.L->isBackground && depth > 42 && pocket > 0.996) return ICE;
      if (!E.L->isBackground && depth > 70 && pocket < 0.003) return CRYSTAL;
      if (!E.L->isBackground && depth > 120 && pocket > 0.991) return IRON_ORE;
      if (!E.L->isBackground && planetBiome.deepPocket != EMPTY
          && depth > planetBiome.deepPocketMinDepth
          && pocketMatches(planetBiome.deepPocketCut,
                           planetBiome.deepPocketAbove))
        return planetBiome.deepPocket;
      return worldY >= DEEP_BLEND_BOTTOM ? DEEPSTONE : STONE;
    }
    if (profile != PGP_MARS) __builtin_unreachable();
    if (depth == 0)
      return slope <= 3 ? planetBiome.surfaceFlat : planetBiome.surfaceSteep;
    if (depth < 6) {
      if (planetBiome.shallowOverride != EMPTY
          && depth < planetBiome.overrideDepth)
        return planetBiome.shallowOverride;
      if (planetBiome.shallowPocket != EMPTY
          && pocketMatches(planetBiome.shallowPocketCut,
                           planetBiome.shallowPocketAbove))
        return planetBiome.shallowPocket;
      return planetBiome.shallow;
    }
    if (depth < 16) return planetBiome.crust;
    if (!E.L->isBackground && depth > 55 && pocket > 0.996) return ICE;
    if (!E.L->isBackground && depth > 85 && pocket < 0.004) return IRON_ORE;
    if (!E.L->isBackground && depth > 150 && pocket > 0.993) return GOLD_ORE;
    if (!E.L->isBackground && planetBiome.deepPocket != EMPTY
        && depth > planetBiome.deepPocketMinDepth
        && pocketMatches(planetBiome.deepPocketCut,
                         planetBiome.deepPocketAbove))
      return planetBiome.deepPocket;
    return worldY >= DEEP_BLEND_BOTTOM ? DEEPSTONE : STONE;
  }
  if (profile != PGP_EARTH) __builtin_unreachable();
  int sea = E.L->gSeaRow - E.L->worldOffsetY;       // sea level as a buffer row (gSeaRow is absolute)
  if (y < surf) {
    // above the terrain: a valley below the sea row floods with water (a flat,
    // contained ocean that settles); the foreground holds the water, the
    // background is a solid wall behind it. Otherwise it's open sky.
    if (y >= sea) return WATER; // water continues into the background instead of an opaque stone wall
    return EMPTY;
  }
  int depth = y - surf;
  int worldY = E.L->worldOffsetY + y;             // absolute depth for the cave/underworld zones
  bool underwater = surf > sea;
  // A two-cell stone sleeve keeps loose biome mantles from collapsing sideways
  // into the foreground's player-clear surface route.
  if (genIsEntranceWall(worldX, worldY)) return STONE;
  // Natural entrances carve their backbone through the dry surface mantle. The
  // later cave check still opens underground caves beneath oceans without
  // piercing the seabed.
  if (!underwater && depth < GEN_SKIN + soil + CAVE_SURFACE_BUFFER
      && genOpenCaveAt(worldX, worldY)) return EMPTY;
  // Both layers share the visible skin + soil mantle. Matching strata prevent
  // gaps in foreground dirt/sand from exposing an unrelated stone backdrop.
  if (depth < GEN_SKIN) return genSkinMat(biome, slope, underwater);
  if (depth < GEN_SKIN + soil) return underwater ? STONE : genSoilMat(biome, depth - GEN_SKIN, soil); // solid under oceans
  // A thick solid stone buffer separates the loose soil (and any ocean floor)
  // from the cave zone, so generated sand never rests directly over a cave and
  // oceans can't drain into one (both churn the cross-layer transfer forever).
  int caveTop = GEN_SKIN + soil + CAVE_SURFACE_BUFFER;
  if (genOpenCaveAt(worldX, worldY)) return EMPTY;
  // Background caves are intentionally sparse and inert: no generated
  // liquids/ores/features, only voids that create visual depth and transfer paths.
  uint8_t rock = genDeepRockAt(worldX, worldY);
  if (E.L->isBackground) return rock;
  // Cave-wall lining is intentionally sparse. Whole-biome component walls look
  // rich, but they create enormous static components; structures carry most of
  // the biome identity instead.
  if (depth >= caveTop && genIsCaveWall(worldX, worldY)) {
    int caveBiome = genCaveBiomeAt(worldX, worldY);
    const CaveBiomeDef& caveDef = caveBiomeDef(caveBiome);
    double detail = whash2(E.L->gCaveSeed ^ 0x305bu, worldX, worldY);
    if (caveDef.wallAccent != EMPTY && detail > caveDef.wallAccentCut)
      return caveDef.wallAccent;
    if (caveDef.wallTendrilMaterial != EMPTY) {
      double tendril = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x4d79u, worldX * 0.035, worldY * 0.050, 2, 0.5) - 0.5);
      if (detail > caveDef.wallTendrilDetailCut
          && tendril < caveDef.wallTendrilNoiseCut)
        return caveDef.wallTendrilMaterial;
    }
    // Crystal specks stud cave walls in EVERY biome (densest in the crystal
    // biome), so lone 1x1 crystals are common outside the salt caverns too.
    // Non-crystal caves receive extra glints for ambient light.
    if (detail > caveDef.crystalCut) return CRYSTAL;
    double moss = wfbm2(E.L->gCaveSeed ^ 0x305au, worldX * 0.02, worldY * 0.02, 2, 0.5);
    if (moss > 0.74 && detail > 0.88) return MOSS;
  }
  // Mycelium doesn't only cling to the cave surface — in a mushroom biome it also
  // threads THROUGH the surrounding solid stone as embedded veins (like ore), so a
  // dug wall reveals fungal rock, not just a mossy skin.
  if (depth >= caveTop && worldY < DEEP_BLEND_BOTTOM) {
    double vein = wridged2(E.L->gCaveSeed ^ 0x4d80u, worldX * 0.045, worldY * 0.055, 2, 0.5);
    const CaveBiomeDef& caveDef = caveBiomeDef(
      genCaveBiomeAt(worldX, worldY));
    if (caveDef.embeddedVeinMaterial != EMPTY
        && vein > caveDef.embeddedVeinCut)
      return caveDef.embeddedVeinMaterial;
  }
  uint8_t ore = genOreFor(biome, worldX, worldY);
  return ore == STONE ? rock : ore;                       // preserve ores across the rock transition
}
// Per-biome tree density. Forest/jungle dense; plains/tundra/swamp sparser;
// desert sparse (cacti); rocky bare.
double TerrainGen::genTreeProb(int biome) {
  return TREE_PROB * surfaceBiomeDef(biome).treeProbabilityScale;
}
// Flora species for a surface tree column: a pure function of biome + worldX, so
// both layers agree and the species is recoverable from the stamped wood material.
uint8_t TerrainGen::pickTreeType(int biome, int worldX) {
  double r = whash1(E.L->gTreeSeed ^ 0x7ee7u, worldX);
  const SurfaceBiomeDef& def = surfaceBiomeDef(biome);
  return r < def.treeFirstCut ? def.treeFirst
       : r < def.treeSecondCut ? def.treeSecond : def.treeThird;
}
bool TerrainGen::genTreeAt(int worldX, int surf) {
  if (surf >= E.L->gSeaRow - E.L->worldOffsetY) return false;  // at/under water -> no trees
  return whash1(E.L->gTreeSeed, worldX) < genTreeProb(genBiomeAt(worldX));
}
