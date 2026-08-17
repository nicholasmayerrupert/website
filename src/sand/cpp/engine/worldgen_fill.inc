  // The one authoritative generation pipeline. Predictive generation supplies
  // base terrain in slices and resumes here with terrainReady=true; synchronous
  // generation runs the same ordered passes from the beginning. `copyToNext` is
  // false only for the isolated prefetch scratch grid.
  void runGenerationPipeline(int colStart, int colEnd,
                             int rowStart, int rowEnd,
                             bool terrainReady, bool copyToNext) {
    if (!terrainReady)
      fillTerrain(colStart, colEnd, rowStart, rowEnd);
    uint32_t profileBit = 1u << planetDef(planetId).generationProfile;
    for (const WorldGenerationStageDef& stage : WORLD_GENERATION_STAGES) {
      if ((stage.generationProfileMask & profileBit) == 0) continue;
      stage.run(*this, stage, colStart, colEnd, rowStart, rowEnd);
    }
    if (copyToNext)
      copyGridToNext(colStart, colEnd, rowStart, rowEnd);
  }

  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    runGenerationPipeline(colStart, colEnd, rowStart, rowEnd,
                          false, true);
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).
