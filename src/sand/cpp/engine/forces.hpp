#pragma once
// Spatial force emitters for materials, free rigid bodies, and mobile actors.

struct Engine;

enum ForceTarget : uint8_t {
  FORCE_POWDER = 1u << 0,
  FORCE_LIQUID = 1u << 1,
  FORCE_RIGID = 1u << 2,
  FORCE_GAS = 1u << 3,
  FORCE_ACTOR = 1u << 4,
};

enum ForceKind : uint8_t {
  FORCE_RADIAL = 0,
  FORCE_DIRECTIONAL = 1,
};

enum ForceLayerTarget : uint8_t {
  FORCE_LAYER_FOREGROUND = 1u << 0,
  FORCE_LAYER_BACKGROUND = 1u << 1,
  FORCE_LAYER_BOTH = FORCE_LAYER_FOREGROUND | FORCE_LAYER_BACKGROUND,
};

struct ForceEmitter {
  double x = 0, y = 0;
  float radius = 0;
  float strength = 0;
  float geometryMinX = 0, geometryMinY = 0;
  float geometryMaxX = 0, geometryMaxY = 0;
  float directionX = 0, directionY = 0;
  uint8_t kind = FORCE_RADIAL;
  uint8_t targets = 0;
  uint8_t repelTargets = 0;
  uint8_t layerTargets = 0;
  int sourceBodyId = -1;
  int sourceBodyLayer = -1;
  int neutroniumCells = 0;
  uint64_t geometryRevision = 0;
  uint64_t signature = 0;
  bool nearestNeutronium = false;
  bool dynamicGeometry = false;
};

class ForceSystem {
 public:
  explicit ForceSystem(Engine& e) : E(e) {}

  // Transient emitters are consumed by the next world step. Actor/projectile
  // systems can queue them before stepWorld without owning any force-grid state.
  void queueRadial(Layer* layer, double x, double y, float radius,
                   float strength, uint8_t targets, uint8_t repelTargets = 0,
                   int sourceBodyId = -1);
  void queueDirectional(Layer* layer, double x, double y, float radius,
                        float strength, float directionX, float directionY,
                        uint8_t targets, uint8_t repelTargets = 0,
                        int sourceBodyId = -1);
  void prepareWorldTick();
  void applyBodyForces();
  bool sampleActor(double x, double y,
                   double& forceX, double& forceY) const;
  bool overridesGravity(int x, int y, uint8_t material);
  bool tryMoveLoose(int x, int y, int k, uint8_t material,
                    bool movementAllowed = true);

 private:
  struct BinLink { int emitter = -1, next = -1; };
  struct GeometryPoint { float x = 0, y = 0; int emitter = -1; };
  struct LayerState {
    std::vector<ForceEmitter> emitters;
    std::vector<GeometryPoint> neutroniumPoints;
    std::vector<int> binHeads;
    std::vector<BinLink> binLinks;
  };
  struct CachedLooseForce {
    double x = 0, y = 0;
    uint32_t serial = 0;
    uint8_t target = 0;
    bool active = false;
  };
  struct LooseForceCache {
    std::vector<int32_t> binOffsets;
    std::vector<CachedLooseForce> cells;
  };
  struct NeutroniumSeed {
    float x = 0, y = 0;
    int gridX = 0, gridY = 0;
    int sourceLayer = 0, emitter = -1;
  };
  struct NeutroniumKdNode {
    int seed = -1, left = -1, right = -1, bestDominanceSeed = -1;
    float minX = 0, minY = 0, maxX = 0, maxY = 0;
  };

