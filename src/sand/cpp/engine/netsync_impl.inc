// RLE-encode one grid into blob: repeated [u32 run][u8 value].
void NetSync::rleEncode(const uint8_t* g) {
  size_t n = (size_t)E.cols * E.rows, i = 0;
  while (i < n) {
    uint8_t v = g[i];
    size_t j = i + 1;
    while (j < n && g[j] == v) j++;
    blobPush32((uint32_t)(j - i));
    blob.push_back(v);
    i = j;
  }
}
int NetSync::serializeWorld() {
  blob.clear();
  rleEncode(E.fg.grid);
  rleEncode(E.bg.grid);
  return (int)blob.size();
}
// Decode one grid's worth of RLE (cols*rows cells) starting at buf[p]; returns
// the new p (start of the next grid's stream).
int NetSync::rleDecode(const uint8_t* buf, int len, int p, uint8_t* g) {
  size_t idx = 0, n = (size_t)E.cols * E.rows;
  while (p + 5 <= len && idx < n) {
    uint32_t run = (uint32_t)buf[p] | ((uint32_t)buf[p + 1] << 8) | ((uint32_t)buf[p + 2] << 16) | ((uint32_t)buf[p + 3] << 24);
    uint8_t v = buf[p + 4]; p += 5;
    for (uint32_t k = 0; k < run && idx < n; k++) g[idx++] = v;
  }
  return p;
}
void NetSync::applyWorld(const uint8_t* buf, int len) {
  int p = rleDecode(buf, len, 0, E.fg.grid);
  rleDecode(buf, len, p, E.bg.grid);
  if (E.fg.fallSpeed) {
    std::fill(E.fg.fallSpeedA.begin(), E.fg.fallSpeedA.end(), (uint8_t)0);
    std::fill(E.fg.fallSpeedB.begin(), E.fg.fallSpeedB.end(), (uint8_t)0);
    std::fill(E.bg.fallSpeedA.begin(), E.bg.fallSpeedA.end(), (uint8_t)0);
    std::fill(E.bg.fallSpeedB.begin(), E.bg.fallSpeedB.end(), (uint8_t)0);
    std::fill(E.fg.liquidVelA.begin(), E.fg.liquidVelA.end(), (uint32_t)0);
    std::fill(E.fg.liquidVelB.begin(), E.fg.liquidVelB.end(), (uint32_t)0);
    std::fill(E.bg.liquidVelA.begin(), E.bg.liquidVelA.end(), (uint32_t)0);
    std::fill(E.bg.liquidVelB.begin(), E.bg.liquidVelB.end(), (uint32_t)0);
  }
  // A full snapshot replaces grid[] without replacing the alternate buffers.
  // Force one ordinary carry before a prior cave-blast sparse proof can be reused.
  E.fg.blastSparseCarryReady = false;
  E.bg.blastSparseCarryReady = false;
  E.fg.skyWorldReachY.clear(); E.fg.skyValid = false; E.fg.skyDirty = true;
  E.bg.skyWorldReachY.clear(); E.bg.skyValid = false; E.bg.skyDirty = true;
  E.useLayer(&E.fg); E.registerSeededComponents(0, E.cols); E.markAllDirty();
  E.useLayer(&E.bg); E.registerSeededComponents(0, E.cols); E.markAllDirty();
  E.useLayer(&E.fg);
}

// Presentation mirrors do not simulate their cellular world, so rebuilding all
// component topology after every packet is wasted main-thread work. Keep only
// the render/lighting dirty state required by WebGL and actor collision reads.
void NetSync::applyWorldMirror(const uint8_t* buf, int len) {
  int p = rleDecode(buf, len, 0, E.fg.grid);
  rleDecode(buf, len, p, E.bg.grid);
  // Preserve absolute-world skylight reach across worker streaming snapshots.
  // A deep buffer's top edge is underground and cannot rediscover that an
  // off-screen vertical shaft reaches the surface. computeDirectSky remaps the
  // previous skyDown/reach cache from skyOffset* into the new world offset.
  // Fresh/resized mirror engines already begin with skyValid=false and no cache.
  E.fg.skyDirty = true;
  E.bg.skyDirty = true;
  E.useLayer(&E.fg); E.markAllDirty();
  E.useLayer(&E.bg); E.markAllDirty();
  E.bgEnabled = true;
  E.useLayer(&E.fg);
}

