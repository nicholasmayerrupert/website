  // Dropped items and cosmetic particles.
  ItemSystem itemsys{*this};
  int spawnItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_STANDARD) { return itemsys.spawnItem(mat, count, px, py, vx, vy, plantType); }
  int throwItem(uint8_t mat, int count, double px, double py, double vx, double vy, uint8_t plantType = PT_STANDARD) { return itemsys.throwItem(mat, count, px, py, vx, vy, plantType); }
  void spawnParticle(uint8_t mat, double px, double py, double vx, double vy, int life) { itemsys.spawnParticle(mat, px, py, vx, vy, life); }
