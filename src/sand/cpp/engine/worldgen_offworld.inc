  __attribute__((minsize, noinline))
  void fillSpaceship(int colStart, int colEnd, int rowStart, int rowEnd) {
#pragma clang attribute push (__attribute__((minsize)), apply_to = function)
    auto put = [&](int worldX, int worldY, uint8_t material) {
      int x = worldX - L->worldOffsetX, y = worldY - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      L->grid[I(x, y)] = material;
    };
    auto hline = [&](int x0, int x1, int y, uint8_t material) {
      for (int x = x0; x <= x1; x++) put(x, y, material);
    };
    auto vline = [&](int x, int y0, int y1, uint8_t material) {
      for (int y = y0; y <= y1; y++) put(x, y, material);
    };
    auto rect = [&](int x0, int x1, int y0, int y1, uint8_t material) {
      for (int y = y0; y <= y1; y++) hline(x0, x1, y, material);
    };
    auto hullBounds = [&](int worldX, int& roof, int& belly) {
      if (worldX < -178 || worldX > 190) return false;
      if (worldX < -154) {
        int taper = -154 - worldX;
        roof = -43 + taper / 2;
        belly = 22 - taper / 3;
        return roof <= belly;
      }
      if (worldX > 154) {
        int taper = worldX - 154;
        roof = -47 + taper / 3;
        belly = 22 - taper / 2;
        return roof <= belly;
      }
      int crown = std::abs(worldX + 8) / 16;
      roof = -56 + crown;
      belly = 25 - imax(0, std::abs(worldX) - 126) / 7;
      return true;
    };

    for (int x = colStart; x < colEnd; x++) {
      int worldX = L->worldOffsetX + x;
      int roof, belly;
      if (!hullBounds(worldX, roof, belly)) continue;
      for (int y = rowStart; y < rowEnd; y++) {
        int worldY = L->worldOffsetY + y;
        if (worldY < roof || worldY > belly) continue;
        if (L->isBackground) {
          bool bridgeGlass = worldX >= 108 && worldX <= 169 &&
                             worldY >= roof + 5 && worldY <= -25;
          bool observationGlass = worldX >= -88 && worldX <= -28 &&
                                  worldY >= roof + 7 && worldY <= -27;
          bool engineGlass = worldX >= -146 && worldX <= -112 &&
                             worldY >= -42 && worldY <= -25;
          uint8_t panel = bridgeGlass || observationGlass || engineGlass ? GLASS
            : (((worldX / 11 + worldY / 8) & 5) == 0 ? DEEPSTONE : BRICK);
          L->grid[I(x, y)] = panel;
          continue;
        }
        bool shell = worldY <= roof + 2 || worldY >= belly - 2 ||
                     worldX <= -175 || worldX >= 187;
        bool mainDeck = worldY >= 18 && worldY <= 20 &&
                        worldX >= -156 && worldX <= 168;
        bool liftOpening = worldX >= -14 && worldX <= 14;
        bool upperDeck = worldY >= -18 && worldY <= -16 &&
                         worldX >= -146 && worldX <= 154 && !liftOpening;
        bool partition = (std::abs(worldX - 96) <= 1 ||
                          std::abs(worldX + 96) <= 1) &&
                         worldY >= -15 && worldY <= 17 &&
                         !(worldY >= 3 && worldY <= 17);
        if (shell || mainDeck || upperDeck || partition)
          L->grid[I(x, y)] = shell ? DEEPSTONE : BRICK;
      }
    }

    if (L->isBackground) {
      // Aft engineering: reactor stacks, coolant loops, and a service console.
      for (int x = -148; x <= -108; x += 10) {
        rect(x, x + 5, -13, 15, x % 20 ? IRON_ORE : COPPER_ORE);
        hline(x - 1, x + 6, -12, LIGHT);
        hline(x - 1, x + 6, 14, DEEPSTONE);
      }
      vline(-151, -12, 15, CRYSTAL);
      vline(-105, -12, 15, CRYSTAL);
      hline(-150, -106, 7, GLASS);

      // Port-side medbay and compact crew berths remain visible but non-physical.
      for (int bunk = 0; bunk < 3; bunk++) {
        int x0 = -87 + bunk * 18;
        rect(x0, x0 + 13, 8, 14, PINE_WOOD);
        rect(x0 + 2, x0 + 11, 7, 8, ICE);
        hline(x0, x0 + 13, 15, DEEPSTONE);
      }
      rect(-90, -84, -10, 2, GLASS);
      rect(-89, -85, -8, 0, ICE);
      hline(-92, -46, -12, LIGHT);

      // The central transporter is a luminous background station, leaving the
      // entire main-deck player corridor unobstructed.
      hline(-22, 22, 16, GLASS);
      hline(-17, 17, 15, CRYSTAL);
      for (int x : {-22, 22}) {
        vline(x, -11, 15, IRON_ORE);
        put(x, -12, LIGHT);
      }
      for (int x = -15; x <= 15; x += 5) put(x, 13, LIGHT);
      vline(-13, -15, 14, GLASS);
      vline(13, -15, 14, GLASS);

      // Starboard armory, suit lockers, and fabrication bench.
      for (int x = 47; x <= 87; x += 10) {
        rect(x, x + 7, 4, 15, DEEPSTONE);
        hline(x + 1, x + 6, 5, GLASS);
        put(x + 3, 9, GOLD_ORE);
        put(x + 4, 12, IRON_ORE);
      }
      hline(44, 90, 15, PINE_WOOD);
      hline(49, 85, 1, LIGHT);

      // Forward command deck: tiered consoles, pilot chairs, map table, and a
      // broad bridge window.
      hline(104, 158, 14, DEEPSTONE);
      for (int x = 108; x <= 154; x += 12) {
        rect(x, x + 7, 9, 13, GLASS);
        put(x + 2, 8, LIGHT);
        rect(x + 3, x + 5, 14, 16, PINE_WOOD);
      }
      rect(116, 142, -12, -8, GLASS);
      hline(120, 138, -7, CRYSTAL);

      // Upper deck: hydroponics, galley, navigation archive, and lift markings.
      for (int x = -136; x <= -104; x += 8) {
        vline(x, -48, -22, PINE_WOOD);
        put(x - 1, -32, PLANT);
        put(x + 1, -38, GLOWBERRY);
      }
      hline(-140, -98, -21, DIRT);
      for (int x = -82; x <= -38; x += 11) {
        rect(x, x + 7, -30, -24, PINE_WOOD);
        hline(x + 1, x + 6, -31, BRICK);
      }
      for (int x = 36; x <= 86; x += 9) {
        rect(x, x + 5, -43, -23, DEEPSTONE);
        hline(x + 1, x + 4, -40, GOLD_ORE);
        hline(x + 1, x + 4, -34, GLASS);
      }
      for (int y = -14; y <= 14; y += 4) {
        put(-13, y, LIGHT);
        put(13, y, LIGHT);
      }
      return;
    }

    stampStructureLandings(put, 0, 14, -18, 18, BRICK);

    // Flush hull lights and a glass-rimmed lift opening illuminate both decks
    // without placing scenery in the player's main corridor.
    for (int x = -148; x <= 160; x += 20) {
      put(x, 18, LIGHT);
      put(x + 1, 18, LIGHT);
    }
    for (int x = -138; x <= 150; x += 24) {
      int roof, belly;
      if (!hullBounds(x, roof, belly)) continue;
      put(x, roof + 2, LIGHT);
      put(x + 1, roof + 2, LIGHT);
    }
    for (int y = -14; y <= 1; y += 5) {
      put(-15, y, GLASS);
      put(15, y, GLASS);
    }
#pragma clang attribute pop
  }

  void fillOutcropGeneratedFeature(
    const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    const PlanetDef& planet = planetDef(planetId);
    int worldLeft = L->worldOffsetX + colStart;
    int worldRight = L->worldOffsetX + colEnd - 1;
    auto put = [&](int worldX, int worldY, uint8_t material) {
      int x = worldX - L->worldOffsetX, y = worldY - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      stampGeneratedFeatureCell(feature, I(x, y), material);
    };
    auto hline = [&](int x0, int x1, int y, uint8_t material) {
      for (int x = imax(x0, worldLeft); x <= imin(x1, worldRight); x++)
        put(x, y, material);
    };
    // Biome-keyed formations make the long stretches between facilities retain a
    // readable planetary identity. Moon outcrops grow as narrow mineral spires;
    // Mars outcrops weather into broad fins and hoodoos.
    int d0 = floorDiv(worldLeft - feature.overscanX, feature.latticeWidth);
    int d1 = floorDiv(worldRight + feature.overscanX, feature.latticeWidth);
    for (int d = d0; d <= d1; d++) {
      OutcropPlan plan;
      if (!worldContext.outcropPlan(d, plan)) continue;
      int center = plan.center, floorY = plan.floorY, biome = plan.biome;
      if (plan.style == OCS_BIOME_FORMATION) {
        const SurfaceBiomeDef& def = surfaceBiomeDef(biome);
        for (int dy = 0; dy <= plan.height; dy++) {
          OutcropSlice slice;
          worldContext.outcropSlice(plan, dy, slice);
          for (int x = slice.left; x <= slice.right; x++) {
            if (def.formationStyle == SFS_FOSSIL
                && !worldContext.fossilCellAt(plan, x - center, dy)) continue;
            bool accent = dy > 1 && ((def.formationStyle == SFS_BOULDER && dy >= plan.height - 1)
              || (def.formationStyle == SFS_STACK && dy % 6 == 0)
              || (def.formationStyle == SFS_SPIRE && x == slice.left + 1 && dy % 7 < 4)
              || (def.formationStyle == SFS_FOSSIL && dy > plan.height * 3 / 4
                  && x - center == (dy / 3) % 3 - 1));
            bool stakes = def.formationStyle == SFS_FOSSIL && plan.id % 3 == 2 && (plan.id & 8);
            uint8_t mat = accent ? def.formationAccent : def.formationMaterial;
            if (stakes && dy < plan.height - 7) mat = dy % 7 < 2 ? BONE : PINE_WOOD;
            put(x, floorY - dy, mat);
          }
        }
        OutcropSlice base;
        worldContext.outcropSlice(plan, 0, base);
        for (int x = base.left; x <= base.right; x++) {
          if (def.formationStyle == SFS_FOSSIL
              && !worldContext.fossilCellAt(plan, x - center, 0)) continue;
          int ground = terrain.genSurfaceAbs(x);
          int soil = terrain.genSoilDepthAt(x, terrain.genBiomeAt(x));
          int rootTop = def.formationStyle == SFS_FOSSIL && plan.id % 3 != 1 ? imax(floorY + 1, ground) : floorY + 1;
          for (int y = rootTop; y <= ground + TerrainGen::GEN_SKIN + soil; y++)
            put(x, y, def.formationMaterial);
        }
        continue;
      }
      const OffworldBiomeDef& biomeDef =
        offworldBiomeDef(planet.offworldMaterialProfile, biome);
      int height = plan.height;
      if (plan.style == OCS_MINERAL_SPIRE) {
        uint8_t mineral = biomeDef.formation;
        for (int dy = 0; dy <= height; dy++) {
          int y = floorY - dy;
          OutcropSlice slice;
          worldContext.outcropSlice(plan, dy, slice);
          for (int x = slice.left; x <= slice.right; x++) {
            bool edge = x == slice.left || x == slice.right || dy == height;
            if (L->isBackground || edge) put(x, y, mineral);
          }
          if (slice.hasShard
              && (L->isBackground || dy == plan.shardHeight || dy % 2 == 0))
            put(slice.shardX, y, biomeDef.formationAccent);
        }
      } else if (plan.style == OCS_WEATHERED_HOODOO) {
        uint8_t rock = biomeDef.formation;
        for (int dy = 0; dy <= height; dy++) {
          OutcropSlice slice;
          worldContext.outcropSlice(plan, dy, slice);
          for (int x = slice.left; x <= slice.right; x++) {
            bool edge = x == slice.left || x == slice.right || dy == height;
            if (slice.contains(x) && (L->isBackground || edge))
              put(x, floorY - dy, rock);
          }
        }
        hline(center - plan.halfBase - 3, center + plan.halfBase + 3, floorY,
              biomeDef.foundation);
      }
    }
  }
