// Spatial force emitters and neutronium attraction.

int ForceSystem::layerIndex(const Layer* layer) const {
  return layer == &E.bg ? 1 : 0;
}

uint8_t ForceSystem::layerBit(const Layer* layer) const {
  return layer == &E.bg ? FORCE_LAYER_BACKGROUND : FORCE_LAYER_FOREGROUND;
}

int ForceSystem::bodyNeutroniumCellCount(const Body* body) const {
  if (!body) return 0;
  if (body->jointRole == 2 && body->jointPeer) body = body->jointPeer;
  int count = 0;
  if (body->cellMaterials.empty()) {
    if (body->material == NEUTRONIUM) count = body->nPts;
  } else {
    count += (int)std::count(body->cellMaterials.begin(),
                             body->cellMaterials.end(), NEUTRONIUM);
  }
  count += (int)std::count(body->jointPeerMaterials.begin(),
                           body->jointPeerMaterials.end(), NEUTRONIUM);
  return count;
}

void ForceSystem::queueRadial(
    Layer* layer, double x, double y, float radius, float strength,
    uint8_t targets, uint8_t repelTargets, int sourceBodyId) {
  if (!layer || radius <= 0 || strength == 0 || targets == 0) return;
  ForceEmitter emitter;
  emitter.x = x;
  emitter.y = y;
  emitter.radius = radius;
  emitter.strength = strength;
  emitter.kind = FORCE_RADIAL;
  emitter.targets = targets;
  emitter.repelTargets = repelTargets;
  emitter.layerTargets = layerBit(layer);
  emitter.sourceBodyId = sourceBodyId;
  int index = layerIndex(layer);
  queued[index].push_back(emitter);
  looseCoverageValid[index] = false;
  looseTangentialBalanced[index] = false;
  layer->forceWakePending = true;
}

void ForceSystem::queueDirectional(
    Layer* layer, double x, double y, float radius, float strength,
    float directionX, float directionY, uint8_t targets,
    uint8_t repelTargets, int sourceBodyId) {
  if (!layer || radius <= 0 || strength == 0 || targets == 0) return;
  double length = std::hypot((double)directionX, (double)directionY);
  if (length <= 1e-9) return;
  ForceEmitter emitter;
  emitter.x = x;
  emitter.y = y;
  emitter.radius = radius;
  emitter.strength = strength;
  emitter.directionX = (float)(directionX / length);
  emitter.directionY = (float)(directionY / length);
  emitter.kind = FORCE_DIRECTIONAL;
  emitter.targets = targets;
  emitter.repelTargets = repelTargets;
  emitter.layerTargets = layerBit(layer);
  emitter.sourceBodyId = sourceBodyId;
  int index = layerIndex(layer);
  queued[index].push_back(emitter);
  looseCoverageValid[index] = false;
  looseTangentialBalanced[index] = false;
  layer->forceWakePending = true;
}

void ForceSystem::addEmitter(
    LayerState& state, const ForceEmitter& emitter) {
  if (emitter.radius <= 0 || emitter.strength == 0 || emitter.targets == 0
      || emitter.layerTargets == 0)
    return;
  ForceEmitter stored = emitter;
  stored.signature = emitterSignature(stored);
  state.emitters.push_back(stored);
}

uint64_t ForceSystem::emitterSignature(const ForceEmitter& emitter) const {
  uint64_t hash = 1469598103934665603ull;
  auto mixBytes = [&](const void* data, size_t length) {
    const uint8_t* bytes = static_cast<const uint8_t*>(data);
    for (size_t i = 0; i < length; i++) {
      hash ^= bytes[i];
      hash *= 1099511628211ull;
    }
  };
  mixBytes(&emitter.x, sizeof(emitter.x));
  mixBytes(&emitter.y, sizeof(emitter.y));
  mixBytes(&emitter.radius, sizeof(emitter.radius));
  mixBytes(&emitter.strength, sizeof(emitter.strength));
  mixBytes(&emitter.geometryMinX, sizeof(emitter.geometryMinX));
  mixBytes(&emitter.geometryMinY, sizeof(emitter.geometryMinY));
  mixBytes(&emitter.geometryMaxX, sizeof(emitter.geometryMaxX));
  mixBytes(&emitter.geometryMaxY, sizeof(emitter.geometryMaxY));
  mixBytes(&emitter.directionX, sizeof(emitter.directionX));
  mixBytes(&emitter.directionY, sizeof(emitter.directionY));
  mixBytes(&emitter.kind, sizeof(emitter.kind));
  mixBytes(&emitter.targets, sizeof(emitter.targets));
  mixBytes(&emitter.repelTargets, sizeof(emitter.repelTargets));
  mixBytes(&emitter.layerTargets, sizeof(emitter.layerTargets));
  mixBytes(&emitter.sourceBodyId, sizeof(emitter.sourceBodyId));
  mixBytes(&emitter.sourceBodyLayer, sizeof(emitter.sourceBodyLayer));
  mixBytes(&emitter.neutroniumCells, sizeof(emitter.neutroniumCells));
  mixBytes(&emitter.geometryRevision, sizeof(emitter.geometryRevision));
  mixBytes(&emitter.nearestNeutronium, sizeof(emitter.nearestNeutronium));
  return hash;
}

