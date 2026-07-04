// Material -> RGBA pixel generation (the engine's render hot path).
//
// Writes one RGBA pixel per cell into renderPixels (little-endian uint32, so the
// bytes land as R,G,B,A for an ImageData). Each material gets a fixed set of 8
// brightness-shifted shades; a stable 64x64 noise tile picks one per cell by
// ABSOLUTE WORLD position (worldOffset+buffer), so the grain stays locked to the
// terrain across frames AND across world shifts. Keying on buffer position instead
// makes the grain visibly "reapply" on a vertical shift, because WORLD_SHIFT_ROWS
// (96) is not a multiple of the 64-tile, so the slid texture and the re-rendered
// cells would disagree on the tile phase. It is identical on the full and per-rect
// paths. Steam shimmers (random skip), fire flickers, lava sparkles.
//
// JS owns the camera/presentation; it calls render_full or render_dirty_rects,
// then uploads renderPixels (putImageData) and blits with drawImage.

// Brighten/darken a packed ABGR color by delta on each channel (alpha kept).
static inline uint32_t jitterShade(uint32_t packed, int delta) {
  if (packed == 0) return 0;
  uint32_t a = packed & 0xff000000u;
  int r = (int)(packed & 0xff), g = (int)((packed >> 8) & 0xff), b = (int)((packed >> 16) & 0xff);
  r += delta; g += delta; b += delta;
  if (r < 0) r = 0; else if (r > 255) r = 255;
  if (g < 0) g = 0; else if (g > 255) g = 255;
  if (b < 0) b = 0; else if (b > 255) b = 255;
  return a | ((uint32_t)b << 16) | ((uint32_t)g << 8) | (uint32_t)r;
}

static constexpr bool RENDER_LIGHTING_ENABLED = true;
static constexpr uint8_t LIGHT_AMBIENT = 35;

inline bool transparentForLight(uint8_t m) {
  return isEmptyMaterial(m) || isGasMaterial(m);
}

inline int lightLossFor(uint8_t m) {
  if (isEmptyMaterial(m) || isGasMaterial(m)) return 4;
  if (isLiquidMaterial(m)) return 8;
  if (isLooseSolidMaterial(m)) return 17;
  if (isRigidMaterialClass(m) || isComponentMaterial(m)) return 24;
  return 20;
}

inline uint32_t renderCellHash(int wx, int wy) {
  uint32_t h = (uint32_t)wx * 0x9e3779b1u;
  h ^= (uint32_t)wy * 0x85ebca77u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
  return h;
}

inline bool myceliumNoduleAt(int wx, int wy) {
  uint32_t h = renderCellHash(wx, wy);
  return (h % 19u) == 0u || (((h >> 8) % 53u) == 0u);
}

static constexpr uint8_t CROSS_LAYER_EMISSIVE_LOSS = 28;

// Baseline emission strength comes from the schema (MAT_EMISSION); CRYSTAL and
// MYCELIUM emit from sparse positional pockets rather than every cell.
inline uint8_t emissionForCell(uint8_t m, int wx, int wy) {
  uint8_t e = MAT_EMISSION[m];
  if (!e) return 0;
  if (m == CRYSTAL) return (((wx * 17 + wy * 31) & 3) == 0) ? e : 0;
  if (m == MYCELIUM) return (((wx * 13 + wy * 29) & 31) == 0) ? e : 0;
  return e;
}

inline uint8_t crossLayerEmissionFor(uint8_t m, int wx, int wy) {
  uint8_t e = emissionForCell(m, wx, wy);
  if (!e) return 0;
  int v = (int)e - CROSS_LAYER_EMISSIVE_LOSS;
  return v > LIGHT_AMBIENT ? (uint8_t)v : 0;
}

inline uint8_t edgeSkyLight() {
  return (uint8_t)(((int)renderSkyLight * 220 + 127) / 255);
}

inline uint32_t applyLight(uint32_t packed, uint8_t light) {
  if (packed == 0) return 0;
  uint32_t a = packed & 0xff000000u;
  uint32_t r = packed & 0xffu, g = (packed >> 8) & 0xffu, b = (packed >> 16) & 0xffu;
  r = (r * light + 127u) / 255u;
  g = (g * light + 127u) / 255u;
  b = (b * light + 127u) / 255u;
  return a | (b << 16) | (g << 8) | r;
}

