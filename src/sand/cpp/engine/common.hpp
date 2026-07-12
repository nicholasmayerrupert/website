#pragma once
// Shared declarations for the WASM sand engine (ported from src/sand/*.js).
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <climits>
#include <cmath>
#include <array>
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <set>
#include <algorithm>
#include <utility>
#include <functional>
#include <emscripten.h>
#include <emscripten/console.h>
#ifdef __EMSCRIPTEN_PTHREADS__
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <thread>
#endif

// Material ids, kinds, and flat lookup tables — generated from
// src/sand/materials.schema.json (the single source shared with JS). Run
// `npm run generate` after editing the schema.
#include "materials.generated.hpp"

// JS<->WASM ABI manifest — snapshot strides + named field offsets, shared
// enums (PlayerInput/Tool/CreativeKind), INV_* constants, and ABI_VERSION.
// Generated from src/sand/abi.schema.json; run `npm run generate:abi` after
// editing it and bump abiVersion on any layout change.
#include "abi.generated.hpp"

// WebGL presentation: per-canvas context + shader program registry. The Engine
// (gl.inc) uploads the CPU-generated pixel buffer into a texture and composites.
#include "gl_shared.hpp"

// Tunables (mirror engine.js)
static const int   CHUNK_SIZE = 32, CHUNK_SHIFT = 5;
static const int   MAX_WATER_FLOW = 10;
// Surface levelling stays local: look ahead only to decide whether a side leads to
// a meaningfully lower connected surface, then move one cell sideways. Two passes
// let resting water flow visibly without long-distance correction jumps.
static const int   LIQUID_SURFACE_LOOKAHEAD = 64, LIQUID_SURFACE_FLOW_PASSES = 2;
// Liquid↔liquid density-chain relocation (resolveLiquidDisplacements): multi-source
// BFS visit budget = min(gridLen, max(BASE, need * PER)). Keeps enclosed-pool
// floods from freezing a tick the way a per-cell BFS would.
static const int   LIQUID_DISP_VISIT_BASE = 4096, LIQUID_DISP_VISIT_PER = 128;
static const float STEAM_DECAY_P = 0.018f, FIRE_DECAY_P = 0.006f;
static const int   DIRTY_PAD_X = MAX_WATER_FLOW + 2, DIRTY_PAD_Y = 2;
static const int   SINK_STRIP_W = 2, INNER_STRIP_W = 1;
static const float SINK_LIQUID_P = 0.85f, SINK_SAND_P = 0.35f, INNER_LIQUID_P = 0.35f, INNER_SAND_P = 0.10f;
static const float OIL_IGNITE_P = 0.25f, PLANT_IGNITE_P = 0.25f * 0.67f, FIRE_SPREAD_P = 0.11f;
// Chance a FIRE cell ignites a flammable at the SAME (x,y) in the OTHER layer.
static const float FIRE_CROSS_P = 0.18f;
// Acid flows + renews enclosed-cell activity every tick, but resolves static
// terrain corrosion in short batches. The batch chance is deliberately higher
// than the stationary 1-(1-.12)^3 probability: fixed-seed gameplay calibration
// keeps cut depth close to the old cadence before moving acid escapes, while
// component split/joint work is still paid only once every three ticks. Free
// rigid-body erosion keeps the original per-tick ACID_DISSOLVE_P below.
static const int ACID_REACT_INTERVAL = 3;
static const float ACID_DISSOLVE_P = 0.12f, ACID_BATCH_DISSOLVE_P = 0.75f;
static const float ACID_DECAY_P = 0.4f, LAVA_EMIT_FIRE_P = 0.001f, ICE_FREEZE_P = 0.03f;
static const float ACRID_SMOKE_P = 0.5f; // chance a dissolved cell emits acrid smoke instead of leaving empty space
// Acrid smoke is wispier and shorter-lived than steam so a big acid burn doesn't
// leave a long-lived gas cloud that keeps the layer active (each active step pays a
// full-grid grounding reflood). ACRID_TRAPPED_DECAY_P: smoke boxed in by liquid/solid
// can't vent, so instead of churning up through the fluid forever it dissolves fast.
static const float ACRID_DECAY_P = 0.05f, ACRID_TRAPPED_DECAY_P = 0.30f;
static const int   MAX_WOOD_CELLS = 120, MAX_LEAF_CELLS = 105, WATER_PER_GROWTH = 1, TRUNK_THICKEN_UNTIL_WOOD = 52;
static const float GROWTH_P = 0.58f, LEAF_GROWTH_P = 0.54f;
static const float LEAF_SEED_DROP_P = 0.10f;
static const float TRUNK_SIDE_FILL_P = 0.96f, TRUNK_DOUBLE_SIDE_FILL_P = 0.78f, TRUNK_WIDE_SIDE_FILL_P = 0.34f;
static const int   MYCELIUM_MAX_CELLS = 180, MYCELIUM_MAX_AGE = 1100;
static const float MYCELIUM_GROWTH_P = 0.34f;

