  // Simulation tick orchestration.
  //
  // This file owns the top-level order: active-region prep, rigid/growth,
  // reactions, loose-cell movement, cleanup, cross-layer transfer, psys.players, and
  // dirty/perf bookkeeping. Local movement rules live in core.inc.

  // ---- step ----
  // Two layers run under ONE tick. updatePlayers + the tick++ happen once;
  // each layer steps via stepLayer() (foreground FIRST, so the shared RNG stream
  // for the foreground is byte-identical to a single-layer build when the
  // background is idle). transferPass() then reconciles cross-layer loose/gas
  // flow (P2).

  void stepLayer(Layer* layer) {
    useLayer(layer);
    if (!beginStepDirty()) return; // nothing active in this layer this step
    // Phase times ACCUMULATE (both layers). step() zeros them once per tick.
    double t0 = emscripten_get_now();
    if (!comps.jointGroundReady) ensureGroundedSingleLayer(); // joint cross-layer flood already ran in step()
    perfGroundingMs += emscripten_get_now() - t0;

    double tA = emscripten_get_now();
    L->assemblyRelocatedCells.clear();
    moveRigidAssemblies();
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-assemblies");
#endif
    perfAssemblyUnionMs += emscripten_get_now() - tA;

    double tB = emscripten_get_now();
    moveBodies();
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-moveBodies");
#endif
    perfBodyMs += emscripten_get_now() - tB;

    double tR = emscripten_get_now();
    growPlantComponents();
    growMyceliumComponents();
    applyReactions(); applyAcid(); applyLava(); applyIce(); applySalt(); applyExplosives();
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-reactions");
#endif
    perfReactMs += emscripten_get_now() - tR;

    double tC = emscripten_get_now();
    prepareNextBuffer();
    // carry-forward component + body cells across the double buffer
    L->curCompCells.clear();
    // Carry component cells forward in `L->next` keeping each cell's actual material
    // (L->grid[k]) so stone-group ores and any future ice-group materials survive the
    // double-buffer swap instead of collapsing to STONE/ICE.
    for (auto& comp : L->stoneComponents) for (int k : comp.cells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (auto& comp : L->plantComponents) for (int k : comp.cells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (auto& comp : L->iceComponents) for (int k : comp.cells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curCompCells.push_back(k); }
    for (int k : L->bodyCells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curCompCells.push_back(k); } // body-material invariant: carry the body's real material, not RIGID
    for (int k : L->prevCompCells) {
      if (L->compOccStamp[k] == tick) continue;
      if (L->grid[k] == EMPTY) { L->next[k] = EMPTY; markCellIndex(k); }
      else if (!isRigidMaterialClass(L->grid[k]) && isRigidMaterialClass(L->next[k])) { L->next[k] = L->grid[k]; markCellIndex(k); }
    }
    // Component displacement already moved these media once in the live grid.
    // Carry them through the freshly blanked next buffer and stamp them so the
    // loose pass cannot move the same volume a second time this tick.
    for (int k : L->assemblyRelocatedCells) {
      uint8_t m = L->grid[k];
      if (m == EMPTY || isRigidMaterialClass(m)) continue;
      L->next[k] = m;
      L->vacatedStamp[k] = tick;
    }
    std::swap(L->prevCompCells, L->curCompCells);
    perfCarryMs += emscripten_get_now() - tC;

    liquidDispPending.clear();
    double tS = emscripten_get_now();
    for (int y = rows - 1; y >= 0; y--) { int minX = L->activeRowMin[y], maxX = L->activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) settleLooseDensityInterface(x, y, rb + x); else for (int x = maxX; x >= minX; x--) settleLooseDensityInterface(x, y, rb + x); }
    for (int y = rows - 1; y >= 0; y--) { int minX = L->activeRowMin[y], maxX = L->activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { if (isLooseSolidMaterial(L->grid[rb + x])) settleSand(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { if (isLooseSolidMaterial(L->grid[rb + x])) settleSand(x, y, rb + x); } }
    perfSandMs += emscripten_get_now() - tS;

    double tL = emscripten_get_now();
    for (int y = rows - 1; y >= 0; y--) { int minX = L->activeRowMin[y], maxX = L->activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = L->grid[rb + x]; if (!isLiquidMaterial(m)) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } else for (int x = maxX; x >= minX; x--) { uint8_t m = L->grid[rb + x]; if (!isLiquidMaterial(m)) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } }
    // Density-chain relocate liquids displaced by denser liquids this settle (before
    // gas claims free cells and before the double-buffer swap commits next[]).
    resolveLiquidDisplacements();
    perfLiquidMs += emscripten_get_now() - tL;

    double tG = emscripten_get_now();
    for (int y = 0; y < rows; y++) { int minX = L->activeRowMin[y], maxX = L->activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = L->grid[rb + x]; if (!isGasMaterial(m)) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x, m); } else for (int x = maxX; x >= minX; x--) { uint8_t m = L->grid[rb + x]; if (!isGasMaterial(m)) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x, m); } }
    perfGasMs += emscripten_get_now() - tG;

    double tT = emscripten_get_now();
    std::swap(L->grid, L->next);
    if ((tick & 1) == 0) relaxLiquidGaps();
    if (tick % 3 == 0) separateLooseByDensity();
    levelLiquidSurfaces();
    applySideSinks();
    perfTailMs += emscripten_get_now() - tT;
  }

  // Real-time entities advance on their own cheap deterministic clock. This is
  // deliberately the extension point for future enemy/AI systems: add their
  // Creature AI updates beside players/items without coupling it to the cellular world.
  bool stepActors() {
    double t0 = emscripten_get_now();
    useLayer(&fg);
    updatePlayers();
    updateItems();
    updateCreatures();
    actorTick++;
    perfActorMs = emscripten_get_now() - t0;
    return !psys.players.empty() || !itemsys.items.empty() || !creatures.creatures.empty();
  }

  bool stepWorld() {
    bool fgA = layerActive(&fg), bgA = layerActive(&bg);
    if (!fgA && !bgA) { useLayer(&fg); perfStepMs = 0; return false; }
    double t0 = emscripten_get_now();
    tick++;
    // Zero fine-phase timers + dirty volume (stepLayer / joint accumulate into these).
    perfDirtyChunks = perfDirtyRows = perfDirtyCells = 0;
    perfComponentCount = perfComponentCellCount = perfCrossBondCount = 0;
    perfGroundingMs = perfCrossLayerGroundingMs = perfComponentIndexMs = 0;
    perfAssemblyUnionMs = perfCarryMs = perfBodyMs = 0;
    perfSandMs = perfLiquidMs = perfGasMs = 0;
    perfReactMs = perfTailMs = perfLayersMs = perfCrossMs = 0;
    // Cross-layer grounding: compute groundedness jointly over both layers up
    // front so solids in one layer support solids at the same cell in the other
    // (gated on bgEnabled -> single-layer scenes stay byte-identical). Each
    // stepLayer() then skips its own first computeGrounded().
    comps.jointGroundReady = false;
    comps.jointBondsInvalid = false;
    // Idle-structure skip: do NOT force a joint pass just because marked rows hold
    // stone/plant/ice or residual static powder exists. Joint runs when:
    //   - jointDirty: acid pure-bore / erase invalidated bonds without groundDirty
    //   - residual cgBonds: ungrounded cross-bonded clusters still need joint motion
    //   - rigidDirty: rigid topology or acid content change on either layer
    //   - looseDirty: powder/liquid wrote (loose overlay is joint-ordered for
    //     dual-layer determinism — both layers refresh before either stepLayer)
    // Free bodies do NOT force joint: they do not change static co-occupation.
    // moveBodies / ensureGroundedSingleLayer preserve joint stamps when
    // jointSupportValid so a cube spawn cannot peel FG/BG support.
    // Settled dual-layer terrain (no dirty bits, no live bonds) skips joint and
    // reuses the previous groundedCell (including cross-layer support patches).
    bool rigidDirty = fg.groundDirty || bg.groundDirty || fg.groundContentDirty || bg.groundContentDirty;
    bool looseDirty = fg.looseGroundDirty || bg.looseGroundDirty;
    bool needJoint = comps.jointDirty || !comps.cgBonds.empty() || rigidDirty || looseDirty;
    if (bgEnabled && needJoint) {
      // computeGroundedBoth splits its wall time into groundingMs (base floods)
      // + crossLayerGroundingMs (bond scan / UF) + componentIndexMs (inside index).
      computeGroundedBoth(); comps.jointGroundReady = true; comps.jointDirty = false;
      fgA = fgA || layerActive(&fg);
      bgA = bgA || layerActive(&bg);
    }
    double tL0 = emscripten_get_now();
    if (fgA) stepLayer(&fg); // foreground first -> deterministic shared-RNG order
    if (bgA) stepLayer(&bg);
    perfLayersMs = emscripten_get_now() - tL0;
    double tX0 = emscripten_get_now();
    // Cross-layer assembly motion needs up-to-date joint grounding. Acid/erase
    // mid-stepLayer dirties bonds (jointDirty) but deliberately leaves
    // jointGroundReady set so the second layer doesn't single-layer-drop while
    // still supported. That means this tick's start-of-step grounded flags can
    // be stale after reactions: a dual-layer chunk that lost its support would
    // skip moveRigidAssemblies (still marked cross-bonded + grounded) AND skip
    // moveCrossLayerBondedAssemblies (jointBondsInvalid) — stuttering or freezing
    // until a dissolve-free step. Refresh joints when dirtied, then move.
    bool jointRefreshedAfterLayers = false;
    if (bgEnabled && (comps.jointDirty || comps.jointBondsInvalid)) {
      computeGroundedBoth(); // adds into grounding / crossLayer / componentIndex
      comps.jointGroundReady = true;
      comps.jointDirty = false;
      comps.jointBondsInvalid = false;
      jointRefreshedAfterLayers = true;
    }
    if (comps.jointGroundReady) {
#ifdef SAND_INVARIANT_CHECKS
      validateInvariants("pre-crossmove");
#endif
      double tAsm = emscripten_get_now();
      moveCrossLayerBondedAssemblies();
      perfAssemblyUnionMs += emscripten_get_now() - tAsm;
#ifdef SAND_INVARIANT_CHECKS
      validateInvariants("post-crossmove");
#endif
      // After a post-reaction recompute, comps that lost support and are NOT
      // cross-bonded were still "grounded" during stepLayer's moveRigidAssemblies.
      // Give them one catch-up fall. Cross-bonded ungrounded comps are handled by
      // moveCrossLayerBondedAssemblies above (and filtered out of this pass).
      if (jointRefreshedAfterLayers) {
        double tA2 = emscripten_get_now();
        useLayer(&fg); moveRigidAssemblies();
        useLayer(&bg); moveRigidAssemblies();
        perfAssemblyUnionMs += emscripten_get_now() - tA2;
      }
      fgA = fgA || layerActive(&fg);
      bgA = bgA || layerActive(&bg);
    }
    crossLayerReactions(fgA, bgA);
    transferPass(fgA, bgA);
    perfCrossMs = emscripten_get_now() - tX0;
    // End-of-step structural counts (cheap O(components), not O(grid)).
    auto countComps = [&](Layer& lay) {
      auto acc = [&](const std::vector<Comp>& list) {
        perfComponentCount += (int)list.size();
        for (const auto& c : list) perfComponentCellCount += (int)c.cells.size();
      };
      acc(lay.stoneComponents); acc(lay.plantComponents); acc(lay.iceComponents);
    };
    countComps(fg); countComps(bg);
    // Live residual bonds, or (when cleared after all-grounded) count of comps
    // still flagged cross-bonded this tick.
    if (!comps.cgBonds.empty()) perfCrossBondCount = (int)comps.cgBonds.size();
    else {
      int n = 0;
      for (uint8_t f : fg.crossBondedComp) if (f) n++;
      for (uint8_t f : bg.crossBondedComp) if (f) n++;
      perfCrossBondCount = n;
    }
    useLayer(&fg); // leave fg active for ABI/render/tool calls between steps
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-step");
#endif
    perfStepMs = emscripten_get_now() - t0;
    return true;
  }

  // Compatibility path for deterministic tests, benches, and embedders that
  // intentionally advance actors and world in lockstep.
  bool step() {
    bool actors = stepActors();
    bool world = stepWorld();
    return actors || world;
  }

  // ---- cross-layer fire (uses the shared RNG) ----
  // Fire jumps between layers: a FIRE cell in one layer ignites a flammable at the
  // SAME (x,y) in the other layer (both directions, probabilistic). Runs after
  // both layers have stepped, over the union of their active regions (fire is
  // always in an active region). Gated on bgEnabled so single-layer scenes draw no
  // RNG and stay byte-identical to a one-layer build.
  void crossLayerReactions(bool fgA, bool bgA) {
    if (!bgEnabled) return;
    // Cross-layer ignition must honor the same invariants as in-layer ignition
    // (applyReactions): a burned PLANT cell must split its component (or the
    // comp keeps a phantom cell — found by the --dev validator), and a
    // flammable BODY cell is owned by erodeBodies, not in-place ignition
    // (body-material invariant). The rand() draws stay UNCONDITIONAL so the
    // shared stream is byte-identical to before; only the write is gated.
    bool fgPlantBurned = false, bgPlantBurned = false;
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
          if (rand() < FIRE_CROSS_P && bg.bodyOwner[k] == -1) {
            if (isPlantMaterial(b)) bgPlantBurned = true;
            bg.grid[k] = FIRE; if (x < bg.rowMarkMin[y]) bg.rowMarkMin[y] = x; if (x > bg.rowMarkMax[y]) bg.rowMarkMax[y] = x;
          }
        } else if (b == FIRE && isFlammable(f)) {
          if (rand() < FIRE_CROSS_P && fg.bodyOwner[k] == -1) {
            if (isPlantMaterial(f)) fgPlantBurned = true;
            fg.grid[k] = FIRE; if (x < fg.rowMarkMin[y]) fg.rowMarkMin[y] = x; if (x > fg.rowMarkMax[y]) fg.rowMarkMax[y] = x;
          }
        }
      }
    }
    if (fgPlantBurned) { useLayer(&fg); splitPlantAfterErase(); }
    if (bgPlantBurned) { useLayer(&bg); splitPlantAfterErase(); }
    if (fgPlantBurned || bgPlantBurned) useLayer(&fg);
  }

  // ---- cross-layer transfer (RNG-free) ----
  // A loose cell (powder or liquid) that is stuck in its layer moves to the other
  // layer at the same (x,y) when it can keep falling there. A gas uses the inverse
  // rule: when it is blocked upward here, it moves to an empty same-cell target in
  // the other layer only if it can keep rising there. The "can keep moving" rule
  // prevents endless layer-to-layer bouncing.
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
    if (isLiquidMaterial(m)) for (int i = 0; i < 2; i++) {
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
  bool gasBlockedUpIn(Layer* lay, int x, int y) {
    if (y <= 1) return true;
    uint8_t* g = lay->grid;
    int above = (y - 1) * cols + x;
    if (g[above] == EMPTY) return false;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? -1 : 1, nx = x + dx;
      if (nx <= 0 || nx >= cols - 1) continue;
      if (g[above + dx] == EMPTY) return false;
    }
    return true;
  }
  bool canRise(Layer* other, int x, int y) {
    if (y <= 1) return false;
    return other->grid[(y - 1) * cols + x] == EMPTY;
  }
  bool tryTransfer(Layer* from, Layer* to, int x, int y, int k) {
    uint8_t m = from->grid[k];
    if (isGasMaterial(m)) {
      if (to->grid[k] != EMPTY) return false;
      if (!gasBlockedUpIn(from, x, y)) return false;
      if (!canRise(to, x, y)) return false;
      to->grid[k] = m; from->grid[k] = EMPTY;
      if (x < to->rowMarkMin[y]) to->rowMarkMin[y] = x; if (x > to->rowMarkMax[y]) to->rowMarkMax[y] = x;
      if (x < from->rowMarkMin[y]) from->rowMarkMin[y] = x; if (x > from->rowMarkMax[y]) from->rowMarkMax[y] = x;
      return true;
    }
    // Powders AND liquids cross layers when stuck. The transfer only fires when the
    // cell is stuck in `from` (nowhere to fall/flow in its own layer) AND can keep
    // FALLING in `to` (canFall) — so it never bleeds sideways into a solid backdrop
    // (generated bg is solid behind oceans, so canFall is false there: no churn).
    // It DOES drain into space the player digs out in the other layer — e.g. mining
    // the background under foreground water lets the water pour into the new channel
    // on its own. Settling fluids (flat bodies go inert) keep this from shimmering.
    if (!isLooseMedium(m)) return false;
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
    // Cross-layer powder/liquid motion invalidates both layers' loose overlays.
    auto touchLoose = [&](Layer* lay) {
      lay->looseGroundDirty = true;
      if ((int)lay->looseDirtyCol.size() == cols) lay->looseDirtyCol[x] = 1;
      if (lay->looseDirtyX1 < lay->looseDirtyX0) { lay->looseDirtyX0 = x; lay->looseDirtyX1 = x; }
      else {
        if (x < lay->looseDirtyX0) lay->looseDirtyX0 = x;
        if (x > lay->looseDirtyX1) lay->looseDirtyX1 = x;
      }
    };
    touchLoose(from); touchLoose(to);
    // mark both layers dirty at (x,y) so render + net + L->next-step settle pick it up
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
