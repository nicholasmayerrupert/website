// Falling-sand simulation core, ported from src/sand/engine.js to C++ for
// WebAssembly. Behavioral parity (not bit-identical) with the JS engine.
//
// STAGE 1: core cellular automaton — grid double-buffer, dirty-chunk tracking,
// loose-density/sand/liquid/gas settle passes, relax/separate, side sinks,
// paint/erase brushes for non-component materials. Components, rigid bodies,
// reactions, growth, and worldgen are added in later stages (currently no-ops).
//
// Material ids MUST stay in lockstep with src/sand/materials.js (the JS render
// side reads the same ids). See the table below.

#include <cstdint>
#include <cstring>
#include <vector>
#include <emscripten.h>

// ---- Material ids (mirror src/sand/materials.js) ----
enum Mat : uint8_t {
  EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, OIL = 4, FIRE = 5, STEAM = 6,
  SEED = 7, WOOD = 8, PLANT = 9, ACID = 10, LAVA = 11, ICE = 12, RIGID = 13,
  DRIFTWOOD = 14
};
enum Kind : uint8_t { K_NONE = 0, K_POWDER = 1, K_LIQUID = 2, K_GAS = 3, K_COMPONENT = 4, K_FREE_RIGID = 5 };

static const int TABLE = 16;
// density, looseSorted, mobility, kind — compiled from the registry.
static const float  DENSITY[TABLE]      = {0, 1.6f, 1.0f, 2.6f, 0.8f, 0, 0, 0.5f, 0.6f, 0.4f, 1.1f, 2.8f, 0.9f, 1.4f, 0.6f, 0};
static const uint8_t DENSITY_SORTED[TABLE] = {0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0};
static const float  MOBILITY[TABLE]     = {0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0.35f, 0, 0, 0, 0};
static const uint8_t MAT_KIND[TABLE]    = {K_NONE, K_POWDER, K_LIQUID, K_COMPONENT, K_LIQUID, K_GAS, K_GAS, K_COMPONENT, K_COMPONENT, K_COMPONENT, K_LIQUID, K_LIQUID, K_COMPONENT, K_FREE_RIGID, K_COMPONENT, K_NONE};

// ---- Tunables (mirror engine.js) ----
static const int   CHUNK_SIZE = 32;
static const int   CHUNK_SHIFT = 5;
static const int   MAX_WATER_FLOW = 10;
static const float STEAM_DECAY_P = 0.018f;
static const float FIRE_DECAY_P = 0.006f;
static const int   DIRTY_PAD_X = MAX_WATER_FLOW + 2;
static const int   DIRTY_PAD_Y = 2;
static const int   SINK_STRIP_W = 2;
static const int   INNER_STRIP_W = 1;
static const float SINK_LIQUID_P = 0.85f;
static const float SINK_SAND_P = 0.35f;
static const float INNER_LIQUID_P = 0.35f;
static const float INNER_SAND_P = 0.10f;

static inline int imin(int a, int b) { return a < b ? a : b; }
static inline int imax(int a, int b) { return a > b ? a : b; }

struct Engine {
  int cols, rows;
  int chunkCols, chunkRows;
  std::vector<uint8_t> gridA, gridB;
  uint8_t* grid;
  uint8_t* next;
  std::vector<uint8_t> dirtyRender;
  std::vector<int32_t> rowMarkMin, rowMarkMax;
  std::vector<int32_t> chunkStamp;
  std::vector<int32_t> activeRowMin, activeRowMax;
  std::vector<int32_t> vacatedStamp;
  int stepSerial = 0;
  int dirtyRenderCount = 0;
  int tick = 0;
  double perfStepMs = 0;
  int perfDirtyChunks = 0;
  bool sinksEnabled;

