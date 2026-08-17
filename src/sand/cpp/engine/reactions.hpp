#pragma once
// Material reaction catalogue + execution. Pass priority is the deterministic
// order contract; layer policy and effect cadence are validated next to each
// handler.

struct Engine;
class ReactionSystem;

using ReactionPassHandler = void (ReactionSystem::*)(bool effectEnabled,
                                                     bool foregroundActive,
                                                     bool backgroundActive);

enum class ReactionPhase : uint8_t {
  BEFORE_BODY_MOVE,
  ACTIVE_LAYER,
  CROSS_LAYER,
};

enum class ReactionLayerPolicy : uint8_t {
  CURRENT_LAYER,
  LAYER_OVERLAP,
};

enum class ReactionMatchKind : uint8_t {
  ANY,
  MATERIAL,
  FLAG,
  CLASS,
  PROFILE,
};

enum ReactionTopologyMask : uint8_t {
  RTM_LOOSE = 1u << 0,
  RTM_COMPONENT = 1u << 1,
  RTM_BODY = 1u << 2,
  RTM_ANY = RTM_LOOSE | RTM_COMPONENT | RTM_BODY,
};

enum class ReactionTriggerKind : uint8_t {
  SELF,
  CONTACT,
  TARGET,
  LAYER_OVERLAP,
  BODY_CONTACT,
};

enum class ReactionDirection : uint8_t {
  SELF,
  CARDINAL,
  ABOVE,
  BELOW,
  LEFT,
  RIGHT,
  OVERLAP,
};

enum class ReactionEffectOp : uint8_t {
  REPLACE,
  PLACE,
  REMOVE,
  SPAWN_BODY,
  DETACH,
  APPLY_IMPULSE,
};

enum class ReactionSubjectSlot : uint8_t {
  SOURCE,
  TARGET,
};

enum class ReactionTopologyPolicy : uint8_t {
  AUTO,
  PRESERVE_OWNER,
  STATIC,
  BODY,
};

enum class ReactionEffectScope : uint8_t {
  CELL,
  OWNER,
};

enum class ReactionBodyShape : uint8_t {
  NONE,
  SINGLE_CELL,
  DISC,
  BOX,
};

enum class ReactionRetryPolicy : uint8_t {
  NONE,
  CARDINAL_NEIGHBOR,
  LAYER_OVERLAP,
};

struct ReactionSourceDescriptor {
  ReactionMatchKind match;
  uint32_t value;
};

struct GeneratedReactionSelector {
  std::array<uint64_t, 4> materialMask{};
  uint8_t topologyMask = RTM_ANY;
};

struct GeneratedReactionEffect {
  ReactionEffectOp op = ReactionEffectOp::REMOVE;
  ReactionSubjectSlot subject = ReactionSubjectSlot::TARGET;
  ReactionTopologyPolicy topology = ReactionTopologyPolicy::AUTO;
  ReactionEffectScope scope = ReactionEffectScope::CELL;
  uint8_t material = EMPTY;
  ReactionBodyShape shape = ReactionBodyShape::NONE;
  uint8_t radius = 0;
  uint8_t halfWidth = 0;
  uint8_t halfHeight = 0;
  double impulseX = 0;
  double impulseY = 0;
  double impulseNormal = 0;
};

struct GeneratedReactionRule {
  const char* id = nullptr;
  uint32_t channel = 0;
  GeneratedReactionSelector source;
  ReactionTriggerKind trigger = ReactionTriggerKind::SELF;
  GeneratedReactionSelector target;
  ReactionDirection direction = ReactionDirection::SELF;
  ReactionLayerPolicy layerPolicy = ReactionLayerPolicy::CURRENT_LAYER;
  uint8_t priority = 0;
  uint32_t cadence = 1;
  float probability = 1;
  uint32_t minimumAge = 0;
  double minimumImpact = 0;
  std::array<GeneratedReactionEffect, 4> effects{};
  uint8_t effectCount = 0;
};

#include "reactions.generated.hpp"

struct ReactionRetryDescriptor {
  ReactionRetryPolicy policy;
  uint8_t sourceIndex;
  ReactionSourceDescriptor neighbor;
  bool neighborMustNotBelongToBody;
};

struct ReactionPassDescriptor {
  const char* name;
  ReactionPhase phase;
  ReactionLayerPolicy layerPolicy;
  std::array<ReactionSourceDescriptor, 4> sources;
  uint8_t sourceCount;
  uint8_t priority;
  uint8_t effectCadence;
  ReactionRetryDescriptor retry;
  ReactionPassHandler handler;
};

struct ReactionSubject {
  Layer* layer = nullptr;
  int cell = -1;
  uint8_t material = EMPTY;
  uint8_t topology = RTM_LOOSE;
  int ownerIndex = -1;
  int ownerId = -1;
  int localCell = -1;
  Body* body = nullptr;
  uint32_t age = 0;
};

