#pragma once
// Local material reactions. Call order consumes shared RNG and is part of the
// deterministic simulation contract.

struct Engine;

class ReactionSystem {
 public:
  explicit ReactionSystem(Engine& e) : E(e) {}

  void prepareActiveLists();
  void applyReactions();
  void applyAcid();
  void applyLava();
  void applyIce();
  void applySalt();

 private:
  Engine& E;
};
