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
    computeGrounded();
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
    if (MAT_KIND[m] == K_LIQUID) for (int i = 0; i < 2; i++) { int dx = i == 0 ? -1 : 1; int nx = x + dx; if (nx > 0 && nx < cols - 1 && canSettleInto(g, y * cols + nx, m)) return false; }
    return true;
  }
  // can the material keep falling in `other` after landing at (x,y)?
  bool canFall(Layer* other, int x, int y, uint8_t m) {
    if (y + 1 >= rows) return false;
    return canSettleInto(other->grid, (y + 1) * cols + x, m);
  }
  bool tryTransfer(Layer* from, Layer* to, int x, int y, int k) {
    uint8_t m = from->grid[k];
    if (!isLoose(m)) return false;
    if (to->grid[k] != EMPTY) return false;
    if (!stuckIn(from, x, y, m)) return false;
    if (!canFall(to, x, y, m)) return false;
    to->grid[k] = m; from->grid[k] = EMPTY;
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
