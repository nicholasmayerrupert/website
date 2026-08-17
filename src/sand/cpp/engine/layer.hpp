#pragma once
// Per-layer grids, dirty state, components, bodies, world stores, and rendering
// buffers. Engine owns foreground and background instances.

#include "reaction_state.generated.hpp"

template <class T>
struct PingPongCellState {
  static_assert(std::is_trivially_copyable<T>::value,
                "persistent cell state must support contiguous copy/shift");
  std::vector<T> phaseA, phaseB;
  T* current = nullptr;
  T* next = nullptr;
  T emptyValue{};

  void allocate(size_t count, T empty) {
    emptyValue = empty;
    phaseA.assign(count, empty);
    phaseB.assign(count, empty);
    current = phaseA.data();
    next = phaseB.data();
  }
  void disable(T empty) {
    emptyValue = empty;
    phaseA.clear(); phaseB.clear();
    current = next = nullptr;
  }
  void swapBuffers() { std::swap(current, next); }
  void clear() {
    std::fill(phaseA.begin(), phaseA.end(), emptyValue);
    std::fill(phaseB.begin(), phaseB.end(), emptyValue);
  }
  void clearSpan(size_t offset, size_t count) {
    if (!current || offset > phaseA.size() || count > phaseA.size() - offset) return;
    std::fill(current + offset, current + offset + count, emptyValue);
    std::fill(next + offset, next + offset + count, emptyValue);
  }
  void copyCurrentSpan(size_t offset, size_t count, T* output) const {
    if (!current || !output || offset > phaseA.size() || count > phaseA.size() - offset) return;
    std::memcpy(output, current + offset, count * sizeof(T));
  }
  void restoreSpan(size_t offset, size_t count, const T* stored) {
    if (!current || offset > phaseA.size() || count > phaseA.size() - offset) return;
    if (stored) {
      std::memcpy(current + offset, stored, count * sizeof(T));
      std::memcpy(next + offset, stored, count * sizeof(T));
    } else {
      std::fill(current + offset, current + offset + count, emptyValue);
      std::fill(next + offset, next + offset + count, emptyValue);
    }
  }
  bool layoutValid(size_t count, bool currentIsPhaseA) const {
    return phaseA.size() == count && phaseB.size() == count
        && current == (currentIsPhaseA ? phaseA.data() : phaseB.data())
        && next == (currentIsPhaseA ? phaseB.data() : phaseA.data());
  }
  bool disabled() const {
    return phaseA.empty() && phaseB.empty() && current == nullptr && next == nullptr;
  }
  void release() {
    std::vector<T>().swap(phaseA); std::vector<T>().swap(phaseB);
    current = next = nullptr;
  }
};

enum PersistentCellOperation : uint8_t {
  PCSO_STATIONARY = 1u << 0,
  PCSO_MOVE = 1u << 1,
  PCSO_SWAP = 1u << 2,
  PCSO_CROSS_LAYER = 1u << 3,
  PCSO_FORCE_PARK = 1u << 4,
  PCSO_BODY_DISPLACE = 1u << 5,
  PCSO_BODY_MOTION = 1u << 6,
  PCSO_ALL = PCSO_STATIONARY | PCSO_MOVE | PCSO_SWAP | PCSO_CROSS_LAYER
    | PCSO_FORCE_PARK | PCSO_BODY_DISPLACE | PCSO_BODY_MOTION,
};

// One profile entry declares a loose-cell side channel's value type, empty
// value, streamed codec, material predicate, and motion policy. Component and
// body state belongs to their topology records. Loose-cell lifecycle and motion
// paths expand this same list at compile time.
#define SAND_PERSISTENT_CELL_CHANNELS(X) \
  X(fallSpeed, uint8_t, 0, fallSpeedStore, encodeTile, decodeTile, persistentLooseState, PCSO_CROSS_LAYER) \
  X(liquidVel, uint32_t, 0, liquidVelocityStore, encodeVelocityTile, decodeVelocityTile, persistentLiquidState, PCSO_STATIONARY | PCSO_MOVE | PCSO_SWAP | PCSO_CROSS_LAYER | PCSO_BODY_DISPLACE) \
  SAND_REACTION_AGE_CHANNEL(X)

