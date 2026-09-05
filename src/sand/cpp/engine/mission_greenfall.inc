// A compact, destructible relay expedition. Coordinates are relative to the
// landing site's surface, and the authored cells enter ordinary chunk storage.
void MissionSystem::buildGreenfall(int centerX, int surfaceY) {
  int left = centerX - 132, right = centerX + 132;
  int top = surfaceY - 72, bottom = surfaceY + 158;
  for (Layer* layer : {&E.fg, &E.bg}) {
    Engine::ActiveLayerScope active(E, layer);
    auto put = [&](int wx, int wy, uint8_t material) {
      int x = wx - layer->worldOffsetX, y = wy - layer->worldOffsetY;
      if (x < 1 || x >= E.cols - 1 || y < 1 || y >= E.rows - 1) return;
      layer->grid[E.I(x, y)] = material;
    };
    auto rect = [&](int x0, int y0, int x1, int y1, uint8_t material) {
      for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++)
        put(centerX + x, surfaceY + y, material);
    };
    for (int wy = top; wy <= bottom; wy++) for (int wx = left; wx <= right; wx++) {
      uint8_t material = wy < surfaceY ? EMPTY : STONE;
      if (wx < centerX - 75 && wy >= surfaceY && wy < surfaceY + 3) material = DIRT;
      if (layer->isBackground && wy >= surfaceY + 5) material = DEEPSTONE;
      put(wx, wy, material);
    }
    // A terraced access gallery remains walkable in both directions. Its wide
    // shaft leaves room to jump, thrust, build, and change the route by mining.
    if (!layer->isBackground) {
      rect(-68, -4, -42, 48, EMPTY);
      rect(-68, 24, 72, 48, EMPTY);
      for (int x = -66; x <= 65; x++) {
        int floor = 4 + (x + 66) / 3;
        rect(x, floor - 24, x, floor - 1, EMPTY);
        rect(x, floor, x, floor + 3, BRICK);
      }
      rect(62, 24, 115, 94, EMPTY);
      for (int x = 65; x <= 112; x++) {
        int floor = 50 + (112 - x);
        rect(x, floor - 25, x, floor - 1, EMPTY);
        rect(x, floor, x, floor + 3, BRICK);
      }
      rect(-77, 91, 114, 126, EMPTY);
      rect(-78, 127, 116, 134, BRICK);
      // Authored sentry terraces keep encounter placement inside its own room.
      rect(-34, 7, -16, 18, EMPTY);
      rect(-34, 19, -16, 22, BRICK);
      rect(82, 59, 105, 76, EMPTY);
      rect(82, 77, 105, 80, BRICK);
      // The service shaft gives the return a direct ascent with rest ledges.
      rect(58, -4, 77, 126, EMPTY);
      rect(57, 72, 61, 74, IRON_ORE);
      rect(74, 30, 117, 32, IRON_ORE);
      // A thin mineral seam invites the mining tool, with open access above it.
      rect(18, 105, 23, 126, COPPER_ORE);
      rect(-76, 120, -71, 126, BRICK);
    } else {
      rect(-78, 18, 120, 135, BRICK);
      for (int x = -72; x < 118; x += 24) {
        rect(x, 23, x + 2, 125, IRON_ORE);
        rect(x + 4, 32, x + 17, 43, GLASS);
        rect(x + 4, 104, x + 17, 117, GLASS);
      }
      for (int x = -60; x < 100; x += 32) {
        rect(x, 23, x + 10, 24, LIGHT);
        rect(x, 93, x + 10, 94, LIGHT);
      }
      rect(57, -2, 58, 125, IRON_ORE);
      rect(77, -2, 78, 125, IRON_ORE);
      for (int y : {0, 30, 70, 108}) {
        rect(57, y, 59, y + 2, LIGHT);
        rect(76, y, 78, y + 2, LIGHT);
        for (int x = 0; x < 4; x++) {
          rect(64 + x, y + 10 - x, 64 + x, y + 10 - x, COPPER_ORE);
          rect(68 + x, y + 7 + x, 68 + x, y + 7 + x, COPPER_ORE);
        }
      }
      // Refuge bunks, medical cross, and seed archive.
      for (int x : {-70, -54, -38}) {
        rect(x, 120, x + 10, 124, PINE_WOOD);
        rect(x, 110, x + 1, 126, IRON_ORE);
        rect(x + 11, 110, x + 12, 126, IRON_ORE);
        rect(x + 2, 109, x + 10, 110, LIGHT);
        rect(x + 2, 112, x + 10, 125, GLASS);
      }
      rect(-54, 101, -52, 109, LIGHT);
      rect(-57, 104, -49, 106, LIGHT);
      rect(92, 100, 109, 125, IRON_ORE);
      rect(95, 103, 105, 119, CRYSTAL);
    }
    // Surface station and broken signal dish, with a clear foreground doorway.
    if (layer->isBackground) {
      rect(4, -30, 73, -1, BRICK);
      rect(10, -25, 64, -12, GLASS);
      rect(12, -7, 52, -5, IRON_ORE);
      rect(19, -11, 30, -8, CRYSTAL);
      rect(36, -10, 48, -8, LIGHT);
      rect(7, -29, 71, -28, IRON_ORE);
      rect(7, -3, 71, -2, IRON_ORE);
      rect(40, -52, 43, -29, IRON_ORE);
      for (int x = 22; x <= 63; x++) {
        int y = -54 + (x - 42) * (x - 42) / 38;
        rect(x, y, x, y + 2, IRON_ORE);
      }
      rect(40, -57, 43, -53, LIGHT);
      // Trees frame the landing and station without blocking the route.
      for (int x : {-124, -84, 119}) {
        rect(x, -40, x + 3, -1, OAK_WOOD);
        for (int branch = 0; branch < 12; branch++) {
          rect(x - branch, -30 - branch / 2, x + 2 - branch, -29 - branch / 2, OAK_WOOD);
          rect(x + branch, -35 - branch / 2, x + 2 + branch, -34 - branch / 2, OAK_WOOD);
        }
        for (int y = -57; y < -26; y++) for (int dx = -20; dx <= 22; dx++) {
          int leftCrown = (dx + 9) * (dx + 9) + (y + 37) * (y + 37);
          int highCrown = dx * dx + (y + 46) * (y + 46);
          int rightCrown = (dx - 11) * (dx - 11) + (y + 40) * (y + 40);
          int fringe = (dx * dx + y * y + x * x) % 13;
          if (leftCrown < 113 + fringe || highCrown < 121 + fringe || rightCrown < 109 + fringe)
            rect(x + dx, y, x + dx, y, OAK_LEAF);
        }
        rect(x - 3, -1, x + 6, -1, MOSS);
      }
      for (int x : {8, 13, 59, 64, 69})
        rect(x, -29, x, -19 + x % 7, VINE);
      rect(-117, -2, -93, -1, LIGHT);
      rect(-118, -17, -116, -2, IRON_ORE);
      rect(-94, -17, -92, -2, IRON_ORE);
      rect(-119, -19, -115, -17, LIGHT);
      rect(-95, -19, -91, -17, LIGHT);
    } else {
      rect(2, -32, 76, -30, BRICK);
      rect(4, -29, 6, -1, BRICK);
      rect(72, -29, 74, -1, BRICK);
      rect(4, -16, 6, -1, EMPTY);
      rect(72, -16, 74, -1, EMPTY);
    }
    // Initial mission authoring replaces the component registry before any
    // mission tick; every surviving and authored solid is registered together.
    layer->components.clear();
    layer->prevCompCells.clear();
    E.comps.registerSeededComponents(0, E.cols);
    E.markAllDirty();
    E.noteLooseDirtyFull();
  }
  E.comps.jointDirty = true;
  E.comps.jointGroundReady = false;
  E.comps.computeGroundedBoth();
  Player* player = E.psys.findPlayer(playerId);
  extractionX = centerX - 105;
  extractionY = surfaceY - 6;
  player->px = extractionX - E.fg.worldOffsetX - player->w * .5;
  player->py = surfaceY - E.fg.worldOffsetY - player->h;
  player->vx = player->vy = 0;
  player->spawnWorldX = extractionX;
  player->spawnWorldY = surfaceY - player->h;

  addObjective(OK_ANCHOR, OS_ACTIVE, 1, centerX + 100, surfaceY + 127,
               MISSION_FLAG_PRIMARY_MARKER);
  addObjective(OK_RESCUE, OS_LOCKED, 3, centerX - 48, surfaceY + 127,
               MISSION_FLAG_PRIMARY_MARKER);
  addObjective(OK_EXTRACT, OS_LOCKED, 1, extractionX, extractionY,
               MISSION_FLAG_PRIMARY_MARKER | MISSION_FLAG_EXTRACTION);
  int jammer = spawnMissionCreature(CS_SHIELD_ANCHOR, centerX + 100,
                                    surfaceY + 127, 0);
  objectives[0].targetActorId = jammer;
  bool placed = jammer != 0;
  for (int x : {-64, -48, -32}) {
    int id = spawnMissionCreature(CS_SURVEYOR, centerX + x, surfaceY + 127, 1);
    placed &= id != 0;
    if (Creature* creature = findCreature(id)) creature->shelterCharge = 1;
  }
  const std::array<std::array<int, 3>, 3> guards{{
    {{CS_DYNAMITEER, -25, 19}}, {{CS_MINIGUNNER, 94, 77}},
    {{CS_BORE_SENTINEL, -5, 127}},
  }};
  for (const auto& guard : guards) {
    int id = spawnMissionCreature((uint8_t)guard[0], centerX + guard[1],
                                  surfaceY + guard[2], -1);
    placed &= id != 0;
    if (Creature* creature = findCreature(id)) creature->attackCooldown = 180;
  }
  if (!placed) { fail(); return; }
  refreshObjectiveMarker(objectives[0]);
}
