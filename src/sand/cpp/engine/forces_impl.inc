// Spatial force emitters and neutronium attraction.

int ForceSystem::layerIndex(const Layer* layer) const {
  return layer == &E.bg ? 1 : 0;
}

uint8_t ForceSystem::layerBit(const Layer* layer) const {
  return layer == &E.bg ? FORCE_LAYER_BACKGROUND : FORCE_LAYER_FOREGROUND;
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
  looseFingerprintValid[index] = false;
  looseEquilibriumSettled[index] = false;
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
  looseFingerprintValid[index] = false;
  looseEquilibriumSettled[index] = false;
  layer->forceWakePending = true;
}

void ForceSystem::addEmitter(
    LayerState& state, const ForceEmitter& emitter) {
  if (emitter.radius <= 0 || emitter.strength == 0 || emitter.targets == 0
      || emitter.layerTargets == 0)
    return;
  state.emitters.push_back(emitter);
}

void ForceSystem::addNeutroniumEmitters(
    Layer* layer, LayerState& state) {
  if (!layer->forceSourcePresent) return;
  bool found = false;
  constexpr uint8_t targets = FORCE_POWDER | FORCE_LIQUID
                            | FORCE_RIGID | FORCE_GAS;
  auto addCluster = [&](double x, double y, int cellCount,
                        int sourceBodyId) {
    if (cellCount <= 0) return;
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
    addEmitter(state, emitter);
  };

  for (const Comp& component : layer->components) {
    if (component.cells.empty()) continue;
    double sumX = 0, sumY = 0;
    int count = 0;
    for (int k : component.cells) {
      if (k < 0 || k >= E.cols * E.rows
          || layer->grid[k] != NEUTRONIUM)
        continue;
      int y = k / E.cols;
      sumX += k - y * E.cols + 0.5;
      sumY += y + 0.5;
      count++;
    }
    if (count > 0) addCluster(sumX / count, sumY / count, count, -1);
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
    double sumX = 0, sumY = 0;
    int count = 0;
    for (int local = 0; local < (int)body->occ.size(); local++) {
      if (!body->occ[local]
          || E.rigid.bodyMaterialAt(body, local) != NEUTRONIUM)
        continue;
      double localX = body->offsetX + local % body->w;
      double localY = body->offsetY + local / body->w;
      sumX += body->px + localX * cs - localY * sn;
      sumY += body->py + localX * sn + localY * cs;
      count++;
    }
    if (count > 0) {
      addCluster(sumX / count, sumY / count, count, body->id);
      E.fg.forceWakePending = E.bg.forceWakePending = true;
      looseFingerprintValid[0] = looseFingerprintValid[1] = false;
      looseEquilibriumSettled[0] = looseEquilibriumSettled[1] = false;
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

void ForceSystem::wakeAffectedTargets(Layer* layer) {
  int index = layerIndex(layer);
  std::array<double, 256>& minForce = looseMinForce[index];
  minForce.fill(1e30);
  looseHistogram.fill(0);
  uint8_t targetLayer = layerBit(layer);
  int binCount = E.chunkCols * E.chunkRows;
  for (int bin = 0; bin < binCount; bin++) {
    if (!binAffectsLayer(states[0], bin, targetLayer)
        && !binAffectsLayer(states[1], bin, targetLayer))
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
        if (!sampleLayer(layer, x + 0.5, y + 0.5, target, -1,
                         forceX, forceY))
          continue;
        double magnitude = std::hypot(forceX, forceY);
        if (magnitude < minForce[material]) minForce[material] = magnitude;
        if (target != FORCE_GAS) {
          int quadrant = (forceX < 0 ? 1 : 0) | (forceY < 0 ? 2 : 0);
          int band = imin(3, (int)(magnitude * 8.0));
          looseHistogram[(material * 4 + quadrant) * 4 + band]++;
        }
        if (x < layer->rowMarkMin[y]) layer->rowMarkMin[y] = x;
        if (x > layer->rowMarkMax[y]) layer->rowMarkMax[y] = x;
      }
    }
  }
  for (Body* body : layer->bodies) {
    if (body->jointRole == 2) continue;
    double forceX, forceY;
    if (!sampleLayer(layer, body->px, body->py, FORCE_RIGID, body->id,
                     forceX, forceY))
      continue;
    int x = (int)std::lround(body->px), y = (int)std::lround(body->py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
    if (x < layer->rowMarkMin[y]) layer->rowMarkMin[y] = x;
    if (x > layer->rowMarkMax[y]) layer->rowMarkMax[y] = x;
  }
  uint64_t fingerprint = 1469598103934665603ull;
  for (uint32_t count : looseHistogram) {
    fingerprint ^= count;
    fingerprint *= 1099511628211ull;
  }
  if (looseFingerprintValid[index]
      && looseFingerprint[index] == fingerprint) {
    looseStableTicks[index] = (uint8_t)imin(255, looseStableTicks[index] + 1);
  } else {
    looseFingerprintValid[index] = true;
    looseFingerprint[index] = fingerprint;
    looseStableTicks[index] = 0;
    looseEquilibriumSettled[index] = false;
  }
  static constexpr int LOOSE_EQUILIBRIUM_TICKS = 32;
  if (looseStableTicks[index] >= LOOSE_EQUILIBRIUM_TICKS)
    looseEquilibriumSettled[index] = true;
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
    int x0 = imax(0, (int)std::floor(emitter.x - emitter.radius));
    int x1 = imin(E.cols - 1, (int)std::ceil(emitter.x + emitter.radius));
    int y0 = imax(0, (int)std::floor(emitter.y - emitter.radius));
    int y1 = imin(E.rows - 1, (int)std::ceil(emitter.y + emitter.radius));
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

void ForceSystem::prepareLayer(Layer* layer) {
  int index = layerIndex(layer);
  LayerState& state = states[index];
  if (!layer->forceSourcePresent && queued[index].empty()) {
    if (!state.emitters.empty()) {
      state.emitters.clear();
      state.binHeads.clear();
      state.binLinks.clear();
      // Releasing the final field must wake held loose material so ordinary
      // gravity can resume. Source removal is rare, so one full-layer wake is
      // cheaper and safer than retaining a second copy of the old force bins.
      for (Layer* target : {&E.fg, &E.bg}) {
        for (int y = 0; y < E.rows; y++) {
          target->rowMarkMin[y] = 0;
          target->rowMarkMax[y] = E.cols - 1;
        }
      }
    }
    layer->forceActive = false;
    return;
  }
  bool hadEmitters = !state.emitters.empty();
  state.emitters.clear();
  for (const ForceEmitter& emitter : queued[index]) addEmitter(state, emitter);
  queued[index].clear();
  addNeutroniumEmitters(layer, state);
  if (hadEmitters && state.emitters.empty()) {
    for (Layer* target : {&E.fg, &E.bg}) {
      for (int y = 0; y < E.rows; y++) {
        target->rowMarkMin[y] = 0;
        target->rowMarkMax[y] = E.cols - 1;
      }
    }
  }
  buildBins(state);
}

void ForceSystem::prepareWorldTick() {
  prepareLayer(&E.fg);
  if (E.bgEnabled) prepareLayer(&E.bg);
  else {
    queued[1].clear();
    states[1].emitters.clear();
    states[1].binHeads.clear();
    states[1].binLinks.clear();
  }
  if (states[0].emitters.empty() && states[1].emitters.empty()) {
    E.fg.forceActive = E.bg.forceActive = false;
    E.fg.forceWakePending = E.bg.forceWakePending = false;
    looseFingerprintValid[0] = looseFingerprintValid[1] = false;
    looseEquilibriumSettled[0] = looseEquilibriumSettled[1] = false;
    looseStableTicks[0] = looseStableTicks[1] = 0;
    return;
  }
  E.fg.forceActive = stateAffectsLayer(states[0], FORCE_LAYER_FOREGROUND)
                  || stateAffectsLayer(states[1], FORCE_LAYER_FOREGROUND);
  E.bg.forceActive = E.bgEnabled
                  && (stateAffectsLayer(states[0], FORCE_LAYER_BACKGROUND)
                      || stateAffectsLayer(states[1], FORCE_LAYER_BACKGROUND));
  bool wakeForeground = E.fg.forceWakePending;
  bool wakeBackground = E.bg.forceWakePending;
  E.fg.forceWakePending = E.bg.forceWakePending = false;
  if (E.fg.forceActive && wakeForeground) wakeAffectedTargets(&E.fg);
  if (E.bg.forceActive && wakeBackground) wakeAffectedTargets(&E.bg);
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
    if (!(emitter.targets & target) || !(emitter.layerTargets & targetLayer)
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

bool ForceSystem::sampleLayer(
    Layer* layer, double x, double y, uint8_t target, int sourceBodyId,
    double& forceX, double& forceY) const {
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
  return forceX * forceX + forceY * forceY > 1e-12;
}

bool ForceSystem::sample(
    double x, double y, uint8_t target, int sourceBodyId,
    double& forceX, double& forceY) const {
  return sampleLayer(E.L, x, y, target, sourceBodyId, forceX, forceY);
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
    int x, int y, uint8_t material) const {
  uint8_t target = E.isLiquidMaterial(material) ? FORCE_LIQUID
                 : E.isGasMaterial(material) ? FORCE_GAS : FORCE_POWDER;
  double forceX, forceY;
  if (!sampleLayer(E.L, x + 0.5, y + 0.5, target, -1,
                   forceX, forceY))
    return false;
  constexpr double CELL_STEP_FORCE = 0.12;
  return forceX * forceX + forceY * forceY
      >= CELL_STEP_FORCE * CELL_STEP_FORCE;
}

void ForceSystem::applyBodyForces() {
  if (!E.L->forceActive) return;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    double forceX, forceY;
    if (!sample(body->px, body->py, FORCE_RIGID, body->id,
                forceX, forceY))
      continue;
    E.rigid.wakeBody(body);
    body->vx += forceX;
    body->vy += forceY;
  }
}

bool ForceSystem::tryMoveLoose(
    int x, int y, int k, uint8_t material, bool movementAllowed) {
  uint8_t target = E.isLiquidMaterial(material) ? FORCE_LIQUID
                 : E.isGasMaterial(material) ? FORCE_GAS : FORCE_POWDER;
  double forceX, forceY;
  if (!sample(x + 0.5, y + 0.5, target, -1, forceX, forceY)) return false;
  double magnitude = std::hypot(forceX, forceY);
  constexpr double CELL_STEP_FORCE = 0.12;
  int forceLayer = layerIndex(E.L);
  if (target != FORCE_GAS && looseEquilibriumSettled[forceLayer]
      && magnitude >= CELL_STEP_FORCE) {
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
    if (followPressureVacancy && E.L->vacatedStamp[toK] == E.tick
        && E.L->grid[toK] == material && E.L->next[toK] == EMPTY)
      return true;
    return E.canEnterIndex(toK, material);
  };
  int destination = -1;
  if (moveCount > 0) {
    int nx = x + moves[0].first, ny = y + moves[0].second;
    if (nx > 0 && nx < E.cols - 1 && ny > 0 && ny < E.rows) {
      int toK = ny * E.cols + nx;
      if (canEnter(toK)) destination = toK;
    }
  }
  if (destination < 0 && moveCount > 0) {
    int stepX = moves[0].first, stepY = moves[0].second;
    int pressureX = x - stepX, pressureY = y - stepY;
    bool pressureBehind = false;
    if (pressureX > 0 && pressureX < E.cols - 1
        && pressureY > 0 && pressureY < E.rows) {
      int pressureK = pressureY * E.cols + pressureX;
      pressureBehind = E.L->grid[pressureK] == material
                    && E.L->vacatedStamp[pressureK] != E.tick;
    }
    double minimum = looseMinForce[layerIndex(E.L)][material];
    bool liquidPressureGradient = E.isLiquidMaterial(material)
      && minimum < 1e20 && magnitude > minimum + 0.015;
    if (!looseEquilibriumSettled[forceLayer]
        && (pressureBehind || liquidPressureGradient)) {
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
      E.L->forceWakePending = true;
    return true;
  }

  if (!movementAllowed) {
    E.L->next[k] = material;
    E.L->nextFallSpeed[k] = 0;
    E.L->nextLiquidVel[k] = 0;
    E.L->forceWakePending = true;
    return true;
  }

  double chance = std::fmin(1.0, magnitude / CELL_STEP_FORCE);
  uint32_t phase = E.L->worldSeed ^ 0x4E455554u
                 ^ ((uint32_t)E.tick * 0x9e3779b9u);
  if (whash2(phase, E.L->worldOffsetX + x,
             E.L->worldOffsetY + y) >= chance) {
    E.L->forceWakePending = true;
    return false;
  }

  int32_t blastGas = material == FIRE ? E.L->blastGasStamp[k] : -1;
  bool recentBlastFire = blastGas >= 0
    && E.tick - blastGas <= ExplosivesSystem::TNT_FUSE_TICKS;
  E.moveMaterialInto(k, destination, material);
  if (recentBlastFire) E.L->blastGasStamp[destination] = blastGas;
  E.L->forceWakePending = true;
  return true;
}