static inline int imin(int a, int b) { return a < b ? a : b; }
static inline int imax(int a, int b) { return a > b ? a : b; }

// Path-halving union-find over an index parent vector (shared by the grounding
// bond union, joint groups, blob reconnects, and rigid sleep islands).
static inline int ufFind(std::vector<int>& p, int a) { while (p[a] != a) { p[a] = p[p[a]]; a = p[a]; } return a; }
static inline void ufUnite(std::vector<int>& p, int a, int b) { int ra = ufFind(p, a), rb = ufFind(p, b); if (ra != rb) p[ra] = rb; }

// Generation-stamped membership set over cell indices: O(1) add/has/remove and
// O(1) clear (bump the generation). Replaces per-call unordered_set<int> hashing
// on hot planning paths. MEMBERSHIP ONLY — it cannot be iterated, so any set
// whose iteration order feeds cell writes or FP accumulation must stay a real
// container (this can still mirror its membership tests).
struct StampSet {
  std::vector<int32_t> stamp;
  int32_t gen = 0;
  // Start a fresh (empty) set sized for `n` cells; call before each use.
  void reset(size_t n) {
    if (stamp.size() < n) stamp.assign(n, 0);
    if (++gen == INT32_MAX) { std::fill(stamp.begin(), stamp.end(), 0); gen = 1; }
  }
  // Bounds-checked: assembly probe sets may briefly hold OOB cell indices near
  // the floor/ceiling; treating those as non-members avoids WASM OOB traps.
  void add(int k) { if ((unsigned)k < stamp.size()) stamp[k] = gen; }
  bool has(int k) const { return (unsigned)k < stamp.size() && stamp[k] == gen; }
  void remove(int k) { if ((unsigned)k < stamp.size()) stamp[k] = 0; }
};

// Persistent workers used by the checkerboard scheduler. Emscripten satisfies
// these std::threads from PTHREAD_POOL_SIZE, avoiding per-frame worker creation.
// The calling thread participates, then waits at one barrier per color wave.
class CheckerboardPool {
#ifdef __EMSCRIPTEN_PTHREADS__
  std::vector<std::thread> workers;
  std::mutex mutex;
  std::condition_variable startCv, doneCv;
  std::function<void(int)> job;
  std::atomic<int> next{0};
  int limit = 0, remaining = 0;
  uint64_t generation = 0;
  bool stopping = false;

  void workerLoop() {
    uint64_t seen = 0;
    for (;;) {
      std::unique_lock<std::mutex> lock(mutex);
      startCv.wait(lock, [&] { return stopping || generation != seen; });
      if (stopping) return;
      seen = generation;
      lock.unlock();
      for (;;) { int i = next.fetch_add(1, std::memory_order_relaxed); if (i >= limit) break; job(i); }
      lock.lock();
      if (--remaining == 0) doneCv.notify_one();
    }
  }
#endif

