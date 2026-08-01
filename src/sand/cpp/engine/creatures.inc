  // Material-aware creatures (CreatureSystem, creatures.hpp). Positions are
  // absolute-world coordinates, so streaming does not remap them.
  CreatureSystem creatures{*this};
  bool damageCreaturesAt(int x, int y, int radius, int damage) { return creatures.damageAtPoint(x, y, radius, damage); }
