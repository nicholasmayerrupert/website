// Renderer method bodies (need the full Engine definition; see renderer.hpp).

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

bool Renderer::transparentForLight(uint8_t m) const {
  return E.isEmptyMaterial(m) || E.isGasMaterial(m);
}

int Renderer::lightLossFor(uint8_t m) const {
  if (E.isEmptyMaterial(m) || E.isGasMaterial(m)) return 4;
  if (E.isLiquidMaterial(m)) return 8;
  if (E.isLooseSolidMaterial(m)) return 17;
  if (E.isRigidMaterialClass(m) || E.isComponentMaterial(m)) return 24;
  return 20;
}

bool Renderer::faceLitMaterial(uint8_t m) const {
  return !E.isEmptyMaterial(m) && !E.isGasMaterial(m) && !E.isLiquidMaterial(m);
}

bool Renderer::topRayStartsInSky(Layer* lay, int x) {
  if (!lay->infinite) return true;
  int worldX = lay->worldOffsetX + x;
  int topWorldY = lay->worldOffsetY;
  return topWorldY < E.terrain.genSurfaceAbs(worldX) && topWorldY < lay->gSeaRow;
}

bool Renderer::sideRayStartsInSky(Layer* lay, int x, int y) {
  if (!lay->infinite) return true;
  int worldX = lay->worldOffsetX + x, worldY = lay->worldOffsetY + y;
  return worldY < E.terrain.genSurfaceAbs(worldX) && worldY < lay->gSeaRow;
}

bool Renderer::directSkyCurrent(Layer* lay) const {
  int n = E.cols * E.rows;
  return lay->skyValid && !lay->skyDirty && lay->skyOffsetX == lay->worldOffsetX && lay->skyOffsetY == lay->worldOffsetY &&
         (int)lay->skyLight.size() == n && (int)lay->skyDownDepth.size() == E.cols && (int)lay->skyDownValue.size() == E.cols;
}

