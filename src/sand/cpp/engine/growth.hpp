#pragma once
// Plant and mycelium growth. Seeds currently grow without consuming water.
// Growth order consumes shared RNG and is part of deterministic behavior.

struct Engine;

class GrowthSystem {
 public:
  explicit GrowthSystem(Engine& e) : E(e) {}

  // Per-tree growth scratch: set at the top of each comp in growPlantComponents
  // so the growth helpers emit the right species materials.
  uint8_t gSpecies = PT_STANDARD, gWoodMat = WOOD, gLeafMat = PLANT;
  const PlantGrowthProfileDef* gGrowth =
    &PLANT_GROWTH_PROFILES[PGR_STANDARD];
  StampSet gPlantCells;
  bool gWillowGravity = false;
  std::vector<int> gWillowLeader;

  bool growStraight();
  bool findWaterTouching(Comp& comp, int count, std::vector<int>& picked);
  uint32_t plantGrowthSignature(Comp& comp);
  void refreshPlantCache(Comp& comp);
  bool willowGravityLeader(Comp& comp, int seed, std::vector<int>& leader);
  int tryGrowWood(Comp& comp, std::unordered_set<int>& reserved);
  bool plantTargetOpen(int k, const std::unordered_set<int>& reserved);
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
