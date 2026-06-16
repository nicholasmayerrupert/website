  // ---- settle passes (identical to Stage 1) ----
  bool canLooseDensitySettleThisTick(uint8_t m) { float mob = MOBILITY[m]; return mob >= 1 || rand() < mob; }
  void settleLooseDensityInterface(int x, int y, int k) {
    uint8_t m = grid[k];
    if (!isLooseDensityMaterial(m) || next[k] != EMPTY) return;
    if (!canLooseDensitySettleThisTick(m)) return;
    int belowK = k + cols;
    if (y + 1 < rows && canDisplaceByLooseDensity(m, grid[belowK]) && next[belowK] == EMPTY) { moveMaterialInto(k, belowK, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue; int ik = belowK + dx; if (canDisplaceByLooseDensity(m, grid[ik]) && next[ik] == EMPTY) { moveMaterialInto(k, ik, m); return; } }
  }
  void settleSand(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && grid[belowK] == SAND && grid[belowK - 1] == SAND && grid[belowK + 1] == SAND) { if (next[k] == EMPTY) next[k] = SAND; return; }
    if (y + 1 < rows && grid[belowK] == EMPTY && next[belowK] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(belowK, SAND); return; }
    if (y + 1 < rows && canDisplaceMaterial(SAND, grid[belowK]) && next[belowK] == EMPTY) { moveMaterialInto(k, belowK, SAND); return; }
    int firstDx = rand() < 0.5 ? -1 : 1, secondDx = -firstDx;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? firstDx : secondDx; int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx; uint8_t m = grid[ik];
      if (m == EMPTY && next[ik] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, SAND); return; }
      if (canDisplaceMaterial(SAND, m) && next[ik] == EMPTY) { moveMaterialInto(k, ik, SAND); return; }
    }
    if (next[k] == EMPTY) writeNextIndex(k, SAND);
  }
  void settleLiquid(int x, int y, int k, uint8_t m) {
    if (next[k] != EMPTY) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && grid[k - 1] == m && grid[k + 1] == m) {
      uint8_t below = grid[belowK], bl = grid[belowK - 1], br = grid[belowK + 1];
      if ((below == m && bl == m && br == m) || (supportsLiquid(below, m) && bl != EMPTY && !canDisplaceMaterial(m, bl) && br != EMPTY && !canDisplaceMaterial(m, br))) {
        next[k] = m; if (y > 1 && grid[k - cols] == EMPTY) markCellIndex(k); return;
      }
    }
    if (y + 1 < rows && grid[belowK] == EMPTY && next[belowK] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(belowK, m); return; }
    if (y + 1 < rows && canDisplaceMaterial(m, grid[belowK]) && next[belowK] == EMPTY) { moveLiquidInto(k, x, y + 1, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i]; int nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      int ik = I(nx, ny);
      if (grid[ik] == EMPTY && next[ik] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, m); return; }
      if (canDisplaceMaterial(m, grid[ik]) && next[ik] == EMPTY) { moveLiquidInto(k, nx, ny, m); return; }
    }
    int flow = 0, firstFlowDir = rand() < 0.5 ? 1 : -1;
    for (int dirIndex = 0; dirIndex < 2 && flow == 0; dirIndex++) {
      int sgn = dirIndex == 0 ? firstFlowDir : -firstFlowDir;
      for (int d = 1; d <= MAX_WATER_FLOW; d++) {
        int nx = x + sgn * d; if (nx <= 0 || nx >= cols - 1) break;
        int sideK = k + sgn * d; if (!canEnterIndex(sideK, m)) break;
        if (y + 1 < rows) { int lowerK = sideK + cols; if (canEnterIndex(lowerK, m)) { int stepK = k + sgn; if (canEnterIndex(stepK, m)) flow = sgn; break; } }
      }
    }
    if (flow != 0) { int stepX = x + flow; if (canLiquidEnter(stepX, y, m)) { moveLiquidInto(k, stepX, y, m); return; } }
    if (y + 1 < rows && supportsLiquid(grid[belowK], m)) {
      int aboveK = k - cols;
      if (y > 1 && grid[aboveK] == m) {
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int sideK = k + dx; if (x + dx <= 0 || x + dx >= cols - 1) continue; if (canEnterIndex(sideK, m) && supportsLiquid(grid[sideK + cols], m)) { moveMaterialInto(k, sideK, m); return; } }
      }
      if (next[k] == EMPTY) writeNextIndex(k, m);
      return;
    }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; if (canLiquidEnter(x + dx, y, m)) { moveLiquidInto(k, x + dx, y, m); return; } }
    if (next[k] == EMPTY) writeNextIndex(k, m);
  }
  void settleLava(int x, int y, int k) { if (next[k] != EMPTY) return; if (rand() >= MOBILITY[LAVA]) { writeNextIndex(k, LAVA); return; } settleLiquid(x, y, k, LAVA); }
  void relaxLiquidGaps() {
    for (int pass = 0; pass < 2; pass++) for (int y = rows - 2; y > 0; y--) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      bool ltr = rand() < 0.5; int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        int k = I(x, y); if (grid[k] != EMPTY) continue;
        if (grid[I(x, y + 1)] == EMPTY) continue;
        int aboveK = I(x, y - 1); uint8_t above = grid[aboveK];
        if (above == WATER || above == ACID || above == OIL) { writeGridIndex(k, above); writeGridIndex(aboveK, EMPTY); continue; }
        const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int sx = x + dx; if (sx <= 0 || sx >= cols - 1) continue; int sk = I(sx, y); uint8_t side = grid[sk]; if (side != WATER && side != OIL && side != ACID) continue; writeGridIndex(k, side); writeGridIndex(sk, EMPTY); if (grid[k] != EMPTY) break; }
      }
    }
  }
  void separateLooseByDensity() {
    int parity = rand() < 0.5 ? 0 : 1;
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      bool ltr = (y % 2) == 0; int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        if (((x + y) % 2) != parity) continue;
        int k = I(x, y), belowK = k + cols; uint8_t upper = grid[k], lower = grid[belowK];
        if (canDisplaceByLooseDensity(upper, lower)) { writeGridIndex(belowK, upper); writeGridIndex(k, lower); }
      }
    }
  }
  void riseSteam(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() < STEAM_DECAY_P || y <= 1) { markCellIndex(k); return; }
    int up = I(x, y - 1);
    if (grid[up] == EMPTY && next[up] == EMPTY && rand() < 0.72) { writeNextIndex(up, STEAM); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = y - 1; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (grid[ik] == EMPTY && next[ik] == EMPTY) { writeNextIndex(ik, STEAM); return; } }
    if (rand() < 0.65) for (int i = 0; i < 2; i++) { int dx = dirs[i]; if (emptyAt(x + dx, y)) { writeNextIndex(I(x + dx, y), STEAM); return; } }
    if (next[k] == EMPTY) writeNextIndex(k, STEAM);
  }
  void riseFire(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() < FIRE_DECAY_P || y <= 1) { markCellIndex(k); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    if (rand() < 0.36) { int up = I(x, y - 1); if (grid[up] == EMPTY && next[up] == EMPTY) { writeNextIndex(up, FIRE); return; } }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = rand() < 0.55 ? y - 1 : y; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (grid[ik] == EMPTY && next[ik] == EMPTY) { writeNextIndex(ik, FIRE); return; } }
    if (next[k] == EMPTY) writeNextIndex(k, FIRE);
  }
  void drain(int xs, int xe, int y, float liquidP, float sandP) {
    for (int x = xs; x <= xe; x++) { int k = I(x, y); uint8_t m = grid[k]; float p = isLiquid(m) ? liquidP : (m == SAND ? sandP : 0); if (p && rand() < p) writeGridIndex(k, EMPTY); }
  }
  void applySideSinks() {
    if (!sinksEnabled || cols < 6) return;
    int leftStart = 1, leftEnd = leftStart + SINK_STRIP_W - 1;
    int rightStart = cols - 2 - (SINK_STRIP_W - 1), rightEnd = cols - 2;
    int innerLeftStart = leftEnd + 1, innerLeftEnd = innerLeftStart + INNER_STRIP_W - 1;
    int innerRightEnd = rightStart - 1, innerRightStart = innerRightEnd - (INNER_STRIP_W - 1);
    for (int y = 1; y < rows; y++) {
      drain(leftStart, leftEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(rightStart, rightEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(innerLeftStart, innerLeftEnd, y, INNER_LIQUID_P, INNER_SAND_P);
      drain(innerRightStart, innerRightEnd, y, INNER_LIQUID_P, INNER_SAND_P);
    }
  }

