#pragma once
struct Engine;
enum EnemyMove : uint8_t { EM_MELEE, EM_LUNGE, EM_SLAM, EM_RUNE, EM_ARROW, EM_FROST_STREAM, EM_ICE_SHARD, EM_FIRE_STREAM };
struct EnemyAttack {
  EnemyMove move;
  int rune, windup, duration, recovery, reach, damage;
};
inline const EnemyAttack* enemyAttackProfile(uint8_t species, int pattern = 0) {
  if (species == CS_FROST_GIANT && pattern == 1) {
    static constexpr EnemyAttack slam{EM_SLAM, 0, 32, 30, 62, 34, 32}; return &slam;
  }
  if (species == CS_FROST_GIANT && pattern == 2) {
    static constexpr EnemyAttack shard{EM_ICE_SHARD, 309, 44, 24, 62, 88, 30}; return &shard;
  }
  if (species == CS_BONE_DINOSAUR && pattern == 1) {
    static constexpr EnemyAttack rush{EM_LUNGE, 0, 29, 30, 48, 46, 28}; return &rush;
  }
  if (species == CS_BONE_DINOSAUR && pattern == 2) {
    static constexpr EnemyAttack breath{EM_FIRE_STREAM, 300, 40, 96, 71, 90, 9}; return &breath;
  }
  if (species == CS_FEN_WISP && pattern == 1) {
    static constexpr EnemyAttack choir{EM_RUNE, 306, 26, 18, 62, 58, 14}; return &choir;
  }
  switch (species) {
#define SAND_ENEMY_ATTACK(SPECIES, MOVE, RUNE, WINDUP, ACTIVE, RECOVERY, REACH, DAMAGE) \
    case SPECIES: { static constexpr EnemyAttack attack{MOVE, RUNE, WINDUP, ACTIVE, RECOVERY, REACH, DAMAGE}; return &attack; }
#include "enemy_attacks.def"
#undef SAND_ENEMY_ATTACK
    default: return nullptr;
  }
}
class CombatSystem {
 public:
  explicit CombatSystem(Engine& engine) : E(engine) {}
  void enemyAttack(Creature& creature);
  void creatureAttack(Creature& creature, const EnemyAttack& attack);
  void enemyTerrainImpact(double x, double y, int radius, uint8_t material, double ringRadius = 0);
  bool hasCharm(const Player& player, int id) const;
  int defense(const Player& player) const;
  bool canGuard(const Player& player) const;
  void tick(Player& player);
  void apply(Player& player, int previousInput);
  void strike(Player& player, const ContentGear& gear);
  void impact(Player& player, const ContentGear& gear, double cx, double cy, double tx, double ty, double dx, double dy, int spellDamage = -1);
 private:
  Engine& E;
};
