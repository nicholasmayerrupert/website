#pragma once
// Shared declarations for the WASM sand engine.
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
#include <emscripten.h>
#include <emscripten/console.h>

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

// Simulation tunables.
static const int   CHUNK_SIZE = 32, CHUNK_SHIFT = 5;
// Runtime storage profiles. The browser presentation mirror never advances the
// cellular simulation, while the authority worker never creates a GL context.
// Keeping those roles explicit avoids allocating both halves of the engine in
// both WASM instances at large zoom levels. Full remains the default for tests,
// servers, and embedders that simulate and render in one Engine.
enum EngineStorageRole : uint8_t {
  ESR_FULL = 0,
  ESR_PRESENTATION = 1,
  ESR_AUTHORITY = 2,
};
static const int   MAX_WATER_FLOW = 10;
// Surface levelling stays local: look ahead only to decide whether a side leads to
// a meaningfully lower connected surface, then move one cell sideways. Two passes
// let resting water flow visibly without long-distance correction jumps.
static const int   LIQUID_SURFACE_LOOKAHEAD = 64, LIQUID_SURFACE_FLOW_PASSES = 2;
// Liquid↔liquid density-chain relocation (resolveLiquidDisplacements): multi-source
// BFS visit budget = min(gridLen, max(BASE, need * PER)). Keeps enclosed-pool
// floods from freezing a tick the way a per-cell BFS would.
static const int   LIQUID_DISP_VISIT_BASE = 4096, LIQUID_DISP_VISIT_PER = 128;
static const float STEAM_DECAY_P = 0.018f, FIRE_DECAY_P = 0.008f;
static const int   DIRTY_PAD_X = MAX_WATER_FLOW + 2, DIRTY_PAD_Y = 2;
static const int   SINK_STRIP_W = 2, INNER_STRIP_W = 1;
static const float SINK_LIQUID_P = 0.85f, SINK_SAND_P = 0.35f, INNER_LIQUID_P = 0.35f, INNER_SAND_P = 0.10f;
static const float OIL_IGNITE_P = 0.25f, PLANT_IGNITE_P = 0.25f * 0.67f, FIRE_SPREAD_P = 0.11f;
// Chance a FIRE cell ignites a flammable at the SAME (x,y) in the OTHER layer.
static const float FIRE_CROSS_P = 0.18f;
// Acid moves every tick but batches static corrosion every three ticks, reducing
// component repair work while retaining the calibrated cut rate. Body erosion
// uses the per-tick probability.
static const int ACID_REACT_INTERVAL = 3;
static const float ACID_DISSOLVE_P = 0.12f, ACID_BATCH_DISSOLVE_P = 0.75f;
static const float ACID_DECAY_P = 0.4f, LAVA_EMIT_FIRE_P = 0.001f, ICE_FREEZE_P = 0.03f;
// Corrosive contact is dangerous to every living actor. Twelve damage four
// times per second is twice the old player-only acid DPS while staying below
// direct lava immersion.
static const int ACID_CONTACT_DAMAGE = 12, ACID_CONTACT_INTERVAL = 15;
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

// Tool ids live in abi.generated.hpp (enum Tool). The engine owns all tool
// policy: brush radii, which tool paints/erases/drafts/spawns, the right-click
// eraser, draft lifecycle, seed placement, and emit throttling.

// Held movement/pan keys forwarded from the browser (createSandGame maps the
// physical keys onto these). The engine owns camera and input policy:
// free-camera panning, the player input bitmask, and the pointer->aim mapping.
enum InputKey : int { IK_LEFT = 0, IK_RIGHT, IK_UP, IK_DOWN, IK_SPACE, IK_SHIFT, IK_SHIELD };
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

// ---- Seeded terrain noise ----
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
// Keep the octave loops shared instead of cloning them into each terrain query.
static __attribute__((noinline)) double wfbm2(uint32_t seed, double x, double y, int octaves, double gain) {
  double amp = 1, freq = 1, sum = 0, norm = 0;
  for (int o = 0; o < octaves; o++) { double n = valueNoise2D(seed + (uint32_t)o * 1013u, x * freq, y * freq); sum += n * amp; norm += amp; amp *= gain; freq *= 2; }
  return norm > 0 ? sum / norm : 0;
}
static __attribute__((noinline)) double wridged2(uint32_t seed, double x, double y, int octaves, double gain) {
  double amp = 1, freq = 1, sum = 0, norm = 0;
  for (int o = 0; o < octaves; o++) { double n = valueNoise2D(seed + (uint32_t)o * 1013u, x * freq, y * freq); double r = 1 - std::fabs(n * 2 - 1); sum += r * r * amp; norm += amp; amp *= gain; freq *= 2; }
  return norm > 0 ? sum / norm : 0;
}

