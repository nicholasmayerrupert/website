#pragma once
#include <box2d/box2d.h>
// Free rigid-body collision, buoyancy, sleep, erosion, and component baking.
// Bodies stamp their real material into their owning Layer.

struct Engine;

// One displaced loose cell (material + source index) pending relocation.
struct Disp { uint8_t material; int from; };

class RigidBodySystem {
 public:
  explicit RigidBodySystem(Engine& e) : E(e) {}
  ~RigidBodySystem();
  static constexpr size_t SPILL_GENERATION_BUDGET =
    (size_t)(TABLE + 4) * TABLE + 2;

  // Diagnostics (engine_test_ rigid ABI).
  int rigidRejectedCells = 0, rigidDepenetrations = 0;
  int rigidOwnershipConflicts = 0;
  int rigidRecoveryBodies = 0;
  int rigidPositionCorrections = 0;
  int rigidRasterCorrections = 0, rigidRasterProjectionFailures = 0;
  double rigidRasterMaxCorrection = 0;
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
  void ensureBodyRaster(Body* b);
  template <class F> void forEachBodyCell(Body* b, F cb);

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
  bool bodyFullyInsideLoadedWindow(Body* b) const;
  void resetSleepTracking(Body* b);
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
  bool bodyTouchesStaticSupport(Body* b);
  bool bodyHasLooseSupport(Body* b);
  double granularBearingFraction(Body* b, Layer& layer);
  bool rasterStableForBake(Body* b);
  void stampJointFollower(Body* leader);
  void restampBodiesAfterStream();
  void bakeRestingBodies();
  void resolveStructureRasterOverlaps();
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
  static constexpr float BOX_METERS_PER_CELL = 0.1f;
  static constexpr float BOX_TICK_SECONDS = 1.0f / 60.0f;
  enum BoxCategory : uint64_t {
    BOX_FG_TERRAIN = 1ull << 0,
    BOX_BG_TERRAIN = 1ull << 1,
    BOX_FG_BODY = 1ull << 2,
    BOX_BG_BODY = 1ull << 3,
    BOX_JOINT_BODY = 1ull << 4,
    BOX_ACTOR = 1ull << 5,
  };
  struct BoxBodyBinding {
    b2BodyId id = b2_nullBodyId;
    int bodyId = 0;
    uint32_t geometryRevision = 0;
    uint8_t layer = 0;
    uint8_t jointRole = 0;
    double px = 0, py = 0, angle = 0;
    double vx = 0, vy = 0, omega = 0;
  };
  struct BoxTerrainRect { int x0 = 0, y0 = 0, x1 = 0, y1 = 0; };
  struct BoxActorBinding {
    b2BodyId id = b2_nullBodyId;
    Player* player = nullptr;
    Creature* creature = nullptr;
  };
  b2WorldId boxWorld = b2_nullWorldId;
  std::array<b2BodyId, 2> boxTerrainBodies{{b2_nullBodyId, b2_nullBodyId}};
  std::array<uint64_t, 2> boxTerrainRevisions{{0, 0}};
  std::unordered_map<Body*, BoxBodyBinding> boxBodies;
  std::unordered_set<Body*> boxWetBodies;
  std::unordered_set<Body*> boxFluidRestBodies;
  std::unordered_set<Body*> boxFluidDensityBodies;
  std::unordered_set<Body*> boxGranularBodies;
  std::unordered_map<Body*, int> boxGranularQuietTicks;
  std::unordered_map<Body*, double> boxFluidSlip;
  std::vector<b2ContactData> boxContactScratch;
  std::vector<BoxActorBinding> boxActors;
  int boxStepTick = -1;
  void resetBox2D();
  void ensureBoxWorld();
  void syncBoxTerrain(Layer& layer, int layerIndex);
  BoxBodyBinding createBoxBody(Body* body, int layerIndex);
  void syncBoxBodies();
  void createBoxActors();
  void finishBoxActors();
  void applyBoxFluidCoupling();
  void writeBackBoxBodies();

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
  std::vector<uint8_t> fluidBodyIceCoupling;
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
  std::vector<int> terrainAdjustmentParents;
  std::vector<int> moveCells, moveFootprint;
  std::vector<int> rasterProjectionOwner, rasterProjectionTouched;
  std::vector<Body*> rasterProjectionBodies;
  std::vector<std::pair<int, int>> rasterProjectionPairs;

  Engine& E;
};
