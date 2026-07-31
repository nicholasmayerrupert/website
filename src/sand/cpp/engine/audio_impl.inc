void AudioSystem::emit(uint8_t type, double localX, double localY, double intensity,
                       uint8_t material, int layer) {
  // Presentation mirrors must never invent gameplay events while predicting a
  // player or applying replicated state. Only an authority records them.
  if (E.storageRole == ESR_PRESENTATION || intensity <= 0) return;
  layer = layer < 0 ? (E.L == &E.bg ? 1 : 0) : (layer ? 1 : 0);
  Layer& lay = layer ? E.bg : E.fg;
  float wx = (float)(lay.worldOffsetX + localX);
  float wy = (float)(lay.worldOffsetY + localY);
  float strength = (float)std::max(0.0, std::min(4.0, intensity));

  // Dense brushes, contact manifolds, and TNT chains can report several nearby
  // facts in one tick. Merge only like events in a small neighbourhood; unlike
  // events remain distinct and the simulation never waits on audio capacity.
  // Weapon impacts are intentionally exempt: each projectile detonation must
  // reach the mixer, even when several rounds land together.
  const float mergeRadius = type == SE_EXPLOSION ? 12.0f
                          : type == SE_FLUID_FALL || type == SE_POWDER_MOVE ? 10.0f
                          : type == SE_ACID_DISSOLVE ? 7.0f
                          : type == SE_IMPACT || type == SE_SOLID_LAND ? 4.0f : 2.0f;
  const float mergeRadius2 = mergeRadius * mergeRadius;
  int serial = std::max(E.tick, E.actorTick);
  if (type != SE_WEAPON_EXPLOSION) {
    for (auto it = events.rbegin(); it != events.rend(); ++it) {
      if (it->tick != serial) break;
      if (it->type != type || it->material != material || it->layer != layer) continue;
      float dx = it->x - wx, dy = it->y - wy;
      if (dx * dx + dy * dy > mergeRadius2) continue;
      float old = it->intensity, total = old + strength;
      if (total > 0) { it->x = (it->x * old + wx * strength) / total; it->y = (it->y * old + wy * strength) / total; }
      it->intensity = std::min(4.0f, old + strength * 0.55f);
      return;
    }
  }
  if ((int)events.size() >= MAX_EVENTS) return;
  events.push_back({type, wx, wy, strength, material, (uint8_t)layer, serial});
}

void AudioSystem::beginRegionalPass() { regionalEventCount = 0; }

void AudioSystem::noteRegional(uint8_t type, uint8_t material, int x, int y,
                               double weight, double mergeRadius) {
  if (weight <= 0 || E.storageRole == ESR_PRESENTATION) return;
  // A saturated pass already has the maximum representable set of regional
  // sounds. Stop accepting per-cell facts instead of searching all slots for
  // every later cell in a broad falling-liquid or powder front.
  if (regionalEventCount >= MAX_REGIONAL_EVENTS) return;
  int layer = E.L == &E.bg ? 1 : 0;
  const double mergeRadius2 = mergeRadius * mergeRadius;
  for (int i = 0; i < regionalEventCount; i++) {
    RegionalEvent& region = regionalEvents[i];
    if (region.type != type || region.material != material || region.layer != layer) continue;
    double cx = region.x / region.weight, cy = region.y / region.weight;
    double dx = cx - x, dy = cy - y;
    if (dx * dx + dy * dy > mergeRadius2) continue;
    region.x += x * weight; region.y += y * weight; region.weight += weight;
    return;
  }
  regionalEvents[regionalEventCount++] = {
    type, material, (uint8_t)layer, x * weight, y * weight, weight
  };
}

void AudioSystem::noteFluidFall(uint8_t material, int x, int y, int fallCells) {
  noteRegional(SE_FLUID_FALL, material, x, y, fallCells, 10.0);
}

void AudioSystem::notePowderMove(uint8_t material, int x, int y, int moveCells) {
  noteRegional(SE_POWDER_MOVE, material, x, y, moveCells, 10.0);
}

