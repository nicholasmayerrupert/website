#pragma once
// Dropped items and cosmetic particles are non-grid actors. They never use the
// shared RNG or enter the chunk store; world shifts remap their local positions.

struct Engine;

class ItemSystem {
 public:
  explicit ItemSystem(Engine& e) : E(e) {}

  std::vector<Item> items;
  int nextItemId = 1;
  std::vector<float> snapshot; // packed [IS_STRIDE] floats per item (ABI reads it)

  int itemCell(const Item& it);
  bool itemGridSolid(int x, int y);
  bool itemCellLiquidAt(int x, int y);
  void moveItemY(Item& it, bool floats = false);
  void moveItemX(Item& it);
  void unburyItem(Item& it);
  void floatItem(Item& it);
  bool seedItemCanPlant(const Item& it, int& x, int& y);
  Player* magnetTarget(const Item& it);
  void ensureItemCapacity();
  int spawnItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_OAK);
  int spawnStack(const InvSlot& stack, double px, double py, double vx, double vy,
                 int pickupDelay = IT_PICKUP_DELAY, bool coagulate = true);
  int throwItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_OAK);
  void spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life);
  void cullItems();
  void updateItems();
  void pickupItems();
  int buildItemSnapshot();

 private:
  Engine& E;
};
