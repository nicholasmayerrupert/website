#pragma once
// Immutable semantic world records. Plans are pure functions of the world seed,
// planet, worldgen version, and absolute coordinates, so they survive streaming
// without growing the changed-cell store.

struct Engine;
class WorldContextSystem;

struct WorldContext {
  int surfaceBiome = BIOME_PLAINS;
  int caveBiome = CAVE_DEFAULT;
  int surfaceY = 0;
  int depth = 0;
  uint32_t tags = 0;
  WorldFeatureKind featureKind = WF_NONE;
  WorldSiteRole siteRole = WSR_NONE;
  uint32_t featureId = 0;
  uint32_t parentFeatureId = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
};

struct WorldBounds {
  int left = 0, top = 0, right = 0, bottom = 0;

  constexpr bool contains(int x, int y) const {
    return x >= left && x <= right && y >= top && y <= bottom;
  }
  constexpr bool overlaps(const WorldBounds& other) const {
    return left <= other.right && right >= other.left
        && top <= other.bottom && bottom >= other.top;
  }
};

enum GeneratedFeatureFamily : uint8_t {
#define SAND_GENERATED_FEATURE(ID, ...) GFF_##ID,
#include "worldgen_features.def"
#undef SAND_GENERATED_FEATURE
  GFF_COUNT,
};

enum GeneratedFeatureStage : uint8_t {
  GFS_SURFACE_CONSTRUCTED,
  GFS_DEEP_CONSTRUCTED,
  GFS_OFFWORLD_FORMATION,
  GFS_OFFWORLD_CONSTRUCTED,
  GFS_COUNT,
};

enum GeneratedFeatureLayerMask : uint8_t {
  GFL_FOREGROUND = 1u << 0,
  GFL_BACKGROUND = 1u << 1,
  GFL_BOTH = GFL_FOREGROUND | GFL_BACKGROUND,
};

// How a feature cell composes with output from earlier generation stages.
// EMPTY is a real replacement value, so GFSP_REPLACE also expresses carving.
enum GeneratedFeatureStampPolicy : uint8_t {
  GFSP_REPLACE,
  GFSP_IF_EMPTY,
};

struct GeneratedFeatureMatch {
  bool found = false;
  GeneratedFeatureFamily family = GFF_COUNT;
  int priority = INT_MIN;
  int specificity = INT_MIN;
  WorldFeatureKind kind = WF_NONE;
  WorldSiteRole role = WSR_NONE;
  uint32_t tags = 0, id = 0, parentId = 0;
  WorldBounds bounds;
};

struct GeneratedFeatureDef;
using GeneratedFeatureQuery = bool (WorldContextSystem::*)(
  const GeneratedFeatureDef&, int, int, GeneratedFeatureMatch&) const;
using GeneratedFeatureOverlapQuery = bool (WorldContextSystem::*)(
  const GeneratedFeatureDef&, const WorldBounds&) const;
using GeneratedFeatureStamp = void (*)(
  Engine&, const GeneratedFeatureDef&, int, int, int, int);

#define SAND_GENERATED_FEATURE(                                        \
    ID, NAME, KIND, ROLE, TAGS, PROFILES, LATTICE_W, LATTICE_H,       \
    REACH_X, REACH_Y, PRIORITY, STAGE, LAYERS, POLICY, EXCLUDES,      \
    QUERY, OVERLAPS, STAMP)                                            \
  void STAMP(Engine&, const GeneratedFeatureDef&, int, int, int, int);
#include "worldgen_features.def"
#undef SAND_GENERATED_FEATURE

struct GeneratedFeatureDef {
  GeneratedFeatureFamily family;
  const char* name;
  WorldFeatureKind kind;
  WorldSiteRole role;
  uint32_t tags;
  uint32_t generationProfileMask;
  int latticeWidth;
  int latticeHeight;
  int overscanX;
  int overscanY;
  int priority;
  GeneratedFeatureStage stage;
  uint8_t layerMask;
  GeneratedFeatureStampPolicy stampPolicy;
  uint32_t excludesMask;
  GeneratedFeatureQuery query;
  GeneratedFeatureOverlapQuery overlaps;
  GeneratedFeatureStamp stamp;
};

static_assert(PLANET_GENERATION_PROFILE_COUNT > 0
              && PLANET_GENERATION_PROFILE_COUNT <= 32,
              "Generation profile masks require between one and 32 profiles");
inline constexpr uint32_t GENERATION_PROFILE_ALL_MASK =
  UINT32_MAX >> (32 - PLANET_GENERATION_PROFILE_COUNT);

inline constexpr int OCEAN_FLORA_MAX_SWAY = 1;
inline constexpr int OCEAN_FLORA_REACH_X = 5;
inline constexpr int OCEAN_FLORA_REACH_Y = 18;
inline constexpr int CAVE_DRESSING_LATTICE = 11;
inline constexpr int CAVE_DRESSING_MAX_ACID_RADIUS = 35;
inline constexpr int CAVE_DRESSING_ACID_BANK = 4;
inline constexpr int CAVE_DRESSING_MAX_FLOOR_SEARCH = 12;
inline constexpr int CAVE_DRESSING_MAX_ACID_DEPTH = 20;
inline constexpr int CAVE_DRESSING_REACH_X = 40;
inline constexpr int CAVE_DRESSING_REACH_Y = 40;
inline constexpr int DEEP_DRESSING_BANK = 3;
inline constexpr int DEEP_DRESSING_REACH_X =
  TerrainGen::DEEP_CAVERN_MAX_RADIUS_X + DEEP_DRESSING_BANK + 2;
