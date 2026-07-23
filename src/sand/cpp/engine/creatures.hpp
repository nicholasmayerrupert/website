#pragma once
// Material-aware creatures: deterministic AI, AABB physics/combat, population
// policy, and snapshots. Creature positions are ABSOLUTE world cells, unlike
// players/items, so a streaming shift never changes their identity or pose.

struct Engine;

enum CreatureSpeciesId : uint8_t {
  CS_MINNOW = 0, CS_PIKE, CS_FOX, CS_HARE, CS_CRAWLER, CS_MOLE, CS_BIRD,
  CS_DYNAMITEER = 7, CS_BORE_SENTINEL = 8, CS_COUNT
};
enum CreatureLocomotion : uint8_t { CL_AQUATIC = 0, CL_AMPHIBIOUS, CL_FLYING };
enum CreatureTarget : uint8_t { CT_NONE = 0, CT_PLAYER = 1, CT_PREY = 2 };
enum CreatureSpawnMode : uint8_t { CSM_REGION = 0, CSM_CONTINUOUS };
enum CreatureHabitat : uint8_t { CH_WATER = 0, CH_SURFACE, CH_CAVE, CH_AIR };
static constexpr int CREATURE_BORE_RADIUS = 4;

struct CreatureSpawnRule {
  CreatureSpawnMode mode;
  CreatureHabitat habitat;
  int regionSize;
  int maxPerRegion;
  int maxActive;
  int densityRadius;
  int densityCap;
  int intervalTicks;
  double chance;
  int minPlayerDistance;
  int maxPlayerDistance;
};

struct CreatureSpecies {
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
};

// One compact, centralized species table. Changing movement/combat/spawn cadence
// or switching between region-time and continuous spawning is a data edit here.
static const CreatureSpecies CREATURE_SPECIES[CS_COUNT] = {
  {.name="minnow", .locomotion=CL_AQUATIC, .w=4, .h=2, .maxHealth=18,
   .walkSpeed=0, .swimSpeed=0.34, .accel=0.055, .gravity=0, .jumpSpeed=0,
   .fluidThreshold=0.70, .sightRange=34, .attackRange=0,
   .damage=0, .attackCooldown=18, .scanInterval=18, .hopPeriod=0,
   .targetMask=CT_NONE, .preyMask=0, .hostile=false,
   .spawn={CSM_CONTINUOUS, CH_WATER, 160, 2, 3, 84, 2, 420, 0.60, 20, 82}},
  {.name="pike", .locomotion=CL_AQUATIC, .w=7, .h=3, .maxHealth=55,
   .walkSpeed=0, .swimSpeed=0.48, .accel=0.070, .gravity=0, .jumpSpeed=0,
   .fluidThreshold=0.64, .sightRange=58, .attackRange=0.6,
   .damage=12, .attackCooldown=14, .scanInterval=14, .hopPeriod=0,
   .targetMask=(uint8_t)(CT_PREY | CT_PLAYER), .preyMask=(1u << CS_MINNOW), .hostile=true,
   .spawn={CSM_CONTINUOUS, CH_WATER, 224, 1, 2, 130, 1, 720, 0.45, 28, 96}},
  {.name="fox", .locomotion=CL_AMPHIBIOUS, .w=7, .h=4, .maxHealth=42,
   .walkSpeed=0.34, .swimSpeed=0.30, .accel=0.060, .gravity=0.075, .jumpSpeed=1.15,
   .fluidThreshold=0.30, .sightRange=62, .attackRange=0.5,
   .damage=7, .attackCooldown=16, .scanInterval=16, .hopPeriod=0,
   .targetMask=CT_PLAYER, .preyMask=0, .hostile=true,
   .spawn={CSM_CONTINUOUS, CH_SURFACE, 192, 1, 1, 96, 1, 660, 0.45, 28, 78}},
  {.name="hare", .locomotion=CL_AMPHIBIOUS, .w=5, .h=3, .maxHealth=24,
   .walkSpeed=0.34, .swimSpeed=0.30, .accel=0.070, .gravity=0.075, .jumpSpeed=1.30,
   .fluidThreshold=0.30, .sightRange=44, .attackRange=0,
   .damage=0, .attackCooldown=0, .scanInterval=20, .hopPeriod=46,
   .targetMask=CT_NONE, .preyMask=0, .hostile=false,
   .spawn={CSM_CONTINUOUS, CH_SURFACE, 160, 1, 2, 88, 1, 540, 0.60, 22, 68}},
  {.name="crawler", .locomotion=CL_AMPHIBIOUS, .w=7, .h=3, .maxHealth=48,
   .walkSpeed=0.25, .swimSpeed=0.22, .accel=0.052, .gravity=0.075, .jumpSpeed=0.95,
   .fluidThreshold=0.34, .sightRange=70, .attackRange=0.7,
   .damage=8, .attackCooldown=20, .scanInterval=18, .hopPeriod=0,
   .targetMask=CT_PLAYER, .preyMask=0, .hostile=true,
   .spawn={CSM_CONTINUOUS, CH_CAVE, 160, 1, 1, 104, 1, 720, 0.45, 30, 112}},
  {.name="mole", .locomotion=CL_AMPHIBIOUS, .w=6, .h=3, .maxHealth=34,
   .walkSpeed=0.22, .swimSpeed=0.18, .accel=0.048, .gravity=0.075, .jumpSpeed=0.82,
   .fluidThreshold=0.36, .sightRange=40, .attackRange=0,
   .damage=0, .attackCooldown=0, .scanInterval=22, .hopPeriod=0,
   .targetMask=CT_NONE, .preyMask=0, .hostile=false,
   .spawn={CSM_CONTINUOUS, CH_CAVE, 176, 1, 1, 112, 1, 780, 0.45, 34, 116}},
  {.name="bird", .locomotion=CL_FLYING, .w=5, .h=3, .maxHealth=20,
   .walkSpeed=0, .swimSpeed=0.50, .accel=0.060, .gravity=0, .jumpSpeed=0,
   .fluidThreshold=0, .sightRange=54, .attackRange=0,
   .damage=0, .attackCooldown=0, .scanInterval=20, .hopPeriod=0,
   .targetMask=CT_NONE, .preyMask=0, .hostile=false,
   .spawn={CSM_CONTINUOUS, CH_AIR, 176, 1, 2, 96, 1, 600, 0.55, 20, 72}},
  {.name="dynamiteer", .locomotion=CL_AMPHIBIOUS, .w=7, .h=5, .maxHealth=72,
   .walkSpeed=0.23, .swimSpeed=0.17, .accel=0.045, .gravity=0.075, .jumpSpeed=1.00,
   .fluidThreshold=0.30, .sightRange=92, .attackRange=72,
   .damage=18, .attackCooldown=135, .scanInterval=12, .hopPeriod=0,
   .targetMask=CT_PLAYER, .preyMask=0, .hostile=true,
   .spawn={CSM_CONTINUOUS, CH_SURFACE, 224, 1, 1, 128, 1, 780, 0.70, 34, 100}},
  {.name="bore sentinel", .locomotion=CL_AMPHIBIOUS, .w=9, .h=6, .maxHealth=170,
   .walkSpeed=0.12, .swimSpeed=0.11, .accel=0.026, .gravity=0.075, .jumpSpeed=0.72,
   .fluidThreshold=0.34, .sightRange=138, .attackRange=118,
   .damage=42, .attackCooldown=260, .scanInterval=10, .hopPeriod=0,
   .targetMask=CT_PLAYER, .preyMask=0, .hostile=true,
   .spawn={CSM_CONTINUOUS, CH_CAVE, 256, 1, 1, 156, 1, 1050, 0.55, 46, 132}},
};

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
  int habitatScanCooldown = 0;
  double habitatX = 0, habitatY = 0;
  bool hasHabitatGoal = false;
  uint8_t animFrame = 0;
  uint8_t attackState = CAS_IDLE;
  int attackTicks = 0;
  double attackProgress = 0;
  double attackAimX = 0, attackAimY = 0; // absolute-world target
};

