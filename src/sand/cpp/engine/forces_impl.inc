// Spatial force emitters and neutronium attraction.

int ForceSystem::layerIndex(const Layer* layer) const {
  return layer == &E.bg ? 1 : 0;
}

void ForceSystem::queueRadial(
    Layer* layer, double x, double y, float radius, float strength,
    uint8_t targets, int sourceBodyId) {
  if (!layer || radius <= 0 || strength == 0 || targets == 0) return;
  ForceEmitter emitter;
  emitter.x = x;
  emitter.y = y;
  emitter.radius = radius;
  emitter.strength = strength;
  emitter.kind = FORCE_RADIAL;
  emitter.targets = targets;
  emitter.sourceBodyId = sourceBodyId;
  queued[layerIndex(layer)].push_back(emitter);
}

void ForceSystem::queueDirectional(
    Layer* layer, double x, double y, float radius, float strength,
    float directionX, float directionY, uint8_t targets, int sourceBodyId) {
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
  emitter.sourceBodyId = sourceBodyId;
  queued[layerIndex(layer)].push_back(emitter);
}

void ForceSystem::addEmitter(
    LayerState& state, const ForceEmitter& emitter) {
  if (emitter.radius <= 0 || emitter.strength == 0 || emitter.targets == 0)
    return;
  state.emitters.push_back(emitter);
}

void ForceSystem::addNeutroniumEmitters(
    Layer* layer, LayerState& state) {
  if (!layer->forceSourcePresent) return;
  bool found = false;
  constexpr uint8_t targets = FORCE_POWDER | FORCE_LIQUID | FORCE_RIGID;
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
    if (count > 0)
      addCluster(sumX / count, sumY / count, count, body->id);
  }
  layer->forceSourcePresent = found;
}

void ForceSystem::wakeAffectedTargets(
    Layer* layer, const LayerState& state) {
  for (int bin = 0; bin < (int)state.binHeads.size(); bin++) {
    if (state.binHeads[bin] < 0) continue;
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
                       : E.isLooseSolidMaterial(material) ? FORCE_POWDER : 0;
        if (!target) continue;
        double forceX, forceY;
        if (!sampleState(state, x + 0.5, y + 0.5, target, -1,
                         forceX, forceY))
          continue;
        if (x < layer->rowMarkMin[y]) layer->rowMarkMin[y] = x;
        if (x > layer->rowMarkMax[y]) layer->rowMarkMax[y] = x;
      }
    }
  }
  for (Body* body : layer->bodies) {
    if (body->jointRole == 2) continue;
    double forceX, forceY;
    if (!sampleState(state, body->px, body->py, FORCE_RIGID, body->id,
                     forceX, forceY))
      continue;
    int x = (int)std::lround(body->px), y = (int)std::lround(body->py);
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
    if (x < layer->rowMarkMin[y]) layer->rowMarkMin[y] = x;
    if (x > layer->rowMarkMax[y]) layer->rowMarkMax[y] = x;
  }
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
    }
    layer->forceActive = false;
    return;
  }
  state.emitters.clear();
  for (const ForceEmitter& emitter : queued[index]) addEmitter(state, emitter);
  queued[index].clear();
  addNeutroniumEmitters(layer, state);
  layer->forceActive = !state.emitters.empty();
  buildBins(state);
  wakeAffectedTargets(layer, state);
}

void ForceSystem::prepareWorldTick() {
  prepareLayer(&E.fg);
  if (E.bgEnabled) prepareLayer(&E.bg);
  else queued[1].clear();
}

bool ForceSystem::sampleState(
    const LayerState& state, double x, double y,
    uint8_t target, int sourceBodyId,
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
    if (!(emitter.targets & target)
        || (sourceBodyId >= 0 && emitter.sourceBodyId == sourceBodyId))
      continue;
    double dx = emitter.x - x, dy = emitter.y - y;
    double distance2 = dx * dx + dy * dy;
    double radius2 = (double)emitter.radius * emitter.radius;
    if (distance2 >= radius2) continue;
    double distance = std::sqrt(distance2);
    double falloff = 1.0 - distance / emitter.radius;
    double magnitude = emitter.strength * falloff * falloff;
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

bool ForceSystem::sample(
    double x, double y, uint8_t target, int sourceBodyId,
    double& forceX, double& forceY) const {
  return sampleState(states[layerIndex(E.L)], x, y, target, sourceBodyId,
                     forceX, forceY);
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
    int x, int y, int k, uint8_t material) {
  uint8_t target = E.isLiquidMaterial(material) ? FORCE_LIQUID : FORCE_POWDER;
  double forceX, forceY;
  if (!sample(x + 0.5, y + 0.5, target, -1, forceX, forceY)) return false;
  double magnitude = std::hypot(forceX, forceY);
  double chance = std::fmin(1.0, magnitude / 0.12);
  uint32_t phase = E.L->worldSeed ^ 0x4E455554u
                 ^ ((uint32_t)E.tick * 0x9e3779b9u);
  if (whash2(phase, E.L->worldOffsetX + x,
             E.L->worldOffsetY + y) >= chance)
    return false;

  int stepX = forceX > 1e-9 ? 1 : (forceX < -1e-9 ? -1 : 0);
  int stepY = forceY > 1e-9 ? 1 : (forceY < -1e-9 ? -1 : 0);
  double absX = std::fabs(forceX), absY = std::fabs(forceY);
  std::array<std::pair<int, int>, 3> moves;
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
  for (int i = 0; i < moveCount; i++) {
    int nx = x + moves[i].first, ny = y + moves[i].second;
    if (nx <= 0 || nx >= E.cols - 1 || ny <= 0 || ny >= E.rows) continue;
    int toK = ny * E.cols + nx;
    bool canEnter = E.isLiquidMaterial(material)
      ? E.liquidCanClaim(toK, material)
      : E.canEnterIndex(toK, material);
    if (!canEnter) continue;
    E.moveMaterialInto(k, toK, material);
    return true;
  }
  return false;
}