void ForceSystem::addNeutroniumEmitters(
    Layer* layer, LayerState& state) {
  if (!layer->forceSourcePresent) return;
  bool found = false;
  constexpr uint8_t targets = FORCE_POWDER | FORCE_LIQUID
                            | FORCE_RIGID | FORCE_GAS | FORCE_ACTOR;
  auto addCluster = [&](double x, double y, int cellCount, int sourceBodyId,
                        int sourceBodyLayer, int sourceNeutroniumCells,
                        bool dynamicGeometry, size_t pointStart,
                        float minX, float minY,
                        float maxX, float maxY) {
    if (cellCount <= 0) return -1;
    found = true;
    double rootCells = std::sqrt((double)cellCount);
    double massScale = std::fmin(3.5, 0.75 + rootCells * 0.35);
    float radius = (float)std::fmin(
      96.0, 52.0 + std::log2((double)cellCount + 1.0) * 6.0);
    float strength = (float)(0.16 * massScale);
    ForceEmitter emitter;
    emitter.x = x;
    emitter.y = y;
    emitter.radius = radius;
    emitter.strength = strength;
    emitter.kind = FORCE_RADIAL;
    emitter.targets = targets;
    emitter.repelTargets = FORCE_GAS;
    emitter.layerTargets = FORCE_LAYER_BOTH;
    emitter.sourceBodyId = sourceBodyId;
    emitter.sourceBodyLayer = sourceBodyLayer;
    emitter.neutroniumCells = sourceNeutroniumCells;
    emitter.dynamicGeometry = dynamicGeometry;
    emitter.geometryMinX = minX;
    emitter.geometryMinY = minY;
    emitter.geometryMaxX = maxX;
    emitter.geometryMaxY = maxY;
    emitter.nearestNeutronium = true;
    uint64_t geometryRevision = 1469598103934665603ull;
    for (size_t i = pointStart; i < state.neutroniumPoints.size(); i++) {
      uint32_t xBits = 0, yBits = 0;
      memcpy(&xBits, &state.neutroniumPoints[i].x, sizeof(xBits));
      memcpy(&yBits, &state.neutroniumPoints[i].y, sizeof(yBits));
      geometryRevision ^= xBits;
      geometryRevision *= 1099511628211ull;
      geometryRevision ^= yBits;
      geometryRevision *= 1099511628211ull;
    }
    emitter.geometryRevision = geometryRevision;
    int emitterIndex = (int)state.emitters.size();
    addEmitter(state, emitter);
    if (emitterIndex >= (int)state.emitters.size()) return -1;
    for (size_t i = pointStart; i < state.neutroniumPoints.size(); i++)
      state.neutroniumPoints[i].emitter = emitterIndex;
    return emitterIndex;
  };

  for (const Comp& component : layer->components) {
    if (component.cells.empty()) continue;
    size_t pointStart = state.neutroniumPoints.size();
    double sumX = 0, sumY = 0;
    float minX = 1e9f, minY = 1e9f, maxX = -1e9f, maxY = -1e9f;
    int count = 0;
    for (int k : component.cells) {
      if (k < 0 || k >= E.cols * E.rows
          || layer->grid[k] != NEUTRONIUM)
        continue;
      int y = k / E.cols;
      float pointX = (float)(k - y * E.cols) + 0.5f;
      float pointY = (float)y + 0.5f;
      sumX += pointX;
      sumY += pointY;
      minX = std::fmin(minX, pointX);
      minY = std::fmin(minY, pointY);
      maxX = std::fmax(maxX, pointX);
      maxY = std::fmax(maxY, pointY);
      state.neutroniumPoints.push_back({pointX, pointY, -1});
      count++;
    }
    if (count > 0)
      addCluster(sumX / count, sumY / count, count, -1, -1, count, false,
                 pointStart, minX, minY, maxX, maxY);
  }

  for (Body* body : layer->bodies) {
    if (body->cellMaterials.empty()) {
      if (body->material != NEUTRONIUM) continue;
    } else if (std::find(body->cellMaterials.begin(),
                         body->cellMaterials.end(), NEUTRONIUM)
               == body->cellMaterials.end()) {
      continue;
    }
    double cs = std::cos(body->angle), sn = std::sin(body->angle);
    size_t pointStart = state.neutroniumPoints.size();
    double sumX = 0, sumY = 0;
    float minX = 1e9f, minY = 1e9f, maxX = -1e9f, maxY = -1e9f;
    int count = 0;
    for (int local = 0; local < (int)body->occ.size(); local++) {
      if (!body->occ[local]
          || E.rigid.bodyMaterialAt(body, local) != NEUTRONIUM)
        continue;
      double localX = body->offsetX + local % body->w;
      double localY = body->offsetY + local / body->w;
      float pointX = (float)(body->px + localX * cs - localY * sn);
      float pointY = (float)(body->py + localX * sn + localY * cs);
      sumX += pointX;
      sumY += pointY;
      minX = std::fmin(minX, pointX);
      minY = std::fmin(minY, pointY);
      maxX = std::fmax(maxX, pointX);
      maxY = std::fmax(maxY, pointY);
      state.neutroniumPoints.push_back({pointX, pointY, -1});
      count++;
    }
    if (count > 0) {
      Body* physicalBody = body->jointRole == 2 && body->jointPeer
        ? body->jointPeer : body;
      int physicalLayer = body->jointRole == 2 ? 0 : layerIndex(layer);
      addCluster(sumX / count, sumY / count, count, physicalBody->id,
                 physicalLayer, bodyNeutroniumCellCount(physicalBody),
                 physicalBody->awake, pointStart, minX, minY, maxX, maxY);
    }
  }
  layer->forceSourcePresent = found;
}

bool ForceSystem::stateAffectsLayer(
    const LayerState& state, uint8_t targetLayer) const {
  for (const ForceEmitter& emitter : state.emitters)
    if (emitter.layerTargets & targetLayer) return true;
  return false;
}

bool ForceSystem::binAffectsLayer(
    const LayerState& state, int bin, uint8_t targetLayer) const {
  if (bin < 0 || bin >= (int)state.binHeads.size()) return false;
  int link = state.binHeads[bin];
  while (link >= 0) {
    const ForceEmitter& emitter = state.emitters[state.binLinks[link].emitter];
    if (emitter.layerTargets & targetLayer) return true;
    link = state.binLinks[link].next;
  }
  return false;
}

bool ForceSystem::binAffectsLooseLayer(
    const LayerState& state, int bin, uint8_t targetLayer) const {
  if (bin < 0 || bin >= (int)state.binHeads.size()) return false;
  constexpr uint8_t looseTargets = FORCE_POWDER | FORCE_LIQUID | FORCE_GAS;
  int link = state.binHeads[bin];
  while (link >= 0) {
    const ForceEmitter& emitter = state.emitters[state.binLinks[link].emitter];
    if ((emitter.layerTargets & targetLayer)
        && (emitter.targets & looseTargets))
      return true;
    link = state.binLinks[link].next;
  }
  return false;
}

uint64_t ForceSystem::forceBinSignature(
    int bin, uint8_t targetLayer) const {
  uint64_t hash = 1469598103934665603ull;
  bool any = false;
  auto mixBytes = [&](const void* data, size_t length) {
    const uint8_t* bytes = static_cast<const uint8_t*>(data);
    for (size_t i = 0; i < length; i++) {
      hash ^= bytes[i];
      hash *= 1099511628211ull;
    }
  };
  for (int sourceLayer = 0; sourceLayer < 2; sourceLayer++) {
    const LayerState& state = states[sourceLayer];
    if (bin < 0 || bin >= (int)state.binHeads.size()) continue;
    int link = state.binHeads[bin];
    while (link >= 0) {
      const ForceEmitter& emitter = state.emitters[state.binLinks[link].emitter];
      link = state.binLinks[link].next;
      if (!(emitter.layerTargets & targetLayer)) continue;
      any = true;
      mixBytes(&sourceLayer, sizeof(sourceLayer));
      mixBytes(&emitter.signature, sizeof(emitter.signature));
    }
  }
  return any ? hash : 0;
}

void ForceSystem::prepareLooseCachesAndDirtyBins() {
  looseCacheSerial++;
  if (looseCacheSerial == 0) {
    looseCacheSerial = 1;
    for (LooseForceCache& cache : looseForceCaches)
      for (CachedLooseForce& entry : cache.cells) entry.serial = 0;
  }
  int binCount = E.chunkCols * E.chunkRows;
  for (int targetLayer = 0; targetLayer < 2; targetLayer++) {
    uint8_t targetBit = targetLayer == 0
      ? FORCE_LAYER_FOREGROUND : FORCE_LAYER_BACKGROUND;
    currentBinSignatures[targetLayer].assign(binCount, 0);
    changedBins[targetLayer].assign(binCount, 0);
    LooseForceCache& cache = looseForceCaches[targetLayer];
    cache.binOffsets.assign(binCount, -1);
    dynamicField[targetLayer] = false;
    for (const LayerState& state : states) {
      for (const ForceEmitter& emitter : state.emitters) {
        if ((emitter.layerTargets & targetBit) && emitter.dynamicGeometry)
          dynamicField[targetLayer] = true;
      }
    }
    int cacheBinCount = 0;
    for (int bin = 0; bin < binCount; bin++) {
      uint64_t signature = forceBinSignature(bin, targetBit);
      currentBinSignatures[targetLayer][bin] = signature;
      uint64_t previous = bin < (int)previousBinSignatures[targetLayer].size()
        ? previousBinSignatures[targetLayer][bin] : 0;
      if (signature != previous) {
        changedBins[targetLayer][bin] = 1;
      }
      if (binAffectsLooseLayer(states[0], bin, targetBit)
          || binAffectsLooseLayer(states[1], bin, targetBit)) {
        cache.binOffsets[bin] = cacheBinCount * CHUNK_SIZE * CHUNK_SIZE;
        cacheBinCount++;
      }
    }
    cache.cells.resize(
      (size_t)cacheBinCount * CHUNK_SIZE * CHUNK_SIZE);
    previousBinSignatures[targetLayer] = currentBinSignatures[targetLayer];
  }
}

