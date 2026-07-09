#pragma once
// Terraria-like player characters (extracted from the Engine in 5d):
// deterministic AABB platformer physics over the cell grid (NO RNG — a fixed
// input stream + seed replays identically, the multiplayer foundation), the
// player-mediated tool policy (reach, cooldown, mining state machine, solid
// drafts), spawn/remove/input plumbing, and the ABI snapshot. Owns the
// players vector. Method bodies live in player_impl.inc.

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
  bool rowSolid(double px, int w, int row);
  bool colSolid(double py, int h, int col);
  int buryDepth(const Player& p);
  bool edgeBlockedX(double px, double py, int w, int h, int dir);
  bool tryMoveX(Player& p, double d, int bury);
  bool moveDown(Player& p, double d);
  bool moveUp(Player& p, double d);
  bool tryMoveY(Player& p, double d);
  int spawnPlayer(double x, double y);
  void playerSurfaceSpawn(int col, double* out);
  int spawnPlayerAtSurface(int col);
  Player* findPlayer(int id);
  void removePlayer(int id);
  void setPlayerInput(int id, int inputBits, double aimX, double aimY, int selectedTool, uint32_t seq);
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
  void setPlayerState(int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady);
  int buildPlayerSnapshot();

 private:
  Engine& E;
};
