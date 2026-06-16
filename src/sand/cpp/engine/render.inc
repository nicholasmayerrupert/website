// Material -> RGBA pixel generation (the engine's render hot path).
//
// Writes one RGBA pixel per cell into renderPixels (little-endian uint32, so the
// bytes land as R,G,B,A for an ImageData). Each material gets a fixed set of 8
// brightness-shifted shades; a stable 64x64 noise tile picks one per cell by
// position, so the grain is steady across frames and identical on the full and
// per-rect paths. Steam shimmers (random skip), fire flickers, lava sparkles.
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

// Fill renderPixels for an INCLUSIVE cell rect [x0,x1] x [y0,y1].
inline void fillRenderSpan(int x0, int y0, int x1, int y1) {
  uint32_t* p = (uint32_t*)renderPixels.data();
  for (int y = y0; y <= y1; y++) {
    int rowBase = y * cols;
    int noiseRow = (y & 63) << 6;
    for (int x = x0; x <= x1; x++) {
      int k = rowBase + x;
      uint8_t m = grid[k];
      uint32_t c = renderVariants[((int)m << 3) + renderNoise[noiseRow + (x & 63)]];
      if (m == STEAM) { if (renderRand() <= 0.18) c = 0; }
      else if (m == FIRE) { if (renderRand() < 0.35) c = PACKED_FIRE_HOT; }
      else if (m == LAVA) { if (((x * 17 + y * 31) & 7) == 0) c = PACKED_LAVA_HOT; }
      p[k] = c;
    }
  }
}

void renderFull() { fillRenderSpan(0, 0, cols - 1, rows - 1); }

// Refill only the coalesced dirty rects (built by buildDirtyRects). Rects are
// [x0,y0,x1,y1) exclusive; convert to inclusive for the fill.
void renderDirtyRects() {
  for (size_t i = 0; i + 3 < dirtyRects.size(); i += 4)
    fillRenderSpan(dirtyRects[i], dirtyRects[i + 1], dirtyRects[i + 2] - 1, dirtyRects[i + 3] - 1);
}
