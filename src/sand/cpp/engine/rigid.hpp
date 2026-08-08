#pragma once
// Free rigid-body collision, buoyancy, sleep, erosion, and component baking.
// Bodies stamp their real material into their owning Layer.

struct Engine;

// One displaced loose cell (material + source index) pending relocation.
struct Disp { uint8_t material; int from; };

class RigidBodySystem {
 public:
  explicit RigidBodySystem(Engine& e) : E(e) {}

  int solverMode = 2;
  double solverResidualTolerance = 1e-4;
  int solverMinIterations = 4;
  int forceFullSolveBodies = R_FORCE_FULL_SOLVE_BODIES;

  // Diagnostics (engine_test_ rigid ABI).
  int rigidRejectedCells = 0, rigidDepenetrations = 0;
  int rigidOwnershipConflicts = 0;
  int rigidRecoveryBodies = 0;
  int rigidPositionCorrections = 0;
  int rigidSubsteps = 0, rigidContacts = 0, rigidWarmStarted = 0;
  int rigidVelocityIterations = 0, rigidBiasIterations = 0;
  int rigidVelocityConstraintEvals = 0, rigidBiasConstraintEvals = 0;
  int rigidShockIslands = 0, rigidShockConstraintEvals = 0;
  int rigidShockFallbacks = 0, rigidShockMaxLayers = 0;
  int rigidShockSkipped = 0;
  int rigidIslands = 0, rigidBlockSolves = 0;
  int rigidIslandBodySteps = 0, rigidGlobalBodySteps = 0;
  int rigidChildPairs = 0, rigidChildManifolds = 0, rigidSweepFallbacks = 0;
  int rigidMaxChildren = 0, rigidChildTransforms = 0;
  int rigidCoherentIslands = 0, rigidDenseFallbackIslands = 0;
  int rigidTerrainRiskBodies = 0, rigidImpactRiskBodies = 0;
  int rigidTerrainSamples = 0, rigidTerrainSamplesSkipped = 0;
  int rigidGranularBodiesSkipped = 0;
  double rigidMaxRelativeSpeed = 0;
  int fluidNodeCount = 0, fluidFaceCount = 0, fluidPressureIterations = 0;
  int fluidCorrectorPasses = 0, fluidCorrectorBodyCount = 0;
  double fluidInitialMs = 0, fluidCorrectorMs = 0;
  double fluidReferenceMs = 0, fluidDomainMs = 0, fluidMatrixMs = 0;
  double fluidSolveMs = 0, fluidWritebackMs = 0;
  double rigidCoreMs = 0, rigidClearMs = 0, rigidDepenMs = 0;
  double rigidBakeMs = 0;
  double rigidBakeSupportMs = 0, rigidBakeRasterMs = 0;
  double rigidBakeRegisterMs = 0;
  int rigidBakedCells = 0;
  double rigidStampMs = 0, rigidSpillMs = 0;
  double rigidPrepareMs = 0, rigidFinalizeMs = 0;
  double rigidContactMs = 0, rigidSolveMs = 0;
  double rigidPairContactMs = 0, rigidTerrainContactMs = 0;
  double rigidMotionPrepMs = 0, rigidIntegrateMs = 0;
  double rigidStepPrepareMs = 0, rigidContactSetupMs = 0;
  double rigidStepFinalizeMs = 0;
  double rigidOccupancyBuildMs = 0, rigidCadenceMs = 0;
  double rigidFluidCoupleMs = 0;
  double rigidFluidReferenceTotalMs = 0, rigidFluidDomainTotalMs = 0;
  double rigidFluidMatrixTotalMs = 0, rigidFluidSolveTotalMs = 0;
  double rigidFluidWritebackTotalMs = 0;
  int rigidFluidNodesTotal = 0, rigidFluidFacesTotal = 0;
  int rigidFluidIterationsTotal = 0, rigidFluidDryReferencesSkipped = 0;
  int rigidSpillDisplaced = 0, rigidSpillVisits = 0, rigidSpillSearches = 0;
  double rigidMaxContactDepth = 0;
  double rigidMaxVelocityResidual = 0, rigidMaxBiasResidual = 0;
  double rigidMaxPenetrationResidual = 0;
  void clearContactCaches();
  // Scratch for per-body bottom-edge support probes: membership
  // stamp + cell list replacing a per-call unordered_set (the probes only sum
  // integer counters, so iteration order is irrelevant).
  StampSet occStamp;
  std::vector<int> occCells;
  // Body erosion connectivity and ownership repair use dense generation stamps
  // because every key is already a loaded-grid cell index.
  StampSet splitMemberStamp, splitVisitedStamp;
  StampSet splitWasBodyStamp, splitClaimedStamp;
  // Body-cell erosion probabilities match static reaction rates.
  static constexpr double RIGID_LAVA_ERODE_P = 0.12; // = ACID_DISSOLVE_P
  static constexpr double RIGID_FIRE_ERODE_P = 0.11; // = FIRE_SPREAD_P

