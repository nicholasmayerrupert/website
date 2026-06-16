// Falling-sand simulation core, ported from src/sand/*.js to C++ for WebAssembly.
// Behavioral parity (not bit-identical) with the JS engine.
//
// STAGES 1-3: grid CA (engine.js) + grid-aligned components stone/plant/ice
// (components.js) + reactions (reactions.js) + plant growth (growth.js) +
// component-aware tools/drafts/seed (tools.js). Free rigid bodies (rigid2d.js,
// rigidBodies.js) and worldgen streaming are added in stages 4-5 (stubbed).
//
// Material ids MUST stay in lockstep with src/sand/materials.js.

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

struct Engine {
  int cols, rows, chunkCols, chunkRows;
  std::vector<uint8_t> gridA, gridB;
  uint8_t* grid; uint8_t* next;
  std::vector<uint8_t> dirtyRender;
  std::vector<int32_t> rowMarkMin, rowMarkMax, chunkStamp, activeRowMin, activeRowMax, vacatedStamp;
  std::vector<uint8_t> groundedCell;
  std::vector<int32_t> cellComp, groundStack, compOccStamp;
  std::vector<int> prevCompCells, curCompCells, bodyCells;
  std::vector<uint8_t> reactionFlags;
  std::vector<int32_t> reactionSteam, reactionFires, reactionIgnite;
  std::vector<Comp> stoneComponents, plantComponents, iceComponents;
  int nextStoneId = 1, nextPlantId = 1, nextIceId = 1;
  std::unordered_set<int> stoneDraft, iceDraft;
  std::vector<int> draftSnapshot;
  // worldgen / streaming
  bool infinite = false;
  int worldOffsetX = 0;
  uint32_t worldSeed = 0;
  int gSurfAmp = 0, gSurfBase = 0, gSeaRow = 0, gSoil = 0;
  uint32_t gCaveSeed = 0, gTreeSeed = 0;
  // free rigid bodies
  std::vector<Body*> bodies;
  int nextBodyId = 1;
  std::vector<int32_t> bodyOwner;
  int rigidRejectedCells = 0, rigidDepenetrations = 0;
  int stepSerial = 0, dirtyRenderCount = 0, tick = 0, perfDirtyChunks = 0;
  double perfStepMs = 0;
  bool sinksEnabled;
  uint32_t rngState;

