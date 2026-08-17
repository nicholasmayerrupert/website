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
  MATERIAL,
  FLAG,
  PROFILE,
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

struct SimpleReactionDescriptor {
  const char* name;
  ReactionMatchKind sourceMatch;
  uint32_t sourceValue;
  ReactionMatchKind neighborMatch;
  uint32_t neighborValue;
  uint8_t sourceProduct;
  uint8_t neighborProduct;
  ReactionLayerPolicy layerPolicy;
  uint32_t directionChannel;
  uint8_t priority;
  uint8_t effectCadence;
  float probability;
};

class ReactionSystem {
 public:
  explicit ReactionSystem(Engine& e);

  void prepareActiveLists();
  void runPhase(ReactionPhase phase);
  void runCrossLayer(bool foregroundActive, bool backgroundActive);
  const std::vector<int>& activeHeatCells() const { return heatCells; }
  static const ReactionPassDescriptor* catalogue(size_t& count);
  static const SimpleReactionDescriptor* simpleCatalogue(size_t& count);

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
  void applySimpleRules(bool effectEnabled, bool foregroundActive,
                        bool backgroundActive);
  void applyCrossLayerMaterialContact(bool effectEnabled,
                                      bool foregroundActive,
                                      bool backgroundActive);
  void applySimpleCrossLayer(bool effectEnabled, bool foregroundActive,
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
  void maintainPassLiveness(const ReactionPassDescriptor& pass,
                            bool foregroundActive, bool backgroundActive);

  Engine& E;
  std::array<std::vector<int>, TABLE> activeByMaterial;
  std::array<std::vector<int>, MATERIAL_REACTION_PROFILE_COUNT>
    activeByReactionProfile;
  std::array<uint8_t, TABLE> sourceMask{};
  std::array<std::vector<const SimpleReactionDescriptor*>, TABLE>
    simpleRulesBySource;
  std::vector<uint8_t> simpleSourceMaterials;
  bool hasCrossSimpleRules = false;
  std::vector<int> heatCells;
  std::vector<int> mutationRemovedScratch;
  std::vector<int> crossIgniteFg, crossIgniteBg;
  std::vector<std::pair<int, int>> crossBodyFrozenIceFg,
    crossBodyFrozenIceBg;
  std::unordered_set<int> crossFrozenIceFg, crossFrozenIceBg;
  struct CrossSimpleMutation {
    int cell;
    uint8_t expectedForeground;
    uint8_t expectedBackground;
    uint8_t foregroundProduct;
    uint8_t backgroundProduct;
  };
  std::vector<CrossSimpleMutation> crossSimpleMutations;
};
