  // Engine-owned state and two simulation layers.
  //
  // The engine simulates two independent grids: a foreground (`fg`) and a
  // background (`bg`). Each `Layer` owns the per-cell state for its storage role
  // (grids, dirty tracking, components, rigid bodies, chunk store, terrain,
  // render pixels). Presentation and authority storage roles omit the half they
  // never use. The shared subsystems (camera, GL, networking, players, tools,
  // tick, RNG, render tables) stay on the Engine.
  //
  // To avoid threading a layer pointer through the hot settle path, the Engine
  // keeps raw-pointer MIRRORS of every indexed per-cell buffer (`L->grid`, `L->next`,
  // `L->vacatedStamp`, ...). `useLayer(lay)` repoints them at the active layer, so
  // the thousands of `buf[k]` accesses in core/components/reactions/... are
  // unchanged. Collections + scalars live on `Layer` and are reached via `L->`.
  int cols, rows, chunkCols, chunkRows;
  EngineStorageRole storageRole;
  Layer fg, bg;       // the two simulations
  Layer* L = &fg;     // active layer (the mirrors below point into it)
#ifdef __EMSCRIPTEN_PTHREADS__
  ParallelPool chunkPool;
  std::vector<Comp*> carryComps;
  std::vector<size_t> carryOffsets;
  std::vector<std::vector<uint64_t>> adjChunkPairs;
  // Per-row movement candidates are gathered concurrently, then concatenated
  // in the legacy traversal order so settle RNG and checksums stay identical.
  std::vector<std::vector<int>> densityRows, sandRows, liquidRows, gasRows;
  std::vector<std::vector<int>> reactionRows;
