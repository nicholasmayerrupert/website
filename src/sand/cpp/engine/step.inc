  // ---- step ----
  bool step() {
    if (!beginStepDirty()) return false;
    double t0 = emscripten_get_now();
    tick++;
    computeGrounded();
    moveRigidAssemblies();
    moveBodies();
    growPlantComponents();
    applyReactions(); applyAcid(); applyLava(); applyIce();
    prepareNextBuffer();
    // carry-forward component + body cells across the double buffer
    curCompCells.clear();
    for (auto& comp : stoneComponents) for (int k : comp.cells) { next[k] = STONE; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (auto& comp : plantComponents) for (int k : comp.cells) { next[k] = grid[k]; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (auto& comp : iceComponents) for (int k : comp.cells) { next[k] = ICE; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (int k : bodyCells) { next[k] = RIGID; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (int k : prevCompCells) {
      if (compOccStamp[k] == tick) continue;
      if (grid[k] == EMPTY) { next[k] = EMPTY; markCellIndex(k); }
      else if (!isRigidMaterial(grid[k]) && isRigidMaterial(next[k])) { next[k] = grid[k]; markCellIndex(k); }
    }
    std::swap(prevCompCells, curCompCells);

    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) settleLooseDensityInterface(x, y, rb + x); else for (int x = maxX; x >= minX; x--) settleLooseDensityInterface(x, y, rb + x); }
    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { if (MAT_KIND[grid[rb + x]] == K_POWDER) settleSand(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { if (MAT_KIND[grid[rb + x]] == K_POWDER) settleSand(x, y, rb + x); } }
    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } else for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } }
    for (int y = 0; y < rows; y++) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x); } }
    uint8_t* tmp = grid; grid = next; next = tmp;
    if ((tick & 1) == 0) relaxLiquidGaps();
    if (tick % 3 == 0) separateLooseByDensity();
    applySideSinks();
    perfStepMs = emscripten_get_now() - t0;
    return true;
  }

