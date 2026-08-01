  // Procedural terrain, chunk store, and infinite world streaming.
  //
  // Owns deterministic generation from absolute world coordinates, cached chunk
  // save/restore, prefetch, and horizontal/vertical window shifts. Camera.inc may
  // request a shift, but this subsystem decides how cells/components/entities
  // move across the loaded window.
  // Surface height, climate, and soil use the shared seed so layers align near
  // the surface. The foreground owns player-clear cave backbones; the background
  // is a mostly-solid backdrop with only rare rounded chambers.
  // Deterministic terrain queries (TerrainGen, terrain.hpp) — composed here;
  // method bodies in terrain_impl.inc. Streaming + fill passes below.
  TerrainGen terrain{*this};
  static constexpr int VILLAGE_LATTICE = WorldContextSystem::VILLAGE_LATTICE;
  static constexpr double VILLAGE_CHANCE = WorldContextSystem::VILLAGE_CHANCE;
  // Shims for the external users (player spawn, render lighting, ABI).
  int genSurfaceAt(int worldX) { return terrain.genSurfaceAt(worldX); }
  int genSurfaceAbs(int worldX) { return terrain.genSurfaceAbs(worldX); }

  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd).
  // A horizontal stream-in passes a column band (full rows); a vertical one passes
  // a row band (full cols); the initial fill is the whole buffer.
  // Base terrain (no trees) over the rect. Split out of fillRect so the prefetch
  // path can generate a band one column-slice at a time across frames; trees must
  // run only AFTER all of a band's terrain columns exist (a tree canopy spills over
  // sky cells, which a later terrain slice would otherwise overwrite), so they're a
  // separate pass. Each column is generated independently of the others.
  void fillTerrain(int colStart, int colEnd, int rowStart, int rowEnd) {
    int n = colEnd - colStart;
    if (n <= 0) return;
    // genSurfaceAbs is multi-octave value noise. The original evaluated genSurfaceAt
    // 3x per column (self + both neighbours for the slope), so each boundary height
    // was recomputed for the adjacent column too. Precompute the band's absolute
    // surface once for [colStart-1, colEnd] and read neighbours from it: byte-identical
    // heights (genSurfaceAt = genSurfaceAbs - worldOffsetY; the offset cancels in the
    // slope difference) with ~3x fewer noise evaluations.
    surfAbsScratch.resize((size_t)n + 2);
    for (int i = 0; i < n + 2; i++) surfAbsScratch[i] = terrain.genSurfaceAbs(L->worldOffsetX + colStart - 1 + i);
    for (int lx = colStart, j = 0; lx < colEnd; lx++, j++) {
      int worldX = L->worldOffsetX + lx;
      int surf = surfAbsScratch[j + 1] - L->worldOffsetY;
      int slope = std::abs(surfAbsScratch[j + 2] - surfAbsScratch[j]);
      int biome = terrain.genBiomeAt(worldX); int soil = terrain.genSoilDepthAt(worldX, biome);
      for (int y = rowStart; y < rowEnd; y++) L->grid[y * cols + lx] = terrain.genCellAt(worldX, surf, slope, biome, soil, y);
    }
  }
  // Trees are background silhouettes over already-generated terrain. Trees reach
  // TREE_REACH cols outside the rect (clipped by `put`), so a band re-evaluates the
  // trunks just outside it and canopies span band seams identically to one big call.
  void fillTrees(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (!L->isBackground) return;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return; if (L->grid[y * cols + lx] == EMPTY) L->grid[y * cols + lx] = m; };
    const int TREE_REACH = 13;   // >= max canopy / branch horizontal reach
    const int TREE_MAX_UP = 42;  // >= max trunk height + canopy upward reach
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = terrain.genSurfaceAt(worldX);
      if (surf + 2 < rowStart || surf - TREE_MAX_UP >= rowEnd) continue; // footprint misses the rect
      // Leave a clean skyline around deterministic villages. Besides making the
      // settlement readable, this prevents background tree components from
      // overlapping the foreground buildings across simulation layers.
      bool nearVillage = false; int vq = worldX / VILLAGE_LATTICE; if (worldX < 0 && worldX % VILLAGE_LATTICE) vq--;
      uint32_t villageSeed = L->worldSeed ^ 0x57121314u;
      for (int v = vq - 1; v <= vq + 1; v++) if (whash1(villageSeed ^ 0xA11A6Eu, v) <= VILLAGE_CHANCE) {
        int vc = v * VILLAGE_LATTICE + 76 + (int)(whash1(villageSeed ^ 0xA11A6Fu, v) * 268);
        if (std::abs(worldX - vc) < 252) { nearVillage = true; break; }
      }
      if (nearVillage) continue;
      if (!terrain.genTreeAt(worldX, surf)) continue;
      int biome = terrain.genBiomeAt(worldX);
      uint8_t pt = terrain.pickTreeType(biome, worldX);
      uint8_t wood = plantWoodMat(pt), leaf = plantLeafMat(pt);
      double hr = whash1(L->gTreeSeed + 1, worldX);
      int h = pt == PT_PINE ? 23 + (int)(hr * 13)     // towering conifer
            : pt == PT_BUSH ? 4 + (int)(hr * 4)       // low shrub
            : pt == PT_CACTUS ? 9 + (int)(hr * 8)     // tall branching cactus
            : pt == PT_WILLOW ? 18 + (int)(hr * 10)
            : 13 + (int)(hr * 12);                    // mature oak
      int top = surf - h;
      auto trunkXAtHeight = [&](int height) {
        if (pt != PT_PINE && pt != PT_WILLOW) return lx;
        int drift = 0, maxDrift = pt == PT_PINE ? 2 : 3;
        for (int band = 0; band < height / 4; band++) {
          double turn = whash2(L->gTreeSeed ^ 0x54A1u, worldX, band);
          if (turn < 0.27) drift--;
          else if (turn > 0.73) drift++;
          drift = imax(-maxDrift, imin(maxDrift, drift));
        }
        return lx + drift;
      };
      for (int y = top; y < surf; y++) {
        int height = surf - y, center = trunkXAtHeight(height), radius = 0;
        if (pt == PT_PINE) radius = height <= 5 ? 2 : height <= 15 ? 1 : 0;
        else if (pt == PT_WILLOW) radius = height <= 6 ? 2 : height <= 14 ? 1 : 0;
        for (int ox = -radius; ox <= radius; ox++) put(center + ox, y, wood);
      }
      if (pt == PT_CACTUS) {                            // arms, no foliage
        int armY = top + 2 + (int)(whash1(L->gTreeSeed ^ 0x3a3au, worldX) * imax(1, h - 4));
        put(lx - 1, armY, wood); put(lx - 2, armY, wood); put(lx - 2, armY - 1, wood);
        put(lx + 1, armY + 2, wood); put(lx + 2, armY + 2, wood); put(lx + 2, armY + 1, wood);
      } else if (pt == PT_PINE) {                       // tapered, ragged evergreen crown
        int level = 4 + (int)(whash1(L->gTreeSeed ^ 0x91A0u, worldX) * 3);
        for (int tier = 0; tier < 9 && level < h - 1; tier++) {
          int baseX = trunkXAtHeight(level), baseY = surf - level;
          int baseReach = 3 + (h - level) * 5 / h;
          for (int side : {-1, 1}) {
            double shape = whash2(L->gTreeSeed ^ 0x91A1u, worldX + side, tier);
            int reach = imax(2, baseReach + (int)(shape * 4) - 2);
            if (shape < 0.10) continue;
            for (int i = 1; i <= reach; i++) {
              int droop = i > reach * 2 / 3 ? (i - reach * 2 / 3 + 1) / 2 : 0;
              put(baseX + side * i, baseY + droop, wood);
            }
          }
          level += 3 + (int)(whash2(L->gTreeSeed ^ 0x91A2u, worldX, tier) * 3);
        }
        int crownH = h - 4;
        for (int oy = -2; oy < crownH; oy++) {
          int y = top + oy, crownX = trunkXAtHeight(surf - y);
          double t = (double)(oy + 2) / (double)imax(1, crownH + 1);
          int rad = 1 + (int)std::floor(t * 7.0);
          // Subtle tiering breaks the cone edge without producing flat shelves.
          if (oy > 2 && oy % 5 == 0) rad = imin(8, rad + 2);
          for (int ox = -rad; ox <= rad; ox++) {
            double edge = whash2(L->gTreeSeed ^ 0x91A3u, worldX + ox, oy);
            if (std::abs(ox) <= rad - 2 || edge > 0.28) put(crownX + ox, y, leaf);
            if (std::abs(ox) < rad && oy % 4 != 1 && edge > 0.18) put(crownX + ox, y + 1, leaf);
          }
        }
      } else if (pt == PT_WILLOW) {                     // clustered crown + soft, irregular droops
        int crownX = trunkXAtHeight(h);
        for (int tier = 0; tier < 3; tier++) for (int side : {-1, 1}) {
          double shape = whash2(L->gTreeSeed ^ 0x7714u, worldX + side, tier);
          if (shape < 0.08) continue;
          int level = h - 3 - tier * 3 + (shape > 0.66 ? 1 : 0);
          int baseX = trunkXAtHeight(level), baseY = surf - level;
          int len = 5 + (int)(whash2(L->gTreeSeed ^ 0x7715u, worldX + side, tier) * 5);
          for (int i = 1; i <= len; i++) {
            int lift = imin(2, (i + 1) / 3);
            int sag = i > len * 2 / 3 ? (i - len * 2 / 3 + 1) / 2 : 0;
            put(baseX + side * i, baseY - lift + sag, wood);
          }
        }
        for (int cx : {-6, -3, 0, 3, 6}) {
          int cy = -2 + (std::abs(cx) / 3) + (int)(whash2(L->gTreeSeed ^ 0x7711u, worldX, cx) * 3);
          int rr = 4 + (std::abs(cx) < 4 ? 1 : 0);
          for (int oy = -rr; oy <= rr; oy++) for (int ox = -rr; ox <= rr; ox++)
            if (ox * ox + oy * oy <= rr * rr + 2) put(crownX + cx + ox, top + cy + oy, leaf);
          int drop = 2 + (int)(whash2(L->gTreeSeed ^ 0x7712u, worldX, cx) * 5);
          int sway = whash2(L->gTreeSeed ^ 0x7713u, worldX, cx) < 0.5 ? -1 : 1;
          for (int i = 1; i <= drop; i++) { put(crownX + cx + (i > drop / 2 ? sway : 0), top + cy + rr + i, leaf); if (i < drop - 1) put(crownX + cx + 1, top + cy + rr + i, leaf); }
        }
      } else {                                          // oak / bush: forked limbs and cloud canopy
        int rad = pt == PT_BUSH ? 4 : 8;
        if (pt != PT_BUSH) for (int side : {-1, 1}) {
          int len = 4 + (int)(whash1(L->gTreeSeed ^ (side < 0 ? 0x81u : 0x82u), worldX) * 4);
          int by = top + 4 + (side < 0 ? 1 : 0);
          for (int i = 1; i <= len; i++) { put(lx + side * i, by - i / 3, wood); if (i > len / 2) put(lx + side * i, by - i / 3 - 1, leaf); }
        }
        for (int cy = -4; cy <= 2; cy += 3) for (int cx = -rad + 2; cx <= rad - 2; cx += 4)
          for (int oy = -3; oy <= 3; oy++) for (int ox = -3; ox <= 3; ox++) if (ox * ox + oy * oy <= 10) put(lx + cx + ox, top + cy + oy, leaf);
      }
    }
  }
  // ---- deterministic structure stamping (ruins) -----------------------------
  // Discrete structures anchor on a coarse world-cell lattice. Each lattice cell's
  // presence/size is a pure hash of its (latX,latY), so a structure is byte-identical
  // no matter which band generates it. Like fillTrees, we OVERSCAN the rect by
  // STRUCT_REACH and clip with `put`, so a structure straddling a band seam is written
  // identically whether produced by one big fillRect or two band calls. fg only.
  static const int STRUCT_LATTICE = 76;  // world cells between candidate anchors
  static const int STRUCT_REACH = 256;   // includes villages and broad mine galleries
  static int floorDiv(int a, int b) { int q = a / b, r = a % b; if (r != 0 && ((r < 0) != (b < 0))) q--; return q; }
  struct ForegroundTerrainScope {
    Layer* layer;
    bool wasBackground;
    uint32_t caveSeed;
    explicit ForegroundTerrainScope(Layer* active)
      : layer(active), wasBackground(active->isBackground), caveSeed(active->gCaveSeed) {
      if (wasBackground) {
        layer->isBackground = false;
        layer->gCaveSeed = layer->worldSeed ^ 0x5bd1e995u;
      }
    }
    ~ForegroundTerrainScope() {
      layer->isBackground = wasBackground;
      layer->gCaveSeed = caveSeed;
    }
  };
