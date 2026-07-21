#pragma once

struct Engine;

class ProjectileSystem {
 public:
  explicit ProjectileSystem(Engine& e) : E(e) {}
  std::vector<Projectile> projectiles;
  std::vector<float> snapshot;
  int nextId = 1;

  void applyBowInput(Player& p, int previousInput);
  void spawnArrow(Player& p, double charge);
  void updateProjectiles();
  int buildSnapshot();

 private:
  Engine& E;
};