inline constexpr int DEEP_DRESSING_REACH_Y = 82;
static_assert(OCEAN_FLORA_REACH_X >= OCEAN_FLORA_MAX_SWAY
              && CAVE_DRESSING_REACH_X >=
                   CAVE_DRESSING_MAX_ACID_RADIUS + CAVE_DRESSING_ACID_BANK
              && CAVE_DRESSING_REACH_Y >=
                   CAVE_DRESSING_MAX_FLOOR_SEARCH
                   + CAVE_DRESSING_MAX_ACID_DEPTH
              && DEEP_DRESSING_REACH_X >=
                   TerrainGen::DEEP_CAVERN_MAX_RADIUS_X
                   + DEEP_DRESSING_BANK,
              "Generation-stage reaches must contain their widest templates");

enum WorldGenerationStage : uint8_t {
#define SAND_WORLDGEN_STAGE(symbol, id, ...) WGS_##symbol = id,
#include "worldgen_stages.def"
#undef SAND_WORLDGEN_STAGE
  WGS_COUNT =
#define SAND_WORLDGEN_STAGE(...) + 1
    0
#include "worldgen_stages.def"
#undef SAND_WORLDGEN_STAGE
};

struct WorldGenerationStageDef;
using WorldGenerationStageRun = void (*)(
  Engine&, const WorldGenerationStageDef&, int, int, int, int);

#define SAND_WORLDGEN_STAGE(symbol, id, name, profiles, featureStage, reachX, reachY, callback) \
  void callback(Engine&, const WorldGenerationStageDef&, int, int, int, int);
#include "worldgen_stages.def"
#undef SAND_WORLDGEN_STAGE

struct WorldGenerationStageDef {
  WorldGenerationStage id;
  const char* name;
  uint32_t generationProfileMask;
  GeneratedFeatureStage featureStage;
  int overscanX, overscanY;
  WorldGenerationStageRun run;
};

struct VillagePlan {
  int latticeX = 0;
  int center = 0;
  int buildingCount = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
  uint32_t id = 0;
};

struct VillageBuildingPlan {
  int ordinal = 0;
  int center = 0;
  int left = 0, wallTop = 0, floorY = 0;
  int width = 0, height = 0, roofHeight = 0;
  bool hall = false;
  int biome = BIOME_PLAINS;
  WorldSiteRole role = WSR_NONE;
  uint32_t id = 0, parentId = 0;
};

struct MineLevelPlan {
  int floor = 0, ceiling = 0;
  int left = 0, right = 0;
  int stationLeft = 0, stationRight = 0;
  int roomLeft = 0, roomTop = 0, roomRight = 0, roomBottom = 0;
};

struct MinePlan {
  static constexpr int MAX_LEVELS = 4;
  int latticeX = 0;
  int center = 0, width = 0, levels = 0, firstFloor = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
  int headhouseLeft = 0, headhouseTop = 0;
  int headhouseRight = 0, headhouseFloor = 0;
  int shaftLeft = 0, shaftRight = 0, shaftHalf = 0;
  int shaftTop = 0, shaftBottom = 0;
  int connectorTop = 0, connectorBottom = 0;
  std::array<MineLevelPlan, MAX_LEVELS> level{};
  uint32_t id = 0;
};

enum OffworldFacilityKind : uint8_t {
#define WORLDGEN_FACILITY_ARCHETYPE(symbol, id, ...) OFK_##symbol = id,
#define WORLDGEN_RUIN_ARCHETYPE(...)
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
  OFK_COUNT =
#define WORLDGEN_FACILITY_ARCHETYPE(...) + 1
#define WORLDGEN_RUIN_ARCHETYPE(...)
    0
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
};

struct OffworldFacilityArchetypeDef {
  OffworldFacilityKind kind;
  const char* name;
  uint32_t generationProfileMask;
  int selectionOrdinal;
  int halfWidth;
  int undergroundDepth;
  int aboveDeckReach;
};

