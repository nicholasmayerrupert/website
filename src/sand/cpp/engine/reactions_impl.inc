// Material reactions.
//
// Runs after growth/rigid movement inside each layer step. This file owns
// local transformations such as water/fire steam, ignition, freezing/melting,
// acid erosion, and lava cooling. It should not own broad movement order.
static constexpr ReactionRetryDescriptor NO_REACTION_RETRY = {
  ReactionRetryPolicy::NONE, 0,
  {ReactionMatchKind::MATERIAL, EMPTY}, false,
};
static constexpr ReactionPassDescriptor REACTION_PASS_CATALOGUE[] = {
  {"body ice", ReactionPhase::BEFORE_BODY_MOVE,
   ReactionLayerPolicy::CURRENT_LAYER, {{}}, 0, 10, 1,
   NO_REACTION_RETRY, &ReactionSystem::applyBodyIce},
  {"fire and water", ReactionPhase::ACTIVE_LAYER,
   ReactionLayerPolicy::CURRENT_LAYER,
   {{{ReactionMatchKind::MATERIAL, WATER}, {ReactionMatchKind::PROFILE, MRP_FIRE}}},
   2, 10, 1, NO_REACTION_RETRY,
   &ReactionSystem::applyFireAndWater},
  {"acid", ReactionPhase::ACTIVE_LAYER,
   ReactionLayerPolicy::CURRENT_LAYER,
   {{{ReactionMatchKind::PROFILE, MRP_ACID}}}, 1,
   20, ACID_REACT_INTERVAL,
   {ReactionRetryPolicy::CARDINAL_NEIGHBOR, 0,
    {ReactionMatchKind::FLAG, MF_DISSOLVABLE}, true},
   &ReactionSystem::applyAcid},
  {"lava", ReactionPhase::ACTIVE_LAYER,
   ReactionLayerPolicy::CURRENT_LAYER,
   {{{ReactionMatchKind::PROFILE, MRP_LAVA}}}, 1, 30, 1,
   NO_REACTION_RETRY, &ReactionSystem::applyLava},
  {"ice", ReactionPhase::ACTIVE_LAYER,
   ReactionLayerPolicy::CURRENT_LAYER, {{}}, 0, 40, 1,
   NO_REACTION_RETRY, &ReactionSystem::applyIce},
  {"simple material rules",
   ReactionPhase::ACTIVE_LAYER, ReactionLayerPolicy::CURRENT_LAYER,
   {{}}, 0, 50, 1, NO_REACTION_RETRY,
   &ReactionSystem::applySimpleRules},
  {"cross-layer material contact",
   ReactionPhase::CROSS_LAYER, ReactionLayerPolicy::LAYER_OVERLAP,
   {{}}, 0, 10, 1, NO_REACTION_RETRY,
   &ReactionSystem::applyCrossLayerMaterialContact},
  {"simple cross-layer rules",
   ReactionPhase::CROSS_LAYER, ReactionLayerPolicy::LAYER_OVERLAP,
   {{}}, 0, 20, 1, NO_REACTION_RETRY,
   &ReactionSystem::applySimpleCrossLayer},
};

// Simple pair rules live entirely in this catalogue and match exact ids,
// generated reaction profiles, or trait flags. Rules for the same source are
// priority ordered. Complex topology/RNG behavior uses optimized custom passes
// registered in REACTION_PASS_CATALOGUE above.
static constexpr SimpleReactionDescriptor SIMPLE_REACTION_CATALOGUE[] = {
  {"salt dissolves in water",
   ReactionMatchKind::MATERIAL, SALT,
   ReactionMatchKind::MATERIAL, WATER,
   BRINE, BRINE, ReactionLayerPolicy::CURRENT_LAYER,
   0x5A1701u, 10, 1, 1.0f},
  {"salt melts snow",
   ReactionMatchKind::MATERIAL, SALT,
   ReactionMatchKind::MATERIAL, SNOW,
   BRINE, BRINE, ReactionLayerPolicy::CURRENT_LAYER,
   0x5A1702u, 20, 1, 1.0f},
};

static constexpr bool reactionNamesEqual(const char* a, const char* b) {
  if (a == nullptr || b == nullptr) return a == b;
  for (size_t i = 0;; i++) {
    if (a[i] != b[i]) return false;
    if (a[i] == '\0') return true;
  }
}

template <size_t N>
static constexpr bool validReactionPassCatalogue(
    const ReactionPassDescriptor (&catalogue)[N]) {
  for (size_t i = 0; i < N; i++) {
    const auto& pass = catalogue[i];
    if (pass.effectCadence == 0 || pass.sourceCount > 4
        || pass.handler == nullptr || pass.name == nullptr
        || pass.name[0] == '\0') return false;
    if (pass.phase != ReactionPhase::BEFORE_BODY_MOVE
        && pass.phase != ReactionPhase::ACTIVE_LAYER
        && pass.phase != ReactionPhase::CROSS_LAYER) return false;
    if (pass.retry.policy != ReactionRetryPolicy::NONE
        && pass.retry.policy != ReactionRetryPolicy::CARDINAL_NEIGHBOR
        && pass.retry.policy != ReactionRetryPolicy::LAYER_OVERLAP) return false;
    bool retries = pass.retry.policy != ReactionRetryPolicy::NONE;
    if ((pass.effectCadence > 1) != retries) return false;
    for (uint8_t source = 0; source < pass.sourceCount; source++) {
      const auto& selector = pass.sources[source];
      if ((selector.match != ReactionMatchKind::MATERIAL
           && selector.match != ReactionMatchKind::FLAG
           && selector.match != ReactionMatchKind::PROFILE)
          || (selector.match == ReactionMatchKind::MATERIAL
           && !isMaterialId((int)selector.value))
          || (selector.match == ReactionMatchKind::FLAG
              && selector.value == 0)
          || (selector.match == ReactionMatchKind::PROFILE
              && (selector.value == MRP_NONE
                  || selector.value >= MATERIAL_REACTION_PROFILE_COUNT)))
        return false;
      for (uint8_t earlier = 0; earlier < source; earlier++)
        if (pass.sources[earlier].match == selector.match
            && pass.sources[earlier].value == selector.value) return false;
    }
    if (retries) {
      const auto& neighbor = pass.retry.neighbor;
      if (pass.retry.sourceIndex >= pass.sourceCount
          || (neighbor.match != ReactionMatchKind::MATERIAL
              && neighbor.match != ReactionMatchKind::FLAG
              && neighbor.match != ReactionMatchKind::PROFILE)
          || (neighbor.match == ReactionMatchKind::MATERIAL
              && !isMaterialId((int)neighbor.value))
          || (neighbor.match == ReactionMatchKind::FLAG
              && neighbor.value == 0)
          || (neighbor.match == ReactionMatchKind::PROFILE
              && (neighbor.value == MRP_NONE
                  || neighbor.value >= MATERIAL_REACTION_PROFILE_COUNT)))
        return false;
      if (pass.retry.policy == ReactionRetryPolicy::CARDINAL_NEIGHBOR
          && pass.layerPolicy != ReactionLayerPolicy::CURRENT_LAYER) return false;
      if (pass.retry.policy == ReactionRetryPolicy::LAYER_OVERLAP
          && pass.layerPolicy != ReactionLayerPolicy::LAYER_OVERLAP) return false;
    }
    if (pass.phase == ReactionPhase::CROSS_LAYER
        && pass.layerPolicy != ReactionLayerPolicy::LAYER_OVERLAP) return false;
    if (pass.phase != ReactionPhase::CROSS_LAYER
        && pass.layerPolicy != ReactionLayerPolicy::CURRENT_LAYER) return false;
    for (size_t j = 0; j < i; j++) {
      const auto& earlier = catalogue[j];
      if (reactionNamesEqual(earlier.name, pass.name)
          || earlier.handler == pass.handler) return false;
      if (earlier.phase == pass.phase
          && earlier.priority >= pass.priority) return false;
    }
  }
  return true;
}