inline bool faceLitMaterial(uint8_t m) {
  return !isEmptyMaterial(m) && !isGasMaterial(m) && !isLiquidMaterial(m);
}

inline bool topRayStartsInSky(Layer* lay, int x) {
  if (!lay->infinite) return true;
  int worldX = lay->worldOffsetX + x;
  int topWorldY = lay->worldOffsetY;
  return topWorldY < genSurfaceAbs(worldX) && topWorldY < lay->gSeaRow;
}

inline bool sideRayStartsInSky(Layer* lay, int x, int y) {
  if (!lay->infinite) return true;
  int worldX = lay->worldOffsetX + x, worldY = lay->worldOffsetY + y;
  return worldY < genSurfaceAbs(worldX) && worldY < lay->gSeaRow;
}

inline bool directSkyCurrent(Layer* lay) {
  int n = cols * rows;
  return lay->skyValid && !lay->skyDirty && lay->skyOffsetX == lay->worldOffsetX && lay->skyOffsetY == lay->worldOffsetY &&
         (int)lay->skyLight.size() == n && (int)lay->skyDownDepth.size() == cols && (int)lay->skyDownValue.size() == cols;
}

void remapSkyTopInput(Layer* lay) {
  if ((int)lay->skyTopInput.size() != cols) lay->skyTopInput.assign(cols, 0);
  if (!lay->infinite) {
    std::fill(lay->skyTopInput.begin(), lay->skyTopInput.end(), 0);
    return;
  }
  if (!lay->skyValid || (int)lay->skyDownDepth.size() != cols || (int)lay->skyDownValue.size() != cols) {
    std::fill(lay->skyTopInput.begin(), lay->skyTopInput.end(), 0);
    return;
  }
  if (lay->skyOffsetX == lay->worldOffsetX && lay->skyOffsetY == lay->worldOffsetY) return;
  std::vector<uint8_t> nextTop((size_t)cols, 0);
  const uint8_t* g = lay->grid;
  for (int x = 0; x < cols; x++) {
    int worldX = lay->worldOffsetX + x;
    int oldX = lay->worldOffsetX + x - lay->skyOffsetX;
    if (oldX >= 0 && oldX < cols) {
      int depth = lay->skyDownDepth[oldX];
      if (depth >= 0) {
        int oldTopInNew = lay->skyOffsetY - lay->worldOffsetY;
        int oldLitEndInNew = oldTopInNew + depth;
        if (oldLitEndInNew >= 0 && oldTopInNew < rows) {
          int firstKnownLit = imax(0, oldTopInNew);
          if (firstKnownLit <= oldLitEndInNew) {
            bool clearToKnownLit = true;
            for (int y = 0; y < firstKnownLit; y++) {
              if (!transparentForLight(g[y * cols + x])) { clearToKnownLit = false; break; }
            }
            if (clearToKnownLit) {
              nextTop[x] = lay->skyDownValue[oldX];
              continue;
            }
          }
        }
      }
    }
    auto it = lay->skyWorldReachY.find(worldX);
    if (it != lay->skyWorldReachY.end() && it->second >= lay->worldOffsetY) nextTop[x] = renderSkyLight;
  }
  lay->skyTopInput.swap(nextTop);
}

