  void fillSpaceship(int colStart, int colEnd, int rowStart, int rowEnd) {
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

  void fillFacilityGeneratedFeature(
    const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    const PlanetDef& planet = planetDef(planetId);
    int worldLeft = L->worldOffsetX + colStart;
    int worldRight = L->worldOffsetX + colEnd - 1;
    int worldTop = L->worldOffsetY + rowStart;
    int worldBottom = L->worldOffsetY + rowEnd - 1;
    auto put = [&](int worldX, int worldY, uint8_t material) {
      int x = worldX - L->worldOffsetX, y = worldY - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      stampGeneratedFeatureCell(feature, I(x, y), material);
    };
    auto hline = [&](int x0, int x1, int y, uint8_t material) {
      for (int x = imax(x0, worldLeft); x <= imin(x1, worldRight); x++)
        put(x, y, material);
    };
    auto vline = [&](int x, int y0, int y1, uint8_t material) {
      for (int y = imax(y0, worldTop); y <= imin(y1, worldBottom); y++)
        put(x, y, material);
    };
    auto rect = [&](int x0, int x1, int y0, int y1, uint8_t material) {
      for (int y = imax(y0, worldTop); y <= imin(y1, worldBottom); y++)
        hline(x0, x1, y, material);
    };

    int q0 = floorDiv(worldLeft - feature.overscanX, feature.latticeWidth);
    int q1 = floorDiv(worldRight + feature.overscanX, feature.latticeWidth);
    for (int q = q0; q <= q1; q++) {
      OffworldFacilityPlan plan;
      if (!worldContext.offworldFacilityPlan(q, plan)) continue;
      int center = plan.center;
      int halfWidth = (plan.right - plan.left) / 2;
      int deckY = plan.deckY;
      int facilityTop = plan.facilityTop;
      int facilityBottom = plan.facilityBottom;
      int facilityHalf = plan.facilityRight - plan.center;
      uint8_t shell = planet.facilityShell;
      uint8_t wall = planet.facilityWall;
      uint8_t trim = planet.facilityTrim;

      // A broad landing apron follows the highest point under the facility.
      // Regular pylons reach the local terrain instead of leaving a floating pad.
      hline(center - halfWidth, center + halfWidth, deckY, shell);
      for (int x = center - halfWidth; x <= center + halfWidth; x += 12) {
        int localSurface = terrain.genSurfaceAbs(x);
        vline(x, deckY + 1, localSurface, (x / 12) % 2 ? shell : wall);
        if (localSurface > deckY + 5)
          hline(x - 2, x + 2, localSurface - 1, shell);
      }

      // Every complex has three roomy underground decks. The foreground retains
      // clear corridors and lift wells; the darker layer carries walls, displays,
      // lighting, machinery, and storage visible through those open rooms.
      if (L->isBackground) {
        rect(center - facilityHalf, center + facilityHalf,
             facilityTop, facilityBottom, wall);
        for (int deck = 0; deck < plan.roomDeckCount; deck++) {
          int floor = plan.roomDeckFloor[deck];
          hline(center - facilityHalf + 4, center + facilityHalf - 4,
                floor, shell);
          hline(center - facilityHalf + 4, center + facilityHalf - 4,
                floor + 1, shell);
          for (int x = center - facilityHalf + 10;
               x <= center + facilityHalf - 10; x += 18) {
            rect(x, x + 8, floor - 10, floor - 5,
                 ((x - center) / 18) % 2 ? GLASS : trim);
            hline(x - 1, x + 9, floor - 4, PINE_WOOD);
          }
          for (int x = center - facilityHalf + 12;
               x <= center + facilityHalf - 12; x += 28)
            put(x, floor - 13, LIGHT);
        }
        vline(center - facilityHalf + 5,
              facilityTop + OFFWORLD_FACILITY_FIRST_ROOM_OFFSET,
              facilityBottom - OFFWORLD_FACILITY_BOTTOM_ROOM_CLEARANCE,
              trim);
        vline(center + facilityHalf - 5,
              facilityTop + OFFWORLD_FACILITY_FIRST_ROOM_OFFSET,
              facilityBottom - OFFWORLD_FACILITY_BOTTOM_ROOM_CLEARANCE,
              trim);
        for (int y = facilityTop + 16; y < facilityBottom - 8;
             y += OFFWORLD_FACILITY_DECK_SPACING) {
          hline(center - facilityHalf + 8, center - 10, y, IRON_ORE);
          hline(center + 10, center + facilityHalf - 8, y, IRON_ORE);
        }
      } else {
        rect(center - facilityHalf, center + facilityHalf,
             facilityTop, facilityBottom, EMPTY);
        for (int t = 0; t < 3; t++) {
          hline(center - facilityHalf, center + facilityHalf,
                facilityTop + t, shell);
          hline(center - facilityHalf, center + facilityHalf,
                facilityBottom - t, shell);
          vline(center - facilityHalf + t, facilityTop, facilityBottom, shell);
          vline(center + facilityHalf - t, facilityTop, facilityBottom, shell);
        }
        for (int divider = 0; divider < plan.dividerCount; divider++) {
          int floor = plan.dividerFloor[divider];
          hline(center - facilityHalf + 3, center - 7, floor, shell);
          hline(center + 7, center + facilityHalf - 3, floor, shell);
          hline(center - facilityHalf + 3, center - 7, floor + 1, shell);
          hline(center + 7, center + facilityHalf - 3, floor + 1, shell);
        }
        for (int x : {center - facilityHalf / 3, center + facilityHalf / 3}) {
          for (int y = facilityTop + 3; y <= facilityBottom - 3; y++) {
            int roomY =
              (y - facilityTop) % OFFWORLD_FACILITY_DECK_SPACING;
            if (roomY >= 19 && roomY <= 28) continue;
            put(x, y, shell);
            put(x + 1, y, shell);
          }
        }
        rect(center - 6, center + 6, deckY + 1, facilityBottom - 3, EMPTY);
        vline(center - 7, deckY, facilityTop + 12, shell);
        vline(center + 7, deckY, facilityTop + 12, shell);
      }

      auto stampMoonObservatory = [&] {
        // Selenographic observatory: a broad pressure dome, flanking labs, and
        // an offset telescope dish distinguish it from every Martian complex.
        for (int x = center - 67; x <= center + 67; x++) {
          double nx = (x - center) / 67.0;
          for (int y = deckY - 43; y <= deckY; y++) {
            double ny = (y - deckY) / 43.0;
            double e = nx * nx + ny * ny;
            if (L->isBackground && e <= .92) put(x, y, e > .72 ? GLASS : DEEPSTONE);
            else if (!L->isBackground && e <= 1.0 && e >= .86) put(x, y, GLASS);
          }
        }
        hline(center - 72, center - 48, deckY - 1, STONE);
        hline(center + 48, center + 72, deckY - 1, STONE);
        vline(center + 36, deckY - 67, deckY - 31, IRON_ORE);
        for (int dy = -13; dy <= 13; dy++) {
          int x = center + 37 + (int)std::lround(std::sqrt(169.0 - dy * dy));
          put(x, deckY - 60 + dy, GLASS);
          if (L->isBackground) hline(center + 38, x, deckY - 60 + dy, DEEPSTONE);
        }
        hline(center - 58, center + 58, deckY - 15,
              L->isBackground ? CRYSTAL : GLASS);
        for (int x = center - 54; x <= center + 54; x += 18)
          put(x, deckY - 18, LIGHT);
      };
      auto stampMoonMassDriver = [&] {
        // Helium-3 mass driver: long magnetic rails cross a skeletal gantry over
        // a deep central drill, with operator cabins suspended on both sides.
        hline(center - 100, center + 100, deckY - 30, IRON_ORE);
        hline(center - 100, center + 100, deckY - 27, CRYSTAL);
        for (int x = center - 96; x <= center + 96; x += 16) {
          vline(x, deckY - 31, deckY - 2, x % 32 ? STONE : DEEPSTONE);
          put(x, deckY - 34, LIGHT);
        }
        for (int side : {-1, 1}) {
          int cabin = center + side * 60;
          if (L->isBackground) rect(cabin - 22, cabin + 22, deckY - 25, deckY - 5, DEEPSTONE);
          else {
            hline(cabin - 22, cabin + 22, deckY - 25, STONE);
            hline(cabin - 22, cabin + 22, deckY - 5, STONE);
            vline(cabin - 22, deckY - 25, deckY - 5, STONE);
            vline(cabin + 22, deckY - 25, deckY - 5, STONE);
            hline(cabin - 14, cabin + 14, deckY - 16, GLASS);
          }
        }
        vline(center - 10, deckY - 54, facilityBottom, STONE);
        vline(center + 10, deckY - 54, facilityBottom, STONE);
        hline(center - 18, center + 18, deckY - 54, IRON_ORE);
        if (L->isBackground)
          for (int y = deckY - 48; y < facilityBottom; y += 12)
            hline(center - 8, center + 8, y, GOLD_ORE);
      };
      auto stampMoonRelay = [&] {
        // Far-side relay monastery: three linked pressure cells sit beneath a
        // towering phased array and a pair of crescent communications dishes.
        for (int pod : {-58, 0, 58}) {
          int radiusX = pod ? 30 : 37, radiusY = pod ? 24 : 31;
          for (int x = center + pod - radiusX; x <= center + pod + radiusX; x++) {
            double nx = (x - center - pod) / (double)radiusX;
            int roofY = deckY - (int)std::lround(std::sqrt(std::fmax(0.0, 1.0 - nx * nx)) * radiusY);
            if (L->isBackground) rect(x, x, roofY, deckY - 2, pod ? DEEPSTONE : GLASS);
            else {
              put(x, roofY, pod ? STONE : GLASS);
              if (std::abs(x - center - pod) == radiusX) vline(x, roofY, deckY, STONE);
            }
          }
          hline(center + pod - radiusX, center + pod + radiusX, deckY - 1, STONE);
        }
        vline(center, deckY - 88, deckY - 33, IRON_ORE);
        for (int y = deckY - 88; y <= deckY - 48; y += 8)
          hline(center - (deckY - 44 - y) / 3, center + (deckY - 44 - y) / 3,
                y, y % 16 ? CRYSTAL : LIGHT);
        for (int side : {-1, 1}) for (int dy = -12; dy <= 12; dy++) {
          int edge = (int)std::lround(std::sqrt(144.0 - dy * dy));
          put(center + side * (43 + edge), deckY - 50 + dy, GLASS);
        }
      };
      auto stampMarsGarden = [&] {
        // Martian garden arcology: three overlapping greenhouse vaults carry
        // terraced hydroponics, hanging plants, irrigation, and warm grow lights.
        for (int pod : {-62, 0, 62}) {
          int radiusX = pod ? 41 : 52, radiusY = pod ? 34 : 46;
          for (int x = center + pod - radiusX; x <= center + pod + radiusX; x++) {
            double nx = (x - center - pod) / (double)radiusX;
            int roofY = deckY - (int)std::lround(std::sqrt(std::fmax(0.0, 1.0 - nx * nx)) * radiusY);
            if (L->isBackground) {
              rect(x, x, roofY, deckY - 2, GLASS);
              for (int y = deckY - 9; y > roofY + 3; y -= 9)
                put(x, y, (x + y) % 5 ? PLANT : GLOWBERRY);
            } else {
              put(x, roofY, GLASS);
              if (std::abs(x - center - pod) == radiusX) vline(x, roofY, deckY, BRICK);
            }
          }
          hline(center + pod - radiusX, center + pod + radiusX, deckY - 1, BRICK);
          for (int y = deckY - 10; y >= deckY - radiusY + 8; y -= 10) {
            hline(center + pod - radiusX + 8, center + pod - 8, y,
                  L->isBackground ? DIRT : GLASS);
            hline(center + pod + 8, center + pod + radiusX - 8, y,
                  L->isBackground ? DIRT : GLASS);
          }
        }
        for (int x = center - 88; x <= center + 88; x += 16)
          put(x, deckY - 14, LIGHT);
      };
      auto stampMarsRefinery = [&] {
        // Red Furnace refinery: paired cracking towers, pressure tanks, overhead
        // pipes, and a heat-exchanger hall create a dense industrial skyline.
        for (int side : {-1, 1}) {
          int tower = center + side * 48;
          int towerTop = deckY - (side < 0 ? 70 : 57);
          if (L->isBackground) rect(tower - 18, tower + 18, towerTop, deckY - 2, DEEPSTONE);
          for (int y = towerTop; y <= deckY - 2; y++) {
            int inset = (y - towerTop) < 8 ? 8 - (y - towerTop) : 0;
            if (!L->isBackground) {
              put(tower - 18 + inset, y, BRICK);
              put(tower + 18 - inset, y, BRICK);
            }
            if ((y - towerTop) % 12 == 0)
              hline(tower - 19 + inset, tower + 19 - inset, y, COPPER_ORE);
          }
          vline(tower, towerTop - 12, towerTop, IRON_ORE);
          put(tower, towerTop - 14, LIGHT);
        }
        hline(center - 82, center + 82, deckY - 33, COPPER_ORE);
        hline(center - 82, center + 82, deckY - 29, IRON_ORE);
        for (int x = center - 78; x <= center + 78; x += 13)
          vline(x, deckY - 32, deckY - 3, BRICK);
        if (L->isBackground) {
          for (int tank : {-78, -25, 25, 78}) {
            rect(center + tank - 12, center + tank + 12, deckY - 23, deckY - 3, CLAY);
            hline(center + tank - 9, center + tank + 9, deckY - 12, GOLD_ORE);
          }
        }
      };
      auto stampMarsSpaceport = [&] {
        // Canyon foundry: a stepped armored hangar surrounds a broad blast door,
        // side cranes, radar vanes, and a high command bridge.
        for (int step = 0; step < 5; step++) {
          int x0 = center - 91 + step * 12, x1 = center + 91 - step * 12;
          int y = deckY - 8 - step * 10;
          hline(x0, x1, y, step % 2 ? COPPER_ORE : BRICK);
          vline(x0, y, deckY - step * 2, BRICK);
          vline(x1, y, deckY - step * 2, BRICK);
          if (L->isBackground) rect(x0 + 2, x1 - 2, y + 1, deckY - step * 2, SANDSTONE);
        }
        int doorTop = deckY - 42;
        if (L->isBackground) rect(center - 31, center + 31, doorTop, deckY - 2, DEEPSTONE);
        hline(center - 31, center + 31, doorTop, IRON_ORE);
        vline(center - 31, doorTop, deckY, IRON_ORE);
        vline(center + 31, doorTop, deckY, IRON_ORE);
        for (int y = doorTop + 6; y < deckY; y += 7)
          hline(center - 29, center + 29, y, L->isBackground ? COPPER_ORE : GLASS);
        for (int side : {-1, 1}) {
          int crane = center + side * 78;
          vline(crane, deckY - 60, deckY - 2, IRON_ORE);
          hline(imin(crane, center + side * 36), imax(crane, center + side * 36),
                deckY - 60, GOLD_ORE);
          vline(center + side * 43, deckY - 59, deckY - 44, IRON_ORE);
        }
        hline(center - 36, center + 36, deckY - 53, GLASS);
        for (int x = center - 28; x <= center + 28; x += 14)
          put(x, deckY - 56, LIGHT);
      };
      switch (plan.kind) {
#define WORLDGEN_FACILITY_ARCHETYPE(symbol, id, name, mask, ordinal, width, depth, above, stamp) \
        case OFK_##symbol: stamp(); break;
#define WORLDGEN_RUIN_ARCHETYPE(...)
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
        case OFK_COUNT: assert(false && "invalid facility archetype"); break;
      }
      if (!L->isBackground) {
        // Keep one generous, continuous lift well from the surface apron through
        // every deck, regardless of which surface archetype crosses the center.
        rect(center - 6, center + 6, deckY - 14, facilityBottom - 3, EMPTY);
        vline(center - 7, deckY, facilityTop + 12, shell);
        vline(center + 7, deckY, facilityTop + 12, shell);
      }
    }
  }

  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd):
  // terrain, natural dressing, constructed structures, trees, then `L->next`.
