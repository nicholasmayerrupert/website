#pragma once
// Spatial force emitters for loose materials and free rigid bodies.

struct Engine;

enum ForceTarget : uint8_t {
  FORCE_POWDER = 1u << 0,
  FORCE_LIQUID = 1u << 1,
  FORCE_RIGID = 1u << 2,
  FORCE_GAS = 1u << 3,
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
  float directionX = 0, directionY = 0;
  uint8_t kind = FORCE_RADIAL;
  uint8_t targets = 0;
  uint8_t repelTargets = 0;
  uint8_t layerTargets = 0;
  int sourceBodyId = -1;
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
  bool tryMoveLoose(int x, int y, int k, uint8_t material);

 private:
  struct BinLink { int emitter = -1, next = -1; };
  struct LayerState {
    std::vector<ForceEmitter> emitters;
    std::vector<int> binHeads;
    std::vector<BinLink> binLinks;
  };

  Engine& E;
  LayerState states[2];
  std::vector<ForceEmitter> queued[2];

  int layerIndex(const Layer* layer) const;
  uint8_t layerBit(const Layer* layer) const;
  void prepareLayer(Layer* layer);
  void addEmitter(LayerState& state, const ForceEmitter& emitter);
  void addNeutroniumEmitters(Layer* layer, LayerState& state);
  void buildBins(LayerState& state);
  bool stateAffectsLayer(const LayerState& state, uint8_t targetLayer) const;
  bool binAffectsLayer(const LayerState& state, int bin,
                       uint8_t targetLayer) const;
  void wakeAffectedTargets(Layer* layer);
  bool sampleState(const LayerState& state, double x, double y,
                   uint8_t target, uint8_t targetLayer, int sourceBodyId,
                   double& forceX, double& forceY) const;
  bool sampleLayer(Layer* layer, double x, double y, uint8_t target,
                   int sourceBodyId, double& forceX, double& forceY) const;
  bool sample(double x, double y, uint8_t target, int sourceBodyId,
              double& forceX, double& forceY) const;
};