inline constexpr std::array<OffworldFacilityArchetypeDef, OFK_COUNT>
OFFWORLD_FACILITY_ARCHETYPES = {{
#define WORLDGEN_FACILITY_ARCHETYPE(symbol, id, name, mask, ordinal, width, depth, above, stamp) \
  {OFK_##symbol, name, mask, ordinal, width, depth, above},
#define WORLDGEN_RUIN_ARCHETYPE(...)
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
}};

inline constexpr int OFFWORLD_FACILITY_DECK_SPACING = 34;
inline constexpr int OFFWORLD_FACILITY_FIRST_ROOM_OFFSET = 4;
inline constexpr int OFFWORLD_FACILITY_BOTTOM_ROOM_CLEARANCE = 5;
inline constexpr int OFFWORLD_FACILITY_SIDE_INSET = 9;
inline constexpr int OFFWORLD_FACILITY_BELOW_DECK_OVERSCAN_MARGIN = 12;

template <size_t N>
constexpr bool validOffworldFacilityArchetypes(
    const std::array<OffworldFacilityArchetypeDef, N>& archetypes) {
  if (N != OFK_COUNT) return false;
  for (size_t i = 0; i < N; i++) {
    const OffworldFacilityArchetypeDef& archetype = archetypes[i];
    if ((size_t)archetype.kind != i
        || !archetype.name || archetype.name[0] == '\0'
        || archetype.generationProfileMask == 0
        || (archetype.generationProfileMask
            & ~GENERATION_PROFILE_ALL_MASK) != 0
        || archetype.selectionOrdinal < 0
        || archetype.halfWidth <= OFFWORLD_FACILITY_SIDE_INSET
        || archetype.undergroundDepth <= OFFWORLD_FACILITY_DECK_SPACING
        || archetype.aboveDeckReach <= 0)
      return false;
    for (size_t j = 0; j < i; j++)
      if ((archetype.generationProfileMask
           & archetypes[j].generationProfileMask) != 0
          && archetype.selectionOrdinal == archetypes[j].selectionOrdinal)
        return false;
  }
  return true;
}
static_assert(validOffworldFacilityArchetypes(
                OFFWORLD_FACILITY_ARCHETYPES),
              "Facility archetypes must be dense, reachable, and dimension-safe");

constexpr bool offworldFacilityInvalidFixturesAreRejected() {
  auto fixture = OFFWORLD_FACILITY_ARCHETYPES;
  fixture[0].generationProfileMask = 0;
  if (validOffworldFacilityArchetypes(fixture)) return false;
  fixture = OFFWORLD_FACILITY_ARCHETYPES;
  fixture[0].generationProfileMask = UINT32_MAX;
  if (validOffworldFacilityArchetypes(fixture)) return false;
  fixture = OFFWORLD_FACILITY_ARCHETYPES;
  fixture[0].halfWidth = OFFWORLD_FACILITY_SIDE_INSET;
  if (validOffworldFacilityArchetypes(fixture)) return false;
  fixture = OFFWORLD_FACILITY_ARCHETYPES;
  fixture[0].undergroundDepth = OFFWORLD_FACILITY_DECK_SPACING;
  if (validOffworldFacilityArchetypes(fixture)) return false;
  fixture = OFFWORLD_FACILITY_ARCHETYPES;
  fixture[0].aboveDeckReach = 0;
  if (validOffworldFacilityArchetypes(fixture)) return false;
  fixture = OFFWORLD_FACILITY_ARCHETYPES;
  fixture[1].generationProfileMask = fixture[0].generationProfileMask;
  fixture[1].selectionOrdinal = fixture[0].selectionOrdinal;
  return !validOffworldFacilityArchetypes(fixture);
}
static_assert(offworldFacilityInvalidFixturesAreRejected(),
              "Invalid facility archetypes must fail validation");
constexpr uint32_t offworldFacilityGenerationProfileMask() {
  uint32_t mask = 0;
  for (const OffworldFacilityArchetypeDef& archetype
       : OFFWORLD_FACILITY_ARCHETYPES)
    mask |= archetype.generationProfileMask;
  return mask;
}
inline constexpr uint32_t OFFWORLD_FACILITY_GENERATION_PROFILE_MASK =
  offworldFacilityGenerationProfileMask();

constexpr int offworldFacilityRoomDeckCountForDepth(int depth) {
  int count = 0;
  for (int floor = OFFWORLD_FACILITY_FIRST_ROOM_OFFSET;
       floor < depth - OFFWORLD_FACILITY_BOTTOM_ROOM_CLEARANCE;
       floor += OFFWORLD_FACILITY_DECK_SPACING)
    count++;
  return count;
}

constexpr int offworldFacilityDividerCountForDepth(int depth) {
  int count = 0;
  for (int floor = OFFWORLD_FACILITY_DECK_SPACING;
       floor < depth; floor += OFFWORLD_FACILITY_DECK_SPACING)
    count++;
  return count;
}

template <size_t N>
constexpr int offworldFacilityMaxRoomDeckCount(
    const std::array<OffworldFacilityArchetypeDef, N>& archetypes) {
  int capacity = 0;
  for (const OffworldFacilityArchetypeDef& archetype : archetypes) {
    int count = offworldFacilityRoomDeckCountForDepth(
      archetype.undergroundDepth);
    if (count > capacity) capacity = count;
  }
  return capacity;
}

template <size_t N>
constexpr int offworldFacilityMaxDividerCount(
    const std::array<OffworldFacilityArchetypeDef, N>& archetypes) {
  int capacity = 0;
  for (const OffworldFacilityArchetypeDef& archetype : archetypes) {
    int count = offworldFacilityDividerCountForDepth(
      archetype.undergroundDepth);
    if (count > capacity) capacity = count;
  }
  return capacity;
}

constexpr bool offworldFacilityPlanCountsFit(
    int depth, int roomDeckCapacity, int dividerCapacity) {
  return depth > OFFWORLD_FACILITY_BOTTOM_ROOM_CLEARANCE
      && offworldFacilityRoomDeckCountForDepth(depth) <= roomDeckCapacity
      && offworldFacilityDividerCountForDepth(depth) <= dividerCapacity;
}

inline constexpr int OFFWORLD_FACILITY_ROOM_DECK_CAPACITY =
  offworldFacilityMaxRoomDeckCount(OFFWORLD_FACILITY_ARCHETYPES);
inline constexpr int OFFWORLD_FACILITY_DIVIDER_CAPACITY =
  offworldFacilityMaxDividerCount(OFFWORLD_FACILITY_ARCHETYPES);

struct OffworldFacilityPlan {
  static constexpr int MAX_ROOM_DECKS =
    OFFWORLD_FACILITY_ROOM_DECK_CAPACITY;
  static constexpr int MAX_DIVIDERS =
    OFFWORLD_FACILITY_DIVIDER_CAPACITY;
  int latticeX = 0;
  int center = 0;
  OffworldFacilityKind kind = OFK_MOON_OBSERVATORY;
  int left = 0, top = 0, right = 0, bottom = 0;
  int deckY = 0, facilityLeft = 0, facilityRight = 0;
  int facilityTop = 0, facilityBottom = 0;
  int roomDeckCount = 0, dividerCount = 0;
  std::array<int, MAX_ROOM_DECKS> roomDeckFloor{};
  std::array<int, MAX_DIVIDERS> dividerFloor{};
  uint32_t id = 0;
};

constexpr bool offworldFacilityPlanCapacitiesAreComplete() {
  for (const OffworldFacilityArchetypeDef& archetype
       : OFFWORLD_FACILITY_ARCHETYPES)
    if (!offworldFacilityPlanCountsFit(
          archetype.undergroundDepth,
          OffworldFacilityPlan::MAX_ROOM_DECKS,
          OffworldFacilityPlan::MAX_DIVIDERS))
      return false;
  return true;
}
static_assert(offworldFacilityPlanCapacitiesAreComplete(),
              "Facility plan buffers must contain every registered layout");

constexpr bool offworldFacilityCapacityFixturesAreValid() {
  constexpr int boundaryDepth = 146;
  constexpr int roomDecks =
    offworldFacilityRoomDeckCountForDepth(boundaryDepth);
  constexpr int dividers =
    offworldFacilityDividerCountForDepth(boundaryDepth);
  return roomDecks == 5 && dividers == 4
      && offworldFacilityPlanCountsFit(
        boundaryDepth, roomDecks, dividers)
      && !offworldFacilityPlanCountsFit(
        boundaryDepth, roomDecks - 1, dividers)
      && !offworldFacilityPlanCountsFit(
        boundaryDepth, roomDecks, dividers - 1);
}
static_assert(offworldFacilityCapacityFixturesAreValid(),
              "Facility plan capacity validation must reject undersized buffers");

constexpr int offworldFacilityMaxHalfWidth() {
  int reach = 0;
  for (const OffworldFacilityArchetypeDef& archetype
       : OFFWORLD_FACILITY_ARCHETYPES)
    if (archetype.halfWidth > reach) reach = archetype.halfWidth;
  return reach;
}
constexpr int offworldFacilityMaxUndergroundDepth() {
  int reach = 0;
  for (const OffworldFacilityArchetypeDef& archetype
       : OFFWORLD_FACILITY_ARCHETYPES)
    if (archetype.undergroundDepth > reach)
      reach = archetype.undergroundDepth;
  return reach;
}
constexpr int offworldFacilityMaxAboveDeckReach() {
  int reach = 0;
  for (const OffworldFacilityArchetypeDef& archetype
       : OFFWORLD_FACILITY_ARCHETYPES)
    if (archetype.aboveDeckReach > reach)
      reach = archetype.aboveDeckReach;
  return reach;
}
inline constexpr int OFFWORLD_FACILITY_OVERSCAN_X =
  offworldFacilityMaxHalfWidth() + 8;
inline constexpr int OFFWORLD_FACILITY_OVERSCAN_Y =
  offworldFacilityMaxUndergroundDepth()
      + OFFWORLD_FACILITY_BELOW_DECK_OVERSCAN_MARGIN
    > offworldFacilityMaxAboveDeckReach()
      ? offworldFacilityMaxUndergroundDepth()
          + OFFWORLD_FACILITY_BELOW_DECK_OVERSCAN_MARGIN
      : offworldFacilityMaxAboveDeckReach();
static_assert(OFFWORLD_FACILITY_OVERSCAN_Y
                >= offworldFacilityMaxAboveDeckReach()
              && OFFWORLD_FACILITY_OVERSCAN_Y
                >= offworldFacilityMaxUndergroundDepth()
                    + OFFWORLD_FACILITY_BELOW_DECK_OVERSCAN_MARGIN,
              "Facility feature reach must contain every registered layout");

enum RuinKind : uint8_t {
#define WORLDGEN_FACILITY_ARCHETYPE(...)
#define WORLDGEN_RUIN_ARCHETYPE(symbol, id, ...) RK_##symbol = id,
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
  RK_COUNT =
#define WORLDGEN_FACILITY_ARCHETYPE(...)
#define WORLDGEN_RUIN_ARCHETYPE(...) + 1
    0
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
};

enum RuinSizeProfile : uint8_t {
  RSP_VARIABLE,
  RSP_SHRINE,
  RSP_COUNT,
};

inline constexpr int RUIN_BASE_MIN_WIDTH = 28;
inline constexpr int RUIN_BASE_WIDTH_VARIATION = 17;
inline constexpr int RUIN_BASE_MAX_WIDTH =
  RUIN_BASE_MIN_WIDTH + RUIN_BASE_WIDTH_VARIATION - 1;
inline constexpr int RUIN_BASE_MIN_HEIGHT = 18;
inline constexpr int RUIN_BASE_HEIGHT_VARIATION = 10;
inline constexpr int RUIN_BASE_MAX_HEIGHT =
  RUIN_BASE_MIN_HEIGHT + RUIN_BASE_HEIGHT_VARIATION - 1;
inline constexpr int RUIN_SHRINE_MIN_WIDTH = 19;
inline constexpr int RUIN_SHRINE_WIDTH_VARIATION = 10;
inline constexpr int RUIN_SHRINE_MAX_WIDTH =
  RUIN_SHRINE_MIN_WIDTH + RUIN_SHRINE_WIDTH_VARIATION - 1;
inline constexpr int RUIN_SHRINE_MAX_HEIGHT =
  PLAYER_H + 3 > RUIN_SHRINE_MAX_WIDTH / 2 + 3
    ? PLAYER_H + 3 : RUIN_SHRINE_MAX_WIDTH / 2 + 3;
inline constexpr int RUIN_FLOOR_SEARCH_REACH = 30;
inline constexpr int RUIN_SIDE_TUNNEL_REACH = 28;
inline constexpr int RUIN_CANDIDATE_JITTER_MAX = 5;
inline constexpr int RUIN_MIN_CANDIDATE_OVERSCAN_X = 64;
inline constexpr int RUIN_MIN_CANDIDATE_OVERSCAN_Y = 64;

struct RuinArchetypeDef {
  RuinKind kind;
  const char* name;
  int preferredCaveProfile;
  double preferredChance;
  bool neutralPool;
  RuinSizeProfile sizeProfile;
  int widthAdd, heightAdd;
  int minSurfaceDepth;
  RuinKind shallowFallback;
};

inline constexpr std::array<RuinArchetypeDef, RK_COUNT> RUIN_ARCHETYPES = {{
#define WORLDGEN_FACILITY_ARCHETYPE(...)
#define WORLDGEN_RUIN_ARCHETYPE(symbol, id, name, profile, chance, neutral, size, widthAdd, heightAdd, minDepth, fallback, stamp) \
  {RK_##symbol, name, profile, chance, neutral, size, widthAdd, heightAdd, \
   minDepth, RK_##fallback},
#include "worldgen_structure_archetypes.def"
#undef WORLDGEN_RUIN_ARCHETYPE
#undef WORLDGEN_FACILITY_ARCHETYPE
}};

constexpr int ruinArchetypeMaxWidth(
    const RuinArchetypeDef& archetype) {
  return archetype.sizeProfile == RSP_VARIABLE
    ? RUIN_BASE_MAX_WIDTH + archetype.widthAdd
    : archetype.sizeProfile == RSP_SHRINE ? RUIN_SHRINE_MAX_WIDTH : 0;
}

constexpr int ruinArchetypeMaxHeight(
    const RuinArchetypeDef& archetype) {
  return archetype.sizeProfile == RSP_VARIABLE
    ? RUIN_BASE_MAX_HEIGHT + archetype.heightAdd
    : archetype.sizeProfile == RSP_SHRINE ? RUIN_SHRINE_MAX_HEIGHT : 0;
}

template <size_t N>
constexpr int ruinMaxWidth(
    const std::array<RuinArchetypeDef, N>& archetypes) {
  int width = 0;
  for (const RuinArchetypeDef& archetype : archetypes) {
    int candidate = ruinArchetypeMaxWidth(archetype);
    if (candidate > width) width = candidate;
  }
  return width;
}

template <size_t N>
constexpr int ruinMaxHeight(
    const std::array<RuinArchetypeDef, N>& archetypes) {
  int height = 0;
  for (const RuinArchetypeDef& archetype : archetypes) {
    int candidate = ruinArchetypeMaxHeight(archetype);
    if (candidate > height) height = candidate;
  }
  return height;
}

constexpr int ruinCandidateOverscanXForWidth(int maxWidth) {
  int planReach = maxWidth + RUIN_CANDIDATE_JITTER_MAX;
  int connectorReach = maxWidth / 2 + RUIN_SIDE_TUNNEL_REACH;
  int required = planReach > connectorReach ? planReach : connectorReach;
  return required > RUIN_MIN_CANDIDATE_OVERSCAN_X
    ? required : RUIN_MIN_CANDIDATE_OVERSCAN_X;
}

constexpr int ruinCandidateOverscanYForHeight(int maxHeight) {
  int required = RUIN_FLOOR_SEARCH_REACH + maxHeight - 1;
  return required > RUIN_MIN_CANDIDATE_OVERSCAN_Y
    ? required : RUIN_MIN_CANDIDATE_OVERSCAN_Y;
}

template <size_t N>
constexpr bool ruinArchetypesAreComplete(
    const std::array<RuinArchetypeDef, N>& archetypes) {
  if (N != (size_t)RK_COUNT) return false;
  bool hasNeutralArchetype = false;
  for (size_t i = 0; i < N; i++) {
    const RuinArchetypeDef& archetype = archetypes[i];
    if ((size_t)archetype.kind != i
        || !archetype.name || archetype.name[0] == '\0'
        || archetype.preferredCaveProfile < -1
        || archetype.preferredCaveProfile >= (int)CBP_COUNT
        || !(archetype.preferredChance >= 0.0
             && archetype.preferredChance <= 1.0)
        || (archetype.preferredCaveProfile < 0
            ? archetype.preferredChance != 0.0
            : archetype.preferredChance <= 0.0)
        || (size_t)archetype.sizeProfile >= (size_t)RSP_COUNT
        || archetype.widthAdd < 0 || archetype.heightAdd < 0
        || archetype.minSurfaceDepth < 0
        || (archetype.sizeProfile != RSP_VARIABLE
            && (archetype.widthAdd != 0 || archetype.heightAdd != 0))
        || (size_t)archetype.shallowFallback >= N
        || ruinArchetypeMaxWidth(archetype) <= 0
        || ruinArchetypeMaxHeight(archetype) <= 0)
      return false;
    if (archetype.preferredCaveProfile >= 0)
      for (size_t j = 0; j < i; j++)
        if (archetypes[j].preferredCaveProfile
              == archetype.preferredCaveProfile
            && archetype.preferredChance
              <= archetypes[j].preferredChance)
          return false;
    hasNeutralArchetype |= archetype.neutralPool;
    if (archetype.minSurfaceDepth > 0) {
      const RuinArchetypeDef& fallback =
        archetypes[(size_t)archetype.shallowFallback];
      if (archetype.sizeProfile != fallback.sizeProfile
          || archetype.widthAdd != fallback.widthAdd
          || archetype.heightAdd != fallback.heightAdd
          || fallback.minSurfaceDepth != 0) return false;
    }
  }
  return hasNeutralArchetype;
}
static_assert(ruinArchetypesAreComplete(RUIN_ARCHETYPES),
              "Ruin archetypes must be dense and exhaustive");

constexpr bool ruinArchetypeInvalidFixturesAreRejected() {
  auto fixture = RUIN_ARCHETYPES;
  fixture[0].preferredChance = 1.01;
  if (ruinArchetypesAreComplete(fixture)) return false;
  fixture = RUIN_ARCHETYPES;
  fixture[0].preferredCaveProfile = CBP_COUNT;
  if (ruinArchetypesAreComplete(fixture)) return false;
  fixture = RUIN_ARCHETYPES;
  fixture[0].widthAdd = -1;
  if (ruinArchetypesAreComplete(fixture)) return false;
  fixture = RUIN_ARCHETYPES;
  fixture[0].sizeProfile = RSP_COUNT;
  if (ruinArchetypesAreComplete(fixture)) return false;
  fixture = RUIN_ARCHETYPES;
  for (RuinArchetypeDef& archetype : fixture)
    archetype.neutralPool = false;
  if (ruinArchetypesAreComplete(fixture)) return false;
  fixture = RUIN_ARCHETYPES;
  fixture[(size_t)RK_SHRINE].preferredCaveProfile =
    fixture[(size_t)RK_OVERGROWN].preferredCaveProfile;
  fixture[(size_t)RK_SHRINE].preferredChance =
    fixture[(size_t)RK_OVERGROWN].preferredChance;
  if (ruinArchetypesAreComplete(fixture)) return false;
  fixture = RUIN_ARCHETYPES;
  fixture[1].widthAdd = 128;
  return ruinArchetypesAreComplete(fixture)
      && ruinMaxWidth(fixture) == RUIN_BASE_MAX_WIDTH + 128
      && ruinCandidateOverscanXForWidth(ruinMaxWidth(fixture))
           > RUIN_MIN_CANDIDATE_OVERSCAN_X;
}
static_assert(ruinArchetypeInvalidFixturesAreRejected(),
              "Invalid ruin archetypes must fail validation");

struct RuinPlan {
  static constexpr int MAX_WIDTH = ruinMaxWidth(RUIN_ARCHETYPES);
  static constexpr int MAX_HEIGHT = ruinMaxHeight(RUIN_ARCHETYPES);
  static constexpr int FLOOR_SEARCH_REACH = RUIN_FLOOR_SEARCH_REACH;
  static constexpr int SIDE_TUNNEL_REACH = RUIN_SIDE_TUNNEL_REACH;
  static constexpr int CANDIDATE_OVERSCAN_X =
    ruinCandidateOverscanXForWidth(MAX_WIDTH);
  static constexpr int CANDIDATE_OVERSCAN_Y =
    ruinCandidateOverscanYForHeight(MAX_HEIGHT);
  static_assert(CANDIDATE_OVERSCAN_X >= MAX_WIDTH
                  + RUIN_CANDIDATE_JITTER_MAX
                && CANDIDATE_OVERSCAN_X
                  >= MAX_WIDTH / 2 + SIDE_TUNNEL_REACH);
  static_assert(CANDIDATE_OVERSCAN_Y
                >= FLOOR_SEARCH_REACH + MAX_HEIGHT - 1);
  int latticeX = 0, latticeY = 0;
  RuinKind kind = RK_HOUSE;
  int left = 0, top = 0, right = 0, bottom = 0;
  int floorY = 0, surfaceY = 0;
  uint32_t id = 0;
};

struct DeepStructurePlan {
  static constexpr int MIN_WIDTH = 86;
  static constexpr int WIDTH_VARIATION = 25;
  static constexpr int MAX_WIDTH = MIN_WIDTH + WIDTH_VARIATION - 1;
  static constexpr int MIN_HEIGHT = 40;
  static constexpr int HEIGHT_VARIATION = 12;
  static constexpr int MAX_HEIGHT = MIN_HEIGHT + HEIGHT_VARIATION - 1;
  static constexpr int SIDE_PORTAL_REACH = 22;
  static constexpr int BUTTRESS_DEPTH = 20;
  static constexpr int FLOOR_SEARCH_EXTRA = 36;
  static constexpr int CANDIDATE_OVERSCAN_X =
    MAX_WIDTH / 2 + SIDE_PORTAL_REACH;
  static constexpr int CANDIDATE_OVERSCAN_Y =
    TerrainGen::DEEP_CAVERN_MAX_RADIUS_Y + FLOOR_SEARCH_EXTRA
    + BUTTRESS_DEPTH - TerrainGen::DEEP_CAVERN_CENTER_Y_MARGIN + 1;
  int gridX = 0, gridY = 0;
  int caveBiome = CAVE_DEFAULT;
  int cavernCenterX = 0, cavernCenterY = 0;
  int cavernRadiusX = 0, cavernRadiusY = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
  int naveLeft = 0, naveTop = 0, naveRight = 0;
  int floorY = 0;
  uint32_t id = 0;
};

enum OutcropStyle : uint8_t {
  OCS_NONE,
  OCS_MINERAL_SPIRE,
  OCS_WEATHERED_HOODOO,
  OCS_BIOME_FORMATION,
};

struct OutcropProfileDef {
  PlanetGenerationProfile profile;
  OutcropStyle style;
};

inline constexpr std::array<OutcropProfileDef,
                            PLANET_GENERATION_PROFILE_COUNT>
OUTCROP_PROFILES = {{
  {PGP_EARTH, OCS_BIOME_FORMATION},
  {PGP_MOON, OCS_MINERAL_SPIRE},
  {PGP_MARS, OCS_WEATHERED_HOODOO},
  {PGP_SHIP, OCS_NONE},
}};
constexpr bool outcropProfilesAreComplete() {
  for (int i = 0; i < PLANET_GENERATION_PROFILE_COUNT; i++)
    if ((int)OUTCROP_PROFILES[i].profile != i) return false;
  return true;
}
constexpr uint32_t outcropGenerationProfileMask() {
  uint32_t mask = 0;
  for (const OutcropProfileDef& profile : OUTCROP_PROFILES)
    if (profile.style != OCS_NONE) mask |= 1u << profile.profile;
  return mask;
}
static_assert(outcropProfilesAreComplete(),
              "Outcrop profiles must be dense and exhaustive");
inline constexpr uint32_t OUTCROP_GENERATION_PROFILE_MASK =
  outcropGenerationProfileMask();

struct OutcropPlan {
  static constexpr int MAX_HEIGHT = 25;
  static constexpr int MAX_HOODOO_HALF_BASE = 11;
  static constexpr int FOUNDATION_MARGIN = 3;
  static constexpr int BOUND_HALF_WIDTH = 28;
  static constexpr int BOUND_VERTICAL_REACH = 28;
  static_assert(BOUND_HALF_WIDTH
                >= MAX_HOODOO_HALF_BASE + FOUNDATION_MARGIN);
  static_assert(BOUND_VERTICAL_REACH >= MAX_HEIGHT);
  int latticeX = 0;
  int center = 0, floorY = 0, biome = BIOME_PLAINS, height = 0;
  OutcropStyle style = OCS_NONE;
  int lean = 0, shardHeight = 0, halfBase = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
  uint32_t id = 0;
};

struct OutcropSlice {
  int left = 0, right = -1;
  int hollowLeft = 1, hollowRight = 0;
  int shardX = 0;
  bool hasShard = false;

  bool contains(int x) const {
    bool inMain = x >= left && x <= right
      && !(x >= hollowLeft && x <= hollowRight);
    return inMain || (hasShard && x == shardX);
  }
};

class WorldContextSystem {
 public:
  explicit WorldContextSystem(Engine& e) : E(e) {}

  static constexpr int VILLAGE_LATTICE = 720;
  static constexpr double VILLAGE_CHANCE = 0.62;
  static constexpr int MINE_LATTICE = 512;
  static constexpr int OFFWORLD_FACILITY_LATTICE = 420;
  static constexpr int RUIN_LATTICE = 76;
  static constexpr int OUTCROP_LATTICE = 92;

  bool villagePlan(int latticeX, VillagePlan& out) const;
  bool villageBuildingPlan(const VillagePlan& village, int ordinal,
                           VillageBuildingPlan& out,
                           int queryX = INT_MIN) const;
  bool minePlan(int latticeX, MinePlan& out) const;
  bool offworldFacilityPlan(int latticeX, OffworldFacilityPlan& out) const;
  bool ruinPlan(int latticeX, int latticeY, RuinPlan& out) const;
  bool deepStructurePlan(int gridX, int gridY,
                         DeepStructurePlan& out) const;
  bool outcropPlan(int latticeX, OutcropPlan& out) const;
  static bool outcropSlice(const OutcropPlan& plan, int dy,
                           OutcropSlice& out);
  static bool fossilCellAt(const OutcropPlan& plan, int dx, int dy);
  WorldContext at(int worldX, int worldY) const;
  void writeSnapshot(int worldX, int worldY, int* out) const;

 private:
#define SAND_GENERATED_FEATURE(                                      \
    ID, NAME, KIND, ROLE, TAGS, PROFILES, LATTICE_W, LATTICE_H,     \
    REACH_X, REACH_Y, PRIORITY, STAGE, LAYERS, POLICY, EXCLUDES,    \
    QUERY, OVERLAPS, STAMP)                                          \
  bool QUERY(const GeneratedFeatureDef&, int, int,                   \
             GeneratedFeatureMatch&) const;                          \
  bool OVERLAPS(const GeneratedFeatureDef&, const WorldBounds&) const;
#include "worldgen_features.def"
#undef SAND_GENERATED_FEATURE

 public:
  inline static constexpr std::array<GeneratedFeatureDef, GFF_COUNT> FEATURES = {{
#define SAND_GENERATED_FEATURE(                                     \
    ID, NAME, KIND, ROLE, TAGS, PROFILES, LATTICE_W, LATTICE_H,    \
    REACH_X, REACH_Y, PRIORITY, STAGE, LAYERS, POLICY, EXCLUDES,   \
    QUERY, OVERLAPS, STAMP)                                         \
    {GFF_##ID, NAME, KIND, ROLE, TAGS, PROFILES,                    \
     LATTICE_W, LATTICE_H, REACH_X, REACH_Y, PRIORITY,              \
     STAGE, LAYERS, POLICY, EXCLUDES,                               \
     &WorldContextSystem::QUERY, &WorldContextSystem::OVERLAPS,     \
     &STAMP},
#include "worldgen_features.def"
#undef SAND_GENERATED_FEATURE
  }};

  static constexpr const GeneratedFeatureDef& featureDef(
      GeneratedFeatureFamily family) {
    return FEATURES[(size_t)family];
  }
 private:
  Engine& E;

  static int floorDiv(int value, int divisor);
  bool featureApplies(GeneratedFeatureFamily family) const;
  bool villageCandidate(int latticeX, VillagePlan& out) const;
  uint32_t featureId(uint32_t salt, int x, int y) const;
  bool candidateAccepted(const GeneratedFeatureDef&,
                         const WorldBounds&) const;
  bool mineContains(const MinePlan& mine, int worldX, int worldY,
                    WorldSiteRole& role, WorldBounds& bounds) const;
};

