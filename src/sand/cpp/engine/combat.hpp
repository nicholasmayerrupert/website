#pragma once
struct Engine;
class CombatSystem {
 public:
  explicit CombatSystem(Engine& engine) : E(engine) {}
  void enemyAttack(Creature& creature);
  bool hasCharm(const Player& player, int id) const;
  int defense(const Player& player) const;
  bool canGuard(const Player& player) const;
  void tick(Player& player);
  void apply(Player& player, int previousInput);
  void strike(Player& player, const ContentGear& gear);
  void impact(Player& player, const ContentGear& gear, double cx, double cy, double tx, double ty, double dx, double dy);
 private:
  Engine& E;
};
