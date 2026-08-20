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
  static constexpr double LIQUID_DENSITY_EXCHANGE_RATE = 1.67;
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
    // Liquid↔liquid density is handled by the post-settle adjacent-swap pass.
    // This pass is powder↔powder / powder↔liquid.
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
    // A cell vacated by an earlier movement cannot settle again from stale grid[].
    if (L->vacatedStamp[k] == tick) return;
    if (handleSpatialForce
        && L->forceActive && forces.tryMoveLoose(x, y, k, m)) return;
    int belowK = k + cols;
    // Packed early-out uses effective occupancy (next / vacated), not raw grid[].
    // A strictly lighter liquid above keeps a submerged density interface awake.
    if (y + 1 < rows && x > 0 && x < cols - 1 && liquidOccupantAt(k - 1) == m && liquidOccupantAt(k + 1) == m
        && !(y > 1 && isLiquidMaterial(L->grid[k - cols]) && canDisplaceByLooseDensity(m, L->grid[k - cols]))) {
      uint8_t below = liquidOccupantAt(belowK), bl = liquidOccupantAt(belowK - 1), br = liquidOccupantAt(belowK + 1);
      if ((below == m && bl == m && br == m)
          || (supportsLiquid(below, m)
              && (bl == m || supportsLiquid(bl, m))
              && (br == m || supportsLiquid(br, m)))) {
        L->next[k] = m;
        carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
        if (touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
        return;
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
    // FALL: ordinary liquid movement uses EMPTY or gas only. Density separation
    // exchanges adjacent liquid cells later in the tick.
    if (y + 1 < rows && liquidColumnPassable(belowK, m)) {
      uint8_t belowOcc = liquidOccupantAt(belowK);
      if (belowOcc != EMPTY) {
        // Gas is exchanged locally into the liquid's source cell.
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
    // LATERAL density push into lighter POWDER only.
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

  bool trySwapSettledLiquidsByDensity(int heavyK, int lightK) {
    if (L->vacatedStamp[heavyK] == tick || L->vacatedStamp[lightK] == tick)
      return false;
    if (L->assemblyWakeStamp[heavyK] == tick
        || L->assemblyWakeStamp[lightK] == tick)
      return false;
    uint8_t heavy = L->grid[heavyK], light = L->grid[lightK];
    if (!isLiquidMaterial(heavy) || !isLiquidMaterial(light)
        || DENSITY[heavy] <= DENSITY[light])
      return false;
    markCellIndex(heavyK);
    markCellIndex(lightK);
    // Density contrast sets the exchange rate; the heavier liquid's mobility
    // applies the same viscosity gate used by its ordinary movement.
    double contrast = (DENSITY[heavy] - DENSITY[light])
      / (DENSITY[heavy] + DENSITY[light]);
    double chance = std::fmin(
      1.0, contrast * MOBILITY[heavy] * LIQUID_DENSITY_EXCHANGE_RATE);
    if (rand() >= chance) return false;
    swapSettledCells(heavyK, lightK);
    L->vacatedStamp[heavyK] = tick;
    L->vacatedStamp[lightK] = tick;
    return true;
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
  // Free-surface leveling moves through EMPTY or a lighter loose material. A
  // submerged density surface uses the same local, rate-limited adjacent swap as
  // the density pass. One sideways step occurs only when the surface drops by a
  // meaningful amount, so flat free surfaces stay inert.
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
          uint8_t above = L->grid[k - cols];
          // Free surface: air or a lighter loose material above.
          if (above != EMPTY && !surfacePassable(above, m)) continue;
          if (L->grid[k + cols] == EMPTY) continue;
          if (L->vacatedStamp[k] == tick || L->vacatedStamp[k + cols] == tick ||
              L->vacatedStamp[k - 1] == tick || L->vacatedStamp[k + 1] == tick) continue;

          int leftK = k - 1, rightK = k + 1;
          auto sideDrop = [&](int sideK, int sgn) {
            if (!surfacePassable(L->grid[sideK], m) || L->vacatedStamp[sideK] == tick || L->assemblyWakeStamp[sideK] == tick) return 0;
            uint8_t side = L->grid[sideK];
            int needDrop = isLiquidMaterial(side) ? 3 : 2;
            return lowerSurfaceDrop(x, y, m, sgn, needDrop);
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
          if (isLiquidMaterial(L->grid[toK])) {
            trySwapSettledLiquidsByDensity(k, toK);
            continue;
          }
          if (MOBILITY[m] < 1 && rand() >= MOBILITY[m]) continue;
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
  void separateLiquidsByDensityPass() {
    if (activeLiquidCells.empty()) return;

    // Gravity-owned pairs are disjoint: vertical exchanges run first, then one
    // alternating diagonal. Force-owned liquids use the same stamp so each cell
    // still exchanges at most once, but the downhill neighbour follows the
    // local force instead of +Y.
    int rowParity = tick & 1;
    int diagonal = ((tick >> 1) & 1) ? 1 : -1;
    auto tryExchange = [&](int fartherK, int closerK) {
      if (L->vacatedStamp[fartherK] == tick || L->vacatedStamp[closerK] == tick)
        return;
      if (L->assemblyWakeStamp[fartherK] == tick
          || L->assemblyWakeStamp[closerK] == tick)
        return;
      if (!isLiquidMaterial(L->grid[fartherK])) return;
      trySwapSettledLiquidsByDensity(fartherK, closerK);
    };

    for (int pass = 0; pass < 2; pass++) {
      for (int y = 1; y < rows - 1; y++) {
        if ((y & 1) != rowParity || L->activeRowSpans[y].empty()) continue;
        bool ltr = ((y + tick + pass) & 1) == 0;
        forEachActiveSpan(y, 1, cols - 2, ltr, [&](int minX, int maxX) {
          int start = ltr ? minX : maxX;
          int end = ltr ? maxX + 1 : minX - 1;
          int stepX = ltr ? 1 : -1;
          for (int x = start; x != end; x += stepX) {
            int k = I(x, y);
            if (!isLiquidMaterial(L->grid[k])) continue;
            if constexpr (spatialForces) {
              std::array<std::pair<int, int>, 3> forceMoves;
              int forceMoveCount = forces.liquidForceSinkMoves(x, y, forceMoves);
              if (forceMoveCount > 0) {
                if (pass != 0) continue;
                for (int i = 0; i < forceMoveCount; i++) {
                  int nx = x + forceMoves[i].first;
                  int ny = y + forceMoves[i].second;
                  if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1)
                    continue;
                  tryExchange(k, I(nx, ny));
                  if (L->vacatedStamp[k] == tick) break;
                }
                continue;
              }
            }
            int lowerX = pass == 0 ? x : x + diagonal;
            if (lowerX <= 0 || lowerX >= cols - 1) continue;
            tryExchange(k, I(lowerX, y + 1));
          }
        });
      }
    }
  }
  void separateLiquidsByDensity() {
    if (L->forceActive) separateLiquidsByDensityPass<true>();
    else separateLiquidsByDensityPass<false>();
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
        // Liquid↔liquid exchange is owned by separateLiquidsByDensity().
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