void ForceSystem::wakeAffectedTargets(
    Layer* layer, const std::vector<uint8_t>* bins,
    bool updateCoverage, bool wakeReleased) {
  double wakeStart = emscripten_get_now();
  int index = layerIndex(layer);
  std::array<double, 256>& minForce = looseMinForce[index];
  if (updateCoverage) {
    minForce.fill(1e30);
    looseQuadrantCounts.fill(0);
  }
  uint8_t targetLayer = layerBit(layer);
  int binCount = E.chunkCols * E.chunkRows;
  for (int bin = 0; bin < binCount; bin++) {
    bool selected = bins ? bin < (int)bins->size() && (*bins)[bin]
      : binAffectsLayer(states[0], bin, targetLayer)
        || binAffectsLayer(states[1], bin, targetLayer);
    if (!selected)
      continue;
    int chunkX = bin % E.chunkCols, chunkY = bin / E.chunkCols;
    int x0 = chunkX * CHUNK_SIZE;
    int x1 = imin(E.cols, x0 + CHUNK_SIZE);
    int y0 = chunkY * CHUNK_SIZE;
    int y1 = imin(E.rows, y0 + CHUNK_SIZE);
    for (int y = y0; y < y1; y++) {
      int row = y * E.cols;
      for (int x = x0; x < x1; x++) {
        uint8_t material = layer->grid[row + x];
        uint8_t target = E.isLiquidMaterial(material) ? FORCE_LIQUID
                       : E.isLooseSolidMaterial(material) ? FORCE_POWDER
                       : E.isGasMaterial(material) ? FORCE_GAS : 0;
        if (!target) continue;
        double forceX, forceY;
        bool active = sampleLoose(layer, x, y, target, forceX, forceY);
        if (!active && !wakeReleased) continue;
        if (active && updateCoverage) {
          double magnitude = std::hypot(forceX, forceY);
          if (magnitude < minForce[material]) minForce[material] = magnitude;
          if (target != FORCE_GAS) {
            int quadrant = (forceX < 0 ? 1 : 0) | (forceY < 0 ? 2 : 0);
            looseQuadrantCounts[material * 4 + quadrant]++;
          }
        }
        if (x < layer->rowMarkMin[y]) layer->rowMarkMin[y] = x;
        if (x > layer->rowMarkMax[y]) layer->rowMarkMax[y] = x;
      }
    }
  }
  for (Body* body : layer->bodies) {
    // Awake bodies already keep the layer scheduled and are sampled once in
    // applyBodyForces. This pass only schedules sleeping bodies reached by a
    // changed or newly rebuilt field.
    if (body->jointRole == 2 || body->awake) continue;
    int x = (int)std::lround(body->px), y = (int)std::lround(body->py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
    if (bins) {
      int bin = (y >> CHUNK_SHIFT) * E.chunkCols + (x >> CHUNK_SHIFT);
      if (bin < 0 || bin >= (int)bins->size() || !(*bins)[bin]) continue;
    }
    double forceX, forceY;
    bool active = sampleLayer(layer, body->px, body->py, FORCE_RIGID,
                              body->id, forceX, forceY);
    if (!active && !wakeReleased) continue;
    if (x < layer->rowMarkMin[y]) layer->rowMarkMin[y] = x;
    if (x > layer->rowMarkMax[y]) layer->rowMarkMax[y] = x;
  }
  // Pressure-driven tangential flow stays enabled while a material's force
  // quadrants become more even. A balanced distribution, or 64 scans without
  // improved coverage, parks the tangent path so blocked static scenes sleep.
  if (!updateCoverage) {
    E.perfForceWakeMs += emscripten_get_now() - wakeStart;
    return;
  }
  bool hasUnbalancedMaterial = false;
  bool coverageChanged = false;
  bool coverageImproved = false;
  for (int material = 0; material < TABLE; material++) {
    int base = material * 4;
    uint32_t counts[4] = {
      looseQuadrantCounts[base], looseQuadrantCounts[base + 1],
      looseQuadrantCounts[base + 2], looseQuadrantCounts[base + 3]
    };
    uint32_t total = counts[0] + counts[1] + counts[2] + counts[3];
    uint64_t imbalance = 0;
    uint32_t minimum = counts[0];
    for (int quadrant = 0; quadrant < 4; quadrant++) {
      imbalance += (uint64_t)counts[quadrant] * counts[quadrant];
      if (counts[quadrant] < minimum) minimum = counts[quadrant];
    }
    if (!looseCoverageValid[index]
        || looseCoverageTotals[index][material] != total) {
      looseCoverageTotals[index][material] = total;
      looseBestImbalance[index][material] = imbalance;
      coverageChanged = true;
    } else if (imbalance < looseBestImbalance[index][material]) {
      looseBestImbalance[index][material] = imbalance;
      coverageImproved = true;
    }
    uint32_t minimumShare = (uint32_t)imax(10, (int)(total / 20));
    if (total >= 40 && minimum < minimumShare)
      hasUnbalancedMaterial = true;
  }
  bool coverageReset = !looseCoverageValid[index] || coverageChanged;
  int elapsed = looseCoverageTick[index] < 0
    ? 1 : imax(1, E.tick - looseCoverageTick[index]);
  looseCoverageTick[index] = E.tick;
  if (coverageReset) {
    looseForceAge[index] = 0;
  } else {
    looseForceAge[index] = (uint16_t)imin(
      65535, looseForceAge[index] + elapsed);
  }
  if (coverageReset || coverageImproved) {
    looseCoverageValid[index] = true;
    looseCoverageStagnantTicks[index] = 0;
  } else {
    looseCoverageStagnantTicks[index] = (uint8_t)imin(
      255, looseCoverageStagnantTicks[index] + elapsed);
  }
  static constexpr int COVERAGE_STAGNANT_TICKS = 64;
  looseTangentialBalanced[index] = !hasUnbalancedMaterial
    || looseCoverageStagnantTicks[index] >= COVERAGE_STAGNANT_TICKS;
  E.perfForceWakeMs += emscripten_get_now() - wakeStart;
}

void ForceSystem::buildBins(LayerState& state) {
  if (state.emitters.empty()) {
    state.binHeads.clear();
    state.binLinks.clear();
    return;
  }
  state.binHeads.assign((size_t)E.chunkCols * E.chunkRows, -1);
  state.binLinks.clear();
  for (int i = 0; i < (int)state.emitters.size(); i++) {
    const ForceEmitter& emitter = state.emitters[i];
    double sourceMinX = emitter.nearestNeutronium
      ? emitter.geometryMinX : emitter.x;
    double sourceMaxX = emitter.nearestNeutronium
      ? emitter.geometryMaxX : emitter.x;
    double sourceMinY = emitter.nearestNeutronium
      ? emitter.geometryMinY : emitter.y;
    double sourceMaxY = emitter.nearestNeutronium
      ? emitter.geometryMaxY : emitter.y;
    int x0 = imax(0, (int)std::floor(sourceMinX - emitter.radius));
    int x1 = imin(E.cols - 1, (int)std::ceil(sourceMaxX + emitter.radius));
    int y0 = imax(0, (int)std::floor(sourceMinY - emitter.radius));
    int y1 = imin(E.rows - 1, (int)std::ceil(sourceMaxY + emitter.radius));
    int chunkX0 = x0 >> CHUNK_SHIFT, chunkX1 = x1 >> CHUNK_SHIFT;
    int chunkY0 = y0 >> CHUNK_SHIFT, chunkY1 = y1 >> CHUNK_SHIFT;
    for (int chunkY = chunkY0; chunkY <= chunkY1; chunkY++) {
      for (int chunkX = chunkX0; chunkX <= chunkX1; chunkX++) {
        int bin = chunkY * E.chunkCols + chunkX;
        state.binLinks.push_back({i, state.binHeads[bin]});
        state.binHeads[bin] = (int)state.binLinks.size() - 1;
      }
    }
  }
}

bool ForceSystem::neutroniumSourceDominates(
    int seedIndex, int targetNeutroniumCells,
    int targetBodyLayer, int targetBodyId) const {
  if (seedIndex < 0 || seedIndex >= (int)neutroniumSeeds.size()) return false;
  const NeutroniumSeed& seed = neutroniumSeeds[seedIndex];
  const LayerState& state = states[seed.sourceLayer];
  if (seed.emitter < 0 || seed.emitter >= (int)state.emitters.size())
    return false;
  const ForceEmitter& emitter = state.emitters[seed.emitter];
  if (emitter.sourceBodyId < 0) return true;
  if (emitter.sourceBodyLayer == targetBodyLayer
      && emitter.sourceBodyId == targetBodyId)
    return false;
  if (emitter.neutroniumCells != targetNeutroniumCells)
    return emitter.neutroniumCells > targetNeutroniumCells;
  if (emitter.sourceBodyLayer != targetBodyLayer)
    return emitter.sourceBodyLayer < targetBodyLayer;
  return emitter.sourceBodyId < targetBodyId;
}

int ForceSystem::buildNeutroniumKdNode(int begin, int end, int depth) {
  if (begin >= end) return -1;
  int middle = begin + (end - begin) / 2;
  int axis = depth & 1;
  std::nth_element(
    neutroniumKdOrder.begin() + begin,
    neutroniumKdOrder.begin() + middle,
    neutroniumKdOrder.begin() + end,
    [&](int first, int second) {
      const NeutroniumSeed& a = neutroniumSeeds[first];
      const NeutroniumSeed& b = neutroniumSeeds[second];
      float av = axis ? a.y : a.x;
      float bv = axis ? b.y : b.x;
      if (av != bv) return av < bv;
      float ao = axis ? a.x : a.y;
      float bo = axis ? b.x : b.y;
      if (ao != bo) return ao < bo;
      return first < second;
    });
  int nodeIndex = (int)neutroniumKdNodes.size();
  int seedIndex = neutroniumKdOrder[middle];
  const NeutroniumSeed& seed = neutroniumSeeds[seedIndex];
  neutroniumKdNodes.push_back({
    seedIndex, -1, -1, seedIndex, seed.x, seed.y, seed.x, seed.y,
  });
  int left = buildNeutroniumKdNode(begin, middle, depth + 1);
  int right = buildNeutroniumKdNode(middle + 1, end, depth + 1);
  NeutroniumKdNode& node = neutroniumKdNodes[nodeIndex];
  node.left = left;
  node.right = right;
  auto sourceBetter = [&](int first, int second) {
    if (second < 0) return true;
    const NeutroniumSeed& firstSeed = neutroniumSeeds[first];
    const NeutroniumSeed& secondSeed = neutroniumSeeds[second];
    const ForceEmitter& a =
      states[firstSeed.sourceLayer].emitters[firstSeed.emitter];
    const ForceEmitter& b =
      states[secondSeed.sourceLayer].emitters[secondSeed.emitter];
    bool aStatic = a.sourceBodyId < 0;
    bool bStatic = b.sourceBodyId < 0;
    if (aStatic != bStatic) return aStatic;
    if (aStatic) return first < second;
    if (a.neutroniumCells != b.neutroniumCells)
      return a.neutroniumCells > b.neutroniumCells;
    if (a.sourceBodyLayer != b.sourceBodyLayer)
      return a.sourceBodyLayer < b.sourceBodyLayer;
    if (a.sourceBodyId != b.sourceBodyId)
      return a.sourceBodyId < b.sourceBodyId;
    return first < second;
  };
  auto includeChild = [&](int childIndex) {
    if (childIndex < 0) return;
    const NeutroniumKdNode& child = neutroniumKdNodes[childIndex];
    node.minX = std::fmin(node.minX, child.minX);
    node.minY = std::fmin(node.minY, child.minY);
    node.maxX = std::fmax(node.maxX, child.maxX);
    node.maxY = std::fmax(node.maxY, child.maxY);
    if (sourceBetter(child.bestDominanceSeed, node.bestDominanceSeed))
      node.bestDominanceSeed = child.bestDominanceSeed;
  };
  includeChild(left);
  includeChild(right);
  return nodeIndex;
}

void ForceSystem::buildNeutroniumIndex() {
  neutroniumKdRoot = -1;
  neutroniumKdOrder.clear();
  neutroniumKdNodes.clear();
  // Small source sets are cheaper to scan directly. Dense body scenes amortize
  // the balanced index over one filtered nearest-source query per body.
  static constexpr int KD_MIN_SEEDS = 64;
  if ((int)neutroniumSeeds.size() < KD_MIN_SEEDS) return;
  neutroniumKdOrder.resize(neutroniumSeeds.size());
  for (int i = 0; i < (int)neutroniumKdOrder.size(); i++)
    neutroniumKdOrder[i] = i;
  neutroniumKdNodes.reserve(neutroniumSeeds.size());
  neutroniumKdRoot = buildNeutroniumKdNode(
    0, (int)neutroniumKdOrder.size(), 0);
}

int ForceSystem::nearestDominantNeutronium(
    double x, double y, int targetNeutroniumCells,
    int targetBodyLayer, int targetBodyId) const {
  if (neutroniumKdRoot < 0) return -1;
  int bestSeed = -1;
  double bestDistance2 = 1e30;
  auto boundsDistance2 = [&](const NeutroniumKdNode& node) {
    double dx = x < node.minX ? node.minX - x
              : x > node.maxX ? x - node.maxX : 0;
    double dy = y < node.minY ? node.minY - y
              : y > node.maxY ? y - node.maxY : 0;
    return dx * dx + dy * dy;
  };
  auto visit = [&](auto&& self, int nodeIndex) -> void {
    if (nodeIndex < 0) return;
    const NeutroniumKdNode& node = neutroniumKdNodes[nodeIndex];
    if (!neutroniumSourceDominates(
          node.bestDominanceSeed, targetNeutroniumCells,
          targetBodyLayer, targetBodyId)
        || boundsDistance2(node) > bestDistance2)
      return;
    if (neutroniumSourceDominates(
          node.seed, targetNeutroniumCells,
          targetBodyLayer, targetBodyId)) {
      const NeutroniumSeed& seed = neutroniumSeeds[node.seed];
      double dx = seed.x - x, dy = seed.y - y;
      double distance2 = dx * dx + dy * dy;
      if (distance2 < bestDistance2
          || (distance2 == bestDistance2 && node.seed < bestSeed)) {
        bestDistance2 = distance2;
        bestSeed = node.seed;
      }
    }
    int first = node.left, second = node.right;
    double firstDistance = first >= 0
      ? boundsDistance2(neutroniumKdNodes[first]) : 1e30;
    double secondDistance = second >= 0
      ? boundsDistance2(neutroniumKdNodes[second]) : 1e30;
    if (secondDistance < firstDistance) {
      std::swap(first, second);
      std::swap(firstDistance, secondDistance);
    }
    if (firstDistance <= bestDistance2) self(self, first);
    if (secondDistance <= bestDistance2) self(self, second);
  };
  visit(visit, neutroniumKdRoot);
  return bestSeed;
}

void ForceSystem::buildNearestNeutroniumField() {
  // Source points carry fresh sub-cell body poses every tick. The grid-space
  // nearest assignment is reused until their occupied cells or ownership change.
  neutroniumSeeds.clear();
  uint64_t geometryHash = 1469598103934665603ull;
  auto mixHash = [&](uint64_t value) {
    geometryHash ^= value;
    geometryHash *= 1099511628211ull;
  };
  mixHash((uint64_t)E.cols);
  mixHash((uint64_t)E.rows);
  double maxRadius = 0;
  int seedMinX = E.cols, seedMinY = E.rows, seedMaxX = -1, seedMaxY = -1;
  for (int sourceLayer = 0; sourceLayer < 2; sourceLayer++) {
    const LayerState& state = states[sourceLayer];
    for (const GeometryPoint& point : state.neutroniumPoints) {
      if (point.emitter < 0 || point.emitter >= (int)state.emitters.size())
        continue;
      int gridX = (int)std::floor(point.x);
      int gridY = (int)std::floor(point.y);
      if (gridX < 0 || gridX >= E.cols || gridY < 0 || gridY >= E.rows)
        continue;
      neutroniumSeeds.push_back({
        point.x, point.y, gridX, gridY, sourceLayer, point.emitter
      });
      mixHash((uint64_t)sourceLayer);
      mixHash((uint64_t)point.emitter);
      mixHash((uint64_t)(gridY * E.cols + gridX));
      const ForceEmitter& emitter = state.emitters[point.emitter];
      if (emitter.radius > maxRadius) maxRadius = emitter.radius;
      if (gridX < seedMinX) seedMinX = gridX;
      if (gridX > seedMaxX) seedMaxX = gridX;
      if (gridY < seedMinY) seedMinY = gridY;
      if (gridY > seedMaxY) seedMaxY = gridY;
    }
  }
  mixHash((uint64_t)neutroniumSeeds.size());
  buildNeutroniumIndex();

  int gridLength = E.cols * E.rows;
  bool dimensionsChanged = nearestFieldCols != E.cols
                        || nearestFieldRows != E.rows;
  bool geometryMatches = nearestFieldValid
    && !dimensionsChanged && nearestGeometryHash == geometryHash;
  if (!geometryMatches) {
    looseCoverageValid[0] = looseCoverageValid[1] = false;
    looseForceAge[0] = looseForceAge[1] = 0;
  }
  nearestGeometryHash = geometryHash;
  nearestFieldCols = E.cols;
  nearestFieldRows = E.rows;
  nearestFieldValid = true;
  if (geometryMatches) return;

  if (neutroniumSeeds.empty()) {
    if (dimensionsChanged) {
      nearestNeutroniumField.clear();
      nearestSeedAt.clear();
      nearestVertical.clear();
    } else if (nearestFieldX1 >= nearestFieldX0
               && nearestFieldY1 >= nearestFieldY0) {
      for (int y = nearestFieldY0; y <= nearestFieldY1; y++)
        std::fill(nearestNeutroniumField.begin()
                    + y * E.cols + nearestFieldX0,
                  nearestNeutroniumField.begin()
                    + y * E.cols + nearestFieldX1 + 1,
                  -1);
    }
    nearestFieldX0 = nearestFieldY0 = 0;
    nearestFieldX1 = nearestFieldY1 = -1;
    return;
  }

  bool resized = dimensionsChanged
              || (int)nearestNeutroniumField.size() != gridLength;
  if (resized) {
    nearestNeutroniumField.assign(gridLength, -1);
    nearestSeedAt.assign(gridLength, -1);
    nearestVertical.assign(gridLength, -1);
  } else if (nearestFieldX1 >= nearestFieldX0
             && nearestFieldY1 >= nearestFieldY0) {
    for (int y = nearestFieldY0; y <= nearestFieldY1; y++)
      std::fill(nearestNeutroniumField.begin() + y * E.cols + nearestFieldX0,
                nearestNeutroniumField.begin() + y * E.cols + nearestFieldX1 + 1,
                -1);
  }
  int padding = (int)std::ceil(maxRadius);
  int x0 = imax(0, seedMinX - padding);
  int x1 = imin(E.cols - 1, seedMaxX + padding);
  int y0 = imax(0, seedMinY - padding);
  int y1 = imin(E.rows - 1, seedMaxY + padding);
  if (!resized) {
    for (int y = y0; y <= y1; y++) {
      std::fill(nearestSeedAt.begin() + y * E.cols + x0,
                nearestSeedAt.begin() + y * E.cols + x1 + 1, -1);
      std::fill(nearestVertical.begin() + y * E.cols + x0,
                nearestVertical.begin() + y * E.cols + x1 + 1, -1);
    }
  }
  nearestFieldX0 = x0;
  nearestFieldX1 = x1;
  nearestFieldY0 = y0;
  nearestFieldY1 = y1;
  for (int seed = 0; seed < (int)neutroniumSeeds.size(); seed++) {
    const NeutroniumSeed& point = neutroniumSeeds[seed];
    int k = point.gridY * E.cols + point.gridX;
    if (nearestSeedAt[k] < 0) nearestSeedAt[k] = seed;
  }
  for (int x = x0; x <= x1; x++) {
    int nearestAbove = -1;
    for (int y = y0; y <= y1; y++) {
      int k = y * E.cols + x;
      if (nearestSeedAt[k] >= 0) nearestAbove = nearestSeedAt[k];
      nearestVertical[k] = nearestAbove;
    }
    int nearestBelow = -1;
    for (int y = y1; y >= y0; y--) {
      int k = y * E.cols + x;
      if (nearestSeedAt[k] >= 0) nearestBelow = nearestSeedAt[k];
      int current = nearestVertical[k];
      if (nearestBelow < 0) continue;
      if (current < 0
          || std::abs(neutroniumSeeds[nearestBelow].gridY - y)
             < std::abs(neutroniumSeeds[current].gridY - y))
        nearestVertical[k] = nearestBelow;
    }
  }

  int width = x1 - x0 + 1;
  edtLocations.resize(width);
  edtBreaks.resize((size_t)width + 1);
  for (int y = y0; y <= y1; y++) {
    int row = y * E.cols;
    int envelope = -1;
    for (int q = x0; q <= x1; q++) {
      int seed = nearestVertical[row + q];
      if (seed < 0) continue;
      double dy = y - neutroniumSeeds[seed].gridY;
      double fq = dy * dy;
      double intersection = -1e30;
      while (envelope >= 0) {
        int p = edtLocations[envelope];
        int previousSeed = nearestVertical[row + p];
        double previousDy = y - neutroniumSeeds[previousSeed].gridY;
        double fp = previousDy * previousDy;
        intersection = ((fq + (double)q * q) - (fp + (double)p * p))
                     / (2.0 * (q - p));
        if (intersection > edtBreaks[envelope]) break;
        envelope--;
      }
      envelope++;
      edtLocations[envelope] = q;
      edtBreaks[envelope] = envelope == 0 ? -1e30 : intersection;
      edtBreaks[envelope + 1] = 1e30;
    }
    if (envelope < 0) continue;
    int active = 0;
    for (int q = x0; q <= x1; q++) {
      while (active < envelope && edtBreaks[active + 1] < q) active++;
      nearestNeutroniumField[row + q]
        = nearestVertical[row + edtLocations[active]];
    }
  }
}

void ForceSystem::prepareLayer(Layer* layer) {
  int index = layerIndex(layer);
  LayerState& state = states[index];
  if (!layer->forceSourcePresent && queued[index].empty()) {
    state.emitters.clear();
    state.neutroniumPoints.clear();
    state.binHeads.clear();
    state.binLinks.clear();
    layer->forceActive = false;
    return;
  }
  state.emitters.clear();
  state.neutroniumPoints.clear();
  for (const ForceEmitter& emitter : queued[index]) addEmitter(state, emitter);
  queued[index].clear();
  addNeutroniumEmitters(layer, state);
  buildBins(state);
}

void ForceSystem::prepareWorldTick() {
  prepareLayer(&E.fg);
  if (E.bgEnabled) prepareLayer(&E.bg);
  else {
    queued[1].clear();
    states[1].emitters.clear();
    states[1].neutroniumPoints.clear();
    states[1].binHeads.clear();
    states[1].binLinks.clear();
  }
  buildNearestNeutroniumField();
  prepareLooseCachesAndDirtyBins();
  bool wakeForeground = E.fg.forceWakePending;
  bool wakeBackground = E.bg.forceWakePending;
  E.fg.forceWakePending = E.bg.forceWakePending = false;
  if (states[0].emitters.empty() && states[1].emitters.empty()) {
    E.fg.forceActive = E.bg.forceActive = false;
    wakeAffectedTargets(&E.fg, &changedBins[0], false, true);
    if (E.bgEnabled)
      wakeAffectedTargets(&E.bg, &changedBins[1], false, true);
    looseCoverageValid[0] = looseCoverageValid[1] = false;
    looseCoverageStagnantTicks[0] = looseCoverageStagnantTicks[1] = 0;
    looseForceAge[0] = looseForceAge[1] = 0;
    looseCoverageTick[0] = looseCoverageTick[1] = -1;
    looseTangentialBalanced[0] = looseTangentialBalanced[1] = false;
    return;
  }
  E.fg.forceActive = stateAffectsLayer(states[0], FORCE_LAYER_FOREGROUND)
                  || stateAffectsLayer(states[1], FORCE_LAYER_FOREGROUND);
  E.bg.forceActive = E.bgEnabled
                  && (stateAffectsLayer(states[0], FORCE_LAYER_BACKGROUND)
                      || stateAffectsLayer(states[1], FORCE_LAYER_BACKGROUND));
  static constexpr int COVERAGE_SCAN_CADENCE = 8;
  auto prepareTarget = [&](Layer* layer, int index, bool fullWake) {
    if (!layer->forceActive) {
      wakeAffectedTargets(layer, &changedBins[index], false, true);
      return;
    }
    bool coverageDue = looseCoverageTick[index] < 0
      || E.tick - looseCoverageTick[index] >= COVERAGE_SCAN_CADENCE;
    if (fullWake || coverageDue) {
      wakeAffectedTargets(layer, nullptr, true, false);
    }
    // A changed bin can contain both the new field and cells just outside a
    // swept/contracted old field. Revisit only those bins to release the latter.
    wakeAffectedTargets(layer, &changedBins[index], false, true);
  };
  prepareTarget(&E.fg, 0, wakeForeground);
  if (E.bgEnabled) prepareTarget(&E.bg, 1, wakeBackground);
}

bool ForceSystem::sampleState(
    const LayerState& state, double x, double y,
    uint8_t target, uint8_t targetLayer, int sourceBodyId,
    double& forceX, double& forceY) const {
  forceX = forceY = 0;
  if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return false;
  if (state.emitters.empty() || state.binHeads.empty()) return false;
  int chunkX = ((int)x) >> CHUNK_SHIFT;
  int chunkY = ((int)y) >> CHUNK_SHIFT;
  if (chunkX < 0 || chunkX >= E.chunkCols
      || chunkY < 0 || chunkY >= E.chunkRows)
    return false;
  int link = state.binHeads[chunkY * E.chunkCols + chunkX];
  while (link >= 0) {
    const ForceEmitter& emitter = state.emitters[state.binLinks[link].emitter];
    link = state.binLinks[link].next;
    if (emitter.nearestNeutronium
        || !(emitter.targets & target) || !(emitter.layerTargets & targetLayer)
        || (sourceBodyId >= 0 && emitter.sourceBodyId == sourceBodyId))
      continue;
    double dx = emitter.x - x, dy = emitter.y - y;
    double distance2 = dx * dx + dy * dy;
    double radius2 = (double)emitter.radius * emitter.radius;
    if (distance2 >= radius2) continue;
    double distance = std::sqrt(distance2);
    double falloff = 1.0 - distance / emitter.radius;
    double magnitude = emitter.strength * falloff * falloff;
    if (emitter.repelTargets & target) magnitude = -magnitude;
    if (emitter.kind == FORCE_DIRECTIONAL) {
      forceX += emitter.directionX * magnitude;
      forceY += emitter.directionY * magnitude;
    } else if (distance > 1e-6) {
      double inverseDistance = 1.0 / distance;
      forceX += dx * inverseDistance * magnitude;
      forceY += dy * inverseDistance * magnitude;
    }
  }
  return forceX * forceX + forceY * forceY > 1e-12;
}

bool ForceSystem::sampleNearestNeutronium(
    Layer* layer, double x, double y, uint8_t target, int sourceBodyId,
    int targetNeutroniumCells, int targetBodyLayer,
    double& forceX, double& forceY) const {
  forceX = forceY = 0;
  if (x < 0 || x >= E.cols || y < 0 || y >= E.rows
      || nearestNeutroniumField.empty() || neutroniumSeeds.empty())
    return false;
  int targetLayer = layerIndex(layer);
  auto eligible = [&](int seedIndex) {
    if (seedIndex < 0 || seedIndex >= (int)neutroniumSeeds.size())
      return false;
    const NeutroniumSeed& seed = neutroniumSeeds[seedIndex];
    const LayerState& state = states[seed.sourceLayer];
    if (seed.emitter < 0 || seed.emitter >= (int)state.emitters.size())
      return false;
    const ForceEmitter& emitter = state.emitters[seed.emitter];
    if (!emitter.nearestNeutronium || !(emitter.targets & target)
        || !(emitter.layerTargets & layerBit(layer)))
      return false;
    if (targetNeutroniumCells > 0 && emitter.sourceBodyId >= 0) {
      if (emitter.sourceBodyLayer == targetBodyLayer
          && emitter.sourceBodyId == sourceBodyId)
        return false;
      if (emitter.neutroniumCells != targetNeutroniumCells)
        return emitter.neutroniumCells > targetNeutroniumCells;
      if (emitter.sourceBodyLayer != targetBodyLayer)
        return emitter.sourceBodyLayer < targetBodyLayer;
      return emitter.sourceBodyId < sourceBodyId;
    }
    return !(seed.sourceLayer == targetLayer && sourceBodyId >= 0
             && emitter.sourceBodyId == sourceBodyId);
  };
  int gridX = (int)std::floor(x), gridY = (int)std::floor(y);
  int fieldSeed = nearestNeutroniumField[gridY * E.cols + gridX];
  int nearestSeed = eligible(fieldSeed) ? fieldSeed : -1;
  if (nearestSeed < 0 && targetNeutroniumCells > 0
      && target == FORCE_RIGID && neutroniumKdRoot >= 0) {
    nearestSeed = nearestDominantNeutronium(
      x, y, targetNeutroniumCells, targetBodyLayer, sourceBodyId);
  }
  if (nearestSeed < 0) {
    double nearestDistance2 = 1e30;
    for (int seedIndex = 0; seedIndex < (int)neutroniumSeeds.size();
         seedIndex++) {
      if (!eligible(seedIndex)) continue;
      const NeutroniumSeed& seed = neutroniumSeeds[seedIndex];
      double dx = seed.x - x, dy = seed.y - y;
      double distance2 = dx * dx + dy * dy;
      if (distance2 >= nearestDistance2) continue;
      nearestDistance2 = distance2;
      nearestSeed = seedIndex;
    }
  }
  if (nearestSeed < 0) return false;
  const NeutroniumSeed& seed = neutroniumSeeds[nearestSeed];
  const ForceEmitter& emitter = states[seed.sourceLayer].emitters[seed.emitter];
  double dx = seed.x - x, dy = seed.y - y;
  double distance2 = dx * dx + dy * dy;
  double radius2 = (double)emitter.radius * emitter.radius;
  if (distance2 >= radius2 || distance2 <= 1e-12) return false;
  double distance = std::sqrt(distance2);
  double falloff = 1.0 - distance / emitter.radius;
  double magnitude = emitter.strength * falloff * falloff;
  if (emitter.repelTargets & target) magnitude = -magnitude;
  double inverseDistance = 1.0 / distance;
  forceX = dx * inverseDistance * magnitude;
  forceY = dy * inverseDistance * magnitude;
  return true;
}

bool ForceSystem::sampleLayer(
    Layer* layer, double x, double y, uint8_t target, int sourceBodyId,
    double& forceX, double& forceY,
    int targetNeutroniumCells, int targetBodyLayer) const {
  forceX = forceY = 0;
  int targetIndex = layerIndex(layer);
  uint8_t targetLayer = layerBit(layer);
  for (int sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
    double sourceForceX, sourceForceY;
    int excludedBody = sourceIndex == targetIndex ? sourceBodyId : -1;
    sampleState(states[sourceIndex], x, y, target, targetLayer,
                excludedBody, sourceForceX, sourceForceY);
    forceX += sourceForceX;
    forceY += sourceForceY;
  }
  double nearestForceX, nearestForceY;
  if (sampleNearestNeutronium(
        layer, x, y, target, sourceBodyId,
        targetNeutroniumCells, targetBodyLayer,
                              nearestForceX, nearestForceY)) {
    forceX += nearestForceX;
    forceY += nearestForceY;
  }
  return forceX * forceX + forceY * forceY > 1e-12;
}

bool ForceSystem::sampleLoose(
    Layer* layer, int x, int y, uint8_t target,
    double& forceX, double& forceY) {
  if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) {
    forceX = forceY = 0;
    return false;
  }
  LooseForceCache& cache = looseForceCaches[layerIndex(layer)];
  int bin = (y >> CHUNK_SHIFT) * E.chunkCols + (x >> CHUNK_SHIFT);
  int offset = bin >= 0 && bin < (int)cache.binOffsets.size()
    ? cache.binOffsets[bin] : -1;
  if (offset < 0) {
    // Every loose-target emitter is linked across its complete bounded reach.
    // An unmapped bin therefore proves that no loose force can affect this cell.
    forceX = forceY = 0;
    return false;
  }
  int localX = x - ((x >> CHUNK_SHIFT) << CHUNK_SHIFT);
  int localY = y - ((y >> CHUNK_SHIFT) << CHUNK_SHIFT);
  CachedLooseForce& entry = cache.cells[
    offset + localY * CHUNK_SIZE + localX];
  if (entry.serial == looseCacheSerial && entry.target == target) {
    forceX = entry.x;
    forceY = entry.y;
    return entry.active;
  }
  entry.active = sampleLayer(layer, x + 0.5, y + 0.5, target, -1,
                             entry.x, entry.y);
  entry.serial = looseCacheSerial;
  entry.target = target;
  forceX = entry.x;
  forceY = entry.y;
  return entry.active;
}

