  void initInfiniteLayerState(uint32_t seed, uint32_t layerSalt, bool background) {
    L->infinite = true; L->isBackground = background; L->worldSeed = seed;
    L->gSurfBase = imax(8, (int)std::floor(rows * 0.22));
    L->gSeaRow = TerrainGen::SEA_LEVEL;
    L->gSoil = TerrainGen::BASE_SOIL_DEPTH;
    L->gCaveSeed = (seed ^ 0x5bd1e995u) + layerSalt * 0x9e3779b9u;
    L->gPocketSeed = (seed ^ 0xC0FFEE11u) + layerSalt * 0x85ebca6bu;
    L->gTreeSeed = seed ^ 0x1b56c4f9u; // shared so tree silhouettes line up across layers
    if (planetId != PL_EARTH) {
      uint32_t planetSalt = planetId == PL_MOON ? 0x4D004E31u
                          : planetId == PL_MARS ? 0x4D415253u : 0x53484950u;
      L->gSeaRow = INT_MAX / 4;
      L->gCaveSeed ^= planetSalt;
      L->gPocketSeed ^= planetSalt * 0x9e3779b9u;
    }
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
  void shiftRowMajorU32(uint32_t* arr, int dx, uint32_t fill) {
    if (dx > 0) for (int y = 0; y < rows; y++) {
      int b = y * cols;
      memmove(arr + b, arr + b + dx, (size_t)(cols - dx) * sizeof(uint32_t));
      std::fill(arr + b + cols - dx, arr + b + cols, fill);
    } else {
      int s = -dx;
      for (int y = 0; y < rows; y++) {
        int b = y * cols;
        memmove(arr + b + s, arr + b, (size_t)(cols - s) * sizeof(uint32_t));
        std::fill(arr + b, arr + b + s, fill);
      }
    }
  }
  // Vertical slide of a row-major buffer by dy rows (dy>0: content moves UP, new
  // band enters at the bottom). A single contiguous memmove (no per-row loop).
  void shiftBufV(uint8_t* arr, int dy, uint8_t fill) {
    int s = std::abs(dy); size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols;
    if (dy > 0) { memmove(arr, arr + band, rest); memset(arr + rest, fill, band); }
    else { memmove(arr + band, arr, rest); memset(arr, fill, band); }
  }
  void shiftBufVU32(uint32_t* arr, int dy, uint32_t fill) {
    int s = std::abs(dy);
    size_t band = (size_t)s * cols, rest = (size_t)(rows - s) * cols;
    if (dy > 0) {
      memmove(arr, arr + band, rest * sizeof(uint32_t));
      std::fill(arr + rest, arr + rest + band, fill);
    } else {
      memmove(arr + band, arr, rest * sizeof(uint32_t));
      std::fill(arr, arr + band, fill);
    }
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
  void csSaveFusesLeaving(int bx0, int by0, int w, int h) {
    for (auto it = L->pendingDetonations.begin();
         it != L->pendingDetonations.end();) {
      int k = it->first;
      int y = k / cols, x = k - y * cols;
      if (x < bx0 || x >= bx0 + w || y < by0 || y >= by0 + h) {
        ++it;
        continue;
      }
      int wx = L->worldOffsetX + x, wy = L->worldOffsetY + y;
      int64_t key = tileKey(floorDiv(wx, CHUNK_SIZE),
                            floorDiv(wy, CHUNK_SIZE));
      auto& stored = L->fuseStore[key];
      auto same = std::find_if(stored.begin(), stored.end(),
        [&](const Layer::StoredFuse& fuse) {
          return fuse.wx == wx && fuse.wy == wy;
        });
      if (same == stored.end()) stored.push_back({wx, wy, it->second});
      else same->ticks = imin(same->ticks, it->second);
      it = L->pendingDetonations.erase(it);
    }
  }
  void shiftPendingFuses(int dx, int dy) {
    if (L->pendingDetonations.empty()) return;
    std::unordered_map<int, int> shifted;
    shifted.reserve(L->pendingDetonations.size());
    for (const auto& entry : L->pendingDetonations) {
      int y = entry.first / cols, x = entry.first - y * cols;
      int nx = x - dx, ny = y - dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      int k = ny * cols + nx;
      auto inserted = shifted.emplace(k, entry.second);
      if (!inserted.second) inserted.first->second = imin(inserted.first->second,
                                                         entry.second);
    }
    L->pendingDetonations.swap(shifted);
  }
  void csRestoreFuses(int bx0, int by0, int w, int h) {
    int worldX0 = L->worldOffsetX + bx0;
    int worldY0 = L->worldOffsetY + by0;
    int tileX0 = floorDiv(worldX0, CHUNK_SIZE);
    int tileY0 = floorDiv(worldY0, CHUNK_SIZE);
    int tileX1 = floorDiv(worldX0 + w - 1, CHUNK_SIZE);
    int tileY1 = floorDiv(worldY0 + h - 1, CHUNK_SIZE);
    for (int tileY = tileY0; tileY <= tileY1; tileY++)
      for (int tileX = tileX0; tileX <= tileX1; tileX++) {
        auto store = L->fuseStore.find(tileKey(tileX, tileY));
        if (store == L->fuseStore.end()) continue;
        std::vector<Layer::StoredFuse> keep;
        for (const Layer::StoredFuse& fuse : store->second) {
          int x = fuse.wx - L->worldOffsetX;
          int y = fuse.wy - L->worldOffsetY;
          if (x < bx0 || x >= bx0 + w || y < by0 || y >= by0 + h) {
            keep.push_back(fuse);
            continue;
          }
          int k = y * cols + x;
          if (L->grid[k] == TNT && L->bodyOwner[k] < 0) {
            auto inserted = L->pendingDetonations.emplace(k, fuse.ticks);
            if (!inserted.second)
              inserted.first->second = imin(inserted.first->second, fuse.ticks);
          }
        }
        if (keep.empty()) L->fuseStore.erase(store);
        else store->second.swap(keep);
      }
  }
  void remapStoredEntities(int oldOffX, int oldOffY,
                           int newOffX, int newOffY,
                           int restoreX0, int restoreY0,
                           int restoreW, int restoreH) {
    std::vector<Item> keptItems;
    keptItems.reserve(itemsys.items.size());
    for (Item item : itemsys.items) {
      double wx = oldOffX + item.px, wy = oldOffY + item.py;
      item.px = wx - newOffX; item.py = wy - newOffY;
      if (item.px >= 0 && item.px < cols && item.py >= 0 && item.py < rows) {
        keptItems.push_back(item);
      } else if (item.kind == IT_ITEM && storedItemCount < IT_MAX_ITEMS) {
        int64_t key = tileKey(floorDiv((int)std::floor(wx), CHUNK_SIZE),
                              floorDiv((int)std::floor(wy), CHUNK_SIZE));
        itemStore[key].push_back({item, wx, wy});
        storedItemCount++;
      }
    }
    itemsys.items.swap(keptItems);

    std::vector<Projectile> keptProjectiles;
    keptProjectiles.reserve(projectiles.projectiles.size());
    for (Projectile projectile : projectiles.projectiles) {
      double wx = oldOffX + projectile.px, wy = oldOffY + projectile.py;
      projectile.px = wx - newOffX; projectile.py = wy - newOffY;
      if (projectile.px >= 0 && projectile.px < cols
          && projectile.py >= 0 && projectile.py < rows) {
        keptProjectiles.push_back(projectile);
      } else if (storedProjectileCount < PROJECTILE_MAX) {
        int64_t key = tileKey(floorDiv((int)std::floor(wx), CHUNK_SIZE),
                              floorDiv((int)std::floor(wy), CHUNK_SIZE));
        projectileStore[key].push_back({projectile, wx, wy});
        storedProjectileCount++;
      }
    }
    projectiles.projectiles.swap(keptProjectiles);

    int worldX0 = newOffX + restoreX0;
    int worldY0 = newOffY + restoreY0;
    int tileX0 = floorDiv(worldX0, CHUNK_SIZE);
    int tileY0 = floorDiv(worldY0, CHUNK_SIZE);
    int tileX1 = floorDiv(worldX0 + restoreW - 1, CHUNK_SIZE);
    int tileY1 = floorDiv(worldY0 + restoreH - 1, CHUNK_SIZE);
    for (int tileY = tileY0; tileY <= tileY1; tileY++)
      for (int tileX = tileX0; tileX <= tileX1; tileX++) {
        int64_t key = tileKey(tileX, tileY);
        auto itemTile = itemStore.find(key);
        if (itemTile != itemStore.end()) {
          std::vector<StoredItem> keep;
          for (StoredItem stored : itemTile->second) {
            double x = stored.wx - newOffX, y = stored.wy - newOffY;
            bool inRestore = x >= restoreX0 && x < restoreX0 + restoreW
                          && y >= restoreY0 && y < restoreY0 + restoreH;
            if (!inRestore || (int)itemsys.items.size() >= IT_MAX_ITEMS) {
              keep.push_back(stored);
              continue;
            }
            stored.value.px = x; stored.value.py = y;
            itemsys.items.push_back(stored.value);
            storedItemCount--;
          }
          if (keep.empty()) itemStore.erase(itemTile);
          else itemTile->second.swap(keep);
        }
        auto projectileTile = projectileStore.find(key);
        if (projectileTile != projectileStore.end()) {
          std::vector<StoredProjectile> keep;
          for (StoredProjectile stored : projectileTile->second) {
            double x = stored.wx - newOffX, y = stored.wy - newOffY;
            bool inRestore = x >= restoreX0 && x < restoreX0 + restoreW
                          && y >= restoreY0 && y < restoreY0 + restoreH;
            if (!inRestore
                || (int)projectiles.projectiles.size() >= PROJECTILE_MAX) {
              keep.push_back(stored);
              continue;
            }
            stored.value.px = x; stored.value.py = y;
            projectiles.projectiles.push_back(stored.value);
            storedProjectileCount--;
          }
          if (keep.empty()) projectileStore.erase(projectileTile);
          else projectileTile->second.swap(keep);
        }
      }
    std::sort(itemsys.items.begin(), itemsys.items.end(),
              [](const Item& a, const Item& b) { return a.id < b.id; });
    std::sort(projectiles.projectiles.begin(), projectiles.projectiles.end(),
              [](const Projectile& a, const Projectile& b) {
                return a.id < b.id;
              });
  }
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
          if (L->fallSpeed) memset(L->fallSpeed + d, 0, CHUNK_SIZE);
          if (L->nextFallSpeed) memset(L->nextFallSpeed + d, 0, CHUNK_SIZE);
          if (L->liquidVel) {
            memset(L->liquidVel + d, 0, CHUNK_SIZE * sizeof(uint32_t));
            memset(L->nextLiquidVel + d, 0, CHUNK_SIZE * sizeof(uint32_t));
          }
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
        if (b->jointRole == 2) L->passiveBodyIds.erase(b->id);
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
        for (auto& e : it->second) {
          Body* b = e.first;
          b->px = e.second.first - L->worldOffsetX;
          b->py = e.second.second - L->worldOffsetY;
          L->bodies.push_back(b);
          if (b->jointRole == 2) L->passiveBodyIds.insert(b->id);
        }
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
    if (planetId == PL_SHIP) {
      fillSpaceship(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    } else if (planetId == PL_MOON || planetId == PL_MARS) {
      fillOffworldStructures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    } else {
      // Cave features / structures BEFORE trees and BEFORE pfStoreTiles,
      // mirroring fillRect's order so a prefetched tile is byte-identical to
      // the synchronous fillRect tile.
      fillCaveFeatures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
      fillDeepCaveFeatures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
      fillOceanFlora(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
      fillStructures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
      fillDeepStructures(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
      sealHazardBoundaries(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
      fillTrees(pfEx0, pfEx0 + pfEw, pfEy0, pfEy0 + pfEh);
    }
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
    useLayer(&fg); restampBodiesAfterStream();
    useLayer(&bg); restampBodiesAfterStream();
    useLayer(&fg);
    for (auto& p : psys.players) { p.px -= dx; p.py -= dy; p.aimX -= dx; p.aimY -= dy; }
    int restoreX = dx > 0 ? cols - std::abs(dx) : 0;
    int restoreY = dy > 0 ? rows - std::abs(dy) : 0;
    int restoreW = dx ? std::abs(dx) : cols;
    int restoreH = dy ? std::abs(dy) : rows;
    remapStoredEntities(fg.worldOffsetX - dx, fg.worldOffsetY - dy,
                        fg.worldOffsetX, fg.worldOffsetY,
                        restoreX, restoreY, restoreW, restoreH);
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
    for (int k : L->passiveBodyCells) { if (isBodyCell(k)) { L->grid[k] = EMPTY; L->next[k] = EMPTY; } L->bodyOwner[k] = -1; }
    L->passiveBodyCells.clear();
    L->blastSparseCarryReady = false;
    // 2) persist the leaving band (bodies + full-state tiles) at the CURRENT offset.
    csSaveFusesLeaving(lx0, ly0, lw, lh);
    csSaveBodiesLeaving(lx0, ly0, lw, lh);
    csSaveTiles(lx0, ly0, lw, lh);
    // 3) slide the buffers + dirty marks.
    double _t = emscripten_get_now();
    if (dx) {
      shiftRowMajorU8(L->grid, dx, EMPTY); shiftRowMajorU8(L->next, dx, EMPTY); shiftRowMajorI32(L->bodyOwner.data(), dx, -1);
      shiftRowMajorU8(L->fallSpeed, dx, 0); shiftRowMajorU8(L->nextFallSpeed, dx, 0);
      shiftRowMajorU32(L->liquidVel, dx, 0); shiftRowMajorU32(L->nextLiquidVel, dx, 0);
      for (int y = 0; y < rows; y++) {
        auto oldSpans = std::move(L->rowMarkSpans[y]);
        L->rowMarkSpans[y].clear();
        for (const auto& span : oldSpans)
          markLayerRowSpan(L, y, span.first - dx, span.second - dx);
      }
    } else {
      shiftBufV(L->grid, dy, EMPTY); shiftBufV(L->next, dy, EMPTY); shiftBufVI32(L->bodyOwner.data(), dy, -1);
      shiftBufV(L->fallSpeed, dy, 0); shiftBufV(L->nextFallSpeed, dy, 0);
      shiftBufVU32(L->liquidVel, dy, 0); shiftBufVU32(L->nextLiquidVel, dy, 0);
      auto oldSpans = std::move(L->rowMarkSpans);
      L->rowMarkSpans.clear(); L->rowMarkSpans.resize(rows);
      for (int y = 0; y < rows; y++) {
        int sy = y + dy;
        if (sy < 0 || sy >= rows) continue;
        for (const auto& span : oldSpans[sy])
          markLayerRowSpan(L, y, span.first, span.second);
      }
    }
    shiftPendingFuses(dx, dy);
    std::fill(L->compOccStamp.begin(), L->compOccStamp.end(), -1);
    std::fill(L->vacatedStamp.begin(), L->vacatedStamp.end(), -1);
    std::fill(L->assemblyWakeStamp.begin(), L->assemblyWakeStamp.end(), -1);
    perfShiftBuffers = emscripten_get_now() - _t;
    // 4) translate staying bodies; drop any fully off the buffer.
    { std::vector<Body*> keep; for (Body* b : L->bodies) { b->px -= dx; b->py -= dy; if (b->px > -b->maxR && b->px < cols + b->maxR && b->py > -b->maxR && b->py < rows + b->maxR) keep.push_back(b); else { if (b->jointRole == 2) L->passiveBodyIds.erase(b->id); delete b; } } L->bodies = std::move(keep); }
    // 5) advance the offset, then bring in the entering band: generate the baseline
    //    only if not fully cached, then overlay any saved tiles + restore bodies.
    L->worldOffsetX += dx; L->worldOffsetY += dy;
    _t = emscripten_get_now();
    if (!csTilesAllPresent(ex0, ey0, ew, eh)) { shiftFillMiss++; if (dx) fillRect(ex0, ex0 + ew, 0, rows); else fillRect(0, cols, ey0, ey0 + eh); }
    else shiftFillHit++; // band fully cached (saved tiles or a prefetched baseline) -> no worldgen this frame
    csLoadTiles(ex0, ey0, ew, eh);
    csRestoreBodies(ex0, ey0, ew, eh);
    csRestoreFuses(ex0, ey0, ew, eh);
    perfShiftFill = emscripten_get_now() - _t;
    // 6) mark the entering band active so it simulates.
    if (dx) for (int y = 0; y < rows; y++)
      markLayerRowSpan(L, y, ex0, ex0 + s - 1);
    else for (int y = ey0; y < ey0 + s; y++)
      markLayerRowSpan(L, y, 0, cols - 1);
    // 7) re-index components, register the entering band.
    _t = emscripten_get_now();
    L->prevCompCells.clear();
    L->prevBodyCells.clear();
    L->curBodyCells.clear();
    translateComponents(L->components, dx, dy);
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
    int oldOffX = fg.worldOffsetX, oldOffY = fg.worldOffsetY;
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
      for (int k : L->passiveBodyCells) { if (isBodyCell(k)) { L->grid[k] = EMPTY; L->next[k] = EMPTY; } L->bodyOwner[k] = -1; }
      L->passiveBodyCells.clear();
      L->blastSparseCarryReady = false;
      csSaveFusesLeaving(0, 0, cols, rows);
      csSaveBodiesLeaving(0, 0, cols, rows); // all bodies -> bodyStore (world keys)
      csSaveTiles(0, 0, cols, rows);
      // Components are buffer-indexed; drop and re-register after refill.
      L->components.clear();
      L->deferredSplitIds.clear(); L->componentTombstones = 0;
      L->nextComponentId = 1;
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
      csRestoreFuses(0, 0, cols, rows);
      registerSeededComponents(0, cols);
      // Wake the whole window so settle re-activates after the rebuild.
      markAllDirty();
      L->groundDirty = true; L->groundContentDirty = true; L->looseGroundDirty = true;
      L->skyDirty = true; L->skyValid = false;
    };
    refillLayer(&fg);
    refillLayer(&bg);
    useLayer(&fg); restampBodiesAfterStream();
    useLayer(&bg); restampBodiesAfterStream();
    useLayer(&fg);

    // Re-anchor entities into the new buffer.
    for (size_t i = 0; i < psys.players.size(); i++) {
      auto& p = psys.players[i];
      p.px = playerWorld[i].wx - newOffX;
      p.py = playerWorld[i].wy - newOffY;
      p.aimX = p.px; p.aimY = p.py;
      p.mineActive = false;
    }
    remapStoredEntities(oldOffX, oldOffY,
                        newOffX, newOffY, 0, 0, cols, rows);

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
