#pragma once
// Immutable semantic world records. Plans are pure functions of the world seed,
// planet, worldgen version, and absolute coordinates, so they survive streaming
// without growing the changed-cell store.

struct Engine;

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

struct MinePlan {
  int latticeX = 0;
  int center = 0, width = 0, levels = 0, firstFloor = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
  int headhouseLeft = 0, headhouseTop = 0;
  int headhouseRight = 0, headhouseFloor = 0;
  uint32_t id = 0;
};

struct OffworldFacilityPlan {
  int latticeX = 0;
  int center = 0, kind = 0;
  int left = 0, top = 0, right = 0, bottom = 0;
  int deckY = 0, facilityLeft = 0, facilityRight = 0;
  int facilityTop = 0, facilityBottom = 0;
  uint32_t id = 0;
};

class WorldContextSystem {
 public:
  explicit WorldContextSystem(Engine& e) : E(e) {}

  static constexpr int VERSION = 1;
  static constexpr int VILLAGE_LATTICE = 420;
  static constexpr double VILLAGE_CHANCE = 0.70;
  static constexpr int MINE_LATTICE = 512;
  static constexpr int OFFWORLD_FACILITY_LATTICE = 420;

  bool villagePlan(int latticeX, VillagePlan& out) const;
  bool villageBuildingPlan(const VillagePlan& village, int ordinal,
                           VillageBuildingPlan& out,
                           int queryX = INT_MIN) const;
  bool minePlan(int latticeX, MinePlan& out) const;
  bool offworldFacilityPlan(int latticeX, OffworldFacilityPlan& out) const;
  WorldContext at(int worldX, int worldY) const;
  void writeSnapshot(int worldX, int worldY, int* out) const;

 private:
  Engine& E;

  static int floorDiv(int value, int divisor);
  uint32_t featureId(uint32_t salt, int x, int y) const;
};