 public:
  CheckerboardPool() {
#ifdef __EMSCRIPTEN_PTHREADS__
    for (int i = 0; i < 3; i++) workers.emplace_back([this] { workerLoop(); });
#endif
  }
  ~CheckerboardPool() {
#ifdef __EMSCRIPTEN_PTHREADS__
    { std::lock_guard<std::mutex> lock(mutex); stopping = true; generation++; }
    startCv.notify_all();
    for (auto& worker : workers) worker.join();
#endif
  }
  template <typename Fn>
  void parallelFor(int count, Fn&& fn) {
#ifdef __EMSCRIPTEN_PTHREADS__
    if (count >= 8 && !workers.empty()) {
      {
        std::lock_guard<std::mutex> lock(mutex);
        job = std::forward<Fn>(fn); limit = count; next.store(0, std::memory_order_relaxed);
        remaining = (int)workers.size(); generation++;
      }
      startCv.notify_all();
      for (;;) { int i = next.fetch_add(1, std::memory_order_relaxed); if (i >= limit) break; job(i); }
      std::unique_lock<std::mutex> lock(mutex);
      doneCv.wait(lock, [&] { return remaining == 0; });
      job = nullptr;
      return;
    }
#endif
    for (int i = 0; i < count; i++) fn(i);
  }
};

// Tool ids live in abi.generated.hpp (enum Tool). The engine owns all tool
// policy: brush radii, which tool paints/erases/drafts/spawns, the right-click
// eraser, draft lifecycle, seed placement, and emit throttling.

// Held movement/pan keys forwarded from the browser (createSandGame maps the
// physical keys onto these). The engine owns the camera + input policy now:
// free-camera panning, the player input bitmask, and the pointer->aim mapping.
enum InputKey : int { IK_LEFT = 0, IK_RIGHT, IK_UP, IK_DOWN, IK_SPACE, IK_SHIFT };
static const double CAM_PAN_CELLS_PER_SEC = 100.0; // camera pan speed while a key is held
static const double CAM_FOLLOW_LERP = 0.18;        // play-mode follow glide
static const double CAM_SURFACE_VIEW_Y_FRAC = 2.0 / 3.0; // surface sits ~2/3 down the view
static const int    CAM_SHIFT_EDGE_MARGIN = 40;    // slide the world this near a buffer edge
// Predictive worldgen prefetch: begin generating the upcoming stream-in band this
// many cells of camera travel BEFORE the shift boundary, so the band's tiles are
// cached by the time the shift fires (fillRect skipped). The per-frame worldgen
// budget bounds the prefetch's own frame cost (~1.5ms; spread over several frames).
static const int    PREFETCH_LOOKAHEAD = 96;
static const int    PREFETCH_CELLS_PER_FRAME = 9000;
static const int BRUSH_SAND = 2, BRUSH_WATER = 2, BRUSH_OIL = 2, BRUSH_FIRE = 1, BRUSH_ACID = 2,
                 BRUSH_LAVA = 2, BRUSH_ICE = 2, BRUSH_STONE = 2, BRUSH_DRIFTWOOD = 1, BRUSH_ERASE = 3, CUBE_HALF = 6;
static const double EMIT_INTERVAL_MS = 18.0;
// How far the infinite world slides per streaming shift (cells).
static const int WORLD_SHIFT_COLS = 128;
static const int WORLD_SHIFT_ROWS = 96; // vertical stream step (tile-aligned; smaller so it fits short buffers)

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

// Flora species — drives growth rules + which wood/leaf material a tree is made of.
// 0 = OAK = the original behavior, so existing/un-typed plant comps are unchanged.
enum PlantType : uint8_t { PT_OAK = 0, PT_PINE, PT_WILLOW, PT_CACTUS, PT_MUSHROOM, PT_BUSH };

struct Comp {
  int id = 0;
  uint8_t plantType = PT_OAK; // flora species (plant comps only); survives shifts/splits/streaming
  // Cell membership as a flat vector (NOT a hash set): components are iterated far
  // more than queried, and a world shift must re-index every cell — an in-place
  // vector offset is ~10x cheaper than rebuilding an unordered_set (the periodic
  // pan stutter). Inserts are dedup'd by construction at every call site (an
  // EMPTY/seen guard precedes each push_back), so no cell is ever added twice.
  std::vector<int> cells;
  int yMax = 0;
  int woodCount = 0, leafCount = 0, age = 0;
  bool cacheDirty = false;
  bool grounded = false;
  // Last committed vertical component move. A prior buoyant rise supplies
  // surface hysteresis while liquid still supports the underside.
  int8_t buoyancyDirection = 0;
  // Only SEEDED plants actively grow. Worldgen-stamped trees (and restored/streamed
  // comps) are inert scenery (growing=false) so they never self-activate the sim.
  // Cleared once a growing plant reaches its species' size cap.
  bool growing = false;
  std::vector<int> woodCells, seedWoodCells;
};

