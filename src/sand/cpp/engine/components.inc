  // Static components, grounding, and assembly movement.
  ComponentSystem comps{*this};
  void computeGrounded() { comps.computeGrounded(); }
  void ensureGroundedSingleLayer() { comps.ensureGroundedSingleLayer(); }
  void computeGroundedBoth() { comps.computeGroundedBoth(); }
  void moveRigidAssemblies() { comps.moveRigidAssemblies(); }
  void moveCrossLayerBondedAssemblies() { comps.moveCrossLayerBondedAssemblies(); }
  bool removalsKeepGroundingValid(const std::vector<int>& removed) { return comps.removalsKeepGroundingValid(removed); }
  void registerSeededComponents(int colStart, int colEnd) { comps.registerSeededComponents(colStart, colEnd); }
  void registerSeededComponents(int colStart, int colEnd, int rowStart, int rowEnd) { comps.registerSeededComponents(colStart, colEnd, rowStart, rowEnd); }
  void registerRigidCells(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, int yMax, bool iceCache) { comps.registerRigidCells(list, nextId, mat, cells, yMax, iceCache); }
  void registerRigidCellsSplit(std::vector<Comp>& list, int& nextId, uint8_t mat, std::unordered_set<int>& cells, bool iceCache) { comps.registerRigidCellsSplit(list, nextId, mat, cells, iceCache); }
  void registerPlantCells(uint8_t mat, std::unordered_set<int>& cells, int yMax) { comps.registerPlantCells(mat, cells, yMax); }
  void splitPlantAfterErase(std::vector<int>* erased = nullptr, int indexedOffset = -1, bool markGroundDirty = true, bool localConnectivityFastPath = false, bool deferJointRefresh = false) { comps.splitPlantAfterErase(erased, indexedOffset, markGroundDirty, localConnectivityFastPath, deferJointRefresh); }
  void finishPlantErosion(std::vector<int>& erased, bool indexedExact, bool deferJointRefresh = false) { comps.finishPlantErosion(erased, indexedExact, deferJointRefresh); }
  void splitRigidAfterErase(std::vector<Comp>& list, std::vector<int>& erased, int& nextId, bool iceCache, bool markGroundDirty = true, int indexedOffset = -1, bool localConnectivityFastPath = false) { comps.splitRigidAfterErase(list, erased, nextId, iceCache, markGroundDirty, indexedOffset, localConnectivityFastPath); }
  int compCount(Layer& lay) { return comps.compCount(lay); }
  Comp* compById(Layer& lay, int id) { return comps.compById(lay, id); }
  void wakeCellsThatLostGrounding(Layer& lay, const std::vector<uint8_t>& prev) { comps.wakeCellsThatLostGrounding(lay, prev); }
