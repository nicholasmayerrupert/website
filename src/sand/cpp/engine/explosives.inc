  // TNT / explosives (ExplosivesSystem, explosives.hpp) — composed here; method
  // bodies in explosives_impl.inc.
  ExplosivesSystem explosives{*this};
  void applyExplosives() { explosives.applyExplosives(); }
  void queueDetonation(int cell, int fuse) { explosives.queueDetonation(cell, fuse); }
  void detonate(int cx, int cy, int radius, double power) { explosives.detonate(cx, cy, radius, power); }
