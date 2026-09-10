#pragma once
struct Engine;
struct Creature;
struct Player;

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
  int use(int player, int bed);
  void wake(Player& player, int result = BR_AWAKE);
  const AdventureBed* find(int id) const;
  void respawnAnchor(Player& player, double* out);
  bool supported(const AdventureBed& bed) const;
 private:
  Engine& E;
  bool eligible(const Creature& resident) const;
  bool danger(const Creature& resident) const;
  bool playerDanger(const Player& player, const AdventureBed& bed) const;
  void furnish(const Creature& resident);
};
