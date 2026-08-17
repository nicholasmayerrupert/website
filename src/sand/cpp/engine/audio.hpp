#pragma once
// Semantic audio events + nearby ambience sampling.
//
// Simulation systems report WHAT happened through emit(); this subsystem owns
// coalescing, bounded storage, absolute-world coordinates, and the packed ABI
// snapshot. The browser owns HOW an event sounds. Continuous ambience is sampled
// from the presentation mirror around the listener, never emitted per moving cell.

struct Engine;

struct SoundEventRecord {
  uint8_t type = SE_PLACE;
  float x = 0, y = 0, intensity = 0;
  uint8_t material = EMPTY, layer = 0;
  int tick = 0;
};

class AudioSystem {
 public:
  explicit AudioSystem(Engine& e) : E(e) { events.reserve(MAX_EVENTS); }

  void emit(uint8_t type, double localX, double localY, double intensity,
            uint8_t material = EMPTY, int layer = -1);
  void beginRegionalPass();
  void noteFluidFall(uint8_t material, int x, int y, int fallCells);
  void notePowderMove(uint8_t material, int x, int y, int moveCells = 1);
  void noteAcidDissolve(int x, int y);
  void flushRegionalPass();
  int buildAndDrainSnapshot();
  float* snapshotData() { return snapshot.data(); }
  void sampleAmbience(double localX, double localY, int radius, float* out);

 private:
  static const int MAX_EVENTS = SOUND_EVENT_MAX_RECORDS;
  static const int AMBIENCE_GROUPS = AMBIENCE_GROUP_COUNT;
  static const int MAX_REGIONAL_EVENTS = 24;

  struct RegionalEvent {
    uint8_t type = SE_FLUID_FALL, material = EMPTY, layer = 0;
    double x = 0, y = 0, weight = 0;
  };

  void noteRegional(uint8_t type, uint8_t material, int x, int y,
                    double weight, double mergeRadius);

  Engine& E;
  std::vector<SoundEventRecord> events;
  std::vector<float> snapshot;
  std::array<RegionalEvent, MAX_REGIONAL_EVENTS> regionalEvents;
  int regionalEventCount = 0;
};