void computeDirectSky(Layer* lay) {
  const int n = cols * rows;
  remapSkyTopInput(lay);
  if ((int)lay->skyLight.size() != n) lay->skyLight.assign(n, 0);
  else std::fill(lay->skyLight.begin(), lay->skyLight.end(), 0);
  if ((int)lay->skyDownDepth.size() != cols) lay->skyDownDepth.assign(cols, -1);
  else std::fill(lay->skyDownDepth.begin(), lay->skyDownDepth.end(), -1);
  if ((int)lay->skyDownValue.size() != cols) lay->skyDownValue.assign(cols, 0);
  else std::fill(lay->skyDownValue.begin(), lay->skyDownValue.end(), 0);
  const uint8_t* g = lay->grid;
  auto seedSkyOnly = [&](int k, uint8_t v) {
    if (v > lay->skyLight[k]) lay->skyLight[k] = v;
  };

  // Directional skylight: cast straight rays from the top and from the visible
  // side edges. This keeps open shafts and surface faces bright without making a
  // whole winding cave bright just because it has one surface connection. Infinite
  // worlds only start these rays from real outside-sky coordinates, so unloaded
  // underground buffer edges do not become fake cave skylights.
  for (int x = 0; x < cols; x++) {
    uint8_t topValue = lay->skyTopInput[x];
    if (topRayStartsInSky(lay, x) && renderSkyLight > topValue) topValue = renderSkyLight;
    if (topValue <= LIGHT_AMBIENT) continue;
    int deepest = -1;
    for (int y = 0; y < rows; y++) {
      int k = y * cols + x;
      seedSkyOnly(k, topValue);
      deepest = y;
      if (!transparentForLight(g[k])) break;
    }
    lay->skyDownDepth[x] = deepest;
    lay->skyDownValue[x] = topValue;
    int worldX = lay->worldOffsetX + x;
    int32_t reach = lay->worldOffsetY + deepest;
    bool blocked = deepest >= 0 && !transparentForLight(g[deepest * cols + x]);
    auto it = lay->skyWorldReachY.find(worldX);
    if (blocked || it == lay->skyWorldReachY.end() || reach > it->second) lay->skyWorldReachY[worldX] = reach;
  }
  uint8_t edge = edgeSkyLight();
  for (int y = 0; y < rows; y++) {
    if (sideRayStartsInSky(lay, 0, y)) {
      for (int x = 0; x < cols; x++) {
        int k = y * cols + x;
        seedSkyOnly(k, edge);
        if (!transparentForLight(g[k])) break;
      }
    }
    if (sideRayStartsInSky(lay, cols - 1, y)) {
      for (int x = cols - 1; x >= 0; x--) {
        int k = y * cols + x;
        seedSkyOnly(k, edge);
        if (!transparentForLight(g[k])) break;
      }
    }
  }
  lay->skyOffsetX = lay->worldOffsetX;
  lay->skyOffsetY = lay->worldOffsetY;
  lay->skyValid = true;
  lay->skyDirty = false;
}

void computeLightingBase(Layer* lay) {
  const int n = cols * rows;
  if ((int)lay->light.size() != n) lay->light.assign(n, LIGHT_AMBIENT);
  else std::fill(lay->light.begin(), lay->light.end(), LIGHT_AMBIENT);
  lightQueue.clear();
  lightQueue.reserve((size_t)n / 4);

  computeDirectSky(lay);

  const uint8_t* g = lay->grid;
  auto seed = [&](int k, uint8_t v) {
    if (v > lay->light[k]) {
      lay->light[k] = v;
      lightQueue.push_back(k);
    }
  };

  for (int k = 0; k < n; k++) if (lay->skyLight[k] > LIGHT_AMBIENT) seed(k, lay->skyLight[k]);

  // Then let sky and emissive sources spill into liquids/solids with material loss.
  for (int y = 0; y < rows; y++) {
    int rb = y * cols, wy = lay->worldOffsetY + y;
    for (int x = 0; x < cols; x++) {
      int k = rb + x;
      uint8_t e = emissionForCell(g[k], lay->worldOffsetX + x, wy);
      if (e) seed(k, e);
    }
  }

  for (size_t qi = 0; qi < lightQueue.size(); qi++) {
    int k = lightQueue[qi];
    int cur = lay->light[k];
    int y = k / cols, x = k - y * cols;
    auto pushNeighbour = [&](int nk) {
      int nl = cur - lightLossFor(g[nk]);
      if (nl <= (int)lay->light[nk]) return;
      lay->light[nk] = (uint8_t)(nl > 255 ? 255 : nl);
      lightQueue.push_back(nk);
    };
    if (x > 0) pushNeighbour(k - 1);
    if (x + 1 < cols) pushNeighbour(k + 1);
    if (y > 0) pushNeighbour(k - cols);
    if (y + 1 < rows) pushNeighbour(k + cols);
  }
}