static constexpr bool validSimpleReactionDescriptor(
    const SimpleReactionDescriptor& rule) {
  if (rule.name == nullptr || !isMaterialId(rule.sourceProduct)
      || !isMaterialId(rule.neighborProduct)
      || rule.effectCadence == 0 || rule.directionChannel == 0
      || rule.probability <= 0.0f || rule.probability > 1.0f) return false;
  if (rule.layerPolicy != ReactionLayerPolicy::CURRENT_LAYER
      && rule.layerPolicy != ReactionLayerPolicy::LAYER_OVERLAP) return false;
  if ((MAT_PLACEMENT[rule.sourceProduct] == MP_STRUCTURE
       && MAT_KIND[rule.sourceProduct] != K_COMPONENT)
      || (MAT_PLACEMENT[rule.neighborProduct] == MP_STRUCTURE
          && MAT_KIND[rule.neighborProduct] != K_COMPONENT)) return false;
  if (rule.sourceMatch != ReactionMatchKind::MATERIAL
      && rule.sourceMatch != ReactionMatchKind::FLAG
      && rule.sourceMatch != ReactionMatchKind::PROFILE) return false;
  if (rule.neighborMatch != ReactionMatchKind::MATERIAL
      && rule.neighborMatch != ReactionMatchKind::FLAG
      && rule.neighborMatch != ReactionMatchKind::PROFILE) return false;
  if (rule.sourceMatch == ReactionMatchKind::MATERIAL
      && !isMaterialId((int)rule.sourceValue)) return false;
  if (rule.neighborMatch == ReactionMatchKind::MATERIAL
      && !isMaterialId((int)rule.neighborValue)) return false;
  if (rule.sourceMatch == ReactionMatchKind::FLAG && rule.sourceValue == 0)
    return false;
  if (rule.neighborMatch == ReactionMatchKind::FLAG && rule.neighborValue == 0)
    return false;
  if (rule.sourceMatch == ReactionMatchKind::PROFILE
      && (rule.sourceValue == MRP_NONE
          || rule.sourceValue >= MATERIAL_REACTION_PROFILE_COUNT)) return false;
  if (rule.neighborMatch == ReactionMatchKind::PROFILE
      && (rule.neighborValue == MRP_NONE
          || rule.neighborValue >= MATERIAL_REACTION_PROFILE_COUNT)) return false;
  return true;
}

static constexpr bool reactionSelectorMatchesMaterial(
    ReactionMatchKind match, uint32_t value, uint8_t material) {
  return match == ReactionMatchKind::MATERIAL
    ? value == material
    : match == ReactionMatchKind::FLAG
      ? (MAT_FLAGS[material] & value) != 0
      : match == ReactionMatchKind::PROFILE
        && MAT_REACTION_PROFILE[material] == value;
}

static constexpr bool reactionSelectorsOverlap(
    ReactionMatchKind aMatch, uint32_t aValue,
    ReactionMatchKind bMatch, uint32_t bValue) {
  for (uint8_t material : DEFINED_MATERIAL_IDS)
    if (reactionSelectorMatchesMaterial(aMatch, aValue, material)
        && reactionSelectorMatchesMaterial(bMatch, bValue, material))
      return true;
  return false;
}

static constexpr bool simpleReactionNeedsRetry(
    const SimpleReactionDescriptor& rule) {
  return rule.effectCadence > 1 || rule.probability < 1.0f;
}

static constexpr bool validSimpleReactionPair(
    const SimpleReactionDescriptor& earlier,
    const SimpleReactionDescriptor& rule) {
  if (reactionNamesEqual(earlier.name, rule.name)
      || earlier.directionChannel == rule.directionChannel) return false;
  if (earlier.layerPolicy == rule.layerPolicy
      && earlier.sourceMatch == rule.sourceMatch
      && earlier.sourceValue == rule.sourceValue
      && earlier.neighborMatch == rule.neighborMatch
      && earlier.neighborValue == rule.neighborValue) return false;
  if (earlier.layerPolicy == rule.layerPolicy
      && earlier.priority == rule.priority
      && reactionSelectorsOverlap(
           earlier.sourceMatch, earlier.sourceValue,
           rule.sourceMatch, rule.sourceValue)) return false;
  return true;
}

template <size_t N>
static constexpr bool validSimpleReactionCatalogue(
    const SimpleReactionDescriptor (&catalogue)[N]) {
  for (size_t i = 0; i < N; i++) {
    const auto& rule = catalogue[i];
    if (!validSimpleReactionDescriptor(rule)) return false;
    for (size_t j = 0; j < i; j++) {
      if (!validSimpleReactionPair(catalogue[j], rule)) return false;
    }
  }
  return true;
}

static constexpr ReactionPassDescriptor CADENCED_PASS_FIXTURE[] = {
  {"cadenced pass contract", ReactionPhase::ACTIVE_LAYER,
   ReactionLayerPolicy::CURRENT_LAYER,
   {{{ReactionMatchKind::PROFILE, MRP_ACID}}}, 1, 1, 2,
   {ReactionRetryPolicy::CARDINAL_NEIGHBOR, 0,
    {ReactionMatchKind::FLAG, MF_DISSOLVABLE}, true},
   &ReactionSystem::applyAcid},
};
static constexpr ReactionPassDescriptor CADENCED_CROSS_PASS_FIXTURE[] = {
  {"cadenced cross-layer contract", ReactionPhase::CROSS_LAYER,
   ReactionLayerPolicy::LAYER_OVERLAP,
   {{{ReactionMatchKind::MATERIAL, SALT}}}, 1, 1, 2,
   {ReactionRetryPolicy::LAYER_OVERLAP, 0,
    {ReactionMatchKind::MATERIAL, WATER}, false},
   &ReactionSystem::applySimpleCrossLayer},
};
static constexpr ReactionPassDescriptor UNSAFE_CADENCED_PASS_FIXTURE[] = {
  {"unsafe cadence contract", ReactionPhase::CROSS_LAYER,
   ReactionLayerPolicy::LAYER_OVERLAP, {{}}, 0, 1, 2,
   NO_REACTION_RETRY,
   &ReactionSystem::applySimpleCrossLayer},
};
static constexpr SimpleReactionDescriptor CROSS_LAYER_DESCRIPTOR_FIXTURE = {
  "cross-layer descriptor contract",
  ReactionMatchKind::MATERIAL, SALT,
  ReactionMatchKind::MATERIAL, WATER,
  BRINE, BRINE, ReactionLayerPolicy::LAYER_OVERLAP,
  0xC2055A17u, 1, 2, 0.5f,
};
static constexpr SimpleReactionDescriptor CATALYST_DESCRIPTOR_FIXTURE = {
  "catalyst descriptor contract",
  ReactionMatchKind::MATERIAL, SALT,
  ReactionMatchKind::MATERIAL, WATER,
  SALT, BRINE, ReactionLayerPolicy::CURRENT_LAYER,
  0xCA7A1157u, 1, 1, 1.0f,
};
static constexpr SimpleReactionDescriptor UNSAFE_BODY_PRODUCT_FIXTURE = {
  "body product contract",
  ReactionMatchKind::MATERIAL, SALT,
  ReactionMatchKind::MATERIAL, WATER,
  RIGID, BRINE, ReactionLayerPolicy::CURRENT_LAYER,
  0xB0D15A17u, 1, 1, 1.0f,
};
static constexpr SimpleReactionDescriptor DISJOINT_PRIORITY_FIXTURE[] = {
  {"disjoint salt source", ReactionMatchKind::MATERIAL, SALT,
   ReactionMatchKind::MATERIAL, WATER, BRINE, BRINE,
   ReactionLayerPolicy::CURRENT_LAYER, 0xD15001u, 7, 1, 1.0f},
  {"disjoint snow source", ReactionMatchKind::MATERIAL, SNOW,
   ReactionMatchKind::MATERIAL, WATER, BRINE, BRINE,
   ReactionLayerPolicy::CURRENT_LAYER, 0xD15002u, 7, 1, 1.0f},
};
static constexpr SimpleReactionDescriptor OVERLAPPING_PRIORITY_FIXTURE[] = {
  {"overlapping salt and water", ReactionMatchKind::MATERIAL, SALT,
   ReactionMatchKind::MATERIAL, WATER, BRINE, BRINE,
   ReactionLayerPolicy::CURRENT_LAYER, 0x0A1501u, 7, 1, 1.0f},
  {"overlapping salt and snow", ReactionMatchKind::MATERIAL, SALT,
   ReactionMatchKind::MATERIAL, SNOW, BRINE, BRINE,
   ReactionLayerPolicy::CURRENT_LAYER, 0x0A1502u, 7, 1, 1.0f},
};