  // mulberry32 PRNG (ported from rng.js)
  uint32_t rngState;
  inline double rand() {
    rngState = (rngState + 0x6d2b79f5u);
    uint32_t a = rngState;
    uint32_t t = a ^ (a >> 15);
    t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7);
    t = (t + (t2 * (61u | t))) ^ t;
    return (double)((t ^ (t >> 14)) >> 0) / 4294967296.0;
  }

  inline int I(int x, int y) { return y * cols + x; }

  Engine(int c, int r, uint32_t seed, bool sinks)
      : cols(c), rows(r), sinksEnabled(sinks), rngState(seed) {
    chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
    chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;
    gridA.assign((size_t)cols * rows, EMPTY);
    gridB.assign((size_t)cols * rows, EMPTY);
    grid = gridA.data();
    next = gridB.data();
    dirtyRender.assign((size_t)chunkCols * chunkRows, 0);
    rowMarkMin.assign(rows, cols);
    rowMarkMax.assign(rows, -1);
    chunkStamp.assign((size_t)chunkCols * chunkRows, -1);
    activeRowMin.assign(rows, 0);
    activeRowMax.assign(rows, 0);
    vacatedStamp.assign((size_t)cols * rows, -1);
  }

  // ---- dirty tracking ----
  inline void markCellIndex(int k) {
    int y = k / cols;
    int x = k - y * cols;
    if (x < rowMarkMin[y]) rowMarkMin[y] = x;
    if (x > rowMarkMax[y]) rowMarkMax[y] = x;
  }
  void markDirtyRect(int x0, int y0, int x1, int y1) {
    int mx0 = x0 < 0 ? 0 : x0;
    int mx1 = x1 > cols - 1 ? cols - 1 : x1;
    int my0 = y0 < 0 ? 0 : y0;
    int my1 = y1 > rows - 1 ? rows - 1 : y1;
    for (int y = my0; y <= my1; y++) {
      if (mx0 < rowMarkMin[y]) rowMarkMin[y] = mx0;
      if (mx1 > rowMarkMax[y]) rowMarkMax[y] = mx1;
    }
  }
  void markAllDirty() {
    for (int y = 0; y < rows; y++) { rowMarkMin[y] = 0; rowMarkMax[y] = cols - 1; }
  }
  void foldRowMarksToRender() {
    for (int y = 0; y < rows; y++) {
      int mn = rowMarkMin[y], mx = rowMarkMax[y];
      if (mx < mn) continue;
      int px0 = mn - DIRTY_PAD_X < 0 ? 0 : mn - DIRTY_PAD_X;
      int px1 = mx + DIRTY_PAD_X > cols - 1 ? cols - 1 : mx + DIRTY_PAD_X;
      int py0 = y - DIRTY_PAD_Y < 0 ? 0 : y - DIRTY_PAD_Y;
      int py1 = y + DIRTY_PAD_Y > rows - 1 ? rows - 1 : y + DIRTY_PAD_Y;
      int c0 = px0 >> CHUNK_SHIFT, c1 = px1 >> CHUNK_SHIFT;
      int cy0 = py0 >> CHUNK_SHIFT, cy1 = py1 >> CHUNK_SHIFT;
      for (int cy = cy0; cy <= cy1; cy++) {
        int rowBase = cy * chunkCols;
        for (int cx = c0; cx <= c1; cx++) {
          int ci = rowBase + cx;
          if (!dirtyRender[ci]) { dirtyRender[ci] = 1; dirtyRenderCount++; }
        }
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
      int px0 = mn - DIRTY_PAD_X < 0 ? 0 : mn - DIRTY_PAD_X;
      int px1 = mx + DIRTY_PAD_X > cols - 1 ? cols - 1 : mx + DIRTY_PAD_X;
      int py0 = y - DIRTY_PAD_Y < 0 ? 0 : y - DIRTY_PAD_Y;
      int py1 = y + DIRTY_PAD_Y > rows - 1 ? rows - 1 : y + DIRTY_PAD_Y;
      for (int yy = py0; yy <= py1; yy++) {
        if (px0 < activeRowMin[yy]) activeRowMin[yy] = px0;
        if (px1 > activeRowMax[yy]) activeRowMax[yy] = px1;
      }
    }
    if (!hasActive) return false;
    stepSerial++;
    perfDirtyChunks = 0;
    for (int y = 0; y < rows; y++) {
      int mn = activeRowMin[y], mx = activeRowMax[y];
      if (mx < mn) continue;
      int rowBase = (y >> CHUNK_SHIFT) * chunkCols;
      for (int cx = mn >> CHUNK_SHIFT, c1 = mx >> CHUNK_SHIFT; cx <= c1; cx++) {
        int ci = rowBase + cx;
        if (chunkStamp[ci] != stepSerial) { chunkStamp[ci] = stepSerial; perfDirtyChunks++; }
      }
    }
    return true;
  }
  void prepareNextBuffer() {
    for (int y = 0; y < rows; y++) {
      int rowStart = y * cols;
      int minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX >= minX) memset(next + rowStart + minX, EMPTY, (size_t)(maxX - minX + 1));
    }
  }

  // ---- cell helpers ----
  inline bool emptyAt(int x, int y) {
    return x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] == EMPTY && next[I(x, y)] == EMPTY;
  }
  inline bool touchesGridEmpty(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && grid[k - 1] == EMPTY) || (x < cols - 2 && grid[k + 1] == EMPTY) ||
           (y > 1 && grid[k - cols] == EMPTY) || (y < rows - 1 && grid[k + cols] == EMPTY);
  }
  inline bool isLiquid(uint8_t m) { return MAT_KIND[m] == K_LIQUID; }
  inline bool isGas(uint8_t m) { return MAT_KIND[m] == K_GAS; }
  inline void writeGridIndex(int k, uint8_t m) {
    if (grid[k] == m) return;
    grid[k] = m;
    markCellIndex(k);
  }
  inline bool isLooseDensityMaterial(uint8_t m) { return DENSITY_SORTED[m] == 1; }
  inline bool canDisplaceByLooseDensity(uint8_t m, uint8_t d) {
    return isLooseDensityMaterial(m) && isLooseDensityMaterial(d) && DENSITY[m] > DENSITY[d];
  }
  inline bool touchesUnstableLooseDensityInterface(int k, uint8_t m) {
    if (!isLooseDensityMaterial(m)) return false;
    int y = k / cols;
    return (y < rows - 1 && canDisplaceByLooseDensity(m, grid[k + cols])) ||
           (y > 1 && canDisplaceByLooseDensity(grid[k - cols], m));
  }
  inline void writeNextIndex(int k, uint8_t m) {
    if (next[k] == m) return;
    next[k] = m;
    if (grid[k] != m || m == FIRE || m == STEAM ||
        (isLiquid(m) && touchesGridEmpty(k)) || touchesUnstableLooseDensityInterface(k, m)) {
      markCellIndex(k);
    }
  }
  inline bool canDisplaceMaterial(uint8_t m, uint8_t d) {
    if (isGas(d)) return true;
    return canDisplaceByLooseDensity(m, d);
  }
  inline bool canEnterIndex(int k, uint8_t m) {
    return next[k] == EMPTY && (grid[k] == EMPTY || canDisplaceMaterial(m, grid[k]));
  }
  inline bool canLiquidEnter(int x, int y, uint8_t m) {
    return x >= 0 && x < cols && y >= 0 && y < rows && canEnterIndex(I(x, y), m);
  }
  inline bool supportsLiquid(uint8_t support, uint8_t m) {
    return support != EMPTY && support != m && !canDisplaceMaterial(m, support);
  }
  void moveMaterialInto(int fromK, int toK, uint8_t m) {
    uint8_t displaced = grid[toK];
    writeNextIndex(toK, m);
    vacatedStamp[fromK] = tick;
    if (displaced != EMPTY && canDisplaceMaterial(m, displaced) &&
        next[fromK] == EMPTY && vacatedStamp[toK] != tick) {
      writeNextIndex(fromK, displaced);
    }
  }
  inline void moveLiquidInto(int fromK, int x, int y, uint8_t m) { moveMaterialInto(fromK, I(x, y), m); }
  inline bool isInBounds(int x, int y) { return x > 0 && x < cols - 1 && y > 0 && y < rows; }

  // ---- settle passes ----
  bool canLooseDensitySettleThisTick(uint8_t m) {
    float mob = MOBILITY[m];
    return mob >= 1 || rand() < mob;
  }
  void settleLooseDensityInterface(int x, int y, int k) {
    uint8_t m = grid[k];
    if (!isLooseDensityMaterial(m) || next[k] != EMPTY) return;
    if (!canLooseDensitySettleThisTick(m)) return;
    int belowK = k + cols;
    if (y + 1 < rows && canDisplaceByLooseDensity(m, grid[belowK]) && next[belowK] == EMPTY) {
      moveMaterialInto(k, belowK, m); return;
    }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i];
      int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx;
      if (canDisplaceByLooseDensity(m, grid[ik]) && next[ik] == EMPTY) {
        moveMaterialInto(k, ik, m); return;
      }
    }
  }
  void settleSand(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    int belowK = k + cols;
    if (y + 1 < rows && x > 0 && x < cols - 1 &&
        grid[belowK] == SAND && grid[belowK - 1] == SAND && grid[belowK + 1] == SAND) {
      if (next[k] == EMPTY) next[k] = SAND;
      return;
    }
    if (y + 1 < rows && grid[belowK] == EMPTY && next[belowK] == EMPTY) {
      vacatedStamp[k] = tick; writeNextIndex(belowK, SAND); return;
    }
    if (y + 1 < rows && canDisplaceMaterial(SAND, grid[belowK]) && next[belowK] == EMPTY) {
      moveMaterialInto(k, belowK, SAND); return;
    }
    int firstDx = rand() < 0.5 ? -1 : 1;
    int secondDx = -firstDx;
    for (int i = 0; i < 2; i++) {
      int dx = i == 0 ? firstDx : secondDx;
      int nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      int ik = belowK + dx;
      uint8_t m = grid[ik];
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
      if ((below == m && bl == m && br == m) ||
          (supportsLiquid(below, m) && bl != EMPTY && !canDisplaceMaterial(m, bl) && br != EMPTY && !canDisplaceMaterial(m, br))) {
        next[k] = m;
        if (y > 1 && grid[k - cols] == EMPTY) markCellIndex(k);
        return;
      }
    }
    if (y + 1 < rows && grid[belowK] == EMPTY && next[belowK] == EMPTY) {
      vacatedStamp[k] = tick; writeNextIndex(belowK, m); return;
    }
    if (y + 1 < rows && canDisplaceMaterial(m, grid[belowK]) && next[belowK] == EMPTY) {
      moveLiquidInto(k, x, y + 1, m); return;
    }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i];
      int nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      int ik = I(nx, ny);
      if (grid[ik] == EMPTY && next[ik] == EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, m); return; }
      if (canDisplaceMaterial(m, grid[ik]) && next[ik] == EMPTY) { moveLiquidInto(k, nx, ny, m); return; }
    }
    int flow = 0;
    int firstFlowDir = rand() < 0.5 ? 1 : -1;
    for (int dirIndex = 0; dirIndex < 2 && flow == 0; dirIndex++) {
      int sgn = dirIndex == 0 ? firstFlowDir : -firstFlowDir;
      for (int d = 1; d <= MAX_WATER_FLOW; d++) {
        int nx = x + sgn * d;
        if (nx <= 0 || nx >= cols - 1) break;
        int sideK = k + sgn * d;
        if (!canEnterIndex(sideK, m)) break;
        if (y + 1 < rows) {
          int lowerK = sideK + cols;
          if (canEnterIndex(lowerK, m)) {
            int stepK = k + sgn;
            if (canEnterIndex(stepK, m)) flow = sgn;
            break;
          }
        }
      }
    }
    if (flow != 0) {
      int stepX = x + flow;
      if (canLiquidEnter(stepX, y, m)) { moveLiquidInto(k, stepX, y, m); return; }
    }
    if (y + 1 < rows && supportsLiquid(grid[belowK], m)) {
      int aboveK = k - cols;
      if (y > 1 && grid[aboveK] == m) {
        for (int i = 0; i < 2; i++) {
          int dx = dirs[i];
          int sideK = k + dx;
          if (x + dx <= 0 || x + dx >= cols - 1) continue;
          if (canEnterIndex(sideK, m) && supportsLiquid(grid[sideK + cols], m)) {
            moveMaterialInto(k, sideK, m); return;
          }
        }
      }
      if (next[k] == EMPTY) writeNextIndex(k, m);
      return;
    }
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i];
      if (canLiquidEnter(x + dx, y, m)) { moveLiquidInto(k, x + dx, y, m); return; }
    }
    if (next[k] == EMPTY) writeNextIndex(k, m);
  }
  void settleLava(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() >= MOBILITY[LAVA]) { writeNextIndex(k, LAVA); return; }
    settleLiquid(x, y, k, LAVA);
  }
  void relaxLiquidGaps() {
    for (int pass = 0; pass < 2; pass++) {
      for (int y = rows - 2; y > 0; y--) {
        int minX = imax(1, activeRowMin[y]);
        int maxX = imin(cols - 2, activeRowMax[y]);
        if (maxX < minX) continue;
        bool ltr = rand() < 0.5;
        int start = ltr ? minX : maxX;
        int end = ltr ? maxX + 1 : minX - 1;
        int stepX = ltr ? 1 : -1;
        for (int x = start; x != end; x += stepX) {
          int k = I(x, y);
          if (grid[k] != EMPTY) continue;
          uint8_t below = grid[I(x, y + 1)];
          if (below == EMPTY) continue;
          int aboveK = I(x, y - 1);
          uint8_t above = grid[aboveK];
          if (above == WATER || above == ACID || above == OIL) {
            writeGridIndex(k, above); writeGridIndex(aboveK, EMPTY); continue;
          }
          const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
          for (int i = 0; i < 2; i++) {
            int dx = dirs[i];
            int sx = x + dx;
            if (sx <= 0 || sx >= cols - 1) continue;
            int sk = I(sx, y);
            uint8_t side = grid[sk];
            if (side != WATER && side != OIL && side != ACID) continue;
            writeGridIndex(k, side); writeGridIndex(sk, EMPTY);
            if (grid[k] != EMPTY) break;
          }
        }
      }
    }
  }
  void separateLooseByDensity() {
    int parity = rand() < 0.5 ? 0 : 1;
    for (int y = 1; y < rows - 1; y++) {
      int minX = imax(1, activeRowMin[y]);
      int maxX = imin(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      bool ltr = (y % 2) == 0;
      int start = ltr ? minX : maxX;
      int end = ltr ? maxX + 1 : minX - 1;
      int stepX = ltr ? 1 : -1;
      for (int x = start; x != end; x += stepX) {
        if (((x + y) % 2) != parity) continue;
        int k = I(x, y);
        int belowK = k + cols;
        uint8_t upper = grid[k], lower = grid[belowK];
        if (canDisplaceByLooseDensity(upper, lower)) {
          writeGridIndex(belowK, upper); writeGridIndex(k, lower);
        }
      }
    }
  }
  void riseSteam(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() < STEAM_DECAY_P || y <= 1) { markCellIndex(k); return; }
    int up = I(x, y - 1);
    if (grid[up] == EMPTY && next[up] == EMPTY && rand() < 0.72) { writeNextIndex(up, STEAM); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i];
      int nx = x + dx, ny = y - 1;
      if (!isInBounds(nx, ny)) continue;
      int ik = I(nx, ny);
      if (grid[ik] == EMPTY && next[ik] == EMPTY) { writeNextIndex(ik, STEAM); return; }
    }
    if (rand() < 0.65) {
      for (int i = 0; i < 2; i++) {
        int dx = dirs[i];
        if (emptyAt(x + dx, y)) { writeNextIndex(I(x + dx, y), STEAM); return; }
      }
    }
    if (next[k] == EMPTY) writeNextIndex(k, STEAM);
  }
  void riseFire(int x, int y, int k) {
    if (next[k] != EMPTY) return;
    if (rand() < FIRE_DECAY_P || y <= 1) { markCellIndex(k); return; }
    const int* dirs = rand() < 0.5 ? DIRS_LF : DIRS_RF;
    if (rand() < 0.36) {
      int up = I(x, y - 1);
      if (grid[up] == EMPTY && next[up] == EMPTY) { writeNextIndex(up, FIRE); return; }
    }
    for (int i = 0; i < 2; i++) {
      int dx = dirs[i];
      int nx = x + dx;
      int ny = rand() < 0.55 ? y - 1 : y;
      if (!isInBounds(nx, ny)) continue;
      int ik = I(nx, ny);
      if (grid[ik] == EMPTY && next[ik] == EMPTY) { writeNextIndex(ik, FIRE); return; }
    }
    if (next[k] == EMPTY) writeNextIndex(k, FIRE);
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
  void drain(int xs, int xe, int y, float liquidP, float sandP) {
    for (int x = xs; x <= xe; x++) {
      int k = I(x, y);
      uint8_t m = grid[k];
      float p = isLiquid(m) ? liquidP : (m == SAND ? sandP : 0);
      if (p && rand() < p) writeGridIndex(k, EMPTY);
    }
  }

  static const int DIRS_LF[2];
  static const int DIRS_RF[2];

  // ---- step ----
  bool step() {
    if (!beginStepDirty()) return false;
    double t0 = emscripten_get_now();
    tick++;
    // Stages 2-5 (rigid/components/reactions/growth) insert here.
    prepareNextBuffer();
    // 4) loose-density interface
    for (int y = rows - 1; y >= 0; y--) {
      int minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX < minX) continue;
      int rowBase = y * cols;
      bool ltr = (y & 1) == 0;
      if (ltr) for (int x = minX; x <= maxX; x++) settleLooseDensityInterface(x, y, rowBase + x);
      else     for (int x = maxX; x >= minX; x--) settleLooseDensityInterface(x, y, rowBase + x);
    }
    // 4b) powders
    for (int y = rows - 1; y >= 0; y--) {
      int minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX < minX) continue;
      int rowBase = y * cols;
      bool ltr = (y & 1) == 0;
      if (ltr) for (int x = minX; x <= maxX; x++) { if (MAT_KIND[grid[rowBase + x]] == K_POWDER) settleSand(x, y, rowBase + x); }
      else     for (int x = maxX; x >= minX; x--) { if (MAT_KIND[grid[rowBase + x]] == K_POWDER) settleSand(x, y, rowBase + x); }
    }
    // 5) liquids
    for (int y = rows - 1; y >= 0; y--) {
      int minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX < minX) continue;
      int rowBase = y * cols;
      bool ltr = (y & 1) == 0;
      if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rowBase + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rowBase + x); else settleLiquid(x, y, rowBase + x, m); }
      else     for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rowBase + x]; if (MAT_KIND[m] != K_LIQUID) continue; if (m == LAVA) settleLava(x, y, rowBase + x); else settleLiquid(x, y, rowBase + x, m); }
    }
    // 6) risers
    for (int y = 0; y < rows; y++) {
      int minX = activeRowMin[y], maxX = activeRowMax[y];
      if (maxX < minX) continue;
      int rowBase = y * cols;
      bool ltr = (y & 1) == 0;
      if (ltr) for (int x = minX; x <= maxX; x++) { uint8_t m = grid[rowBase + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rowBase + x); else riseSteam(x, y, rowBase + x); }
      else     for (int x = maxX; x >= minX; x--) { uint8_t m = grid[rowBase + x]; if (MAT_KIND[m] != K_GAS) continue; if (m == FIRE) riseFire(x, y, rowBase + x); else riseSteam(x, y, rowBase + x); }
    }
    // 7) flip
    uint8_t* tmp = grid; grid = next; next = tmp;
    // 8) relax
    if ((tick & 1) == 0) relaxLiquidGaps();
    // 9) separate
    if (tick % 3 == 0) separateLooseByDensity();
    // 10) sinks
    applySideSinks();
    perfStepMs = emscripten_get_now() - t0;
    return true;
  }

  // ---- brushes (non-component materials) ----
  int paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) {
      int yy = cy + oy;
      if (yy <= 0 || yy >= rows) continue;
      for (int ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        int xx = cx + ox;
        if (xx <= 0 || xx >= cols - 1) continue;
        int k = I(xx, yy);
        if ((overwrite || grid[k] == EMPTY) && grid[k] != material) { grid[k] = material; changed = 1; }
      }
    }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
  int eraseDisc(int cx, int cy, int radius) {
    int changed = 0;
    for (int oy = -radius; oy <= radius; oy++) {
      int yy = cy + oy;
      if (yy <= 0 || yy >= rows) continue;
      for (int ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        int xx = cx + ox;
        if (xx <= 0 || xx >= cols - 1) continue;
        int k = I(xx, yy);
        if (grid[k] != EMPTY) { grid[k] = EMPTY; changed = 1; }
      }
    }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }
};

