#pragma once
// Campaign mission authority: authored objectives, scripted actors, extraction,
// and compact snapshots. Mission positions are absolute world cells so streaming
// never changes an objective's identity or marker.

struct Engine;
struct Creature;

static constexpr int MISSION_FLAG_PRIMARY_MARKER = 1 << 0;
static constexpr int MISSION_FLAG_EXTRACTION = 1 << 1;

struct MissionObjective {
  int id = 0;
  uint8_t type = OK_CLEAR;
  uint8_t state = OS_LOCKED;
  int current = 0;
  int required = 1;
  int worldX = 0, worldY = 0;
  int targetActorId = 0;
  int flags = 0;
};

class MissionSystem {
 public:
  explicit MissionSystem(Engine& e) : E(e) {}

  uint8_t missionId = MI_NONE;
  uint8_t planetId = PL_EARTH;
  uint8_t phase = MP_INACTIVE;
  int playerId = 0;
  int revision = 0;
  int threatLevel = 0;
  int extractionX = 0, extractionY = 0;
  int startActorTick = 0;
  int elapsedTicks = 0;
  int recoveredWeaponMask = 0;
  int pendingObjective = -1;
  bool coreDestabilized = false;
  std::vector<MissionObjective> objectives;
  std::vector<int32_t> missionSnapshot;
  std::vector<int32_t> objectiveSnapshot;

  bool start(int id, int ownerPlayerId);
  void update();
  void onCreatureKilled(Creature& creature);
  bool rescueCreature(Creature& creature);
  bool active() const {
    return phase == MP_ACTIVE || phase == MP_EXTRACTION;
  }
  int buildMissionSnapshot();
  int buildObjectiveSnapshot();

 private:
  Engine& E;

  MissionObjective& addObjective(uint8_t type, uint8_t state, int required,
                                 int worldX, int worldY, int flags = 0);
  MissionObjective* findObjective(int objectiveId);
  Creature* findCreature(int actorId);
  int spawnMissionCreature(uint8_t species, int worldX, int worldY,
                           int objectiveId, int offsetX = 0);
  void carveRoom(int worldX, int worldY, int radius);
  void authorFacilityRoom(int worldX, int worldY, int radius);
  void activateObjective(int objectiveId);
  void completeObjective(MissionObjective& objective);
  void refreshObjectiveMarker(MissionObjective& objective);
  void beginExtraction();
  void fail();
  void updateThreat();
  void collectRecoveredWeapons();
};
