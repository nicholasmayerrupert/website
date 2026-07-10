// ReactionSystem method bodies (need the full Engine definition; see reactions.hpp).

// Material reactions.
//
// Runs after growth/rigid movement inside each layer step. This file owns
// local transformations such as water/fire steam, ignition, freezing/melting,
// acid erosion, and lava cooling. It should not own broad movement order.
void ReactionSystem::applyReactions() {
  int steamCount = 0, fireCount = 0, igniteCount = 0; bool plantBurned = false;
  int igniteCap = E.cols * E.rows;
  std::vector<int>& snowMelt = E.reactionSnowMelt; snowMelt.clear();
  for (int y = 1; y < E.rows; y++) {
    int minX, maxX; if (!E.activeRowSpan(y, minX, maxX)) continue;
    for (int x = minX; x <= maxX; x++) {
      int k = E.I(x, y); if (E.L->grid[k] != WATER) continue;
      int nk = E.L->grid[k + 1] == FIRE ? k + 1 : (E.L->grid[k - 1] == FIRE ? k - 1 : -1);
      if (nk < 0 && y < E.rows - 1 && E.L->grid[k + E.cols] == FIRE) nk = k + E.cols;
      if (nk < 0 && E.L->grid[k - E.cols] == FIRE) nk = k - E.cols;
      if (nk >= 0) { E.L->reactionSteam[steamCount++] = k; if (!E.L->reactionFlags[nk]) { E.L->reactionFlags[nk] = 1; E.L->reactionFires[fireCount++] = nk; } }
    }
  }
  for (int y = 1; y < E.rows; y++) {
    int minX, maxX; if (!E.activeRowSpan(y, minX, maxX)) continue;
    for (int x = minX; x <= maxX; x++) {
      int k = E.I(x, y); if (E.L->grid[k] != FIRE || E.L->reactionFlags[k]) continue;
      int neigh[4]; int nn; if (y < E.rows - 1) { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k + E.cols; neigh[3] = k - E.cols; nn = 4; } else { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k - E.cols; nn = 3; }
      for (int ni = 0; ni < nn; ni++) {
        int nk = neigh[ni];
        if (E.L->grid[nk] == OIL) {
          if (E.rand() > OIL_IGNITE_P) continue;
          if (igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = nk;
          if (E.rand() < FIRE_SPREAD_P) {
            int oilY = nk / E.cols; int on[4]; int onn; if (oilY < E.rows - 1) { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk + E.cols; on[3] = nk - E.cols; onn = 4; } else { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk - E.cols; onn = 3; }
            for (int oi = 0; oi < onn; oi++) { int ok = on[oi]; if (E.L->grid[ok] == OIL && E.rand() < 0.12 && igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = ok; }
          }
        } else if (E.L->grid[nk] == GUNPOWDER) {
          // Gunpowder is a fast fuse: it catches on any flame contact (no roll) and
          // the burn front races on through every adjacent grain, so a connected
          // trail or pile deflagrates in a couple of steps. It is also flammable, so
          // lava lights it directly (applyLava) and the chain takes over here.
          if (igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = nk;
          int gy = nk / E.cols; int gn[4]; int gnn; if (gy < E.rows - 1) { gn[0] = nk + 1; gn[1] = nk - 1; gn[2] = nk + E.cols; gn[3] = nk - E.cols; gnn = 4; } else { gn[0] = nk + 1; gn[1] = nk - 1; gn[2] = nk - E.cols; gnn = 3; }
          for (int gi = 0; gi < gnn; gi++) { int gk = gn[gi]; if (E.L->grid[gk] == GUNPOWDER && igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = gk; }
        } else if (E.L->grid[nk] == SNOW) { snowMelt.push_back(nk); } // fire melts snow to water (consistent with lava+snow and ice melting near fire)
        // Ignition is keyed to the `flammable` FLAG, not plant-family: the doc says
        // flammable = "ignites near fire/lava", and lava already uses isFlammable.
        // This stops fire from burning non-flammable plants (juicy cactus, wet
        // mushrooms) and lets any flammable powder/liquid catch the same way oil does.
        else if (!E.isBodyCell(nk) && E.isFlammable(E.L->grid[nk]) && E.rand() < PLANT_IGNITE_P) { if (igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = nk; } // body-material invariant: a flammable body disintegrates via erodeBodies, not in-place ignition
      }
    }
  }
  for (int i = 0; i < fireCount; i++) { int k = E.L->reactionFires[i]; if (E.L->grid[k] == FIRE) E.writeGridIndex(k, EMPTY); E.L->reactionFlags[k] = 0; }
  for (int i = 0; i < steamCount; i++) { int k = E.L->reactionSteam[i]; if (E.L->grid[k] == WATER) E.writeGridIndex(k, STEAM); }
  for (size_t i = 0; i < snowMelt.size(); i++) { int k = snowMelt[i]; if (E.L->grid[k] == SNOW) E.writeGridIndex(k, WATER); }
  for (int i = 0; i < igniteCount; i++) { int k = E.L->reactionIgnite[i]; if (!E.isBodyCell(k) && E.isFlammable(E.L->grid[k])) { plantBurned = plantBurned || E.isPlantMaterial(E.L->grid[k]); E.writeGridIndex(k, FIRE); } }
  if (plantBurned) E.splitPlantAfterErase();
}
void ReactionSystem::applyAcid() {
  bool dissolvedStone = false, dissolvedIce = false, dissolvedPlant = false;
  bool jointWasDirty = E.comps.jointDirty, jointBondsWereInvalid = E.comps.jointBondsInvalid;
  bool crossBondMayBreak = false;
  std::vector<int>& erasedStone = E.acidErasedStone; std::vector<int>& erasedIce = E.acidErasedIce;
  erasedStone.clear(); erasedIce.clear();
  // A pure acid bore can preserve the sleeping joint closure when the removed
  // cell was not the last co-occupation contact between its component pair.
  // Scan the smaller component and stop on the first surviving overlap; bulk
  // terrain usually finds one almost immediately.
  auto removalMayBreakCrossBond = [&](int target) {
    if (!E.bgEnabled || !E.comps.jointSupportValid || E.comps.jointSleepBlocked) return true;
    Layer& own = *E.L;
    Layer& peer = E.L == &E.fg ? E.bg : E.fg;
    if (!E.isRigidMaterialClass(peer.grid[target])) return false;
    int ownId = own.cellComp[target], peerId = peer.cellComp[target];
    int ownN = E.compCount(own), peerN = E.compCount(peer);
    if (ownId < 0 || ownId >= ownN || peerId < 0 || peerId >= peerN) return true;
    Comp* ownComp = E.comps.compById(own, ownId);
    Comp* peerComp = E.comps.compById(peer, peerId);
    if (ownComp->cells.size() <= peerComp->cells.size()) {
      for (int q : ownComp->cells) {
        if (q == target || !E.isRigidMaterialClass(own.grid[q])) continue;
        if (peer.cellComp[q] == peerId && E.isRigidMaterialClass(peer.grid[q])) return false;
      }
    } else {
      for (int q : peerComp->cells) {
        if (q == target || !E.isRigidMaterialClass(peer.grid[q])) continue;
        if (own.cellComp[q] == ownId && E.isRigidMaterialClass(own.grid[q])) return false;
      }
    }
    return true;
  };
  for (int y = 1; y < E.rows - 1; y++) {
    int minX, maxX; if (!E.activeRowSpan(y, minX, maxX)) continue;
    for (int x = minX; x <= maxX; x++) {
      int k = E.I(x, y); if (E.L->grid[k] != ACID) continue;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      // body-material invariant: a stone body cell IS dissolvable material, but acid
      // on free-body cells is owned by the body-erosion path (erodeBodies), so skip them here.
      auto acidEats = [&](int q) { return E.isDissolvable(E.L->grid[q]) && !E.isBodyCell(q); };
      if (!acidEats(right) && !acidEats(left) && !acidEats(down) && !acidEats(up)) continue;
      // Acid touching dissolvable material is actively boring: keep it in the active
      // band so it keeps eating on later steps. Without this, a failed dissolve roll
      // lets settleLiquid see the enclosed acid as resting-on-support and go inert,
      // dropping it out of the band forever — it freezes mid-solid after eating only
      // a little (acid "settles in stone"). Re-marking ends naturally once no
      // dissolvable neighbour remains or the acid decays.
      E.markCellIndex(k);
      if (E.rand() >= ACID_DISSOLVE_P) continue;
      bool hf = E.rand() < 0.5; int a = hf ? right : down, b = hf ? left : up, c = hf ? down : right, d = hf ? up : left;
      int target = -1;
      if (acidEats(a)) target = a; else if (acidEats(b)) target = b; else if (acidEats(c)) target = c; else if (acidEats(d)) target = d;
      if (target < 0) continue;
      uint8_t tm = E.L->grid[target];
      if ((E.isStoneComponentMaterial(tm) || E.isIceComponentMaterial(tm))
          && removalMayBreakCrossBond(target)) crossBondMayBreak = true;
      if (E.isStoneComponentMaterial(tm)) { erasedStone.push_back(target); dissolvedStone = true; } else if (E.isIceComponentMaterial(tm)) { erasedIce.push_back(target); dissolvedIce = true; } else if (E.isPlantMaterial(tm)) dissolvedPlant = true;
      // Dissolving releases acrid smoke (a yellow gas that rises/dissipates like
      // steam) from the dissolved cell ~half the time; otherwise it leaves space.
      if (E.rand() < ACRID_SMOKE_P) { E.writeGridIndex(target, ACRID_SMOKE); E.markCellIndex(target); }
      else E.writeGridIndex(target, EMPTY);
      if (E.rand() < ACID_DECAY_P) E.writeGridIndex(k, EMPTY);
    }
  }
  // Pass markGroundDirty=false and decide grounding ourselves: a dissolve that
  // doesn't disconnect anything (the common case of acid boring through bulk
  // stone) keeps the grounding cache valid and skips the full-grid reflood that
  // otherwise dominates the cost. removalsKeepGroundingValid patches the removed
  // cells when safe; any disconnect / seed / powder case forces a reflood.
  E.L->compsReshaped = false; // splitRigidAfterErase sets this if the comp SET changes
  if (dissolvedStone) E.splitRigidAfterErase(E.L->stoneComponents, erasedStone, E.L->nextStoneId, false, false);
  if (dissolvedIce) E.splitRigidAfterErase(E.L->iceComponents, erasedIce, E.L->nextIceId, true, false);
  if (dissolvedPlant) E.splitPlantAfterErase(); // sets groundDirty (plant grounding nuance)
  bool pureBore = false;
  if (dissolvedStone || dissolvedIce) {
    E.comps.cgRemovedCells.clear();
    E.comps.cgRemovedCells.insert(E.comps.cgRemovedCells.end(), erasedStone.begin(), erasedStone.end());
    E.comps.cgRemovedCells.insert(E.comps.cgRemovedCells.end(), erasedIce.begin(), erasedIce.end());
    if (!E.removalsKeepGroundingValid(E.comps.cgRemovedCells)) {
      E.L->groundDirty = true; // a real disconnect -> full reflood
    } else if (E.L->compsReshaped) {
      // Grounding still valid, but a comp split/vanished so the positional comp ids
      // that cellComp stores shifted -> the next pass must re-index (incremental).
      E.L->groundContentDirty = true;
    } else {
      // Pure bore: every surviving comp kept its id and position, so the cached
      // cellComp is still correct except at the removed cells. groundedCell was just
      // patched by removalsKeepGroundingValid; patch cellComp to match and leave the
      // cache otherwise untouched, so the next grounding pass SKIPS entirely. This is
      // what stops acid boring bulk stone from re-indexing the whole layer (incl. a
      // big inert ice tub holding a separate acid pool) every dissolve step.
      for (int k : E.comps.cgRemovedCells) E.L->cellComp[k] = -1;
      pureBore = !dissolvedPlant;
    }
  }
  if (pureBore && !crossBondMayBreak && E.comps.jointSupportValid && !E.comps.jointSleepBlocked) {
    // splitRigidAfterErase conservatively invalidates every joint. The surviving
    // overlap above proves this component-pair edge still exists, while
    // removalsKeepGroundingValid proved the same-layer base stayed exact.
    E.comps.jointDirty = jointWasDirty;
    E.comps.jointBondsInvalid = jointBondsWereInvalid;
  }
}
void ReactionSystem::applyLava() {
  std::unordered_set<int>& hardened = E.lavaHardenedScratch; hardened.clear();
  int hardenedYMax = 0; bool plantBurned = false;
  for (int y = 1; y < E.rows - 1; y++) {
    int minX, maxX; if (!E.activeRowSpan(y, minX, maxX)) continue;
    for (int x = minX; x <= maxX; x++) {
      int k = E.I(x, y); if (E.L->grid[k] != LAVA) continue;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      int snowK = -1;
      if (E.L->grid[right] == SNOW) snowK = right; else if (E.L->grid[left] == SNOW) snowK = left; else if (E.L->grid[down] == SNOW) snowK = down; else if (E.L->grid[up] == SNOW) snowK = up;
      if (snowK >= 0) { E.writeGridIndex(snowK, WATER); E.markCellIndex(k); continue; }
      int burnK = -1;
      // body-material invariant: lava disintegrates a flammable body via erodeBodies, not in-place ignition.
      auto lavaBurns = [&](int q) { return E.isFlammable(E.L->grid[q]) && !E.isBodyCell(q); };
      if (lavaBurns(right)) burnK = right; else if (lavaBurns(left)) burnK = left; else if (lavaBurns(down)) burnK = down; else if (lavaBurns(up)) burnK = up;
      if (burnK >= 0) { if (E.isPlantMaterial(E.L->grid[burnK])) plantBurned = true; E.writeGridIndex(burnK, FIRE); continue; }
      int liquidK = -1;
      // Flag-driven (quenchesLava: water/acid/brine) -> steam + hardened stone.
      auto quenches = [&](int q) { return E.isLavaQuencher(E.L->grid[q]); };
      if (quenches(right)) liquidK = right; else if (quenches(left)) liquidK = left; else if (quenches(down)) liquidK = down; else if (quenches(up)) liquidK = up;
      if (liquidK >= 0) { E.writeGridIndex(liquidK, STEAM); E.writeGridIndex(k, STONE); hardened.insert(k); if (y > hardenedYMax) hardenedYMax = y; continue; }
      if (E.rand() < LAVA_EMIT_FIRE_P) { int airK = -1; if (E.L->grid[up] == EMPTY) airK = up; else if (E.L->grid[right] == EMPTY) airK = right; else if (E.L->grid[left] == EMPTY) airK = left; if (airK >= 0) E.writeGridIndex(airK, FIRE); }
    }
  }
  if (!hardened.empty()) E.registerRigidCells(E.L->stoneComponents, E.L->nextStoneId, STONE, hardened, hardenedYMax, false);
  if (plantBurned) E.splitPlantAfterErase();
}
void ReactionSystem::applyIce() {
  bool melted = false; std::vector<int>& meltedCells = E.iceMeltedScratch; meltedCells.clear();
  for (auto& comp : E.L->iceComponents) {
    // Iterate by snapshot length, not a copy: freezing appends ICE cells to
    // comp.cells, and those new cells are already ICE (no further melt/freeze this
    // pass), so capping the loop at the pre-pass size is byte-identical to copying
    // the vector first — without the per-component heap allocation.
    size_t iceN = comp.cells.size();
    for (size_t ci = 0; ci < iceN; ci++) {
      int k = comp.cells[ci];
      if (E.L->grid[k] != ICE) continue;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      uint8_t rm = E.L->grid[right], lm = E.L->grid[left], dm = E.L->grid[down], um = E.L->grid[up];
      if (rm == FIRE || rm == LAVA || lm == FIRE || lm == LAVA || dm == FIRE || dm == LAVA || um == FIRE || um == LAVA) { E.writeGridIndex(k, WATER); meltedCells.push_back(k); melted = true; continue; }
      // Salt de-ices: ice touching a salt grain melts to BRINE (not water), and the
      // grain is spent (also -> brine). Brine never refreezes because the freeze
      // check below only targets WATER, so the melt sticks. Deterministic (no rand):
      // an ice-free / salt-free scene consumes no RNG here, so checksums are stable.
      if (rm == SALT || lm == SALT || dm == SALT || um == SALT) {
        int saltK = rm == SALT ? right : lm == SALT ? left : dm == SALT ? down : up;
        E.writeGridIndex(k, BRINE); E.writeGridIndex(saltK, BRINE); meltedCells.push_back(k); melted = true; continue;
      }
      if (E.rand() < ICE_FREEZE_P) {
        int waterK = -1; if (rm == WATER) waterK = right; else if (lm == WATER) waterK = left; else if (dm == WATER) waterK = down; else if (um == WATER) waterK = up;
        if (waterK >= 0) { E.writeGridIndex(waterK, ICE); comp.cells.push_back(waterK); int wy = waterK / E.cols; if (wy > comp.yMax) comp.yMax = wy; comp.cacheDirty = true; E.L->groundDirty = true; } // waterK was WATER (live grid read) -> not already in comp; new ICE cell -> reflood
      }
    }
  }
  if (melted) E.splitRigidAfterErase(E.L->iceComponents, meltedCells, E.L->nextIceId, true);
}
// Salt is a desiccant / de-icer. A grain that touches WATER dissolves into it,
// turning that water to BRINE (saltwater) and liquefying the grain into brine as
// well; the same grain melts SNOW to brine on contact. Brine is freeze-immune (the
// ice-freeze reaction only ever targets WATER), so salted meltwater never re-ices.
// Ice de-icing lives in applyIce (ice is a component and needs the split
// bookkeeping). Deterministic (no rand): a salt-free scene writes nothing here, so
// existing checksums are unchanged. Each grain salinates only itself + one
// neighbour, so a pinch of salt makes a little brine — no runaway ocean conversion.
void ReactionSystem::applySalt() {
  for (int y = 1; y < E.rows - 1; y++) {
    int minX, maxX; if (!E.activeRowSpan(y, minX, maxX)) continue;
    for (int x = minX; x <= maxX; x++) {
      int k = E.I(x, y); if (E.L->grid[k] != SALT) continue;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      int waterK = -1;
      if (E.L->grid[right] == WATER) waterK = right; else if (E.L->grid[left] == WATER) waterK = left; else if (E.L->grid[down] == WATER) waterK = down; else if (E.L->grid[up] == WATER) waterK = up;
      if (waterK >= 0) { E.writeGridIndex(waterK, BRINE); E.writeGridIndex(k, BRINE); continue; }
      // NOTE: salt does NOT dissolve on contact with existing brine — a denser salt
      // grain sinks THROUGH meltwater/brine to reach fresh ice below and keep
      // de-icing (applyIce runs first and consumes any grain adjacent to ice). The
      // tradeoff is a rare undissolved grain stranded in a deep brine pool, which
      // reads fine (a pinch of un-dissolved salt at the bottom).
      int snowK = -1;
      if (E.L->grid[right] == SNOW) snowK = right; else if (E.L->grid[left] == SNOW) snowK = left; else if (E.L->grid[down] == SNOW) snowK = down; else if (E.L->grid[up] == SNOW) snowK = up;
      if (snowK >= 0) { E.writeGridIndex(snowK, BRINE); E.writeGridIndex(k, BRINE); }
    }
  }
}