  inline double rand() {
    rngState = (rngState + 0x6d2b79f5u);
    uint32_t a = rngState;
    uint32_t t = a ^ (a >> 15); t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7); t = (t + (t2 * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
  inline int I(int x, int y) { return y * cols + x; }

  Engine(int c, int r, uint32_t seed, bool sinks) : cols(c), rows(r), sinksEnabled(sinks), rngState(seed) {
    chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
    chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;
    size_t n = (size_t)cols * rows;
    gridA.assign(n, EMPTY); gridB.assign(n, EMPTY);
    grid = gridA.data(); next = gridB.data();
    dirtyRender.assign((size_t)chunkCols * chunkRows, 0);
    rowMarkMin.assign(rows, cols); rowMarkMax.assign(rows, -1);
    chunkStamp.assign((size_t)chunkCols * chunkRows, -1);
    activeRowMin.assign(rows, 0); activeRowMax.assign(rows, 0);
    vacatedStamp.assign(n, -1);
    groundedCell.assign(n, 0); cellComp.assign(n, -1); groundStack.assign(n, 0);
    compOccStamp.assign(n, -1);
    reactionFlags.assign(n, 0); reactionSteam.assign(n, 0); reactionFires.assign(n, 0); reactionIgnite.assign(n, 0);
    bodyOwner.assign(n, -1);
  }
  ~Engine() { for (Body* b : bodies) delete b; }

  // ---- predicates ----
  inline bool isPlantMaterial(uint8_t m) { return m == SEED || m == WOOD || m == PLANT || m == DRIFTWOOD; }
  inline bool isDissolvable(uint8_t m) { return m == SAND || m == STONE || m == WOOD || m == PLANT || m == SEED || m == DRIFTWOOD; }
  inline bool isRigidMaterial(uint8_t m) { return m == STONE || m == WOOD || m == PLANT || m == SEED || m == ICE || m == RIGID || m == DRIFTWOOD; }
  inline bool isFlammable(uint8_t m) { return m == OIL || isPlantMaterial(m); }
  inline bool isBearingMaterial(uint8_t m) { return m == SAND || isRigidMaterial(m); }
  inline bool isLiquid(uint8_t m) { return MAT_KIND[m] == K_LIQUID; }
  inline bool isGas(uint8_t m) { return MAT_KIND[m] == K_GAS; }
  inline bool componentDisplaceable(uint8_t m) { return m == EMPTY || m == SAND || isLiquid(m) || isGas(m); }
  inline bool isInBounds(int x, int y) { return x > 0 && x < cols - 1 && y > 0 && y < rows; }

  // ---- dirty tracking ----
  inline void markCellIndex(int k) {
    int y = k / cols, x = k - y * cols;
    if (x < rowMarkMin[y]) rowMarkMin[y] = x;
    if (x > rowMarkMax[y]) rowMarkMax[y] = x;
  }
  void markDirtyRect(int x0, int y0, int x1, int y1) {
    int mx0 = imax(0, x0), mx1 = imin(cols - 1, x1), my0 = imax(0, y0), my1 = imin(rows - 1, y1);
    for (int y = my0; y <= my1; y++) {
      if (mx0 < rowMarkMin[y]) rowMarkMin[y] = mx0;
      if (mx1 > rowMarkMax[y]) rowMarkMax[y] = mx1;
    }
  }
  void markAllDirty() { for (int y = 0; y < rows; y++) { rowMarkMin[y] = 0; rowMarkMax[y] = cols - 1; } }
  void foldRowMarksToRender() {
    for (int y = 0; y < rows; y++) {
      int mn = rowMarkMin[y], mx = rowMarkMax[y];
      if (mx < mn) continue;
      int px0 = imax(0, mn - DIRTY_PAD_X), px1 = imin(cols - 1, mx + DIRTY_PAD_X);
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      int c0 = px0 >> CHUNK_SHIFT, c1 = px1 >> CHUNK_SHIFT, cy0 = py0 >> CHUNK_SHIFT, cy1 = py1 >> CHUNK_SHIFT;
      for (int cy = cy0; cy <= cy1; cy++) {
        int rb = cy * chunkCols;
        for (int cx = c0; cx <= c1; cx++) { int ci = rb + cx; if (!dirtyRender[ci]) { dirtyRender[ci] = 1; dirtyRenderCount++; } }
      }
    }
  }
  bool beginStepDirty() {
    foldRowMarksToRender();
    for (int y = 0; y < rows; y++) { activeRowMin[y] = cols; activeRowMax[y] = -1; }
    bool hasActive = false;
    for (int y = 0; y < rows; y++) {
      int mn = rowMarkMin[y], mx = rowMarkMax[y];
      if (mx < mn) continue;
      hasActive = true;
      rowMarkMin[y] = cols; rowMarkMax[y] = -1;
      int px0 = imax(0, mn - DIRTY_PAD_X), px1 = imin(cols - 1, mx + DIRTY_PAD_X);
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      for (int yy = py0; yy <= py1; yy++) { if (px0 < activeRowMin[yy]) activeRowMin[yy] = px0; if (px1 > activeRowMax[yy]) activeRowMax[yy] = px1; }
    }
    if (!hasActive) return false;
    stepSerial++; perfDirtyChunks = 0;
    for (int y = 0; y < rows; y++) {
      int mn = activeRowMin[y], mx = activeRowMax[y];
      if (mx < mn) continue;
      int rb = (y >> CHUNK_SHIFT) * chunkCols;
      for (int cx = mn >> CHUNK_SHIFT, c1 = mx >> CHUNK_SHIFT; cx <= c1; cx++) { int ci = rb + cx; if (chunkStamp[ci] != stepSerial) { chunkStamp[ci] = stepSerial; perfDirtyChunks++; } }
    }
    return true;
  }
  void prepareNextBuffer() {
    for (int y = 0; y < rows; y++) {
      int rs = y * cols, minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX >= minX) memset(next + rs + minX, EMPTY, (size_t)(maxX - minX + 1));
    }
  }

  // ---- cell helpers ----
  inline bool emptyAt(int x, int y) { return x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] == EMPTY && next[I(x, y)] == EMPTY; }
  inline bool touchesGridEmpty(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && grid[k - 1] == EMPTY) || (x < cols - 2 && grid[k + 1] == EMPTY) ||
           (y > 1 && grid[k - cols] == EMPTY) || (y < rows - 1 && grid[k + cols] == EMPTY);
  }
  inline void writeGridIndex(int k, uint8_t m) { if (grid[k] == m) return; grid[k] = m; markCellIndex(k); }
  inline bool isLooseDensityMaterial(uint8_t m) { return DENSITY_SORTED[m] == 1; }
  inline bool canDisplaceByLooseDensity(uint8_t m, uint8_t d) { return isLooseDensityMaterial(m) && isLooseDensityMaterial(d) && DENSITY[m] > DENSITY[d]; }
  inline bool touchesUnstableLooseDensityInterface(int k, uint8_t m) {
    if (!isLooseDensityMaterial(m)) return false;
    int y = k / cols;
    return (y < rows - 1 && canDisplaceByLooseDensity(m, grid[k + cols])) || (y > 1 && canDisplaceByLooseDensity(grid[k - cols], m));
  }
  inline void writeNextIndex(int k, uint8_t m) {
    if (next[k] == m) return;
    next[k] = m;
    if (grid[k] != m || m == FIRE || m == STEAM || (isLiquid(m) && touchesGridEmpty(k)) || touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
  }
  inline bool canDisplaceMaterial(uint8_t m, uint8_t d) { if (isGas(d)) return true; return canDisplaceByLooseDensity(m, d); }
  inline bool canEnterIndex(int k, uint8_t m) { return next[k] == EMPTY && (grid[k] == EMPTY || canDisplaceMaterial(m, grid[k])); }
  inline bool canLiquidEnter(int x, int y, uint8_t m) { return x >= 0 && x < cols && y >= 0 && y < rows && canEnterIndex(I(x, y), m); }
  inline bool supportsLiquid(uint8_t s, uint8_t m) { return s != EMPTY && s != m && !canDisplaceMaterial(m, s); }
  void moveMaterialInto(int fromK, int toK, uint8_t m) {
    uint8_t displaced = grid[toK];
    writeNextIndex(toK, m);
    vacatedStamp[fromK] = tick;
    if (displaced != EMPTY && canDisplaceMaterial(m, displaced) && next[fromK] == EMPTY && vacatedStamp[toK] != tick) writeNextIndex(fromK, displaced);
  }
  inline void moveLiquidInto(int fromK, int x, int y, uint8_t m) { moveMaterialInto(fromK, I(x, y), m); }

  static const int DIRS_LF[2];
  static const int DIRS_RF[2];

  // ---- settle passes (identical to Stage 1) ----
  bool canLooseDensitySettleThisTick(uint8_t m) { float mob = MOBILITY[m]; return mob >= 1 || rand() < mob; }
  void settleLooseDensityInterface(int x, int y, int k) {
    uint8_t m = grid[k];
    if (!isLooseDensityMaterial(m) || next[k] != EMPTY) return;
    if (!canLooseDensitySettleThisTick(m)) return;
    int belowK = k + cols;
    if (y + 1 < rows && canDisplaceByLooseDensity(m, grid[belowK]) && next[belowK] == EMPTY) { moveMaterialInto(k, belowK, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx; if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue; int ik = belowK + dx; if (canDisplaceByLooseDensity(m, grid[ik]) && next[ik] == EMPTY) { moveMaterialInto(k, ik, m); return; } }
  }
  void settleSand(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && grid[belowK] == SAND && grid[belowK - 1] == SAND && grid[belowK + 1] == SAND) { if (next[k] == EMPTY) next[k] = SAND; return; }
    if (y + 1 < rows && grid[belowK] == EMPTY && next[belowK] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(belowK, SAND); return; }
    if (y + 1 < rows && canDisplaceMaterial(SAND, grid[belowK]) && next[belowK] == EMPTY) { moveMaterialInto(k, belowK, SAND); return; }
    int firstDx = rand() < 0.5 ? -1 : 1, secondDx = -firstDx;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? firstDx : secondDx; int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx; uint8_t m = grid[ik];
      if (m == EMPTY && next[ik] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, SAND); return; }
      if (canDisplaceMaterial(SAND, m) && next[ik] == EMPTY) { moveMaterialInto(k, ik, SAND); return; }
    }
    if (next[k] == EMPTY) writeNextIndex(k, SAND);
  }
  void settleLiquid(int x, int y, int k, uint8_t m) {
    if (next[k] != EMPTY) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 && grid[k - 1] == m && grid[k + 1] == m) {
      uint8_t below = grid[belowK], bl = grid[belowK - 1], br = grid[belowK + 1];
      if ((below == m && bl == m && br == m) || (supportsLiquid(below, m) && bl != EMPTY && !canDisplaceMaterial(m, bl) && br != EMPTY && !canDisplaceMaterial(m, br))) {
        next[k] = m; if (y > 1 && grid[k - cols] == EMPTY) markCellIndex(k); return;
      }
    }
    if (y + 1 < rows && grid[belowK] == EMPTY && next[belowK] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(belowK, m); return; }
    if (y + 1 < rows && canDisplaceMaterial(m, grid[belowK]) && next[belowK] == EMPTY) { moveLiquidInto(k, x, y + 1, m); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i]; int nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      int ik = I(nx, ny);
      if (grid[ik] == EMPTY && next[ik] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, m); return; }
      if (canDisplaceMaterial(m, grid[ik]) && next[ik] == EMPTY) { moveLiquidInto(k, nx, ny, m); return; }
    }
    int flow = 0, firstFlowDir = rand() < 0.5 ? 1 : -1;
    for (int dirIndex = 0; dirIndex < 2 && flow == 0; dirIndex++) {
      int sgn = dirIndex == 0 ? firstFlowDir : -firstFlowDir;
      for (int d = 1; d <= MAX_WATER_FLOW; d++) {
        int nx = x + sgn * d; if (nx <= 0 || nx >= cols - 1) break;
        int sideK = k + sgn * d; if (!canEnterIndex(sideK, m)) break;
        if (y + 1 < rows) { int lowerK = sideK + cols; if (canEnterIndex(lowerK, m)) { int stepK = k + sgn; if (canEnterIndex(stepK, m)) flow = sgn; break; } }
      }
    }
    if (flow != 0) { int stepX = x + flow; if (canLiquidEnter(stepX, y, m)) { moveLiquidInto(k, stepX, y, m); return; } }
    if (y + 1 < rows && supportsLiquid(grid[belowK], m)) {
      int aboveK = k - cols;
      if (y > 1 && grid[aboveK] == m) {
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int sideK = k + dx; if (x + dx <= 0 || x + dx >= cols - 1) continue; if (canEnterIndex(sideK, m) && supportsLiquid(grid[sideK + cols], m)) { moveMaterialInto(k, sideK, m); return; } }
      }
      if (next[k] == EMPTY) writeNextIndex(k, m);
      return;
    }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; if (canLiquidEnter(x + dx, y, m)) { moveLiquidInto(k, x + dx, y, m); return; } }
    if (next[k] == EMPTY) writeNextIndex(k, m);
  }
  void settleLava(int x, int y, int k) { if (next[k] != EMPTY) return; if (rand() >= MOBILITY[LAVA]) { writeNextIndex(k, LAVA); return; } settleLiquid(x, y, k, LAVA); }
  void relaxLiquidGaps() {
    for (int pass = 0; pass < 2; pass++) for (int y = rows - 2; y > 0; y--) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      bool ltr = rand() < 0.5; int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        int k = I(x, y); if (grid[k] != EMPTY) continue;
        if (grid[I(x, y + 1)] == EMPTY) continue;
        int aboveK = I(x, y - 1); uint8_t above = grid[aboveK];
        if (above == WATER || above == ACID || above == OIL) { writeGridIndex(k, above); writeGridIndex(aboveK, EMPTY); continue; }
        const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
        for (int i = 0; i < 2; i++) { int dx = dirs[i]; int sx = x + dx; if (sx <= 0 || sx >= cols - 1) continue; int sk = I(sx, y); uint8_t side = grid[sk]; if (side != WATER && side != OIL && side != ACID) continue; writeGridIndex(k, side); writeGridIndex(sk, EMPTY); if (grid[k] != EMPTY) break; }
      }
    }
  }
  void separateLooseByDensity() {
    int parity = rand() < 0.5 ? 0 : 1;
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      bool ltr = (y % 2) == 0; int start = ltr ? minX : maxX, end = ltr ? maxX + 1 : minX - 1, stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        if (((x + y) % 2) != parity) continue;
        int k = I(x, y), belowK = k + cols; uint8_t upper = grid[k], lower = grid[belowK];
        if (canDisplaceByLooseDensity(upper, lower)) { writeGridIndex(belowK, upper); writeGridIndex(k, lower); }
      }
    }
  }
  void riseSteam(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() < STEAM_DECAY_P || y <= 1) { markCellIndex(k); return; }
    int up = I(x, y - 1);
    if (grid[up] == EMPTY && next[up] == EMPTY && rand() < 0.72) { writeNextIndex(up, STEAM); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = y - 1; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (grid[ik] == EMPTY && next[ik] == EMPTY) { writeNextIndex(ik, STEAM); return; } }
    if (rand() < 0.65) for (int i = 0; i < 2; i++) { int dx = dirs[i]; if (emptyAt(x + dx, y)) { writeNextIndex(I(x + dx, y), STEAM); return; } }
    if (next[k] == EMPTY) writeNextIndex(k, STEAM);
  }
  void riseFire(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() < FIRE_DECAY_P || y <= 1) { markCellIndex(k); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    if (rand() < 0.36) { int up = I(x, y - 1); if (grid[up] == EMPTY && next[up] == EMPTY) { writeNextIndex(up, FIRE); return; } }
    for (int i = 0; i < 2; i++) { int dx = dirs[i]; int nx = x + dx, ny = rand() < 0.55 ? y - 1 : y; if (!isInBounds(nx, ny)) continue; int ik = I(nx, ny); if (grid[ik] == EMPTY && next[ik] == EMPTY) { writeNextIndex(ik, FIRE); return; } }
    if (next[k] == EMPTY) writeNextIndex(k, FIRE);
  }
  void drain(int xs, int xe, int y, float liquidP, float sandP) {
    for (int x = xs; x <= xe; x++) { int k = I(x, y); uint8_t m = grid[k]; float p = isLiquid(m) ? liquidP : (m == SAND ? sandP : 0); if (p && rand() < p) writeGridIndex(k, EMPTY); }
  }
  void applySideSinks() {
    if (!sinksEnabled || cols < 6) return;
    int leftStart = 1, leftEnd = leftStart + SINK_STRIP_W - 1;
    int rightStart = cols - 2 - (SINK_STRIP_W - 1), rightEnd = cols - 2;
    int innerLeftStart = leftEnd + 1, innerLeftEnd = innerLeftStart + INNER_STRIP_W - 1;
    int innerRightEnd = rightStart - 1, innerRightStart = innerRightEnd - (INNER_STRIP_W - 1);
    for (int y = 1; y < rows; y++) {
      drain(leftStart, leftEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(rightStart, rightEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(innerLeftStart, innerLeftEnd, y, INNER_LIQUID_P, INNER_SAND_P);
      drain(innerRightStart, innerRightEnd, y, INNER_LIQUID_P, INNER_SAND_P);
    }
  }

  // ================= COMPONENTS (components.js) =================
  void computeGrounded() {
    std::fill(groundedCell.begin(), groundedCell.end(), 0);
    std::fill(cellComp.begin(), cellComp.end(), -1);
    std::vector<Comp*> comps;
    auto indexComps = [&](std::vector<Comp>& list) {
      for (auto& c : list) { c.grounded = false; int id = (int)comps.size(); comps.push_back(&c); for (int k : c.cells) cellComp[k] = id; }
    };
    indexComps(stoneComponents); indexComps(plantComponents); indexComps(iceComponents);
    int sp = 0;
    auto groundCellAt = [&](int k) {
      if (groundedCell[k]) return;
      groundedCell[k] = 1;
      int id = cellComp[k];
      if (id >= 0) comps[id]->grounded = true;
      groundStack[sp++] = k;
    };
    int floorBase = (rows - 1) * cols;
    for (int x = 0; x < cols; x++) { int k = floorBase + x; if (isBearingMaterial(grid[k])) groundCellAt(k); }
    for (int y = rows - 2; y > 0; y--) { int rb = y * cols; for (int x = 1; x < cols - 1; x++) { int k = rb + x; if (grid[k] == SAND && grid[k + cols] == LAVA) groundCellAt(k); } }
    while (sp > 0) {
      int k = groundStack[--sp];
      int above = k - cols;
      if (above >= 0 && !groundedCell[above] && isBearingMaterial(grid[above])) groundCellAt(above);
      if (isRigidMaterial(grid[k])) {
        int ky = k / cols, kx = k - ky * cols;
        for (int oy = -1; oy <= 1; oy++) { int ny = ky + oy; if (ny <= 0 || ny >= rows) continue; int rb = ny * cols; for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = kx + ox; if (nx <= 0 || nx >= cols - 1) continue; int nk = rb + nx; if (!groundedCell[nk] && isRigidMaterial(grid[nk])) groundCellAt(nk); } }
      }
    }
  }

  void moveRigidAssemblies() {
    std::vector<Comp*> all;
    for (auto& c : stoneComponents) all.push_back(&c);
    int nStone = (int)all.size();
    for (auto& c : plantComponents) all.push_back(&c);
    int nStonePlant = (int)all.size();
    for (auto& c : iceComponents) all.push_back(&c);
    int n = (int)all.size();
    if (n == 0) return;
    for (auto* comp : all) { int ym = 0; for (int k : comp->cells) { int y = k / cols; if (y > ym) ym = y; } comp->yMax = ym; }
    std::vector<int> parent(n); for (int i = 0; i < n; i++) parent[i] = i;
    auto find = [&](int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (int i = 0; i < n; i++) for (int k : all[i]->cells) {
      int y = k / cols, x = k - y * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (nx < 1 || nx >= cols - 1 || ny < 1 || ny >= rows) continue; int j = cellComp[ny * cols + nx]; if (j >= 0) { int ri = find(i), rj = find(j); if (ri != rj) parent[ri] = rj; } }
    }
    struct Group { std::vector<int> comps; bool grounded = false; int maxY = 0; };
    std::unordered_map<int, Group> groups;
    for (int i = 0; i < n; i++) { int r = find(i); Group& g = groups[r]; g.comps.push_back(i); if (all[i]->grounded) g.grounded = true; if (all[i]->yMax > g.maxY) g.maxY = all[i]->yMax; }
    std::vector<Group*> order; order.reserve(groups.size());
    for (auto& kv : groups) order.push_back(&kv.second);
    std::sort(order.begin(), order.end(), [](Group* a, Group* b) { return a->maxY > b->maxY; });

    auto matOf = [&](int i, int k) -> uint8_t { return i < nStone ? STONE : (i < nStonePlant ? grid[k] : ICE); };

    auto translateAssembly = [&](Group* grp, std::unordered_set<int>& cells, int dir) -> bool {
      int dy = dir > 0 ? 1 : -1;
      std::unordered_set<int> movedCells;
      for (int k : cells) { int leadK = k + dir; int leadY = leadK / cols; if (leadY < 1 || leadY >= rows) return false; if (cells.count(leadK)) continue; if (!componentDisplaceable(grid[leadK])) return false; }
      for (int k : cells) movedCells.insert(k + dir);
      struct Disp { uint8_t material; int from; };
      std::vector<Disp> displaced; std::vector<int> vacated;
      for (int k : cells) { int leadK = k + dir; uint8_t lead = grid[leadK]; if (!cells.count(leadK) && lead != EMPTY && componentDisplaceable(lead)) displaced.push_back({lead, leadK}); if (!cells.count(k - dir)) vacated.push_back(k); }
      int liquidDisplacedCount = 0; for (auto& d : displaced) if (isLiquid(d.material)) liquidDisplacedCount++;
      std::vector<int> sideSpillTargets;
      if (liquidDisplacedCount > 0) {
        std::unordered_set<int> seen, reserved; std::vector<int> queue;
        int offs[4]; if (dir > 0) { offs[0] = -1; offs[1] = 1; offs[2] = cols; offs[3] = -cols; } else { offs[0] = -1; offs[1] = 1; offs[2] = -cols; offs[3] = cols; }
        int gridLen = cols * rows;
        auto canVisit = [&](int k) { if (k < 0 || k >= gridLen || seen.count(k)) return false; int y = k / cols, x = k - y * cols; if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return false; if (cells.count(k) || movedCells.count(k)) return false; uint8_t m = grid[k]; return m == EMPTY || isLiquid(m); };
        auto enqueue = [&](int k) { if (!canVisit(k)) return; seen.insert(k); queue.push_back(k); };
        for (auto& d : displaced) { if (!isLiquid(d.material)) continue; for (int off : offs) enqueue(d.from + off); }
        for (size_t qi = 0; qi < queue.size() && (int)sideSpillTargets.size() < liquidDisplacedCount; qi++) {
          int k = queue[qi];
          if (grid[k] == EMPTY) { if (!reserved.count(k)) { reserved.insert(k); sideSpillTargets.push_back(k); } continue; }
          for (int off : offs) enqueue(k + off);
        }
        if ((int)sideSpillTargets.size() < liquidDisplacedCount) return false;
      }
      struct Move { Comp* comp; bool isPlant; std::vector<std::pair<int, uint8_t>> mats; int wood, leaf; };
      std::vector<Move> moves;
      for (int ci : grp->comps) {
        Comp* comp = all[ci]; bool isPlant = ci >= nStone && ci < nStonePlant;
        std::vector<std::pair<int, uint8_t>> mats; int wood = 0, leaf = 0;
        for (int k : comp->cells) { uint8_t m = matOf(ci, k); mats.push_back({k + dir, m}); if (isPlant) { if (m == WOOD) wood++; else if (m == PLANT) leaf++; } }
        moves.push_back({comp, isPlant, std::move(mats), wood, leaf});
      }
      for (int k : cells) writeGridIndex(k, EMPTY);
      for (auto& mv : moves) {
        std::unordered_set<int> newCells;
        for (auto& pr : mv.mats) { writeGridIndex(pr.first, pr.second); newCells.insert(pr.first); }
        mv.comp->cells = std::move(newCells);
        mv.comp->yMax = imax(0, imin(rows - 1, mv.comp->yMax + dy));
        if (mv.isPlant) { mv.comp->woodCount = mv.wood; mv.comp->leafCount = mv.leaf; mv.comp->cacheDirty = true; }
      }
      int di = 0, si = 0;
      for (auto& d : displaced) {
        if (isLiquid(d.material)) { writeGridIndex(sideSpillTargets[si++], d.material); continue; }
        while (di < (int)vacated.size() && grid[vacated[di]] != EMPTY) di++;
        if (di < (int)vacated.size()) writeGridIndex(vacated[di++], d.material);
      }
      return true;
    };

    // measureLiquidImmersion returns via out-params; returns false if "null".
    auto measureLiquidImmersion = [&](std::unordered_set<int>& cells, int& wetCells, int& exposedCells, int& bottomExposed, int& bottomLiquid, double& liquidDensityOut) -> bool {
      wetCells = 0; exposedCells = 0; bottomExposed = 0; bottomLiquid = 0;
      double liquidDensity = 0; int liquidContacts = 0;
      for (int k : cells) {
        int y = k / cols, x = k - y * cols; bool wet = false, exposed = false;
        if (x > 1 && !cells.count(k - 1)) { exposed = true; uint8_t m = grid[k - 1]; if (isLiquid(m)) { wet = true; liquidDensity += DENSITY[m]; liquidContacts++; } }
        if (x < cols - 2 && !cells.count(k + 1)) { exposed = true; uint8_t m = grid[k + 1]; if (isLiquid(m)) { wet = true; liquidDensity += DENSITY[m]; liquidContacts++; } }
        if (y > 1 && !cells.count(k - cols)) { exposed = true; }
        if (y < rows - 1 && !cells.count(k + cols)) { exposed = true; bottomExposed++; uint8_t m = grid[k + cols]; if (isLiquid(m)) { wet = true; bottomLiquid++; liquidDensity += DENSITY[m]; liquidContacts++; } }
        if (exposed) exposedCells++; if (wet) wetCells++;
      }
      if (liquidContacts == 0) return false;
      int requiredWet = imax(1, (int)std::ceil(std::sqrt((double)cells.size()) * BUOY_WET_PERIMETER_FRAC));
      if (wetCells < requiredWet) return false;
      liquidDensityOut = liquidDensity / liquidContacts;
      return true;
    };

    for (Group* grp : order) {
      if (grp->grounded) continue;
      std::unordered_set<int> cells;
      for (int ci : grp->comps) for (int k : all[ci]->cells) cells.insert(k);
      double weight = 0; int xMin = cols, xMax = 0;
      for (int ci : grp->comps) for (int k : all[ci]->cells) { weight += DENSITY[matOf(ci, k)]; int x = k - (k / cols) * cols; if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      int wetCells, exposedCells, bottomExposed, bottomLiquid; double liquidDensity;
      if (!measureLiquidImmersion(cells, wetCells, exposedCells, bottomExposed, bottomLiquid, liquidDensity)) { translateAssembly(grp, cells, cols); continue; }
      double avgDensity = weight / cells.size();
      if (avgDensity > liquidDensity) { translateAssembly(grp, cells, cols); continue; }
      double targetWetCells = exposedCells * (avgDensity / liquidDensity) * BUOY_DRAFT_SCALE;
      double imbalance = wetCells - targetWetCells;
      double band = std::fmax(BUOY_BAND_MIN, (xMax - xMin + 1) * BUOY_BAND_FRAC);
      bool buoyantSupport = bottomExposed > 0 && bottomLiquid >= bottomExposed * BUOY_SUPPORT_FRAC;
      if (imbalance < -band) translateAssembly(grp, cells, cols);
      else if (imbalance > band) { if (buoyantSupport) translateAssembly(grp, cells, -cols); else translateAssembly(grp, cells, cols); }
    }
  }

  void floodComponent(int sx, int sy, std::vector<uint8_t>& seen, bool bounded, std::unordered_set<int>& outCells, int& outYMax,
                      bool (Engine::*matCheck)(uint8_t)) {
    int bx = bounded ? sx >> CHUNK_SHIFT : 0, by = bounded ? sy >> CHUNK_SHIFT : 0;
    int k0 = sy * cols + sx;
    outCells.clear(); outCells.insert(k0); outYMax = sy; seen[k0] = 1;
    std::vector<int> queue; queue.push_back(k0);
    for (size_t qi = 0; qi < queue.size(); qi++) {
      int cur = queue[qi]; int y = cur / cols, x = cur - y * cols; if (y > outYMax) outYMax = y;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy;
        if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows) continue;
        if (bounded && ((nx >> CHUNK_SHIFT) != bx || (ny >> CHUNK_SHIFT) != by)) continue;
        int nk = ny * cols + nx; if (seen[nk] || !(this->*matCheck)(grid[nk])) continue;
        seen[nk] = 1; outCells.insert(nk); queue.push_back(nk);
      }
    }
  }
  bool isStone(uint8_t m) { return m == STONE; }
  bool isIce(uint8_t m) { return m == ICE; }
  bool isPlantMat(uint8_t m) { return isPlantMaterial(m); }

  void registerSeededComponents(int colStart, int colEnd) {
    size_t n = (size_t)cols * rows;
    // STONE (chunk-bounded)
    {
      std::vector<uint8_t> seen(n, 0);
      for (auto& comp : stoneComponents) for (int k : comp.cells) seen[k] = 1;
      for (int sy = 0; sy < rows; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] || grid[k] != STONE) continue;
        std::unordered_set<int> cells; int yMax;
        floodComponent(sx, sy, seen, true, cells, yMax, &Engine::isStone);
        Comp c; c.id = nextStoneId++; c.cells = std::move(cells); c.yMax = yMax; stoneComponents.push_back(std::move(c));
      }
    }
    // PLANT family
    {
      std::vector<uint8_t> seen(n, 0);
      for (auto& comp : plantComponents) for (int k : comp.cells) seen[k] = 1;
      for (int sy = 0; sy < rows; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] || !isPlantMaterial(grid[k])) continue;
        std::unordered_set<int> cells; int yMax;
        floodComponent(sx, sy, seen, false, cells, yMax, &Engine::isPlantMat);
        Comp c; c.id = nextPlantId++; c.yMax = yMax; c.age = 0; c.cacheDirty = true;
        for (int kk : cells) { if (grid[kk] == WOOD) c.woodCount++; else if (grid[kk] == PLANT) c.leafCount++; }
        c.cells = std::move(cells); plantComponents.push_back(std::move(c));
      }
    }
    // ICE
    {
      std::vector<uint8_t> seen(n, 0);
      for (auto& comp : iceComponents) for (int k : comp.cells) seen[k] = 1;
      for (int sy = 0; sy < rows; sy++) for (int sx = colStart; sx < colEnd; sx++) {
        int k = sy * cols + sx; if (seen[k] || grid[k] != ICE) continue;
        std::unordered_set<int> cells; int yMax;
        floodComponent(sx, sy, seen, false, cells, yMax, &Engine::isIce);
        Comp c; c.id = nextIceId++; c.cells = std::move(cells); c.yMax = yMax; c.cacheDirty = true; iceComponents.push_back(std::move(c));
      }
    }
  }

  void registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) {
    if (cells.empty()) return;
    std::unordered_set<int> touchingIds;
    for (int k : cells) {
      int y = k / cols, x = k - y * cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx;
        if (grid[nk] != mat || cells.count(nk)) continue;
        for (auto& comp : list) if (comp.cells.count(nk)) { touchingIds.insert(comp.id); break; }
      }
    }
    Comp newComp; newComp.id = nextId++; newComp.cells = cells; newComp.yMax = yMax; newComp.cacheDirty = iceCache;
    if (!touchingIds.empty()) {
      std::vector<Comp> keep;
      for (auto& comp : list) {
        if (touchingIds.count(comp.id)) { for (int k : comp.cells) { newComp.cells.insert(k); int y = k / cols; if (y > newComp.yMax) newComp.yMax = y; } }
        else keep.push_back(std::move(comp));
      }
      list = std::move(keep);
    }
    list.push_back(std::move(newComp));
  }

  // split a plant-family component list keeping only cells still of plant material
  void splitPlantAfterErase() {
    std::vector<Comp> updated;
    for (auto& comp : plantComponents) {
      std::unordered_set<int> remaining;
      for (int k : comp.cells) if (isPlantMaterial(grid[k])) remaining.insert(k);
      bool reused = false;
      while (!remaining.empty()) {
        int start = *remaining.begin();
        std::vector<int> queue; queue.push_back(start);
        std::unordered_set<int> part; part.insert(start); remaining.erase(start);
        for (size_t qi = 0; qi < queue.size(); qi++) {
          int cur = queue[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (remaining.count(nk)) { remaining.erase(nk); part.insert(nk); queue.push_back(nk); } }
        }
        Comp c; c.id = reused ? nextPlantId++ : comp.id; c.yMax = 0; c.age = comp.age; c.cacheDirty = true;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; if (grid[k] == WOOD) c.woodCount++; else if (grid[k] == PLANT) c.leafCount++; }
        c.cells = std::move(part); updated.push_back(std::move(c)); reused = true;
      }
    }
    plantComponents = std::move(updated);
  }
  // split stone/ice after erase: remove erased cells, re-flood
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache) {
    if (erased.empty() || list.empty()) return;
    std::vector<Comp> updated;
    for (auto& comp : list) {
      bool touched = false;
      for (int k : erased) if (comp.cells.erase(k)) touched = true;
      if (!touched) { updated.push_back(std::move(comp)); continue; }
      if (comp.cells.empty()) continue;
      std::unordered_set<int> remaining = comp.cells;
      while (!remaining.empty()) {
        int start = *remaining.begin();
        std::vector<int> queue; queue.push_back(start);
        std::unordered_set<int> part; part.insert(start); remaining.erase(start);
        for (size_t qi = 0; qi < queue.size(); qi++) {
          int cur = queue[qi]; int y = cur / cols, x = cur - y * cols;
          for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; int nx = x + ox, ny = y + oy; if (!isInBounds(nx, ny)) continue; int nk = ny * cols + nx; if (remaining.count(nk)) { remaining.erase(nk); part.insert(nk); queue.push_back(nk); } }
        }
        Comp c; c.id = nextId++; c.yMax = 0; c.cacheDirty = iceCache;
        for (int k : part) { int y = k / cols; if (y > c.yMax) c.yMax = y; }
        c.cells = std::move(part); updated.push_back(std::move(c));
      }
    }
    list = std::move(updated);
  }

  // ================= REACTIONS (reactions.js) =================
  void applyReactions() {
    int steamCount = 0, fireCount = 0, igniteCount = 0; bool plantBurned = false;
    int igniteCap = (int)reactionIgnite.size();
    for (int y = 1; y < rows; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != WATER) continue;
        int nk = grid[k + 1] == FIRE ? k + 1 : (grid[k - 1] == FIRE ? k - 1 : -1);
        if (nk < 0 && y < rows - 1 && grid[k + cols] == FIRE) nk = k + cols;
        if (nk < 0 && grid[k - cols] == FIRE) nk = k - cols;
        if (nk >= 0) { reactionSteam[steamCount++] = k; if (!reactionFlags[nk]) { reactionFlags[nk] = 1; reactionFires[fireCount++] = nk; } }
      }
    }
    for (int y = 1; y < rows; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != FIRE || reactionFlags[k]) continue;
        int neigh[4]; int nn; if (y < rows - 1) { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k + cols; neigh[3] = k - cols; nn = 4; } else { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k - cols; nn = 3; }
        for (int ni = 0; ni < nn; ni++) {
          int nk = neigh[ni];
          if (grid[nk] == OIL) {
            if (rand() > OIL_IGNITE_P) continue;
            if (igniteCount < igniteCap) reactionIgnite[igniteCount++] = nk;
            if (rand() < FIRE_SPREAD_P) {
              int oilY = nk / cols; int on[4]; int onn; if (oilY < rows - 1) { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk + cols; on[3] = nk - cols; onn = 4; } else { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk - cols; onn = 3; }
              for (int oi = 0; oi < onn; oi++) { int ok = on[oi]; if (grid[ok] == OIL && rand() < 0.12 && igniteCount < igniteCap) reactionIgnite[igniteCount++] = ok; }
            }
          } else if (isPlantMaterial(grid[nk]) && rand() < PLANT_IGNITE_P) { if (igniteCount < igniteCap) reactionIgnite[igniteCount++] = nk; }
        }
      }
    }
    for (int i = 0; i < fireCount; i++) { int k = reactionFires[i]; if (grid[k] == FIRE) writeGridIndex(k, EMPTY); reactionFlags[k] = 0; }
    for (int i = 0; i < steamCount; i++) { int k = reactionSteam[i]; if (grid[k] == WATER) writeGridIndex(k, STEAM); }
    for (int i = 0; i < igniteCount; i++) { int k = reactionIgnite[i]; if (grid[k] == OIL || isPlantMaterial(grid[k])) { plantBurned = plantBurned || isPlantMaterial(grid[k]); writeGridIndex(k, FIRE); } }
    if (plantBurned) splitPlantAfterErase();
  }
  void applyAcid() {
    bool dissolvedStone = false, dissolvedPlant = false; std::vector<int> erasedStone;
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != ACID) continue;
        int right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        if (!isDissolvable(grid[right]) && !isDissolvable(grid[left]) && !isDissolvable(grid[down]) && !isDissolvable(grid[up])) continue;
        if (rand() >= ACID_DISSOLVE_P) continue;
        bool hf = rand() < 0.5; int a = hf ? right : down, b = hf ? left : up, c = hf ? down : right, d = hf ? up : left;
        int target = -1;
        if (isDissolvable(grid[a])) target = a; else if (isDissolvable(grid[b])) target = b; else if (isDissolvable(grid[c])) target = c; else if (isDissolvable(grid[d])) target = d;
        if (target < 0) continue;
        uint8_t tm = grid[target];
        if (tm == STONE) { erasedStone.push_back(target); dissolvedStone = true; } else if (isPlantMaterial(tm)) dissolvedPlant = true;
        writeGridIndex(target, EMPTY);
        if (rand() < ACID_DECAY_P) writeGridIndex(k, EMPTY);
      }
    }
    if (dissolvedStone) splitRigidAfterErase(stoneComponents, erasedStone, nextStoneId, false);
    if (dissolvedPlant) splitPlantAfterErase();
  }
  void applyLava() {
    std::unordered_set<int> hardened; int hardenedYMax = 0; bool plantBurned = false;
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]), maxX = imin(cols - 2, activeRowMax[y]); if (maxX < minX) continue;
      for (int x = minX; x <= maxX; x++) {
        int k = I(x, y); if (grid[k] != LAVA) continue;
        int right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        int burnK = -1;
        if (isFlammable(grid[right])) burnK = right; else if (isFlammable(grid[left])) burnK = left; else if (isFlammable(grid[down])) burnK = down; else if (isFlammable(grid[up])) burnK = up;
        if (burnK >= 0) { if (isPlantMaterial(grid[burnK])) plantBurned = true; writeGridIndex(burnK, FIRE); continue; }
        int liquidK = -1;
        if (grid[right] == WATER || grid[right] == ACID) liquidK = right; else if (grid[left] == WATER || grid[left] == ACID) liquidK = left; else if (grid[down] == WATER || grid[down] == ACID) liquidK = down; else if (grid[up] == WATER || grid[up] == ACID) liquidK = up;
        if (liquidK >= 0) { writeGridIndex(liquidK, STEAM); writeGridIndex(k, STONE); hardened.insert(k); if (y > hardenedYMax) hardenedYMax = y; continue; }
        if (rand() < LAVA_EMIT_FIRE_P) { int airK = -1; if (grid[up] == EMPTY) airK = up; else if (grid[right] == EMPTY) airK = right; else if (grid[left] == EMPTY) airK = left; if (airK >= 0) writeGridIndex(airK, FIRE); }
      }
    }
    if (!hardened.empty()) registerRigidCells(stoneComponents, nextStoneId, STONE, hardened, hardenedYMax, false);
    if (plantBurned) splitPlantAfterErase();
  }
  void applyIce() {
    bool melted = false; std::vector<int> meltedCells;
    for (auto& comp : iceComponents) {
      std::vector<int> cells(comp.cells.begin(), comp.cells.end());
      for (int k : cells) {
        if (grid[k] != ICE) continue;
        int right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        uint8_t rm = grid[right], lm = grid[left], dm = grid[down], um = grid[up];
        if (rm == FIRE || rm == LAVA || lm == FIRE || lm == LAVA || dm == FIRE || dm == LAVA || um == FIRE || um == LAVA) { writeGridIndex(k, WATER); meltedCells.push_back(k); melted = true; continue; }
        if (rand() < ICE_FREEZE_P) {
          int waterK = -1; if (rm == WATER) waterK = right; else if (lm == WATER) waterK = left; else if (dm == WATER) waterK = down; else if (um == WATER) waterK = up;
          if (waterK >= 0) { writeGridIndex(waterK, ICE); comp.cells.insert(waterK); int wy = waterK / cols; if (wy > comp.yMax) comp.yMax = wy; comp.cacheDirty = true; }
        }
      }
    }
    if (melted) splitRigidAfterErase(iceComponents, meltedCells, nextIceId, true);
  }

  // ================= GROWTH (growth.js) =================
  bool findWaterTouching(Comp& comp, int count, std::vector<int>& picked) {
    std::vector<int> candidates; std::unordered_set<int> seen;
    auto consider = [&](int nk) { if (grid[nk] != WATER || seen.count(nk)) return; seen.insert(nk); candidates.push_back(nk); };
    for (int k : comp.cells) { uint8_t m = grid[k]; if (m != SEED && m != WOOD) continue; int x = k % cols, y = k / cols; if (x < cols - 2) consider(k + 1); if (x > 1) consider(k - 1); if (y < rows - 1) consider(k + cols); if (y > 1) consider(k - cols); }
    if ((int)candidates.size() < count) return false;
    picked.clear();
    while ((int)picked.size() < count && !candidates.empty()) { int i = (int)(rand() * candidates.size()); picked.push_back(candidates[i]); candidates.erase(candidates.begin() + i); }
    return (int)picked.size() == count;
  }
  void refreshPlantCache(Comp& comp) {
    if (!comp.cacheDirty && !comp.woodCells.empty()) return; // approximates the JS guard
    comp.woodCells.clear(); comp.seedWoodCells.clear();
    for (int k : comp.cells) { uint8_t m = grid[k]; if (m == WOOD) { comp.woodCells.push_back(k); comp.seedWoodCells.push_back(k); } else if (m == SEED) comp.seedWoodCells.push_back(k); }
    auto byRow = [this](int a, int b) { return (a / cols) < (b / cols); };
    std::stable_sort(comp.woodCells.begin(), comp.woodCells.end(), byRow);
    std::stable_sort(comp.seedWoodCells.begin(), comp.seedWoodCells.end(), byRow);
    comp.cacheDirty = false;
  }
  int tryGrowWood(Comp& comp, std::unordered_set<int>& reserved) {
    refreshPlantCache(comp);
    std::vector<int>& sources = !comp.woodCells.empty() ? comp.woodCells : comp.seedWoodCells;
    for (int source : sources) {
      int y = source / cols, x = source - y * cols;
      bool branchReady = comp.woodCount > 16; int branchDir = rand() < 0.5 ? -1 : 1;
      int cand[5][2]; int nc;
      if (branchReady && rand() < 0.55) { cand[0][0] = x + branchDir; cand[0][1] = y - 1; cand[1][0] = x + branchDir * 2; cand[1][1] = y - 1; cand[2][0] = x + branchDir; cand[2][1] = y; cand[3][0] = x; cand[3][1] = y - 1; cand[4][0] = x - branchDir; cand[4][1] = y - 1; nc = 5; }
      else { cand[0][0] = x; cand[0][1] = y - 1; cand[1][0] = x - 1; cand[1][1] = y - 1; cand[2][0] = x + 1; cand[2][1] = y - 1; cand[3][0] = x - 1; cand[3][1] = y; cand[4][0] = x + 1; cand[4][1] = y; nc = 5; }
      for (int i = 0; i < nc; i++) { int tx = cand[i][0], ty = cand[i][1]; if (!isInBounds(tx, ty)) continue; int tk = I(tx, ty); if (grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
    }
    return -1;
  }
  bool addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
    if (k < 0 || k >= cols * rows || grid[k] != EMPTY || reserved.count(k)) return false;
    growth.push_back({k, WOOD}); reserved.insert(k); return true;
  }
  void thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved) {
    if (comp.woodCount >= TRUNK_THICKEN_UNTIL_WOOD || rand() > TRUNK_SIDE_FILL_P) return;
    int y = k / cols, x = k - y * cols; const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) { int tx = x + dirs[i]; if (!isInBounds(tx, y)) continue; if (addWoodIfOpen(I(tx, y), growth, reserved)) break; }
    if (rand() > TRUNK_DOUBLE_SIDE_FILL_P) return;
    for (int i = 0; i < 2; i++) { int tx = x - dirs[i]; if (!isInBounds(tx, y)) continue; if (addWoodIfOpen(I(tx, y), growth, reserved)) break; }
    if (rand() > TRUNK_WIDE_SIDE_FILL_P) return;
    for (int i = 0; i < 2; i++) { int tx = x + dirs[i] * 2; if (!isInBounds(tx, y)) continue; if (addWoodIfOpen(I(tx, y), growth, reserved)) break; }
  }
  int tryGrowLeaf(Comp& comp, std::unordered_set<int>& reserved) {
    refreshPlantCache(comp);
    if (comp.woodCells.empty()) return -1;
    for (int source : comp.woodCells) {
      int y = source / cols, x = source - y * cols;
      int cand[11][2] = {{x, y - 1}, {x - 1, y}, {x + 1, y}, {x - 1, y - 1}, {x + 1, y - 1}, {x - 2, y}, {x + 2, y}, {x - 2, y - 1}, {x + 2, y - 1}, {x - 3, y}, {x + 3, y}};
      int start = (int)(rand() * 11); int step = rand() < 0.5 ? 1 : -1;
      for (int i = 0; i < 11; i++) { int idx = ((start + i * step) % 11 + 11) % 11; int tx = cand[idx][0], ty = cand[idx][1]; if (!isInBounds(tx, ty)) continue; int tk = I(tx, ty); if (grid[tk] == EMPTY && !reserved.count(tk)) return tk; }
    }
    return -1;
  }
  void growPlantComponents() {
    if (plantComponents.empty()) return;
    for (auto& comp : plantComponents) {
      comp.age++;
      std::vector<int> waterCells;
      if (!findWaterTouching(comp, WATER_PER_GROWTH, waterCells)) continue;
      for (int wk : waterCells) markCellIndex(wk);
      if (rand() > GROWTH_P) continue;
      std::vector<std::pair<int, uint8_t>> growth; std::unordered_set<int> reserved;
      bool shouldGrowWood = comp.woodCount < MAX_WOOD_CELLS && (comp.woodCount < 18 || rand() > LEAF_GROWTH_P);
      if (shouldGrowWood) {
        int firstWood = tryGrowWood(comp, reserved);
        if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) thickenTrunkAround(firstWood, comp, growth, reserved);
        int extraWood = tryGrowWood(comp, reserved);
        if (extraWood >= 0 && rand() < 0.72) addWoodIfOpen(extraWood, growth, reserved);
      }
      if (growth.empty() && comp.woodCount >= 6 && comp.leafCount < MAX_LEAF_CELLS) {
        int leafCount = rand() < 0.35 ? 2 : 1;
        for (int i = 0; i < leafCount; i++) { int leafK = tryGrowLeaf(comp, reserved); if (leafK >= 0) { growth.push_back({leafK, PLANT}); reserved.insert(leafK); } }
      }
      if (growth.empty()) continue;
      for (int wk : waterCells) writeGridIndex(wk, EMPTY);
      for (auto& g : growth) { int targetK = g.first; uint8_t material = g.second; if (grid[targetK] != EMPTY) continue; writeGridIndex(targetK, material); comp.cells.insert(targetK); int y = targetK / cols; if (y > comp.yMax) comp.yMax = y; if (material == WOOD) comp.woodCount++; else comp.leafCount++; comp.cacheDirty = true; }
    }
  }

  // ---- step ----
  bool step() {
    if (!beginStepDirty()) return false;
    double t0 = emscripten_get_now();
    tick++;
    computeGrounded();
    moveRigidAssemblies();
    moveBodies();
    growPlantComponents();
    applyReactions(); applyAcid(); applyLava(); applyIce();
    prepareNextBuffer();
    // carry-forward component + body cells across the double buffer
    curCompCells.clear();
    for (auto& comp : stoneComponents) for (int k : comp.cells) { next[k] = STONE; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (auto& comp : plantComponents) for (int k : comp.cells) { next[k] = grid[k]; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (auto& comp : iceComponents) for (int k : comp.cells) { next[k] = ICE; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (int k : bodyCells) { next[k] = RIGID; compOccStamp[k] = tick; curCompCells.push_back(k); }
    for (int k : prevCompCells) {
      if (compOccStamp[k] == tick) continue;
      if (grid[k] == EMPTY) { next[k] = EMPTY; markCellIndex(k); }
      else if (!isRigidMaterial(grid[k]) && isRigidMaterial(next[k])) { next[k] = grid[k]; markCellIndex(k); }
    }
    std::swap(prevCompCells, curCompCells);

    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) settleLooseDensityInterface(x, y, rb + x); else for (int x = maxX; x >= minX; x--) settleLooseDensityInterface(x, y, rb + x); }
    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { if (MAT_KIND[grid[rb + x]] == K_POWDER) settleSand(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { if (MAT_KIND[grid[rb + x]] == K_POWDER) settleSand(x, y, rb + x); } }
    for (int y = rows - 1; y >= 0; y--) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } else for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rb + x); else settleLiquid(x, y, rb + x, m); } }
    for (int y = 0; y < rows; y++) { int minX = activeRowMin[y], maxX = activeRowMax[y]; if (maxX < minX) continue; int rb = y * cols; bool ltr = (y & 1) == 0; if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x); } else for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rb + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rb + x); else riseSteam(x, y, rb + x); } }
    uint8_t* tmp = grid; grid = next; next = tmp;
    if ((tick & 1) == 0) relaxLiquidGaps();
    if (tick % 3 == 0) separateLooseByDensity();
    applySideSinks();
    perfStepMs = emscripten_get_now() - t0;
    return true;
  }

  // ================= TOOLS (tools.js) =================
  int paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if ((overwrite || grid[k] == EMPTY) && grid[k] != material) { grid[k] = material; changed = 1; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  int eraseDisc(int cx, int cy, int radius) {
    std::vector<int> erasedStone, erasedIce, bodyCellList; bool erasedPlant = false; int changed = 0;
    std::unordered_map<int, Body*> bodyById; std::unordered_set<Body*> dirtyBodies;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy);
      if (grid[k] == RIGID) { if (bodyById.empty()) for (Body* b : bodies) bodyById[b->id] = b; if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = 1; }
      if (grid[k] != EMPTY) { if (grid[k] == STONE) erasedStone.push_back(k); else if (grid[k] == ICE) erasedIce.push_back(k); if (isPlantMaterial(grid[k])) erasedPlant = true; if (grid[k] == RIGID) bodyOwner[k] = -1; grid[k] = EMPTY; changed = 1; }
      if (stoneDraft.erase(k)) changed = 1; if (iceDraft.erase(k)) changed = 1;
    } }
    finishErasedBodies(dirtyBodies, bodyCells);
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    splitRigidAfterErase(stoneComponents, erasedStone, nextStoneId, false);
    splitRigidAfterErase(iceComponents, erasedIce, nextIceId, true);
    if (erasedPlant && !plantComponents.empty()) splitPlantAfterErase();
    return changed;
  }
  int addDiscToDraft(std::unordered_set<int>& draft, int cx, int cy, int radius, int yLimit) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= yLimit) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy); if (grid[k] == EMPTY && !draft.count(k)) { draft.insert(k); changed = 1; } } }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  void finalizeStoneDraft() {
    if (stoneDraft.empty()) return;
    std::unordered_set<int> cells; int yMax = 0;
    for (int k : stoneDraft) if (grid[k] == EMPTY) { grid[k] = STONE; markCellIndex(k); cells.insert(k); int y = k / cols; if (y > yMax) yMax = y; }
    registerRigidCells(stoneComponents, nextStoneId, STONE, cells, yMax, false);
  }
  void finalizeIceDraft() {
    if (iceDraft.empty()) return;
    std::unordered_set<int> cells; int yMax = 0;
    for (int k : iceDraft) if (grid[k] == EMPTY) { grid[k] = ICE; markCellIndex(k); cells.insert(k); int y = k / cols; if (y > yMax) yMax = y; }
    registerRigidCells(iceComponents, nextIceId, ICE, cells, yMax, true);
  }
  void finalizeDriftwoodDraft() {
    if (stoneDraft.empty()) return;
    for (int k : stoneDraft) if (grid[k] == EMPTY) { grid[k] = DRIFTWOOD; markCellIndex(k); }
    registerSeededComponents(0, cols);
  }
  bool getSeedOrigin(int cx, int cy, int& x0, int& y0) {
    x0 = (int)std::floor(cx - SEED_SIZE / 2.0); y0 = (int)std::floor(cy - SEED_SIZE / 2.0);
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    return true;
  }
  bool canPlaceSeedAt(int x0, int y0) {
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) if (grid[I(x, y)] != EMPTY) return false;
    return true;
  }
  bool placeSeedAt(int x0, int y0) {
    if (!canPlaceSeedAt(x0, y0)) return false;
    Comp c; c.id = nextPlantId++; c.yMax = 0; c.age = 0; c.cacheDirty = true;
    for (int y = y0; y < y0 + SEED_SIZE; y++) for (int x = x0; x < x0 + SEED_SIZE; x++) { int k = I(x, y); grid[k] = SEED; c.cells.insert(k); if (y > c.yMax) c.yMax = y; }
    plantComponents.push_back(std::move(c));
    markDirtyRect(x0, y0, x0 + SEED_SIZE - 1, y0 + SEED_SIZE - 1);
    return true;
  }

  // ================= WORLDGEN STREAMING (streamGen.js + worldWindow.js) =================
  static const double SURFACE_FREQ, CAVE_FREQ, CAVE_THRESH, TREE_PROB;
  static const int SURFACE_OCT, GEN_SKIN;
  int genSurfaceAt(int worldX) {
    double n = wfbm2(worldSeed, worldX * SURFACE_FREQ, 0.5, SURFACE_OCT, 0.5);
    int y = (int)std::lround(gSurfBase - (n - 0.5) * 2 * gSurfAmp);
    if (y < 2) y = 2; if (y > rows - 4) y = rows - 4; return y;
  }
  bool genIsCave(int worldX, int y) { return wridged2(gCaveSeed, worldX * CAVE_FREQ, y * CAVE_FREQ, 3, 0.5) > CAVE_THRESH; }
  uint8_t genCellAt(int worldX, int surf, int slope, int y) {
    if (y < surf) return y >= gSeaRow ? WATER : EMPTY;
    int depth = y - surf;
    if (depth < GEN_SKIN) return slope <= 1 ? PLANT : SAND;
    if (depth < GEN_SKIN + gSoil) return SAND;
    if (depth >= GEN_SKIN + gSoil + 2 && genIsCave(worldX, y)) return EMPTY;
    return STONE;
  }
  bool genTreeAt(int worldX, int surf) { return surf <= gSeaRow && whash1(gTreeSeed, worldX) < TREE_PROB; }
  void fillBand(int colStart, int colCount, int wOffsetX) {
    int colEnd = colStart + colCount;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < 0 || y >= rows) return; grid[y * cols + lx] = m; };
    for (int lx = colStart; lx < colEnd; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      int slope = std::abs(genSurfaceAt(worldX + 1) - genSurfaceAt(worldX - 1));
      for (int y = 0; y < rows; y++) grid[y * cols + lx] = genCellAt(worldX, surf, slope, y);
    }
    const int TREE_REACH = 4;
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = wOffsetX + lx; int surf = genSurfaceAt(worldX);
      if (!genTreeAt(worldX, surf)) continue;
      int h = 6 + (int)(whash1(gTreeSeed + 1, worldX) * 7);
      int top = surf - h;
      for (int y = top; y < surf; y++) put(lx, y, WOOD);
      for (int oy = -3; oy <= 1; oy++) for (int ox = -3; ox <= 3; ox++) { if (ox * ox + oy * oy > 9) continue; put(lx + ox, top + oy, PLANT); }
    }
    for (int lx = colStart; lx < colEnd; lx++) for (int y = 0; y < rows; y++) { int k = y * cols + lx; next[k] = grid[k]; }
  }
  void initInfinite(uint32_t seed) {
    infinite = true; worldSeed = seed;
    gSurfAmp = imax(16, (int)std::floor(rows * 0.16));
    gSurfBase = imax(8, (int)std::floor(rows * 0.24));
    gSeaRow = gSurfBase + imax(2, (int)std::floor(rows * 0.05));
    gSoil = imax(3, (int)std::floor(rows * 0.045));
    gCaveSeed = seed ^ 0x5bd1e995u; gTreeSeed = seed ^ 0x1b56c4f9u;
    worldOffsetX = -(cols / 2);
    fillBand(0, cols, worldOffsetX);
    registerSeededComponents(0, cols);
  }
  void shiftRowMajorU8(uint8_t* arr, int dx, uint8_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, cols - dx); memset(arr + b + cols - dx, fill, dx); }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, cols - s); memset(arr + b, fill, s); } }
  }
  void translateComponents(std::vector<Comp>& list, int dx) {
    std::vector<Comp> kept;
    for (auto& comp : list) {
      std::unordered_set<int> cells; int yMax = 0;
      for (int k : comp.cells) { int nx = (k % cols) - dx; if (nx < 0 || nx >= cols) continue; int nk = k - dx; cells.insert(nk); int y = nk / cols; if (y > yMax) yMax = y; }
      if (cells.empty()) continue;
      comp.cells = std::move(cells); comp.yMax = yMax; comp.cacheDirty = true;
      kept.push_back(std::move(comp));
    }
    list = std::move(kept);
  }
  void shiftWorld(int dx) {
    if (!dx || !infinite) return;
    int s = std::abs(dx);
    if (s >= cols) return;
    int oldOffset = worldOffsetX, newOffset = oldOffset + dx;
    int enterColStart = dx > 0 ? cols - s : 0;
    shiftRowMajorU8(grid, dx, EMPTY);
    shiftRowMajorU8(next, dx, EMPTY);
    for (int y = 0; y < rows; y++) {
      if (rowMarkMax[y] < rowMarkMin[y]) continue;
      int mn = rowMarkMin[y] - dx, mx = rowMarkMax[y] - dx;
      if (mx < 0 || mn > cols - 1) { rowMarkMin[y] = cols; rowMarkMax[y] = -1; continue; }
      rowMarkMin[y] = mn < 0 ? 0 : mn; rowMarkMax[y] = mx > cols - 1 ? cols - 1 : mx;
    }
    std::fill(compOccStamp.begin(), compOccStamp.end(), -1);
    std::fill(vacatedStamp.begin(), vacatedStamp.end(), -1);
    fillBand(enterColStart, s, newOffset);
    worldOffsetX = newOffset;
    for (int y = 0; y < rows; y++) { if (enterColStart < rowMarkMin[y]) rowMarkMin[y] = enterColStart; if (enterColStart + s - 1 > rowMarkMax[y]) rowMarkMax[y] = enterColStart + s - 1; }
    // un-stamp free bodies before the shift, then translate / drop them
    for (int k : bodyCells) { if (grid[k] == RIGID) grid[k] = EMPTY; if (next[k] == RIGID) next[k] = EMPTY; bodyOwner[k] = -1; }
    bodyCells.clear();
    {
      std::vector<Body*> keep;
      for (Body* b : bodies) { b->px -= dx; if (b->px > -b->maxR && b->px < cols + b->maxR) keep.push_back(b); else delete b; }
      bodies = std::move(keep);
    }
    shiftRowMajorI32(bodyOwner.data(), dx, -1);
    translateComponents(stoneComponents, dx);
    translateComponents(plantComponents, dx);
    translateComponents(iceComponents, dx);
    registerSeededComponents(enterColStart, enterColStart + s);
  }
  void shiftRowMajorI32(int32_t* arr, int dx, int32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * 4); for (int i = b + cols - dx; i < b + cols; i++) arr[i] = fill; }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, (size_t)(cols - s) * 4); for (int i = b; i < b + s; i++) arr[i] = fill; } }
  }

  // ================= FREE RIGID BODIES (rigid2d.js + rigidBodies.js) =================
  void worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy) {
    double lx = b->points[i * 2], ly = b->points[i * 2 + 1];
    ox = b->px + lx * cs - ly * sn; oy = b->py + lx * sn + ly * cs;
  }
  bool computeDerived(Body* b, bool preserveWorld) {
    int nPts = 0; double sumX = 0, sumY = 0;
    for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) { if (!b->occ[j * b->w + i]) continue; nPts++; sumX += b->offsetX + i; sumY += b->offsetY + j; }
    if (nPts == 0) return false;
    double dx = sumX / nPts, dy = sumY / nPts;
    if (preserveWorld && (dx != 0 || dy != 0)) { double c = std::cos(b->angle), s = std::sin(b->angle); b->px += dx * c - dy * s; b->py += dx * s + dy * c; }
    b->offsetX -= dx; b->offsetY -= dy;
    b->points.assign((size_t)nPts * 2, 0.f); b->boundaryPts.clear();
    int pi = 0; double inertia = 0, maxR2 = 0;
    auto filled = [&](int ii, int jj) { return ii >= 0 && ii < b->w && jj >= 0 && jj < b->h && b->occ[jj * b->w + ii]; };
    for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) {
      if (!b->occ[j * b->w + i]) continue;
      double lx = b->offsetX + i, ly = b->offsetY + j;
      b->points[pi * 2] = (float)lx; b->points[pi * 2 + 1] = (float)ly;
      double r2 = lx * lx + ly * ly; inertia += b->density * r2; if (r2 > maxR2) maxR2 = r2;
      if (!filled(i - 1, j) || !filled(i + 1, j) || !filled(i, j - 1) || !filled(i, j + 1)) b->boundaryPts.push_back(pi);
      pi++;
    }
    double mass = b->density * nPts;
    b->nPts = nPts; b->invMass = mass > 0 ? 1 / mass : 0; b->invInertia = inertia > 0 ? 1 / inertia : 0;
    b->maxR = std::sqrt(maxR2); b->awake = true; b->stillTicks = 0;
    return true;
  }
  Body* spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density) {
    int nPts = (int)cells.size(); if (nPts == 0) return nullptr;
    double cx = 0, cy = 0;
    for (auto& c : cells) { cx += c.first + 0.5; cy += c.second + 0.5; }
    cx /= nPts; cy /= nPts;
    int minX = 1 << 30, minY = 1 << 30, maxX = -(1 << 30), maxY = -(1 << 30);
    for (auto& c : cells) { if (c.first < minX) minX = c.first; if (c.first > maxX) maxX = c.first; if (c.second < minY) minY = c.second; if (c.second > maxY) maxY = c.second; }
    int w = maxX - minX + 1, h = maxY - minY + 1;
    Body* b = new Body();
    b->occ.assign((size_t)w * h, 0);
    for (auto& c : cells) b->occ[(size_t)(c.second - minY) * w + (c.first - minX)] = 1;
    b->w = w; b->h = h; b->offsetX = minX + 0.5 - cx; b->offsetY = minY + 0.5 - cy;
    b->px = cx; b->py = cy; b->angle = 0; b->vx = 0; b->vy = 0; b->omega = 0;
    b->material = material; b->density = density; b->id = nextBodyId++;
    computeDerived(b, false);
    bodies.push_back(b);
    return b;
  }
  void terrainNormalAt(int cx, int cy, double& ox, double& oy) {
    int l = cx > 0 && isBodyTerrain(cx - 1, cy) ? 1 : 0;
    int r = cx < cols - 1 && isBodyTerrain(cx + 1, cy) ? 1 : 0;
    int u = cy > 0 && isBodyTerrain(cx, cy - 1) ? 1 : 0;
    int d = cy < rows - 1 && isBodyTerrain(cx, cy + 1) ? 1 : 0;
    double nx = l - r, ny = u - d;
    if (nx == 0 && ny == 0) { ox = 0; oy = -1; return; }
    double inv = 1 / std::sqrt(nx * nx + ny * ny); ox = nx * inv; oy = ny * inv;
  }
  int insideBodyIndex(Body* b, double wx, double wy) {
    double dx = wx - b->px, dy = wy - b->py;
    double lx = dx * b->cs + dy * b->sn, ly = -dx * b->sn + dy * b->cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) return -1;
    int k = j * b->w + i; return b->occ[k] ? k : -1;
  }
  void bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy) {
    int i = idx % b->w, j = idx / b->w; int w = b->w, h = b->h;
    auto at = [&](int ii, int jj) { return (ii < 0 || ii >= w || jj < 0 || jj >= h) ? 0 : (int)b->occ[jj * w + ii]; };
    int nlx = at(i - 1, j) - at(i + 1, j), nly = at(i, j - 1) - at(i, j + 1);
    if (nlx == 0 && nly == 0) { double rx = wx - b->px, ry = wy - b->py; double rl = std::sqrt(rx * rx + ry * ry); if (rl > 0) { ox = rx / rl; oy = ry / rl; } else { ox = 0; oy = -1; } return; }
    double wx2 = nlx * b->cs - nly * b->sn, wy2 = nlx * b->sn + nly * b->cs;
    double inv = 1 / std::sqrt(wx2 * wx2 + wy2 * wy2); ox = wx2 * inv; oy = wy2 * inv;
  }
  void resolveContact(Contact& c) {
    Body* A = c.a; Body* B = c.b;
    double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
    double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
    double rvx = A->vx - A->omega * c.ray, rvy = A->vy + A->omega * c.rax;
    if (B) { rvx -= B->vx - B->omega * c.rby; rvy -= B->vy + B->omega * c.rbx; }
    double vn = rvx * c.nx + rvy * c.ny;
    double rnA = c.rax * c.ny - c.ray * c.nx, rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
    double denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB;
    if (denom > 0) {
      double delta = -(1 + R_RESTITUTION) * vn / denom;
      double newJn = c.accJn + delta; if (newJn < 0) newJn = 0;
      double applied = newJn - c.accJn; c.accJn = newJn;
      double jx = applied * c.nx, jy = applied * c.ny;
      A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
      if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
    }
    double tx = -c.ny, ty = c.nx;
    double rtvx = A->vx - A->omega * c.ray, rtvy = A->vy + A->omega * c.rax;
    if (B) { rtvx -= B->vx - B->omega * c.rby; rtvy -= B->vy + B->omega * c.rbx; }
    double vt = rtvx * tx + rtvy * ty;
    double rtA = c.rax * ty - c.ray * tx, rtB = B ? c.rbx * ty - c.rby * tx : 0;
    double denomT = aInvM + bInvM + aInvI * rtA * rtA + bInvI * rtB * rtB;
    if (denomT > 0) {
      double maxF = R_FRICTION * c.accJn, delta = -vt / denomT;
      double newJt = c.accJt + delta; if (newJt > maxF) newJt = maxF; else if (newJt < -maxF) newJt = -maxF;
      double applied = newJt - c.accJt; c.accJt = newJt;
      double jx = applied * tx, jy = applied * ty;
      A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
      if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
    }
  }
  void resolveBias(Contact& c) {
    Body* A = c.a; Body* B = c.b;
    double bias = R_BAUMGARTE * std::fmax(0.0, c.depth - R_PEN_SLOP);
    if (bias <= 0) return; if (bias > R_MAX_BIAS_VEL) bias = R_MAX_BIAS_VEL;
    double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
    double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
    double rvx = A->pvx - A->pw * c.ray, rvy = A->pvy + A->pw * c.rax;
    if (B) { rvx -= B->pvx - B->pw * c.rby; rvy -= B->pvy + B->pw * c.rbx; }
    double vn = rvx * c.nx + rvy * c.ny; if (vn >= bias) return;
    double rnA = c.rax * c.ny - c.ray * c.nx, rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
    double denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB; if (denom <= 0) return;
    double delta = (bias - vn) / denom;
    double newJ = c.accBias + delta; if (newJ < 0) newJ = 0;
    double applied = newJ - c.accBias; c.accBias = newJ;
    double jx = applied * c.nx, jy = applied * c.ny;
    A->pvx += jx * aInvM; A->pvy += jy * aInvM; A->pw += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->pvx -= jx * bInvM; B->pvy -= jy * bInvM; B->pw -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
  void wakeBody(Body* b) { b->awake = true; b->stillTicks = 0; }
  void rigidStep(double tickDt) {
    int n = (int)bodies.size();
    std::vector<int> islandParent(n);
    std::vector<double> islandMinStill(n);
    double maxSpeed2 = 0;
    for (Body* b : bodies) { if (!b->awake) continue; double sp2 = b->vx * b->vx + b->vy * b->vy; if (sp2 > maxSpeed2) maxSpeed2 = sp2; }
    double maxSpeed = std::sqrt(maxSpeed2) + R_GRAVITY * tickDt;
    int substeps = (int)std::ceil(maxSpeed / R_SAFE_SUBSTEP); if (substeps < 1) substeps = 1; if (substeps > R_MAX_SUBSTEPS) substeps = R_MAX_SUBSTEPS;
    std::vector<Contact> contacts; int nc = 0;
    struct PenPt { double wx, wy, nx, ny, depth; };
    std::vector<PenPt> penAcc, terrAcc;
    double wpx, wpy, nx_, ny_;
    for (int sub = 0; sub < substeps; sub++) {
      double dt = tickDt / substeps;
      for (int bi = 0; bi < n; bi++) {
        Body* b = bodies[bi];
        if (b->awake) b->vy += R_GRAVITY * dt;
        b->cs = std::cos(b->angle); b->sn = std::sin(b->angle);
        if (b->awake && !b->boundaryPts.empty()) {
          int wet = 0; double densitySum = 0;
          for (int bp : b->boundaryPts) { worldPoint(b, bp, b->sn, b->cs, wpx, wpy); double d = fluidDensityAt((int)std::floor(wpx), (int)std::floor(wpy)); if (d <= 0) continue; wet++; densitySum += d; }
          if (wet > 0) {
            double submerged = (double)wet / b->boundaryPts.size(), avgFluidD = densitySum / wet;
            b->vy -= R_GRAVITY * (avgFluidD / b->density) * submerged * dt;
            double drag = std::fmax(0.0, 1 - R_LIQUID_DRAG * submerged);
            b->vx *= drag; b->vy *= drag; b->omega *= std::fmax(0.0, 1 - R_LIQUID_ANG_DRAG * submerged);
          }
        }
        if (b->awake) {
          double sp2 = b->vx * b->vx + b->vy * b->vy;
          if (sp2 > R_MAX_SPEED * R_MAX_SPEED) { double s = R_MAX_SPEED / std::sqrt(sp2); b->vx *= s; b->vy *= s; }
          double wMax = R_MAX_SPEED / (b->maxR > 0 ? b->maxR : 1);
          if (b->omega > wMax) b->omega = wMax; else if (b->omega < -wMax) b->omega = -wMax;
        }
        double cs = b->cs, sn = b->sn;
        double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
        double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
        auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy; };
        corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
        b->aabbX0 = x0; b->aabbY0 = y0; b->aabbX1 = x1; b->aabbY1 = y1;
        b->pvx = 0; b->pvy = 0; b->pw = 0; b->hadContact = false; b->maxDepth = 0; b->idx = bi;
      }
      contacts.clear();
      auto penDepth = [&](Body* T, double wx, double wy, double nx, double ny) { double d = 0.5, mx = wx, my = wy; for (int s = 0; s < 4; s++) { mx += nx; my += ny; if (insideBodyIndex(T, mx, my) < 0) break; d += 1; } return d; };
      auto collectPen = [&](Body* P, Body* T, double sign) {
        for (int bp : P->boundaryPts) { worldPoint(P, bp, P->sn, P->cs, wpx, wpy); if (wpx < T->aabbX0 || wpx > T->aabbX1 || wpy < T->aabbY0 || wpy > T->aabbY1) continue; int idx = insideBodyIndex(T, wpx, wpy); if (idx < 0) continue; bodyNormalAt(T, idx, wpx, wpy, nx_, ny_); penAcc.push_back({wpx, wpy, nx_ * sign, ny_ * sign, penDepth(T, wpx, wpy, nx_, ny_)}); }
      };
      auto reduceManifold = [&](std::vector<PenPt>& acc, Body* A, Body* B, double fbx, double fby) {
        if (acc.empty()) return;
        double snx = 0, sny = 0; for (auto& p : acc) { snx += p.nx; sny += p.ny; }
        double nl = std::sqrt(snx * snx + sny * sny), Nx, Ny;
        if (nl < 1e-6) { Nx = fbx; Ny = fby; } else { Nx = snx / nl; Ny = sny / nl; }
        double tx = -Ny, ty = Nx; PenPt* lo = nullptr; PenPt* hi = nullptr; double loP = 1e18, hiP = -1e18;
        for (auto& pt : acc) { double pr = pt.wx * tx + pt.wy * ty; if (pr < loP) { loP = pr; lo = &pt; } if (pr > hiP) { hiP = pr; hi = &pt; } }
        auto push = [&](PenPt* p) { contacts.push_back({A, B, p->wx - A->px, p->wy - A->py, B ? p->wx - B->px : 0, B ? p->wy - B->py : 0, Nx, Ny, p->depth, 0, 0, 0}); if (p->depth > A->maxDepth) A->maxDepth = p->depth; if (B && p->depth > B->maxDepth) B->maxDepth = p->depth; };
        push(lo); if (hi != lo) push(hi);
        A->hadContact = true; if (B) B->hadContact = true;
      };
      for (int i = 0; i < n; i++) {
        Body* A = bodies[i];
        for (int j = i + 1; j < n; j++) {
          Body* B = bodies[j];
          if (!A->awake && !B->awake) continue;
          if (A->aabbX1 < B->aabbX0 || B->aabbX1 < A->aabbX0 || A->aabbY1 < B->aabbY0 || B->aabbY1 < A->aabbY0) continue;
          penAcc.clear(); collectPen(A, B, 1); collectPen(B, A, -1);
          if (penAcc.empty()) continue;
          bool aMoving = A->awake && (A->vx * A->vx + A->vy * A->vy > R_WAKE_LIN2 || A->omega * A->omega > R_WAKE_ANG2);
          bool bMoving = B->awake && (B->vx * B->vx + B->vy * B->vy > R_WAKE_LIN2 || B->omega * B->omega > R_WAKE_ANG2);
          if (!A->awake && bMoving) wakeBody(A);
          if (!B->awake && aMoving) wakeBody(B);
          if (!A->awake && !B->awake) continue;
          double dx = A->px - B->px, dy = A->py - B->py; double dl = std::sqrt(dx * dx + dy * dy); if (dl == 0) dl = 1; dx /= dl; dy /= dl;
          double minA = 1e18, maxB = -1e18;
          for (int bp : A->boundaryPts) { worldPoint(A, bp, A->sn, A->cs, wpx, wpy); double pr = wpx * dx + wpy * dy; if (pr < minA) minA = pr; }
          for (int bp : B->boundaryPts) { worldPoint(B, bp, B->sn, B->cs, wpx, wpy); double pr = wpx * dx + wpy * dy; if (pr > maxB) maxB = pr; }
          double depth = std::fmax(0.5, (maxB - minA) + 0.5);
          for (auto& p : penAcc) { p.nx = dx; p.ny = dy; p.depth = depth; }
          reduceManifold(penAcc, A, B, dx, dy);
        }
      }
      for (int bi = 0; bi < n; bi++) {
        Body* b = bodies[bi]; if (!b->awake) continue;
        terrAcc.clear();
        for (int bp : b->boundaryPts) {
          worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
          int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
          if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
          int tx = cx, ty = cy; double depth = 0.5;
          if (!isBodyTerrain(cx, cy)) {
            double rx = wpx - b->px, ry = wpy - b->py;
            tx = (int)std::floor(wpx + (b->vx - b->omega * ry) * dt);
            ty = (int)std::floor(wpy + (b->vy + b->omega * rx) * dt);
            if (tx < 0 || tx >= cols || ty < 0 || ty >= rows || !isBodyTerrain(tx, ty)) continue;
            depth = 0;
          }
          terrainNormalAt(tx, ty, nx_, ny_);
          if (depth > 0) { double mx = wpx, my = wpy; for (int s = 0; s < 4; s++) { mx += nx_; my += ny_; int ix = (int)std::floor(mx), iy = (int)std::floor(my); if (ix < 0 || ix >= cols || iy < 0 || iy >= rows || !isBodyTerrain(ix, iy)) break; depth += 1; } }
          terrAcc.push_back({wpx, wpy, nx_, ny_, depth});
        }
        reduceManifold(terrAcc, b, nullptr, 0, -1);
      }
      nc = (int)contacts.size();
      for (int it = 0; it < R_SOLVER_ITERS; it++) { if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) resolveContact(contacts[ci]); else for (int ci = 0; ci < nc; ci++) resolveContact(contacts[ci]); }
      for (int it = 0; it < R_SOLVER_ITERS; it++) { if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) resolveBias(contacts[ci]); else for (int ci = 0; ci < nc; ci++) resolveBias(contacts[ci]); }
      for (int bi = 0; bi < n; bi++) {
        Body* b = bodies[bi]; if (!b->awake) continue;
        b->px += (b->vx + b->pvx) * dt; b->py += (b->vy + b->pvy) * dt; b->angle += (b->omega + b->pw) * dt;
        if (!b->hadContact) { b->stillTicks = 0; continue; }
        if (b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN) { b->vx *= R_CONTACT_LIN_DAMP; b->vy *= R_CONTACT_LIN_DAMP; }
        if (b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG) b->omega *= R_CONTACT_ANG_DAMP;
        if (b->vx * b->vx + b->vy * b->vy < R_SLEEP_LIN * R_SLEEP_LIN && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG && b->maxDepth <= R_REST_DEPTH) b->stillTicks++; else b->stillTicks = 0;
      }
    }
    for (int bi = 0; bi < n; bi++) islandParent[bi] = bi;
    std::function<int(int)> ifind = [&](int a) { while (islandParent[a] != a) { islandParent[a] = islandParent[islandParent[a]]; a = islandParent[a]; } return a; };
    for (int ci = 0; ci < nc; ci++) { Contact& c = contacts[ci]; if (!c.b || !c.a->awake || !c.b->awake) continue; int ra = ifind(c.a->idx), rb = ifind(c.b->idx); if (ra != rb) islandParent[ra] = rb; }
    for (int bi = 0; bi < n; bi++) islandMinStill[bi] = 1e18;
    for (int bi = 0; bi < n; bi++) { Body* b = bodies[bi]; if (!b->awake) continue; int r = ifind(bi); double st = b->hadContact ? b->stillTicks : 0; if (st < islandMinStill[r]) islandMinStill[r] = st; }
    for (int bi = 0; bi < n; bi++) { Body* b = bodies[bi]; if (!b->awake) continue; if (islandMinStill[ifind(bi)] >= R_SLEEP_TICKS) { b->awake = false; b->vx = 0; b->vy = 0; b->omega = 0; } }
  }
  template <class F> void forEachBodyCell(Body* b, F cb) {
    double sn = std::sin(b->angle), cs = std::cos(b->angle);
    double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
    double minWX = 1e18, minWY = 1e18, maxWX = -1e18, maxWY = -1e18;
    auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx; if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy; };
    corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
    int x0 = (int)std::floor(minWX), x1 = (int)std::floor(maxWX), y0 = (int)std::floor(minWY), y1 = (int)std::floor(maxWY);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= cols) x1 = cols - 1; if (y1 >= rows) y1 = rows - 1;
    for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
      double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
      double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
      if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
      if (b->occ[j * b->w + i]) cb(wx, wy);
    }
  }
  int localCellAt(Body* b, double wx, double wy) { b->cs = std::cos(b->angle); b->sn = std::sin(b->angle); return insideBodyIndex(b, wx, wy); }
  bool eraseLocalCell(Body* b, int idx) { if (idx < 0 || idx >= (int)b->occ.size() || !b->occ[idx]) return false; b->occ[idx] = 0; return true; }
  bool splitDisconnectedBody(Body* b) {
    std::vector<uint8_t> seen(b->occ.size(), 0);
    std::vector<std::vector<int>> parts;
    for (int k = 0; k < (int)b->occ.size(); k++) {
      if (seen[k] || !b->occ[k]) continue;
      std::vector<int> part, stack; seen[k] = 1; stack.push_back(k);
      while (!stack.empty()) { int cur = stack.back(); stack.pop_back(); part.push_back(cur); int i = cur % b->w, j = cur / b->w; auto pu = [&](int ii, int jj) { if (ii < 0 || ii >= b->w || jj < 0 || jj >= b->h) return; int nk = jj * b->w + ii; if (seen[nk] || !b->occ[nk]) return; seen[nk] = 1; stack.push_back(nk); }; pu(i - 1, j); pu(i + 1, j); pu(i, j - 1); pu(i, j + 1); }
      parts.push_back(std::move(part));
    }
    if (parts.size() <= 1) return false;
    double oldPx = b->px, oldPy = b->py, oldVx = b->vx, oldVy = b->vy, oldOmega = b->omega;
    auto makePiece = [&](std::vector<int>& part, int id) -> Body* {
      int minI = 1 << 30, minJ = 1 << 30, maxI = -(1 << 30), maxJ = -(1 << 30);
      for (int idx : part) { int i = idx % b->w, j = idx / b->w; if (i < minI) minI = i; if (i > maxI) maxI = i; if (j < minJ) minJ = j; if (j > maxJ) maxJ = j; }
      int w = maxI - minI + 1, h = maxJ - minJ + 1;
      Body* p = new Body(); p->occ.assign((size_t)w * h, 0);
      for (int idx : part) { int i = idx % b->w, j = idx / b->w; p->occ[(size_t)(j - minJ) * w + (i - minI)] = 1; }
      p->w = w; p->h = h; p->offsetX = b->offsetX + minI; p->offsetY = b->offsetY + minJ;
      p->px = oldPx; p->py = oldPy; p->angle = b->angle; p->material = b->material; p->density = b->density; p->id = id;
      computeDerived(p, true);
      double rx = p->px - oldPx, ry = p->py - oldPy; p->vx = oldVx - oldOmega * ry; p->vy = oldVy + oldOmega * rx; p->omega = oldOmega;
      return p;
    };
    // first part reuses b in place
    Body* first = makePiece(parts[0], b->id);
    *b = *first; delete first;
    int bi = -1; for (int i = 0; i < (int)bodies.size(); i++) if (bodies[i] == b) { bi = i; break; }
    std::vector<Body*> extra;
    for (size_t p = 1; p < parts.size(); p++) extra.push_back(makePiece(parts[p], nextBodyId++));
    if (bi >= 0) bodies.insert(bodies.begin() + bi + 1, extra.begin(), extra.end());
    else for (Body* e : extra) bodies.push_back(e);
    return true;
  }

  // ---- rigidBodies.js layer ----
  bool isBodyTerrain(int x, int y) {
    int k = y * cols + x; uint8_t m = grid[k];
    if (m == SAND) return groundedCell[k] == 1;
    return m == STONE || m == WOOD || m == PLANT || m == SEED || m == ICE;
  }
  double fluidDensityAt(int x, int y) { if (x < 0 || x >= cols || y < 0 || y >= rows) return 0; uint8_t m = grid[y * cols + x]; return isLiquid(m) ? DENSITY[m] : 0; }
  bool isBodyRelocatable(uint8_t m, int k) { return isLiquid(m) || (m == SAND && groundedCell[k] != 1); }
  bool canBodyOccupy(uint8_t m, int k) { return m == EMPTY || m == FIRE || m == STEAM || isBodyRelocatable(m, k); }
  struct Disp { uint8_t material; int from; };
  void spillDisplacedBodyMaterial(std::vector<Disp>& displaced, std::unordered_set<int>& footprint, std::unordered_set<int>& edgeFootprint) {
    if (displaced.empty()) return;
    int offs[4] = {-cols, -1, 1, cols}; int gridLen = cols * rows;
    auto isPassable = [&](uint8_t m, int k) { return m == EMPTY || isLiquid(m) || isGas(m) || (m == SAND && groundedCell[k] != 1); };
    std::unordered_set<int> seen;
    auto canVisit = [&](int k) { if (k <= 0 || k >= gridLen || footprint.count(k) || seen.count(k)) return false; int y = k / cols, x = k - y * cols; return x > 0 && x < cols - 1 && y > 0 && y < rows && isPassable(grid[k], k); };
    auto isDropTarget = [&](int k, uint8_t mat) { if (footprint.count(k)) return false; uint8_t m = grid[k]; if (m == EMPTY) return true; return (isLiquid(m) || isGas(m)) && DENSITY[m] < DENSITY[mat]; };
    std::vector<int> footprintEdgeStarts; std::unordered_set<int> footprintEdgeSeen;
    std::vector<int> sortedFootprint(edgeFootprint.begin(), edgeFootprint.end()); std::sort(sortedFootprint.begin(), sortedFootprint.end());
    for (int k : sortedFootprint) for (int off : offs) { int nk = k + off; if (footprintEdgeSeen.count(nk)) continue; int y = nk / cols, x = nk - y * cols; if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) continue; if (isPassable(grid[nk], nk)) { footprintEdgeSeen.insert(nk); footprintEdgeStarts.push_back(nk); } }
    std::vector<Disp> worklist = displaced;
    std::sort(worklist.begin(), worklist.end(), [](const Disp& a, const Disp& b) { return DENSITY[b.material] < DENSITY[a.material]; });
    std::vector<int> queue;
    for (size_t wi = 0; wi < worklist.size(); wi++) {
      Disp d = worklist[wi]; seen.clear(); queue.clear(); int target = -1;
      for (int off : offs) { int nk = d.from + off; if (!canVisit(nk)) continue; seen.insert(nk); queue.push_back(nk); }
      if (queue.empty()) for (int nk : footprintEdgeStarts) { if (!canVisit(nk)) continue; seen.insert(nk); queue.push_back(nk); }
      for (size_t qi = 0; qi < queue.size(); qi++) { int k = queue[qi]; if (isDropTarget(k, d.material)) { target = k; break; } for (int off : offs) { int nk = k + off; if (!canVisit(nk)) continue; seen.insert(nk); queue.push_back(nk); } }
      if (target >= 0) { uint8_t evicted = grid[target]; if (evicted != EMPTY) worklist.push_back({evicted, target}); writeGridIndex(target, d.material); }
    }
  }
  double rigidErodeProbabilityAt(int k) {
    double p = 0; int x = k % cols, y = k / cols;
    auto consider = [&](int nk) { uint8_t m = grid[nk]; if (m == ACID) p = std::fmax(p, ACID_DISSOLVE_P); else if (m == LAVA) p = std::fmax(p, RIGID_LAVA_ERODE_P); else if (m == FIRE) p = std::fmax(p, RIGID_FIRE_ERODE_P); };
    if (x < cols - 1) consider(k + 1); if (x > 0) consider(k - 1); if (y < rows - 1) consider(k + cols); if (y > 0) consider(k - cols);
    return p;
  }
  static const double RIGID_LAVA_ERODE_P, RIGID_FIRE_ERODE_P;
  bool eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty) {
    int id = bodyOwner[k]; if (id < 0 || grid[k] != RIGID) return false;
    auto it = bodyById.find(id); if (it == bodyById.end()) return false; Body* b = it->second;
    int y = k / cols, x = k - y * cols;
    int idx = localCellAt(b, x + 0.5, y + 0.5);
    if (idx < 0 || !eraseLocalCell(b, idx)) return false;
    writeGridIndex(k, EMPTY); bodyOwner[k] = -1; dirty.insert(b); return true;
  }
  void finishErasedBodies(std::unordered_set<Body*>& dirty, std::vector<int>& cells) {
    if (dirty.empty()) { bodyCells = cells; return; }
    std::unordered_set<int> removedIds;
    for (Body* b : dirty) { if (computeDerived(b, true)) { splitDisconnectedBody(b); } else removedIds.insert(b->id); }
    if (!removedIds.empty()) {
      std::vector<Body*> keep;
      for (Body* b : bodies) { if (removedIds.count(b->id)) delete b; else keep.push_back(b); }
      bodies = std::move(keep);
      for (int k : cells) { if (!removedIds.count(bodyOwner[k])) continue; if (grid[k] == RIGID) writeGridIndex(k, EMPTY); bodyOwner[k] = -1; }
    }
    for (int k : cells) if (grid[k] == RIGID) bodyOwner[k] = -1;
    std::vector<int> kept; std::unordered_set<int> claimed;
    for (Body* b : bodies) forEachBodyCell(b, [&](int x, int y) { int k = y * cols + x; if (grid[k] != RIGID || claimed.count(k)) return; bodyOwner[k] = b->id; claimed.insert(k); kept.push_back(k); });
    for (int k : cells) if (grid[k] == RIGID && !claimed.count(k)) { writeGridIndex(k, EMPTY); bodyOwner[k] = -1; }
    bodyCells = kept;
  }
  void erodeBodies(std::vector<int>& cells) {
    if (cells.empty()) { bodyCells = cells; return; }
    std::unordered_map<int, Body*> bodyById; for (Body* b : bodies) bodyById[b->id] = b;
    std::unordered_set<Body*> dirty;
    for (int k : cells) { double p = rigidErodeProbabilityAt(k); if (p <= 0 || rand() >= p) continue; eraseBodyCellIndex(k, bodyById, dirty); }
    finishErasedBodies(dirty, cells);
  }
  int bodyFootprintBlocked(Body* b) {
    int blocked = 0;
    forEachBodyCell(b, [&](int x, int y) { int k = y * cols + x; uint8_t m = grid[k]; if (m == RIGID && bodyOwner[k] == b->id) return; if (!canBodyOccupy(m, k)) blocked++; });
    return blocked;
  }
  int bodyDepenTolerance(Body* b) { return imax(1, (int)std::floor(imin(b->w, b->h) * 0.34)); }
  bool depenetrateBodyRaster(Body* b, double prePx, double prePy, bool hasPre) {
    int tol = bodyDepenTolerance(b);
    if (bodyFootprintBlocked(b) <= tol) return false;
    double newPx = b->px, newPy = b->py, newAngle = b->angle;
    if (hasPre) {
      b->px = prePx; b->py = prePy; b->angle = newAngle;
      if (bodyFootprintBlocked(b) <= tol) {
        double lo = 0, hi = 1;
        for (int iter = 0; iter < 6; iter++) { double mid = (lo + hi) * 0.5; b->px = prePx + (newPx - prePx) * mid; b->py = prePy + (newPy - prePy) * mid; b->angle = newAngle; if (bodyFootprintBlocked(b) <= tol) lo = mid; else hi = mid; }
        b->px = prePx + (newPx - prePx) * lo; b->py = prePy + (newPy - prePy) * lo; b->angle = newAngle;
        double mvx = newPx - prePx, mvy = newPy - prePy, len = std::hypot(mvx, mvy);
        if (len > 1e-6) { double nx = mvx / len, ny = mvy / len, vn = b->vx * nx + b->vy * ny; if (vn > 0) { b->vx -= vn * nx; b->vy -= vn * ny; } }
        b->awake = true; b->stillTicks = 0; return true;
      }
    }
    b->px = newPx; b->py = newPy; b->angle = newAngle;
    double maxLift = 3.0, st = 0.125;
    for (double lift = st; lift <= maxLift + 1e-9; lift += st) { b->py = newPy - lift; if (bodyFootprintBlocked(b) <= tol) { if (b->vy > 0) b->vy = 0; b->awake = true; b->stillTicks = 0; return true; } }
    b->px = newPx; b->py = newPy; b->angle = newAngle; return false;
  }
  void moveBodies() {
    if (bodies.empty() && bodyCells.empty()) return;
    computeGrounded();
    for (int k : bodyCells) { if (grid[k] == RIGID) writeGridIndex(k, EMPTY); bodyOwner[k] = -1; }
    std::unordered_map<int, std::pair<double, double>> prePoses;
    for (Body* b : bodies) prePoses[b->id] = {b->px, b->py};
    rigidStep(1.0);
    rigidRejectedCells = 0; rigidDepenetrations = 0;
    for (Body* b : bodies) { auto it = prePoses.find(b->id); bool hp = it != prePoses.end(); double ppx = hp ? it->second.first : 0, ppy = hp ? it->second.second : 0; if (depenetrateBodyRaster(b, ppx, ppy, hp)) rigidDepenetrations++; }
    std::vector<int> cells; std::unordered_set<int> footprint;
    std::unordered_map<int, std::pair<std::vector<Disp>, std::unordered_set<int>>> perBody;
    for (Body* b : bodies) {
      auto& pb = perBody[b->id];
      forEachBodyCell(b, [&](int x, int y) {
        int k = y * cols + x; if (bodyOwner[k] != -1) return; uint8_t m = grid[k];
        if (!canBodyOccupy(m, k)) { rigidRejectedCells++; return; }
        if (isBodyRelocatable(m, k)) pb.first.push_back({m, k});
        writeGridIndex(k, RIGID); bodyOwner[k] = b->id; cells.push_back(k); footprint.insert(k); pb.second.insert(k);
      });
    }
    for (auto& kv : perBody) spillDisplacedBodyMaterial(kv.second.first, footprint, kv.second.second);
    erodeBodies(cells);
  }
  Body* spawnBody(const std::vector<std::pair<int, int>>& cells) {
    Body* b = spawnBodyImpl(cells, RIGID, DENSITY[RIGID]);
    if (b && !cells.empty()) { int minX = cols - 1, minY = rows - 1, maxX = 0, maxY = 0; for (auto& c : cells) { if (c.first < minX) minX = c.first; if (c.first > maxX) maxX = c.first; if (c.second < minY) minY = c.second; if (c.second > maxY) maxY = c.second; } markDirtyRect(minX, minY, maxX, maxY); }
    return b;
  }
};

