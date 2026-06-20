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

// Material ids, kinds, and flat lookup tables — generated from
// src/sand/materials.schema.json (the single source shared with JS). Run
// `npm run generate` after editing the schema.
#include "materials.generated.hpp"

// WebGL presentation: per-canvas context + shader program registry. The Engine
// (gl.inc) uploads the CPU-generated pixel buffer into a texture and composites.
#include "gl_shared.hpp"

// Tunables (mirror engine.js)
static const int   CHUNK_SIZE = 32, CHUNK_SHIFT = 5, SEED_SIZE = 2;
static const int   MAX_WATER_FLOW = 10;
// How far along a connected free surface the leveller looks for a lower column to
// pour into (levelLiquidSurfaces). Bounds the residual: a settled surface is flat to
// <=1px within any window this wide, so a wider body keeps a gentle (imperceptible)
// slope while still going fully inert.
static const int   LIQUID_LEVEL_RANGE = 128;
static const float STEAM_DECAY_P = 0.018f, FIRE_DECAY_P = 0.006f;
static const int   DIRTY_PAD_X = MAX_WATER_FLOW + 2, DIRTY_PAD_Y = 2;
static const int   SINK_STRIP_W = 2, INNER_STRIP_W = 1;
static const float SINK_LIQUID_P = 0.85f, SINK_SAND_P = 0.35f, INNER_LIQUID_P = 0.35f, INNER_SAND_P = 0.10f;
static const float BUOY_BAND_FRAC = 0.5f, BUOY_BAND_MIN = 1.5f, BUOY_DRAFT_SCALE = 0.5f, BUOY_WET_PERIMETER_FRAC = 0.75f, BUOY_SUPPORT_FRAC = 0.5f;
static const float OIL_IGNITE_P = 0.25f, PLANT_IGNITE_P = 0.25f * 0.67f, FIRE_SPREAD_P = 0.11f;
// Chance a FIRE cell ignites a flammable at the SAME (x,y) in the OTHER layer.
static const float FIRE_CROSS_P = 0.18f;
static const float ACID_DISSOLVE_P = 0.12f, ACID_DECAY_P = 0.4f, LAVA_EMIT_FIRE_P = 0.001f, ICE_FREEZE_P = 0.03f;
static const int   MAX_WOOD_CELLS = 120, MAX_LEAF_CELLS = 105, WATER_PER_GROWTH = 2, TRUNK_THICKEN_UNTIL_WOOD = 52;
static const float GROWTH_P = 0.58f, LEAF_GROWTH_P = 0.54f;
static const float TRUNK_SIDE_FILL_P = 0.96f, TRUNK_DOUBLE_SIDE_FILL_P = 0.78f, TRUNK_WIDE_SIDE_FILL_P = 0.34f;

static inline int imin(int a, int b) { return a < b ? a : b; }
static inline int imax(int a, int b) { return a > b ? a : b; }

// Tool ids (mirror the JS tool-name -> int map in createSandGame). The engine
// owns all tool policy: brush radii, which tool paints/erases/drafts/spawns,
// the right-click eraser, draft lifecycle, seed placement, and emit throttling.
enum Tool : int { T_CUBE = 0, T_SAND, T_WATER, T_STONE, T_OIL, T_FIRE, T_ACID, T_LAVA, T_ICE, T_SEED, T_DRIFTWOOD, T_ERASER };

// Held movement/pan keys forwarded from the browser (createSandGame maps the
// physical keys onto these). The engine owns the camera + input policy now:
// free-camera panning, the player input bitmask, and the pointer->aim mapping.
enum InputKey : int { IK_LEFT = 0, IK_RIGHT, IK_UP, IK_DOWN, IK_SPACE, IK_SHIFT };
static const double CAM_PAN_CELLS_PER_SEC = 100.0; // camera pan speed while a key is held
static const double CAM_FOLLOW_LERP = 0.18;        // play-mode follow glide
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
static const int    ITEM_SNAP_STRIDE = 7;    // id, kind, material, count, px, py, life
struct Item {
  int id = 0;
  uint8_t kind = IT_ITEM;
  uint8_t material = 0;
  uint8_t count = 1;       // stack carried by this dropped item (merged at pickup)
  double px = 0, py = 0;   // buffer-local cell coords (a point), +y down
  double vx = 0, vy = 0;   // cells per step
  int life = 0;            // PARTICLE: steps remaining
  int pickupDelay = 0;     // ITEM: steps before it can be vacuumed (and homed)
};

