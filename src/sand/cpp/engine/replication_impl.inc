// RLE planes: foreground/background u8 materials, then foreground/background
// u16 source texels. Each run is [u32 length][value].
template<class T> void ReplicationSystem::rleEncode(const T* g) {
  size_t n = (size_t)E.cols * E.rows, i = 0;
  while (i < n) {
    T v = g[i];
    size_t j = i + 1;
    while (j < n && g[j] == v) j++;
    blobPush32((uint32_t)(j - i));
    blob.push_back(v & 0xff);
    if constexpr (sizeof(T) == 2) blob.push_back(v >> 8);
    i = j;
  }
}
int ReplicationSystem::serializeWorld() {
  blob.clear();
  rleEncode(E.fg.grid);
  rleEncode(E.bg.grid);
  rleEncode(E.fg.textureTexels.data());
  rleEncode(E.bg.textureTexels.data());
  return (int)blob.size();
}
// Decode one grid's worth of RLE (cols*rows cells) starting at buf[p]; returns
// the new p (start of the next grid's stream).
template<class T> int ReplicationSystem::rleDecode(const uint8_t* buf, int len, int p, T* g) {
  size_t idx = 0, n = (size_t)E.cols * E.rows;
  while (p + 4 + (int)sizeof(T) <= len && idx < n) {
    uint32_t run = (uint32_t)buf[p] | ((uint32_t)buf[p + 1] << 8) | ((uint32_t)buf[p + 2] << 16) | ((uint32_t)buf[p + 3] << 24);
    T v = buf[p + 4];
    if constexpr (sizeof(T) == 2) v |= (T)buf[p + 5] << 8;
    p += 4 + sizeof(T);
    for (uint32_t k = 0; k < run && idx < n; k++) g[idx++] = v;
  }
  return p;
}
int ReplicationSystem::rleValidate(const uint8_t* buf, int len, int p, bool textures) const {
  size_t idx = 0, n = (size_t)E.cols * E.rows;
  while (idx < n) {
    if (p < 0 || p + (textures ? 6 : 5) > len) return -1;
    uint32_t run = (uint32_t)buf[p]
      | ((uint32_t)buf[p + 1] << 8)
      | ((uint32_t)buf[p + 2] << 16)
      | ((uint32_t)buf[p + 3] << 24);
    int value = textures ? readLE16(buf, p + 4) : buf[p + 4];
    if (run == 0 || run > n - idx || (textures ? (value >= 1024 && value != WORLD_TEXTURE) : !isMaterialId(value))) return -1;
    idx += run;
    p += textures ? 6 : 5;
  }
  return p;
}
bool ReplicationSystem::decodeWorldGrids(const uint8_t* buf, int len) {
  if (!buf || len <= 0) return false;
  int fgEnd = rleValidate(buf, len, 0);
  int bgEnd = fgEnd >= 0 ? rleValidate(buf, len, fgEnd) : -1;
  int fgTexturesEnd = bgEnd >= 0 ? rleValidate(buf, len, bgEnd, true) : -1;
  int bgTexturesEnd = fgTexturesEnd >= 0 ? rleValidate(buf, len, fgTexturesEnd, true) : -1;
  if (bgTexturesEnd != len) return false;
  int p = rleDecode(buf, len, 0, E.fg.grid);
  p = rleDecode(buf, len, p, E.bg.grid);
  p = rleDecode(buf, len, p, E.fg.textureTexels.data());
  rleDecode(buf, len, p, E.bg.textureTexels.data());
  return true;
}
// Presentation mirrors do not simulate their cellular world, so rebuilding all
// component topology after every packet is wasted main-thread work. Keep only
// the render/lighting dirty state required by WebGL and actor collision reads.
bool ReplicationSystem::applyWorldMirror(const uint8_t* buf, int len) {
  if (!decodeWorldGrids(buf, len)) return false;
  // Preserve absolute-world skylight reach across worker streaming snapshots.
  // A deep buffer's top edge is underground and cannot rediscover that an
  // off-screen vertical shaft reaches the surface. computeDirectSky remaps the
  // previous skyDown/reach cache from skyOffset* into the new world offset.
  // Fresh/resized mirror engines already begin with skyValid=false and no cache.
  E.fg.skyDirty = true;
  E.bg.skyDirty = true;
  { Engine::ActiveLayerScope active(E, &E.fg); E.markAllDirty(); }
  { Engine::ActiveLayerScope active(E, &E.bg); E.markAllDirty(); }
  E.bgEnabled = true;
  return true;
}

