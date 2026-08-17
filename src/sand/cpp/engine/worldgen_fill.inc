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

  static constexpr int HAZARD_GENERATION_HALO = 1;
  void generationRectWithHazardHalo(
      int colStart, int colEnd, int rowStart, int rowEnd,
      int& genColStart, int& genColEnd,
      int& genRowStart, int& genRowEnd) const {
    genColStart = imax(0, colStart - HAZARD_GENERATION_HALO);
    genColEnd = imin(cols, colEnd + HAZARD_GENERATION_HALO);
    genRowStart = imax(0, rowStart - HAZARD_GENERATION_HALO);
    genRowEnd = imin(rows, rowEnd + HAZARD_GENERATION_HALO);
  }

  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    // Generate the local hazard context, then restore it so only the requested
    // rectangle becomes part of the loaded world.
    int genColStart, genColEnd, genRowStart, genRowEnd;
    generationRectWithHazardHalo(
      colStart, colEnd, rowStart, rowEnd,
      genColStart, genColEnd, genRowStart, genRowEnd);
    std::vector<std::pair<int, uint8_t>> savedHalo;
    size_t generatedCells = (size_t)(genColEnd - genColStart)
                          * (size_t)(genRowEnd - genRowStart);
    size_t requestedCells = (size_t)(colEnd - colStart)
                          * (size_t)(rowEnd - rowStart);
    savedHalo.reserve(generatedCells - requestedCells);
    for (int y = genRowStart; y < genRowEnd; y++)
      for (int x = genColStart; x < genColEnd; x++) {
        if (x >= colStart && x < colEnd
            && y >= rowStart && y < rowEnd) continue;
        int k = y * cols + x;
        savedHalo.push_back({k, L->grid[k]});
      }
    runGenerationPipeline(genColStart, genColEnd, genRowStart, genRowEnd,
                          false, false);
    for (const auto& cell : savedHalo) L->grid[cell.first] = cell.second;
    copyGridToNext(colStart, colEnd, rowStart, rowEnd);
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).
