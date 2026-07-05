// ComponentSystem method bodies (need the full Engine definition; see components.hpp).

// Component lifetime and connectivity.
//
// Stone, ice, and plant materials are not loose pixels. They survive a step
// only through component membership, and unregistered component cells are
// erased during cleanup. Tool placement, worldgen, growth, and world shifting
// should route component writes through this subsystem and then sync/register.
// Rebuild E.L->cellComp[] (cell -> component index), the cgComps index, and per-
// component mean density. Shared by the full reflood (computeGrounded) and the
// incremental refresh (incrementalGroundingRefresh). Resets each Comp's grounded
// flag to false (the flood / refresh sets it back). Does NOT touch E.L->groundedCell[].
// O(total component cells).
void ComponentSystem::indexComponents() {
  Layer* const lay = E.L;
  int32_t* const cc = lay->cellComp.data();
  cgComps.clear();
  cgCompDensity.clear();
  auto idx = [&](std::vector<Comp>& list) {
    for (auto& c : list) {
      c.grounded = false;
      int id = (int)cgComps.size();
      cgComps.push_back(&c);
      double sum = 0;
      for (int k : c.cells) { cc[k] = id; sum += DENSITY[lay->grid[k]]; }
      cgCompDensity.push_back(c.cells.empty() ? 0 : sum / c.cells.size());
    }
  };
  idx(lay->stoneComponents); idx(lay->plantComponents); idx(lay->iceComponents);
}
void ComponentSystem::computeGrounded() {
  // Hot flood: hoist the per-cell buffers into TRUE locals (register-bound;
  // uint8_t stores can't alias them, unlike the old Engine-member mirrors).
  Layer* const lay = E.L;
  const uint8_t* const g = lay->grid;
  uint8_t* const grounded = lay->groundedCell.data();
  int32_t* const cc = lay->cellComp.data();
  int32_t* const gstack = lay->groundStack.data();
  std::fill(lay->groundedCell.begin(), lay->groundedCell.end(), (uint8_t)0);
  std::fill(lay->cellComp.begin(), lay->cellComp.end(), -1);
  indexComponents();
  bool sawPowder = false;
  auto canGroundAbove = [&](int below, int above) {
    uint8_t upper = g[above];
    if (!E.isBearingMaterial(upper)) return false;
    uint8_t lower = g[below];
    // Powders support other bearing loose cells and can settle rigid solids, but
    // they never push a rigid solid upward. Rigid-on-powder is handled by
    // moveRigidAssemblies with one-way granular support/displacement, not by
    // marking the rigid component grounded at the powder surface.
    if (E.isLooseSolidMaterial(lower) && E.isRigidMaterialClass(upper)) return false;
    return true;
  };
  int sp = 0;
  if (groundStackX.size() != (size_t)E.cols * E.rows) groundStackX.assign((size_t)E.cols * E.rows, 0);
  int32_t* gsx = groundStackX.data();
  // groundCellAt records the cell's column x alongside k, so the DFS below never
  // recomputes k/E.cols (an integer division per popped rigid cell). Every caller
  // already knows x: the seeds iterate x, and a propagation target's column is
  // derived from its parent (the cell above shares x; an 8-neighbour is nx).
  auto groundCellAt = [&](int k, int x) {
    if (grounded[k]) return;
    grounded[k] = 1;
    int id = cc[k];
    if (id >= 0) cgComps[id]->grounded = true;
    gsx[sp] = x; gstack[sp++] = k;
  };
  int floorBase = (E.rows - 1) * E.cols;
  for (int x = 0; x < E.cols; x++) { int k = floorBase + x; if (E.isBearingMaterial(g[k])) groundCellAt(k, x); }
  // Streamed-edge support: in the infinite world the left/right/top buffer edges abut
  // UNLOADED world that may itself be grounded. A rigid cell touching such an edge is
  // assumed supported, so a structure whose real floor-contact has streamed off the
  // buffer does not spuriously fall (it reconnects when the region streams back in).
  if (lay->infinite) {
    for (int y = 1; y < E.rows; y++) {
      int kl = y * E.cols + 1;          if (E.isRigidMaterialClass(g[kl])) groundCellAt(kl, 1);
      int kr = y * E.cols + (E.cols - 2); if (E.isRigidMaterialClass(g[kr])) groundCellAt(kr, E.cols - 2);
    }
    int topBase = E.cols; // row y = 1
    for (int x = 1; x < E.cols - 1; x++) { int k = topBase + x; if (E.isRigidMaterialClass(g[k])) groundCellAt(k, x); }
  }
  for (int y = E.rows - 2; y > 0; y--) {
    int rb = y * E.cols;
    for (int x = 1; x < E.cols - 1; x++) {
      int k = rb + x;
      if (E.isLooseSolidMaterial(g[k])) {
        sawPowder = true;
        if (E.isLiquidMaterial(g[k + E.cols]) && DENSITY[g[k + E.cols]] >= DENSITY[g[k]]) groundCellAt(k, x);
      }
    }
  }
  int gridLen = E.cols * E.rows;
  while (sp > 0) {
    --sp; int k = gstack[sp], kx = gsx[sp];
    int above = k - E.cols;
    if (above >= 0 && !grounded[above] && canGroundAbove(k, above)) groundCellAt(above, kx);
    if (E.isRigidMaterialClass(g[k])) {
      // Neighbour-row validity ny in [1, E.rows-1] <=> (k + oy*E.cols) in [E.cols, gridLen):
      // a division-free restatement of the original `ny<=0 || ny>=E.rows` test.
      for (int oy = -1; oy <= 1; oy++) {
        int rb = k + oy * E.cols;
        if (rb < E.cols || rb >= gridLen) continue;
        for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = kx + ox; if (nx <= 0 || nx >= E.cols - 1) continue;
          int nk = rb + ox;
          if (!grounded[nk] && E.isRigidMaterialClass(g[nk])) groundCellAt(nk, nx);
        }
      }
    }
  }
  // The cache is now fresh. Stay "dirty" (force a full reflood next step too)
  // while any powder is present: powder grounding (line above) depends on the
  // liquid beneath it, and liquids move without routing through the component
  // hooks that set groundDirty, so we can't safely skip the flood with powder
  // around. Powder-free scenes (e.g. acid eating stone) go clean and can skip.
  lay->groundSawPowder = sawPowder;
  lay->groundDirty = sawPowder;
}

// Incremental grounding for the common single-layer, powder-free case: the
// expensive part of computeGrounded is the flood; everything else (lay->cellComp +
// per-component density + grounded flags) is a cheap O(stone) linear pass. When
// no removal disconnected anything (Layer::groundDirty stayed false), the cached
// grounded[] is still the true grounded set (removed cells were patched to 0
// at the dissolve site), so we skip the flood entirely and only rebuild the
// cheap bookkeeping, deriving each component's grounded flag from the cache.
// Produces a byte-identical grounded[]/cc[] to a full reflood (verified).
void ComponentSystem::incrementalGroundingRefresh() {
  std::fill(E.L->cellComp.begin(), E.L->cellComp.end(), -1);
  indexComponents();                       // rebuilds E.L->cellComp + cgCompDensity, resets grounded=false
  for (Comp* c : cgComps) {                // a connected component is grounded iff ANY of its cells is
    for (int k : c->cells) if (E.L->groundedCell[k]) { c->grounded = true; break; }
  }
}

// Single-layer grounding entry point (the cross-layer path uses computeGrounded
// directly via computeGroundedBoth). Picks the full reflood or the incremental
// refresh, and when groundVerify is on, runs BOTH and asserts byte-equality so a
// wrong fast path can never silently desync — it shows up as a test failure.
void ComponentSystem::ensureGroundedSingleLayer() {
  bool full = groundForceFull || E.bgEnabled || E.L->groundDirty;
  // Skip the whole pass when nothing that affects grounding changed since the last
  // one: powder-free (powder grounding tracks liquids outside the component hooks),
  // no structural change (groundDirty), and no acid fast-path removal
  // (groundContentDirty). Every rigid mutation EITHER sets groundDirty or is the
  // acid fast-path removal (which sets groundContentDirty), so when all three are
  // clear the cached E.L->cellComp[]/E.L->groundedCell[]/comp.grounded are byte-identical to a
  // fresh incremental refresh — re-running it (an O(all rigid cells) pass) is pure
  // waste. This is what keeps a big INERT rigid mass cheap: a resting acid pool held
  // in an ice tub, say, while acid bores stone elsewhere. The boring keeps the LAYER
  // active every step, but only the steps that actually edit rigid content pay the
  // O(stone+ice) grounding cost; idle/non-dissolving steps reuse the cache for free.
  if (!full && !groundVerify && !E.L->groundSawPowder && !E.L->groundContentDirty) return;
  E.L->groundContentDirty = false;
  if (!groundVerify) {
    if (full) computeGrounded(); else incrementalGroundingRefresh();
    return;
  }
  if (full) computeGrounded(); else incrementalGroundingRefresh();
  gvGrounded.assign(E.L->groundedCell.begin(), E.L->groundedCell.end());
  gvCellComp.assign(E.L->cellComp.begin(), E.L->cellComp.end());
  computeGrounded(); // the trusted reference; leaves the live arrays correct regardless
  for (size_t i = 0, n = (size_t)E.cols * E.rows; i < n; i++) {
    if (gvGrounded[i] != E.L->groundedCell[i] || gvCellComp[i] != E.L->cellComp[i]) { groundMismatches++; break; }
  }
}

