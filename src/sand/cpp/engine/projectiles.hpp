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
  void applyAcidMortarInput(Player& p, int previousInput);
  void applyClusterLauncherInput(Player& p, int previousInput);
  void applyMinigunInput(Player& p);
  void spawnArrow(Player& p, double charge);
  void spawnBlastRound(Player& p);
  void spawnDynamite(const Creature& thrower, double targetX, double targetY);
  void spawnDynamite(Player& thrower);
  void spawnAcidShell(const Creature& shooter, double targetX, double targetY);
  void spawnAcidShell(Player& shooter);
  void spawnClusterBomb(const Creature& shooter, double targetX, double targetY);
  void spawnClusterBomb(Player& shooter);
  void spawnMinigunRound(const Creature& shooter, double targetX, double targetY);
  void spawnMinigunRound(Player& shooter);
  void spawnBoreBeam(int owner, double ox, double oy, double dx, double dy);
  void updateProjectiles();
  int buildSnapshot();

 private:
  Engine& E;
  void spawnDynamiteAt(int owner, double sx, double sy, double targetX, double targetY);
  void spawnAcidShellAt(int owner, double sx, double sy, double targetX, double targetY);
  void spawnClusterBombAt(int owner, double sx, double sy, double targetX, double targetY);
  void spawnMinigunRoundAt(int owner, double guardX, double guardY,
                           double muzzleX, double muzzleY, double dirX, double dirY);
};