// Diff per layer: [u16 rectCount] then per rect [u16 x0,y0,x1,y1][raw cells,
// row-major][u16 source texels, row-major]. x1/y1 EXCLUSIVE. fg section then bg section, concatenated.
void ReplicationSystem::writeDiffLayer(bool background) {
  Layer* lay = background ? &E.bg : &E.fg;
  Engine::ActiveLayerScope active(E, lay);
  E.buildDirtyRects();
  int rc = (int)(lay->dirtyRects.size() / 4);
  size_t section = blob.size(), cursor = section + 2;
  diffRectOffsets.resize(rc);
  for (int r = 0; r < rc; r++) {
    int x0 = lay->dirtyRects[r * 4], y0 = lay->dirtyRects[r * 4 + 1], x1 = lay->dirtyRects[r * 4 + 2], y1 = lay->dirtyRects[r * 4 + 3];
    diffRectOffsets[r] = cursor;
    cursor += 8 + 3 * (size_t)(x1 - x0) * (y1 - y0);
  }
  blob.resize(cursor);
  auto put16 = [&](size_t p, int v) { blob[p] = v & 0xff; blob[p + 1] = (v >> 8) & 0xff; };
  put16(section, rc);
  auto writeRect = [&](int r) {
    int x0 = lay->dirtyRects[r * 4], y0 = lay->dirtyRects[r * 4 + 1], x1 = lay->dirtyRects[r * 4 + 2], y1 = lay->dirtyRects[r * 4 + 3];
    size_t p = diffRectOffsets[r];
    put16(p, x0); put16(p + 2, y0); put16(p + 4, x1); put16(p + 6, y1);
    size_t width = (size_t)(x1 - x0), out = p + 8;
    for (int y = y0; y < y1; y++) {
      std::memcpy(blob.data() + out, lay->grid + y * E.cols + x0, width);
      out += width;
    }
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
      put16(out, lay->textureTexels[y * E.cols + x]);
      out += 2;
    }
  };
  for (int r = 0; r < rc; r++) writeRect(r);
}
int ReplicationSystem::serializeDiff() {
  blob.clear();
  writeDiffLayer(false);
  writeDiffLayer(true);
  return (int)blob.size();
}
int ReplicationSystem::readDiffLayer(const uint8_t* buf, int len, int p, bool background,
                           int lightEditX0, int lightEditX1) {
  Layer* lay = background ? &E.bg : &E.fg;
  if (p + 2 > len) return p;
  int rc = readLE16(buf, p); p += 2;
  Engine::ActiveLayerScope active(E, lay);
  for (int r = 0; r < rc; r++) {
    if (p + 8 > len) break;
    int x0 = readLE16(buf, p), y0 = readLE16(buf, p + 2), x1 = readLE16(buf, p + 4), y1 = readLE16(buf, p + 6);
    p += 8;
    int width = x1 - x0;
    int area = width * (y1 - y0);
    int textureOffset = p + area;
    if (width < 0 || y1 < y0) return p;
    bool validRect = x0 >= 0 && x1 <= E.cols && y0 >= 0 && y1 <= E.rows;
    for (int y = y0; y < y1; y++) {
      if (p + width > len) return p;
      if (validRect) {
        if (E.storageRole == ESR_PRESENTATION) {
          const uint8_t* incoming = buf + p;
          const uint8_t* current = lay->grid + y * E.cols + x0;
          int runX0 = -1;
          for (int x = 0; x < width; x++) {
            uint8_t oldM = current[x], newM = incoming[x];
            bool immediateLightChange = oldM != newM &&
              ((isMaterialId(oldM) && MAT_CLASS[oldM] == MC_RIGID)
               || MAT_CLASS[newM] == MC_RIGID ||
               (x0 + x >= lightEditX0 && x0 + x <= lightEditX1));
            if (immediateLightChange && runX0 < 0) runX0 = x0 + x;
            if ((!immediateLightChange || x + 1 == width) && runX0 >= 0) {
              int runX1 = immediateLightChange && x + 1 == width ? x0 + x : x0 + x - 1;
              E.glp.glNoteTerrainLightChange(runX0, runX1);
              runX0 = -1;
            }
          }
        }
        std::memcpy(lay->grid + y * E.cols + x0, buf + p, (size_t)width);
        for (int x = x0; x < x1; x++) {
          lay->textureTexels[y * E.cols + x] = (uint16_t)readLE16(buf, textureOffset);
          textureOffset += 2;
        }
        lay->clearMotionSpan((size_t)y * E.cols + x0, (size_t)width);
      }
      p += width;
    }
    p += area * 2;
    if (x1 > x0 && y1 > y0) E.markDirtyRect(x0, y0, x1 - 1, y1 - 1);
  }
  return p;
}
int ReplicationSystem::validateDiffLayer(const uint8_t* buf, int len, int p) const {
  if (!buf || p < 0 || p + 2 > len) return -1;
  int rectCount = readLE16(buf, p);
  p += 2;
  for (int rect = 0; rect < rectCount; rect++) {
    if (p + 8 > len) return -1;
    int x0 = readLE16(buf, p), y0 = readLE16(buf, p + 2);
    int x1 = readLE16(buf, p + 4), y1 = readLE16(buf, p + 6);
    p += 8;
    if (x1 < x0 || y1 < y0 || x1 > E.cols || y1 > E.rows) return -1;
    size_t area = (size_t)(x1 - x0) * (size_t)(y1 - y0);
    if (area * 3 > (size_t)(len - p)) return -1;
    for (size_t i = 0; i < area; i++)
      if (!isMaterialId(buf[p + i])) return -1;
    for (size_t i = 0; i < area; i++) {
      int texel = readLE16(buf, p + (int)area + (int)i * 2);
      if (texel >= 1024 && texel != WORLD_TEXTURE) return -1;
    }
    p += (int)area * 3;
  }
  return p;
}
bool ReplicationSystem::applyDiffGrids(const uint8_t* buf, int len,
                             int lightEditX0, int lightEditX1) {
  int fgEnd = validateDiffLayer(buf, len, 0);
  int bgEnd = fgEnd >= 0 ? validateDiffLayer(buf, len, fgEnd) : -1;
  if (bgEnd != len) return false;
  int p = readDiffLayer(buf, len, 0, false, lightEditX0, lightEditX1);
  readDiffLayer(buf, len, p, true, lightEditX0, lightEditX1);
  return true;
}
bool ReplicationSystem::applyDiffMirror(const uint8_t* buf, int len, int lightEditX0, int lightEditX1) {
  if (!applyDiffGrids(buf, len, lightEditX0, lightEditX1)) return false;
  E.fg.skyDirty = true; E.bg.skyDirty = true;
  E.bgEnabled = true;
  return true;
}

// FNV-1a over BOTH grids (divergence / resync check). Authority and presentation
// fold the layers in the same order, so one u32 detects any divergence.
uint32_t ReplicationSystem::gridHashFNV() {
  uint32_t h = 0x811c9dc5u; size_t n = (size_t)E.cols * E.rows;
  for (size_t i = 0; i < n; i++) { h ^= E.fg.grid[i]; h *= 0x01000193u; }
  for (size_t i = 0; i < n; i++) { h ^= E.bg.grid[i]; h *= 0x01000193u; }
  return h;
}
