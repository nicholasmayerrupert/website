// TerrainGen method bodies (need the full Engine definition; see terrain.hpp).

// Biome from a low-frequency SHARED-seed band, so both layers agree. A secondary
// band splits plains/forest. Biomes vary the surface skin, soil depth and trees
// (NOT the surface height — keeping the height biome-independent avoids cliffs at
// biome seams, which would otherwise be steep enough to avalanche surface sand
// forever).
int TerrainGen::genBiomeAt(int worldX) {
  // n is the primary climate band; t is a secondary (moisture) splitter that
  // varies the biome WITHIN a band. Both are shared-seed + worldX only, so the
  // foreground and background agree and there is no worldY dependence (height
  // stays biome-independent — see the cliff/avalanche note above).
  double n = wfbm2(E.L->worldSeed ^ 0xB10B10u, worldX * BIOME_FREQ, 2.5, 3, 0.5);
  double t = wfbm2(E.L->worldSeed ^ 0x7A11D2u, worldX * BIOME_FREQ * 1.7, 5.5, 2, 0.5);
  if (n < 0.30) return t < 0.5 ? BIOME_PLAINS : BIOME_FOREST;
  if (n < 0.42) return t < 0.45 ? BIOME_FOREST : BIOME_JUNGLE;
  if (n < 0.54) return t < 0.5 ? BIOME_DESERT : BIOME_SWAMP;
  if (n < 0.64) return BIOME_DESERT;
  if (n < 0.82) return t < 0.58 ? BIOME_TUNDRA : BIOME_FOREST;
  if (n < 0.92) return t < 0.52 ? BIOME_TUNDRA : BIOME_ROCKY;
  return BIOME_ROCKY; // bare-stone country is now a rare high-climate extreme
}
// Terrain top in ABSOLUTE world-Y (centred at worldY=0; smaller = higher). Smooth
// multi-octave hills/valleys; valleys below the sea row flood (handled in genCellAt).
int TerrainGen::genSurfaceAbs(int worldX) {
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
  double amp = E.L->gSurfAmp * (0.68 + hills * 0.55 + highland * 0.42);
  double macro = -(continental - 0.5) * E.L->gSurfAmp * 1.55;
  double peaks = -highland * ridges * E.L->gSurfAmp * 0.70;
  return (int)std::lround(macro - (n - 0.5) * 2 * amp + peaks
                        + (cuts - 0.45) * E.L->gSurfAmp * 0.18);
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
// Material of the loose mantle between the skin and the deep stone (was a literal
// SAND). `d` is depth into the soil band. All powders here rest on the stone
// buffer below (caveTop) so they settle inert just like the old sand mantle.
uint8_t TerrainGen::genSoilMat(int biome, int d, int soil) {
  switch (biome) {
    case BIOME_DESERT: return d >= soil * 2 / 3 ? SANDSTONE : SAND; // sand over a sandstone base
    case BIOME_SWAMP:  return MUD;
    case BIOME_ROCKY:  return STONE;
    default:           return DIRT; // plains / forest / tundra / jungle
  }
}
int TerrainGen::genCaveTopAbs(int worldX) {
  int biome = genBiomeAt(worldX), soil = genSoilDepth(biome);
  return genSurfaceAbs(worldX) + GEN_SKIN + soil + imax(10, (int)std::floor(E.rows * 0.04));
}
int TerrainGen::genCaveBiomeAt(int worldX, int worldY) {
  if (worldY < genCaveTopAbs(worldX) + 18 || worldY >= caveBottomAbs()) return CAVE_DEFAULT;
  double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
  if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
  double wx = worldX + (wfbm2(E.L->gCaveSeed ^ 0xB107u, worldX * 0.0029, worldY * 0.0024, 2, 0.5) - 0.5) * 128.0;
  double wy = worldY + (wfbm2(E.L->gCaveSeed ^ 0xB108u, worldX * 0.0023, worldY * 0.0029, 2, 0.5) - 0.5) * 112.0;
  double pick = wfbm2(E.L->gCaveSeed ^ 0xB109u, wx * 0.00175, wy * 0.00205, 3, 0.5);
  // Three broad cave biome families, plus a sparse default. Liquids are stamped
  // as structures inside these regions, so adding another family later only
  // requires adding a new enum case and feature branch.
  if (pick < 0.10) return CAVE_DEFAULT;
  if (pick < 0.40) return CAVE_CRYSTAL;
  if (pick < 0.70) return CAVE_MUSHROOM;
  return CAVE_LUSH;
}
// Caves combine Minecraft-style density fields: broad "cheese" voids plus
// contour-line "spaghetti/noodle" tunnels. Terraria-like detail passes decorate
// the resulting cave floors/walls later, rather than carving independent rooms.
bool TerrainGen::genIsCave(int worldX, int worldY) {
  double warpX = (wfbm2(E.L->gCaveSeed ^ 0xCA71u, worldX * 0.010, worldY * 0.010, 1, 0.5) - 0.5) * 18.0;
  double warpY = (wfbm2(E.L->gCaveSeed ^ 0xCA72u, worldX * 0.009, worldY * 0.011, 1, 0.5) - 0.5) * 14.0;
  double sx = worldX + warpX, sy = worldY + warpY;
  double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
  if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
  double bgBias = E.L->isBackground ? 0.060 : 0.0;
  double cheese = wfbm2(E.L->gCaveSeed ^ 0x55u, sx * CAVE_FREQ * 0.52, sy * CAVE_FREQ * 0.42, 3, 0.5);
  double spaghetti = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x5A6Eu, sx * CAVE_FREQ * 1.55, sy * CAVE_FREQ * 0.82, 2, 0.5) - 0.5);
  double noodle = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x7A6Eu, sx * CAVE_FREQ * 2.8, sy * CAVE_FREQ * 1.9, 1, 0.5) - 0.5);
  double shaft = std::fabs(wfbm2(E.L->gCaveSeed ^ 0x5A7Fu, sx * CAVE_FREQ * 0.80, sy * CAVE_FREQ * 2.20, 1, 0.5) - 0.5);
  double chamberThresh = 0.755 - depthFrac * 0.075 + bgBias * 3.0;
  double spaghettiWidth = 0.075 + depthFrac * 0.026 - bgBias;
  double noodleWidth = 0.044 + depthFrac * 0.014 - bgBias * 0.6;
  double shaftWidth = 0.052 + depthFrac * 0.012 - bgBias * 0.8;
  return cheese > chamberThresh || spaghetti < spaghettiWidth || noodle < noodleWidth || shaft < shaftWidth;
}
bool TerrainGen::genOpenCaveAt(int worldX, int worldY) {
  return worldY >= genCaveTopAbs(worldX) && worldY < caveBottomAbs() && genIsCave(worldX, worldY);
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
  double v = wridged2(E.L->gPocketSeed ^ 0x0a5eu, worldX * ORE_FREQ, worldY * ORE_FREQ, 2, 0.5);
  if (v < ORE_THRESH) return STONE;
  double sel = wfbm2(E.L->gPocketSeed ^ 0x5e1eu, worldX * ORE_FREQ * 0.7, worldY * ORE_FREQ * 0.7, 2, 0.5);
  bool deep = worldY > caveBottomAbs();
  // GOLD is rare and only deep; the others scale coal(common)->copper->iron.
  if (deep && sel > 0.90) return GOLD_ORE;
  switch (biome) {
    case BIOME_DESERT: return sel < 0.55 ? COPPER_ORE : IRON_ORE;
    case BIOME_ROCKY:
    case BIOME_TUNDRA: return sel < 0.55 ? COAL_ORE : IRON_ORE;
    case BIOME_JUNGLE: return sel < 0.6 ? COPPER_ORE : IRON_ORE;
    default: // plains / forest / swamp
      if (sel < 0.45) return COAL_ORE;
      if (sel < 0.78) return COPPER_ORE;
      return IRON_ORE;
  }
}
// Absolute-world depth zones (cells below the surface centre, worldY=0). These
// scale with the viewport but the world is infinitely deep: below the underworld
// top it's stone + lava forever. Surface->caves->deep ore->underworld lava.
int TerrainGen::caveBottomAbs() { return E.rows * 9 / 5; }     // caves stop here (~1.8 viewports down)
int TerrainGen::underworldAbs() { return E.rows * 13 / 5; }    // lava underworld begins (~2.6 down)
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
  // Both layers share the visible skin + soil mantle. Matching strata prevent
  // gaps in foreground dirt/sand from exposing an unrelated stone backdrop.
  if (depth < GEN_SKIN) return genSkinMat(biome, slope, underwater);
  if (depth < GEN_SKIN + soil) return underwater ? STONE : genSoilMat(biome, depth - GEN_SKIN, soil); // solid under oceans
  // A thick solid stone buffer separates the loose soil (and any ocean floor)
  // from the cave zone, so generated sand never rests directly over a cave and
  // oceans can't drain into one (both churn the cross-layer transfer forever).
  int caveTop = GEN_SKIN + soil + imax(10, (int)std::floor(E.rows * 0.04));
  // Caves are foreground traversal. The generated background stays solid stone
  // behind them; players can still dig/paint the background, but streaming does
  // not spend half the terrain budget carving a second hidden cave network.
  if (E.L->isBackground) return STONE;
  if (depth >= caveTop && worldY < caveBottomAbs() && genIsCave(worldX, worldY)) return EMPTY;
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
    case BIOME_SWAMP:  return r < 0.72 ? PT_OAK : PT_BUSH; // avoid sparse willow skeletons in generated scenery
    case BIOME_FOREST: return r < 0.5 ? PT_PINE : PT_OAK;
    case BIOME_JUNGLE: return r < 0.35 ? PT_BUSH : PT_OAK;
    default:           return r < 0.25 ? PT_BUSH : PT_OAK; // plains
  }
}
bool TerrainGen::genTreeAt(int worldX, int surf) {
  if (surf >= E.L->gSeaRow - E.L->worldOffsetY) return false;  // at/under water -> no trees
  return whash1(E.L->gTreeSeed, worldX) < genTreeProb(genBiomeAt(worldX));
}
