#pragma once
// Shared declarations for the WASM sand engine (ported from src/sand/*.js).
#include <cstdint>
#include <cstring>
#include <cmath>
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <algorithm>
#include <utility>
#include <functional>
#include <emscripten.h>

enum Mat : uint8_t {
  EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, OIL = 4, FIRE = 5, STEAM = 6,
  SEED = 7, WOOD = 8, PLANT = 9, ACID = 10, LAVA = 11, ICE = 12, RIGID = 13,
  DRIFTWOOD = 14
};
enum Kind : uint8_t { K_NONE = 0, K_POWDER = 1, K_LIQUID = 2, K_GAS = 3, K_COMPONENT = 4, K_FREE_RIGID = 5 };

static const int TABLE = 16;
static const float  DENSITY[TABLE]      = {0, 1.6f, 1.0f, 2.6f, 0.8f, 0, 0, 0.5f, 0.6f, 0.4f, 1.1f, 2.8f, 0.9f, 1.4f, 0.6f, 0};
static const uint8_t DENSITY_SORTED[TABLE] = {0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0};
static const float  MOBILITY[TABLE]     = {0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0.35f, 0, 0, 0, 0};
static const uint8_t MAT_KIND[TABLE]    = {K_NONE, K_POWDER, K_LIQUID, K_COMPONENT, K_LIQUID, K_GAS, K_GAS, K_COMPONENT, K_COMPONENT, K_COMPONENT, K_LIQUID, K_LIQUID, K_COMPONENT, K_FREE_RIGID, K_COMPONENT, K_NONE};

// Tunables (mirror engine.js)
static const int   CHUNK_SIZE = 32, CHUNK_SHIFT = 5, SEED_SIZE = 2;
static const int   MAX_WATER_FLOW = 10;
static const float STEAM_DECAY_P = 0.018f, FIRE_DECAY_P = 0.006f;
static const int   DIRTY_PAD_X = MAX_WATER_FLOW + 2, DIRTY_PAD_Y = 2;
static const int   SINK_STRIP_W = 2, INNER_STRIP_W = 1;
static const float SINK_LIQUID_P = 0.85f, SINK_SAND_P = 0.35f, INNER_LIQUID_P = 0.35f, INNER_SAND_P = 0.10f;
static const float BUOY_BAND_FRAC = 0.5f, BUOY_BAND_MIN = 1.5f, BUOY_DRAFT_SCALE = 0.5f, BUOY_WET_PERIMETER_FRAC = 0.75f, BUOY_SUPPORT_FRAC = 0.5f;
static const float OIL_IGNITE_P = 0.25f, PLANT_IGNITE_P = 0.25f * 0.67f, FIRE_SPREAD_P = 0.11f;
static const float ACID_DISSOLVE_P = 0.12f, ACID_DECAY_P = 0.4f, LAVA_EMIT_FIRE_P = 0.001f, ICE_FREEZE_P = 0.03f;
static const int   MAX_WOOD_CELLS = 120, MAX_LEAF_CELLS = 105, WATER_PER_GROWTH = 2, TRUNK_THICKEN_UNTIL_WOOD = 52;
static const float GROWTH_P = 0.58f, LEAF_GROWTH_P = 0.54f;
static const float TRUNK_SIDE_FILL_P = 0.96f, TRUNK_DOUBLE_SIDE_FILL_P = 0.78f, TRUNK_WIDE_SIDE_FILL_P = 0.34f;

static inline int imin(int a, int b) { return a < b ? a : b; }
static inline int imax(int a, int b) { return a > b ? a : b; }