static_assert(validReactionPassCatalogue(REACTION_PASS_CATALOGUE),
              "reaction passes need unique names, handlers, and phase priority");
static_assert(validReactionPassCatalogue(CADENCED_PASS_FIXTURE),
              "cadenced passes must declare matched-source retry semantics");
static_assert(validReactionPassCatalogue(CADENCED_CROSS_PASS_FIXTURE),
              "cross-layer cadence uses overlap retry semantics");
static_assert(!validReactionPassCatalogue(UNSAFE_CADENCED_PASS_FIXTURE),
              "cadenced passes cannot silently skip matched-source retries");
static_assert(validSimpleReactionCatalogue(SIMPLE_REACTION_CATALOGUE),
              "simple reactions contain an invalid or duplicate descriptor");
static_assert(validSimpleReactionDescriptor(CROSS_LAYER_DESCRIPTOR_FIXTURE),
              "cross-layer simple descriptors must satisfy the registry contract");
static_assert(validSimpleReactionDescriptor(CATALYST_DESCRIPTOR_FIXTURE),
              "catalysts may preserve their source material");
static_assert(simpleReactionNeedsRetry(CROSS_LAYER_DESCRIPTOR_FIXTURE),
              "delayed and probabilistic rules must retry while matched");
static_assert(!validSimpleReactionDescriptor(UNSAFE_BODY_PRODUCT_FIXTURE),
              "body-only products cannot use the declarative topology path");
static_assert(validSimpleReactionCatalogue(DISJOINT_PRIORITY_FIXTURE),
              "disjoint source selectors may share a priority");
static_assert(!validSimpleReactionCatalogue(OVERLAPPING_PRIORITY_FIXTURE),
              "overlapping source selectors need deterministic priority");

ReactionSystem::ReactionSystem(Engine& engine) : E(engine) {
  sourceMask.fill(0);
  for (const auto& pass : REACTION_PASS_CATALOGUE) {
    for (uint8_t source = 0; source < pass.sourceCount; source++) {
      const auto& selector = pass.sources[source];
      for (uint8_t material : DEFINED_MATERIAL_IDS) {
        if (reactionSelectorMatchesMaterial(
              selector.match, selector.value, material))
          sourceMask[material] = 1;
      }
    }
  }
  for (uint8_t material : DEFINED_MATERIAL_IDS) {
    for (const auto& rule : SIMPLE_REACTION_CATALOGUE) {
      bool matches = reactionSelectorMatchesMaterial(
        rule.sourceMatch, rule.sourceValue, material);
      if (!matches) continue;
      sourceMask[material] = 1;
      simpleRulesBySource[material].push_back(&rule);
      if (rule.layerPolicy == ReactionLayerPolicy::LAYER_OVERLAP)
        hasCrossSimpleRules = true;
    }
    auto& rules = simpleRulesBySource[material];
    if (!rules.empty()) {
      std::sort(rules.begin(), rules.end(), [](const auto* a, const auto* b) {
        return a->priority < b->priority;
      });
      simpleSourceMaterials.push_back((uint8_t)material);
    }
  }
}

const ReactionPassDescriptor* ReactionSystem::catalogue(size_t& count) {
  count = sizeof(REACTION_PASS_CATALOGUE) / sizeof(REACTION_PASS_CATALOGUE[0]);
  return REACTION_PASS_CATALOGUE;
}

const SimpleReactionDescriptor* ReactionSystem::simpleCatalogue(size_t& count) {
  count = sizeof(SIMPLE_REACTION_CATALOGUE) / sizeof(SIMPLE_REACTION_CATALOGUE[0]);
  return SIMPLE_REACTION_CATALOGUE;
}

void ReactionSystem::runPhase(ReactionPhase phase) {
  for (const auto& pass : REACTION_PASS_CATALOGUE) {
    if (pass.phase != phase) continue;
    bool effectEnabled = pass.effectCadence == 1
      || E.tick % pass.effectCadence == 0;
    if (!effectEnabled) maintainPassLiveness(pass, false, false);
    (this->*pass.handler)(effectEnabled, false, false);
  }
}

void ReactionSystem::runCrossLayer(bool foregroundActive,
                                   bool backgroundActive) {
  if (!E.bgEnabled) return;
  for (const auto& pass : REACTION_PASS_CATALOGUE) {
    if (pass.phase != ReactionPhase::CROSS_LAYER) continue;
    bool effectEnabled = pass.effectCadence == 1
      || E.tick % pass.effectCadence == 0;
    if (!effectEnabled)
      maintainPassLiveness(pass, foregroundActive, backgroundActive);
    (this->*pass.handler)(effectEnabled, foregroundActive, backgroundActive);
  }
}

bool ReactionSystem::materialMatches(uint8_t material, ReactionMatchKind kind,
                                     uint32_t value) const {
  return reactionSelectorMatchesMaterial(kind, value, material);
}