  // Rasterize a body's occ mask to world cells (bodies in impl; instantiated there).
  template <class F> void forEachBodyCell(Body* b, F cb);

  void worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy);
  bool computeDerived(Body* b, bool preserveWorld);
  Body* spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density);
  Body* spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, const std::vector<uint8_t>& materials);
  Body* spawnJointBodyImpl(const std::vector<std::pair<int, int>>& fgCells,
                           const std::vector<uint8_t>& fgMaterials,
                           const std::vector<std::pair<int, int>>& bgCells,
                           const std::vector<uint8_t>& bgMaterials);
  void bindJointBodies(Body* leader, Body* follower, int jointId);
  void unbindJointBodies(Body* leader, Body* follower);
  void freezeCellsOntoBody(Layer& sourceLayer, int sourceBodyId,
                           Layer& targetLayer, const std::vector<int>& cells);
  uint8_t bodyMaterialAt(Body* b, int localIndex);
  void terrainNormalAt(Body* b, int cx, int cy, double bodyDensity, double& ox, double& oy);
  int insideBodyIndex(Body* b, double wx, double wy);
  void bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy);
  // Return the total |impulse| applied, so the solver loops can early-exit the
  // moment an iteration is a provable no-op (all-zero applied impulses leave
  // every velocity bitwise unchanged, so every later iteration recomputes the
  // same zeros — breaking there is bit-identical to running all iterations).
  double resolveContact(Contact& c);
  double resolveContactNormal(Contact& c);
  double resolveContactFriction(Contact& c);
  double resolveContactBlock(Contact& first, Contact& second);
  void applyWarmStart(Contact& c);
  double resolveBias(Contact& c);
  bool bodyFullyInsideLoadedWindow(Body* b) const;
  void wakeBody(Body* b);
  void wakeBodiesTouchingCells(
    Layer& layer, const std::vector<std::pair<int, int>>& cells);
  void syncJointFollower(Body* leader);
  void breakJointBody(Body* member);
  bool coupleLiquids(const std::vector<Body*>& bodies, double dt);
  void rigidStep(double tickDt);
  int localCellAt(Body* b, double wx, double wy);
  bool eraseLocalCell(Body* b, int idx);
  bool isBodyTerrain(Body* b, int x, int y, double bodyDensity);
  double granularMediumDensityAt(int x, int y);
  bool isBodyRelocatable(uint8_t m, int k, double bodyDensity);
  bool canBodyOccupy(uint8_t m, int k, double bodyDensity);
  void spillDisplacedBodyMaterial(std::vector<Disp>& displaced,
                                  const std::vector<int>& edgeFootprint,
                                  int32_t footprintGen, int bodyId,
                                  double bodyDensity,
                                  const std::vector<int>* vacated = nullptr);
  double rigidErodeProbabilityAt(int k);
  bool eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty);
  void finishErasedBodies(std::unordered_set<Body*>& dirty, std::vector<int>& cells,
                          bool splitJointBodies = true);
  void finishErasedJointBodies(const std::unordered_set<Body*>& dirty);
  void erodeBodies(std::vector<int>& cells);
  int bodyFootprintBlocked(Body* b);
  bool bodyFootprintOverlapsSolid(Body* b);
  int bodyTerrainBlocked(Body* b);
  bool sleepingBodyTouchesMovingLiquid(Body* b);
  bool sleepingBodyHasSupport(Body* b, double probe);
  bool findTerrainClearAdjustment(Body* b, double& dx, double& dy);
  void bakeBodyToGrid(Body* b, int assemblyId);
  bool bodySolidifies(Body* b);
  bool bodyTouchesGroundedSolid(Body* b);
  bool bodyTouchesSettledLooseComponent(Body* b);
  bool bodyHasLooseSupport(Body* b);
  bool rasterStableForBake(Body* b);
  void stampJointFollower(Body* leader);
  void restampBodiesAfterStream();
  void bakeRestingBodies();
  void moveBodies();
  void collectPlacementTouchingBodyIds(
    const std::vector<std::pair<int, int>>& cells,
    std::unordered_set<int>& touchingIds);
  bool anchorPlacementToStatic(
    const std::vector<std::pair<int, int>>& cells, uint8_t material,
    uint8_t plantType);
  Body* finishSpawn(const std::vector<std::pair<int, int>>& cells, uint8_t material,
                    bool attachTouchingBodies = true);
  Body* spawnBody(const std::vector<std::pair<int, int>>& cells);
  Body* spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material);
  Body* spawnDisc(int cx, int cy, int radius, uint8_t material);

 private:
  struct ContactCacheKey {
    int aId = -1, bId = -1;
    int childA = -1, childB = -1, featureA = -1, featureB = -1;
    uint32_t aRevision = 0, bRevision = 0;
    uint8_t normalBucket = 0, bLayer = 0;
    uint8_t retainMissed = 0; // pair metadata, not key identity
    bool operator==(const ContactCacheKey& other) const {
      return aId == other.aId && bId == other.bId
          && childA == other.childA && childB == other.childB
          && featureA == other.featureA && featureB == other.featureB
          && aRevision == other.aRevision && bRevision == other.bRevision
          && normalBucket == other.normalBucket && bLayer == other.bLayer;
    }
  };
  struct ContactCacheKeyHash {
    size_t operator()(const ContactCacheKey& key) const {
      size_t h = (uint32_t)key.aId * 0x9e3779b1u;
      h ^= (uint32_t)key.bId + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= (uint32_t)key.childA + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= (uint32_t)key.childB + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= (uint32_t)key.featureA + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= (uint32_t)key.featureB + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= key.aRevision + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= key.bRevision + 0x9e3779b9u + (h << 6) + (h >> 2);
      h ^= (size_t)key.normalBucket << 1;
      h ^= (size_t)key.bLayer << 5;
      return h;
    }
  };
  struct CachedContact {
    double lax = 0, lay = 0, lbx = 0, lby = 0;
    double nx = 0, ny = 0, jn = 0, jt = 0, dt = 1;
    uint8_t age = 0;
    bool used = false;
  };
  using ContactCache = std::unordered_map<
    ContactCacheKey, std::vector<CachedContact>, ContactCacheKeyHash>;
  std::array<ContactCache, 2> contactCaches;
  std::array<std::unordered_map<uint64_t, int>, 2> impactContactTicks;
  struct PairAxisState {
    uint32_t aRevision = 0, bRevision = 0;
    double nx = 0, ny = 0;
    uint8_t age = 0;
  };
  std::array<std::unordered_map<uint64_t, PairAxisState>, 2> pairAxes;
  struct ShockAttemptState {
    uint8_t consecutiveFailures = 0;
    int retryTick = 0, lastTick = 0;
  };
  std::unordered_map<uint64_t, ShockAttemptState> shockAttemptCache;
  std::vector<std::vector<int>> shockGraphScratch, shockLayersScratch;
  std::vector<uint8_t> shockTerrainRootScratch, shockTopIsAScratch;
  std::vector<uint8_t> shockOnStackScratch;
  std::vector<int> shockBottomScratch, shockIndexScratch, shockLowScratch;
  std::vector<int> shockStackScratch, shockComponentScratch;
  std::vector<int> shockLevelScratch, shockBodyLevelScratch;
  std::vector<std::array<double, 3>> shockDeferredScratch;
  ContactCache nextContactCacheScratch;
  std::vector<Contact> solverContactScratch;
  std::vector<int> broadphaseOrderScratch;
  std::vector<std::pair<int, int>> broadphasePairScratch;
  std::array<std::vector<int>, 2> broadphaseBodyIds;
  std::vector<uint8_t> terrainRigidBins;
  std::vector<uint8_t> terrainGranularBins;
  int terrainRigidBinCols = 0, terrainRigidBinRows = 0;

  struct FluidNode {
    Layer* layer = nullptr;
    int cell = -1, component = -1, sourceBody = -1;
    uint8_t material = EMPTY;
    double vx = 0, vy = 0, pressure = 0;
    double residual = 0, direction = 0;
  };
  struct FluidSeed {
    int packedCell = -1, body = -1;
  };
  enum FluidFaceKind : uint8_t {
    FF_INTERNAL,
    FF_AIR,
    FF_STATIC,
    FF_DOMAIN,
    FF_BODY
  };
  struct FluidFace {
    int a, b, body;
    int8_t nx, ny;
    double rx, ry, predicted;
    FluidFaceKind kind;
    double boundaryPressure = 0, inverseDensity = 0;
  };
  struct FluidOperatorFace {
    int a, b;
    double inverseDensity;
  };
  struct FluidBodyOperatorFace {
    int a, body;
    double nx, ny, cross, inverseMass, inverseInertia;
  };
  struct FluidReference {
    int leftX = -1, rightX = -1;
  };
  std::array<std::vector<int32_t>, 2> fluidNodeStamp, fluidNodeIndex;
  std::array<std::vector<int32_t>, 2> fluidBodyStamp, fluidBodyIndex;
  std::array<std::vector<float>, 2> fluidPressureCache;
  std::array<int, 2> fluidPressureWorldX{{INT32_MIN, INT32_MIN}};
  std::array<int, 2> fluidPressureWorldY{{INT32_MIN, INT32_MIN}};
  int32_t fluidNodeGeneration = 0, fluidBodyGeneration = 0;
  std::vector<FluidNode> fluidNodes;
  std::vector<FluidNode> fluidNodeSortScratch;
  std::vector<FluidFace> fluidFaces;
  std::vector<FluidOperatorFace> fluidOperatorFaces;
  std::vector<FluidBodyOperatorFace> fluidBodyOperatorFaces;
  std::vector<FluidReference> fluidReferences;
  std::array<std::vector<double>, 2> fluidReferencePressure;
  std::array<std::vector<uint8_t>, 2> fluidReferenceColumnState;
  std::vector<std::array<int, 4>> fluidBodyBounds;
  std::vector<double> fluidSolvePressure, fluidSolveResidual;
  std::vector<double> fluidSolveDirection, fluidSolveApplied;
  std::vector<double> fluidSolvePreconditioned, fluidSolveDiagonal;
  std::vector<double> fluidSolveFactorDiagonal;
  std::vector<std::array<int, 2>> fluidSolveLower;
  std::vector<std::array<double, 2>> fluidSolveLowerMatrix;
  std::vector<std::array<double, 2>> fluidSolveLowerFactor;
  std::vector<uint8_t> fluidSolveLowerCount;
  std::vector<uint8_t> fluidSolvePinned;
  std::vector<int> fluidQueue, fluidQueueSortScratch, fluidNodeDepth;
  std::vector<FluidSeed> fluidSeeds;
  std::vector<double> fluidRHS;
  std::vector<double> fluidBodyDVX, fluidBodyDVY, fluidBodyDW;
  std::vector<double> fluidBodyMaxSlip;
  std::vector<uint8_t> fluidBodySurface, fluidBodyDensityEquilibrium;
  std::vector<int> moveBodyIds;
  std::unordered_map<int, int> moveBodySlotById;
  struct MovePose {
    double px = 0, py = 0, angle = 0;
  };
  std::vector<MovePose> movePreviousPoses;
  std::vector<std::vector<int>> movePreviousFootprints;
  std::vector<std::vector<Disp>> moveDisplaced;
  std::vector<std::vector<int>> moveStamped;
  std::vector<uint8_t> movePreviousMaterialGrid;
  std::vector<int32_t> movePreviousOwnerGrid;
  std::vector<std::pair<int, int>> terrainContactPairs;
  std::vector<int> terrainAdjustmentParents;
  std::vector<int> moveCells, moveFootprint;

  Engine& E;
};
