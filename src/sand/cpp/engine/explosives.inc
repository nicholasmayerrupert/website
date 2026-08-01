  // TNT / explosives (ExplosivesSystem, explosives.hpp) — composed here; method
  // bodies in explosives_impl.inc.
  ExplosivesSystem explosives{*this};
  void queueDetonation(int cell, int fuse) { explosives.queueDetonation(cell, fuse); }
  void detonate(int cx, int cy, int radius, double power, int immunePlayerId = 0,
                uint8_t explosiveMaterial = TNT, uint32_t seedSerial = UINT32_MAX,
                uint8_t soundEvent = SE_EXPLOSION,
                double actorDamageScale = 1.0,
                bool bypassActorCooldown = false,
                int immuneCreatureId = 0) {
    explosives.detonate(cx, cy, radius, power, immunePlayerId, explosiveMaterial,
                        seedSerial, soundEvent, actorDamageScale,
                        bypassActorCooldown, immuneCreatureId);
  }