void ReactionSystem::maintainPassLiveness(
    const ReactionPassDescriptor& pass, bool foregroundActive,
    bool backgroundActive) {
  if (pass.retry.policy == ReactionRetryPolicy::NONE) return;
  const auto& source = pass.sources[pass.retry.sourceIndex];
  const auto& neighbor = pass.retry.neighbor;
  auto neighborMatches = [&](Layer& layer, int cell) {
    return materialMatches(layer.grid[cell], neighbor.match, neighbor.value)
      && (!pass.retry.neighborMustNotBelongToBody
          || layer.bodyOwner[cell] < 0);
  };
  if (pass.retry.policy == ReactionRetryPolicy::CARDINAL_NEIGHBOR) {
    static constexpr int DX[4] = {1, 0, -1, 0};
    static constexpr int DY[4] = {0, 1, 0, -1};
    for (uint8_t material : DEFINED_MATERIAL_IDS) {
      if (!materialMatches(material, source.match, source.value)) continue;
      for (int cell : activeCells(material)) {
        if (!materialMatches(E.L->grid[cell], source.match, source.value))
          continue;
        int y = cell / E.cols, x = cell - y * E.cols;
        for (int direction = 0; direction < 4; direction++) {
          int nx = x + DX[direction], ny = y + DY[direction];
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          if (!neighborMatches(*E.L, ny * E.cols + nx)) continue;
          E.markLayerSimCell(E.L, cell);
          break;
        }
      }
    }
    return;
  }
  for (int y = 1; y < E.rows; y++) {
    E.forEachActiveUnionSpan(&E.fg, foregroundActive, &E.bg,
                             backgroundActive, y, 1, E.cols - 2, true,
                             [&](int minX, int maxX) {
      for (int x = minX; x <= maxX; x++) {
        int cell = y * E.cols + x;
        if (materialMatches(E.fg.grid[cell], source.match, source.value)
            && neighborMatches(E.bg, cell))
          E.markLayerSimCell(&E.fg, cell);
        if (materialMatches(E.bg.grid[cell], source.match, source.value)
            && neighborMatches(E.fg, cell))
          E.markLayerSimCell(&E.bg, cell);
      }
    });
  }
}

static int reactionWorldCoordinate(int origin, int local) {
  return (int)((uint32_t)origin + (uint32_t)local);
}

template <class Predicate>
static int reactionCardinalMatch(
    Engine& engine, int k, uint32_t channel, Predicate&& predicate) {
  int y = k / engine.cols, x = k - y * engine.cols;
  static constexpr int DX[4] = {1, 0, -1, 0};
  static constexpr int DY[4] = {0, 1, 0, -1};
  uint32_t phase = engine.L->worldSeed ^ channel
    ^ ((uint32_t)engine.tick * 0x9E3779B9u)
    ^ (engine.L->isBackground ? 0xB6A4D5u : 0u);
  int start = ((int)(whash2(
    phase, reactionWorldCoordinate(engine.L->worldOffsetX, x),
    reactionWorldCoordinate(engine.L->worldOffsetY, y)) * 4.0)) & 3;
  for (int offset = 0; offset < 4; offset++) {
    int direction = (start + offset) & 3;
    int nx = x + DX[direction], ny = y + DY[direction];
    if (nx < 0 || nx >= engine.cols || ny < 0 || ny >= engine.rows) continue;
    int candidate = ny * engine.cols + nx;
    if (predicate(candidate)) return candidate;
  }
  return -1;
}

void ReactionSystem::prepareActiveLists() {
  for (auto& cells : activeByMaterial) cells.clear();
  for (auto& cells : activeByReactionProfile) cells.clear();
  heatCells.clear();
  E.L->heatAddedAfterPrepare = false;
  auto besideExplosive = [&](int k, int x, int y) {
    auto explosive = [&](int q) {
      return E.isHeatSensitiveExplosive(E.L->grid[q]);
    };
    return (x + 1 < E.cols && explosive(k + 1))
        || (x > 0 && explosive(k - 1))
        || (y + 1 < E.rows && explosive(k + E.cols))
        || (y > 0 && explosive(k - E.cols));
  };
  for (int y = 1; y < E.rows; y++) {
    if (E.L->activeRowSpans[y].empty()) continue;
    int rb = y * E.cols;
    E.forEachActiveSpan(y, 1, E.cols - 2, true, [&](int minX, int maxX) {
      for (int x = minX; x <= maxX; x++) {
        int k = rb + x;
        uint8_t material = E.L->grid[k];
        if (sourceMask[material]) {
          activeByMaterial[material].push_back(k);
          uint8_t profile = MAT_REACTION_PROFILE[material];
          if (profile != MRP_NONE)
            activeByReactionProfile[profile].push_back(k);
        }
        if (E.isHeatSource(material) && y < E.rows - 1
            && besideExplosive(k, x, y)) heatCells.push_back(k);
      }
    });
  }
}