// Free rigid body: continuous float pose, solved in rigidStep (rigid2d.js port).
struct Body {
  int id = 0;
  std::vector<uint8_t> occ; int w = 0, h = 0;
  double offsetX = 0, offsetY = 0;
  double px = 0, py = 0, angle = 0;
  double vx = 0, vy = 0, omega = 0;
  uint8_t material = RIGID; double density = 1;
  bool awake = true; int stillTicks = 0;
  int fuseTicks = 0; // >0 = a lit TNT body counting down to detonation (explosives.inc)
  std::vector<float> points; int nPts = 0;
  std::vector<int> boundaryPts;
  // Local-space collision samples (interleaved lx,ly): the cell centre plus the
  // midpoint of every exposed cell face and exposed convex corner. The body
  // shape is the union of 1x1 occupied squares, so sampling only cell centres
  // misses the exposed edges of thin shapes; these are cached and rebuilt only
  // when the occupancy changes (computeDerived).
  std::vector<float> boundarySamples;
  double invMass = 0, invInertia = 0, maxR = 0;
  // transient per-step
  double cs = 1, sn = 0;
  double sweepMargin = 0;
  double aabbX0 = 0, aabbY0 = 0, aabbX1 = 0, aabbY1 = 0;
  double pvx = 0, pvy = 0, pw = 0;
  // omega entering the substep's contact solve (before the solver converts the
  // body's fall into rotation). Used to tell a genuine topple — where the solver
  // feeds angular velocity that grows in one direction each substep — apart from
  // rest jitter, so contact damping settles the latter without crushing the former.
  double omegaPre = 0;
  bool hadContact = false; double maxDepth = 0; int idx = 0;
};
struct Contact { Body* a; Body* b; double rax, ray, rbx, rby, nx, ny, depth, accJn, accJt, accBias; };

// ---- Dropped items + cosmetic particles (items.inc) ----
// A lightweight NON-GRID entity. IT_ITEM = a dropped material the player can pick
// up; IT_PARTICLE = a short-lived fleck of mining debris (no pickup). Items fall
// under gravity (slower in liquid), rest on the SURFACE of solids (never buried —
// they rise out if covered), pass through each other (no stacking), and MAGNET
// toward a nearby player. Pose is buffer-local cell coords like Player/Body, so a
// world shift remaps them by (dx,dy). Updated with NO rand(), so the sim RNG stream
// stays byte-identical.
enum ItemKind : uint8_t { IT_ITEM = 0, IT_PARTICLE = 1 };
static const double IT_GRAVITY = 0.18, IT_MAX_FALL = 4.0;
static const double IT_LIQUID_GRAVITY = 0.05, IT_LIQUID_MAX_FALL = 0.9, IT_LIQUID_DRAG = 0.85;
static const double IT_MOVE_SUBSTEP = 0.34;  // sub-cell stepping prevents tunneling
static const int    IT_PICKUP_DELAY = 12;    // steps after spawn before a drop can be vacuumed
static const double IT_PICKUP_R = 1.6;       // collect radius (cells, from player center) — magnet feeds it
static const double IT_MAGNET_R = 14.0;      // homing radius: within this an item flies to the player
static const double IT_MAGNET_MAX_SPEED = 4.5; // homing speed clamp (cells/step). Pure-pursuit (velocity
                                               // points straight at the player each step) so items never orbit.
