#pragma once
// One simulation layer (foreground or background) — ALL the per-cell state:
// grids, dirty tracking, components, rigid bodies, tile/body stores, lighting
// buffers, render pixels. Hoisted out of the Engine (5c) so the extracted
// subsystem classes (Renderer, TerrainGen, ...) can take Layer* in their
// interfaces. The Engine composes two (fg/bg) plus raw-pointer mirrors of the
// hot indexed buffers (see members.inc).

struct Layer {
  EngineStorageRole storageRole = ESR_FULL;
  // double buffer + the "current"/"next" pointers (alternate each step)
  std::vector<uint8_t> gridA, gridB; uint8_t* grid = nullptr; uint8_t* next = nullptr;
  // dirty tracking (per-layer active region)
  std::vector<uint8_t> dirtyRender;
  std::vector<int32_t> dirtyRects;
  std::vector<int32_t> rowMarkMin, rowMarkMax, chunkStamp, activeRowMin, activeRowMax, vacatedStamp, assemblyWakeStamp, blastGasStamp;
  // A locally-proven cave blast starts from synchronized buffers (its fuse ticks
  // paid the ordinary full carry). Keep the crater + short gas aftermath local
  // without changing the general double-buffer path or its deterministic order.
  int blastLocalCarryTicks = 0;
  // Persistent best-energy scratch for a same-tick blast batch. Membership uses
  // seenStamp/seenGen, so a batch clears in O(1) instead of allocating + zeroing
  // two full-window arrays on every detonation tick.
  std::vector<float> blastBestEnergy;
  int dirtyRenderCount = 0;
  // per-cell sim scratch
  std::vector<uint8_t> groundedCell;
  std::vector<int32_t> cellComp, groundStack, compOccStamp;
  // generation-stamped "seen" scratch for component flood fills (reused across
  // calls; a cell is "seen" iff seenStamp[k] == seenGen, so a clear is just gen++).
  std::vector<int32_t> seenStamp; int32_t seenGen = 0;
  // Free rigid-body displacement spill scratch. Footprint and reserved targets
  // must be live at the same time as a BFS seen set, so they use separate stamps.
  std::vector<int32_t> rigidSpillFootprint, rigidSpillReserved;
  std::vector<int> prevCompCells, curCompCells, bodyCells;
  // Loose/gas cells relocated by static-component motion before prepareNextBuffer.
  // They are carried once into next[] and skipped by the loose pass that tick.
  std::vector<int> assemblyRelocatedCells;
  std::vector<uint8_t> reactionFlags;
  std::vector<int32_t> reactionSteam, reactionFires, reactionIgnite;
  // Set when a reaction creates new heat after prepareActiveLists. Existing heat
  // may disappear safely (the candidate is rechecked); newly-created heat needs
  // the legacy ordered active-span scan so TNT can still ignite that same tick.
  bool heatAddedAfterPrepare = false;
  // Transient survival mining damage. 0 = no active damage; otherwise the
  // remaining durability for the current held mine target. Not serialized.
  std::vector<uint32_t> mineDamage;
  // Render-only light values (0..255). Recomputed before full render; never
  // serialized or used by simulation/checksum paths. `lightBase` holds this
  // layer's pre-cross-projection light so both layers' final light can be solved
  // from one base pass each (projectCrossLayerLight reads the OTHER layer's base).
  std::vector<uint8_t> light, lightBase, skyLight, skyTopInput, skyDownValue;
  std::vector<int32_t> skyDownDepth;
  std::unordered_map<int, int32_t> skyWorldReachY;
  int skyOffsetX = 0, skyOffsetY = 0;
  int skyInputLevel = -1;
  bool skyValid = false, skyDirty = true;
  // Conservative "this layer might have nonzero mineDamage" flag: set true the
  // moment any cell is damaged, cleared only when the whole array is zeroed
  // (clearAllMineDamage / world shift). Lets the render fill skip the per-cell
  // mineDamage load + crack-shading branch entirely in the overwhelmingly common
  // case that nobody is mining (a pure render speedup; pixels aren't in the
  // checksum). A stale-true flag just falls back to the exact per-cell path.
  bool mineDamageAny = false;
  // components + ids
  std::vector<Comp> stoneComponents, plantComponents, iceComponents;
  int nextStoneId = 1, nextPlantId = 1, nextIceId = 1;
  bool myceliumActive = false;
  // Incremental-grounding cache state (see members near cgComps). groundDirty
  // true => the next grounding pass must be a full reflood; it is set true by any
  // component add/move/split/growth/sync.
  // groundSawPowder records whether the last overlay saw any powder (diagnostics /
  // legacy gates; the hot path no longer refloods solely because powder exists).
  // groundContentDirty: a rigid component change that did NOT set groundDirty (the
  // acid fast-path removal) happened since the last grounding pass, so the cached
  // cellComp/groundedCell must be refreshed even though no full reflood is forced.
  // looseGroundDirty: a powder or liquid cell changed since the last successful
  // overlay. Powder grounding depends on the cell below (rigid / denser liquid), so
  // only loose/liquid motion invalidates the overlay — not the mere presence of
  // powder. When groundDirty, groundContentDirty, and looseGroundDirty are all
  // clear (and the rigid base is valid), the cached grounding is the exact
  // grounding of the current grid and the whole pass can be skipped.
  bool groundDirty = true, groundSawPowder = false, groundContentDirty = true;
  bool looseGroundDirty = true;
  // Inclusive column span of powder/liquid writes since the last overlay.
  // looseDirtyX1 < looseDirtyX0 means "unknown / full width" when looseGroundDirty.
  int looseDirtyX0 = 0, looseDirtyX1 = -1;
  // Sparse dirty columns (bitset). When non-empty and not "full", only these
  // columns need base-copy + loose overlay on a pure only-loose refresh.
  // looseDirtyFull forces every column (unknown write site / post-rigid flood).
  std::vector<uint8_t> looseDirtyCol;
  bool looseDirtyFull = true;
  // Per-column count of loose-solid + liquid cells (optional sparse skip aid).
  std::vector<int32_t> looseColCount;
  // After a world stream, grounding caches are shifted with the grid and only the
  // entering band (+ edge seams) must be re-seeded. -1 => no stream band (full).
  int groundStreamX0 = -1, groundStreamX1 = -1; // half-open [x0,x1) when x0 >= 0
  int groundStreamY0 = -1, groundStreamY1 = -1; // half-open [y0,y1) when y0 >= 0
  // When the peer layer is rigid-dirty, this layer replays groundRigidBase (drop
  // joint patches) without a full rigid DFS.
  bool groundBaseReplay = false;
  // Rigid-grounding base cache (Perf 7b): groundedCell as of the last fresh
  // computeRigidGrounded (R bits only, taken BEFORE the loose overlay) plus the
  // comp grounded flags in stone|plant|ice order. computeGrounded reuses it
  // (memcpy + overlay) when no rigid mutation is pending and the layer has no
  // bodies (body stamps join rigid chains without routing through the hooks).
  // The acid pure-bore path patches removed cells here like it patches
  // groundedCell (removalsKeepGroundingValid).
  std::vector<uint8_t> groundRigidBase, groundBaseFlags;
  bool groundBaseValid = false;
  // Set by splitRigidAfterErase when an erase changes the component SET (a comp
  // splits into >1 piece or is fully removed), shifting the positional comp ids that
  // cellComp stores. The acid fast path clears it first, then uses it to decide
  // whether a dissolve that kept grounding valid needs a full re-index (structure
  // changed) or just a cheap cellComp patch of the removed cells (a pure bore).
  bool compsReshaped = false;
  std::vector<uint8_t> crossBondedComp;
  // Cached 8-neighbour adjacency between component ids (packed min/max ids).
  // Rebuilt with cellComp in indexComponents; joint grounding reuses it instead
  // of re-walking every component cell on every loose-material tick.
  std::vector<uint64_t> compAdjPairs;
  // free rigid bodies + ownership
  std::vector<Body*> bodies; int nextBodyId = 1;
  std::vector<int32_t> bodyOwner;
  // lit static TNT cells counting down to detonation (cell -> ticksLeft). Body TNT
  // uses Body::fuseTicks instead, since a body's cells move. See explosives.inc.
  std::unordered_map<int, int> pendingDetonations;
  // worldgen / streaming (per-layer terrain + chunk store)
  bool infinite = false;
  bool isBackground = false; // bg = a more-solid backdrop (sparser caves) behind the carved fg
  int worldOffsetX = 0, worldOffsetY = 0; // buffer cell (x,y) maps to world (worldOffsetX+x, worldOffsetY+y)
  uint32_t worldSeed = 0;
  int gSurfAmp = 0, gSurfBase = 0, gSeaRow = 0, gSoil = 0;
  uint32_t gCaveSeed = 0, gTreeSeed = 0, gPocketSeed = 0;
  // 2D streaming persistence: full sim-state saved as CHUNK_SIZE x CHUNK_SIZE
  // tiles keyed by absolute tile coords (so it survives shifts in BOTH axes).
  std::unordered_map<int64_t, std::vector<uint8_t>> tileStore;              // (tileWX,tileWY) -> CHUNK*CHUNK cells
  std::unordered_map<int64_t, std::vector<std::pair<Body*, std::pair<double, double>>>> bodyStore; // tile -> [(body, (worldPx,worldPy))]
  // render pixels for this layer (cols*rows*4 RGBA)
  std::vector<uint8_t> renderPixels;

