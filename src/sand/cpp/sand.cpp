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

struct Comp {
  int id = 0;
  std::unordered_set<int> cells;
  int yMax = 0;
  int woodCount = 0, leafCount = 0, age = 0;
  bool cacheDirty = false;
  bool grounded = false;
  std::vector<int> woodCells, seedWoodCells;
};

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
  }

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
    // moveBodies(); // stage 4
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
    std::vector<int> erasedStone, erasedIce; bool erasedPlant = false; int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) { int yy = cy + oy; if (yy <= 0 || yy >= rows) continue; for (int ox = -radius; ox <= radius; ox++) { if (ox * ox + oy * oy > radius * radius) continue; int xx = cx + ox; if (xx <= 0 || xx >= cols - 1) continue; int k = I(xx, yy);
      if (grid[k] != EMPTY) { if (grid[k] == STONE) erasedStone.push_back(k); else if (grid[k] == ICE) erasedIce.push_back(k); if (isPlantMaterial(grid[k])) erasedPlant = true; grid[k] = EMPTY; changed = 1; }
      if (stoneDraft.erase(k)) changed = 1; if (iceDraft.erase(k)) changed = 1;
    } }
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
};

const int Engine::DIRS_LF[2] = {-1, 1};
const int Engine::DIRS_RF[2] = {1, -1};

// ---------------- C ABI ----------------
extern "C" {
EMSCRIPTEN_KEEPALIVE Engine* engine_create(int cols, int rows, uint32_t seed, int sinks) { Engine* e = new Engine(cols, rows, seed, sinks != 0); e->markAllDirty(); return e; }
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
} // extern "C"