static_assert(GFF_COUNT > 0 && GFF_COUNT <= 32,
              "Generated feature selection uses a 32-bit family mask");
inline constexpr uint32_t GENERATED_FEATURE_ALL_MASK =
  UINT32_MAX >> (32 - GFF_COUNT);

template <size_t N>
constexpr bool validGeneratedFeatureCatalogue(
    const std::array<GeneratedFeatureDef, N>& catalogue) {
  if (N != GFF_COUNT) return false;
  for (size_t i = 0; i < N; i++) {
    const GeneratedFeatureDef& feature = catalogue[i];
    if ((size_t)feature.family != i || !feature.query || !feature.overlaps
        || !feature.stamp
        || !feature.name || feature.name[0] == '\0'
        || feature.generationProfileMask == 0
        || (feature.generationProfileMask & ~GENERATION_PROFILE_ALL_MASK) != 0
        || feature.latticeWidth <= 0 || feature.latticeHeight < 0
        || feature.overscanX < 0 || feature.overscanY < 0
        || (unsigned)feature.stage >= GFS_COUNT
        || feature.layerMask == 0
        || (feature.layerMask & ~GFL_BOTH) != 0
        || (feature.stampPolicy != GFSP_REPLACE
            && feature.stampPolicy != GFSP_IF_EMPTY)
        || (feature.excludesMask & ~GENERATED_FEATURE_ALL_MASK) != 0)
      return false;
    if (feature.excludesMask & (1u << i)) return false;
    for (size_t j = 0; j < i; j++) {
      const GeneratedFeatureDef& earlier = catalogue[j];
      if (earlier.stage == feature.stage
          && earlier.priority > feature.priority)
        return false;
    }
    for (size_t j = 0; j < N; j++) {
      if ((feature.excludesMask & (1u << j)) == 0) continue;
      // Exclusions always point down the ownership order, making candidate
      // acceptance acyclic even when the excluded family has exclusions too.
      if (catalogue[j].priority >= feature.priority)
        return false;
    }
  }
  return true;
}
static_assert(validGeneratedFeatureCatalogue(WorldContextSystem::FEATURES),
              "Generated feature descriptors must be dense and stage-ordered");