// Projects `crossLay`'s light into `lay`. Reads crossLay->lightBase (the layer's
// PRE-projection light) rather than crossLay->light, so both directions can be
// projected from clean bases in one frame without the two calls contaminating each
// other. Callers MUST snapshot crossLay->lightBase = crossLay->light before calling.
void projectCrossLayerLight(Layer* lay, Layer* crossLay) {
  const int n = cols * rows;
  const uint8_t* g = lay->grid;
  const uint8_t* cg = crossLay->grid;
  const uint8_t* cl = crossLay->lightBase.data();
  lightQueue.clear();
  lightQueue.reserve((size_t)n / 8);
  for (int k = 0; k < n; k++) {
    int v = 0;
    if (transparentForLight(cg[k])) {
      v = (int)cl[k] - CROSS_LAYER_EMISSIVE_LOSS;
    } else {
      int y = k / cols, x = k - y * cols;
      v = (int)crossLayerEmissionFor(cg[k], crossLay->worldOffsetX + x, crossLay->worldOffsetY + y);
    }
    if (v > (int)lay->light[k] && v > LIGHT_AMBIENT) {
      lay->light[k] = (uint8_t)v;
      if (transparentForLight(g[k])) lightQueue.push_back(k);
    }
  }

  for (size_t qi = 0; qi < lightQueue.size(); qi++) {
    int k = lightQueue[qi];
    int cur = lay->light[k];
    int y = k / cols, x = k - y * cols;
    auto pushNeighbour = [&](int nk) {
      int nl = cur - lightLossFor(g[nk]);
      if (nl <= (int)lay->light[nk]) return;
      lay->light[nk] = (uint8_t)(nl > 255 ? 255 : nl);
      if (transparentForLight(g[nk])) lightQueue.push_back(nk);
    };
    if (x > 0) pushNeighbour(k - 1);
    if (x + 1 < cols) pushNeighbour(k + 1);
    if (y > 0) pushNeighbour(k - cols);
    if (y + 1 < rows) pushNeighbour(k + cols);
  }
}

void computeLighting(Layer* lay, Layer* crossLay = nullptr) {
  computeLightingBase(lay);
  if (!crossLay) return;
  computeLightingBase(crossLay);
  crossLay->lightBase = crossLay->light;  // snapshot base for projectCrossLayerLight
  projectCrossLayerLight(lay, crossLay);
}

// Solve BOTH layers' final light in one coordinated pass (the GL present path).
// Each layer's base is computed exactly once (vs. the ~4x of calling computeLighting
// per layer), snapshotted into lightBase, then cross-projected. Matches the per-layer
// computeLighting result exactly: the foreground receives cross-light from the
// background only when bgEnabled, the background always receives it from the
// foreground (mirrors the crossLay selection in renderFull()).
void computeLightingBoth() {
  computeLightingBase(&fg);
  fg.lightBase = fg.light;
  computeLightingBase(&bg);
  bg.lightBase = bg.light;
  if (bgEnabled) projectCrossLayerLight(&fg, &bg);  // fg <- bg base (only when bg is live)
  projectCrossLayerLight(&bg, &fg);                 // bg <- fg base (always)
}

inline uint8_t renderLightForCell(const uint8_t* light, int k, int x, int y, uint8_t m) {
  uint8_t v = light[k];
  if (!faceLitMaterial(m)) return v;
  if (x > 0 && light[k - 1] > v) v = light[k - 1];
  if (x + 1 < cols && light[k + 1] > v) v = light[k + 1];
  if (y > 0 && light[k - cols] > v) v = light[k - cols];
  if (y + 1 < rows && light[k + cols] > v) v = light[k + cols];
  return v;
}

void buildRenderTables() {
  for (int m = 0; m < TABLE; m++) {
    uint32_t base = MAT_COLOR[m];
    int amp = MAT_TEXTURE_AMP[m];
    for (int i = 0; i < 8; i++) {
      double t = (double)i / 7.0 * 2.0 - 1.0; // -1..1
      renderVariants[(m << 3) + i] = jitterShade(base, (int)std::lround(t * amp));
    }
  }
  for (int i = 0; i < 64 * 64; i++) {
    int v = (int)(renderRand() * 8.0);
    renderNoise[i] = (uint8_t)(v < 0 ? 0 : (v > 7 ? 7 : v));
  }
}

