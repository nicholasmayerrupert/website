  // ================= WORLDGEN STREAMING (streamGen.js + worldWindow.js) =================
  // Terraria/Starbound-flavoured generator. The SURFACE (height + biome + soil)
  // is derived from the shared world seed, so the foreground and background line
  // up at the top and the soil layer never erodes via cross-layer drain. The
  // SUBSURFACE (caves + ore/liquid pockets) is derived from a PER-LAYER seed, so
  // the background diverges underground — digging the foreground reveals a
  // different cave network behind it, and cross-layer transfer flows wherever the
  // two cavities mismatch. Biomes (plains / desert / rocky) vary the surface skin,
  // soil depth, and tree density. Materials are the existing palette only.
  enum Biome : int { BIOME_PLAINS = 0, BIOME_DESERT = 1, BIOME_ROCKY = 2 };
  static const double SURFACE_FREQ, CAVE_FREQ, CAVE_THRESH, TREE_PROB;
  static const double BIOME_FREQ, POCKET_FREQ, WATER_POCKET_THRESH, OIL_POCKET_THRESH, LAVA_THRESH;
  static const int SURFACE_OCT, GEN_SKIN;
  int genSurfaceAt(int worldX) {
    double n = wfbm2(L->worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
    // A slower large-scale roll layers gentle hills + valleys onto the detail
    // noise. Kept modest so slopes stay near the sand angle-of-repose (steep
    // slopes would keep loose surface sand avalanching, churning the sim forever).
    double hills = wfbm2(L->worldSeed ^ 0x9e3779b9u, worldX * SURFACE_FREQ * 0.25, 3.1, 3, 0.5);
    double amp = L->gSurfAmp * (0.85 + hills * 0.4);
    int y = (int)std::lround(L->gSurfBase - (n - 0.5) * 2 * amp);
    if (y < 2) y = 2; if (y > rows - 4) y = rows - 4; return y;
  }
  // Biome from a low-frequency SHARED-seed band, so both layers agree on biome.
  int genBiomeAt(int worldX) {
    double n = wfbm2(L->worldSeed ^ 0xB10B10u, worldX * BIOME_FREQ, 2.5, 3, 0.5);
    if (n < 0.42) return BIOME_PLAINS;
    if (n < 0.66) return BIOME_DESERT;
    return BIOME_ROCKY;
  }
  // Rocky has no loose soil (bare stone to the surface, so it stays one connected
  // component); desert has a deep sand mantle; plains a normal dirt band.
  int genSoilDepth(int biome) { return biome == BIOME_ROCKY ? 0 : (biome == BIOME_DESERT ? L->gSoil * 2 : L->gSoil); }
  bool genIsCave(int worldX, int y) { return wridged2(L->gCaveSeed, worldX * CAVE_FREQ, y * CAVE_FREQ, 3, 0.5) > CAVE_THRESH; }
  // The ONLY generated liquid: rare LAVA chambers sealed deep in the bedrock
  // (deepFrac >= 0.84, below the cave zone, so they're enclosed by solid stone and
  // stay inert until dug into). We deliberately avoid open or cave-adjacent
  // liquids — a free liquid surface re-marks itself dirty every step forever,
  // which would churn the whole buffer (huge net diffs + wasted CPU). Returns
  // STONE when no chamber applies.
  uint8_t genPocketAt(int worldX, int y, int depth, int soil) {
    double deepFrac = (double)y / rows;
    if (deepFrac >= 0.84 && wridged2(L->gPocketSeed ^ 0x1a7au, worldX * POCKET_FREQ, y * POCKET_FREQ, 3, 0.5) > LAVA_THRESH) return LAVA;
    return STONE;
  }
  uint8_t genCellAt(int worldX, int surf, int slope, int biome, int soil, int y) {
    // Above the surface is open sky. We deliberately do NOT flood valleys with open
    // seas: a free water surface re-marks itself dirty every step forever, so large
    // generated seas would churn the whole buffer (huge net diffs + wasted CPU).
    // Water lives in CONTAINED underground pockets instead (inert until dug into).
    if (y < surf) return EMPTY;
    int depth = y - surf;
    if (depth < GEN_SKIN) {                                    // surface skin
      if (biome == BIOME_ROCKY) return STONE;                 // bare stone (connects down)
      if (biome == BIOME_DESERT) return SAND;
      return slope <= 1 ? PLANT : SAND;                       // plains: grass on flats, sand on steeps
    }
    if (depth < GEN_SKIN + soil) return SAND;                  // dirt / sand mantle
    // Caves carve the explorable mid-depths only, starting a thick stone buffer
    // BELOW the loose soil so generated sand never rests directly above a cave
    // (otherwise the two layers' divergent caves let sand settle into different
    // spots, and cross-layer transfer churns forever). The deep base (>=0.78) is
    // solid bedrock so the world has a stable, grounded floor.
    if (depth >= GEN_SKIN + soil + 8 && (double)y / rows < 0.78 && genIsCave(worldX, y)) return EMPTY;
    return genPocketAt(worldX, y, depth, soil);               // stone + liquid/lava pockets
  }
  bool genTreeAt(int worldX, int surf) {
    return genBiomeAt(worldX) == BIOME_PLAINS && surf <= L->gSeaRow && whash1(L->gTreeSeed, worldX) < TREE_PROB;
  }
  void fillBand(int colStart, int colCount, int wOffsetX) {
    int colEnd = colStart + colCount;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < 0 || y >= rows) return; grid[y * cols + lx] = m; };
    for (int lx = colStart; lx < colEnd; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      int slope = std::abs(genSurfaceAt(worldX + 1) - genSurfaceAt(worldX - 1));
      int biome = genBiomeAt(worldX); int soil = genSoilDepth(biome);
      for (int y = 0; y < rows; y++) grid[y * cols + lx] = genCellAt(worldX, surf, slope, biome, soil, y);
    }
    const int TREE_REACH = 4;
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      if (!genTreeAt(worldX, surf)) continue;
      int h = 6 + (int)(whash1(L->gTreeSeed + 1, worldX) * 7);
      int top = surf - h;
      for (int y = top; y < surf; y++) put(lx, y, WOOD);
      for (int oy = -3; oy <= 1; oy++) for (int ox = -3; ox <= 3; ox++) { if (ox * ox + oy * oy > 9) continue; put(lx + ox, top + oy, PLANT); }
    }
    for (int lx = colStart; lx < colEnd; lx++) for (int y = 0; y < rows; y++) { int k = y * cols + lx; next[k] = grid[k]; }
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared, so the two layers share a silhouette but
  // diverge below ground. fg passes 0, bg passes 1.
  void initInfiniteLayer(uint32_t seed, uint32_t layerSalt) {
    L->infinite = true; L->worldSeed = seed;
    L->gSurfAmp = imax(16, (int)std::floor(rows * 0.16));
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.24));
    L->gSeaRow = L->gSurfBase + imax(2, (int)std::floor(rows * 0.05));
    L->gSoil = imax(2, (int)std::floor(rows * 0.012)); // thin sand mantle: settles fast, doesn't churn
    L->gCaveSeed = (seed ^ 0x5bd1e995u) + layerSalt * 0x9e3779b9u;
    L->gPocketSeed = (seed ^ 0xC0FFEE11u) + layerSalt * 0x85ebca6bu;
    L->gTreeSeed = seed ^ 0x1b56c4f9u; // shared so tree silhouettes line up across layers
    L->worldOffsetX = -(cols / 2);
    fillBand(0, cols, L->worldOffsetX);
    registerSeededComponents(0, cols);
  }
  // Generate BOTH layers: shared surface (no erosion), divergent subsurface. The
  // background is fully simulated; cross-layer transfer flows where caves/pockets
  // mismatch. Enabling the background activates that transfer.
  void initInfinite(uint32_t seed) {
    useLayer(&fg); initInfiniteLayer(seed, 0);
    useLayer(&bg); initInfiniteLayer(seed, 1);
    bgEnabled = true;
    useLayer(&fg);
  }
  void shiftRowMajorU8(uint8_t* arr, int dx, uint8_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, cols - dx); memset(arr + b + cols - dx, fill, dx); }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, cols - s); memset(arr + b, fill, s); } }
  }
  // Re-index every component after the grid slid by dx columns. A column shift is a
  // uniform index delta within each row (k -> k - dx), so we offset Comp.cells IN
  // PLACE (compacting out cells that fell off the row's edge) rather than rebuilding
  // an unordered_set per component. This is the bulk of the periodic pan-shift cost:
  // the in-place vector pass is ~10x cheaper than the hash-set rebuild it replaces.
  void translateComponents(std::vector<Comp>& list, int dx) {
    size_t w = 0; // write cursor over `list`, dropping components that fully left the buffer
    for (size_t r = 0; r < list.size(); r++) {
      Comp& comp = list[r];
      auto& cs = comp.cells; size_t cw = 0; int yMax = 0;
      for (size_t i = 0; i < cs.size(); i++) {
        int k = cs[i]; int nx = (k % cols) - dx; if (nx < 0 || nx >= cols) continue; // cell slid off this row -> drop
        int nk = k - dx; cs[cw++] = nk; int y = nk / cols; if (y > yMax) yMax = y;
      }
      if (cw == 0) continue; // whole component left the buffer
      cs.resize(cw); comp.yMax = yMax; comp.cacheDirty = true;
      if (w != r) list[w] = std::move(comp);
      w++;
    }
    list.resize(w);
  }
  // ---- chunk store (chunkStore.js): persist edited bands across shifts ----
  void csSaveMaterials(int colStart, int width, int key) {
    Layer::MatBand& e = L->matStore[key];
    if (e.width != width) { e.width = width; e.buf.assign((size_t)width * rows, 0); }
    for (int y = 0; y < rows; y++) { int src = y * cols + colStart; memcpy(e.buf.data() + (size_t)y * width, grid + src, width); }
  }
  bool csLoadMaterials(int colStart, int width, int key) {
    auto it = L->matStore.find(key);
    if (it == L->matStore.end() || it->second.width != width) return false;
    const uint8_t* buf = it->second.buf.data();
    for (int y = 0; y < rows; y++) { int dst = y * cols + colStart; memcpy(grid + dst, buf + (size_t)y * width, width); memcpy(next + dst, buf + (size_t)y * width, width); }
    return true;
  }
  void csSaveBodies(int key, std::vector<std::pair<Body*, double>>&& list) { if (!list.empty()) L->bodyStore[key] = std::move(list); }
  std::vector<std::pair<Body*, double>> csTakeBodies(int key) {
    auto it = L->bodyStore.find(key); if (it == L->bodyStore.end()) return {};
    auto l = std::move(it->second); L->bodyStore.erase(it); return l;
  }

  // Slide the loaded window by dx world-columns. Mirrors worldWindow.shiftWorld:
  // un-stamp body rasters, persist the leaving band (materials + L->bodies) to the
  // store, memmove the buffers, translate survivors, then restore the entering
  // band from the store if previously visited (else generate it).
  // Decide whether the loaded world window should slide so the camera always
  // has room to keep panning, and slide it if so. cameraCellX is the view's
  // left column; the engine owns the shift distance. Returns the applied dx
  // (0 if none); JS uses it to slide its visual cache and pull the camera back.
  int maybeShiftWorld(int cameraCellX, int visibleCols, int marginCols) {
    if (!fg.infinite) return 0;
    int maxCamX = cols - visibleCols;
    int dx = 0;
    if (cameraCellX >= maxCamX - marginCols) dx = WORLD_SHIFT_COLS;
    else if (cameraCellX <= marginCols) dx = -WORLD_SHIFT_COLS;
    if (dx) shiftWorld(dx);
    return dx;
  }
  // Slide BOTH layers in lockstep with the shared camera. Players are anchored
  // once (not per layer).
  void shiftWorld(int dx) {
    if (!dx || !fg.infinite) return;
    int s = std::abs(dx); if (s >= cols) return;
    worldShiftCount++;
    useLayer(&fg); shiftLayer(dx);
    useLayer(&bg); shiftLayer(dx);
    useLayer(&fg);
    for (auto& p : players) { p.px -= dx; p.aimX -= dx; } // anchor players to the world once
  }
  void shiftLayer(int dx) {
    if (!dx || !L->infinite) return;
    int s = std::abs(dx);
    if (s >= cols) return;
    int oldOffset = L->worldOffsetX, newOffset = oldOffset + dx;
    int leaveColStart = dx > 0 ? 0 : cols - s;
    int enterColStart = dx > 0 ? cols - s : 0;
    int leaveKey = oldOffset + leaveColStart, enterKey = newOffset + enterColStart;

    // 1) clear body rasters so no RIGID ghost is saved or memmoved (L->bodies
    //    re-rasterize from their float poses next step).
    for (int k : L->bodyCells) { if (grid[k] == RIGID) grid[k] = EMPTY; if (next[k] == RIGID) next[k] = EMPTY; bodyOwner[k] = -1; }
    L->bodyCells.clear();

    // 2) persist the leaving band: L->bodies sitting in it (keyed by world-x), then
    //    its materials.
    {
      std::vector<std::pair<Body*, double>> leaving; std::vector<Body*> staying;
      for (Body* b : L->bodies) { if (b->px >= leaveColStart && b->px < leaveColStart + s) leaving.push_back({b, oldOffset + b->px}); else staying.push_back(b); }
      if (!leaving.empty()) { L->bodies = std::move(staying); csSaveBodies(leaveKey, std::move(leaving)); }
    }
    csSaveMaterials(leaveColStart, s, leaveKey);

    // 3) slide the persistent buffers + dirty marks.
    double _t = emscripten_get_now();
    shiftRowMajorU8(grid, dx, EMPTY);
    shiftRowMajorU8(next, dx, EMPTY);
    shiftRowMajorI32(bodyOwner, dx, -1);
    for (int y = 0; y < rows; y++) {
      if (rowMarkMax[y] < rowMarkMin[y]) continue;
      int mn = rowMarkMin[y] - dx, mx = rowMarkMax[y] - dx;
      if (mx < 0 || mn > cols - 1) { rowMarkMin[y] = cols; rowMarkMax[y] = -1; continue; }
      rowMarkMin[y] = mn < 0 ? 0 : mn; rowMarkMax[y] = mx > cols - 1 ? cols - 1 : mx;
    }
    std::fill(compOccStamp, compOccStamp + (size_t)cols * rows, -1);
    std::fill(vacatedStamp, vacatedStamp + (size_t)cols * rows, -1);
    perfShiftBuffers = emscripten_get_now() - _t;

    // 4) translate staying L->bodies; drop any that left the buffer.
    {
      std::vector<Body*> keep;
      for (Body* b : L->bodies) { b->px -= dx; if (b->px > -b->maxR && b->px < cols + b->maxR) keep.push_back(b); else delete b; }
      L->bodies = std::move(keep);
    }

    // 5) bring in the newly exposed band: restore it if we've stored it before,
    //    else generate. Advance the offset and restore its saved L->bodies.
    _t = emscripten_get_now();
    if (!csLoadMaterials(enterColStart, s, enterKey)) fillBand(enterColStart, s, newOffset);
    L->worldOffsetX = newOffset;
    for (auto& e : csTakeBodies(enterKey)) { e.first->px = e.second - newOffset; L->bodies.push_back(e.first); }
    perfShiftFill = emscripten_get_now() - _t;

    // 6) mark the new band active so it simulates, then update components.
    for (int y = 0; y < rows; y++) { if (enterColStart < rowMarkMin[y]) rowMarkMin[y] = enterColStart; if (enterColStart + s - 1 > rowMarkMax[y]) rowMarkMax[y] = enterColStart + s - 1; }
    _t = emscripten_get_now();
    translateComponents(L->stoneComponents, dx);
    translateComponents(L->plantComponents, dx);
    translateComponents(L->iceComponents, dx);
    perfShiftTranslate = emscripten_get_now() - _t;
    _t = emscripten_get_now();
    registerSeededComponents(enterColStart, enterColStart + s);
    perfShiftRegister = emscripten_get_now() - _t;
  }
  void shiftRowMajorI32(int32_t* arr, int dx, int32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * 4); for (int i = b + cols - dx; i < b + cols; i++) arr[i] = fill; }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, (size_t)(cols - s) * 4); for (int i = b; i < b + s; i++) arr[i] = fill; } }
  }

