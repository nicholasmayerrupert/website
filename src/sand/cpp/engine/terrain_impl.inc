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

// Continuous temperature, moisture, altitude, and ruggedness fields choose the
// raw biome. Height itself remains biome-independent, avoiding unstable material
// cliffs where climates meet.
int TerrainGen::classifyBiomeAt(int worldX) {
  double temperature = genTemperatureAt(worldX);
  double moisture = genMoistureAt(worldX);
  int surface = genSurfaceAbs(worldX);
  double altitude = std::fmax(0.0, (double)(SEA_LEVEL - surface) / 92.0);
  double rugged = wridged2(E.L->worldSeed ^ 0xB10B12u, worldX * BIOME_FREQ * 2.2, 4.0, 3, 0.52);

  if ((altitude > 0.28 && rugged > 0.58) || (altitude > 0.52 && temperature > 0.27)) return BIOME_ROCKY;
  if (temperature < 0.29 || (altitude > 0.34 && temperature < 0.45)) return BIOME_TUNDRA;
  if (moisture < 0.31 && temperature > 0.43) return BIOME_DESERT;
  if (moisture > 0.72 && surface > SEA_LEVEL - 20 && temperature > 0.38) return BIOME_SWAMP;
  if (temperature > 0.62 && moisture > 0.57) return BIOME_JUNGLE;
  if (moisture > 0.51) return BIOME_FOREST;
  return BIOME_PLAINS;
}

// Ecotones occupy a narrow band around raw climate boundaries. Four-column
// deterministic patches borrow the neighbouring biome, producing a readable
// transition without per-pixel speckle or a single hard material seam.
int TerrainGen::genBiomeAt(int worldX) {
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
  double peaks = -highland * ridges * SURFACE_AMPLITUDE * 0.70;
  int value = (int)std::lround(macro - (n - 0.5) * 2 * amp + peaks
                             + (cuts - 0.45) * SURFACE_AMPLITUDE * 0.18);
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
  if (biome == BIOME_ROCKY) return 0;            // bare stone (stays one connected mass)
  if (biome == BIOME_DESERT) return E.L->gSoil * 3; // deep sand
  if (biome == BIOME_JUNGLE) return E.L->gSoil + 3; // thick lush mantle
  return E.L->gSoil + 2;                            // plains / forest / tundra / swamp
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
  switch (biome) {
    case BIOME_ROCKY:  return STONE;
    case BIOME_DESERT: return SAND;
    case BIOME_TUNDRA: return SNOW;            // snow blanket over the dirt mantle
    case BIOME_SWAMP:  return slope <= 2 ? GRASS : MUD;
    default:           return slope <= 2 ? GRASS : SAND; // plains/forest/jungle: grass on gentle, sand on steeps
  }
}
// Material of the mantle between the surface skin and deep stone. `d` is depth
// within the soil band.
uint8_t TerrainGen::genSoilMat(int biome, int d, int soil) {
  switch (biome) {
    case BIOME_DESERT: return d >= soil * 2 / 3 ? SANDSTONE : SAND; // sand over a sandstone base
    case BIOME_SWAMP:  return MUD;
    case BIOME_ROCKY:  return STONE;
    default:           return DIRT; // plains / forest / tundra / jungle
  }
}
int TerrainGen::genCaveTopAbs(int worldX) {
  int biome = genBiomeAt(worldX), soil = genSoilDepthAt(worldX, biome);
  return genSurfaceAbs(worldX) + GEN_SKIN + soil + CAVE_SURFACE_BUFFER;
}
int TerrainGen::genCaveBiomeAt(int worldX, int worldY) {
  if (worldY < genCaveTopAbs(worldX) + 18 || worldY >= caveBottomAbs()) return CAVE_DEFAULT;
  double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
  if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
  double wx = worldX + (wfbm2(E.L->gCaveSeed ^ 0xB107u, worldX * 0.0029, worldY * 0.0024, 2, 0.5) - 0.5) * 128.0;
  double wy = worldY + (wfbm2(E.L->gCaveSeed ^ 0xB108u, worldX * 0.0023, worldY * 0.0029, 2, 0.5) - 0.5) * 112.0;
  double pick = wfbm2(E.L->gCaveSeed ^ 0xB109u, wx * 0.00175, wy * 0.00205, 3, 0.5);
  // Three broad cave-biome families plus sparse unthemed caves.
  if (pick < 0.10) return CAVE_DEFAULT;
  if (pick < 0.40) return CAVE_CRYSTAL;
  if (pick < 0.70) return CAVE_MUSHROOM;
  return CAVE_LUSH;
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
  plan.deepY = imin(CAVE_BOTTOM - 32, imax(plan.middleY + 92, 414 + (int)(roll(0x109u) * 78)));

  cached.seed = layerSeed;
  cached.region = region;
  cached.plan = plan;
  return plan;
}