struct ReactionContactEvent {
  Layer* layer = nullptr;
  int sourceBodyId = -1;
  int targetBodyId = -1;
  double sourceX = 0;
  double sourceY = 0;
  double targetX = 0;
  double targetY = 0;
  double impact = 0;
  double normalX = 0;
  double normalY = 0;
};

class ReactionSystem {
 public:
  explicit ReactionSystem(Engine& e);

  void prepareActiveLists();
  void runPhase(ReactionPhase phase);
  void runCrossLayer(bool foregroundActive, bool backgroundActive);
  const std::vector<int>& activeHeatCells() const { return heatCells; }
  static const ReactionPassDescriptor* catalogue(size_t& count);
  static const GeneratedReactionRule* generatedCatalogue(size_t& count);
  static const GeneratedReactionRule* fixtureCatalogue(size_t& count);
  ReactionSubject resolveSubject(Layer& layer, int cell);
  bool executeFixture(size_t fixture, Layer& layer, int sourceCell,
                      int targetCell = -1, double impact = 0,
                      uint32_t sourceAge = UINT32_MAX);
  void beginRigidContacts(Layer& layer);
  void recordRigidContact(const ReactionContactEvent& contact);
  bool acceptsRigidContacts() const {
#ifdef SAND_INVARIANT_CHECKS
    return GENERATED_REACTIONS_HAVE_BODY_CONTACT
      || GENERATED_REACTION_FIXTURES_HAVE_BODY_CONTACT;
#else
    return GENERATED_REACTIONS_HAVE_BODY_CONTACT;
#endif
  }
  size_t rigidContactCount() const { return rigidContactEvents.size(); }

  // Every catalogue row points directly at one uniformly shaped implementation.
  void applyBodyIce(bool effectEnabled, bool foregroundActive,
                    bool backgroundActive);
  void applyFireAndWater(bool effectEnabled, bool foregroundActive,
                         bool backgroundActive);
  void applyAcid(bool effectEnabled, bool foregroundActive,
                 bool backgroundActive);
  void applyLava(bool effectEnabled, bool foregroundActive,
                 bool backgroundActive);
  void applyIce(bool effectEnabled, bool foregroundActive,
                bool backgroundActive);
  void applyGeneratedRules(bool effectEnabled, bool foregroundActive,
                           bool backgroundActive);
  void applyCrossLayerMaterialContact(bool effectEnabled,
                                      bool foregroundActive,
                                      bool backgroundActive);
  void applyGeneratedCrossLayer(bool effectEnabled, bool foregroundActive,
                                bool backgroundActive);

 private:
  const std::vector<int>& activeCells(uint8_t material) const {
    return activeByMaterial[material];
  }
  const std::vector<int>& activeProfileCells(uint8_t profile) const {
    return activeByReactionProfile[profile];
  }
  bool materialMatches(uint8_t material, ReactionMatchKind kind,
                       uint32_t value) const;
  bool selectorMatches(const ReactionSubject& subject,
                       const GeneratedReactionSelector& selector) const;
  bool selectorMatchesCell(Layer& layer, int cell,
                           const GeneratedReactionSelector& selector);
  bool executeRule(const GeneratedReactionRule& rule,
                   const ReactionSubject& source,
                   const ReactionSubject& target,
                   double impact = 0, double normalX = 0,
                   double normalY = 0);
  int targetCellFor(const GeneratedReactionRule& rule,
                    const ReactionSubject& source);
  uint32_t subjectAge(const ReactionSubject& subject) const;
  void maintainPassLiveness(const ReactionPassDescriptor& pass,
                            bool foregroundActive, bool backgroundActive);

  Engine& E;
  std::array<std::vector<int>, TABLE> activeByMaterial;
  std::array<std::vector<int>, MATERIAL_REACTION_PROFILE_COUNT>
    activeByReactionProfile;
  std::array<uint8_t, TABLE> sourceMask{};
  std::array<std::vector<const GeneratedReactionRule*>, TABLE>
    generatedRulesBySource;
  std::vector<uint8_t> generatedSourceMaterials;
  bool hasGeneratedCrossRules = false;
  std::vector<ReactionContactEvent> rigidContactEvents;
  Layer* rigidContactLayer = nullptr;
  std::vector<int> heatCells;
  std::vector<int> mutationRemovedScratch;
  std::vector<int> crossIgniteFg, crossIgniteBg;
  std::vector<std::pair<int, int>> crossBodyFrozenIceFg,
    crossBodyFrozenIceBg;
  std::unordered_set<int> crossFrozenIceFg, crossFrozenIceBg;
};
