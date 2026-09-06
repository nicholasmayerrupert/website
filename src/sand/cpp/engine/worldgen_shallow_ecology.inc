  // Shallow gardens follow the foreground cave contour, painted into the
  // simulated background wall so roots and fossils leave walking space clear.
  void fillShallowCaveEcology(int colStart, int colEnd, int rowStart, int rowEnd,
                             int reachX, int reachY) {
    if (!L->isBackground) return;
    ForegroundTerrainScope foregroundQuery(L);
    constexpr int lattice = 22;
    uint32_t seed = L->worldSeed ^ 0x6E01080u;
    int gx0 = floorDiv(L->worldOffsetX + colStart - reachX, lattice);
    int gx1 = floorDiv(L->worldOffsetX + colEnd + reachX, lattice);
    int gy0 = floorDiv(L->worldOffsetY + rowStart - reachY, lattice);
    int gy1 = floorDiv(L->worldOffsetY + rowEnd + reachY, lattice);
    for (int gy = gy0; gy <= gy1; gy++) for (int gx = gx0; gx <= gx1; gx++) {
      int wx = gx * lattice + (int)(whash2(seed, gx, gy) * lattice);
      int wy = gy * lattice + (int)(whash2(seed ^ 1u, gx, gy) * lattice);
      if (wy < terrain.genCaveTopAbs(wx)
          || whash2(seed ^ 2u, gx, gy) > terrain.genUndergroundStrength(wx, wy) * .78) continue;
      int biome = terrain.genBiomeAt(wx);
      const auto& def = surfaceBiomeDef(biome);
      bool ceiling = biome == BIOME_WATCHWOOD || def.undergroundFlora == VINE
                   || whash2(seed ^ 3u, gx, gy) < .35;
      int dir = ceiling ? 1 : -1, rootY = 0;
      bool found = false;
      for (int dy = -9; dy <= 9; dy++) {
        int y = wy + dy;
        if (terrain.genOpenCaveAt(wx, y) && !terrain.genOpenCaveAt(wx, y - dir)) {
          rootY = y - dir;
          found = true;
          break;
        }
      }
      if (!found || rootY < terrain.genCaveTopAbs(wx)) continue;
      WorldBounds bounds{wx - 12, rootY - 20, wx + 12, rootY + 20};
      if (worldContext.overlapsConstruction(bounds)) continue;
      auto put = [&](int x, int y, uint8_t mat) {
        if (y != rootY && !terrain.genOpenCaveAt(x, y)) return;
        int lx = x - L->worldOffsetX, ly = y - L->worldOffsetY;
        if (lx < colStart || lx >= colEnd || ly < rowStart || ly >= rowEnd) return;
        L->grid[ly * cols + lx] = mat;
      };
      int height = 5 + (int)(whash2(seed ^ 4u, gx, gy) * 9);
      int side = whash2(seed ^ 5u, gx, gy) < .5 ? -1 : 1;
      if (biome == BIOME_WATCHWOOD) {
        int tipX = wx, tipY = rootY;
        for (int i = 0; i <= height; i++) {
          int x = wx + side * (i * i / (height * 4)), y = rootY + i;
          if (i && !terrain.genOpenCaveAt(x, y)) break;
          put(x, y, EYE_WOOD); put(x - side, y, EYE_WOOD);
          if (i > 2 && i % 4 == 0) put(x + side, y, VIOLET_FROND);
          tipX = x; tipY = y;
        }
        if (tipY > rootY + 5) {
          stampEyeGlyph(put, tipX, tipY, 3 + (gx & 1), 2, side);
          put(tipX, tipY + 2, TEAL_LICHEN);
        }
      } else if (biome == BIOME_ROCKY) {
        // Curved vertebrae and short ribs rise from a buried mineral root.
        for (int i = 0; i <= height; i++) {
          int x = wx + side * (i * i / (height * 3)), y = rootY + dir * i;
          if (i && !terrain.genOpenCaveAt(x, y)) break;
          put(x, y, BONE); put(x - side, y, PALESTONE);
          if (i > 1 && i % 3 == 0) for (int b = 1; b <= 3; b++)
            put(x + side * b, y + dir * (b / 3), b == 3 ? OCHRE_REED : BONE);
          if (i < 4) put(x - side * 2, y, RUST_BRAMBLE);
        }
      } else if (def.undergroundFlora == CRYSTAL) {
        for (int branch = -1; branch <= 1; branch++) {
          int length = branch == 0 ? height : height / 2 + (branch + 1);
          for (int i = 0; i <= length; i++) {
            int x = wx + branch, y = rootY + dir * i;
            if (i && !terrain.genOpenCaveAt(x, y)) break;
            put(x, y, i < 2 ? def.undergroundAccent : CRYSTAL);
          }
        }
      } else {
        // Unequal rootlets, moss fans, and sparse berries soften the rock.
        for (int branch = -1; branch <= 1; branch++) {
          int length = branch == 0 ? height : 2 + height / (branch < 0 ? 2 : 3);
          for (int i = 0; i <= length; i++) {
            int x = wx + branch, y = rootY + dir * i;
            if (i && !terrain.genOpenCaveAt(x, y)) break;
            put(x, y, i < 2 ? def.undergroundRock : def.undergroundFlora);
            if (i > 2 && i % 5 == 0) put(x + branch, y, biome == BIOME_SWAMP ? TEAL_LICHEN : MOSS);
            if (branch == 0 && i == length && whash2(seed ^ 6u, gx, gy) < .28)
              put(x, y, GLOWBERRY);
          }
        }
      }
    }
  }