bool TerrainGen::segmentContains(int x, int y, int ax, int ay, int bx, int by, double radius) {
  double vx = bx - ax, vy = by - ay;
  double wx = x - ax, wy = y - ay;
  double vv = vx * vx + vy * vy;
  double t = vv > 0 ? (wx * vx + wy * vy) / vv : 0.0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  double dx = x - (ax + vx * t), dy = y - (ay + vy * t);
  return dx * dx + dy * dy <= radius * radius;
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
// variety around this graph; they are no longer responsible for connectivity.
// The background deliberately has no route graph: rare chambers there remain
// visual pockets instead of revealing the foreground topology as straight lines.
bool TerrainGen::genIsBackboneCave(int worldX, int worldY) {
  if (E.L->isBackground || worldY >= CAVE_BOTTOM) return false;
  int region = floorDiv(worldX, CAVE_REGION_WIDTH);
  for (int r = region - 1; r <= region; r++) {
    CaveRegionPlan p = cavePlan(r);
    if (taperedSegmentContains(worldX, worldY, p.entryX, p.entryY,
                               p.mouthX, p.mouthY, 4.8, 5.8, 0xE101u)) return true;
    if (taperedSegmentContains(worldX, worldY, p.mouthX, p.mouthY,
                               p.upperX, p.upperY, 5.8, 6.6, 0xE102u)) return true;
    if (taperedSegmentContains(worldX, worldY, p.upperX, p.upperY,
                               p.middleX, p.middleY, 6.6, 5.8, 0xE103u)) return true;
    if (taperedSegmentContains(worldX, worldY, p.middleX, p.middleY,
                               p.deepX, p.deepY, 5.8, 6.4, 0xE104u)) return true;
    CaveRegionPlan next = cavePlan(r + 1);
    if (taperedSegmentContains(worldX, worldY, p.middleX, p.middleY,
                               next.middleX, next.middleY, 5.6, 5.6, 0xE105u)) return true;
    if ((r & 1) == 0 &&
        taperedSegmentContains(worldX, worldY, p.deepX, p.deepY,
                               next.deepX, next.deepY, 6.0, 6.0, 0xE106u)) return true;
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
                                         p.mouthX, p.mouthY, 6.5, 7.2, 0xE101u);
    bool inner = taperedSegmentContains(worldX, worldY, p.entryX, p.entryY,
                                         p.mouthX, p.mouthY, 4.8, 5.8, 0xE101u);
    if (outer && !inner) return true;
  }
  return false;
}

