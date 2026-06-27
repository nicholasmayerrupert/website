  // Material reactions.
  //
  // Runs after growth/rigid movement inside each layer step. This file owns
  // local transformations such as water/fire steam, ignition, freezing/melting,
  // acid erosion, and lava cooling. It should not own broad movement order.
  void applyReactions() {
    int steamCount = 0, fireCount = 0, igniteCount = 0; bool plantBurned = false;
    int igniteCap = cols * rows;
    for (int y = 1; y < rows; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != WATER) continue;
        int nk = grid[k + 1] == FIRE ? k + 1 : (grid[k - 1] == FIRE ? k - 1 : -1);
        if (nk < 0 && y < rows - 1 && grid[k + cols] == FIRE) nk = k + cols;
        if (nk < 0 && grid[k - cols] == FIRE) nk = k - cols;
        if (nk >= 0) { reactionSteam[steamCount++] = k; if (!reactionFlags[nk]) { reactionFlags[nk] = 1; reactionFires[fireCount++] = nk; } }
      }
    }
    for (int y = 1; y < rows; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != FIRE || reactionFlags[k]) continue;
        int neigh[4]; int nn; if (y < rows - 1) { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k + cols; neigh[3] = k - cols; nn = 4; } else { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k - cols; nn = 3; }
        for (int ni = 0; ni < nn; ni++) {
          int nk = neigh[ni];
          if (grid[nk] == OIL) {
            if (rand() > OIL_IGNITE_P) continue;
            if (igniteCount < igniteCap) reactionIgnite[igniteCount++] = nk;
            if (rand() < FIRE_SPREAD_P) {
              int oilY = nk / cols; int on[4]; int onn; if (oilY < rows - 1) { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk + cols; on[3] = nk - cols; onn = 4; } else { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk - cols; onn = 3; }
              for (int oi = 0; oi < onn; oi++) { int ok = on[oi]; if (grid[ok] == OIL && rand() < 0.12 && igniteCount < igniteCap) reactionIgnite[igniteCount++] = ok; }
            }
          } else if (isPlantMaterial(grid[nk]) && rand() < PLANT_IGNITE_P) { if (igniteCount < igniteCap) reactionIgnite[igniteCount++] = nk; }
        }
      }
    }
    for (int i = 0; i < fireCount; i++) { int k = reactionFires[i]; if (grid[k] == FIRE) writeGridIndex(k, EMPTY); reactionFlags[k] = 0; }
    for (int i = 0; i < steamCount; i++) { int k = reactionSteam[i]; if (grid[k] == WATER) writeGridIndex(k, STEAM); }
    for (int i = 0; i < igniteCount; i++) { int k = reactionIgnite[i]; if (grid[k] == OIL || isPlantMaterial(grid[k])) { plantBurned = plantBurned || isPlantMaterial(grid[k]); writeGridIndex(k, FIRE); } }
    if (plantBurned) splitPlantAfterErase();
  }
  void applyAcid() {
    bool dissolvedStone = false, dissolvedIce = false, dissolvedPlant = false;
    std::vector<int>& erasedStone = acidErasedStone; std::vector<int>& erasedIce = acidErasedIce;
    erasedStone.clear(); erasedIce.clear();
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != ACID) continue;
        int right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        if (!isDissolvable(grid[right]) && !isDissolvable(grid[left]) && !isDissolvable(grid[down]) && !isDissolvable(grid[up])) continue;
        // Acid touching dissolvable material is actively boring: keep it in the active
        // band so it keeps eating on later steps. Without this, a failed dissolve roll
        // lets settleLiquid see the enclosed acid as resting-on-support and go inert,
        // dropping it out of the band forever — it freezes mid-solid after eating only
        // a little (acid "settles in stone"). Re-marking ends naturally once no
        // dissolvable neighbour remains or the acid decays.
        markCellIndex(k);
        if (rand() >= ACID_DISSOLVE_P) continue;
        bool hf = rand() < 0.5; int a = hf ? right : down, b = hf ? left : up, c = hf ? down : right, d = hf ? up : left;
        int target = -1;
        if (isDissolvable(grid[a])) target = a; else if (isDissolvable(grid[b])) target = b; else if (isDissolvable(grid[c])) target = c; else if (isDissolvable(grid[d])) target = d;
        if (target < 0) continue;
        uint8_t tm = grid[target];
        if (isStoneComp(tm)) { erasedStone.push_back(target); dissolvedStone = true; } else if (isIceComp(tm)) { erasedIce.push_back(target); dissolvedIce = true; } else if (isPlantMaterial(tm)) dissolvedPlant = true;
        // Dissolving releases acrid smoke (a yellow gas that rises/dissipates like
        // steam) from the dissolved cell ~half the time; otherwise it leaves space.
        if (rand() < ACRID_SMOKE_P) { writeGridIndex(target, ACRID_SMOKE); markCellIndex(target); }
        else writeGridIndex(target, EMPTY);
        if (rand() < ACID_DECAY_P) writeGridIndex(k, EMPTY);
      }
    }
    // Pass markGroundDirty=false and decide grounding ourselves: a dissolve that
    // doesn't disconnect anything (the common case of acid boring through bulk
    // stone) keeps the grounding cache valid and skips the full-grid reflood that
    // otherwise dominates the cost. removalsKeepGroundingValid patches the removed
    // cells when safe; any disconnect / seed / powder case forces a reflood.
    L->compsReshaped = false; // splitRigidAfterErase sets this if the comp SET changes
    if (dissolvedStone) splitRigidAfterErase(L->stoneComponents, erasedStone, L->nextStoneId, false, false);
    if (dissolvedIce) splitRigidAfterErase(L->iceComponents, erasedIce, L->nextIceId, true, false);
    if (dissolvedPlant) splitPlantAfterErase(); // sets groundDirty (plant grounding nuance)
    if (dissolvedStone || dissolvedIce) {
      cgRemovedCells.clear();
      cgRemovedCells.insert(cgRemovedCells.end(), erasedStone.begin(), erasedStone.end());
      cgRemovedCells.insert(cgRemovedCells.end(), erasedIce.begin(), erasedIce.end());
      if (!removalsKeepGroundingValid(cgRemovedCells)) {
        L->groundDirty = true; // a real disconnect -> full reflood
      } else if (L->compsReshaped) {
        // Grounding still valid, but a comp split/vanished so the positional comp ids
        // that cellComp stores shifted -> the next pass must re-index (incremental).
        L->groundContentDirty = true;
      } else {
        // Pure bore: every surviving comp kept its id and position, so the cached
        // cellComp is still correct except at the removed cells. groundedCell was just
        // patched by removalsKeepGroundingValid; patch cellComp to match and leave the
        // cache otherwise untouched, so the next grounding pass SKIPS entirely. This is
        // what stops acid boring bulk stone from re-indexing the whole layer (incl. a
        // big inert ice tub holding a separate acid pool) every dissolve step.
        for (int k : cgRemovedCells) cellComp[k] = -1;
      }
    }
  }
  void applyLava() {
    std::unordered_set<int>& hardened = lavaHardenedScratch; hardened.clear();
    int hardenedYMax = 0; bool plantBurned = false;
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != LAVA) continue;
        int right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        int snowK = -1;
        if (grid[right] == SNOW) snowK = right; else if (grid[left] == SNOW) snowK = left; else if (grid[down] == SNOW) snowK = down; else if (grid[up] == SNOW) snowK = up;
        if (snowK >= 0) { writeGridIndex(snowK, WATER); markCellIndex(k); continue; }
        int burnK = -1;
        if (isFlammable(grid[right])) burnK = right; else if (isFlammable(grid[left])) burnK = left; else if (isFlammable(grid[down])) burnK = down; else if (isFlammable(grid[up])) burnK = up;
        if (burnK >= 0) { if (isPlantMaterial(grid[burnK])) plantBurned = true; writeGridIndex(burnK, FIRE); continue; }
        int liquidK = -1;
        if (grid[right] == WATER || grid[right] == ACID) liquidK = right; else if (grid[left] == WATER || grid[left] == ACID) liquidK = left; else if (grid[down] == WATER || grid[down] == ACID) liquidK = down; else if (grid[up] == WATER || grid[up] == ACID) liquidK = up;
        if (liquidK >= 0) { writeGridIndex(liquidK, STEAM); writeGridIndex(k, STONE); hardened.insert(k); if (y > hardenedYMax) hardenedYMax = y; continue; }
        if (rand() < LAVA_EMIT_FIRE_P) { int airK = -1; if (grid[up] == EMPTY) airK = up; else if (grid[right] == EMPTY) airK = right; else if (grid[left] == EMPTY) airK = left; if (airK >= 0) writeGridIndex(airK, FIRE); }
      }
    }
    if (!hardened.empty()) registerRigidCells(L->stoneComponents, L->nextStoneId, STONE, hardened, hardenedYMax, false);
    if (plantBurned) splitPlantAfterErase();
  }
  void applyIce() {
    bool melted = false; std::vector<int>& meltedCells = iceMeltedScratch; meltedCells.clear();
    for (auto& comp : L->iceComponents) {
      // Iterate by snapshot length, not a copy: freezing appends ICE cells to
      // comp.cells, and those new cells are already ICE (no further melt/freeze this
      // pass), so capping the loop at the pre-pass size is byte-identical to copying
      // the vector first — without the per-component heap allocation.
      size_t iceN = comp.cells.size();
      for (size_t ci = 0; ci < iceN; ci++) {
        int k = comp.cells[ci];
        if (grid[k] != ICE) continue;
        int right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        uint8_t rm = grid[right], lm = grid[left], dm = grid[down], um = grid[up];
        if (rm == FIRE || rm == LAVA || lm == FIRE || lm == LAVA || dm == FIRE || dm == LAVA || um == FIRE || um == LAVA) { writeGridIndex(k, WATER); meltedCells.push_back(k); melted = true; continue; }
        if (rand() < ICE_FREEZE_P) {
          int waterK = -1; if (rm == WATER) waterK = right; else if (lm == WATER) waterK = left; else if (dm == WATER) waterK = down; else if (um == WATER) waterK = up;
          if (waterK >= 0) { writeGridIndex(waterK, ICE); comp.cells.push_back(waterK); int wy = waterK / cols; if (wy > comp.yMax) comp.yMax = wy; comp.cacheDirty = true; L->groundDirty = true; } // waterK was WATER (live grid read) -> not already in comp; new ICE cell -> reflood
        }
      }
    }
    if (melted) splitRigidAfterErase(L->iceComponents, meltedCells, L->nextIceId, true);
  }
