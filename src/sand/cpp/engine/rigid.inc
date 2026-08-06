  // Free rigid bodies (RigidBodySystem, rigid.hpp) — composed here; method
  // bodies in rigid_impl.inc.
  RigidBodySystem rigid{*this};
  bool planAssemblyBodyPush(const std::unordered_set<int>& assemblyCells, int dir, AssemblyBodyPush& plan) { return rigid.planAssemblyBodyPush(assemblyCells, dir, plan); }
  bool planAssemblyBodyPush(const std::vector<int>& assemblyCells, int dir, AssemblyBodyPush& plan) { return rigid.planAssemblyBodyPush(assemblyCells, dir, plan); }
  void applyAssemblyBodyPush(AssemblyBodyPush& plan) { rigid.applyAssemblyBodyPush(plan); }
  Body* spawnBody(const std::vector<std::pair<int, int>>& cells) { return rigid.spawnBody(cells); }
  Body* spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material) { return rigid.spawnBox(cx, cy, halfW, halfH, material); }
  Body* spawnDisc(int cx, int cy, int radius, uint8_t material) { return rigid.spawnDisc(cx, cy, radius, material); }
  Body* spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density) { return rigid.spawnBodyImpl(cells, material, density); }
  Body* finishSpawn(const std::vector<std::pair<int, int>>& cells, uint8_t material, bool attachTouchingBodies = true) { return rigid.finishSpawn(cells, material, attachTouchingBodies); }
  bool eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty) { return rigid.eraseBodyCellIndex(k, bodyById, dirty); }
  void finishErasedBodies(std::unordered_set<Body*>& dirty, std::vector<int>& cells,
                          bool splitJointBodies = true) {
    rigid.finishErasedBodies(dirty, cells, splitJointBodies);
  }
  void erodeBodies(std::vector<int>& cells) { rigid.erodeBodies(cells); }
  void wakeBody(Body* b) { rigid.wakeBody(b); }
  int localCellAt(Body* b, double wx, double wy) { return rigid.localCellAt(b, wx, wy); }
  bool eraseLocalCell(Body* b, int idx) { return rigid.eraseLocalCell(b, idx); }
  bool canBodyOccupy(uint8_t m, int k, double bodyDensity) { return rigid.canBodyOccupy(m, k, bodyDensity); }
  int bodyFootprintBlocked(Body* b) { return rigid.bodyFootprintBlocked(b); }
  int bodyTerrainBlocked(Body* b) { return rigid.bodyTerrainBlocked(b); }
  bool computeDerived(Body* b, bool preserveWorld) { return rigid.computeDerived(b, preserveWorld); }
  void restampBodiesAfterStream() { rigid.restampBodiesAfterStream(); }