// Diff per layer: [u16 rectCount] then per rect [u16 x0,y0,x1,y1][raw cells,
// row-major]. x1/y1 EXCLUSIVE. fg section then bg section, concatenated.
void NetSync::writeDiffLayer(bool background) {
  Layer* lay = background ? &E.bg : &E.fg;
  E.useLayer(lay); E.buildDirtyRects();
  int rc = (int)(lay->dirtyRects.size() / 4);
  size_t section = blob.size(), cursor = section + 2;
  diffRectOffsets.resize(rc);
  for (int r = 0; r < rc; r++) {
    int x0 = lay->dirtyRects[r * 4], y0 = lay->dirtyRects[r * 4 + 1], x1 = lay->dirtyRects[r * 4 + 2], y1 = lay->dirtyRects[r * 4 + 3];
    diffRectOffsets[r] = cursor;
    cursor += 8 + (size_t)(x1 - x0) * (y1 - y0);
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
  };
  for (int r = 0; r < rc; r++) writeRect(r);
}
int NetSync::serializeDiff() {
  blob.clear();
  writeDiffLayer(false);
  writeDiffLayer(true);
  return (int)blob.size();
}
int NetSync::readDiffLayer(const uint8_t* buf, int len, int p, bool background,
                           int lightEditX0, int lightEditX1) {
  Layer* lay = background ? &E.bg : &E.fg;
  if (p + 2 > len) return p;
  int rc = readLE16(buf, p); p += 2;
  E.useLayer(lay);
  for (int r = 0; r < rc; r++) {
    if (p + 8 > len) break;
    int x0 = readLE16(buf, p), y0 = readLE16(buf, p + 2), x1 = readLE16(buf, p + 4), y1 = readLE16(buf, p + 6);
    p += 8;
    int width = x1 - x0;
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
              (MAT_CLASS[oldM] == MC_RIGID || MAT_CLASS[newM] == MC_RIGID ||
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
        if (lay->fallSpeed) std::memset(lay->fallSpeed + y * E.cols + x0, 0, (size_t)width);
        if (lay->liquidVel) {
          size_t offset = (size_t)y * E.cols + x0;
          size_t bytes = (size_t)width * sizeof(uint32_t);
          std::memset(lay->liquidVel + offset, 0, bytes);
          std::memset(lay->nextLiquidVel + offset, 0, bytes);
        }
      }
      p += width;
    }
    if (x1 > x0 && y1 > y0) E.markDirtyRect(x0, y0, x1 - 1, y1 - 1);
  }
  return p;
}
void NetSync::applyDiff(const uint8_t* buf, int len) {
  if (len < 2) return;
  int p = readDiffLayer(buf, len, 0, false);
  readDiffLayer(buf, len, p, true);
  E.fg.skyDirty = true; E.bg.skyDirty = true;
  E.useLayer(&E.fg); E.registerSeededComponents(0, E.cols);
  E.useLayer(&E.bg); E.registerSeededComponents(0, E.cols);
  E.useLayer(&E.fg);
}

void NetSync::applyDiffMirror(const uint8_t* buf, int len, int lightEditX0, int lightEditX1) {
  if (len < 2) return;
  int p = readDiffLayer(buf, len, 0, false, lightEditX0, lightEditX1);
  readDiffLayer(buf, len, p, true, lightEditX0, lightEditX1);
  E.fg.skyDirty = true; E.bg.skyDirty = true;
  E.bgEnabled = true;
  E.useLayer(&E.fg);
}

// FNV-1a over BOTH grids (divergence / resync check). Host + client fold the
// two layers in the same order, so the single u32 still detects any divergence.
uint32_t NetSync::gridHashFNV() {
  uint32_t h = 0x811c9dc5u; size_t n = (size_t)E.cols * E.rows;
  for (size_t i = 0; i < n; i++) { h ^= E.fg.grid[i]; h *= 0x01000193u; }
  for (size_t i = 0; i < n; i++) { h ^= E.bg.grid[i]; h *= 0x01000193u; }
  return h;
}
