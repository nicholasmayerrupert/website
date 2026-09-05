  // Frontier's authored places share absolute coordinates with the procedural
  // landscape. Every band uses this same stamp, including predictive generation.
  static constexpr int FRONTIER_LEFT = -320, FRONTIER_RIGHT = 319;
  static constexpr int FRONTIER_TOP = -160, FRONTIER_BOTTOM = 191;

  void fillFrontier(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (planetId != PL_FRONTIER) return;
    bool bgLayer = L->isBackground;
    auto rect = [&](int x0, int y0, int x1, int y1, uint8_t mat) {
      int left = imax(colStart, x0 - L->worldOffsetX);
      int right = imin(colEnd - 1, x1 - L->worldOffsetX);
      int top = imax(rowStart, y0 - L->worldOffsetY);
      int bottom = imin(rowEnd - 1, y1 - L->worldOffsetY);
      for (int y = top; y <= bottom; y++) for (int x = left; x <= right; x++)
        L->grid[I(x, y)] = mat;
    };
    auto room = [&](int left, int top, int right, int bottom) {
      rect(left, top, right, bottom, bgLayer ? BRICK : EMPTY);
      if (!bgLayer) {
        rect(left, top, right, top + 2, DEEPSTONE);
        rect(left, bottom - 2, right, bottom, DEEPSTONE);
        rect(left, top, left + 2, bottom, DEEPSTONE);
        rect(right - 2, top, right, bottom, DEEPSTONE);
        rect(left, bottom - 22, left + 2, bottom - 3, EMPTY);
        rect(right - 2, bottom - 22, right, bottom - 3, EMPTY);
      } else {
        rect(left + 4, top + 4, right - 4, top + 5, IRON_ORE);
        for (int x = left + 10; x < right - 12; x += 32) {
          rect(x, top + 8, x + 16, bottom - 16, GLASS);
          rect(x, top + 6, x + 12, top + 7, LIGHT);
        }
      }
    };

    // The station is a cluster of beveled modules anchored to a shared
    // foundation. Background furnishings leave foreground circulation clear.
    rect(FRONTIER_LEFT, FRONTIER_TOP, FRONTIER_RIGHT, 15, EMPTY);
    rect(FRONTIER_LEFT, 16, FRONTIER_RIGHT, FRONTIER_BOTTOM, STONE);
    auto module = [&](int left, int top, int right, int floor, uint8_t wall) {
      for (int y = top; y <= floor; y++) {
        int bevel = imax(0, 8 - imin(y - top, floor - y));
        rect(left + bevel, y, right - bevel, y, bgLayer ? wall : IRON_ORE);
        if (y > top + 2 && y < floor - 2)
          rect(left + bevel + 3, y, right - bevel - 3, y, bgLayer ? wall : EMPTY);
      }
      if (bgLayer) {
        rect(left + 10, floor - 9, right - 10, floor - 4, PINE_WOOD);
        for (int x = left + 12; x < right - 12; x += 24)
          rect(x, top + 9, x + 1, floor - 4, IRON_ORE);
        rect(left + 10, top + 5, right - 10, top + 6, IRON_ORE);
        rect(left + 14, top + 7, right - 14, top + 7, LIGHT);
      } else {
        rect(left + 8, top, right - 8, top + 1, SANDSTONE);
        rect(left + 8, floor - 2, right - 8, floor - 1, SANDSTONE);
        // Full-height doorways connect the modules at floor level.
        rect(left, floor - 23, left + 10, floor - 3, EMPTY);
        rect(right - 10, floor - 23, right, floor - 3, EMPTY);
      }
    };
    auto window = [&](int left, int top, int right, int bottom) {
      if (!bgLayer) return;
      rect(left + 2, top, right - 2, bottom, IRON_ORE);
      rect(left, top + 2, right, bottom - 2, IRON_ORE);
      rect(left + 3, top + 3, right - 3, bottom - 3, GLASS);
      rect(left + 4, top + 3, right - 4, top + 3, LIGHT);
      for (int x = left + 17; x < right - 4; x += 18)
        rect(x, top + 2, x + 1, bottom - 2, IRON_ORE);
    };
    auto console = [&](int x, int floor, int width) {
      if (!bgLayer) return;
      rect(x + 2, floor - 15, x + width - 2, floor - 7, IRON_ORE);
      rect(x + 4, floor - 13, x + width - 4, floor - 9, CRYSTAL);
      rect(x, floor - 6, x + width, floor - 4, SANDSTONE);
      rect(x + 3, floor - 3, x + 5, floor, IRON_ORE);
      rect(x + width - 5, floor - 3, x + width - 3, floor, IRON_ORE);
      rect(x + 4, floor - 5, x + 8, floor - 5, LIGHT);
    };
    auto crate = [&](int x, int floor, int width) {
      if (!bgLayer) return;
      rect(x, floor - width, x + width, floor, PINE_WOOD);
      rect(x + 2, floor - width + 2, x + width - 2, floor - 2, COPPER_ORE);
      rect(x + width / 2, floor - width + 1, x + width / 2 + 1, floor - 1, IRON_ORE);
      rect(x + 2, floor - width / 2, x + width - 2, floor - width / 2, IRON_ORE);
    };
    auto bed = [&](int x, int floor) {
      if (!bgLayer) return;
      rect(x, floor - 7, x + 24, floor - 4, PINE_WOOD);
      rect(x + 1, floor - 10, x + 23, floor - 8, GLASS);
      rect(x + 2, floor - 11, x + 7, floor - 9, SANDSTONE);
      rect(x + 2, floor - 3, x + 4, floor, IRON_ORE);
      rect(x + 20, floor - 3, x + 22, floor, IRON_ORE);
    };
    // Surface: cargo porch, command, workshop, and a raised glass conservatory.
    module(-302, -18, -172, 19, DEEPSTONE);
    module(-172, -43, -28, 19, STONE);
    module(28, -31, 164, 19, DEEPSTONE);
    module(164, -59, 298, 19, GLASS);
    // A narrow tower and an offset bunkhouse break up the roofline.
    module(-24, -112, 30, -37, DEEPSTONE);
    module(-40, -139, 46, -97, STONE);
    module(-160, -97, -30, -37, STONE);
    module(-38, -64, 104, -21, DEEPSTONE);
    window(-146, -83, -111, -58);
    window(-95, -83, -47, -58);
    window(-20, -125, 28, -101);
    window(-25, -53, 89, -29);
    window(-158, -31, -115, -7);
    window(-106, -31, -45, -7);
    // Underground rooms have separate footprints and exposed rock between wings.
    module(-218, 26, -30, 75, STONE);
    module(30, 33, 204, 75, DEEPSTONE);
    module(-184, 84, -30, 128, DEEPSTONE);
    module(30, 86, 250, 128, STONE);
    module(-228, 138, -30, 181, DEEPSTONE);
    module(30, 137, 174, 181, DEEPSTONE);

    // A framed stairwell gives access to every deck. Each landing leaves a
    // central opening and overlaps its neighboring room's floor edge.
    rect(-25, -97, 25, 177, bgLayer ? DEEPSTONE : EMPTY);
    if (bgLayer) {
      rect(-27, -97, -25, 181, IRON_ORE);
      rect(25, -97, 27, 181, IRON_ORE);
      rect(-4, -96, 4, 175, STONE);
      for (int y = -89; y < 177; y += 18) {
        rect(-2, y, 2, y + 1, IRON_ORE);
        rect(-24, y, -23, y + 3, LIGHT);
      }
    } else {
      for (int i = 0; i < 14; i++) {
        int y = -85 + i * 20;
        rect(i & 1 ? 8 : -28, y, i & 1 ? 28 : -8, y + 2, IRON_ORE);
      }
      // The entry floor stays continuous; side hatches lead downstairs.
      rect(-320, 16, 319, 18, DEEPSTONE);
      rect(-310, 16, 310, 16, SANDSTONE);
      rect(-24, 17, 24, 18, IRON_ORE);
      rect(-24, 19, 24, 27, EMPTY);
      rect(-10, -104, 10, -93, EMPTY);
      rect(-237, 0, -223, 69, EMPTY);
      rect(-237, 51, -206, 69, EMPTY);
      rect(209, 0, 223, 69, EMPTY);
      rect(192, 51, 223, 69, EMPTY);
    }
    rect(-320, -6, -299, 15, bgLayer ? DEEPSTONE : EMPTY);
    rect(295, -6, 319, 15, bgLayer ? DEEPSTONE : EMPTY);

    // Conservatory ribs follow a stepped dome rather than a flat box roof.
    for (int x = 166; x <= 296; x++) {
      int roof = -59 + (int)(pow(std::abs(x - 231) / 65.0, 2) * 24);
      rect(x, -62, x, roof - 1, EMPTY);
      rect(x, roof, x, roof + 2, IRON_ORE);
      if (bgLayer) {
        rect(x, roof + 3, x, -1, GLASS);
        if ((x - 166) % 26 < 2) rect(x, roof + 3, x, 12, IRON_ORE);
      }
    }
    // Covered cargo approach, rooftop solar banks, aerial, and exhaust stacks.
    for (int x = -300; x <= -184; x++) {
      int roof = -26 + imax(0, -x - 266) / 3;
      rect(x, roof, x, roof + 2, IRON_ORE);
    }
    if (bgLayer) {
      rect(-289, -17, -287, 15, IRON_ORE);
      rect(-188, -24, -186, 15, IRON_ORE);
      rect(-287, -13, -287, -8, LIGHT);
      rect(-267, -21, -235, -20, LIGHT);
    }
    for (int x = -148; x <= -72; x += 38) {
      rect(x + 12, -110, x + 14, -97, IRON_ORE);
      for (int xx = 0; xx < 32; xx++) {
        int y = -111 + xx / 8;
        rect(x + xx, y, x + xx, y + 2, IRON_ORE);
        if (bgLayer && xx % 8 > 0) rect(x + xx, y, x + xx, y, CRYSTAL);
      }
    }
    rect(3, -156, 5, -140, IRON_ORE);
    rect(-9, -152, 17, -151, IRON_ORE);
    rect(2, -158, 6, -156, LIGHT);
    rect(119, -50, 126, -32, IRON_ORE);
    rect(134, -44, 140, -32, IRON_ORE);
    rect(117, -52, 128, -50, DEEPSTONE);
    rect(132, -46, 142, -44, DEEPSTONE);

    if (bgLayer) {
      // Cargo pallets and a suspended hoist under the western canopy.
      rect(-274, 12, -225, 14, PINE_WOOD);
      crate(-272, 11, 16); crate(-251, 11, 20); crate(-264, -6, 13);
      rect(-215, -15, -214, 0, IRON_ORE);
      rect(-218, -1, -211, 1, IRON_ORE);
      // Command: a recessed chart, consoles and a low bench.
      rect(-99, -26, -47, -9, IRON_ORE);
      rect(-96, -23, -50, -12, DEEPSTONE);
      for (int x = -92; x < -53; x += 3) {
        int y = -15 - (int)(std::sin(x * .22) * 4);
        rect(x, y, x + 1, y, CRYSTAL);
      }
      console(-90, 14, 37);
      rect(-145, 5, -112, 9, PINE_WOOD);
      rect(-141, 10, -139, 14, IRON_ORE);
      rect(-118, 10, -116, 14, IRON_ORE);
      // Workshop: pegboard, tools, bench vise, storage and a fabrication press.
      rect(57, -19, 105, -4, PINE_WOOD);
      for (int x = 63; x < 101; x += 10) {
        rect(x, -15, x + 1, -7, IRON_ORE);
        rect(x - 2, -16, x + 3, -14, SANDSTONE);
      }
      rect(57, -24, 106, -22, IRON_ORE);
      rect(60, -22, 103, -22, LIGHT);
      rect(53, 5, 113, 7, SANDSTONE);
      for (int x : {56, 106}) rect(x, 8, x + 3, 14, IRON_ORE);
      rect(96, -2, 103, 4, IRON_ORE);
      rect(120, -14, 145, 14, IRON_ORE);
      rect(125, -8, 140, 6, DEEPSTONE);
      rect(128, -5, 137, -4, LIGHT);
      crate(151, 14, 9);
      // Beds have pillows, frames and individual reading lights.
      bed(-146, -41); bed(-107, -41); bed(-67, -41);
      for (int x : {-143, -104, -64}) rect(x, -64, x + 3, -63, LIGHT);
      console(-15, -100, 30);
      // Hydroponics: irrigated beds with three different crop heights.
      for (int x = 182; x < 280; x += 31) {
        rect(x, 8, x + 23, 14, IRON_ORE);
        rect(x + 2, 7, x + 21, 9, DIRT);
        for (int i = 0; i < 3; i++) {
          int stem = x + 5 + i * 6, top = -3 - i * 4;
          rect(stem, top, stem, 6, PINE_WOOD);
          rect(stem - 2, top, stem + 2, top + 2, MOSS);
          rect(stem - 3, top + 5, stem + 3, top + 6, MOSS);
        }
      }
      rect(179, 4, 285, 5, COPPER_ORE);
      // Medbay: isolated beds, wall monitors, cabinet and a cross inset.
      for (int x : {-194, -147, -100}) {
        bed(x, 70); console(x + 26, 70, 13);
        window(x, 41, x + 20, 52);
      }
      rect(-205, 34, -198, 36, GLASS);
      rect(-203, 32, -201, 38, GLASS);
      // Mess hall: tables, stools, wall cupboards and a cooker.
      for (int x : {63, 119}) {
        rect(x, 61, x + 28, 63, PINE_WOOD);
        rect(x + 12, 64, x + 15, 70, IRON_ORE);
        for (int side : {-7, 34}) {
          rect(x + side, 64, x + side + 7, 66, PINE_WOOD);
          rect(x + side + 3, 67, x + side + 4, 70, IRON_ORE);
        }
      }
      rect(165, 50, 189, 70, IRON_ORE);
      rect(169, 54, 185, 64, DEEPSTONE);
      rect(168, 48, 175, 49, COPPER_ORE);
      window(62, 44, 150, 54);
      // Research: racks, specimen cases and a microscope bench.
      for (int x : {-162, -133}) {
        rect(x, 96, x + 20, 123, PINE_WOOD);
        for (int y = 99; y < 122; y += 8) {
          rect(x + 2, y, x + 18, y + 3, SANDSTONE);
          rect(x + 6, y, x + 8, y + 3, COPPER_ORE);
        }
      }
      console(-92, 123, 34);
      rect(-80, 100, -77, 111, IRON_ORE);
      rect(-81, 99, -71, 101, GLASS);
      // The range has a perforated backstop and three circular targets.
      rect(215, 96, 236, 122, IRON_ORE);
      for (int y = 98; y < 121; y += 4)
        rect(218, y, 233, y + 1, DEEPSTONE);
      for (int x : {120, 155, 190}) {
        rect(x, 110, x + 2, 122, PINE_WOOD);
        for (int y = -6; y <= 6; y++) {
          int radius = (int)std::sqrt(36.0 - y * y);
          rect(x + 1 - radius, 105 + y, x + 1 + radius, 105 + y, SANDSTONE);
        }
        rect(x, 103, x + 2, 107, COPPER_ORE);
      }
      crate(52, 123, 18); crate(75, 123, 13);
      // Engineering uses thick pipes, ribbed generators and service gauges.
      rect(-204, 148, -52, 151, COPPER_ORE);
      for (int x : {-191, -143, -95}) {
        rect(x, 153, x + 28, 176, IRON_ORE);
        for (int dx = 4; dx <= 24; dx += 5)
          rect(x + dx, 157, x + dx + 1, 172, DEEPSTONE);
        rect(x + 10, 154, x + 18, 155, LIGHT);
        rect(x + 12, 150, x + 15, 153, COPPER_ORE);
      }
      for (int x : {57, 100, 143}) {
        rect(x, 149, x + 17, 174, IRON_ORE);
        rect(x + 3, 152, x + 14, 171, GLASS);
        rect(x + 5, 164, x + 12, 171, CRYSTAL);
        rect(x + 7, 143, x + 10, 149, COPPER_ORE);
      }
      rect(63, 141, 153, 144, COPPER_ORE);
      // Local lights are small fixtures; the wall surfaces remain readable.
      for (auto light : {std::pair<int,int>{-162,-38}, {46,-26}, {-210,31},
                         {40,38}, {-173,89}, {40,91}, {-212,143}, {40,142}})
        rect(light.first, light.second, light.first + 8, light.second + 1, LIGHT);
    }

    // An accessible service adit winds from engineering into the cave system.
    for (int x = -452; x <= -210; x++) {
      int floor = 177 + imax(0, -x - 238) / 2;
      rect(x, floor - 26, x, floor + 3, bgLayer ? DEEPSTONE : EMPTY);
      if (!bgLayer) rect(x, floor, x, floor + 3, STONE);
      else if (x % 36 == 0) rect(x, floor - 24, x + 5, floor - 23, LIGHT);
    }
    // The drowned archive sits over a dry karst sump. Its floor and walls are
    // physical: the player can excavate a drain in any direction.
    room(-604, 274, -380, 399);
    rect(-590, 308, -394, 395, bgLayer ? DEEPSTONE : WATER);
    rect(-442, 258, -416, 310, bgLayer ? BRICK : EMPTY);
    rect(-580, 407, -392, 473, bgLayer ? STONE : EMPTY);
    if (bgLayer) {
      for (int x = -578; x < -406; x += 28) {
        rect(x, 321, x + 17, 387, PINE_WOOD);
        for (int y = 327; y < 388; y += 12)
          rect(x + 2, y, x + 15, y + 5, COPPER_ORE);
      }
      rect(-492, 374, -468, 390, CRYSTAL);
      rect(-487, 379, -473, 386, LIGHT);
    }

    // A collapsed railway pass west of the base hides a geological instrument.
    int passY = terrain.genSurfaceAbs(-790) + 36;
    room(-906, passY - 48, -658, passY + 5);
    rect(-910, passY - 22, -654, passY + 1, bgLayer ? DEEPSTONE : EMPTY);
    if (!bgLayer) {
      rect(-808, passY - 45, -792, passY + 1, STONE);
      rect(-834, passY - 8, -811, passY + 1, SANDSTONE);
      rect(-906, passY + 2, -658, passY + 5, IRON_ORE);
    } else {
      for (int x = -894; x < -666; x += 36) {
        rect(x, passY - 44, x + 3, passY + 1, PINE_WOOD);
        rect(x, passY - 45, x + 22, passY - 43, PINE_WOOD);
      }
      rect(-870, passY - 13, -850, passY - 2, CRYSTAL);
      rect(-866, passY - 10, -854, passY - 8, LIGHT);
    }
    // Open hillside approach avoids burying the pass behind a second rock wall.
    for (int x = -672; x <= -580; x++) {
      int floor = passY + 2 - (x + 672) / 2;
      rect(x, floor - 24, x, floor - 1, bgLayer ? STONE : EMPTY);
    }

    // Windward Observatory crowns a real mountain. Its tower creates a climb
    // with intermediate landings for the jetpack to recharge.
    int peak = terrain.genSurfaceAbs(900);
    room(850, peak - 78, 950, peak + 3);
    rect(845, peak - 20, 955, peak, bgLayer ? GLASS : EMPTY);
    room(878, peak - 143, 924, peak - 78);
    rect(887, peak - 134, 913, peak - 2, bgLayer ? GLASS : EMPTY);
    for (int i = 0; i < 6; i++) {
      int y = peak - 17 - i * 21;
      if (!bgLayer) rect(i & 1 ? 908 : 878, y, i & 1 ? 925 : 894, y + 2, IRON_ORE);
      else rect(880, y - 8, 884, y - 7, LIGHT);
    }
    rect(898, peak - 173, 901, peak - 144, IRON_ORE);
    rect(882, peak - 163, 917, peak - 161, IRON_ORE);
    rect(896, peak - 174, 903, peak - 171, LIGHT);
    if (bgLayer) rect(896, peak - 135, 905, peak - 128, LIGHT);
  }

  bool repairFrontierBase(int playerId) {
    if (planetId != PL_FRONTIER) return false;
    Player* player = psys.findPlayer(playerId);
    if (!player || !player->alive) return false;
    double wx = fg.worldOffsetX + player->px, wy = fg.worldOffsetY + player->py;
    // Osei's maintenance radio also works within the station if rubble blocks
    // the route to the workshop.
    if (wx < FRONTIER_LEFT || wx > FRONTIER_RIGHT
        || wy < FRONTIER_TOP || wy > FRONTIER_BOTTOM) return false;
    for (Layer* layer : {&fg, &bg}) {
      ActiveLayerScope active(*this, layer);
      int x0 = imax(0, FRONTIER_LEFT - L->worldOffsetX);
      int x1 = imin(cols, FRONTIER_RIGHT + 1 - L->worldOffsetX);
      int y0 = imax(0, FRONTIER_TOP - L->worldOffsetY);
      int y1 = imin(rows, FRONTIER_BOTTOM + 1 - L->worldOffsetY);
      std::vector<uint8_t> original((size_t)imax(0, x1 - x0) * imax(0, y1 - y0));
      size_t i = 0;
      for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++)
        original[i++] = L->grid[I(x, y)];
      fillFrontier(x0, x1, y0, y1);
      std::vector<uint8_t> restored(original.size());
      i = 0;
      for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
        restored[i] = L->grid[I(x, y)];
        L->grid[I(x, y)] = original[i++];
      }
      for (auto it = L->pendingDetonations.begin(); it != L->pendingDetonations.end();) {
        int x = it->first % cols, y = it->first / cols;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) it = L->pendingDetonations.erase(it);
        else ++it;
      }
      std::vector<int> removed;
      {
        CellMutationBatch clear(*this, removed);
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) clear.erase(I(x, y));
        clear.commitGeneral();
      }
      {
        CellMutationBatch rebuild(*this, removed);
        i = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++)
          rebuild.replaceAuto(I(x, y), restored[i++]);
        rebuild.commitGeneral();
      }
      for (int ty = floorDiv(FRONTIER_TOP, CHUNK_SIZE); ty <= floorDiv(FRONTIER_BOTTOM, CHUNK_SIZE); ty++)
        for (int tx = floorDiv(FRONTIER_LEFT, CHUNK_SIZE); tx <= floorDiv(FRONTIER_RIGHT, CHUNK_SIZE); tx++) {
          int64_t key = tileKey(tx, ty);
          L->tileStore.erase(key);
          L->prefetchStore.erase(key);
          L->fuseStore.erase(key);
          eraseStoredComponentTile(key);
#define SAND_RESET_BASE_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) L->store.erase(key);
          SAND_PERSISTENT_CELL_CHANNELS(SAND_RESET_BASE_CHANNEL)
#undef SAND_RESET_BASE_CHANNEL
          auto bodies = L->bodyStore.find(key);
          if (bodies != L->bodyStore.end()) {
            for (auto& stored : bodies->second) delete stored.first;
            L->bodyStore.erase(bodies);
          }
        }
      markAllDirty();
      noteLooseDirtyFull();
    }
    auto& shots = projectiles.projectiles;
    shots.erase(std::remove_if(shots.begin(), shots.end(), [&](const Projectile& shot) {
      double x = fg.worldOffsetX + shot.px, y = fg.worldOffsetY + shot.py;
      return x >= FRONTIER_LEFT && x <= FRONTIER_RIGHT && y >= FRONTIER_TOP && y <= FRONTIER_BOTTOM;
    }), shots.end());
    player->px = -fg.worldOffsetX;
    player->py = 16 - player->h - fg.worldOffsetY;
    player->vx = player->vy = 0;
    return true;
  }