// Flora species — drives growth rules + which wood/leaf material a tree is made of.
// Keep the seven palette ids stable. PT_STANDARD is the plain SEED material's
// original growth path; it lives outside that 0..6 palette range so Oak can have
// a distinct silhouette without renumbering saved/networked species.
enum PlantType : uint8_t { PT_OAK = 0, PT_PINE, PT_WILLOW, PT_CACTUS, PT_MUSHROOM, PT_BUSH, PT_VINE, PT_STANDARD };

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
  // Set when this component was stamped from a sleeping rigid body. It
  // distinguishes a stable bake from a naturally unsupported component.
  bool settledBody = false;
  // The sleeping body baked while loose material, rather than rigid terrain,
  // supplied its underside support. Complete loss of that footprint restores
  // the body solver even when no rigid component was directly cut.
  bool settledLooseSupport = false;
  // A topology-changing erase marks the affected support closure for rigid-body
  // conversion if grounding shows that it lost its last static support.
  bool detachedByBreak = false;
  // Last committed vertical component move. A prior buoyant rise supplies
  // surface hysteresis while liquid still supports the underside.
  int8_t buoyancyDirection = 0;
  // Only SEEDED plants actively grow. Worldgen-stamped trees (and restored/streamed
  // comps) are inert scenery (growing=false) so they never self-activate the sim.
  // Cleared once a growing plant reaches its species' size cap.
  bool growing = false;
  // Procedural growth can add non-adjacent cells to one logical plant. Such a
  // component uses cell connectivity for support instead of the component graph.
  bool requiresCellGrounding = false;
  std::vector<int> woodCells, seedWoodCells;
};

