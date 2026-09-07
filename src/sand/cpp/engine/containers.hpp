#pragma once
struct Engine;
struct ContentChest { int id, x, y, surface; std::vector<InvSlot> loot; };
struct AdventureChest {
  int id = 0;
  double wx = 0, wy = 0;
  bool opened = false;
  std::vector<InvSlot> loot;
};
class ContainerSystem {
 public:
  explicit ContainerSystem(Engine& e) : E(e) {}
  std::vector<AdventureChest> chests;
  std::vector<float> snapshot, lootSnapshot;
  int activeChest = 0;
  void initialize();
  void tick();
  bool interact(int player, int chest, int slot);
  int buildSnapshot();
  int buildLootSnapshot();
 private:
  Engine& E;
};
