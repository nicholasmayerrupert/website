#pragma once
// Material-aware creatures: deterministic AI, AABB physics/combat, population
// policy, and snapshots. Creature positions are ABSOLUTE world cells, unlike
// players/items, so a streaming shift never changes their identity or pose.

struct Engine;

enum CreatureLocomotion : uint8_t {
  CL_AQUATIC = 0, CL_AMPHIBIOUS, CL_FLYING, CL_STATIONARY
};
enum CreatureTarget : uint8_t { CT_NONE = 0, CT_PLAYER = 1, CT_PREY = 2 };
enum CreatureHabitat : uint8_t { CH_WATER = 0, CH_SURFACE, CH_CAVE, CH_AIR };
static constexpr int CREATURE_BORE_RADIUS = 5;

struct CreatureSpawnRule {
  CreatureHabitat habitat;
  int maxActive;
  int densityRadius;
  int densityCap;
  int minPlayerDistance;
  int maxPlayerDistance;
};
struct CreatureWorldRule {
  uint32_t requiredTags = 0;
  uint32_t excludedTags = 0;
  uint32_t preferredTags = 0;
  uint32_t allowedSurfaceBiomes = SURFACE_BIOME_ALL_MASK;
  uint32_t allowedCaveBiomes = CAVE_BIOME_ALL_MASK;
  uint32_t preferredSurfaceBiomes = 0;
  uint32_t preferredCaveBiomes = 0;
  int minDepth = INT_MIN;
  int maxDepth = INT_MAX;
  int baseWeight = 10;
  int preferredBonus = 20;
};

struct CreatureSpecies {
  uint8_t id;
  const char* name;
  CreatureLocomotion locomotion;
  int w, h, maxHealth;
  double walkSpeed, swimSpeed, accel, gravity, jumpSpeed;
  double fluidThreshold, sightRange, attackRange;
  int damage, attackCooldown, scanInterval;
  int hopPeriod;
  uint8_t targetMask;
  uint32_t preyMask;
  bool hostile;
  CreatureSpawnRule spawn;
  CreatureWorldRule world;
  uint8_t population;
  int encounterCost;
  bool countsTowardNaturalCap;
  uint8_t behaviorProfile;
  uint8_t renderProfile;
  bool humanNpc;
  uint8_t renderBob;
  bool stationaryCycle;
  uint8_t protection;
};

#include "creatures.generated.hpp"

struct Creature {
  int id = 0;
  uint8_t species = CS_MINNOW;
  bool alive = true;
  double wx = 0, wy = 0; // absolute-world AABB top-left (+y down)
  double vx = 0, vy = 0;
  int health = 1;
  int facing = 1;
  bool grounded = false;
  uint8_t targetKind = CT_NONE;
  int targetId = 0;
  int scanCooldown = 0, attackCooldown = 0, hurtCooldown = 0;
  int deathTicks = 0;
  int wanderDir = 0, wanderTicks = 0;
  double homeX = 0;
  int roamRadius = 0;
  int habitatScanCooldown = 0;
  double habitatX = 0, habitatY = 0;
  bool hasHabitatGoal = false;
  uint8_t animFrame = 0;
  uint8_t attackState = CAS_IDLE;
  uint8_t attackPattern = 0;
  int attackTicks = 0;
  double attackProgress = 0;
  double attackAimX = 0, attackAimY = 0; // absolute-world target
  // Presentation mirrors also store pending-breach records in this compact
  // actor shape. Authority-side materialized creatures always keep this at 0.
  double spawnProgress = 0;
  double shelterCharge = 0; // powered rescue shelter, fades as its jammer shuts down
  double rescueProgress = 0; // 0..1 channel, 1..2 departure animation
  int rescueLastTick = -1;
  int missionObjective = -1;
  bool missionActor = false;
};

struct CreatureSpawnTelegraph {
  int id = 0;
  uint8_t species = CS_DYNAMITEER;
  double wx = 0, wy = 0;
  int ticksRemaining = 0, totalTicks = 1;
};

class CreatureSystem {
 public:
  explicit CreatureSystem(Engine& e) : E(e) {}

