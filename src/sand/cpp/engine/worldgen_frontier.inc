  // Frontier's authored places share absolute coordinates with the procedural
  // landscape. Every band uses this same stamp, including predictive generation.
  static constexpr int FRONTIER_LEFT = -320, FRONTIER_RIGHT = 319;
  static constexpr int FRONTIER_TOP = -96, FRONTIER_BOTTOM = 191;

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

    // Aster Station: an observation deck, inhabited surface concourse, two
    // laboratory levels, and a deep engineering hall around an open atrium.
    rect(FRONTIER_LEFT, FRONTIER_TOP, FRONTIER_RIGHT, 15, EMPTY);
    rect(FRONTIER_LEFT, 16, FRONTIER_RIGHT, FRONTIER_BOTTOM, STONE);
    room(-294, -28, 294, 19);
    room(-238, -76, 208, -28);
    room(-278, 19, 278, 72);
    room(-260, 72, 260, 125);
    room(-228, 125, 228, 178);
    // A broad central shaft links every floor; staggered cantilever landings
    // give the jetpack time to recharge without sealing the vertical route.
    rect(-24, -68, 24, 175, bgLayer ? GLASS : EMPTY);
    if (bgLayer) {
      rect(-27, -72, -25, 178, IRON_ORE);
      rect(25, -72, 27, 178, IRON_ORE);
      for (int y = -56; y < 168; y += 24) {
        rect(-26, y, -25, y + 4, LIGHT);
        rect(25, y, 26, y + 4, LIGHT);
      }
    } else {
      for (int i = 0; i < 10; i++) {
        int y = -48 + i * 23;
        rect(i & 1 ? 9 : -27, y, i & 1 ? 27 : -9, y + 2, BRICK);
      }
      // Main arrival remains a walkable bridge through the atrium.
      rect(-24, 16, 24, 18, IRON_ORE);
      rect(-17, 19, 17, 175, EMPTY);
    }
    // Grounded service exits open directly into the wilderness on both sides.
    rect(-320, -4, -292, 15, bgLayer ? DEEPSTONE : EMPTY);
    rect(292, -4, 319, 15, bgLayer ? DEEPSTONE : EMPTY);
    // Roof terraces and antennas make the base readable across the valley.
    rect(-180, -84, -176, -77, IRON_ORE);
    rect(-198, -86, -158, -84, IRON_ORE);
    rect(147, -94, 150, -77, IRON_ORE);
    rect(145, -95, 152, -93, LIGHT);
    if (bgLayer) {
      // Command table, wall map, and equipment lockers on the surface deck.
      rect(-94, -13, -43, -2, DEEPSTONE);
      rect(-89, -12, -48, -5, CRYSTAL);
      rect(-90, 9, -42, 14, IRON_ORE);
      rect(-84, 6, -50, 8, LIGHT);
      for (int x = 116; x < 262; x += 22) {
        rect(x, -10, x + 15, 14, IRON_ORE);
        rect(x + 3, -6, x + 12, 7, COPPER_ORE);
        rect(x + 3, -8, x + 12, -7, LIGHT);
      }
      // Medbay beds, hydroponic planters, archive shelves, and a firing range.
      for (int x = -232; x < -55; x += 36) {
        rect(x, 60, x + 24, 67, PINE_WOOD);
        rect(x + 2, 57, x + 22, 59, GLASS);
        rect(x + 20, 54, x + 23, 57, LIGHT);
        rect(x, 105, x + 27, 120, PINE_WOOD);
        for (int y = 107; y < 119; y += 5) {
          rect(x + 2, y, x + 25, y + 2, COPPER_ORE);
          rect(x + 8, y, x + 10, y + 2, CRYSTAL);
        }
      }
      for (int x = 52; x < 235; x += 30) {
        rect(x, 63, x + 22, 68, BRICK);
        rect(x + 3, 60, x + 19, 62, DIRT);
        for (int stem = 4; stem < 20; stem += 5) {
          rect(x + stem, 49, x + stem + 1, 59, VINE);
          rect(x + stem - 1, 49, x + stem + 2, 51, MOSS);
        }
      }
      // Engineering turbines and a contained, luminous coolant circuit.
      for (int x : {-196, -144, 108, 160}) {
        rect(x, 139, x + 28, 172, IRON_ORE);
        rect(x + 4, 143, x + 24, 165, GLASS);
        rect(x + 10, 145, x + 18, 163, CRYSTAL);
        rect(x + 4, 169, x + 24, 170, LIGHT);
      }
      rect(80, 106, 210, 108, IRON_ORE);
      for (int x : {108, 154, 200}) {
        rect(x, 96, x + 5, 105, PINE_WOOD);
        rect(x - 2, 93, x + 7, 97, SANDSTONE);
      }
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
