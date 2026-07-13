  // Player characters (PlayerSystem, player.hpp) — composed here; method bodies
  // in player_impl.inc. Shims keep the frequent internal call sites unchanged;
  // the players vector lives on the system (psys.players).
  PlayerSystem psys{*this};
  Player* findPlayer(int id) { return psys.findPlayer(id); }
  int spawnPlayer(double x, double y) { return psys.spawnPlayer(x, y); }
  int spawnPlayerAtSurface(int col) { return psys.spawnPlayerAtSurface(col); }
  void playerSurfaceSpawn(int col, double* out) { psys.playerSurfaceSpawn(col, out); }
  void removePlayer(int id) { psys.removePlayer(id); }
  void setPlayerInput(int id, int inputBits, double aimX, double aimY, int selectedTool, uint32_t seq,
                      double moveX = NAN, double moveY = NAN) {
    psys.setPlayerInput(id, inputBits, aimX, aimY, selectedTool, seq, moveX, moveY);
  }
  bool isSolidForPlayer(uint8_t m) { return psys.isSolidForPlayer(m); }
  void resetPlayerMine(Player& p) { psys.resetPlayerMine(p); }
  bool mineFootprintHasContent(int cx, int cy, int footprintId, Layer* layer) { return psys.mineFootprintHasContent(cx, cy, footprintId, layer); }
  bool mineDisc(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed = true) { return psys.mineDisc(p, ax, ay, layer, scaledSpeed); }
  bool mineFootprint(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed = true) { return psys.mineFootprint(p, ax, ay, layer, scaledSpeed); }
  bool mineFootprintBoth(Player& p, int ax, int ay, bool scaledSpeed = true) { return psys.mineFootprintBoth(p, ax, ay, scaledSpeed); }
  void playerFinalizeSolidDraft() { psys.playerFinalizeSolidDraft(); }
  void applyPlayerTools() { psys.applyPlayerTools(); }
  void updatePlayers() { psys.updatePlayers(); }
  void stepPlayerOnly(int id) { psys.stepPlayerOnly(id); }
  void setPlayerState(int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady) { psys.setPlayerState(id, x, y, vx, vy, facing, grounded, jumpReady); }