// Do all of the rigid cells in `boundary` (the surviving rigid neighbours of the
// removed blob) reconnect to one another through rigid material within [x0,x1] x
// [y0,y1], WITHOUT passing through any cell stamped `removedGen`? If so, the blob is
// not a cut: every path that used the blob reroutes through the reconnected
// boundary, so removing it disconnects nothing. A bounded window + visit cap keep
// it cheap; failing to connect (or exceeding the cap) is treated as a cut, which is
// always safe (the caller refloods).
bool ComponentSystem::blobBoundaryReconnects(const std::vector<int>& boundary, int32_t inN, int x0, int y0, int x1, int y1, int32_t removedGen) {
  int32_t vis = ++E.L->seenGen;
  // Early-exit means a genuine reconnection finds all boundary cells quickly, so the
  // cap only bounds the wasted work of a check that is going to FAIL (a real cut):
  // keep it modest so a failing check costs far less than the reflood it precedes.
  int* q = E.L->groundStack.data(); const int cap = 8000;
  int qh = 0, qt = 0;
  int need = (int)boundary.size(), found = 1; // boundary[0] is the BFS seed
  E.L->seenStamp[boundary[0]] = vis; q[qt++] = boundary[0];
  while (qh < qt) {
    if (qt >= cap) return false;
    int cur = q[qh++]; int cy = cur / E.cols, cx = cur - cy * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nx = cx + ox, ny = cy + oy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      int nk = ny * E.cols + nx;
      int32_t s = E.L->seenStamp[nk];
      if (s == vis || s == removedGen) continue;
      if (!E.isRigidMaterialClass(E.L->grid[nk])) continue;
      if (s == inN && ++found == need) return true; // all boundary cells reconnected -> not a cut (early out)
      E.L->seenStamp[nk] = vis; q[qt++] = nk;
    }
  }
  return found == need;
}

// Decide whether ONE 8-connected blob of just-removed rigid cells (grid already
// cleared at each) keeps the grounding cache valid. A removal changes another cell's
// grounding only by disconnecting it from a SEED (floor / streamed buffer edge /
// powder-on-dense-liquid). The blob is safe when it is (a) compact (small bbox) and
// clear of the edge/floor seed margin, (b) free of powder in its neighbourhood, and
// (c) such that every surviving rigid neighbour of the blob reconnects to the others
// without the blob. Then removing it disconnects nothing and the only grounding
// change is the removed cells themselves. Does NOT patch E.L->groundedCell -- the caller
// (removalsKeepGroundingValid) patches once every component of the batch is cleared,
// so a later failing component still leaves the cache untouched for the reflood.
bool ComponentSystem::blobKeepsGroundingValid(const std::vector<int>& blob) {
  const int MARGIN = 2;  // stay clear of the floor (row E.rows-1) and streamed edges
  const int SPAN = 128;  // max blob extent for the fast path; wider spreads reflood
  const int W = 8;       // reconnect-search margin around the blob bbox
  int32_t gen = ++E.L->seenGen;
  int bx0 = E.cols, by0 = E.rows, bx1 = -1, by1 = -1;
  for (int k : blob) {
    E.L->seenStamp[k] = gen;
    int y = k / E.cols, x = k - y * E.cols;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 - bx0 > SPAN || by1 - by0 > SPAN) { gbSpan++; return false; }
  if (bx0 <= MARGIN || bx1 >= E.cols - 1 - MARGIN || by0 <= MARGIN || by1 >= E.rows - 1 - MARGIN) { gbEdge++; return false; }
  // Gather the blob's surviving rigid neighbours (deduped via the inN stamp); bail
  // on any powder nearby (powder/liquid grounding nuance not modelled here). Removed
  // cells of OTHER components are already empty in the grid, so they are skipped by
  // the isRigidMaterial test and never pollute this blob's boundary.
  int32_t inN = ++E.L->seenGen;
  cgBlobN.clear();
  for (int r : blob) {
    int ry = r / E.cols, rx = r - ry * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int nk = (ry + oy) * E.cols + (rx + ox);
      uint8_t m = E.L->grid[nk];
      if (E.isLooseSolidMaterial(m)) { gbPowder++; return false; }
      if (E.isRigidMaterialClass(m) && E.L->seenStamp[nk] != gen && E.L->seenStamp[nk] != inN) { E.L->seenStamp[nk] = inN; cgBlobN.push_back(nk); }
    }
  }
  if ((int)cgBlobN.size() > 1) {  // 0/1 external connection: the blob is a pendant, removing it disconnects nothing else
    int x0 = imax(1, bx0 - W), x1 = imin(E.cols - 2, bx1 + W);
    int y0 = imax(1, by0 - W), y1 = imin(E.rows - 2, by1 + W);
    if (!blobBoundaryReconnects(cgBlobN, inN, x0, y0, x1, y1, gen)) { gbCut++; return false; }
  }
  gbFast++;
  return true;
}

// Decide whether a batch of just-removed rigid cells keeps the grounding cache valid,
// by partitioning it into 8-connected components and requiring EVERY component to
// independently pass blobKeepsGroundingValid. Checking per-component is essential and
// sound: the cells must be checked as a blob, not one at a time (two ADJACENT removals
// can together sever a bridge that neither severs alone -- the co-removed neighbour,
// already cleared, otherwise looks like plain empty space and hides it), but distinct
// 8-connected components are by definition non-adjacent, so no component can hide a
// bridge running through another's cells. Any path through a removed cell reroutes
// locally around its own component using surviving material; disjoint components never
// share that reroute. This lets a wide erosion front (e.g. a broad acid pool) split
// into many small blobs that each fast-path, instead of the whole batch bailing on its
// overall span. E.L->groundedCell stays a pure function of the grid -- verified byte-for-byte
// against a full reflood every step under groundVerify (see the grounding test).
bool ComponentSystem::removalsKeepGroundingValid(const std::vector<int>& removed) {
  if (removed.empty()) return true;
  // seenStamp marks each removed cell's partition state: `present` = a removed cell
  // not yet claimed by a component, `taken` = already swept into one. blobKeeps...
  // re-stamps a component's own cells (with a fresh gen) but only after we have
  // finished sweeping that component, so the outer scan still sees later components.
  int32_t present = ++E.L->seenGen;
  for (int k : removed) E.L->seenStamp[k] = present;
  int32_t taken = ++E.L->seenGen;
  for (int seed : removed) {
    if (E.L->seenStamp[seed] != present) continue; // already pulled into an earlier component
    cgRemovedComp.clear();
    int qt = 0; E.L->groundStack[qt++] = seed; E.L->seenStamp[seed] = taken;
    for (int qh = 0; qh < qt; qh++) {
      int cur = E.L->groundStack[qh]; cgRemovedComp.push_back(cur);
      int cy = cur / E.cols, cx = cur - cy * E.cols;
      for (int oy = -1; oy <= 1; oy++) { int ny = cy + oy; if (ny < 0 || ny >= E.rows) continue;
        for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = cx + ox; if (nx < 0 || nx >= E.cols) continue;
          int nk = ny * E.cols + nx;
          if (E.L->seenStamp[nk] == present) { E.L->seenStamp[nk] = taken; E.L->groundStack[qt++] = nk; }
        }
      }
    }
    if (!blobKeepsGroundingValid(cgRemovedComp)) return false; // a real cut/edge/powder/span -> reflood
  }
  for (int k : removed) E.L->groundedCell[k] = 0; // every component safe: only the removed cells lose grounding
  return true;
}

int ComponentSystem::compCount(Layer& lay) { return (int)(lay.stoneComponents.size() + lay.plantComponents.size() + lay.iceComponents.size()); }

// Union same-layer 8-adjacent components into `parent` (and `groundParent` when
// non-null), restricted to the components reachable from a cross-layer bonded
// comp. This replaces the old O(E.cols*E.rows) full-grid uniteLayerAdj pass that ran
// up to 4x per step. Cross-layer bond unions + the global grounded scan are done
// by the caller; here we only add same-layer adjacency.
//
// We seed from each layer's UNGROUNDED cross-bonded comps and walk same-layer
// adjacency. computeGrounded floods grounding across 8-adjacency, so an
// ungrounded rigid cell never borders a grounded one — every comp discovered by
// the walk is therefore ungrounded too, and the walk stays inside the floating
// region instead of scanning the whole grounded terrain mass. A grounded bonded
// endpoint needs no walk: its bond union (caller) + grounded scan already make
// its class grounded; whether its same-layer neighbours get marked cross-bonded
// is unobservable (grounded comps never move and are skipped everywhere).
void ComponentSystem::unionCrossBondedClusters(std::vector<int>& parent, std::vector<int>* groundParent, int nf, int nb) {
  int total = nf + nb;
  if ((int)cgCompStamp.size() < total) cgCompStamp.assign(total, 0);
  int32_t gen = ++cgCompGen;
  cgWorkQueue.clear();
  auto seed = [&](Layer& lay, int offset, int count) {
    for (int i = 0; i < count; i++) {
      if (i >= (int)lay.crossBondedComp.size() || !lay.crossBondedComp[i]) continue;
      if (compById(lay, i)->grounded) continue;
      int gid = offset + i;
      if (cgCompStamp[gid] == gen) continue;
      cgCompStamp[gid] = gen; cgWorkQueue.push_back(gid);
    }
  };
  seed(E.fg, 0, nf); seed(E.bg, nf, nb);
  for (size_t qi = 0; qi < cgWorkQueue.size(); qi++) {
    int gid = cgWorkQueue[qi];
    bool isFg = gid < nf; Layer& lay = isFg ? E.fg : E.bg; int offset = isFg ? 0 : nf;
    int layerCount = isFg ? nf : nb;
    Comp* c = compById(lay, gid - offset);
    const int32_t* cc = lay.cellComp.data();
    for (int k : c->cells) {
      int y = k / E.cols, x = k - y * E.cols;
      for (int oy = -1; oy <= 1; oy++) { int ny = y + oy; if (ny < 0 || ny >= E.rows) continue; int rb = ny * E.cols;
        for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox; if (nx < 0 || nx >= E.cols) continue;
          int nid = cc[rb + nx]; if (nid < 0 || nid >= layerCount) continue; int ngid = offset + nid;
          ufUnite(parent, gid, ngid);
          if (groundParent) ufUnite(*groundParent, gid, ngid);
          if (cgCompStamp[ngid] != gen) { cgCompStamp[ngid] = gen; cgWorkQueue.push_back(ngid); }
        }
      }
    }
  }
}

