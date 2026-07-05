#pragma once
// One simulation layer (foreground or background) — ALL the per-cell state:
// grids, dirty tracking, components, rigid bodies, tile/body stores, lighting
// buffers, render pixels. Hoisted out of the Engine (5c) so the extracted
// subsystem classes (Renderer, TerrainGen, ...) can take Layer* in their
// interfaces. The Engine composes two (fg/bg) plus raw-pointer mirrors of the
// hot indexed buffers (see members.inc).

struct Layer {
  // double buffer + the "current"/"next" pointers (alternate each step)
  std::vector<uint8_t> gridA, gridB; uint8_t* grid = nullptr; uint8_t* next = nullptr;
  // dirty tracking (per-layer active region)
  std::vector<uint8_t> dirtyRender;
  std::vector<int32_t> dirtyRects;
  std::vector<int32_t> rowMarkMin, rowMarkMax, chunkStamp, activeRowMin, activeRowMax, vacatedStamp;
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
  std::vector<uint8_t> reactionFlags;
  std::vector<int32_t> reactionSteam, reactionFires, reactionIgnite;
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
  // component add/move/split/growth/sync and stays true while powder is present
  // (powder grounding depends on liquids that don't route through these hooks).
  // groundSawPowder records whether the last full reflood saw any powder.
  // groundContentDirty: a rigid component change that did NOT set groundDirty (the
  // acid fast-path removal) happened since the last grounding pass, so the cached
  // cellComp/groundedCell must be refreshed even though no full reflood is forced.
  // When it (and groundDirty/powder) are all clear, the cached grounding is still
  // the exact grounding of the current grid and the whole pass can be skipped.
  bool groundDirty = true, groundSawPowder = false, groundContentDirty = true;
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

  void alloc(int cols, int rows, int chunkCols, int chunkRows) {
    size_t n = (size_t)cols * rows;
    gridA.assign(n, EMPTY); gridB.assign(n, EMPTY);
    grid = gridA.data(); next = gridB.data();
    dirtyRender.assign((size_t)chunkCols * chunkRows, 0);
    rowMarkMin.assign(rows, cols); rowMarkMax.assign(rows, -1);
    chunkStamp.assign((size_t)chunkCols * chunkRows, -1);
    activeRowMin.assign(rows, 0); activeRowMax.assign(rows, 0);
    vacatedStamp.assign(n, -1);
    groundedCell.assign(n, 0); cellComp.assign(n, -1); groundStack.assign(n, 0);
    groundRigidBase.clear(); groundBaseFlags.clear(); groundBaseValid = false;
    compOccStamp.assign(n, -1);
    seenStamp.assign(n, 0); seenGen = 0;
    rigidSpillFootprint.assign(n, 0); rigidSpillReserved.assign(n, 0);
    reactionFlags.assign(n, 0); reactionSteam.assign(n, 0); reactionFires.assign(n, 0); reactionIgnite.assign(n, 0);
    mineDamage.assign(n, 0);
    light.assign(n, 0); lightBase.assign(n, 0); skyLight.assign(n, 0); skyTopInput.assign(cols, 0);
    skyDownValue.assign(cols, 0); skyDownDepth.assign(cols, -1);
    skyWorldReachY.clear();
    skyOffsetX = skyOffsetY = 0; skyValid = false; skyDirty = true;
    bodyOwner.assign(n, -1);
    renderPixels.assign(n * 4, 0);
  }
  ~Layer() {
    for (Body* b : bodies) delete b;
    for (auto& kv : bodyStore) for (auto& e : kv.second) delete e.first;
  }
};