  void alloc(int cols, int rows, int chunkCols, int chunkRows, EngineStorageRole role = ESR_FULL) {
    storageRole = role;
    size_t n = (size_t)cols * rows;
    gridA.assign(n, EMPTY);
    grid = gridA.data();
    dirtyRender.assign((size_t)chunkCols * chunkRows, 0);
    rowMarkMin.assign(rows, cols); rowMarkMax.assign(rows, -1);

    // A presentation mirror receives authoritative grids and only performs
    // camera collision queries, lighting, pixel fill, and GL compositing. Point
    // next at the read-only grid as a defensive fallback for shared query code;
    // presentation code never swaps or writes the cellular next buffer.
    if (role == ESR_PRESENTATION) {
      gridB.clear(); next = grid;
      light.assign(n, 0); lightBase.assign(n, 0); skyLight.assign(n, 0); skyTopInput.assign(cols, 0);
      skyDownValue.assign(cols, 0); skyDownDepth.assign(cols, -1);
      renderPixels.assign(n * 4, 0);
      return;
    }

    gridB.assign(n, EMPTY); next = gridB.data();
    chunkStamp.assign((size_t)chunkCols * chunkRows, -1);
    activeRowMin.assign(rows, 0); activeRowMax.assign(rows, 0);
    vacatedStamp.assign(n, -1);
    assemblyWakeStamp.assign(n, -1);
    blastGasStamp.assign(n, -1);
    groundedCell.assign(n, 0); cellComp.assign(n, -1); groundStack.assign(n, 0);
    groundRigidBase.clear(); groundBaseFlags.clear(); groundBaseValid = false;
    looseDirtyX0 = 0; looseDirtyX1 = -1;
    looseDirtyCol.assign(cols, 0); looseDirtyFull = true;
    looseColCount.assign(cols, 0);
    groundStreamX0 = groundStreamX1 = groundStreamY0 = groundStreamY1 = -1;
    compOccStamp.assign(n, -1);
    seenStamp.assign(n, 0); seenGen = 0;
    rigidSpillFootprint.assign(n, 0); rigidSpillReserved.assign(n, 0);
    reactionFlags.assign(n, 0); reactionSteam.assign(n, 0); reactionFires.assign(n, 0); reactionIgnite.assign(n, 0);
    mineDamage.assign(n, 0);
    bodyOwner.assign(n, -1);
    if (role != ESR_AUTHORITY) {
      light.assign(n, 0); lightBase.assign(n, 0); skyLight.assign(n, 0); skyTopInput.assign(cols, 0);
      skyDownValue.assign(cols, 0); skyDownDepth.assign(cols, -1);
      renderPixels.assign(n * 4, 0);
    }
    skyWorldReachY.clear();
    skyOffsetX = skyOffsetY = 0; skyInputLevel = -1; skyValid = false; skyDirty = true;
  }
  // Reallocate per-cell sim/render arrays for a new buffer size while PRESERVING
  // tileStore/bodyStore/worldgen seeds/params (used by resizeLoadedWindow).
  // Callers must have already persisted live buffer content into the stores and
  // emptied bodies/components that were buffer-indexed.
  void reallocSim(int newCols, int newRows, int newChunkCols, int newChunkRows) {
    const size_t newN = (size_t)newCols * newRows;
    if (newN < gridA.size()) {
      // assign()/clear() preserve vector capacity. After an extreme zoom-out that
      // kept every old per-cell allocation alive even though hot loops used the
      // smaller logical size, leaving hundreds of MB resident. Swap only on the
      // shrink path; growth still reuses capacity normally.
      auto release = [](auto& v) { std::decay_t<decltype(v)>().swap(v); };
      release(gridA); release(gridB); release(dirtyRender); release(dirtyRects);
      release(rowMarkMin); release(rowMarkMax); release(chunkStamp);
      release(activeRowMin); release(activeRowMax); release(vacatedStamp); release(assemblyWakeStamp); release(blastGasStamp); release(blastBestEnergy); release(assemblyRelocatedCells);
      release(groundedCell); release(cellComp); release(groundStack); release(compOccStamp);
      release(seenStamp); release(rigidSpillFootprint); release(rigidSpillReserved);
      release(prevCompCells); release(curCompCells); release(bodyCells);
      release(reactionFlags); release(reactionSteam); release(reactionFires); release(reactionIgnite);
      release(mineDamage); release(light); release(lightBase); release(skyLight);
      release(skyTopInput); release(skyDownValue); release(skyDownDepth);
      release(stoneComponents); release(plantComponents); release(iceComponents);
      release(looseDirtyCol); release(looseColCount); release(groundRigidBase);
      release(groundBaseFlags); release(crossBondedComp); release(bodyOwner); release(renderPixels);
      release(compAdjPairs);
    }
    alloc(newCols, newRows, newChunkCols, newChunkRows, storageRole);
    stoneComponents.clear(); plantComponents.clear(); iceComponents.clear();
    nextStoneId = nextPlantId = nextIceId = 1;
    myceliumActive = false;
    groundDirty = true; groundSawPowder = false; groundContentDirty = true;
    looseGroundDirty = true; looseDirtyX0 = 0; looseDirtyX1 = -1;
    looseDirtyCol.assign(newCols, 0); looseDirtyFull = true;
    groundStreamX0 = groundStreamX1 = groundStreamY0 = groundStreamY1 = -1;
    groundBaseValid = false;
    bodies.clear(); bodyCells.clear();
    pendingDetonations.clear();
    blastLocalCarryTicks = 0;
    prevCompCells.clear(); curCompCells.clear();
    mineDamageAny = false;
    dirtyRenderCount = 0;
  }
  // Resize a presentation-only layer while preserving every overlapping
  // absolute-world cell. Newly exposed space stays transparent until the
  // authority's full snapshot arrives; the already-visible world never blanks
  // during that handoff.
  void resizePresentation(int oldCols, int oldRows, int newCols, int newRows,
                          int newChunkCols, int newChunkRows,
                          int oldOffX, int oldOffY, int newOffX, int newOffY) {
    std::vector<uint8_t> oldGrid = std::move(gridA);
    gridA.assign((size_t)newCols * newRows, EMPTY);
    int wx0 = imax(oldOffX, newOffX), wy0 = imax(oldOffY, newOffY);
    int wx1 = imin(oldOffX + oldCols, newOffX + newCols);
    int wy1 = imin(oldOffY + oldRows, newOffY + newRows);
    if (wx1 > wx0 && wy1 > wy0) {
      size_t width = (size_t)(wx1 - wx0);
      for (int wy = wy0; wy < wy1; wy++) {
        size_t src = (size_t)(wy - oldOffY) * oldCols + (wx0 - oldOffX);
        size_t dst = (size_t)(wy - newOffY) * newCols + (wx0 - newOffX);
        memcpy(gridA.data() + dst, oldGrid.data() + src, width);
      }
    }
    gridB.clear(); grid = gridA.data(); next = grid;
    size_t n = (size_t)newCols * newRows;
    if (n < light.size()) {
      auto release = [](auto& v) { std::decay_t<decltype(v)>().swap(v); };
      release(dirtyRender); release(dirtyRects); release(rowMarkMin); release(rowMarkMax);
      release(light); release(lightBase); release(skyLight); release(skyTopInput);
      release(skyDownValue); release(skyDownDepth); release(renderPixels);
    }
    dirtyRender.assign((size_t)newChunkCols * newChunkRows, 0);
    dirtyRects.clear(); rowMarkMin.assign(newRows, newCols); rowMarkMax.assign(newRows, -1);
    light.assign(n, 0); lightBase.assign(n, 0); skyLight.assign(n, 0); skyTopInput.assign(newCols, 0);
    skyDownValue.assign(newCols, 0); skyDownDepth.assign(newCols, -1);
    renderPixels.assign(n * 4, 0);
    skyDirty = true; skyValid = false; dirtyRenderCount = 0;
  }
  ~Layer() {
    for (Body* b : bodies) delete b;
    for (auto& kv : bodyStore) for (auto& e : kv.second) delete e.first;
  }
};
