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
// paths. MAT_RENDER_ANIM selects a render-only moving texture; simulation state and
// the lighting solve remain untouched.
//
// GLPresenter uploads these pixels into foreground/background textures and
// composites the final frame.

bool Renderer::topRayStartsInSky(Layer* lay, int x) {
  if (!lay->infinite) return true;
  int worldX = lay->worldOffsetX + x;
  int topWorldY = lay->worldOffsetY;
  return topWorldY < E.terrain.genSurfaceAbs(worldX) && topWorldY < lay->gSeaRow;
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
  if (lay->skyOffsetX == lay->worldOffsetX && lay->skyOffsetY == lay->worldOffsetY &&
      lay->skyInputLevel == (int)renderSkyLight) return;
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
              // skyDownDepth is geometric provenance: it proves that this
              // buffer top connects to real sky outside the loaded window.
              // Its cached value may be from a different day/night phase, so
              // always apply the current render-only skylight intensity.
              nextTop[x] = renderSkyLight;
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
  else {
    for (int y = ry0; y <= ry1; y++) { uint8_t* row = lay->skyLight.data() + y * E.cols; std::fill(row + rx0, row + rx1 + 1, (uint8_t)0); }
  }
  if ((int)lay->skyDownDepth.size() != E.cols) lay->skyDownDepth.assign(E.cols, -1);
  if ((int)lay->skyDownValue.size() != E.cols) lay->skyDownValue.assign(E.cols, 0);
  const uint8_t* g = lay->grid;
  auto seedSkyOnly = [&](int k, uint8_t v) {
    if (v > lay->skyLight[k]) lay->skyLight[k] = v;
  };

  // Directional skylight casts downward from real sky. Horizontal light in
  // infinite worlds comes from the attenuated flood through outdoor air, not
  // from moving buffer edges. Finite worlds also have fixed side skylights.
  // Open shafts retain direct sky without lighting an entire winding cave.
  // Rays scan from the real buffer edge, checking transparency along the path;
  // only the seeding is restricted to the solve region. Out-of-region columns
  // keep their previous skyDownDepth/Value/reach entries (they are only read by
  // the shift remap, and shifts force a full-region solve).
  auto castTopRay = [&](int x) {
    uint8_t topValue = lay->skyTopInput[x];
    if (topRayStartsInSky(lay, x) && renderSkyLight > topValue) topValue = renderSkyLight;
    if (topValue <= LIGHT_AMBIENT) { lay->skyDownDepth[x] = -1; lay->skyDownValue[x] = 0; return; }
    int deepest = -1;
    for (int y = 0; y < E.rows; y++) {
      int k = y * E.cols + x;
      if (y >= ry0 && y <= ry1) seedSkyOnly(k, topValue);
      deepest = y;
      if (!transparentForLight(g[k])) break;
    }
    lay->skyDownDepth[x] = deepest;
    lay->skyDownValue[x] = topValue;
  };
  for (int x = rx0; x <= rx1; x++) castTopRay(x);
  // Update the sparse reach map after casting the rays.
  for (int x = rx0; x <= rx1; x++) {
    int deepest = lay->skyDownDepth[x];
    if (deepest < 0) continue;
    int worldX = lay->worldOffsetX + x;
    int32_t reach = lay->worldOffsetY + deepest;
    bool blocked = deepest >= 0 && !transparentForLight(g[deepest * E.cols + x]);
    auto it = lay->skyWorldReachY.find(worldX);
    if (blocked || it == lay->skyWorldReachY.end() || reach > it->second) lay->skyWorldReachY[worldX] = reach;
  }
  uint8_t edge = edgeSkyLight();
  auto castSideRays = [&](int y) {
    for (int x = 0; x < E.cols; x++) {
      int k = y * E.cols + x;
      if (x >= rx0 && x <= rx1) seedSkyOnly(k, edge);
      if (!transparentForLight(g[k])) break;
    }
    for (int x = E.cols - 1; x >= 0; x--) {
      int k = y * E.cols + x;
      if (x >= rx0 && x <= rx1) seedSkyOnly(k, edge);
      if (!transparentForLight(g[k])) break;
    }
  };
  if (!lay->infinite) for (int y = ry0; y <= ry1; y++) castSideRays(y);
  lay->skyOffsetX = lay->worldOffsetX;
  lay->skyOffsetY = lay->worldOffsetY;
  lay->skyInputLevel = (int)renderSkyLight;
  lay->skyValid = true;
  lay->skyDirty = false;
}

