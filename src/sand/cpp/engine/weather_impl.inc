// Authoritative weather effects.

const WeatherSystem::WeatherProfile& WeatherSystem::profileFor(
    WeatherKind requestedKind) {
  // New event kinds extend this table and provide either a shared precipitation
  // handler or a purpose-built handler without changing step orchestration.
  static const std::array<WeatherProfile, 2> profiles = {{
    {WK_CLEAR, nullptr, EMPTY, 0, 0, 0, 0, 0, false},
    {WK_RAIN, &WeatherSystem::updatePrecipitation, WATER,
     4, 1, 8, 384, 24, true},
  }};
  for (const WeatherProfile& profile : profiles)
    if (profile.kind == requestedKind) return profile;
  return profiles[0];
}

void WeatherSystem::setKind(int value) {
  WeatherKind next = isWeatherKindValue(value)
    ? static_cast<WeatherKind>(value) : WK_CLEAR;
  if (kind == next) return;
  kind = next;
  // A newly-started event waits for its next complete cadence bucket. Tracking
  // buckets (rather than exact modulo ticks) also tolerates split-clock callers
  // that do not sample stepWorld on every actor tick.
  const WeatherProfile& profile = profileFor(kind);
  lastCadenceBucket = profile.cadence
    ? E.actorTick / profile.cadence
    : -1;
}

void WeatherSystem::update() {
  if (E.storageRole == ESR_PRESENTATION) return;
  const WeatherProfile& profile = profileFor(kind);
  if (!profile.update || (profile.earthOnly && E.planetId != PL_EARTH)) return;
  if (E.cam.viewportCols <= 0 || E.cam.viewportRows <= 0) return;

  // actorTick advances on every authority turn even when the cellular world is
  // asleep. World tick cannot drive this cadence because its quiet-world gate
  // is precisely what weather must be able to wake.
  if (!profile.cadence) return;
  const int sourceTick = E.actorTick;
  const int cadenceBucket = sourceTick / profile.cadence;
  if (cadenceBucket == lastCadenceBucket) return;
  lastCadenceBucket = cadenceBucket;

  Engine::ActiveLayerScope active(E, &E.fg, &E.fg);
  (this->*profile.update)(profile);
}

void WeatherSystem::updatePrecipitation(const WeatherProfile& profile) {
  if (!isMaterialId(profile.precipitationMaterial)
      || profile.precipitationMaterial == EMPTY
      || profile.dropsPerCadence == 0 || profile.attemptsPerDrop == 0)
    return;

  int visibleX0 = (int)std::floor(E.cam.camX);
  int visibleX1 = (int)std::ceil(E.cam.camX + E.cam.viewportCols) - 1;
  int visibleTop = (int)std::floor(E.cam.camY);
  int visibleBottom = (int)std::ceil(E.cam.camY + E.cam.viewportRows) - 1;
  visibleX0 = imax(2, visibleX0);
  visibleX1 = imin(E.cols - 3, visibleX1);
  visibleTop = imax(1, visibleTop);
  visibleBottom = imin(E.rows - 3, visibleBottom);
  if (visibleX1 < visibleX0 || visibleBottom <= visibleTop) return;

  // Physical accumulation stays in a bounded central slice at extreme zoom.
  // Cosmetic rain can still cover the full canvas without waking simulation
  // across an arbitrarily large loaded window.
  int spawnWidth = visibleX1 - visibleX0 + 1;
  if (spawnWidth > profile.maxSpawnSpan) {
    int center = (visibleX0 + visibleX1) / 2;
    visibleX0 = center - profile.maxSpawnSpan / 2;
    visibleX1 = visibleX0 + profile.maxSpawnSpan - 1;
    spawnWidth = profile.maxSpawnSpan;
  }

  const int absoluteLeft = E.fg.worldOffsetX + visibleX0;
  const int absoluteRight = E.fg.worldOffsetX + visibleX1;
  const int absoluteViewTop = E.fg.worldOffsetY + visibleTop;
  const int absoluteViewBottom = E.fg.worldOffsetY + visibleBottom;
  const uint32_t weatherSeed = E.fg.infinite ? E.fg.worldSeed : sourceSeed;
  const uint32_t tickSeed = weatherSeed ^ 0x71A17E5Du
    ^ (uint32_t)E.actorTick * 0x9e3779b9u;

  CellMutationBatch mutations(E, removedScratch);
  for (int drop = 0; drop < profile.dropsPerCadence; drop++) {
    for (int attempt = 0; attempt < profile.attemptsPerDrop; attempt++) {
      const int ordinal = drop * profile.attemptsPerDrop + attempt;
      const uint32_t candidateSeed = tickSeed
        ^ (uint32_t)ordinal * 0x85ebca6bu;
      const double pick = whash2(
        candidateSeed, absoluteLeft, absoluteRight + ordinal);
      const int absoluteX = absoluteLeft
        + imin(spawnWidth - 1, (int)(pick * spawnWidth));
      const int localX = absoluteX - E.fg.worldOffsetX;
      const bool generatedWorld = E.fg.infinite;
      const int surface = generatedWorld
        ? E.terrain.genSurfaceAbs(absoluteX)
        : absoluteViewTop + 1;
      const int absoluteY = generatedWorld
        ? imax(absoluteViewTop + 1, surface - profile.surfaceClearance)
        : absoluteViewTop + 1;
      const int localY = absoluteY - E.fg.worldOffsetY;

      // Generated worlds source rain above their stable procedural surface;
      // bounded sandboxes source it just inside the visible top edge.
      if ((generatedWorld
            && (absoluteY >= surface || absoluteY >= E.fg.gSeaRow))
          || absoluteY > absoluteViewBottom
          || localX < 2 || localX > E.cols - 3
          || localY < 2 || localY > E.rows - 3)
        continue;

      // Current loaded geometry, rather than procedural terrain alone, decides
      // whether this column is exposed to the sky. Gas is transparent to rain;
      // any solid, liquid, loose material, or rigid-body raster blocks it.
      bool exposedToSky = true;
      for (int scanY = localY - 1; scanY >= 1; scanY--) {
        const uint8_t overhead = E.fg.grid[E.I(localX, scanY)];
        if (overhead != EMPTY && !E.isGasMaterial(overhead)) {
          exposedToSky = false;
          break;
        }
      }
      if (!exposedToSky) continue;
      const int cell = E.I(localX, localY);
      if (E.fg.grid[cell] != EMPTY) continue;
      if (mutations.replaceLoose(cell, profile.precipitationMaterial)) break;
    }
  }
  mutations.commitGeneral();
}