class CreatureSystem {
 public:
  explicit CreatureSystem(Engine& e) : E(e) {}

  std::vector<Creature> creatures;
  // Hibernation is bucketed by absolute 128-cell region, so restoring a window
  // touches only nearby buckets instead of scanning all previously explored life.
  std::unordered_map<uint64_t, std::vector<Creature>> dormantRegions;
  std::unordered_set<uint64_t> spawnedRegions;
  std::vector<float> snapshot;
  int nextCreatureId = 1;
  static constexpr int NATURAL_MOB_CAP = 8;
  static constexpr int MIXED_DENSITY_RADIUS = 96;
  static constexpr int MIXED_DENSITY_CAP = 3;

  const CreatureSpecies& species(const Creature& c) const { return CREATURE_SPECIES[c.species]; }
  bool inLoadedWindow(const Creature& c, int margin = 0) const;
  bool boxHitsSolid(double wx, double wy, int w, int h) const;
  double blockingCoverage(double wx, double wy, int w, int h) const;
  double fluidCoverage(double wx, double wy, int w, int h) const;
  bool boxTouchesLiquid(double wx, double wy, int w, int h) const;
  bool boxFitsHabitat(uint8_t speciesId, double wx, double wy) const;
  int localDensity(uint8_t speciesId, double wx, double wy, int radius) const;
  int localDensityAll(double wx, double wy, int radius) const;
  bool farEnoughFromPlayers(double wx, double wy, int minDistance) const;
  bool spawnNearFocus(uint8_t speciesId, uint32_t salt);
  int spawnCreature(uint8_t speciesId, double wx, double wy, bool requireHabitat = true);
  int spawnCreatureNatural(uint8_t speciesId, double wx, double wy);
  bool spawnCandidate(uint8_t speciesId, int regionX, int regionY, uint32_t salt);
  void spawnRegion(uint8_t speciesId, int regionX, int regionY);
  void maintainPopulation();
  void updateNaturalPopulation();
  void acquireTarget(Creature& c);
  bool targetPoint(const Creature& c, double& tx, double& ty, Creature** prey, Player** player);
  bool findNearbyHabitat(const Creature& c, int maxRadius, double& tx, double& ty) const;
  void refreshWander(Creature& c);
  void steerAquatic(Creature& c);
  void moveAquatic(Creature& c);
  void moveBeachedAquatic(Creature& c);
  void moveAmphibious(Creature& c);
  void moveFlying(Creature& c);
  void attackTarget(Creature& c);
  void updateDynamiteerAttack(Creature& c);
  void updateBoreSentinelAttack(Creature& c);
  void fireBore(Creature& c);
  void fireBore(Player& p);
  void fireBoreLine(double ox, double oy, double dx, double dy, int damage,
                    int immunePlayerId, int immuneCreatureId);
  void dropWeapon(const Creature& c);
  void updateCreatures();
  bool damageAtPoint(int x, int y, int radius, int damage);
  int buildCreatureSnapshot();

 private:
  Engine& E;
};
