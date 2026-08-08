#pragma once
// Static component membership, grounding, splitting, and body detachment.

struct Engine;

enum class ConnectivitySplitMode : uint8_t {
  FULL,        // rebuild every surviving connected piece
  LOCAL_EXACT, // preserve only when the touched component remains connected
};

// Side/bottom face contact of a cell set against a grid (top faces excluded on
// purpose: top liquid never creates support/lift).
struct FaceContact {
  int faces = 0, liquidFaces = 0, bottomLiquidFaces = 0, bottomPowderFaces = 0, openAirFaces = 0;
  int bearingFaces = 0;
  double liquidDensityArea = 0, bottomPowderDensityArea = 0;
  double displacedArea = 0, displacedLiquidMass = 0;
};


class ComponentSystem {
 public:
  explicit ComponentSystem(Engine& e) : E(e) {}

  // One downward powder-contact cell bears this many cell-depths of material
  // at the powder's density. This keeps small light solids on the surface while
  // allowing a tall/concentrated load to overload the same footprint.
  static constexpr double GRANULAR_BEARING_DEPTH = 5.0;

  // ---- grounding cache and scratch ----
  bool jointGroundReady = false;
  bool jointBondsInvalid = false;
  // Foreground body baking can register new static components in both layers
  // before the background layer moves. Refresh their shared component index and
  // support closure first so the background never classifies those new pieces
  // from stale layer-local topology.
  bool jointBakeNeedsGroundRefresh = false;
  // Fire completes component membership cleanup immediately, but may defer the
  // expensive joint-graph rebuild to the start of the next tick.
  bool jointDirtyDeferred = false;
  // Persistent validity of the settled rigid joint-support closure currently
  // stamped into both layers. With no residual unsupported bonds, loose motion
  // cannot change this closure (loose cells do not ground rigid cells), so
  // pure-loose ticks refresh dirty columns without rebuilding the joint graph.
  bool jointSupportValid = false;
  bool jointSupportSleeping = false;
  bool jointSleepBlocked = false;
  // Sticky: bonds were invalidated (acid/erase/split) and computeGroundedBoth
  // must run on the next step even if the acid pure-bore path left groundDirty
  // and groundContentDirty false and cleared cgBonds. Without this, the joint
  // pass can skip, ensureGroundedSingleLayer re-grounds without cross-layer
  // support, and a held beam creeps down one cell at a time until co-occupation
  // is lost and it free-falls.
  // NOTE: invalidation must NOT clear jointGroundReady mid-step — the other
  // layer may still need this tick's joint grounded flags for moveRigidAssemblies.
  bool jointDirty = false;
  // Reusable scratch for computeGroundedBoth() (sized to cols*rows once).
  std::vector<uint8_t> cgPrevFg, cgPrevBg, cgVisited;
  std::vector<int> cgStack, cgIsland;
  // Parallel x-coordinate stack for computeGrounded's flood.
  std::vector<int32_t> groundStackX;
  // cellComp index -> Comp* map (rebuilt by indexComponents()).
  std::vector<Comp*> cgComps;
  // Incremental-grounding diagnostics (engine_test_ grounding ABI).
  bool groundVerify = false;
  bool groundForceFull = false;
  long groundMismatches = 0;
  long gbEdge = 0, gbPowder = 0, gbCut = 0, gbCutCap = 0, gbCutOpen = 0, gbSpan = 0, gbFast = 0;
  std::vector<uint8_t> gvGrounded;
  std::vector<int32_t> gvCellComp;
  std::vector<int> cgRemovedCells, cgBlobN, cgRemovedComp;
  struct CrossLayerBond { int fgComp = -1, bgComp = -1; bool supportsGround = false; };
  std::vector<CrossLayerBond> cgBonds;
  std::vector<int> cgParent, cgGroundParent, cgWorkQueue, cgCompStamp;
  std::vector<int> cgAdjCounts;
  std::vector<uint64_t> cgAdjScratch;
  std::vector<int32_t> cgBondSeenFg, cgBondSeenBg;
  std::vector<std::vector<int>> cgBondCandidatesFg, cgBondCandidatesBg;
  int32_t cgCompGen = 0;
  // Membership mirrors for assembly contact probes.
  // The real unordered_sets are kept wherever their ITERATION order feeds cell
  // writes or FP sums; these only replace the .count() hashing.
  StampSet asmCells;                          // current assembly's cell set
  StampSet detachVisited;
  StampSet asmExterior;
  std::vector<uint8_t> asmExteriorValue;
  std::vector<int> asmExteriorRegion;
  std::vector<int> asmAirFaces;
  StampSet asmOpenAir;
  std::vector<uint8_t> asmOpenAirValue;
  std::vector<int> asmOpenAirPath;
  StampSet regCells, regOwnerStamp;           // registerRigidCells: input-set membership + lazy owner map validity
  std::vector<int32_t> regOwnerVal;           // owner comp index, valid where regOwnerStamp.has(k)
  std::vector<uint8_t> splitTouched;           // acid split: indexed touched-component mask
  StampSet splitMembers, splitRemovedSet;      // local no-cut proof + batch erased membership
  std::vector<int> splitSurvivors, splitErased, splitBlob, splitPart, splitBoundary; // split + local-proof reusable queues
  std::vector<Comp> splitUpdated;              // avoids rebuilding list capacity per bite
  uint8_t floodTargetMat = 0; // set before a per-material chunk-bounded flood

