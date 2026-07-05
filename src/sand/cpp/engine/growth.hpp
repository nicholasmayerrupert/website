#pragma once
// Plant + mycelium growth (extracted from the Engine in 5e). Trees drink
// adjacent WATER and grow species-shaped wood/leaves; mycelium creeps over
// stone. Owns the per-tree growth scratch (species material selectors set at
// the top of each comp walk). DETERMINISM: heavy shared-rand() user — call
// order is part of the sim contract. Method bodies live in growth_impl.inc.

struct Engine;

class GrowthSystem {
 public:
  explicit GrowthSystem(Engine& e) : E(e) {}

  // Per-tree growth scratch: set at the top of each comp in growPlantComponents
  // so the growth helpers emit the right species materials. OAK defaults keep
  // the original behavior byte-identical.
  uint8_t gGrowType = PT_OAK, gWoodMat = WOOD, gLeafMat = PLANT;

  bool growStraight();
  bool compHasSeed(Comp& comp);
  bool findWaterTouching(Comp& comp, int count, std::vector<int>& picked);
  void refreshPlantCache(Comp& comp);
  int tryGrowWood(Comp& comp, std::unordered_set<int>& reserved);
  bool addWoodIfOpen(int k, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved);
  void thickenTrunkAround(int k, Comp& comp, std::vector<std::pair<int, uint8_t>>& growth, std::unordered_set<int>& reserved);
  int tryGrowLeaf(Comp& comp, std::unordered_set<int>& reserved);
  void growPlantComponents();
  int myceliumNeighbourCount(int k);
  bool myceliumFindStoneTarget(Comp& comp, int& targetK);
  bool myceliumCompHasSpore(Comp& comp);
  bool myceliumCompTouchesStone(Comp& comp);
  void refreshDormantMyceliumComponents();
  void growMyceliumComponents();

 private:
  Engine& E;
};