constexpr bool generatedFeatureInvalidFixturesAreRejected() {
  auto fixture = WorldContextSystem::FEATURES;
  fixture[0].generationProfileMask = 0;
  if (validGeneratedFeatureCatalogue(fixture)) return false;
  fixture = WorldContextSystem::FEATURES;
  fixture[0].layerMask = 1u << 7;
  if (validGeneratedFeatureCatalogue(fixture)) return false;
  fixture = WorldContextSystem::FEATURES;
  fixture[0].stampPolicy = (GeneratedFeatureStampPolicy)255;
  if (validGeneratedFeatureCatalogue(fixture)) return false;
  fixture = WorldContextSystem::FEATURES;
  fixture[0].excludesMask = UINT32_MAX;
  return !validGeneratedFeatureCatalogue(fixture);
}
static_assert(generatedFeatureInvalidFixturesAreRejected(),
              "Invalid generated feature descriptors must fail validation");

// Positive means `candidate` owns an overlap and therefore stamps later; negative
// means it yields. The same ordering drives raster composition and semantic
// context, including explicit plan-level exclusion relationships.
constexpr int compareGeneratedFeatureOwnership(
    const GeneratedFeatureDef& candidate, int candidateSpecificity,
    uint32_t candidateId, const GeneratedFeatureDef& incumbent,
    int incumbentSpecificity, uint32_t incumbentId) {
  bool candidateExcluded =
    (candidate.excludesMask & (1u << incumbent.family)) != 0;
  bool incumbentExcluded =
    (incumbent.excludesMask & (1u << candidate.family)) != 0;
  if (candidateExcluded != incumbentExcluded)
    return candidateExcluded ? -1 : 1;
  if (candidate.priority != incumbent.priority)
    return candidate.priority < incumbent.priority ? -1 : 1;
  if (candidate.family == incumbent.family
      && candidateSpecificity != incumbentSpecificity)
    return candidateSpecificity < incumbentSpecificity ? -1 : 1;
  if (candidateId != incumbentId)
    return candidateId > incumbentId ? -1 : 1;
  if (candidate.family != incumbent.family)
    return candidate.family < incumbent.family ? -1 : 1;
  return 0;
}