static const double IT_RISE_STEP = 1.0;      // un-bury rise speed when an item is inside a solid
static const double IT_BOB_AMP = 0.14;       // render-only surface bob amplitude (cells)
static const int    IT_BOB_PERIOD = 70;      // render-only bob period (steps)
static const double IT_THROW_SPEED = 1.7;    // horizontal throw speed (facing direction)
static const double IT_THROW_UP = -0.9;      // upward kick on a throw
static const int    IT_THROW_PICKUP_DELAY = 40; // a thrown item ignores the magnet this long
static const int    IT_PARTICLE_LIFE = 24;   // default mining-debris lifetime (steps)
static const int    IT_MAX_ITEMS = 1024;     // hard cap; oldest particle (then item) evicted
// Item snapshot layout: IS_* offsets / IS_STRIDE in abi.generated.hpp.
struct Item {
  int id = 0;
  uint8_t kind = IT_ITEM;
  uint8_t material = 0;
  uint8_t count = 1;       // stack carried by this dropped item (merged at pickup)
  uint8_t plantType = PT_OAK; // species carried by SEED items
  double px = 0, py = 0;   // buffer-local cell coords (a point), +y down
  double vx = 0, vy = 0;   // cells per step
  int life = 0;            // PARTICLE: steps remaining
  int pickupDelay = 0;     // ITEM: steps before it can be vacuumed (and homed)
};

// ---- Player (Terraria-like character; simulated in C++, presented in JS) ----
// Input is a normalized bitmask (enum PlayerInput in abi.generated.hpp)
// supplied by JS/network each step. Physics is fully deterministic (no RNG)
// and runs at a fixed per-step timestep so a fixed input stream replays
// identically — the foundation for multiplayer.
// Player physics tunables (cells; velocities in cells per fixed step).
static const int    PLAYER_W = 4, PLAYER_H = 8;
// Gravity is deliberately soft so falls feel floaty at sand-cell scale.
// Move/run caps are ~2/3 of the original platformer values.
static const double P_GRAVITY = 0.078125, P_MAX_FALL = 6.0;
// Speed was cut ~33% from 0.42/1.05; restored half that cut → mid-way boost.
static const double P_MOVE_ACCEL = 0.35, P_MAX_RUN = 0.875, P_RUN_MULT = 1.7;
// Jump height ~ v^2/(2g); √0.75 keeps height ~25% lower at current gravity.
static const double P_GROUND_FRICTION = 0.55, P_AIR_FRICTION = 0.92, P_JUMP_VEL = 2.035;
static const double P_MOVE_SUBSTEP = 0.25; // sub-cell stepping prevents tunneling
static const double P_STEP_UP = 2.0;       // auto-climb height for low (1-2px) ledges
static const int    P_BURY_JUMP_MAX = 4;   // max embed depth (px) a player can still jump out of (else must dig)
// Player tool use (Phase 3): reach limit, per-action cooldown, brush radii.
static const double P_TOOL_REACH = 30.0;   // max cells from player center (place/mine further)
static const int    P_TOOL_COOLDOWN = 4;   // steps between held creative/place actions (survival mining progresses every tick)
static const int    P_MINE_R = 2, P_PAINT_R = 2, P_BUILD_R = 2;
// Eraser hits happen at this constant cadence for every material. DURABILITY[]
// controls how many hits a cell survives, not the time between hits.
// Player buoyancy: liquids are non-solid to the player, so without this he'd fall
// through at full speed. Submersion is measured as the fraction of his AABB cells
// that are liquid: past MIN_COVERAGE he's "in liquid" (gentle gravity, velocity
// drag, low terminal sink speed, slower running); past the higher SWIM_COVERAGE he
// can also swim upward with the jump key. Two coverage thresholds (not a ramp) keep
// the behavior crisp: wade-drag vs full swim.
static const double P_LIQUID_MIN_COVERAGE = 0.20, P_LIQUID_SWIM_COVERAGE = 0.45;
static const double P_LIQUID_GRAVITY = 0.08, P_LIQUID_MAX_FALL = 1.15, P_LIQUID_MAX_RISE = -1.8;
static const double P_LIQUID_RUN_MULT = 0.55, P_LIQUID_DRAG_X = 0.76, P_LIQUID_DRAG_Y = 0.82, P_LIQUID_SWIM_ACCEL = 0.34;
// ---- Survival inventory (inventory.inc) ----
// A fixed grid of stacks per player: the first INV_HOTBAR slots are the always-
// visible hotbar; the rest are the openable grid. A slot holds either a material
// stack (placeable) or a tool (mines; never stacks). count 0 = empty.
// INV_HOTBAR / INV_SLOTS live in abi.generated.hpp (shared with the JS HUD).
static const int INV_GRID = INV_SLOTS - INV_HOTBAR; // 27
static const int INV_STACK_MAX = 999;
// Inventory snapshot layout: IVS_* offsets / IVS_STRIDE in abi.generated.hpp.
struct InvSlot {
  uint8_t material = 0;   // material id for a stack (0 when a tool or empty)
  uint8_t isTool = 0;     // 1 = a mining tool (class/tier below), not a placeable stack
  uint8_t toolClass = 0;  // ToolClass when isTool
  uint8_t toolTier = 0;   // ToolTier when isTool
  uint8_t plantType = PT_OAK; // species carried by SEED stacks
  int count = 0;          // stack size (tools = 1); 0 = empty
};
// Survival tool footprints are engine-defined shape masks. v1 ships square presets,
// but the shape representation is generic so future custom patterns can reuse the
// same placement/mining/draft code paths.
struct SurvivalFootprintCell {
  int8_t ox = 0, oy = 0;
};
struct SurvivalFootprint {
  uint8_t id = 0;
  uint8_t width = 0, height = 0;
  int8_t anchorX = 0, anchorY = 0; // aimed cell maps to local mask cell (anchorX,anchorY)
  std::vector<SurvivalFootprintCell> cells; // deterministic center-first ordering
};
// Footprint snapshot layout: FP_* offsets / FP_STRIDE in abi.generated.hpp.
static const int SURVIVAL_FOOTPRINT_MAX_SIZE = 8;
static const int SURVIVAL_FOOTPRINT_DEFAULT_ID = 2;  // 3x3 in the default preset list
static const uint32_t SURVIVAL_MINING_SPEED_MULTIPLIER = 8;