const double Engine::RIGID_LAVA_ERODE_P = 0.12; // = ACID_DISSOLVE_P
const double Engine::RIGID_FIRE_ERODE_P = 0.11; // = FIRE_SPREAD_P
const double Engine::SURFACE_FREQ = 0.010;
const double Engine::CAVE_FREQ = 0.05;
const double Engine::CAVE_THRESH = 0.66;
const double Engine::TREE_PROB = 0.05;
const int Engine::SURFACE_OCT = 5;
const int Engine::GEN_SKIN = 1;

const int Engine::DIRS_LF[2] = {-1, 1};
const int Engine::DIRS_RF[2] = {1, -1};

// ---------------- C ABI ----------------
extern "C" {
EMSCRIPTEN_KEEPALIVE Engine* engine_create(int cols, int rows, uint32_t seed, int sinks, int infinite) {
  Engine* e = new Engine(cols, rows, seed, sinks != 0);
  if (infinite) e->initInfinite(seed);
  e->markAllDirty();
  return e;
}
EMSCRIPTEN_KEEPALIVE void engine_shift_world(Engine* e, int dx) { e->shiftWorld(dx); }
EMSCRIPTEN_KEEPALIVE int engine_world_offset_x(Engine* e) { return e->worldOffsetX; }
EMSCRIPTEN_KEEPALIVE int engine_world_surface_at(Engine* e, int worldX) { return e->infinite ? e->genSurfaceAt(worldX) : 0; }
EMSCRIPTEN_KEEPALIVE void engine_destroy(Engine* e) { delete e; }
EMSCRIPTEN_KEEPALIVE int engine_step(Engine* e) { return e->step() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid(Engine* e) { return e->grid; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_dirty(Engine* e) { return e->dirtyRender.data(); }
EMSCRIPTEN_KEEPALIVE int engine_dirty_count(Engine* e) { return e->dirtyRenderCount; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_cols(Engine* e) { return e->chunkCols; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_rows(Engine* e) { return e->chunkRows; }
EMSCRIPTEN_KEEPALIVE void engine_fold_dirty(Engine* e) { e->foldRowMarksToRender(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_dirty(Engine* e) { memset(e->dirtyRender.data(), 0, e->dirtyRender.size()); e->dirtyRenderCount = 0; }
EMSCRIPTEN_KEEPALIVE int engine_paint_disc(Engine* e, int cx, int cy, int r, int mat, int ow) { return e->paintDisc(cx, cy, r, (uint8_t)mat, ow != 0); }
EMSCRIPTEN_KEEPALIVE int engine_erase_disc(Engine* e, int cx, int cy, int r) { return e->eraseDisc(cx, cy, r); }
EMSCRIPTEN_KEEPALIVE void engine_set_sinks(Engine* e, int v) { e->sinksEnabled = v != 0; }
EMSCRIPTEN_KEEPALIVE void engine_sync_components(Engine* e) { e->registerSeededComponents(0, e->cols); }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_ms(Engine* e) { return e->perfStepMs; }
EMSCRIPTEN_KEEPALIVE int engine_perf_dirty_chunks(Engine* e) { return e->perfDirtyChunks; }
EMSCRIPTEN_KEEPALIVE int engine_tick(Engine* e) { return e->tick; }

// drafts / seed
EMSCRIPTEN_KEEPALIVE int engine_add_stone_draft(Engine* e, int cx, int cy, int r) { return e->addDiscToDraft(e->stoneDraft, cx, cy, r, e->rows); }
EMSCRIPTEN_KEEPALIVE int engine_add_ice_draft(Engine* e, int cx, int cy, int r) { return e->addDiscToDraft(e->iceDraft, cx, cy, r, e->rows - 1); }
EMSCRIPTEN_KEEPALIVE void engine_finalize_stone_draft(Engine* e) { e->finalizeStoneDraft(); }
EMSCRIPTEN_KEEPALIVE void engine_finalize_ice_draft(Engine* e) { e->finalizeIceDraft(); }
EMSCRIPTEN_KEEPALIVE void engine_finalize_driftwood_draft(Engine* e) { e->finalizeDriftwoodDraft(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_stone_draft(Engine* e) { e->stoneDraft.clear(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_ice_draft(Engine* e) { e->iceDraft.clear(); }
EMSCRIPTEN_KEEPALIVE int engine_stone_draft_snapshot(Engine* e) { e->draftSnapshot.assign(e->stoneDraft.begin(), e->stoneDraft.end()); return (int)e->draftSnapshot.size(); }
EMSCRIPTEN_KEEPALIVE int engine_ice_draft_snapshot(Engine* e) { e->draftSnapshot.assign(e->iceDraft.begin(), e->iceDraft.end()); return (int)e->draftSnapshot.size(); }
EMSCRIPTEN_KEEPALIVE int* engine_draft_ptr(Engine* e) { return e->draftSnapshot.data(); }
EMSCRIPTEN_KEEPALIVE int engine_get_seed_origin(Engine* e, int cx, int cy, int* out) { int x0, y0; if (!e->getSeedOrigin(cx, cy, x0, y0)) return 0; out[0] = x0; out[1] = y0; return 1; }
EMSCRIPTEN_KEEPALIVE int engine_can_place_seed(Engine* e, int x0, int y0) { return e->canPlaceSeedAt(x0, y0) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int engine_place_seed(Engine* e, int x0, int y0) { return e->placeSeedAt(x0, y0) ? 1 : 0; }

// free rigid bodies
EMSCRIPTEN_KEEPALIVE void engine_spawn_body(Engine* e, int* xy, int count) {
  std::vector<std::pair<int, int>> cells; cells.reserve(count);
  for (int i = 0; i < count; i++) cells.push_back({xy[i * 2], xy[i * 2 + 1]});
  e->spawnBody(cells);
}
EMSCRIPTEN_KEEPALIVE int engine_body_count(Engine* e) { return (int)e->bodies.size(); }
EMSCRIPTEN_KEEPALIVE int engine_body_blocked(Engine* e, int i) { return (i >= 0 && i < (int)e->bodies.size()) ? e->bodyFootprintBlocked(e->bodies[i]) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_body_awake(Engine* e, int i) { return (i >= 0 && i < (int)e->bodies.size()) ? (e->bodies[i]->awake ? 1 : 0) : -1; }
EMSCRIPTEN_KEEPALIVE int engine_rigid_rejected(Engine* e) { return e->rigidRejectedCells; }
} // extern "C"
