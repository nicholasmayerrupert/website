// Material reactions.
//
// Runs after growth/rigid movement inside each layer step. This file owns
// local transformations such as water/fire steam, ignition, freezing/melting,
// acid erosion, and lava cooling. It should not own broad movement order.
void ReactionSystem::prepareActiveLists() {
  E.activeWaterCells.clear(); E.activeFireCells.clear(); E.activeAcidCells.clear();
  E.activeLavaCells.clear(); E.activeSaltCells.clear(); E.activeHeatCells.clear();
  E.L->heatAddedAfterPrepare = false;
  auto besideExplosive = [&](int k, int x, int y) {
    auto explosive = [&](int q) {
      uint8_t material = E.L->grid[q];
      return material == TNT || material == METHANE;
    };
    return (x + 1 < E.cols && explosive(k + 1))
        || (x > 0 && explosive(k - 1))
        || (y + 1 < E.rows && explosive(k + E.cols))
        || (y > 0 && explosive(k - E.cols));
  };
  for (int y = 1; y < E.rows; y++) {
    if (E.L->activeRowSpans[y].empty()) continue;
    int rb = y * E.cols;
    E.forEachActiveSpan(y, 1, E.cols - 2, true, [&](int minX, int maxX) {
      for (int x = minX; x <= maxX; x++) {
        int k = rb + x;
        switch (E.L->grid[k]) {
          case WATER: E.activeWaterCells.push_back(k); break;
          case FIRE: E.activeFireCells.push_back(k); if (y < E.rows - 1 && besideExplosive(k, x, y)) E.activeHeatCells.push_back(k); break;
          case ACID: if (y < E.rows - 1) E.activeAcidCells.push_back(k); break;
          case LAVA: if (y < E.rows - 1) { E.activeLavaCells.push_back(k); if (besideExplosive(k, x, y)) E.activeHeatCells.push_back(k); } break;
          case SALT: if (y < E.rows - 1) E.activeSaltCells.push_back(k); break;
          default: break;
        }
      }
    });
  }
}