// Cross-layer grounding (runs once per step when the background is live). Each
// layer is grounded independently first; cross-layer contact then creates
// transient component bonds only when a connected overlap patch is large enough.
// A bonded assembly is grounded only if one member has ordinary same-layer/floor
// support. Unsupported overlaps therefore fall together instead of pinning each
// other, and tiny accidental overlaps do not transmit support.
// Produce one layer's BASE grounding (independent of the cross-layer step), either
// by a full flood or by reusing the cached base from a prior flood. The reuse path
// is taken only when the layer's rigid topology is provably unchanged: groundDirty
// false (every add/split/remove/move/freeze/registration sets it) AND no acid
// fast-path removal (groundContentDirty) AND a valid cache. Because computeGrounded
// ends with groundDirty = sawPowder, a layer holding powder ALWAYS refloods; only a
// powder-free, edit-free layer (the dry stone background during a pan) reuses. The
// reused E.L->groundedCell/comp.grounded are byte-identical to a fresh flood (E.L->groundedCell
// is a pure function of the grid; E.L->cellComp is written ONLY by grounding so it stays
// valid untouched between passes). This halves computeGroundedBoth's cost in the
// common two-layer pan case (the bg flood was ~half the joint-grounding time).
void ComponentSystem::groundLayerBase(Layer* lay, std::vector<uint8_t>& baseCache, bool& baseValid, std::vector<uint8_t>& gbCache) {
  E.useLayer(lay);
  int cc = (int)(lay->stoneComponents.size() + lay->plantComponents.size() + lay->iceComponents.size());
  bool full = groundForceFull || lay->groundDirty || lay->groundContentDirty || !baseValid || (int)gbCache.size() != cc;
  if (full) {
    computeGrounded();
    lay->groundContentDirty = false;
    baseCache.assign(lay->groundedCell.begin(), lay->groundedCell.end());
    gbCache.clear(); gbCache.reserve(cc);
    for (auto& c : lay->stoneComponents) gbCache.push_back(c.grounded ? 1 : 0);
    for (auto& c : lay->plantComponents) gbCache.push_back(c.grounded ? 1 : 0);
    for (auto& c : lay->iceComponents) gbCache.push_back(c.grounded ? 1 : 0);
    baseValid = true;
  } else {
    std::copy(baseCache.begin(), baseCache.end(), lay->groundedCell.begin());
    size_t i = 0;
    for (auto& c : lay->stoneComponents) c.grounded = gbCache[i++] != 0;
    for (auto& c : lay->plantComponents) c.grounded = gbCache[i++] != 0;
    for (auto& c : lay->iceComponents) c.grounded = gbCache[i++] != 0;
  }
}

// Re-widen the settle band over cells that LOST grounding this pass (prev
// grounded, now not) so they start falling next step. Shared by the fast and
// full grounding paths.
void ComponentSystem::wakeCellsThatLostGrounding(Layer& lay, const std::vector<uint8_t>& prev) {
  const uint8_t* gr = lay.groundedCell.data(); const uint8_t* g = lay.grid;
  int32_t* rmn = lay.rowMarkMin.data(); int32_t* rmx = lay.rowMarkMax.data();
  for (int y = 0; y < E.rows; y++) {
    int rb = y * E.cols, mn = rmn[y], mx = rmx[y];
    for (int x = 0; x < E.cols; x++) { int k = rb + x; if (prev[k] && !gr[k] && E.isRigidMaterialClass(g[k])) { if (x < mn) mn = x; if (x > mx) mx = x; } }
    rmn[y] = mn; rmx[y] = mx;
  }
}
void ComponentSystem::computeGroundedBoth() {
  cgPrevFg.assign(E.fg.groundedCell.begin(), E.fg.groundedCell.end());
  cgPrevBg.assign(E.bg.groundedCell.begin(), E.bg.groundedCell.end());
  // Each layer's base grounding: full flood when its rigid topology changed, else a
  // cheap cache reuse. cgFgBase/cgBgBase are populated here (the cross-layer machinery
  // below reads them as the independent base snapshots).
  groundLayerBase(&E.fg, cgFgBase, cgFgBaseValid, cgFgGroundedBase);
  groundLayerBase(&E.bg, cgBgBase, cgBgBaseValid, cgBgGroundedBase);

  int nf = compCount(E.fg), nb = compCount(E.bg);
  E.fg.crossBondedComp.assign(nf, 0);
  E.bg.crossBondedComp.assign(nb, 0);
  cgBonds.clear();

  // Common settled-terrain case: every component already grounded by its own
  // layer's flood. Then the whole cross-layer machinery below is provably a no-op
  // — directGroundSmall only ever touches UNGROUNDED comps, and with none
  // ungrounded no bond patch can form (a bond needs an ungrounded endpoint). So
  // skip it, AND skip the two full-grid base snapshots (cgFgBase/cgBgBase) that
  // only directGroundSmall + the pair-overlap test read. E.fg.groundedCell is
  // untouched by bg's flood, so deferring those copies to the ungrounded path
  // below is byte-identical to taking them here. Only wakeCellsThatLostGrounding (re-waking cells
  // that lost grounding) still must run.
  bool anyUngrounded = false;
  for (int i = 0; i < nf && !anyUngrounded; i++) if (!compById(E.fg, i)->grounded) anyUngrounded = true;
  for (int i = 0; i < nb && !anyUngrounded; i++) if (!compById(E.bg, i)->grounded) anyUngrounded = true;
  if (!anyUngrounded) {
    wakeCellsThatLostGrounding(E.fg, cgPrevFg); wakeCellsThatLostGrounding(E.bg, cgPrevBg);
    E.useLayer(&E.fg);
    return;
  }
  // cgFgBase/cgBgBase already hold each layer's base grounding (groundLayerBase).

  // Tiny (< MIN_CELLS) chunks can never reach the bond patch threshold, so a
  // 1-3 cell stone bit in front of solid background used to fall. They also
  // don't need the coupled-assembly move machinery (they just shouldn't fall) —
  // routing them through bonds made churny terrain re-run that machinery every
  // step. Instead ground a tiny ungrounded comp directly when a majority of its
  // cells are backed by GROUNDED other-layer rigid. Uses the independent base
  // grounding snapshots (cgFgBase/cgBgBase) so it never chains or lets two
  // ungrounded chunks float on each other; cheap (O(tiny-comp cells)).
  auto directGroundSmall = [&](Layer& lay, int count, const std::vector<uint8_t>& otherBase, const uint8_t* otherGrid) {
    for (int i = 0; i < count; i++) {
      Comp* c = compById(lay, i);
      if (c->grounded || (int)c->cells.size() >= CROSS_LAYER_BOND_MIN_CELLS) continue;
      int backed = 0;
      for (int k : c->cells) if (otherBase[k] && E.isRigidMaterialClass(otherGrid[k])) backed++;
      if (backed * 2 >= (int)c->cells.size()) { c->grounded = true; for (int k : c->cells) lay.groundedCell[k] = 1; }
    }
  };
  directGroundSmall(E.fg, nf, cgBgBase, E.bg.grid);
  directGroundSmall(E.bg, nb, cgFgBase, E.fg.grid);

  bool anyUnsupported = false;
  for (int i = 0; i < nf && !anyUnsupported; i++) if (!compById(E.fg, i)->grounded) anyUnsupported = true;
  for (int i = 0; i < nb && !anyUnsupported; i++) if (!compById(E.bg, i)->grounded) anyUnsupported = true;

  if (!anyUnsupported) {
    wakeCellsThatLostGrounding(E.fg, cgPrevFg); wakeCellsThatLostGrounding(E.bg, cgPrevBg);
    E.useLayer(&E.fg);
    return;
  }

  std::vector<int> fgArea(nf, 0), bgArea(nb, 0);
  for (int i = 0; i < nf; i++) fgArea[i] = (int)compById(E.fg, i)->cells.size();
  for (int i = 0; i < nb; i++) bgArea[i] = (int)compById(E.bg, i)->cells.size();

  std::unordered_map<int64_t, std::vector<int>> pairCells;
  const int32_t* const bgCC = E.bg.cellComp.data();
  const uint8_t* const bgG = E.bg.grid;
  const int32_t* const fgCC = E.fg.cellComp.data();
  const uint8_t* const fgG = E.fg.grid;
  for (int fi = 0; fi < nf; fi++) {
    Comp* fc = compById(E.fg, fi);
    if (fc->grounded) continue;
    for (int k : fc->cells) {
      int bi = bgCC[k];
      if (bi < 0 || bi >= nb || !E.isRigidMaterialClass(bgG[k])) continue;
      int64_t key = ((int64_t)fi << 32) | (uint32_t)bi;
      pairCells[key].push_back(k);
    }
  }
  for (int bi = 0; bi < nb; bi++) {
    Comp* bc = compById(E.bg, bi);
    if (bc->grounded) continue;
    for (int k : bc->cells) {
      int fi = fgCC[k];
      if (fi < 0 || fi >= nf || !E.isRigidMaterialClass(fgG[k]) || !compById(E.fg, fi)->grounded) continue;
      int64_t key = ((int64_t)fi << 32) | (uint32_t)bi;
      pairCells[key].push_back(k);
    }
  }

  // Largest-connected-overlap test, stamp-flooded (no per-pair hash sets): a cell
  // of this pair's overlap is "present" iff seen[k] == gen; consuming it sets 0.
  std::vector<int32_t>& seen = E.fg.seenStamp;
  std::vector<int>& stack = cgStack;
  for (auto& kv : pairCells) {
    int fi = (int)(kv.first >> 32), bi = (int)(uint32_t)kv.first;
    int required = imax(CROSS_LAYER_BOND_MIN_CELLS, (int)std::ceil(CROSS_LAYER_BOND_AREA_FRAC * (double)imin(fgArea[fi], bgArea[bi])));
    if ((int)kv.second.size() < required) continue;
    int32_t gen = ++E.fg.seenGen;
    for (int k : kv.second) seen[k] = gen;
    int largest = 0;
    for (int start : kv.second) {
      if (seen[start] != gen) continue;
      seen[start] = 0; stack.clear(); stack.push_back(start);
      int patch = 0;
      while (!stack.empty()) {
        int k = stack.back(); stack.pop_back(); patch++;
        int y = k / E.cols, x = k - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          int nk = ny * E.cols + nx;
          if (seen[nk] == gen) { seen[nk] = 0; stack.push_back(nk); }
        }
      }
      if (patch > largest) largest = patch;
    }
    if (largest >= required) {
      cgBonds.push_back({fi, bi, true});
      E.fg.crossBondedComp[fi] = 1;
      E.bg.crossBondedComp[bi] = 1;
    } else if (largest > 0 && !compById(E.fg, fi)->grounded && !compById(E.bg, bi)->grounded) {
      cgBonds.push_back({fi, bi, false});
      E.fg.crossBondedComp[fi] = 1;
      E.bg.crossBondedComp[bi] = 1;
    }
  }

  if (cgBonds.empty()) {
    wakeCellsThatLostGrounding(E.fg, cgPrevFg); wakeCellsThatLostGrounding(E.bg, cgPrevBg);
    E.useLayer(&E.fg);
    return;
  }

  std::vector<int>& parent = cgParent; std::vector<int>& groundParent = cgGroundParent;
  parent.assign(nf + nb, 0); groundParent.assign(nf + nb, 0);
  for (int i = 0; i < nf + nb; i++) parent[i] = groundParent[i] = i;
  for (auto& b : cgBonds) {
    ufUnite(parent, b.fgComp, nf + b.bgComp);
    if (b.supportsGround) ufUnite(groundParent, b.fgComp, nf + b.bgComp);
  }
  // Same-layer adjacency: bounded walk from ungrounded bonded comps instead of
  // the old O(E.cols*E.rows) full-grid scan (the panning-perf regression).
  unionCrossBondedClusters(parent, &groundParent, nf, nb);
  std::vector<uint8_t> rootBonded(nf + nb, 0);
  for (auto& b : cgBonds) rootBonded[ufFind(parent, b.fgComp)] = 1;
  std::fill(E.fg.crossBondedComp.begin(), E.fg.crossBondedComp.end(), (uint8_t)0);
  std::fill(E.bg.crossBondedComp.begin(), E.bg.crossBondedComp.end(), (uint8_t)0);
  for (int i = 0; i < nf; i++) if (rootBonded[ufFind(parent, i)]) E.fg.crossBondedComp[i] = 1;
  for (int i = 0; i < nb; i++) if (rootBonded[ufFind(parent, nf + i)]) E.bg.crossBondedComp[i] = 1;
  std::vector<uint8_t> rootGrounded(nf + nb, 0);
  for (int i = 0; i < nf; i++) if (compById(E.fg, i)->grounded) rootGrounded[ufFind(groundParent, i)] = 1;
  for (int i = 0; i < nb; i++) if (compById(E.bg, i)->grounded) rootGrounded[ufFind(groundParent, nf + i)] = 1;
  for (int i = 0; i < nf; i++) if (E.fg.crossBondedComp[i] && rootGrounded[ufFind(groundParent, i)]) {
    Comp* c = compById(E.fg, i); c->grounded = true;
    for (int k : c->cells) E.fg.groundedCell[k] = 1;
  }
  for (int i = 0; i < nb; i++) if (E.bg.crossBondedComp[i] && rootGrounded[ufFind(groundParent, nf + i)]) {
    Comp* c = compById(E.bg, i); c->grounded = true;
    for (int k : c->cells) E.bg.groundedCell[k] = 1;
  };

  // Re-wake whatever lost grounding this step (only the 1->0 transition;
  // already-ungrounded cells stay active from their own motion/edits).
  wakeCellsThatLostGrounding(E.fg, cgPrevFg); wakeCellsThatLostGrounding(E.bg, cgPrevBg);
  E.useLayer(&E.fg);
}