void AudioSystem::noteAcidDissolve(int x, int y) {
  noteRegional(SE_ACID_DISSOLVE, ACID, x, y, 1.0, 7.0);
}

void AudioSystem::flushRegionalPass() {
  for (int i = 0; i < regionalEventCount; i++) {
    const RegionalEvent& region = regionalEvents[i];
    if (region.weight <= 0) continue;
    double intensity = region.type == SE_ACID_DISSOLVE
      ? std::min(1.7, 0.28 + std::sqrt(region.weight) * 0.18)
      : region.type == SE_POWDER_MOVE
        ? std::min(1.25, 0.08 + std::sqrt(region.weight) * 0.065)
        : std::min(1.35, 0.1 + std::sqrt(region.weight) * 0.085);
    emit(region.type, region.x / region.weight, region.y / region.weight,
         intensity, region.material, region.layer);
  }
  regionalEventCount = 0;
}

int AudioSystem::buildAndDrainSnapshot() {
  snapshot.assign(events.size() * SND_STRIDE, 0.0f);
  for (size_t i = 0; i < events.size(); i++) {
    const SoundEventRecord& e = events[i];
    float* out = snapshot.data() + i * SND_STRIDE;
    out[SND_TYPE] = (float)e.type;
    out[SND_X] = e.x; out[SND_Y] = e.y; out[SND_INTENSITY] = e.intensity;
    out[SND_MATERIAL] = (float)e.material; out[SND_LAYER] = (float)e.layer;
  }
  int count = (int)events.size();
  events.clear();
  return count;
}

void AudioSystem::sampleAmbience(double localX, double localY, int radius, float* out) {
  if (!out) return;
  std::fill(out, out + AMBIENCE_GROUPS * AMBIENCE_STRIDE, 0.0f);
  radius = imax(8, imin(96, radius));
  int cx = (int)std::floor(localX), cy = (int)std::floor(localY);
  int x0 = imax(1, cx - radius), x1 = imin(E.cols - 2, cx + radius);
  int y0 = imax(1, cy - radius), y1 = imin(E.rows - 1, cy + radius);
  // A two-cell stride caps this at ~9k probes per layer at the largest radius.
  // It runs at 8 Hz from JS, independently of world size and browser zoom.
  double amount[AMBIENCE_GROUPS] = {0}, sumX[AMBIENCE_GROUPS] = {0}, sumY[AMBIENCE_GROUPS] = {0};
  auto scan = [&](Layer& lay, double layerGain) {
    for (int y = y0; y <= y1; y += 2) for (int x = x0; x <= x1; x += 2) {
      uint8_t m = lay.grid[y * E.cols + x];
      int group = -1;
      if (m == WATER || m == BRINE) group = 0;
      else if (m == FIRE) group = 1;
      else if (m == LAVA) group = 2;
      else if (m == ACID) group = 3;
      if (group < 0) continue;
      double dx = x - localX, dy = y - localY;
      double distanceGain = 1.0 - std::min(1.0, std::sqrt(dx * dx + dy * dy) / radius);
      double w = layerGain * (0.25 + 0.75 * distanceGain);
      amount[group] += w; sumX[group] += (lay.worldOffsetX + x) * w; sumY[group] += (lay.worldOffsetY + y) * w;
    }
  };
  scan(E.fg, 1.0);
  if (E.bgEnabled) scan(E.bg, 0.45);
  for (int group = 0; group < AMBIENCE_GROUPS; group++) {
    int o = group * AMBIENCE_STRIDE;
    // Around 70 sampled cells reaches full bed volume; sqrt keeps small sources audible.
    out[o] = (float)std::min(1.0, std::sqrt(amount[group] / 70.0));
    out[o + 1] = amount[group] > 0 ? (float)(sumX[group] / amount[group]) : (float)(E.fg.worldOffsetX + localX);
    out[o + 2] = amount[group] > 0 ? (float)(sumY[group] / amount[group]) : (float)(E.fg.worldOffsetY + localY);
  }
}