void ReactionSystem::applyReactions() {
  int steamCount = 0, fireCount = 0, igniteCount = 0;
  bool plantIndexExact = E.L->groundBaseValid && !E.L->groundDirty && !E.L->groundContentDirty;
  std::vector<int>& erasedPlant = E.reactionErasedPlant; erasedPlant.clear();
  int igniteCap = E.cols * E.rows;
  std::vector<int>& snowMelt = E.reactionSnowMelt; snowMelt.clear();
  for (int k : E.activeWaterCells) {
      if (E.L->grid[k] != WATER) continue;
      int y = k / E.cols;
      int nk = E.L->grid[k + 1] == FIRE ? k + 1 : (E.L->grid[k - 1] == FIRE ? k - 1 : -1);
      if (nk < 0 && y < E.rows - 1 && E.L->grid[k + E.cols] == FIRE) nk = k + E.cols;
      if (nk < 0 && E.L->grid[k - E.cols] == FIRE) nk = k - E.cols;
      if (nk >= 0) { E.L->reactionSteam[steamCount++] = k; if (!E.L->reactionFlags[nk]) { E.L->reactionFlags[nk] = 1; E.L->reactionFires[fireCount++] = nk; } }
  }
  for (int k : E.activeFireCells) {
      if (E.L->grid[k] != FIRE || E.L->reactionFlags[k]) continue;
      int y = k / E.cols;
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
  for (int i = 0; i < fireCount; i++) { int k = E.L->reactionFires[i]; if (E.L->grid[k] == FIRE) E.writeGridIndex(k, EMPTY); E.L->reactionFlags[k] = 0; }
  for (int i = 0; i < steamCount; i++) { int k = E.L->reactionSteam[i]; if (E.L->grid[k] == WATER) E.writeGridIndex(k, STEAM); }
  for (size_t i = 0; i < snowMelt.size(); i++) { int k = snowMelt[i]; if (E.L->grid[k] == SNOW) E.writeGridIndex(k, WATER); }
  for (int i = 0; i < igniteCount; i++) { int k = E.L->reactionIgnite[i]; if (!E.isBodyCell(k) && E.isFlammable(E.L->grid[k])) { if (E.isPlantMaterial(E.L->grid[k])) erasedPlant.push_back(k); E.writeGridIndex(k, FIRE); } }
  E.finishPlantErosion(erasedPlant, plantIndexExact, true);
}
void ReactionSystem::applyAcid() {
  bool reactNow = E.tick % ACID_REACT_INTERVAL == 0;
  bool dissolvedStructural = false;
  bool cellCompExact = E.L->groundBaseValid && !E.L->groundDirty && !E.L->groundContentDirty;
  bool jointWasDirty = E.comps.jointDirty, jointBondsWereInvalid = E.comps.jointBondsInvalid;
  bool crossBondMayBreak = false;
  std::vector<int>& erasedStructural = E.acidErasedStructural;
  std::vector<int64_t>& crossPairs = E.acidCrossPairs;
  erasedStructural.clear();
  crossPairs.clear();
  // A pure acid bore can preserve the sleeping joint closure when the batch did
  // not remove the last co-occupation contact between a component pair. Record
  // each touched pair while dissolving, then scan its smaller component ONCE
  // against the final post-batch grid instead of once per removed cell.
  auto noteTouchedCrossBond = [&](int target) {
    if (!E.bgEnabled) return;
    if (!E.comps.jointSupportValid || E.comps.jointSleepBlocked) { crossBondMayBreak = true; return; }
    Layer& own = *E.L;
    Layer& peer = E.L == &E.fg ? E.bg : E.fg;
    if (!cellCompExact || own.groundDirty || own.groundContentDirty || peer.groundDirty || peer.groundContentDirty) { crossBondMayBreak = true; return; }
    if (!E.isRigidMaterialClass(peer.grid[target])) return;
    int ownId = own.cellComp[target], peerId = peer.cellComp[target];
    int ownN = E.compCount(own), peerN = E.compCount(peer);
    if (ownId < 0 || ownId >= ownN || peerId < 0 || peerId >= peerN) { crossBondMayBreak = true; return; }
    int64_t key = ((int64_t)ownId << 32) | (uint32_t)peerId;
    if (std::find(crossPairs.begin(), crossPairs.end(), key) == crossPairs.end()) crossPairs.push_back(key);
  };
  auto touchedCrossBondSurvives = [&](int64_t key) {
    Layer& own = *E.L;
    Layer& peer = E.L == &E.fg ? E.bg : E.fg;
    int ownId = (int)(key >> 32), peerId = (int)(uint32_t)key;
    Comp* ownComp = E.comps.compById(own, ownId);
    Comp* peerComp = E.comps.compById(peer, peerId);
    if (ownComp->cells.size() <= peerComp->cells.size()) {
      for (int q : ownComp->cells) {
        if (!E.isRigidMaterialClass(own.grid[q])) continue;
        if (peer.cellComp[q] == peerId && E.isRigidMaterialClass(peer.grid[q])) return true;
      }
    } else {
      for (int q : peerComp->cells) {
        if (!E.isRigidMaterialClass(peer.grid[q])) continue;
        if (own.cellComp[q] == ownId && E.isRigidMaterialClass(own.grid[q])) return true;
      }
    }
    return false;
  };
  for (int k : E.activeAcidCells) {
      if (E.L->grid[k] != ACID) continue;
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
      if (!reactNow) continue;
      if (E.rand() >= ACID_BATCH_DISSOLVE_P) continue;
      bool hf = E.rand() < 0.5; int a = hf ? right : down, b = hf ? left : up, c = hf ? down : right, d = hf ? up : left;
      int target = -1;
      if (acidEats(a)) target = a; else if (acidEats(b)) target = b; else if (acidEats(c)) target = c; else if (acidEats(d)) target = d;
      if (target < 0) continue;
      uint8_t tm = E.L->grid[target];
      E.audio.noteAcidDissolve(target % E.cols, target / E.cols);
      if (E.isComponentMaterial(tm)) {
        noteTouchedCrossBond(target);
        erasedStructural.push_back(target);
        dissolvedStructural = true;
      }
      // Dissolving releases acrid smoke (a yellow gas that rises/dissipates like
      // steam) from the dissolved cell ~half the time; otherwise it leaves space.
      if (E.rand() < ACRID_SMOKE_P) { E.writeGridIndex(target, ACRID_SMOKE); E.markCellIndex(target); }
      else E.writeGridIndex(target, EMPTY);
      if (E.rand() < ACID_DECAY_P) E.writeGridIndex(k, EMPTY);
  }
  if (!crossBondMayBreak) for (int64_t pair : crossPairs) {
    if (!touchedCrossBondSurvives(pair)) { crossBondMayBreak = true; break; }
  }
  // Pass markGroundDirty=false and decide grounding ourselves: a dissolve that
  // doesn't disconnect anything (the common case of acid boring through bulk
  // stone) keeps the grounding cache valid and skips the full-grid reflood that
  // otherwise dominates the cost. removalsKeepGroundingValid patches the removed
  // cells when safe; any disconnect / seed / powder case forces a reflood.
  E.L->compsReshaped = false; // splitRigidAfterErase sets this if the comp SET changes
  // cellComp is exact at reaction time. Use it to avoid re-scanning every rigid
  // cell in the layer just to discover which one or two components acid touched.
  ConnectivitySplitMode splitMode = cellCompExact
    ? ConnectivitySplitMode::LOCAL_EXACT
    : ConnectivitySplitMode::FULL;
  if (dissolvedStructural) E.splitRigidAfterErase(
    E.L->components, erasedStructural, E.L->nextComponentId,
    false, false, cellCompExact ? 0 : -1, splitMode);
  bool pureBore = false;
  if (dissolvedStructural) {
    E.comps.cgRemovedCells.clear();
    E.comps.cgRemovedCells.insert(E.comps.cgRemovedCells.end(),
                                  erasedStructural.begin(), erasedStructural.end());
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
      pureBore = true;
    }
  }
  if (pureBore && !crossBondMayBreak && E.comps.jointSupportValid && !E.comps.jointSleepBlocked) {
    // Only preserve the sleeping joint when NO component depends on cross-layer
    // stamps (every currently-grounded comp is also base-grounded). Hanging dual-
    // layer structures (BG beam held only by co-occupation with FG) keep base
    // flags ungrounded while c.grounded is joint-stamped — pure-bore must NOT
    // clear jointDirty there, or multi-log scenes creep one cell per dissolve
    // while co-occupation still exists (sleep skips re-joint; stamps go stale).
    auto dependsOnJoint = [](Layer& lay) {
      if (!lay.groundBaseValid) return true;
      size_t n = lay.components.size();
      if (lay.groundBaseFlags.size() != n) return true;
      size_t i = 0;
      auto scan = [&](std::vector<Comp>& list) {
        for (auto& c : list) {
          if (c.grounded && !lay.groundBaseFlags[i]) return true;
          i++;
        }
        return false;
      };
      return scan(lay.components);
    };
    if (!dependsOnJoint(E.fg) && !dependsOnJoint(E.bg)) {
      // splitRigidAfterErase conservatively invalidates every joint. Surviving
      // overlap + base-only support prove the closure is still exact for terrain.
      E.comps.jointDirty = jointWasDirty;
      E.comps.jointBondsInvalid = jointBondsWereInvalid;
    }
  }
}
void ReactionSystem::applyLava() {
  std::vector<int> burnedPlant;
  for (int k : E.activeLavaCells) {
      if (E.L->grid[k] != LAVA) continue;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      int snowK = -1;
      if (E.L->grid[right] == SNOW) snowK = right; else if (E.L->grid[left] == SNOW) snowK = left; else if (E.L->grid[down] == SNOW) snowK = down; else if (E.L->grid[up] == SNOW) snowK = up;
      if (snowK >= 0) { E.writeGridIndex(snowK, WATER); E.markCellIndex(k); continue; }
      int burnK = -1;
      // body-material invariant: lava disintegrates a flammable body via erodeBodies, not in-place ignition.
      auto lavaBurns = [&](int q) { return E.isFlammable(E.L->grid[q]) && !E.isBodyCell(q); };
      if (lavaBurns(right)) burnK = right; else if (lavaBurns(left)) burnK = left; else if (lavaBurns(down)) burnK = down; else if (lavaBurns(up)) burnK = up;
      if (burnK >= 0) { if (E.isPlantMaterial(E.L->grid[burnK])) burnedPlant.push_back(burnK); E.writeGridIndex(burnK, FIRE); continue; }
      int liquidK = -1;
      // Flag-driven (quenchesLava: water/acid/brine) -> steam + loose stone dust.
      // Keeping disconnected quench residue granular avoids creating a rigid body
      // for every isolated lava cell along a turbulent liquid boundary.
      auto quenches = [&](int q) { return E.isLavaQuencher(E.L->grid[q]); };
      if (quenches(right)) liquidK = right; else if (quenches(left)) liquidK = left; else if (quenches(down)) liquidK = down; else if (quenches(up)) liquidK = up;
      if (liquidK >= 0) { E.writeGridIndex(liquidK, STEAM); E.writeGridIndex(k, STONE_DUST); continue; }
      if (E.rand() < LAVA_EMIT_FIRE_P) { int airK = -1; if (E.L->grid[up] == EMPTY) airK = up; else if (E.L->grid[right] == EMPTY) airK = right; else if (E.L->grid[left] == EMPTY) airK = left; if (airK >= 0) E.writeGridIndex(airK, FIRE); }
  }
  if (!burnedPlant.empty()) E.splitPlantAfterErase(&burnedPlant);
}
void ReactionSystem::applyIce() {
  bool melted = false; std::vector<int>& meltedCells = E.iceMeltedScratch; meltedCells.clear();
  E.ensureComponentRegistries();
  for (int componentIndex : E.L->iceComponents) {
    Comp& comp = E.L->components[componentIndex];
    // Iterate by snapshot length, not a copy: freezing appends ICE cells to
    // comp.cells, and those new cells are already ICE (no further melt/freeze this
    // pass), so capping the loop at the pre-pass size is byte-identical to copying
    // the vector first — without the per-component heap allocation.
    size_t iceN = comp.cells.size();
    for (size_t ci = 0; ci < iceN; ci++) {
      int k = comp.cells[ci];
      if (E.L->grid[k] != ICE) continue;
      int y = k / E.cols, x = k - y * E.cols;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      // A floating ice component can legitimately settle on the last row. Keep
      // its reaction probes inside the grid; an unchecked floor `down` read could
      // alias unrelated WASM memory and, when that byte looked like WATER, append
      // an out-of-bounds ICE cell nondeterministically.
      uint8_t rm = x + 1 < E.cols ? E.L->grid[right] : EMPTY;
      uint8_t lm = x > 0 ? E.L->grid[left] : EMPTY;
      uint8_t dm = y + 1 < E.rows ? E.L->grid[down] : EMPTY;
      uint8_t um = y > 0 ? E.L->grid[up] : EMPTY;
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
        if (waterK >= 0) { E.writeGridIndex(waterK, ICE); comp.cells.push_back(waterK); E.noteComponentIndexAddition(componentIndex, waterK); int wy = waterK / E.cols; if (wy > comp.yMax) comp.yMax = wy; comp.cacheDirty = true; E.L->componentCarryDirty = true; } // waterK was WATER (live grid read) -> not already in comp; new ICE cell -> reflood
      }
    }
  }
  if (melted) E.splitRigidAfterErase(E.L->components, meltedCells, E.L->nextComponentId, true);

  // Free ice bodies remain material-identical ICE cells in the live grid. Water
  // frozen by one extends that body's local occupancy so the new ice shares its
  // pose instead of entering the static component registry as a separate island.
  std::vector<std::pair<int, int>>& frozen = E.bodyFrozenIceScratch;
  frozen.clear();
  auto freezeBesideBodyIce = [&](int k) {
    if (k < 0 || k >= E.cols * E.rows || E.L->bodyOwner[k] < 0
        || E.L->grid[k] != ICE) return;
    int y = k / E.cols, x = k - y * E.cols;
    uint8_t rm = x + 1 < E.cols ? E.L->grid[k + 1] : EMPTY;
    uint8_t lm = x > 0 ? E.L->grid[k - 1] : EMPTY;
    uint8_t dm = y + 1 < E.rows ? E.L->grid[k + E.cols] : EMPTY;
    uint8_t um = y > 0 ? E.L->grid[k - E.cols] : EMPTY;
    int waterK = rm == WATER && E.L->bodyOwner[k + 1] < 0 ? k + 1
               : lm == WATER && E.L->bodyOwner[k - 1] < 0 ? k - 1
               : dm == WATER && E.L->bodyOwner[k + E.cols] < 0 ? k + E.cols
               : um == WATER && E.L->bodyOwner[k - E.cols] < 0 ? k - E.cols
               : -1;
    if (waterK < 0) return;
    // A world/tick hash keeps the new body reaction deterministic without
    // advancing the shared reaction stream for unrelated materials.
    uint32_t phase = E.L->worldSeed ^ 0x1CEB0D1u
                   ^ ((uint32_t)E.tick * 0x9E3779B9u)
                   ^ (E.L->isBackground ? 0xB6A4D5u : 0u);
    if (whash2(phase, E.L->worldOffsetX + x,
               E.L->worldOffsetY + y) >= ICE_FREEZE_P) return;
    frozen.push_back({waterK, E.L->bodyOwner[k]});
  };
  for (int k : E.L->bodyCells) freezeBesideBodyIce(k);
  for (int k : E.L->passiveBodyCells) freezeBesideBodyIce(k);
  std::sort(frozen.begin(), frozen.end(),
            [](const auto& a, const auto& b) {
              return a.second != b.second ? a.second < b.second
                                          : a.first < b.first;
            });
  for (size_t begin = 0; begin < frozen.size();) {
    size_t end = begin + 1;
    while (end < frozen.size() && frozen[end].second == frozen[begin].second) end++;
    std::vector<int> cells;
    cells.reserve(end - begin);
    for (size_t i = begin; i < end; i++) {
      if (i > begin && frozen[i].first == frozen[i - 1].first) continue;
      cells.push_back(frozen[i].first);
    }
    E.rigid.freezeCellsOntoBody(*E.L, frozen[begin].second, *E.L, cells);
    begin = end;
  }
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
  for (int k : E.activeSaltCells) {
      if (E.L->grid[k] != SALT) continue;
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
