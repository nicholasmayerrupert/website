#pragma once
// Free rigid-body collision, buoyancy, sleep, erosion, and component baking.
// Bodies stamp their real material into their owning Layer.

struct Engine;

// One displaced loose cell (material + source index) pending relocation.
struct Disp { uint8_t material; int from; };

// Exact one-cell translation of the free-body stack in front of a descending
// static assembly. Planning is read-only so the component mover can finish all
// of its normal displacement/buoyancy checks before either side is mutated.
struct AssemblyBodyPush {
  Layer* layer = nullptr;
  std::vector<Body*> bodies;
  std::vector<Body*> crushedBodies;
  std::vector<int> oldCells;
  std::vector<int> newCells;
  std::vector<int> owners;
  std::unordered_set<int> vacated;
  std::unordered_set<int> occupied;
  std::unordered_map<int, uint8_t> overlay;
  bool empty() const { return bodies.empty() && crushedBodies.empty(); }
};

class RigidBodySystem {
 public:
  explicit RigidBodySystem(Engine& e) : E(e) {}

  // Diagnostics (engine_test_ rigid ABI).
  int rigidRejectedCells = 0, rigidDepenetrations = 0;
  // Scratch for per-body bottom-edge support probes: membership
  // stamp + cell list replacing a per-call unordered_set (the probes only sum
  // integer counters, so iteration order is irrelevant).
  StampSet occStamp;
  std::vector<int> occCells;
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
  uint8_t bodyMaterialAt(Body* b, int localIndex);
  void terrainNormalAt(Body* b, int cx, int cy, double bodyDensity, double& ox, double& oy);
  int insideBodyIndex(Body* b, double wx, double wy);
  void bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy);
  // Return the total |impulse| applied, so the solver loops can early-exit the
  // moment an iteration is a provable no-op (all-zero applied impulses leave
  // every velocity bitwise unchanged, so every later iteration recomputes the
  // same zeros — breaking there is bit-identical to running all iterations).
  double resolveContact(Contact& c);
  double resolveBias(Contact& c);
  void wakeBody(Body* b);
  void syncJointFollower(Body* leader);
  void breakJointBody(Body* member);
  void rigidStep(double tickDt);
  int localCellAt(Body* b, double wx, double wy);
  bool eraseLocalCell(Body* b, int idx);
  bool isBodyTerrain(Body* b, int x, int y, double bodyDensity);
  double buoyantLiquidDensityAt(int x, int y);
  double bodyLiquidSupport(Body* b, double& submerged);
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
  void finishErasedBodies(std::unordered_set<Body*>& dirty, std::vector<int>& cells);
  void erodeBodies(std::vector<int>& cells);
  int bodyFootprintBlocked(Body* b);
  bool sleepingBodyHasSupport(Body* b, double probe);
  int bodyDepenTolerance(Body* b);
  bool depenetrateBodyRaster(Body* b, double prePx, double prePy, bool hasPre);
  bool pushActorsFromBody(Body* b, double prePx, double prePy, double preAngle, double preVx, double preVy);
  void bakeBodyToGrid(Body* b);
  bool bodySolidifies(Body* b);
  bool bodyTouchesGroundedSolid(Body* b);
  bool bodyTouchesSettledLooseComponent(Body* b);
  bool bodyHasLooseSupport(Body* b);
  void stampJointFollower(Body* leader);
  void bakeRestingBodies();
  template <class Cells>
  bool planAssemblyBodyPush(const Cells& assemblyCells, int dir, AssemblyBodyPush& plan);
  void applyAssemblyBodyPush(AssemblyBodyPush& plan);
  void moveBodies();
  Body* finishSpawn(const std::vector<std::pair<int, int>>& cells, uint8_t material,
                    bool attachTouchingBodies = true);
  Body* spawnBody(const std::vector<std::pair<int, int>>& cells);
  Body* spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material);
  Body* spawnDisc(int cx, int cy, int radius, uint8_t material);

 private:
  Engine& E;
};