const int Engine::DIRS_LF[2] = {-1, 1};
const int Engine::DIRS_RF[2] = {1, -1};

// ---------------- C ABI ----------------
extern "C" {

EMSCRIPTEN_KEEPALIVE Engine* engine_create(int cols, int rows, uint32_t seed, int sinks) {
  Engine* e = new Engine(cols, rows, seed, sinks != 0);
  e->markAllDirty();
  return e;
}
EMSCRIPTEN_KEEPALIVE void engine_destroy(Engine* e) { delete e; }
EMSCRIPTEN_KEEPALIVE int engine_step(Engine* e) { return e->step() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_grid(Engine* e) { return e->grid; }
EMSCRIPTEN_KEEPALIVE uint8_t* engine_dirty(Engine* e) { return e->dirtyRender.data(); }
EMSCRIPTEN_KEEPALIVE int engine_dirty_count(Engine* e) { return e->dirtyRenderCount; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_cols(Engine* e) { return e->chunkCols; }
EMSCRIPTEN_KEEPALIVE int engine_chunk_rows(Engine* e) { return e->chunkRows; }
EMSCRIPTEN_KEEPALIVE void engine_fold_dirty(Engine* e) { e->foldRowMarksToRender(); }
EMSCRIPTEN_KEEPALIVE void engine_clear_dirty(Engine* e) {
  memset(e->dirtyRender.data(), 0, e->dirtyRender.size());
  e->dirtyRenderCount = 0;
}
EMSCRIPTEN_KEEPALIVE int engine_paint_disc(Engine* e, int cx, int cy, int r, int mat, int overwrite) {
  return e->paintDisc(cx, cy, r, (uint8_t)mat, overwrite != 0);
}
EMSCRIPTEN_KEEPALIVE int engine_erase_disc(Engine* e, int cx, int cy, int r) {
  return e->eraseDisc(cx, cy, r);
}
EMSCRIPTEN_KEEPALIVE void engine_set_sinks(Engine* e, int v) { e->sinksEnabled = v != 0; }
EMSCRIPTEN_KEEPALIVE double engine_perf_step_ms(Engine* e) { return e->perfStepMs; }
EMSCRIPTEN_KEEPALIVE int engine_perf_dirty_chunks(Engine* e) { return e->perfDirtyChunks; }
EMSCRIPTEN_KEEPALIVE int engine_tick(Engine* e) { return e->tick; }

} // extern "C"