// Fill `out` (RGBA over uint32) for an INCLUSIVE cell rect [x0,x1] x [y0,y1] from
// `g` (a layer's grid). Parameterized so it serves either layer's renderPixels.
inline void fillRenderSpan(uint8_t* g, uint32_t* p, int x0, int y0, int x1, int y1) {
  // Index the noise/sparkle by absolute world coords so the grain is locked to the
  // terrain, not the buffer. worldOffset is 0 for bounded worlds (no-op there);
  // for infinite worlds it advances per shift. `& 63`/`& 7` stay in range for
  // negative offsets too (two's-complement low bits == value mod 64/8).
  int woX = L->worldOffsetX, woY = L->worldOffsetY;
  // Skip the per-cell mineDamage load + crack-shading branch entirely unless this
  // layer actually has live mining damage (almost never). mineDamage is a parallel
  // cols*rows array, so eliding the load also removes a cache stream from the hot
  // fill. The damaged uint32_t* is only dereferenced on the rare path.
  const uint32_t* dmg = L->mineDamageAny ? L->mineDamage.data() : nullptr;
  for (int y = y0; y <= y1; y++) {
    int rowBase = y * cols;
    int wy = woY + y;
    const uint8_t* noiseRow = &renderNoise[(wy & 63) << 6];
    int wx = woX + x0;
    for (int x = x0; x <= x1; x++, wx++) {
      int k = rowBase + x;
      uint8_t m = g[k];
      uint32_t c = renderVariants[((int)m << 3) + noiseRow[wx & 63]];
      if (dmg) {
        uint32_t rem = dmg[k];
        if (rem > 0) {
          uint32_t dur = (uint32_t)DURABILITY[m] * 16u;
          if (dur > 0 && rem < dur) {
            double damaged = (double)(dur - rem) / (double)dur;
            c = jitterShade(c, -(int)std::lround(80.0 * damaged));
          }
        }
      }
      if (m == STEAM) { if (renderRand() <= 0.18) c = 0; }
      else if (m == FIRE) { if (renderRand() < 0.35) c = PACKED_FIRE_HOT; }
      else if (m == LAVA) { if (((wx * 17 + wy * 31) & 7) == 0) c = PACKED_LAVA_HOT; }
      else if (m == CRYSTAL) { if ((renderCellHash(wx, wy) & 7u) == 0u) c = PACKED_CRYSTAL_CORE; }
      else if (m == MYCELIUM || m == MYCELIUM_SPORE) {
        if (m == MYCELIUM_SPORE || myceliumNoduleAt(wx, wy)) c = PACKED_MYCELIUM_NODULE;
      }
      else if (m == GLOWBERRY) { if ((renderCellHash(wx, wy) & 3u) == 0u) c = PACKED_GLOWBERRY_CORE; }
      else if (m == GLOWSHROOM) { if ((renderCellHash(wx, wy) & 3u) == 0u) c = PACKED_GLOWSHROOM_CORE; }
      if (RENDER_LIGHTING_ENABLED) c = applyLight(c, renderLightForCell(L->light.data(), k, x, y, m));
      p[k] = c;
    }
  }
}

// Render the ACTIVE layer (L) into its own renderPixels.
void renderFull() {
  if (RENDER_LIGHTING_ENABLED) {
    Layer* crossLay = (L == &bg) ? &fg : ((L == &fg && bgEnabled) ? &bg : nullptr);
    computeLighting(L, crossLay);
  }
  fillRenderSpan(L->grid, (uint32_t*)L->renderPixels.data(), 0, 0, cols - 1, rows - 1);
}

// Refill only the active layer's coalesced dirty rects. Rects are [x0,y0,x1,y1)
// exclusive; convert to inclusive for the fill.
void renderDirtyRects() {
  if (RENDER_LIGHTING_ENABLED) { renderFull(); return; }
  uint8_t* g = L->grid; uint32_t* p = (uint32_t*)L->renderPixels.data();
  for (size_t i = 0; i + 3 < L->dirtyRects.size(); i += 4)
    fillRenderSpan(g, p, L->dirtyRects[i], L->dirtyRects[i + 1], L->dirtyRects[i + 2] - 1, L->dirtyRects[i + 3] - 1);
}
