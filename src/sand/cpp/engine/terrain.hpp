#pragma once
// Deterministic procedural terrain queries (extracted from the Engine in 5c).
//
// Every function is a pure function of absolute world coordinates + the ACTIVE
// layer's terrain params (seeds, surface amplitude, sea row — set by
// initInfiniteLayer) via position-keyed hashes (whash/wfbm; NO shared rand()
// stream), so generation is order-independent and both layers line up at the
// surface. Streaming (shifts, tile store, prefetch) and the fill passes stay
// on the Engine (worldgen.inc); this class answers "what is the world at
// (x, y)?".
//
// Method bodies live in terrain_impl.inc (they need the full Engine
// definition to reach E.L-> and E.rows).

struct Engine;

enum Biome : int { BIOME_PLAINS = 0, BIOME_FOREST = 1, BIOME_DESERT = 2, BIOME_ROCKY = 3,
                   BIOME_TUNDRA = 4, BIOME_JUNGLE = 5, BIOME_SWAMP = 6 };
enum CaveBiome : int { CAVE_DEFAULT = 0, CAVE_CRYSTAL = 1, CAVE_MUSHROOM = 2, CAVE_LUSH = 3 };
class TerrainGen {
 public:
  explicit TerrainGen(Engine& e) : E(e) {}

  // Generator tunables (values were Engine statics defined in sand.cpp).
  static constexpr double SURFACE_FREQ = 0.008;
  static constexpr double CAVE_FREQ = 0.01;    // ~5x larger caves (lower freq = bigger features)
  static constexpr double CAVE_THRESH = 0.66;
  static constexpr double TREE_PROB = 0.05;
  static constexpr double BIOME_FREQ = 0.0025; // broad climate regions with smaller moisture pockets
  static constexpr double POCKET_FREQ = 0.06;  // underground liquid/lava pockets
  static constexpr double WATER_POCKET_THRESH = 0.80; // pocket noise below this stays STONE (genPocketAt)
  static constexpr double LAVA_THRESH = 0.88;  // rare sealed bedrock lava chambers
  static constexpr double ORE_FREQ = 0.11;     // ore-vein noise wavelength (small clusters)
  static constexpr double ORE_THRESH = 0.80;   // ridged-noise cutoff -> sparse veins
  static constexpr int SURFACE_OCT = 5;
  static constexpr int GEN_SKIN = 1;

  int genBiomeAt(int worldX);
  int genSurfaceAbs(int worldX);
  int genSurfaceAt(int worldX);
  int genSoilDepth(int biome);
  uint8_t genSkinMat(int biome, int slope, bool underwater);
  uint8_t genSoilMat(int biome, int d, int soil);
  int genCaveTopAbs(int worldX);
  int genCaveBiomeAt(int worldX, int worldY);
  bool genIsCave(int worldX, int worldY);
  bool genOpenCaveAt(int worldX, int worldY);
  bool genIsCaveWall(int worldX, int worldY);
  uint8_t genOreFor(int biome, int worldX, int worldY);
  int caveBottomAbs();
  int underworldAbs();
  uint8_t genPocketAt(int worldX, int worldY);
  uint8_t genCellAt(int worldX, int surf, int slope, int biome, int soil, int y);
  double genTreeProb(int biome);
  uint8_t pickTreeType(int biome, int worldX);
  bool genTreeAt(int worldX, int surf);

 private:
  Engine& E;
};
