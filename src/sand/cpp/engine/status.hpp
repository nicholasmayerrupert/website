#pragma once
struct Engine;

class StatusEffectSystem {
 public:
  explicit StatusEffectSystem(Engine& engine) : E(engine) {}
  std::vector<float> snapshot;
  int apply(int actorKind, int actorId, int effect, int durationTicks = 0,
            int strength = 1, int sourceKind = SA_NONE, int sourceId = 0);
  int apply(Player& player, int effect, int ticks = 0, int strength = 1,
            int sourceKind = SA_NONE, int sourceId = 0);
  int apply(Creature& creature, int effect, int ticks = 0, int strength = 1,
            int sourceKind = SA_NONE, int sourceId = 0);
  int remove(int actorKind, int actorId, int effect);
  int cleanse(int actorKind, int actorId, int tags);
  int cleanse(StatusState& state, int tags);
  bool has(const StatusState& state, int effect) const;
  bool harmful(const StatusState& state) const;
  void clear(StatusState& state);
  void rebuild(StatusState& state) const;
  bool valid(const StatusState& state) const;
  void tick(Player& player);
  void tick(Creature& creature);
  int buildSnapshot();

 private:
  Engine& E;
  StatusState* find(int actorKind, int actorId);
  int apply(StatusState& state, int effect, int ticks, int strength,
            int sourceKind, int sourceId, int immunityTags);
  std::pair<int, int> advance(StatusState& state);
  void environment(int actorKind, int actorId, double x, double y, int w, int h);
};