  void prepareAssemblyScratch(size_t gridLen);

  bool isKestrelFrameAnchor(const Layer& lay, int x, int y) const;
  void indexComponents();
  bool patchComponentIndexAdditions();
  void computeStaticGraphGrounded();
  void computeRigidGrounded(bool reuseComponentIndex = false);
  void applyLooseOverlay();
  void refreshLooseOverlayPreservingJoint(Layer* lay);
  void normalizeDeferredConnectivity();
  void computeGrounded();
  void incrementalGroundingRefresh();
  void ensureGroundedSingleLayer();
  bool blobBoundaryReconnects(const std::vector<int>& boundary, int32_t inN, int x0, int y0, int x1, int y1, int32_t removedGen);
  bool blobBoundaryRegionsStayGrounded(const std::vector<int>& boundary, int32_t removedGen);
  bool blobKeepsGroundingValid(const std::vector<int>& blob);
  bool removalsKeepGroundingValid(const std::vector<int>& removed);
  int compCount(Layer& lay);
  void unionCrossBondedClusters(std::vector<int>& parent, std::vector<int>* groundParent, int nf, int nb);
  void groundLayerBase(Layer* lay);
  void wakeCellsThatLostGrounding(Layer& lay, const std::vector<uint8_t>& prev);
  void computeGroundedBoth();
  Comp* compById(Layer& lay, int id);
  bool compIdIsPlant(Layer& lay, int id);
  template <class Cells>
  void accumulateFaceContact(const uint8_t* g, const Cells& cells, FaceContact& c,
                             bool collectBearing = false);
  int motionDecision(const FaceContact& c, size_t cellCount, double solidMass);
  void detachComponentGroups(Layer& lay, const std::vector<std::vector<int>>& groups);
  void detachCrossLayerComponentGroups(
    const std::vector<std::pair<std::vector<int>, std::vector<int>>>& groups);
  void patchStableComponentTopology(Layer& lay, const std::vector<int>& changedSlots);
  void trimTrailingComponentTombstones(Layer& lay);
  void splitRigidAfterBlast(const std::vector<int>& erased);
  void markBreakCandidates();
  void moveCrossLayerBondedAssemblies();
  void moveRigidAssemblies();
  bool isFloodTargetMat(uint8_t m);
  bool isIceMat(uint8_t m);
  bool isPlantMat(uint8_t m);
  void registerSeededComponents(int colStart, int colEnd);
  void registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd);
  void registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache);
  void registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax);
  void registerRigidCellsSplit(std::vector<Comp>& list, int& nextId, uint8_t mat,
                               std::unordered_set<int>& cells, bool iceCache);
  void registerBakedCells(uint8_t mat, const std::vector<int>& cells,
                          int assemblyId, bool iceCache, bool looseSupport,
                          uint8_t plantType = PT_OAK);
  bool componentRemovalLocallyConnected(const std::vector<int>& erased, const std::vector<int>& survivors, int indexedComp = -1);
  bool finishFocusedStaticErosion(const std::vector<int>& erased);
  void splitPlantAfterErase(std::vector<int>* erased = nullptr, int indexedOffset = -1, bool markGroundDirty = true, bool localConnectivityFastPath = false, bool deferJointRefresh = false);
  void finishPlantErosion(std::vector<int>& erased, bool indexedExact, bool deferJointRefresh = false);
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId,
                            bool iceCache, bool markGroundDirty = true, int indexedOffset = -1,
                            ConnectivitySplitMode splitMode = ConnectivitySplitMode::FULL);
  void floodComponent(int sx, int sy, std::vector<int32_t>& seen, int32_t gen, bool bounded, std::vector<int>& outCells, int& outYMax, bool (ComponentSystem::*matCheck)(uint8_t));

 private:
  bool isGroundingRigidCell(const Layer& lay, int k) const;
  Engine& E;
};
