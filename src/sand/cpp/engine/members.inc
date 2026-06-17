  // ================= TWO SIMULATION LAYERS =================
  // The engine simulates two independent grids: a foreground (`fg`) and a
  // background (`bg`). Each `Layer` holds ALL the per-cell simulation state
  // (grids, dirty tracking, components, rigid bodies, chunk store, terrain,
  // render pixels). The shared subsystems (camera, GL, networking, players,
  // tools, tick, RNG, render tables) stay on the Engine.
  //
  // To avoid threading a layer pointer through the hot settle path, the Engine
  // keeps raw-pointer MIRRORS of every indexed per-cell buffer (`grid`, `next`,
  // `vacatedStamp`, ...). `useLayer(lay)` repoints them at the active layer, so
  // the thousands of `buf[k]` accesses in core/components/reactions/... are
  // unchanged. Collections + scalars live on `Layer` and are reached via `L->`.
  struct Layer {
    struct MatBand { int width = 0; std::vector<uint8_t> buf; };
    // double buffer + the "current"/"next" pointers (alternate each step)
    std::vector<uint8_t> gridA, gridB; uint8_t* grid = nullptr; uint8_t* next = nullptr;
    // dirty tracking (per-layer active region)
    std::vector<uint8_t> dirtyRender;
    std::vector<int32_t> dirtyRects;
    std::vector<int32_t> rowMarkMin, rowMarkMax, chunkStamp, activeRowMin, activeRowMax, vacatedStamp;
    int dirtyRenderCount = 0;
    // per-cell sim scratch
    std::vector<uint8_t> groundedCell;
    std::vector<int32_t> cellComp, groundStack, compOccStamp;
    // generation-stamped "seen" scratch for component flood fills (reused across
    // calls; a cell is "seen" iff seenStamp[k] == seenGen, so a clear is just gen++).
    std::vector<int32_t> seenStamp; int32_t seenGen = 0;
    std::vector<int> prevCompCells, curCompCells, bodyCells;
    std::vector<uint8_t> reactionFlags;
    std::vector<int32_t> reactionSteam, reactionFires, reactionIgnite;
    // components + ids
    std::vector<Comp> stoneComponents, plantComponents, iceComponents;
    int nextStoneId = 1, nextPlantId = 1, nextIceId = 1;
    // free rigid bodies + ownership
    std::vector<Body*> bodies; int nextBodyId = 1;
    std::vector<int32_t> bodyOwner;
    // worldgen / streaming (per-layer terrain + chunk store)
    bool infinite = false;
    bool isBackground = false; // bg = a more-solid backdrop (sparser caves) behind the carved fg
    int worldOffsetX = 0;
    uint32_t worldSeed = 0;
    int gSurfAmp = 0, gSurfBase = 0, gSeaRow = 0, gSoil = 0;
    uint32_t gCaveSeed = 0, gTreeSeed = 0, gPocketSeed = 0;
    std::unordered_map<int, MatBand> matStore;                                // worldX -> saved band
    std::unordered_map<int, std::vector<std::pair<Body*, double>>> bodyStore; // worldX -> [(body, worldPx)]
    // render pixels for this layer (cols*rows*4 RGBA)
    std::vector<uint8_t> renderPixels;

    void alloc(int cols, int rows, int chunkCols, int chunkRows) {
      size_t n = (size_t)cols * rows;
      gridA.assign(n, EMPTY); gridB.assign(n, EMPTY);
      grid = gridA.data(); next = gridB.data();
      dirtyRender.assign((size_t)chunkCols * chunkRows, 0);
      rowMarkMin.assign(rows, cols); rowMarkMax.assign(rows, -1);
      chunkStamp.assign((size_t)chunkCols * chunkRows, -1);
      activeRowMin.assign(rows, 0); activeRowMax.assign(rows, 0);
      vacatedStamp.assign(n, -1);
      groundedCell.assign(n, 0); cellComp.assign(n, -1); groundStack.assign(n, 0);
      compOccStamp.assign(n, -1);
      seenStamp.assign(n, 0); seenGen = 0;
      reactionFlags.assign(n, 0); reactionSteam.assign(n, 0); reactionFires.assign(n, 0); reactionIgnite.assign(n, 0);
      bodyOwner.assign(n, -1);
      renderPixels.assign(n * 4, 0);
    }
    ~Layer() {
      for (Body* b : bodies) delete b;
      for (auto& kv : bodyStore) for (auto& e : kv.second) delete e.first;
    }
  };

  int cols, rows, chunkCols, chunkRows;
  Layer fg, bg;       // the two simulations
  Layer* L = &fg;     // active layer (the mirrors below point into it)

  // ---- raw-pointer mirrors of the active layer's indexed buffers ----
  // Repointed by useLayer(); the hot per-cell code indexes these unchanged.
  uint8_t* grid = nullptr; uint8_t* next = nullptr;
  uint8_t* dirtyRender = nullptr; uint8_t* groundedCell = nullptr; uint8_t* reactionFlags = nullptr;
  int32_t* rowMarkMin = nullptr; int32_t* rowMarkMax = nullptr; int32_t* chunkStamp = nullptr;
  int32_t* activeRowMin = nullptr; int32_t* activeRowMax = nullptr; int32_t* vacatedStamp = nullptr;
  int32_t* cellComp = nullptr; int32_t* groundStack = nullptr; int32_t* compOccStamp = nullptr;
  int32_t* reactionSteam = nullptr; int32_t* reactionFires = nullptr; int32_t* reactionIgnite = nullptr;
  int32_t* bodyOwner = nullptr;

  // Point the mirrors at `lay` and make it the active layer.
  void useLayer(Layer* lay) {
    L = lay;
    grid = lay->grid; next = lay->next;
    dirtyRender = lay->dirtyRender.data();
    groundedCell = lay->groundedCell.data();
    reactionFlags = lay->reactionFlags.data();
    rowMarkMin = lay->rowMarkMin.data(); rowMarkMax = lay->rowMarkMax.data();
    chunkStamp = lay->chunkStamp.data();
    activeRowMin = lay->activeRowMin.data(); activeRowMax = lay->activeRowMax.data();
    vacatedStamp = lay->vacatedStamp.data();
    cellComp = lay->cellComp.data(); groundStack = lay->groundStack.data();
    compOccStamp = lay->compOccStamp.data();
    reactionSteam = lay->reactionSteam.data(); reactionFires = lay->reactionFires.data();
    reactionIgnite = lay->reactionIgnite.data();
    bodyOwner = lay->bodyOwner.data();
  }
  // Persist the (possibly swapped) current/next buffer identity back to the layer.
  void flushLayerGrids() { L->grid = grid; L->next = next; }
  // Non-consuming check: does a layer have any active row marks this step?
  bool layerActive(Layer* lay) {
    for (int y = 0; y < rows; y++) if (lay->rowMarkMax[y] >= lay->rowMarkMin[y]) return true;
    return false;
  }

  int stepSerial = 0, tick = 0, perfDirtyChunks = 0, worldShiftCount = 0;
  int rigidRejectedCells = 0, rigidDepenetrations = 0;
  double perfStepMs = 0;
  double perfShiftBuffers = 0, perfShiftTranslate = 0, perfShiftRegister = 0, perfShiftFill = 0;
  double perfStepGround = 0, perfStepRigid = 0, perfStepReact = 0, perfStepCarry = 0, perfStepSettle = 0, perfStepTail = 0;
  bool sinksEnabled;
  uint32_t rngState;
  // Cross-layer transfer only runs once the background is "real" (has generated
  // terrain or placed material). An empty/untouched background does not interact,
  // so a pure single-layer scene (e.g. the headless tests) is byte-identical.
  bool bgEnabled = false;
  // When bgEnabled, step() runs ONE joint grounding flood over both layers up
  // front (computeGroundedBoth) so solids support solids across layers; this flag
  // tells each stepLayer() to skip its own per-layer computeGrounded() (the first
  // one — moveBodies still re-derives per-layer grounding for free bodies/sand).
  bool jointGroundReady = false;
  // ---- tool / pointer state (input policy ported from createSandGame) ----
  int activeTool = T_CUBE;
  bool lmbDown = false, rmbDown = false;
  // The active draft (stone/ice/seed staging) targets this layer: 0 = foreground
  // (LMB), 1 = background (RMB). The draft set is shared staging; finalize writes
  // into the layer chosen here on pointerDown.
  int draftLayer = 0;
  std::unordered_set<int> stoneDraft, iceDraft;
  std::vector<int> draftSnapshot;
  bool draftingStone = false, draftingIce = false, draftingSeed = false, draftIsDriftwood = false;
  bool hasSeedOrigin = false; int seedOriginX = 0, seedOriginY = 0;
  double lastEmitMs = -1e9;
  // ---- players (Terraria-like characters; physics in player.inc) ----
  std::vector<Player> players;
  int nextPlayerId = 1;
  std::vector<float> playerSnapshot; // packed [PLAYER_SNAP_STRIDE] floats per player
  int playerActionCount = 0;         // total player tool actions fired (debug/test)
  std::vector<uint8_t> netBlob;      // scratch buffer for world snapshot / diff serialization
  // Renderer tables (material -> RGBA). Shared (layer-agnostic). Uses a SEPARATE
  // rng so per-frame fire/steam flicker never perturbs the simulation.
  uint32_t renderVariants[TABLE * 8]; // 8 brightness-shifted shades per material
  uint8_t renderNoise[64 * 64];       // stable per-cell grain selector (0..7)
  uint32_t renderRngState = 0;

  inline double rand() {
    rngState = (rngState + 0x6d2b79f5u);
    uint32_t a = rngState;
    uint32_t t = a ^ (a >> 15); t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7); t = (t + (t2 * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
  inline double renderRand() {
    renderRngState = (renderRngState + 0x6d2b79f5u);
    uint32_t a = renderRngState;
    uint32_t t = a ^ (a >> 15); t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7); t = (t + (t2 * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
  inline int I(int x, int y) { return y * cols + x; }

  Engine(int c, int r, uint32_t seed, bool sinks) : cols(c), rows(r), sinksEnabled(sinks), rngState(seed) {
    chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
    chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;
    fg.alloc(cols, rows, chunkCols, chunkRows);
    bg.alloc(cols, rows, chunkCols, chunkRows);
    useLayer(&fg);
    renderRngState = seed ^ 0x9e3779b9u;
    buildRenderTables();
  }
  ~Engine() { glDestroy(); }

  // ---- predicates ----
  inline bool isPlantMaterial(uint8_t m) { return m == SEED || m == WOOD || m == PLANT || m == DRIFTWOOD; }
  inline bool isDissolvable(uint8_t m) { return m == SAND || m == STONE || m == WOOD || m == PLANT || m == SEED || m == DRIFTWOOD; }
  inline bool isRigidMaterial(uint8_t m) { return m == STONE || m == WOOD || m == PLANT || m == SEED || m == ICE || m == RIGID || m == DRIFTWOOD; }
  inline bool isFlammable(uint8_t m) { return m == OIL || isPlantMaterial(m); }
  inline bool isBearingMaterial(uint8_t m) { return m == SAND || isRigidMaterial(m); }
  inline bool isLiquid(uint8_t m) { return MAT_KIND[m] == K_LIQUID; }
  inline bool isGas(uint8_t m) { return MAT_KIND[m] == K_GAS; }
  inline bool componentDisplaceable(uint8_t m) { return m == EMPTY || m == SAND || isLiquid(m) || isGas(m); }
  inline bool isInBounds(int x, int y) { return x > 0 && x < cols - 1 && y > 0 && y < rows; }

  // ---- dirty tracking (operates on the active layer via the mirrors) ----
  inline void markCellIndex(int k) {
    int y = k / cols, x = k - y * cols;
    if (x < rowMarkMin[y]) rowMarkMin[y] = x;
    if (x > rowMarkMax[y]) rowMarkMax[y] = x;
  }
  void markDirtyRect(int x0, int y0, int x1, int y1) {
    int mx0 = imax(0, x0), mx1 = imin(cols - 1, x1), my0 = imax(0, y0), my1 = imin(rows - 1, y1);
    for (int y = my0; y <= my1; y++) {
      if (mx0 < rowMarkMin[y]) rowMarkMin[y] = mx0;
      if (mx1 > rowMarkMax[y]) rowMarkMax[y] = mx1;
    }
  }
  void markAllDirty() { for (int y = 0; y < rows; y++) { rowMarkMin[y] = 0; rowMarkMax[y] = cols - 1; } }
  // Fully reset dirty tracking (row marks + render chunk flags) for the active layer.
  void clearAllDirty() {
    for (int y = 0; y < rows; y++) { rowMarkMin[y] = cols; rowMarkMax[y] = -1; }
    memset(dirtyRender, 0, (size_t)chunkCols * chunkRows); L->dirtyRenderCount = 0;
  }
  void foldRowMarksToRender() {
    for (int y = 0; y < rows; y++) {
      int mn = rowMarkMin[y], mx = rowMarkMax[y];
      if (mx < mn) continue;
      int px0 = imax(0, mn - DIRTY_PAD_X), px1 = imin(cols - 1, mx + DIRTY_PAD_X);
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      int c0 = px0 >> CHUNK_SHIFT, c1 = px1 >> CHUNK_SHIFT, cy0 = py0 >> CHUNK_SHIFT, cy1 = py1 >> CHUNK_SHIFT;
      for (int cy = cy0; cy <= cy1; cy++) {
        int rb = cy * chunkCols;
        for (int cx = c0; cx <= c1; cx++) { int ci = rb + cx; if (!dirtyRender[ci]) { dirtyRender[ci] = 1; L->dirtyRenderCount++; } }
      }
    }
  }
  // Coalesce the per-chunk dirty flags into cell-space rectangles for the active
  // layer: [x0,y0,x1,y1) EXCLUSIVE, packed into L->dirtyRects.
  void buildDirtyRects() {
    foldRowMarksToRender();
    L->dirtyRects.clear();
    for (int cy = 0; cy < chunkRows; cy++) {
      int cy0 = cy * CHUNK_SIZE, cy1 = imin(rows, cy0 + CHUNK_SIZE), rb = cy * chunkCols, cx = 0;
      while (cx < chunkCols) {
        if (!dirtyRender[rb + cx]) { cx++; continue; }
        int startCx = cx;
        while (cx + 1 < chunkCols && dirtyRender[rb + cx + 1]) cx++;
        int x0 = startCx * CHUNK_SIZE, x1 = imin(cols, (cx + 1) * CHUNK_SIZE);
        L->dirtyRects.push_back(x0); L->dirtyRects.push_back(cy0);
        L->dirtyRects.push_back(x1); L->dirtyRects.push_back(cy1);
        cx++;
      }
    }
  }
  bool beginStepDirty() {
    foldRowMarksToRender();
    for (int y = 0; y < rows; y++) { activeRowMin[y] = cols; activeRowMax[y] = -1; }
    bool hasActive = false;
    for (int y = 0; y < rows; y++) {
      int mn = rowMarkMin[y], mx = rowMarkMax[y];
      if (mx < mn) continue;
      hasActive = true;
      rowMarkMin[y] = cols; rowMarkMax[y] = -1;
      int px0 = imax(0, mn - DIRTY_PAD_X), px1 = imin(cols - 1, mx + DIRTY_PAD_X);
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      for (int yy = py0; yy <= py1; yy++) { if (px0 < activeRowMin[yy]) activeRowMin[yy] = px0; if (px1 > activeRowMax[yy]) activeRowMax[yy] = px1; }
    }
    if (!hasActive) return false;
    stepSerial++; perfDirtyChunks = 0;
    for (int y = 0; y < rows; y++) {
      int mn = activeRowMin[y], mx = activeRowMax[y];
      if (mx < mn) continue;
      int rb = (y >> CHUNK_SHIFT) * chunkCols;
      for (int cx = mn >> CHUNK_SHIFT, c1 = mx >> CHUNK_SHIFT; cx <= c1; cx++) { int ci = rb + cx; if (chunkStamp[ci] != stepSerial) { chunkStamp[ci] = stepSerial; perfDirtyChunks++; } }
    }
    return true;
  }
  void prepareNextBuffer() {
    for (int y = 0; y < rows; y++) {
      int rs = y * cols, minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX >= minX) memset(next + rs + minX, EMPTY, (size_t)(maxX - minX + 1));
    }
  }

  // ---- cell helpers ----
  inline bool emptyAt(int x, int y) { return x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] == EMPTY && next[I(x, y)] == EMPTY; }
  inline bool touchesGridEmpty(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && grid[k - 1] == EMPTY) || (x < cols - 2 && grid[k + 1] == EMPTY) ||
           (y > 1 && grid[k - cols] == EMPTY) || (y < rows - 1 && grid[k + cols] == EMPTY);
  }
  // A liquid only stays "active" if it has somewhere to FLOW — empty to a side or
  // below. Empty ABOVE (open sky over a flat surface) is NOT an escape: liquid
  // never flows up, so a surface cell blocked on its sides + below has settled and
  // should go inert instead of re-marking itself dirty every step forever (the
  // shimmer + the per-step diff churn that broke open oceans in multiplayer). It
  // re-wakes normally when a neighbour changes (dirty padding covers the gap).
  inline bool liquidCanEscape(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && grid[k - 1] == EMPTY) || (x < cols - 2 && grid[k + 1] == EMPTY) ||
           (y < rows - 1 && grid[k + cols] == EMPTY);
  }
  inline void writeGridIndex(int k, uint8_t m) { if (grid[k] == m) return; grid[k] = m; markCellIndex(k); }
  inline bool isLooseDensityMaterial(uint8_t m) { return DENSITY_SORTED[m] == 1; }
  inline bool canDisplaceByLooseDensity(uint8_t m, uint8_t d) { return isLooseDensityMaterial(m) && isLooseDensityMaterial(d) && DENSITY[m] > DENSITY[d]; }
  inline bool touchesUnstableLooseDensityInterface(int k, uint8_t m) {
    if (!isLooseDensityMaterial(m)) return false;
    int y = k / cols;
    return (y < rows - 1 && canDisplaceByLooseDensity(m, grid[k + cols])) || (y > 1 && canDisplaceByLooseDensity(grid[k - cols], m));
  }
  inline void writeNextIndex(int k, uint8_t m) {
    if (next[k] == m) return;
    next[k] = m;
    if (grid[k] != m || m == FIRE || m == STEAM || (isLiquid(m) && liquidCanEscape(k)) || touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
  }
  inline bool canDisplaceMaterial(uint8_t m, uint8_t d) { if (isGas(d)) return true; return canDisplaceByLooseDensity(m, d); }
  inline bool canEnterIndex(int k, uint8_t m) { return next[k] == EMPTY && (grid[k] == EMPTY || canDisplaceMaterial(m, grid[k])); }
  inline bool canLiquidEnter(int x, int y, uint8_t m) { return x >= 0 && x < cols && y >= 0 && y < rows && canEnterIndex(I(x, y), m); }
  inline bool supportsLiquid(uint8_t s, uint8_t m) { return s != EMPTY && s != m && !canDisplaceMaterial(m, s); }
  void moveMaterialInto(int fromK, int toK, uint8_t m) {
    uint8_t displaced = grid[toK];
    writeNextIndex(toK, m);
    vacatedStamp[fromK] = tick;
    if (displaced != EMPTY && canDisplaceMaterial(m, displaced) && next[fromK] == EMPTY && vacatedStamp[toK] != tick) writeNextIndex(fromK, displaced);
  }
  inline void moveLiquidInto(int fromK, int x, int y, uint8_t m) { moveMaterialInto(fromK, I(x, y), m); }

  static const int DIRS_LF[2];
  static const int DIRS_RF[2];