// Creative brush mode (tools.inc): the searchable palette selects ANY material,
// any seed species, the eraser, or the cube; the brush routes by mode rather than a
// fixed per-material Tool enum. PAINT = powder/liquid/gas (continuous), DRAFT = a
// component material drawn with a live preview then dropped on release.
enum CreativeMode : uint8_t { CM_PAINT = 0, CM_DRAFT, CM_SEED, CM_MYCELIUM_SPORE, CM_ERASE, CM_CUBE, CM_CREATURE };
// enum CreativeKind (what engine_set_creative_material's kind refers to) lives
// in abi.generated.hpp.

// ---- Player sprite + animation (player.inc state pick; gl.inc per-pixel blit) ----
// Deterministic: animState picked from physics at the end of integratePlayer, frame
// derived from the actor tick, so prediction/replay reproduce the same frame.
enum AnimState : uint8_t { AS_IDLE = 0, AS_WALK, AS_RUN, AS_RISE, AS_FALL, AS_WADE, AS_SWIM, AS_COUNT };
static const double AS_MOVE_EPS = 0.10;            // |vx| below -> idle
static const double AS_RUN_SPEED = P_MAX_RUN * 0.95; // run only past ~walk top speed
static const double AS_RISE_EPS = 0.05;            // airborne |vy| below -> treat as fall (apex)
static const uint8_t ANIM_N[AS_COUNT] = {2, 4, 4, 2, 2, 2, 4}; // frames per state
static const uint8_t ANIM_T[AS_COUNT] = {36, 8, 5, 6, 6, 14, 7}; // ticks per frame
// Sprite: 6x10 sprite-pixels, each = one world cell. Anchored at AABB offset (-1,-2)
// cells so feet plant on the surface and the body centers on the 4-wide hitbox.
static const int SPR_W = 6, SPR_H = 10;
static const float SPR_PAL[8][4] = {
  {0, 0, 0, 0},                                       // 0 transparent
  {26 / 255.f, 20 / 255.f, 28 / 255.f, 1},            // 1 outline
  {232 / 255.f, 180 / 255.f, 140 / 255.f, 1},         // 2 skin
  {188 / 255.f, 128 / 255.f, 96 / 255.f, 1},          // 3 skin-shadow
  {120 / 255.f, 72 / 255.f, 40 / 255.f, 1},           // 4 hair
  {70 / 255.f, 130 / 255.f, 200 / 255.f, 1},          // 5 shirt
  {60 / 255.f, 56 / 255.f, 78 / 255.f, 1},            // 6 pants
  {40 / 255.f, 30 / 255.f, 24 / 255.f, 1},            // 7 boots
};
// [state][frame][row] of 6-char digit rows (palette indices), facing RIGHT (mirror for
// left). Unused frame slots (states with N<4) repeat frame 0 and are never indexed.
static const char* const SPR_GRID[AS_COUNT][4][SPR_H] = {
  { // AS_IDLE
    {"011110","014410","142421","112221","015551","055552","055552","066662","007700","007000"},
    {"000000","011110","014410","142421","112221","015551","055552","066662","077770","007700"},
    {"011110","014410","142421","112221","015551","055552","055552","066662","007700","007000"},
    {"011110","014410","142421","112221","015551","055552","055552","066662","007700","007000"},
  },
  { // AS_WALK
    {"011110","014410","142421","112221","015551","055552","055552","066662","077070","070007"},
    {"011110","014410","142421","112221","015551","055552","055552","066662","007700","007700"},
    {"011110","014410","142421","112221","015551","055552","055552","066662","070070","700070"},
    {"011110","014410","142421","112221","015551","055552","055552","066662","007700","070070"},
  },
  { // AS_RUN
    {"001111","001441","014242","011222","001555","005555","055552","066620","066000","070700"},
    {"001111","001441","014242","011222","001555","005555","055552","066662","000770","007007"},
    {"001111","001441","014242","011222","001555","005555","055552","066662","007070","070070"},
    {"001111","001441","014242","011222","001555","005555","055552","066620","066700","007000"},
  },
  { // AS_RISE
    {"011110","014410","142421","112221","015551","555555","055550","066660","007700","000000"},
    {"050000","015110","014410","142421","112221","015551","055552","066662","006600","000000"},
    {"011110","014410","142421","112221","015551","555555","055550","066660","007700","000000"},
    {"011110","014410","142421","112221","015551","555555","055550","066660","007700","000000"},
  },
  { // AS_FALL
    {"011110","014410","142421","112221","515555","055550","066660","066660","070070","700007"},
    {"510015","014410","142421","112221","115551","055552","066660","066660","700070","070007"},
    {"011110","014410","142421","112221","515555","055550","066660","066660","070070","700007"},
    {"011110","014410","142421","112221","515555","055550","066660","066660","070070","700007"},
  },
  { // AS_WADE
    {"011110","014410","142421","112221","515551","055552","055552","000000","000000","000000"},
    {"011110","014410","142421","112221","155555","055552","055552","000000","000000","000000"},
    {"011110","014410","142421","112221","515551","055552","055552","000000","000000","000000"},
    {"011110","014410","142421","112221","515551","055552","055552","000000","000000","000000"},
  },
  { // AS_SWIM
    {"000000","000000","000550","014455","142255","112225","005555","066600","006600","000000"},
    {"000000","000000","000000","014405","142255","112255","055555","666000","060600","000000"},
    {"000000","000000","000000","014400","142220","112250","055555","066660","006600","000000"},
    {"000000","000000","000550","014455","142255","112225","005555","060060","600060","000000"},
  },
};

