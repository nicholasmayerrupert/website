#pragma once
// Batched, topology-aware grid edits.
//
// Component/body membership is part of a cell's state. Callers use this batch
// instead of pairing raw grid writes with ad-hoc split/register cleanup. Loose
// products, new static components, and attachment to an existing component are
// deliberately separate operations so a structural product cannot become an
// orphaned grid pixel by accident.

struct Engine;

class CellMutationBatch {
 public:
  CellMutationBatch(Engine& engine, std::vector<int>& removedScratch);
  ~CellMutationBatch();

  // Replace with EMPTY or an MP_PAINT material. Returns false for every
  // MP_STRUCTURE product; callers must choose a topology-aware operation.
  bool replaceLoose(int cell, uint8_t material);
  bool erase(int cell) { return replaceLoose(cell, EMPTY); }

  // Route a product through its generated placement policy. FREE_RIGID is
  // intentionally left to ReactionTransaction because it needs a body shape.
  bool replaceAuto(int cell, uint8_t material);

  // Keep structural membership when both the existing owner and product can
  // represent it. Loose products still erode the owner through replaceAuto.
  bool replacePreservingOwner(int cell, uint8_t material);

  // Create a new static component island during commit.
  bool replaceWithStatic(int cell, uint8_t material);

  // Add or replace a product cell in one existing component. Cross-component,
  // body-owned, and mixed plant/non-plant ownership is rejected before writes.
  bool replaceAttached(int cell, uint8_t material, int componentIndex);

  const std::vector<int>& removedStructural() const { return removed; }
  bool empty() const { return !changed; }

  // Ordinary tool/runtime edits: repair bodies, split every touched component,
  // then register newly-created static islands.
  void commitGeneral();

  // Optimized reaction epilogues. These retain the established grounding/cache
  // behavior while sharing the safe mutation front-end.
  void commitPlantErosion(bool indexedExact, bool deferJointRefresh);
  void commitPlantSplit(bool markGroundDirty = true,
                        bool deferJointRefresh = false);
  void commitRigidErosion(bool iceCache, bool markGroundDirty = true,
                          int indexedOffset = -1,
                          ConnectivitySplitMode splitMode = ConnectivitySplitMode::FULL);

  // A complex handler (acid) owns its specialized component repair. This only
  // finalizes body edits and leaves removedStructural() available to the caller.
  void commitBodiesOnly();

 private:
  bool replaceImpl(int cell, uint8_t material, bool queueStatic);
  int componentOwnerIndex(int cell);
  bool hasStaticMembership(int cell);
  void detachOldTopology(int cell, uint8_t oldMaterial);
  void compactCanceledRemovals();
  void registerCreatedStatic();

  Engine& E;
#ifdef SAND_INVARIANT_CHECKS
  Layer* layer;
#endif
  std::vector<int>& removed;
  std::vector<std::pair<int, uint8_t>> createdStatic;
  std::unordered_map<int, Body*> bodyById;
  std::unordered_set<Body*> dirtyBodies;
  std::unordered_set<int> canceledRemovals;
  std::unordered_map<int, uint8_t> removedMaterialByCell;
  std::unordered_map<int, uint8_t> attachmentRoleByComponent;
  bool staticMembershipBuilt = false;
  int32_t staticMembershipGeneration = 0;
  bool changed = false;
  bool removedPlantTopology = false;
  bool removedNonPlantTopology = false;
  bool finishedBodies = false;
  bool committed = false;
};
