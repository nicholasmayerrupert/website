#pragma once
// Authoritative environmental weather. Presentation policy (sky tint, clouds,
// and cosmetic precipitation) stays in JavaScript; this subsystem owns only
// deterministic effects on the simulated world.

struct Engine;

class WeatherSystem {
 public:
  explicit WeatherSystem(Engine& e) : E(e) {}

  void initialize(uint32_t seed) { sourceSeed = seed; }
  void setKind(int value);
  WeatherKind getKind() const { return kind; }
  void update();

 private:
  struct WeatherProfile;
  using UpdateHandler = void (WeatherSystem::*)(const WeatherProfile&);

  struct WeatherProfile {
    WeatherKind kind;
    UpdateHandler update;
    uint8_t precipitationMaterial;
    uint8_t cadence;
    uint8_t dropsPerCadence;
    uint8_t attemptsPerDrop;
    uint16_t maxSpawnSpan;
    uint8_t surfaceClearance;
    bool earthOnly;
  };

  static const WeatherProfile& profileFor(WeatherKind kind);
  void updatePrecipitation(const WeatherProfile& profile);

  Engine& E;
  WeatherKind kind = WK_CLEAR;
  int lastCadenceBucket = -1;
  uint32_t sourceSeed = 0;
  std::vector<int> removedScratch;
};