void Renderer::remapSkyTopInput(Layer* lay) {
  if ((int)lay->skyTopInput.size() != E.cols) lay->skyTopInput.assign(E.cols, 0);
  if (!lay->infinite) {
    std::fill(lay->skyTopInput.begin(), lay->skyTopInput.end(), 0);
    return;
  }
  if (!lay->skyValid || (int)lay->skyDownDepth.size() != E.cols || (int)lay->skyDownValue.size() != E.cols) {
    std::fill(lay->skyTopInput.begin(), lay->skyTopInput.end(), 0);
    return;
  }
  if (lay->skyOffsetX == lay->worldOffsetX && lay->skyOffsetY == lay->worldOffsetY) return;
  std::vector<uint8_t> nextTop((size_t)E.cols, 0);
  const uint8_t* g = lay->grid;
  for (int x = 0; x < E.cols; x++) {
    int worldX = lay->worldOffsetX + x;
    int oldX = lay->worldOffsetX + x - lay->skyOffsetX;
    if (oldX >= 0 && oldX < E.cols) {
      int depth = lay->skyDownDepth[oldX];
      if (depth >= 0) {
        int oldTopInNew = lay->skyOffsetY - lay->worldOffsetY;
        int oldLitEndInNew = oldTopInNew + depth;
        if (oldLitEndInNew >= 0 && oldTopInNew < E.rows) {
          int firstKnownLit = imax(0, oldTopInNew);
          if (firstKnownLit <= oldLitEndInNew) {
            bool clearToKnownLit = true;
            for (int y = 0; y < firstKnownLit; y++) {
              if (!transparentForLight(g[y * E.cols + x])) { clearToKnownLit = false; break; }
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

void Renderer::computeDirectSky(Layer* lay, int rx0, int ry0, int rx1, int ry1) {
  const int n = E.cols * E.rows;
  remapSkyTopInput(lay);
  if ((int)lay->skyLight.size() != n) lay->skyLight.assign(n, 0);
  else for (int y = ry0; y <= ry1; y++) { uint8_t* row = lay->skyLight.data() + y * E.cols; std::fill(row + rx0, row + rx1 + 1, (uint8_t)0); }
  if ((int)lay->skyDownDepth.size() != E.cols) lay->skyDownDepth.assign(E.cols, -1);
  if ((int)lay->skyDownValue.size() != E.cols) lay->skyDownValue.assign(E.cols, 0);
  const uint8_t* g = lay->grid;
  auto seedSkyOnly = [&](int k, uint8_t v) {
    if (v > lay->skyLight[k]) lay->skyLight[k] = v;
  };

  // Directional skylight: cast straight rays from the top and from the visible
  // side edges. This keeps open shafts and surface faces bright without making a
  // whole winding cave bright just because it has one surface connection. Infinite
  // worlds only start these rays from real outside-sky coordinates, so unloaded
  // underground buffer edges do not become fake cave skylights. Rays always
  // scan from the REAL buffer edge (transparency along the whole path matters);
  // only the seeding is restricted to the solve region. Out-of-region columns
  // keep their previous skyDownDepth/Value/reach entries (they are only read by
  // the shift remap, and shifts force a full-region solve).
  for (int x = rx0; x <= rx1; x++) {
    uint8_t topValue = lay->skyTopInput[x];
    if (topRayStartsInSky(lay, x) && renderSkyLight > topValue) topValue = renderSkyLight;
    if (topValue <= LIGHT_AMBIENT) { lay->skyDownDepth[x] = -1; lay->skyDownValue[x] = 0; continue; }
    int deepest = -1;
    for (int y = 0; y < E.rows; y++) {
      int k = y * E.cols + x;
      if (y >= ry0 && y <= ry1) seedSkyOnly(k, topValue);
      deepest = y;
      if (!transparentForLight(g[k])) break;
    }
    lay->skyDownDepth[x] = deepest;
    lay->skyDownValue[x] = topValue;
    int worldX = lay->worldOffsetX + x;
    int32_t reach = lay->worldOffsetY + deepest;
    bool blocked = deepest >= 0 && !transparentForLight(g[deepest * E.cols + x]);
    auto it = lay->skyWorldReachY.find(worldX);
    if (blocked || it == lay->skyWorldReachY.end() || reach > it->second) lay->skyWorldReachY[worldX] = reach;
  }
  uint8_t edge = edgeSkyLight();
  for (int y = ry0; y <= ry1; y++) {
    if (sideRayStartsInSky(lay, 0, y)) {
      for (int x = 0; x < E.cols; x++) {
        int k = y * E.cols + x;
        if (x >= rx0 && x <= rx1) seedSkyOnly(k, edge);
        if (!transparentForLight(g[k])) break;
      }
    }
    if (sideRayStartsInSky(lay, E.cols - 1, y)) {
      for (int x = E.cols - 1; x >= 0; x--) {
        int k = y * E.cols + x;
        if (x >= rx0 && x <= rx1) seedSkyOnly(k, edge);
        if (!transparentForLight(g[k])) break;
      }
    }
  }
  lay->skyOffsetX = lay->worldOffsetX;
  lay->skyOffsetY = lay->worldOffsetY;
  lay->skyValid = true;
  lay->skyDirty = false;
}

void Renderer::computeLightingBase(Layer* lay, int rx0, int ry0, int rx1, int ry1) {
  const int n = E.cols * E.rows;
  if ((int)lay->light.size() != n) lay->light.assign(n, LIGHT_AMBIENT);
  else for (int y = ry0; y <= ry1; y++) { uint8_t* row = lay->light.data() + y * E.cols; std::fill(row + rx0, row + rx1 + 1, LIGHT_AMBIENT); }
  lightQueue.clear();
  lightQueue.reserve((size_t)n / 4);

  computeDirectSky(lay, rx0, ry0, rx1, ry1);

  const uint8_t* g = lay->grid;
  auto seed = [&](int k, uint8_t v) {
    if (v > lay->light[k]) {
      lay->light[k] = v;
      lightQueue.push_back(k);
    }
  };

  for (int y = ry0; y <= ry1; y++) {
    int rb = y * E.cols;
    for (int x = rx0; x <= rx1; x++) { int k = rb + x; if (lay->skyLight[k] > LIGHT_AMBIENT) seed(k, lay->skyLight[k]); }
  }

  // Then let sky and emissive sources spill into liquids/solids with material loss.
  for (int y = ry0; y <= ry1; y++) {
    int rb = y * E.cols, wy = lay->worldOffsetY + y;
    for (int x = rx0; x <= rx1; x++) {
      int k = rb + x;
      uint8_t e = emissionForCell(g[k], lay->worldOffsetX + x, wy);
      if (e) seed(k, e);
    }
  }

  // Flood clamped to the region: the ring underestimates (its far sources are
  // cut off), which cannot change any value inside the exact window (their
  // real contribution there is <= ambient by the distance argument above).
  for (size_t qi = 0; qi < lightQueue.size(); qi++) {
    int k = lightQueue[qi];
    int cur = lay->light[k];
    int y = k / E.cols, x = k - y * E.cols;
    auto pushNeighbour = [&](int nk) {
      int nl = cur - lightLossFor(g[nk]);
      if (nl <= (int)lay->light[nk]) return;
      lay->light[nk] = (uint8_t)(nl > 255 ? 255 : nl);
      lightQueue.push_back(nk);
    };
    if (x > rx0) pushNeighbour(k - 1);
    if (x < rx1) pushNeighbour(k + 1);
    if (y > ry0) pushNeighbour(k - E.cols);
    if (y < ry1) pushNeighbour(k + E.cols);
  }
}

// Projects `crossLay`'s light into `lay`. Reads crossLay->lightBase (the layer's
// PRE-projection light) rather than crossLay->light, so both directions can be
// projected from clean bases in one frame without the two calls contaminating each
// other. Callers MUST snapshot crossLay->lightBase = crossLay->light before calling.
void Renderer::projectCrossLayerLight(Layer* lay, Layer* crossLay, int rx0, int ry0, int rx1, int ry1) {
  const int n = E.cols * E.rows;
  const uint8_t* g = lay->grid;
  const uint8_t* cg = crossLay->grid;
  const uint8_t* cl = crossLay->lightBase.data();
  lightQueue.clear();
  lightQueue.reserve((size_t)n / 8);
  for (int y = ry0; y <= ry1; y++) {
    int rb = y * E.cols;
    for (int x = rx0; x <= rx1; x++) {
      int k = rb + x;
      int v = 0;
      if (transparentForLight(cg[k])) {
        v = (int)cl[k] - CROSS_LAYER_EMISSIVE_LOSS;
      } else {
        v = (int)crossLayerEmissionFor(cg[k], crossLay->worldOffsetX + x, crossLay->worldOffsetY + y);
      }
      if (v > (int)lay->light[k] && v > LIGHT_AMBIENT) {
        lay->light[k] = (uint8_t)v;
        if (transparentForLight(g[k])) lightQueue.push_back(k);
      }
    }
  }

  for (size_t qi = 0; qi < lightQueue.size(); qi++) {
    int k = lightQueue[qi];
    int cur = lay->light[k];
    int y = k / E.cols, x = k - y * E.cols;
    auto pushNeighbour = [&](int nk) {
      int nl = cur - lightLossFor(g[nk]);
      if (nl <= (int)lay->light[nk]) return;
      lay->light[nk] = (uint8_t)(nl > 255 ? 255 : nl);
      if (transparentForLight(g[nk])) lightQueue.push_back(nk);
    };
    if (x > rx0) pushNeighbour(k - 1);
    if (x < rx1) pushNeighbour(k + 1);
    if (y > ry0) pushNeighbour(k - E.cols);
    if (y < ry1) pushNeighbour(k + E.cols);
  }
}

void Renderer::computeLighting(Layer* lay, Layer* crossLay) {
  computeLightingBase(lay, 0, 0, E.cols - 1, E.rows - 1);
  if (!crossLay) return;
  computeLightingBase(crossLay, 0, 0, E.cols - 1, E.rows - 1);
  crossLay->lightBase = crossLay->light;  // snapshot base for projectCrossLayerLight
  projectCrossLayerLight(lay, crossLay, 0, 0, E.cols - 1, E.rows - 1);
}

// Solve BOTH layers' final light in one coordinated pass (the GL present path).
// Each layer's base is computed exactly once (vs. the ~4x of calling computeLighting
// per layer), snapshotted into lightBase, then cross-projected. Matches the per-layer
// computeLighting result exactly: the foreground receives cross-light from the
// background only when E.bgEnabled, the background always receives it from the
// foreground (mirrors the crossLay selection in renderFull()).
void Renderer::computeLightingBoth(int rx0, int ry0, int rx1, int ry1) {
  const size_t n = (size_t)E.cols * E.rows;
  auto snapshotBase = [&](Layer& lay) {
    if (lay.lightBase.size() != n) { lay.lightBase = lay.light; return; }
    for (int y = ry0; y <= ry1; y++) {
      size_t off = (size_t)y * E.cols;
      std::copy(lay.light.begin() + off + rx0, lay.light.begin() + off + rx1 + 1, lay.lightBase.begin() + off + rx0);
    }
  };
  computeLightingBase(&E.fg, rx0, ry0, rx1, ry1);
  snapshotBase(E.fg);
  computeLightingBase(&E.bg, rx0, ry0, rx1, ry1);
  snapshotBase(E.bg);
  if (E.bgEnabled) projectCrossLayerLight(&E.fg, &E.bg, rx0, ry0, rx1, ry1);  // fg <- bg base (only when bg is live)
  projectCrossLayerLight(&E.bg, &E.fg, rx0, ry0, rx1, ry1);                   // bg <- fg base (always)
}

uint8_t Renderer::renderLightForCell(const uint8_t* light, int k, int x, int y, uint8_t m) const {
  uint8_t v = light[k];
  if (!faceLitMaterial(m)) return v;
  if (x > 0 && light[k - 1] > v) v = light[k - 1];
  if (x + 1 < E.cols && light[k + 1] > v) v = light[k + 1];
  if (y > 0 && light[k - E.cols] > v) v = light[k - E.cols];
  if (y + 1 < E.rows && light[k + E.cols] > v) v = light[k + E.cols];
  return v;
}

void Renderer::buildRenderTables() {
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
void Renderer::fillRenderSpan(uint8_t* g, uint32_t* p, int x0, int y0, int x1, int y1) {
  // Index the noise/sparkle by absolute world coords so the grain is locked to the
  // terrain, not the buffer. worldOffset is 0 for bounded worlds (no-op there);
  // for infinite worlds it advances per shift. `& 63`/`& 7` stay in range for
  // negative offsets too (two's-complement low bits == value mod 64/8).
  int woX = E.L->worldOffsetX, woY = E.L->worldOffsetY;
  // Skip the per-cell mineDamage load + crack-shading branch entirely unless this
  // layer actually has live mining damage (almost never). mineDamage is a parallel
  // E.cols*E.rows array, so eliding the load also removes a cache stream from the hot
  // fill. The damaged uint32_t* is only dereferenced on the rare path.
  const uint32_t* dmg = E.L->mineDamageAny ? E.L->mineDamage.data() : nullptr;
  const uint8_t* light = RENDER_LIGHTING_ENABLED ? E.L->light.data() : nullptr;
  for (int y = y0; y <= y1; y++) {
    int rowBase = y * E.cols;
    int wy = woY + y;
    const uint8_t* noiseRow = &renderNoise[(wy & 63) << 6];
    int wx = woX + x0;
    for (int x = x0; x <= x1; x++, wx++) {
      int k = rowBase + x;
      uint8_t m = g[k];
      // EMPTY is the dominant cell in open sky / caves — skip noise/light work.
      if (m == EMPTY) { p[k] = 0; continue; }
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
#ifdef __EMSCRIPTEN_PTHREADS__
      // Animated grain is cell-addressed rather than consuming a shared stream,
      // so independent checkerboard chunks can be filled concurrently.
      uint32_t anim = renderCellHash(wx ^ (int)renderFrameSalt, wy + (int)(renderFrameSalt * 17u));
      if (m == STEAM) { if ((anim & 0xffffu) <= 11796u) c = 0; }
      else if (m == FIRE) { if ((anim & 0xffffu) < 22938u) c = PACKED_FIRE_HOT; }
#else
      if (m == STEAM) { if (renderRand() <= 0.18) c = 0; }
      else if (m == FIRE) { if (renderRand() < 0.35) c = PACKED_FIRE_HOT; }
#endif
      else if (m == LAVA) { if (((wx * 17 + wy * 31) & 7) == 0) c = PACKED_LAVA_HOT; }
      else if (m == CRYSTAL) { if ((renderCellHash(wx, wy) & 7u) == 0u) c = PACKED_CRYSTAL_CORE; }
      else if (m == MYCELIUM || m == MYCELIUM_SPORE) {
        if (m == MYCELIUM_SPORE || myceliumNoduleAt(wx, wy)) c = PACKED_MYCELIUM_NODULE;
      }
      else if (m == GLOWBERRY) { if ((renderCellHash(wx, wy) & 3u) == 0u) c = PACKED_GLOWBERRY_CORE; }
      else if (m == GLOWSHROOM) { if ((renderCellHash(wx, wy) & 3u) == 0u) c = PACKED_GLOWSHROOM_CORE; }
      if (light) c = applyLight(c, renderLightForCell(light, k, x, y, m));
      p[k] = c;
    }
  }
}

// Render the ACTIVE layer (L) into its own renderPixels.
void Renderer::renderFull() {
  if (RENDER_LIGHTING_ENABLED) {
    Layer* crossLay = (E.L == &E.bg) ? &E.fg : ((E.L == &E.fg && E.bgEnabled) ? &E.bg : nullptr);
    computeLighting(E.L, crossLay);
  }
  uint8_t* g = E.L->grid;
  uint32_t* p = (uint32_t*)E.L->renderPixels.data();
#ifdef __EMSCRIPTEN_PTHREADS__
  renderFrameSalt++;
  E.forEachCheckerboardChunk([&](int cx, int cy) {
    int x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
    fillRenderSpan(g, p, x0, y0, imin(E.cols - 1, x0 + CHUNK_SIZE - 1), imin(E.rows - 1, y0 + CHUNK_SIZE - 1));
  });
#else
  fillRenderSpan(g, p, 0, 0, E.cols - 1, E.rows - 1);
#endif
}

// Refill only the active layer's coalesced dirty rects. Rects are [x0,y0,x1,y1)
// exclusive; convert to inclusive for the fill.
void Renderer::renderDirtyRects() {
  if (RENDER_LIGHTING_ENABLED) { renderFull(); return; }
  uint8_t* g = E.L->grid; uint32_t* p = (uint32_t*)E.L->renderPixels.data();
  for (size_t i = 0; i + 3 < E.L->dirtyRects.size(); i += 4)
    fillRenderSpan(g, p, E.L->dirtyRects[i], E.L->dirtyRects[i + 1], E.L->dirtyRects[i + 2] - 1, E.L->dirtyRects[i + 3] - 1);
}
