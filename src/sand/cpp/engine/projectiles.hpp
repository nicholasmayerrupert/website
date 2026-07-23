#pragma once

struct Engine;

class ProjectileSystem {
 public:
  explicit ProjectileSystem(Engine& e) : E(e) {}
  std::vector<Projectile> projectiles;
  std::vector<float> snapshot;
  int nextId = 1;

  void applyBowInput(Player& p, int previousInput);
  void applyBlastGunInput(Player& p);
  void applyDynamiteSatchelInput(Player& p, int previousInput);
  void applyBoreCannonInput(Player& p, int previousInput);
  void spawnArrow(Player& p, double charge);
  void spawnBlastRound(Player& p);
  void spawnDynamite(const Creature& thrower, double targetX, double targetY);
  void spawnDynamite(Player& thrower);
  void updateProjectiles();
  int buildSnapshot();

 private:
  Engine& E;
  void spawnDynamiteAt(int owner, double sx, double sy, double targetX, double targetY);
};
