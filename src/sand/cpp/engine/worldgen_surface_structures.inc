  void fillVillageGeneratedFeature(
      const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    // Keep clipping and store logic shared across structure stamp sites.
    auto put = [&](int wx, int wy, uint8_t m) __attribute__((noinline)) {
      int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
      stampGeneratedFeatureCell(feature, y * cols + lx, m);
    };
    int rectX0 = L->worldOffsetX + colStart, rectX1 = L->worldOffsetX + colEnd - 1;
    int rectY0 = L->worldOffsetY + rowStart, rectY1 = L->worldOffsetY + rowEnd - 1;
    int wx0 = rectX0 - feature.overscanX;
    int wx1 = rectX1 + feature.overscanX;
    // Structure plans always consult foreground cave topology, even while the
    // background or a prefetched scratch band is active. This keeps placement
    // decisions byte-identical across both layers.
    auto groundAnchorY = [&](int x) {
      BiomeSample sample = terrain.genBiomeSampleAt(
        x, terrain.genSurfaceAbs(x));
      int biome = sample.ownerFamily == BF_SURFACE
        ? sample.ownerBiome : BIOME_PLAINS;
      return terrain.genSurfaceAbs(x) + TerrainGen::GEN_SKIN
           + terrain.genSoilDepthAt(x, biome);
    };
    auto stampTerraceFoundation = [&](int left, int right, int floorY,
                                      uint8_t foundation, bool stairs) {
      for (int x = left; x <= right; x++) {
        int groundY = groundAnchorY(x);
        for (int y = floorY + 1; y <= groundY; y++) {
          uint8_t course = foundation;
          if (foundation == BRICK && (y - floorY) % 5 == 0) course = SANDSTONE;
          put(x, y, course);
        }
      }
      if (!stairs) return;
      // Compact masonry stairs join a raised terrace to the natural grade. Each
      // tread continues to the terrain, so even the approach is visibly grounded.
      for (int side : {-1, 1}) {
        int edgeX = side < 0 ? left : right;
        int drop = terrain.genSurfaceAbs(edgeX + side) - floorY;
        for (int step = 1; step <= imin(10, drop); step++) {
          int x = edgeX + side * step;
          int groundY = groundAnchorY(x);
          int stepY = imin(floorY + step, groundY - 1);
          for (int y = stepY; y <= groundY; y++) put(x, y, foundation);
        }
      }
    };
    // Surface villages: a deterministic chain of roomy homes, workshops,
    // apothecaries, storehouses, and a meeting hall. The foreground retains a
    // generous walk-through silhouette; the solid background wall carries the
    // windows, furniture, tools, produce, banners, and other lived-in detail.
    int vxMin = floorDiv(wx0, feature.latticeWidth);
    int vxMax = floorDiv(wx1, feature.latticeWidth);
    auto stampCottage = [&](const VillageBuildingPlan& plan) {
      int ordinal = plan.ordinal, role = ordinal & 3;
      bool hall = plan.hall;
      int cx = plan.center, w = plan.width;
      int biome = plan.biome, left = plan.left;
      int floorY = plan.floorY, wallTop = plan.wallTop;
      int roofH = plan.roofHeight;
      if (left + w + 2 < rectX0 || left - 2 > rectX1
          || floorY < rectY0 || wallTop - roofH - 16 > rectY1) return;
      const int DOOR_CLEARANCE = PLAYER_H + 5;
      const SurfaceBiomeDef& biomeDef = surfaceBiomeDef(biome);
      uint8_t wall = biomeDef.structureWall;
      uint8_t foundation = biomeDef.structureFoundation;
      for (int x = left; x <= left + w; x++) {
        for (int y = wallTop; y <= floorY; y++) {
          bool edge = x == left || x == left + w || y == wallTop || y == floorY;
          bool sidePassage = (x == left || x == left + w) && y >= floorY - DOOR_CLEARANCE + 1;
          bool door = x >= cx - 3 && x <= cx + 3 && y >= floorY - DOOR_CLEARANCE + 1;
          if (L->isBackground) put(x, y, wall); // dim, solid room backdrop behind the facade
          else put(x, y, edge && !sidePassage && !door ? wall : EMPTY);
        }
      }
      // Every exposed column continues into natural terrain. Alternating courses
      // keep tall downhill foundations from reading as featureless rectangles.
      stampTerraceFoundation(left, left + w, floorY, foundation, true);

      // The four occupations use genuinely different silhouettes: domestic
      // gable, workshop shed, glazed apothecary arch, warehouse parapet, and a
      // civic hall with a belfry. All roofs are solid in both layers.
      int roofStyle = hall ? 4 : role;
      auto roofColumn = [&](int x, int top) {
        for (int y = top; y <= wallTop; y++) put(x, y, wall);
      };
      if (roofStyle == 0) {
        for (int ry = 0; ry <= roofH; ry++)
          for (int x = left - 2 + ry; x <= left + w + 2 - ry; x++) put(x, wallTop - ry, wall);
        int dormerY = wallTop - roofH / 2;
        for (int dx = -3; dx <= 3; dx++) for (int dy = -2; dy <= 2; dy++)
          put(cx + dx, dormerY + dy, std::abs(dx) == 3 || std::abs(dy) == 2 ? PINE_WOOD : CRYSTAL);
      } else if (roofStyle == 1) {
        for (int x = left - 2; x <= left + w + 2; x++) {
          int run = x - (left - 2);
          int rise = roofH - run * roofH / (w + 4);
          roofColumn(x, wallTop - rise);
        }
        for (int x = left + 5; x <= left + 7; x++)
          for (int y = wallTop - roofH - 6; y <= wallTop - roofH + 2; y++) put(x, y, BRICK);
        put(left + 6, wallTop - roofH - 7, CRYSTAL);
      } else if (roofStyle == 2) {
        int half = w / 2 + 2;
        for (int x = left - 2; x <= left + w + 2; x++) {
          int dx = std::abs(x - cx);
          int arch = 3 + (roofH - 2) * (half * half - dx * dx) / (half * half);
          roofColumn(x, wallTop - imax(2, arch));
        }
        for (int ribX : {cx - 9, cx, cx + 9}) {
          int dx = std::abs(ribX - cx);
          int arch = 3 + (roofH - 2) * (half * half - dx * dx) / (half * half);
          put(ribX, wallTop - arch, CRYSTAL);
          put(ribX, wallTop - arch + 1, CRYSTAL);
        }
      } else if (roofStyle == 3) {
        for (int x = left - 2; x <= left + w + 2; x++)
          for (int y = wallTop - 5; y <= wallTop; y++) put(x, y, wall);
        for (int x = left - 2; x <= left + w + 2; x += 7)
          for (int y = wallTop - 8; y < wallTop - 5; y++) put(x, y, wall);
      } else {
        for (int ry = 0; ry <= roofH; ry++)
          for (int x = left - 2 + ry; x <= left + w + 2 - ry; x++) put(x, wallTop - ry, wall);
        int apex = wallTop - roofH;
        for (int x = cx - 6; x <= cx + 6; x++) for (int y = apex - 8; y <= apex + 1; y++) put(x, y, wall);
        for (int ry = 0; ry <= 5; ry++)
          for (int x = cx - 8 + ry; x <= cx + 8 - ry; x++) put(x, apex - 8 - ry, wall);
        for (int wx : {cx - 2, cx + 2}) for (int y = apex - 6; y <= apex - 3; y++) put(wx, y, CRYSTAL);
        put(cx, apex - 7, CLAY);
      }

      if (L->isBackground) {
        auto shelf = [&](int x0, int x1, int y) {
          for (int x = x0; x <= x1; x++) put(x, y, PINE_WOOD);
          put(x0 + 1, y + 1, WOOD); put(x1 - 1, y + 1, WOOD);
        };
        auto table = [&](int x0, int x1, int y) {
          for (int x = x0; x <= x1; x++) put(x, y, WOOD);
          for (int yy = y + 1; yy <= floorY - 1; yy++) {
            put(x0 + 1, yy, PINE_WOOD); put(x1 - 1, yy, PINE_WOOD);
          }
        };
        auto crate = [&](int x, int y, int cw, int ch) {
          for (int dx = 0; dx < cw; dx++) for (int dy = 0; dy < ch; dy++) {
            bool edge = dx == 0 || dx == cw - 1 || dy == 0 || dy == ch - 1;
            put(x + dx, y + dy, edge || dx == dy ? PINE_WOOD : WOOD);
          }
        };
        auto window = [&](int x, int y) {
          for (int dx = -3; dx <= 3; dx++) for (int dy = -3; dy <= 3; dy++) {
            bool frame = std::abs(dx) == 3 || std::abs(dy) == 3 || dx == 0 || dy == 0;
            put(x + dx, y + dy, frame ? PINE_WOOD : CRYSTAL);
          }
          // Window boxes soften the masonry and visibly distinguish occupied homes.
          for (int dx = -4; dx <= 4; dx++) put(x + dx, y + 4, WOOD);
          for (int dx : {-3, 0, 3}) put(x + dx, y + 3, dx == 0 ? GLOWBERRY : PLANT);
        };

        // Timber framing and irregular masonry bands make the backdrop read as a
        // built wall rather than a flat rectangle.
        for (int x = left + 3; x <= left + w - 3; x += 8)
          for (int y = wallTop + 1; y < floorY; y++) put(x, y, PINE_WOOD);
        for (int y = wallTop + 5; y < floorY - 3; y += 7)
          for (int x = left + 1; x < left + w; x++)
            if ((x + ordinal) % 9 != 0) put(x, y, SANDSTONE);
        for (int x = left + 1; x < left + w; x++) put(x, floorY - 2, PINE_WOOD);
        window(left + 8, wallTop + 8);
        window(left + w - 8, wallTop + 8);

        if (hall) {
          // A communal banquet hall: long trestle table, benches, heraldic
          // banners, a chandelier, and a raised speaker's end.
          table(left + 8, left + w - 8, floorY - 6);
          for (int x = left + 10; x <= left + w - 10; x++) {
            put(x, floorY - 3, WOOD);
            if (x % 9 == 0) put(x, floorY - 4, CLAY);
          }
          for (int bx : {left + 14, cx, left + w - 14}) {
            for (int y = wallTop + 2; y <= wallTop + 8; y++) put(bx, y, MOSS);
            put(bx - 1, wallTop + 4, GOLD_ORE); put(bx + 1, wallTop + 6, CRYSTAL);
          }
          for (int y = wallTop + 1; y <= wallTop + 7; y++) put(cx, y, IRON_ORE);
          for (int dx = -3; dx <= 3; dx++) put(cx + dx, wallTop + 7, IRON_ORE);
          put(cx - 3, wallTop + 8, CRYSTAL); put(cx, wallTop + 8, CRYSTAL); put(cx + 3, wallTop + 8, CRYSTAL);
          for (int x = left + w - 9; x <= left + w - 3; x++) put(x, floorY - 4, BRICK);
          put(left + w - 6, floorY - 5, CRYSTAL);
        } else {
          switch (ordinal & 3) {
            case 0: { // family home: hearth, bed, supper table, and potted herbs
              for (int x = left + 3; x <= left + 9; x++) for (int y = floorY - 7; y < floorY; y++) {
                bool hearth = x == left + 3 || x == left + 9 || y == floorY - 7;
                if (hearth) put(x, y, BRICK);
              }
              put(left + 6, floorY - 2, CRYSTAL); put(left + 6, floorY - 3, GOLD_ORE);
              for (int x = left + w - 13; x <= left + w - 3; x++) put(x, floorY - 3, WOOD);
              for (int x = left + w - 12; x <= left + w - 5; x++) put(x, floorY - 4, MOSS);
              put(left + w - 4, floorY - 4, WILLOW_LEAF);
              table(cx - 4, cx + 4, floorY - 5);
              shelf(left + w - 13, left + w - 5, floorY - 11);
              put(left + w - 11, floorY - 12, CLAY); put(left + w - 10, floorY - 13, PLANT);
              break;
            }
            case 1: { // smith/carpenter: workbench, tool board, furnace, timber
              table(left + 4, left + 17, floorY - 5);
              shelf(left + 5, left + 16, floorY - 11);
              for (int tx = left + 7; tx <= left + 15; tx += 4) {
                put(tx, floorY - 12, tx & 1 ? COPPER_ORE : IRON_ORE);
                put(tx, floorY - 13, IRON_ORE);
              }
              for (int x = left + w - 11; x <= left + w - 3; x++) for (int y = floorY - 7; y < floorY; y++) {
                bool furnace = x == left + w - 11 || x == left + w - 3 || y == floorY - 7;
                if (furnace) put(x, y, BRICK);
              }
              put(left + w - 7, floorY - 2, CRYSTAL);
              for (int x = cx - 3; x <= cx + 4; x += 2) put(x, floorY - 2, PINE_WOOD);
              break;
            }
            case 2: { // apothecary: specimen shelves and a lush preparation table
              for (int sy : {floorY - 6, floorY - 12}) shelf(left + 4, left + w - 4, sy);
              static const uint8_t jars[] = { CLAY, MUSH_CAP, MOSS, GLOWBERRY, CRYSTAL, PLANT };
              for (int x = left + 6; x <= left + w - 6; x += 4) {
                put(x, floorY - 7, jars[std::abs(x + ordinal) % 6]);
                put(x, floorY - 13, jars[std::abs(x + ordinal + 3) % 6]);
              }
              table(cx - 6, cx + 6, floorY - 4);
              for (int x : {cx - 4, cx, cx + 4}) put(x, floorY - 5, x == cx ? GLOWSHROOM : PLANT);
              for (int y = wallTop + 1; y <= wallTop + 6; y++) put(left + w - 4, y, VINE);
              put(left + w - 5, wallTop + 6, GLOWBERRY);
              break;
            }
            default: { // storehouse: stacked marked crates and well-stocked racks
              crate(left + 4, floorY - 7, 8, 6);
              crate(left + 12, floorY - 5, 7, 4);
              crate(left + w - 13, floorY - 8, 9, 7);
              shelf(cx - 6, cx + 7, floorY - 10);
              for (int x = cx - 4; x <= cx + 5; x += 3) put(x, floorY - 11, x & 1 ? COPPER_ORE : COAL_ORE);
              put(left + 7, floorY - 4, GOLD_ORE);
              break;
            }
          }
        }
      } else {
        // Two widely spaced masonry piers carry the roof into the terrace. They
        // leave player-clear side entries and a broad central room, but prevent
        // the foreground facade from reading as a roof suspended over a floor.
        for (int pierX : {left + 9, left + w - 9})
          for (int y = wallTop + 1; y <= floorY; y++) put(pierX, y, wall);
        // High beams brace the wide spans without shrinking the playable opening.
        for (int y = wallTop + 2; y < floorY - DOOR_CLEARANCE; y++) put(cx, y, wall);
        for (int x = left + 5; x <= left + w - 5; x++) if (x < cx - 4 || x > cx + 4) put(x, floorY - DOOR_CLEARANCE - 1, wall);
      }
      if (L->isBackground) {
        // Hanging shop signs remain readable but, like streetlamps, sit behind the
        // player so the decorative post cannot obstruct the path between homes.
        int signX = left + w + 6;
        for (int y = floorY - 8; y <= floorY; y++) put(signX, y, PINE_WOOD);
        for (int y = floorY + 1; y <= groundAnchorY(signX); y++) put(signX, y, PINE_WOOD);
        for (int x = signX - 4; x <= signX + 3; x++) for (int y = floorY - 9; y <= floorY - 6; y++)
          put(x, y, PINE_WOOD);
        put(signX - 1, floorY - 8, hall ? CRYSTAL : (ordinal & 1 ? COPPER_ORE : CRYSTAL));
      }
    };
    for (int vx = vxMin; vx <= vxMax; vx++) {
      VillagePlan village;
      if (!worldContext.villagePlan(vx, village)) continue;
      int center = village.center, count = village.buildingCount;
      int wellX = center + count * 29 + 12, wellY;

      // A continuous sand street and lanterns turn the individual facades into
      // one settlement. Everything follows the terrain instead of flattening it.
      int streetLeft = center - count * 29 - 30, streetRight = wellX + 12;
      for (int x = streetLeft; x <= streetRight; x++) put(x, terrain.genSurfaceAbs(x), SAND);
      // Facades and their masonry foundations remain embedded through the loose
      // street layer.
      for (int i = 0; i < count; i++) {
        VillageBuildingPlan building;
        if (worldContext.villageBuildingPlan(village, i, building))
          stampCottage(building);
      }
      // Streetlamps live entirely in the background plane, whose emissive light
      // projects into the foreground. They remain bright without becoming narrow
      // collision posts between otherwise player-clear buildings.
      if (L->isBackground) for (int i = 0; i + 1 < count; i++) {
        int lampX = center + (i - count / 2) * 58 + 29;
        int lampY = terrain.genSurfaceAbs(lampX) - 1;
        for (int y = lampY - 9; y <= groundAnchorY(lampX); y++) put(lampX, y, PINE_WOOD);
        for (int dx = -3; dx <= 3; dx++) put(lampX + dx, lampY - 9, PINE_WOOD);
        put(lampX - 3, lampY - 8, CRYSTAL); put(lampX + 3, lampY - 8, CRYSTAL);
      }

      // A covered market stall beside the well adds a communal place rather than
      // another sealed box: canopy, counter, produce, pottery, and hanging goods.
      int marketX = wellX - 20, marketSurfaceSum = 0;
      for (int x = marketX - 11; x <= marketX + 11; x++) marketSurfaceSum += terrain.genSurfaceAbs(x);
      int marketY = floorDiv(marketSurfaceSum, 23) - 1;
      stampTerraceFoundation(marketX - 11, marketX + 11, marketY, SANDSTONE, true);
      for (int x = marketX - 11; x <= marketX + 11; x++) {
        put(x, marketY - 12, ((x - marketX) & 3) < 2 ? BRICK : SANDSTONE);
        put(x, marketY - 11, ((x - marketX) & 3) < 2 ? BRICK : SANDSTONE);
      }
      for (int side : {-1, 1}) for (int y = marketY - 10; y <= marketY; y++) put(marketX + side * 10, y, PINE_WOOD);
      for (int x = marketX - 8; x <= marketX + 8; x++) put(x, marketY - 4, WOOD);
      for (int x : {marketX - 7, marketX + 7}) for (int y = marketY - 3; y <= marketY; y++) put(x, y, PINE_WOOD);
      if (L->isBackground) {
        static const uint8_t wares[] = { CLAY, MUSH_CAP, MOSS, GLOWBERRY, GOLD_ORE, PLANT };
        for (int x = marketX - 7; x <= marketX + 7; x += 3)
          put(x, marketY - 5, wares[std::abs(x) % 6]);
        for (int x = marketX - 5; x <= marketX + 5; x += 5) {
          for (int y = marketY - 10; y <= marketY - 8; y++) put(x, y, VINE);
          put(x + 1, marketY - 8, GLOWBERRY);
        }
      }

      int wellSurfaceSum = 0;
      for (int x = wellX - 7; x <= wellX + 7; x++) wellSurfaceSum += terrain.genSurfaceAbs(x);
      wellY = floorDiv(wellSurfaceSum, 15) - 1;
      stampTerraceFoundation(wellX - 7, wellX + 7, wellY, BRICK, true);
      for (int dx = -4; dx <= 4; dx++) put(wellX + dx, wellY, BRICK);
      for (int side : {-1, 1}) for (int y = wellY - 12; y < wellY; y++) put(wellX + side * 5, y, PINE_WOOD);
      for (int ry = 0; ry <= 4; ry++)
        for (int x = wellX - 7 + ry; x <= wellX + 7 - ry; x++) put(x, wellY - 12 - ry, BRICK);
      for (int x = wellX - 5; x <= wellX + 5; x++) put(x, wellY - 8, WOOD);
      put(wellX, wellY - 11, STONE);
      for (int y = wellY - 10; y <= wellY - 3; y++) put(wellX, y, WOOD);
      for (int dx = -2; dx <= 2; dx++) {
        put(wellX + dx, wellY - 2, BRICK);
        put(wellX + dx, wellY - 1, dx == 0 ? WATER : BRICK);
      }
      put(wellX, wellY - 3, CLAY); put(wellX - 4, wellY - 1, MOSS);
    }
  }

  void fillMineGeneratedFeature(
      const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    auto put = [&](int wx, int wy, uint8_t m) __attribute__((noinline)) {
      int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
      stampGeneratedFeatureCell(feature, y * cols + lx, m);
    };
    int rectX0 = L->worldOffsetX + colStart;
    int rectX1 = L->worldOffsetX + colEnd - 1;
    int rectY0 = L->worldOffsetY + rowStart;
    int rectY1 = L->worldOffsetY + rowEnd - 1;
    int wx0 = rectX0 - feature.overscanX;
    int wx1 = rectX1 + feature.overscanX;
    auto groundAnchorY = [&](int x) {
      BiomeSample sample = terrain.genBiomeSampleAt(
        x, terrain.genSurfaceAbs(x));
      int biome = sample.ownerFamily == BF_SURFACE
        ? sample.ownerBiome : BIOME_PLAINS;
      return terrain.genSurfaceAbs(x) + TerrainGen::GEN_SKIN
           + terrain.genSoilDepthAt(x, biome);
    };
    auto stampTerraceFoundation = [&](int left, int right, int floorY,
                                      uint8_t foundation, bool stairs) {
      for (int x = left; x <= right; x++) {
        int groundY = groundAnchorY(x);
        for (int y = floorY + 1; y <= groundY; y++) {
          uint8_t course = foundation;
          if (foundation == BRICK && (y - floorY) % 5 == 0)
            course = SANDSTONE;
          put(x, y, course);
        }
      }
      if (!stairs) return;
      for (int side : {-1, 1}) {
        int edgeX = side < 0 ? left : right;
        int drop = terrain.genSurfaceAbs(edgeX + side) - floorY;
        for (int step = 1; step <= imin(10, drop); step++) {
          int x = edgeX + side * step;
          int groundY = groundAnchorY(x);
          int stepY = imin(floorY + step, groundY - 1);
          for (int y = stepY; y <= groundY; y++) put(x, y, foundation);
        }
      }
    };

    // Large, multi-level mines are shared structures: the foreground owns their
    // clear galleries and access shafts, while the background remains solid and
    // carries matching timber frames, station walls, and rail beds. In side view
    // the support work therefore reads behind the player without cutting linear
    // voids through the backdrop.
    int mineMin = floorDiv(wx0, feature.latticeWidth);
    int mineMax = floorDiv(wx1, feature.latticeWidth);
    for (int mr = mineMin; mr <= mineMax; mr++) {
      MinePlan plan;
      if (!worldContext.minePlan(mr, plan)) continue;
      int center = plan.center;

      int levels = plan.levels;
      int shaftHalf = plan.shaftHalf;
      if (plan.right < rectX0 || plan.left > rectX1
          || plan.bottom < rectY0 || plan.top > rectY1) continue;

      auto stampSupportFrame = [&](int x, int ceiling, int floor) {
        for (int y = ceiling; y <= floor; y++) put(x, y, WOOD);
        for (int dx = -4; dx <= 4; dx++) put(x + dx, ceiling, WOOD);
        for (int d = 1; d <= 4; d++) {
          put(x - d, ceiling + d, PINE_WOOD);
          put(x + d, ceiling + d, PINE_WOOD);
        }
      };
      auto stampRail = [&](int x0, int x1, int floor) {
        for (int x = x0; x <= x1; x++) put(x, floor - 1, IRON_ORE);
        for (int x = x0; x <= x1; x += 5)
          for (int dx = 0; dx < 3 && x + dx <= x1; dx++) put(x + dx, floor, WOOD);
      };
      auto stampMineCart = [&](int x, int floor, uint8_t load) {
        for (int dx = -6; dx <= 6; dx++) {
          put(x + dx, floor - 6, IRON_ORE);
          put(x + dx, floor - 3, IRON_ORE);
          if (std::abs(dx) == 6) for (int y = floor - 6; y <= floor - 3; y++) put(x + dx, y, IRON_ORE);
          else if (std::abs(dx) < 5) put(x + dx, floor - 5, load);
        }
        for (int dx : {-4, 4}) {
          put(x + dx, floor - 2, PINE_WOOD);
          put(x + dx - 1, floor - 2, IRON_ORE);
          put(x + dx + 1, floor - 2, IRON_ORE);
        }
      };
      auto stampMineCrates = [&](int x, int floor, int count) {
        for (int c = 0; c < count; c++) {
          int cw = 6 + (c & 1), ch = 4 + ((c + 1) & 1);
          int x0 = x + c * 5, y0 = floor - ch - (c & 1) * 4;
          for (int dx = 0; dx < cw; dx++) for (int dy = 0; dy < ch; dy++) {
            bool edge = dx == 0 || dx == cw - 1 || dy == 0 || dy == ch - 1;
            put(x0 + dx, y0 + dy, edge || dx == dy ? PINE_WOOD : WOOD);
          }
        }
      };

      for (int level = 0; level < levels; level++) {
        const MineLevelPlan& levelPlan = plan.level[level];
        int floor = levelPlan.floor, ceiling = levelPlan.ceiling;
        int x0 = levelPlan.left, x1 = levelPlan.right;
        int stationHalf = (levelPlan.stationRight
                         - levelPlan.stationLeft) / 2;
        int sideRoomHeight = levelPlan.ceiling - levelPlan.roomTop;
        int roomX0 = levelPlan.roomLeft, roomX1 = levelPlan.roomRight;

        if (L->isBackground) {
          for (int y = ceiling - 5; y <= floor; y++)
            for (int x = center - stationHalf; x <= center + stationHalf; x++)
              put(x, y, BRICK);
          // A tall brick station with pale masonry bands, timber bays, a line
          // map, and a lit identity plaque. It visually anchors every level.
          for (int y : {ceiling - 3, floor - 4})
            for (int x = center - stationHalf + 1; x < center + stationHalf; x++) put(x, y, SANDSTONE);
          for (int x = center - stationHalf + 4; x < center + stationHalf; x += 9)
            for (int y = ceiling - 4; y < floor; y++) put(x, y, PINE_WOOD);
          for (int x = center - 8; x <= center + 8; x++) for (int y = ceiling - 1; y <= ceiling + 3; y++)
            put(x, y, PINE_WOOD);
          for (int x = center - 6; x <= center + 6; x += 3) put(x, ceiling + 1, level == 0 ? GOLD_ORE : COPPER_ORE);
          put(center, ceiling + 3, CRYSTAL);

          // The foreground alcove is backed by its own constructed room. Each
          // level has a distinct use instead of repeating an empty tunnel.
          for (int y = ceiling - sideRoomHeight; y < ceiling; y++)
            for (int x = roomX0; x <= roomX1; x++) put(x, y, BRICK);
          for (int x = roomX0; x <= roomX1; x++) {
            put(x, ceiling - sideRoomHeight, PINE_WOOD);
            put(x, ceiling - 2, PINE_WOOD);
          }
          for (int y = ceiling - sideRoomHeight; y < ceiling; y++) {
            put(roomX0, y, PINE_WOOD); put(roomX1, y, PINE_WOOD);
          }
          for (int x = x0 + 8; x <= x1 - 8; x += 18)
            stampSupportFrame(x, ceiling, floor);
          stampRail(x0 + 3, x1 - 3, floor);

          for (int lampX = x0 + 17; lampX < x1 - 12; lampX += 34) {
            put(lampX, ceiling, IRON_ORE); put(lampX, ceiling + 1, IRON_ORE);
            put(lampX - 1, ceiling + 2, CRYSTAL); put(lampX, ceiling + 2, CRYSTAL); put(lampX + 1, ceiling + 2, CRYSTAL);
          }
          uint8_t cartLoad = level == 0 ? WOOD : level == 1 ? COAL_ORE : level == 2 ? COPPER_ORE : GOLD_ORE;
          stampMineCart(x0 + 28, floor, cartLoad);
          if (x1 - x0 > 175) stampMineCart(x1 - 30, floor, level == 0 ? CLAY : IRON_ORE);

          if (level == 0) {
            // Station office, benches, clock, and route board.
            for (int x = roomX0 + 4; x <= roomX1 - 4; x++) put(x, ceiling - 6, WOOD);
            for (int x : {roomX0 + 6, roomX1 - 6}) for (int y = ceiling - 5; y <= ceiling - 2; y++) put(x, y, PINE_WOOD);
            for (int x = roomX0 + 5; x <= roomX0 + 12; x++) put(x, ceiling - 10, SANDSTONE);
            put(roomX0 + 8, ceiling - 12, CRYSTAL);
            for (int x = roomX0 + 16; x <= roomX1 - 3; x++) put(x, ceiling - 9, PINE_WOOD);
            for (int x = roomX0 + 18; x <= roomX1 - 5; x += 4) put(x, ceiling - 10, x & 1 ? GOLD_ORE : CRYSTAL);
          } else if (level == 1) {
            // Repair shop: long bench, hanging tools, spare rail and timber.
            for (int x = roomX0 + 3; x <= roomX1 - 3; x++) put(x, ceiling - 5, WOOD);
            for (int x : {roomX0 + 5, roomX1 - 5}) for (int y = ceiling - 4; y < ceiling; y++) put(x, y, PINE_WOOD);
            for (int x = roomX0 + 5; x <= roomX1 - 5; x += 5) {
              put(x, ceiling - 9, IRON_ORE); put(x + 1, ceiling - 8, COPPER_ORE);
            }
            for (int x = roomX0 + 7; x <= roomX1 - 7; x++) put(x, ceiling - 12, IRON_ORE);
          } else if (level == 2) {
            // Ore depot: marked storage, assay shelf, and richer deep loads.
            stampMineCrates(roomX0 + 3, ceiling, 4);
            for (int x = roomX0 + 4; x <= roomX1 - 4; x++) put(x, ceiling - 10, PINE_WOOD);
            for (int x = roomX0 + 6; x <= roomX1 - 6; x += 4)
              put(x, ceiling - 11, x % 3 == 0 ? GOLD_ORE : (x & 1 ? COPPER_ORE : IRON_ORE));
          } else {
            // The oldest level has been reclaimed by a luminous fungal garden.
            for (int x = roomX0 + 2; x < roomX1 - 1; x++) put(x, ceiling - 3, MYCELIUM);
            for (int x = roomX0 + 5; x < roomX1 - 3; x += 6) {
              int mh = 2 + ((x - roomX0) % 3);
              for (int y = 0; y < mh; y++) put(x, ceiling - 4 - y, MUSH_STEM);
              for (int dx = -2; dx <= 2; dx++) put(x + dx, ceiling - 4 - mh, MUSH_CAP);
              if (x & 1) put(x + 1, ceiling - 4 - mh, GLOWSHROOM);
            }
            for (int y = ceiling - sideRoomHeight + 1; y <= ceiling - sideRoomHeight + 5; y++) put(roomX1 - 4, y, VINE);
            put(roomX1 - 5, ceiling - sideRoomHeight + 5, GLOWBERRY);
          }
          continue;
        }

        for (int y = ceiling; y < floor; y++)
          for (int x = x0; x <= x1; x++) put(x, y, EMPTY);
        // A tall central station breaks up the long gallery and leaves generous
        // headroom around the main shaft.
        for (int y = ceiling - 5; y < floor; y++)
          for (int x = center - stationHalf; x <= center + stationHalf; x++) put(x, y, EMPTY);

        int shaftA = plan.shaftLeft, shaftB = plan.shaftRight;
        auto railSection = [&](int from, int to) {
          if (from <= to) stampRail(from, to, floor);
        };
        railSection(x0 + 3, shaftA - shaftHalf - 1);
        railSection(shaftA + shaftHalf + 1, shaftB - shaftHalf - 1);
        railSection(shaftB + shaftHalf + 1, x1 - 3);

        for (int x = roomX0; x <= roomX1; x++)
          for (int y = ceiling - sideRoomHeight; y < ceiling; y++) put(x, y, EMPTY);
        for (int lampX = x0 + 18; lampX < x1 - 12; lampX += 36)
          put(lampX, ceiling + 1, CRYSTAL);
      }

      // Broad inter-level shafts let the full player body pass with room to
      // maneuver. Timber ledges mark each landing in the background layer.
      for (int shaftX : {plan.shaftLeft, plan.shaftRight}) {
        int top = plan.shaftTop;
        int bottom = plan.shaftBottom;
        if (!L->isBackground) {
          for (int y = top; y < bottom; y++)
            for (int x = shaftX - shaftHalf; x <= shaftX + shaftHalf; x++) put(x, y, EMPTY);
        } else {
          for (int y = top; y < bottom; y++) {
            put(shaftX, y, IRON_ORE);                    // hoist cable
            put(shaftX + shaftHalf - 2, y, PINE_WOOD);  // service ladder
            if ((y - top) % 4 == 0)
              for (int x = shaftX + shaftHalf - 5; x <= shaftX + shaftHalf - 1; x++) put(x, y, WOOD);
          }
          for (int level = 0; level < levels; level++) {
            int landing = plan.level[level].floor;
            for (int x = shaftX - shaftHalf - 2; x <= shaftX + shaftHalf + 2; x++)
              put(x, landing, WOOD);
          }
        }
      }

      // A substantial headhouse makes the mine legible at the surface. Its
      // constructed shaft is intentionally regular; natural cave mouths are not.
      int houseW = plan.headhouseRight - plan.headhouseLeft;
      int houseLeft = plan.headhouseLeft;
      int floor = plan.headhouseFloor, houseTop = plan.headhouseTop;
      for (int y = houseTop; y <= floor; y++) for (int x = houseLeft; x <= houseLeft + houseW; x++) {
        bool shell = x == houseLeft || x == houseLeft + houseW || y == houseTop || y == floor;
        bool doorway = y >= floor - PLAYER_H - 4 && std::abs(x - center) <= shaftHalf;
        if (L->isBackground) put(x, y, BRICK);
        else put(x, y, shell && !doorway ? BRICK : EMPTY);
      }
      stampTerraceFoundation(houseLeft, houseLeft + houseW, floor, BRICK, true);
      for (int roof = 0; roof <= 9; roof++)
        for (int x = houseLeft - 2 + roof; x <= houseLeft + houseW + 2 - roof; x++)
          put(x, houseTop - roof, BRICK);
      if (L->isBackground) {
        // Hoist house machinery: glowing windows, winding wheel and drum, tool
        // rack, manifest board, and supplies beside the shaft.
        for (int wx : {houseLeft + 7, houseLeft + houseW - 7})
          for (int dx = -3; dx <= 3; dx++) for (int dy = -3; dy <= 3; dy++)
            put(wx + dx, houseTop + 8 + dy, std::abs(dx) == 3 || std::abs(dy) == 3 || dx == 0 || dy == 0 ? PINE_WOOD : CRYSTAL);
        int wheelX = center - 8, wheelY = floor - 10;
        for (int d = -5; d <= 5; d++) {
          put(wheelX + d, wheelY - 5 + std::abs(d) / 2, IRON_ORE);
          put(wheelX + d, wheelY + 5 - std::abs(d) / 2, IRON_ORE);
          put(wheelX - 5 + std::abs(d) / 2, wheelY + d, IRON_ORE);
          put(wheelX + 5 - std::abs(d) / 2, wheelY + d, IRON_ORE);
        }
        for (int dx = -3; dx <= 3; dx++) put(wheelX + dx, wheelY, COPPER_ORE);
        put(wheelX, wheelY, GOLD_ORE);
        for (int y = wheelY + 1; y <= floor; y++) put(center, y, IRON_ORE);
        stampMineCrates(center + 9, floor, 2);
        for (int x = houseLeft + 4; x <= houseLeft + 15; x++) put(x, floor - 5, PINE_WOOD);
        for (int x = houseLeft + 6; x <= houseLeft + 13; x += 3) put(x, floor - 6, x & 1 ? IRON_ORE : COPPER_ORE);
        for (int x = center - 5; x <= center + 5; x++) put(x, houseTop + 2, PINE_WOOD);
        put(center, houseTop + 2, GOLD_ORE); put(center - 3, houseTop + 2, CRYSTAL); put(center + 3, houseTop + 2, CRYSTAL);
      } else {
        put(houseLeft + 1, floor - PLAYER_H - 6, CRYSTAL);
        put(houseLeft + houseW - 1, floor - PLAYER_H - 6, CRYSTAL);
      }

      int shaftTop = plan.connectorTop;
      int shaftBottom = plan.connectorBottom;
      if (!L->isBackground) {
        for (int y = shaftTop; y <= shaftBottom; y++)
          for (int x = center - shaftHalf; x <= center + shaftHalf; x++) put(x, y, EMPTY);
      } else {
        for (int y = floor; y <= shaftBottom; y += 14)
          for (int x = center - shaftHalf - 2; x <= center + shaftHalf + 2; x++)
            put(x, y, WOOD);
      }
    }
  }

  void fillRuinGeneratedFeature(
      const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    auto put = [&](int wx, int wy, uint8_t m) __attribute__((noinline)) {
      int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
      stampGeneratedFeatureCell(feature, y * cols + lx, m);
    };
    uint32_t sseed = L->worldSeed ^ 0x57121314u;
    int rectX0 = L->worldOffsetX + colStart;
    int rectX1 = L->worldOffsetX + colEnd - 1;
    int rectY0 = L->worldOffsetY + rowStart;
    int rectY1 = L->worldOffsetY + rowEnd - 1;
    int wx0 = rectX0 - feature.overscanX;
    int wx1 = rectX1 + feature.overscanX;
    int wy0 = rectY0 - feature.overscanY;
    int wy1 = rectY1 + feature.overscanY;
    auto h2 = [&](uint32_t salt, int a, int b) {
      return whash2(sseed ^ salt, a, b);
    };

    int lxMin = floorDiv(wx0, feature.latticeWidth);
    int lxMax = floorDiv(wx1, feature.latticeWidth);
    int lyMin = floorDiv(wy0, feature.latticeHeight);
    int lyMax = floorDiv(wy1, feature.latticeHeight);

    // --- structure archetypes ------------------------------------------------
    // Each ruin has two coordinated stamps. The foreground is a roomy, traversable
    // shell; the background is a fully solid decorated wall with furnishings,
    // murals, storage, vegetation, and light. This keeps the backdrop mostly solid
    // while making the empty play space feel inhabited.
    auto backdropRoom = [&](int ax, int ay, int w, int h, uint8_t field) {
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        uint8_t mat = border ? BRICK : field;
        if (!border && oy % 6 == 0 && ox % 8 != 0) mat = SANDSTONE;
        if (!border && ox % 9 == 0) mat = PINE_WOOD;
        put(ax + ox, ay + oy, mat);
      }
    };
    // A former dwelling: framed windows and the remains of an ordinary home.
    auto stampHouse = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, BRICK);
        int fy = ay + h - 1;
        for (int wx : {ax + 7, ax + w - 8})
          for (int dx = -3; dx <= 3; dx++) for (int dy = -3; dy <= 3; dy++)
            put(wx + dx, ay + 7 + dy, std::abs(dx) == 3 || std::abs(dy) == 3 || dx == 0 || dy == 0 ? PINE_WOOD : CRYSTAL);
        // Hearth, bed, table, crockery, shelf, and a small hanging lamp.
        for (int x = ax + 3; x <= ax + 9; x++) for (int y = fy - 7; y < fy; y++)
          if (x == ax + 3 || x == ax + 9 || y == fy - 7) put(x, y, STONE);
        put(ax + 6, fy - 2, CRYSTAL); put(ax + 6, fy - 3, GOLD_ORE);
        for (int x = ax + w - 13; x <= ax + w - 3; x++) put(x, fy - 3, WOOD);
        for (int x = ax + w - 12; x <= ax + w - 5; x++) put(x, fy - 4, MOSS);
        for (int x = ax + w / 2 - 4; x <= ax + w / 2 + 4; x++) put(x, fy - 6, WOOD);
        for (int x : {ax + w / 2 - 3, ax + w / 2 + 3}) for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
        for (int x = ax + w - 14; x <= ax + w - 5; x++) put(x, fy - 11, PINE_WOOD);
        put(ax + w - 12, fy - 12, CLAY); put(ax + w - 9, fy - 12, MUSH_CAP); put(ax + w - 6, fy - 12, PLANT);
        for (int y = ay + 1; y <= ay + 6; y++) put(ax + w / 2, y, IRON_ORE);
        put(ax + w / 2, ay + 7, CRYSTAL);
        return;
      }
      int doorX = 1 + (int)(h2(0xE5u, lx, ly) * (w - 4));
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        bool door = oy == h - 1 && ox >= doorX && ox <= doorX + 1;
        put(ax + ox, ay + oy, (border && !door) ? BRICK : EMPTY);
      }
      for (int x = ax + 3; x <= ax + 8; x++) put(x, ay + h - 3, WOOD);
      put(ax + 3, ay + h - 4, CRYSTAL);
    };
    // A treasury with a monumental lock wall behind its ore-hoard.
    auto stampVault = [&](int ax, int ay, int w, int h, int, int) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, STONE);
        int cx = ax + w / 2, cy = ay + h / 2;
        for (int r = 3; r <= imin(9, h / 2 - 2); r += 3) {
          for (int d = -r; d <= r; d++) {
            put(cx + d, cy - r + std::abs(d) / 2, r & 1 ? GOLD_ORE : COPPER_ORE);
            put(cx + d, cy + r - std::abs(d) / 2, r & 1 ? GOLD_ORE : COPPER_ORE);
          }
        }
        put(cx, cy, CRYSTAL);
        for (int x = ax + 3; x <= ax + w - 4; x += 7) {
          for (int y = ay + h - 6; y <= ay + h - 2; y++) put(x, y, IRON_ORE);
          put(x + 2, ay + h - 3, x % 3 == 0 ? GOLD_ORE : COPPER_ORE);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      int fy = ay + h - 2;
      int rewardDepth = fy - terrain.genSurfaceAbs(ax + w / 2);
      bool ironDepth = rewardDepth > 105, goldDepth = rewardDepth > 300;
      for (int ox = 2; ox < w - 2; ox++) {
        double r = h2(0x7000u, ax + ox, ay);
        uint8_t ore = goldDepth && r < 0.14 ? GOLD_ORE
                    : ironDepth && r < 0.42 ? IRON_ORE
                    : r < 0.72 ? COPPER_ORE : EMPTY;
        if (ore != EMPTY) put(ax + ox, fy, ore);
        if (goldDepth && r < 0.06) put(ax + ox, fy - 1, GOLD_ORE); // taller deep-vault heaps
      }
      put(ax + 2, fy, CRYSTAL); put(ax + w - 3, fy, CRYSTAL);
    };
    // A ceremonial gallery. Painted arches continue behind the foreground pillars.
    auto stampColonnade = [&](int ax, int ay, int w, int h, int, int) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, SANDSTONE);
        int fy = ay + h - 1;
        for (int px = ax + 1; px < ax + w; px += 12) {
          for (int y = ay + 2; y < fy; y++) put(px, y, BRICK);
          for (int dx = -4; dx <= 4; dx++) {
            int archY = ay + 3 + std::abs(dx) / 2;
            put(px + 6 + dx, archY, BRICK);
          }
        }
        // Repeating mosaic panels and offering bowls make the long hall legible.
        for (int x = ax + 6; x < ax + w - 4; x += 12) {
          for (int d = -3; d <= 3; d++) {
            put(x + d, ay + h / 2 - 3 + std::abs(d), MOSS);
            put(x + d, ay + h / 2 + 3 - std::abs(d), COPPER_ORE);
          }
          put(x, ay + h / 2, CRYSTAL);
          for (int dx = -2; dx <= 2; dx++) put(x + dx, fy - 3, CLAY);
        }
        return;
      }
      for (int oy = 1; oy < h - 1; oy++) for (int ox = 1; ox < w - 1; ox++) put(ax + ox, ay + oy, EMPTY);
      for (int ox = 0; ox < w; ox++) { put(ax + ox, ay, BRICK); put(ax + ox, ay + h - 1, BRICK); }
      for (int ox = 0; ox < w; ox += 12) for (int oy = 1; oy < h - 1; oy++) {
        put(ax + ox, ay + oy, BRICK);
        if (ox + 1 < w) put(ax + ox + 1, ay + oy, BRICK);
      }
      put(ax + w / 2, ay + h - 2, CRYSTAL);             // an altar crystal for light
    };
    // A stepped brick pyramid backed by a mineral sunburst and votive niches.
    auto stampShrine = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, STONE);
        int cx = ax + w / 2, cy = ay + h / 2 - 1;
        for (int r = 2; r <= imin(9, w / 2 - 2); r += 2) {
          for (int d = -r; d <= r; d++) {
            put(cx + d, cy - r + std::abs(d), r % 4 ? CRYSTAL : GOLD_ORE);
            put(cx + d, cy + r - std::abs(d), r % 4 ? CRYSTAL : GOLD_ORE);
          }
        }
        for (int x = ax + 3; x < ax + w - 2; x += 5) {
          put(x, ay + h - 4, CLAY); put(x, ay + h - 5, GLOWBERRY);
        }
        return;
      }
      int base = ay + h - 1, steps = imin(w / 2, h - 1);
      for (int s = 0; s <= steps; s++) for (int ox = s; ox < w - s; ox++) put(ax + ox, base - s, BRICK);
      int topY = base - steps, cx = ax + w / 2;
      int ch = 4 + (int)(h2(0x7100u, lx, ly) * 5);      // 4..8 crystal spire
      for (int i = 0; i < ch; i++) { int rad = imax(0, 2 - i / 2); for (int dx = -rad; dx <= rad; dx++) put(cx + dx, topY - 1 - i, CRYSTAL); }
      put(cx - 1, topY, CRYSTAL); put(cx + 1, topY, CRYSTAL);
    };
    // A smithy with a contained crucible, tool wall, bellows, and ore racks.
    auto stampForge = [&](int ax, int ay, int w, int h, int, int) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, BRICK);
        int fy = ay + h - 1;
        for (int x = ax + 3; x <= ax + w - 4; x++) put(x, fy - 6, WOOD);
        for (int x : {ax + 5, ax + w - 6}) for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
        for (int x = ax + 5; x < ax + w - 4; x += 5) {
          put(x, fy - 10, IRON_ORE); put(x + 1, fy - 9, x & 1 ? COPPER_ORE : GOLD_ORE);
        }
        for (int x = ax + 3; x <= ax + 11; x++) for (int y = fy - 8; y < fy; y++)
          if (x == ax + 3 || x == ax + 11 || y == fy - 8) put(x, y, STONE);
        put(ax + 7, fy - 2, CRYSTAL); put(ax + 7, fy - 3, GOLD_ORE);
        for (int d = 0; d < 6; d++) {
          put(ax + w - 9 - d, fy - 3 - d / 2, WOOD);
          put(ax + w - 9 + d, fy - 3 - d / 2, WOOD);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      int cx = ax + w / 2, fy = ay + h - 1;             // crucible sits in the floor
      for (int ox = cx - 2; ox <= cx + 2; ox++) { put(ox, fy, STONE); put(ox, fy - 1, LAVA); }
      put(cx - 3, fy, STONE); put(cx - 3, fy - 1, STONE); // stone hearth fully contains the lava
      put(cx + 3, fy, STONE); put(cx + 3, fy - 1, STONE);
      for (int x = ax + 3; x <= ax + 8; x++) put(x, fy - 2, WOOD);
      uint8_t toolMetal = fy - terrain.genSurfaceAbs(ax + w - 6) > 105 ? IRON_ORE : COPPER_ORE;
      put(ax + w - 6, fy - 2, toolMetal); put(ax + w - 6, fy - 3, toolMetal);
    };
    // A lost archive with tall book bays, reading tables, maps, and balconies.
    // The shelves remain in the background; only edge stacks and a lectern enter
    // the foreground, preserving a broad central aisle.
    auto stampArchive = [&](int ax, int ay, int w, int h, int, int) {
      int fy = ay + h - 1, cx = ax + w / 2;
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, SANDSTONE);
        auto bookcase = [&](int x0, int x1) {
          for (int x : {x0, x1}) for (int y = ay + 3; y <= fy - 2; y++) put(x, y, PINE_WOOD);
          for (int shelfY = ay + 6; shelfY < fy - 2; shelfY += 5) {
            for (int x = x0; x <= x1; x++) put(x, shelfY, WOOD);
            for (int x = x0 + 2; x < x1; x += 2) {
              static const uint8_t books[] = { CLAY, MOSS, CRYSTAL, COPPER_ORE, COAL_ORE };
              put(x, shelfY - 1, books[std::abs(x + shelfY) % 5]);
              if ((x + shelfY) & 1) put(x, shelfY - 2, books[std::abs(x + shelfY + 2) % 5]);
            }
          }
        };
        bookcase(ax + 3, ax + 12);
        bookcase(ax + w - 13, ax + w - 4);
        // Central celestial map and librarian's desk.
        int mapY = ay + h / 2 - 3;
        for (int r = 2; r <= 7; r += 2) for (int d = -r; d <= r; d++) {
          if (std::abs(d) == r || (d + r) % 3 == 0)
            put(cx + d, mapY + (r - std::abs(d)) / 2, r == 6 ? GOLD_ORE : CRYSTAL);
        }
        for (int x = cx - 7; x <= cx + 7; x++) put(x, fy - 6, WOOD);
        for (int x : {cx - 5, cx + 5}) for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
        put(cx - 3, fy - 7, CLAY); put(cx, fy - 7, CRYSTAL); put(cx + 3, fy - 7, MOSS);
        for (int y = ay + 1; y <= ay + 7; y++) put(cx, y, PINE_WOOD);
        for (int dx = -3; dx <= 3; dx++) put(cx + dx, ay + 7, IRON_ORE);
        put(cx - 3, ay + 8, CRYSTAL); put(cx, ay + 8, CRYSTAL); put(cx + 3, ay + 8, CRYSTAL);
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      for (int side : {-1, 1}) {
        int x0 = side < 0 ? ax + 2 : ax + w - 6;
        for (int x = x0; x <= x0 + 4; x++) for (int y = fy - 7; y < fy; y++) {
          bool frame = x == x0 || x == x0 + 4 || (y - (fy - 7)) % 3 == 0;
          if (frame) put(x, y, PINE_WOOD);
        }
        int balconyX0 = side < 0 ? ax + 2 : ax + w - 12;
        int balconyX1 = side < 0 ? ax + 11 : ax + w - 3;
        for (int x = balconyX0; x <= balconyX1; x++) put(x, ay + 9, WOOD);
        for (int y = ay + 10; y <= ay + 13; y++) put(side < 0 ? balconyX1 : balconyX0, y, PINE_WOOD);
      }
      for (int x = cx - 2; x <= cx + 2; x++) put(x, fy - 2, WOOD);
      put(cx, fy - 3, CRYSTAL);
    };
    // A crumbled, plant-choked ruin — the lush biome's signature structure.
    auto stampOvergrown = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, BRICK);
        int fy = ay + h - 1;
        for (int x = ax + 1; x < ax + w - 1; x++)
          if (h2(0x7210u, x, ay) < 0.72) put(x, fy - 2, MOSS);
        for (int x = ax + 3; x < ax + w - 3; x += 5) {
          int len = 3 + (int)(h2(0x7211u, x, ay) * (h - 7));
          for (int d = 1; d <= len; d++) put(x, ay + d, VINE);
          if (x & 1) put(x + 1, ay + len, GLOWBERRY);
        }
        for (int x = ax + 5; x < ax + w - 4; x += 7) {
          for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
          put(x + 1, fy - 5, CLAY); put(x + 1, fy - 6, PLANT);
        }
        // A broken green-and-gold mural survives beneath the growth.
        for (int d = -5; d <= 5; d++) {
          put(ax + w / 2 + d, ay + h / 2 + std::abs(d) / 2, MOSS);
          if ((d & 2) == 0) put(ax + w / 2 + d, ay + h / 2 - 1, GOLD_ORE);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        if (border) put(ax + ox, ay + oy, h2(0x7200u, ax + ox, ay + oy) < 0.80 ? BRICK : EMPTY); // ~20% crumbled
        else put(ax + ox, ay + oy, EMPTY);
      }
      for (int ox = 1; ox < w - 1; ox++) if (h2(0x7201u, ax + ox, ay) < 0.85) put(ax + ox, ay + h - 2, MOSS); // moss carpet
      for (int ox = 1; ox < w - 1; ox++) if (h2(0x7202u, ax + ox, ay) < 0.45) {  // vines drape from the top wall
        int vlen = 2 + (int)(h2(0x7203u, ax + ox, ay) * (h - 3));
        for (int i = 1; i <= vlen && i < h - 1; i++) put(ax + ox, ay + i, VINE);
      }
      for (int ox = 2; ox < w - 2; ox++) if (h2(0x7204u, ax + ox, ay) < 0.32) {  // leafy plants sprout from the floor
        int ph = 1 + (int)(h2(0x7205u, ax + ox, ay) * 3);
        for (int i = 0; i < ph; i++) put(ax + ox, ay + h - 2 - i, PLANT);
      }
      if (h2(0x7206u, lx, ly) < 0.6) put(ax + 2, ay + h - 2, CRYSTAL); // a soft glow through the leaves
    };
    // A brick grotto sheltering a dense, bioluminescent fungal conservatory.
    auto stampMushGrove = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, MYCELIUM);
        int fy = ay + h - 1;
        for (int x = ax + 2; x < ax + w - 2; x++) put(x, fy - 2, MYCELIUM);
        for (int x = ax + 4; x < ax + w - 3; x += 5) {
          int mh = 3 + (int)(h2(0x7310u, x, ay) * 5);
          for (int d = 0; d < mh; d++) put(x, fy - 3 - d, MUSH_STEM);
          for (int dx = -3; dx <= 3; dx++)
            if (std::abs(dx) < 3 || h2(0x7311u, x + dx, ay) < 0.72) put(x + dx, fy - 3 - mh, MUSH_CAP);
          if (x % 3 == 0) put(x, fy - 4 - mh, GLOWSHROOM);
        }
        for (int x = ax + 6; x < ax + w - 5; x += 8) {
          for (int y = ay + 1; y <= ay + 5; y++) put(x, y, VINE);
          put(x + 1, ay + 5, GLOWBERRY);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      for (int ox = 1; ox < w - 1; ox++) put(ax + ox, ay + h - 2, MYCELIUM); // fungal floor
      for (int m = 0; m < 5; m++) {
        int mx = ax + 3 + m * (w - 6) / 4;
        if (h2(0x7300u + m, lx, ly) >= 0.72) continue;
        int mh = 2 + (int)(h2(0x7301u, mx, ay) * 3);
        for (int i = 0; i < mh; i++) put(mx, ay + h - 3 - i, MUSH_STEM);      // stem rises off the mycelium floor
        int capY = ay + h - 3 - mh;
        for (int dx = -2; dx <= 2; dx++) if (std::abs(dx) <= 1 || h2(0x7302u, mx + dx, capY) < 0.7) put(mx + dx, capY, MUSH_CAP);
        if (m & 1) put(mx, capY - 1, GLOWSHROOM);
      }
      put(ax + 2, ay + h - 3, CRYSTAL);
    };

    for (int ly = lyMin; ly <= lyMax; ly++) for (int lx = lxMin; lx <= lxMax; lx++) {
      RuinPlan plan;
      if (!worldContext.ruinPlan(lx, ly, plan)) continue;
      int ax = plan.left, ay = plan.top;
      int w = plan.right - plan.left, h = plan.bottom - plan.top + 1;
      if (plan.right < rectX0 || plan.left > rectX1
          || plan.bottom < rectY0 || plan.top > rectY1) continue;
      switch (plan.kind) {
#define WORLDGEN_FACILITY_ARCHETYPE(...)
#define WORLDGEN_RUIN_ARCHETYPE(symbol, id, name, profile, chance, neutral, size, widthAdd, heightAdd, minDepth, fallback, stamp) \
        case RK_##symbol: stamp(ax, ay, w, h, lx, ly); break;
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
        case RK_COUNT: assert(false && "invalid ruin archetype"); break;
      }

      // Open one full-height side door and connect it to the first nearby cave
      // cell. The containing cavern normally starts immediately outside the
      // facade; the bounded search also handles thick noise walls.
      if (!L->isBackground) {
        int dir = h2(0xAACC355u, lx, ly) < 0.5 ? -1 : 1;
        int edgeX = dir < 0 ? ax : ax + w - 1;
        int doorBottom = ay + h - 2;
        int doorTop = doorBottom - PLAYER_H - 4;
        int reach = 2;
        for (int d = 1; d <= 28; d++) {
          if (terrain.genOpenCaveAt(edgeX + dir * d, doorBottom)) { reach = d; break; }
        }
        for (int d = 0; d <= reach; d++)
          for (int py = doorTop; py <= doorBottom; py++) put(edgeX + dir * d, py, EMPTY);
      }
    }
  }
  // Monumental ruins inhabit whole deep chambers. Each plan is shared by both
  // layers: the foreground supplies roomy architecture and traversable doors,
  // while the background supplies the solid back wall, furnishings, light, and
  // storytelling detail without putting clutter in the player's path.