// Map a E.L->cellComp id (assigned by computeGrounded in stone|plant|ice order) back
// to its Comp* in the SAME layer.
Comp* ComponentSystem::compById(Layer& lay, int id) {
  size_t ns = lay.stoneComponents.size();
  if ((size_t)id < ns) return &lay.stoneComponents[id];
  id -= (int)ns;
  size_t np = lay.plantComponents.size();
  if ((size_t)id < np) return &lay.plantComponents[id];
  return &lay.iceComponents[id - (int)np];
}

bool ComponentSystem::compIdIsPlant(Layer& lay, int id) {
  int ns = (int)lay.stoneComponents.size();
  if (id < ns) return false;
  id -= ns;
  return id < (int)lay.plantComponents.size();
}

// Side/bottom face contact of a cell set against a grid (top faces excluded on
// purpose: top liquid never creates support/lift). Shared by the single-layer
// buoyancy decision (moveRigidAssemblies) and the cross-layer descend decision
// (moveCrossLayerBondedAssemblies) — the latter accumulates over both layers
// and ignores the `faces` total.
void ComponentSystem::accumulateFaceContact(const uint8_t* g, const std::unordered_set<int>& cells, FaceContact& c) {
  for (int k : cells) {
    int y = k / E.cols, x = k - y * E.cols;
    const int offs[3] = { -1, 1, E.cols };
    for (int i = 0; i < 3; i++) {
      int nk = k + offs[i], nx = x + (offs[i] == -1 ? -1 : offs[i] == 1 ? 1 : 0), ny = y + (offs[i] == E.cols ? 1 : 0);
      if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows) continue;
      if (cells.count(nk)) continue;
      uint8_t m = g[nk];
      c.faces++;
      if (E.isLiquidMaterial(m)) {
        c.liquidFaces++;
        c.liquidDensityArea += DENSITY[m];
        if (offs[i] == E.cols) c.bottomLiquidFaces++;
      } else if (E.isLooseSolidMaterial(m)) {
        c.powderFaces++;
        c.powderDensityArea += DENSITY[m];
        if (offs[i] == E.cols) c.bottomPowderFaces++;
      }
    }
  }
}

