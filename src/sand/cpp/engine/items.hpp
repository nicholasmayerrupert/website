#pragma once
// Dropped items and cosmetic particles (extracted from the Engine in 5c/5d).
//
// Entities, NOT grid cells. An IT_ITEM is a Starbound-style surface sprite: it
// falls, rests ON TOP of solids, NEVER stays buried (rises out if covered),
// passes freely through other items (no stacking), and MAGNETS toward a nearby
// player until collected. IT_PARTICLE is cosmetic mining debris. They never
// write the grid, never go through the tile store, and use NO rand() — so
// worldgen prefetch byte-identicality and the sim RNG stream are untouched
// (determinism invariant). Method bodies live in items_impl.inc.

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
  int throwItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_OAK);
  void spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life);
  void cullItems();
  void updateItems();
  void pickupItems();
  int buildItemSnapshot();

 private:
  Engine& E;
};
