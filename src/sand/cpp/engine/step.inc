  // World-step orchestration. One shared tick steps foreground, then background,
  // and finally reconciles cross-layer support, reactions, and transfer. Actor
  // updates run independently in stepActors(); step() composes both clocks for
  // compatibility. Local cell movement rules live in core.inc.

  void stepLayer(Layer* layer) {
    useLayer(layer);
    if (!beginStepDirty()) return; // nothing active in this layer this step
    if (L->groundDirty || L->groundContentDirty || !L->groundBaseValid)
      L->componentCarryDirty = true;
    audio.beginRegionalPass();
    // Timers accumulate across both layers and are reset once per world tick.
    double t0 = emscripten_get_now();
    if (!comps.jointGroundReady) comps.ensureGroundedSingleLayer(); // joint cross-layer flood already ran in step()
    perfGroundingMs += emscripten_get_now() - t0;

    double tA = emscripten_get_now();
    comps.moveRigidAssemblies();
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-assemblies");
#endif
    perfAssemblyUnionMs += emscripten_get_now() - tA;

    double tB = emscripten_get_now();
    reactions.applyBodyIce();
    forces.applyBodyForces();
    rigid.moveBodies();
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-moveBodies");
#endif
    perfBodyMs += emscripten_get_now() - tB;

    double tR = emscripten_get_now();
    growth.growPlantComponents();
    growth.growMyceliumComponents();
    reactions.prepareActiveLists();
    reactions.applyReactions();
    reactions.applyAcid();
    reactions.applyLava();
    reactions.applyIce(); reactions.applySalt(); explosives.applyExplosives();
#ifdef SAND_INVARIANT_CHECKS
    validateInvariants("post-reactions");
#endif
    perfReactMs += emscripten_get_now() - tR;

    double tC = emscripten_get_now();
    prepareNextBuffer();
    bool blastLocalCarry = L->blastSparseCarryReady
      && !L->looseGroundDirty;
    bool indexedLocalCarry = L->groundBaseValid
      && !L->groundDirty && !L->groundContentDirty
      && !L->componentCarryDirty;
    bool localRigidCarry = blastLocalCarry || indexedLocalCarry;
    if (localRigidCarry) {
      auto carryRigidSpan = [&](int y, int minX, int maxX) {
        int rb = y * cols;
        for (int x = minX; x <= maxX; x++) {
          int k = rb + x;
          bool currentOwned = L->cellComp[k] >= 0 || L->bodyOwner[k] >= 0;
          if ((blastLocalCarry && isRigidMaterialClass(L->grid[k]))
              || currentOwned || isRigidMaterialClass(L->next[k]))
            L->next[k] = L->grid[k];
        }
      };
      for (int y = 0; y < rows; y++) {
        for (const auto& span : L->activeRowSpans[y])
          carryRigidSpan(y, span.first, span.second);
        for (const auto& span : L->rowMarkSpans[y])
          carryRigidSpan(y, span.first, span.second);
      }
      if (localRigidCarry) {
        L->curBodyCells.clear();
        auto noteBody = [&](int k) {
          L->compOccStamp[k] = tick;
          L->curBodyCells.push_back(k);
        };
        for (int k : L->bodyCells) noteBody(k);
        for (int k : L->passiveBodyCells) noteBody(k);
        for (int k : L->prevBodyCells) {
          if (L->cellComp[k] >= 0 || L->bodyOwner[k] >= 0) continue;
          if (L->grid[k] == EMPTY || isRigidMaterialClass(L->grid[k])) {
            L->grid[k] = EMPTY;
            L->next[k] = EMPTY;
            markCellIndex(k);
          } else if (isRigidMaterialClass(L->next[k])) {
            L->next[k] = L->grid[k];
            markCellIndex(k);
          }
        }
        std::swap(L->prevBodyCells, L->curBodyCells);
      }
    } else {
      L->curCompCells.clear();
      for (auto& comp : L->components) for (int k : comp.cells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curCompCells.push_back(k); }
      L->curBodyCells.clear();
      for (int k : L->bodyCells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curBodyCells.push_back(k); }
      for (int k : L->passiveBodyCells) { L->next[k] = L->grid[k]; L->compOccStamp[k] = tick; L->curBodyCells.push_back(k); }
      for (int k : L->prevCompCells) {
        if (L->cellComp[k] >= 0 || L->bodyOwner[k] >= 0) continue;
        if (L->grid[k] == EMPTY || isRigidMaterialClass(L->grid[k])) {
          L->grid[k] = EMPTY; L->next[k] = EMPTY; markCellIndex(k);
        } else if (isRigidMaterialClass(L->next[k])) {
          L->next[k] = L->grid[k]; markCellIndex(k);
        }
      }
      for (int k : L->prevBodyCells) {
        if (L->cellComp[k] >= 0 || L->bodyOwner[k] >= 0) continue;
        if (L->grid[k] == EMPTY || isRigidMaterialClass(L->grid[k])) {
          L->grid[k] = EMPTY; L->next[k] = EMPTY; markCellIndex(k);
        } else if (isRigidMaterialClass(L->next[k])) {
          L->next[k] = L->grid[k]; markCellIndex(k);
        }
      }
      std::swap(L->prevCompCells, L->curCompCells);
      std::swap(L->prevBodyCells, L->curBodyCells);
      L->componentCarryDirty = false;
    }
    perfCarryMs += emscripten_get_now() - tC;

    // Build movement candidates once in the exact order each settle pass used
    // to discover them. Zoomed-out active bands are mostly empty/rigid; avoiding
    // four repeated full-span scans is substantially cheaper than probing every
    // cell separately for density, powder, liquid, and gas.
    activeDensityCells.clear(); activeSandCells.clear(); activeLiquidCells.clear(); activeGasCells.clear();
    for (int y = rows - 1; y >= 0; y--) {
      if (L->activeRowSpans[y].empty()) continue;
      int rb = y * cols; bool ltr = (y & 1) == 0;
      activeGasRow.clear();
      auto gather = [&](int x) {
        int k = rb + x;
        uint8_t m = L->grid[k];
        if (isLooseDensityMaterial(m) && y + 1 < rows
            && (canDisplaceByLooseDensity(m, L->grid[k + cols])
                || (x > 1 && canDisplaceByLooseDensity(
                      m, L->grid[k + cols - 1]))
                || (x < cols - 2 && canDisplaceByLooseDensity(
                      m, L->grid[k + cols + 1]))))
          activeDensityCells.push_back(k);
        if (isLooseSolidMaterial(m)) activeSandCells.push_back(k);
        if (isLiquidMaterial(m)) activeLiquidCells.push_back(k);
        if (isGasMaterial(m)) activeGasRow.push_back(k);
      };
      forEachActiveSpan(y, 0, cols - 1, ltr, [&](int minX, int maxX) {
        if (ltr) for (int x = minX; x <= maxX; x++) gather(x);
        else for (int x = maxX; x >= minX; x--) gather(x);
      });
      activeGasCells.insert(activeGasCells.end(), activeGasRow.rbegin(), activeGasRow.rend());
    }
    std::reverse(activeGasCells.begin(), activeGasCells.end());

    liquidDispPending.clear();
    double tS = emscripten_get_now();
    for (int k : activeDensityCells) { int y = k / cols; settleLooseDensityInterface(k - y * cols, y, k); }
    for (int k : activeSandCells) { int y = k / cols; if (isLooseSolidMaterial(L->grid[k])) settleSand(k - y * cols, y, k); }
    perfSandMs += emscripten_get_now() - tS;

    double tL = emscripten_get_now();
    for (size_t first = 0; first < activeLiquidCells.size();) {
      int rowK = activeLiquidCells[first];
      int y = rowK / cols, rowBegin = y * cols, rowEnd = rowBegin + cols;
      size_t last = first + 1;
      while (last < activeLiquidCells.size()
             && activeLiquidCells[last] >= rowBegin
             && activeLiquidCells[last] < rowEnd)
        last++;
      for (; first < last; first++) {
        int k = activeLiquidCells[first];
        uint8_t m = L->grid[k];
        if (!isLiquidMaterial(m)) continue;
        int x = k - rowBegin;
        if (m == LAVA) settleLava(x, y, k);
        else settleLiquid(x, y, k, m);
      }
    }
    // Density-chain relocate liquids displaced by denser liquids this settle (before
    // gas claims free cells and before the double-buffer swap commits next[]).
    resolveLiquidDisplacements();
    perfLiquidMs += emscripten_get_now() - tL;

    double tG = emscripten_get_now();
    for (int k : activeGasCells) { uint8_t m = L->grid[k]; if (!isGasMaterial(m)) continue; int y = k / cols, x = k - y * cols; if (m == FIRE) riseFire(x, y, k); else riseSteam(x, y, k, m); }
    perfGasMs += emscripten_get_now() - tG;

    double tT = emscripten_get_now();
    std::swap(L->grid, L->next);
    std::swap(L->fallSpeed, L->nextFallSpeed);
    std::swap(L->liquidVel, L->nextLiquidVel);
    double tRelax = emscripten_get_now();
    if (L->bodies.size() >= R_DENSE_RIGID_CARGO_BODIES
        || (tick & 1) == 0)
      relaxLiquidGaps();
    perfLiquidRelaxMs += emscripten_get_now() - tRelax;
    if (gravityCellStep && tick % 3 == 0) separateLooseByDensity();
    double tSurface = emscripten_get_now();
    levelLiquidSurfaces();
    perfLiquidSurfaceMs += emscripten_get_now() - tSurface;
    applySideSinks();
    perfTailMs += emscripten_get_now() - tT;
    audio.flushRegionalPass();
  }

  // Players, projectiles, items, and creatures advance on a separate deterministic
  // clock so a quiet cellular world does not throttle real-time actors.
  bool stepActors() {
    double t0 = emscripten_get_now();
    useLayer(&fg);
    psys.updatePlayers();
    projectiles.updateProjectiles();
    itemsys.updateItems();
    creatures.updateCreatures();
    missions.update();
    actorTick++;
    perfActorMs = emscripten_get_now() - t0;
    return !psys.players.empty() || !projectiles.projectiles.empty() || !itemsys.items.empty() ||
      !creatures.creatures.empty() || !creatures.pendingSpawns.empty();
  }

  bool stepWorld() {
    if (storageRole == ESR_PRESENTATION) return false;
    double t0 = emscripten_get_now();
    perfForceWakeMs = 0;
    double tForce = emscripten_get_now();
    forces.prepareWorldTick();
    perfForcePrepareMs = emscripten_get_now() - tForce - perfForceWakeMs;
    auto retainSleepingBodySupportDirty = [&](Layer& lay) {
      if (!lay.groundDirty && !lay.groundContentDirty && !lay.looseGroundDirty) return;
      for (Body* b : lay.bodies) if (b->jointRole != 2 && !b->awake) {
        lay.sleepingBodySupportDirty = true;
        break;
      }
    };
    retainSleepingBodySupportDirty(fg);
    retainSleepingBodySupportDirty(bg);
    bool fgA = layerActive(&fg), bgA = layerActive(&bg);
    if (!fgA && !bgA) { useLayer(&fg); perfStepMs = 0; return false; }
    tick++;
    advanceGravityCadence();
    // Zero fine-phase timers + dirty volume (stepLayer / joint accumulate into these).
    perfDirtyChunks = perfDirtyRows = perfDirtyCells = 0;
    perfComponentCount = perfComponentCellCount = perfCrossBondCount = 0;
    perfGroundingMs = perfCrossLayerGroundingMs = perfComponentIndexMs = 0;
    perfAssemblyUnionMs = perfCarryMs = perfBodyMs = 0;
    perfSandMs = perfLiquidMs = perfGasMs = 0;
    perfReactMs = perfTailMs = perfLiquidRelaxMs = perfLiquidSurfaceMs = 0;
    perfLayersMs = perfCrossMs = 0;
    // Cross-layer grounding: compute groundedness jointly over both layers up
    // front so solids in one layer support solids at the same cell in the other
    // (gated on bgEnabled -> single-layer scenes stay byte-identical). Each
    // stepLayer() then skips its own first computeGrounded().
    comps.jointGroundReady = false;
    comps.jointBondsInvalid = false;
    if (comps.jointDirtyDeferred) {
      comps.jointDirty = true;
      comps.jointDirtyDeferred = false;
    }
    // Idle-structure skip: do NOT force a joint pass just because marked rows hold
    // structural components or residual static powder exist. Joint runs when:
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
      comps.computeGroundedBoth(); comps.jointGroundReady = true; comps.jointDirty = false;
      fgA = fgA || layerActive(&fg);
      bgA = bgA || layerActive(&bg);
    }
    double tL0 = emscripten_get_now();
    if (fgA) stepLayer(&fg); // foreground first -> deterministic shared-RNG order
    if (bgEnabled && comps.jointBakeNeedsGroundRefresh) {
      comps.computeGroundedBoth();
      comps.jointGroundReady = true;
      comps.jointDirty = false;
      comps.jointBondsInvalid = false;
      comps.jointBakeNeedsGroundRefresh = false;
      fgA = fgA || layerActive(&fg);
      bgA = bgA || layerActive(&bg);
    }
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
    // Plant erosion defers joint invalidation so the second layer keeps the
    // start-of-tick support closure. Both layers are complete here, so consume
    // that invalidation before deciding whether the bonded assembly can move.
    if (comps.jointDirtyDeferred) {
      comps.jointDirty = true;
      comps.jointDirtyDeferred = false;
    }
    if (bgEnabled && (comps.jointDirty || comps.jointBondsInvalid)) {
      comps.computeGroundedBoth(); // adds into grounding / crossLayer / componentIndex
      comps.jointGroundReady = true;
      comps.jointDirty = false;
      comps.jointBondsInvalid = false;
      jointRefreshedAfterLayers = true;
    }
    if (comps.jointGroundReady && !comps.jointDirtyDeferred) {
#ifdef SAND_INVARIANT_CHECKS
      validateInvariants("pre-crossmove");
#endif
      double tAsm = emscripten_get_now();
      comps.moveCrossLayerBondedAssemblies();
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
        useLayer(&fg); comps.moveRigidAssemblies();
        useLayer(&bg); comps.moveRigidAssemblies();
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
      acc(lay.components);
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
    bool fgIndexExact = fg.groundBaseValid && !fg.groundDirty && !fg.groundContentDirty;
    bool bgIndexExact = bg.groundBaseValid && !bg.groundDirty && !bg.groundContentDirty;
    Layer* previousLayer = L;
    auto igniteCell = [&](Layer& layer, int k) {
      useLayer(&layer);
      writeGridIndex(k, FIRE);
    };
    crossFireErasedFg.clear(); crossFireErasedBg.clear();
    crossFrozenIceFg.clear(); crossFrozenIceBg.clear();
    crossBodyFrozenIceFg.clear(); crossBodyFrozenIceBg.clear();
    for (int y = 1; y < rows - 1; y++) {
      forEachActiveUnionSpan(&fg, fgA, &bg, bgA, y, 1, cols - 2, true,
                             [&](int mn, int mx) {
        for (int x = mn; x <= mx; x++) {
        int k = y * cols + x;
        uint8_t f = fg.grid[k], b = bg.grid[k];
        if (f == FIRE && isFlammable(b)) {
          if (rand() < FIRE_CROSS_P && bg.bodyOwner[k] == -1) {
            if (isPlantMaterial(b)) crossFireErasedBg.push_back(k);
            igniteCell(bg, k);
          }
        } else if (b == FIRE && isFlammable(f)) {
          if (rand() < FIRE_CROSS_P && fg.bodyOwner[k] == -1) {
            if (isPlantMaterial(f)) crossFireErasedFg.push_back(k);
            igniteCell(fg, k);
          }
        }
        // Co-occupied cells are adjacent across the two simulated planes.
        // Static ICE registers a static target component. Body-owned ICE
        // extends its shared-pose body into the target layer.
        if (f == ICE && b == WATER && bg.bodyOwner[k] < 0) {
          uint32_t phase = fg.worldSeed ^ 0x1CEB0D2u
                         ^ ((uint32_t)tick * 0x9E3779B9u);
          if (whash2(phase, fg.worldOffsetX + x,
                     fg.worldOffsetY + y) < ICE_FREEZE_P) {
            if (fg.bodyOwner[k] >= 0)
              crossBodyFrozenIceBg.push_back({fg.bodyOwner[k], k});
            else
              crossFrozenIceBg.insert(k);
          }
        } else if (b == ICE && f == WATER && fg.bodyOwner[k] < 0) {
          uint32_t phase = fg.worldSeed ^ 0x1CEB0D3u
                         ^ ((uint32_t)tick * 0x9E3779B9u);
          if (whash2(phase, fg.worldOffsetX + x,
                     fg.worldOffsetY + y) < ICE_FREEZE_P) {
            if (bg.bodyOwner[k] >= 0)
              crossBodyFrozenIceFg.push_back({bg.bodyOwner[k], k});
            else
              crossFrozenIceFg.insert(k);
          }
        }
        }
      });
    }
    if (!crossFireErasedFg.empty()) { useLayer(&fg); finishPlantErosion(crossFireErasedFg, fgIndexExact, true); }
    if (!crossFireErasedBg.empty()) { useLayer(&bg); finishPlantErosion(crossFireErasedBg, bgIndexExact, true); }
    auto commitBodyFrozenIce = [&](Layer& source, Layer& target,
                                   std::vector<std::pair<int, int>>& frozen) {
      if (frozen.empty()) return;
      std::sort(frozen.begin(), frozen.end());
      for (size_t begin = 0; begin < frozen.size();) {
        size_t end = begin + 1;
        while (end < frozen.size() && frozen[end].first == frozen[begin].first) end++;
        std::vector<int> cells;
        cells.reserve(end - begin);
        for (size_t i = begin; i < end; i++)
          if (i == begin || frozen[i].second != frozen[i - 1].second)
            cells.push_back(frozen[i].second);
        rigid.freezeCellsOntoBody(source, frozen[begin].first,
                                  target, cells);
        begin = end;
      }
    };
    commitBodyFrozenIce(bg, fg, crossBodyFrozenIceFg);
    commitBodyFrozenIce(fg, bg, crossBodyFrozenIceBg);
    auto commitFrozenIce = [&](Layer& layer, std::unordered_set<int>& cells) {
      if (cells.empty()) return;
      useLayer(&layer);
      for (auto it = cells.begin(); it != cells.end();) {
        int k = *it;
        if (layer.grid[k] == WATER) {
          writeGridIndex(k, ICE);
          ++it;
        } else {
          it = cells.erase(it);
        }
      }
      registerRigidCellsSplit(layer.components, layer.nextComponentId,
                              ICE, cells, true);
    };
    commitFrozenIce(fg, crossFrozenIceFg);
    commitFrozenIce(bg, crossFrozenIceBg);
    useLayer(previousLayer);
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
      if (to->liquidVel) {
        to->liquidVel[k] = 0;
        from->liquidVel[k] = 0;
      }
      markLayerRowSpan(to, y, x, x);
      markLayerRowSpan(from, y, x, x);
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
    uint8_t srcSpeed = from->fallSpeed ? from->fallSpeed[k] : 0;
    uint8_t dstSpeed = to->fallSpeed ? to->fallSpeed[k] : 0;
    uint32_t srcVelocity = from->liquidVel ? from->liquidVel[k] : 0;
    uint32_t dstVelocity = to->liquidVel ? to->liquidVel[k] : 0;
    if (swap) {
      to->grid[k] = m; from->grid[k] = dst;
      if (to->fallSpeed) to->fallSpeed[k] = srcSpeed;
      if (from->fallSpeed) from->fallSpeed[k] = dstSpeed;
      if (to->liquidVel) {
        to->liquidVel[k] = isLiquidMaterial(m) ? srcVelocity : 0;
        from->liquidVel[k] = isLiquidMaterial(dst) ? dstVelocity : 0;
      }
    } else {
      to->grid[k] = m; from->grid[k] = EMPTY;
      if (to->fallSpeed) to->fallSpeed[k] = srcSpeed;
      if (from->fallSpeed) from->fallSpeed[k] = 0;
      if (to->liquidVel) {
        to->liquidVel[k] = isLiquidMaterial(m) ? srcVelocity : 0;
        from->liquidVel[k] = 0;
      }
    }
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
    markLayerRowSpan(to, y, x, x);
    markLayerRowSpan(from, y, x, x);
    return true;
  }
  void transferPass(bool fgA, bool bgA) {
    if (!bgEnabled) return; // an empty/untouched background does not interact
    for (int y = rows - 1; y >= 0; y--) {
      bool ltr = (y & 1) == 0;
      auto transferAt = [&](int x) {
        int k = y * cols + x;
        uint8_t f = fg.grid[k], b = bg.grid[k];
        // Empty/rigid pairs dominate zoomed-out terrain and can never transfer.
        // Reject them before two tryTransfer calls and their neighbour probes.
        if (!isGasMaterial(f) && !isLooseMedium(f) && !isGasMaterial(b) && !isLooseMedium(b)) return;
        if (!tryTransfer(&fg, &bg, x, y, k)) tryTransfer(&bg, &fg, x, y, k);
      };
      forEachActiveUnionSpan(&fg, fgA, &bg, bgA, y, 0, cols - 1, ltr,
                             [&](int mn, int mx) {
        if (ltr) for (int x = mn; x <= mx; x++) transferAt(x);
        else for (int x = mx; x >= mn; x--) transferAt(x);
      });
    }
  }
