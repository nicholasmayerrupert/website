  // ================= WORLDGEN STREAMING (streamGen.js + worldWindow.js) =================
  // Terraria/Starbound-flavoured generator. The SURFACE (height + biome + soil)
  // is derived from the shared world seed, so the foreground and background line
  // up at the top and the soil layer never erodes via cross-layer drain. The
  // SUBSURFACE (caves + ore/liquid pockets) is derived from a PER-LAYER seed, so
  // the background diverges underground — digging the foreground reveals a
  // different cave network behind it, and cross-layer transfer flows wherever the
  // two cavities mismatch. Biomes (plains / desert / rocky) vary the surface skin,
  // soil depth, and tree density. Materials are the existing palette only.
  enum Biome : int { BIOME_PLAINS = 0, BIOME_FOREST = 1, BIOME_DESERT = 2, BIOME_ROCKY = 3 };
  static const double SURFACE_FREQ, CAVE_FREQ, CAVE_THRESH, TREE_PROB;
  static const double BIOME_FREQ, POCKET_FREQ, WATER_POCKET_THRESH, OIL_POCKET_THRESH, LAVA_THRESH;
  static const int SURFACE_OCT, GEN_SKIN;
  // Biome from a low-frequency SHARED-seed band, so both layers agree. A secondary
  // band splits plains/forest. Biomes vary the surface skin, soil depth and trees
  // (NOT the surface height — keeping the height biome-independent avoids cliffs at
  // biome seams, which would otherwise be steep enough to avalanche surface sand
  // forever).
  int genBiomeAt(int worldX) {
    double n = wfbm2(L->worldSeed ^ 0xB10B10u, worldX * BIOME_FREQ, 2.5, 3, 0.5);
    double t = wfbm2(L->worldSeed ^ 0x7A11D2u, worldX * BIOME_FREQ * 1.7, 5.5, 2, 0.5);
    if (n < 0.40) return t < 0.5 ? BIOME_PLAINS : BIOME_FOREST;
    if (n < 0.64) return BIOME_DESERT;
    return BIOME_ROCKY;
  }
  // Terrain top (smaller y = higher). Smooth multi-octave hills/valleys; valleys
  // that fall below the sea row flood into oceans/lakes (handled in genCellAt).
  int genSurfaceAt(int worldX) {
    double n = wfbm2(L->worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
    double hills = wfbm2(L->worldSeed ^ 0x9e3779b9u, worldX * SURFACE_FREQ * 0.22, 3.1, 4, 0.5);
    double amp = L->gSurfAmp * (0.75 + hills * 0.6);
    int y = (int)std::lround(L->gSurfBase - (n - 0.5) * 2 * amp);
    if (y < 2) y = 2; if (y > rows - 4) y = rows - 4; return y;
  }
  int genSoilDepth(int biome) {
    if (biome == BIOME_ROCKY) return 0;          // bare stone (stays one connected mass)
    if (biome == BIOME_DESERT) return L->gSoil * 3; // deep sand
    return L->gSoil + 2;                          // plains / forest dirt
  }
  uint8_t genSkinMat(int biome, int slope, bool underwater) {
    if (underwater) return STONE;                // solid seabed (loose sand under water just avalanches)
    if (biome == BIOME_ROCKY) return STONE;
    if (biome == BIOME_DESERT) return SAND;
    return slope <= 2 ? PLANT : SAND;            // plains/forest: grass on gentle ground, sand on steeps
  }
  // Caves carve winding tunnels (ridged noise) plus the occasional larger cavern
  // (fbm). The BACKGROUND uses a higher threshold -> a more-solid backdrop behind
  // the foreground's traversable caves (the user's "back solid, front carved").
  bool genIsCave(int worldX, int y) {
    double tun = wridged2(L->gCaveSeed, worldX * CAVE_FREQ, y * CAVE_FREQ, 3, 0.5);
    double cav = wfbm2(L->gCaveSeed ^ 0x55u, worldX * CAVE_FREQ * 0.45, y * CAVE_FREQ * 0.45, 3, 0.5);
    double caveBias = L->isBackground ? 0.13 : 0.0; // bg: sparser caves
    return tun > CAVE_THRESH + caveBias || cav > 0.74 + caveBias;
  }
  // Sealed liquid/lava chambers in the DEEP stone (below the cave zone, so they're
  // enclosed by solid rock and stay inert until dug into — never cave-adjacent,
  // which would let them drain + churn). The zones are DEPTH-SEPARATED with stone
  // buffers so different liquids never touch (water against lava would steam
  // forever; oil against water would density-swap forever), and each pocket holds
  // a SINGLE liquid (a low-freq region selector) so no two liquids mix. STONE
  // otherwise.
  uint8_t genPocketAt(int worldX, int y, double df) {
    if (df < 0.80) return STONE;
    double p = wridged2(L->gPocketSeed ^ 0x1a7au, worldX * POCKET_FREQ, y * POCKET_FREQ, 3, 0.5); // pocket shape
    if (df >= 0.90) return p > LAVA_THRESH ? LAVA : STONE;     // underworld: lava only
    if (df >= 0.86) return STONE;                              // solid buffer between water and lava
    if (p <= WATER_POCKET_THRESH) return STONE;                // 0.80..0.86: water OR oil reservoirs...
    double sel = wfbm2(L->gPocketSeed ^ 0x9bu, worldX * POCKET_FREQ * 0.3, y * POCKET_FREQ * 0.3, 2, 0.5);
    return sel < 0.5 ? WATER : OIL;                            // ...each region a single liquid (no mixing)
  }
  uint8_t genCellAt(int worldX, int surf, int slope, int biome, int soil, int y) {
    int sea = L->gSeaRow;
    if (y < surf) {
      // above the terrain: a valley below the sea row floods with water (a flat,
      // contained ocean that settles); the foreground holds the water, the
      // background is a solid wall behind it. Otherwise it's open sky.
      if (y >= sea) return L->isBackground ? STONE : WATER;
      return EMPTY;
    }
    int depth = y - surf;
    bool underwater = surf > sea;
    // The FOREGROUND has the rich loose strata (skin + dirt/sand mantle). The
    // BACKGROUND skips them — a dry solid backdrop, no loose soil to churn.
    if (!L->isBackground) {
      if (depth < GEN_SKIN) return genSkinMat(biome, slope, underwater);
      if (depth < GEN_SKIN + soil) return underwater ? STONE : SAND; // solid under oceans
    }
    // A thick solid stone buffer separates the loose soil (and any ocean floor)
    // from the cave zone, so generated sand never rests directly over a cave and
    // oceans can't drain into one (both churn the cross-layer transfer forever).
    int caveTop = GEN_SKIN + soil + imax(10, (int)std::floor(rows * 0.04));
    double df = (double)y / rows; // depth fraction (relative to the buffer; absolute once vertical streaming lands)
    // Caves: the foreground gets traversable tunnels; the background gets the same
    // network but SPARSER (genIsCave biases by layer) for a more-solid backdrop.
    // The bg's caves are DRY (it has no soil/liquids), so they stay inert.
    if (depth >= caveTop && df < 0.80 && genIsCave(worldX, y)) return EMPTY;
    if (L->isBackground) return STONE;                       // bg: solid stone, no liquid pockets
    return genPocketAt(worldX, y, df);                       // fg: stone + sealed deep liquids
  }
  bool genTreeAt(int worldX, int surf) {
    if (surf >= L->gSeaRow) return false;        // at/under water -> no trees
    int biome = genBiomeAt(worldX);
    double prob = biome == BIOME_FOREST ? TREE_PROB * 3.2 : (biome == BIOME_PLAINS ? TREE_PROB : 0.0);
    return whash1(L->gTreeSeed, worldX) < prob;
  }
  void fillBand(int colStart, int colCount, int wOffsetX) {
    int colEnd = colStart + colCount;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < 0 || y >= rows) return; if (grid[y * cols + lx] == EMPTY) grid[y * cols + lx] = m; };
    for (int lx = colStart; lx < colEnd; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      int slope = std::abs(genSurfaceAt(worldX + 1) - genSurfaceAt(worldX - 1));
      int biome = genBiomeAt(worldX); int soil = genSoilDepth(biome);
      for (int y = 0; y < rows; y++) grid[y * cols + lx] = genCellAt(worldX, surf, slope, biome, soil, y);
    }
    // Trees: trunks + canopy, only on dry land (a tree's footprint reaches a few
    // columns out, so scan past the band edges). Foreground only — the background
    // is a clean backdrop. `put` won't overwrite existing solids/water.
    if (!L->isBackground) {
      const int TREE_REACH = 4;
      for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
        int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
        if (!genTreeAt(worldX, surf)) continue;
        int h = 6 + (int)(whash1(L->gTreeSeed + 1, worldX) * 8);
        int top = surf - h;
        for (int y = top; y < surf; y++) put(lx, y, WOOD);
        for (int oy = -4; oy <= 1; oy++) for (int ox = -3; ox <= 3; ox++) { if (ox * ox + oy * oy > 11) continue; put(lx + ox, top + oy, PLANT); }
      }
    }
    for (int lx = colStart; lx < colEnd; lx++) for (int y = 0; y < rows; y++) { int k = y * cols + lx; next[k] = grid[k]; }
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared, so the two layers share a silhouette but
  // diverge below ground. fg passes 0, bg passes 1 (+ isBackground).
  void initInfiniteLayer(uint32_t seed, uint32_t layerSalt, bool background) {
    L->infinite = true; L->isBackground = background; L->worldSeed = seed;
    L->gSurfAmp = imax(20, (int)std::floor(rows * 0.17));
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.22));
    L->gSeaRow = L->gSurfBase + imax(2, (int)std::floor(rows * 0.03)); // sea level: below-average valleys flood into oceans/lakes
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
    useLayer(&fg); initInfiniteLayer(seed, 0, false); // foreground: caves carved for traversal
    useLayer(&bg); initInfiniteLayer(seed, 1, true);  // background: more-solid backdrop
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

