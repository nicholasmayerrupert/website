  // ---- step ----
  // Two layers run under ONE tick. updatePlayers + the tick++ happen once;
  // each layer steps via stepLayer() (foreground FIRST, so the shared RNG stream
  // for the foreground is byte-identical to a single-layer build when the
  // background is idle). transferPass() then reconciles cross-layer powder/liquid
  // flow (P2).
  bool isLoose(uint8_t m) { return MAT_KIND[m] == K_POWDER || MAT_KIND[m] == K_LIQUID; }

  void stepLayer(Layer* layer) {
    useLayer(layer);
    if (!beginStepDirty()) return; // nothing active in this layer this step
    double t0 = emscripten_get_now();
    if (!jointGroundReady) computeGrounded(); // joint cross-layer flood already ran in step()
    double tG = emscripten_get_now(); perfStepGround = tG - t0;
    moveRigidAssemblies();
    moveBodies();
    double tR = emscripten_get_now(); perfStepRigid = tR - tG;
    growPlantComponents();
    applyReactions(); applyAcid(); applyLava(); applyIce();
    double tX = emscripten_get_now(); perfStepReact = tX - tR;
    prepareNextBuffer();
    // carry-forward component + body cells across the double buffer
    L->curCompCells.clear();
    for (auto& comp : L->stoneComponents) for (int k : comp.cells) { next[k] = STONE; compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (auto& comp : L->plantComponents) for (int k : comp.cells) { next[k] = grid[k]; compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (auto& comp : L->iceComponents) for (int k : comp.cells) { next[k] = ICE; compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (int k : L->bodyCells) { next[k] = RIGID; compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (int k : L->prevCompCells) {
      if (compOccStamp[k] == tick) continue;
      if (grid[k] == EMPTY) { next[k] = EMPTY; markCellIndex(k); }
      else if (!isRigidMaterial(grid[k]) && isRigidMaterial(next[k])) { next[k] = grid[k]; markCellIndex(k); }
    }
    std::swap(L->prevCompCells, L->curCompCells);
    double tC = emscripten_get_now(); perfStepCarry = tC - tX;

    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) settleLooseDensityInterface(x, y, rb + x); else for (int x = maxX; x >= minX; x--) settleLooseDensityInterface(x, y, rb + x); }
    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { if (MAT_KIND[grid[rb + x]] == K_POWDER) settleSand(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { if (MAT_KIND[grid[rb + x]] == K_POWDER) settleSand(x, y, rb + x); } }
    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } else for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } }
    for (int y = 0; y < rows; y++) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x); } }
    double tS = emscripten_get_now(); perfStepSettle = tS - tC;
    std::swap(grid, next); flushLayerGrids();
    if ((tick & 1) == 0) relaxLiquidGaps();
    if (tick % 3 == 0) separateLooseByDensity();
    levelLiquidSurfaces();
    applySideSinks();
    perfStepTail = emscripten_get_now() - tS;
  }

  bool step() {
    // Players advance every step (foreground only); their tool edits mark fg active.
    useLayer(&fg);
    updatePlayers();
    bool fgA = layerActive(&fg), bgA = layerActive(&bg);
    if (!fgA && !bgA) { useLayer(&fg); return !players.empty(); }
    double t0 = emscripten_get_now();
    tick++;
    // Cross-layer grounding: compute groundedness jointly over both layers up
    // front so solids in one layer support solids at the same cell in the other
    // (gated on bgEnabled -> single-layer scenes stay byte-identical). Each
    // stepLayer() then skips its own first computeGrounded().
    jointGroundReady = false;
    if (bgEnabled) { computeGroundedBoth(); jointGroundReady = true; }
    if (fgA) stepLayer(&fg); // foreground first -> deterministic shared-RNG order
    if (bgA) stepLayer(&bg);
    crossLayerReactions(fgA, bgA);
    transferPass(fgA, bgA);
    useLayer(&fg); // leave fg active for ABI/render/tool calls between steps
    perfStepMs = emscripten_get_now() - t0;
    return true;
  }

  // ---- cross-layer fire (uses the shared RNG) ----
  // Fire jumps between layers: a FIRE cell in one layer ignites a flammable at the
  // SAME (x,y) in the other layer (both directions, probabilistic). Runs after
  // both layers have stepped, over the union of their active regions (fire is
  // always in an active region). Gated on bgEnabled so single-layer scenes draw no
  // RNG and stay byte-identical to a one-layer build.
  void crossLayerReactions(bool fgA, bool bgA) {
    if (!bgEnabled) return;
    for (int y = 1; y < rows - 1; y++) {
      int mn = cols, mx = -1;
      if (fgA && fg.activeRowMax[y] >= fg.activeRowMin[y]) { if (fg.activeRowMin[y] < mn) mn = fg.activeRowMin[y]; if (fg.activeRowMax[y] > mx) mx = fg.activeRowMax[y]; }
      if (bgA && bg.activeRowMax[y] >= bg.activeRowMin[y]) { if (bg.activeRowMin[y] < mn) mn = bg.activeRowMin[y]; if (bg.activeRowMax[y] > mx) mx = bg.activeRowMax[y]; }
      if (mx < mn) continue;
      mn = imax(1, mn); mx = imin(cols - 2, mx);
      for (int x = mn; x <= mx; x++) {
        int k = y * cols + x;
        uint8_t f = fg.grid[k], b = bg.grid[k];
        if (f == FIRE && isFlammable(b)) {
          if (rand() < FIRE_CROSS_P) { bg.grid[k] = FIRE; if (x < bg.rowMarkMin[y]) bg.rowMarkMin[y] = x; if (x > bg.rowMarkMax[y]) bg.rowMarkMax[y] = x; }
        } else if (b == FIRE && isFlammable(f)) {
          if (rand() < FIRE_CROSS_P) { fg.grid[k] = FIRE; if (x < fg.rowMarkMin[y]) fg.rowMarkMin[y] = x; if (x > fg.rowMarkMax[y]) fg.rowMarkMax[y] = x; }
        }
      }
    }
  }

  // ---- cross-layer transfer (RNG-free) ----
  // A loose cell (powder or liquid) that is stuck in its layer moves to the other
  // layer at the same (x,y) when that cell is empty there AND it can keep falling
  // there (the "can keep falling" rule prevents endless layer-to-layer bouncing).
  inline bool canSettleInto(uint8_t* g, int k, uint8_t m) { uint8_t d = g[k]; return d == EMPTY || canDisplaceMaterial(m, d); }
  // "no downward move available in `lay`": straight-down + both down-diagonals are
  // blocked (and, for liquids, no immediate side-flow either) — i.e. "not falling".
  bool stuckIn(Layer* lay, int x, int y, uint8_t m) {
    if (y + 1 >= rows) return true;            // resting on the floor
    uint8_t* g = lay->grid;
    int below = (y + 1) * cols + x;
    if (canSettleInto(g, below, m)) return false;
    for (int i = 0; i < 2; i++) { int dx = i == 0 ? -1 : 1; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue; if (canSettleInto(g, below + dx, m)) return false; }
    // Liquid side-flow only counts as "not stuck" if it is a REAL escape: a side
    // cell the liquid can enter that ALSO opens downward (the liquid can keep
    // descending from there), matching settleLiquid's flow scan. A side neighbour
    // resting on support with nothing below it — empty floor puddle, or a LIGHTER
    // loose cell stuck on stone (lava beside bg sand, both on the stone band) — is
    // NOT an escape: the in-layer settle declines that lateral move (a 1-deep puddle
    // goes inert; lateral density spread only fires into a lighter LIQUID), so the
    // cell is genuinely stuck and must stay free to transfer cross-layer.
    if (MAT_KIND[m] == K_LIQUID) for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? -1 : 1; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue;
      int sideK = y * cols + nx;
      if (canSettleInto(g, sideK, m) && canSettleInto(g, sideK + cols, m)) return false;
    }
    return true;
  }
  // can the material keep falling in `other` after landing at (x,y)?
  bool canFall(Layer* other, int x, int y, uint8_t m) {
    if (y + 1 >= rows) return false;
    return canSettleInto(other->grid, (y + 1) * cols + x, m);
  }
  bool tryTransfer(Layer* from, Layer* to, int x, int y, int k) {
    uint8_t m = from->grid[k];
    // Powders AND liquids cross layers when stuck. The transfer only fires when the
    // cell is stuck in `from` (nowhere to fall/flow in its own layer) AND can keep
    // FALLING in `to` (canFall) — so it never bleeds sideways into a solid backdrop
    // (generated bg is solid behind oceans, so canFall is false there: no churn).
    // It DOES drain into space the player digs out in the other layer — e.g. mining
    // the background under foreground water lets the water pour into the new channel
    // on its own. Settling fluids (flat bodies go inert) keep this from shimmering.
    if (!isLoose(m)) return false;
    // Target empty -> a plain transfer. Target occupied by a LIGHTER loose material
    // (powder OR liquid) -> a density SWAP: a denser stuck loose material (fg lava,
    // fg water, ...) pushes through the lighter one (bg sand, bg oil, ...), trading
    // places across the layers. canDisplaceByLooseDensity is powder+liquid generic, so
    // lava(2.8) displaces sand(1.6), sand(1.6) displaces water(1.0), water(1.0)
    // displaces oil(0.8), etc. Its strict density test is antisymmetric, so the reverse
    // swap is impossible (no oscillation); the stuck+canFall gates keep it from bleeding
    // into a packed backdrop or churning.
    uint8_t dst = to->grid[k]; bool swap = false;
    if (dst != EMPTY) {
      if (!canDisplaceByLooseDensity(m, dst)) return false;
      swap = true;
    }
    if (!stuckIn(from, x, y, m)) return false;
    if (!canFall(to, x, y, m)) return false;
    if (swap) { to->grid[k] = m; from->grid[k] = dst; }
    else { to->grid[k] = m; from->grid[k] = EMPTY; }
    // mark both layers dirty at (x,y) so render + net + next-step settle pick it up
    if (x < to->rowMarkMin[y]) to->rowMarkMin[y] = x; if (x > to->rowMarkMax[y]) to->rowMarkMax[y] = x;
    if (x < from->rowMarkMin[y]) from->rowMarkMin[y] = x; if (x > from->rowMarkMax[y]) from->rowMarkMax[y] = x;
    return true;
  }
  void transferPass(bool fgA, bool bgA) {
    if (!bgEnabled) return; // an empty/untouched background does not interact
    for (int y = rows - 1; y >= 0; y--) {
      int mn = cols, mx = -1;
      if (fgA && fg.activeRowMax[y] >= fg.activeRowMin[y]) { if (fg.activeRowMin[y] < mn) mn = fg.activeRowMin[y]; if (fg.activeRowMax[y] > mx) mx = fg.activeRowMax[y]; }
      if (bgA && bg.activeRowMax[y] >= bg.activeRowMin[y]) { if (bg.activeRowMin[y] < mn) mn = bg.activeRowMin[y]; if (bg.activeRowMax[y] > mx) mx = bg.activeRowMax[y]; }
      if (mx < mn) continue;
      mn = imax(0, mn); mx = imin(cols - 1, mx);
      bool ltr = (y & 1) == 0;
      if (ltr) for (int x = mn; x <= mx; x++) { int k = y * cols + x; if (!tryTransfer(&fg, &bg, x, y, k)) tryTransfer(&bg, &fg, x, y, k); }
      else for (int x = mx; x >= mn; x--) { int k = y * cols + x; if (!tryTransfer(&fg, &bg, x, y, k)) tryTransfer(&bg, &fg, x, y, k); }
    }
  }
