  // Material reactions (ReactionSystem, reactions.hpp) — composed here; method
  // bodies in reactions_impl.inc. Shims keep the step-pipeline call sites.
  ReactionSystem reactions{*this};
  void prepareReactionLists() { reactions.prepareActiveLists(); }
  void applyReactions() { reactions.applyReactions(); }
  void applyAcid() { reactions.applyAcid(); }
  void applyLava() { reactions.applyLava(); }
  void applyIce() { reactions.applyIce(); }
  void applySalt() { reactions.applySalt(); }