void ReactionSystem::applyFireAndWater(bool effectEnabled, bool, bool) {
  if (!effectEnabled) return;
  auto isFire = [&](int cell) {
    return E.hasMaterialReactionProfile(E.L->grid[cell], MRP_FIRE);
  };
  int steamCount = 0, fireCount = 0, igniteCount = 0;
  bool plantIndexExact = E.L->groundBaseValid && !E.L->groundDirty && !E.L->groundContentDirty;
  std::vector<int>& erasedPlant = E.reactionErasedPlant;
  CellMutationBatch mutations(E, erasedPlant);
  int igniteCap = E.cols * E.rows;
  std::vector<int>& snowMelt = E.reactionSnowMelt; snowMelt.clear();
  for (int k : activeCells(WATER)) {
      if (E.L->grid[k] != WATER) continue;
      int y = k / E.cols;
      int nk = isFire(k + 1) ? k + 1 : (isFire(k - 1) ? k - 1 : -1);
      if (nk < 0 && y < E.rows - 1 && isFire(k + E.cols)) nk = k + E.cols;
      if (nk < 0 && isFire(k - E.cols)) nk = k - E.cols;
      if (nk >= 0) { E.L->reactionSteam[steamCount++] = k; if (!E.L->reactionFlags[nk]) { E.L->reactionFlags[nk] = 1; E.L->reactionFires[fireCount++] = nk; } }
  }
  for (int k : activeProfileCells(MRP_FIRE)) {
      if (!isFire(k) || E.L->reactionFlags[k]) continue;
      int y = k / E.cols;
      int neigh[4]; int nn; if (y < E.rows - 1) { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k + E.cols; neigh[3] = k - E.cols; nn = 4; } else { neigh[0] = k + 1; neigh[1] = k - 1; neigh[2] = k - E.cols; nn = 3; }
      for (int ni = 0; ni < nn; ni++) {
        int nk = neigh[ni];
        if (E.L->grid[nk] == OIL) {
          if (E.rand() > OIL_IGNITE_P) continue;
          if (igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = nk;
          if (E.rand() < FIRE_SPREAD_P) {
            int oilY = nk / E.cols; int on[4]; int onn; if (oilY < E.rows - 1) { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk + E.cols; on[3] = nk - E.cols; onn = 4; } else { on[0] = nk + 1; on[1] = nk - 1; on[2] = nk - E.cols; onn = 3; }
            for (int oi = 0; oi < onn; oi++) { int ok = on[oi]; if (E.L->grid[ok] == OIL && E.rand() < 0.12 && igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = ok; }
          }
        } else if (E.L->grid[nk] == GUNPOWDER) {
          // Gunpowder is a fast fuse: it catches on any flame contact (no roll) and
          // the burn front races on through every adjacent grain, so a connected
          // trail or pile deflagrates in a couple of steps. It is also flammable, so
          // lava lights it directly (applyLava) and the chain takes over here.
          if (igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = nk;
          int gy = nk / E.cols; int gn[4]; int gnn; if (gy < E.rows - 1) { gn[0] = nk + 1; gn[1] = nk - 1; gn[2] = nk + E.cols; gn[3] = nk - E.cols; gnn = 4; } else { gn[0] = nk + 1; gn[1] = nk - 1; gn[2] = nk - E.cols; gnn = 3; }
          for (int gi = 0; gi < gnn; gi++) { int gk = gn[gi]; if (E.L->grid[gk] == GUNPOWDER && igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = gk; }
        } else if (E.L->grid[nk] == SNOW) { snowMelt.push_back(nk); } // fire melts snow to water (consistent with lava+snow and ice melting near fire)
        // Ignition is keyed to the `flammable` FLAG, not plant-family: the doc says
        // flammable = "ignites near fire/lava", and lava already uses isFlammable.
        // This stops fire from burning non-flammable plants (juicy cactus, wet
        // mushrooms) and lets any flammable powder/liquid catch the same way oil does.
        else if (!E.isBodyCell(nk) && E.isFlammable(E.L->grid[nk]) && E.rand() < PLANT_IGNITE_P) { if (igniteCount < igniteCap) E.L->reactionIgnite[igniteCount++] = nk; } // body-material invariant: a flammable body disintegrates via erodeBodies, not in-place ignition
      }
  }
  for (int i = 0; i < fireCount; i++) { int k = E.L->reactionFires[i]; if (isFire(k)) mutations.replaceLoose(k, EMPTY); E.L->reactionFlags[k] = 0; }
  for (int i = 0; i < steamCount; i++) { int k = E.L->reactionSteam[i]; if (E.L->grid[k] == WATER) mutations.replaceLoose(k, STEAM); }
  for (size_t i = 0; i < snowMelt.size(); i++) { int k = snowMelt[i]; if (E.L->grid[k] == SNOW) mutations.replaceLoose(k, WATER); }
  for (int i = 0; i < igniteCount; i++) { int k = E.L->reactionIgnite[i]; if (!E.isBodyCell(k) && E.isFlammable(E.L->grid[k])) mutations.replaceLoose(k, FIRE); }
  mutations.commitPlantErosion(plantIndexExact, true);
}
void ReactionSystem::applyAcid(bool effectEnabled, bool, bool) {
  bool dissolvedStructural = false;
  bool cellCompExact = E.L->groundBaseValid && !E.L->groundDirty && !E.L->groundContentDirty;
  bool jointWasDirty = E.comps.jointDirty, jointBondsWereInvalid = E.comps.jointBondsInvalid;
  bool crossBondMayBreak = false;
  std::vector<int>& erasedStructural = E.acidErasedStructural;
  std::vector<int64_t>& crossPairs = E.acidCrossPairs;
  CellMutationBatch mutations(E, erasedStructural);
  crossPairs.clear();
  // A pure acid bore can preserve the sleeping joint closure when the batch did
  // not remove the last co-occupation contact between a component pair. Record
  // each touched pair while dissolving, then scan its smaller component ONCE
  // against the final post-batch grid instead of once per removed cell.
  auto noteTouchedCrossBond = [&](int target) {
    if (!E.bgEnabled) return;
    if (!E.comps.jointSupportValid) { crossBondMayBreak = true; return; }
    Layer& own = *E.L;
    Layer& peer = E.L == &E.fg ? E.bg : E.fg;
    if (!cellCompExact || own.groundDirty || own.groundContentDirty || peer.groundDirty || peer.groundContentDirty) { crossBondMayBreak = true; return; }
    if (!E.isRigidMaterialClass(peer.grid[target])) return;
    int ownId = own.cellComp[target], peerId = peer.cellComp[target];
    int ownN = E.comps.compCount(own), peerN = E.comps.compCount(peer);
    if (ownId < 0 || ownId >= ownN || peerId < 0 || peerId >= peerN) { crossBondMayBreak = true; return; }
    int64_t key = ((int64_t)ownId << 32) | (uint32_t)peerId;
    if (std::find(crossPairs.begin(), crossPairs.end(), key) == crossPairs.end()) crossPairs.push_back(key);
  };
  auto touchedCrossBondSurvives = [&](int64_t key) {
    Layer& own = *E.L;
    Layer& peer = E.L == &E.fg ? E.bg : E.fg;
    int ownId = (int)(key >> 32), peerId = (int)(uint32_t)key;
    Comp* ownComp = E.comps.compById(own, ownId);
    Comp* peerComp = E.comps.compById(peer, peerId);
    if (ownComp->cells.size() <= peerComp->cells.size()) {
      for (int q : ownComp->cells) {
        if (!E.isRigidMaterialClass(own.grid[q])) continue;
        if (peer.cellComp[q] == peerId && E.isRigidMaterialClass(peer.grid[q])) return true;
      }
    } else {
      for (int q : peerComp->cells) {
        if (!E.isRigidMaterialClass(peer.grid[q])) continue;
        if (own.cellComp[q] == ownId && E.isRigidMaterialClass(own.grid[q])) return true;
      }
    }
    return false;
  };
  for (int k : activeProfileCells(MRP_ACID)) {
      if (!E.hasMaterialReactionProfile(E.L->grid[k], MRP_ACID)) continue;
      int y = k / E.cols;
      int right = k + 1, left = k - 1;
      int down = y + 1 < E.rows ? k + E.cols : k;
      int up = y > 0 ? k - E.cols : k;
      // body-material invariant: a stone body cell IS dissolvable material, but acid
      // on free-body cells is owned by the body-erosion path (erodeBodies), so skip them here.
      auto acidEats = [&](int q) { return E.isDissolvable(E.L->grid[q]) && !E.isBodyCell(q); };
      if (!acidEats(right) && !acidEats(left) && !acidEats(down) && !acidEats(up)) continue;
      // Acid touching dissolvable material is actively boring: keep it in the active
      // band so it keeps eating on later steps. Without this, a failed dissolve roll
      // lets settleLiquid see the enclosed acid as resting-on-support and go inert,
      // dropping it out of the band forever — it freezes mid-solid after eating only
      // a little (acid "settles in stone"). Re-marking ends naturally once no
      // dissolvable neighbour remains or the acid decays.
      E.markCellIndex(k);
      if (!effectEnabled) continue;
      if (E.rand() >= ACID_BATCH_DISSOLVE_P) continue;
      int target = reactionCardinalMatch(E, k, 0xAC1D01u, acidEats);
      if (target < 0) continue;
      uint8_t tm = E.L->grid[target];
      E.audio.noteAcidDissolve(target % E.cols, target / E.cols);
      if (E.isComponentMaterial(tm)) {
        noteTouchedCrossBond(target);
        dissolvedStructural = true;
      }
      // Dissolving releases acrid smoke (a yellow gas that rises/dissipates like
      // steam) from the dissolved cell ~half the time; otherwise it leaves space.
      if (E.rand() < ACRID_SMOKE_P) { mutations.replaceLoose(target, ACRID_SMOKE); E.markCellIndex(target); }
      else mutations.replaceLoose(target, EMPTY);
      if (E.rand() < ACID_DECAY_P) mutations.replaceLoose(k, EMPTY);
  }
  mutations.commitBodiesOnly();
  if (!crossBondMayBreak) for (int64_t pair : crossPairs) {
    if (!touchedCrossBondSurvives(pair)) { crossBondMayBreak = true; break; }
  }
  // Pass markGroundDirty=false and decide grounding ourselves: a dissolve that
  // doesn't disconnect anything (the common case of acid boring through bulk
  // stone) keeps the grounding cache valid and skips the full-grid reflood that
  // otherwise dominates the cost. removalsKeepGroundingValid patches the removed
  // cells when safe; any disconnect / seed / powder case forces a reflood.
  E.L->compsReshaped = false; // splitRigidAfterErase sets this if the comp SET changes
  // cellComp is exact at reaction time. Use it to avoid re-scanning every rigid
  // cell in the layer just to discover which one or two components acid touched.
  ConnectivitySplitMode splitMode = cellCompExact
    ? ConnectivitySplitMode::LOCAL_EXACT
    : ConnectivitySplitMode::FULL;
  if (dissolvedStructural) E.comps.splitRigidAfterErase(
    E.L->components, erasedStructural, E.L->nextComponentId,
    false, false, cellCompExact ? 0 : -1, splitMode);
  bool pureBore = false;
  if (dissolvedStructural) {
    E.comps.cgRemovedCells.clear();
    E.comps.cgRemovedCells.insert(E.comps.cgRemovedCells.end(),
                                  erasedStructural.begin(), erasedStructural.end());
    if (!E.comps.removalsKeepGroundingValid(E.comps.cgRemovedCells)) {
      E.L->groundDirty = true; // a real disconnect -> full reflood
    } else if (E.L->compsReshaped) {
      // Grounding still valid, but a comp split/vanished so the positional comp ids
      // that cellComp stores shifted -> the next pass must re-index (incremental).
      E.L->groundContentDirty = true;
    } else {
      // Pure bore: every surviving comp kept its id and position, so the cached
      // cellComp is still correct except at the removed cells. groundedCell was just
      // patched by removalsKeepGroundingValid; patch cellComp to match and leave the
      // cache otherwise untouched, so the next grounding pass SKIPS entirely. This is
      // what stops acid boring bulk stone from re-indexing the whole layer (incl. a
      // big inert ice tub holding a separate acid pool) every dissolve step.
      for (int k : E.comps.cgRemovedCells) E.L->cellComp[k] = -1;
      pureBore = true;
    }
  }
  if (pureBore && !crossBondMayBreak && E.comps.jointSupportValid) {
    // Only preserve the sleeping joint when NO component depends on cross-layer
    // stamps (every currently-grounded comp is also base-grounded). Hanging dual-
    // layer structures (BG beam held only by co-occupation with FG) keep base
    // flags ungrounded while c.grounded is joint-stamped — pure-bore must NOT
    // clear jointDirty there, or multi-log scenes creep one cell per dissolve
    // while co-occupation still exists (sleep skips re-joint; stamps go stale).
    auto dependsOnJoint = [](Layer& lay) {
      if (!lay.groundBaseValid) return true;
      size_t n = lay.components.size();
      if (lay.groundBaseFlags.size() != n) return true;
      size_t i = 0;
      auto scan = [&](std::vector<Comp>& list) {
        for (auto& c : list) {
          if (c.grounded && !lay.groundBaseFlags[i]) return true;
          i++;
        }
        return false;
      };
      return scan(lay.components);
    };
    if (!dependsOnJoint(E.fg) && !dependsOnJoint(E.bg)) {
      // splitRigidAfterErase conservatively invalidates every joint. Surviving
      // overlap + base-only support prove the closure is still exact for terrain.
      E.comps.jointDirty = jointWasDirty;
      E.comps.jointBondsInvalid = jointBondsWereInvalid;
    }
  }
}
void ReactionSystem::applyLava(bool effectEnabled, bool, bool) {
  if (!effectEnabled) return;
  CellMutationBatch mutations(E, mutationRemovedScratch);
  for (int k : activeProfileCells(MRP_LAVA)) {
      if (!E.hasMaterialReactionProfile(E.L->grid[k], MRP_LAVA)) continue;
      int right = k + 1, left = k - 1, up = k - E.cols;
      int snowK = reactionCardinalMatch(
        E, k, 0x1A7A01u, [&](int q) { return E.L->grid[q] == SNOW; });
      if (snowK >= 0) { mutations.replaceLoose(snowK, WATER); E.markCellIndex(k); continue; }
      int burnK = -1;
      // body-material invariant: lava disintegrates a flammable body via erodeBodies, not in-place ignition.
      auto lavaBurns = [&](int q) { return E.isFlammable(E.L->grid[q]) && !E.isBodyCell(q); };
      burnK = reactionCardinalMatch(E, k, 0x1A7A02u, lavaBurns);
      if (burnK >= 0) { mutations.replaceLoose(burnK, FIRE); continue; }
      int liquidK = -1;
      // Flag-driven (quenchesLava: water/acid/brine) -> steam + loose stone dust.
      // Keeping disconnected quench residue granular avoids creating a rigid body
      // for every isolated lava cell along a turbulent liquid boundary.
      auto quenches = [&](int q) { return E.isLavaQuencher(E.L->grid[q]); };
      liquidK = reactionCardinalMatch(E, k, 0x1A7A03u, quenches);
      if (liquidK >= 0) { mutations.replaceLoose(liquidK, STEAM); mutations.replaceLoose(k, STONE_DUST); continue; }
      if (E.rand() < LAVA_EMIT_FIRE_P) { int airK = -1; if (E.L->grid[up] == EMPTY) airK = up; else if (E.L->grid[right] == EMPTY) airK = right; else if (E.L->grid[left] == EMPTY) airK = left; if (airK >= 0) mutations.replaceLoose(airK, FIRE); }
  }
  mutations.commitPlantSplit();
}
void ReactionSystem::applyBodyIce(bool effectEnabled, bool, bool) {
  if (!effectEnabled) return;
  std::vector<std::pair<int, int>>& frozen = E.bodyFrozenIceScratch;
  frozen.clear();
  uint32_t phase = E.L->worldSeed ^ 0x1CEB0D1u
                 ^ ((uint32_t)E.tick * 0x9E3779B9u)
                 ^ (E.L->isBackground ? 0xB6A4D5u : 0u);
  for (Body* body : E.L->bodies) {
    E.rigid.ensureBodyRaster(body);
    for (const BodyRasterCell& cell : body->rasterBoundaryFootprint) {
      if (E.rigid.bodyMaterialAt(body, cell.local) != ICE) continue;
      int waterK = -1;
      int start = ((int)(whash2(
        phase ^ 0xD1AEC7u,
        reactionWorldCoordinate(E.L->worldOffsetX, cell.x),
        reactionWorldCoordinate(E.L->worldOffsetY, cell.y)) * 4.0)) & 3;
      static constexpr int DX[4] = {1, 0, -1, 0};
      static constexpr int DY[4] = {0, 1, 0, -1};
      for (int offset = 0; offset < 4; offset++) {
        int direction = (start + offset) & 3;
        int x = cell.x + DX[direction], y = cell.y + DY[direction];
        if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
        int k = y * E.cols + x;
        if (E.L->grid[k] != WATER || E.L->bodyOwner[k] >= 0) continue;
        waterK = k;
        break;
      }
      if (waterK < 0
          || whash2(
            phase, reactionWorldCoordinate(E.L->worldOffsetX, cell.x),
            reactionWorldCoordinate(E.L->worldOffsetY, cell.y))
             >= ICE_FREEZE_P) continue;
      frozen.push_back({body->id, waterK});
    }
  }
  std::sort(frozen.begin(), frozen.end());
  frozen.erase(std::unique(frozen.begin(), frozen.end()), frozen.end());
  for (size_t begin = 0; begin < frozen.size();) {
    size_t end = begin + 1;
    while (end < frozen.size() && frozen[end].first == frozen[begin].first) end++;
    std::vector<int> cells;
    cells.reserve(end - begin);
    for (size_t i = begin; i < end; i++) cells.push_back(frozen[i].second);
    E.rigid.freezeCellsOntoBody(*E.L, frozen[begin].first, *E.L, cells);
    begin = end;
  }
}
void ReactionSystem::applyIce(bool effectEnabled, bool, bool) {
  if (!effectEnabled) return;
  std::vector<int>& meltedCells = E.iceMeltedScratch;
  CellMutationBatch mutations(E, meltedCells);
  E.ensureComponentRegistries();
  for (int componentIndex : E.L->iceComponents) {
    Comp& comp = E.L->components[componentIndex];
    // Iterate by snapshot length, not a copy: freezing appends ICE cells to
    // comp.cells, and those new cells are already ICE (no further melt/freeze this
    // pass), so capping the loop at the pre-pass size is byte-identical to copying
    // the vector first — without the per-component heap allocation.
    size_t iceN = comp.cells.size();
    for (size_t ci = 0; ci < iceN; ci++) {
      int k = comp.cells[ci];
      if (E.L->grid[k] != ICE) continue;
      int y = k / E.cols, x = k - y * E.cols;
      int right = k + 1, left = k - 1, down = k + E.cols, up = k - E.cols;
      // A floating ice component can legitimately settle on the last row. Keep
      // its reaction probes inside the grid; an unchecked floor `down` read could
      // alias unrelated WASM memory and, when that byte looked like WATER, append
      // an out-of-bounds ICE cell nondeterministically.
      uint8_t rm = x + 1 < E.cols ? E.L->grid[right] : EMPTY;
      uint8_t lm = x > 0 ? E.L->grid[left] : EMPTY;
      uint8_t dm = y + 1 < E.rows ? E.L->grid[down] : EMPTY;
      uint8_t um = y > 0 ? E.L->grid[up] : EMPTY;
      auto meltsIce = [&](uint8_t material) {
        uint8_t profile = E.materialReactionProfile(material);
        return profile == MRP_FIRE || profile == MRP_LAVA;
      };
      if (meltsIce(rm) || meltsIce(lm) || meltsIce(dm) || meltsIce(um)) { mutations.replaceLoose(k, WATER); continue; }
      // Salt de-ices: ice touching a salt grain melts to BRINE (not water), and the
      // grain is spent (also -> brine). Brine never refreezes because the freeze
      // check below only targets WATER, so the melt sticks. Deterministic (no rand):
      // an ice-free / salt-free scene consumes no RNG here, so checksums are stable.
      if (rm == SALT || lm == SALT || dm == SALT || um == SALT) {
        int saltK = reactionCardinalMatch(
          E, k, 0x1CE5A17u, [&](int q) { return E.L->grid[q] == SALT; });
        mutations.replaceLoose(k, BRINE); mutations.replaceLoose(saltK, BRINE); continue;
      }
      // The preloaded cardinal materials also prove whether randomized water
      // selection has a candidate. Inert ice needs no hash or second grid scan.
      if (rm != WATER && lm != WATER && dm != WATER && um != WATER) continue;
      int waterK = reactionCardinalMatch(
        E, k, 0x1CEF12Eu, [&](int q) { return E.L->grid[q] == WATER; });
      if (waterK >= 0) {
        // A quiet ice/water boundary remains a live probabilistic reaction. Keep
        // the ice cell scheduled without marking an unchanged world tile dirty.
        E.markLayerSimCell(E.L, k);
        if (E.rand() < ICE_FREEZE_P) {
          mutations.replaceAttached(waterK, ICE, componentIndex);
          // Refreezing a member cancels its queued removal; genuinely external
          // water is appended to this stable component index.
        }
      }
    }
  }
  mutations.commitRigidErosion(true);
}
// Declarative same-layer X + Y -> products. Source buckets are precomputed once
// from identities, profiles, and traits, then populated during the active-span
// scan, so adding a rule does not add a full-grid scan. Chance uses a
// coordinate/tick hash channel; inserting a descriptor cannot perturb any shared
// RNG stream.
void ReactionSystem::applySimpleRules(bool effectEnabled, bool, bool) {
  if (!effectEnabled) return;
  constexpr ReactionLayerPolicy layerPolicy =
    ReactionLayerPolicy::CURRENT_LAYER;
  CellMutationBatch mutations(E, mutationRemovedScratch);
  auto writeProduct = [&](int cell, uint8_t product) {
    if (MAT_PLACEMENT[product] == MP_STRUCTURE)
      mutations.replaceWithStatic(cell, product);
    else
      mutations.replaceLoose(cell, product);
  };
  for (uint8_t sourceMaterial : simpleSourceMaterials) {
    const auto& rules = simpleRulesBySource[sourceMaterial];
    for (int cell : activeCells(sourceMaterial)) {
      uint8_t liveSource = E.L->grid[cell];
      for (const SimpleReactionDescriptor* rule : rules) {
        if (rule->layerPolicy != layerPolicy
            || !materialMatches(liveSource, rule->sourceMatch,
                                rule->sourceValue)) continue;
        int neighbor = reactionCardinalMatch(E, cell, rule->directionChannel,
          [&](int candidate) {
            return materialMatches(E.L->grid[candidate], rule->neighborMatch,
                                   rule->neighborValue);
          });
        if (neighbor < 0) continue;
        if (simpleReactionNeedsRetry(*rule)) E.markLayerSimCell(E.L, cell);
        if (E.tick % rule->effectCadence != 0) break;
        if (rule->probability < 1.0f) {
          int y = cell / E.cols, x = cell - y * E.cols;
          uint32_t phase = E.L->worldSeed ^ rule->directionChannel
            ^ ((uint32_t)E.tick * 0x9E3779B9u)
            ^ (E.L->isBackground ? 0xB6A4D5u : 0u);
          if (whash2(phase,
                     reactionWorldCoordinate(E.L->worldOffsetX, x),
                     reactionWorldCoordinate(E.L->worldOffsetY, y))
              >= rule->probability) break;
        }
        writeProduct(neighbor, rule->neighborProduct);
        writeProduct(cell, rule->sourceProduct);
        break;
      }
    }
  }
  mutations.commitGeneral();
}

// Cross-layer fire and ice use the same topology-aware mutation path as local
// reactions. Fire consumes the shared simulation RNG; ice uses coordinate hashes.
void ReactionSystem::applyCrossLayerMaterialContact(bool effectEnabled,
                                                    bool foregroundActive,
                                                    bool backgroundActive) {
  if (!effectEnabled) return;
  bool fgIndexExact = E.fg.groundBaseValid && !E.fg.groundDirty
    && !E.fg.groundContentDirty;
  bool bgIndexExact = E.bg.groundBaseValid && !E.bg.groundDirty
    && !E.bg.groundContentDirty;
  crossIgniteFg.clear(); crossIgniteBg.clear();
  crossFrozenIceFg.clear(); crossFrozenIceBg.clear();
  crossBodyFrozenIceFg.clear(); crossBodyFrozenIceBg.clear();
  for (int y = 1; y < E.rows - 1; y++) {
    E.forEachActiveUnionSpan(&E.fg, foregroundActive, &E.bg, backgroundActive,
                             y, 1, E.cols - 2, true,
                             [&](int minX, int maxX) {
      for (int x = minX; x <= maxX; x++) {
        int cell = y * E.cols + x;
        uint8_t foreground = E.fg.grid[cell];
        uint8_t background = E.bg.grid[cell];
        if (E.hasMaterialReactionProfile(foreground, MRP_FIRE)
            && E.isFlammable(background)) {
          if (E.rand() < FIRE_CROSS_P && E.bg.bodyOwner[cell] == -1)
            crossIgniteBg.push_back(cell);
        } else if (E.hasMaterialReactionProfile(background, MRP_FIRE)
                   && E.isFlammable(foreground)) {
          if (E.rand() < FIRE_CROSS_P && E.fg.bodyOwner[cell] == -1)
            crossIgniteFg.push_back(cell);
        }
        if (foreground == ICE && background == WATER
            && E.bg.bodyOwner[cell] < 0) {
          uint32_t phase = E.fg.worldSeed ^ 0x1CEB0D2u
            ^ ((uint32_t)E.tick * 0x9E3779B9u);
          if (whash2(phase, E.fg.worldOffsetX + x,
                     E.fg.worldOffsetY + y) < ICE_FREEZE_P) {
            if (E.fg.bodyOwner[cell] >= 0)
              crossBodyFrozenIceBg.push_back({E.fg.bodyOwner[cell], cell});
            else
              crossFrozenIceBg.insert(cell);
          }
        } else if (background == ICE && foreground == WATER
                   && E.fg.bodyOwner[cell] < 0) {
          uint32_t phase = E.fg.worldSeed ^ 0x1CEB0D3u
            ^ ((uint32_t)E.tick * 0x9E3779B9u);
          if (whash2(phase, E.fg.worldOffsetX + x,
                     E.fg.worldOffsetY + y) < ICE_FREEZE_P) {
            if (E.bg.bodyOwner[cell] >= 0)
              crossBodyFrozenIceFg.push_back({E.bg.bodyOwner[cell], cell});
            else
              crossFrozenIceFg.insert(cell);
          }
        }
      }
    });
  }

  {
    Engine::ActiveLayerScope layerScope(E, &E.fg);
    CellMutationBatch foregroundFire(E, mutationRemovedScratch);
    for (int cell : crossIgniteFg)
      if (E.fg.bodyOwner[cell] < 0 && E.isFlammable(E.fg.grid[cell]))
        foregroundFire.replaceLoose(cell, FIRE);
    foregroundFire.commitPlantErosion(fgIndexExact, true);
  }
  {
    Engine::ActiveLayerScope layerScope(E, &E.bg);
    CellMutationBatch backgroundFire(E, mutationRemovedScratch);
    for (int cell : crossIgniteBg)
      if (E.bg.bodyOwner[cell] < 0 && E.isFlammable(E.bg.grid[cell]))
        backgroundFire.replaceLoose(cell, FIRE);
    backgroundFire.commitPlantErosion(bgIndexExact, true);
  }

  auto commitBodyFrozenIce = [&](Layer& source, Layer& target,
                                  std::vector<std::pair<int, int>>& frozen) {
    if (frozen.empty()) return;
    std::sort(frozen.begin(), frozen.end());
    for (size_t begin = 0; begin < frozen.size();) {
      size_t end = begin + 1;
      while (end < frozen.size()
             && frozen[end].first == frozen[begin].first) end++;
      std::vector<int> cells;
      cells.reserve(end - begin);
      for (size_t i = begin; i < end; i++)
        if (i == begin || frozen[i].second != frozen[i - 1].second)
          cells.push_back(frozen[i].second);
      E.rigid.freezeCellsOntoBody(source, frozen[begin].first, target, cells);
      begin = end;
    }
  };
  commitBodyFrozenIce(E.bg, E.fg, crossBodyFrozenIceFg);
  commitBodyFrozenIce(E.fg, E.bg, crossBodyFrozenIceBg);

  auto commitFrozenIce = [&](Layer& layer, std::unordered_set<int>& cells) {
    Engine::ActiveLayerScope layerScope(E, &layer);
    CellMutationBatch frozen(E, mutationRemovedScratch);
    for (int cell : cells)
      if (layer.grid[cell] == WATER) frozen.replaceWithStatic(cell, ICE);
    frozen.commitGeneral();
  };
  commitFrozenIce(E.fg, crossFrozenIceFg);
  commitFrozenIce(E.bg, crossFrozenIceBg);
}

// Generic overlap rules treat co-occupied foreground/background cells as
// neighbors. Foreground-source wins an ambiguous bid; descriptor priority wins
// within one source direction. Products commit layer-by-layer through the same
// topology repair used by local rules.
void ReactionSystem::applySimpleCrossLayer(bool effectEnabled,
                                           bool foregroundActive,
                                           bool backgroundActive) {
  if (!effectEnabled || !hasCrossSimpleRules) return;
  crossSimpleMutations.clear();
  for (int y = 1; y < E.rows; y++) {
    E.forEachActiveUnionSpan(&E.fg, foregroundActive, &E.bg, backgroundActive,
                             y, 1, E.cols - 2, true,
                             [&](int minX, int maxX) {
      for (int x = minX; x <= maxX; x++) {
        int cell = y * E.cols + x;
        uint8_t foreground = E.fg.grid[cell];
        uint8_t background = E.bg.grid[cell];
        const SimpleReactionDescriptor* selected = nullptr;
        bool foregroundIsSource = true;
        auto select = [&](uint8_t source, uint8_t neighbor) {
          for (const auto* rule : simpleRulesBySource[source]) {
            if (rule->layerPolicy != ReactionLayerPolicy::LAYER_OVERLAP
                || !materialMatches(source, rule->sourceMatch, rule->sourceValue)
                || !materialMatches(neighbor, rule->neighborMatch,
                                    rule->neighborValue)) continue;
            return rule;
          }
          return (const SimpleReactionDescriptor*)nullptr;
        };
        selected = select(foreground, background);
        if (!selected) {
          selected = select(background, foreground);
          foregroundIsSource = false;
        }
        if (!selected) continue;
        Layer& sourceLayer = foregroundIsSource ? E.fg : E.bg;
        if (simpleReactionNeedsRetry(*selected))
          E.markLayerSimCell(&sourceLayer, cell);
        if (E.tick % selected->effectCadence != 0) continue;
        if (selected->probability < 1.0f) {
          uint32_t direction = foregroundIsSource ? 0xF60A1u : 0xB60A1u;
          uint32_t phase = E.fg.worldSeed ^ selected->directionChannel
            ^ direction ^ ((uint32_t)E.tick * 0x9E3779B9u);
          if (whash2(phase, E.fg.worldOffsetX + x,
                     E.fg.worldOffsetY + y) >= selected->probability) continue;
        }
        crossSimpleMutations.push_back({
          cell,
          foreground,
          background,
          foregroundIsSource ? selected->sourceProduct
                             : selected->neighborProduct,
          foregroundIsSource ? selected->neighborProduct
                             : selected->sourceProduct,
        });
      }
    });
  }
  if (crossSimpleMutations.empty()) return;
  crossSimpleMutations.erase(
    std::remove_if(crossSimpleMutations.begin(), crossSimpleMutations.end(),
      [&](const CrossSimpleMutation& mutation) {
        return E.fg.grid[mutation.cell] != mutation.expectedForeground
          || E.bg.grid[mutation.cell] != mutation.expectedBackground;
      }),
    crossSimpleMutations.end());
  if (crossSimpleMutations.empty()) return;
  auto applyLayer = [&](Layer& layer, bool foregroundLayer) {
    Engine::ActiveLayerScope layerScope(E, &layer);
    CellMutationBatch mutations(E, mutationRemovedScratch);
    for (const auto& mutation : crossSimpleMutations) {
      uint8_t product = foregroundLayer ? mutation.foregroundProduct
                                        : mutation.backgroundProduct;
      if (MAT_PLACEMENT[product] == MP_STRUCTURE)
        mutations.replaceWithStatic(mutation.cell, product);
      else
        mutations.replaceLoose(mutation.cell, product);
    }
    mutations.commitGeneral();
  };
  applyLayer(E.fg, true);
  applyLayer(E.bg, false);
}
