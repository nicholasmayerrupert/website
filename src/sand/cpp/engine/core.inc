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
  // common.hpp) on purpose. Only moves a liquid into EMPTY space strictly below,
  // so settled scenes (nothing empty below) are byte-identical to single-step.
  static const int LIQUID_FALL_PER_DENSITY = 3;
  static const int LIQUID_FALL_CAP = 5;
  bool canLooseDensitySettleThisTick(uint8_t m) { float mob = MOBILITY[m]; return mob >= 1 || rand() < mob; }
  void settleLooseDensityInterface(int x, int y, int k) {
    uint8_t m = L->grid[k];
    if (!isLooseDensityMaterial(m) || L->next[k] != EMPTY) return;
    if (!canLooseDensitySettleThisTick(m)) return;
    int belowK = k + cols;
    if (y + 1 < rows && canDisplaceByLooseDensity(m, L->grid[belowK]) && L->next[belowK] == EMPTY) { moveMaterialInto(k, belowK, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue; int ik = belowK + dx; if (canDisplaceByLooseDensity(m, L->grid[ik]) && L->next[ik] == EMPTY) { moveMaterialInto(k, ik, m); return; } }
  }
  // Settle one POWDER cell. `self` is the actual powder material (SAND, DIRT,
  // SNOW, ...), so every new position keeps that material instead of becoming
  // SAND. The "packed" early-out checks for the SAME powder all around below.
  void settleSand(int x, int y, int k) {
    if (L->next[k] != EMPTY) return;
    uint8_t self = L->grid[k];
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && L->grid[belowK] == self && L->grid[belowK - 1] == self && L->grid[belowK + 1] == self) { if (L->next[k] == EMPTY) L->next[k] = self; return; }
    if (y + 1 < rows && L->grid[belowK] == EMPTY && L->next[belowK] == EMPTY) { L->vacatedStamp[k] = tick; writeNextIndex(belowK, self); return; }
    if (y + 1 < rows && canDisplaceMaterial(self, L->grid[belowK]) && L->next[belowK] == EMPTY) { moveMaterialInto(k, belowK, self); return; }
    int firstDx = rand() < 0.5 ? -1 : 1, secondDx = -firstDx;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? firstDx : secondDx; int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx; uint8_t m = L->grid[ik];
      if (m == EMPTY && L->next[ik] == EMPTY) { L->vacatedStamp[k] = tick; writeNextIndex(ik, self); return; }
      if (canDisplaceMaterial(self, m) && L->next[ik] == EMPTY) { moveMaterialInto(k, ik, self); return; }
    }
    if (L->next[k] == EMPTY) writeNextIndex(k, self);
  }
  void settleLiquid(int x, int y, int k, uint8_t m) {
    if (L->next[k] != EMPTY) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && L->grid[k - 1] == m && L->grid[k + 1] == m) {
      uint8_t below = L->grid[belowK], bl = L->grid[belowK - 1], br = L->grid[belowK + 1];
      if ((below == m && bl == m && br == m) || (supportsLiquid(below, m) && bl != EMPTY && !canDisplaceMaterial(m, bl) && br != EMPTY && !canDisplaceMaterial(m, br))) {
        L->next[k] = m; return; // settled flat surface -> go inert (no re-mark just for open sky above)
      }
    }
    // DENSITY RISE: a lighter liquid rises into a strictly-DENSER liquid directly
    // above or up-diagonally — the symmetric partner of the down/down-diagonal sink
    // below. Together they LEVEL a two-fluid interface (a water mound under oil
    // flattens as oil rises and water sinks) and, because each swap strictly lowers
    // gravitational PE, the body CONVERGES and settles. Restricted to a liquid above
    // (powder sorting is handled by settleSand). Deterministic parity direction (no
    // rand) so single-fluid scenes — which never have a denser liquid above — are
    // byte-identical. Runs before the side flow so buoyancy beats lateral spread.
    if (y > 1) {
      int aboveK = k - cols;
      if (isLiquidMaterial(L->grid[aboveK]) && canDisplaceByLooseDensity(L->grid[aboveK], m) && L->next[aboveK] == EMPTY && L->next[k] == EMPTY) { moveDensitySwap(k, aboveK, m); return; }
      int firstDx = ((x + y) & 1) ? 1 : -1;
      for (int i = 0; i < 2; i++) { int dx = i == 0 ? firstDx : -firstDx; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue; int uk = aboveK + dx; if (isLiquidMaterial(L->grid[uk]) && canDisplaceByLooseDensity(L->grid[uk], m) && L->next[uk] == EMPTY && L->next[k] == EMPTY) { moveDensitySwap(k, uk, m); return; } }
    }
    if (y + 1 < rows && L->grid[belowK] == EMPTY && L->next[belowK] == EMPTY) {
      // DENSITY-SCALED FALL: denser liquids drop more cells per tick. Walk straight
      // down, stopping at the first cell that isn't free (free == both L->grid AND L->next
      // EMPTY, matching the single-step guard above and respecting the double buffer
      // so two cells can't claim the same destination), and move to the farthest free
      // cell. Only ever moves into EMPTY space strictly below, so a settled scene
      // (nothing empty below any liquid) takes 0 steps and is byte-identical to before.
      int maxFall = (int)std::lround(DENSITY[m] * LIQUID_FALL_PER_DENSITY);
      if (maxFall < 1) maxFall = 1;
      if (maxFall > LIQUID_FALL_CAP) maxFall = LIQUID_FALL_CAP;
      int dst = belowK;
      for (int s = 2; s <= maxFall; s++) {
        if (y + s >= rows) break;                       // bottom of buffer
        int nk = k + s * cols;
        if (L->grid[nk] != EMPTY || L->next[nk] != EMPTY) break;
        dst = nk;
      }
      L->vacatedStamp[k] = tick; writeNextIndex(dst, m);
      // A multi-cell jump moves the source >DIRTY_PAD_Y rows from the destination,
      // so the vacated source/intermediate rows would fall outside L->next step's active
      // band and prepareNextBuffer wouldn't blank their `L->next` slots — the double
      // buffer then resurrects a stale value from 2 ticks ago as a ghost trail. Mark
      // the whole fall span dirty so those rows stay active and get blanked. (For a
      // single-cell fall dst==belowK and the existing pad already covers it.)
      if (dst != belowK) markDirtyRect(x, y, x, dst / cols);
      return;
    }
    if (y + 1 < rows && canDisplaceMaterial(m, L->grid[belowK]) && L->next[belowK] == EMPTY) { moveLiquidInto(k, x, y + 1, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i]; int nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      int ik = I(nx, ny);
      if (L->grid[ik] == EMPTY && L->next[ik] == EMPTY) { L->vacatedStamp[k] = tick; writeNextIndex(ik, m); return; }
      if (canDisplaceMaterial(m, L->grid[ik]) && L->next[ik] == EMPTY) { moveLiquidInto(k, nx, ny, m); return; }
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
    // LATERAL DENSITY SPREAD: push sideways into an adjacent strictly-LIGHTER loose
    // material. This started as two-liquid leveling (water into oil); allowing powders
    // here lets pressured water/lava push light snow/sand aside, after which the normal
    // vertical density pass lifts the displaced powder above the denser liquid.
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue; int sk = k + dx; if (L->next[sk] == EMPTY && isLooseDensityMaterial(L->grid[sk]) && canDisplaceByLooseDensity(m, L->grid[sk])) { moveLiquidInto(k, nx, y, m); return; } }
    if (y + 1 < rows && supportsLiquid(L->grid[belowK], m)) {
      int aboveK = k - cols;
      bool hasAbove = (y > 1 && L->grid[aboveK] == m);
      if (hasAbove) {
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int sideK = k + dx; if (x + dx <= 0 || x + dx >= cols - 1) continue; if (canEnterIndex(sideK, m) && supportsLiquid(L->grid[sideK + cols], m)) { moveMaterialInto(k, sideK, m); return; } }
      }
      // Resting on support with no reachable lower opening (the flow scan above found
      // none) and no liquid stacked above. This cell cannot make downward progress, so
      // a same-level empty neighbour is NOT a real escape: spreading a 1-deep puddle
      // sideways across a flat floor just shuffles cells and churns the diff forever.
      // Go inert (re-wakes via dirty padding if a neighbour later opens a lower path).
      // PRESSURED cells (liquid above) keep the normal re-mark so columns still drain.
      if (L->next[k] == EMPTY) { L->next[k] = m; if ((hasAbove ? liquidCanEscape(k) : touchesUnstableLooseDensityInterface(k, m)) || adjacentInternalHole(k, m)) markCellIndex(k); }
      return;
    }
    // Same-level sideways spread ONLY under pressure (liquid stacked directly
    // above). A FREE surface cell (open above) does not slide into a same-level
    // gap, so a ragged surface settles to a stable shape instead of shimmering
    // left/right forever. Pressured cells still equalize (and stay active);
    // free-surface cells go inert (re-wake via dirty padding on disturbance),
    // but keep the density-interface re-mark so liquids still separate by density.
    bool pressured = (y > 1 && L->grid[k - cols] == m);
    if (pressured) {
      // Equalize sideways ONLY toward a genuinely-lower surface: the target must be
      // open at this level AND have nothing of ours stacked directly above it. A gap
      // that has the same liquid right above is about to be filled by a vertical
      // fall, so sliding into it merely chases the gap sideways. A sub-row air bubble
      // pinned at a ragged container bottom would otherwise shimmer left/right every
      // step forever (both flanking cells are pressured and swap the gap), never
      // settling — letting it rise to the free surface instead lets the body go inert.
      for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue; if (canLiquidEnter(nx, y, m) && !(L->grid[I(nx, y - 1)] == m)) { moveLiquidInto(k, nx, y, m); return; } }
      // Cannot usefully equalize: only stay active (re-mark) if a vertical fall can
      // still fill the gap beside us (liquid above the gap) — otherwise go inert so a
      // settled-but-imperfectly-packed body stops churning the per-step diff.
      if (L->next[k] == EMPTY) {
        L->next[k] = m;
        bool fillableGap = false;
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1) continue; if (L->grid[I(nx, y)] == EMPTY && y > 1 && L->grid[I(nx, y - 1)] == m) { fillableGap = true; break; } }
        if (fillableGap || touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
      }
      return;
    }
    if (L->next[k] == EMPTY) { L->next[k] = m; if (touchesUnstableLooseDensityInterface(k, m) || adjacentInternalHole(k, m)) markCellIndex(k); }
  }
  void settleLava(int x, int y, int k) { if (L->next[k] != EMPTY) return; if (rand() >= MOBILITY[LAVA]) { writeNextIndex(k, LAVA); return; } settleLiquid(x, y, k, LAVA); }
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
  // Keep a wide free LIQUID-against-AIR surface flowing locally until it is nearly
  // level. The probe looks along a connected surface to see whether a side reaches a
  // column >=2px lower, but the actual move is only ONE adjacent sideways step into
  // air. The L->next normal settle pass then lets that cell fall naturally. This avoids
  // both failure modes: a one-sided pile/ramp that goes inert too soon, and the old
  // non-local "flattening" jump that placed a cell directly at the distant low point.
  void levelLiquidSurfaces() {
    auto surfacePassable = [&](uint8_t c, uint8_t m) {
      return c == EMPTY || (isLooseSolidMaterial(c) && canDisplaceByLooseDensity(m, c));
    };
    auto lowerSurfaceDrop = [&](int x, int y, uint8_t m, int sgn) {
      int lvl = y;
      for (int d = 1; d <= LIQUID_SURFACE_LOOKAHEAD; d++) {
        int cx = x + sgn * d; if (cx <= 0 || cx >= cols - 1) break;
        uint8_t c = L->grid[I(cx, lvl)];
        if (c == m) continue;                  // liquid at this level -> connected, surface >= lvl
        if (!surfacePassable(c, m)) break;     // wall / denser material at the level -> body ends
        int ny = lvl + 1;                      // air here -> this column is shorter; descend to its surface
        while (ny < rows && surfacePassable(L->grid[I(cx, ny)], m)) ny++;
        if (ny >= rows || L->grid[I(cx, ny)] != m) break; // open drop or foreign material -> stop
        lvl = ny;
        if (lvl - y >= 2) return lvl - y;
      }
      return 0;
    };

    for (int pass = 0; pass < LIQUID_SURFACE_FLOW_PASSES; pass++) {
      // Bottom-to-top plus stamping prevents same-tick cascades: a moved source or
      // destination will not be consumed again until the L->next simulation tick.
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
          if (above != EMPTY && !surfacePassable(above, m)) continue; // free air or lighter powder surface
          if (L->grid[k + cols] == EMPTY) continue;     // falling cells are handled by the normal liquid settle pass
          if (L->vacatedStamp[k] == tick || L->vacatedStamp[k + cols] == tick ||
              L->vacatedStamp[k - 1] == tick || L->vacatedStamp[k + 1] == tick) continue;

          int leftK = k - 1, rightK = k + 1;
          int leftDrop = (surfacePassable(L->grid[leftK], m) && L->vacatedStamp[leftK] != tick) ? lowerSurfaceDrop(x, y, m, -1) : 0;
          int rightDrop = (surfacePassable(L->grid[rightK], m) && L->vacatedStamp[rightK] != tick) ? lowerSurfaceDrop(x, y, m, 1) : 0;
          if (leftDrop == 0 && rightDrop == 0) continue;
          int dir = 0;
          if (leftDrop > rightDrop) dir = -1;
          else if (rightDrop > leftDrop) dir = 1;
          else dir = ((x + y + tick + pass) & 1) ? 1 : -1;
          int toK = k + dir;
          if (!surfacePassable(L->grid[toK], m) || L->vacatedStamp[toK] == tick) continue;
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
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    if (rand() < 0.36) { int up = I(x, y - 1); if (L->grid[up] == EMPTY && L->next[up] == EMPTY) { writeNextIndex(up, FIRE); return; } }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = rand() < 0.55 ? y - 1 : y; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (L->grid[ik] == EMPTY && L->next[ik] == EMPTY) { writeNextIndex(ik, FIRE); return; } }
    if (L->next[k] == EMPTY) writeNextIndex(k, FIRE);
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
