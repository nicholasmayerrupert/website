#pragma once
// Procedural terrain queries are pure functions of absolute coordinates and the
// active layer's terrain parameters. They never consume shared simulation RNG.

#include "biomes.generated.hpp"
#include "cave_profile_handlers.hpp"

struct Engine;

// Terrain, feature plans, and semantic identities are one compatibility unit.
// Bump this when deterministic generation or feature containment changes.
inline constexpr int WORLD_GENERATION_VERSION = 4;

class TerrainGen {
 public:
  explicit TerrainGen(Engine& e) : E(e) {}

  // Generator tunables. World-space dimensions are deliberately independent of
  // the loaded buffer: a seed names one canonical world at every viewport size.
  // The constants define one canonical world independent of viewport height.
  static constexpr int WORLDGEN_VERSION = WORLD_GENERATION_VERSION;
  static constexpr int SURFACE_AMPLITUDE = 54;
  static constexpr int SEA_LEVEL = 18;
  static constexpr int BASE_SOIL_DEPTH = 3;
  static constexpr int CAVE_SURFACE_BUFFER = 12;
  static constexpr int CAVE_BOTTOM = 720;
  static constexpr int DEEP_BLEND_TOP = CAVE_BOTTOM - 96;
  static constexpr int DEEP_BLEND_BOTTOM = CAVE_BOTTOM + 128;
  static constexpr int CAVE_REGION_WIDTH = 256;
  static constexpr int DEEP_CAVERN_WIDTH = 288;
  static constexpr int DEEP_CAVERN_HEIGHT = 208;
  static constexpr int DEEP_CAVERN_CENTER_X_MARGIN = 56;
  static constexpr int DEEP_CAVERN_CENTER_Y_MARGIN = 16;
  static constexpr int DEEP_CAVERN_MIN_RADIUS_X = 82;
  static constexpr int DEEP_CAVERN_RADIUS_X_VARIATION = 64;
  static constexpr int DEEP_CAVERN_MIN_RADIUS_Y = 52;
  static constexpr int DEEP_CAVERN_RADIUS_Y_VARIATION = 42;
  static constexpr int DEEP_CAVERN_MAX_RADIUS_X =
    DEEP_CAVERN_MIN_RADIUS_X + DEEP_CAVERN_RADIUS_X_VARIATION - 1;
  static constexpr int DEEP_CAVERN_MAX_RADIUS_Y =
    DEEP_CAVERN_MIN_RADIUS_Y + DEEP_CAVERN_RADIUS_Y_VARIATION - 1;
  static constexpr double SURFACE_FREQ = 0.008;
  static constexpr double CAVE_FREQ = 0.01;    // lower frequency produces larger features
  static constexpr double TREE_PROB = 0.05;
  static constexpr double BIOME_FREQ = 0.0018; // broad climate regions with smaller moisture pockets
  static constexpr double ORE_FREQ = 0.11;     // ore-vein noise wavelength (small clusters)
  static constexpr double ORE_THRESH = 0.80;   // ridged-noise cutoff -> sparse veins
  static constexpr int SURFACE_OCT = 5;
  static constexpr int GEN_SKIN = 1;

  int genBiomeAt(int worldX);
  double genTemperatureAt(int worldX);
  double genMoistureAt(int worldX);
  int genSurfaceAbs(int worldX);
  int genSurfaceAt(int worldX);
  int genSoilDepth(int biome);
  int genSoilDepthAt(int worldX, int biome);
  uint8_t genSkinMat(int biome, int slope, bool underwater);
  uint8_t genSoilMat(int biome, int d, int soil);
  int genCaveTopAbs(int worldX);
  int genCaveBiomeAt(int worldX, int worldY);
  bool genIsBackboneCave(int worldX, int worldY);
  bool genIsDeepCave(int worldX, int worldY);
  bool genIsCave(int worldX, int worldY);
  bool genOpenCaveAt(int worldX, int worldY);
  bool genIsCaveWall(int worldX, int worldY);
  bool genIsEntranceWall(int worldX, int worldY);
  uint8_t genOreFor(int biome, int worldX, int worldY);
  int caveBottomAbs();
  uint8_t genDeepRockAt(int worldX, int worldY);
  uint8_t genCellAt(int worldX, int surf, int slope, int biome, int soil, int y);
  double genTreeProb(int biome);
  uint8_t pickTreeType(int biome, int worldX);
  bool genTreeAt(int worldX, int surf);

  struct DeepCavernPlan {
    int centerX = 0, centerY = 0;
    int radiusX = 0, radiusY = 0;
  };
  DeepCavernPlan deepCavernPlan(int gx, int gy);

 private:
  struct SurfaceCacheEntry {
    uint32_t seed = 0;
    int x = INT_MIN;
    int value = 0;
  };
  struct BiomeCacheEntry {
    uint32_t seed = 0;
    int x = INT_MIN;
    uint8_t value = BIOME_PLAINS;
  };
  struct CaveCacheEntry {
    uint32_t seed = 0;
    int x = INT_MIN, y = INT_MIN;
    uint8_t value = 0;
  };
  struct CaveRegionPlan {
    int entryX = 0, entryY = 0;
    int mouthX = 0, mouthY = 0;
    int upperX = 0, upperY = 0;
    int middleX = 0, middleY = 0;
    int deepX = 0, deepY = 0;
  };
  struct CavePlanCacheEntry {
    uint32_t seed = 0;
    int region = INT_MIN;
    CaveRegionPlan plan;
  };
  struct DeepPlanCacheEntry {
    uint32_t seed = 0;
    int gx = INT_MIN, gy = INT_MIN;
    DeepCavernPlan plan;
  };

  static constexpr int SURFACE_CACHE_SIZE = 4096;
  static constexpr int BIOME_CACHE_SIZE = 2048;
  static constexpr int CAVE_CACHE_SIZE = 16384;
  static constexpr int CAVE_PLAN_CACHE_SIZE = 256;
  static constexpr int DEEP_PLAN_CACHE_SIZE = 256;

  Engine& E;
  std::array<SurfaceCacheEntry, SURFACE_CACHE_SIZE> surfaceCache{};
  std::array<BiomeCacheEntry, BIOME_CACHE_SIZE> biomeCache{};
  std::array<CaveCacheEntry, CAVE_CACHE_SIZE> caveCache{};
  std::array<CavePlanCacheEntry, CAVE_PLAN_CACHE_SIZE> cavePlanCache{};
  std::array<DeepPlanCacheEntry, DEEP_PLAN_CACHE_SIZE> deepPlanCache{};

  static int floorDiv(int value, int divisor);
  int classifyBiomeAt(int worldX);
  CaveRegionPlan cavePlan(int region);
  bool taperedSegmentContains(int x, int y, int ax, int ay, int bx, int by,
                              double startRadius, double endRadius, uint32_t salt);
};
