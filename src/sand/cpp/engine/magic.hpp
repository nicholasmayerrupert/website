#pragma once
struct Engine;

class MagicSystem {
 public:
  explicit MagicSystem(Engine& engine) : E(engine) {}
  // Item ownership, socket validation, and immutable recipe compilation.
  bool isWand(const InvSlot& item) const;
  int spellCapacity(const InvSlot& item) const;
  int upgradeCapacity(const InvSlot& item) const;
  void initializeWand(InvSlot& item) const;
  bool validItem(const InvSlot& item) const;
  bool validCast(const SpellCast& cast) const;
  bool socket(int playerId, int slot, int kind, int index, int value);
  SpellCast compileCast(const InvSlot& item, int chargeTicks = 0) const;

  struct WandPose { double shoulderX, shoulderY, handX, handY, dx, dy, tipX, tipY; };
  WandPose wandPose(double x, double y, int facing, double aimX, double aimY,
                    double bodyBob = 0) const;

  // Player resources and actor-clock execution.
  bool continuous(const SpellCast& cast) const;
  void tickMana(Player& player);
  bool spendMana(Player& player, int cost);
  void restoreMana(Player& player, int amount);
  void resetMana(Player& player);
  void cancelCharge(Player& player);
  void apply(Player& player, int previousInput);
  void fire(Player& player);
  void trigger(Projectile& projectile);
  void flush();

 private:
  Engine& E;
  struct Pending {
    SpellCast cast;
    int owner, node;
    double x, y, targetX, targetY;
  };
  std::vector<Pending> pending;
  static SpellConnection connectionForUpgrade(int upgrade);
  int projectileCount(int definition) const;
  void emit(const Pending& spell);
};
