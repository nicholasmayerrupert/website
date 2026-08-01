  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    fillTerrain(colStart, colEnd, rowStart, rowEnd);
    if (planetId == PL_SHIP) {
      fillSpaceship(colStart, colEnd, rowStart, rowEnd);
      copyGridToNext(colStart, colEnd, rowStart, rowEnd);
      return;
    }
    if (planetId != PL_EARTH) {
      fillOffworldStructures(colStart, colEnd, rowStart, rowEnd);
      copyGridToNext(colStart, colEnd, rowStart, rowEnd);
      return;
    }
    fillCaveFeatures(colStart, colEnd, rowStart, rowEnd);
    fillDeepCaveFeatures(colStart, colEnd, rowStart, rowEnd);
    fillOceanFlora(colStart, colEnd, rowStart, rowEnd);
    fillStructures(colStart, colEnd, rowStart, rowEnd); // keep constructed interiors clear of natural cave dressing
    fillDeepStructures(colStart, colEnd, rowStart, rowEnd);
    sealHazardBoundaries(colStart, colEnd, rowStart, rowEnd);
    fillTrees(colStart, colEnd, rowStart, rowEnd);
    copyGridToNext(colStart, colEnd, rowStart, rowEnd);
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).

