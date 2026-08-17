  // Hot per-cell movement helpers for loose powders, liquids, gases, and
  // density interfaces.
  //
  // step.inc decides the tick order; this file owns the tiny local movement
  // rules used inside that order. Keep high-level gameplay/tool policy out of
  // this path because it runs over the active rows every simulation tick.

  // ---- settle passes ----
  // Falling loose cells carry downward momentum in Layer::fallSpeed. A clear
  // vertical fall accelerates by one cell/tick until its material's terminal
  // speed; contact, diagonal avalanching, and lateral flow reset that momentum.
  // Liquid terminal speed remains density-scaled, except lava shares the normal
  // water/acid/brine cap. Every loose solid shares the lower powder cap so
  // material identity does not change freefall distance.
  static const int LIQUID_FALL_PER_DENSITY = 3;
  static const int LIQUID_FALL_CAP = 5;
  static const int POWDER_FALL_CAP = 3;
  int looseFallCap(uint8_t m) {
    if (isLooseSolidMaterial(m)) return POWDER_FALL_CAP;
    uint8_t fixedCap = LIQUID_FIXED_FALL_CAP[MAT_LIQUID_PROFILE[m]];
    if (fixedCap) return fixedCap;
    int cap = (int)std::lround(DENSITY[m] * LIQUID_FALL_PER_DENSITY);
    return imax(1, imin(LIQUID_FALL_CAP, cap));
  }
  uint8_t acceleratedFallSpeed(int k, uint8_t m) {
    int speed = L->fallSpeed.current ? (int)L->fallSpeed.current[k] + 1 : 1;
    return (uint8_t)imin(looseFallCap(m), imax(1, speed));
  }
  void carryNextFallSpeed(int k, uint8_t speed) {
    if (L->fallSpeed.next) L->fallSpeed.next[k] = speed;
  }
  bool canLooseDensitySettleThisTick(uint8_t m) { float mob = MOBILITY[m]; return mob >= 1 || rand() < mob; }
  void settleLooseDensityInterface(int x, int y, int k) {
    uint8_t m = L->grid[k];
    if (!isLooseDensityMaterial(m) || L->next[k] != EMPTY) return;
    if (L->vacatedStamp[k] == tick) return;
    if (L->forceActive && forces.overridesGravity(x, y, m)) return;
    if (!gravityCellStepAt(x)) return;
    if (!canLooseDensitySettleThisTick(m)) return;
    int belowK = k + cols;
    // Liquid↔liquid density is handled by settleLiquid (deep sink through lighter
    // fluid + multi-source BFS relocate). One-cell swaps here recreated the old
    // row-by-row bubble-sort look. Keep this pass for powder↔powder / powder↔liquid.
    auto trySink = [&](int ik) {
      if (!canDisplaceByLooseDensity(m, L->grid[ik]) || L->next[ik] != EMPTY) return false;
      if (isLiquidMaterial(m) && isLiquidMaterial(L->grid[ik])) return false;
      moveMaterialInto(k, ik, m);
      return true;
    };
    if (y + 1 < rows && trySink(belowK)) return;
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i]; int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      if (trySink(belowK + dx)) return;
    }
  }
  // Settle one POWDER cell. `self` is the actual powder material (SAND, DIRT,
  // SNOW, ...), so every new position keeps that material instead of becoming
  // SAND. The "packed" early-out checks for the SAME powder all around below.
  void settleSand(int x, int y, int k) {
    if (L->next[k] != EMPTY) return;
    uint8_t self = L->grid[k];
    if (L->forceActive && forces.tryMoveLoose(x, y, k, self)) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && L->grid[belowK] == self && L->grid[belowK - 1] == self && L->grid[belowK + 1] == self) { if (L->next[k] == EMPTY) writeNextIndex(k, self); return; }
    if (!gravityCellStepAt(x) && y + 1 < rows) {
      auto canFallInto = [&](int ik) {
        uint8_t target = L->grid[ik];
        return L->next[ik] == EMPTY
          && (target == EMPTY || canDisplaceMaterial(self, target));
      };
      bool gravityPath = canFallInto(belowK)
        || (x > 1 && canFallInto(belowK - 1))
        || (x < cols - 2 && canFallInto(belowK + 1));
      if (gravityPath) {
        uint8_t speed = acceleratedFallSpeed(k, self);
        writeNextIndex(k, self);
        carryNextFallSpeed(k, speed);
        markCellIndex(k);
        return;
      }
    }
    if (y + 1 < rows && L->grid[belowK] == EMPTY && L->next[belowK] == EMPTY) {
      uint8_t speed = acceleratedFallSpeed(k, self);
      int dst = belowK;
      for (int s = 2; s <= speed; s++) {
        if (y + s >= rows) break;
        int nk = k + s * cols;
        if (L->grid[nk] != EMPTY || L->next[nk] != EMPTY) break;
        dst = nk;
      }
      vacateForNextMove(k);
      writeNextIndex(dst, self);
      carryPersistentStateToNext(k, dst, self, PCSO_MOVE);
      carryNextFallSpeed(dst, speed);
      audio.notePowderMove(self, dst % cols, dst / cols, (dst - k) / cols);
      if (dst != belowK) markMoveSpan(k, dst);
      return;
    }
    if (y + 1 < rows && canDisplaceMaterial(self, L->grid[belowK]) && L->next[belowK] == EMPTY) { moveMaterialInto(k, belowK, self); return; }
    int firstDx = rand() < 0.5 ? -1 : 1, secondDx = -firstDx;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? firstDx : secondDx; int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx; uint8_t m = L->grid[ik];
      if (m == EMPTY && L->next[ik] == EMPTY) {
        vacateForNextMove(k); writeNextIndex(ik, self);
        carryPersistentStateToNext(k, ik, self, PCSO_MOVE);
        audio.notePowderMove(self, nx, y + 1); return;
      }
      if (canDisplaceMaterial(self, m) && L->next[ik] == EMPTY) { moveMaterialInto(k, ik, self); return; }
    }
    if (L->next[k] == EMPTY) writeNextIndex(k, self);
  }
  void settleLiquid(int x, int y, int k, uint8_t m,
                    bool handleSpatialForce = true) {
    if (L->next[k] != EMPTY) return;
    // Already moved this tick (e.g. denser liquid sank in settleLooseDensityInterface
    // and enqueued a lighter liquid instead of swapping into the source). Without this
    // guard the same grid cell is settled again and duplicates into a free next[].
    if (L->vacatedStamp[k] == tick) return;
    if (handleSpatialForce
        && L->forceActive && forces.tryMoveLoose(x, y, k, m)) return;
    int belowK = k + cols;
    // Packed early-out must use effective occupancy (next / vacated), not raw grid[].
    // Otherwise a denser cell above one that just sank still sees "solid pack of m"
    // in grid and goes inert — killing same-tick cascade through a lighter pool and
    // recreating the old row-by-row bubble.
    // Also: do NOT early-out when a strictly lighter liquid is above (submerged denser
    // free surface) — that cell still needs lateral equalize into the lighter body or
    // a brine mound under water freezes into a permanent pyramid.
    if (y + 1 < rows && x > 0 && x < cols - 1 && liquidOccupantAt(k - 1) == m && liquidOccupantAt(k + 1) == m
        && !(y > 1 && isLiquidMaterial(L->grid[k - cols]) && canDisplaceByLooseDensity(m, L->grid[k - cols]))) {
      uint8_t below = liquidOccupantAt(belowK), bl = liquidOccupantAt(belowK - 1), br = liquidOccupantAt(belowK + 1);
      if ((below == m && bl == m && br == m) || (supportsLiquid(below, m) && bl != EMPTY && !canDisplaceMaterial(m, bl) && br != EMPTY && !canDisplaceMaterial(m, br))) {
        L->next[k] = m;
        carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
        return; // settled flat surface -> go inert (no re-mark just for open sky above)
      }
    }
    if (!gravityCellStepAt(x) && y + 1 < rows) {
      bool gravityPath = liquidColumnPassable(belowK, m);
      if (!gravityPath) {
        for (int dx : {-1, 1}) {
          int nx = x + dx;
          if (nx <= 0 || nx >= cols - 1) continue;
          if (liquidCanClaim(belowK + dx, m)) { gravityPath = true; break; }
        }
      }
      if (gravityPath) {
        uint8_t speed = acceleratedFallSpeed(k, m);
        writeNextIndex(k, m);
        carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
        carryNextFallSpeed(k, speed);
        markCellIndex(k);
        return;
      }
    }
    // FALL / SINK: less-dense liquid is free volume for a *single-cell* sink
    // (local density exchange). Multi-cell freefall is EMPTY-only.
    //
    // Treating a deep oil column as air and landing many cells down made the
    // denser's vacated source sit far above the displaced oil. resolve then
    // BFS'd oil to free-surface empties (or restored into that high fallback)
    // — the whole pool "sucked up" into the falling fluid like a geyser.
    if (y + 1 < rows && liquidColumnPassable(belowK, m)) {
      uint8_t belowOcc = liquidOccupantAt(belowK);
      if (belowOcc != EMPTY) {
        // Lighter liquid or gas: one-cell claim only (swap / density-chain).
        moveLiquidInto(k, x, y + 1, m);
        return;
      }
      uint8_t maxFall = acceleratedFallSpeed(k, m);
      int dst = belowK;
      for (int s = 2; s <= maxFall; s++) {
        if (y + s >= rows) break;
        int nk = k + s * cols;
        // Stop at anything non-empty — do not tunnel through lighter liquid.
        if (liquidOccupantAt(nk) != EMPTY) break;
        dst = nk;
      }
      // Vacate source + write dest. Multi-cell jumps must dirty the full span:
      // DIRTY_PAD_Y is only 2, but liquids fall up to LIQUID_FALL_CAP (5), so
      // without this the vacated source/intermediate rows fall outside next
      // step's active band, prepareNextBuffer skips them, and the double
      // buffer resurrects stale water as a ghost trail (false "duplication").
      vacateForNextMove(k);
      writeNextIndex(dst, m);
      carryPersistentStateToNext(k, dst, m, PCSO_MOVE);
      carryNextFallSpeed(dst, maxFall);
      audio.noteFluidFall(m, dst % cols, dst / cols, (dst - k) / cols);
      if (dst != k) markMoveSpan(k, dst);
      return;
    }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i]; int nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      int ik = I(nx, ny);
      if (!liquidCanClaim(ik, m)) continue;
      uint8_t occ = liquidOccupantAt(ik);
      if (occ == EMPTY) {
        vacateForNextMove(k); writeNextIndex(ik, m);
        carryPersistentStateToNext(k, ik, m, PCSO_MOVE);
        audio.noteFluidFall(m, nx, ny, 1);
        return;
      }
      moveLiquidInto(k, nx, ny, m);
      return;
    }
    int flow = 0, firstFlowDir = rand() < 0.5 ? 1 : -1;
    for (int dirIndex = 0; dirIndex < 2 && flow == 0; dirIndex++) {
      int sgn = dirIndex == 0 ? firstFlowDir : -firstFlowDir;
      for (int d = 1; d <= MAX_WATER_FLOW; d++) {
        int nx = x + sgn * d; if (nx <= 0 || nx >= cols - 1) break;
        int sideK = k + sgn * d; if (!canEnterIndex(sideK, m)) break;
        if (y + 1 < rows) { int lowerK = sideK + cols; if (canEnterIndex(lowerK, m)) { int stepK = k + sgn; if (canEnterIndex(stepK, m)) flow = sgn; break; } }
      }
    }
    if (flow != 0) { int stepX = x + flow; if (canLiquidEnter(stepX, y, m)) { moveLiquidInto(k, stepX, y, m); return; } }
    // LATERAL density push into lighter POWDER only. Lighter liquid is free volume
    // for fall / free-surface leveling (levelLiquidSurfaces, drop>=2) — not for
    // same-level flow (that PE-neutral swaps forever).
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue;
      int sk = k + dx;
      if (!liquidCanClaim(sk, m)) continue;
      uint8_t occ = liquidOccupantAt(sk);
      if (!isLooseSolidMaterial(occ) || !canDisplaceByLooseDensity(m, occ)) continue;
      moveLiquidInto(k, nx, y, m);
      return;
    }
    if (y + 1 < rows && supportsLiquid(L->grid[belowK], m)) {
      // Same material above OR lighter liquid above (submerged denser body).
      bool hasAbove = liquidPressureAbove(k, m);
      if (hasAbove) {
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int sideK = k + dx; if (x + dx <= 0 || x + dx >= cols - 1) continue; if (canEnterIndex(sideK, m) && supportsLiquid(L->grid[sideK + cols], m)) { moveMaterialInto(k, sideK, m); return; } }
      }
      // Resting on support: same-level empty is only an escape when pressured.
      // Free-surface leveling of denser mounds under lighter fluid is done by
      // levelLiquidSurfaces (lighter liquid = air, drop>=2) — same as air pyramids.
      if (L->next[k] == EMPTY) {
        L->next[k] = m;
        carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
        if ((hasAbove ? liquidCanEscape(k) : touchesUnstableLooseDensityInterface(k, m))
            || adjacentInternalHole(k, m)) markCellIndex(k);
      }
      return;
    }
    // Same-level sideways into EMPTY under pressure (own liquid or lighter liquid
    // above). Free air surface does not slide into same-level gaps (anti-shimmer).
    bool pressured = liquidPressureAbove(k, m);
    if (pressured) {
      for (int i = 0; i < 2; i++) {
        int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue;
        if (canLiquidEnter(nx, y, m) && !(L->grid[I(nx, y - 1)] == m)) { moveLiquidInto(k, nx, y, m); return; }
      }
      if (L->next[k] == EMPTY) {
        L->next[k] = m;
        carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
        bool fillableGap = false;
        for (int i = 0; i < 2; i++) {
          int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue;
          int sk = I(nx, y);
          if (L->grid[sk] == EMPTY && y > 1 && liquidPressureAbove(sk, m)) { fillableGap = true; break; }
        }
        if (fillableGap || touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
      }
      return;
    }
    if (L->next[k] == EMPTY) {
      L->next[k] = m;
      carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
      if (touchesUnstableLooseDensityInterface(k, m)
          || adjacentInternalHole(k, m)) markCellIndex(k);
    }
  }
  void settleMobilityGatedLiquid(int x, int y, int k, uint8_t material) {
    if (L->next[k] != EMPTY) return;
    if (L->forceActive
        && forces.tryMoveLoose(x, y, k, material))
      return;
    bool movementAllowed = rand() < MOBILITY[material];
    int belowK = k + cols;
    uint8_t profile = MAT_LIQUID_PROFILE[material];
    // Profiles may let a clear downward path bypass the mobility gate while
    // diagonal, lateral, and surface flow retain the configured mobility.
    bool straightGravityPath = LIQUID_STRAIGHT_FALL[profile]
      && gravityCellStepAt(x) && y + 1 < rows
      && liquidColumnPassable(belowK, material)
      && !(L->forceActive && forces.overridesGravity(x, y, material));
    if (straightGravityPath) {
      settleLiquid(x, y, k, material, false);
      return;
    }
    if (!movementAllowed) {
      writeNextIndex(k, material);
      if (L->fallSpeed.current) carryNextFallSpeed(k, L->fallSpeed.current[k]);
      return;
    }
    settleLiquid(x, y, k, material, false);
  }

  // After liquid settle: place every lighter liquid that denser fluid displaced this
  // tick. One multi-source BFS per material group per wave (not per cell).
  //
  // Placement priority (anti-geyser):
  //   1. Own fallback (denser's vacated source) — the natural 1-cell density swap.
  //      Without this, BFS raced every displaced oil cell to free-surface EMPTY and
  //      the pool "sucked" up into the falling water.
  //   2. Nearest EMPTY via BFS (only for liquids that lost their fallback; gas is
  //      pathable but not claimed — bubble swaps go through moveMaterialInto).
  //   3. Strictly less-dense liquid (chain continues).
  //   4. Spare free slots released by peers that landed elsewhere.
  //
  // Volume conservation: each pending liquid owns a real free fallback. Fallbacks
  // of unplaced liquids stay reserved so BFS cannot steal them. On chain, the
  // lighter liquid inherits that fallback — never the overwritten target cell.
  void resolveLiquidDisplacements() {
    if (liquidDispPending.empty()) return;
    int gridLen = cols * rows;
    int offs[4] = { -1, 1, cols, -cols };
    std::vector<LiquidDisp> pending = std::move(liquidDispPending);
    liquidDispPending.clear();
    std::vector<LiquidDisp> nextPending;
    std::vector<int> queue, targets, levelChain, levelEmpty, spareFree;
    std::vector<char> usedFallback; // parallel to a material group during resolve
    // Bodies already finished this stepLayer; reuse rigidSpillReserved as a free
    // reserved-stamp buffer (separate gen from seenStamp).
    L->reserveSeenGenerations(
      (size_t)(MATERIAL_COUNT + 4) * MATERIAL_COUNT + 2);
    int32_t reservedGen = L->nextSeenGeneration();

    auto plannedAt = [&](int k) -> uint8_t {
      if (L->assemblyWakeStamp[k] == tick) return STONE;
      int y = k / cols, x = k - y * cols;
      // Active rows were blanked then rewritten — next[] is authoritative there
      // for materials that already settled. Gas rises AFTER this resolve pass;
      // powder may still sit only in grid if no sink claimed it. Treat both as
      // present so BFS does not place liquid on unmoved smoke/snow.
      if (activeSpanContains(L, y, x)) {
        uint8_t n = L->next[k];
        if (n != EMPTY) return n;
        if (L->vacatedStamp[k] == tick) return EMPTY;
        uint8_t g = L->grid[k];
        if (isGasMaterial(g) || isLooseSolidMaterial(g)) return g;
        return EMPTY;
      }
      return L->grid[k];
    };
    auto reserveFallback = [&](int fb) {
      if (fb > 0 && fb < gridLen && plannedAt(fb) == EMPTY)
        L->rigidSpillReserved[fb] = reservedGen;
    };
    auto plannedStateAt = [&](int cell) {
      int y = cell / cols, x = cell - y * cols;
      if (activeSpanContains(L, y, x) && L->next[cell] != EMPTY)
        return capturePersistentNextState(L, cell);
      return capturePersistentCurrentState(L, cell);
    };
    auto placeAt = [&](int cell, const LiquidDisp& displacement) {
      uint8_t mat = displacement.material;
      writeNextIndex(cell, mat);
      restorePersistentNextState(
        L, cell, mat, displacement.state, PCSO_SWAP);
      markCellIndex(displacement.from);
      markCellIndex(cell);
    };

    for (int wave = 0; !pending.empty() && wave < MATERIAL_COUNT + 4; wave++) {
      std::sort(pending.begin(), pending.end(), [](const LiquidDisp& a, const LiquidDisp& b) {
        if (DENSITY[a.material] != DENSITY[b.material]) return DENSITY[a.material] > DENSITY[b.material];
        if (a.material != b.material) return a.material < b.material;
        return a.from < b.from;
      });
      nextPending.clear();
      // Reserve every fallback so BFS (for residual unplaced) cannot steal them.
      for (const auto& d : pending) reserveFallback(d.fallback);

      for (size_t gi = 0; gi < pending.size();) {
        uint8_t mat = pending[gi].material;
        size_t gj = gi + 1;
        while (gj < pending.size() && pending[gj].material == mat) gj++;
        int need = (int)(gj - gi);
        usedFallback.assign(need, 0);
        spareFree.clear();

        // Pass 1: natural density swap into own vacated denser source.
        int remaining = need;
        for (int i = 0; i < need; i++) {
          int fb = pending[gi + i].fallback;
          if (fb <= 0 || fb >= gridLen) continue;
          if (plannedAt(fb) != EMPTY) continue;
          // Claim exclusively (may already be reservedGen from reserveFallback).
          L->rigidSpillReserved[fb] = reservedGen;
          placeAt(fb, pending[gi + i]);
          usedFallback[i] = 1;
          remaining--;
        }
        if (remaining == 0) { gi = gj; continue; }

        // Pass 2: BFS only for liquids that could not take their fallback.
        queue.clear(); targets.clear();
        int32_t seenGen = L->nextSeenGeneration();
        auto canVisit = [&](int k) {
          if (k <= 0 || k >= gridLen || L->seenStamp[k] == seenGen) return false;
          int y = k / cols, x = k - y * cols;
          if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return false;
          uint8_t p = plannedAt(k);
          return p == EMPTY || isGasMaterial(p) || isLiquidMaterial(p);
        };
        auto enqueue = [&](int k) {
          if (!canVisit(k)) return;
          L->seenStamp[k] = seenGen;
          queue.push_back(k);
        };
        for (int i = 0; i < need; i++) {
          if (usedFallback[i]) continue;
          for (int off : offs) enqueue(pending[gi + i].from + off);
        }

        int visitBudget = imin(gridLen, imax(LIQUID_DISP_VISIT_BASE, remaining * LIQUID_DISP_VISIT_PER));
        int visits = 0;
        for (size_t qi = 0; qi < queue.size() && (int)targets.size() < remaining && visits < visitBudget;) {
          size_t levelEnd = queue.size();
          levelChain.clear(); levelEmpty.clear();
          for (; qi < levelEnd && visits < visitBudget; qi++, visits++) {
            int k = queue[qi];
            if (L->rigidSpillReserved[k] == reservedGen) {
              // Reserved free slot (someone's fallback): expand through, do not claim.
              for (int off : offs) enqueue(k + off);
              continue;
            }
            uint8_t p = plannedAt(k);
            // Claim true EMPTY only. Gas is free volume for pathing (canVisit) but
            // not a placement target — overwriting smoke/steam here destroyed it
            // without a bubble swap (moveMaterialInto is the only gas-safe claim).
            if (p == EMPTY) levelEmpty.push_back(k);
            else if (isLiquidMaterial(p) && DENSITY[p] < DENSITY[mat]) levelChain.push_back(k);
            for (int off : offs) enqueue(k + off);
          }
          // Prefer EMPTY over chain at the same distance.
          for (int k : levelEmpty) {
            if ((int)targets.size() >= remaining) break;
            if (L->rigidSpillReserved[k] == reservedGen) continue;
            L->rigidSpillReserved[k] = reservedGen;
            targets.push_back(k);
          }
          for (int k : levelChain) {
            if ((int)targets.size() >= remaining) break;
            if (L->rigidSpillReserved[k] == reservedGen) continue;
            L->rigidSpillReserved[k] = reservedGen;
            targets.push_back(k);
          }
        }

        int ti = 0;
        for (int i = 0; i < need; i++) {
          if (usedFallback[i]) continue;
          int fb = pending[gi + i].fallback;
          if (ti < (int)targets.size()) {
            int target = targets[ti++];
            uint8_t prev = plannedAt(target);
            if (isLiquidMaterial(prev) && DENSITY[prev] < DENSITY[mat]) {
              nextPending.push_back({prev, target, fb, plannedStateAt(target)});
              reserveFallback(fb);
            } else if (fb > 0 && fb < gridLen && plannedAt(fb) == EMPTY) {
              // BFS found other free volume; release own fallback for peers.
              L->rigidSpillReserved[fb] = reservedGen;
              spareFree.push_back(fb);
            }
            placeAt(target, pending[gi + i]);
            if (fb > 0 && fb < gridLen) markCellIndex(fb);
            usedFallback[i] = 1;
            continue;
          }
          // Pass 3: restore into own fallback, then spare free slots.
          if (fb > 0 && fb < gridLen && plannedAt(fb) == EMPTY) {
            L->rigidSpillReserved[fb] = reservedGen;
            placeAt(fb, pending[gi + i]);
            usedFallback[i] = 1;
            continue;
          }
          while (!spareFree.empty()) {
            int s = spareFree.back();
            spareFree.pop_back();
            if (s > 0 && s < gridLen && plannedAt(s) == EMPTY) {
              L->rigidSpillReserved[s] = reservedGen;
              placeAt(s, pending[gi + i]);
              usedFallback[i] = 1;
              break;
            }
          }
        }
        gi = gj;
      }
      pending.swap(nextPending);
    }
    liquidDispPending.clear();
  }

  void swapSettledCells(int a, int b) {
    const uint8_t materialA = L->grid[a];
    const uint8_t materialB = L->grid[b];
    const PersistentCellSnapshot stateA = capturePersistentCurrentState(L, a);
    const PersistentCellSnapshot stateB = capturePersistentCurrentState(L, b);

    writeGridIndexUnsafe(a, materialB);
    writeGridIndexUnsafe(b, materialA);
    restorePersistentCurrentState(L, a, materialB, stateB, PCSO_SWAP);
    restorePersistentCurrentState(L, b, materialA, stateA, PCSO_SWAP);

    // Tail motion runs after the simulation buffers are swapped. Mirror every
    // exchange so cells remain valid even when they leave the next active span.
    L->next[a] = materialB;
    L->next[b] = materialA;
    restorePersistentNextState(L, a, materialB, stateB, PCSO_SWAP);
    restorePersistentNextState(L, b, materialA, stateA, PCSO_SWAP);
  }

  template <bool spatialForces>
  void relaxLiquidGapsPass() {
    // Candidate discovery already scanned the active band. A blast-only band has
    // no liquid to relax, so preserve its per-row direction draws without probing
    // every cell. Dense rigid cargo interleaves rows to keep its work even while
    // every row receives one cleanup pass every two ticks.
    bool denseRigidCargo =
      L->bodies.size() >= R_DENSE_RIGID_CARGO_BODIES;
    int passCount = denseRigidCargo ? 1 : 2;
    if (activeLiquidCells.empty()) {
      for (int pass = 0; pass < passCount; pass++) {
        for (int y = rows - 2; y > 0; y--) {
          if (denseRigidCargo && ((y ^ tick) & 1)) continue;
          if (L->activeRowSpans[y].empty()) continue;
          (void)rand();
        }
      }
      return;
    }
    for (int pass = 0; pass < passCount; pass++) {
      for (int y = rows - 2; y > 0; y--) {
        if (denseRigidCargo && ((y ^ tick) & 1)) continue;
        if (L->activeRowSpans[y].empty()) continue;
        bool ltr = rand() < 0.5;
        forEachActiveSpan(y, 1, cols - 2, ltr, [&](int minX, int maxX) {
          int start = ltr ? minX : maxX;
          int end = ltr ? maxX + 1 : minX - 1;
          int stepX = ltr ? 1 : -1;
          for (int x = start; x != end; x += stepX) {
          int k = I(x, y); if (L->grid[k] != EMPTY || L->assemblyWakeStamp[k] == tick) continue;
          if (L->grid[I(x, y + 1)] == EMPTY) continue;
          int aboveK = I(x, y - 1); uint8_t above = L->grid[aboveK];
          if constexpr (spatialForces) {
            if (relaxesGaps(above)
                && forces.overridesGravity(x, y - 1, above))
              continue;
          }
          if (gravityCellStep && relaxesGaps(above)) {
            swapSettledCells(aboveK, k);
            continue;
          }
          // Fill the gap from a side DETERMINISTICALLY (left-first), so an internal hole
          // always migrates the same way — toward the layer's edge, where it vanishes.
          // A holey liquid layer (e.g. oil arriving at the surface in scattered spots)
          // thus coalesces into a solid, flat layer and SETTLES, instead of the random
          // fill shuffling the holes around forever (perpetual churn).
          static const int FILL_DIRS[2] = { -1, 1 };
          for (int i = 0; i < 2; i++) {
            int dx = FILL_DIRS[i], sx = x + dx;
            if (sx <= 0 || sx >= cols - 1) continue;
            int sk = I(sx, y); uint8_t side = L->grid[sk];
            if (!relaxesGaps(side)) continue;
            if constexpr (spatialForces) {
              if (forces.overridesGravity(sx, y, side)) continue;
            }
            swapSettledCells(sk, k);
            if (L->grid[k] != EMPTY) break;
          }
          }
        });
      }
    }
  }
  void relaxLiquidGaps() {
    if (L->forceActive) relaxLiquidGapsPass<true>();
    else relaxLiquidGapsPass<false>();
  }
  // Free-surface leveling — air and denser-under-lighter share one rule:
  // free volume for denser m = EMPTY / lighter powder / strictly lighter liquid
  // (lighter liquid = air). One sideways step only if the free surface drops by
  // >=2px (same anti-shimmer as air pyramids). Flat free surfaces (drop 0/1)
  // stay put and go inert. General same-level flow still does NOT treat lighter
  // liquid as air (canEnterIndex) — only this free-surface solver does.
  template <bool spatialForces>
  void levelLiquidSurfacesPass() {
    if (!gravityCellStep) return;
    // The active candidate scan is authoritative for this tick. Avoid two full
    // active-span passes for gas/empty blast aftermath when no liquid exists.
    if (activeLiquidCells.empty()) return;
    auto surfacePassable = [&](uint8_t c, uint8_t m) {
      return c == EMPTY
          || (isLooseSolidMaterial(c) && canDisplaceByLooseDensity(m, c))
          || (isLiquidMaterial(c) && canDisplaceByLooseDensity(m, c));
    };
    // needDrop: air/powder free volume uses 2 (classic). Stepping into lighter
    // liquid uses 3 so mild residual free-surface scallops go inert instead of
    // PE-swapping forever; tall denser mounds still see large drops and flatten.
    auto lowerSurfaceDrop = [&](int x, int y, uint8_t m, int sgn, int needDrop) {
      int lvl = y;
      for (int d = 1; d <= LIQUID_SURFACE_LOOKAHEAD; d++) {
        int cx = x + sgn * d; if (cx <= 0 || cx >= cols - 1) break;
        int ck = I(cx, lvl); if (L->assemblyWakeStamp[ck] == tick) break;
        uint8_t c = L->grid[ck];
        if (c == m) continue;
        if (!surfacePassable(c, m)) break;
        int ny = lvl + 1;
        while (ny < rows && surfacePassable(L->grid[I(cx, ny)], m)) ny++;
        if (ny >= rows || L->grid[I(cx, ny)] != m) break;
        lvl = ny;
        if (lvl - y >= needDrop) return lvl - y;
      }
      return 0;
    };

    for (int pass = 0; pass < LIQUID_SURFACE_FLOW_PASSES; pass++) {
      for (int y = rows - 2; y >= 1; y--) {
        if (L->activeRowSpans[y].empty()) continue;
        bool ltr = ((y + pass + tick) & 1) == 0;
        forEachActiveSpan(y, 1, cols - 2, ltr, [&](int minX, int maxX) {
          int start = ltr ? minX : maxX;
          int end = ltr ? maxX + 1 : minX - 1;
          int stepX = ltr ? 1 : -1;
          for (int x = start; x != end; x += stepX) {
          int k = I(x, y);
          uint8_t m = L->grid[k];
          if (!isLiquidMaterial(m)) continue;
          if constexpr (spatialForces) {
            if (forces.overridesGravity(x, y, m)) continue;
          }
          if (MOBILITY[m] < 1 && rand() >= MOBILITY[m]) continue;
          uint8_t above = L->grid[k - cols];
          // Free surface: air/powder, or lighter liquid above (submerged denser).
          if (above != EMPTY && !surfacePassable(above, m)) continue;
          if (L->grid[k + cols] == EMPTY) continue;
          if (L->vacatedStamp[k] == tick || L->vacatedStamp[k + cols] == tick ||
              L->vacatedStamp[k - 1] == tick || L->vacatedStamp[k + 1] == tick) continue;

          int leftK = k - 1, rightK = k + 1;
          auto sideDrop = [&](int sideK, int sgn) {
            if (!surfacePassable(L->grid[sideK], m) || L->vacatedStamp[sideK] == tick || L->assemblyWakeStamp[sideK] == tick) return 0;
            uint8_t side = L->grid[sideK];
            int need = (isLiquidMaterial(side) && canDisplaceByLooseDensity(m, side)) ? 3 : 2;
            return lowerSurfaceDrop(x, y, m, sgn, need);
          };
          int leftDrop = sideDrop(leftK, -1);
          int rightDrop = sideDrop(rightK, 1);
          if (leftDrop == 0 && rightDrop == 0) continue;
          int dir = 0;
          if (leftDrop > rightDrop) dir = -1;
          else if (rightDrop > leftDrop) dir = 1;
          else dir = ((x + y + tick + pass) & 1) ? 1 : -1;
          int toK = k + dir;
          if (!surfacePassable(L->grid[toK], m) || L->vacatedStamp[toK] == tick || L->assemblyWakeStamp[toK] == tick) continue;
          // drop>=2 already: PE-down free-surface reshape (same as air into empty).
          // Swap is volume-safe; lighter liquid takes the denser free-surface cell and
          // is pushed up by later density sink / free-surface water fill.
          swapSettledCells(k, toK);
          L->vacatedStamp[k] = tick;
          L->vacatedStamp[toK] = tick;
          }
        });
      }
    }
  }
  void levelLiquidSurfaces() {
    if (L->forceActive) levelLiquidSurfacesPass<true>();
    else levelLiquidSurfacesPass<false>();
  }
  template <bool spatialForces>
  void separateLooseByDensityPass() {
    int parity = rand() < 0.5 ? 0 : 1;
    // Keep the RNG draw above for deterministic parity with the former scan.
    if (activeDensityCells.empty()) return;
    for (int y = 1; y < rows - 1; y++) {
      if (L->activeRowSpans[y].empty()) continue;
      bool ltr = (y % 2) == 0;
      forEachActiveSpan(y, 1, cols - 2, ltr, [&](int minX, int maxX) {
        int start = ltr ? minX : maxX;
        int end = ltr ? maxX + 1 : minX - 1;
        int stepX = ltr ? 1 : -1;
        for (int x = start; x != end; x += stepX) {
        if (((x + y) % 2) != parity) continue;
        int k = I(x, y), belowK = k + cols; uint8_t upper = L->grid[k], lower = L->grid[belowK];
        if constexpr (spatialForces) {
          if (isLooseDensityMaterial(upper)
              && forces.overridesGravity(x, y, upper))
            continue;
        }
        // Liquid↔liquid: settleLiquid + density-chain BFS only (no checkerboard swaps).
        if (isLiquidMaterial(upper) && isLiquidMaterial(lower)) continue;
        if (canDisplaceByLooseDensity(upper, lower)) {
          swapSettledCells(k, belowK);
        }
        }
      });
    }
  }
  void separateLooseByDensity() {
    if (L->forceActive) separateLooseByDensityPass<true>();
    else separateLooseByDensityPass<false>();
  }
  // Move a light gas upward into empty volume or exchange it with a heavier gas.
  // The upper row has already run in the gas pass: if it stayed, park that gas in
  // the source; if it moved away, simply claim the cell. This keeps each gas to
  // one cell of movement per tick and conserves persistent methane volume.
  bool canRiseGasInto(int toK, uint8_t m) {
    uint8_t upper = L->grid[toK], parked = L->next[toK];
    if (upper == EMPTY) return parked == EMPTY;
    return canGasRiseThrough(m, upper) && (parked == EMPTY || parked == upper);
  }
  bool tryRiseGasInto(int fromK, int toK, uint8_t m) {
    if (!canRiseGasInto(toK, m)) return false;
    uint8_t upper = L->grid[toK];
    if (upper == EMPTY) {
      writeNextIndex(toK, m);
      carryPersistentStateToNext(fromK, toK, m, PCSO_MOVE);
      return true;
    }
    uint8_t parked = L->next[toK];
    writeNextIndex(toK, m);
    carryPersistentStateToNext(fromK, toK, m, PCSO_MOVE);
    if (parked == upper) {
      writeNextIndex(fromK, upper);
      carryPersistentStateToNext(toK, fromK, upper, PCSO_MOVE);
    }
    return true;
  }
  // Shared buoyant-gas movement. Lifetime and routing come from the material's
  // generated gas profile; writes always preserve the source material.
  void riseSteam(int x, int y, int k, uint8_t m) {
    if (L->next[k] != EMPTY) return;
    if (L->vacatedStamp[k] == tick) { writeNextIndex(k, m); return; } // blast-shocked gas gets one visible frame before normal decay/motion
    uint8_t profile = MAT_GAS_PROFILE[m];
    float decayP = GAS_DECAY[profile];
    if (GAS_TRAPPED_DECAY[profile] != decayP) {
      // Profiles with a distinct trapped lifetime check for empty or gas-passable
      // vents above and beside the cell. The read-only probe precedes the one decay
      // roll, so selecting this behavior does not add another random draw.
      auto ventsInto = [&](int vk) { uint8_t v = L->grid[vk]; return v == EMPTY || canGasRiseThrough(m, v); };
      bool canVent = (y > 1 && ventsInto(I(x, y - 1)))
                  || (x > 1 && ventsInto(I(x - 1, y)))
                  || (x < cols - 1 && ventsInto(I(x + 1, y)))
                  || (y > 1 && x > 1 && ventsInto(I(x - 1, y - 1)))
                  || (y > 1 && x < cols - 1 && ventsInto(I(x + 1, y - 1)));
      if (!canVent) decayP = GAS_TRAPPED_DECAY[profile];
    }
    if ((!GAS_PERSISTENT[profile] && rand() < decayP) || y <= 1) { markCellIndex(k); return; }
    if (L->forceActive && forces.tryMoveLoose(x, y, k, m)) return;
    int up = I(x, y - 1);
    if (canRiseGasInto(up, m) && rand() < GAS_UP_CHANCE[profile] && tryRiseGasInto(k, up, m)) return;
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = y - 1; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (tryRiseGasInto(k, ik, m)) return; }
    auto ceilingRouteLeadsUp = [&](int dx) {
      // Reverse of liquid surface flow: ceiling-routed gas only walks flat when
      // that corridor leads to higher empty volume. A closed level pocket therefore
      // settles instead of diffusing left/right forever, while a side tunnel to an
      // upper chamber still vents naturally.
      static const int LOOKAHEAD = 24;
      for (int d = 1; d <= LOOKAHEAD; d++) {
        int nx = x + dx * d;
        if (nx <= 0 || nx >= cols - 1) return false;
        int nk = I(nx, y); uint8_t along = L->grid[nk];
        if (along != EMPTY && along != m) return false;
        if (y > 1 && L->grid[nk - cols] == EMPTY) return true;
      }
      return false;
    };
    bool ceilingRoute = GAS_CEILING_ROUTE[profile] != 0;
    bool trySide = ceilingRoute ? true : rand() < GAS_SIDE_CHANCE[profile];
    if (trySide) for (int i = 0; i < 2; i++) {
      int dx = dirs[i];
      if (emptyAt(x + dx, y) && (!ceilingRoute || ceilingRouteLeadsUp(dx))) {
        int destination = I(x + dx, y);
        writeNextIndex(destination, m);
        carryPersistentStateToNext(k, destination, m, PCSO_MOVE);
        return;
      }
    }
    if (L->next[k] == EMPTY) writeNextIndex(k, m);
  }
  void riseFire(int x, int y, int k, uint8_t material) {
    if (L->next[k] != EMPTY) return;
    if (L->vacatedStamp[k] == tick) { writeNextIndex(k, material); return; } // keep explosion fire volume through the detonation step
    uint8_t profile = MAT_GAS_PROFILE[material];
    if (rand() < GAS_DECAY[profile] || y <= 1) { markCellIndex(k); return; }
    int32_t blastGas = L->blastGasStamp[k];
    bool recentBlastFire = blastGas >= 0 && tick - blastGas <= ExplosivesSystem::TNT_FUSE_TICKS;
    if (L->forceActive && forces.tryMoveLoose(x, y, k, material)) return;
    auto writeFire = [&](int dst) {
      writeNextIndex(dst, material);
      if (recentBlastFire) L->blastGasStamp[dst] = blastGas;
    };
    auto moveFire = [&](int dst) {
      if (!tryRiseGasInto(k, dst, material)) return false;
      if (recentBlastFire) L->blastGasStamp[dst] = blastGas;
      return true;
    };
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    if (rand() < 0.36) { int up = I(x, y - 1); if (moveFire(up)) return; }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = rand() < 0.55 ? y - 1 : y; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (moveFire(ik)) return; }
    if (L->next[k] == EMPTY) writeFire(k);
  }
  void drain(int xs, int xe, int y, float liquidP, float sandP) {
    for (int x = xs; x <= xe; x++) { int k = I(x, y); uint8_t m = L->grid[k]; float p = isLiquidMaterial(m) ? liquidP : (m == SAND ? sandP : 0); if (p && rand() < p) writeGridIndexUnsafe(k, EMPTY); }
  }
  void applySideSinks() {
    if (!sinksEnabled || cols < 6) return;
    int leftStart = 1, leftEnd = leftStart + SINK_STRIP_W - 1;
    int rightStart = cols - 2 - (SINK_STRIP_W - 1), rightEnd = cols - 2;
    int innerLeftStart = leftEnd + 1, innerLeftEnd = innerLeftStart + INNER_STRIP_W - 1;
    int innerRightEnd = rightStart - 1, innerRightStart = innerRightEnd - (INNER_STRIP_W - 1);
    for (int y = 1; y < rows; y++) {
      drain(leftStart, leftEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(rightStart, rightEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(innerLeftStart, innerLeftEnd, y, INNER_LIQUID_P, INNER_SAND_P);
      drain(innerRightStart, innerRightEnd, y, INNER_LIQUID_P, INNER_SAND_P);
    }
  }