// Free rigid body with a continuous pose over a cell occupancy mask.
struct Body {
  int id = 0;
  std::vector<uint8_t> occ; int w = 0, h = 0;
  // Empty means every occupied cell uses `material`. Detached terrain keeps an
  // occ-sized material map so stone, ore, timber, and foliage remain one rigid
  // shape without losing their individual cell identities.
  std::vector<uint8_t> cellMaterials;
  // A blast-detached foreground/background pair shares one physical occupancy
  // and pose. Each body stores only its own layer's materials in cellMaterials;
  // this inverse map supplies the peer layer for combined mass/collision.
  std::vector<uint8_t> jointPeerMaterials;
  Body* jointPeer = nullptr;
  // 0 = ordinary body, 1 = simulated foreground leader, 2 = kinematic
  // background follower. Bodies become joint only when one structural
  // detachment event creates both halves.
  uint8_t jointRole = 0;
  double offsetX = 0, offsetY = 0;
  double px = 0, py = 0, angle = 0;
  double vx = 0, vy = 0, omega = 0;
  uint8_t material = RIGID; double density = 1;
  bool awake = true; int stillTicks = 0;
  bool blastDebris = false; // tiny explosion rubble; non-structural until stable enough to bake
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
struct Contact {
  Body* a; Body* b;
  double rax, ray, rbx, rby, nx, ny, depth;
  // Separating speed captured from the contact's initial impact. Keeping this
  // target fixed lets sequential impulses preserve a small rebound instead of
  // damping it back to zero over later solver iterations.
  double impactSpeed, targetVn;
  double accJn, accJt, accBias;
};

// ---- Dropped items + cosmetic particles (items.inc) ----
// A lightweight NON-GRID entity. IT_ITEM = a dropped material the player can pick
// up; IT_PARTICLE = a short-lived fleck of mining debris (no pickup). Items fall
// under gravity (slower in liquid), rest on the SURFACE of solids (never buried —
// they rise out if covered), and MAGNET toward a nearby player. Compatible
// material drops coagulate when spawned close together; the remaining actors
// pass through each other. Pose is buffer-local cell coords like Player/Body, so a
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
static const double IT_COAGULATE_R = 4.0;    // nearby identical material drops share one stack actor
static const int    IT_PARTICLE_LIFE = 24;   // default mining-debris lifetime (steps)
static const int    IT_MAX_ITEMS = 1024;     // hard cap; oldest particle (then item) evicted
// Item snapshot layout: IS_* offsets / IS_STRIDE in abi.generated.hpp.
struct Item {
  int id = 0;
  uint8_t kind = IT_ITEM;
  uint8_t itemKind = IK_MATERIAL;
  uint8_t material = 0;
  uint8_t isTool = 0, toolClass = 0, toolTier = 0;
  int count = 1;           // stack carried by this dropped item (merged at pickup)
  uint8_t plantType = PT_OAK; // species carried by SEED items
  double px = 0, py = 0;   // buffer-local cell coords (a point), +y down
  double vx = 0, vy = 0;   // cells per step
  int life = 0;            // PARTICLE: steps remaining
  int pickupDelay = 0;     // ITEM: steps before it can be vacuumed (and homed)
};

// Projectiles are lightweight actor-clock entities. Fast rounds use swept
// collision rather than the globally speed-clamped rigid-body solver; dynamite
// keeps its replicated fuse/pose here so presentation mirrors can animate it.
static const int PROJECTILE_MAX = 256, ARROW_LIFE = 180, BOW_CHARGE_MAX = 48;
// The starter gun fires once every 22 actor ticks (~2.7 rounds/second at 60 Hz).
// This halves its former fire rate while keeping held automatic fire.
static const int BLAST_ROUND_LIFE = 90, BLAST_GUN_COOLDOWN = 22;
static const int DYNAMITE_FUSE_TICKS = 105;
static const int DYNAMITE_SATCHEL_COOLDOWN = 45;
static const int BORE_CANNON_CHARGE_TICKS = 60, BORE_CANNON_COOLDOWN = 150;
static const int BLAST_ROUND_RADIUS = 10;
static constexpr double BLAST_ROUND_POWER = 13.0;
static const double ARROW_GRAVITY = 0.04, PROJECTILE_SWEEP_STEP = 0.25;
static const double BLAST_ROUND_SPEED = 11.5;
static const double DYNAMITE_GRAVITY = 0.075, DYNAMITE_MAX_FALL = 2.8;
static const double DYNAMITE_BOUNCE = 0.58, DYNAMITE_FRICTION = 0.52;
struct Projectile {
  int id = 0, owner = 0, life = ARROW_LIFE;
  double px = 0, py = 0, vx = 0, vy = 0, charge = 0;
  uint8_t kind = PK_ARROW;
  int fuse = 0;
  double rotation = 0;
};

// Player state and deterministic platformer physics.
// Input is a normalized bitmask (enum PlayerInput in abi.generated.hpp)
// supplied by JS/network each step. Physics is fully deterministic (no RNG)
// and runs at a fixed timestep so a fixed input stream replays identically.
// Player physics tunables (cells; velocities in cells per fixed step).
static const int    PLAYER_W = 4, PLAYER_H = 8;
// Soft gravity and capped acceleration keep movement readable at sand-cell scale.
static const double P_GRAVITY = 0.078125, P_MAX_FALL = 6.0;
static const double P_MOVE_ACCEL = 0.35, P_MAX_RUN = 0.875, P_RUN_MULT = 1.7;
static const double P_GROUND_FRICTION = 0.55, P_AIR_FRICTION = 0.92, P_JUMP_VEL = 2.035;
static const double P_AIM_FACING_DEADZONE = 0.2; // retain side while aiming almost exactly vertical
static const double P_MOVE_SUBSTEP = 0.25; // sub-cell stepping prevents tunneling
static const double P_STEP_UP = 2.0;       // auto-climb height for low (1-2px) ledges
static const int    P_BURY_JUMP_MAX = 4;   // max embed depth (px) a player can still jump out of (else must dig)
// Rechargeable personal jetpack. Fuel is normalized [0,1] so the ABI/HUD can
// expose it without duplicating a capacity constant. A full tank provides two
// seconds of thrust and takes three seconds of non-thrusting time to refill.
static const double P_JETPACK_THRUST = 0.16, P_JETPACK_MAX_RISE = 1.65;
static const double P_JETPACK_BURN = 1.0 / 120.0, P_JETPACK_RECHARGE = 1.0 / 180.0;
// A held ward covers the 120-degree sector centered on the cursor aim. Combat
// damage entering that sector drains ward health before player health; the ward
// begins its quick recharge one second after its most recent absorbed hit.
static const int    P_SHIELD_MAX_HEALTH = 200;
static const int    P_SHIELD_RECHARGE_DELAY = 60, P_SHIELD_RECHARGE_PER_TICK = 2;
static constexpr double P_SHIELD_HALF_ARC_COS = 0.5; // cos(60 degrees)
// Safe-spawn search stays local to the original surface neighborhood. If a
// player destroyed every candidate, respawn builds a tiny component-aware pad.
static const int    P_SPAWN_SEARCH_X = 64, P_SPAWN_SEARCH_Y = 64, P_SPAWN_HAZARD_MARGIN = 2;
// Player tool reach and action cadence.
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
// Captured weapons carry their remaining ammunition in InvSlot::count. The
// starter blast gun is deliberately absent: its singleton count is ownership,
// not ammunition, and it remains unlimited.
static const int DYNAMITE_SATCHEL_PICKUP_AMMO = 10;
static const int BORE_CANNON_PICKUP_AMMO = 15;
static const int ACID_MORTAR_PICKUP_AMMO = 20;
static const int CLUSTER_LAUNCHER_PICKUP_AMMO = 15;
static const int MINIGUN_PICKUP_AMMO = 250;
static const int INV_WEAPON_AMMO_MAX = 999999;
static inline bool isFiniteAmmoWeapon(uint8_t itemKind) {
  return itemKind == IK_DYNAMITE_SATCHEL || itemKind == IK_BORE_CANNON ||
         itemKind == IK_ACID_MORTAR || itemKind == IK_CLUSTER_LAUNCHER ||
         itemKind == IK_MINIGUN;
}
static inline int weaponPickupAmmo(uint8_t itemKind) {
  if (itemKind == IK_DYNAMITE_SATCHEL) return DYNAMITE_SATCHEL_PICKUP_AMMO;
  if (itemKind == IK_BORE_CANNON) return BORE_CANNON_PICKUP_AMMO;
  if (itemKind == IK_ACID_MORTAR) return ACID_MORTAR_PICKUP_AMMO;
  if (itemKind == IK_CLUSTER_LAUNCHER) return CLUSTER_LAUNCHER_PICKUP_AMMO;
  if (itemKind == IK_MINIGUN) return MINIGUN_PICKUP_AMMO;
  return 0;
}
static inline int inventoryStackLimit(uint8_t itemKind) {
  if (isFiniteAmmoWeapon(itemKind)) return INV_WEAPON_AMMO_MAX;
  if (itemKind == IK_MATERIAL || itemKind == IK_ARROW) return INV_STACK_MAX;
  return 1;
}
static inline bool inventoryStackCanSplit(uint8_t itemKind) {
  return itemKind == IK_MATERIAL || itemKind == IK_ARROW;
}
// Inventory snapshot layout: IVS_* offsets / IVS_STRIDE in abi.generated.hpp.
struct InvSlot {
  uint8_t itemKind = IK_MATERIAL;
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
static const int SURVIVAL_FOOTPRINT_MAX_SIZE = 10;
static const int SURVIVAL_FOOTPRINT_DEFAULT_ID = 9;  // 10x10 in the square preset list
static const uint32_t SURVIVAL_MINING_SPEED_MULTIPLIER = 8;
// The starter TC_DIG tool is the fast universal survival tool. Keep this separate
// from the shared survival multiplier so hands and classed tools retain their
// existing material/tier timing.
static const uint32_t SURVIVAL_DIG_TOOL_SPEED_MULTIPLIER = 13;

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
// Sprite: 8x12 authored pixels at 3/4 of a world cell each. The denser grid keeps
// the same six-cell silhouette as the old 6x10 art while giving the face, jacket,
// belt, and gait enough resolution to read. Arms are articulated by the presenter
// so hands can follow locomotion and exact weapon grip anchors independently.
static const int SPR_W = 8, SPR_H = 12;
static constexpr double SPR_PIXEL_SCALE = 0.75;
static const float SPR_PAL[10][4] = {
  {0, 0, 0, 0},                                       // 0 transparent
  {20 / 255.f, 18 / 255.f, 26 / 255.f, 1},            // 1 outline
  {236 / 255.f, 184 / 255.f, 142 / 255.f, 1},         // 2 skin
  {184 / 255.f, 118 / 255.f, 88 / 255.f, 1},          // 3 skin-shadow
  {92 / 255.f, 58 / 255.f, 45 / 255.f, 1},            // 4 hair
  {48 / 255.f, 108 / 255.f, 170 / 255.f, 1},          // 5 jacket
  {45 / 255.f, 48 / 255.f, 72 / 255.f, 1},            // 6 trousers
  {30 / 255.f, 29 / 255.f, 38 / 255.f, 1},            // 7 boots / gloves
  {236 / 255.f, 111 / 255.f, 36 / 255.f, 1},          // 8 safety-orange trim
  {102 / 255.f, 222 / 255.f, 230 / 255.f, 1},         // 9 visor
};
// [state][frame][row] of 8-char digit rows (palette indices), facing RIGHT
// (mirror for left). Unused frame slots repeat frame 0 and are never indexed.
static const char* const SPR_GRID[AS_COUNT][4][SPR_H] = {
  { // AS_IDLE
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00166100","01707100","01707100"},
    {"00111100","01444810","14222910","13322100","00128810","01555510",
     "01555510","01586510","00166100","00166100","01707100","01707100"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00166100","01707100","01707100"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00166100","01707100","01707100"},
  },
  { // AS_WALK
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00601600","00700170","07000007"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00166100","00177100","00177100"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00601600","07100700","70000070"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00166100","01701700","07007000"},
  },
  { // AS_RUN
    {"00011110","00144481","01422291","01332210","00012810","00155551",
     "01555510","01586510","00166000","00600160","00700017","07000000"},
    {"00011110","00144481","01422291","01332210","00012810","00155551",
     "01555510","01586510","00166100","00066100","00017700","00700070"},
    {"00011110","00144481","01422291","01332210","00012810","00155551",
     "01555510","01586510","00166100","01600060","17000700","00000070"},
    {"00011110","00144481","01422291","01332210","00012810","00155551",
     "01555510","01586510","00166000","00166100","01700700","07000000"},
  },
  { // AS_RISE
    {"00111100","01444810","14222910","13322100","00128810","01555510",
     "01555510","01586510","00166100","00600600","00700700","00000000"},
    {"00111100","01444810","14222910","13322100","00128810","01555510",
     "01555510","01586510","00166100","00066000","00700700","00000000"},
    {"00111100","01444810","14222910","13322100","00128810","01555510",
     "01555510","01586510","00166100","00600600","00700700","00000000"},
    {"00111100","01444810","14222910","13322100","00128810","01555510",
     "01555510","01586510","00166100","00600600","00700700","00000000"},
  },
  { // AS_FALL
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00600600","07007000","70000070"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","06000060","70000007","00000000"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00600600","07007000","70000070"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00600600","07007000","70000070"},
  },
  { // AS_WADE
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00601600","00000000","00000000"},
    {"00111100","01444810","14222910","13322100","00128810","01555510",
     "01555510","01586510","00166100","00166100","00000000","00000000"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00601600","00000000","00000000"},
    {"00111100","01444810","14222910","13322100","00128100","01555510",
     "01555510","01586510","00166100","00601600","00000000","00000000"},
  },
  { // AS_SWIM
    {"00000000","00000000","00011110","01444810","14222910","13322100",
     "00128810","01555551","01555610","00666600","00700700","00000000"},
    {"00000000","00000000","00011110","01444810","14222910","13322100",
     "00128810","01555551","01555610","06660060","07000007","00000000"},
    {"00000000","00000000","00011110","01444810","14222910","13322100",
     "00128810","01555551","01555610","00666600","00070070","00000000"},
    {"00000000","00000000","00011110","01444810","14222910","13322100",
     "00128810","01555551","01555610","06660060","70000070","00000000"},
  },
};

struct Player {
  int id = 0;
  bool active = true, alive = true;
  double px = 0, py = 0;   // AABB top-left, cell coords (world-local to the buffer)
  // Immutable first-spawn anchor in absolute world cells. Unlike px/py it is
  // deliberately not translated when the streamed window moves or resizes.
  double spawnWorldX = 0, spawnWorldY = 0;
  bool respawnPending = false;
  double vx = 0, vy = 0;   // cells per step (+y is down, matching the grid)
  int w = PLAYER_W, h = PLAYER_H;
  int facing = 1;          // +1 right, -1 left
  bool grounded = false;
  int selectedTool = T_ERASER;
  double aimX = 0, aimY = 0; // cell coords of the aim/cursor
  int input = 0;
  double inputX = 0, inputY = 0; // normalized analog move; ignored when analogInput is false
  bool analogInput = false;
  int prevInput = 0;       // last step's input bits (for single-shot edge detection)
  bool jumpReady = false;  // armed (grounded + jump released); persists so a press isn't lost to a 1-frame grounded flicker
  uint32_t inputSeq = 0;   // last applied input sequence (multiplayer)
  int health = 100;
  int hurtCooldown = 0; // contact-damage immunity; also protects a fresh respawn
  int lastDamageTick = -1000000;
  int shieldHealth = P_SHIELD_MAX_HEALTH;
  int shieldHurtCooldown = 0;
  int lastShieldDamageTick = -1000000;
  bool shieldActive = false;
  int deathTicks = 0;
  int buriedTicks = 0;
  int bowChargeTicks = 0;
  double jetpackFuel = 1.0; // normalized [0,1]
  bool jetpackActive = false;
  double landingImpact = 0;
  int toolCooldown = 0; // steps remaining before this player can act again
  // When an automatic weapon spends its final round while PRIMARY stays held,
  // suppress the now-empty slot's bare-hand mining until PRIMARY is released.
  bool emptyWeaponTriggerLatch = false;
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

// Rigid-body tunables.
static const double R_GRAVITY = 0.06, R_MAX_SPEED = 3.0, R_SAFE_SUBSTEP = 0.5;
static const int    R_MAX_SUBSTEPS = 10, R_SOLVER_ITERS = 64, R_SLEEP_TICKS = 20;
static const int    R_BLAST_DEBRIS_SOLVER_ITERS = 16;
// Swept body collision: surfaces touch within R_CONTACT_SKIN cells (resting
// stability + earlier contact), and a sample's per-substep relative path is
// marched in steps no larger than R_SWEEP_STEP cells looking for first impact.
static const double R_CONTACT_SKIN = 0.1, R_SWEEP_STEP = 0.4;
static const double R_TERRAIN_RESTITUTION = 0.1, R_BODY_RESTITUTION = 0.18, R_BOUNCE_MIN_SPEED = 0.35;
static const double R_FRICTION = 0.6, R_BAUMGARTE = 0.2, R_MAX_BIAS_VEL = 0.3, R_PEN_SLOP = 0.5;
static const double R_CONTACT_LIN_DAMP = 0.9, R_CONTACT_ANG_DAMP = 0.6, R_LIQUID_DRAG = 0.12, R_LIQUID_ANG_DRAG = 0.1;
static const double R_SLEEP_LIN = 0.007, R_SLEEP_ANG = 0.0045;
static const double R_SETTLE_LIN = R_SLEEP_LIN * 8, R_SETTLE_ANG = R_SLEEP_ANG * 8;
static const double R_BUOY_REST_BAND = 0.08, R_BUOY_REST_DAMP = 0.45, R_BUOY_ZERO_VY = 0.02;
static const double R_GRANULAR_BEARING_DEPTH = 7.0;
static const double R_WAKE_LIN2 = 0.028 * 0.028, R_WAKE_ANG2 = 0.014 * 0.014, R_REST_DEPTH = 1.0;

// Composed subsystem declarations.
#include "camera.hpp"
#include "netsync.hpp"
#include "layer.hpp"
#include "terrain.hpp"
#include "renderer.hpp"
#include "creatures.hpp"
#include "glpresenter.hpp"
#include "items.hpp"
#include "inventory.hpp"
#include "crafting.hpp"
#include "projectiles.hpp"
#include "player.hpp"
#include "tools.hpp"
#include "reactions.hpp"
#include "explosives.hpp"
#include "growth.hpp"
#include "components.hpp"
#include "rigid.hpp"
#include "audio.hpp"