void ComponentSystem::moveCrossLayerBondedAssemblies() {
  int nf = compCount(E.fg), nb = compCount(E.bg);
  if (cgBonds.empty() || nf == 0 || nb == 0) return;
  E.fg.groundDirty = true; E.bg.groundDirty = true; // cross-layer assembly may move -> reflood both
  std::vector<int>& parent = cgParent;
  parent.assign(nf + nb, 0);
  for (int i = 0; i < nf + nb; i++) parent[i] = i;
  for (auto& b : cgBonds) {
    if (b.fgComp < 0 || b.fgComp >= nf || b.bgComp < 0 || b.bgComp >= nb) continue;
    ufUnite(parent, b.fgComp, nf + b.bgComp);
  }
  // Bounded same-layer union-find (replaces the old full-grid uniteLayerAdj),
  // seeded from ungrounded cross-bonded comps; operates on cgParent so the
  // helper's internal find/unite share this same array.
  unionCrossBondedClusters(parent, nullptr, nf, nb);

  struct JointGroup { std::vector<int> fgComps, bgComps; bool grounded = false; int maxY = 0; };
  std::unordered_map<int, JointGroup> groups;
  for (int i = 0; i < nf; i++) if (i < (int)E.fg.crossBondedComp.size() && E.fg.crossBondedComp[i]) {
    int r = ufFind(parent, i); JointGroup& g = groups[r]; g.fgComps.push_back(i);
    Comp* c = compById(E.fg, i); if (c->grounded) g.grounded = true; if (c->yMax > g.maxY) g.maxY = c->yMax;
  }
  for (int i = 0; i < nb; i++) if (i < (int)E.bg.crossBondedComp.size() && E.bg.crossBondedComp[i]) {
    int r = ufFind(parent, nf + i); JointGroup& g = groups[r]; g.bgComps.push_back(i);
    Comp* c = compById(E.bg, i); if (c->grounded) g.grounded = true; if (c->yMax > g.maxY) g.maxY = c->yMax;
  }
  std::vector<JointGroup*> order; order.reserve(groups.size());
  for (auto& kv : groups) order.push_back(&kv.second);
  std::sort(order.begin(), order.end(), [](JointGroup* a, JointGroup* b) { return a->maxY > b->maxY; });

  std::unordered_set<int> fgCells, bgCells;
  struct CellMat { int k; uint8_t m; };
  std::vector<CellMat> fgMats, bgMats;
  auto collect = [&](Layer& lay, const std::vector<int>& ids, std::unordered_set<int>& cells, std::vector<CellMat>& mats) {
    cells.clear(); mats.clear();
    for (int id : ids) {
      Comp* c = compById(lay, id);
      for (int k : c->cells) { cells.insert(k); mats.push_back({k, lay.grid[k]}); }
    }
  };
  auto crossLayerShouldDescend = [&](double density, const std::unordered_set<int>& fCells, const std::unordered_set<int>& bCells) {
    FaceContact c;
    accumulateFaceContact(E.fg.grid, fCells, c);
    accumulateFaceContact(E.bg.grid, bCells, c);
    if (c.liquidFaces > 0) {
      double liquidDensity = c.liquidDensityArea / c.liquidFaces;
      if (density > liquidDensity + 1e-6) return true;
      return c.bottomLiquidFaces == 0;
    }
    if (c.powderFaces > 0) {
      double powderDensity = c.powderDensityArea / c.powderFaces;
      if (density > powderDensity + 1e-6) return true;
      return c.bottomPowderFaces == 0;
    }
    return true;
  };

  // Plan a one-cell descent of `own` in `lay`. An assembly descends into EMPTY
  // (or its own) cells, and - after the joint side/bottom contact decision says
  // it should sink - shoves aside powder/liquid directly beneath its shell
  // instead of being pinned by it. Liquid above the shell is ignored by this
  // downward-only cross-layer decision.
  // Displaced contents are relocated into the cells the assembly vacates (its
  // per-column tops); if they can't fit there, we decline the move (status quo).
  // Gas is simply overrun (it dissipates), matching translateAssembly.
  auto planLayerMove = [&](Layer& lay, const std::unordered_set<int>& own,
                           std::vector<std::pair<int, uint8_t>>& relocate) -> bool {
    relocate.clear();
    for (int k : own) {
      int nk = k + E.cols, ny = nk / E.cols;
      if (ny < 1 || ny >= E.rows) return false;
      if (own.count(nk)) continue;
      uint8_t below = lay.grid[nk];
      if (below == EMPTY || E.isGasMaterial(below)) continue;
      bool displaceable = E.isBuoyantMedium(below);
      if (!displaceable) return false;
      relocate.push_back({0, below}); // dest cell assigned below (after vacated cells are known)
    }
    // Vacated cells (own cells with no own cell above) become empty after the move
    // and receive the displaced material. Count must cover every displaced cell.
    int slots = 0;
    for (int k : own) if (!own.count(k - E.cols)) slots++;
    if ((int)relocate.size() > slots) return false;
    int ri = 0;
    for (int k : own) { if (ri >= (int)relocate.size()) break; if (!own.count(k - E.cols)) relocate[ri++].first = k; }
    return true;
  };
  auto applyLayer = [&](Layer& lay, const std::vector<int>& ids, const std::unordered_set<int>& cells, const std::vector<CellMat>& mats, const std::vector<std::pair<int, uint8_t>>& relocate) {
    E.useLayer(&lay);
    for (int k : cells) if (!cells.count(k - E.cols)) E.writeGridIndex(k, EMPTY);
    for (auto& cm : mats) E.writeGridIndex(cm.k + E.cols, cm.m);
    for (auto& r : relocate) E.writeGridIndex(r.first, r.second); // displaced contents into vacated tops
    for (int id : ids) {
      Comp* c = compById(lay, id);
      bool isPlant = compIdIsPlant(lay, id);
      int wood = 0, leaf = 0, ym = 0;
      for (int& k : c->cells) {
        k += E.cols;
        int y = k / E.cols; if (y > ym) ym = y;
        if (isPlant) { uint8_t m = lay.grid[k]; if (E.isPlantWood(m)) wood++; else if (E.isPlantLeaf(m)) leaf++; }
      }
      c->yMax = ym;
      if (isPlant) { c->woodCount = wood; c->leafCount = leaf; c->cacheDirty = true; }
    }
  };

  std::vector<std::pair<int, uint8_t>> fgReloc, bgReloc;
  for (JointGroup* g : order) {
    if (g->grounded || g->fgComps.empty() || g->bgComps.empty()) continue;
    collect(E.fg, g->fgComps, fgCells, fgMats);
    collect(E.bg, g->bgComps, bgCells, bgMats);
    // Mean density of the whole bonded assembly (both layers) is passed through
    // for parity with the single-layer movement API; loose media are displaced
    // generally and liquid buoyancy is resolved in the per-layer assembly path.
    double sum = 0; int n = 0;
    for (auto& cm : fgMats) { sum += DENSITY[cm.m]; n++; }
    for (auto& cm : bgMats) { sum += DENSITY[cm.m]; n++; }
    double density = n ? sum / n : 0;
    // Both layers must be able to descend (the assembly moves as one unit); if
    // either is blocked by non-displaceable material, the assembly stays put.
    if (!crossLayerShouldDescend(density, fgCells, bgCells)) continue;
    if (!planLayerMove(E.fg, fgCells, fgReloc) || !planLayerMove(E.bg, bgCells, bgReloc)) continue;
    applyLayer(E.fg, g->fgComps, fgCells, fgMats, fgReloc);
    applyLayer(E.bg, g->bgComps, bgCells, bgMats, bgReloc);
  }
  E.useLayer(&E.fg);
}

