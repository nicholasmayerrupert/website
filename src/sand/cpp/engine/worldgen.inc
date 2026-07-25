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
  // Shims for the external users (player spawn, render lighting, ABI).
  int genSurfaceAt(int worldX) { return terrain.genSurfaceAt(worldX); }
  int genSurfaceAbs(int worldX) { return terrain.genSurfaceAbs(worldX); }

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
    // genSurfaceAbs is multi-octave value noise. The original evaluated genSurfaceAt
    // 3x per column (self + both neighbours for the slope), so each boundary height
    // was recomputed for the adjacent column too. Precompute the band's absolute
    // surface once for [colStart-1, colEnd] and read neighbours from it: byte-identical
    // heights (genSurfaceAt = genSurfaceAbs - worldOffsetY; the offset cancels in the
    // slope difference) with ~3x fewer noise evaluations.
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
  // Trees are background silhouettes over already-generated terrain. Trees reach
  // TREE_REACH cols outside the rect (clipped by `put`), so a band re-evaluates the
  // trunks just outside it and canopies span band seams identically to one big call.
  void fillTrees(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (!L->isBackground) return;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return; if (L->grid[y * cols + lx] == EMPTY) L->grid[y * cols + lx] = m; };
    const int TREE_REACH = 13;   // >= max canopy / branch horizontal reach
    const int TREE_MAX_UP = 42;  // >= max trunk height + canopy upward reach
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = terrain.genSurfaceAt(worldX);
      if (surf + 2 < rowStart || surf - TREE_MAX_UP >= rowEnd) continue; // footprint misses the rect
      // Leave a clean skyline around deterministic villages. Besides making the
      // settlement readable, this prevents background tree components from
      // overlapping the foreground buildings across simulation layers.
      bool nearVillage = false; int vq = worldX / 420; if (worldX < 0 && worldX % 420) vq--;
      uint32_t villageSeed = L->worldSeed ^ 0x57121314u;
      for (int v = vq - 1; v <= vq + 1; v++) if (whash1(villageSeed ^ 0xA11A6Eu, v) <= 0.78) {
        int vc = v * 420 + 76 + (int)(whash1(villageSeed ^ 0xA11A6Fu, v) * 268);
        if (std::abs(worldX - vc) < 252) { nearVillage = true; break; }
      }
      if (nearVillage) continue;
      if (!terrain.genTreeAt(worldX, surf)) continue;
      int biome = terrain.genBiomeAt(worldX);
      uint8_t pt = terrain.pickTreeType(biome, worldX);
      uint8_t wood = plantWoodMat(pt), leaf = plantLeafMat(pt);
      double hr = whash1(L->gTreeSeed + 1, worldX);
      int h = pt == PT_PINE ? 23 + (int)(hr * 13)     // towering conifer
            : pt == PT_BUSH ? 4 + (int)(hr * 4)       // low shrub
            : pt == PT_CACTUS ? 9 + (int)(hr * 8)     // tall branching cactus
            : pt == PT_WILLOW ? 18 + (int)(hr * 10)
            : 13 + (int)(hr * 12);                    // mature oak
      int top = surf - h;
      auto trunkXAtHeight = [&](int height) {
        if (pt != PT_PINE && pt != PT_WILLOW) return lx;
        int drift = 0, maxDrift = pt == PT_PINE ? 2 : 3;
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
        if (pt == PT_PINE) radius = height <= 5 ? 2 : height <= 15 ? 1 : 0;
        else if (pt == PT_WILLOW) radius = height <= 6 ? 2 : height <= 14 ? 1 : 0;
        for (int ox = -radius; ox <= radius; ox++) put(center + ox, y, wood);
      }
      if (pt == PT_CACTUS) {                            // arms, no foliage
        int armY = top + 2 + (int)(whash1(L->gTreeSeed ^ 0x3a3au, worldX) * imax(1, h - 4));
        put(lx - 1, armY, wood); put(lx - 2, armY, wood); put(lx - 2, armY - 1, wood);
        put(lx + 1, armY + 2, wood); put(lx + 2, armY + 2, wood); put(lx + 2, armY + 1, wood);
      } else if (pt == PT_PINE) {                       // tapered, ragged evergreen crown
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
      } else if (pt == PT_WILLOW) {                     // clustered crown + soft, irregular droops
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
      } else {                                          // oak / bush: forked limbs and cloud canopy
        int rad = pt == PT_BUSH ? 4 : 8;
        if (pt != PT_BUSH) for (int side : {-1, 1}) {
          int len = 4 + (int)(whash1(L->gTreeSeed ^ (side < 0 ? 0x81u : 0x82u), worldX) * 4);
          int by = top + 4 + (side < 0 ? 1 : 0);
          for (int i = 1; i <= len; i++) { put(lx + side * i, by - i / 3, wood); if (i > len / 2) put(lx + side * i, by - i / 3 - 1, leaf); }
        }
        for (int cy = -4; cy <= 2; cy += 3) for (int cx = -rad + 2; cx <= rad - 2; cx += 4)
          for (int oy = -3; oy <= 3; oy++) for (int ox = -3; ox <= 3; ox++) if (ox * ox + oy * oy <= 10) put(lx + cx + ox, top + cy + oy, leaf);
      }
    }
  }
  // ---- deterministic structure stamping (ruins) -----------------------------
  // Discrete structures anchor on a coarse world-cell lattice. Each lattice cell's
  // presence/size is a pure hash of its (latX,latY), so a structure is byte-identical
  // no matter which band generates it. Like fillTrees, we OVERSCAN the rect by
  // STRUCT_REACH and clip with `put`, so a structure straddling a band seam is written
  // identically whether produced by one big fillRect or two band calls. fg only.
  static const int STRUCT_LATTICE = 76;  // world cells between candidate anchors
  static const int STRUCT_REACH = 256;   // includes villages and broad mine galleries
  static int floorDiv(int a, int b) { int q = a / b, r = a % b; if (r != 0 && ((r < 0) != (b < 0))) q--; return q; }
  void fillStructures(int colStart, int colEnd, int rowStart, int rowEnd) {
    auto put = [&](int wx, int wy, uint8_t m) {
      int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
      L->grid[y * cols + lx] = m;                         // structures OVERWRITE terrain
    };
    uint32_t sseed = L->worldSeed ^ 0x57121314u;       // fg-only struct seed (shared is fine)
    int wx0 = L->worldOffsetX + colStart - STRUCT_REACH, wx1 = L->worldOffsetX + colEnd + STRUCT_REACH;
    int wy0 = L->worldOffsetY + rowStart - STRUCT_REACH, wy1 = L->worldOffsetY + rowEnd + STRUCT_REACH;
    int rectX0 = L->worldOffsetX + colStart, rectX1 = L->worldOffsetX + colEnd - 1;
    int rectY0 = L->worldOffsetY + rowStart, rectY1 = L->worldOffsetY + rowEnd - 1;
    int lxMin = floorDiv(wx0, STRUCT_LATTICE), lxMax = floorDiv(wx1, STRUCT_LATTICE);
    int lyMin = floorDiv(wy0, STRUCT_LATTICE), lyMax = floorDiv(wy1, STRUCT_LATTICE);
    auto h2 = [&](uint32_t salt, int a, int b) { return whash2(sseed ^ salt, a, b); };
    // Structure plans always consult foreground cave topology, even while the
    // background or a prefetched scratch band is active. This keeps placement
    // decisions byte-identical across both layers.
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
    auto stampTerraceFoundation = [&](int left, int right, int floorY,
                                      uint8_t foundation, bool stairs) {
      for (int x = left; x <= right; x++) {
        int groundY = terrain.genSurfaceAbs(x);
        for (int y = floorY + 1; y <= groundY; y++) {
          uint8_t course = foundation;
          if (foundation == BRICK && (y - floorY) % 5 == 0) course = SANDSTONE;
          put(x, y, course);
        }
      }
      if (!stairs) return;
      // Compact masonry stairs join a raised terrace to the natural grade. Each
      // tread continues to the terrain, so even the approach is visibly grounded.
      for (int side : {-1, 1}) {
        int edgeX = side < 0 ? left : right;
        int drop = terrain.genSurfaceAbs(edgeX + side) - floorY;
        for (int step = 1; step <= imin(10, drop); step++) {
          int x = edgeX + side * step;
          int groundY = terrain.genSurfaceAbs(x);
          int stepY = imin(floorY + step, groundY - 1);
          for (int y = stepY; y <= groundY; y++) put(x, y, foundation);
        }
      }
    };
    // Surface villages: a deterministic chain of roomy homes, workshops,
    // apothecaries, storehouses, and a meeting hall. The foreground retains a
    // generous walk-through silhouette; the solid background wall carries the
    // windows, furniture, tools, produce, banners, and other lived-in detail.
    static const int VILLAGE_LATTICE = 420;
    int vxMin = floorDiv(wx0, VILLAGE_LATTICE), vxMax = floorDiv(wx1, VILLAGE_LATTICE);
    auto stampCottage = [&](int cx, int ordinal, bool hall) {
      int role = ordinal & 3, variant = (ordinal >> 2) & 1;
      int w = hall ? 52
            : role == 0 ? 36 + variant * 4
            : role == 1 ? 44 + variant * 2
            : role == 2 ? 38 + variant * 4
                        : 46 - variant * 2;
      int h = hall ? 30
            : role == 0 ? 24 + variant * 2
            : role == 1 ? 22 + variant * 2
            : role == 2 ? 27 + variant
                        : 24 + variant * 2;
      int biome = terrain.genBiomeAt(cx);
      int ground = terrain.genSurfaceAbs(cx), left = cx - w / 2;
      if (ground >= L->gSeaRow || biome == BIOME_ROCKY) return;
      int lo = ground, hi = ground, surfaceSum = 0;
      bool crossesCaveMouth = false;
      {
        ForegroundTerrainScope foregroundQuery(L);
        for (int x = left; x <= left + w; x++) {
          int sy = terrain.genSurfaceAbs(x);
          lo = imin(lo, sy); hi = imax(hi, sy); surfaceSum += sy;
          if (terrain.genOpenCaveAt(x, sy) || terrain.genOpenCaveAt(x, sy + 1)
              || terrain.genOpenCaveAt(x, sy + 2)) crossesCaveMouth = true;
        }
      }
      // Stone foundations absorb ordinary rolling terrain; reject only severe
      // escarpments. A structure never bridges a surface cave entrance.
      if (crossesCaveMouth || hi - lo > (hall ? 14 : 11)) return;
      int floorY = floorDiv(surfaceSum, w + 1) - 1;
      int wallTop = floorY - h, roofH = hall ? 11 : role == 2 ? 10 : 9;
      if (left + w + 2 < rectX0 || left - 2 > rectX1
          || floorY < rectY0 || wallTop - roofH - 16 > rectY1) return;
      const int DOOR_CLEARANCE = PLAYER_H + 5;
      uint8_t wall = biome == BIOME_DESERT ? SANDSTONE : BRICK;
      uint8_t foundation = biome == BIOME_DESERT ? SANDSTONE : BRICK;
      for (int x = left; x <= left + w; x++) {
        for (int y = wallTop; y <= floorY; y++) {
          bool edge = x == left || x == left + w || y == wallTop || y == floorY;
          bool sidePassage = (x == left || x == left + w) && y >= floorY - DOOR_CLEARANCE + 1;
          bool door = x >= cx - 3 && x <= cx + 3 && y >= floorY - DOOR_CLEARANCE + 1;
          if (L->isBackground) put(x, y, wall); // dim, solid room backdrop behind the facade
          else put(x, y, edge && !sidePassage && !door ? wall : EMPTY);
        }
      }
      // Every exposed column continues into natural terrain. Alternating courses
      // keep tall downhill foundations from reading as featureless rectangles.
      stampTerraceFoundation(left, left + w, floorY, foundation, true);

      // The four occupations use genuinely different silhouettes: domestic
      // gable, workshop shed, glazed apothecary arch, warehouse parapet, and a
      // civic hall with a belfry. All roofs are solid in both layers.
      int roofStyle = hall ? 4 : role;
      auto roofColumn = [&](int x, int top) {
        for (int y = top; y <= wallTop; y++) put(x, y, wall);
      };
      if (roofStyle == 0) {
        for (int ry = 0; ry <= roofH; ry++)
          for (int x = left - 2 + ry; x <= left + w + 2 - ry; x++) put(x, wallTop - ry, wall);
        int dormerY = wallTop - roofH / 2;
        for (int dx = -3; dx <= 3; dx++) for (int dy = -2; dy <= 2; dy++)
          put(cx + dx, dormerY + dy, std::abs(dx) == 3 || std::abs(dy) == 2 ? PINE_WOOD : CRYSTAL);
      } else if (roofStyle == 1) {
        for (int x = left - 2; x <= left + w + 2; x++) {
          int run = x - (left - 2);
          int rise = roofH - run * roofH / (w + 4);
          roofColumn(x, wallTop - rise);
        }
        for (int x = left + 5; x <= left + 7; x++)
          for (int y = wallTop - roofH - 6; y <= wallTop - roofH + 2; y++) put(x, y, BRICK);
        put(left + 6, wallTop - roofH - 7, CRYSTAL);
      } else if (roofStyle == 2) {
        int half = w / 2 + 2;
        for (int x = left - 2; x <= left + w + 2; x++) {
          int dx = std::abs(x - cx);
          int arch = 3 + (roofH - 2) * (half * half - dx * dx) / (half * half);
          roofColumn(x, wallTop - imax(2, arch));
        }
        for (int ribX : {cx - 9, cx, cx + 9}) {
          int dx = std::abs(ribX - cx);
          int arch = 3 + (roofH - 2) * (half * half - dx * dx) / (half * half);
          put(ribX, wallTop - arch, CRYSTAL);
          put(ribX, wallTop - arch + 1, CRYSTAL);
        }
      } else if (roofStyle == 3) {
        for (int x = left - 2; x <= left + w + 2; x++)
          for (int y = wallTop - 5; y <= wallTop; y++) put(x, y, wall);
        for (int x = left - 2; x <= left + w + 2; x += 7)
          for (int y = wallTop - 8; y < wallTop - 5; y++) put(x, y, wall);
      } else {
        for (int ry = 0; ry <= roofH; ry++)
          for (int x = left - 2 + ry; x <= left + w + 2 - ry; x++) put(x, wallTop - ry, wall);
        int apex = wallTop - roofH;
        for (int x = cx - 6; x <= cx + 6; x++) for (int y = apex - 8; y <= apex + 1; y++) put(x, y, wall);
        for (int ry = 0; ry <= 5; ry++)
          for (int x = cx - 8 + ry; x <= cx + 8 - ry; x++) put(x, apex - 8 - ry, wall);
        for (int wx : {cx - 2, cx + 2}) for (int y = apex - 6; y <= apex - 3; y++) put(wx, y, CRYSTAL);
        put(cx, apex - 7, CLAY);
      }

      if (L->isBackground) {
        auto shelf = [&](int x0, int x1, int y) {
          for (int x = x0; x <= x1; x++) put(x, y, PINE_WOOD);
          put(x0 + 1, y + 1, WOOD); put(x1 - 1, y + 1, WOOD);
        };
        auto table = [&](int x0, int x1, int y) {
          for (int x = x0; x <= x1; x++) put(x, y, WOOD);
          for (int yy = y + 1; yy <= floorY - 1; yy++) {
            put(x0 + 1, yy, PINE_WOOD); put(x1 - 1, yy, PINE_WOOD);
          }
        };
        auto crate = [&](int x, int y, int cw, int ch) {
          for (int dx = 0; dx < cw; dx++) for (int dy = 0; dy < ch; dy++) {
            bool edge = dx == 0 || dx == cw - 1 || dy == 0 || dy == ch - 1;
            put(x + dx, y + dy, edge || dx == dy ? PINE_WOOD : WOOD);
          }
        };
        auto window = [&](int x, int y) {
          for (int dx = -3; dx <= 3; dx++) for (int dy = -3; dy <= 3; dy++) {
            bool frame = std::abs(dx) == 3 || std::abs(dy) == 3 || dx == 0 || dy == 0;
            put(x + dx, y + dy, frame ? PINE_WOOD : CRYSTAL);
          }
          // Window boxes soften the masonry and visibly distinguish occupied homes.
          for (int dx = -4; dx <= 4; dx++) put(x + dx, y + 4, WOOD);
          for (int dx : {-3, 0, 3}) put(x + dx, y + 3, dx == 0 ? GLOWBERRY : PLANT);
        };

        // Timber framing and irregular masonry bands make the backdrop read as a
        // built wall rather than a flat rectangle.
        for (int x = left + 3; x <= left + w - 3; x += 8)
          for (int y = wallTop + 1; y < floorY; y++) put(x, y, PINE_WOOD);
        for (int y = wallTop + 5; y < floorY - 3; y += 7)
          for (int x = left + 1; x < left + w; x++)
            if ((x + ordinal) % 9 != 0) put(x, y, SANDSTONE);
        for (int x = left + 1; x < left + w; x++) put(x, floorY - 2, PINE_WOOD);
        window(left + 8, wallTop + 8);
        window(left + w - 8, wallTop + 8);

        if (hall) {
          // A communal banquet hall: long trestle table, benches, heraldic
          // banners, a chandelier, and a raised speaker's end.
          table(left + 8, left + w - 8, floorY - 6);
          for (int x = left + 10; x <= left + w - 10; x++) {
            put(x, floorY - 3, WOOD);
            if (x % 9 == 0) put(x, floorY - 4, CLAY);
          }
          for (int bx : {left + 14, cx, left + w - 14}) {
            for (int y = wallTop + 2; y <= wallTop + 8; y++) put(bx, y, MOSS);
            put(bx - 1, wallTop + 4, GOLD_ORE); put(bx + 1, wallTop + 6, CRYSTAL);
          }
          for (int y = wallTop + 1; y <= wallTop + 7; y++) put(cx, y, IRON_ORE);
          for (int dx = -3; dx <= 3; dx++) put(cx + dx, wallTop + 7, IRON_ORE);
          put(cx - 3, wallTop + 8, CRYSTAL); put(cx, wallTop + 8, CRYSTAL); put(cx + 3, wallTop + 8, CRYSTAL);
          for (int x = left + w - 9; x <= left + w - 3; x++) put(x, floorY - 4, BRICK);
          put(left + w - 6, floorY - 5, CRYSTAL);
        } else {
          switch (ordinal & 3) {
            case 0: { // family home: hearth, bed, supper table, and potted herbs
              for (int x = left + 3; x <= left + 9; x++) for (int y = floorY - 7; y < floorY; y++) {
                bool hearth = x == left + 3 || x == left + 9 || y == floorY - 7;
                if (hearth) put(x, y, BRICK);
              }
              put(left + 6, floorY - 2, CRYSTAL); put(left + 6, floorY - 3, GOLD_ORE);
              for (int x = left + w - 13; x <= left + w - 3; x++) put(x, floorY - 3, WOOD);
              for (int x = left + w - 12; x <= left + w - 5; x++) put(x, floorY - 4, MOSS);
              put(left + w - 4, floorY - 4, WILLOW_LEAF);
              table(cx - 4, cx + 4, floorY - 5);
              shelf(left + w - 13, left + w - 5, floorY - 11);
              put(left + w - 11, floorY - 12, CLAY); put(left + w - 10, floorY - 13, PLANT);
              break;
            }
            case 1: { // smith/carpenter: workbench, tool board, furnace, timber
              table(left + 4, left + 17, floorY - 5);
              shelf(left + 5, left + 16, floorY - 11);
              for (int tx = left + 7; tx <= left + 15; tx += 4) {
                put(tx, floorY - 12, tx & 1 ? COPPER_ORE : IRON_ORE);
                put(tx, floorY - 13, IRON_ORE);
              }
              for (int x = left + w - 11; x <= left + w - 3; x++) for (int y = floorY - 7; y < floorY; y++) {
                bool furnace = x == left + w - 11 || x == left + w - 3 || y == floorY - 7;
                if (furnace) put(x, y, BRICK);
              }
              put(left + w - 7, floorY - 2, CRYSTAL);
              for (int x = cx - 3; x <= cx + 4; x += 2) put(x, floorY - 2, PINE_WOOD);
              break;
            }
            case 2: { // apothecary: specimen shelves and a lush preparation table
              for (int sy : {floorY - 6, floorY - 12}) shelf(left + 4, left + w - 4, sy);
              static const uint8_t jars[] = { CLAY, MUSH_CAP, MOSS, GLOWBERRY, CRYSTAL, PLANT };
              for (int x = left + 6; x <= left + w - 6; x += 4) {
                put(x, floorY - 7, jars[std::abs(x + ordinal) % 6]);
                put(x, floorY - 13, jars[std::abs(x + ordinal + 3) % 6]);
              }
              table(cx - 6, cx + 6, floorY - 4);
              for (int x : {cx - 4, cx, cx + 4}) put(x, floorY - 5, x == cx ? GLOWSHROOM : PLANT);
              for (int y = wallTop + 1; y <= wallTop + 6; y++) put(left + w - 4, y, VINE);
              put(left + w - 5, wallTop + 6, GLOWBERRY);
              break;
            }
            default: { // storehouse: stacked marked crates and well-stocked racks
              crate(left + 4, floorY - 7, 8, 6);
              crate(left + 12, floorY - 5, 7, 4);
              crate(left + w - 13, floorY - 8, 9, 7);
              shelf(cx - 6, cx + 7, floorY - 10);
              for (int x = cx - 4; x <= cx + 5; x += 3) put(x, floorY - 11, x & 1 ? COPPER_ORE : COAL_ORE);
              put(left + 7, floorY - 4, GOLD_ORE);
              break;
            }
          }
        }
      } else {
        // Two widely spaced masonry piers carry the roof into the terrace. They
        // leave player-clear side entries and a broad central room, but prevent
        // the foreground facade from reading as a roof suspended over a floor.
        for (int pierX : {left + 9, left + w - 9})
          for (int y = wallTop + 1; y <= floorY; y++) put(pierX, y, wall);
        // High beams brace the wide spans without shrinking the playable opening.
        for (int y = wallTop + 2; y < floorY - DOOR_CLEARANCE; y++) put(cx, y, wall);
        for (int x = left + 5; x <= left + w - 5; x++) if (x < cx - 4 || x > cx + 4) put(x, floorY - DOOR_CLEARANCE - 1, wall);
      }
      if (L->isBackground) {
        // Hanging shop signs remain readable but, like streetlamps, sit behind the
        // player so the decorative post cannot obstruct the path between homes.
        int signX = left + w + 6;
        for (int y = floorY - 8; y <= floorY; y++) put(signX, y, PINE_WOOD);
        for (int x = signX - 4; x <= signX + 3; x++) for (int y = floorY - 9; y <= floorY - 6; y++)
          put(x, y, PINE_WOOD);
        put(signX - 1, floorY - 8, hall ? CRYSTAL : (ordinal & 1 ? COPPER_ORE : CRYSTAL));
      }
    };
    for (int vx = vxMin; vx <= vxMax; vx++) {
      if (whash1(sseed ^ 0xA11A6Eu, vx) > 0.78) continue;
      int center = vx * VILLAGE_LATTICE + 76 + (int)(whash1(sseed ^ 0xA11A6Fu, vx) * 268);
      if (terrain.genSurfaceAbs(center) >= L->gSeaRow) continue;
      int count = 5 + (int)(whash1(sseed ^ 0xA11A70u, vx) * 3);
      for (int i = 0; i < count; i++) stampCottage(center + (i - count / 2) * 58, i, i == count / 2);
      int wellX = center + count * 29 + 12, wellY;

      // A continuous stone street and lanterns turn the individual facades into
      // one settlement. Everything follows the terrain instead of flattening it.
      int streetLeft = center - count * 29 - 30, streetRight = wellX + 12;
      for (int x = streetLeft; x <= streetRight; x++) put(x, terrain.genSurfaceAbs(x), SANDSTONE);
      // Streetlamps live entirely in the background plane, whose emissive light
      // projects into the foreground. They remain bright without becoming narrow
      // collision posts between otherwise player-clear buildings.
      if (L->isBackground) for (int i = 0; i + 1 < count; i++) {
        int lampX = center + (i - count / 2) * 58 + 29;
        int lampY = terrain.genSurfaceAbs(lampX) - 1;
        for (int y = lampY - 9; y <= lampY; y++) put(lampX, y, PINE_WOOD);
        for (int dx = -3; dx <= 3; dx++) put(lampX + dx, lampY - 9, PINE_WOOD);
        put(lampX - 3, lampY - 8, CRYSTAL); put(lampX + 3, lampY - 8, CRYSTAL);
      }

      // A covered market stall beside the well adds a communal place rather than
      // another sealed box: canopy, counter, produce, pottery, and hanging goods.
      int marketX = wellX - 20, marketSurfaceSum = 0;
      for (int x = marketX - 11; x <= marketX + 11; x++) marketSurfaceSum += terrain.genSurfaceAbs(x);
      int marketY = floorDiv(marketSurfaceSum, 23) - 1;
      stampTerraceFoundation(marketX - 11, marketX + 11, marketY, SANDSTONE, true);
      for (int x = marketX - 11; x <= marketX + 11; x++) {
        put(x, marketY - 12, ((x - marketX) & 3) < 2 ? BRICK : SANDSTONE);
        put(x, marketY - 11, ((x - marketX) & 3) < 2 ? BRICK : SANDSTONE);
      }
      for (int side : {-1, 1}) for (int y = marketY - 10; y <= marketY; y++) put(marketX + side * 10, y, PINE_WOOD);
      for (int x = marketX - 8; x <= marketX + 8; x++) put(x, marketY - 4, WOOD);
      for (int x : {marketX - 7, marketX + 7}) for (int y = marketY - 3; y <= marketY; y++) put(x, y, PINE_WOOD);
      if (L->isBackground) {
        static const uint8_t wares[] = { CLAY, MUSH_CAP, MOSS, GLOWBERRY, GOLD_ORE, PLANT };
        for (int x = marketX - 7; x <= marketX + 7; x += 3)
          put(x, marketY - 5, wares[std::abs(x) % 6]);
        for (int x = marketX - 5; x <= marketX + 5; x += 5) {
          for (int y = marketY - 10; y <= marketY - 8; y++) put(x, y, VINE);
          put(x + 1, marketY - 8, GLOWBERRY);
        }
      }

      int wellSurfaceSum = 0;
      for (int x = wellX - 7; x <= wellX + 7; x++) wellSurfaceSum += terrain.genSurfaceAbs(x);
      wellY = floorDiv(wellSurfaceSum, 15) - 1;
      stampTerraceFoundation(wellX - 7, wellX + 7, wellY, BRICK, true);
      for (int dx = -4; dx <= 4; dx++) put(wellX + dx, wellY, BRICK);
      for (int side : {-1, 1}) for (int y = wellY - 12; y < wellY; y++) put(wellX + side * 5, y, PINE_WOOD);
      for (int ry = 0; ry <= 4; ry++)
        for (int x = wellX - 7 + ry; x <= wellX + 7 - ry; x++) put(x, wellY - 12 - ry, BRICK);
      for (int x = wellX - 5; x <= wellX + 5; x++) put(x, wellY - 8, WOOD);
      put(wellX, wellY - 11, STONE);
      for (int y = wellY - 10; y <= wellY - 3; y++) put(wellX, y, WOOD);
      for (int dx = -2; dx <= 2; dx++) {
        put(wellX + dx, wellY - 2, BRICK);
        put(wellX + dx, wellY - 1, dx == 0 ? WATER : BRICK);
      }
      put(wellX, wellY - 3, CLAY); put(wellX - 4, wellY - 1, MOSS);
    }

    // Large, multi-level mines are shared structures: the foreground owns their
    // clear galleries and access shafts, while the background remains solid and
    // carries matching timber frames, station walls, and rail beds. In side view
    // the support work therefore reads behind the player without cutting linear
    // voids through the backdrop.
    static const int MINE_LATTICE = 512;
    struct MineFootprint { int left, right, top, bottom; };
    std::vector<MineFootprint> mines;
    int mineMin = floorDiv(wx0, MINE_LATTICE), mineMax = floorDiv(wx1, MINE_LATTICE);
    for (int mr = mineMin; mr <= mineMax; mr++) {
      if (whash1(sseed ^ 0xD16D0001u, mr) > 0.72) continue;
      int center = mr * MINE_LATTICE + 112
                 + (int)(whash1(sseed ^ 0xD16D0002u, mr) * (MINE_LATTICE - 224));
      int surface = terrain.genSurfaceAbs(center);
      if (surface >= L->gSeaRow || terrain.genBiomeAt(center) == BIOME_ROCKY) continue;

      int width = 152 + (int)(whash1(sseed ^ 0xD16D0003u, mr) * 57);
      int levels = whash1(sseed ^ 0xD16D0004u, mr) < 0.38 ? 4 : 3;
      const int clearHeight = PLAYER_H + 7;
      const int levelGap = 27;
      int firstFloor = surface + 126 + (int)(whash1(sseed ^ 0xD16D0005u, mr) * 64);
      firstFloor = imin(firstFloor, TerrainGen::CAVE_BOTTOM - 28 - (levels - 1) * levelGap);
      int left = center - width / 2, right = center + width / 2;
      int shaftHalf = 6;
      MineFootprint mine{left, right, surface - 36, firstFloor + (levels - 1) * levelGap};
      if (mine.right < rectX0 || mine.left > rectX1 || mine.bottom < rectY0 || mine.top > rectY1) continue;
      mines.push_back(mine);

      auto stampSupportFrame = [&](int x, int ceiling, int floor) {
        for (int y = ceiling; y <= floor; y++) put(x, y, WOOD);
        for (int dx = -4; dx <= 4; dx++) put(x + dx, ceiling, WOOD);
        for (int d = 1; d <= 4; d++) {
          put(x - d, ceiling + d, PINE_WOOD);
          put(x + d, ceiling + d, PINE_WOOD);
        }
      };
      auto stampRail = [&](int x0, int x1, int floor) {
        for (int x = x0; x <= x1; x++) put(x, floor - 1, IRON_ORE);
        for (int x = x0; x <= x1; x += 5)
          for (int dx = 0; dx < 3 && x + dx <= x1; dx++) put(x + dx, floor, WOOD);
      };
      auto stampMineCart = [&](int x, int floor, uint8_t load) {
        for (int dx = -6; dx <= 6; dx++) {
          put(x + dx, floor - 6, IRON_ORE);
          put(x + dx, floor - 3, IRON_ORE);
          if (std::abs(dx) == 6) for (int y = floor - 6; y <= floor - 3; y++) put(x + dx, y, IRON_ORE);
          else if (std::abs(dx) < 5) put(x + dx, floor - 5, load);
        }
        for (int dx : {-4, 4}) {
          put(x + dx, floor - 2, PINE_WOOD);
          put(x + dx - 1, floor - 2, IRON_ORE);
          put(x + dx + 1, floor - 2, IRON_ORE);
        }
      };
      auto stampMineCrates = [&](int x, int floor, int count) {
        for (int c = 0; c < count; c++) {
          int cw = 6 + (c & 1), ch = 4 + ((c + 1) & 1);
          int x0 = x + c * 5, y0 = floor - ch - (c & 1) * 4;
          for (int dx = 0; dx < cw; dx++) for (int dy = 0; dy < ch; dy++) {
            bool edge = dx == 0 || dx == cw - 1 || dy == 0 || dy == ch - 1;
            put(x0 + dx, y0 + dy, edge || dx == dy ? PINE_WOOD : WOOD);
          }
        }
      };

      for (int level = 0; level < levels; level++) {
        int floor = firstFloor + level * levelGap;
        int ceiling = floor - clearHeight;
        int inset = (level & 1) * 10;
        int x0 = left + inset, x1 = right - inset;
        int stationHalf = level == 0 ? 27 : 21;
        const int sideRoomHeight = PLAYER_H + 5;
        int roomX0 = (level & 1) == 0 ? x0 + 12 : x1 - 44;
        int roomX1 = roomX0 + 31;

        if (L->isBackground) {
          for (int y = ceiling - 5; y <= floor; y++)
            for (int x = center - stationHalf; x <= center + stationHalf; x++)
              put(x, y, BRICK);
          // A tall brick station with pale masonry bands, timber bays, a line
          // map, and a lit identity plaque. It visually anchors every level.
          for (int y : {ceiling - 3, floor - 4})
            for (int x = center - stationHalf + 1; x < center + stationHalf; x++) put(x, y, SANDSTONE);
          for (int x = center - stationHalf + 4; x < center + stationHalf; x += 9)
            for (int y = ceiling - 4; y < floor; y++) put(x, y, PINE_WOOD);
          for (int x = center - 8; x <= center + 8; x++) for (int y = ceiling - 1; y <= ceiling + 3; y++)
            put(x, y, PINE_WOOD);
          for (int x = center - 6; x <= center + 6; x += 3) put(x, ceiling + 1, level == 0 ? GOLD_ORE : COPPER_ORE);
          put(center, ceiling + 3, CRYSTAL);

          // The foreground alcove is backed by its own constructed room. Each
          // level has a distinct use instead of repeating an empty tunnel.
          for (int y = ceiling - sideRoomHeight; y < ceiling; y++)
            for (int x = roomX0; x <= roomX1; x++) put(x, y, BRICK);
          for (int x = roomX0; x <= roomX1; x++) {
            put(x, ceiling - sideRoomHeight, PINE_WOOD);
            put(x, ceiling - 2, PINE_WOOD);
          }
          for (int y = ceiling - sideRoomHeight; y < ceiling; y++) {
            put(roomX0, y, PINE_WOOD); put(roomX1, y, PINE_WOOD);
          }
          for (int x = x0 + 8; x <= x1 - 8; x += 18)
            stampSupportFrame(x, ceiling, floor);
          stampRail(x0 + 3, x1 - 3, floor);

          for (int lampX = x0 + 17; lampX < x1 - 12; lampX += 34) {
            put(lampX, ceiling, IRON_ORE); put(lampX, ceiling + 1, IRON_ORE);
            put(lampX - 1, ceiling + 2, CRYSTAL); put(lampX, ceiling + 2, CRYSTAL); put(lampX + 1, ceiling + 2, CRYSTAL);
          }
          uint8_t cartLoad = level == 0 ? WOOD : level == 1 ? COAL_ORE : level == 2 ? COPPER_ORE : GOLD_ORE;
          stampMineCart(x0 + 28, floor, cartLoad);
          if (x1 - x0 > 175) stampMineCart(x1 - 30, floor, level == 0 ? CLAY : IRON_ORE);

          if (level == 0) {
            // Station office, benches, clock, and route board.
            for (int x = roomX0 + 4; x <= roomX1 - 4; x++) put(x, ceiling - 6, WOOD);
            for (int x : {roomX0 + 6, roomX1 - 6}) for (int y = ceiling - 5; y <= ceiling - 2; y++) put(x, y, PINE_WOOD);
            for (int x = roomX0 + 5; x <= roomX0 + 12; x++) put(x, ceiling - 10, SANDSTONE);
            put(roomX0 + 8, ceiling - 12, CRYSTAL);
            for (int x = roomX0 + 16; x <= roomX1 - 3; x++) put(x, ceiling - 9, PINE_WOOD);
            for (int x = roomX0 + 18; x <= roomX1 - 5; x += 4) put(x, ceiling - 10, x & 1 ? GOLD_ORE : CRYSTAL);
          } else if (level == 1) {
            // Repair shop: long bench, hanging tools, spare rail and timber.
            for (int x = roomX0 + 3; x <= roomX1 - 3; x++) put(x, ceiling - 5, WOOD);
            for (int x : {roomX0 + 5, roomX1 - 5}) for (int y = ceiling - 4; y < ceiling; y++) put(x, y, PINE_WOOD);
            for (int x = roomX0 + 5; x <= roomX1 - 5; x += 5) {
              put(x, ceiling - 9, IRON_ORE); put(x + 1, ceiling - 8, COPPER_ORE);
            }
            for (int x = roomX0 + 7; x <= roomX1 - 7; x++) put(x, ceiling - 12, IRON_ORE);
          } else if (level == 2) {
            // Ore depot: marked storage, assay shelf, and richer deep loads.
            stampMineCrates(roomX0 + 3, ceiling, 4);
            for (int x = roomX0 + 4; x <= roomX1 - 4; x++) put(x, ceiling - 10, PINE_WOOD);
            for (int x = roomX0 + 6; x <= roomX1 - 6; x += 4)
              put(x, ceiling - 11, x % 3 == 0 ? GOLD_ORE : (x & 1 ? COPPER_ORE : IRON_ORE));
          } else {
            // The oldest level has been reclaimed by a luminous fungal garden.
            for (int x = roomX0 + 2; x < roomX1 - 1; x++) put(x, ceiling - 3, MYCELIUM);
            for (int x = roomX0 + 5; x < roomX1 - 3; x += 6) {
              int mh = 2 + ((x - roomX0) % 3);
              for (int y = 0; y < mh; y++) put(x, ceiling - 4 - y, MUSH_STEM);
              for (int dx = -2; dx <= 2; dx++) put(x + dx, ceiling - 4 - mh, MUSH_CAP);
              if (x & 1) put(x + 1, ceiling - 4 - mh, GLOWSHROOM);
            }
            for (int y = ceiling - sideRoomHeight + 1; y <= ceiling - sideRoomHeight + 5; y++) put(roomX1 - 4, y, VINE);
            put(roomX1 - 5, ceiling - sideRoomHeight + 5, GLOWBERRY);
          }
          continue;
        }

        for (int y = ceiling; y < floor; y++)
          for (int x = x0; x <= x1; x++) put(x, y, EMPTY);
        // A tall central station breaks up the long gallery and leaves generous
        // headroom around the main shaft.
        for (int y = ceiling - 5; y < floor; y++)
          for (int x = center - stationHalf; x <= center + stationHalf; x++) put(x, y, EMPTY);

        int shaftA = center - width / 4, shaftB = center + width / 4;
        auto railSection = [&](int from, int to) {
          if (from <= to) stampRail(from, to, floor);
        };
        railSection(x0 + 3, shaftA - shaftHalf - 1);
        railSection(shaftA + shaftHalf + 1, shaftB - shaftHalf - 1);
        railSection(shaftB + shaftHalf + 1, x1 - 3);

        for (int x = roomX0; x <= roomX1; x++)
          for (int y = ceiling - sideRoomHeight; y < ceiling; y++) put(x, y, EMPTY);
        for (int lampX = x0 + 18; lampX < x1 - 12; lampX += 36)
          put(lampX, ceiling + 1, CRYSTAL);
      }

      // Broad inter-level shafts let the full player body pass with room to
      // maneuver. Timber ledges mark each landing in the background layer.
      for (int shaftX : {center - width / 4, center + width / 4}) {
        int top = firstFloor - clearHeight;
        int bottom = firstFloor + (levels - 1) * levelGap;
        if (!L->isBackground) {
          for (int y = top; y < bottom; y++)
            for (int x = shaftX - shaftHalf; x <= shaftX + shaftHalf; x++) put(x, y, EMPTY);
        } else {
          for (int y = top; y < bottom; y++) {
            put(shaftX, y, IRON_ORE);                    // hoist cable
            put(shaftX + shaftHalf - 2, y, PINE_WOOD);  // service ladder
            if ((y - top) % 4 == 0)
              for (int x = shaftX + shaftHalf - 5; x <= shaftX + shaftHalf - 1; x++) put(x, y, WOOD);
          }
          for (int level = 0; level < levels; level++) {
            int landing = firstFloor + level * levelGap;
            for (int x = shaftX - shaftHalf - 2; x <= shaftX + shaftHalf + 2; x++)
              put(x, landing, WOOD);
          }
        }
      }

      // A substantial headhouse makes the mine legible at the surface. Its
      // constructed shaft is intentionally regular; natural cave mouths are not.
      int houseW = 42, houseH = 25, houseLeft = center - houseW / 2;
      int houseSurfaceSum = 0;
      for (int x = houseLeft; x <= houseLeft + houseW; x++)
        houseSurfaceSum += terrain.genSurfaceAbs(x);
      int floor = floorDiv(houseSurfaceSum, houseW + 1) - 1;
      int houseTop = floor - houseH;
      for (int y = houseTop; y <= floor; y++) for (int x = houseLeft; x <= houseLeft + houseW; x++) {
        bool shell = x == houseLeft || x == houseLeft + houseW || y == houseTop || y == floor;
        bool doorway = y >= floor - PLAYER_H - 4 && std::abs(x - center) <= shaftHalf;
        if (L->isBackground) put(x, y, BRICK);
        else put(x, y, shell && !doorway ? BRICK : EMPTY);
      }
      stampTerraceFoundation(houseLeft, houseLeft + houseW, floor, BRICK, true);
      for (int roof = 0; roof <= 9; roof++)
        for (int x = houseLeft - 2 + roof; x <= houseLeft + houseW + 2 - roof; x++)
          put(x, houseTop - roof, BRICK);
      if (L->isBackground) {
        // Hoist house machinery: glowing windows, winding wheel and drum, tool
        // rack, manifest board, and supplies beside the shaft.
        for (int wx : {houseLeft + 7, houseLeft + houseW - 7})
          for (int dx = -3; dx <= 3; dx++) for (int dy = -3; dy <= 3; dy++)
            put(wx + dx, houseTop + 8 + dy, std::abs(dx) == 3 || std::abs(dy) == 3 || dx == 0 || dy == 0 ? PINE_WOOD : CRYSTAL);
        int wheelX = center - 8, wheelY = floor - 10;
        for (int d = -5; d <= 5; d++) {
          put(wheelX + d, wheelY - 5 + std::abs(d) / 2, IRON_ORE);
          put(wheelX + d, wheelY + 5 - std::abs(d) / 2, IRON_ORE);
          put(wheelX - 5 + std::abs(d) / 2, wheelY + d, IRON_ORE);
          put(wheelX + 5 - std::abs(d) / 2, wheelY + d, IRON_ORE);
        }
        for (int dx = -3; dx <= 3; dx++) put(wheelX + dx, wheelY, COPPER_ORE);
        put(wheelX, wheelY, GOLD_ORE);
        for (int y = wheelY + 1; y <= floor; y++) put(center, y, IRON_ORE);
        stampMineCrates(center + 9, floor, 2);
        for (int x = houseLeft + 4; x <= houseLeft + 15; x++) put(x, floor - 5, PINE_WOOD);
        for (int x = houseLeft + 6; x <= houseLeft + 13; x += 3) put(x, floor - 6, x & 1 ? IRON_ORE : COPPER_ORE);
        for (int x = center - 5; x <= center + 5; x++) put(x, houseTop + 2, PINE_WOOD);
        put(center, houseTop + 2, GOLD_ORE); put(center - 3, houseTop + 2, CRYSTAL); put(center + 3, houseTop + 2, CRYSTAL);
      } else {
        put(houseLeft + 1, floor - PLAYER_H - 6, CRYSTAL);
        put(houseLeft + houseW - 1, floor - PLAYER_H - 6, CRYSTAL);
      }

      int shaftTop = floor - PLAYER_H - 4;
      int shaftBottom = firstFloor - clearHeight;
      if (!L->isBackground) {
        for (int y = shaftTop; y <= shaftBottom; y++)
          for (int x = center - shaftHalf; x <= center + shaftHalf; x++) put(x, y, EMPTY);
      } else {
        for (int y = floor; y <= shaftBottom; y += 14)
          for (int x = center - shaftHalf - 2; x <= center + shaftHalf + 2; x++)
            put(x, y, WOOD);
      }
    }

    // --- structure archetypes ------------------------------------------------
    // Each ruin has two coordinated stamps. The foreground is a roomy, traversable
    // shell; the background is a fully solid decorated wall with furnishings,
    // murals, storage, vegetation, and light. This keeps the backdrop mostly solid
    // while making the empty play space feel inhabited.
    enum SKind { SK_HOUSE, SK_VAULT, SK_COLONNADE, SK_SHRINE, SK_FORGE, SK_ARCHIVE, SK_OVERGROWN, SK_MUSHGROVE };
    auto backdropRoom = [&](int ax, int ay, int w, int h, uint8_t field) {
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        uint8_t mat = border ? BRICK : field;
        if (!border && oy % 6 == 0 && ox % 8 != 0) mat = SANDSTONE;
        if (!border && ox % 9 == 0) mat = PINE_WOOD;
        put(ax + ox, ay + oy, mat);
      }
    };
    // A former dwelling: framed windows and the remains of an ordinary home.
    auto stampHouse = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, BRICK);
        int fy = ay + h - 1;
        for (int wx : {ax + 7, ax + w - 8})
          for (int dx = -3; dx <= 3; dx++) for (int dy = -3; dy <= 3; dy++)
            put(wx + dx, ay + 7 + dy, std::abs(dx) == 3 || std::abs(dy) == 3 || dx == 0 || dy == 0 ? PINE_WOOD : CRYSTAL);
        // Hearth, bed, table, crockery, shelf, and a small hanging lamp.
        for (int x = ax + 3; x <= ax + 9; x++) for (int y = fy - 7; y < fy; y++)
          if (x == ax + 3 || x == ax + 9 || y == fy - 7) put(x, y, STONE);
        put(ax + 6, fy - 2, CRYSTAL); put(ax + 6, fy - 3, GOLD_ORE);
        for (int x = ax + w - 13; x <= ax + w - 3; x++) put(x, fy - 3, WOOD);
        for (int x = ax + w - 12; x <= ax + w - 5; x++) put(x, fy - 4, MOSS);
        for (int x = ax + w / 2 - 4; x <= ax + w / 2 + 4; x++) put(x, fy - 6, WOOD);
        for (int x : {ax + w / 2 - 3, ax + w / 2 + 3}) for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
        for (int x = ax + w - 14; x <= ax + w - 5; x++) put(x, fy - 11, PINE_WOOD);
        put(ax + w - 12, fy - 12, CLAY); put(ax + w - 9, fy - 12, MUSH_CAP); put(ax + w - 6, fy - 12, PLANT);
        for (int y = ay + 1; y <= ay + 6; y++) put(ax + w / 2, y, IRON_ORE);
        put(ax + w / 2, ay + 7, CRYSTAL);
        return;
      }
      int doorX = 1 + (int)(h2(0xE5u, lx, ly) * (w - 4));
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        bool door = oy == h - 1 && ox >= doorX && ox <= doorX + 1;
        put(ax + ox, ay + oy, (border && !door) ? BRICK : EMPTY);
      }
      for (int x = ax + 3; x <= ax + 8; x++) put(x, ay + h - 3, WOOD);
      put(ax + 3, ay + h - 4, CRYSTAL);
    };
    // A treasury with a monumental lock wall behind its ore-hoard.
    auto stampVault = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, STONE);
        int cx = ax + w / 2, cy = ay + h / 2;
        for (int r = 3; r <= imin(9, h / 2 - 2); r += 3) {
          for (int d = -r; d <= r; d++) {
            put(cx + d, cy - r + std::abs(d) / 2, r & 1 ? GOLD_ORE : COPPER_ORE);
            put(cx + d, cy + r - std::abs(d) / 2, r & 1 ? GOLD_ORE : COPPER_ORE);
          }
        }
        put(cx, cy, CRYSTAL);
        for (int x = ax + 3; x <= ax + w - 4; x += 7) {
          for (int y = ay + h - 6; y <= ay + h - 2; y++) put(x, y, IRON_ORE);
          put(x + 2, ay + h - 3, x % 3 == 0 ? GOLD_ORE : COPPER_ORE);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      int fy = ay + h - 2;
      int rewardDepth = fy - terrain.genSurfaceAbs(ax + w / 2);
      bool ironDepth = rewardDepth > 105, goldDepth = rewardDepth > 300;
      for (int ox = 2; ox < w - 2; ox++) {
        double r = h2(0x7000u, ax + ox, ay);
        uint8_t ore = goldDepth && r < 0.14 ? GOLD_ORE
                    : ironDepth && r < 0.42 ? IRON_ORE
                    : r < 0.72 ? COPPER_ORE : EMPTY;
        if (ore != EMPTY) put(ax + ox, fy, ore);
        if (goldDepth && r < 0.06) put(ax + ox, fy - 1, GOLD_ORE); // taller deep-vault heaps
      }
      put(ax + 2, fy, CRYSTAL); put(ax + w - 3, fy, CRYSTAL);
    };
    // A ceremonial gallery. Painted arches continue behind the foreground pillars.
    auto stampColonnade = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, SANDSTONE);
        int fy = ay + h - 1;
        for (int px = ax + 1; px < ax + w; px += 12) {
          for (int y = ay + 2; y < fy; y++) put(px, y, BRICK);
          for (int dx = -4; dx <= 4; dx++) {
            int archY = ay + 3 + std::abs(dx) / 2;
            put(px + 6 + dx, archY, BRICK);
          }
        }
        // Repeating mosaic panels and offering bowls make the long hall legible.
        for (int x = ax + 6; x < ax + w - 4; x += 12) {
          for (int d = -3; d <= 3; d++) {
            put(x + d, ay + h / 2 - 3 + std::abs(d), MOSS);
            put(x + d, ay + h / 2 + 3 - std::abs(d), COPPER_ORE);
          }
          put(x, ay + h / 2, CRYSTAL);
          for (int dx = -2; dx <= 2; dx++) put(x + dx, fy - 3, CLAY);
        }
        return;
      }
      for (int oy = 1; oy < h - 1; oy++) for (int ox = 1; ox < w - 1; ox++) put(ax + ox, ay + oy, EMPTY);
      for (int ox = 0; ox < w; ox++) { put(ax + ox, ay, BRICK); put(ax + ox, ay + h - 1, BRICK); }
      for (int ox = 0; ox < w; ox += 12) for (int oy = 1; oy < h - 1; oy++) {
        put(ax + ox, ay + oy, BRICK);
        if (ox + 1 < w) put(ax + ox + 1, ay + oy, BRICK);
      }
      put(ax + w / 2, ay + h - 2, CRYSTAL);             // an altar crystal for light
    };
    // A stepped brick pyramid backed by a mineral sunburst and votive niches.
    auto stampShrine = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, STONE);
        int cx = ax + w / 2, cy = ay + h / 2 - 1;
        for (int r = 2; r <= imin(9, w / 2 - 2); r += 2) {
          for (int d = -r; d <= r; d++) {
            put(cx + d, cy - r + std::abs(d), r % 4 ? CRYSTAL : GOLD_ORE);
            put(cx + d, cy + r - std::abs(d), r % 4 ? CRYSTAL : GOLD_ORE);
          }
        }
        for (int x = ax + 3; x < ax + w - 2; x += 5) {
          put(x, ay + h - 4, CLAY); put(x, ay + h - 5, GLOWBERRY);
        }
        return;
      }
      int base = ay + h - 1, steps = imin(w / 2, h - 1);
      for (int s = 0; s <= steps; s++) for (int ox = s; ox < w - s; ox++) put(ax + ox, base - s, BRICK);
      int topY = base - steps, cx = ax + w / 2;
      int ch = 4 + (int)(h2(0x7100u, lx, ly) * 5);      // 4..8 crystal spire
      for (int i = 0; i < ch; i++) { int rad = imax(0, 2 - i / 2); for (int dx = -rad; dx <= rad; dx++) put(cx + dx, topY - 1 - i, CRYSTAL); }
      put(cx - 1, topY, CRYSTAL); put(cx + 1, topY, CRYSTAL);
    };
    // A smithy with a contained crucible, tool wall, bellows, and ore racks.
    auto stampForge = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, BRICK);
        int fy = ay + h - 1;
        for (int x = ax + 3; x <= ax + w - 4; x++) put(x, fy - 6, WOOD);
        for (int x : {ax + 5, ax + w - 6}) for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
        for (int x = ax + 5; x < ax + w - 4; x += 5) {
          put(x, fy - 10, IRON_ORE); put(x + 1, fy - 9, x & 1 ? COPPER_ORE : GOLD_ORE);
        }
        for (int x = ax + 3; x <= ax + 11; x++) for (int y = fy - 8; y < fy; y++)
          if (x == ax + 3 || x == ax + 11 || y == fy - 8) put(x, y, STONE);
        put(ax + 7, fy - 2, CRYSTAL); put(ax + 7, fy - 3, GOLD_ORE);
        for (int d = 0; d < 6; d++) {
          put(ax + w - 9 - d, fy - 3 - d / 2, WOOD);
          put(ax + w - 9 + d, fy - 3 - d / 2, WOOD);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      int cx = ax + w / 2, fy = ay + h - 1;             // crucible sits in the floor
      for (int ox = cx - 2; ox <= cx + 2; ox++) { put(ox, fy, STONE); put(ox, fy - 1, LAVA); }
      put(cx - 3, fy, STONE); put(cx - 3, fy - 1, STONE); // stone hearth fully contains the lava
      put(cx + 3, fy, STONE); put(cx + 3, fy - 1, STONE);
      for (int x = ax + 3; x <= ax + 8; x++) put(x, fy - 2, WOOD);
      uint8_t toolMetal = fy - terrain.genSurfaceAbs(ax + w - 6) > 105 ? IRON_ORE : COPPER_ORE;
      put(ax + w - 6, fy - 2, toolMetal); put(ax + w - 6, fy - 3, toolMetal);
    };
    // A lost archive with tall book bays, reading tables, maps, and balconies.
    // The shelves remain in the background; only edge stacks and a lectern enter
    // the foreground, preserving a broad central aisle.
    auto stampArchive = [&](int ax, int ay, int w, int h, int lx, int ly) {
      int fy = ay + h - 1, cx = ax + w / 2;
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, SANDSTONE);
        auto bookcase = [&](int x0, int x1) {
          for (int x : {x0, x1}) for (int y = ay + 3; y <= fy - 2; y++) put(x, y, PINE_WOOD);
          for (int shelfY = ay + 6; shelfY < fy - 2; shelfY += 5) {
            for (int x = x0; x <= x1; x++) put(x, shelfY, WOOD);
            for (int x = x0 + 2; x < x1; x += 2) {
              static const uint8_t books[] = { CLAY, MOSS, CRYSTAL, COPPER_ORE, COAL_ORE };
              put(x, shelfY - 1, books[std::abs(x + shelfY) % 5]);
              if ((x + shelfY) & 1) put(x, shelfY - 2, books[std::abs(x + shelfY + 2) % 5]);
            }
          }
        };
        bookcase(ax + 3, ax + 12);
        bookcase(ax + w - 13, ax + w - 4);
        // Central celestial map and librarian's desk.
        int mapY = ay + h / 2 - 3;
        for (int r = 2; r <= 7; r += 2) for (int d = -r; d <= r; d++) {
          if (std::abs(d) == r || (d + r) % 3 == 0)
            put(cx + d, mapY + (r - std::abs(d)) / 2, r == 6 ? GOLD_ORE : CRYSTAL);
        }
        for (int x = cx - 7; x <= cx + 7; x++) put(x, fy - 6, WOOD);
        for (int x : {cx - 5, cx + 5}) for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
        put(cx - 3, fy - 7, CLAY); put(cx, fy - 7, CRYSTAL); put(cx + 3, fy - 7, MOSS);
        for (int y = ay + 1; y <= ay + 7; y++) put(cx, y, PINE_WOOD);
        for (int dx = -3; dx <= 3; dx++) put(cx + dx, ay + 7, IRON_ORE);
        put(cx - 3, ay + 8, CRYSTAL); put(cx, ay + 8, CRYSTAL); put(cx + 3, ay + 8, CRYSTAL);
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      for (int side : {-1, 1}) {
        int x0 = side < 0 ? ax + 2 : ax + w - 6;
        for (int x = x0; x <= x0 + 4; x++) for (int y = fy - 7; y < fy; y++) {
          bool frame = x == x0 || x == x0 + 4 || (y - (fy - 7)) % 3 == 0;
          if (frame) put(x, y, PINE_WOOD);
        }
        int balconyX0 = side < 0 ? ax + 2 : ax + w - 12;
        int balconyX1 = side < 0 ? ax + 11 : ax + w - 3;
        for (int x = balconyX0; x <= balconyX1; x++) put(x, ay + 9, WOOD);
        for (int y = ay + 10; y <= ay + 13; y++) put(side < 0 ? balconyX1 : balconyX0, y, PINE_WOOD);
      }
      for (int x = cx - 2; x <= cx + 2; x++) put(x, fy - 2, WOOD);
      put(cx, fy - 3, CRYSTAL);
    };
    // A crumbled, plant-choked ruin — the lush biome's signature structure.
    auto stampOvergrown = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, BRICK);
        int fy = ay + h - 1;
        for (int x = ax + 1; x < ax + w - 1; x++)
          if (h2(0x7210u, x, ay) < 0.72) put(x, fy - 2, MOSS);
        for (int x = ax + 3; x < ax + w - 3; x += 5) {
          int len = 3 + (int)(h2(0x7211u, x, ay) * (h - 7));
          for (int d = 1; d <= len; d++) put(x, ay + d, VINE);
          if (x & 1) put(x + 1, ay + len, GLOWBERRY);
        }
        for (int x = ax + 5; x < ax + w - 4; x += 7) {
          for (int y = fy - 5; y < fy; y++) put(x, y, PINE_WOOD);
          put(x + 1, fy - 5, CLAY); put(x + 1, fy - 6, PLANT);
        }
        // A broken green-and-gold mural survives beneath the growth.
        for (int d = -5; d <= 5; d++) {
          put(ax + w / 2 + d, ay + h / 2 + std::abs(d) / 2, MOSS);
          if ((d & 2) == 0) put(ax + w / 2 + d, ay + h / 2 - 1, GOLD_ORE);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        if (border) put(ax + ox, ay + oy, h2(0x7200u, ax + ox, ay + oy) < 0.80 ? BRICK : EMPTY); // ~20% crumbled
        else put(ax + ox, ay + oy, EMPTY);
      }
      for (int ox = 1; ox < w - 1; ox++) if (h2(0x7201u, ax + ox, ay) < 0.85) put(ax + ox, ay + h - 2, MOSS); // moss carpet
      for (int ox = 1; ox < w - 1; ox++) if (h2(0x7202u, ax + ox, ay) < 0.45) {  // vines drape from the top wall
        int vlen = 2 + (int)(h2(0x7203u, ax + ox, ay) * (h - 3));
        for (int i = 1; i <= vlen && i < h - 1; i++) put(ax + ox, ay + i, VINE);
      }
      for (int ox = 2; ox < w - 2; ox++) if (h2(0x7204u, ax + ox, ay) < 0.32) {  // leafy plants sprout from the floor
        int ph = 1 + (int)(h2(0x7205u, ax + ox, ay) * 3);
        for (int i = 0; i < ph; i++) put(ax + ox, ay + h - 2 - i, PLANT);
      }
      if (h2(0x7206u, lx, ly) < 0.6) put(ax + 2, ay + h - 2, CRYSTAL); // a soft glow through the leaves
    };
    // A brick grotto sheltering a dense, bioluminescent fungal conservatory.
    auto stampMushGrove = [&](int ax, int ay, int w, int h, int lx, int ly) {
      if (L->isBackground) {
        backdropRoom(ax, ay, w, h, MYCELIUM);
        int fy = ay + h - 1;
        for (int x = ax + 2; x < ax + w - 2; x++) put(x, fy - 2, MYCELIUM);
        for (int x = ax + 4; x < ax + w - 3; x += 5) {
          int mh = 3 + (int)(h2(0x7310u, x, ay) * 5);
          for (int d = 0; d < mh; d++) put(x, fy - 3 - d, MUSH_STEM);
          for (int dx = -3; dx <= 3; dx++)
            if (std::abs(dx) < 3 || h2(0x7311u, x + dx, ay) < 0.72) put(x + dx, fy - 3 - mh, MUSH_CAP);
          if (x % 3 == 0) put(x, fy - 4 - mh, GLOWSHROOM);
        }
        for (int x = ax + 6; x < ax + w - 5; x += 8) {
          for (int y = ay + 1; y <= ay + 5; y++) put(x, y, VINE);
          put(x + 1, ay + 5, GLOWBERRY);
        }
        return;
      }
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      for (int ox = 1; ox < w - 1; ox++) put(ax + ox, ay + h - 2, MYCELIUM); // fungal floor
      for (int m = 0; m < 5; m++) {
        int mx = ax + 3 + m * (w - 6) / 4;
        if (h2(0x7300u + m, lx, ly) >= 0.72) continue;
        int mh = 2 + (int)(h2(0x7301u, mx, ay) * 3);
        for (int i = 0; i < mh; i++) put(mx, ay + h - 3 - i, MUSH_STEM);      // stem rises off the mycelium floor
        int capY = ay + h - 3 - mh;
        for (int dx = -2; dx <= 2; dx++) if (std::abs(dx) <= 1 || h2(0x7302u, mx + dx, capY) < 0.7) put(mx + dx, capY, MUSH_CAP);
        if (m & 1) put(mx, capY - 1, GLOWSHROOM);
      }
      put(ax + 2, ay + h - 3, CRYSTAL);
    };

    for (int ly = lyMin; ly <= lyMax; ly++) for (int lx = lxMin; lx <= lxMax; lx++) {
      if (whash2(sseed, lx, ly) >= 0.25) continue;
      // jittered anchor + hashed size
      int ax = lx * STRUCT_LATTICE + (int)(whash2(sseed ^ 0xA1u, lx, ly) * 6);
      int ay = ly * STRUCT_LATTICE + (int)(whash2(sseed ^ 0xB2u, lx, ly) * 6);
      int w = 28 + (int)(whash2(sseed ^ 0xC3u, lx, ly) * 17); // 28..44
      int h = 18 + (int)(whash2(sseed ^ 0xD4u, lx, ly) * 10); // 18..27
      int kind;
      int centerX, floorY, surfAbs;
      {
        // Background generation temporarily asks the foreground terrain oracle
        // where the ruin sits. The scope restores the active layer before any
        // cells are stamped, so both layers share one exact structure plan even
        // during predictive generation into a scratch band.
        ForegroundTerrainScope foregroundQuery(L);
        // Pick an archetype, biased by the cave biome it sits in so a structure fits
        // its surroundings (lush -> overgrown ruin, mushroom -> grove, crystal ->
        // shrine); elsewhere a mix of the neutral kinds.
        int caveBiome = terrain.genCaveBiomeAt(ax + w / 2, ay + h / 2);
        double pick = whash2(sseed ^ 0x9001u, lx, ly);
        if (caveBiome == CAVE_LUSH && pick < 0.60) kind = SK_OVERGROWN;
        else if (caveBiome == CAVE_MUSHROOM && pick < 0.55) kind = SK_MUSHGROVE;
        else if (caveBiome == CAVE_CRYSTAL && pick < 0.55) kind = SK_SHRINE;
        else {
          static const SKind pool[] = { SK_HOUSE, SK_VAULT, SK_COLONNADE, SK_FORGE, SK_ARCHIVE, SK_OVERGROWN, SK_SHRINE };
          kind = pool[(int)(whash2(sseed ^ 0x9002u, lx, ly) * 7) % 7];
        }
        if (kind == SK_COLONNADE) w += 4;                // halls run wider
        if (kind == SK_ARCHIVE) { w += 8; h += 4; }      // room for shelves + central aisle
        if (kind == SK_SHRINE) {
          w = 19 + (int)(whash2(sseed ^ 0xC4u, lx, ly) * 10);
          h = imax(PLAYER_H + 3, w / 2 + 3);
        }
        // Seat the structure on an actual cave floor near its deterministic
        // candidate. This keeps its reward and doorway on the traversable cave
        // graph instead of creating an isolated room in arbitrary solid stone.
        centerX = ax + w / 2; floorY = INT_MIN;
        for (int radius = 0; radius <= 30 && floorY == INT_MIN; radius++) {
          for (int side = 0; side < (radius == 0 ? 1 : 2); side++) {
            int yy = ay + (radius == 0 ? 0 : (side == 0 ? -radius : radius));
            if (terrain.genOpenCaveAt(centerX, yy) && !terrain.genOpenCaveAt(centerX, yy + 1)) {
              floorY = yy;
              break;
            }
          }
        }
        if (floorY == INT_MIN) continue;
        ay = floorY - h + 1;
        if (ax + w < rectX0 || ax > rectX1 || ay + h < rectY0 || ay > rectY1) continue;
        surfAbs = terrain.genSurfaceAbs(centerX);
        if (ay < surfAbs + 30 || ay + h > terrain.caveBottomAbs()) continue;
        bool overlapsMine = false;
        for (const MineFootprint& mine : mines) {
          if (ax <= mine.right && ax + w >= mine.left
              && ay <= mine.bottom && ay + h >= mine.top) {
            overlapsMine = true;
            break;
          }
        }
        if (overlapsMine) continue;
        if (kind == SK_FORGE && floorY - surfAbs < 180) kind = SK_HOUSE;
      }
      switch (kind) {
        case SK_HOUSE:     stampHouse(ax, ay, w, h, lx, ly); break;
        case SK_VAULT:     stampVault(ax, ay, w, h, lx, ly); break;
        case SK_COLONNADE: stampColonnade(ax, ay, w, h, lx, ly); break;
        case SK_SHRINE:    stampShrine(ax, ay, w, h, lx, ly); break;
        case SK_FORGE:     stampForge(ax, ay, w, h, lx, ly); break;
        case SK_ARCHIVE:   stampArchive(ax, ay, w, h, lx, ly); break;
        case SK_OVERGROWN: stampOvergrown(ax, ay, w, h, lx, ly); break;
        case SK_MUSHGROVE: stampMushGrove(ax, ay, w, h, lx, ly); break;
      }

      // Open one full-height side door and connect it to the first nearby cave
      // cell. The containing cavern normally starts immediately outside the
      // facade; the bounded search also handles thick noise walls.
      if (!L->isBackground) {
        int dir = h2(0xAACC355u, lx, ly) < 0.5 ? -1 : 1;
        int edgeX = dir < 0 ? ax : ax + w - 1;
        int doorBottom = ay + h - 2;
        int doorTop = doorBottom - PLAYER_H - 4;
        int reach = 2;
        for (int d = 1; d <= 28; d++) {
          if (terrain.genOpenCaveAt(edgeX + dir * d, doorBottom)) { reach = d; break; }
        }
        for (int d = 0; d <= reach; d++)
          for (int py = doorTop; py <= doorBottom; py++) put(edgeX + dir * d, py, EMPTY);
      }
    }
  }
  // Deterministic ocean gardens rooted in the background seabed. VINE is used as
  // flexible kelp, with leafy forks and occasional luminous berries attached to
  // the stalk so every generated plant cell belongs to a grounded component.
  void fillOceanFlora(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (!L->isBackground) return;
    auto put = [&](int wx, int wy, uint8_t m) {
      if (wy < L->gSeaRow) return; // ocean flora never breaches the water surface
      int x = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
      if (x < colStart || x >= colEnd || y < rowStart || y >= rowEnd) return;
      int k = y * cols + x; if (L->grid[k] == WATER || L->grid[k] == EMPTY) L->grid[k] = m;
    };
    const int REACH = 5;
    for (int x = colStart - REACH; x < colEnd + REACH; x++) {
      int wx = L->worldOffsetX + x, surfAbs = terrain.genSurfaceAbs(wx);
      if (surfAbs <= L->gSeaRow + 3) continue;
      double spawn = whash1(L->worldSeed ^ 0x5EA9EEDu, wx);
      if (spawn > 0.115) continue;
      int height = 4 + (int)(whash1(L->worldSeed ^ 0x5EA9EEEu, wx) * imin(18, imax(5, surfAbs - L->gSeaRow - 1)));
      for (int i = 1; i <= height; i++) {
        int sway = i > height / 2 && whash2(L->worldSeed ^ 0x5EA9EEFu, wx, i) > 0.72 ? (i & 1 ? 1 : -1) : 0;
        put(wx + sway, surfAbs - i, VINE);
        if (i > 2 && i % 4 == 0) put(wx + (i & 4 ? 1 : -1), surfAbs - i, PLANT);
        if (i > 3 && whash2(L->worldSeed ^ 0x610BEEu, wx, i) > 0.91) put(wx + (i & 1 ? 1 : -1), surfAbs - i + 1, GLOWBERRY);
      }
    }
  }
  void putCaveFeatureCell(int colStart, int colEnd, int rowStart, int rowEnd, int wx, int wy, uint8_t m, bool requireEmpty = true) {
    int lx = wx - L->worldOffsetX, y = wy - L->worldOffsetY;
    if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return;
    int k = y * cols + lx;
    if (requireEmpty && L->grid[k] != EMPTY) return;
    L->grid[k] = m;
  }
  // Foreground cave biomes. The terrain pass decides the cave shape; this pass
  // attaches biome detail to floors, ceilings and walls so features blend into the
  // existing cave network rather than carving detached oval rooms.
  void fillCaveFeatures(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (L->isBackground) return;
    uint32_t sseed = L->gCaveSeed ^ 0xF3A741u;
    static const int FEATURE_LATTICE = 11, FEATURE_REACH = 40; // >= widest feature (big acid lakes)
    int wx0 = L->worldOffsetX + colStart - FEATURE_REACH, wx1 = L->worldOffsetX + colEnd + FEATURE_REACH;
    int wy0 = L->worldOffsetY + rowStart - FEATURE_REACH, wy1 = L->worldOffsetY + rowEnd + FEATURE_REACH;
    int lxMin = floorDiv(wx0, FEATURE_LATTICE), lxMax = floorDiv(wx1, FEATURE_LATTICE);
    int lyMin = floorDiv(wy0, FEATURE_LATTICE), lyMax = floorDiv(wy1, FEATURE_LATTICE);
    auto findFloor = [&](int wx, int wy, int& floorY) {
      for (int dy = -8; dy <= 12; dy++) {
        int yy = wy + dy;
        if (terrain.genOpenCaveAt(wx, yy) && !terrain.genOpenCaveAt(wx, yy + 1)) { floorY = yy; return true; }
      }
      return false;
    };
    auto findCeiling = [&](int wx, int wy, int& ceilY) {
      for (int dy = -12; dy <= 8; dy++) {
        int yy = wy + dy;
        if (terrain.genOpenCaveAt(wx, yy) && !terrain.genOpenCaveAt(wx, yy - 1)) { ceilY = yy; return true; }
      }
      return false;
    };
    auto stampCrystalSpike = [&](int wx, int baseY, int dir, int ht, int baseRad) {
      // Width is purely the tapering radius (no height-driven base flare — that was
      // what made tall spikes balloon out sideways). Base width = 2*baseRad+1,
      // narrowing to a point every 4 rows up.
      for (int i = 0; i < ht && terrain.genOpenCaveAt(wx, baseY + dir * i); i++) {
        int rad = imax(0, baseRad - i / 4);
        for (int dx = -rad; dx <= rad; dx++)
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + dx, baseY + dir * i, CRYSTAL);
      }
    };
    auto stampSaltPile = [&](int wx, int floorY, int gx, int gy) {
      int half = 2 + (int)(whash2(sseed ^ 0x611u, gx, gy) * 5);
      int maxH = 2 + (int)(whash2(sseed ^ 0x612u, gx, gy) * 4);
      for (int dx = -half; dx <= half; dx++) {
        int px = wx + dx;
        double falloff = 1.0 - (double)std::abs(dx) / (double)(half + 1);
        int hgt = 1 + (int)std::floor(falloff * maxH);
        for (int i = 0; i < hgt && terrain.genOpenCaveAt(px, floorY - i); i++) {
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY - i, SALT);
        }
      }
    };
    auto stampMethanePocket = [&](int wx, int ceilY, int gx, int gy) {
      // A shallow lens attached to the cave ceiling. The generic gas pass lets it
      // spread into nearby high points afterward; generation only supplies a
      // deterministic, seam-safe initial pocket.
      int rx = 6 + (int)(whash2(sseed ^ 0x6A50u, gx, gy) * 8);
      int depth = 2 + (int)(whash2(sseed ^ 0x6A51u, gx, gy) * 2);
      for (int dy = 0; dy < depth; dy++) {
        double t = (double)dy / (double)depth;
        int half = imax(1, (int)std::floor(rx * std::sqrt(1.0 - t * t)));
        for (int dx = -half; dx <= half; dx++) {
          int px = wx + dx, py = ceilY + dy;
          if (terrain.genOpenCaveAt(px, py))
            putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, py, METHANE);
        }
      }
    };
    auto stampLavaBasin = [&](int wx, int floorY, int gx, int gy) {
      // Wide size spread: a squared roll skews toward many small glowing pools with
      // the occasional big lake. Depth tracks width so the pool stays basin-shaped
      // (never a flat lava streak) and stone-lined.
      double lv = whash2(sseed ^ 0x550u, gx, gy);
      int rx = 4 + (int)(lv * lv * 14);                                    // 4..17
      int ry = 2 + (int)(whash2(sseed ^ 0x551u, gx, gy) * 4) + rx / 4;     // depth grows with width
      for (int dx = -rx - 3; dx <= rx + 3; dx++) {
        int px = wx + dx;
        double ax = (double)std::abs(dx);
        double nx = std::fmin(1.0, ax / (double)imax(1, rx));
        double curve = std::sqrt(std::fmax(0.0, 1.0 - nx * nx));
        int depth = 3 + (int)std::floor(curve * ry);
        bool bank = ax > rx;
        bool wall = ax >= rx - 2;
        if (bank) {
          for (int yy = floorY - 1; yy <= floorY + depth + 2; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, STONE, false);
          continue;
        }
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 1, STONE, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth, STONE, false);
        if (wall) {
          for (int yy = floorY - 1; yy <= floorY + depth; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, STONE, false);
        } else {
          for (int yy = floorY; yy < floorY + depth; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, LAVA, false);
        }
      }
    };
    auto stampCrystalAcidBasin = [&](int wx, int floorY, int gx, int gy) {
      // Big lakes are the norm: taking the MAX of two rolls skews the size toward
      // the large end, and the floor keeps out tiny ponds entirely. Depth tracks
      // width so even the widest basins stay rounded (never a flat acid smear).
      double av = whash2(sseed ^ 0x440u, gx, gy), bv = whash2(sseed ^ 0x441u, gx, gy);
      int rx = 12 + (int)(std::fmax(av, bv) * 23);                         // 12..35, large-skewed
      int ry = 3 + (int)(whash2(sseed ^ 0x442u, gx, gy) * 5) + rx / 5;     // depth grows with width (lake-like)
      for (int dx = -rx - 4; dx <= rx + 4; dx++) {
        int px = wx + dx;
        double ax = (double)std::abs(dx);
        double nx = std::fmin(1.0, ax / (double)imax(1, rx));
        double curve = std::sqrt(std::fmax(0.0, 1.0 - nx * nx));
        int depth = 3 + (int)std::floor(curve * ry);
        bool bank = ax > rx;
        bool wall = ax >= rx - 2;
        if (bank) {
          for (int yy = floorY - 2; yy <= floorY + depth + 3; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, STONE, false);
          continue;
        }
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 2, STONE, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 1, STONE, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth, CRYSTAL, false);
        putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth - 1, CRYSTAL, false);
        if (wall) {
          for (int yy = floorY - 1; yy <= floorY + depth; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, CRYSTAL, false);
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, floorY + depth + 1, STONE, false);
        } else {
          for (int yy = floorY; yy < floorY + depth - 1; yy++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, yy, ACID, false);
        }
      }
    };
    auto stampMyceliumTendril = [&](int wx, int startY, int gx, int gy) {
      int len = 9 + (int)(whash2(sseed ^ 0x220u, gx, gy) * 20);
      int dir = whash2(sseed ^ 0x221u, gx, gy) < 0.5 ? -1 : 1;
      int px = wx, py = startY;
      for (int i = 0; i < len; i++) {
        if (terrain.genOpenCaveAt(px, py)) {
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, py, MYCELIUM);
          if (whash2(sseed ^ 0x225u, px, py) > 0.72) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px, py - 1, MYCELIUM);
          if (whash2(sseed ^ 0x226u, px, py) > 0.82) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, px - dir, py, MYCELIUM);
        }
        px += dir;
        double step = whash2(sseed ^ 0x224u, gx * 31 + i, gy);
        if (step < 0.24) py--;
        else if (step > 0.78) py++;
      }
    };
    for (int gy = lyMin; gy <= lyMax; gy++) for (int gx = lxMin; gx <= lxMax; gx++) {
      int wx = gx * FEATURE_LATTICE + (int)(whash2(sseed ^ 0x11u, gx, gy) * FEATURE_LATTICE);
      int wy = gy * FEATURE_LATTICE + (int)(whash2(sseed ^ 0x22u, gx, gy) * FEATURE_LATTICE);
      int caveBiome = terrain.genCaveBiomeAt(wx, wy);
      int caveTop = terrain.genCaveTopAbs(wx);
      double depth01 = std::fmax(0.0, std::fmin(1.0,
        (double)(wy - caveTop) / (double)imax(1, terrain.caveBottomAbs() - caveTop)));
      double h = whash2(sseed, gx, gy);
      double lavaH = whash2(sseed ^ 0x55AAu, gx, gy);
      int floorY = wy, ceilY = wy;
      bool hasFloor = findFloor(wx, wy, floorY), hasCeil = findCeiling(wx, wy, ceilY);

      // Hazard pressure rises with depth. The first fifth of the cave network is
      // deliberately forgiving; below it, danger ramps continuously rather than
      // appearing at one hard world-Y boundary.
      double hazardDepth = std::fmax(0.0, (depth01 - 0.18) / 0.82);

      // Lava pools are the main light source in the caves that grow nothing
      // luminous of their own: plain and (to a lesser extent) mushroom/lush caves
      // get them far more often. Crystal caves stay lava-light — they glow already.
      double lavaThr = (caveBiome == CAVE_DEFAULT ? 0.0100
                     : caveBiome == CAVE_CRYSTAL ? 0.0012
                     : 0.0034) * (hazardDepth * 2.50);
      if (hasFloor && lavaH < lavaThr) {
        stampLavaBasin(wx, floorY, gx, gy);
        continue;
      }

      // Rare ceiling pockets make otherwise-dark caves hazardous. Mushroom caves
      // are richest; crystal caves are nearly methane-free. Keeping this sparse
      // avoids filling every generated window with permanently active gas.
      double methaneH = whash2(sseed ^ 0x6A52u, gx, gy);
      double methaneThr = (caveBiome == CAVE_MUSHROOM ? 0.009
                          : caveBiome == CAVE_DEFAULT ? 0.006
                          : caveBiome == CAVE_LUSH ? 0.002 : 0.001) * (hazardDepth * 1.30);
      if (hasCeil && methaneH < methaneThr) {
        stampMethanePocket(wx, ceilY, gx, gy);
        continue;
      }

      if (caveBiome == CAVE_CRYSTAL) {
        double acidThreshold = hazardDepth > 0 ? 0.003 + hazardDepth * 0.038 : 0.0;
        if (hasFloor && h < acidThreshold) stampCrystalAcidBasin(wx, floorY, gx, gy);
        else if (hasFloor && h < 0.30) stampSaltPile(wx, floorY, gx, gy);
        else if ((hasFloor || hasCeil) && h < 0.40) {
          // GIANT crystal cluster: a slender central spire hugged by a couple of
          // shorter ones — a tight bouquet, not a wide fan.
          bool fromFloor = hasFloor && (!hasCeil || whash2(sseed ^ 0x333u, gx, gy) < 0.70);
          int baseY = fromFloor ? floorY : ceilY, dir = fromFloor ? -1 : 1;
          int bigH = 7 + (int)(whash2(sseed ^ 0x334u, gx, gy) * 8); // 7..14 tall
          int bigR = 1 + (int)(whash2(sseed ^ 0x335u, gx, gy) * 2); // 1..2 wide
          stampCrystalSpike(wx, baseY, dir, bigH, bigR);
          stampCrystalSpike(wx - 1, baseY, dir, bigH * 2 / 3, 1);
          stampCrystalSpike(wx + 1, baseY, dir, bigH * 3 / 4, 1);
          stampCrystalSpike(wx - 2, baseY, dir, bigH / 2, 0);
          stampCrystalSpike(wx + 2, baseY, dir, bigH / 2, 0);
        }
        else if ((hasFloor || hasCeil) && h < 0.64) {
          bool fromFloor = hasFloor && (!hasCeil || whash2(sseed ^ 0x331u, gx, gy) < 0.68);
          int baseY = fromFloor ? floorY : ceilY, dir = fromFloor ? -1 : 1;
          int ht = 3 + (int)(whash2(sseed ^ 0x330u, gx, gy) * 8); // 3..10 slender spikes
          stampCrystalSpike(wx, baseY, dir, ht, 1);
        }
      } else if (caveBiome == CAVE_MUSHROOM) {
        if (hasFloor && h < 0.50) stampMyceliumTendril(wx, floorY, gx, gy);
        if (hasCeil && h > 0.82) stampMyceliumTendril(wx, ceilY, gx ^ 0x31, gy ^ 0x17);
        if (hasFloor && h > 0.60) {
          int mh = 3 + (int)(whash2(sseed ^ 0x222u, gx, gy) * 7);
          for (int i = 0; i < mh && terrain.genOpenCaveAt(wx, floorY - i); i++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY - i, MUSH_STEM);
          int capY = floorY - mh;
          int capR = 2 + (int)(whash2(sseed ^ 0x223u, gx, gy) * 3);
          // About half the giant mushrooms are bioluminescent — a glowing blue cap.
          uint8_t capMat = whash2(sseed ^ 0x226u, gx, gy) < 0.5 ? GLOWSHROOM : MUSH_CAP;
          for (int dx = -capR; dx <= capR; dx++) {
            if (std::abs(dx) <= 1 || whash2(sseed ^ 0x224u, wx + dx, capY) < 0.78) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + dx, capY, capMat);
          }
        }
        if (hasFloor && h > 0.40 && h < 0.56) {   // little bioluminescent mushrooms scattered on the floor
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY, MUSH_STEM);
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY - 1, GLOWSHROOM);
          if (whash2(sseed ^ 0x230u, gx, gy) < 0.5 && terrain.genOpenCaveAt(wx + 1, floorY) && !terrain.genOpenCaveAt(wx + 1, floorY + 1)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + 1, floorY, GLOWSHROOM);
        }
        if ((hasFloor || hasCeil) && h > 0.89) {   // occasional crystal spike — brighten the fungal dark
          int baseY = hasFloor ? floorY : ceilY;
          stampCrystalSpike(wx, baseY, hasFloor ? -1 : 1, 3 + (int)(whash2(sseed ^ 0x227u, gx, gy) * 5), whash2(sseed ^ 0x22Au, gx, gy) < 0.4 ? 1 : 0);
        }
      } else if (caveBiome == CAVE_LUSH) {
        // Independent per-feature rolls (not one shared h) so a lush cell can carry a
        // mossy floor AND drooping vines AND a leafy bush at once -> visibly greener.
        double pMoss = whash2(sseed ^ 0x101u, gx, gy);
        double pVine = whash2(sseed ^ 0x102u, gx, gy);
        double pBush = whash2(sseed ^ 0x103u, gx, gy);
        // Mossy floor carpet almost everywhere there's a floor, spreading sideways.
        if (hasFloor && pMoss < 0.92) {
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY, pMoss < 0.5 ? PLANT : MOSS);
          if (terrain.genOpenCaveAt(wx + 1, floorY)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + 1, floorY, MOSS);
          if (pMoss < 0.6 && terrain.genOpenCaveAt(wx - 1, floorY)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx - 1, floorY, MOSS);
        }
        // Long drooping vines from the ceiling, often in a second offset strand.
        // Ripe glowberries stud the vines and light the hollow orange (they hang
        // beside a vine cell so they join the vine's plant component and stay put).
        auto studBerry = [&](int vx, int vy) {
          if (whash2(sseed ^ 0x120u, vx, vy) >= 0.13) return;
          int bdx = whash2(sseed ^ 0x121u, vx, vy) < 0.5 ? 1 : -1;
          putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, vx + bdx, vy, GLOWBERRY);
        };
        if (hasCeil && pVine < 0.80) {
          int len = 5 + (int)(whash2(sseed ^ 0x110u, gx, gy) * 18);
          for (int i = 0; i < len && terrain.genOpenCaveAt(wx, ceilY + i); i++) { putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, ceilY + i, VINE); if (i > 0) studBerry(wx, ceilY + i); }
          if (pVine < 0.42) {
            int vdx = whash2(sseed ^ 0x115u, gx, gy) < 0.5 ? 1 : -1;
            int len2 = 3 + (int)(whash2(sseed ^ 0x114u, gx, gy) * 12);
            for (int i = 0; i < len2 && terrain.genOpenCaveAt(wx + vdx, ceilY + i); i++) { putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + vdx, ceilY + i, VINE); if (i > 0) studBerry(wx + vdx, ceilY + i); }
          }
        }
        // Leafy green bushes / tall plants rising from the floor with a little crown.
        if (hasFloor && pBush < 0.50) {
          int ht = 3 + (int)(whash2(sseed ^ 0x111u, gx, gy) * 6);
          for (int i = 0; i < ht && terrain.genOpenCaveAt(wx, floorY - i); i++) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx, floorY - i, PLANT);
          int crownY = floorY - ht + 1;
          for (int cdx = -1; cdx <= 1; cdx += 2) if (terrain.genOpenCaveAt(wx + cdx, crownY)) putCaveFeatureCell(colStart, colEnd, rowStart, rowEnd, wx + cdx, crownY, PLANT);
        }
        if ((hasFloor || hasCeil) && h > 0.91) {   // crystal accents scattered through the greenery
          int baseY = hasFloor ? floorY : ceilY;
          stampCrystalSpike(wx, baseY, hasFloor ? -1 : 1, 3 + (int)(whash2(sseed ^ 0x112u, gx, gy) * 5), whash2(sseed ^ 0x113u, gx, gy) < 0.4 ? 1 : 0);
        }
      } else {   // CAVE_DEFAULT: the darkest caves — seed them with the most glinting minerals
        if ((hasFloor || hasCeil) && h > 0.86) {
          int baseY = hasFloor ? floorY : ceilY, dir = hasFloor ? -1 : 1;
          // occasionally a small clustered spike, otherwise a lone slender one
          if (h > 0.95) stampCrystalSpike(wx, baseY, dir, 4 + (int)(whash2(sseed ^ 0x229u, gx, gy) * 5), 1);
          else stampCrystalSpike(wx, baseY, dir, 3 + (int)(whash2(sseed ^ 0x228u, gx, gy) * 4), whash2(sseed ^ 0x22Bu, gx, gy) < 0.35 ? 1 : 0);
        }
      }
    }
    sealHazardBoundaries(colStart, colEnd, rowStart, rowEnd);
  }
  void sealHazardBoundaries(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int y = rowStart; y < rowEnd; y++) for (int x = colStart; x < colEnd; x++) {
      int k = y * cols + x;
      if (L->grid[k] != SALT && !isDissolvable(L->grid[k])) continue;
      bool touchesAcid = (x > 0 && L->grid[k - 1] == ACID) || (x + 1 < cols && L->grid[k + 1] == ACID)
                       || (y > 0 && L->grid[k - cols] == ACID) || (y + 1 < rows && L->grid[k + cols] == ACID);
      if (touchesAcid) L->grid[k] = CRYSTAL;
    }
    for (int y = rowStart; y < rowEnd; y++) for (int x = colStart; x < colEnd; x++) {
      int k = y * cols + x;
      if (L->grid[k] == ACID) {
        if (y + 1 < rows && L->grid[k + cols] != ACID) L->grid[k + cols] = CRYSTAL;
        if (x > 0 && L->grid[k - 1] != ACID && L->grid[k - 1] != EMPTY) L->grid[k - 1] = CRYSTAL;
        if (x + 1 < cols && L->grid[k + 1] != ACID && L->grid[k + 1] != EMPTY) L->grid[k + 1] = CRYSTAL;
      } else if (L->grid[k] == LAVA) {
        if (y + 1 < rows && L->grid[k + cols] != LAVA) L->grid[k + cols] = STONE;
        if (x > 0 && L->grid[k - 1] != LAVA && L->grid[k - 1] != EMPTY) L->grid[k - 1] = STONE;
        if (x + 1 < cols && L->grid[k + 1] != LAVA && L->grid[k + 1] != EMPTY) L->grid[k + 1] = STONE;
      }
    }
  }
  void copyGridToNext(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int lx = colStart; lx < colEnd; lx++) for (int y = rowStart; y < rowEnd; y++) { int k = y * cols + lx; L->next[k] = L->grid[k]; }
  }
  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd):
  // terrain, natural dressing, constructed structures, trees, then `L->next`.
  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    fillTerrain(colStart, colEnd, rowStart, rowEnd);
    fillCaveFeatures(colStart, colEnd, rowStart, rowEnd);
    fillOceanFlora(colStart, colEnd, rowStart, rowEnd);
    fillStructures(colStart, colEnd, rowStart, rowEnd); // keep constructed interiors clear of natural cave dressing
    sealHazardBoundaries(colStart, colEnd, rowStart, rowEnd);
    fillTrees(colStart, colEnd, rowStart, rowEnd);
    copyGridToNext(colStart, colEnd, rowStart, rowEnd);
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).
  void initInfiniteLayerState(uint32_t seed, uint32_t layerSalt, bool background) {
    L->infinite = true; L->isBackground = background; L->worldSeed = seed;
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.22));
    L->gSeaRow = TerrainGen::SEA_LEVEL;
    L->gSoil = TerrainGen::BASE_SOIL_DEPTH;
    L->gCaveSeed = (seed ^ 0x5bd1e995u) + layerSalt * 0x9e3779b9u;
    L->gPocketSeed = (seed ^ 0xC0FFEE11u) + layerSalt * 0x85ebca6bu;
    L->gTreeSeed = seed ^ 0x1b56c4f9u; // shared so tree silhouettes line up across layers
    L->worldOffsetX = (-(cols / 2)) & ~(CHUNK_SIZE - 1);   // tile-aligned origin (2D tile store needs alignment)
    L->worldOffsetY = (-L->gSurfBase) & ~(CHUNK_SIZE - 1); // surface centre (worldY=0) ~gSurfBase down the buffer
  }
  void initInfiniteLayer(uint32_t seed, uint32_t layerSalt, bool background) {
    initInfiniteLayerState(seed, layerSalt, background);
    fillRect(0, cols, 0, rows);
    registerSeededComponents(0, cols);
  }
  void initInfinite(uint32_t seed) {
    useLayer(&fg); initInfiniteLayer(seed, 0, false); // foreground: caves carved for traversal
    useLayer(&bg); initInfiniteLayer(seed, 1, true);  // background: more-solid backdrop
    bgEnabled = true;
    useLayer(&fg);
  }
  // The browser mirror receives its actual cells from the authority worker. It
  // still needs deterministic terrain metadata for the initial camera surface,
  // but generating a duplicate world would require all simulation scratch and
  // defeat the presentation storage profile.
  void initInfinitePresentation(uint32_t seed) {
    useLayer(&fg); initInfiniteLayerState(seed, 0, false);
    useLayer(&bg); initInfiniteLayerState(seed, 1, true);
    bgEnabled = true;
    useLayer(&fg);
  }
  void shiftRowMajorU8(uint8_t* arr, int dx, uint8_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, cols - dx); memset(arr + b + cols - dx, fill, dx); }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, cols - s); memset(arr + b, fill, s); } }
  }
  // Vertical slide of a row-major buffer by dy rows (dy>0: content moves UP, new
  // band enters at the bottom). A single contiguous memmove (no per-row loop).
  void shiftBufV(uint8_t* arr, int dy, uint8_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols;
    if (dy > 0) { memmove(arr, arr + band, rest); memset(arr + rest, fill, band); }
    else { memmove(arr + band, arr, rest); memset(arr, fill, band); }
  }
  void shiftBufVI32(int32_t* arr, int dy, int32_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols, n = (size_t)rows * cols;
    if (dy > 0) { memmove(arr, arr + band, rest * 4); for (size_t i = rest; i < n; i++) arr[i] = fill; }
    else { memmove(arr + band, arr, rest * 4); for (size_t i = 0; i < band; i++) arr[i] = fill; }
  }
  // Re-index every component after the L->grid slid by (dx,dy). One axis at a time:
  // each cell's new (col,row) is (x-dx, y-dy); cells that slid off the buffer drop.
  void translateComponents(std::vector<Comp>& list, int dx, int dy) {
    size_t w = 0;
    for (size_t r = 0; r < list.size(); r++) {
      Comp& comp = list[r]; auto& cs = comp.cells; size_t cw = 0; int yMax = 0;
      for (size_t i = 0; i < cs.size(); i++) {
        int k = cs[i]; int nxC = (k % cols) - dx, nyC = (k / cols) - dy;
        if (nxC < 0 || nxC >= cols || nyC < 0 || nyC >= rows) continue; // slid off the buffer
        cs[cw++] = nyC * cols + nxC; if (nyC > yMax) yMax = nyC;
      }
      if (cw == 0) continue;
      cs.resize(cw); comp.yMax = yMax; comp.cacheDirty = true;
      // The carry history is coordinate-bearing state for the ping-pong
      // buffers. Rebuild its staying footprint from these already-translated
      // cells instead of performing a second full index-translation pass.
      L->prevCompCells.insert(L->prevCompCells.end(), cs.begin(), cs.end());
      if (w != r) list[w] = std::move(comp);
      w++;
    }
    list.resize(w);
  }
  // ---- 2D tile chunk store: changed sim-state keyed by absolute tiles --------
  static inline int64_t tileKey(int tx, int ty) {
    return (int64_t)(((uint64_t)(uint32_t)tx << 32) | (uint32_t)ty);
  }
  void markWorldTileDirty(int k) {
    if (!L->infinite || L->storageRole == ESR_PRESENTATION || k < 0 || k >= cols * rows) return;
    int y = k / cols, x = k - y * cols;
    int wx = L->worldOffsetX + x, wy = L->worldOffsetY + y;
    L->dirtyWorldTiles.insert(tileKey(floorDiv(wx, CHUNK_SIZE), floorDiv(wy, CHUNK_SIZE)));
  }
  void markWorldRectDirty(int x0, int y0, int x1, int y1) {
    if (!L->infinite || L->storageRole == ESR_PRESENTATION || x1 < x0 || y1 < y0) return;
    int tx0 = floorDiv(L->worldOffsetX + x0, CHUNK_SIZE);
    int tx1 = floorDiv(L->worldOffsetX + x1, CHUNK_SIZE);
    int ty0 = floorDiv(L->worldOffsetY + y0, CHUNK_SIZE);
    int ty1 = floorDiv(L->worldOffsetY + y1, CHUNK_SIZE);
    for (int ty = ty0; ty <= ty1; ty++)
      for (int tx = tx0; tx <= tx1; tx++) L->dirtyWorldTiles.insert(tileKey(tx, ty));
  }
  static void encodeTile(const uint8_t* raw, std::vector<uint8_t>& out) {
    std::vector<uint8_t> packed;
    packed.reserve(CHUNK_SIZE * 4);
    const int count = CHUNK_SIZE * CHUNK_SIZE;
    for (int i = 0; i < count;) {
      int run = 1;
      while (i + run < count && raw[i + run] == raw[i] && run < 255) run++;
      packed.push_back((uint8_t)run);
      packed.push_back(raw[i]);
      i += run;
    }
    if ((int)packed.size() < count) out.swap(packed);
    else out.assign(raw, raw + count);
  }
  static bool decodeTile(const std::vector<uint8_t>& stored, uint8_t* out) {
    const int count = CHUNK_SIZE * CHUNK_SIZE;
    if ((int)stored.size() == count) {
      memcpy(out, stored.data(), count);
      return true;
    }
    int cursor = 0;
    if (stored.empty() || (stored.size() & 1)) return false;
    for (size_t i = 0; i < stored.size(); i += 2) {
      int run = stored[i];
      if (run <= 0 || cursor + run > count) return false;
      memset(out + cursor, stored[i + 1], (size_t)run);
      cursor += run;
    }
    return cursor == count;
  }
  size_t worldStoreBytes() const {
    size_t total = 0;
    auto add = [&](const Layer& lay) {
      for (const auto& entry : lay.tileStore) total += entry.second.size();
      for (const auto& entry : lay.prefetchStore) total += entry.second.size();
    };
    add(fg); add(bg);
    return total;
  }
  int worldStoredTileCount() const { return (int)(fg.tileStore.size() + bg.tileStore.size()); }
  int worldPrefetchTileCount() const { return (int)(fg.prefetchStore.size() + bg.prefetchStore.size()); }
  // Only WHOLE 32x32 tiles fully inside the buffer are persisted; a partial edge
  // tile (when cols/rows aren't chunk-multiples — e.g. the headless tests) is
  // skipped and just regenerates. The game's buffer is chunk-rounded, so every
  // tile is whole and persistence is complete.
  bool wholeTile(int tx, int ty) { return tx >= 0 && ty >= 0 && tx + CHUNK_SIZE <= cols && ty + CHUNK_SIZE <= rows; }
  void csSaveTiles(int bx0, int by0, int w, int h) { // uses the CURRENT offset (leaving band)
    std::array<uint8_t, CHUNK_SIZE * CHUNK_SIZE> raw;
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        int64_t key = tileKey(floorDiv(awx, CHUNK_SIZE), floorDiv(awy, CHUNK_SIZE));
        for (int r = 0; r < CHUNK_SIZE; r++)
          memcpy(raw.data() + r * CHUNK_SIZE,
                 L->grid + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
        if (!L->dirtyWorldTiles.count(key)) {
          L->tileStore.erase(key);
          if (L->prefetchStore.find(key) == L->prefetchStore.end())
            encodeTile(raw.data(), L->prefetchStore[key]);
          continue;
        }
        L->prefetchStore.erase(key);
        encodeTile(raw.data(), L->tileStore[key]);
      }
  }
  bool csTilesAllPresent(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false; // a partial tile is never persisted -> must regenerate
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        int64_t key = tileKey(floorDiv(awx, CHUNK_SIZE), floorDiv(awy, CHUNK_SIZE));
        if (L->tileStore.find(key) == L->tileStore.end() &&
            L->prefetchStore.find(key) == L->prefetchStore.end()) return false;
      }
    return true;
  }
  void csLoadTiles(int bx0, int by0, int w, int h) { // overlay saved tiles (NEW offset); missing left as-is
    std::array<uint8_t, CHUNK_SIZE * CHUNK_SIZE> raw;
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        int64_t key = tileKey(floorDiv(awx, CHUNK_SIZE), floorDiv(awy, CHUNK_SIZE));
        auto persistent = L->tileStore.find(key);
        auto prefetched = L->prefetchStore.find(key);
        const std::vector<uint8_t>* stored = persistent != L->tileStore.end() ? &persistent->second
          : (prefetched != L->prefetchStore.end() ? &prefetched->second : nullptr);
        if (!stored || !decodeTile(*stored, raw.data())) continue;
        for (int r = 0; r < CHUNK_SIZE; r++) {
          size_t d = (size_t)(ty + r) * cols + tx;
          memcpy(L->grid + d, raw.data() + r * CHUNK_SIZE, CHUNK_SIZE);
          memcpy(L->next + d, raw.data() + r * CHUNK_SIZE, CHUNK_SIZE);
        }
        if (persistent != L->tileStore.end()) L->dirtyWorldTiles.insert(key);
        if (prefetched != L->prefetchStore.end()) L->prefetchStore.erase(prefetched);
      }
  }
  void csSaveBodiesLeaving(int bx0, int by0, int w, int h) { // CURRENT offset
    std::vector<Body*> staying;
    for (Body* b : L->bodies) {
      if (b->px >= bx0 && b->px < bx0 + w && b->py >= by0 && b->py < by0 + h) {
        double awx = L->worldOffsetX + b->px, awy = L->worldOffsetY + b->py;
        L->bodyStore[tileKey(floorDiv((int)std::floor(awx), CHUNK_SIZE),
                             floorDiv((int)std::floor(awy), CHUNK_SIZE))].push_back({b, {awx, awy}});
      } else staying.push_back(b);
    }
    L->bodies = std::move(staying);
  }
  void csRestoreBodies(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->bodyStore.find(tileKey(floorDiv(awx, CHUNK_SIZE),
                                            floorDiv(awy, CHUNK_SIZE)));
        if (it == L->bodyStore.end()) continue;
        for (auto& e : it->second) { Body* b = e.first; b->px = e.second.first - L->worldOffsetX; b->py = e.second.second - L->worldOffsetY; L->bodies.push_back(b); }
        L->bodyStore.erase(it);
      }
  }

  // ---- predictive worldgen prefetch ----------------------------------------
  // The shift's fillRect (per-cell multi-octave noise over the whole entering band,
  // x2 layers) is the dominant cause of the periodic ~1/sec pan hitch when exploring
  // NEW terrain. But the entering band is OFF-SCREEN (the shift fires `margin` cells
  // before the edge and slides a whole chunk), so there's ~1s of runway to build it.
  // So we pre-generate the upcoming band's tiles into a bounded baseline cache a
  // slice per frame; when the shift fires, csTilesAllPresent is already true and
  // fillRect is skipped -> only the cheap csLoadTiles memcpy runs on that frame.
  //
  // SAFETY (multiplayer / determinism): prefetch changes only WHEN worldgen runs,
  // never WHAT it produces. Tiles are generated by the SAME fillTerrain/fillTrees
  // keyed on ABSOLUTE coords, so a prefetched tile is byte-identical to fillRect's
  // for that position regardless of timing. Worst case is a cache MISS (graceful
  // fallback to the synchronous fillRect), never corruption. It writes only to the
  // side-cache; the live sim buffers are untouched.

  // The entering band's buffer rect for a coming shift (mirrors shiftLayer).
  void pfBand(int dx, int dy, int& ex0, int& ey0, int& ew, int& eh) {
    int s = std::abs(dx) + std::abs(dy);
    if (dx) { eh = rows; ey0 = 0; ew = s; ex0 = dx > 0 ? cols - s : 0; }
    else    { ew = cols; ex0 = 0; eh = s; ey0 = dy > 0 ? rows - s : 0; }
  }
  // Is every whole tile of a layer's entering band already cached (saved edits or
  // a prior prefetch)? A partial edge tile (non-chunk-multiple buffer) is
  // never persisted, so such a band can't be all-present -> prefetch is a no-op there.
  bool pfBandCached(Layer* Lx, int futOffX, int futOffY) {
    for (int ty = pfEy0; ty < pfEy0 + pfEh; ty += CHUNK_SIZE)
      for (int tx = pfEx0; tx < pfEx0 + pfEw; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false;
        int64_t key = tileKey(floorDiv(futOffX + tx, CHUNK_SIZE),
                              floorDiv(futOffY + ty, CHUNK_SIZE));
        if (Lx->tileStore.find(key) == Lx->tileStore.end() &&
            Lx->prefetchStore.find(key) == Lx->prefetchStore.end()) return false;
      }
    return true;
  }
  // Slice the prefetched band out of the scratch L->grid and store any tile not already
  // present (never clobber a saved/edited tile). Keyed by FUTURE absolute coords so
  // the shift's csLoadTiles (which uses the post-shift offset) finds them.
  void pfStoreTiles(Layer* Lx, int futOffX, int futOffY) {
    std::array<uint8_t, CHUNK_SIZE * CHUNK_SIZE> raw;
    for (int ty = pfEy0; ty < pfEy0 + pfEh; ty += CHUNK_SIZE)
      for (int tx = pfEx0; tx < pfEx0 + pfEw; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int64_t key = tileKey(floorDiv(futOffX + tx, CHUNK_SIZE),
                              floorDiv(futOffY + ty, CHUNK_SIZE));
        if (Lx->tileStore.find(key) != Lx->tileStore.end()) continue;
        if (Lx->prefetchStore.find(key) != Lx->prefetchStore.end()) continue;
        for (int r = 0; r < CHUNK_SIZE; r++)
          memcpy(raw.data() + r * CHUNK_SIZE,
                 pfGrid.data() + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
        encodeTile(raw.data(), Lx->prefetchStore[key]);
      }
  }
  // Run one terrain slice for layer Lx into the pfGrid scratch at the future offset.
  // We retarget only L + L->grid + Lx's offset (NOT useLayer) and restore them: terrain
  // gen reads L->* + L->grid + cols/rows only, never the other per-cell mirrors. Returns
  // true once the whole band's terrain is generated.
  bool pfTerrainStep(Layer* Lx, int futOffX, int futOffY) {
    Layer* sL = L; uint8_t* sGrid = Lx->grid;
    int sOffX = Lx->worldOffsetX, sOffY = Lx->worldOffsetY;
    L = Lx; Lx->grid = pfGrid.data();
    Lx->worldOffsetX = futOffX; Lx->worldOffsetY = futOffY;
    bool done;
    if (pfDx) {
      int per = imax(1, PREFETCH_CELLS_PER_FRAME / imax(1, rows));
      int c0 = pfEx0 + pfCursor, c1 = imin(pfEx0 + pfEw, c0 + per);
      fillTerrain(c0, c1, 0, rows); pfCursor += c1 - c0; done = pfCursor >= pfEw;
    } else {
      int per = imax(1, PREFETCH_CELLS_PER_FRAME / imax(1, cols));
      int r0 = pfEy0 + pfCursor, r1 = imin(pfEy0 + pfEh, r0 + per);
      fillTerrain(0, cols, r0, r1); pfCursor += r1 - r0; done = pfCursor >= pfEh;
    }
    Lx->worldOffsetX = sOffX; Lx->worldOffsetY = sOffY;
    Lx->grid = sGrid; L = sL;
    return done;
  }
  // Complete the band, then slice it into the disposable baseline cache.
  void pfFinalizeLayer(Layer* Lx, int futOffX, int futOffY) {
    Layer* sL = L; uint8_t* sGrid = Lx->grid;
    int sOffX = Lx->worldOffsetX, sOffY = Lx->worldOffsetY;
    L = Lx; Lx->grid = pfGrid.data();
    Lx->worldOffsetX = futOffX; Lx->worldOffsetY = futOffY;
    // Cave features / structures BEFORE trees and BEFORE pfStoreTiles, mirroring
    // fillRect's order, so a prefetched tile is byte-identical to the synchronous
    // fillRect tile.
    fillCaveFeatures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillOceanFlora(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillStructures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    sealHazardBoundaries(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillTrees(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    Lx->worldOffsetX = sOffX; Lx->worldOffsetY = sOffY;
    Lx->grid = sGrid; L = sL;
    pfStoreTiles(Lx, futOffX, futOffY);
  }
  void pfStartTarget(int dx, int dy) {
    // Keep a few recent pristine bands for immediate backtracking, but never let
    // disposable baseline state grow with total exploration distance.
    size_t baselineLimit = (size_t)chunkCols * chunkRows * 4;
    if (fg.prefetchStore.size() > baselineLimit) fg.prefetchStore.clear();
    if (bg.prefetchStore.size() > baselineLimit) bg.prefetchStore.clear();
    pfDx = dx; pfDy = dy; pfCursor = 0;
    if ((int)pfGrid.size() != cols * rows) {
      if ((size_t)cols * rows < pfGrid.size()) std::vector<uint8_t>().swap(pfGrid);
      pfGrid.assign((size_t)cols * rows, EMPTY);
    }
    pfBand(dx, dy, pfEx0, pfEy0, pfEw, pfEh);
    int futOffX = fg.worldOffsetX + dx, futOffY = fg.worldOffsetY + dy; // fg/bg share one offset
    bool cached = pfBandCached(&fg, futOffX, futOffY) && (!bgEnabled || pfBandCached(&bg, futOffX, futOffY));
    pfStage = cached ? PF_DONE : PF_FG_TERRAIN;
  }
  // Generate at most one slice toward caching the band; advances the stage machine.
  void pfRunSlice() {
    int futOffX = fg.worldOffsetX + pfDx, futOffY = fg.worldOffsetY + pfDy;
    if (pfStage == PF_FG_TERRAIN) {
      if (pfTerrainStep(&fg, futOffX, futOffY)) { pfFinalizeLayer(&fg, futOffX, futOffY); pfCursor = 0; pfStage = bgEnabled ? PF_BG_TERRAIN : PF_DONE; }
    } else if (pfStage == PF_BG_TERRAIN) {
      if (pfTerrainStep(&bg, futOffX, futOffY)) { pfFinalizeLayer(&bg, futOffX, futOffY); pfStage = PF_DONE; }
    }
  }
  // Per-frame driver: pick the nearest upcoming shift boundary within
  // PREFETCH_LOOKAHEAD cells of camera travel and advance its prefetch. Called from
  // streamWorld with the live camera; also exposed as a test hook.
  void prefetchAdvance(int camCellX, int camCellY, int visCols, int visRows) {
    if (!fg.infinite) return;
    int wantDx = 0, wantDy = 0, best = PREFETCH_LOOKAHEAD + 1;
    int distR = (cols - visCols - CAM_SHIFT_EDGE_MARGIN) - camCellX; // cells until each trigger fires
    int distL = camCellX - CAM_SHIFT_EDGE_MARGIN;
    int distB = (rows - visRows - CAM_SHIFT_EDGE_MARGIN) - camCellY;
    int distT = camCellY - CAM_SHIFT_EDGE_MARGIN;
    if (distR >= 0 && distR < best) { best = distR; wantDx = WORLD_SHIFT_COLS; wantDy = 0; }
    if (distL >= 0 && distL < best) { best = distL; wantDx = -WORLD_SHIFT_COLS; wantDy = 0; }
    if (distB >= 0 && distB < best) { best = distB; wantDx = 0; wantDy = WORLD_SHIFT_ROWS; }
    if (distT >= 0 && distT < best) { best = distT; wantDx = 0; wantDy = -WORLD_SHIFT_ROWS; }
    if (!wantDx && !wantDy) { pfDx = pfDy = 0; return; }
    if (wantDx != pfDx || wantDy != pfDy) pfStartTarget(wantDx, wantDy);
    if (pfStage != PF_DONE) pfRunSlice();
  }

  // Slide the loaded window so the camera has room. cameraCell is the view's
  // left/top cell; WORLD_SHIFT_* remain tile-aligned for the chunk store.
  int maybeShiftWorld(int cameraCellX, int visibleCols, int marginCols) {
    if (!fg.infinite) return 0;
    int dx = 0;
    if (cameraCellX >= cols - visibleCols - marginCols) dx = WORLD_SHIFT_COLS;
    else if (cameraCellX <= marginCols) dx = -WORLD_SHIFT_COLS;
    if (dx) shiftWorld(dx, 0);
    return dx;
  }
  int maybeShiftWorldVertical(int cameraCellY, int visibleRows, int marginRows) {
    if (!fg.infinite) return 0;
    int dy = 0;
    if (cameraCellY >= rows - visibleRows - marginRows) dy = WORLD_SHIFT_ROWS;
    else if (cameraCellY <= marginRows) dy = -WORLD_SHIFT_ROWS;
    if (dy) shiftWorld(0, dy);
    return dy;
  }
  // Slide BOTH layers in lockstep with the shared camera; anchor psys.players once.
  void shiftWorld(int dx, int dy) {
    if ((!dx && !dy) || !fg.infinite) return;
    // A partial prefetch is tied to the current absolute (X,Y) origin. Even a
    // perpendicular shift changes that target: retaining its completed slices
    // would mix the old origin with newly generated slices and cache a vertically
    // discontinuous foreground band. Finished bands are already cached, so
    // discarding only the in-flight scratch state is always safe.
    pfDx = pfDy = 0; pfStage = PF_DONE; pfCursor = 0;
    worldShiftCount++;
    useLayer(&fg); shiftLayer(dx, dy);
    useLayer(&bg); shiftLayer(dx, dy);
    useLayer(&fg);
    for (auto& p : psys.players) { p.px -= dx; p.py -= dy; p.aimX -= dx; p.aimY -= dy; }
    // Items are buffer-local entities like psys.players: slide them by the same delta and
    // drop any that leave the loaded window (v1 — no off-buffer item persistence).
    if (!itemsys.items.empty()) {
      std::vector<Item> keep; keep.reserve(itemsys.items.size());
      for (auto& it : itemsys.items) { it.px -= dx; it.py -= dy; if (it.px >= 0 && it.px < cols && it.py >= 0 && it.py < rows) keep.push_back(it); }
      itemsys.items.swap(keep);
    }
    if (!projectiles.projectiles.empty()) {
      std::vector<Projectile> keep; keep.reserve(projectiles.projectiles.size());
      for (auto arrow : projectiles.projectiles) { arrow.px -= dx; arrow.py -= dy; if (arrow.px >= 0 && arrow.px < cols && arrow.py >= 0 && arrow.py < rows) keep.push_back(arrow); }
      projectiles.projectiles.swap(keep);
    }
    remapDraftsForShift(dx, dy); // pin in-progress solid drafts to their world location (mirrors the L->grid shift)
    remapEmitStrokeForShift(dx, dy); // keep held paint/erase strokes from sweeping across the buffer slide
    useLayer(&fg); clearAllMineDamage();
    useLayer(&bg); clearAllMineDamage();
    useLayer(&fg);
    for (auto& p : psys.players) p.mineActive = false;
  }
  void shiftLayer(int dx, int dy) {
    if ((!dx && !dy) || !L->infinite) return;
    int s = std::abs(dx) + std::abs(dy);
    if (s >= (dx ? cols : rows)) return;
    // leaving / entering buffer rects (one axis only).
    int lx0, ly0, lw, lh, ex0, ey0, ew, eh;
    if (dx) { lh = eh = rows; ly0 = ey0 = 0; lw = ew = s; lx0 = dx > 0 ? 0 : cols - s; ex0 = dx > 0 ? cols - s : 0; }
    else    { lw = ew = cols; lx0 = ex0 = 0; lh = eh = s; ly0 = dy > 0 ? 0 : rows - s; ey0 = dy > 0 ? rows - s : 0; }

    // 1) clear body rasters so no body ghost is saved/memmoved (bodies persist via
    //    bodyStore + translate below). body-material invariant: body cells hold their
    //    real material now, so clear by isBodyCell, not by == RIGID.
    for (int k : L->bodyCells) { if (isBodyCell(k)) { L->grid[k] = EMPTY; L->next[k] = EMPTY; } L->bodyOwner[k] = -1; }
    L->bodyCells.clear();
    L->pendingDetonations.clear(); // lit-fuse cell indices are buffer-local; drop them on a shift (a rare lost fuse)
    L->blastSparseCarryReady = false;
    // 2) persist the leaving band (bodies + full-state tiles) at the CURRENT offset.
    csSaveBodiesLeaving(lx0, ly0, lw, lh);
    csSaveTiles(lx0, ly0, lw, lh);
    // 3) slide the buffers + dirty marks.
    double _t = emscripten_get_now();
    if (dx) {
      shiftRowMajorU8(L->grid, dx, EMPTY); shiftRowMajorU8(L->next, dx, EMPTY); shiftRowMajorI32(L->bodyOwner.data(), dx, -1);
      for (int y = 0; y < rows; y++) { if (L->rowMarkMax[y] < L->rowMarkMin[y]) continue; int mn = L->rowMarkMin[y] - dx, mx = L->rowMarkMax[y] - dx; if (mx < 0 || mn > cols - 1) { L->rowMarkMin[y] = cols; L->rowMarkMax[y] = -1; continue; } L->rowMarkMin[y] = mn < 0 ? 0 : mn; L->rowMarkMax[y] = mx > cols - 1 ? cols - 1 : mx; }
    } else {
      shiftBufV(L->grid, dy, EMPTY); shiftBufV(L->next, dy, EMPTY); shiftBufVI32(L->bodyOwner.data(), dy, -1);
      if (dy > 0) for (int y = 0; y < rows; y++) { int sy = y + dy; L->rowMarkMin[y] = sy < rows ? L->rowMarkMin[sy] : cols; L->rowMarkMax[y] = sy < rows ? L->rowMarkMax[sy] : -1; }
      else for (int y = rows - 1; y >= 0; y--) { int sy = y + dy; L->rowMarkMin[y] = sy >= 0 ? L->rowMarkMin[sy] : cols; L->rowMarkMax[y] = sy >= 0 ? L->rowMarkMax[sy] : -1; }
    }
    std::fill(L->compOccStamp.begin(), L->compOccStamp.end(), -1);
    std::fill(L->vacatedStamp.begin(), L->vacatedStamp.end(), -1);
    std::fill(L->assemblyWakeStamp.begin(), L->assemblyWakeStamp.end(), -1);
    perfShiftBuffers = emscripten_get_now() - _t;
    // 4) translate staying bodies; drop any fully off the buffer.
    { std::vector<Body*> keep; for (Body* b : L->bodies) { b->px -= dx; b->py -= dy; if (b->px > -b->maxR && b->px < cols + b->maxR && b->py > -b->maxR && b->py < rows + b->maxR) keep.push_back(b); else delete b; } L->bodies = std::move(keep); }
    // 5) advance the offset, then bring in the entering band: generate the baseline
    //    only if not fully cached, then overlay any saved tiles + restore bodies.
    L->worldOffsetX += dx; L->worldOffsetY += dy;
    _t = emscripten_get_now();
    if (!csTilesAllPresent(ex0, ey0, ew, eh)) { shiftFillMiss++; if (dx) fillRect(ex0, ex0 + ew, 0, rows); else fillRect(0, cols, ey0, ey0 + eh); }
    else shiftFillHit++; // band fully cached (saved tiles or a prefetched baseline) -> no worldgen this frame
    csLoadTiles(ex0, ey0, ew, eh);
    csRestoreBodies(ex0, ey0, ew, eh);
    perfShiftFill = emscripten_get_now() - _t;
    // 6) mark the entering band active so it simulates.
    if (dx) for (int y = 0; y < rows; y++) { if (ex0 < L->rowMarkMin[y]) L->rowMarkMin[y] = ex0; if (ex0 + s - 1 > L->rowMarkMax[y]) L->rowMarkMax[y] = ex0 + s - 1; }
    else for (int y = ey0; y < ey0 + s; y++) { L->rowMarkMin[y] = 0; L->rowMarkMax[y] = cols - 1; }
    // 7) re-index components, register the entering band.
    _t = emscripten_get_now();
    L->prevCompCells.clear();
    translateComponents(L->stoneComponents, dx, dy);
    translateComponents(L->plantComponents, dx, dy);
    translateComponents(L->iceComponents, dx, dy);
    perfShiftTranslate = emscripten_get_now() - _t;
    _t = emscripten_get_now();
    if (dx) registerSeededComponents(ex0, ex0 + s, 0, rows);
    else registerSeededComponents(0, cols, ey0, ey0 + s);
    perfShiftRegister = emscripten_get_now() - _t;
  }
  void shiftRowMajorI32(int32_t* arr, int dx, int32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * 4); for (int i = b + cols - dx; i < b + cols; i++) arr[i] = fill; }
    else { int s = -dx; for (int y = 0; y < rows; y++) { int b = y * cols; memmove(arr + b + s, arr + b, (size_t)(cols - s) * 4); for (int i = b; i < b + s; i++) arr[i] = fill; } }
  }

  // Grow/shrink the loaded simulation window while preserving world content via
  // the tile/body stores. Keeps worldgen seeds/params (so terrain stays byte-
  // identical for absolute coords), players, and items. Returns 1 if dims changed.
  // Camera is re-anchored so the pre-resize world-space view center stays put.
  int resizeLoadedWindow(int newCols, int newRows) {
    if (!fg.infinite) return 0;
    if (newCols < CHUNK_SIZE * 2 || newRows < CHUNK_SIZE * 2) return 0;
    // Chunk-align (tile store requires whole tiles).
    newCols = (newCols + CHUNK_SIZE - 1) & ~(CHUNK_SIZE - 1);
    newRows = (newRows + CHUNK_SIZE - 1) & ~(CHUNK_SIZE - 1);
    if (newCols == cols && newRows == rows) return 0;

    // Validate the complete replacement texture set before touching either the
    // live world or the old GL textures. MAX_TEXTURE_SIZE only constrains a
    // dimension; this catches the lower real memory limit on mobile Safari.
    if (!glp.glRebuildCellTextures(newCols, newRows)) return 0;

    // World-space point under the current view center (fallback: buffer center).
    double vCols = cam.viewportCols > 0 ? (double)cam.viewportCols : (double)cols;
    double vRows = cam.viewportRows > 0 ? (double)cam.viewportRows : (double)rows;
    double worldCX = fg.worldOffsetX + cam.camX + vCols * 0.5;
    double worldCY = fg.worldOffsetY + cam.camY + vRows * 0.5;

    // Players / items in world space (shared offset across layers).
    struct WEnt { double wx, wy; };
    std::vector<WEnt> playerWorld; playerWorld.reserve(psys.players.size());
    for (auto& p : psys.players) playerWorld.push_back({fg.worldOffsetX + p.px, fg.worldOffsetY + p.py});
    std::vector<WEnt> itemWorld; itemWorld.reserve(itemsys.items.size());
    for (auto& it : itemsys.items) itemWorld.push_back({fg.worldOffsetX + it.px, fg.worldOffsetY + it.py});
    std::vector<WEnt> projectileWorld; projectileWorld.reserve(projectiles.projectiles.size());
    for (auto& arrow : projectiles.projectiles) projectileWorld.push_back({fg.worldOffsetX + arrow.px, fg.worldOffsetY + arrow.py});

    // Presentation mirrors have no simulation/component/tile state to persist
    // or regenerate. Resize only their compact cell+lighting+pixel storage and
    // wait for the worker's authoritative full snapshot.
    if (storageRole == ESR_PRESENTATION) {
      int newOffX = ((int)std::floor(worldCX - newCols * 0.5)) & ~(CHUNK_SIZE - 1);
      int newOffY = ((int)std::floor(worldCY - newRows * 0.5)) & ~(CHUNK_SIZE - 1);
      int oldCols = cols, oldRows = rows;
      int oldOffX = fg.worldOffsetX, oldOffY = fg.worldOffsetY;
      cols = newCols; rows = newRows;
      chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
      chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;
      fg.resizePresentation(oldCols, oldRows, cols, rows, chunkCols, chunkRows,
                            oldOffX, oldOffY, newOffX, newOffY);
      bg.resizePresentation(oldCols, oldRows, cols, rows, chunkCols, chunkRows,
                            oldOffX, oldOffY, newOffX, newOffY);
      fg.worldOffsetX = bg.worldOffsetX = newOffX;
      fg.worldOffsetY = bg.worldOffsetY = newOffY;
      fg.skyDirty = bg.skyDirty = true;
      fg.skyValid = bg.skyValid = false;
      for (size_t i = 0; i < psys.players.size(); i++) {
        auto& p = psys.players[i];
        p.px = playerWorld[i].wx - newOffX; p.py = playerWorld[i].wy - newOffY;
        p.aimX = p.px; p.aimY = p.py; p.mineActive = false;
      }
      for (size_t i = 0; i < itemsys.items.size(); i++) {
        itemsys.items[i].px = itemWorld[i].wx - newOffX;
        itemsys.items[i].py = itemWorld[i].wy - newOffY;
      }
      for (size_t i = 0; i < projectiles.projectiles.size(); i++) {
        projectiles.projectiles[i].px = projectileWorld[i].wx - newOffX;
        projectiles.projectiles[i].py = projectileWorld[i].wy - newOffY;
      }
      cam.setBounds(cols - cam.viewportCols, rows - cam.viewportRows);
      cam.set(worldCX - newOffX - vCols * 0.5, worldCY - newOffY - vRows * 0.5);
      useLayer(&fg); markAllDirty();
      useLayer(&bg); markAllDirty();
      useLayer(&fg);
      worldShiftCount++;
      return 1;
    }

    auto persistLayer = [&](Layer* lay) {
      useLayer(lay);
      // Drop body rasters so free-body cells don't pollute the tile save (bodies
      // persist via bodyStore, same as shiftWorld).
      for (int k : L->bodyCells) { if (isBodyCell(k)) { L->grid[k] = EMPTY; L->next[k] = EMPTY; } L->bodyOwner[k] = -1; }
      L->bodyCells.clear();
      L->pendingDetonations.clear();
      L->blastSparseCarryReady = false;
      csSaveBodiesLeaving(0, 0, cols, rows); // all bodies -> bodyStore (world keys)
      csSaveTiles(0, 0, cols, rows);
      // Components are buffer-indexed; drop and re-register after refill.
      L->stoneComponents.clear(); L->plantComponents.clear(); L->iceComponents.clear();
      L->deferredStoneSplitIds.clear(); L->deferredIceSplitIds.clear(); L->componentTombstones = 0;
      L->nextStoneId = L->nextPlantId = L->nextIceId = 1;
    };
    persistLayer(&fg);
    persistLayer(&bg);

    // Cancel in-progress drafts/strokes (buffer indices would be meaningless).
    tools.drafting = false; tools.draftingSeed = false; tools.draftStrokeActive = false;
    tools.hasSeedOrigin = false; tools.emitStrokeActive = false;
    tools.draft.clear();

    int newOffX = ((int)std::floor(worldCX - newCols * 0.5)) & ~(CHUNK_SIZE - 1);
    int newOffY = ((int)std::floor(worldCY - newRows * 0.5)) & ~(CHUNK_SIZE - 1);

    cols = newCols; rows = newRows;
    chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
    chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;

    // Keep worldgen amplitude/seeds (set at first init); only buffers resize.
    fg.reallocSim(cols, rows, chunkCols, chunkRows);
    bg.reallocSim(cols, rows, chunkCols, chunkRows);
    fg.prefetchStore.clear();
    bg.prefetchStore.clear();
    fg.worldOffsetX = newOffX; fg.worldOffsetY = newOffY;
    bg.worldOffsetX = newOffX; bg.worldOffsetY = newOffY;

    auto refillLayer = [&](Layer* lay) {
      useLayer(lay);
      // Baseline generate then overlay saved tiles (same order as a shift miss).
      fillRect(0, cols, 0, rows);
      csLoadTiles(0, 0, cols, rows);
      csRestoreBodies(0, 0, cols, rows);
      registerSeededComponents(0, cols);
      // Wake the whole window so settle re-activates after the rebuild.
      for (int y = 0; y < rows; y++) { L->rowMarkMin[y] = 0; L->rowMarkMax[y] = cols - 1; }
      L->groundDirty = true; L->groundContentDirty = true; L->looseGroundDirty = true;
      L->skyDirty = true; L->skyValid = false;
    };
    refillLayer(&fg);
    refillLayer(&bg);
    useLayer(&fg);

    // Re-anchor entities into the new buffer.
    for (size_t i = 0; i < psys.players.size(); i++) {
      auto& p = psys.players[i];
      p.px = playerWorld[i].wx - newOffX;
      p.py = playerWorld[i].wy - newOffY;
      p.aimX = p.px; p.aimY = p.py;
      p.mineActive = false;
    }
    {
      std::vector<Item> keep; keep.reserve(itemsys.items.size());
      for (size_t i = 0; i < itemsys.items.size(); i++) {
        auto it = itemsys.items[i];
        it.px = itemWorld[i].wx - newOffX;
        it.py = itemWorld[i].wy - newOffY;
        if (it.px >= 0 && it.px < cols && it.py >= 0 && it.py < rows) keep.push_back(it);
      }
      itemsys.items.swap(keep);
    }
    {
      std::vector<Projectile> keep; keep.reserve(projectiles.projectiles.size());
      for (size_t i = 0; i < projectiles.projectiles.size(); i++) {
        auto arrow = projectiles.projectiles[i]; arrow.px = projectileWorld[i].wx - newOffX; arrow.py = projectileWorld[i].wy - newOffY;
        if (arrow.px >= 0 && arrow.px < cols && arrow.py >= 0 && arrow.py < rows) keep.push_back(arrow);
      }
      projectiles.projectiles.swap(keep);
    }

    // Prefetch scratch matches the new dims; cancel any in-flight band.
    pfDx = pfDy = 0; pfStage = PF_DONE; pfCursor = 0;
    if ((int)pfGrid.size() != cols * rows) pfGrid.assign((size_t)cols * rows, EMPTY);

    // Camera: same world center, new buffer/view metrics (viewport already set by JS).
    cam.setBounds(cols - cam.viewportCols, rows - cam.viewportRows);
    cam.set(worldCX - newOffX - vCols * 0.5, worldCY - newOffY - vRows * 0.5);

    useLayer(&fg); markAllDirty();
    useLayer(&bg); markAllDirty();
    useLayer(&fg);
    worldShiftCount++; // treat as a stream event for any counters/tests
    return 1;
  }
