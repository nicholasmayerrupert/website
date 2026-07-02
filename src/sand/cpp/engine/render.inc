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
  if (isEmptyMaterial(m) || isGasMaterial(m)) return 8;
  if (isLiquidMaterial(m)) return 16;
  if (isLooseSolidMaterial(m)) return 34;
  if (isRigidMaterialClass(m) || isComponentMaterial(m)) return 48;
  return 40;
}

inline uint8_t emissionFor(uint8_t m) {
  if (m == FIRE) return 230;
  if (m == LAVA) return 210;
  return 0;
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

void computeDirectSky(Layer* lay) {
  const int n = cols * rows;
  if ((int)lay->skyLight.size() != n) lay->skyLight.assign(n, 0);
  else std::fill(lay->skyLight.begin(), lay->skyLight.end(), 0);
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
    if (!topRayStartsInSky(lay, x)) continue;
    for (int y = 0; y < rows; y++) {
      int k = y * cols + x;
      seedSkyOnly(k, renderSkyLight);
      if (!transparentForLight(g[k])) break;
    }
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
}

void computeLighting(Layer* lay, Layer* crossLay = nullptr) {
  const int n = cols * rows;
  if ((int)lay->light.size() != n) lay->light.assign(n, LIGHT_AMBIENT);
  else std::fill(lay->light.begin(), lay->light.end(), LIGHT_AMBIENT);
  lightQueue.clear();
  lightQueue.reserve((size_t)n / 4);

  computeDirectSky(lay);
  if (crossLay) computeDirectSky(crossLay);

  const uint8_t* g = lay->grid;
  auto seed = [&](int k, uint8_t v) {
    if (v > lay->light[k]) {
      lay->light[k] = v;
      lightQueue.push_back(k);
    }
  };

  for (int k = 0; k < n; k++) if (lay->skyLight[k] > LIGHT_AMBIENT) seed(k, lay->skyLight[k]);
  if (crossLay) {
    const uint8_t* cg = crossLay->grid;
    const uint8_t* cs = crossLay->skyLight.data();
    for (int k = 0; k < n; k++) if (transparentForLight(cg[k]) && cs[k] > LIGHT_AMBIENT) seed(k, cs[k]);
  }

  // Then let sky and emissive sources spill into liquids/solids with material loss.
  for (int k = 0; k < n; k++) {
    uint8_t e = emissionFor(g[k]);
    if (e) seed(k, e);
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