bool TerrainGen::genIsCave(int worldX, int worldY) {
  uint32_t seed = E.L->gCaveSeed ^ (E.L->isBackground ? 0x80000000u : 0u);
  uint32_t key = seed ^ ((uint32_t)worldX * 0x85ebca6bu) ^ ((uint32_t)worldY * 0xc2b2ae35u);
  CaveCacheEntry& cached = caveCache[key & (CAVE_CACHE_SIZE - 1)];
  if (cached.seed == seed && cached.x == worldX && cached.y == worldY) return cached.value != 0;

  bool result = false;
  if (E.L->isBackground) {
    // Background terrain is a backdrop, not a second tunnel map. One broad
    // density field produces occasional enclosed chambers without spaghetti,
    // noodles, shafts, or graph segments.
    double warpX = (wfbm2(E.L->gCaveSeed ^ 0xCA71u, worldX * 0.006, worldY * 0.006, 1, 0.5) - 0.5) * 14.0;
    double warpY = (wfbm2(E.L->gCaveSeed ^ 0xCA72u, worldX * 0.006, worldY * 0.006, 1, 0.5) - 0.5) * 12.0;
    double chamber = wfbm2(E.L->gCaveSeed ^ 0x55u,
                           (worldX + warpX) * CAVE_FREQ * 0.38,
                           (worldY + warpY) * CAVE_FREQ * 0.34, 3, 0.5);
    result = chamber > 0.825;
  } else {
    result = genIsBackboneCave(worldX, worldY);
  }
  if (!result && !E.L->isBackground) {
    double warpX = (wfbm2(E.L->gCaveSeed ^ 0xCA71u, worldX * 0.010, worldY * 0.010, 1, 0.5) - 0.5) * 18.0;
    double warpY = (wfbm2(E.L->gCaveSeed ^ 0xCA72u, worldX * 0.009, worldY * 0.011, 1, 0.5) - 0.5) * 14.0;
    double sx = worldX + warpX, sy = worldY + warpY;
    double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
    if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
    double cheese = wfbm2(E.L->gCaveSeed ^ 0x55u, sx * CAVE_FREQ * 0.52, sy * CAVE_FREQ * 0.42, 3, 0.5);
    double spaghetti = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x5A6Eu, sx * CAVE_FREQ * 1.55, sy * CAVE_FREQ * 0.82, 2, 0.5) - 0.5);
    double noodle = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x7A6Eu, sx * CAVE_FREQ * 2.8, sy * CAVE_FREQ * 1.9, 1, 0.5) - 0.5);
    double shaft = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x5A7Fu, sx * CAVE_FREQ * 0.80, sy * CAVE_FREQ * 2.20, 1, 0.5) - 0.5);
    double chamberThresh = 0.755 - depthFrac * 0.075;
    double spaghettiWidth = 0.075 + depthFrac * 0.026;
    double noodleWidth = 0.044 + depthFrac * 0.014;
    double shaftWidth = 0.052 + depthFrac * 0.012;
    result = cheese > chamberThresh || spaghetti < spaghettiWidth || noodle < noodleWidth || shaft < shaftWidth;
  }
  cached.seed = seed;
  cached.x = worldX;
  cached.y = worldY;
  cached.value = result ? 1 : 0;
  return result;
}
bool TerrainGen::genOpenCaveAt(int worldX, int worldY) {
  if (worldY >= caveBottomAbs()) return false;
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
  if (depth > 38 && (sel > 0.40 || geology > 0.62 || biome == BIOME_DESERT || biome == BIOME_JUNGLE)) return COPPER_ORE;
  return COAL_ORE;
}
// Canonical absolute-world depth zones. Below the underworld top the world stays
// stone + lava forever: surface -> caves -> deep ore -> underworld lava.
int TerrainGen::caveBottomAbs() { return CAVE_BOTTOM; }
int TerrainGen::underworldAbs() { return UNDERWORLD_TOP; }
// Sealed liquid/lava chambers in the DEEP stone (below the cave zone, so they're
// enclosed by solid rock and stay inert until dug into — never cave-adjacent,
// which would let them drain + churn). The zones are DEPTH-SEPARATED with stone
// buffers so different liquids never touch (water against lava would steam
// forever; oil against water would density-swap forever), and each pocket holds
// a SINGLE liquid (a low-freq region selector) so no two liquids mix. STONE
// otherwise.
uint8_t TerrainGen::genPocketAt(int worldX, int worldY) {
  int caveBottom = caveBottomAbs(), under = underworldAbs();
  if (worldY < caveBottom) return STONE;
  double p = wridged2(E.L->gPocketSeed ^ 0x1a7au, worldX * POCKET_FREQ, worldY * POCKET_FREQ, 3, 0.5); // pocket shape
  if (worldY >= under) return p > LAVA_THRESH ? LAVA : STONE;          // underworld: lava only
  if (worldY >= under - 8) return STONE;                               // solid buffer above the lava
  if (p <= WATER_POCKET_THRESH) return STONE;                          // deep zone: water OR oil reservoirs...
  double sel = wfbm2(E.L->gPocketSeed ^ 0x9bu, worldX * POCKET_FREQ * 0.3, worldY * POCKET_FREQ * 0.3, 2, 0.5);
  return sel < 0.5 ? WATER : OIL;                                      // ...each region a single liquid (no mixing)
}
uint8_t TerrainGen::genCellAt(int worldX, int surf, int slope, int biome, int soil, int y) {
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
  if (E.L->isBackground) return STONE;
  uint8_t base = genPocketAt(worldX, worldY);              // fg: deep stone + sealed liquids/lava
  if (base != STONE) return base;                          // sealed liquid / lava chamber
  // Cave-wall lining is intentionally sparse. Whole-biome component walls look
  // rich, but they create enormous static components; structures carry most of
  // the biome identity instead.
  if (depth >= caveTop && worldY < caveBottomAbs() && genIsCaveWall(worldX, worldY)) {
    int caveBiome = genCaveBiomeAt(worldX, worldY);
    double detail = whash2(E.L->gCaveSeed ^ 0x305bu, worldX, worldY);
    if (caveBiome == CAVE_LUSH && detail > 0.55) return MOSS;   // richer moss lining
    if (caveBiome == CAVE_MUSHROOM) {
      double tendril = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x4d79u, worldX * 0.035, worldY * 0.050, 2, 0.5) - 0.5);
      if (detail > 0.960 || (detail > 0.62 && tendril < 0.024)) return MYCELIUM; // denser wall mycelium
    }
    // Crystal specks stud cave walls in EVERY biome (densest in the crystal
    // biome), so lone 1x1 crystals are common outside the salt caverns too.
    // The non-crystal caves glint noticeably more now, for a bit of ambient light.
    double crystalCut = caveBiome == CAVE_CRYSTAL ? 0.955 : 0.966;
    if (detail > crystalCut) return CRYSTAL;
    double moss = wfbm2(E.L->gCaveSeed ^ 0x305au, worldX * 0.02, worldY * 0.02, 2, 0.5);
    if (moss > 0.74 && detail > 0.88) return MOSS;
  }
  // Mycelium doesn't only cling to the cave surface — in a mushroom biome it also
  // threads THROUGH the surrounding solid stone as embedded veins (like ore), so a
  // dug wall reveals fungal rock, not just a mossy skin.
  if (depth >= caveTop && worldY < caveBottomAbs()) {
    double vein = wridged2(E.L->gCaveSeed ^ 0x4d80u, worldX * 0.045, worldY * 0.055, 2, 0.5);
    if (vein > 0.86 && genCaveBiomeAt(worldX, worldY) == CAVE_MUSHROOM) return MYCELIUM;
  }
  return genOreFor(biome, worldX, worldY);                 // solid stone -> maybe an ore vein
}
// Per-biome tree density. Forest/jungle dense; plains/tundra/swamp sparser;
// desert sparse (cacti); rocky bare.
double TerrainGen::genTreeProb(int biome) {
  switch (biome) {
    case BIOME_FOREST: return TREE_PROB * 3.2;
    case BIOME_JUNGLE: return TREE_PROB * 4.0;
    case BIOME_SWAMP:  return TREE_PROB * 2.0;
    case BIOME_TUNDRA: return TREE_PROB * 1.5;
    case BIOME_PLAINS: return TREE_PROB;
    case BIOME_DESERT: return TREE_PROB * 0.7; // cacti
    default:           return 0.0;             // rocky
  }
}
// Flora species for a surface tree column: a pure function of biome + worldX, so
// both layers agree and the species is recoverable from the stamped wood material.
uint8_t TerrainGen::pickTreeType(int biome, int worldX) {
  double r = whash1(E.L->gTreeSeed ^ 0x7ee7u, worldX);
  switch (biome) {
    case BIOME_DESERT: return PT_CACTUS;
    case BIOME_TUNDRA: return PT_PINE;
    case BIOME_SWAMP:  return r < 0.48 ? PT_WILLOW : r < 0.82 ? PT_OAK : PT_BUSH;
    case BIOME_FOREST: return r < 0.5 ? PT_PINE : PT_OAK;
    case BIOME_JUNGLE: return r < 0.35 ? PT_BUSH : PT_OAK;
    default:           return r < 0.25 ? PT_BUSH : PT_OAK; // plains
  }
}
bool TerrainGen::genTreeAt(int worldX, int surf) {
  if (surf >= E.L->gSeaRow - E.L->worldOffsetY) return false;  // at/under water -> no trees
  return whash1(E.L->gTreeSeed, worldX) < genTreeProb(genBiomeAt(worldX));
}
