#pragma once
// Deterministic AABB player physics, survival tool policy, and snapshots.

struct Engine;

class PlayerSystem {
 public:
  explicit PlayerSystem(Engine& e) : E(e) {}

  std::vector<Player> players;
  int nextPlayerId = 1;
  std::vector<float> snapshot; // packed [PS_STRIDE] floats per player (ABI reads it)

  bool isSolidForPlayer(uint8_t m);
  bool playerCellSolid(int x, int y);
  bool playerBoxHits(double px, double py, int w, int h);
  bool playerBoxHitsOtherBody(double px, double py, int w, int h, const Body* ignored);
  bool rowSolid(double px, int w, int row);
  bool colSolid(double py, int h, int col);
  int buryDepth(const Player& p);
  bool edgeBlockedX(double px, double py, int w, int h, int dir);
  bool tryMoveX(Player& p, double d, int bury);
  bool moveDown(Player& p, double d);
  bool moveUp(Player& p, double d);
  bool tryMoveY(Player& p, double d);
  bool spawnAreaLoaded(double px, double py, int margin = P_SPAWN_HAZARD_MARGIN);
  bool spawnOverlapsPlayer(double px, double py, const Player* ignore);
  bool safeSpawnAt(double px, double py, const Player* ignore);
  bool findSafeSpawnNearWorld(double worldX, double worldY, double* out, const Player* ignore);
  bool buildSafeSpawnPad(double worldX, double worldY, double* out, const Player* ignore);
  int spawnPlayer(double x, double y);
  void playerSurfaceSpawn(int col, double* out);
  int spawnPlayerAtSurface(int col);
  bool respawnPlayer(Player& p);
  bool requestRespawn(int id);
  bool shieldCoversSource(const Player& p, double sourceX, double sourceY) const;
  // Returns the portion that reached player health. Omitting source coordinates
  // marks environmental/contact damage that a directional ward cannot block.
  int damagePlayer(Player& p, int damage, int cooldown = 30,
                   double sourceX = NAN, double sourceY = NAN,
                   bool bypassCooldown = false);
  void killPlayer(Player& p);
  void crushPlayer(Player& p);
  void updatePlayerVitals(Player& p);
  Player* findPlayer(int id);
  void removePlayer(int id);
  void setPlayerInput(int id, int inputBits, double aimX, double aimY, int selectedTool, uint32_t seq,
                      double moveX, double moveY);
  bool playerCellLiquid(int x, int y);
  double samplePlayerFluidCoverage(const Player& p);
  void integratePlayer(Player& p);
  uint8_t toolMaterial(int tool);
  bool playerBuildOverlapsSelf(Player& p, int ax, int ay, int r);
  bool playerUseTool(Player& p, int ax, int ay, Layer* layer);
  bool isSolidTool(int t);
  void resetPlayerMine(Player& p);
  void resolveMineDrops(Player& p);
  // True if the survival footprint at (cx,cy) still has at least one non-EMPTY
  // cell in `layer` (or both layers when layer is null — dual-mine / RMB path).
  bool mineFootprintHasContent(int cx, int cy, int footprintId, Layer* layer);
  bool mineDisc(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed = true);
  bool mineFootprint(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed = true);
  bool mineFootprintBoth(Player& p, int ax, int ay, bool scaledSpeed = true);
  void playerBeginSolidDraft(Player& p, int tool, int ax, int ay, int btn);
  void playerFinalizeSolidDraft();
  void applyPlayerTools();
  void updatePlayers();
  void stepPlayerOnly(int id);
  void setPlayerState(int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady,
                      double jetpackFuel = 1.0, int jetpackActive = 0);
  int buildPlayerSnapshot();

 private:
  Engine& E;
};
