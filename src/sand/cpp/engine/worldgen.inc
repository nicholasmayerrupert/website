  // ================= WORLDGEN STREAMING (streamGen.js + worldWindow.js) =================
  static const double SURFACE_FREQ, CAVE_FREQ, CAVE_THRESH, TREE_PROB;
  static const int SURFACE_OCT, GEN_SKIN;
  int genSurfaceAt(int worldX) {
    double n = wfbm2(worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
    int y = (int)std::lround(gSurfBase - (n - 0.5) * 2 * gSurfAmp);
    if (y < 2) y = 2; if (y > rows - 4) y = rows - 4; return y;
  }
  bool genIsCave(int worldX, int y) { return wridged2(gCaveSeed, worldX * CAVE_FREQ, y * CAVE_FREQ, 3, 0.5) > CAVE_THRESH; }
  uint8_t genCellAt(int worldX, int surf, int slope, int y) {
    if (y < surf) return y >= gSeaRow ? WATER : EMPTY;
    int depth = y - surf;
    if (depth < GEN_SKIN) return slope <= 1 ? PLANT : SAND;
    if (depth < GEN_SKIN + gSoil) return SAND;
    if (depth >= GEN_SKIN + gSoil + 2 && genIsCave(worldX, y)) return EMPTY;
    return STONE;
  }
  bool genTreeAt(int worldX, int surf) { return surf <= gSeaRow && whash1(gTreeSeed, worldX) < TREE_PROB; }
  void fillBand(int colStart, int colCount, int wOffsetX) {
    int colEnd = colStart + colCount;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < 0 || y >= rows) return; grid[y * cols + lx] = m; };
    for (int lx = colStart; lx < colEnd; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      int slope = std::abs(genSurfaceAt(worldX + 1) - genSurfaceAt(worldX - 1));
      for (int y = 0; y < rows; y++) grid[y * cols + lx] = genCellAt(worldX, surf, slope, y);
    }
    const int TREE_REACH = 4;
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      if (!genTreeAt(worldX, surf)) continue;
      int h = 6 + (int)(whash1(gTreeSeed + 1, worldX) * 7);
      int top = surf - h;
      for (int y = top; y < surf; y++) put(lx, y, WOOD);
      for (int oy = -3; oy <= 1; oy++) for (int ox = -3; ox <= 3; ox++) { if (ox * ox + oy * oy > 9) continue; put(lx + ox, top + oy, PLANT); }
    }
    for (int lx = colStart; lx < colEnd; lx++) for (int y = 0; y < rows; y++) { int k = y * cols + lx; next[k] = grid[k]; }
  }
  void initInfinite(uint32_t seed) {
    infinite = true; worldSeed = seed;
    gSurfAmp = imax(16, (int)std::floor(rows * 0.16));
    gSurfBase = imax(8, (int)std::floor(rows * 0.24));
    gSeaRow = gSurfBase + imax(2, (int)std::floor(rows * 0.05));
    gSoil = imax(3, (int)std::floor(rows * 0.045));
    gCaveSeed = seed ^ 0x5bd1e995u; gTreeSeed = seed ^ 0x1b56c4f9u;
    worldOffsetX = -(cols / 2);
    fillBand(0, cols, worldOffsetX);
    registerSeededComponents(0, cols);
  }
  void shiftRowMajorU8(uint8_t* arr, int dx, uint8_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, cols - dx); memset(arr + b + cols - dx, fill, dx); }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, cols - s); memset(arr + b, fill, s); } }
  }
  void translateComponents(std::vector<Comp>& list, int dx) {
    std::vector<Comp> kept;
    for (auto& comp : list) {
      std::unordered_set<int> cells; int yMax = 0;
      for (int k : comp.cells) { int nx = (k % cols) - dx; if (nx < 0 || nx >= cols) continue; int nk = k - dx; cells.insert(nk); int y = nk / cols; if (y > yMax) yMax = y; }
      if (cells.empty()) continue;
      comp.cells = std::move(cells); comp.yMax = yMax; comp.cacheDirty = true;
      kept.push_back(std::move(comp));
    }
    list = std::move(kept);
  }
  void shiftWorld(int dx) {
    if (!dx || !infinite) return;
    int s = std::abs(dx);
    if (s >= cols) return;
    int oldOffset = worldOffsetX, newOffset = oldOffset + dx;
    int enterColStart = dx > 0 ? cols - s : 0;
    shiftRowMajorU8(grid, dx, EMPTY);
    shiftRowMajorU8(next, dx, EMPTY);
    for (int y = 0; y < rows; y++) {
      if (rowMarkMax[y] < rowMarkMin[y]) continue;
      int mn = rowMarkMin[y] - dx, mx = rowMarkMax[y] - dx;
      if (mx < 0 || mn > cols - 1) { rowMarkMin[y] = cols; rowMarkMax[y] = -1; continue; }
      rowMarkMin[y] = mn < 0 ? 0 : mn; rowMarkMax[y] = mx > cols - 1 ? cols - 1 : mx;
    }
    std::fill(compOccStamp.begin(), compOccStamp.end(), -1);
    std::fill(vacatedStamp.begin(), vacatedStamp.end(), -1);
    fillBand(enterColStart, s, newOffset);
    worldOffsetX = newOffset;
    for (int y = 0; y < rows; y++) { if (enterColStart < rowMarkMin[y]) rowMarkMin[y] = enterColStart; if (enterColStart + s - 1 > rowMarkMax[y]) rowMarkMax[y] = enterColStart + s - 1; }
    // un-stamp free bodies before the shift, then translate / drop them
    for (int k : bodyCells) { if (grid[k] == RIGID) grid[k] = EMPTY; if (next[k] == RIGID) next[k] = EMPTY; bodyOwner[k] = -1; }
    bodyCells.clear();
    {
      std::vector<Body*> keep;
      for (Body* b : bodies) { b->px -= dx; if (b->px > -b->maxR && b->px < cols + b->maxR) keep.push_back(b); else delete b; }
      bodies = std::move(keep);
    }
    shiftRowMajorI32(bodyOwner.data(), dx, -1);
    translateComponents(stoneComponents, dx);
    translateComponents(plantComponents, dx);
    translateComponents(iceComponents, dx);
    registerSeededComponents(enterColStart, enterColStart + s);
  }
  void shiftRowMajorI32(int32_t* arr, int dx, int32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * 4); for (int i = b + cols - dx; i < b + cols; i++) arr[i] = fill; }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, (size_t)(cols - s) * 4); for (int i = b; i < b + s; i++) arr[i] = fill; } }
  }