// ---- Player (Terraria-like character; simulated in C++, presented in JS) ----
// Input is a normalized bitmask supplied by JS/network each step. Physics is
// fully deterministic (no RNG) and runs at a fixed per-step timestep so a fixed
// input stream replays identically — the foundation for multiplayer.
enum PlayerInput : int {
  PI_LEFT = 1, PI_RIGHT = 2, PI_JUMP = 4, PI_DOWN = 8,
  PI_PRIMARY = 16, PI_SECONDARY = 32, PI_RUN = 64
};
// Player physics tunables (cells; velocities in cells per fixed step).
static const int    PLAYER_W = 4, PLAYER_H = 8;
static const double P_GRAVITY = 0.25, P_MAX_FALL = 6.0;
static const double P_MOVE_ACCEL = 0.6, P_MAX_RUN = 1.6, P_RUN_MULT = 1.7;
static const double P_GROUND_FRICTION = 0.55, P_AIR_FRICTION = 0.92, P_JUMP_VEL = 2.8;
static const double P_MOVE_SUBSTEP = 0.25; // sub-cell stepping prevents tunneling
static const double P_STEP_UP = 2.0;       // auto-climb height for low (1-2px) ledges
static const int    P_BURY_JUMP_MAX = 4;   // max embed depth (px) a player can still jump out of (else must dig)
// Player tool use (Phase 3): reach limit, per-action cooldown, brush radii.
static const double P_TOOL_REACH = 30.0;   // max cells from player center (place/mine further)
static const int    P_TOOL_COOLDOWN = 4;   // steps between actions while held
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
static const int INV_HOTBAR = 9;
static const int INV_GRID = 27;
static const int INV_SLOTS = INV_HOTBAR + INV_GRID; // 36
static const int INV_STACK_MAX = 999;
static const int INV_SNAP_STRIDE = 6; // material, isTool, toolClass, toolTier, count, selected
struct InvSlot {
  uint8_t material = 0;   // material id for a stack (0 when a tool or empty)
  uint8_t isTool = 0;     // 1 = a mining tool (class/tier below), not a placeable stack
  uint8_t toolClass = 0;  // ToolClass when isTool
  uint8_t toolTier = 0;   // ToolTier when isTool
  int count = 0;          // stack size (tools = 1); 0 = empty
};

// Creative brush mode (tools.inc): the searchable palette selects ANY material,
// any seed species, the eraser, or the cube; the brush routes by mode rather than a
// fixed per-material Tool enum. PAINT = powder/liquid/gas (continuous), DRAFT = a
// component material drawn with a live preview then dropped on release.
enum CreativeMode : uint8_t { CM_PAINT = 0, CM_DRAFT, CM_SEED, CM_ERASE, CM_CUBE };
// What a creative palette selection refers to (engine_set_creative_material kind).
enum CreativeKind : uint8_t { CK_MATERIAL = 0, CK_SEED, CK_ERASER, CK_CUBE };

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
  int toolCooldown = 0; // steps remaining before this player can act again
  bool mineActive = false;
  int mineLayer = 0, mineX = 0, mineY = 0;
  // Held mining tool: a destroyed cell drops its material only when this class/tier
  // satisfies the material's MAT_TOOLCLASS/MAT_TOOLTIER gate (set from the selected
  // inventory slot in inventory.inc; defaults to a bare hand).
  uint8_t heldToolClass = TC_HAND, heldToolTier = TT_HAND;
  // Survival inventory: hotbar + grid stacks, and the selected hotbar slot.
  InvSlot inv[INV_SLOTS];
  int selectedSlot = 0;
  // The stack currently "held on the cursor" (Minecraft-style pick/place/throw). 0 = empty.
  InvSlot cursor;
};
// Player snapshot layout (float32 per field) shared with JS and the net layer.
static const int PLAYER_SNAP_STRIDE = 17;

// Rigid tunables (rigid2d.js)
static const double R_GRAVITY = 0.06, R_MAX_SPEED = 3.0, R_SAFE_SUBSTEP = 0.6;
static const int    R_MAX_SUBSTEPS = 6, R_SOLVER_ITERS = 64, R_SLEEP_TICKS = 20;
static const double R_RESTITUTION = 0, R_FRICTION = 0.6, R_BAUMGARTE = 0.2, R_MAX_BIAS_VEL = 0.3, R_PEN_SLOP = 0.5;
static const double R_CONTACT_LIN_DAMP = 0.9, R_CONTACT_ANG_DAMP = 0.6, R_LIQUID_DRAG = 0.12, R_LIQUID_ANG_DRAG = 0.1;
static const double R_SLEEP_LIN = 0.007, R_SLEEP_ANG = 0.0045;
static const double R_SETTLE_LIN = R_SLEEP_LIN * 8, R_SETTLE_ANG = R_SLEEP_ANG * 8;
static const double R_WAKE_LIN2 = 0.028 * 0.028, R_WAKE_ANG2 = 0.014 * 0.014, R_REST_DEPTH = 1.0;