void ComponentSystem::moveRigidAssemblies() {
  // Only UNGROUNDED assemblies can move (fall/float) — grounded terrain stays
  // put (the per-group loop below `continue`s on grounded). computeGrounded
  // floods grounded-ness through rigid contact, so an ungrounded component is
  // never 8-connected to a grounded one. So we process only ungrounded
  // components here, making the whole pass O(ungrounded cells) instead of
  // O(all stone) every step. `E.L->cellComp` (from computeGrounded) holds GLOBAL
  // comp indices in stone|plant|ice order; localOf maps those to our filtered
  // ungrounded `all` array (or -1 for grounded/none).
  int totalComps = (int)(E.L->stoneComponents.size() + E.L->plantComponents.size() + E.L->iceComponents.size());
  if (totalComps == 0) return;
  std::vector<Comp*> all;
  std::vector<int> localOf(totalComps, -1);
  int gi = 0;
  auto addList = [&](std::vector<Comp>& list) {
    for (auto& c : list) { if (!c.grounded && (!jointGroundReady || gi >= (int)E.L->crossBondedComp.size() || !E.L->crossBondedComp[gi])) { localOf[gi] = (int)all.size(); all.push_back(&c); } gi++; }
  };
  addList(E.L->stoneComponents); int nStone = (int)all.size();
  addList(E.L->plantComponents); int nStonePlant = (int)all.size();
  addList(E.L->iceComponents);
  int n = (int)all.size();
  if (n == 0) return; // everything is grounded (settled) -> nothing to move
  for (auto* comp : all) { int ym = 0; for (int k : comp->cells) { int y = k / E.cols; if (y > ym) ym = y; } comp->yMax = ym; }
  std::vector<int> parent(n); for (int i = 0; i < n; i++) parent[i] = i;
  // anchored[i]: this ungrounded comp is 8-adjacent to a GROUNDED comp, so it
  // is attached to supported terrain and must not move. (In the original full
  // union-find such a comp joined a grounded group and was skipped; this
  // reproduces that exactly while only scanning ungrounded cells.)
  std::vector<uint8_t> anchored(n, 0);
  for (int i = 0; i < n; i++) for (int k : all[i]->cells) {
    int y = k / E.cols, x = k - y * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (nx < 1 || nx >= E.cols - 1 || ny < 1 || ny >= E.rows) continue; int gj = E.L->cellComp[ny * E.cols + nx]; if (gj >= 0) { int j = localOf[gj]; if (j >= 0) { ufUnite(parent, i, j); } else { anchored[i] = 1; } } }
  }
  struct Group { std::vector<int> comps; bool grounded = false; int maxY = 0; };
  std::unordered_map<int, Group> groups;
  for (int i = 0; i < n; i++) { int r = ufFind(parent, i); Group& g = groups[r]; g.comps.push_back(i); if (all[i]->grounded || anchored[i]) g.grounded = true; if (all[i]->yMax > g.maxY) g.maxY = all[i]->yMax; }
  std::vector<Group*> order; order.reserve(groups.size());
  for (auto& kv : groups) order.push_back(&kv.second);
  std::sort(order.begin(), order.end(), [](Group* a, Group* b) { return a->maxY > b->maxY; });

  // Read the live grid for stone-group and plant comps so a falling component
  // keeps its real material (ore stays ore, not STONE). Ice comps are pure ICE.
  auto matOf = [&](int i, int k) -> uint8_t { return i < nStonePlant ? E.L->grid[k] : ICE; };

  auto translateAssembly = [&](Group* grp, std::unordered_set<int>& cells, int dir) -> bool {
    int dy = dir > 0 ? 1 : -1;
    auto componentDisplaceableForAssembly = [&](uint8_t m) {
      return m == EMPTY || E.isGasMaterial(m) || E.isBuoyantMedium(m);
    };
    for (int k : cells) {
      int leadK = k + dir; int leadY = leadK / E.cols;
      if (leadY < 1 || leadY >= E.rows) return false;
      if (cells.count(leadK)) continue;
      uint8_t lead = E.L->grid[leadK];
      if (!componentDisplaceableForAssembly(lead)) return false;
    }
    struct Disp { uint8_t material; int from; };
    std::vector<Disp> displaced; std::vector<int> vacated;
    for (int k : cells) {
      int leadK = k + dir; uint8_t lead = E.L->grid[leadK];
      if (!cells.count(leadK) && lead != EMPTY && componentDisplaceableForAssembly(lead)) displaced.push_back({lead, leadK});
      if (!cells.count(k - dir)) vacated.push_back(k);
    }
    int liquidDisplacedCount = 0, powderDisplacedCount = 0;
    for (auto& d : displaced) { if (E.isLiquidMaterial(d.material)) liquidDisplacedCount++; else if (E.isLooseSolidMaterial(d.material)) powderDisplacedCount++; }
    // Liquids and powders are relocated volume-preservingly. Liquids use a
    // density chain: dense fluid claims nearby lighter fluid first, then that
    // lighter fluid continues the same search until the chain reaches a surface.
    // The cells the assembly vacates are valid free volume for this planning
    // step; large slanted solids otherwise need too many distant surface cells
    // and can pin in full liquid stacks. Powders use a spill BFS to nearby free
    // room. GAS keeps the original vacated-cell dump.
    struct LiquidWrite { int target; uint8_t material; };
    std::vector<LiquidWrite> liquidWrites;
    std::vector<int> powderTargets;
    std::unordered_set<int> reserved; // cells already claimed by liquid/powder relocation
    if (liquidDisplacedCount > 0 || powderDisplacedCount > 0) {
      // Cells the assembly is about to occupy — a spill target must not be one of
      // them. Built lazily here (only when liquid/powder is displaced) so a large
      // slab falling through air/empty skips O(area) hash-set work/step.
      std::unordered_set<int> movedCells;
      for (int k : cells) movedCells.insert(k + dir);
      std::unordered_set<int> vacatedCells(vacated.begin(), vacated.end());
      int offs[4]; if (dir > 0) { offs[0] = -1; offs[1] = 1; offs[2] = E.cols; offs[3] = -E.cols; } else { offs[0] = -1; offs[1] = 1; offs[2] = -E.cols; offs[3] = E.cols; }
      int gridLen = E.cols * E.rows;
      auto plannedMaterialAt = [&](int k) -> uint8_t { return vacatedCells.count(k) ? EMPTY : E.L->grid[k]; };
      // Bound the total volume-preserving liquid search for this one assembly move.
      // Each displaced liquid cell BFS-floods the reachable liquid body to find a
      // surface; for a large rigid slab sinking through a big ENCLOSED pool (e.g.
      // acid/water quenching a lava lake into a sinking STONE island) that is
      // O(displaced * poolArea) per step and froze the E.tick for seconds. Once the
      // shared budget is spent, planLiquidChain fails over to planVacatedLiquidDump —
      // the volume the slab just vacated directly above it, which is the natural
      // destination for a fully-immersed slab anyway. Small slabs / shallow pools
      // never approach the cap, so their realistic surface-seeking flow is unchanged.
      const long LIQUID_PLAN_VISIT_BUDGET = 100000;
      long liquidPlanVisits = 0;
      auto planLiquidChain = [&](uint8_t startMaterial, int startFrom) -> bool {
        size_t writeBase = liquidWrites.size();
        std::vector<int> claimed;
        auto fail = [&]() {
          liquidWrites.resize(writeBase);
          for (int k : claimed) reserved.erase(k);
          return false;
        };
        uint8_t moving = startMaterial;
        int origin = startFrom;
        for (int chain = 0; chain < TABLE + 2; chain++) {
          std::unordered_set<int> seen; std::vector<int> queue;
          auto canVisit = [&](int k) {
            if (liquidPlanVisits >= LIQUID_PLAN_VISIT_BUDGET) return false; // budget spent -> stop flooding, fall back to vacated dump
            if (k < 0 || k >= gridLen || seen.count(k) || reserved.count(k)) return false;
            int y = k / E.cols, x = k - y * E.cols;
            if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false;
            if (movedCells.count(k) || (cells.count(k) && !vacatedCells.count(k))) return false;
            uint8_t m = plannedMaterialAt(k);
            return m == EMPTY || E.isLiquidMaterial(m);
          };
          auto enqueue = [&](int k) { if (!canVisit(k)) return; seen.insert(k); queue.push_back(k); liquidPlanVisits++; };
          for (int off : offs) enqueue(origin + off);
          for (size_t qi = 0; qi < queue.size();) {
            size_t levelEnd = queue.size();
            int lighterTarget = -1, emptyTarget = -1;
            for (; qi < levelEnd; qi++) {
              int k = queue[qi];
              uint8_t m = plannedMaterialAt(k);
              if (E.isLiquidMaterial(m) && DENSITY[m] < DENSITY[moving]) {
                if (lighterTarget < 0) lighterTarget = k;
                continue;
              }
              if (m == EMPTY) {
                if (emptyTarget < 0) emptyTarget = k;
                continue;
              }
              for (int off : offs) enqueue(k + off);
            }
            int target = lighterTarget >= 0 ? lighterTarget : emptyTarget;
            if (target < 0) continue;
            uint8_t displacedLiquid = plannedMaterialAt(target);
            liquidWrites.push_back({target, moving});
            reserved.insert(target);
            claimed.push_back(target);
            if (E.isLiquidMaterial(displacedLiquid)) {
              moving = displacedLiquid;
              origin = target;
              break;
            }
            return true;
          }
          if (queue.empty()) return fail();
        }
        return fail();
      };
      int vacatedRelocCursor = 0;
      auto planVacatedLiquidDump = [&](uint8_t material) {
        while (vacatedRelocCursor < (int)vacated.size() && reserved.count(vacated[vacatedRelocCursor])) vacatedRelocCursor++;
        if (vacatedRelocCursor >= (int)vacated.size()) return false;
        int target = vacated[vacatedRelocCursor++];
        liquidWrites.push_back({target, material});
        reserved.insert(target);
        return true;
      };
      for (auto& d : displaced) {
        if (!E.isLiquidMaterial(d.material)) continue;
        if (!planLiquidChain(d.material, d.from) && !planVacatedLiquidDump(d.material)) return false;
      }

      auto runPowderSpill = [&](int need, std::vector<int>& out) -> bool {
        if (need <= 0) return true;
        std::unordered_set<int> seen; std::vector<int> queue;
        auto canVisit = [&](int k) { if (k < 0 || k >= gridLen || seen.count(k) || reserved.count(k)) return false; int y = k / E.cols, x = k - y * E.cols; if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false; if (movedCells.count(k) || (cells.count(k) && !vacatedCells.count(k))) return false; uint8_t m = plannedMaterialAt(k); return m == EMPTY || E.isLiquidMaterial(m) || E.isLooseSolidMaterial(m); };
        auto enqueue = [&](int k) { if (!canVisit(k)) return; seen.insert(k); queue.push_back(k); };
        for (auto& d : displaced) { if (!E.isLooseSolidMaterial(d.material)) continue; for (int off : offs) enqueue(d.from + off); }
        for (size_t qi = 0; qi < queue.size() && (int)out.size() < need; qi++) {
          int k = queue[qi];
          if (plannedMaterialAt(k) == EMPTY) { if (!reserved.count(k)) { reserved.insert(k); out.push_back(k); } continue; }
          for (int off : offs) enqueue(k + off);
        }
        return (int)out.size() >= need;
      };
      if (!runPowderSpill(powderDisplacedCount, powderTargets)) return false;
    }
    struct Move { Comp* comp; bool isPlant; std::vector<std::pair<int, uint8_t>> mats; int wood, leaf; };
    std::vector<Move> moves;
    for (int ci : grp->comps) {
      Comp* comp = all[ci]; bool isPlant = ci >= nStone && ci < nStonePlant;
      std::vector<std::pair<int, uint8_t>> mats; int wood = 0, leaf = 0;
      for (int k : comp->cells) { uint8_t m = matOf(ci, k); mats.push_back({k + dir, m}); if (isPlant) { if (E.isPlantWood(m)) wood++; else if (E.isPlantLeaf(m)) leaf++; } }
      moves.push_back({comp, isPlant, std::move(mats), wood, leaf});
    }
    std::vector<std::pair<int, int>> movedFuses;
    if (!E.L->pendingDetonations.empty()) {
      movedFuses.reserve(E.L->pendingDetonations.size());
      for (int k : cells) {
        auto it = E.L->pendingDetonations.find(k);
        if (it == E.L->pendingDetonations.end()) continue;
        movedFuses.push_back({k + dir, it->second});
        E.L->pendingDetonations.erase(it);
      }
    }
    E.L->groundDirty = true; // an assembly is relocating -> grounding changes -> full reflood
    for (int k : cells) E.writeGridIndex(k, EMPTY);
    for (auto& mv : moves) {
      std::vector<int> newCells; newCells.reserve(mv.mats.size());
      for (auto& pr : mv.mats) { E.writeGridIndex(pr.first, pr.second); newCells.push_back(pr.first); } // mats are distinct (k+dir over distinct k)
      mv.comp->cells = std::move(newCells);
      mv.comp->yMax = imax(0, imin(E.rows - 1, mv.comp->yMax + dy));
      if (mv.isPlant) { mv.comp->woodCount = mv.wood; mv.comp->leafCount = mv.leaf; mv.comp->cacheDirty = true; }
    }
    for (auto& pr : movedFuses) {
      auto it = E.L->pendingDetonations.find(pr.first);
      if (it == E.L->pendingDetonations.end() || pr.second < it->second) E.L->pendingDetonations[pr.first] = pr.second;
    }
    // Relocate every displaced cell: liquids use liquidWrites, powders -> powderTargets,
    // gas -> the vacated-cell dump. A powder STILL advances the
    // shared vacated cursor (without writing there) so gas keeps landing in
    // byte-identical cells while the powder goes to its spill target instead.
    int di = 0, pi = 0;
    for (auto& d : displaced) {
      if (E.isLiquidMaterial(d.material)) continue;
      while (di < (int)vacated.size() && (E.L->grid[vacated[di]] != EMPTY || reserved.count(vacated[di]))) di++;
      if (E.isLooseSolidMaterial(d.material)) { E.writeGridIndex(powderTargets[pi++], d.material); if (di < (int)vacated.size()) di++; }
      else if (di < (int)vacated.size()) E.writeGridIndex(vacated[di++], d.material); // gas
    }
    for (auto& w : liquidWrites) E.writeGridIndex(w.target, w.material);
#ifdef SAND_INVARIANT_CHECKS
    {
      // Dev probe: no relocation target may land inside ANY component's cells.
      std::unordered_set<int> allCompCells;
      for (auto& c : E.L->stoneComponents) for (int k : c.cells) allCompCells.insert(k);
      for (auto& c : E.L->plantComponents) for (int k : c.cells) allCompCells.insert(k);
      for (auto& c : E.L->iceComponents) for (int k : c.cells) allCompCells.insert(k);
      auto probe = [&](int t, uint8_t m, const char* what) {
        if (!allCompCells.count(t)) return;
        char buf[200];
        snprintf(buf, sizeof(buf), "TRANSLATE PROBE: %s wrote mat=%d into comp cell k=%d (x=%d,y=%d) dir=%d vacated=%d",
                 what, (int)m, t, t % E.cols, t / E.cols, dir > 0 ? 1 : -1, (int)std::count(vacated.begin(), vacated.end(), t));
        emscripten_console_error(buf);
        abort();
      };
      for (auto& w : liquidWrites) probe(w.target, w.material, "liquidWrite");
      for (size_t i2 = 0; i2 < powderTargets.size(); i2++) probe(powderTargets[i2], 0, "powderSpill");
    }
#endif
    return true;
  };

  auto motionDecision = [&](std::unordered_set<int>& cells, double avgDensity) -> int {
    FaceContact c;
    accumulateFaceContact(E.L->grid, cells, c);
    bool powderSupports = false;
    if (c.powderFaces > 0) {
      double powderDensity = c.powderDensityArea / c.powderFaces;
      powderSupports = c.bottomPowderFaces > 0 && avgDensity <= powderDensity + 1e-6;
    }
    if (c.liquidFaces > 0) {
      double liquidDensity = c.liquidDensityArea / c.liquidFaces;
      if (avgDensity > liquidDensity + 1e-6) return powderSupports ? 0 : 1;
      double targetFaces = c.faces > 0 ? c.faces * (avgDensity / liquidDensity) : 0;
      double imbalance = c.liquidFaces - targetFaces;
      double band = std::fmax(1.0, std::sqrt((double)cells.size()) * 0.25);
      if (imbalance > band && c.bottomLiquidFaces > 0) return -1;
      if (c.bottomLiquidFaces > 0 && imbalance >= -band) return 0;
      return powderSupports ? 0 : 1;
    }
    if (powderSupports) return 0; // one-way granular support, never lift
    return 1;
  };

  for (Group* grp : order) {
    if (grp->grounded) continue;
    std::unordered_set<int> cells;
    for (int ci : grp->comps) for (int k : all[ci]->cells) cells.insert(k);
    double weight = 0;
    for (int ci : grp->comps) {
      for (int k : all[ci]->cells) {
        double d = DENSITY[matOf(ci, k)];
        weight += d;
      }
    }
    double avgDensity = weight / cells.size();
    int decision = motionDecision(cells, avgDensity);
    if (decision == 0) continue;
    std::unordered_set<int> shifted; shifted.reserve(cells.size());
    int dirK = decision > 0 ? E.cols : -E.cols;
    for (int k : cells) shifted.insert(k + dirK);
    // If a one-cell move would immediately ask for the opposite move, the
    // assembly is already straddling buoyant equilibrium. Hold it there instead
    // of producing a deterministic up/down two-cycle.
    if (motionDecision(shifted, avgDensity) == -decision) continue;
    translateAssembly(grp, cells, dirK);
  }
}

