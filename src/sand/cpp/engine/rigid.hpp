#pragma once
// Free rigid bodies (extracted from the Engine in 5f): swept mask-derived
// collision (no centre-to-centre normals; point-speed substeps), buoyancy in
// denser fluids, one-way granular support, sleep islands, lava/fire erosion,
// erase/split reconciliation, resting-body bake into static components, and
// the per-step stamp/un-stamp of each body's REAL material into the grid (the
// BODY-MATERIAL invariant's write side). The bodies themselves live on the
// Layer (they stream with the tile store). Method bodies live in
// rigid_impl.inc.

struct Engine;

// One displaced loose cell (material + source index) pending relocation.
struct Disp { uint8_t material; int from; };

class RigidBodySystem {
 public:
  explicit RigidBodySystem(Engine& e) : E(e) {}

  // Diagnostics (engine_test_ rigid ABI).
  int rigidRejectedCells = 0, rigidDepenetrations = 0;
  // Scratch for the per-body bottom-edge support probes (Phase 6): membership
  // stamp + cell list replacing a per-call unordered_set (the probes only sum
  // integer counters, so iteration order is irrelevant).
  StampSet occStamp;
  std::vector<int> occCells;
  // Erosion probabilities for body cells against lava/fire (match the static
  // reaction rates; were Engine statics defined in sand.cpp).
  static constexpr double RIGID_LAVA_ERODE_P = 0.12; // = ACID_DISSOLVE_P
  static constexpr double RIGID_FIRE_ERODE_P = 0.11; // = FIRE_SPREAD_P

  // Rasterize a body's occ mask to world cells (bodies in impl; instantiated there).
  template <class F> void forEachBodyCell(Body* b, F cb);

  void worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy);
  bool computeDerived(Body* b, bool preserveWorld);
  Body* spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density);
  void terrainNormalAt(int cx, int cy, double bodyDensity, double& ox, double& oy);
  int insideBodyIndex(Body* b, double wx, double wy);
  void bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy);
  // Return the total |impulse| applied, so the solver loops can early-exit the
  // moment an iteration is a provable no-op (all-zero applied impulses leave
  // every velocity bitwise unchanged, so every later iteration recomputes the
  // same zeros — breaking there is bit-identical to running all iterations).
  double resolveContact(Contact& c);
  double resolveBias(Contact& c);
  void wakeBody(Body* b);
  void rigidStep(double tickDt);
  int localCellAt(Body* b, double wx, double wy);
  bool eraseLocalCell(Body* b, int idx);
  bool isBodyTerrain(int x, int y, double bodyDensity);
  double buoyantLiquidDensityAt(int x, int y);
  double granularMediumDensityAt(int x, int y);
  bool isBodyRelocatable(uint8_t m, int k, double bodyDensity);
  bool canBodyOccupy(uint8_t m, int k, double bodyDensity);
  void spillDisplacedBodyMaterial(std::vector<Disp>& displaced, const std::vector<int>& edgeFootprint, int32_t footprintGen, double bodyDensity);
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
  bool bodySolidifies(uint8_t m);
  bool bodyFloatsOnMedium(Body* b);
  bool bodyHasLooseSupport(Body* b);
  void bakeRestingBodies();
  void moveBodies();
  Body* finishSpawn(const std::vector<std::pair<int, int>>& cells, uint8_t material);
  Body* spawnBody(const std::vector<std::pair<int, int>>& cells);
  Body* spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material);
  Body* spawnDisc(int cx, int cy, int radius, uint8_t material);

 private:
  Engine& E;
};