  Engine& E;
  LayerState states[2];
  std::vector<ForceEmitter> queued[2];
  std::array<std::array<double, 256>, 2> looseMinForce = {};
  static constexpr int LOOSE_QUADRANT_COUNT = TABLE * 4;
  std::array<uint32_t, LOOSE_QUADRANT_COUNT> looseQuadrantCounts = {};
  std::array<std::array<uint32_t, TABLE>, 2> looseCoverageTotals = {};
  std::array<std::array<uint64_t, TABLE>, 2> looseBestImbalance = {};
  std::array<uint8_t, 2> looseCoverageStagnantTicks = {};
  std::array<uint16_t, 2> looseForceAge = {};
  std::array<bool, 2> looseCoverageValid = {};
  std::array<bool, 2> looseTangentialBalanced = {};
  std::array<int, 2> looseCoverageTick = {{-1, -1}};
  std::array<bool, 2> dynamicField = {};
  LooseForceCache looseForceCaches[2];
  uint32_t looseCacheSerial = 0;
  std::vector<uint64_t> previousBinSignatures[2];
  std::vector<uint64_t> currentBinSignatures[2];
  std::vector<uint8_t> changedBins[2];
  std::vector<NeutroniumSeed> neutroniumSeeds;
  std::vector<int> neutroniumKdOrder;
  std::vector<NeutroniumKdNode> neutroniumKdNodes;
  int neutroniumKdRoot = -1;
  std::vector<int> nearestSeedAt, nearestVertical, nearestNeutroniumField;
  std::vector<int> edtLocations;
  std::vector<double> edtBreaks;
  uint64_t nearestGeometryHash = 0;
  int nearestFieldCols = 0, nearestFieldRows = 0;
  int nearestFieldX0 = 0, nearestFieldY0 = 0;
  int nearestFieldX1 = -1, nearestFieldY1 = -1;
  bool nearestFieldValid = false;

  int layerIndex(const Layer* layer) const;
  uint8_t layerBit(const Layer* layer) const;
  int bodyNeutroniumCellCount(const Body* body) const;
  void prepareLayer(Layer* layer);
  void addEmitter(LayerState& state, const ForceEmitter& emitter);
  uint64_t emitterSignature(const ForceEmitter& emitter) const;
  void addNeutroniumEmitters(Layer* layer, LayerState& state);
  void buildBins(LayerState& state);
  void buildNeutroniumIndex();
  int buildNeutroniumKdNode(int begin, int end, int depth);
  bool neutroniumSourceDominates(int seedIndex, int targetNeutroniumCells,
                                 int targetBodyLayer,
                                 int targetBodyId) const;
  int nearestDominantNeutronium(double x, double y,
                                int targetNeutroniumCells,
                                int targetBodyLayer,
                                int targetBodyId) const;
  void buildNearestNeutroniumField();
  bool stateAffectsLayer(const LayerState& state, uint8_t targetLayer) const;
  bool binAffectsLayer(const LayerState& state, int bin,
                       uint8_t targetLayer) const;
  bool binAffectsLooseLayer(const LayerState& state, int bin,
                            uint8_t targetLayer) const;
  uint64_t forceBinSignature(int bin, uint8_t targetLayer) const;
  void prepareLooseCachesAndDirtyBins();
  void wakeAffectedTargets(Layer* layer, const std::vector<uint8_t>* bins,
                           bool updateCoverage, bool wakeReleased);
  bool sampleState(const LayerState& state, double x, double y,
                   uint8_t target, uint8_t targetLayer, int sourceBodyId,
                   double& forceX, double& forceY) const;
  bool sampleNearestNeutronium(Layer* layer, double x, double y,
                               uint8_t target, int sourceBodyId,
                               int targetNeutroniumCells,
                               int targetBodyLayer,
                               double& forceX, double& forceY) const;
  bool sampleLayer(Layer* layer, double x, double y, uint8_t target,
                   int sourceBodyId, double& forceX, double& forceY,
                   int targetNeutroniumCells = 0,
                   int targetBodyLayer = -1) const;
  bool sampleLoose(Layer* layer, int x, int y, uint8_t target,
                   double& forceX, double& forceY);
  bool sampleBody(Layer* layer, Body* body,
                  double& forceX, double& forceY) const;
  bool bodyTouchesBins(const Body* body,
                       const std::vector<uint8_t>& bins) const;
  int looseMoveCandidates(double forceX, double forceY,
                          std::array<std::pair<int, int>, 3>& moves) const;
};