struct Player {
  int id = 0;
  bool active = true, alive = true;
  double px = 0, py = 0;   // AABB top-left, cell coords (world-local to the buffer)
  double vx = 0, vy = 0;   // cells per step (+y is down, matching the grid)
  int w = PLAYER_W, h = PLAYER_H;
  int facing = 1;          // +1 right, -1 left
  bool grounded = false;
  int selectedTool = T_ERASER;
  double aimX = 0, aimY = 0; // cell coords of the aim/cursor
  int input = 0;
  int prevInput = 0;       // last step's input bits (for single-shot edge detection)
  bool jumpReady = false;  // armed (grounded + jump released); persists so a press isn't lost to a 1-frame grounded flicker
  uint32_t inputSeq = 0;   // last applied input sequence (multiplayer)
  int health = 100;
  int hurtCooldown = 0; // contact-damage immunity; also protects a fresh respawn
  int toolCooldown = 0; // steps remaining before this player can act again
  bool mineActive = false;
  int mineLayer = 0, mineX = 0, mineY = 0, mineFootprint = -1;
  // Held mining tool: a destroyed cell drops its material only when this class/tier
  // satisfies the material's MAT_TOOLCLASS/MAT_TOOLTIER gate (set from the selected
  // inventory slot in inventory.inc; defaults to a bare hand).
  uint8_t heldToolClass = TC_HAND, heldToolTier = TT_HAND;
  // Survival inventory: hotbar + grid stacks, and the selected hotbar slot.
  InvSlot inv[INV_SLOTS];
  int selectedSlot = 0;
  int selectedFootprint = SURVIVAL_FOOTPRINT_DEFAULT_ID;
  bool placeStrokeActive = false;
  int placeStrokeX = 0, placeStrokeY = 0, placeStrokeLayer = 0, placeStrokeFootprint = -1;
  uint8_t placeStrokeMaterial = EMPTY;
  // The stack currently "held on the cursor" (Minecraft-style pick/place/throw). 0 = empty.
  InvSlot cursor;
  // Animation (computed at the end of integratePlayer; frame derived from actorTick).
  uint8_t animState = AS_IDLE, animFrame = 0;
};
// Player snapshot layout: PS_* offsets / PS_STRIDE in abi.generated.hpp.

