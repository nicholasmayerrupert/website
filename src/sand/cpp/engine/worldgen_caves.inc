  void fillDeepGeneratedFeature(
      const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    bool background = L->isBackground;
    auto put = [&](int wx, int wy, uint8_t mat) {
      int x = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      stampGeneratedFeatureCell(feature, y * cols + x, mat);
    };
    if (feature.family != GFF_DEEP_STRUCTURE) return;
    int rectX0 = L->worldOffsetX + colStart, rectX1 = L->worldOffsetX + colEnd - 1;
    int rectY0 = L->worldOffsetY + rowStart, rectY1 = L->worldOffsetY + rowEnd - 1;
    int wx0 = rectX0 - feature.overscanX;
    int wx1 = rectX1 + feature.overscanX;
    int wy0 = rectY0 - feature.overscanY;
    int wy1 = rectY1 + feature.overscanY;
    if (wy1 < TerrainGen::DEEP_BLEND_TOP) return;
    int gx0 = floorDiv(wx0, feature.latticeWidth);
    int gx1 = floorDiv(wx1, feature.latticeWidth);
    int gy0 = imax(0, floorDiv(wy0 - TerrainGen::CAVE_BOTTOM,
                              feature.latticeHeight));
    int gy1 = imax(0, floorDiv(wy1 - TerrainGen::CAVE_BOTTOM,
                              feature.latticeHeight));
    uint32_t seed = L->worldSeed ^ 0xD33A900u;

    // All placement queries use the foreground graph, including during
    // background generation and predictive prefetch.
    ForegroundTerrainScope foregroundQuery(L);
    for (int gy = gy0; gy <= gy1; gy++) for (int gx = gx0; gx <= gx1; gx++) {
      DeepStructurePlan plan;
      if (!worldContext.deepStructurePlan(gx, gy, plan)) continue;
      TerrainGen::DeepCavernPlan p{
        plan.cavernCenterX, plan.cavernCenterY,
        plan.cavernRadiusX, plan.cavernRadiusY,
      };
      int biome = plan.caveBiome;
      const CaveBiomeDef& biomeDef = caveBiomeDef(biome);
      int width = plan.naveRight - plan.naveLeft + 1;
      int height = plan.floorY - plan.naveTop + 1;
      int floorY = plan.floorY;
      int left = plan.naveLeft, right = plan.naveRight, top = plan.naveTop;
      if (plan.right < rectX0 || plan.left > rectX1
          || plan.bottom < rectY0 || plan.top - 3 > rectY1) continue;

      uint8_t wall = biomeDef.monumentWall;
      uint8_t accent = biomeDef.monumentAccent;
      int half = imax(1, width / 2);

      // Clear a genuinely roomy nave in front. Behind it, repair any rare natural
      // background recess into one continuous decorated wall.
      for (int x = left; x <= right; x++) {
        int dx = std::abs(x - p.centerX);
        int roofY = top + dx * dx * 7 / (half * half);
        for (int y = roofY + 2; y < floorY; y++) {
          if (background) {
            bool course = (y - top) % 8 == 0;
            put(x, y, course ? wall : DEEPSTONE);
          } else {
            put(x, y, EMPTY);
          }
        }
        put(x, roofY, wall);
        put(x, roofY + 1, wall);
        put(x, floorY, wall);
        put(x, floorY + 1, DEEPSTONE);
        put(x, floorY + 2, DEEPSTONE);
      }
      for (int y = top + 6; y <= floorY; y++) {
        put(left, y, wall); put(left + 1, y, wall);
        put(right - 1, y, wall); put(right, y, wall);
      }

      // Massive exterior buttresses carry the hall into the cavern floor or lava.
      for (int bx : {left + 7, p.centerX, right - 7}) {
        int baseWidth = bx == p.centerX ? 3 : 2;
        for (int y = floorY + 1;
             y <= floorY + DeepStructurePlan::BUTTRESS_DEPTH; y++) {
          int flare = (y - floorY) / 7;
          for (int dx = -baseWidth - flare; dx <= baseWidth + flare; dx++) put(bx + dx, y, DEEPSTONE);
        }
      }

      // Two wide side portals meet the natural cavern even when the shell clips
      // into a rough wall. At 14 cells high they clear the player with room to jump.
      if (!background) for (int side : {-1, 1}) {
        int edge = side < 0 ? left : right;
        for (int d = 0; d <= DeepStructurePlan::SIDE_PORTAL_REACH; d++)
          for (int y = floorY - PLAYER_H - 6; y < floorY; y++)
            put(edge + side * d, y, EMPTY);
      }

      CaveDeepStructureHandler structureHandler =
        caveProfileHandler(biomeDef.profile).deepStructure;
      if (structureHandler == CDSH_MAGMA) {
        // Furnace citadel: tall arched bays, molten hearths, chains, and an
        // uninterrupted central causeway above the surrounding lava.
        for (int bay = 0; bay < 4; bay++) {
          int cx = left + (bay * 2 + 1) * width / 8;
          if (background) {
            for (int y = floorY - 11; y <= floorY - 4; y++)
              for (int x = cx - 5; x <= cx + 5; x++)
                put(x, y, (x == cx - 5 || x == cx + 5 || y == floorY - 11) ? BRICK : DEEPSTONE);
            for (int y = floorY - 8; y <= floorY - 4; y++)
              for (int x = cx - 2; x <= cx + 2; x++) put(x, y, LAVA);
            put(cx - 6, floorY - 3, IRON_ORE);
            put(cx - 5, floorY - 3, IRON_ORE);
          } else {
            for (int y = floorY - 10; y < floorY - 2; y++) {
              put(cx - 6, y, BRICK); put(cx + 6, y, BRICK);
            }
            for (int x = cx - 6; x <= cx + 6; x++) put(x, floorY - 11, BRICK);
          }
          for (int y = top + 7; y < floorY - 13; y++) put(cx, y, IRON_ORE);
          put(cx, floorY - 13, CRYSTAL);
        }
        for (int x = left + 3; x <= right - 3; x += 4) {
          put(x, floorY - 2, IRON_ORE);
          if ((x - left) % 12 == 3) put(x, floorY - 3, GOLD_ORE);
        }
      } else if (structureHandler == CDSH_GEODE) {
        // Crystal observatory: concentric luminous arches frame a broad altar,
        // with a star-map mosaic living safely in the background.
        for (int ring = 0; ring < 3; ring++) {
          int rx = width / 2 - 12 - ring * 8, ry = height - 15 - ring * 5;
          for (int dx = -rx; dx <= rx; dx++) {
            double nx = (double)dx / (double)rx;
            int y = floorY - (int)std::round(ry * std::sqrt(std::fmax(0.0, 1.0 - nx * nx)));
            put(p.centerX + dx, y, ring == 1 ? DEEPSTONE : CRYSTAL);
          }
        }
        if (background) {
          for (int star = 0; star < 28; star++) {
            int x = left + 8 + (int)(whash2(seed ^ 0xB10u, gx * 31 + star, gy) * (width - 16));
            int y = top + 9 + (int)(whash2(seed ^ 0xB11u, gx, gy * 31 + star) * (height - 20));
            put(x, y, star % 5 ? CRYSTAL : GOLD_ORE);
          }
          for (int x = p.centerX - 10; x <= p.centerX + 10; x++)
            put(x, floorY - 4 - std::abs(x - p.centerX) / 4, CRYSTAL);
        }
      } else if (structureHandler == CDSH_FOSSIL) {
        // Fossil conservatory: broad timber scaffolds, excavation tables, rail
        // carts, and carefully mounted remains make this feel actively studied.
        for (int sx = left + 10; sx < right - 8; sx += 18) {
          for (int y = top + 10; y < floorY; y++) put(sx, y, WOOD);
          for (int x = sx; x <= imin(right - 3, sx + 13); x++) {
            put(x, top + 15, WOOD);
            put(x, floorY - 10, WOOD);
          }
        }
        if (background) {
          for (int table = 0; table < 4; table++) {
            int x0 = left + 9 + table * (width - 20) / 4;
            for (int x = x0; x < x0 + 10; x++) put(x, floorY - 5, WOOD);
            put(x0 + 1, floorY - 4, SANDSTONE);
            put(x0 + 4, floorY - 4, DEBRIS);
            put(x0 + 7, floorY - 4, GOLD_ORE);
          }
          for (int x = left + 5; x <= right - 5; x++) {
            put(x, floorY - 2, IRON_ORE);
            if ((x - left) % 8 == 0) {
              put(x, floorY - 3, IRON_ORE);
              put(x + 2, floorY - 3, IRON_ORE);
            }
          }
          for (int x = p.centerX - 14; x <= p.centerX + 14; x++) {
            int y = top + 11 + (x - p.centerX) * (x - p.centerX) / 42;
            put(x, y, SANDSTONE);
          }
        }
      } else if (structureHandler == CDSH_VOID) {
        // Hanging archive: high galleries, packed shelves, fungal tapestries,
        // lamps, and a clear ceremonial aisle through the center.
        for (int level = 0; level < 2; level++) {
          int y = floorY - 12 - level * 12;
          for (int x = left + 5; x <= right - 5; x++) put(x, y, BRICK);
          for (int x : {left + 8, right - 8}) for (int yy = y; yy < floorY; yy++) put(x, yy, BRICK);
        }
        if (background) {
          for (int shelf = 0; shelf < 7; shelf++) {
            int x0 = left + 7 + shelf * (width - 16) / 7;
            for (int y = floorY - 10; y <= floorY - 4; y++) {
              put(x0, y, WOOD); put(x0 + 6, y, WOOD);
            }
            for (int y : {floorY - 10, floorY - 7, floorY - 4})
              for (int x = x0; x <= x0 + 6; x++) put(x, y, WOOD);
            put(x0 + 2, floorY - 8, MYCELIUM);
            put(x0 + 4, floorY - 5, GLOWSHROOM);
          }
          for (int x : {p.centerX - 18, p.centerX, p.centerX + 18}) {
            for (int y = top + 4; y <= top + 15; y++) put(x, y, VINE);
            put(x - 1, top + 15, GLOWSHROOM);
            put(x, top + 15, GLOWSHROOM);
            put(x + 1, top + 15, GLOWSHROOM);
          }
        }
      } else if (structureHandler != CDSH_NONE) {
        __builtin_trap();
      }

      // Reopen a generous central aisle after every archetype's foreground
      // detailing. Architectural rhythm remains on either side, never as clutter
      // the player has to squeeze through.
      if (!background)
        for (int x = p.centerX - 7; x <= p.centerX + 7; x++)
          for (int y = floorY - PLAYER_H - 6; y < floorY; y++) put(x, y, EMPTY);
      if (background) put(p.centerX, floorY - 2, accent);
    }
  }
  // Deterministic ocean gardens rooted in the background seabed. VINE is used as
  // flexible kelp, with leafy forks and occasional luminous berries attached to
  // the stalk so every generated plant cell belongs to a grounded component.
  void fillOceanFlora(int colStart, int colEnd, int rowStart, int rowEnd,
                      int reachX) {
    if (!L->isBackground) return;
    auto put = [&](int wx, int wy, uint8_t m) {
      if (wy < L->gSeaRow) return; // ocean flora never breaches the water surface
      int x = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      int k = y * cols + x; if (L->grid[k] == WATER || L->grid[k] == EMPTY) L->grid[k] = m;
    };
    for (int x = colStart - reachX; x < colEnd + reachX; x++) {
      int wx = L->worldOffsetX + x, surfAbs = terrain.genSurfaceAbs(wx);
      if (surfAbs <= L->gSeaRow + 3) continue;
      double spawn = whash1(L->worldSeed ^ 0x5EA9EEDu, wx);
      if (spawn > 0.115) continue;
      int height = 4 + (int)(whash1(L->worldSeed ^ 0x5EA9EEEu, wx) * imin(18, imax(5, surfAbs - L->gSeaRow - 1)));
      for (int i = 1; i <= height; i++) {
        int sway = i > height / 2 && whash2(L->worldSeed ^ 0x5EA9EEFu, wx, i) > 0.72 ? (i & 1 ? 1 : -1) : 0;
        put(wx + sway, surfAbs - i, VINE);
        if (i > 2 && i % 4 == 0) put(wx + (i & 4 ? 1 : -1), surfAbs - i, PLANT);
        if (i > 3 && whash2(L->worldSeed ^ 0x610BEEu, wx, i) > 0.91) put(wx + (i & 1 ? 1 : -1), surfAbs - i + 1, GLOWBERRY);
      }
    }
  }
  void putCaveFeatureCell(int colStart, int colEnd, int rowStart, int rowEnd, int wx, int wy, uint8_t m, bool requireEmpty = true) {
    int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
    if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
    int k = y * cols + lx;
    if (requireEmpty && L->grid[k] != EMPTY) return;
    L->grid[k] = m;
  }
  // Foreground cave biomes. The terrain pass decides the cave shape; this pass
  // attaches biome detail to floors, ceilings and walls so features blend into the
  // existing cave network rather than carving detached oval rooms.
  void fillCaveFeatures(int colStart, int colEnd, int rowStart, int rowEnd,
                        int reachX, int reachY) {
    if (L->isBackground) return;
    uint32_t sseed = L->gCaveSeed ^ 0xF3A741u;
    int wx0 = L->worldOffsetX + colStart - reachX;
    int wx1 = L->worldOffsetX + colEnd + reachX;
    int wy0 = L->worldOffsetY + rowStart - reachY;
    int wy1 = L->worldOffsetY + rowEnd + reachY;
    int lxMin = floorDiv(wx0, CAVE_DRESSING_LATTICE);
    int lxMax = floorDiv(wx1, CAVE_DRESSING_LATTICE);
    int lyMin = floorDiv(wy0, CAVE_DRESSING_LATTICE);
    int lyMax = floorDiv(wy1, CAVE_DRESSING_LATTICE);
    auto findFloor = [&](int wx, int wy, int& floorY) {
      for (int dy = -8; dy <= 12; dy++) {
        int yy = wy + dy;
        if (terrain.genOpenCaveAt(wx, yy) && !terrain.genOpenCaveAt(wx, yy + 1)) { floorY = yy; return true; }
      }
      return false;
    };
    auto findCeiling = [&](int wx, int wy, int& ceilY) {
      for (int dy = -12; dy <= 8; dy++) {
        int yy = wy + dy;
        if (terrain.genOpenCaveAt(wx, yy) && !terrain.genOpenCaveAt(wx, yy - 1)) { ceilY = yy; return true; }
      }
      return false;
    };
    auto stampCrystalSpike = [&](int wx, int baseY, int dir, int ht, int baseRad) {
      // Width is purely the tapering radius (no height-driven base flare — that was
      // what made tall spikes balloon out sideways). Base width = 2*baseRad+1,
      // narrowing to a point every 4 rows up.
      for (int i = 0; i < ht && terrain.genOpenCaveAt(wx, baseY + dir * i); i++) {
        int rad = imax(0, baseRad - i / 4);
        for (int dx = -rad; dx <= rad; dx++)
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + dx, baseY + dir * i, CRYSTAL);
      }
    };
    auto stampSaltPile = [&](int wx, int floorY, int gx, int gy) {
      int half = 2 + (int)(whash2(sseed ^ 0x611u, gx, gy) * 5);
      int maxH = 2 + (int)(whash2(sseed ^ 0x612u, gx, gy) * 4);
      for (int dx = -half; dx <= half; dx++) {
        int px = wx + dx;
        double falloff = 1.0 - (double)std::abs(dx) / (double)(half + 1);
        int hgt = 1 + (int)std::floor(falloff * maxH);
        for (int i = 0; i < hgt && terrain.genOpenCaveAt(px, floorY - i); i++) {
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY - i, SALT);
        }
      }
    };
    auto stampMethanePocket = [&](int wx, int ceilY, int gx, int gy) {
      // A shallow lens attached to the cave ceiling. The generic gas pass lets it
      // spread into nearby high points afterward; generation only supplies a
      // deterministic, seam-safe initial pocket.
      int rx = 6 + (int)(whash2(sseed ^ 0x6A50u, gx, gy) * 8);
      int depth = 2 + (int)(whash2(sseed ^ 0x6A51u, gx, gy) * 2);
      for (int dy = 0; dy < depth; dy++) {
        double t = (double)dy / (double)depth;
        int half = imax(1, (int)std::floor(rx * std::sqrt(1.0 - t * t)));
        for (int dx = -half; dx <= half; dx++) {
          int px = wx + dx, py = ceilY + dy;
          if (terrain.genOpenCaveAt(px, py))
            putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, py, METHANE);
        }
      }
    };
    auto stampLavaBasin = [&](int wx, int floorY, int gx, int gy) {
      // Wide size spread: a squared roll skews toward many small glowing pools with
      // the occasional big lake. Depth tracks width so the pool stays basin-shaped
      // (never a flat lava streak) and stone-lined.
      double lv = whash2(sseed ^ 0x550u, gx, gy);
      int rx = 4 + (int)(lv * lv * 14);                                    // 4..17
      int ry = 2 + (int)(whash2(sseed ^ 0x551u, gx, gy) * 4) + rx / 4;     // depth grows with width
      for (int dx = -rx - 3; dx <= rx + 3; dx++) {
        int px = wx + dx;
        double ax = (double)std::abs(dx);
        double nx = std::fmin(1.0, ax / (double)imax(1, rx));
        double curve = std::sqrt(std::fmax(0.0, 1.0 - nx * nx));
        int depth = 3 + (int)std::floor(curve * ry);
        bool bank = ax > rx;
        bool wall = ax >= rx - 2;
        if (bank) {
          for (int yy = floorY - 1; yy <= floorY + depth + 2; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, STONE, false);
          continue;
        }
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 1, STONE, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth, STONE, false);
        if (wall) {
          for (int yy = floorY - 1; yy <= floorY + depth; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, STONE, false);
        } else {
          for (int yy = floorY; yy < floorY + depth; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, LAVA, false);
        }
      }
    };
    auto stampCrystalAcidBasin = [&](int wx, int floorY, int gx, int gy) {
      // Big lakes are the norm: taking the MAX of two rolls skews the size toward
      // the large end, and the floor keeps out tiny ponds entirely. Depth tracks
      // width so even the widest basins stay rounded (never a flat acid smear).
      double av = whash2(sseed ^ 0x440u, gx, gy), bv = whash2(sseed ^ 0x441u, gx, gy);
      int rx = 12 + (int)(std::fmax(av, bv) * 23);                         // 12..35, large-skewed
      int ry = 3 + (int)(whash2(sseed ^ 0x442u, gx, gy) * 5) + rx / 5;     // depth grows with width (lake-like)
      for (int dx = -rx - 4; dx <= rx + 4; dx++) {
        int px = wx + dx;
        double ax = (double)std::abs(dx);
        double nx = std::fmin(1.0, ax / (double)imax(1, rx));
        double curve = std::sqrt(std::fmax(0.0, 1.0 - nx * nx));
        int depth = 3 + (int)std::floor(curve * ry);
        bool bank = ax > rx;
        bool wall = ax >= rx - 2;
        if (bank) {
          for (int yy = floorY - 2; yy <= floorY + depth + 3; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, STONE, false);
          continue;
        }
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 2, STONE, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 1, STONE, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth, CRYSTAL, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth - 1, CRYSTAL, false);
        if (wall) {
          for (int yy = floorY - 1; yy <= floorY + depth; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, CRYSTAL, false);
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 1, STONE, false);
        } else {
          for (int yy = floorY; yy < floorY + depth - 1; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, ACID, false);
        }
      }
    };
    auto stampMyceliumTendril = [&](int wx, int startY, int gx, int gy) {
      int len = 9 + (int)(whash2(sseed ^ 0x220u, gx, gy) * 20);
      int dir = whash2(sseed ^ 0x221u, gx, gy) < 0.5 ? -1 : 1;
      int px = wx, py = startY;
      for (int i = 0; i < len; i++) {
        if (terrain.genOpenCaveAt(px, py)) {
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, py, MYCELIUM);
          if (whash2(sseed ^ 0x225u, px, py) > 0.72) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, py - 1, MYCELIUM);
          if (whash2(sseed ^ 0x226u, px, py) > 0.82) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px - dir, py, MYCELIUM);
        }
        px += dir;
        double step = whash2(sseed ^ 0x224u, gx * 31 + i, gy);
        if (step < 0.24) py--;
        else if (step > 0.78) py++;
      }
    };
    for (int gy = lyMin; gy <= lyMax; gy++) for (int gx = lxMin; gx <= lxMax; gx++) {
      int wx = gx * CAVE_DRESSING_LATTICE
             + (int)(whash2(sseed ^ 0x11u, gx, gy) * CAVE_DRESSING_LATTICE);
      int wy = gy * CAVE_DRESSING_LATTICE
             + (int)(whash2(sseed ^ 0x22u, gx, gy) * CAVE_DRESSING_LATTICE);
      BiomeSample sample = terrain.genBiomeSampleAt(wx, wy);
      if (sample.ownerFamily != BF_CAVE) continue;
      const CaveBiomeDef& caveDef = caveBiomeDef(sample.ownerBiome);
      int caveTop = terrain.genCaveTopAbs(wx);
      int hazardRampBottom = terrain.caveBottomAbs() * 4 / 5;
      double depth01 = std::fmax(0.0, std::fmin(1.0,
        (double)(wy - caveTop) / (double)imax(1, hazardRampBottom - caveTop)));
      double h = whash2(sseed, gx, gy);
      double lavaH = whash2(sseed ^ 0x55AAu, gx, gy);
      int floorY = wy, ceilY = wy;
      bool hasFloor = findFloor(wx, wy, floorY), hasCeil = findCeiling(wx, wy, ceilY);

      // Hazard pressure rises with depth. The first fifth of the cave network is
      // deliberately forgiving; below it, danger ramps continuously rather than
      // appearing at one hard world-Y boundary.
      double hazardDepth = std::fmax(0.0, (depth01 - 0.18) / 0.82);

      // Lava pools are the main light source in the caves that grow nothing
      // luminous of their own: plain and (to a lesser extent) mushroom/lush caves
      // get them far more often. Crystal caves stay lava-light — they glow already.
      double lavaThr = caveDef.lavaHazard * (hazardDepth * 2.50);
      if (hasFloor && lavaH < lavaThr) {
        stampLavaBasin(wx, floorY, gx, gy);
        continue;
      }

      // Rare ceiling pockets make otherwise-dark caves hazardous. Mushroom caves
      // are richest; crystal caves are nearly methane-free. Keeping this sparse
      // avoids filling every generated window with permanently active gas.
      double methaneH = whash2(sseed ^ 0x6A52u, gx, gy);
      double methaneThr = caveDef.methaneHazard * (hazardDepth * 1.30);
      if (hasCeil && methaneH < methaneThr) {
        stampMethanePocket(wx, ceilY, gx, gy);
        continue;
      }

      CaveUpperDressingHandler upperHandler =
        caveProfileHandler(caveDef.profile).upperDressing;
      if (upperHandler == CUDH_CRYSTAL) {
        double acidThreshold = hazardDepth > 0 ? 0.003 + hazardDepth * 0.038 : 0.0;
        if (hasFloor && h < acidThreshold) stampCrystalAcidBasin(wx, floorY, gx, gy);
        else if (hasFloor && h < 0.30) stampSaltPile(wx, floorY, gx, gy);
        else if ((hasFloor || hasCeil) && h < 0.40) {
          // GIANT crystal cluster: a slender central spire hugged by a couple of
          // shorter ones — a tight bouquet, not a wide fan.
          bool fromFloor = hasFloor && (!hasCeil || whash2(sseed ^ 0x333u, gx, gy) < 0.70);
          int baseY = fromFloor ? floorY : ceilY, dir = fromFloor ? -1 : 1;
          int bigH = 7 + (int)(whash2(sseed ^ 0x334u, gx, gy) * 8); // 7..14 tall
          int bigR = 1 + (int)(whash2(sseed ^ 0x335u, gx, gy) * 2); // 1..2 wide
          stampCrystalSpike(wx, baseY, dir, bigH, bigR);
          stampCrystalSpike(wx - 1, baseY, dir, bigH * 2 / 3, 1);
          stampCrystalSpike(wx + 1, baseY, dir, bigH * 3 / 4, 1);
          stampCrystalSpike(wx - 2, baseY, dir, bigH / 2, 0);
          stampCrystalSpike(wx + 2, baseY, dir, bigH / 2, 0);
        }
        else if ((hasFloor || hasCeil) && h < 0.64) {
          bool fromFloor = hasFloor && (!hasCeil || whash2(sseed ^ 0x331u, gx, gy) < 0.68);
          int baseY = fromFloor ? floorY : ceilY, dir = fromFloor ? -1 : 1;
          int ht = 3 + (int)(whash2(sseed ^ 0x330u, gx, gy) * 8); // 3..10 slender spikes
          stampCrystalSpike(wx, baseY, dir, ht, 1);
        }
      } else if (upperHandler == CUDH_MUSHROOM) {
        if (hasFloor && h < 0.50) stampMyceliumTendril(wx, floorY, gx, gy);
        if (hasCeil && h > 0.82) stampMyceliumTendril(wx, ceilY, gx ^ 0x31, gy ^ 0x17);
        if (hasFloor && h > 0.60) {
          int mh = 3 + (int)(whash2(sseed ^ 0x222u, gx, gy) * 7);
          for (int i = 0; i < mh && terrain.genOpenCaveAt(wx, floorY - i); i++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY - i, MUSH_STEM);
          int capY = floorY - mh;
          int capR = 2 + (int)(whash2(sseed ^ 0x223u, gx, gy) * 3);
          // About half the giant mushrooms are bioluminescent — a glowing blue cap.
          uint8_t capMat = whash2(sseed ^ 0x226u, gx, gy) < 0.5 ? GLOWSHROOM : MUSH_CAP;
          for (int dx = -capR; dx <= capR; dx++) {
            if (std::abs(dx) <= 1 || whash2(sseed ^ 0x224u, wx + dx, capY) < 0.78) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + dx, capY, capMat);
          }
        }
        if (hasFloor && h > 0.40 && h < 0.56) {   // little bioluminescent mushrooms scattered on the floor
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY, MUSH_STEM);
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY - 1, GLOWSHROOM);
          if (whash2(sseed ^ 0x230u, gx, gy) < 0.5 && terrain.genOpenCaveAt(wx + 1, floorY) && !terrain.genOpenCaveAt(wx + 1, floorY + 1)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + 1, floorY, GLOWSHROOM);
        }
        if ((hasFloor || hasCeil) && h > 0.89) {   // occasional crystal spike — brighten the fungal dark
          int baseY = hasFloor ? floorY : ceilY;
          stampCrystalSpike(wx, baseY, hasFloor ? -1 : 1, 3 + (int)(whash2(sseed ^ 0x227u, gx, gy) * 5), whash2(sseed ^ 0x22Au, gx, gy) < 0.4 ? 1 : 0);
        }
      } else if (upperHandler == CUDH_LUSH) {
        // Independent per-feature rolls (not one shared h) so a lush cell can carry a
        // mossy floor AND drooping vines AND a leafy bush at once -> visibly greener.
        double pMoss = whash2(sseed ^ 0x101u, gx, gy);
        double pVine = whash2(sseed ^ 0x102u, gx, gy);
        double pBush = whash2(sseed ^ 0x103u, gx, gy);
        // Mossy floor carpet almost everywhere there's a floor, spreading sideways.
        if (hasFloor && pMoss < 0.92) {
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY, pMoss < 0.5 ? PLANT : MOSS);
          if (terrain.genOpenCaveAt(wx + 1, floorY)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + 1, floorY, MOSS);
          if (pMoss < 0.6 && terrain.genOpenCaveAt(wx - 1, floorY)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx - 1, floorY, MOSS);
        }
        // Long drooping vines from the ceiling, often in a second offset strand.
        // Ripe glowberries stud the vines and light the hollow orange (they hang
        // beside a vine cell so they join the vine's plant component and stay put).
        auto studBerry = [&](int vx, int vy) {
          if (whash2(sseed ^ 0x120u, vx, vy) >= 0.13) return;
          int bdx = whash2(sseed ^ 0x121u, vx, vy) < 0.5 ? 1 : -1;
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, vx + bdx, vy, GLOWBERRY);
        };
        if (hasCeil && pVine < 0.80) {
          int len = 5 + (int)(whash2(sseed ^ 0x110u, gx, gy) * 18);
          for (int i = 0; i < len && terrain.genOpenCaveAt(wx, ceilY + i); i++) { putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, ceilY + i, VINE); if (i > 0) studBerry(wx, ceilY + i); }
          if (pVine < 0.42) {
            int vdx = whash2(sseed ^ 0x115u, gx, gy) < 0.5 ? 1 : -1;
            int len2 = 3 + (int)(whash2(sseed ^ 0x114u, gx, gy) * 12);
            for (int i = 0; i < len2 && terrain.genOpenCaveAt(wx + vdx, ceilY + i); i++) { putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + vdx, ceilY + i, VINE); if (i > 0) studBerry(wx + vdx, ceilY + i); }
          }
        }
        // Leafy green bushes / tall plants rising from the floor with a little crown.
        if (hasFloor && pBush < 0.50) {
          int ht = 3 + (int)(whash2(sseed ^ 0x111u, gx, gy) * 6);
          for (int i = 0; i < ht && terrain.genOpenCaveAt(wx, floorY - i); i++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY - i, PLANT);
          int crownY = floorY - ht + 1;
          for (int cdx = -1; cdx <= 1; cdx += 2) if (terrain.genOpenCaveAt(wx + cdx, crownY)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + cdx, crownY, PLANT);
        }
        if ((hasFloor || hasCeil) && h > 0.91) {   // crystal accents scattered through the greenery
          int baseY = hasFloor ? floorY : ceilY;
          stampCrystalSpike(wx, baseY, hasFloor ? -1 : 1, 3 + (int)(whash2(sseed ^ 0x112u, gx, gy) * 5), whash2(sseed ^ 0x113u, gx, gy) < 0.4 ? 1 : 0);
        }
      } else if (upperHandler == CUDH_DEFAULT) {
        // The darkest caves are seeded with the most glinting minerals.
        if ((hasFloor || hasCeil) && h > 0.86) {
          int baseY = hasFloor ? floorY : ceilY, dir = hasFloor ? -1 : 1;
          // occasionally a small clustered spike, otherwise a lone slender one
          if (h > 0.95) stampCrystalSpike(wx, baseY, dir, 4 + (int)(whash2(sseed ^ 0x229u, gx, gy) * 5), 1);
          else stampCrystalSpike(wx, baseY, dir, 3 + (int)(whash2(sseed ^ 0x228u, gx, gy) * 4), whash2(sseed ^ 0x22Bu, gx, gy) < 0.35 ? 1 : 0);
        }
      } else if (upperHandler != CUDH_NONE) {
        __builtin_trap();
      }
    }
    sealHazardBoundaries(colStart, colEnd, rowStart, rowEnd);
  }
  // Chamber-scale dressing for the abyss. Upper cave features are deliberately
  // small and local; these compositions use the same deterministic deep-cavern
  // plans as the terrain, so lava seas, geodes, fossils, and fungal gardens fill
  // the room they belong to and remain identical across streamed band seams.
  void fillDeepCaveFeatures(int colStart, int colEnd, int rowStart, int rowEnd,
                            int reachX, int reachY) {
    if (L->isBackground) return;
    int wx0 = L->worldOffsetX + colStart - reachX;
    int wx1 = L->worldOffsetX + colEnd + reachX;
    int wy0 = L->worldOffsetY + rowStart - reachY;
    int wy1 = L->worldOffsetY + rowEnd + reachY;
    if (wy1 < TerrainGen::DEEP_BLEND_TOP) return;
    int gx0 = floorDiv(wx0, TerrainGen::DEEP_CAVERN_WIDTH) - 1;
    int gx1 = floorDiv(wx1, TerrainGen::DEEP_CAVERN_WIDTH) + 1;
    int gy0 = imax(0, floorDiv(wy0 - TerrainGen::CAVE_BOTTOM,
                              TerrainGen::DEEP_CAVERN_HEIGHT) - 1);
    int gy1 = imax(0, floorDiv(wy1 - TerrainGen::CAVE_BOTTOM,
                              TerrainGen::DEEP_CAVERN_HEIGHT) + 1);
    uint32_t seed = L->gCaveSeed ^ 0xD33F700u;

    auto putOpen = [&](int wx, int wy, uint8_t mat, bool overwrite = false) {
      if (!terrain.genOpenCaveAt(wx, wy)) return;
      int x = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      int k = y * cols + x;
      if (overwrite || L->grid[k] == EMPTY) L->grid[k] = mat;
    };
    auto findFloor = [&](int wx, int startY, int reach, int& floorY) {
      for (int y = startY; y <= startY + reach; y++)
        if (terrain.genOpenCaveAt(wx, y) && !terrain.genOpenCaveAt(wx, y + 1)) {
          floorY = y;
          return true;
        }
      return false;
    };
    auto findCeiling = [&](int wx, int startY, int reach, int& ceilingY) {
      for (int y = startY; y >= startY - reach; y--)
        if (terrain.genOpenCaveAt(wx, y) && !terrain.genOpenCaveAt(wx, y - 1)) {
          ceilingY = y;
          return true;
        }
      return false;
    };
    auto crystalSpire = [&](int wx, int baseY, int dir, int height, int radius) {
      for (int i = 0; i < height; i++) {
        int r = imax(0, radius - i * (radius + 1) / imax(1, height));
        for (int dx = -r; dx <= r; dx++) putOpen(wx + dx, baseY + dir * i, CRYSTAL);
      }
    };

    for (int gy = gy0; gy <= gy1; gy++) for (int gx = gx0; gx <= gx1; gx++) {
      TerrainGen::DeepCavernPlan p = terrain.deepCavernPlan(gx, gy);
      if (p.centerX + p.radiusX + 8 < wx0 || p.centerX - p.radiusX - 8 > wx1
          || p.centerY + p.radiusY + 8 < wy0 || p.centerY - p.radiusY - 8 > wy1) continue;
      BiomeSample sample = terrain.genBiomeSampleAt(p.centerX, p.centerY);
      if (sample.ownerFamily != BF_CAVE) continue;
      const CaveBiomeDef& caveDef = caveBiomeDef(sample.ownerBiome);
      if (!caveDef.deep) continue; // preserve the blended upper-cave pockets

      CaveDeepDressingHandler deepHandler =
        caveProfileHandler(caveDef.profile).deepDressing;
      if (deepHandler == CDDH_MAGMA) {
        // A broad, shallow lava sea rests in an irregular deepstone basin. Its
        // surface is level like a real liquid; only the shoreline and bed vary.
        int lakeY = p.centerY + p.radiusY / 4;
        int half = p.radiusX - 15;
        for (int dx = -half - 3; dx <= half + 3; dx++) {
          int wx = p.centerX + dx;
          double edge = (double)std::abs(dx) / (double)imax(1, half);
          double shore = valueNoise2D(seed ^ 0xA110u, wx * 0.045, p.centerY * 0.017);
          bool bank = edge > 0.88 + (shore - 0.5) * 0.12;
          int bedY = lakeY + 7 + (int)(shore * 7.0)
                   + (int)std::floor(edge * edge * 5.0);
          if (bank) {
            for (int y = lakeY - 2; y <= bedY + 1; y++) putOpen(wx, y, DEEPSTONE, true);
            continue;
          }
          putOpen(wx, bedY, DEEPSTONE, true);
          putOpen(wx, bedY + 1, DEEPSTONE, true);
          for (int y = lakeY; y < bedY; y++) putOpen(wx, y, LAVA, true);
        }
        // A few molten falls make the lake read as part of a living volcanic
        // system rather than a painted stripe.
        for (int fall = 0; fall < 2; fall++) {
          int fx = p.centerX - p.radiusX / 2
                 + (int)(whash2(seed ^ 0xA120u, gx, gy * 3 + fall) * p.radiusX);
          int ceilingY;
          if (!findCeiling(fx, p.centerY, p.radiusY + 16, ceilingY)) continue;
          int width = 2 + (int)(whash2(seed ^ 0xA121u, gx + fall, gy) * 3);
          for (int x = fx - width / 2; x <= fx + width / 2; x++)
            for (int y = ceilingY; y <= lakeY; y++) putOpen(x, y, LAVA);
        }
        for (int i = 0; i < 5; i++) {
          int sx = p.centerX - half * 3 / 4 + i * half * 3 / 8;
          int floorY;
          if (findFloor(sx, p.centerY, p.radiusY + 20, floorY))
            crystalSpire(sx, floorY, -1, 4 + (i & 1) * 3, 1);
        }
      } else if (deepHandler == CDDH_GEODE) {
        // Floor and ceiling crystal crowns converge toward a luminous nave.
        for (int i = -4; i <= 4; i++) {
          int wx = p.centerX + i * imax(9, p.radiusX / 10);
          int floorY, ceilingY;
          int height = 10 + (int)(whash2(seed ^ 0xB110u, gx * 13 + i, gy) * 22);
          if (i == 0) height = p.radiusY - imin(20, p.radiusY / 2) + 8;
          int radius = 1 + (int)(whash2(seed ^ 0xB111u, gx, gy * 13 + i) * 4);
          if (findFloor(wx, p.centerY, p.radiusY + 18, floorY))
            crystalSpire(wx, floorY, -1, height, radius);
          if (i % 2 == 0 && findCeiling(wx + 4, p.centerY, p.radiusY + 18, ceilingY))
            crystalSpire(wx + 4, ceilingY, 1, height * 2 / 3, imax(1, radius - 1));
        }
        // A faceted halo gives each geode a distant, recognizable silhouette.
        int haloRx = imin(34, p.radiusX / 3), haloRy = imin(20, p.radiusY / 2);
        for (int dx = -haloRx; dx <= haloRx; dx++) {
          double nx = (double)dx / (double)haloRx;
          int dy = (int)std::round(haloRy * std::sqrt(std::fmax(0.0, 1.0 - nx * nx)));
          for (int t = -1; t <= 1; t++) {
            putOpen(p.centerX + dx, p.centerY - dy + t, CRYSTAL);
            putOpen(p.centerX + dx, p.centerY + dy + t, CRYSTAL);
          }
        }
      } else if (deepHandler == CDDH_FOSSIL) {
        // A cathedral-sized rib cage embedded in the cavern, with a broken skull
        // at one end. Gaps and missing ribs keep it ancient rather than schematic.
        int ribRx = imin(68, p.radiusX * 3 / 5);
        int ribRy = imin(34, p.radiusY * 2 / 3);
        int baseY = p.centerY + p.radiusY - 7;
        for (int dx = -ribRx; dx <= ribRx; dx++) {
          double nx = (double)dx / (double)ribRx;
          int arch = (int)std::round(ribRy * std::sqrt(std::fmax(0.0, 1.0 - nx * nx)));
          if (whash2(seed ^ 0xC110u, gx * 97 + dx / 5, gy) > 0.08)
            for (int t = 0; t < 3; t++) putOpen(p.centerX + dx, baseY - arch + t, SANDSTONE);
        }
        for (int rib = -4; rib <= 4; rib++) {
          if (rib == 3) continue;
          int wx = p.centerX + rib * ribRx / 5;
          int topY = baseY - ribRy + std::abs(rib) * 3;
          for (int y = topY; y <= baseY + 3; y++) {
            int bend = (y - topY) * (y - topY) / imax(18, ribRy * 3);
            putOpen(wx + (rib < 0 ? -bend : bend), y, SANDSTONE);
          }
        }
        int skullX = p.centerX - ribRx - 9, skullY = baseY - 8;
        for (int oy = -11; oy <= 11; oy++) for (int ox = -15; ox <= 15; ox++) {
          double d = (double)(ox * ox) / 225.0 + (double)(oy * oy) / 121.0;
          bool eye = oy < 1 && ((ox + 6) * (ox + 6) + (oy + 2) * (oy + 2) < 14
                            || (ox - 6) * (ox - 6) + (oy + 2) * (oy + 2) < 14);
          if (d > 0.72 && d < 1.18 && !eye) putOpen(skullX + ox, skullY + oy, SANDSTONE);
        }
      } else if (deepHandler == CDDH_VOID) {
        // Void gardens hang from the roof in long fungal curtains while enormous
        // glowshrooms rise from the floor, producing vertical layers of light.
        for (int i = -6; i <= 6; i++) {
          int wx = p.centerX + i * imax(7, p.radiusX / 15);
          int ceilingY;
          if (!findCeiling(wx, p.centerY, p.radiusY + 18, ceilingY)) continue;
          int len = 8 + (int)(whash2(seed ^ 0xD110u, gx * 31 + i, gy) * 25);
          for (int y = ceilingY; y < ceilingY + len; y++) {
            putOpen(wx, y, MYCELIUM);
            if ((y - ceilingY) % 7 == 5) putOpen(wx + (i & 1 ? 1 : -1), y, GLOWSHROOM);
          }
        }
        for (int i = -3; i <= 3; i++) {
          int wx = p.centerX + i * imax(13, p.radiusX / 8), floorY;
          if (!findFloor(wx, p.centerY, p.radiusY + 18, floorY)) continue;
          int height = 9 + (int)(whash2(seed ^ 0xD120u, gx * 19 + i, gy) * 17);
          for (int y = floorY; y > floorY - height; y--) putOpen(wx, y, MUSH_STEM);
          int capY = floorY - height, capR = 5 + height / 4;
          for (int dx = -capR; dx <= capR; dx++) {
            int crown = 2 + (int)std::round(2.0 * (1.0 - std::abs(dx) / (double)capR));
            for (int dy = 0; dy < crown; dy++) putOpen(wx + dx, capY + dy, GLOWSHROOM);
          }
        }
      } else if (deepHandler != CDDH_NONE) {
        __builtin_trap();
      }
    }
  }
  void sealHazardBoundaries(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int y = rowStart; y < rowEnd; y++) for (int x = colStart; x < colEnd; x++) {
      int k = y * cols + x;
      if (L->grid[k] != SALT && !isDissolvable(L->grid[k])) continue;
      bool touchesAcid = (x > colStart && L->grid[k - 1] == ACID)
                       || (x + 1 < colEnd && L->grid[k + 1] == ACID)
                       || (y > rowStart && L->grid[k - cols] == ACID)
                       || (y + 1 < rowEnd && L->grid[k + cols] == ACID);
      if (touchesAcid) L->grid[k] = CRYSTAL;
    }
    for (int y = rowStart; y < rowEnd; y++) for (int x = colStart; x < colEnd; x++) {
      int k = y * cols + x;
      if (L->grid[k] == ACID) {
        if (y + 1 < rowEnd && L->grid[k + cols] != ACID) L->grid[k + cols] = CRYSTAL;
        if (x > colStart && L->grid[k - 1] != ACID && L->grid[k - 1] != EMPTY) L->grid[k - 1] = CRYSTAL;
        if (x + 1 < colEnd && L->grid[k + 1] != ACID && L->grid[k + 1] != EMPTY) L->grid[k + 1] = CRYSTAL;
      } else if (L->grid[k] == LAVA) {
        int wx = L->worldOffsetX + x, wy = L->worldOffsetY + y;
        uint8_t wall = terrain.genDeepRockAt(wx, wy);
        if (y + 1 < rowEnd && L->grid[k + cols] != LAVA) L->grid[k + cols] = wall;
        if (x > colStart && L->grid[k - 1] != LAVA && L->grid[k - 1] != EMPTY) L->grid[k - 1] = wall;
        if (x + 1 < colEnd && L->grid[k + 1] != LAVA && L->grid[k + 1] != EMPTY) L->grid[k + 1] = wall;
      }
    }
  }
  void copyGridToNext(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int lx = colStart; lx < colEnd; lx++)
      for (int y = rowStart; y < rowEnd; y++)
        mirrorCurrentCellToNext(y * cols + lx);
  }
