  // Procedural terrain, chunk store, and infinite world streaming.
  //
  // Owns deterministic generation from absolute world coordinates, cached chunk
  // save/restore, prefetch, and horizontal/vertical window shifts. Camera.inc may
  // request a shift, but this subsystem decides how cells/components/entities
  // move across the loaded window.
  // Surface height, climate, and soil use the shared seed so layers align near
  // the surface. The foreground owns player-clear cave backbones; the background
  // is a mostly-solid backdrop with only rare rounded chambers.
  // Deterministic terrain queries (TerrainGen, terrain.hpp) — composed here;
  // method bodies in terrain_impl.inc. Streaming + fill passes below.
  TerrainGen terrain{*this};
  static constexpr int VILLAGE_LATTICE = WorldContextSystem::VILLAGE_LATTICE;
  static constexpr double VILLAGE_CHANCE = WorldContextSystem::VILLAGE_CHANCE;
  // Shims for the external users (player spawn, render lighting, ABI).
  inline void stampGeneratedFeatureCell(
      const GeneratedFeatureDef& feature, int index, uint8_t material) {
    if (feature.stampPolicy == GFSP_REPLACE || L->grid[index] == EMPTY)
      L->grid[index] = material;
  }

  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd).
  // A horizontal stream-in passes a column band (full rows); a vertical one passes
  // a row band (full cols); the initial fill is the whole buffer.
  // Base terrain (no trees) over the rect. Split out of fillRect so the prefetch
  // path can generate a band one column-slice at a time across frames; trees must
  // run only AFTER all of a band's terrain columns exist (a tree canopy spills over
  // sky cells, which a later terrain slice would otherwise overwrite), so they're a
  // separate pass. Each column is generated independently of the others.
  void fillTerrain(int colStart, int colEnd, int rowStart, int rowEnd) {
    int n = colEnd - colStart;
    if (n <= 0) return;
    // Precompute absolute surface heights for [colStart-1, colEnd] so each column
    // and both slope neighbours share the same cached band values.
    surfAbsScratch.resize((size_t)n + 2);
    for (int i = 0; i < n + 2; i++) surfAbsScratch[i] = terrain.genSurfaceAbs(L->worldOffsetX + colStart - 1 + i);
    for (int lx = colStart, j = 0; lx < colEnd; lx++, j++) {
      int worldX = L->worldOffsetX + lx;
      int surf = surfAbsScratch[j + 1] - L->worldOffsetY;
      int slope = std::abs(surfAbsScratch[j + 2] - surfAbsScratch[j]);
      int biome = terrain.genBiomeAt(worldX); int soil = terrain.genSoilDepthAt(worldX, biome);
      for (int y = rowStart; y < rowEnd; y++) L->grid[y * cols + lx] = terrain.genCellAt(worldX, surf, slope, biome, soil, y);
    }
  }
  template<class Put>
  static void stampEyeGlyph(Put&& put, int cx, int cy, int rx, int ry,
                            int gaze = 0) {
    for (int dy = -ry; dy <= ry; dy++) for (int dx = -rx; dx <= rx; dx++) {
      if (dx * dx * ry * ry + dy * dy * rx * rx > rx * rx * ry * ry) continue;
      int ix = imax(1, rx - 1), iy = imax(1, ry - 1);
      bool rim = dx * dx * iy * iy + dy * dy * ix * ix > ix * ix * iy * iy;
      int iris = imax(2, ry - 2), px = dx - gaze;
      uint8_t mat = rim ? EYE_WOOD : EYE_SCLERA;
      if (!rim && px * px + dy * dy <= iris * iris) {
        mat = EYE_IRIS;
        if (std::abs(px) <= imax(0, iris / 3) && std::abs(dy) < iris) mat = EYE_PUPIL;
        if (px == -1 && dy == -iris + 1) mat = EYE_SCLERA;
      } else if (!rim && std::abs(dx) > rx / 2
                 && dy == (std::abs(dx) - rx / 2) / 2) mat = EYE_WOOD;
      put(cx + dx, cy + dy, mat);
    }
  }

  // A bounded silhouette shared by seeded growth and generated trees. Each
  // target cell carries its final wood, sclera, iris, or pupil material.
  template<class Put>
  static void stampEyeTree(Put&& put, int cx, int ground, int height,
                           uint32_t seed, int worldX) {
    constexpr int reach = 20, width = reach * 2 + 1, rise = 42;
    uint8_t raster[width * rise] = {};
    auto sketch = [&](int x, int y, uint8_t material) {
      if (x < -reach || x > reach || y < -rise || y >= 0) return;
      raster[(y + rise) * width + x + reach] = material;
    };
    int top = -height;
    int ry = 5 + (int)(whash1(seed ^ 0xE7E53u, worldX) * 4);
    int lean = (int)(whash1(seed ^ 0xE7E55u, worldX) * 7) - 3;
    int rx = ry + 2 + (int)(whash1(seed ^ 0xE7E56u, worldX) * 3);
    auto trunkX = [&](int y) { return lean * -y / height; };
    for (int y = top + ry; y < 0; y++) {
      sketch(trunkX(y), y, EYE_WOOD);
      sketch(trunkX(y) + 1, y, EYE_WOOD);
    }
    double form = whash1(seed ^ 0xE7E57u, worldX);
    int branches = form < 0.4 ? 0 : form < 0.75 ? 1 : 2;
    int firstSide = whash1(seed ^ 0xE7E58u, worldX) < 0.5 ? -1 : 1;
    for (int branch = 0; branch < branches; branch++) {
      int side = branch ? -firstSide : firstSide;
      int eyeY = imin(-9, top + 10 + (int)(whash2(seed ^ 0xE7E59u, worldX, branch) * 6));
      int branchBase = imin(-2, eyeY + 8), baseX = trunkX(branchBase);
      int arm = 8 + (int)(whash2(seed ^ 0xE7E5Au, worldX, branch) * 4);
      for (int d = 0; d <= arm; d++) {
        int y = branchBase - (branchBase - eyeY - 3) * d / arm;
        sketch(baseX + side * d, y, EYE_WOOD);
        sketch(baseX + side * d, y + 1, EYE_WOOD);
      }
      stampEyeGlyph(sketch, baseX + side * arm, eyeY, 5, 3, side);
    }
    stampEyeGlyph(sketch, lean, top, rx, ry,
                  whash1(seed ^ 0xE7E54u, worldX) < 0.5 ? -1 : 1);
    for (int y = -1; y >= -rise; y--) for (int x = -reach; x <= reach; x++) {
      uint8_t material = raster[(y + rise) * width + x + reach];
      if (material != EMPTY) put(cx + x, ground + y, material);
    }
  }

  // Trees are background silhouettes over already-generated terrain. The generated
  // profile reach overscans candidate trunks so canopies span band seams.
  void fillTrees(int colStart, int colEnd, int rowStart, int rowEnd,
                 int reachX, int reachY) {
    if (!L->isBackground) return;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return; if (L->grid[y * cols + lx] == EMPTY) L->grid[y * cols + lx] = m; };
    for (int lx = colStart - reachX; lx < colEnd + reachX; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = terrain.genSurfaceAt(worldX);
      if (surf + reachY < rowStart
          || surf - reachY >= rowEnd) continue;
      // Leave a clean skyline around deterministic villages. Besides making the
      // settlement readable, this prevents background tree components from
      // overlapping the foreground buildings across simulation layers.
      bool nearVillage = false;
      int vq = floorDiv(worldX, VILLAGE_LATTICE);
      for (int v = vq - 1; v <= vq + 1; v++) {
        VillagePlan village;
        if (worldContext.villagePlan(v, village)
            && std::abs(worldX - village.center) < 252) {
          nearVillage = true;
          break;
        }
      }
      if (nearVillage) continue;
      if (!terrain.genTreeAt(worldX, surf)) continue;
      int biome = terrain.genBiomeAt(worldX);
      uint8_t pt = terrain.pickTreeType(biome, worldX);
      const PlantWorldgenProfileDef& plantProfile =
        plantWorldgenProfileForSpecies(pt);
      uint8_t wood = plantWoodMat(pt), leaf = plantLeafMat(pt);
      double hr = whash1(L->gTreeSeed + 1, worldX);
      int h = plantProfile.heightBase
        + (int)(hr * plantProfile.heightVariation);
      int top = surf - h;
      if (plantProfile.topology == PWGT_EYE) {
        stampEyeTree(put, lx, surf, h, L->gTreeSeed, worldX);
        for (int dx = -3; dx <= 3; dx++) {
          int ground = terrain.genSurfaceAt(worldX + dx);
          for (int y = surf - 4 + std::abs(dx); y < ground; y++) put(lx + dx, y, wood);
        }
        // Buried roots connect the heavy crown to the load-bearing pale stratum.
        int rootDepth = TerrainGen::GEN_SKIN + terrain.genSoilDepthAt(worldX, biome);
        for (int dx = 0; dx <= 1; dx++) {
          int x = lx + dx;
          if (x < colStart || x >= colEnd) continue;
          for (int y = imax(surf, rowStart); y <= imin(surf + rootDepth, rowEnd - 1); y++) {
            int k = y * cols + x;
            if (L->grid[k] == VEIN_SOIL) L->grid[k] = wood;
          }
        }
        continue;
      }
      auto trunkXAtHeight = [&](int height) {
        if (plantProfile.topology != PWGT_PINE
            && plantProfile.topology != PWGT_WILLOW) return lx;
        int drift = 0,
            maxDrift = plantProfile.topology == PWGT_PINE ? 2 : 3;
        for (int band = 0; band < height / 4; band++) {
          double turn = whash2(L->gTreeSeed ^ 0x54A1u, worldX, band);
          if (turn < 0.27) drift--;
          else if (turn > 0.73) drift++;
          drift = imax(-maxDrift, imin(maxDrift, drift));
        }
        return lx + drift;
      };
      for (int y = top; y < surf; y++) {
        int height = surf - y, center = trunkXAtHeight(height), radius = 0;
        if (plantProfile.topology == PWGT_PINE)
          radius = height <= 5 ? 2 : height <= 15 ? 1 : 0;
        else if (plantProfile.topology == PWGT_WILLOW)
          radius = height <= 6 ? 2 : height <= 14 ? 1 : 0;
        for (int ox = -radius; ox <= radius; ox++) put(center + ox, y, wood);
      }
      if (plantProfile.topology == PWGT_CACTUS) {       // arms, no foliage
        int armY = top + 2 + (int)(whash1(L->gTreeSeed ^ 0x3a3au, worldX) * imax(1, h - 4));
        put(lx - 1, armY, wood); put(lx - 2, armY, wood); put(lx - 2, armY - 1, wood);
        put(lx + 1, armY + 2, wood); put(lx + 2, armY + 2, wood); put(lx + 2, armY + 1, wood);
      } else if (plantProfile.topology == PWGT_PINE) {  // tapered, ragged evergreen crown
        int level = 4 + (int)(whash1(L->gTreeSeed ^ 0x91A0u, worldX) * 3);
        for (int tier = 0; tier < 9 && level < h - 1; tier++) {
          int baseX = trunkXAtHeight(level), baseY = surf - level;
          int baseReach = 3 + (h - level) * 5 / h;
          for (int side : {-1, 1}) {
            double shape = whash2(L->gTreeSeed ^ 0x91A1u, worldX + side, tier);
            int reach = imax(2, baseReach + (int)(shape * 4) - 2);
            if (shape < 0.10) continue;
            for (int i = 1; i <= reach; i++) {
              int droop = i > reach * 2 / 3 ? (i - reach * 2 / 3 + 1) / 2 : 0;
              put(baseX + side * i, baseY + droop, wood);
            }
          }
          level += 3 + (int)(whash2(L->gTreeSeed ^ 0x91A2u, worldX, tier) * 3);
        }
        int crownH = h - 4;
        for (int oy = -2; oy < crownH; oy++) {
          int y = top + oy, crownX = trunkXAtHeight(surf - y);
          double t = (double)(oy + 2) / (double)imax(1, crownH + 1);
          int rad = 1 + (int)std::floor(t * 7.0);
          // Subtle tiering breaks the cone edge without producing flat shelves.
          if (oy > 2 && oy % 5 == 0) rad = imin(8, rad + 2);
          for (int ox = -rad; ox <= rad; ox++) {
            double edge = whash2(L->gTreeSeed ^ 0x91A3u, worldX + ox, oy);
            if (std::abs(ox) <= rad - 2 || edge > 0.28) put(crownX + ox, y, leaf);
            if (std::abs(ox) < rad && oy % 4 != 1 && edge > 0.18) put(crownX + ox, y + 1, leaf);
          }
        }
      } else if (plantProfile.topology == PWGT_WILLOW) { // clustered crown + soft, irregular droops
        int crownX = trunkXAtHeight(h);
        for (int tier = 0; tier < 3; tier++) for (int side : {-1, 1}) {
          double shape = whash2(L->gTreeSeed ^ 0x7714u, worldX + side, tier);
          if (shape < 0.08) continue;
          int level = h - 3 - tier * 3 + (shape > 0.66 ? 1 : 0);
          int baseX = trunkXAtHeight(level), baseY = surf - level;
          int len = 5 + (int)(whash2(L->gTreeSeed ^ 0x7715u, worldX + side, tier) * 5);
          for (int i = 1; i <= len; i++) {
            int lift = imin(2, (i + 1) / 3);
            int sag = i > len * 2 / 3 ? (i - len * 2 / 3 + 1) / 2 : 0;
            put(baseX + side * i, baseY - lift + sag, wood);
          }
        }
        for (int cx : {-6, -3, 0, 3, 6}) {
          int cy = -2 + (std::abs(cx) / 3) + (int)(whash2(L->gTreeSeed ^ 0x7711u, worldX, cx) * 3);
          int rr = 4 + (std::abs(cx) < 4 ? 1 : 0);
          for (int oy = -rr; oy <= rr; oy++) for (int ox = -rr; ox <= rr; ox++)
            if (ox * ox + oy * oy <= rr * rr + 2) put(crownX + cx + ox, top + cy + oy, leaf);
          int drop = 2 + (int)(whash2(L->gTreeSeed ^ 0x7712u, worldX, cx) * 5);
          int sway = whash2(L->gTreeSeed ^ 0x7713u, worldX, cx) < 0.5 ? -1 : 1;
          for (int i = 1; i <= drop; i++) { put(crownX + cx + (i > drop / 2 ? sway : 0), top + cy + rr + i, leaf); if (i < drop - 1) put(crownX + cx + 1, top + cy + rr + i, leaf); }
        }
      } else if (plantProfile.topology == PWGT_BROADLEAF
                 || plantProfile.topology == PWGT_BUSH) {
        // Broadleaf and bush profiles use forked limbs and a cloud canopy.
        bool bush = plantProfile.topology == PWGT_BUSH;
        int rad = bush ? 4 : 8;
        if (!bush) for (int side : {-1, 1}) {
          int len = 4 + (int)(whash1(L->gTreeSeed ^ (side < 0 ? 0x81u : 0x82u), worldX) * 4);
          int by = top + 4 + (side < 0 ? 1 : 0);
          for (int i = 1; i <= len; i++) { put(lx + side * i, by - i / 3, wood); if (i > len / 2) put(lx + side * i, by - i / 3 - 1, leaf); }
        }
        for (int cy = -4; cy <= 2; cy += 3) for (int cx = -rad + 2; cx <= rad - 2; cx += 4)
          for (int oy = -3; oy <= 3; oy++) for (int ox = -3; ox <= 3; ox++) if (ox * ox + oy * oy <= 10) put(lx + cx + ox, top + cy + oy, leaf);
      } else __builtin_unreachable();
    }
  }
  // ---- deterministic structure stamping (ruins) -----------------------------
  // Each generated feature owns its lattice and overscan, so deterministic
  // candidates straddling a band seam are identical in whole-window and band fills.
  static int floorDiv(int a, int b) { int q = a / b, r = a % b; if (r != 0 && ((r < 0) != (b < 0))) q--; return q; }
  struct ForegroundTerrainScope {
    Layer* layer;
    bool wasBackground;
    uint32_t caveSeed;
    explicit ForegroundTerrainScope(Layer* active)
      : layer(active), wasBackground(active->isBackground), caveSeed(active->gCaveSeed) {
      if (wasBackground) {
        layer->isBackground = false;
        layer->gCaveSeed = layer->worldSeed ^ 0x5bd1e995u;
      }
    }
    ~ForegroundTerrainScope() {
      layer->isBackground = wasBackground;
      layer->gCaveSeed = caveSeed;
    }
  };