// Rigid tunables (rigid2d.js)
static const double R_GRAVITY = 0.06, R_MAX_SPEED = 3.0, R_SAFE_SUBSTEP = 0.5;
static const int    R_MAX_SUBSTEPS = 10, R_SOLVER_ITERS = 64, R_SLEEP_TICKS = 20;
// Swept body collision: surfaces touch within R_CONTACT_SKIN cells (resting
// stability + earlier contact), and a sample's per-substep relative path is
// marched in steps no larger than R_SWEEP_STEP cells looking for first impact.
static const double R_CONTACT_SKIN = 0.1, R_SWEEP_STEP = 0.4;
static const double R_RESTITUTION = 0, R_FRICTION = 0.6, R_BAUMGARTE = 0.2, R_MAX_BIAS_VEL = 0.3, R_PEN_SLOP = 0.5;
static const double R_CONTACT_LIN_DAMP = 0.9, R_CONTACT_ANG_DAMP = 0.6, R_LIQUID_DRAG = 0.12, R_LIQUID_ANG_DRAG = 0.1;
static const double R_SLEEP_LIN = 0.007, R_SLEEP_ANG = 0.0045;
static const double R_SETTLE_LIN = R_SLEEP_LIN * 8, R_SETTLE_ANG = R_SLEEP_ANG * 8;
static const double R_BUOY_REST_BAND = 0.08, R_BUOY_REST_DAMP = 0.45, R_BUOY_ZERO_VY = 0.02;
static const double R_WAKE_LIN2 = 0.028 * 0.028, R_WAKE_ANG2 = 0.014 * 0.014, R_REST_DEPTH = 1.0;

// View camera + input state class (extracted from the Engine in 5c; needs the
// CAM_*/PLAYER_H constants and enums above).
#include "camera.hpp"
// Multiplayer world replication class (extracted in 5c; composed by Engine).
#include "netsync.hpp"
// Per-layer simulation state (hoisted from the Engine in 5c).
#include "layer.hpp"
// Deterministic terrain-query class (extracted in 5c; composed by Engine).
#include "terrain.hpp"
// Pixel generation + lighting class (extracted in 5c; composed by Engine).
#include "renderer.hpp"
// Material-aware non-player actors (AI, combat, spawning, world persistence).
#include "creatures.hpp"
// WebGL compositor class (extracted in 5c; composed by Engine).
#include "glpresenter.hpp"
// Dropped items + particles class (extracted in 5d; composed by Engine).
#include "items.hpp"
// Survival inventory policy class (extracted in 5d; composed by Engine).
#include "inventory.hpp"
// Player characters class (extracted in 5d; composed by Engine).
#include "player.hpp"
// Tool semantics class (extracted in 5d; composed by Engine).
#include "tools.hpp"
// Material reactions class (extracted in 5e; composed by Engine).
#include "reactions.hpp"
// TNT / explosives class (extracted in 5e; composed by Engine).
#include "explosives.hpp"
// Plant + mycelium growth class (extracted in 5e; composed by Engine).
#include "growth.hpp"
// Components + grounding class (extracted in 5f; composed by Engine).
#include "components.hpp"
// Free rigid bodies class (extracted in 5f; composed by Engine).
#include "rigid.hpp"
