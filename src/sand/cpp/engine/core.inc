  // Hot per-cell movement helpers for loose powders, liquids, gases, and
  // density interfaces.
  //
  // step.inc decides the tick order; this file owns the tiny local movement
  // rules used inside that order. Keep high-level gameplay/tool policy out of
  // this path because it runs over the active rows every simulation tick.

  // ---- settle passes (identical to Stage 1) ----
  // Density-scaled straight-down fall for liquids: a liquid may drop up to
  // round(DENSITY * LIQUID_FALL_PER_DENSITY) cells per tick (clamped to
  // [1, LIQUID_FALL_CAP]). With the values below: OIL(0.8)->2, WATER(1.0)->3,
  // ACID(1.1)->3, LAVA(2.8)->8 capped to 5 — so density actually orders the
  // fall speed (lighter oil lags, heavier lava plummets). Defined here (NOT
  // common.hpp) on purpose. Column free space is EMPTY/gas/less-dense liquid
  // (liquidTreatsAsEmpty); only the landing cell is occupied (lighter liquid
  // there is density-chain relocated). Single-fluid settled columns (nothing
  // free below) still take 0 steps.
  static const int LIQUID_FALL_PER_DENSITY = 3;
  static const int LIQUID_FALL_CAP = 5;
  bool canLooseDensitySettleThisTick(uint8_t m) { float mob = MOBILITY[m]; return mob >= 1 || rand() < mob; }
  void settleLooseDensityInterface(int x, int y, int k) {
    uint8_t m = L->grid[k];
    if (!isLooseDensityMaterial(m) || L->next[k] != EMPTY) return;
    if (L->vacatedStamp[k] == tick) return;
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
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && L->grid[belowK] == self && L->grid[belowK - 1] == self && L->grid[belowK + 1] == self) { if (L->next[k] == EMPTY) L->next[k] = self; return; }
    if (y + 1 < rows && L->grid[belowK] == EMPTY && L->next[belowK] == EMPTY) { vacateForNextMove(k); writeNextIndex(belowK, self); return; }
    if (y + 1 < rows && canDisplaceMaterial(self, L->grid[belowK]) && L->next[belowK] == EMPTY) { moveMaterialInto(k, belowK, self); return; }
    int firstDx = rand() < 0.5 ? -1 : 1, secondDx = -firstDx;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? firstDx : secondDx; int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx; uint8_t m = L->grid[ik];
      if (m == EMPTY && L->next[ik] == EMPTY) { vacateForNextMove(k); writeNextIndex(ik, self); return; }
      if (canDisplaceMaterial(self, m) && L->next[ik] == EMPTY) { moveMaterialInto(k, ik, self); return; }
    }
    if (L->next[k] == EMPTY) writeNextIndex(k, self);
  }
  void settleLiquid(int x, int y, int k, uint8_t m) {
    if (L->next[k] != EMPTY) return;
    // Already moved this tick (e.g. denser liquid sank in settleLooseDensityInterface
    // and enqueued a lighter liquid instead of swapping into the source). Without this
    // guard the same grid cell is settled again and duplicates into a free next[].
    if (L->vacatedStamp[k] == tick) return;
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
        L->next[k] = m; return; // settled flat surface -> go inert (no re-mark just for open sky above)
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
      int maxFall = (int)std::lround(DENSITY[m] * LIQUID_FALL_PER_DENSITY);
      if (maxFall < 1) maxFall = 1;
      if (maxFall > LIQUID_FALL_CAP) maxFall = LIQUID_FALL_CAP;
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
      if (occ == EMPTY) { vacateForNextMove(k); writeNextIndex(ik, m); return; }
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
      if (L->next[k] == EMPTY) { L->next[k] = m; if ((hasAbove ? liquidCanEscape(k) : touchesUnstableLooseDensityInterface(k, m)) || adjacentInternalHole(k, m)) markCellIndex(k); }
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
    if (L->next[k] == EMPTY) { L->next[k] = m; if (touchesUnstableLooseDensityInterface(k, m) || adjacentInternalHole(k, m)) markCellIndex(k); }
  }
  void settleLava(int x, int y, int k) { if (L->next[k] != EMPTY) return; if (rand() >= MOBILITY[LAVA]) { writeNextIndex(k, LAVA); return; } settleLiquid(x, y, k, LAVA); }

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
    int32_t reservedGen = ++L->seenGen;

    auto plannedAt = [&](int k) -> uint8_t {
      int y = k / cols, x = k - y * cols;
      // Active rows were blanked then rewritten — next[] is authoritative there
      // for materials that already settled. Gas rises AFTER this resolve pass, so
      // a blanked next[] still leaves grid gas occupying the cell; treat it as
      // present so BFS does not place liquid on top of unmoved smoke/steam.
      if (x >= L->activeRowMin[y] && x <= L->activeRowMax[y]) {
        uint8_t n = L->next[k];
        if (n != EMPTY) return n;
        if (L->vacatedStamp[k] == tick) return EMPTY;
        uint8_t g = L->grid[k];
        if (isGasMaterial(g)) return g;
        return EMPTY;
      }
      return L->grid[k];
    };
    auto reserveFallback = [&](int fb) {
      if (fb > 0 && fb < gridLen && plannedAt(fb) == EMPTY)
        L->rigidSpillReserved[fb] = reservedGen;
    };
    auto placeAt = [&](int cell, uint8_t mat, int fromK) {
      writeNextIndex(cell, mat);
      markCellIndex(fromK);
      markCellIndex(cell);
    };

    for (int wave = 0; !pending.empty() && wave < TABLE + 4; wave++) {
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
          placeAt(fb, mat, pending[gi + i].from);
          usedFallback[i] = 1;
          remaining--;
        }
        if (remaining == 0) { gi = gj; continue; }

        // Pass 2: BFS only for liquids that could not take their fallback.
        queue.clear(); targets.clear();
        int32_t seenGen = ++L->seenGen;
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
              nextPending.push_back({prev, target, fb});
              reserveFallback(fb);
            } else if (fb > 0 && fb < gridLen && plannedAt(fb) == EMPTY) {
              // BFS found other free volume; release own fallback for peers.
              L->rigidSpillReserved[fb] = reservedGen;
              spareFree.push_back(fb);
            }
            placeAt(target, mat, pending[gi + i].from);
            if (fb > 0 && fb < gridLen) markCellIndex(fb);
            usedFallback[i] = 1;
            continue;
          }
          // Pass 3: restore into own fallback, then spare free slots.
          if (fb > 0 && fb < gridLen && plannedAt(fb) == EMPTY) {
            L->rigidSpillReserved[fb] = reservedGen;
            placeAt(fb, mat, pending[gi + i].from);
            usedFallback[i] = 1;
            continue;
          }
          while (!spareFree.empty()) {
            int s = spareFree.back();
            spareFree.pop_back();
            if (s > 0 && s < gridLen && plannedAt(s) == EMPTY) {
              L->rigidSpillReserved[s] = reservedGen;
              placeAt(s, mat, pending[gi + i].from);
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

  void relaxLiquidGaps() {
    for (int pass = 0; pass < 2; pass++) for (int y = rows - 2; y > 0; y--) {
      int minX, maxX; if (!activeRowSpan(y, minX, maxX)) continue;
      bool ltr = rand() < 0.5; int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        int k = I(x, y); if (L->grid[k] != EMPTY) continue;
        if (L->grid[I(x, y + 1)] == EMPTY) continue;
        int aboveK = I(x, y - 1); uint8_t above = L->grid[aboveK];
        if (relaxesGaps(above)) { writeGridIndex(k, above); writeGridIndex(aboveK, EMPTY); continue; }
        // Fill the gap from a side DETERMINISTICALLY (left-first), so an internal hole
        // always migrates the same way — toward the layer's edge, where it vanishes.
        // A holey liquid layer (e.g. oil arriving at the surface in scattered spots)
        // thus coalesces into a solid, flat layer and SETTLES, instead of the random
        // fill shuffling the holes around forever (perpetual churn).
        static const int FILL_DIRS[2] = { -1, 1 };
        for (int i = 0; i < 2; i++) { int dx = FILL_DIRS[i]; int sx = x + dx; if (sx <= 0 || sx >= cols - 1) continue; int sk = I(sx, y); uint8_t side = L->grid[sk]; if (!relaxesGaps(side)) continue; writeGridIndex(k, side); writeGridIndex(sk, EMPTY); if (L->grid[k] != EMPTY) break; }
      }
    }
  }
  // Free-surface leveling — air and denser-under-lighter share one rule:
  // free volume for denser m = EMPTY / lighter powder / strictly lighter liquid
  // (lighter liquid = air). One sideways step only if the free surface drops by
  // >=2px (same anti-shimmer as air pyramids). Flat free surfaces (drop 0/1)
  // stay put and go inert. General same-level flow still does NOT treat lighter
  // liquid as air (canEnterIndex) — only this free-surface solver does.
  void levelLiquidSurfaces() {
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
        uint8_t c = L->grid[I(cx, lvl)];
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
        int minX, maxX; if (!activeRowSpan(y, minX, maxX)) continue;
        bool ltr = ((y + pass + tick) & 1) == 0;
        int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
        for (int x = start; x != end; x += stepX) {
          int k = I(x, y);
          uint8_t m = L->grid[k];
          if (!isLiquidMaterial(m)) continue;
          if (MOBILITY[m] < 1 && rand() >= MOBILITY[m]) continue;
          uint8_t above = L->grid[k - cols];
          // Free surface: air/powder, or lighter liquid above (submerged denser).
          if (above != EMPTY && !surfacePassable(above, m)) continue;
          if (L->grid[k + cols] == EMPTY) continue;
          if (L->vacatedStamp[k] == tick || L->vacatedStamp[k + cols] == tick ||
              L->vacatedStamp[k - 1] == tick || L->vacatedStamp[k + 1] == tick) continue;

          int leftK = k - 1, rightK = k + 1;
          auto sideDrop = [&](int sideK, int sgn) {
            if (!surfacePassable(L->grid[sideK], m) || L->vacatedStamp[sideK] == tick) return 0;
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
          if (!surfacePassable(L->grid[toK], m) || L->vacatedStamp[toK] == tick) continue;
          // drop>=2 already: PE-down free-surface reshape (same as air into empty).
          // Swap is volume-safe; lighter liquid takes the denser free-surface cell and
          // is pushed up by later density sink / free-surface water fill.
          uint8_t displaced = L->grid[toK];
          writeGridIndex(k, displaced);
          writeGridIndex(toK, m);
          L->vacatedStamp[k] = tick;
          L->vacatedStamp[toK] = tick;
        }
      }
    }
  }
  void separateLooseByDensity() {
    int parity = rand() < 0.5 ? 0 : 1;
    for (int y = 1; y < rows - 1; y++) {
      int minX, maxX; if (!activeRowSpan(y, minX, maxX)) continue;
      bool ltr = (y % 2) == 0; int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        if (((x + y) % 2) != parity) continue;
        int k = I(x, y), belowK = k + cols; uint8_t upper = L->grid[k], lower = L->grid[belowK];
        // Liquid↔liquid: settleLiquid + density-chain BFS only (no checkerboard swaps).
        if (isLiquidMaterial(upper) && isLiquidMaterial(lower)) continue;
        if (canDisplaceByLooseDensity(upper, lower)) { writeGridIndex(belowK, upper); writeGridIndex(k, lower); }
      }
    }
  }
  // Shared rise/dissipate behaviour for buoyant gases. Writes the SAME material
  // `m` it is moving (not a hardcoded STEAM) so e.g. ACRID_SMOKE rises and
  // dissipates exactly like steam while keeping its own identity/colour.
  void riseSteam(int x, int y, int k, uint8_t m) {
    if (L->next[k] != EMPTY) return;
    if (L->vacatedStamp[k] == tick) { writeNextIndex(k, m); return; } // blast-shocked gas gets one visible frame before normal decay/motion
    float decayP = STEAM_DECAY_P;
    if (m == ACRID_SMOKE) {
      decayP = ACRID_DECAY_P;
      // Acrid smoke that can't vent (no empty cell above or beside it — boxed in by
      // liquid/solid) dissolves quickly rather than churning. Re-rising through a
      // fluid every step keeps a large region awake, and an awake layer pays a full
      // grounding reflood per step, so a trapped cloud is pure cost with no payoff.
      // Reads only (no extra RNG draw before the decay roll) so steam stays
      // byte-identical and non-acrid scenes are unaffected.
      bool canVent = (y > 1 && L->grid[I(x, y - 1)] == EMPTY)
                  || (x > 1 && L->grid[I(x - 1, y)] == EMPTY)
                  || (x < cols - 1 && L->grid[I(x + 1, y)] == EMPTY)
                  || (y > 1 && x > 1 && L->grid[I(x - 1, y - 1)] == EMPTY)
                  || (y > 1 && x < cols - 1 && L->grid[I(x + 1, y - 1)] == EMPTY);
      if (!canVent) decayP = ACRID_TRAPPED_DECAY_P;
    }
    if (rand() < decayP || y <= 1) { markCellIndex(k); return; }
    int up = I(x, y - 1);
    if (L->grid[up] == EMPTY && L->next[up] == EMPTY && rand() < 0.72) { writeNextIndex(up, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = y - 1; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (L->grid[ik] == EMPTY && L->next[ik] == EMPTY) { writeNextIndex(ik, m); return; } }
    if (rand() < 0.65) for (int i = 0; i < 2; i++) { int dx = dirs[i]; if (emptyAt(x + dx, y)) { writeNextIndex(I(x + dx, y), m); return; } }
    if (L->next[k] == EMPTY) writeNextIndex(k, m);
  }
  void riseFire(int x, int y, int k) {
    if (L->next[k] != EMPTY) return;
    if (L->vacatedStamp[k] == tick) { writeNextIndex(k, FIRE); return; } // keep explosion fire volume through the detonation step
    if (rand() < FIRE_DECAY_P || y <= 1) { markCellIndex(k); return; }
    int32_t blastGas = L->blastGasStamp[k];
    auto writeFire = [&](int dst) {
      writeNextIndex(dst, FIRE);
      if (blastGas >= 0 && tick - blastGas <= ExplosivesSystem::TNT_FUSE_TICKS) L->blastGasStamp[dst] = blastGas;
    };
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    if (rand() < 0.36) { int up = I(x, y - 1); if (L->grid[up] == EMPTY && L->next[up] == EMPTY) { writeFire(up); return; } }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = rand() < 0.55 ? y - 1 : y; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (L->grid[ik] == EMPTY && L->next[ik] == EMPTY) { writeFire(ik); return; } }
    if (L->next[k] == EMPTY) writeFire(k);
  }
  void drain(int xs, int xe, int y, float liquidP, float sandP) {
    for (int x = xs; x <= xe; x++) { int k = I(x, y); uint8_t m = L->grid[k]; float p = isLiquidMaterial(m) ? liquidP : (m == SAND ? sandP : 0); if (p && rand() < p) writeGridIndex(k, EMPTY); }
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