bool ForceSystem::sample(
    double x, double y, uint8_t target, int sourceBodyId,
    double& forceX, double& forceY,
    int targetNeutroniumCells, int targetBodyLayer) const {
  return sampleLayer(E.L, x, y, target, sourceBodyId, forceX, forceY,
                     targetNeutroniumCells, targetBodyLayer);
}

bool ForceSystem::sampleActor(
    double x, double y, double& forceX, double& forceY) const {
  if (states[0].emitters.empty() && states[1].emitters.empty()) {
    forceX = forceY = 0;
    return false;
  }
  return sampleLayer(&E.fg, x, y, FORCE_ACTOR, -1, forceX, forceY);
}

int ForceSystem::looseMoveCandidates(
    double forceX, double forceY,
    std::array<std::pair<int, int>, 3>& moves) const {
  int stepX = forceX > 1e-9 ? 1 : (forceX < -1e-9 ? -1 : 0);
  int stepY = forceY > 1e-9 ? 1 : (forceY < -1e-9 ? -1 : 0);
  double absX = std::fabs(forceX), absY = std::fabs(forceY);
  int moveCount = 0;
  if (stepX && stepY && absX * 3 > absY && absY * 3 > absX)
    moves[moveCount++] = {stepX, stepY};
  if (absX >= absY) {
    if (stepX) moves[moveCount++] = {stepX, 0};
    if (stepY) moves[moveCount++] = {0, stepY};
  } else {
    if (stepY) moves[moveCount++] = {0, stepY};
    if (stepX) moves[moveCount++] = {stepX, 0};
  }
  return moveCount;
}

