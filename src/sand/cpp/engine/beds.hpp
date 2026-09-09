#pragma once
struct Engine;
struct Creature;

struct AdventureBed {
  int id = 0, resident = 0, sleeper = 0, wakeUntil = 0;
  double wx = 0, wy = 0; // center x and mattress top in absolute world cells
  bool seeking = false;
};

class BedSystem {
 public:
  explicit BedSystem(Engine& engine) : E(engine) {}
  std::vector<AdventureBed> beds;
  std::vector<float> snapshot;
  void tick();
  bool rest(Creature& resident);
  const AdventureBed* goal(int resident) const;
  int buildSnapshot();
 private:
  Engine& E;
  bool eligible(const Creature& resident) const;
  bool supported(const AdventureBed& bed) const;
  bool danger(const Creature& resident) const;
  void furnish(const Creature& resident);
};
