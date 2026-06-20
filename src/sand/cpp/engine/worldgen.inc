  // ================= WORLDGEN STREAMING (streamGen.js + worldWindow.js) =================
  // Terraria/Starbound-flavoured generator. The SURFACE (height + biome + soil)
  // is derived from the shared world seed, so the foreground and background line
  // up at the top and the soil layer never erodes via cross-layer drain. The
  // SUBSURFACE (caves + ore/liquid pockets) is derived from a PER-LAYER seed, so
  // the background diverges underground — digging the foreground reveals a
  // different cave network behind it, and cross-layer transfer flows wherever the
  // two cavities mismatch. Biomes (plains / desert / rocky) vary the surface skin,
  // soil depth, and tree density. Materials are the existing palette only.
  enum Biome : int { BIOME_PLAINS = 0, BIOME_FOREST = 1, BIOME_DESERT = 2, BIOME_ROCKY = 3,
                     BIOME_TUNDRA = 4, BIOME_JUNGLE = 5, BIOME_SWAMP = 6 };
  static const double SURFACE_FREQ, CAVE_FREQ, CAVE_THRESH, TREE_PROB;
  static const double BIOME_FREQ, POCKET_FREQ, WATER_POCKET_THRESH, OIL_POCKET_THRESH, LAVA_THRESH;
  static const double ORE_FREQ, ORE_THRESH;
  static const int SURFACE_OCT, GEN_SKIN;
  // Biome from a low-frequency SHARED-seed band, so both layers agree. A secondary
  // band splits plains/forest. Biomes vary the surface skin, soil depth and trees
  // (NOT the surface height — keeping the height biome-independent avoids cliffs at
  // biome seams, which would otherwise be steep enough to avalanche surface sand
  // forever).
  int genBiomeAt(int worldX) {
    // n is the primary climate band; t is a secondary (moisture) splitter that
    // varies the biome WITHIN a band. Both are shared-seed + worldX only, so the
    // foreground and background agree and there is no worldY dependence (height
    // stays biome-independent — see the cliff/avalanche note above).
    double n = wfbm2(L->worldSeed ^ 0xB10B10u, worldX * BIOME_FREQ, 2.5, 3, 0.5);
    double t = wfbm2(L->worldSeed ^ 0x7A11D2u, worldX * BIOME_FREQ * 1.7, 5.5, 2, 0.5);
    if (n < 0.30) return t < 0.5 ? BIOME_PLAINS : BIOME_FOREST;
    if (n < 0.42) return t < 0.45 ? BIOME_FOREST : BIOME_JUNGLE;
    if (n < 0.54) return t < 0.5 ? BIOME_DESERT : BIOME_SWAMP;
    if (n < 0.66) return BIOME_DESERT;
    if (n < 0.80) return t < 0.5 ? BIOME_TUNDRA : BIOME_ROCKY;
    return BIOME_ROCKY;
  }
  // Terrain top in ABSOLUTE world-Y (centred at worldY=0; smaller = higher). Smooth
  // multi-octave hills/valleys; valleys below the sea row flood (handled in genCellAt).
  int genSurfaceAbs(int worldX) {
    double n = wfbm2(L->worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
    double hills = wfbm2(L->worldSeed ^ 0x9e3779b9u, worldX * SURFACE_FREQ * 0.22, 3.1, 4, 0.5);
    double amp = L->gSurfAmp * (0.75 + hills * 0.6);
    return (int)std::lround(-(n - 0.5) * 2 * amp);
  }
  // Terrain top as a BUFFER row in the current window (may be <0 or >=rows when the
  // surface has scrolled off; genCellAt's `y < surf` test handles that as all-sky /
  // all-underground). Used by spawn + tree placement.
  int genSurfaceAt(int worldX) { return genSurfaceAbs(worldX) - L->worldOffsetY; }
  int genSoilDepth(int biome) {
    if (biome == BIOME_ROCKY) return 0;            // bare stone (stays one connected mass)
    if (biome == BIOME_DESERT) return L->gSoil * 3; // deep sand
    if (biome == BIOME_JUNGLE) return L->gSoil + 3; // thick lush mantle
    return L->gSoil + 2;                            // plains / forest / tundra / swamp
  }
  uint8_t genSkinMat(int biome, int slope, bool underwater) {
    if (underwater) return STONE;                // solid seabed (loose powder under water just avalanches)
    switch (biome) {
      case BIOME_ROCKY:  return STONE;
      case BIOME_DESERT: return SAND;
      case BIOME_TUNDRA: return SNOW;            // snow blanket over the dirt mantle
      case BIOME_SWAMP:  return slope <= 2 ? PLANT : MUD;
      default:           return slope <= 2 ? PLANT : SAND; // plains/forest/jungle: grass on gentle, sand on steeps
    }
  }
  // Material of the loose mantle between the skin and the deep stone (was a literal
  // SAND). `d` is depth into the soil band. All powders here rest on the stone
  // buffer below (caveTop) so they settle inert just like the old sand mantle.
  uint8_t genSoilMat(int biome, int d, int soil) {
    switch (biome) {
      case BIOME_DESERT: return d >= soil * 2 / 3 ? SANDSTONE : SAND; // sand over a sandstone base
      case BIOME_SWAMP:  return MUD;
      case BIOME_ROCKY:  return STONE;
      default:           return DIRT; // plains / forest / tundra / jungle
    }
  }
  // Caves carve winding tunnels (ridged noise) plus the occasional larger cavern
  // (fbm). The BACKGROUND uses a higher threshold -> a more-solid backdrop behind
  // the foreground's traversable caves (the user's "back solid, front carved").
  bool genIsCave(int worldX, int worldY) {
    double tun = wridged2(L->gCaveSeed, worldX * CAVE_FREQ, worldY * CAVE_FREQ, 3, 0.5);
    double cav = wfbm2(L->gCaveSeed ^ 0x55u, worldX * CAVE_FREQ * 0.45, worldY * CAVE_FREQ * 0.45, 3, 0.5);
    double caveBias = L->isBackground ? 0.13 : 0.0; // bg: sparser caves
    // Depth zoning: near the surface, winding tunnels dominate; deeper, the cavern
    // (fbm) threshold drops so large open caverns open up. Pure in worldY.
    double depthFrac = (double)worldY / (double)imax(1, caveBottomAbs());
    if (depthFrac < 0) depthFrac = 0; else if (depthFrac > 1) depthFrac = 1;
    double cavThresh = 0.78 - depthFrac * 0.12;
    return tun > CAVE_THRESH + caveBias || cav > cavThresh + caveBias;
  }
  // Solid stone that sits one cell from a carved cave (a cave-wall surface). Pure
  // noise (samples genIsCave at the 4 neighbours), so it stays deterministic. The
  // caller has already checked this cell is in the carved cave zone and is stone.
  bool genIsCaveWall(int worldX, int worldY) {
    return genIsCave(worldX + 1, worldY) || genIsCave(worldX - 1, worldY)
        || genIsCave(worldX, worldY + 1) || genIsCave(worldX, worldY - 1);
  }
  // Ore veins: sparse winding clusters of ore embedded in the deep stone (returns
  // STONE where there's no vein). Pure in (seed, worldX, worldY) so prefetch stays
  // byte-identical; ore is solid-in-solid so it's inert and grounds like stone.
  // Biome + depth bias WHICH ore. gPocketSeed is per-layer (fg only places ore).
  uint8_t genOreFor(int biome, int worldX, int worldY) {
    double v = wridged2(L->gPocketSeed ^ 0x0a5eu, worldX * ORE_FREQ, worldY * ORE_FREQ, 2, 0.5);
    if (v < ORE_THRESH) return STONE;
    double sel = wfbm2(L->gPocketSeed ^ 0x5e1eu, worldX * ORE_FREQ * 0.7, worldY * ORE_FREQ * 0.7, 2, 0.5);
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
  int caveBottomAbs() { return rows * 9 / 5; }     // caves stop here (~1.8 viewports down)
  int underworldAbs() { return rows * 13 / 5; }    // lava underworld begins (~2.6 down)
  // Sealed liquid/lava chambers in the DEEP stone (below the cave zone, so they're
  // enclosed by solid rock and stay inert until dug into — never cave-adjacent,
  // which would let them drain + churn). The zones are DEPTH-SEPARATED with stone
  // buffers so different liquids never touch (water against lava would steam
  // forever; oil against water would density-swap forever), and each pocket holds
  // a SINGLE liquid (a low-freq region selector) so no two liquids mix. STONE
  // otherwise.
  uint8_t genPocketAt(int worldX, int worldY) {
    int caveBottom = caveBottomAbs(), under = underworldAbs();
    if (worldY < caveBottom) return STONE;
    double p = wridged2(L->gPocketSeed ^ 0x1a7au, worldX * POCKET_FREQ, worldY * POCKET_FREQ, 3, 0.5); // pocket shape
    if (worldY >= under) return p > LAVA_THRESH ? LAVA : STONE;          // underworld: lava only
    if (worldY >= under - 8) return STONE;                               // solid buffer above the lava
    if (p <= WATER_POCKET_THRESH) return STONE;                          // deep zone: water OR oil reservoirs...
    double sel = wfbm2(L->gPocketSeed ^ 0x9bu, worldX * POCKET_FREQ * 0.3, worldY * POCKET_FREQ * 0.3, 2, 0.5);
    return sel < 0.5 ? WATER : OIL;                                      // ...each region a single liquid (no mixing)
  }
  uint8_t genCellAt(int worldX, int surf, int slope, int biome, int soil, int y) {
    int sea = L->gSeaRow - L->worldOffsetY;       // sea level as a buffer row (gSeaRow is absolute)
    if (y < surf) {
      // above the terrain: a valley below the sea row floods with water (a flat,
      // contained ocean that settles); the foreground holds the water, the
      // background is a solid wall behind it. Otherwise it's open sky.
      if (y >= sea) return L->isBackground ? STONE : WATER;
      return EMPTY;
    }
    int depth = y - surf;
    int worldY = L->worldOffsetY + y;             // absolute depth for the cave/underworld zones
    bool underwater = surf > sea;
    // The FOREGROUND has the rich loose strata (skin + dirt/sand mantle). The
    // BACKGROUND skips them — a dry solid backdrop, no loose soil to churn.
    if (!L->isBackground) {
      if (depth < GEN_SKIN) return genSkinMat(biome, slope, underwater);
      if (depth < GEN_SKIN + soil) return underwater ? STONE : genSoilMat(biome, depth - GEN_SKIN, soil); // solid under oceans
    }
    // A thick solid stone buffer separates the loose soil (and any ocean floor)
    // from the cave zone, so generated sand never rests directly over a cave and
    // oceans can't drain into one (both churn the cross-layer transfer forever).
    int caveTop = GEN_SKIN + soil + imax(10, (int)std::floor(rows * 0.04));
    // Caves: the foreground gets traversable tunnels; the background gets the same
    // network but SPARSER (genIsCave biases by layer). DRY in the bg (no soil/liquids).
    if (depth >= caveTop && worldY < caveBottomAbs() && genIsCave(worldX, worldY)) return EMPTY;
    if (L->isBackground) return STONE;                       // bg: solid stone, no liquid pockets
    uint8_t base = genPocketAt(worldX, worldY);              // fg: deep stone + sealed liquids/lava
    if (base != STONE) return base;                          // sealed liquid / lava chamber
    // Cave-wall lining: in mossy regions (a low-freq selector), stone facing a cave
    // is MOSS. Solid-against-air, so it's inert and grounds via the stone behind it.
    if (depth >= caveTop && worldY < caveBottomAbs() && genIsCaveWall(worldX, worldY)) {
      double moss = wfbm2(L->gCaveSeed ^ 0x305au, worldX * 0.02, worldY * 0.02, 2, 0.5);
      if (moss > 0.66) return MOSS;
    }
    return genOreFor(biome, worldX, worldY);                 // solid stone -> maybe an ore vein
  }
  // Per-biome tree density. Forest/jungle dense; plains/tundra/swamp sparser;
  // desert sparse (cacti); rocky bare.
  double genTreeProb(int biome) {
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
  uint8_t pickTreeType(int biome, int worldX) {
    double r = whash1(L->gTreeSeed ^ 0x7ee7u, worldX);
    switch (biome) {
      case BIOME_DESERT: return PT_CACTUS;
      case BIOME_TUNDRA: return PT_PINE;
      case BIOME_SWAMP:  return PT_WILLOW;
      case BIOME_FOREST: return r < 0.5 ? PT_PINE : PT_OAK;
      case BIOME_JUNGLE: return r < 0.35 ? PT_BUSH : PT_OAK;
      default:           return r < 0.25 ? PT_BUSH : PT_OAK; // plains
    }
  }
  bool genTreeAt(int worldX, int surf) {
    if (surf >= L->gSeaRow - L->worldOffsetY) return false;  // at/under water -> no trees
    return whash1(L->gTreeSeed, worldX) < genTreeProb(genBiomeAt(worldX));
  }
  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd).
  // A horizontal stream-in passes a column band (full rows); a vertical one passes
  // a row band (full cols); the initial fill is the whole buffer.
  // Base terrain (no trees) over the rect. Split out of fillRect so the prefetch
  // path can generate a band one column-slice at a time across frames; trees must
  // run only AFTER all of a band's terrain columns exist (a tree canopy spills over
  // sky cells, which a later terrain slice would otherwise overwrite), so they're a
  // separate pass. Each column is generated independently of the others.
  void fillTerrain(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int lx = colStart; lx < colEnd; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = genSurfaceAt(worldX);
      int slope = std::abs(genSurfaceAt(worldX + 1) - genSurfaceAt(worldX - 1));
      int biome = genBiomeAt(worldX); int soil = genSoilDepth(biome);
      for (int y = rowStart; y < rowEnd; y++) grid[y * cols + lx] = genCellAt(worldX, surf, slope, biome, soil, y);
    }
  }
  // Trees (fg only) over already-generated terrain in the rect. Trees reach
  // TREE_REACH cols outside the rect (clipped by `put`), so a band re-evaluates the
  // trunks just outside it and canopies span band seams identically to one big call.
  void fillTrees(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (!L->isBackground) return;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return; if (grid[y * cols + lx] == EMPTY) grid[y * cols + lx] = m; };
    const int TREE_REACH = 6;    // >= max canopy horizontal reach
    const int TREE_MAX_UP = 30;  // >= max trunk height + canopy upward reach
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = genSurfaceAt(worldX);
      if (surf + 2 < rowStart || surf - TREE_MAX_UP >= rowEnd) continue; // footprint misses the rect
      if (!genTreeAt(worldX, surf)) continue;
      int biome = genBiomeAt(worldX);
      uint8_t pt = pickTreeType(biome, worldX);
      uint8_t wood = plantWoodMat(pt), leaf = plantLeafMat(pt);
      double hr = whash1(L->gTreeSeed + 1, worldX);
      int h = pt == PT_PINE ? 12 + (int)(hr * 7)      // tall conifer
            : pt == PT_BUSH ? 3 + (int)(hr * 3)       // low shrub
            : pt == PT_CACTUS ? 6 + (int)(hr * 5)     // medium column
            : pt == PT_WILLOW ? 8 + (int)(hr * 6)
            : 6 + (int)(hr * 8);                      // oak
      int top = surf - h;
      for (int y = top; y < surf; y++) put(lx, y, wood); // trunk
      if (pt == PT_CACTUS) {                            // arms, no foliage
        int armY = top + 2 + (int)(whash1(L->gTreeSeed ^ 0x3a3au, worldX) * imax(1, h - 4));
        put(lx - 1, armY, wood); put(lx - 2, armY, wood); put(lx - 2, armY - 1, wood);
        put(lx + 1, armY + 2, wood); put(lx + 2, armY + 2, wood); put(lx + 2, armY + 1, wood);
      } else if (pt == PT_PINE) {                       // conical needles, narrowing upward
        for (int oy = 0; oy <= 6; oy++) { int wRad = (oy + 1) / 2; for (int ox = -wRad; ox <= wRad; ox++) put(lx + ox, top + oy, leaf); }
      } else if (pt == PT_WILLOW) {                     // wide, drooping
        for (int oy = -3; oy <= 3; oy++) for (int ox = -4; ox <= 4; ox++) { if (ox * ox + (oy < 0 ? oy * oy : 0) > 14) continue; put(lx + ox, top + oy, leaf); }
      } else {                                          // oak / bush round canopy
        for (int oy = -4; oy <= 1; oy++) for (int ox = -3; ox <= 3; ox++) { if (ox * ox + oy * oy > 11) continue; put(lx + ox, top + oy, leaf); }
      }
    }
  }
  // ---- deterministic structure stamping (ruins) -----------------------------
  // Discrete structures anchor on a coarse world-cell lattice. Each lattice cell's
  // presence/size is a pure hash of its (latX,latY), so a structure is byte-identical
  // no matter which band generates it. Like fillTrees, we OVERSCAN the rect by
  // STRUCT_REACH and clip with `put`, so a structure straddling a band seam is written
  // identically whether produced by one big fillRect or two band calls. fg only.
  static const int STRUCT_LATTICE = 56;  // world cells between candidate anchors
  static const int STRUCT_REACH = 24;    // >= max (jitter + structure extent)
  static int floorDiv(int a, int b) { int q = a / b, r = a % b; if (r != 0 && ((r < 0) != (b < 0))) q--; return q; }
  void fillStructures(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (L->isBackground) return;                       // fg only (matches trees)
    auto put = [&](int wx, int wy, uint8_t m) {
      int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
      grid[y * cols + lx] = m;                         // structures OVERWRITE terrain
    };
    uint32_t sseed = L->worldSeed ^ 0x57121314u;       // fg-only struct seed (shared is fine)
    int wx0 = L->worldOffsetX + colStart - STRUCT_REACH, wx1 = L->worldOffsetX + colEnd + STRUCT_REACH;
    int wy0 = L->worldOffsetY + rowStart - STRUCT_REACH, wy1 = L->worldOffsetY + rowEnd + STRUCT_REACH;
    int lxMin = floorDiv(wx0, STRUCT_LATTICE), lxMax = floorDiv(wx1, STRUCT_LATTICE);
    int lyMin = floorDiv(wy0, STRUCT_LATTICE), lyMax = floorDiv(wy1, STRUCT_LATTICE);
    for (int ly = lyMin; ly <= lyMax; ly++) for (int lx = lxMin; lx <= lxMax; lx++) {
      if (whash2(sseed, lx, ly) >= 0.18) continue;     // rare: a ruin at this anchor
      // jittered anchor + hashed size
      int ax = lx * STRUCT_LATTICE + (int)(whash2(sseed ^ 0xA1u, lx, ly) * 6);
      int ay = ly * STRUCT_LATTICE + (int)(whash2(sseed ^ 0xB2u, lx, ly) * 6);
      int w = 11 + (int)(whash2(sseed ^ 0xC3u, lx, ly) * 7); // 11..17
      int h = 7 + (int)(whash2(sseed ^ 0xD4u, lx, ly) * 4);  // 7..10
      // Only underground in solid stone, above the sealed-liquid zone: keeps the
      // carved interior away from loose soil (no avalanche) and from pockets.
      int surfAbs = genSurfaceAbs(ax + w / 2);
      if (ay < surfAbs + 30) continue;
      if (ay + h > caveBottomAbs()) continue;
      int doorX = ax + 1 + (int)(whash2(sseed ^ 0xE5u, lx, ly) * (w - 4)); // doorway in the bottom wall
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        bool door = oy == h - 1 && ox >= doorX && ox <= doorX + 1; // 2-wide doorway
        put(ax + ox, ay + oy, (border && !door) ? BRICK : EMPTY);
      }
    }
  }
  void copyGridToNext(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int lx = colStart; lx < colEnd; lx++) for (int y = rowStart; y < rowEnd; y++) { int k = y * cols + lx; next[k] = grid[k]; }
  }
  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd):
  // terrain, then trees, then mirror into `next`. (Same order/output as before the
  // split — terrain first, trees second, next-copy last.)
  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    fillTerrain(colStart, colEnd, rowStart, rowEnd);
    fillStructures(colStart, colEnd, rowStart, rowEnd); // overwrite terrain (ruins) before trees overlay
    fillTrees(colStart, colEnd, rowStart, rowEnd);
    copyGridToNext(colStart, colEnd, rowStart, rowEnd);
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).
  void initInfiniteLayer(uint32_t seed, uint32_t layerSalt, bool background) {
    L->infinite = true; L->isBackground = background; L->worldSeed = seed;
    L->gSurfAmp = imax(20, (int)std::floor(rows * 0.17));
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.22));
    L->gSeaRow = (int)std::floor(L->gSurfAmp * 0.35); // ABSOLUTE sea level (worldY); valleys below flood
    L->gSoil = imax(2, (int)std::floor(rows * 0.012));
    L->gCaveSeed = (seed ^ 0x5bd1e995u) + layerSalt * 0x9e3779b9u;
    L->gPocketSeed = (seed ^ 0xC0FFEE11u) + layerSalt * 0x85ebca6bu;
    L->gTreeSeed = seed ^ 0x1b56c4f9u; // shared so tree silhouettes line up across layers
    L->worldOffsetX = (-(cols / 2)) & ~(CHUNK_SIZE - 1);   // tile-aligned origin (2D tile store needs alignment)
    L->worldOffsetY = (-L->gSurfBase) & ~(CHUNK_SIZE - 1); // surface centre (worldY=0) ~gSurfBase down the buffer
    fillRect(0, cols, 0, rows);
    registerSeededComponents(0, cols);
  }
  void initInfinite(uint32_t seed) {
    useLayer(&fg); initInfiniteLayer(seed, 0, false); // foreground: caves carved for traversal
    useLayer(&bg); initInfiniteLayer(seed, 1, true);  // background: more-solid backdrop
    bgEnabled = true;
    useLayer(&fg);
  }
  void shiftRowMajorU8(uint8_t* arr, int dx, uint8_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, cols - dx); memset(arr + b + cols - dx, fill, dx); }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, cols - s); memset(arr + b, fill, s); } }
  }
  // Vertical slide of a row-major buffer by dy rows (dy>0: content moves UP, new
  // band enters at the bottom). A single contiguous memmove (no per-row loop).
  void shiftBufV(uint8_t* arr, int dy, uint8_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols;
    if (dy > 0) { memmove(arr, arr + band, rest); memset(arr + rest, fill, band); }
    else { memmove(arr + band, arr, rest); memset(arr, fill, band); }
  }
  void shiftBufVI32(int32_t* arr, int dy, int32_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols, n = (size_t)rows * cols;
    if (dy > 0) { memmove(arr, arr + band, rest * 4); for (size_t i = rest; i < n; i++) arr[i] = fill; }
    else { memmove(arr + band, arr, rest * 4); for (size_t i = 0; i < band; i++) arr[i] = fill; }
  }
  // Re-index every component after the grid slid by (dx,dy). One axis at a time:
  // each cell's new (col,row) is (x-dx, y-dy); cells that slid off the buffer drop.
  void translateComponents(std::vector<Comp>& list, int dx, int dy) {
    size_t w = 0;
    for (size_t r = 0; r < list.size(); r++) {
      Comp& comp = list[r]; auto& cs = comp.cells; size_t cw = 0; int yMax = 0;
      for (size_t i = 0; i < cs.size(); i++) {
        int k = cs[i]; int nxC = (k % cols) - dx, nyC = (k / cols) - dy;
        if (nxC < 0 || nxC >= cols || nyC < 0 || nyC >= rows) continue; // slid off the buffer
        cs[cw++] = nyC * cols + nxC; if (nyC > yMax) yMax = nyC;
      }
      if (cw == 0) continue;
      cs.resize(cw); comp.yMax = yMax; comp.cacheDirty = true;
      if (w != r) list[w] = std::move(comp);
      w++;
    }
    list.resize(w);
  }
  // ---- 2D tile chunk store: full sim-state persistence keyed by absolute tiles ----
  static inline int64_t tileKey(int tx, int ty) { return ((int64_t)tx << 32) | (uint32_t)ty; }
  // Only WHOLE 32x32 tiles fully inside the buffer are persisted; a partial edge
  // tile (when cols/rows aren't chunk-multiples — e.g. the headless tests) is
  // skipped and just regenerates. The game's buffer is chunk-rounded, so every
  // tile is whole and persistence is complete.
  bool wholeTile(int tx, int ty) { return tx >= 0 && ty >= 0 && tx + CHUNK_SIZE <= cols && ty + CHUNK_SIZE <= rows; }
  void csSaveTiles(int bx0, int by0, int w, int h) { // uses the CURRENT offset (leaving band)
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto& buf = L->tileStore[tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT)];
        if ((int)buf.size() != CHUNK_SIZE * CHUNK_SIZE) buf.resize((size_t)CHUNK_SIZE * CHUNK_SIZE);
        for (int r = 0; r < CHUNK_SIZE; r++) memcpy(buf.data() + (size_t)r * CHUNK_SIZE, grid + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
      }
  }
  bool csTilesAllPresent(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false; // a partial tile is never persisted -> must regenerate
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        if (L->tileStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT)) == L->tileStore.end()) return false;
      }
    return true;
  }
  void csLoadTiles(int bx0, int by0, int w, int h) { // overlay saved tiles (NEW offset); missing left as-is
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->tileStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT));
        if (it == L->tileStore.end()) continue;
        const uint8_t* buf = it->second.data();
        for (int r = 0; r < CHUNK_SIZE; r++) { size_t d = (size_t)(ty + r) * cols + tx; memcpy(grid + d, buf + (size_t)r * CHUNK_SIZE, CHUNK_SIZE); memcpy(next + d, buf + (size_t)r * CHUNK_SIZE, CHUNK_SIZE); }
      }
  }
  void csSaveBodiesLeaving(int bx0, int by0, int w, int h) { // CURRENT offset
    std::vector<Body*> staying;
    for (Body* b : L->bodies) {
      if (b->px >= bx0 && b->px < bx0 + w && b->py >= by0 && b->py < by0 + h) {
        double awx = L->worldOffsetX + b->px, awy = L->worldOffsetY + b->py;
        L->bodyStore[tileKey((int)std::floor(awx) >> CHUNK_SHIFT, (int)std::floor(awy) >> CHUNK_SHIFT)].push_back({b, {awx, awy}});
      } else staying.push_back(b);
    }
    L->bodies = std::move(staying);
  }
  void csRestoreBodies(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->bodyStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT));
        if (it == L->bodyStore.end()) continue;
        for (auto& e : it->second) { Body* b = e.first; b->px = e.second.first - L->worldOffsetX; b->py = e.second.second - L->worldOffsetY; L->bodies.push_back(b); }
        L->bodyStore.erase(it);
      }
  }

  // ---- predictive worldgen prefetch ----------------------------------------
  // The shift's fillRect (per-cell multi-octave noise over the whole entering band,
  // x2 layers) is the dominant cause of the periodic ~1/sec pan hitch when exploring
  // NEW terrain. But the entering band is OFF-SCREEN (the shift fires `margin` cells
  // before the edge and slides a whole chunk), so there's ~1s of runway to build it.
  // So we pre-generate the upcoming band's tiles into the tileStore a slice per
  // frame; when the shift fires, csTilesAllPresent is already true and fillRect is
  // skipped -> only the cheap csLoadTiles memcpy runs on that frame.
  //
  // SAFETY (multiplayer / determinism): prefetch changes only WHEN worldgen runs,
  // never WHAT it produces. Tiles are generated by the SAME fillTerrain/fillTrees
  // keyed on ABSOLUTE coords, so a prefetched tile is byte-identical to fillRect's
  // for that position regardless of timing. Worst case is a cache MISS (graceful
  // fallback to the synchronous fillRect), never corruption. It writes only to the
  // side-cache tileStore; the live sim buffers are untouched.

  // The entering band's buffer rect for a coming shift (mirrors shiftLayer).
  void pfBand(int dx, int dy, int& ex0, int& ey0, int& ew, int& eh) {
    int s = std::abs(dx) + std::abs(dy);
    if (dx) { eh = rows; ey0 = 0; ew = s; ex0 = dx > 0 ? cols - s : 0; }
    else    { ew = cols; ex0 = 0; eh = s; ey0 = dy > 0 ? rows - s : 0; }
  }
  // Is every whole tile of a layer's entering band already in its tileStore (saved
  // edits or a prior prefetch)? A partial edge tile (non-chunk-multiple buffer) is
  // never persisted, so such a band can't be all-present -> prefetch is a no-op there.
  bool pfBandCached(Layer* Lx, int futOffX, int futOffY) {
    for (int ty = pfEy0; ty < pfEy0 + pfEh; ty += CHUNK_SIZE)
      for (int tx = pfEx0; tx < pfEx0 + pfEw; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false;
        if (Lx->tileStore.find(tileKey((futOffX + tx) >> CHUNK_SHIFT, (futOffY + ty) >> CHUNK_SHIFT)) == Lx->tileStore.end()) return false;
      }
    return true;
  }
  // Slice the prefetched band out of the scratch grid and store any tile not already
  // present (never clobber a saved/edited tile). Keyed by FUTURE absolute coords so
  // the shift's csLoadTiles (which uses the post-shift offset) finds them.
  void pfStoreTiles(Layer* Lx, int futOffX, int futOffY) {
    for (int ty = pfEy0; ty < pfEy0 + pfEh; ty += CHUNK_SIZE)
      for (int tx = pfEx0; tx < pfEx0 + pfEw; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int64_t key = tileKey((futOffX + tx) >> CHUNK_SHIFT, (futOffY + ty) >> CHUNK_SHIFT);
        if (Lx->tileStore.find(key) != Lx->tileStore.end()) continue;
        auto& buf = Lx->tileStore[key];
        buf.resize((size_t)CHUNK_SIZE * CHUNK_SIZE);
        for (int r = 0; r < CHUNK_SIZE; r++) memcpy(buf.data() + (size_t)r * CHUNK_SIZE, pfGrid.data() + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
      }
  }
  // Run one terrain slice for layer Lx into the scratch grid at the future offset.
  // We retarget only L + grid + Lx's offset (NOT useLayer) and restore them: terrain
  // gen reads L->* + grid + cols/rows only, never the other per-cell mirrors. Returns
  // true once the whole band's terrain is generated.
  bool pfTerrainStep(Layer* Lx, int futOffX, int futOffY) {
    Layer* sL = L; uint8_t* sGrid = grid;
    int sOffX = Lx->worldOffsetX, sOffY = Lx->worldOffsetY;
    L = Lx; grid = pfGrid.data();
    Lx->worldOffsetX = futOffX; Lx->worldOffsetY = futOffY;
    bool done;
    if (pfDx) {
      int per = imax(1, PREFETCH_CELLS_PER_FRAME / imax(1, rows));
      int c0 = pfEx0 + pfCursor, c1 = imin(pfEx0 + pfEw, c0 + per);
      fillTerrain(c0, c1, 0, rows); pfCursor += c1 - c0; done = pfCursor >= pfEw;
    } else {
      int per = imax(1, PREFETCH_CELLS_PER_FRAME / imax(1, cols));
      int r0 = pfEy0 + pfCursor, r1 = imin(pfEy0 + pfEh, r0 + per);
      fillTerrain(0, cols, r0, r1); pfCursor += r1 - r0; done = pfCursor >= pfEh;
    }
    Lx->worldOffsetX = sOffX; Lx->worldOffsetY = sOffY;
    grid = sGrid; L = sL;
    return done;
  }
  // Trees over the whole band (fg only), then slice the band into the tileStore.
  void pfFinalizeLayer(Layer* Lx, int futOffX, int futOffY) {
    Layer* sL = L; uint8_t* sGrid = grid;
    int sOffX = Lx->worldOffsetX, sOffY = Lx->worldOffsetY;
    L = Lx; grid = pfGrid.data();
    Lx->worldOffsetX = futOffX; Lx->worldOffsetY = futOffY;
    // Structures BEFORE trees and BEFORE pfStoreTiles, mirroring fillRect's order,
    // so a prefetched tile is byte-identical to the synchronous fillRect tile.
    fillStructures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillTrees(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    Lx->worldOffsetX = sOffX; Lx->worldOffsetY = sOffY;
    grid = sGrid; L = sL;
    pfStoreTiles(Lx, futOffX, futOffY);
  }
  void pfStartTarget(int dx, int dy) {
    pfDx = dx; pfDy = dy; pfCursor = 0;
    if ((int)pfGrid.size() != cols * rows) pfGrid.assign((size_t)cols * rows, EMPTY);
    pfBand(dx, dy, pfEx0, pfEy0, pfEw, pfEh);
    int futOffX = fg.worldOffsetX + dx, futOffY = fg.worldOffsetY + dy; // fg/bg share one offset
    bool cached = pfBandCached(&fg, futOffX, futOffY) && (!bgEnabled || pfBandCached(&bg, futOffX, futOffY));
    pfStage = cached ? PF_DONE : PF_FG_TERRAIN;
  }
  // Generate at most one slice toward caching the band; advances the stage machine.
  void pfRunSlice() {
    int futOffX = fg.worldOffsetX + pfDx, futOffY = fg.worldOffsetY + pfDy;
    if (pfStage == PF_FG_TERRAIN) {
      if (pfTerrainStep(&fg, futOffX, futOffY)) { pfFinalizeLayer(&fg, futOffX, futOffY); pfCursor = 0; pfStage = bgEnabled ? PF_BG_TERRAIN : PF_DONE; }
    } else if (pfStage == PF_BG_TERRAIN) {
      if (pfTerrainStep(&bg, futOffX, futOffY)) { pfFinalizeLayer(&bg, futOffX, futOffY); pfStage = PF_DONE; }
    }
  }
  // Per-frame driver: pick the nearest upcoming shift boundary within
  // PREFETCH_LOOKAHEAD cells of camera travel and advance its prefetch. Called from
  // streamWorld with the live camera; also exposed as a test hook.
  void prefetchAdvance(int camCellX, int camCellY, int visCols, int visRows) {
    if (!fg.infinite) return;
    int wantDx = 0, wantDy = 0, best = PREFETCH_LOOKAHEAD + 1;
    int distR = (cols - visCols - CAM_SHIFT_EDGE_MARGIN) - camCellX; // cells until each trigger fires
    int distL = camCellX - CAM_SHIFT_EDGE_MARGIN;
    int distB = (rows - visRows - CAM_SHIFT_EDGE_MARGIN) - camCellY;
    int distT = camCellY - CAM_SHIFT_EDGE_MARGIN;
    if (distR >= 0 && distR < best) { best = distR; wantDx = WORLD_SHIFT_COLS; wantDy = 0; }
    if (distL >= 0 && distL < best) { best = distL; wantDx = -WORLD_SHIFT_COLS; wantDy = 0; }
    if (distB >= 0 && distB < best) { best = distB; wantDx = 0; wantDy = WORLD_SHIFT_ROWS; }
    if (distT >= 0 && distT < best) { best = distT; wantDx = 0; wantDy = -WORLD_SHIFT_ROWS; }
    if (!wantDx && !wantDy) { pfDx = pfDy = 0; return; }
    if (wantDx != pfDx || wantDy != pfDy) pfStartTarget(wantDx, wantDy);
    if (pfStage != PF_DONE) pfRunSlice();
  }

  // Slide the loaded window so the camera always has room. cameraCell is the view's
  // left/top cell; returns the applied shift (0 if none). JS slides its GL texture
  // and pulls the camera back. WORLD_SHIFT_* are tile-aligned (the 2D store needs it).
  int maybeShiftWorld(int cameraCellX, int visibleCols, int marginCols) {
    if (!fg.infinite) return 0;
    int dx = 0;
    if (cameraCellX >= cols - visibleCols - marginCols) dx = WORLD_SHIFT_COLS;
    else if (cameraCellX <= marginCols) dx = -WORLD_SHIFT_COLS;
    if (dx) shiftWorld(dx, 0);
    return dx;
  }
  int maybeShiftWorldVertical(int cameraCellY, int visibleRows, int marginRows) {
    if (!fg.infinite) return 0;
    int dy = 0;
    if (cameraCellY >= rows - visibleRows - marginRows) dy = WORLD_SHIFT_ROWS;
    else if (cameraCellY <= marginRows) dy = -WORLD_SHIFT_ROWS;
    if (dy) shiftWorld(0, dy);
    return dy;
  }
  // Slide BOTH layers in lockstep with the shared camera; anchor players once.
  void shiftWorld(int dx, int dy) {
    if ((!dx && !dy) || !fg.infinite) return;
    worldShiftCount++;
    useLayer(&fg); shiftLayer(dx, dy);
    useLayer(&bg); shiftLayer(dx, dy);
    useLayer(&fg);
    for (auto& p : players) { p.px -= dx; p.py -= dy; p.aimX -= dx; p.aimY -= dy; }
    remapDraftsForShift(dx, dy); // pin in-progress solid drafts to their world location (mirrors the grid shift)
    useLayer(&fg); clearAllMineDamage();
    useLayer(&bg); clearAllMineDamage();
    useLayer(&fg);
    for (auto& p : players) p.mineActive = false;
  }
  void shiftLayer(int dx, int dy) {
    if ((!dx && !dy) || !L->infinite) return;
    int s = std::abs(dx) + std::abs(dy);
    if (s >= (dx ? cols : rows)) return;
    // leaving / entering buffer rects (one axis only).
    int lx0, ly0, lw, lh, ex0, ey0, ew, eh;
    if (dx) { lh = eh = rows; ly0 = ey0 = 0; lw = ew = s; lx0 = dx > 0 ? 0 : cols - s; ex0 = dx > 0 ? cols - s : 0; }
    else    { lw = ew = cols; lx0 = ex0 = 0; lh = eh = s; ly0 = dy > 0 ? 0 : rows - s; ey0 = dy > 0 ? rows - s : 0; }

    // 1) clear body rasters so no RIGID ghost is saved/memmoved.
    for (int k : L->bodyCells) { if (grid[k] == RIGID) grid[k] = EMPTY; if (next[k] == RIGID) next[k] = EMPTY; bodyOwner[k] = -1; }
    L->bodyCells.clear();
    // 2) persist the leaving band (bodies + full-state tiles) at the CURRENT offset.
    csSaveBodiesLeaving(lx0, ly0, lw, lh);
    csSaveTiles(lx0, ly0, lw, lh);
    // 3) slide the buffers + dirty marks.
    double _t = emscripten_get_now();
    if (dx) {
      shiftRowMajorU8(grid, dx, EMPTY); shiftRowMajorU8(next, dx, EMPTY); shiftRowMajorI32(bodyOwner, dx, -1);
      for (int y = 0; y < rows; y++) { if (rowMarkMax[y] < rowMarkMin[y]) continue; int mn = rowMarkMin[y] - dx, mx = rowMarkMax[y] - dx; if (mx < 0 || mn > cols - 1) { rowMarkMin[y] = cols; rowMarkMax[y] = -1; continue; } rowMarkMin[y] = mn < 0 ? 0 : mn; rowMarkMax[y] = mx > cols - 1 ? cols - 1 : mx; }
    } else {
      shiftBufV(grid, dy, EMPTY); shiftBufV(next, dy, EMPTY); shiftBufVI32(bodyOwner, dy, -1);
      if (dy > 0) for (int y = 0; y < rows; y++) { int sy = y + dy; rowMarkMin[y] = sy < rows ? rowMarkMin[sy] : cols; rowMarkMax[y] = sy < rows ? rowMarkMax[sy] : -1; }
      else for (int y = rows - 1; y >= 0; y--) { int sy = y + dy; rowMarkMin[y] = sy >= 0 ? rowMarkMin[sy] : cols; rowMarkMax[y] = sy >= 0 ? rowMarkMax[sy] : -1; }
    }
    std::fill(compOccStamp, compOccStamp + (size_t)cols * rows, -1);
    std::fill(vacatedStamp, vacatedStamp + (size_t)cols * rows, -1);
    perfShiftBuffers = emscripten_get_now() - _t;
    // 4) translate staying bodies; drop any fully off the buffer.
    { std::vector<Body*> keep; for (Body* b : L->bodies) { b->px -= dx; b->py -= dy; if (b->px > -b->maxR && b->px < cols + b->maxR && b->py > -b->maxR && b->py < rows + b->maxR) keep.push_back(b); else delete b; } L->bodies = std::move(keep); }
    // 5) advance the offset, then bring in the entering band: generate the baseline
    //    only if not fully cached, then overlay any saved tiles + restore bodies.
    L->worldOffsetX += dx; L->worldOffsetY += dy;
    _t = emscripten_get_now();
    if (!csTilesAllPresent(ex0, ey0, ew, eh)) { shiftFillMiss++; if (dx) fillRect(ex0, ex0 + ew, 0, rows); else fillRect(0, cols, ey0, ey0 + eh); }
    else shiftFillHit++; // band fully cached (saved tiles or a prefetched baseline) -> no worldgen this frame
    csLoadTiles(ex0, ey0, ew, eh);
    csRestoreBodies(ex0, ey0, ew, eh);
    perfShiftFill = emscripten_get_now() - _t;
    // 6) mark the entering band active so it simulates.
    if (dx) for (int y = 0; y < rows; y++) { if (ex0 < rowMarkMin[y]) rowMarkMin[y] = ex0; if (ex0 + s - 1 > rowMarkMax[y]) rowMarkMax[y] = ex0 + s - 1; }
    else for (int y = ey0; y < ey0 + s; y++) { rowMarkMin[y] = 0; rowMarkMax[y] = cols - 1; }
    // 7) re-index components, register the entering band.
    _t = emscripten_get_now();
    translateComponents(L->stoneComponents, dx, dy);
    translateComponents(L->plantComponents, dx, dy);
    translateComponents(L->iceComponents, dx, dy);
    perfShiftTranslate = emscripten_get_now() - _t;
    _t = emscripten_get_now();
    if (dx) registerSeededComponents(ex0, ex0 + s, 0, rows);
    else registerSeededComponents(0, cols, ey0, ey0 + s);
    perfShiftRegister = emscripten_get_now() - _t;
  }
  void shiftRowMajorI32(int32_t* arr, int dx, int32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * 4); for (int i = b + cols - dx; i < b + cols; i++) arr[i] = fill; }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, (size_t)(cols - s) * 4); for (int i = b; i < b + s; i++) arr[i] = fill; } }
  }