bool ForceSystem::overridesGravity(
    int x, int y, uint8_t material) {
  uint8_t target = E.isLiquidMaterial(material) ? FORCE_LIQUID
                 : E.isGasMaterial(material) ? FORCE_GAS : FORCE_POWDER;
  double forceX, forceY;
  if (!sampleLoose(E.L, x, y, target, forceX, forceY))
    return false;
  constexpr double CELL_STEP_FORCE = 0.12;
  return forceX * forceX + forceY * forceY
      >= CELL_STEP_FORCE * CELL_STEP_FORCE;
}

void ForceSystem::applyBodyForces() {
  if (!E.L->forceActive) return;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int neutroniumCells = bodyNeutroniumCellCount(body);
    double forceX, forceY;
    if (!sample(body->px, body->py, FORCE_RIGID, body->id,
                forceX, forceY, neutroniumCells,
                neutroniumCells > 0 ? layerIndex(E.L) : -1))
      continue;
    if (!body->awake) E.rigid.wakeBody(body);
    body->vx += forceX;
    body->vy += forceY;
  }
}

bool ForceSystem::tryMoveLoose(
    int x, int y, int k, uint8_t material, bool movementAllowed) {
  uint8_t target = E.isLiquidMaterial(material) ? FORCE_LIQUID
                 : E.isGasMaterial(material) ? FORCE_GAS : FORCE_POWDER;
  double forceX, forceY;
  if (!sampleLoose(E.L, x, y, target, forceX, forceY)) return false;
  double magnitude = std::hypot(forceX, forceY);
  constexpr double CELL_STEP_FORCE = 0.12;
  int forceLayer = layerIndex(E.L);
  // Nearest-cell Voronoi boundaries can sustain microscopic swaps. Once a
  // static field has processed an unchanged material population long enough,
  // strong-field non-gas cells park so the layer can become inactive.
  static constexpr int FORCE_EQUILIBRIUM_TICKS = 768;
  if (target != FORCE_GAS && !dynamicField[forceLayer]
      && magnitude >= CELL_STEP_FORCE
      && looseForceAge[forceLayer] >= FORCE_EQUILIBRIUM_TICKS) {
    E.L->next[k] = material;
    E.L->nextFallSpeed[k] = 0;
    E.L->nextLiquidVel[k] = 0;
    return true;
  }
  std::array<std::pair<int, int>, 3> moves;
  int moveCount = looseMoveCandidates(forceX, forceY, moves);
  auto canEnter = [&](int toK, bool followPressureVacancy = false) {
    if (E.isLiquidMaterial(material)) {
      // Radial moves reject same-material vacancies because they are not new
      // volume. Pressure chains may follow one after a frontier cell moves.
      return (followPressureVacancy
              || E.L->vacatedStamp[toK] != E.tick
              || E.L->grid[toK] != material)
          && E.liquidCanClaim(toK, material);
    }
    if (E.isGasMaterial(material)) {
      uint8_t occupant = E.L->grid[toK];
      return E.L->next[toK] == EMPTY
          && (E.L->vacatedStamp[toK] == E.tick || occupant == EMPTY
              || (E.isGasMaterial(occupant) && occupant != material))
          && !(E.L->vacatedStamp[toK] == E.tick && occupant == material);
    }
    if (followPressureVacancy) {
      if (E.L->vacatedStamp[toK] == E.tick
          && E.L->grid[toK] == material && E.L->next[toK] == EMPTY)
        return true;
      // Tangential powder flow uses the same density displacement rule as its
      // direct force step; a strictly lighter loose material is available shell
      // volume, while equal or denser material remains blocking support.
      return E.canEnterIndex(toK, material);
    }
    return E.canEnterIndex(toK, material);
  };
  int destination = -1;
  int stepX = moveCount > 0 ? moves[0].first : 0;
  int stepY = moveCount > 0 ? moves[0].second : 0;
  int pressureX = x - stepX, pressureY = y - stepY;
  bool pressureBehind = false;
  if (pressureX > 0 && pressureX < E.cols - 1
      && pressureY > 0 && pressureY < E.rows) {
    int pressureK = pressureY * E.cols + pressureX;
    pressureBehind = E.L->grid[pressureK] == material
                  && E.L->vacatedStamp[pressureK] != E.tick;
  }
  uint32_t lateralPhase = E.L->worldSeed ^ 0x4C495155u
                        ^ ((uint32_t)E.tick * 0x9e3779b9u);
  bool fanPressuredLiquid = target == FORCE_LIQUID
    && magnitude >= CELL_STEP_FORCE && pressureBehind
    && whash2(lateralPhase, E.L->worldOffsetX + x,
              E.L->worldOffsetY + y) < 0.125;
  // Pressurized liquid occasionally takes another inward route before the
  // direct radial cell, widening an incoming stream into available shell space.
  if (fanPressuredLiquid && moveCount > 0) {
    std::array<std::pair<int, int>, 2> lateralMoves;
    if (stepX && stepY) {
      lateralMoves = {{moves[1], moves[2]}};
    } else {
      lateralMoves = {{
        {stepX + stepY, stepY - stepX},
        {stepX - stepY, stepY + stepX}
      }};
    }
    if (((E.L->worldOffsetX + x) + (E.L->worldOffsetY + y)
         + E.tick) & 1)
      std::swap(lateralMoves[0], lateralMoves[1]);
    for (const auto& lateral : lateralMoves) {
      int nx = x + lateral.first, ny = y + lateral.second;
      if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows)
        continue;
      int toK = ny * E.cols + nx;
      uint8_t occupant = E.L->grid[toK];
      if (occupant != EMPTY && !E.isGasMaterial(occupant)) continue;
      if (!canEnter(toK)) continue;
      destination = toK;
      break;
    }
  }
  if (moveCount > 0) {
    int nx = x + moves[0].first, ny = y + moves[0].second;
    if (nx > 0 && nx < E.cols - 1 && ny > 0 && ny < E.rows) {
      int toK = ny * E.cols + nx;
      if (destination < 0 && canEnter(toK)) destination = toK;
    }
  }
  if (destination < 0 && moveCount > 0) {
    double minimum = looseMinForce[layerIndex(E.L)][material];
    bool forcePressureGradient = target != FORCE_GAS
      && minimum < 1e20 && magnitude > minimum + 0.015;
    if (!looseTangentialBalanced[forceLayer]
        && (pressureBehind || forcePressureGradient)) {
      std::array<std::pair<int, int>, 2> tangents = {{
        {stepY, -stepX}, {-stepY, stepX}
      }};
      if (stepX == 0 || stepY == 0) {
        for (auto& tangent : tangents) {
          tangent.first += stepX;
          tangent.second += stepY;
        }
      }
      if (((E.L->worldOffsetX + x) + (E.L->worldOffsetY + y)
           + E.tick) & 1)
        std::swap(tangents[0], tangents[1]);
      for (const auto& tangent : tangents) {
        int nx = x + tangent.first, ny = y + tangent.second;
        int innerX = nx + stepX, innerY = ny + stepY;
        if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows
            || innerX <= 0 || innerX >= E.cols - 1
            || innerY <= 0 || innerY >= E.rows)
          continue;
        int toK = ny * E.cols + nx;
        int innerK = innerY * E.cols + innerX;
        uint8_t support = E.L->grid[innerK];
        if (support == EMPTY || E.L->vacatedStamp[innerK] == E.tick
            || E.canDisplaceMaterial(material, support)
            || !canEnter(toK, true))
          continue;
        destination = toK;
        break;
      }
    }
  }
  for (int i = 1; destination < 0 && i < moveCount; i++) {
    int nx = x + moves[i].first, ny = y + moves[i].second;
    if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows) continue;
    int toK = ny * E.cols + nx;
    if (!canEnter(toK)) continue;
    destination = toK;
    break;
  }
  if (destination < 0) {
    // The field owns this cell for the tick, but a blocked cell creates no
    // follow-up wake. Static force-balanced arrangements can therefore sleep.
    E.L->next[k] = material;
    E.L->nextFallSpeed[k] = 0;
    E.L->nextLiquidVel[k] = 0;
    // Transient gases still need future ticks for their normal decay. Methane
    // is persistent and may sleep once the repulsive field has packed it.
    if (E.isGasMaterial(material) && material != METHANE)
      E.markCellIndex(k);
    return true;
  }

  if (!movementAllowed) {
    E.L->next[k] = material;
    E.L->nextFallSpeed[k] = 0;
    E.L->nextLiquidVel[k] = 0;
    E.markCellIndex(k);
    return true;
  }

  double chance = std::fmin(1.0, magnitude / CELL_STEP_FORCE);
  uint32_t phase = E.L->worldSeed ^ 0x4E455554u
                 ^ ((uint32_t)E.tick * 0x9e3779b9u);
  if (whash2(phase, E.L->worldOffsetX + x,
             E.L->worldOffsetY + y) >= chance) {
    E.markCellIndex(k);
    return false;
  }

  int32_t blastGas = material == FIRE ? E.L->blastGasStamp[k] : -1;
  bool recentBlastFire = blastGas >= 0
    && E.tick - blastGas <= ExplosivesSystem::TNT_FUSE_TICKS;
  E.moveMaterialInto(k, destination, material);
  if (recentBlastFire) E.L->blastGasStamp[destination] = blastGas;
  return true;
}