#define SAND_VALIDATE_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
  static_assert(std::is_trivially_copyable<type>::value, #name " state must be trivially copyable"); \
  static_assert(((operations) & ~PCSO_ALL) == 0, #name " has an unknown motion operation");
SAND_PERSISTENT_CELL_CHANNELS(SAND_VALIDATE_CELL_CHANNEL)
#undef SAND_VALIDATE_CELL_CHANNEL

struct PersistentCellSnapshot {
#define SAND_DECLARE_CELL_SNAPSHOT(name, type, empty, store, encode, decode, accepts, operations) \
  type name = (type)(empty);
  SAND_PERSISTENT_CELL_CHANNELS(SAND_DECLARE_CELL_SNAPSHOT)
#undef SAND_DECLARE_CELL_SNAPSHOT
};

struct Layer {
  struct StoredFuse {
    int wx = 0, wy = 0, ticks = 0;
  };
  EngineStorageRole storageRole = ESR_FULL;
  // double buffer + the "current"/"next" pointers (alternate each step)
  std::vector<uint8_t> gridA, gridB; uint8_t* grid = nullptr; uint8_t* next = nullptr;
  // Per-cell downward momentum for powders and liquids. These buffers swap with
  // grid/next, so a loose cell carries its fall speed across world ticks.
  // Packed cell-centered liquid velocity used by the rigid/fluid pressure
  // solve. It moves with liquid cells and remains independent of the cellular
  // automaton's integer fall distance above.
#define SAND_DECLARE_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
  PingPongCellState<type> name; \
  std::unordered_map<int64_t, std::vector<type>> store;
  SAND_PERSISTENT_CELL_CHANNELS(SAND_DECLARE_CELL_CHANNEL)
#undef SAND_DECLARE_CELL_CHANNEL
  // dirty tracking (per-layer active region)
  std::vector<uint8_t> dirtyRender;
  std::vector<int32_t> dirtyRects;
  std::vector<int32_t> chunkStamp, vacatedStamp, assemblyWakeStamp, blastGasStamp;
  // Sorted, merged inclusive spans retain disjoint activity on each row.
  std::vector<std::vector<std::pair<int32_t, int32_t>>> rowMarkSpans,
    simOnlyRowMarkSpans, activeRowSpans;
  // A locally-proven cave blast starts from synchronized buffers (its fuse ticks
  // paid the ordinary full carry). Once proven, gas/rigid-only ticks may keep
  // component carry local until a buffer replacement/stream invalidates the proof;
  // loose support or assembly relocation still selects the full carry path.
  bool blastSparseCarryReady = false;
  // Static component membership changed since the last complete ping-pong
  // carry. The next active layer turn refreshes both buffer membership views.
  bool componentCarryDirty = true;
  int dirtyRenderCount = 0;
  // per-cell sim scratch
  std::vector<uint8_t> groundedCell;
  std::vector<int32_t> cellComp, groundStack;
  // Generation-stamped "seen" scratch for component flood fills. All buffers
  // keyed by seenGen are cleared together before the signed generation wraps.
  std::vector<int32_t> seenStamp; int32_t seenGen = 0;
  // Free rigid-body displacement spill scratch. Footprint and reserved targets
  // must be live at the same time as a BFS seen set, so they use separate stamps.
  std::vector<int32_t> rigidSpillFootprint, rigidSpillReserved;
  std::vector<int> prevCompCells, curCompCells, prevBodyCells, curBodyCells;
  std::vector<int> bodyCells, passiveBodyCells;
  std::vector<uint8_t> reactionFlags;
  std::vector<int32_t> reactionSteam, reactionFires, reactionIgnite;
  // Set when a reaction creates new heat after prepareActiveLists. Existing heat
  // may disappear safely (the candidate is rechecked); newly-created heat needs
  // the ordered active-span scan so TNT can still ignite that same tick.
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
  // Static structural cells share one registry regardless of material. Individual
  // materials still select their own reactions and growth behavior from their
  // exact id/flags; component partitions are only a topology/performance detail.
  std::vector<Comp> components;
  std::vector<int32_t> growingPlantComponents, myceliumComponents, iceComponents;
  std::vector<int32_t> mobileComponents;
  bool componentRegistryDirty = true;
  int nextComponentId = 1;
  bool myceliumActive = false;
  // False proves that no growth-capable spore exists in this loaded layer.
  // It avoids searching every stone cell for dormant spores on ordinary terrain.
  bool myceliumSporePresent = false;
  // Conservative latch for materials that generate spatial force emitters.
  // ForceSystem clears it after rebuilding finds no remaining source.
  bool forceSourcePresent = false;
  bool forceActive = false;
  // Incremental-grounding cache state (see members near cgComps). groundDirty
  // true => the next grounding pass must be a full reflood; it is set true by any
  // component add/move/split/growth/sync.
  // groundContentDirty: a rigid component change that did NOT set groundDirty (the
  // acid fast-path removal) happened since the last grounding pass, so the cached
  // cellComp/groundedCell must be refreshed even though no full reflood is forced.
  // looseGroundDirty: a powder or liquid cell changed since the last successful
  // overlay. Powder grounding depends on the cell below (rigid / denser liquid), so
  // only loose/liquid motion invalidates the overlay — not the mere presence of
  // powder. When groundDirty, groundContentDirty, and looseGroundDirty are all
  // clear (and the rigid base is valid), the cached grounding is the exact
  // grounding of the current grid and the whole pass can be skipped.
  bool groundDirty = true, groundContentDirty = true;
  // Additions to existing components preserve positional ids. Record those
  // exact cells so the next rigid refresh can patch cellComp and local graph
  // edges without re-indexing every loaded component.
  // True exactly when cellComp matches the current stable component slots.
  // Structural cuts and body extraction patch it in place; bulk registration
  // clears the flag until indexComponents runs.
  bool componentIndexExact = false;
  bool componentIndexPatchOnly = false;
  std::vector<std::pair<int32_t, int32_t>> componentIndexPatches;
  bool looseGroundDirty = true;
  // Inclusive column span of powder/liquid writes since the last overlay.
  // looseDirtyX1 < looseDirtyX0 means "unknown / full width" when looseGroundDirty.
  int looseDirtyX0 = 0, looseDirtyX1 = -1;
  // Sparse dirty columns (bitset). When non-empty and not "full", only these
  // columns need base-copy + loose overlay on a pure only-loose refresh.
  // looseDirtyFull forces every column (unknown write site / post-rigid flood).
  std::vector<uint8_t> looseDirtyCol;
  bool looseDirtyFull = true;
  // Rigid-grounding base cache (Perf 7b): groundedCell as of the last fresh
  // computeRigidGrounded (R bits only, taken BEFORE the loose overlay) plus the
  // comp grounded flags in stone|plant|ice order. computeGrounded reuses it
  // (memcpy + overlay) when no rigid mutation or structurally bearing free body
  // is pending. Blast rubble does not participate in grounding.
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
  // A locally-safe edit can retain a positional Comp without immediately
  // rebuilding its canonical flood order. In the global-equivalence mode, its
  // pieces remain connected through neighbouring components while the rigid graph
  // is unchanged. Remember these stable ids and normalize them before the next
  // true topology reflood.
  std::vector<int> deferredSplitIds;
  int componentTombstones = 0;
  std::vector<uint8_t> crossBondedComp;
  // Cached 8-neighbour adjacency between component ids (packed min/max ids).
  // Rebuilt with cellComp in indexComponents; joint grounding reuses it instead
  // of re-walking every component cell on every loose-material tick.
  std::vector<uint64_t> compAdjPairs;
  // The top row and outer columns have directed support rules. A component
  // touching them requires the conservative cell flood.
  bool groundHasDirectedBoundaryComp = false;
  // free rigid bodies + ownership
  std::vector<Body*> bodies; int nextBodyId = 1;
  std::vector<int32_t> bodyOwner;
  // Kinematic halves of cross-layer bodies are stamped into this layer but are
  // simulated by their foreground leader.
  std::unordered_set<int> passiveBodyIds;
  // One-shot wake probe retained across the grounding pass, which consumes the
  // dirty flags that reported a possible change beneath a sleeping body.
  bool sleepingBodySupportDirty = false;
  // Lit static fuse-profile cells count down here (cell -> ticksLeft); moving
  // bodies keep their countdown in Body::fuseTicks.
  std::unordered_map<int, int> pendingDetonations;
  // worldgen / streaming (per-layer terrain + chunk store)
  bool infinite = false;
  bool isBackground = false; // bg = a more-solid backdrop (sparser caves) behind the carved fg
  int worldOffsetX = 0, worldOffsetY = 0; // buffer cell (x,y) maps to world (worldOffsetX+x, worldOffsetY+y)
  uint32_t worldSeed = 0;
  int gSurfBase = 0, gSeaRow = 0, gSoil = 0;
  uint32_t gCaveSeed = 0, gTreeSeed = 0, gPocketSeed = 0;
  // 2D streaming persistence keyed by absolute tile coordinates. Persistent
  // tiles contain changed simulation state; predictive baseline tiles live in a
  // separate, bounded cache and disappear once their target shift is consumed.
  // Payloads use compact RLE when it beats the raw CHUNK*CHUNK bytes.
  std::unordered_map<int64_t, std::vector<uint8_t>> tileStore;
  std::unordered_map<int64_t, std::vector<uint8_t>> prefetchStore;
  std::unordered_map<int64_t, std::vector<StoredCompFragment>> componentStore;
  std::unordered_map<int, StoredCompState> componentStateStore;
  std::unordered_map<int, int> componentFragmentRefs;
  std::unordered_set<int> componentStateGcCandidates;
  std::unordered_set<int64_t> dirtyWorldTiles;
  std::unordered_map<int64_t, std::vector<std::pair<Body*, std::pair<double, double>>>> bodyStore; // tile -> [(body, (worldPx,worldPy))]
  std::unordered_map<int64_t, std::vector<StoredFuse>> fuseStore;
  // render pixels for this layer (cols*rows*4 RGBA)
  std::vector<uint8_t> renderPixels;

  // The material grid and motion state are one ping-pong unit. Keeping their
  // phase change and reset operations here prevents a newly-added side buffer
  // from being omitted at a swap, network replacement, or streamed restore.
  void swapSimulationBuffers() {
    std::swap(grid, next);
#define SAND_SWAP_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) name.swapBuffers();
    SAND_PERSISTENT_CELL_CHANNELS(SAND_SWAP_CELL_CHANNEL)
#undef SAND_SWAP_CELL_CHANNEL
  }

  void clearMotionState() {
#define SAND_CLEAR_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) name.clear();
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CLEAR_CELL_CHANNEL)
#undef SAND_CLEAR_CELL_CHANNEL
  }

  void clearMotionSpan(size_t offset, size_t count) {
    if (offset >= gridA.size()) return;
    count = std::min(count, gridA.size() - offset);
#define SAND_CLEAR_CELL_SPAN(name, type, empty, store, encode, decode, accepts, operations) name.clearSpan(offset, count);
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CLEAR_CELL_SPAN)
#undef SAND_CLEAR_CELL_SPAN
  }

  // A vacated topology raster releases its material, body ownership, and every
  // registered cell-state phase as one operation. Component membership must
  // already be absent at the call site.
  void clearVacatedCellPhases(size_t index) {
    if (!grid || !next || index >= gridA.size()) return;
    grid[index] = next[index] = EMPTY;
#define SAND_CLEAR_VACATED_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (name.current) { \
      name.current[index] = (type)(empty); \
      name.next[index] = (type)(empty); \
    }
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CLEAR_VACATED_CELL_CHANNEL)
#undef SAND_CLEAR_VACATED_CELL_CHANNEL
    if (index < bodyOwner.size()) bodyOwner[index] = -1;
  }

  template <class Shift>
  void shiftPersistentCellState(Shift&& shift) {
    shift(grid, (uint8_t)EMPTY); shift(next, (uint8_t)EMPTY);
#define SAND_SHIFT_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    shift(name.current, name.emptyValue); shift(name.next, name.emptyValue);
    SAND_PERSISTENT_CELL_CHANNELS(SAND_SHIFT_CELL_CHANNEL)
#undef SAND_SHIFT_CELL_CHANNEL
    shift(bodyOwner.data(), (int32_t)-1);
  }

  bool cellBufferLayoutValid(int cols, int rows,
                             int chunkCols, int chunkRows) const {
    const size_t n = (size_t)cols * rows;
    const size_t chunks = (size_t)chunkCols * chunkRows;
    if (gridA.size() != n || grid == nullptr || dirtyRender.size() != chunks
        || rowMarkSpans.size() != (size_t)rows
        || simOnlyRowMarkSpans.size() != (size_t)rows)
      return false;
    const bool renders = storageRole != ESR_AUTHORITY;
    if ((light.size() == n) != renders || (lightBase.size() == n) != renders
        || (skyLight.size() == n) != renders
        || (skyTopInput.size() == (size_t)cols) != renders
        || (skyDownValue.size() == (size_t)cols) != renders
        || (skyDownDepth.size() == (size_t)cols) != renders
        || (renderPixels.size() == n * 4) != renders)
      return false;
    if (storageRole == ESR_PRESENTATION) {
      return gridB.empty() && grid == gridA.data() && next == grid
#define SAND_DISABLED_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
          && name.disabled()
          SAND_PERSISTENT_CELL_CHANNELS(SAND_DISABLED_CELL_CHANNEL)
#undef SAND_DISABLED_CELL_CHANNEL
          ;
    }
    const bool phaseA = grid == gridA.data();
    const bool phaseB = grid == gridB.data();
    if ((!phaseA && !phaseB) || next != (phaseA ? gridB.data() : gridA.data())
#define SAND_INVALID_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
        || !name.layoutValid(n, phaseA)
        SAND_PERSISTENT_CELL_CHANNELS(SAND_INVALID_CELL_CHANNEL)
#undef SAND_INVALID_CELL_CHANNEL
        )
      return false;
    return gridB.size() == n && chunkStamp.size() == chunks
        && activeRowSpans.size() == (size_t)rows
        && vacatedStamp.size() == n && assemblyWakeStamp.size() == n
        && blastGasStamp.size() == n && groundedCell.size() == n
        && cellComp.size() == n && groundStack.size() == n
        && seenStamp.size() == n && rigidSpillFootprint.size() == n
        && rigidSpillReserved.size() == n && reactionFlags.size() == n
        && reactionSteam.size() == n && reactionFires.size() == n
        && reactionIgnite.size() == n && mineDamage.size() == n
        && bodyOwner.size() == n && looseDirtyCol.size() == (size_t)cols;
  }

  template <class T>
  static void releaseBuffer(T& buffer) {
    T().swap(buffer);
  }

  void releaseCellBufferCapacity() {
    releaseBuffer(gridA); releaseBuffer(gridB);
#define SAND_RELEASE_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) name.release();
    SAND_PERSISTENT_CELL_CHANNELS(SAND_RELEASE_CELL_CHANNEL)
#undef SAND_RELEASE_CELL_CHANNEL
    grid = next = nullptr;
    releaseBuffer(dirtyRender); releaseBuffer(dirtyRects);
    releaseBuffer(rowMarkSpans); releaseBuffer(simOnlyRowMarkSpans);
    releaseBuffer(chunkStamp); releaseBuffer(activeRowSpans);
    releaseBuffer(vacatedStamp); releaseBuffer(assemblyWakeStamp);
    releaseBuffer(blastGasStamp); releaseBuffer(groundedCell);
    releaseBuffer(cellComp); releaseBuffer(groundStack);
    releaseBuffer(seenStamp); releaseBuffer(rigidSpillFootprint);
    releaseBuffer(rigidSpillReserved); releaseBuffer(reactionFlags);
    releaseBuffer(reactionSteam); releaseBuffer(reactionFires);
    releaseBuffer(reactionIgnite); releaseBuffer(mineDamage);
    releaseBuffer(light); releaseBuffer(lightBase); releaseBuffer(skyLight);
    releaseBuffer(skyTopInput); releaseBuffer(skyDownValue);
    releaseBuffer(skyDownDepth); releaseBuffer(looseDirtyCol);
    releaseBuffer(groundRigidBase); releaseBuffer(bodyOwner);
    releaseBuffer(renderPixels);
  }

  void reserveSeenGenerations(size_t count) {
    if (count <= (size_t)(INT32_MAX - seenGen)) return;
    std::fill(seenStamp.begin(), seenStamp.end(), 0);
    std::fill(rigidSpillFootprint.begin(), rigidSpillFootprint.end(), 0);
    std::fill(rigidSpillReserved.begin(), rigidSpillReserved.end(), 0);
    seenGen = 0;
  }

  int32_t nextSeenGeneration() {
    if (seenGen == INT32_MAX) {
      std::fill(seenStamp.begin(), seenStamp.end(), 0);
      std::fill(rigidSpillFootprint.begin(), rigidSpillFootprint.end(), 0);
      std::fill(rigidSpillReserved.begin(), rigidSpillReserved.end(), 0);
      seenGen = 0;
    }
    return ++seenGen;
  }

  void alloc(int cols, int rows, int chunkCols, int chunkRows, EngineStorageRole role = ESR_FULL) {
    storageRole = role;
    size_t n = (size_t)cols * rows;
    gridA.assign(n, EMPTY);
    grid = gridA.data();
    dirtyRender.assign((size_t)chunkCols * chunkRows, 0);
    rowMarkSpans.clear(); rowMarkSpans.resize(rows);
    simOnlyRowMarkSpans.clear(); simOnlyRowMarkSpans.resize(rows);
    growingPlantComponents.clear(); myceliumComponents.clear(); iceComponents.clear();
    componentRegistryDirty = true;

    // A presentation mirror receives authoritative grids and only performs
    // camera collision queries, lighting, pixel fill, and GL compositing. Point
    // next at the read-only grid as a defensive fallback for shared query code;
    // presentation code never swaps or writes the cellular next buffer.
    if (role == ESR_PRESENTATION) {
      gridB.clear(); next = grid;
#define SAND_DISABLE_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) name.disable((type)(empty));
      SAND_PERSISTENT_CELL_CHANNELS(SAND_DISABLE_CELL_CHANNEL)
#undef SAND_DISABLE_CELL_CHANNEL
      light.assign(n, 0); lightBase.assign(n, 0); skyLight.assign(n, 0); skyTopInput.assign(cols, 0);
      skyDownValue.assign(cols, 0); skyDownDepth.assign(cols, -1);
      renderPixels.assign(n * 4, 0);
      return;
    }

    gridB.assign(n, EMPTY); next = gridB.data();
#define SAND_ALLOCATE_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) name.allocate(n, (type)(empty));
    SAND_PERSISTENT_CELL_CHANNELS(SAND_ALLOCATE_CELL_CHANNEL)
#undef SAND_ALLOCATE_CELL_CHANNEL
    chunkStamp.assign((size_t)chunkCols * chunkRows, -1);
    activeRowSpans.clear(); activeRowSpans.resize(rows);
    vacatedStamp.assign(n, -1);
    assemblyWakeStamp.assign(n, -1);
    blastGasStamp.assign(n, -1);
    groundedCell.assign(n, 0); cellComp.assign(n, -1); groundStack.assign(n, 0);
    groundRigidBase.clear(); groundBaseFlags.clear(); groundBaseValid = false;
    looseDirtyX0 = 0; looseDirtyX1 = -1;
    looseDirtyCol.assign(cols, 0); looseDirtyFull = true;
    seenStamp.assign(n, 0); seenGen = 0;
    rigidSpillFootprint.assign(n, 0); rigidSpillReserved.assign(n, 0);
    reactionFlags.assign(n, 0); reactionSteam.assign(n, 0); reactionFires.assign(n, 0); reactionIgnite.assign(n, 0);
    mineDamage.assign(n, 0);
    bodyOwner.assign(n, -1);
    sleepingBodySupportDirty = false;
    if (role != ESR_AUTHORITY) {
      light.assign(n, 0); lightBase.assign(n, 0); skyLight.assign(n, 0); skyTopInput.assign(cols, 0);
      skyDownValue.assign(cols, 0); skyDownDepth.assign(cols, -1);
      renderPixels.assign(n * 4, 0);
    }
    skyWorldReachY.clear();
    skyOffsetX = skyOffsetY = 0; skyInputLevel = -1; skyValid = false; skyDirty = true;
  }
  // Reallocate per-cell sim/render arrays for a new buffer size while preserving
  // persistent world stores and worldgen seeds/params (used by resizeLoadedWindow).
  // Callers must have already persisted live buffer content into the stores and
  // emptied bodies/components that were buffer-indexed.
  void reallocSim(int newCols, int newRows, int newChunkCols, int newChunkRows) {
    const size_t newN = (size_t)newCols * newRows;
    if (newN < gridA.size()) {
      // Release capacity after shrink; ordinary growth still reuses allocations.
      auto release = [](auto& v) { std::decay_t<decltype(v)>().swap(v); };
      releaseCellBufferCapacity();
      release(prevCompCells); release(curCompCells); release(prevBodyCells); release(curBodyCells);
      release(bodyCells); release(passiveBodyCells);
      release(components);
      release(growingPlantComponents); release(myceliumComponents); release(iceComponents);
      release(mobileComponents);
      release(deferredSplitIds);
      release(componentIndexPatches);
      release(groundBaseFlags); release(crossBondedComp);
      release(compAdjPairs);
    }
    alloc(newCols, newRows, newChunkCols, newChunkRows, storageRole);
    components.clear();
    growingPlantComponents.clear(); myceliumComponents.clear(); iceComponents.clear();
    mobileComponents.clear();
    componentRegistryDirty = true;
    deferredSplitIds.clear(); componentTombstones = 0;
    nextComponentId = 1;
    myceliumActive = false;
    myceliumSporePresent = false;
    forceSourcePresent = false;
    forceActive = false;
    groundDirty = true; groundContentDirty = true;
    componentIndexExact = false;
    componentIndexPatchOnly = false; componentIndexPatches.clear();
    looseGroundDirty = true; looseDirtyX0 = 0; looseDirtyX1 = -1;
    looseDirtyCol.assign(newCols, 0); looseDirtyFull = true;
    groundBaseValid = false;
    bodies.clear(); bodyCells.clear(); passiveBodyCells.clear(); passiveBodyIds.clear();
    pendingDetonations.clear();
    blastSparseCarryReady = false;
    componentCarryDirty = true;
    prevCompCells.clear(); curCompCells.clear();
    prevBodyCells.clear(); curBodyCells.clear();
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
#define SAND_DISABLE_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) name.disable((type)(empty));
    SAND_PERSISTENT_CELL_CHANNELS(SAND_DISABLE_CELL_CHANNEL)
#undef SAND_DISABLE_CELL_CHANNEL
    size_t n = (size_t)newCols * newRows;
    if (n < light.size()) {
      auto release = [](auto& v) { std::decay_t<decltype(v)>().swap(v); };
      release(dirtyRender); release(dirtyRects); release(rowMarkSpans);
      release(simOnlyRowMarkSpans);
      release(light); release(lightBase); release(skyLight); release(skyTopInput);
      release(skyDownValue); release(skyDownDepth); release(renderPixels);
    }
    dirtyRender.assign((size_t)newChunkCols * newChunkRows, 0);
    dirtyRects.clear();
    rowMarkSpans.clear(); rowMarkSpans.resize(newRows);
    simOnlyRowMarkSpans.clear(); simOnlyRowMarkSpans.resize(newRows);
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
