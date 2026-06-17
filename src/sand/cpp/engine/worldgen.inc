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
  // Terrain top in ABSOLUTE world-Y (centred at worldY=0; smaller = higher). Smooth
  // multi-octave hills/valleys; valleys below the sea row flood (handled in genCellAt).
  int genSurfaceAbs(int worldX) {
    double n = wfbm2(L->worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
    double hills = wfbm2(L->worldSeed ^ 0x9e3779b9u, worldX * SURFACE_FREQ * 0.22, 3.1, 4, 0.5);
    double amp = L->gSurfAmp * (0.75 + hills * 0.6);
    return (int)std::lround(-(n - 0.5) * 2 * amp);
  }
  // Terrain top as a BUFFER row in the current window (may be <0 or >=rows when the
  // surface has scrolled off; genCellAt's `y < surf` test handles that as all-sky /
  // all-underground). Used by spawn + tree placement.
  int genSurfaceAt(int worldX) { return genSurfaceAbs(worldX) - L->worldOffsetY; }
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
  bool genIsCave(int worldX, int worldY) {
    double tun = wridged2(L->gCaveSeed, worldX * CAVE_FREQ, worldY * CAVE_FREQ, 3, 0.5);
    double cav = wfbm2(L->gCaveSeed ^ 0x55u, worldX * CAVE_FREQ * 0.45, worldY * CAVE_FREQ * 0.45, 3, 0.5);
    double caveBias = L->isBackground ? 0.13 : 0.0; // bg: sparser caves
    return tun > CAVE_THRESH + caveBias || cav > 0.74 + caveBias;
  }
  // Absolute-world depth zones (cells below the surface centre, worldY=0). These
  // scale with the viewport but the world is infinitely deep: below the underworld
  // top it's stone + lava forever. Surface->caves->deep ore->underworld lava.
  int caveBottomAbs() { return rows * 9 / 5; }     // caves stop here (~1.8 viewports down)
  int underworldAbs() { return rows * 13 / 5; }    // lava underworld begins (~2.6 down)
  // Sealed liquid/lava chambers in the DEEP stone (below the cave zone, so they're
  // enclosed by solid rock and stay inert until dug into — never cave-adjacent,
  // which would let them drain + churn). The zones are DEPTH-SEPARATED with stone
  // buffers so different liquids never touch (water against lava would steam
  // forever; oil against water would density-swap forever), and each pocket holds
  // a SINGLE liquid (a low-freq region selector) so no two liquids mix. STONE
  // otherwise.
  uint8_t genPocketAt(int worldX, int worldY) {
    int caveBottom = caveBottomAbs(), under = underworldAbs();
    if (worldY < caveBottom) return STONE;
    double p = wridged2(L->gPocketSeed ^ 0x1a7au, worldX * POCKET_FREQ, worldY * POCKET_FREQ, 3, 0.5); // pocket shape
    if (worldY >= under) return p > LAVA_THRESH ? LAVA : STONE;          // underworld: lava only
    if (worldY >= under - 8) return STONE;                               // solid buffer above the lava
    if (p <= WATER_POCKET_THRESH) return STONE;                          // deep zone: water OR oil reservoirs...
    double sel = wfbm2(L->gPocketSeed ^ 0x9bu, worldX * POCKET_FREQ * 0.3, worldY * POCKET_FREQ * 0.3, 2, 0.5);
    return sel < 0.5 ? WATER : OIL;                                      // ...each region a single liquid (no mixing)
  }
  uint8_t genCellAt(int worldX, int surf, int slope, int biome, int soil, int y) {
    int sea = L->gSeaRow - L->worldOffsetY;       // sea level as a buffer row (gSeaRow is absolute)
    if (y < surf) {
      // above the terrain: a valley below the sea row floods with water (a flat,
      // contained ocean that settles); the foreground holds the water, the
      // background is a solid wall behind it. Otherwise it's open sky.
      if (y >= sea) return L->isBackground ? STONE : WATER;
      return EMPTY;
    }
    int depth = y - surf;
    int worldY = L->worldOffsetY + y;             // absolute depth for the cave/underworld zones
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
    // Caves: the foreground gets traversable tunnels; the background gets the same
    // network but SPARSER (genIsCave biases by layer). DRY in the bg (no soil/liquids).
    if (depth >= caveTop && worldY < caveBottomAbs() && genIsCave(worldX, worldY)) return EMPTY;
    if (L->isBackground) return STONE;                       // bg: solid stone, no liquid pockets
    return genPocketAt(worldX, worldY);                      // fg: deep stone + sealed liquids/lava
  }
  bool genTreeAt(int worldX, int surf) {
    if (surf >= L->gSeaRow - L->worldOffsetY) return false;  // at/under water -> no trees
    int biome = genBiomeAt(worldX);
    double prob = biome == BIOME_FOREST ? TREE_PROB * 3.2 : (biome == BIOME_PLAINS ? TREE_PROB : 0.0);
    return whash1(L->gTreeSeed, worldX) < prob;
  }
  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd).
  // A horizontal stream-in passes a column band (full rows); a vertical one passes
  // a row band (full cols); the initial fill is the whole buffer.
  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return; if (grid[y * cols + lx] == EMPTY) grid[y * cols + lx] = m; };
    for (int lx = colStart; lx < colEnd; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = genSurfaceAt(worldX);
      int slope = std::abs(genSurfaceAt(worldX + 1) - genSurfaceAt(worldX - 1));
      int biome = genBiomeAt(worldX); int soil = genSoilDepth(biome);
      for (int y = rowStart; y < rowEnd; y++) grid[y * cols + lx] = genCellAt(worldX, surf, slope, biome, soil, y);
    }
    // Trees (fg only): place only when a tree's footprint can reach this rect.
    if (!L->isBackground) {
      const int TREE_REACH = 4;
      for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
        int worldX = L->worldOffsetX + lx; int surf = genSurfaceAt(worldX);
        if (surf + 2 < rowStart || surf - 16 >= rowEnd) continue; // footprint misses the rect
        if (!genTreeAt(worldX, surf)) continue;
        int h = 6 + (int)(whash1(L->gTreeSeed + 1, worldX) * 8);
        int top = surf - h;
        for (int y = top; y < surf; y++) put(lx, y, WOOD);
        for (int oy = -4; oy <= 1; oy++) for (int ox = -3; ox <= 3; ox++) { if (ox * ox + oy * oy > 11) continue; put(lx + ox, top + oy, PLANT); }
      }
    }
    for (int lx = colStart; lx < colEnd; lx++) for (int y = rowStart; y < rowEnd; y++) { int k = y * cols + lx; next[k] = grid[k]; }
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).
  void initInfiniteLayer(uint32_t seed, uint32_t layerSalt, bool background) {
    L->infinite = true; L->isBackground = background; L->worldSeed = seed;
    L->gSurfAmp = imax(20, (int)std::floor(rows * 0.17));
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.22));
    L->gSeaRow = (int)std::floor(L->gSurfAmp * 0.35); // ABSOLUTE sea level (worldY); valleys below flood
    L->gSoil = imax(2, (int)std::floor(rows * 0.012));
    L->gCaveSeed = (seed ^ 0x5bd1e995u) + layerSalt * 0x9e3779b9u;
    L->gPocketSeed = (seed ^ 0xC0FFEE11u) + layerSalt * 0x85ebca6bu;
    L->gTreeSeed = seed ^ 0x1b56c4f9u; // shared so tree silhouettes line up across layers
    L->worldOffsetX = (-(cols / 2)) & ~(CHUNK_SIZE - 1);   // tile-aligned origin (2D tile store needs alignment)
    L->worldOffsetY = (-L->gSurfBase) & ~(CHUNK_SIZE - 1); // surface centre (worldY=0) ~gSurfBase down the buffer
    fillRect(0, cols, 0, rows);
    registerSeededComponents(0, cols);
  }
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
  // Vertical slide of a row-major buffer by dy rows (dy>0: content moves UP, new
  // band enters at the bottom). A single contiguous memmove (no per-row loop).
  void shiftBufV(uint8_t* arr, int dy, uint8_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols;
    if (dy > 0) { memmove(arr, arr + band, rest); memset(arr + rest, fill, band); }
    else { memmove(arr + band, arr, rest); memset(arr, fill, band); }
  }
  void shiftBufVI32(int32_t* arr, int dy, int32_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols, n = (size_t)rows * cols;
    if (dy > 0) { memmove(arr, arr + band, rest * 4); for (size_t i = rest; i < n; i++) arr[i] = fill; }
    else { memmove(arr + band, arr, rest * 4); for (size_t i = 0; i < band; i++) arr[i] = fill; }
  }
  // Re-index every component after the grid slid by (dx,dy). One axis at a time:
  // each cell's new (col,row) is (x-dx, y-dy); cells that slid off the buffer drop.
  void translateComponents(std::vector<Comp>& list, int dx, int dy) {
    size_t w = 0;
    for (size_t r = 0; r < list.size(); r++) {
      Comp& comp = list[r]; auto& cs = comp.cells; size_t cw = 0; int yMax = 0;
      for (size_t i = 0; i < cs.size(); i++) {
        int k = cs[i]; int nxC = (k % cols) - dx, nyC = (k / cols) - dy;
        if (nxC < 0 || nxC >= cols || nyC < 0 || nyC >= rows) continue; // slid off the buffer
        cs[cw++] = nyC * cols + nxC; if (nyC > yMax) yMax = nyC;
      }
      if (cw == 0) continue;
      cs.resize(cw); comp.yMax = yMax; comp.cacheDirty = true;
      if (w != r) list[w] = std::move(comp);
      w++;
    }
    list.resize(w);
  }
  // ---- 2D tile chunk store: full sim-state persistence keyed by absolute tiles ----
  static inline int64_t tileKey(int tx, int ty) { return ((int64_t)tx << 32) | (uint32_t)ty; }
  // Only WHOLE 32x32 tiles fully inside the buffer are persisted; a partial edge
  // tile (when cols/rows aren't chunk-multiples — e.g. the headless tests) is
  // skipped and just regenerates. The game's buffer is chunk-rounded, so every
  // tile is whole and persistence is complete.
  bool wholeTile(int tx, int ty) { return tx >= 0 && ty >= 0 && tx + CHUNK_SIZE <= cols && ty + CHUNK_SIZE <= rows; }
  void csSaveTiles(int bx0, int by0, int w, int h) { // uses the CURRENT offset (leaving band)
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto& buf = L->tileStore[tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT)];
        if ((int)buf.size() != CHUNK_SIZE * CHUNK_SIZE) buf.resize((size_t)CHUNK_SIZE * CHUNK_SIZE);
        for (int r = 0; r < CHUNK_SIZE; r++) memcpy(buf.data() + (size_t)r * CHUNK_SIZE, grid + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
      }
  }
  bool csTilesAllPresent(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false; // a partial tile is never persisted -> must regenerate
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        if (L->tileStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT)) == L->tileStore.end()) return false;
      }
    return true;
  }
  void csLoadTiles(int bx0, int by0, int w, int h) { // overlay saved tiles (NEW offset); missing left as-is
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->tileStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT));
        if (it == L->tileStore.end()) continue;
        const uint8_t* buf = it->second.data();
        for (int r = 0; r < CHUNK_SIZE; r++) { size_t d = (size_t)(ty + r) * cols + tx; memcpy(grid + d, buf + (size_t)r * CHUNK_SIZE, CHUNK_SIZE); memcpy(next + d, buf + (size_t)r * CHUNK_SIZE, CHUNK_SIZE); }
      }
  }
  void csSaveBodiesLeaving(int bx0, int by0, int w, int h) { // CURRENT offset
    std::vector<Body*> staying;
    for (Body* b : L->bodies) {
      if (b->px >= bx0 && b->px < bx0 + w && b->py >= by0 && b->py < by0 + h) {
        double awx = L->worldOffsetX + b->px, awy = L->worldOffsetY + b->py;
        L->bodyStore[tileKey((int)std::floor(awx) >> CHUNK_SHIFT, (int)std::floor(awy) >> CHUNK_SHIFT)].push_back({b, {awx, awy}});
      } else staying.push_back(b);
    }
    L->bodies = std::move(staying);
  }
  void csRestoreBodies(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->bodyStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT));
        if (it == L->bodyStore.end()) continue;
        for (auto& e : it->second) { Body* b = e.first; b->px = e.second.first - L->worldOffsetX; b->py = e.second.second - L->worldOffsetY; L->bodies.push_back(b); }
        L->bodyStore.erase(it);
      }
  }

  // Slide the loaded window so the camera always has room. cameraCell is the view's
  // left/top cell; returns the applied shift (0 if none). JS slides its GL texture
  // and pulls the camera back. WORLD_SHIFT_* are tile-aligned (the 2D store needs it).
  int maybeShiftWorld(int cameraCellX, int visibleCols, int marginCols) {
    if (!fg.infinite) return 0;
    int dx = 0;
    if (cameraCellX >= cols - visibleCols - marginCols) dx = WORLD_SHIFT_COLS;
    else if (cameraCellX <= marginCols) dx = -WORLD_SHIFT_COLS;
    if (dx) shiftWorld(dx, 0);
    return dx;
  }
  int maybeShiftWorldVertical(int cameraCellY, int visibleRows, int marginRows) {
    if (!fg.infinite) return 0;
    int dy = 0;
    if (cameraCellY >= rows - visibleRows - marginRows) dy = WORLD_SHIFT_ROWS;
    else if (cameraCellY <= marginRows) dy = -WORLD_SHIFT_ROWS;
    if (dy) shiftWorld(0, dy);
    return dy;
  }
  // Slide BOTH layers in lockstep with the shared camera; anchor players once.
  void shiftWorld(int dx, int dy) {
    if ((!dx && !dy) || !fg.infinite) return;
    worldShiftCount++;
    useLayer(&fg); shiftLayer(dx, dy);
    useLayer(&bg); shiftLayer(dx, dy);
    useLayer(&fg);
    for (auto& p : players) { p.px -= dx; p.py -= dy; p.aimX -= dx; p.aimY -= dy; }
  }
  void shiftLayer(int dx, int dy) {
    if ((!dx && !dy) || !L->infinite) return;
    int s = std::abs(dx) + std::abs(dy);
    if (s >= (dx ? cols : rows)) return;
    // leaving / entering buffer rects (one axis only).
    int lx0, ly0, lw, lh, ex0, ey0, ew, eh;
    if (dx) { lh = eh = rows; ly0 = ey0 = 0; lw = ew = s; lx0 = dx > 0 ? 0 : cols - s; ex0 = dx > 0 ? cols - s : 0; }
    else    { lw = ew = cols; lx0 = ex0 = 0; lh = eh = s; ly0 = dy > 0 ? 0 : rows - s; ey0 = dy > 0 ? rows - s : 0; }

    // 1) clear body rasters so no RIGID ghost is saved/memmoved.
    for (int k : L->bodyCells) { if (grid[k] == RIGID) grid[k] = EMPTY; if (next[k] == RIGID) next[k] = EMPTY; bodyOwner[k] = -1; }
    L->bodyCells.clear();
    // 2) persist the leaving band (bodies + full-state tiles) at the CURRENT offset.
    csSaveBodiesLeaving(lx0, ly0, lw, lh);
    csSaveTiles(lx0, ly0, lw, lh);
    // 3) slide the buffers + dirty marks.
    double _t = emscripten_get_now();
    if (dx) {
      shiftRowMajorU8(grid, dx, EMPTY); shiftRowMajorU8(next, dx, EMPTY); shiftRowMajorI32(bodyOwner, dx, -1);
      for (int y = 0; y < rows; y++) { if (rowMarkMax[y] < rowMarkMin[y]) continue; int mn = rowMarkMin[y] - dx, mx = rowMarkMax[y] - dx; if (mx < 0 || mn > cols - 1) { rowMarkMin[y] = cols; rowMarkMax[y] = -1; continue; } rowMarkMin[y] = mn < 0 ? 0 : mn; rowMarkMax[y] = mx > cols - 1 ? cols - 1 : mx; }
    } else {
      shiftBufV(grid, dy, EMPTY); shiftBufV(next, dy, EMPTY); shiftBufVI32(bodyOwner, dy, -1);
      if (dy > 0) for (int y = 0; y < rows; y++) { int sy = y + dy; rowMarkMin[y] = sy < rows ? rowMarkMin[sy] : cols; rowMarkMax[y] = sy < rows ? rowMarkMax[sy] : -1; }
      else for (int y = rows - 1; y >= 0; y--) { int sy = y + dy; rowMarkMin[y] = sy >= 0 ? rowMarkMin[sy] : cols; rowMarkMax[y] = sy >= 0 ? rowMarkMax[sy] : -1; }
    }
    std::fill(compOccStamp, compOccStamp + (size_t)cols * rows, -1);
    std::fill(vacatedStamp, vacatedStamp + (size_t)cols * rows, -1);
    perfShiftBuffers = emscripten_get_now() - _t;
    // 4) translate staying bodies; drop any fully off the buffer.
    { std::vector<Body*> keep; for (Body* b : L->bodies) { b->px -= dx; b->py -= dy; if (b->px > -b->maxR && b->px < cols + b->maxR && b->py > -b->maxR && b->py < rows + b->maxR) keep.push_back(b); else delete b; } L->bodies = std::move(keep); }
    // 5) advance the offset, then bring in the entering band: generate the baseline
    //    only if not fully cached, then overlay any saved tiles + restore bodies.
    L->worldOffsetX += dx; L->worldOffsetY += dy;
    _t = emscripten_get_now();
    if (!csTilesAllPresent(ex0, ey0, ew, eh)) { if (dx) fillRect(ex0, ex0 + ew, 0, rows); else fillRect(0, cols, ey0, ey0 + eh); }
    csLoadTiles(ex0, ey0, ew, eh);
    csRestoreBodies(ex0, ey0, ew, eh);
    perfShiftFill = emscripten_get_now() - _t;
    // 6) mark the entering band active so it simulates.
    if (dx) for (int y = 0; y < rows; y++) { if (ex0 < rowMarkMin[y]) rowMarkMin[y] = ex0; if (ex0 + s - 1 > rowMarkMax[y]) rowMarkMax[y] = ex0 + s - 1; }
    else for (int y = ey0; y < ey0 + s; y++) { rowMarkMin[y] = 0; rowMarkMax[y] = cols - 1; }
    // 7) re-index components, register the entering band.
    _t = emscripten_get_now();
    translateComponents(L->stoneComponents, dx, dy);
    translateComponents(L->plantComponents, dx, dy);
    translateComponents(L->iceComponents, dx, dy);
    perfShiftTranslate = emscripten_get_now() - _t;
    _t = emscripten_get_now();
    if (dx) registerSeededComponents(ex0, ex0 + s, 0, rows);
    else registerSeededComponents(0, cols, ey0, ey0 + s);
    perfShiftRegister = emscripten_get_now() - _t;
  }
  void shiftRowMajorI32(int32_t* arr, int dx, int32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * 4); for (int i = b + cols - dx; i < b + cols; i++) arr[i] = fill; }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, (size_t)(cols - s) * 4); for (int i = b; i < b + s; i++) arr[i] = fill; } }
  }