#endif

  // Make `lay` the active layer. The old raw-pointer mirrors of its indexed
  // buffers are gone (5g): hot code reads through L-> (Layer::L->grid/L->next are
  // already raw pointers; the vectors index directly).
  void useLayer(Layer* lay) { L = lay; }
  // Non-consuming check: does a layer have any active row marks this step?
  bool layerActive(Layer* lay) {
    if (!lay->pendingDetonations.empty()) return true;
    for (Body* b : lay->bodies) if (b->material == TNT && b->fuseTicks > 0) return true;
    for (int y = 0; y < rows; y++) if (lay->rowMarkMax[y] >= lay->rowMarkMin[y]) return true;
    return false;
  }

  int stepSerial = 0, tick = 0, actorTick = 0, worldShiftCount = 0;
  // Last-step volume counters (accumulated across both layers in beginStepDirty /
  // end-of-step component scan). Zeroed at the start of each step().
  int perfDirtyChunks = 0, perfDirtyRows = 0, perfDirtyCells = 0;
  int perfComponentCount = 0, perfComponentCellCount = 0, perfCrossBondCount = 0;
  double perfStepMs = 0, perfActorMs = 0;
  // Present-path sub-phase timers (gl.inc glRenderFrame): the full-buffer lighting
  // solve, the windowed pixel fill, and the windowed texture upload. Render-only.
  double perfLightMs = 0, perfFillMs = 0, perfUploadMs = 0;
  double perfShiftBuffers = 0, perfShiftTranslate = 0, perfShiftRegister = 0, perfShiftFill = 0;
  // Predictive worldgen prefetch (worldgen.inc): amortize the shift's fillRect over
  // the off-screen frames before the boundary is crossed. Generates the upcoming
  // stream-in band into the tileStore a slice per frame so the shift can skip
  // fillRect. pfGrid is a scratch band buffer; the stage machine spans fg then bg.
  enum { PF_FG_TERRAIN = 0, PF_BG_TERRAIN = 1, PF_DONE = 2 };
  std::vector<uint8_t> pfGrid;
  int pfDx = 0, pfDy = 0, pfStage = PF_DONE, pfCursor = 0;
  int pfEx0 = 0, pfEy0 = 0, pfEw = 0, pfEh = 0; // entering band rect being prefetched
  int shiftFillHit = 0, shiftFillMiss = 0;      // per-layer shift: band cached vs fillRect fallback
  // Fine step-phase timers (ms). Dual-layer: ACCUMULATED across both stepLayer
  // calls (+ joint/cross at step level). Zeroed at the start of each step().
  double perfGroundingMs = 0;            // per-layer ensureGrounded + joint groundLayerBase
  double perfCrossLayerGroundingMs = 0;  // joint bond scan + UF after base floods
  double perfComponentIndexMs = 0;       // indexComponents() (inside grounding)
  double perfAssemblyUnionMs = 0;        // moveRigidAssemblies + cross-layer assembly move
  double perfCarryMs = 0;
  double perfBodyMs = 0;                 // free rigid bodies (moveBodies)
  double perfSandMs = 0;                 // density interface + settleSand
  double perfLiquidMs = 0;               // liquids + density-chain relocate
  double perfGasMs = 0;                  // fire/steam rise
  double perfReactMs = 0;
  double perfTailMs = 0;                 // swap + liquid relax/level/sinks
  double perfLayersMs = 0;               // wall time of both stepLayer() calls
  double perfCrossMs = 0;                // post-layer joint refresh + cross react/transfer
  bool sinksEnabled;
  uint32_t rngState;
  // Cross-layer transfer only runs once the background is "real" (has generated
  // terrain or placed material). An empty/untouched background does not interact,
  // so a pure single-layer scene (e.g. the headless tests) is byte-identical.
  bool bgEnabled = false;
  bool deferStructureThisTick = false;
  // When bgEnabled, step() runs ONE joint grounding flood over both layers up
  // front (computeGroundedBoth) so solids support solids across layers; this flag
  // tells each stepLayer() to skip its own per-layer computeGrounded() (the first
  // one — moveBodies still re-derives per-layer grounding for free bodies/sand).
  std::vector<int> acidErasedStone, acidErasedIce, reactionErasedPlant; // reusable reaction scratch (avoids heap allocs every active step)
  std::vector<int> crossFireErasedFg, crossFireErasedBg;
  std::vector<int> activeWaterCells, activeFireCells, activeAcidCells, activeLavaCells, activeSaltCells, activeHeatCells;
  std::vector<int> activeDensityCells, activeSandCells, activeLiquidCells, activeGasCells, activeGasRow;
  std::vector<int64_t> acidCrossPairs;             // unique touched joint pairs, checked once after an acid batch
  std::vector<int> surfAbsScratch;                 // reusable per-band surface-height cache for fillTerrain
  std::unordered_set<int> lavaHardenedScratch;     // reusable per-call scratch for applyLava
  std::vector<int> iceMeltedScratch;               // reusable per-call scratch for applyIce
  std::vector<int> reactionSnowMelt;               // reusable per-call scratch for applyReactions (snow melted by fire -> water)
  // Liquid↔liquid density-chain displacement: denser liquid treats lighter liquid as
  // free volume for movement; the displaced lighter liquid is relocated after the
  // settle pass by a multi-source BFS (resolveLiquidDisplacements in core.inc).
  // from = cell the lighter liquid occupied; fallback = a real free cell (denser's
  // vacated source), propagated through chains — never the overwritten target.
  struct LiquidDisp { uint8_t material; int from; int fallback; };
  std::vector<LiquidDisp> liquidDispPending;
  // ---- players (Terraria-like characters; physics in player.inc) ----
  // ---- dropped items + particles (entities; physics in items.inc) ----
  bool survivalInventory = false;         // survival mining->drops->inventory (set from JS)
  bool creaturesEnabled = false;          // advance existing creature actors
  bool creatureNaturalSpawning = false;   // survival or explicit /fps population mode
  int playerActionCount = 0;         // total player tool actions fired (debug/test)
  inline double rand() {
    rngState = (rngState + 0x6d2b79f5u);
    uint32_t a = rngState;
    uint32_t t = a ^ (a >> 15); t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7); t = (t + (t2 * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
  inline int I(int x, int y) { return y * cols + x; }

#ifdef __EMSCRIPTEN_PTHREADS__
  // Execute spatially independent chunks in four checkerboard waves. Adjacent
  // chunks never run in the same wave, leaving a full CHUNK_SIZE guard band for
  // cell rules that inspect or write across their own edge. The ordinary WASM
  // build uses the exact same order serially; the pthread build distributes the
  // chunks in each wave over Emscripten's fixed worker pool.
  template <typename Fn>
  void forEachCheckerboardChunk(Fn&& fn) {
    const int count = chunkCols * chunkRows;
    for (int color = 0; color < 4; color++) {
      chunkPool.parallelFor(count, [&](int ci) {
        int cy = ci / chunkCols, cx = ci - cy * chunkCols;
        if (((cx & 1) | ((cy & 1) << 1)) != color) return;
        fn(cx, cy);
      });
    }
  }
#endif

  Engine(int c, int r, uint32_t seed, bool sinks, EngineStorageRole role = ESR_FULL)
      : cols(c), rows(r), storageRole(role), sinksEnabled(sinks), rngState(seed) {
    chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
    chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;
    fg.alloc(cols, rows, chunkCols, chunkRows, storageRole);
    bg.alloc(cols, rows, chunkCols, chunkRows, storageRole);
    useLayer(&fg);
    renderer.init(seed); // render-only RNG + shade/noise tables (separate stream)
    initSurvivalFootprints();
  }
  ~Engine() { glDestroy(); }

  // ---- material predicates ----
  // Material id is exact identity. MAT_CLASS is the broad gameplay/physics
  // bucket, MAT_FLAGS are extra traits, and MAT_CGROUP routes static component
  // storage/splitting. Adding a material that reuses existing physics should
  // need only a schema entry.
  inline bool isEmptyMaterial(uint8_t m) { return m == EMPTY || MAT_CLASS[m] == MC_NONE; }
  inline bool isGasMaterial(uint8_t m) { return MAT_CLASS[m] == MC_GAS; }
  inline bool canGasRiseThrough(uint8_t rising, uint8_t upper) {
    return isGasMaterial(rising) && isGasMaterial(upper) && DENSITY[rising] < DENSITY[upper];
  }
  inline bool isLiquidMaterial(uint8_t m) { return MAT_CLASS[m] == MC_LIQUID; }
  inline bool isLooseSolidMaterial(uint8_t m) { return MAT_CLASS[m] == MC_SOLID; }
  inline bool isRigidMaterialClass(uint8_t m) { return MAT_CLASS[m] == MC_RIGID; }
  inline bool isComponentMaterial(uint8_t m) { return MAT_CGROUP[m] != CG_NONE; }
  inline uint8_t componentGroupOf(uint8_t m) { return MAT_CGROUP[m]; }
  inline bool isStoneComponentMaterial(uint8_t m) { return MAT_CGROUP[m] == CG_STONE; }
  inline bool isPlantComponentMaterial(uint8_t m) { return MAT_CGROUP[m] == CG_PLANT; }
  inline bool isIceComponentMaterial(uint8_t m) { return MAT_CGROUP[m] == CG_ICE; }
  inline bool hasRigidFlag(uint8_t m) { return MAT_FLAGS[m] & MF_RIGID; }
  inline bool isPlantMaterial(uint8_t m) { return MAT_FLAGS[m] & MF_PLANTFAMILY; }
  inline bool isDissolvable(uint8_t m) { return MAT_FLAGS[m] & MF_DISSOLVABLE; }
  inline bool isFlammable(uint8_t m) { return MAT_FLAGS[m] & MF_FLAMMABLE; }
  inline bool isLavaQuencher(uint8_t m) { return MAT_FLAGS[m] & MF_QUENCHESLAVA; }
  // Liquids that fill 1-cell gaps in a resting layer (relaxLiquidGaps).
  // LAVA still omits the flag (slow/thick); BRINE has it so submerged/free
  // brine pools coalesce and go inert instead of shimmering on ragged holes.
  inline bool relaxesGaps(uint8_t m) { return MAT_FLAGS[m] & MF_RELAXESGAPS; }
  inline bool isBearingMaterial(uint8_t m) { return MAT_FLAGS[m] & MF_BEARING; }
  inline bool isBlastDamageable(uint8_t m) { return !isEmptyMaterial(m) && !isGasMaterial(m); }
  inline bool isLooseMedium(uint8_t m) { return isLiquidMaterial(m) || isLooseSolidMaterial(m); }
  inline bool isBuoyantMedium(uint8_t m) { return isLooseMedium(m); }
  inline bool isBlockingForPlayer(uint8_t m) { return !isEmptyMaterial(m) && !isGasMaterial(m) && !isLiquidMaterial(m); }
  inline bool isMineable(uint8_t m) { return !isEmptyMaterial(m) && !isGasMaterial(m); }
  // Which rigid-component list a destroyed L->grid cell belongs to mirrors
  // registerComponentCells' routing (CG_ICE -> ice, CG_PLANT -> plant via
  // isPlantMaterial, else stone). EVERY site that clears a component cell from the
  // L->grid (erase, mine, acid) must feed it to splitRigidAfterErase via
  // componentGroupOf, or the body keeps an invisible cell that still
  // collides/grounds — sand floats on the hole and powders/liquids won't pass.
  // Keyed on group, not material id, so new ores/blocks (sandstone, brick, …)
  // are covered with no edit here.
  // Flora-type material classification: which plant-family materials act as a tree
  // trunk vs foliage, and the species<->material mapping. A plant comp is a single
  // species, so its trunk/leaf material is derived from its plantType (and vice
  // versa when re-registering streamed-in cells). DRIFTWOOD/VINE are neither, so
  // they never act as a growth source (driftwood stays non-growing as before).
  inline bool isPlantWood(uint8_t m) { return MAT_FLAGS[m] & MF_PLANTWOOD; }
  inline bool isPlantLeaf(uint8_t m) { return MAT_FLAGS[m] & MF_PLANTLEAF; }
  inline uint8_t plantWoodMat(uint8_t pt) { return pt == PT_PINE ? PINE_WOOD : pt == PT_CACTUS ? CACTUS : pt == PT_MUSHROOM ? MUSH_STEM : WOOD; }
  inline uint8_t plantLeafMat(uint8_t pt) { return pt == PT_MUSHROOM ? MUSH_CAP : PLANT; }
  inline uint8_t plantTypeFromWood(uint8_t m) { return m == PINE_WOOD ? PT_PINE : m == CACTUS ? PT_CACTUS : m == MUSH_STEM ? PT_MUSHROOM : PT_OAK; }
  inline bool isMyceliumMaterial(uint8_t m) { return m == MYCELIUM || m == MYCELIUM_SPORE; }
  inline bool componentDisplaceable(uint8_t m) { return m == EMPTY || m == SAND || isLiquidMaterial(m) || isGasMaterial(m); }
  inline bool isInBounds(int x, int y) { return x > 0 && x < cols - 1 && y > 0 && y < rows; }

  // ===== BODY-MATERIAL INVARIANT (read this once; it explains the whole rewrite) =====
  // A free rigid body stamps its REAL material into the L->grid (moveBodies), so a stone
  // body's cells literally read STONE — they render, mine, and carry durability as
  // stone for free. `L->bodyOwner[k] != -1`, i.e. isBodyCell(k), is what distinguishes a
  // body-owned cell from identical-looking STATIC terrain.
  //   * Anything that just READS a cell's appearance/material (render, mining drops,
  //     durability) needs no change — material-identity is automatic.
  //   * Anything that builds or reacts with STATIC terrain (the grounding flood,
  //     component registration, the acid/lava/fire/ice/salt reactions, the world-shift
  //     clear) MUST skip body cells via isBodyCell(k). Each such site carries the
  //     comment `// body-material invariant: skip free-body cells (see isBodyCell)` so
  //     the whole pattern is greppable. Body-cell reactions stay owned by erodeBodies.
  //   * A body whose material has a static component form (stone-group, ice, OR
  //     plant-family) BAKES into that component when it comes to rest ON SOLID GROUND
  //     (bakeRestingBodies in rigid.inc). RIGID bodies never bake, and a body still
  //     FLOATING on liquid (e.g. a wood log bobbing on water) keeps bobbing as a free
  //     body until it actually beaches on solid terrain.
  // Explosives (explosives.inc) are the one reaction that is body-agnostic: a TNT cell
  // detonates whether it is static or body-owned.
  inline bool isBodyCell(int k) { return L->bodyOwner[k] != -1; }

  // Clamped active-row settle band for row y (the [1, cols-2] interior). Returns
  // false when the row has no active cells — the per-row guard every reaction /
  // interior scan starts with.
  inline bool activeRowSpan(int y, int& minX, int& maxX) {
    minX = imax(1, L->activeRowMin[y]);
    maxX = imin(cols - 2, L->activeRowMax[y]);
    return maxX >= minX;
  }


#ifdef SAND_INVARIANT_CHECKS
  // Dev-build post-step validator (wasm/build.sh --dev; NEVER commit a dev
  // artifact). Aborts loudly when a structural invariant is broken instead of
  // letting it surface later as flicker/invisible collision.
  //   A. BODY-MATERIAL: a body-owned cell (L->bodyOwner[k] != -1) must hold a
  //      non-EMPTY material (the body stamps its real material into the L->grid).
  //   B. COMPONENT-CELL: every component cell must hold a material of its
  //      list's group, must not be body-owned, and must appear in exactly one
  //      component (comp.cells dedup-by-construction).
  void validateInvariants(const char* where) {
    auto fail = [&](const char* what, int k, int mat, int extra) {
      char buf[200];
      snprintf(buf, sizeof(buf), "SAND INVARIANT VIOLATION [%s] %s at k=%d (x=%d,y=%d) mat=%d extra=%d", where, what, k, k % cols, k / cols, mat, extra);
      emscripten_console_error(buf);
      abort();
    };
    auto checkLayer = [&](Layer& lay) {
      size_t n = (size_t)cols * rows;
      for (size_t k = 0; k < n; k++)
        if (lay.bodyOwner[k] != -1 && lay.grid[k] == EMPTY) fail("body-owned cell is EMPTY", (int)k, 0, lay.bodyOwner[k]);
      lay.seenGen++;
      auto checkList = [&](std::vector<Comp>& comps, uint8_t group, bool plant) {
        for (Comp& c : comps) for (int k : c.cells) {
          if (k < 0 || k >= (int)n) fail("component cell out of bounds", k, -1, 0);
          uint8_t m0 = lay.grid[k];
          if (plant ? !isPlantMaterial(m0) : componentGroupOf(m0) != group) fail("component cell material not in its group", k, m0, group);
          if (lay.bodyOwner[k] != -1) fail("component cell is body-owned", k, m0, lay.bodyOwner[k]);
          if (lay.seenStamp[k] == lay.seenGen) fail("cell in two components / duplicated", k, m0, 0);
          lay.seenStamp[k] = lay.seenGen;
        }
      };
      checkList(lay.stoneComponents, CG_STONE, false);
      checkList(lay.iceComponents, CG_ICE, false);
      checkList(lay.plantComponents, CG_PLANT, true);
    };
    checkLayer(fg);
    checkLayer(bg);
  }
#endif

  // ---- dirty tracking (operates on the active layer via the mirrors) ----
  inline void markCellIndex(int k) {
    if (k < 0 || k >= cols * rows) return;
    int y = k / cols, x = k - y * cols;
    if (x < L->rowMarkMin[y]) L->rowMarkMin[y] = x;
    if (x > L->rowMarkMax[y]) L->rowMarkMax[y] = x;
  }
  void markDirtyRect(int x0, int y0, int x1, int y1) {
    int mx0 = imax(0, x0), mx1 = imin(cols - 1, x1), my0 = imax(0, y0), my1 = imin(rows - 1, y1);
    for (int y = my0; y <= my1; y++) {
      if (mx0 < L->rowMarkMin[y]) L->rowMarkMin[y] = mx0;
      if (mx1 > L->rowMarkMax[y]) L->rowMarkMax[y] = mx1;
    }
  }
  void markAllDirty() { for (int y = 0; y < rows; y++) { L->rowMarkMin[y] = 0; L->rowMarkMax[y] = cols - 1; } }
  // Fully reset dirty tracking (row marks + render chunk flags) for the active layer.
  void clearAllDirty() {
    for (int y = 0; y < rows; y++) { L->rowMarkMin[y] = cols; L->rowMarkMax[y] = -1; }
    memset(L->dirtyRender.data(), 0, (size_t)chunkCols * chunkRows); L->dirtyRenderCount = 0;
  }
  void foldRowMarksToRender() {
    for (int y = 0; y < rows; y++) {
      int mn = L->rowMarkMin[y], mx = L->rowMarkMax[y];
      if (mx < mn) continue;
      int px0 = imax(0, mn - DIRTY_PAD_X), px1 = imin(cols - 1, mx + DIRTY_PAD_X);
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      int c0 = px0 >> CHUNK_SHIFT, c1 = px1 >> CHUNK_SHIFT, cy0 = py0 >> CHUNK_SHIFT, cy1 = py1 >> CHUNK_SHIFT;
      for (int cy = cy0; cy <= cy1; cy++) {
        int rb = cy * chunkCols;
        for (int cx = c0; cx <= c1; cx++) { int ci = rb + cx; if (!L->dirtyRender[ci]) { L->dirtyRender[ci] = 1; L->dirtyRenderCount++; } }
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
        if (!L->dirtyRender[rb + cx]) { cx++; continue; }
        int startCx = cx;
        while (cx + 1 < chunkCols && L->dirtyRender[rb + cx + 1]) cx++;
        int x0 = startCx * CHUNK_SIZE, x1 = imin(cols, (cx + 1) * CHUNK_SIZE);
        L->dirtyRects.push_back(x0); L->dirtyRects.push_back(cy0);
        L->dirtyRects.push_back(x1); L->dirtyRects.push_back(cy1);
        cx++;
      }
    }
  }
  bool beginStepDirty() {
    for (auto& kv : L->pendingDetonations) {
      int k = kv.first;
      if (k < 0 || k >= cols * rows) continue;
      int y = k / cols, x = k - y * cols;
      if (x < L->rowMarkMin[y]) L->rowMarkMin[y] = x;
      if (x > L->rowMarkMax[y]) L->rowMarkMax[y] = x;
    }
    for (Body* b : L->bodies) if (b->material == TNT && b->fuseTicks > 0) {
      int x = (int)std::lround(b->px), y = (int)std::lround(b->py);
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      if (x < L->rowMarkMin[y]) L->rowMarkMin[y] = x;
      if (x > L->rowMarkMax[y]) L->rowMarkMax[y] = x;
    }
    foldRowMarksToRender();
    for (int y = 0; y < rows; y++) { L->activeRowMin[y] = cols; L->activeRowMax[y] = -1; }
    bool hasActive = false;
    for (int y = 0; y < rows; y++) {
      int mn = L->rowMarkMin[y], mx = L->rowMarkMax[y];
      if (mx < mn) continue;
      hasActive = true;
      L->rowMarkMin[y] = cols; L->rowMarkMax[y] = -1;
      int px0 = imax(0, mn - DIRTY_PAD_X), px1 = imin(cols - 1, mx + DIRTY_PAD_X);
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      for (int yy = py0; yy <= py1; yy++) { if (px0 < L->activeRowMin[yy]) L->activeRowMin[yy] = px0; if (px1 > L->activeRowMax[yy]) L->activeRowMax[yy] = px1; }
    }
    if (!hasActive) return false;
    stepSerial++;
    // Accumulate dirty volume for this layer (step() zeros the counters once).
    for (int y = 0; y < rows; y++) {
      int mn = L->activeRowMin[y], mx = L->activeRowMax[y];
      if (mx < mn) continue;
      perfDirtyRows++;
      perfDirtyCells += (mx - mn + 1);
      int rb = (y >> CHUNK_SHIFT) * chunkCols;
      for (int cx = mn >> CHUNK_SHIFT, c1 = mx >> CHUNK_SHIFT; cx <= c1; cx++) {
        int ci = rb + cx;
        if (L->chunkStamp[ci] != stepSerial) { L->chunkStamp[ci] = stepSerial; perfDirtyChunks++; }
      }
    }
    return true;
  }
  void prepareNextBuffer() {
    for (int y = 0; y < rows; y++) {
      int rs = y * cols, minX = L->activeRowMin[y], maxX = L->activeRowMax[y];
      if (maxX >= minX) memset(L->next + rs + minX, EMPTY, (size_t)(maxX - minX + 1));
    }
  }

  // ---- cell helpers ----
  inline bool emptyAt(int x, int y) { return x >= 0 && x < cols && y >= 0 && y < rows && L->grid[I(x, y)] == EMPTY && L->next[I(x, y)] == EMPTY; }
  inline bool touchesGridEmpty(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && L->grid[k - 1] == EMPTY) || (x < cols - 2 && L->grid[k + 1] == EMPTY) ||
           (y > 1 && L->grid[k - cols] == EMPTY) || (y < rows - 1 && L->grid[k + cols] == EMPTY);
  }
  // A liquid only stays "active" if it has somewhere to FLOW — empty to a side or
  // below. Empty ABOVE (open sky over a flat surface) is NOT an escape: liquid
  // never flows up, so a surface cell blocked on its sides + below has settled and
  // should go inert instead of re-marking itself dirty every step forever (the
  // shimmer + the per-step diff churn that broke open oceans in multiplayer). It
  // re-wakes normally when a neighbour changes (dirty padding covers the gap).
  inline bool liquidCanEscape(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && L->grid[k - 1] == EMPTY) || (x < cols - 2 && L->grid[k + 1] == EMPTY) ||
           (y < rows - 1 && L->grid[k + cols] == EMPTY);
  }
  // Is this surface cell L->next to an INTERNAL hole — a 1-wide empty gap in the liquid
  // layer with more of our liquid on its far side? Such a hole CAN be coalesced away
  // (relaxLiquidGaps migrates it to an edge); an OPEN edge (empty-empty beyond) or a
  // 1-lower neighbouring column (empty over liquid = a gentle slope) is NOT an
  // internal hole, so a flat-but-ragged surface or a settled puddle still goes inert.
  inline bool adjacentInternalHole(int k, uint8_t m) {
    // Only materials that participate in relaxLiquidGaps benefit from staying
    // awake on an internal hole. BRINE (historically no relaxesGaps) would
    // re-mark forever on a ragged free surface and never go inert.
    if (!relaxesGaps(m)) return false;
    int x = k % cols, y = k / cols;
    if (y + 1 >= rows) return false;
    // The hole must also have SUPPORT below it (non-empty) — that is the gap
    // relaxLiquidGaps actually fills. A hole with empty below is a rising bubble the
    // fall handles, not a coalesce target, and re-marking on it would spin forever.
    if (x > 2 && L->grid[k - 1] == EMPTY && L->grid[k - 2] == m && L->grid[k - 1 + cols] != EMPTY) return true;
    if (x < cols - 3 && L->grid[k + 1] == EMPTY && L->grid[k + 2] == m && L->grid[k + 1 + cols] != EMPTY) return true;
    return false;
  }
  // Powder/liquid motion (or replace) invalidates the loose grounding overlay.
  // Rigid topology uses groundDirty/groundContentDirty separately.
  inline bool isLooseOverlayMat(uint8_t m) {
    return isLooseSolidMaterial(m) || isLiquidMaterial(m);
  }
  inline void noteLooseDirtyCol(int x) {
    if (x < 0 || x >= cols) return;
    if ((int)L->looseDirtyCol.size() != cols) L->looseDirtyCol.assign(cols, 0);
    L->looseDirtyCol[x] = 1;
    if (!L->looseGroundDirty || L->looseDirtyX1 < L->looseDirtyX0) {
      L->looseDirtyX0 = x; L->looseDirtyX1 = x;
    } else {
      if (x < L->looseDirtyX0) L->looseDirtyX0 = x;
      if (x > L->looseDirtyX1) L->looseDirtyX1 = x;
    }
    L->looseGroundDirty = true;
  }
  inline void noteLooseDirtyFull() {
    L->looseGroundDirty = true;
    L->looseDirtyFull = true;
    L->looseDirtyX0 = 0; L->looseDirtyX1 = cols - 1;
  }
  inline void noteLooseGroundTouch(uint8_t m) {
    if (isLooseOverlayMat(m)) noteLooseDirtyFull();
  }
  inline void noteLooseGroundTouch2(uint8_t a, uint8_t b) {
    if (isLooseOverlayMat(a) || isLooseOverlayMat(b)) noteLooseDirtyFull();
  }
  inline void noteLooseGroundTouch2At(int k, uint8_t a, uint8_t b) {
    if (isLooseOverlayMat(a) || isLooseOverlayMat(b))
      noteLooseDirtyCol(k - (k / cols) * cols);
  }
  // Keep looseColCount in sync with LIVE grid[] (not next[]).
  inline void adjustLooseColCount(int x, uint8_t oldM, uint8_t newM) {
    if (x < 0 || x >= cols || (int)L->looseColCount.size() != cols) return;
    if (isLooseOverlayMat(oldM)) L->looseColCount[x]--;
    if (isLooseOverlayMat(newM)) L->looseColCount[x]++;
  }
  inline void writeGridIndex(int k, uint8_t m) {
    if (k < 0 || k >= cols * rows) return;
    if (L->grid[k] == m) return;
    int x = k - (k / cols) * cols;
    uint8_t old = L->grid[k];
    noteLooseGroundTouch2At(k, old, m);
    adjustLooseColCount(x, old, m);
    if ((m == FIRE || m == LAVA) && old != FIRE && old != LAVA) L->heatAddedAfterPrepare = true;
    L->grid[k] = m;
    markCellIndex(k);
  }
  inline bool isLooseDensityMaterial(uint8_t m) { return DENSITY_SORTED[m] == 1; }
  inline bool canDisplaceByLooseDensity(uint8_t m, uint8_t d) { return isLooseDensityMaterial(m) && isLooseDensityMaterial(d) && DENSITY[m] > DENSITY[d]; }
  // True iff this cell still has a pending density swap with a neighbour — used to
  // keep an UNLEVEL two-fluid interface awake until it settles flat.
  //   - vertical (any loose material): a lighter material directly below, or a
  //     heavier one directly above (preserves powder-on-water sorting).
  //   - DIAGONAL, LIQUIDS ONLY: a denser liquid up-diagonal that `m` can rise into,
  //     or a lighter liquid down-diagonal that `m` can sink into. This is what lets a
  //     water mound under oil keep exchanging (water sinks / oil rises) until level.
  // Restricted to liquids on the diagonals so powder sorting isn't double-counted and
  // a SINGLE-fluid surface (no density difference anywhere) still returns false -> the
  // surface goes inert, no shimmer/multiplayer churn.
  inline bool touchesUnstableLooseDensityInterface(int k, uint8_t m) {
    if (!isLooseDensityMaterial(m)) return false;
    int y = k / cols, x = k - y * cols;
    if (y < rows - 1 && canDisplaceByLooseDensity(m, L->grid[k + cols])) return true;
    if (y > 1 && canDisplaceByLooseDensity(L->grid[k - cols], m)) return true;
    if (isLiquidMaterial(m)) {
      if (y > 1) {
        if (x > 1 && isLiquidMaterial(L->grid[k - cols - 1]) && canDisplaceByLooseDensity(L->grid[k - cols - 1], m)) return true;
        if (x < cols - 2 && isLiquidMaterial(L->grid[k - cols + 1]) && canDisplaceByLooseDensity(L->grid[k - cols + 1], m)) return true;
      }
      if (y < rows - 1) {
        if (x > 1 && isLiquidMaterial(L->grid[k + cols - 1]) && canDisplaceByLooseDensity(m, L->grid[k + cols - 1])) return true;
        if (x < cols - 2 && isLiquidMaterial(L->grid[k + cols + 1]) && canDisplaceByLooseDensity(m, L->grid[k + cols + 1])) return true;
      }
    }
    return false;
  }
  // Stamp source vacated for this tick AND mark it dirty. Vacate alone is not
  // enough: prepareNextBuffer only blanks active rows, and a multi-cell liquid
  // fall can leave the source outside the destination's DIRTY_PAD_Y band next
  // step. Unblanked next[source] then resurrects a 2-tick-old value as a ghost
  // trail (looks like fluid duplication while falling).
  inline void vacateForNextMove(int fromK) {
    noteLooseGroundTouch2At(fromK, L->grid[fromK], EMPTY);
    L->vacatedStamp[fromK] = tick;
    markCellIndex(fromK);
  }
  // Mark every cell on a vertical/horizontal move span dirty so intermediate
  // rows stay in the active band and get blanked next prepareNextBuffer.
  inline void markMoveSpan(int fromK, int toK) {
    int fy = fromK / cols, fx = fromK - fy * cols;
    int ty = toK / cols, tx = toK - ty * cols;
    if (fx == tx && fy == ty) { markCellIndex(fromK); return; }
    markDirtyRect(imin(fx, tx), imin(fy, ty), imax(fx, tx), imax(fy, ty));
  }
  inline void writeNextIndex(int k, uint8_t m) {
    // Even when next[] already holds m (stale double-buffer residue), still mark
    // if the committed grid differs — otherwise a reclaim that early-outs here
    // leaves the vacated source without a dirty mark and ghosts can return.
    if (L->next[k] == m) {
      if (L->grid[k] != m) {
        noteLooseGroundTouch2At(k, L->grid[k], m);
        markCellIndex(k);
      }
      return;
    }
    noteLooseGroundTouch2At(k, L->grid[k], m);
    noteLooseGroundTouch2At(k, L->next[k], EMPTY); // vacating/replacing prior next material
    L->next[k] = m;
    if (L->grid[k] != m || m == FIRE || m == STEAM || (isLiquidMaterial(m) && liquidCanEscape(k)) || touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
  }
  inline bool canDisplaceMaterial(uint8_t m, uint8_t d) { if (isGasMaterial(d)) return true; return canDisplaceByLooseDensity(m, d); }
  // Free volume for liquid movement: EMPTY, gas, or a strictly less-dense liquid.
  // Denser liquids path through lighter ones as if they were air; the lighter
  // liquid is relocated by resolveLiquidDisplacements (not a local swap).
  //
  // Gas is free volume only once per tick — the gas still sitting in grid[k]
  // with next empty. Gas already written into next[k] this tick is a rising
  // bubble parked for the rest of the settle pass. Claiming that again would
  // cascade-swap it to the free surface in one step (looks like teleporting).
  inline bool liquidTreatsAsEmpty(uint8_t m, uint8_t d) {
    return d == EMPTY || isGasMaterial(d) || (isLiquidMaterial(d) && canDisplaceByLooseDensity(m, d));
  }
  // True when liquid may claim the gas at k this tick (grid-native, not yet moved).
  inline bool liquidGasClaimableAt(int k) {
    return L->next[k] == EMPTY && L->vacatedStamp[k] != tick && isGasMaterial(L->grid[k]);
  }
  // Effective occupant of k this tick for liquid claims. Prefers next[] (already
  // settled writers) so denser fluid can still sink through lighter fluid that
  // wrote itself into next bottom-up — without this, next!=EMPTY blocked all
  // multi-cell sinks and left only 1-cell settleLooseDensityInterface swaps.
  // Parked rising gas in next[] is reported as itself but is NOT free volume
  // (see liquidColumnPassable / liquidCanClaim) so the bubble rises 1 cell/tick.
  inline uint8_t liquidOccupantAt(int k) {
    uint8_t n = L->next[k];
    if (n != EMPTY) return n;
    if (L->vacatedStamp[k] == tick) return EMPTY;
    return L->grid[k];
  }
  // Fall-through: EMPTY / claimable gas / lighter liquid count as air.
  // Gas already parked in next[] blocks further fall this tick.
  inline bool liquidColumnPassable(int k, uint8_t m) {
    if (L->assemblyWakeStamp[k] == tick) return false;
    uint8_t n = L->next[k];
    if (n != EMPTY) {
      if (isGasMaterial(n)) return false; // rising bubble — one step/tick
      return isLiquidMaterial(n) && canDisplaceByLooseDensity(m, n);
    }
    if (L->vacatedStamp[k] == tick) return true;
    uint8_t g = L->grid[k];
    return g == EMPTY || isGasMaterial(g) || (isLiquidMaterial(g) && canDisplaceByLooseDensity(m, g));
  }
  // Land/claim for fall / down-diagonal / vertical sink: EMPTY, claimable gas,
  // or strictly lighter loose (liquid or powder).
  // Gas/powder already written into next[] this tick are parked displacees —
  // do not re-claim them (cascade would drop mass on vacatedStamp / overwrite).
  inline bool liquidCanClaim(int k, uint8_t m) {
    if (L->assemblyWakeStamp[k] == tick) return false;
    uint8_t n = L->next[k];
    if (n != EMPTY) {
      if (isGasMaterial(n) || isLooseSolidMaterial(n)) return false; // parked bubble/grain
      return canDisplaceMaterial(m, n);
    }
    if (L->vacatedStamp[k] == tick) return true;
    uint8_t g = L->grid[k];
    return g == EMPTY || isGasMaterial(g) || canDisplaceMaterial(m, g);
  }
  // Same-level flow / enter: EMPTY or claimable gas only. Lighter liquid is NOT
  // air for lateral flow — treating it as enterable makes a flat water|oil
  // contact swap forever (BFS relocates oil into the vacated hole = PE-neutral
  // churn) and multi-fluid pools never go inert. Parked next[] gas is blocked.
  inline bool liquidCanFlowInto(int k, uint8_t m) {
    (void)m;
    if (L->assemblyWakeStamp[k] == tick) return false;
    uint8_t n = L->next[k];
    if (n != EMPTY) return false;
    if (L->vacatedStamp[k] == tick) return true;
    uint8_t g = L->grid[k];
    return g == EMPTY || isGasMaterial(g);
  }
  inline bool canEnterIndex(int k, uint8_t m) {
    if (isLiquidMaterial(m)) return liquidCanFlowInto(k, m);
    return L->next[k] == EMPTY && (L->grid[k] == EMPTY || canDisplaceMaterial(m, L->grid[k]));
  }
  inline bool canLiquidEnter(int x, int y, uint8_t m) { return x >= 0 && x < cols && y >= 0 && y < rows && canEnterIndex(I(x, y), m); }
  inline bool supportsLiquid(uint8_t s, uint8_t m) { return s != EMPTY && s != m && !canDisplaceMaterial(m, s); }
  // True if something stacks pressure on this liquid cell: more of the same
  // material above, OR a strictly lighter liquid (e.g. water over brine). Without
  // the latter, submerged denser fluid never equalizes sideways and freezes into
  // a pyramid under the lighter layer.
  inline bool liquidPressureAbove(int k, uint8_t m) {
    int y = k / cols;
    if (y <= 1) return false;
    uint8_t a = L->grid[k - cols];
    if (a == m) return true;
    return isLiquidMaterial(a) && DENSITY[a] < DENSITY[m];
  }
  void moveMaterialInto(int fromK, int toK, uint8_t m) {
    // For liquids, displace the effective occupant (next if set, else grid) so a
    // denser cell can overwrite a lighter liquid that already settled into next[].
    uint8_t displaced = isLiquidMaterial(m) ? liquidOccupantAt(toK) : L->grid[toK];
    writeNextIndex(toK, m);
    vacateForNextMove(fromK);
    if (isLiquidMaterial(m)) {
      int fromY = fromK / cols, toY = toK / cols;
      if (toY > fromY) audio.noteFluidFall(m, toK - toY * cols, toY, toY - fromY);
    } else if (isLooseSolidMaterial(m) && fromK != toK) {
      int toY = toK / cols;
      audio.notePowderMove(m, toK - toY * cols, toY,
                           std::max(1, std::abs(toK - fromK) / cols));
    }
    // Multi-cell liquid sinks (and any sparse jump) must dirty the full span so
    // vacated/intermediate rows stay blankable across the double buffer.
    if (fromK != toK) markMoveSpan(fromK, toK);
    if (displaced == EMPTY || displaced == m || !canDisplaceMaterial(m, displaced)) return;
    if (!isLiquidMaterial(m) && L->vacatedStamp[toK] == tick) return;
    // Liquid→liquid: denser claims the cell; lighter is relocated by multi-source BFS
    // after the settle pass (density chain). Do not swap into the source.
    if (isLiquidMaterial(m) && isLiquidMaterial(displaced)) {
      liquidDispPending.push_back({displaced, toK, fromK});
      return;
    }
    // Gas / lighter powder: swap into the mover's vacated source (one cell).
    // Claim checks only allow grid-native gas/powder, so a lower liquid swap that
    // parked the displacee in next[fromK] is not re-claimed by the cell above —
    // bubbles/grains rise ~1 cell/tick instead of cascading. Always relocate:
    // the vacatedStamp[toK] powder guard below is for powder→powder ghosts and
    // would drop liquid-displaced snow/steam (water "eats" snow).
    if (isGasMaterial(displaced) || isLooseSolidMaterial(displaced)) {
      if (L->next[fromK] == EMPTY) writeNextIndex(fromK, displaced);
      return;
    }
    // Other displacees (should be rare): only emit if grid occupant still present.
    if (L->vacatedStamp[toK] == tick) return;
    if (L->next[fromK] == EMPTY) writeNextIndex(fromK, displaced);
  }
  inline void moveLiquidInto(int fromK, int x, int y, uint8_t m) { moveMaterialInto(fromK, I(x, y), m); }

  static const int DIRS_LF[2];
  static const int DIRS_RF[2];