// `seen[k] == gen` means visited. The caller bumps the generation (gen++) to
// "clear" the whole buffer in O(1) instead of reallocating/zeroing E.cols*E.rows.
void ComponentSystem::floodComponent(int sx, int sy, std::vector<int32_t>& seen, int32_t gen, bool bounded, std::vector<int>& outCells, int& outYMax,
                    bool (ComponentSystem::*matCheck)(uint8_t)) {
  int bx = bounded ? sx >> CHUNK_SHIFT : 0, by = bounded ? sy >> CHUNK_SHIFT : 0;
  int k0 = sy * E.cols + sx;
  outCells.clear(); outCells.push_back(k0); outYMax = sy; seen[k0] = gen; // seen[] dedups -> push_back never repeats
  for (size_t qi = 0; qi < outCells.size(); qi++) {
    int cur = outCells[qi]; int y = cur / E.cols, x = cur - y * E.cols; if (y > outYMax) outYMax = y;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
      if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows) continue;
      if (bounded && ((nx >> CHUNK_SHIFT) != bx || (ny >> CHUNK_SHIFT) != by)) continue;
      int nk = ny * E.cols + nx; if (seen[nk] == gen || !(this->*matCheck)(E.L->grid[nk])) continue;
      seen[nk] = gen; outCells.push_back(nk);
    }
  }
}
// Component-group membership for the seeded-component floods (generated from the
// schema `componentGroup`). The stone group floods each material as its OWN id
// (an ore vein is its own island, not merged with surrounding stone), so it uses
// floodTargetMat rather than a group-membership predicate.
bool ComponentSystem::isFloodTargetMat(uint8_t m) { return m == floodTargetMat; }
bool ComponentSystem::isIceGroup(uint8_t m) { return MAT_CGROUP[m] == CG_ICE; }
bool ComponentSystem::isPlantMat(uint8_t m) { return MAT_CGROUP[m] == CG_PLANT; }

void ComponentSystem::registerSeededComponents(int colStart, int colEnd) { registerSeededComponents(colStart, colEnd, 0, E.rows); }
// Register stone/plant/ice components for unseen material in the buffer rect
// [colStart,colEnd) x [rowStart,rowEnd). A streamed-in vertical band passes a row
// range (E.cols-wide); a horizontal band passes a col range (E.rows-tall).
void ComponentSystem::registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd) {
  E.L->groundDirty = true; // bulk component rebuild (sync/tools/worldgen/shift) -> full reflood
  // Reused generation-stamped scratch (allocated once in Layer::alloc): a cell
  // is "seen" iff seenStamp[k] == gen. Each of the three blocks bumps gen, so
  // the "clear" between materials costs O(1) instead of zeroing E.cols*E.rows.
  std::vector<int32_t>& seen = E.L->seenStamp;
  // STONE group (chunk-bounded). Each same-id region floods as its own island,
  // so a vein of ore inside stone is a distinct component (and stays a distinct
  // material when it falls — see matOf in moveRigidAssemblies). New ores/blocks
  // with componentGroup "stone" register here automatically.
  {
    int32_t gen = ++E.L->seenGen;
    for (auto& comp : E.L->stoneComponents) for (int k : comp.cells) seen[k] = gen;
    for (int k : E.L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components (skip both seeding and flood-merge)
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || MAT_CGROUP[E.L->grid[k]] != CG_STONE) continue;
      std::vector<int> cells; int yMax;
      floodTargetMat = E.L->grid[k];
      floodComponent(sx, sy, seen, gen, true, cells, yMax, &ComponentSystem::isFloodTargetMat);
      Comp c; c.id = E.L->nextStoneId++; c.cells = std::move(cells); c.yMax = yMax;
      c.growing = floodTargetMat == MYCELIUM_SPORE;
      if (c.growing) E.L->myceliumActive = true;
      E.L->stoneComponents.push_back(std::move(c));
    }
  }
  // PLANT group (unbounded — a whole tree is one component). New plant-family
  // flora with componentGroup "plant" register here automatically.
  {
    int32_t gen = ++E.L->seenGen;
    for (auto& comp : E.L->plantComponents) for (int k : comp.cells) seen[k] = gen;
    for (int k : E.L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || MAT_CGROUP[E.L->grid[k]] != CG_PLANT) continue;
      std::vector<int> cells; int yMax;
      floodComponent(sx, sy, seen, gen, false, cells, yMax, &ComponentSystem::isPlantMat);
      Comp c; c.id = E.L->nextPlantId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
      // Re-derive the species from the trunk material (so a streamed-in / restored
      // tree keeps its type — the cells ARE the persistence) and count generically.
      for (int kk : cells) { uint8_t m = E.L->grid[kk]; if (E.isPlantWood(m)) { c.woodCount++; if (c.plantType == PT_OAK) c.plantType = E.plantTypeFromWood(m); } else if (E.isPlantLeaf(m)) c.leafCount++; }
      c.cells = std::move(cells); E.L->plantComponents.push_back(std::move(c));
    }
  }
  // ICE group (unbounded).
  {
    int32_t gen = ++E.L->seenGen;
    for (auto& comp : E.L->iceComponents) for (int k : comp.cells) seen[k] = gen;
    for (int k : E.L->bodyCells) seen[k] = gen; // body-material invariant: free-body cells are not static components
    for (int sy = rowStart; sy < rowEnd; sy++) for (int sx = colStart; sx < colEnd; sx++) {
      int k = sy * E.cols + sx; if (seen[k] == gen || MAT_CGROUP[E.L->grid[k]] != CG_ICE) continue;
      std::vector<int> cells; int yMax;
      floodComponent(sx, sy, seen, gen, false, cells, yMax, &ComponentSystem::isIceGroup);
      Comp c; c.id = E.L->nextIceId++; c.cells = std::move(cells); c.yMax = yMax; c.cacheDirty = true; E.L->iceComponents.push_back(std::move(c));
    }
  }
}

