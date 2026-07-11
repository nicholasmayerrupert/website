  // Dropped items + particles (ItemSystem, items.hpp) — composed here; method
  // bodies in items_impl.inc. Shims keep the frequent internal call sites
  // (mining drops, cursor throws, blast debris, the step loop) unchanged.
  ItemSystem itemsys{*this};
  int spawnItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_OAK) { return itemsys.spawnItem(mat, count, px, py, vx, vy, plantType); }
  int throwItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_OAK) { return itemsys.throwItem(mat, count, px, py, vx, vy, plantType); }
  void spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life) { itemsys.spawnParticle(mat, px, py, vx, vy, life); }
  void updateItems() { itemsys.updateItems(); }
