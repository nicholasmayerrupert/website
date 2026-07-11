  // Procedural terrain, chunk store, and infinite world streaming.
  //
  // Owns deterministic generation from absolute world coordinates, cached chunk
  // save/restore, prefetch, and horizontal/vertical window shifts. Camera.inc may
  // request a shift, but this subsystem decides how cells/components/entities
  // move across the loaded window.
  // Terraria/Starbound-flavoured generator. The SURFACE (height + biome + soil)
  // is derived from the shared world seed, so the foreground and background line
  // up at the top and the soil layer never erodes via cross-layer drain. The
  // SUBSURFACE (caves + ore/liquid pockets) is derived from a PER-LAYER seed, so
  // the background diverges underground — digging the foreground reveals a
  // different cave network behind it, and cross-layer transfer flows wherever the
  // two cavities mismatch. Biomes (plains / desert / rocky) vary the surface skin,
  // soil depth, and tree density. Materials are the existing palette only.
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
      int biome = terrain.genBiomeAt(worldX); int soil = terrain.genSoilDepth(biome);
      for (int y = rowStart; y < rowEnd; y++) L->grid[y * cols + lx] = terrain.genCellAt(worldX, surf, slope, biome, soil, y);
    }
  }
  // Trees are background silhouettes over already-generated terrain. Trees reach
  // TREE_REACH cols outside the rect (clipped by `put`), so a band re-evaluates the
  // trunks just outside it and canopies span band seams identically to one big call.
  void fillTrees(int colStart, int colEnd, int rowStart, int rowEnd) {
    if (!L->isBackground) return;
    auto put = [&](int lx, int y, uint8_t m) { if (lx < colStart || lx >= colEnd || y < rowStart || y >= rowEnd) return; if (L->grid[y * cols + lx] == EMPTY) L->grid[y * cols + lx] = m; };
    const int TREE_REACH = 11;   // >= max canopy / branch horizontal reach
    const int TREE_MAX_UP = 42;  // >= max trunk height + canopy upward reach
    for (int lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      int worldX = L->worldOffsetX + lx; int surf = terrain.genSurfaceAt(worldX);
      if (surf + 2 < rowStart || surf - TREE_MAX_UP >= rowEnd) continue; // footprint misses the rect
      // Leave a clean skyline around deterministic villages. Besides making the
      // settlement readable, this prevents background tree components from
      // overlapping the foreground buildings across simulation layers.
      bool nearVillage = false; int vq = worldX / 360; if (worldX < 0 && worldX % 360) vq--;
      uint32_t villageSeed = L->worldSeed ^ 0x57121314u;
      for (int v = vq - 1; v <= vq + 1; v++) if (whash1(villageSeed ^ 0xA11A6Eu, v) <= 0.58) {
        int vc = v * 360 + 70 + (int)(whash1(villageSeed ^ 0xA11A6Fu, v) * 210);
        if (std::abs(worldX - vc) < 184) { nearVillage = true; break; }
      }
      if (nearVillage) continue;
      if (!terrain.genTreeAt(worldX, surf)) continue;
      int biome = terrain.genBiomeAt(worldX);
      uint8_t pt = terrain.pickTreeType(biome, worldX);
      uint8_t wood = plantWoodMat(pt), leaf = plantLeafMat(pt);
      double hr = whash1(L->gTreeSeed + 1, worldX);
      int h = pt == PT_PINE ? 20 + (int)(hr * 12)     // towering conifer
            : pt == PT_BUSH ? 4 + (int)(hr * 4)       // low shrub
            : pt == PT_CACTUS ? 9 + (int)(hr * 8)     // tall branching cactus
            : pt == PT_WILLOW ? 15 + (int)(hr * 9)
            : 13 + (int)(hr * 12);                    // mature oak
      int top = surf - h;
      for (int y = top; y < surf; y++) put(lx, y, wood); // trunk
      if (pt == PT_CACTUS) {                            // arms, no foliage
        int armY = top + 2 + (int)(whash1(L->gTreeSeed ^ 0x3a3au, worldX) * imax(1, h - 4));
        put(lx - 1, armY, wood); put(lx - 2, armY, wood); put(lx - 2, armY - 1, wood);
        put(lx + 1, armY + 2, wood); put(lx + 2, armY + 2, wood); put(lx + 2, armY + 1, wood);
      } else if (pt == PT_PINE) {                       // tapered, ragged evergreen crown
        int crownH = h - 4;
        for (int oy = -2; oy < crownH; oy++) {
          double t = (double)(oy + 2) / (double)imax(1, crownH + 1);
          int rad = 1 + (int)std::floor(t * 7.0);
          // Subtle tiering breaks the cone edge without producing flat shelves.
          if (oy > 2 && oy % 5 == 0) rad = imin(8, rad + 2);
          for (int ox = -rad; ox <= rad; ox++) {
            double edge = whash2(L->gTreeSeed ^ 0x91A3u, worldX + ox, oy);
            if (std::abs(ox) <= rad - 2 || edge > 0.28) put(lx + ox, top + oy, leaf);
            if (std::abs(ox) < rad && oy % 4 != 1 && edge > 0.18) put(lx + ox, top + oy + 1, leaf);
          }
        }
      } else if (pt == PT_WILLOW) {                     // clustered crown + soft, irregular droops
        for (int cx : {-6, -3, 0, 3, 6}) {
          int cy = -2 + (std::abs(cx) / 3) + (int)(whash2(L->gTreeSeed ^ 0x7711u, worldX, cx) * 3);
          int rr = 4 + (std::abs(cx) < 4 ? 1 : 0);
          for (int oy = -rr; oy <= rr; oy++) for (int ox = -rr; ox <= rr; ox++)
            if (ox * ox + oy * oy <= rr * rr + 2) put(lx + cx + ox, top + cy + oy, leaf);
          int drop = 2 + (int)(whash2(L->gTreeSeed ^ 0x7712u, worldX, cx) * 5);
          int sway = whash2(L->gTreeSeed ^ 0x7713u, worldX, cx) < 0.5 ? -1 : 1;
          for (int i = 1; i <= drop; i++) { put(lx + cx + (i > drop / 2 ? sway : 0), top + cy + rr + i, leaf); if (i < drop - 1) put(lx + cx + 1, top + cy + rr + i, leaf); }
        }
        for (int side : {-1, 1}) { int len = 4 + (int)(hr * 3); for (int i = 1; i <= len; i++) put(lx + side * i, top + 2 - i / 3, wood); }
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
  static const int STRUCT_LATTICE = 56;  // world cells between candidate anchors
  static const int STRUCT_REACH = 192;   // includes wide surface village clusters
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
    int lxMin = floorDiv(wx0, STRUCT_LATTICE), lxMax = floorDiv(wx1, STRUCT_LATTICE);
    int lyMin = floorDiv(wy0, STRUCT_LATTICE), lyMax = floorDiv(wy1, STRUCT_LATTICE);
    auto h2 = [&](uint32_t salt, int a, int b) { return whash2(sseed ^ salt, a, b); };
    // Surface villages: a deterministic chain of cottages, paths, wells and a
    // taller meeting hall. Foundations follow the local ground so settlements
    // feel embedded in the landscape rather than pasted across it.
    static const int VILLAGE_LATTICE = 360;
    int vxMin = floorDiv(wx0, VILLAGE_LATTICE), vxMax = floorDiv(wx1, VILLAGE_LATTICE);
    auto stampCottage = [&](int cx, int ordinal, bool hall) {
      int w = hall ? 43 : 32 + (ordinal % 3) * 3, h = hall ? 27 : 21 + (ordinal & 1) * 2;
      int ground = terrain.genSurfaceAbs(cx), left = cx - w / 2;
      if (ground >= L->gSeaRow || terrain.genBiomeAt(cx) == BIOME_ROCKY) return;
      int lo = ground, hi = ground;
      for (int x = left; x <= left + w; x++) { int sy = terrain.genSurfaceAbs(x); lo = imin(lo, sy); hi = imax(hi, sy); }
      if (hi - lo > 5) return;
      int floorY = lo - 1, wallTop = floorY - h, roofH = hall ? 11 : 9;
      const int DOOR_CLEARANCE = PLAYER_H + 3; // 11 cells: comfortably taller than the 8-cell player
      uint8_t wall = terrain.genBiomeAt(cx) == BIOME_DESERT ? SANDSTONE : BRICK;
      for (int x = left; x <= left + w; x++) {
        for (int y = wallTop; y <= floorY; y++) {
          bool edge = x == left || x == left + w || y == wallTop || y == floorY;
          bool sidePassage = (x == left || x == left + w) && y >= floorY - DOOR_CLEARANCE + 1;
          bool door = x >= cx - 3 && x <= cx + 3 && y >= floorY - DOOR_CLEARANCE + 1;
          if (L->isBackground) put(x, y, wall); // dim, solid room backdrop behind the facade
          else put(x, y, edge && !sidePassage && !door ? wall : EMPTY);
        }
        for (int y = floorY + 1; y <= terrain.genSurfaceAbs(x); y++) put(x, y, BRICK);
      }
      // A solid pitched roof, not just an outline. The background copy gives it
      // depth; the foreground copy makes the roof genuinely mineable/walkable.
      for (int ry = 0; ry <= roofH; ry++) for (int x = left - 2 + ry; x <= left + w + 2 - ry; x++) put(x, wallTop - ry, wall);
      if (!L->isBackground) {
        for (int wy : {wallTop + 6, wallTop + 7, wallTop + 8, wallTop + 9}) for (int wx : {left + 7, left + w - 7}) put(wx, wy, CRYSTAL);
        // Interior beams and a low sill add depth without blocking the walk-through.
        for (int y = wallTop + 2; y < floorY - DOOR_CLEARANCE; y++) put(cx, y, wall);
        for (int x = left + 5; x <= left + w - 5; x++) if (x < cx - 4 || x > cx + 4) put(x, floorY - DOOR_CLEARANCE - 1, wall);
        if (hall) { for (int y = wallTop - roofH - 6; y < wallTop - roofH; y++) put(left + 5, y, BRICK); put(left + 5, wallTop - roofH - 6, FIRE); }
      }
    };
    for (int vx = vxMin; vx <= vxMax; vx++) {
      if (whash1(sseed ^ 0xA11A6Eu, vx) > 0.58) continue;
      int center = vx * VILLAGE_LATTICE + 70 + (int)(whash1(sseed ^ 0xA11A6Fu, vx) * 210);
      if (terrain.genSurfaceAbs(center) >= L->gSeaRow) continue;
      int count = 3 + (int)(whash1(sseed ^ 0xA11A70u, vx) * 3);
      for (int i = 0; i < count; i++) stampCottage(center + (i - count / 2) * 56, i, i == count / 2);
      int wellX = center + count * 28 + 10, wellY = terrain.genSurfaceAbs(wellX) - 1;
      for (int dx = -3; dx <= 3; dx++) { put(wellX + dx, wellY, BRICK); if (std::abs(dx) == 3) for (int dy = 1; dy <= 5; dy++) put(wellX + dx, wellY - dy, BRICK); }
      for (int dx = -2; dx <= 2; dx++) put(wellX + dx, wellY - 5, BRICK);
      put(wellX, wellY - 1, WATER); put(wellX, wellY - 2, WATER);
    }
    if (L->isBackground) return;                       // villages have backdrops; caves/ruins stay fg-only
    // --- structure archetypes ------------------------------------------------
    // Each stamps a self-contained ruin anchored at its top-left (ax,ay). All use
    // only solid CG_STONE shells (BRICK/CRYSTAL/MOSS/MYCELIUM merge into the
    // grounded terrain) plus CG_PLANT dressing attached the way the proven cave
    // features attach it (stems/plants rise from the floor, vines hang from the
    // top wall) so the whole thing generates inert. Interiors are carved EMPTY.
    enum SKind { SK_HOUSE, SK_VAULT, SK_COLONNADE, SK_SHRINE, SK_FORGE, SK_OVERGROWN, SK_MUSHGROVE };
    // A plain hollow brick house with a doorway (the original ruin).
    auto stampHouse = [&](int ax, int ay, int w, int h, int lx, int ly) {
      int doorX = ax + 1 + (int)(h2(0xE5u, lx, ly) * (w - 4));
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        bool door = oy == h - 1 && ox >= doorX && ox <= doorX + 1;
        put(ax + ox, ay + oy, (border && !door) ? BRICK : EMPTY);
      }
    };
    // A sealed brick vault with an ore-hoard resting on the floor + a corner crystal.
    auto stampVault = [&](int ax, int ay, int w, int h, int lx, int ly) {
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      int fy = ay + h - 2;
      for (int ox = 2; ox < w - 2; ox++) {
        double r = h2(0x7000u, ax + ox, ay);
        uint8_t ore = r < 0.14 ? GOLD_ORE : r < 0.42 ? IRON_ORE : r < 0.72 ? COPPER_ORE : EMPTY;
        if (ore != EMPTY) put(ax + ox, fy, ore);
        if (r < 0.06) put(ax + ox, fy - 1, GOLD_ORE);   // taller heaps of treasure
      }
      put(ax + 2, fy, CRYSTAL); put(ax + w - 3, fy, CRYSTAL);
    };
    // An open pillared hall: brick floor + roof with regularly spaced columns.
    auto stampColonnade = [&](int ax, int ay, int w, int h, int lx, int ly) {
      for (int oy = 1; oy < h - 1; oy++) for (int ox = 1; ox < w - 1; ox++) put(ax + ox, ay + oy, EMPTY);
      for (int ox = 0; ox < w; ox++) { put(ax + ox, ay, BRICK); put(ax + ox, ay + h - 1, BRICK); }
      for (int ox = 0; ox < w; ox += 3) for (int oy = 1; oy < h - 1; oy++) put(ax + ox, ay + oy, BRICK);
      put(ax + w / 2, ay + h - 2, CRYSTAL);             // an altar crystal for light
    };
    // A stepped brick pyramid crowned with a crystal cluster (a crystal-cave shrine).
    auto stampShrine = [&](int ax, int ay, int w, int h, int lx, int ly) {
      int base = ay + h - 1, steps = imin(w / 2, h - 1);
      for (int s = 0; s <= steps; s++) for (int ox = s; ox < w - s; ox++) put(ax + ox, base - s, BRICK);
      int topY = base - steps, cx = ax + w / 2;
      int ch = 4 + (int)(h2(0x7100u, lx, ly) * 5);      // 4..8 crystal spire
      for (int i = 0; i < ch; i++) { int rad = imax(0, 2 - i / 2); for (int dx = -rad; dx <= rad; dx++) put(cx + dx, topY - 1 - i, CRYSTAL); }
      put(cx - 1, topY, CRYSTAL); put(cx + 1, topY, CRYSTAL);
    };
    // A brick smithy with a contained lava crucible glowing on the floor.
    auto stampForge = [&](int ax, int ay, int w, int h, int lx, int ly) {
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      int cx = ax + w / 2, fy = ay + h - 1;             // crucible sits in the floor
      for (int ox = cx - 2; ox <= cx + 2; ox++) { put(ox, fy, STONE); put(ox, fy - 1, LAVA); }
      put(cx - 3, fy, STONE); put(cx - 3, fy - 1, STONE); // stone hearth fully contains the lava
      put(cx + 3, fy, STONE); put(cx + 3, fy - 1, STONE);
    };
    // A crumbled, plant-choked ruin — the lush biome's signature structure.
    auto stampOvergrown = [&](int ax, int ay, int w, int h, int lx, int ly) {
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
    // A brick grotto sheltering a stand of giant mushrooms (the mushroom biome).
    auto stampMushGrove = [&](int ax, int ay, int w, int h, int lx, int ly) {
      for (int oy = 0; oy < h; oy++) for (int ox = 0; ox < w; ox++) {
        bool border = ox == 0 || ox == w - 1 || oy == 0 || oy == h - 1;
        put(ax + ox, ay + oy, border ? BRICK : EMPTY);
      }
      for (int ox = 1; ox < w - 1; ox++) put(ax + ox, ay + h - 2, MYCELIUM); // fungal floor
      for (int m = 0; m < 3; m++) {
        int mx = ax + 3 + m * (w - 6) / 2;
        if (h2(0x7300u + m, lx, ly) >= 0.72) continue;
        int mh = 2 + (int)(h2(0x7301u, mx, ay) * 3);
        for (int i = 0; i < mh; i++) put(mx, ay + h - 3 - i, MUSH_STEM);      // stem rises off the mycelium floor
        int capY = ay + h - 3 - mh;
        for (int dx = -2; dx <= 2; dx++) if (std::abs(dx) <= 1 || h2(0x7302u, mx + dx, capY) < 0.7) put(mx + dx, capY, MUSH_CAP);
      }
      put(ax + 2, ay + h - 3, CRYSTAL);
    };

    for (int ly = lyMin; ly <= lyMax; ly++) for (int lx = lxMin; lx <= lxMax; lx++) {
      if (whash2(sseed, lx, ly) >= 0.18) continue;     // rare: a ruin at this anchor
      // jittered anchor + hashed size
      int ax = lx * STRUCT_LATTICE + (int)(whash2(sseed ^ 0xA1u, lx, ly) * 6);
      int ay = ly * STRUCT_LATTICE + (int)(whash2(sseed ^ 0xB2u, lx, ly) * 6);
      int w = 12 + (int)(whash2(sseed ^ 0xC3u, lx, ly) * 8); // 12..19
      int h = 7 + (int)(whash2(sseed ^ 0xD4u, lx, ly) * 4);  // 7..10
      // Pick an archetype, biased by the cave biome it sits in so a structure fits
      // its surroundings (lush -> overgrown ruin, mushroom -> grove, crystal ->
      // shrine); elsewhere a mix of the neutral kinds.
      int caveBiome = terrain.genCaveBiomeAt(ax + w / 2, ay + h / 2);
      double pick = whash2(sseed ^ 0x9001u, lx, ly);
      int kind;
      if (caveBiome == CAVE_LUSH && pick < 0.60) kind = SK_OVERGROWN;
      else if (caveBiome == CAVE_MUSHROOM && pick < 0.55) kind = SK_MUSHGROVE;
      else if (caveBiome == CAVE_CRYSTAL && pick < 0.55) kind = SK_SHRINE;
      else {
        static const SKind pool[] = { SK_HOUSE, SK_VAULT, SK_COLONNADE, SK_FORGE, SK_OVERGROWN, SK_SHRINE };
        kind = pool[(int)(whash2(sseed ^ 0x9002u, lx, ly) * 6) % 6];
      }
      if (kind == SK_COLONNADE) w += 4;                // halls run wider
      if (kind == SK_SHRINE) { w = 9 + (int)(whash2(sseed ^ 0xC4u, lx, ly) * 6); h = w / 2 + 3; }
      // Only underground in solid stone, above the sealed-liquid zone: keeps the
      // carved interior away from loose soil (no avalanche) and from pockets. The
      // shrine also throws a crystal spire UP, so leave headroom above it too.
      int surfAbs = terrain.genSurfaceAbs(ax + w / 2);
      if (ay < surfAbs + 30) continue;
      if (ay + h > terrain.caveBottomAbs()) continue;
      switch (kind) {
        case SK_HOUSE:     stampHouse(ax, ay, w, h, lx, ly); break;
        case SK_VAULT:     stampVault(ax, ay, w, h, lx, ly); break;
        case SK_COLONNADE: stampColonnade(ax, ay, w, h, lx, ly); break;
        case SK_SHRINE:    stampShrine(ax, ay, w, h, lx, ly); break;
        case SK_FORGE:     stampForge(ax, ay, w, h, lx, ly); break;
        case SK_OVERGROWN: stampOvergrown(ax, ay, w, h, lx, ly); break;
        case SK_MUSHGROVE: stampMushGrove(ax, ay, w, h, lx, ly); break;
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
      double h = whash2(sseed, gx, gy);
      double lavaH = whash2(sseed ^ 0x55AAu, gx, gy);
      int floorY = wy, ceilY = wy;
      bool hasFloor = findFloor(wx, wy, floorY), hasCeil = findCeiling(wx, wy, ceilY);

      // Lava pools are the main light source in the caves that grow nothing
      // luminous of their own: plain and (to a lesser extent) mushroom/lush caves
      // get them far more often. Crystal caves stay lava-light — they glow already.
      double lavaThr = caveBiome == CAVE_DEFAULT ? 0.0100
                     : caveBiome == CAVE_CRYSTAL ? 0.0012
                     : 0.0034;   // mushroom / lush: brighten them up
      if (hasFloor && lavaH < lavaThr) {
        stampLavaBasin(wx, floorY, gx, gy);
        continue;
      }

      if (caveBiome == CAVE_CRYSTAL) {
        if (hasFloor && h < 0.030) stampCrystalAcidBasin(wx, floorY, gx, gy);   // sparse, big lakes
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
    for (int y = rowStart; y < rowEnd; y++) for (int x = colStart; x < colEnd; x++) {
      int k = y * cols + x;
      if (L->grid[k] != SALT && !isDissolvable(L->grid[k])) continue;
      bool touchesAcid = (x > 0 && L->grid[k - 1] == ACID) || (x + 1 < cols && L->grid[k + 1] == ACID)
                       || (y > 0 && L->grid[k - cols] == ACID) || (y + 1 < rows && L->grid[k + cols] == ACID);
      if (touchesAcid) L->grid[k] = CRYSTAL;
    }
    for (int y = rowStart; y < rowEnd; y++) for (int x = colStart; x < colEnd; x++) {
      int k = y * cols + x;
      if (L->grid[k] != ACID) continue;
      if (y + 1 < rows && L->grid[k + cols] != ACID) L->grid[k + cols] = CRYSTAL;
      if (x > 0 && L->grid[k - 1] != ACID && L->grid[k - 1] != EMPTY) L->grid[k - 1] = CRYSTAL;
      if (x + 1 < cols && L->grid[k + 1] != ACID && L->grid[k + 1] != EMPTY) L->grid[k + 1] = CRYSTAL;
    }
  }
  void copyGridToNext(int colStart, int colEnd, int rowStart, int rowEnd) {
    for (int lx = colStart; lx < colEnd; lx++) for (int y = rowStart; y < rowEnd; y++) { int k = y * cols + lx; L->next[k] = L->grid[k]; }
  }
  // Generate worldgen into the buffer rect [colStart,colEnd) x [rowStart,rowEnd):
  // terrain, then trees, then mirror into `L->next`. (Same order/output as before the
  // split — terrain first, trees second, L->next-copy last.)
  void fillRect(int colStart, int colEnd, int rowStart, int rowEnd) {
    fillTerrain(colStart, colEnd, rowStart, rowEnd);
    fillStructures(colStart, colEnd, rowStart, rowEnd); // overwrite terrain before cave features / trees overlay
    fillCaveFeatures(colStart, colEnd, rowStart, rowEnd);
    fillOceanFlora(colStart, colEnd, rowStart, rowEnd);
    fillTrees(colStart, colEnd, rowStart, rowEnd);
    copyGridToNext(colStart, colEnd, rowStart, rowEnd);
  }
  // layerSalt distinguishes the per-layer subsurface seeds (caves + pockets) while
  // leaving the surface seed shared. fg passes 0, bg passes 1 (+ isBackground).
  void initInfiniteLayer(uint32_t seed, uint32_t layerSalt, bool background) {
    L->infinite = true; L->isBackground = background; L->worldSeed = seed;
    L->gSurfAmp = imax(20, (int)std::floor(rows * 0.17));
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.22));
    L->gSeaRow = (int)std::floor(L->gSurfAmp * 0.35); // ABSOLUTE sea level (worldY); valleys below flood
    L->gSoil = imax(2, (int)std::floor(rows * 0.012));
    L->gCaveSeed = (seed ^ 0x5bd1e995u) + layerSalt * 0x9e3779b9u;
    L->gPocketSeed = (seed ^ 0xC0FFEE11u) + layerSalt * 0x85ebca6bu;
    L->gTreeSeed = seed ^ 0x1b56c4f9u; // shared so tree silhouettes line up across layers
    L->worldOffsetX = (-(cols / 2)) & ~(CHUNK_SIZE - 1);   // tile-aligned origin (2D tile store needs alignment)
    L->worldOffsetY = (-L->gSurfBase) & ~(CHUNK_SIZE - 1); // surface centre (worldY=0) ~gSurfBase down the buffer
    fillRect(0, cols, 0, rows);
    registerSeededComponents(0, cols);
  }
  void initInfinite(uint32_t seed) {
    useLayer(&fg); initInfiniteLayer(seed, 0, false); // foreground: caves carved for traversal
    useLayer(&bg); initInfiniteLayer(seed, 1, true);  // background: more-solid backdrop
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
      if (w != r) list[w] = std::move(comp);
      w++;
    }
    list.resize(w);
  }
  // ---- 2D tile chunk store: full sim-state persistence keyed by absolute tiles ----
  static inline int64_t tileKey(int tx, int ty) { return ((int64_t)tx << 32) | (uint32_t)ty; }
  // Only WHOLE 32x32 tiles fully inside the buffer are persisted; a partial edge
  // tile (when cols/rows aren't chunk-multiples — e.g. the headless tests) is
  // skipped and just regenerates. The game's buffer is chunk-rounded, so every
  // tile is whole and persistence is complete.
  bool wholeTile(int tx, int ty) { return tx >= 0 && ty >= 0 && tx + CHUNK_SIZE <= cols && ty + CHUNK_SIZE <= rows; }
  void csSaveTiles(int bx0, int by0, int w, int h) { // uses the CURRENT offset (leaving band)
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto& buf = L->tileStore[tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT)];
        if ((int)buf.size() != CHUNK_SIZE * CHUNK_SIZE) buf.resize((size_t)CHUNK_SIZE * CHUNK_SIZE);
        for (int r = 0; r < CHUNK_SIZE; r++) memcpy(buf.data() + (size_t)r * CHUNK_SIZE, L->grid + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
      }
  }
  bool csTilesAllPresent(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false; // a partial tile is never persisted -> must regenerate
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        if (L->tileStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT)) == L->tileStore.end()) return false;
      }
    return true;
  }
  void csLoadTiles(int bx0, int by0, int w, int h) { // overlay saved tiles (NEW offset); missing left as-is
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->tileStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT));
        if (it == L->tileStore.end()) continue;
        const uint8_t* buf = it->second.data();
        for (int r = 0; r < CHUNK_SIZE; r++) { size_t d = (size_t)(ty + r) * cols + tx; memcpy(L->grid + d, buf + (size_t)r * CHUNK_SIZE, CHUNK_SIZE); memcpy(L->next + d, buf + (size_t)r * CHUNK_SIZE, CHUNK_SIZE); }
      }
  }
  void csSaveBodiesLeaving(int bx0, int by0, int w, int h) { // CURRENT offset
    std::vector<Body*> staying;
    for (Body* b : L->bodies) {
      if (b->px >= bx0 && b->px < bx0 + w && b->py >= by0 && b->py < by0 + h) {
        double awx = L->worldOffsetX + b->px, awy = L->worldOffsetY + b->py;
        L->bodyStore[tileKey((int)std::floor(awx) >> CHUNK_SHIFT, (int)std::floor(awy) >> CHUNK_SHIFT)].push_back({b, {awx, awy}});
      } else staying.push_back(b);
    }
    L->bodies = std::move(staying);
  }
  void csRestoreBodies(int bx0, int by0, int w, int h) { // entering band, NEW offset
    for (int ty = by0; ty < by0 + h; ty += CHUNK_SIZE)
      for (int tx = bx0; tx < bx0 + w; tx += CHUNK_SIZE) {
        int awx = L->worldOffsetX + tx, awy = L->worldOffsetY + ty;
        auto it = L->bodyStore.find(tileKey(awx >> CHUNK_SHIFT, awy >> CHUNK_SHIFT));
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
  // So we pre-generate the upcoming band's tiles into the tileStore a slice per
  // frame; when the shift fires, csTilesAllPresent is already true and fillRect is
  // skipped -> only the cheap csLoadTiles memcpy runs on that frame.
  //
  // SAFETY (multiplayer / determinism): prefetch changes only WHEN worldgen runs,
  // never WHAT it produces. Tiles are generated by the SAME fillTerrain/fillTrees
  // keyed on ABSOLUTE coords, so a prefetched tile is byte-identical to fillRect's
  // for that position regardless of timing. Worst case is a cache MISS (graceful
  // fallback to the synchronous fillRect), never corruption. It writes only to the
  // side-cache tileStore; the live sim buffers are untouched.

  // The entering band's buffer rect for a coming shift (mirrors shiftLayer).
  void pfBand(int dx, int dy, int& ex0, int& ey0, int& ew, int& eh) {
    int s = std::abs(dx) + std::abs(dy);
    if (dx) { eh = rows; ey0 = 0; ew = s; ex0 = dx > 0 ? cols - s : 0; }
    else    { ew = cols; ex0 = 0; eh = s; ey0 = dy > 0 ? rows - s : 0; }
  }
  // Is every whole tile of a layer's entering band already in its tileStore (saved
  // edits or a prior prefetch)? A partial edge tile (non-chunk-multiple buffer) is
  // never persisted, so such a band can't be all-present -> prefetch is a no-op there.
  bool pfBandCached(Layer* Lx, int futOffX, int futOffY) {
    for (int ty = pfEy0; ty < pfEy0 + pfEh; ty += CHUNK_SIZE)
      for (int tx = pfEx0; tx < pfEx0 + pfEw; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) return false;
        if (Lx->tileStore.find(tileKey((futOffX + tx) >> CHUNK_SHIFT, (futOffY + ty) >> CHUNK_SHIFT)) == Lx->tileStore.end()) return false;
      }
    return true;
  }
  // Slice the prefetched band out of the scratch L->grid and store any tile not already
  // present (never clobber a saved/edited tile). Keyed by FUTURE absolute coords so
  // the shift's csLoadTiles (which uses the post-shift offset) finds them.
  void pfStoreTiles(Layer* Lx, int futOffX, int futOffY) {
    for (int ty = pfEy0; ty < pfEy0 + pfEh; ty += CHUNK_SIZE)
      for (int tx = pfEx0; tx < pfEx0 + pfEw; tx += CHUNK_SIZE) {
        if (!wholeTile(tx, ty)) continue;
        int64_t key = tileKey((futOffX + tx) >> CHUNK_SHIFT, (futOffY + ty) >> CHUNK_SHIFT);
        if (Lx->tileStore.find(key) != Lx->tileStore.end()) continue;
        auto& buf = Lx->tileStore[key];
        buf.resize((size_t)CHUNK_SIZE * CHUNK_SIZE);
        for (int r = 0; r < CHUNK_SIZE; r++) memcpy(buf.data() + (size_t)r * CHUNK_SIZE, pfGrid.data() + (size_t)(ty + r) * cols + tx, CHUNK_SIZE);
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
  // Trees over the whole background band, then slice the band into the tileStore.
  void pfFinalizeLayer(Layer* Lx, int futOffX, int futOffY) {
    Layer* sL = L; uint8_t* sGrid = Lx->grid;
    int sOffX = Lx->worldOffsetX, sOffY = Lx->worldOffsetY;
    L = Lx; Lx->grid = pfGrid.data();
    Lx->worldOffsetX = futOffX; Lx->worldOffsetY = futOffY;
    // Structures / cave features BEFORE trees and BEFORE pfStoreTiles, mirroring
    // fillRect's order, so a prefetched tile is byte-identical to the synchronous
    // fillRect tile.
    fillStructures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillCaveFeatures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillOceanFlora(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    fillTrees(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    Lx->worldOffsetX = sOffX; Lx->worldOffsetY = sOffY;
    Lx->grid = sGrid; L = sL;
    pfStoreTiles(Lx, futOffX, futOffY);
  }
  void pfStartTarget(int dx, int dy) {
    pfDx = dx; pfDy = dy; pfCursor = 0;
    if ((int)pfGrid.size() != cols * rows) pfGrid.assign((size_t)cols * rows, EMPTY);
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

  // Slide the loaded window so the camera always has room. cameraCell is the view's
  // left/top cell; returns the applied shift (0 if none). JS slides its GL texture
  // and pulls the camera back. WORLD_SHIFT_* are tile-aligned (the 2D store needs it).
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

    auto persistLayer = [&](Layer* lay) {
      useLayer(lay);
      // Drop body rasters so free-body cells don't pollute the tile save (bodies
      // persist via bodyStore, same as shiftWorld).
      for (int k : L->bodyCells) { if (isBodyCell(k)) { L->grid[k] = EMPTY; L->next[k] = EMPTY; } L->bodyOwner[k] = -1; }
      L->bodyCells.clear();
      L->pendingDetonations.clear();
      csSaveBodiesLeaving(0, 0, cols, rows); // all bodies -> bodyStore (world keys)
      csSaveTiles(0, 0, cols, rows);
      // Components are buffer-indexed; drop and re-register after refill.
      L->stoneComponents.clear(); L->plantComponents.clear(); L->iceComponents.clear();
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

    // Prefetch scratch matches the new dims; cancel any in-flight band.
    pfDx = pfDy = 0; pfStage = PF_DONE; pfCursor = 0;
    if ((int)pfGrid.size() != cols * rows) pfGrid.assign((size_t)cols * rows, EMPTY);

    // GL textures are cols×rows — rebuild if a context is live.
    glp.glRebuildCellTextures();

    // Camera: same world center, new buffer/view metrics (viewport already set by JS).
    cam.setBounds(cols - cam.viewportCols, rows - cam.viewportRows);
    cam.set(worldCX - newOffX - vCols * 0.5, worldCY - newOffY - vRows * 0.5);

    useLayer(&fg); markAllDirty();
    useLayer(&bg); markAllDirty();
    useLayer(&fg);
    worldShiftCount++; // treat as a stream event for any counters/tests
    return 1;
  }
