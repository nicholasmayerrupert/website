  // Frontier's authored places share absolute coordinates with the procedural
  // landscape. Every band uses this same stamp, including predictive generation.

  void fillFrontier(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (planetId == PL_FRONTIER) content.stamp(colStart, colEnd, rowStart, rowEnd);
  }

  bool repairFrontierBase(int playerId) {
    if (planetId != PL_FRONTIER) return false;
    Player* player = psys.findPlayer(playerId);
    if (!player || !player->alive) return false;
    double wx = fg.worldOffsetX + player->px, wy = fg.worldOffsetY + player->py;
    // Osei's maintenance radio also works within the station if rubble blocks
    // the route to the workshop.
    if (wx < content.repairBounds[0] || wx > content.repairBounds[2]
        || wy < content.repairBounds[1] || wy > content.repairBounds[3]) return false;
    for (Layer* layer : {&fg, &bg}) {
      ActiveLayerScope active(*this, layer);
      int x0 = imax(0, content.repairBounds[0] - L->worldOffsetX);
      int x1 = imin(cols, content.repairBounds[2] + 1 - L->worldOffsetX);
      int y0 = imax(0, content.repairBounds[1] - L->worldOffsetY);
      int y1 = imin(rows, content.repairBounds[3] + 1 - L->worldOffsetY);
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
      for (int ty = floorDiv(content.repairBounds[1], CHUNK_SIZE); ty <= floorDiv(content.repairBounds[3], CHUNK_SIZE); ty++)
        for (int tx = floorDiv(content.repairBounds[0], CHUNK_SIZE); tx <= floorDiv(content.repairBounds[2], CHUNK_SIZE); tx++) {
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
      return x >= content.repairBounds[0] && x <= content.repairBounds[2] && y >= content.repairBounds[1] && y <= content.repairBounds[3];
    }), shots.end());
    double spawn[2];
    if (psys.findSafeSpawnNearWorld(content.spawn[0], content.spawn[1], spawn, player)) {
      player->px = spawn[0]; player->py = spawn[1];
    }
    for (Creature& resident : creatures.creatures) {
      if (!resident.alive || !CREATURE_SPECIES[resident.species].humanNpc ||
          resident.wx < content.repairBounds[0] || resident.wx > content.repairBounds[2] ||
          resident.wy < content.repairBounds[1] || resident.wy > content.repairBounds[3]) continue;
      double x, y;
      if (creatures.findGroundSpawn(resident.species, resident.wx, resident.wy, x, y, 32, 48, &resident)) {
        resident.wx = x; resident.wy = y; resident.vx = resident.vy = 0;
      }
    }
    player->vx = player->vy = 0;
    return true;
  }