inline constexpr std::array<WorldGenerationStageDef, WGS_COUNT>
WORLD_GENERATION_STAGES = {{
#define SAND_WORLDGEN_STAGE(symbol, id, name, profiles, featureStage, reachX, reachY, callback) \
  {WGS_##symbol, name, profiles, featureStage, reachX, reachY, &callback},
#include "worldgen_stages.def"
#undef SAND_WORLDGEN_STAGE
}};

template <size_t N>
constexpr bool validWorldGenerationStages(
    const std::array<WorldGenerationStageDef, N>& stages) {
  if (N != WGS_COUNT) return false;
  for (size_t i = 0; i < N; i++) {
    const WorldGenerationStageDef& stage = stages[i];
    if ((int)stage.id != (int)i || !stage.name || stage.name[0] == '\0'
        || stage.generationProfileMask == 0
        || (stage.generationProfileMask & ~GENERATION_PROFILE_ALL_MASK) != 0
        || (unsigned)stage.featureStage > GFS_COUNT
        || stage.overscanX < 0 || stage.overscanY < 0 || !stage.run)
      return false;
  }
  return true;
}

template <size_t StageN, size_t FeatureN>
constexpr bool generationStageCoverageIsComplete(
    const std::array<WorldGenerationStageDef, StageN>& stages,
    const std::array<GeneratedFeatureDef, FeatureN>& features) {
  for (const GeneratedFeatureDef& feature : features) {
    uint32_t coveredProfiles = 0;
    for (const WorldGenerationStageDef& stage : stages)
      if (stage.featureStage == feature.stage)
        coveredProfiles |= stage.generationProfileMask;
    if ((feature.generationProfileMask & ~coveredProfiles) != 0) return false;
  }
  for (const WorldGenerationStageDef& stage : stages) {
    if ((unsigned)stage.featureStage >= GFS_COUNT) continue;
    bool hasCompatibleFeature = false;
    for (const GeneratedFeatureDef& feature : features)
      if (feature.stage == stage.featureStage
          && (feature.generationProfileMask & stage.generationProfileMask) != 0) {
        hasCompatibleFeature = true;
        break;
      }
    if (!hasCompatibleFeature) return false;
  }
  return true;
}

static_assert(validWorldGenerationStages(WORLD_GENERATION_STAGES),
              "World generation stages must be dense and exhaustive");
static_assert(generationStageCoverageIsComplete(
                WORLD_GENERATION_STAGES, WorldContextSystem::FEATURES),
              "Every generated feature needs a compatible generation stage");

constexpr bool worldGenerationStageInvalidFixturesAreRejected() {
  auto fixture = WORLD_GENERATION_STAGES;
  fixture[0].generationProfileMask = 0;
  if (validWorldGenerationStages(fixture)) return false;
  fixture = WORLD_GENERATION_STAGES;
  fixture[0].featureStage = (GeneratedFeatureStage)(GFS_COUNT + 1);
  if (validWorldGenerationStages(fixture)) return false;
  fixture = WORLD_GENERATION_STAGES;
  for (WorldGenerationStageDef& stage : fixture)
    if (stage.featureStage == WorldContextSystem::FEATURES[0].stage)
      stage.featureStage = GFS_COUNT;
  return !generationStageCoverageIsComplete(
    fixture, WorldContextSystem::FEATURES);
}
static_assert(worldGenerationStageInvalidFixturesAreRejected(),
              "Invalid or uncovered world generation stages must fail validation");