void Renderer::computeLightingBase(Layer* lay, int rx0, int ry0, int rx1, int ry1) {
  const int n = E.cols * E.rows;
  if ((int)lay->light.size() != n) lay->light.assign(n, LIGHT_AMBIENT);
  else {
    for (int y = ry0; y <= ry1; y++) { uint8_t* row = lay->light.data() + y * E.cols; std::fill(row + rx0, row + rx1 + 1, LIGHT_AMBIENT); }
  }
  for (auto& bucket : lightBuckets) bucket.clear();

  computeDirectSky(lay, rx0, ry0, rx1, ry1);

  const uint8_t* g = lay->grid;
  // Seed sky cells into intensity buckets before adding emissive sources.
  for (int y = ry0; y <= ry1; y++) {
    int rb = y * E.cols;
    for (int x = rx0; x <= rx1; x++) {
      int k = rb + x;
      if (lay->skyLight[k] > LIGHT_AMBIENT) {
        uint8_t v = lay->skyLight[k];
        if (v > lay->light[k]) {
          lay->light[k] = v;
          lightBuckets[lay->light[k]].push_back(((uint64_t)(uint32_t)x << 32) | (uint32_t)k);
        }
      }
    }
  }
  // Then let sky and emissive sources spill into liquids/solids with material loss.
  for (int y = ry0; y <= ry1; y++) {
    int rb = y * E.cols, wy = lay->worldOffsetY + y;
    for (int x = rx0; x <= rx1; x++) {
      int k = rb + x;
      uint8_t e = emissionForCell(g[k], lay->worldOffsetX + x, wy);
      if (e && e > lay->light[k]) {
        lay->light[k] = e;
        lightBuckets[lay->light[k]].push_back(((uint64_t)(uint32_t)x << 32) | (uint32_t)k);
      }
    }
  }
  // Players/projectiles occupy the foreground actor plane. Seed their light
  // after material emission so both share the same wall/liquid attenuation and
  // the existing foreground -> background projection below.
  if (lay == &E.fg) {
    for (const RenderLightSource& source : dynamicLights) {
      if (source.x < rx0 || source.x > rx1 ||
          source.y < ry0 || source.y > ry1 ||
          source.intensity <= LIGHT_AMBIENT) continue;
      int k = source.y * E.cols + source.x;
      if (source.intensity <= lay->light[k]) continue;
      lay->light[k] = source.intensity;
      lightBuckets[source.intensity].push_back(((uint64_t)(uint32_t)source.x << 32) | (uint32_t)k);
    }
  }

  // Flood clamped to the region: the ring underestimates (its far sources are
  // cut off), which cannot change any value inside the exact window (their
  // real contribution there is <= ambient by the distance argument above).
  for (int level = 255; level > LIGHT_AMBIENT; level--) {
    auto& bucket = lightBuckets[level];
    for (size_t qi = 0; qi < bucket.size(); qi++) {
      uint64_t q = bucket[qi];
      int k = (int)(uint32_t)q, x = (int)(uint32_t)(q >> 32);
      int cur = lay->light[k];
      if (cur != level) continue;
      auto pushNeighbour = [&](int nk, int nx) {
        int nl = cur - lightLossFor(g[nk]);
        if (nl <= (int)lay->light[nk]) return;
        lay->light[nk] = (uint8_t)(nl > 255 ? 255 : nl);
        lightBuckets[nl].push_back(((uint64_t)(uint32_t)nx << 32) | (uint32_t)nk);
      };
      if (x > rx0) pushNeighbour(k - 1, x - 1);
      if (x < rx1) pushNeighbour(k + 1, x + 1);
      if (k >= (ry0 + 1) * E.cols) pushNeighbour(k - E.cols, x);
      if (k < ry1 * E.cols) pushNeighbour(k + E.cols, x);
    }
  }
}

