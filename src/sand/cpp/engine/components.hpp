#pragma once
// Grid-aligned stone/plant/ice components (extracted from the Engine in 5f):
// the grounding floods (full + incremental with the cut-vertex fast path), the
// two-layer coupled grounding + cross-layer bonds, ungrounded-assembly movement
// with volume-preserving fluid/powder displacement, component registration
// (seeded floods), and the split-after-erase reconciliation. Owns the entire
// cg* grounding cache. DETERMINISM: assembly movement draws from the shared
// rand() stream — order is part of the sim contract. Method bodies live in
// components_impl.inc.

struct Engine;

// Side/bottom face contact of a cell set against a grid (top faces excluded on
// purpose: top liquid never creates support/lift).
struct FaceContact {
  int faces = 0, liquidFaces = 0, bottomLiquidFaces = 0, powderFaces = 0, bottomPowderFaces = 0;
  double liquidDensityArea = 0, powderDensityArea = 0;
};


class ComponentSystem {
 public:
  explicit ComponentSystem(Engine& e) : E(e) {}

  // ---- grounding cache + scratch (moved off the Engine) ----
  bool jointGroundReady = false;
  bool jointBondsInvalid = false;
  // Reusable scratch for computeGroundedBoth() (sized to cols*rows once).
  std::vector<uint8_t> cgPrevFg, cgPrevBg, cgFgBase, cgBgBase, cgVisited;
  std::vector<int> cgStack, cgIsland;
  // Parallel x-coordinate stack for computeGrounded's flood.
  std::vector<int32_t> groundStackX;
  // Per-layer BASE-grounding reuse cache; valid iff cg*BaseValid.
  std::vector<uint8_t> cgFgGroundedBase, cgBgGroundedBase;
  bool cgFgBaseValid = false, cgBgBaseValid = false;
  // cellComp index -> Comp* map + mean densities (rebuilt by indexComponents()).
  std::vector<Comp*> cgComps;
  std::vector<double> cgCompDensity;
  // Incremental-grounding diagnostics (engine_test_ grounding ABI).
  bool groundVerify = false;
  bool groundForceFull = false;
  long groundMismatches = 0;
  long gbEdge = 0, gbPowder = 0, gbCut = 0, gbSpan = 0, gbFast = 0;
  std::vector<uint8_t> gvGrounded;
  std::vector<int32_t> gvCellComp;
  std::vector<int> cgRemovedCells, cgBlobN, cgRemovedComp;
  struct CrossLayerBond { int fgComp = -1, bgComp = -1; bool supportsGround = false; };
  std::vector<CrossLayerBond> cgBonds;
  std::vector<int> cgParent, cgGroundParent, cgWorkQueue, cgCompStamp;
  int32_t cgCompGen = 0;
  // Membership mirrors for the assembly-displacement planning path (Phase 6).
  // The real unordered_sets are kept wherever their ITERATION order feeds cell
  // writes or FP sums; these only replace the .count() hashing.
  StampSet asmCells;                          // current assembly's cell set (translateAssembly / accumulateFaceContact)
  StampSet trMoved, trVacated, trReserved, trSeen; // translateAssembly relocation planning
  StampSet regCells, regOwnerStamp;           // registerRigidCells: input-set membership + lazy owner map validity
  std::vector<int32_t> regOwnerVal;           // owner comp index, valid where regOwnerStamp.has(k)
  uint8_t floodTargetMat = 0; // set before a per-material stone flood

  void indexComponents();
  void computeRigidGrounded();
  void applyLooseOverlay();
  void computeGrounded();
  void incrementalGroundingRefresh();
  void ensureGroundedSingleLayer();
  bool blobBoundaryReconnects(const std::vector<int>& boundary, int32_t inN, int x0, int y0, int x1, int y1, int32_t removedGen);
  bool blobKeepsGroundingValid(const std::vector<int>& blob);
  bool removalsKeepGroundingValid(const std::vector<int>& removed);
  int compCount(Layer& lay);
  void unionCrossBondedClusters(std::vector<int>& parent, std::vector<int>* groundParent, int nf, int nb);
  void groundLayerBase(Layer* lay, std::vector<uint8_t>& baseCache, bool& baseValid, std::vector<uint8_t>& gbCache);
  void wakeCellsThatLostGrounding(Layer& lay, const std::vector<uint8_t>& prev);
  void computeGroundedBoth();
  Comp* compById(Layer& lay, int id);
  bool compIdIsPlant(Layer& lay, int id);
  void accumulateFaceContact(const uint8_t* g, const std::unordered_set<int>& cells, FaceContact& c);
  void moveCrossLayerBondedAssemblies();
  void moveRigidAssemblies();
  bool isFloodTargetMat(uint8_t m);
  bool isIceGroup(uint8_t m);
  bool isPlantMat(uint8_t m);
  void registerSeededComponents(int colStart, int colEnd);
  void registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd);
  void registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache);
  void registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax);
  void registerRigidCellsSplit(std::vector<Comp>& list, int& nextId, uint8_t mat,
                               std::unordered_set<int>& cells, bool iceCache);
  void splitPlantAfterErase();
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache, bool markGroundDirty = true);
  void floodComponent(int sx, int sy, std::vector<int32_t>& seen, int32_t gen, bool bounded, std::vector<int>& outCells, int& outYMax, bool (ComponentSystem::*matCheck)(uint8_t));

 private:
  Engine& E;
};
