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
      p[k] = c;
    }
  }
}

// Render the ACTIVE layer (L) into its own renderPixels.
void renderFull() { fillRenderSpan(L->grid, (uint32_t*)L->renderPixels.data(), 0, 0, cols - 1, rows - 1); }

// Refill only the active layer's coalesced dirty rects. Rects are [x0,y0,x1,y1)
// exclusive; convert to inclusive for the fill.
void renderDirtyRects() {
  uint8_t* g = L->grid; uint32_t* p = (uint32_t*)L->renderPixels.data();
  for (size_t i = 0; i + 3 < L->dirtyRects.size(); i += 4)
    fillRenderSpan(g, p, L->dirtyRects[i], L->dirtyRects[i + 1], L->dirtyRects[i + 2] - 1, L->dirtyRects[i + 3] - 1);
}