// Projects `crossLay`'s light into `lay`. Reads crossLay->lightBase (the layer's
// PRE-projection light) rather than crossLay->light, so both directions can be
// projected from clean bases in one frame without the two calls contaminating each
// other. Callers MUST snapshot crossLay->lightBase = crossLay->light before calling.
void Renderer::projectCrossLayerLight(Layer* lay, Layer* crossLay, int rx0, int ry0, int rx1, int ry1) {
  const uint8_t* g = lay->grid;
  const uint8_t* cg = crossLay->grid;
  const uint8_t* cl = crossLay->lightBase.data();
  for (auto& bucket : lightBuckets) bucket.clear();
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
        if (transparentForLight(g[k])) lightBuckets[lay->light[k]].push_back(((uint64_t)(uint32_t)x << 32) | (uint32_t)k);
      }
    }
  }

  for (int level = 255; level > LIGHT_AMBIENT; level--) {
    auto& bucket = lightBuckets[level];
    for (size_t qi = 0; qi < bucket.size(); qi++) {
      uint64_t q = bucket[qi];
      int k = (int)(uint32_t)q, x = (int)(uint32_t)(q >> 32);
      int cur = lay->light[k];
      if (cur != level) continue;
      auto pushNeighbour = [&](int nk, int nx) {
        int nl = cur - lightLossFor(g[nk]);
        if (nl <= (int)lay->light[nk]) return;
        lay->light[nk] = (uint8_t)(nl > 255 ? 255 : nl);
        if (transparentForLight(g[nk])) lightBuckets[nl].push_back(((uint64_t)(uint32_t)nx << 32) | (uint32_t)nk);
      };
      if (x > rx0) pushNeighbour(k - 1, x - 1);
      if (x < rx1) pushNeighbour(k + 1, x + 1);
      if (k >= (ry0 + 1) * E.cols) pushNeighbour(k - E.cols, x);
      if (k < ry1 * E.cols) pushNeighbour(k + E.cols, x);
    }
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

// Recompute a lighting region while changing only its exact inner rectangle.
// The surrounding solve margin supplies every source that can reach the kept
// pixels; restoring that margin leaves unrelated cached light untouched.
void Renderer::computeLightingBothPatch(int sx0, int sy0, int sx1, int sy1,
                                        int keepX0, int keepY0, int keepX1, int keepY1) {
  sx0 = imax(0, sx0); sy0 = imax(0, sy0);
  sx1 = imin(E.cols - 1, sx1); sy1 = imin(E.rows - 1, sy1);
  keepX0 = imax(sx0, keepX0); keepY0 = imax(sy0, keepY0);
  keepX1 = imin(sx1, keepX1); keepY1 = imin(sy1, keepY1);
  if (sx0 > sx1 || sy0 > sy1 || keepX0 > keepX1 || keepY0 > keepY1) return;

  int width = sx1 - sx0 + 1, height = sy1 - sy0 + 1;
  size_t plane = (size_t)width * height;
  lightPatchScratch.resize(plane * 4);
  auto snapshot = [&](const std::vector<uint8_t>& src, size_t planeIndex) {
    uint8_t* out = lightPatchScratch.data() + planeIndex * plane;
    for (int y = sy0; y <= sy1; y++) {
      size_t srcOff = (size_t)y * E.cols + sx0;
      size_t dstOff = (size_t)(y - sy0) * width;
      std::copy(src.begin() + srcOff, src.begin() + srcOff + width, out + dstOff);
    }
  };
  snapshot(E.fg.light, 0);
  snapshot(E.fg.lightBase, 1);
  snapshot(E.bg.light, 2);
  snapshot(E.bg.lightBase, 3);

  computeLightingBoth(sx0, sy0, sx1, sy1);

  auto restoreRect = [&](std::vector<uint8_t>& dst, size_t planeIndex,
                         int rx0, int ry0, int rx1, int ry1) {
    if (rx0 > rx1 || ry0 > ry1) return;
    const uint8_t* saved = lightPatchScratch.data() + planeIndex * plane;
    for (int y = ry0; y <= ry1; y++) {
      size_t dstOff = (size_t)y * E.cols + rx0;
      size_t srcOff = (size_t)(y - sy0) * width + (rx0 - sx0);
      std::copy(saved + srcOff, saved + srcOff + (rx1 - rx0 + 1), dst.begin() + dstOff);
    }
  };
  auto restoreMargins = [&](std::vector<uint8_t>& dst, size_t planeIndex) {
    restoreRect(dst, planeIndex, sx0, sy0, sx1, keepY0 - 1);
    restoreRect(dst, planeIndex, sx0, keepY1 + 1, sx1, sy1);
    restoreRect(dst, planeIndex, sx0, keepY0, keepX0 - 1, keepY1);
    restoreRect(dst, planeIndex, keepX1 + 1, keepY0, sx1, keepY1);
  };
  restoreMargins(E.fg.light, 0);
  restoreMargins(E.fg.lightBase, 1);
  restoreMargins(E.bg.light, 2);
  restoreMargins(E.bg.lightBase, 3);
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
    int alpha = (int)std::lround((1.0f - MAT_TRANSPARENCY[m]) * 255.0f);
    if (alpha < 0) alpha = 0; else if (alpha > 255) alpha = 255;
    renderAlphaMask[m] = (uint32_t)alpha << 24;
    uint32_t base = (MAT_COLOR[m] & 0x00ffffffu) | renderAlphaMask[m];
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
bool Renderer::fillRenderSpan(uint8_t* g, uint32_t* p, int x0, int y0, int x1, int y1) {
  // Index the noise/sparkle by absolute world coords so the grain is locked to the
  // terrain, not the buffer. worldOffset is 0 for bounded worlds (no-op there);
  // for infinite worlds it advances per shift. `& 63`/`& 7` stay in range for
  // negative offsets too (two's-complement low bits == value mod 64/8).
  int woX = E.L->worldOffsetX, woY = E.L->worldOffsetY;
  // Skip the per-cell mineDamage load + crack-shading branch entirely unless this
  // layer actually has live mining damage (almost never). mineDamage is a matching
  // E.cols*E.rows array, so eliding the load also removes a cache stream from the hot
  // fill. The damaged uint32_t* is only dereferenced on the rare path.
  const uint32_t* dmg = E.L->mineDamageAny ? E.L->mineDamage.data() : nullptr;
  const uint8_t* light = RENDER_LIGHTING_ENABLED ? E.L->light.data() : nullptr;
  const int frame = (int)(renderFrameSalt & 0x7fffffffu);
  bool hasAnimated = false;
  auto shimmerPhase = [&](uint8_t animKind) {
    // The 12 Hz presentation clock stays shared; each texture chooses how many
    // frames it holds a shimmer step. Nothing is translated through world space.
    if (animKind == RA_STEAM || animKind == RA_ACID) return frame / 2;
    if (animKind == RA_SMOKE) return frame / 3;
    if (animKind == RA_METHANE) return frame / 5;
    if (animKind == RA_WATER) return frame / 4;
    if (animKind == RA_OIL) return frame / 6;
    if (animKind == RA_LAVA) return frame / 8;
    return frame; // fire
  };
  auto shimmerAt = [&](int wx, int wy, int phase) {
    // A fixed per-cell phase offset makes brightness pulse in place instead of
    // making the noise field crawl diagonally. Triangle wave: 0..7..0.
    int t = (phase + (int)((renderCellHash(wx, wy) >> 8) & 15u)) & 15;
    return (uint8_t)(t < 8 ? t : 15 - t);
  };
  for (int y = y0; y <= y1; y++) {
    int rowBase = y * E.cols;
    int wy = woY + y;
    int authoredAmbient = E.planetId == PL_FRONTIER ? E.content.ambientAt(wy) : 0;
    const uint8_t* noiseRow = &renderNoise[(wy & 63) << 6];
    int wx = woX + x0;
    for (int x = x0; x <= x1; x++, wx++) {
      int k = rowBase + x;
      uint8_t m = g[k];
      // EMPTY is the dominant cell in open sky / caves — skip noise/light work.
      if (m == EMPTY) { p[k] = 0; continue; }
      uint8_t animKind = MAT_RENDER_ANIM[m];
      hasAnimated = hasAnimated || animKind != RA_NONE;
      uint8_t shade = noiseRow[wx & 63];
      uint8_t shimmer = animKind == RA_NONE ? 0 : shimmerAt(wx, wy, shimmerPhase(animKind));
      if (animKind == RA_WATER) shade = (uint8_t)(((int)shade * 2 + shimmer) / 3);
      else if (animKind == RA_OIL) shade = (uint8_t)(((int)shade * 3 + shimmer) / 4);
      else if (animKind == RA_ACID) shade = (uint8_t)(((int)shade + shimmer) / 2);
      uint32_t c = renderVariants[((int)m << 3) + shade];
      if (E.planetId == PL_FRONTIER && E.content.hasTexture[m])
        c = E.content.textures[m][((wy & 7) << 3) | (wx & 7)];
      uint32_t alphaMask = renderAlphaMask[m];
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
      if (animKind == RA_FIRE) {
        if (shimmer >= 5) c = PACKED_FIRE_HOT;
      } else if (animKind == RA_STEAM || animKind == RA_SMOKE) {
        c = jitterShade(c, ((int)shimmer - 3) * 2);
      } else if (animKind == RA_METHANE) {
        // Pulse opacity rather than only RGB: at methane's low base opacity, small
        // brightness shifts are hard to see. The 48..104 alpha range stays visibly
        // present and translucent at every phase, without recreating air holes.
        alphaMask = (uint32_t)(48 + shimmer * 8) << 24;
        c = jitterShade(c, ((int)shimmer - 3) * 3);
      } else if (animKind == RA_WATER) {
        if (shade >= 6) c = jitterShade(c, 4);
      } else if (animKind == RA_OIL) {
        if (shade >= 6) c = jitterShade(c, 3);
      } else if (animKind == RA_ACID) {
        if (shade == 7) c = jitterShade(c, 11);
      } else if (animKind == RA_LAVA) {
        // Keep the molten patches fixed in world space and pulse their brightness.
        // The material itself can still flow.
        int nx = wx & 63, ny = wy & 63;
        int molten = (int)renderNoise[(ny << 6) + nx] * 2
                   + (int)renderNoise[(ny << 6) + ((nx - 1) & 63)]
                   + (int)renderNoise[(ny << 6) + ((nx + 1) & 63)]
                   + (int)renderNoise[(((ny - 1) & 63) << 6) + nx]
                   + (int)renderNoise[(((ny + 1) & 63) << 6) + nx];
        if (molten >= 31) c = shimmer >= 2 ? PACKED_LAVA_HOT : PACKED_LAVA_WARM;
        else if (molten >= 25) c = shimmer == 7 ? PACKED_LAVA_HOT : PACKED_LAVA_WARM;
      } else {
        uint8_t detail = MAT_RENDER_DETAIL_PROFILE[m];
        uint8_t pattern = RENDER_DETAIL_PATTERN[detail];
        bool highlighted = pattern == RDPAT_ALWAYS;
        if (pattern == RDPAT_HASH_MASK)
          highlighted = (renderCellHash(wx, wy) & RENDER_DETAIL_MASK[detail])
            == RENDER_DETAIL_MATCH[detail];
        else if (pattern == RDPAT_MYCELIUM_NODULE)
          highlighted = myceliumNoduleAt(wx, wy);
        if (highlighted) c = RENDER_DETAIL_COLOR[detail];
      }
      if (light) c = applyLight(c, (uint8_t)imax(authoredAmbient, renderLightForCell(light, k, x, y, m)));
      c = (c & 0x00ffffffu) | alphaMask;
      p[k] = c;
    }
  }
  return hasAnimated;
}

// Render the ACTIVE layer (L) into its own renderPixels.
void Renderer::renderFull() {
  if (RENDER_LIGHTING_ENABLED) {
    Layer* crossLay = (E.L == &E.bg) ? &E.fg : ((E.L == &E.fg && E.bgEnabled) ? &E.bg : nullptr);
    computeLighting(E.L, crossLay);
  }
  uint8_t* g = E.L->grid;
  uint32_t* p = (uint32_t*)E.L->renderPixels.data();
  renderFrameSalt++;
  fillRenderSpan(g, p, 0, 0, E.cols - 1, E.rows - 1);
}

// Refill only the active layer's coalesced dirty rects. Rects are [x0,y0,x1,y1)
// exclusive; convert to inclusive for the fill.
void Renderer::renderDirtyRects() {
  if (RENDER_LIGHTING_ENABLED) { renderFull(); return; }
  uint8_t* g = E.L->grid; uint32_t* p = (uint32_t*)E.L->renderPixels.data();
  for (size_t i = 0; i + 3 < E.L->dirtyRects.size(); i += 4)
    fillRenderSpan(g, p, E.L->dirtyRects[i], E.L->dirtyRects[i + 1], E.L->dirtyRects[i + 2] - 1, E.L->dirtyRects[i + 3] - 1);
}