void ComponentSystem::registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) {
  if (cells.empty()) return;
  E.L->groundDirty = true; // adds rigid cells (lava harden / tool placement) -> full reflood
  // Find which existing components the new cells touch. Comp.cells is a vector
  // now, so a linear .count() per neighbor would be O(cells * comps * size); use
  // a cell->component-index map built LAZILY (only once a same-material neighbor
  // actually exists), keeping the common "placed in open space" case allocation-free.
  std::unordered_set<int> touchingIds;
  std::unordered_map<int, int> owner; bool ownerBuilt = false;
  for (int k : cells) {
    int y = k / E.cols, x = k - y * E.cols;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx;
      if (E.L->grid[nk] != mat || cells.count(nk)) continue;
      if (!ownerBuilt) { for (size_t i = 0; i < list.size(); i++) for (int c : list[i].cells) owner[c] = (int)i; ownerBuilt = true; }
      auto it = owner.find(nk); if (it != owner.end()) touchingIds.insert(list[it->second].id);
    }
  }
  Comp newComp; newComp.id = nextId++; newComp.cells.assign(cells.begin(), cells.end()); newComp.yMax = yMax; newComp.cacheDirty = iceCache;
  if (!touchingIds.empty()) {
    std::vector<Comp> keep;
    for (auto& comp : list) {
      if (touchingIds.count(comp.id)) { for (int k : comp.cells) { newComp.cells.push_back(k); int y = k / E.cols; if (y > newComp.yMax) newComp.yMax = y; } }
      else keep.push_back(std::move(comp));
    }
    list = std::move(keep);
  }
  list.push_back(std::move(newComp));
}

// Plant analogue of registerRigidCells, used when a free plant-family body (a wood
// log, etc.) bakes into terrain on rest. Delegates the cell/merge bookkeeping to
// registerRigidCells (so a baked log fuses with an adjacent same-material tree), then
// re-derives the plant-comp fields (species + wood/leaf counts) from the resulting
// cell set. The baked plant is inert scenery (growing=false), like worldgen flora.
void ComponentSystem::registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax) {
  registerRigidCells(E.L->plantComponents, E.L->nextPlantId, mat, cells, yMax, false);
  Comp& c = E.L->plantComponents.back();
  c.woodCount = 0; c.leafCount = 0; c.age = 0; c.growing = false; c.cacheDirty = true; c.plantType = PT_OAK;
  for (int k : c.cells) { uint8_t m = E.L->grid[k]; if (E.isPlantWood(m)) { c.woodCount++; if (c.plantType == PT_OAK) c.plantType = E.plantTypeFromWood(m); } else if (E.isPlantLeaf(m)) c.leafCount++; }
}

// Split the freshly-placed `cells` into 8-connected groups and register each as
// its OWN component (each still merges with adjacent EXISTING same-material comps
// inside registerRigidCells). A fast cursor leaves air gaps between brush stamps,
// so one draft can drop several physically-disconnected blobs. Lumping them into a
// SINGLE component (plain registerRigidCells) makes the whole thing inherit the
// grounded flag of any one supported blob — computeGrounded sets comp->grounded
// from any grounded cell, and moveRigidAssemblies only moves !grounded comps — so
// floating blobs never fall. Splitting first lets each disconnected blob be judged
// for support on its own, matching driftwood (which registers through the flood-fill
// registerSeededComponents). 8-connectivity mirrors computeGrounded/moveRigidAssemblies
// so the split agrees with how the physics later groups and grounds these cells.
void ComponentSystem::registerRigidCellsSplit(std::vector<Comp>& list, int& nextId, uint8_t mat,
                             std::unordered_set<int>& cells, bool iceCache) {
  if (cells.empty()) return;
  std::unordered_set<int> remaining(cells.begin(), cells.end());
  std::vector<int> stack;
  while (!remaining.empty()) {
    int seed = *remaining.begin(); remaining.erase(remaining.begin());
    std::unordered_set<int> group; int yMax = 0;
    stack.clear(); stack.push_back(seed);
    while (!stack.empty()) {
      int k = stack.back(); stack.pop_back();
      group.insert(k); int y = k / E.cols, x = k - y * E.cols; if (y > yMax) yMax = y;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx; auto it = remaining.find(nk);
        if (it != remaining.end()) { remaining.erase(it); stack.push_back(nk); }
      }
    }
    registerRigidCells(list, nextId, mat, group, yMax, iceCache);
  }
}

// split a plant-family component list keeping only cells still of plant material
void ComponentSystem::splitPlantAfterErase() {
  if (jointGroundReady) { jointBondsInvalid = true; jointGroundReady = false; }
  E.L->groundDirty = true; // plant cells removed/split -> full reflood
  std::vector<Comp> updated;
  std::vector<int32_t>& seen = E.L->seenStamp;
  std::vector<int> part;
  for (auto& comp : E.L->plantComponents) {
    int32_t remGen = ++E.L->seenGen;
    for (int k : comp.cells) if (E.isPlantMaterial(E.L->grid[k])) seen[k] = remGen;
    bool reused = false;
    for (int seed : comp.cells) {
      if (seen[seed] != remGen) continue;
      part.clear(); part.push_back(seed); seen[seed] = 0; // part doubles as the BFS queue; seen[] dedups
      for (size_t qi = 0; qi < part.size(); qi++) {
        int cur = part[qi]; int y = cur / E.cols, x = cur - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx; if (seen[nk] == remGen) { seen[nk] = 0; part.push_back(nk); } }
      }
      Comp c; c.id = reused ? E.L->nextPlantId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
      c.plantType = comp.plantType; c.growing = comp.growing; // a cut tree keeps species + growth on both halves
      for (int k : part) { int y = k / E.cols; if (y > c.yMax) c.yMax = y; if (E.isPlantWood(E.L->grid[k])) c.woodCount++; else if (E.isPlantLeaf(E.L->grid[k])) c.leafCount++; }
      c.cells = std::move(part); updated.push_back(std::move(c)); reused = true;
    }
  }
  E.L->plantComponents = std::move(updated);
}
// split stone/ice after erase: remove erased cells, re-flood
// markGroundDirty=true (the default, used by tools-erase and ice-melt) forces a
// full grounding reflood next pass. Acid passes false and instead runs its own
// cut-vertex check (noteAcidRemovals) to keep the grounding cache valid when a
// dissolve doesn't disconnect anything.
void ComponentSystem::splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache, bool markGroundDirty) {
  if (jointGroundReady && !erased.empty()) { jointBondsInvalid = true; jointGroundReady = false; }
  if (markGroundDirty && !erased.empty()) E.L->groundDirty = true;
  if (erased.empty() || list.empty()) return;
  std::vector<int32_t>& seen = E.L->seenStamp;
  int32_t erasedGen = ++E.L->seenGen;
  for (int k : erased) seen[k] = erasedGen;
  std::vector<Comp> updated;
  std::vector<int> survivors, part;
  for (auto& comp : list) {
    bool touched = false;
    survivors.clear(); survivors.reserve(comp.cells.size());
    for (int k : comp.cells) { if (seen[k] == erasedGen) touched = true; else survivors.push_back(k); }
    if (!touched) { updated.push_back(std::move(comp)); continue; }
    if (survivors.empty()) { E.L->compsReshaped = true; continue; } // comp fully erased -> ids shift
    int32_t remGen = ++E.L->seenGen;
    for (int k : survivors) seen[k] = remGen;
    bool reused = false;
    for (int start : survivors) {
      if (seen[start] != remGen) continue;
      part.clear(); part.push_back(start); seen[start] = 0; // part doubles as the BFS queue
      for (size_t qi = 0; qi < part.size(); qi++) {
        int cur = part[qi]; int y = cur / E.cols, x = cur - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!E.isInBounds(nx, ny)) continue; int nk = ny * E.cols + nx; if (seen[nk] == remGen) { seen[nk] = 0; part.push_back(nk); } }
      }
      if (reused) E.L->compsReshaped = true; // a 2nd+ surviving piece -> a split: ids shift
      Comp c; c.id = reused ? nextId++ : comp.id; c.yMax = 0; c.cacheDirty = iceCache;
      for (int k : part) { int y = k / E.cols; if (y > c.yMax) c.yMax = y; }
      c.cells = std::move(part); updated.push_back(std::move(c));
      reused = true;
    }
  }
  list = std::move(updated);
}
