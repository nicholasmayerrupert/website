#pragma once
// Material reactions (extracted from the Engine in 5e): fire/steam/ignition,
// acid dissolving (with its grounding-cache fast path), lava quench/harden,
// ice freeze/melt, and salt. Runs after growth/rigid movement inside each
// layer step; owns local transformations only, never broad movement order.
//
// DETERMINISM: these draw from the Engine's SHARED rand() stream — call order
// is part of the sim contract (the bench checksum enforces it). Method bodies
// live in reactions_impl.inc.

struct Engine;

class ReactionSystem {
 public:
  explicit ReactionSystem(Engine& e) : E(e) {}

  void applyReactions();
  void applyAcid();
  void applyLava();
  void applyIce();
  void applySalt();

 private:
  Engine& E;
};