  std::vector<Creature> creatures;
  // Hibernation is bucketed by absolute 128-cell region, so restoring a window
  // touches only nearby buckets instead of scanning all previously explored life.
  std::unordered_map<uint64_t, std::vector<Creature>> dormantRegions;
  std::unordered_set<uint64_t> spawnedVillageResidentSites;
  std::vector<CreatureSpawnTelegraph> pendingSpawns;
  std::vector<float> snapshot;
  int nextCreatureId = 1;
  static constexpr int NATURAL_MOB_CAP = 8;
  static constexpr int AMBIENT_MOB_CAP = 3;
  static constexpr int VILLAGE_RESIDENT_CAP = 12;
  static constexpr int MIXED_DENSITY_RADIUS = 96;
  static constexpr int MIXED_DENSITY_CAP = 3;
  static constexpr int SPAWN_VIEW_MARGIN = 10;
  static constexpr int SPAWN_TELEGRAPH_MIN_TICKS = 54;
  static constexpr int SPAWN_TELEGRAPH_TICK_SPAN = 31;
  static constexpr int ENCOUNTER_CADENCE_TICKS = 120;
  static constexpr int ENCOUNTER_THREAT_GAIN_TICKS = 90;
  static constexpr int ENCOUNTER_THREAT_MAX = 14;
  static constexpr int AMBIENT_CADENCE_TICKS = 240;
  int encounterThreat = 8;
  int encounterNextTick = 0;
  int ambientNextTick = 0;

  const CreatureSpecies& species(const Creature& c) const { return CREATURE_SPECIES[c.species]; }
  bool isProtectedNpc(const Creature& c) const;
  bool inLoadedWindow(const Creature& c, int margin = 0) const;
  bool boxInsideLoadedWindow(double wx, double wy, int w, int h, int margin = 0) const;
  bool boxHitsSolid(double wx, double wy, int w, int h) const;
  double blockingCoverage(double wx, double wy, int w, int h) const;
  double fluidCoverage(double wx, double wy, int w, int h) const;
  uint8_t contactHazardAtBox(
    double wx, double wy, int w, int h, int cadencePhase) const;
  bool boxTouchesLiquid(double wx, double wy, int w, int h) const;
  bool boxFitsHabitat(uint8_t speciesId, double wx, double wy) const;
  bool worldRuleAllows(uint8_t speciesId, double wx, double wy) const;
  int worldSpawnWeight(uint8_t speciesId, double wx, double wy) const;
  int localDensity(uint8_t speciesId, double wx, double wy, int radius) const;
  int localDensityAll(double wx, double wy, int radius) const;
  bool farEnoughFromPlayers(double wx, double wy, int minDistance) const;
  bool spawnNearFocus(uint8_t speciesId, uint32_t salt);
  bool spawnVisibleBreachNearFocus(uint8_t speciesId, uint32_t salt);
  bool findSpawnNearFocus(uint8_t speciesId, uint32_t salt, bool requireOffscreen,
                          double& outWx, double& outWy) const;
  bool queueSpawnTelegraph(uint8_t speciesId, double wx, double wy, uint32_t salt);
  bool hasRecordCapacity() const;
  void updateSpawnTelegraphs();
  int encounterCost(uint8_t speciesId) const;
  int addCreature(uint8_t speciesId, double wx, double wy, int id);
  bool safeGroundSpawnAt(uint8_t species, int x, int y, const Creature* ignore = nullptr) const;
  bool findGroundSpawn(uint8_t species, double worldX, double worldY, double& x, double& y,
                       int rangeX = 32, int rangeY = 48, const Creature* ignore = nullptr) const;
  int spawnCreature(uint8_t speciesId, double wx, double wy, bool requireHabitat = true);
  int spawnCreatureNatural(uint8_t speciesId, double wx, double wy);
  void maintainPopulation();
  void updateVillageResidents();
  void updateNaturalPopulation();
  void acquireTarget(Creature& c);
  bool targetPoint(const Creature& c, double& tx, double& ty, Creature** prey, Player** player);
  bool findNearbyHabitat(const Creature& c, int maxRadius, double& tx, double& ty) const;
  void applySpatialForce(Creature& c);
  void refreshWander(Creature& c);
  void steerAquatic(Creature& c);
  void moveAquatic(Creature& c);
  void moveBeachedAquatic(Creature& c);
  void moveAmphibious(Creature& c);
  void moveFlying(Creature& c);
  void attackTarget(Creature& c);
  void updateBoreSentinelAttack(Creature& c);
  void updateMinigunnerAttack(Creature& c);
  void updateBossAttack(Creature& c);
  void fireBore(Creature& c);
  void fireBore(Player& p);
  void fireBoreLine(double ox, double oy, double dx, double dy, int damage,
                    int immunePlayerId, int immuneCreatureId);
  void dropWeapon(const Creature& c);
  void killCreature(Creature& c);
  void crushCreature(Creature& c);
  void updateCreatures();
  bool damageAtPoint(int x, int y, int radius, int damage);
  int buildCreatureSnapshot();

 private:
  Engine& E;
  WorldContext spawnWorldContext(double wx, double wy) const;
  bool worldRuleAllows(
    const CreatureWorldRule& rule, const WorldContext& context) const;
  int worldSpawnWeight(uint8_t speciesId, const WorldContext& context) const;
  void updateChargedProjectileAttack(Creature& c, CreatureAttackHandler attack,
                                     int chargeTicks, int firingTicks);
};