// ---- Seeded noise (worldgen/noise.js) ----
static inline double whash2(uint32_t seed, int x, int y) {
  uint32_t h = seed;
  h = (h ^ (uint32_t)x) * 0x27d4eb2du;
  h = (h ^ (uint32_t)y) * 0x165667b1u;
  h ^= h >> 15; h = h * 0x2c1b3c6du; h ^= h >> 13;
  return (double)h / 4294967296.0;
}
static inline double whash1(uint32_t seed, int x) { return whash2(seed, x, 0x9e37); }
static inline double wfade(double t) { return t * t * t * (t * (t * 6 - 15) + 10); }
static inline double wlerp(double a, double b, double t) { return a + (b - a) * t; }
static double valueNoise2D(uint32_t seed, double x, double y) {
  double xi = std::floor(x), yi = std::floor(y), xf = x - xi, yf = y - yi;
  double u = wfade(xf), v = wfade(yf);
  double aa = whash2(seed, (int)xi, (int)yi), ba = whash2(seed, (int)xi + 1, (int)yi);
  double ab = whash2(seed, (int)xi, (int)yi + 1), bb = whash2(seed, (int)xi + 1, (int)yi + 1);
  return wlerp(wlerp(aa, ba, u), wlerp(ab, bb, u), v);
}
static double wfbm2(uint32_t seed, double x, double y, int octaves, double gain) {
  double amp = 1, freq = 1, sum = 0, norm = 0;
  for (int o = 0; o < octaves; o++) { double n = valueNoise2D(seed + (uint32_t)o * 1013u, x * freq, y * freq); sum += n * amp; norm += amp; amp *= gain; freq *= 2; }
  return norm > 0 ? sum / norm : 0;
}
static double wridged2(uint32_t seed, double x, double y, int octaves, double gain) {
  double amp = 1, freq = 1, sum = 0, norm = 0;
  for (int o = 0; o < octaves; o++) { double n = valueNoise2D(seed + (uint32_t)o * 1013u, x * freq, y * freq); double r = 1 - std::fabs(n * 2 - 1); sum += r * r * amp; norm += amp; amp *= gain; freq *= 2; }
  return norm > 0 ? sum / norm : 0;
}

struct Comp {
  int id = 0;
  std::unordered_set<int> cells;
  int yMax = 0;
  int woodCount = 0, leafCount = 0, age = 0;
  bool cacheDirty = false;
  bool grounded = false;
  std::vector<int> woodCells, seedWoodCells;
};

// Free rigid body: continuous float pose, solved in rigidStep (rigid2d.js port).
struct Body {
  int id = 0;
  std::vector<uint8_t> occ; int w = 0, h = 0;
  double offsetX = 0, offsetY = 0;
  double px = 0, py = 0, angle = 0;
  double vx = 0, vy = 0, omega = 0;
  uint8_t material = 13; double density = 1;
  bool awake = true; int stillTicks = 0;
  std::vector<float> points; int nPts = 0;
  std::vector<int> boundaryPts;
  double invMass = 0, invInertia = 0, maxR = 0;
  // transient per-step
  double cs = 1, sn = 0;
  double aabbX0 = 0, aabbY0 = 0, aabbX1 = 0, aabbY1 = 0;
  double pvx = 0, pvy = 0, pw = 0;
  bool hadContact = false; double maxDepth = 0; int idx = 0;
};
struct Contact { Body* a; Body* b; double rax, ray, rbx, rby, nx, ny, depth, accJn, accJt, accBias; };

// Rigid tunables (rigid2d.js)
static const double R_GRAVITY = 0.06, R_MAX_SPEED = 3.0, R_SAFE_SUBSTEP = 0.6;
static const int    R_MAX_SUBSTEPS = 6, R_SOLVER_ITERS = 64, R_SLEEP_TICKS = 20;
static const double R_RESTITUTION = 0, R_FRICTION = 0.6, R_BAUMGARTE = 0.2, R_MAX_BIAS_VEL = 0.3, R_PEN_SLOP = 0.5;
static const double R_CONTACT_LIN_DAMP = 0.9, R_CONTACT_ANG_DAMP = 0.6, R_LIQUID_DRAG = 0.12, R_LIQUID_ANG_DRAG = 0.1;
static const double R_SLEEP_LIN = 0.007, R_SLEEP_ANG = 0.0045;
static const double R_SETTLE_LIN = R_SLEEP_LIN * 8, R_SETTLE_ANG = R_SLEEP_ANG * 8;
static const double R_WAKE_LIN2 = 0.028 * 0.028, R_WAKE_ANG2 = 0.014 * 0.014, R_REST_DEPTH = 1.0;

