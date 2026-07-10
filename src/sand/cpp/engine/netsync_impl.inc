// NetSync method bodies (need the full Engine definition; see netsync.hpp).

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
  E.fg.skyWorldReachY.clear(); E.fg.skyValid = false; E.fg.skyDirty = true;
  E.bg.skyWorldReachY.clear(); E.bg.skyValid = false; E.bg.skyDirty = true;
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
  blobPush16(rc);
  for (int r = 0; r < rc; r++) {
    int x0 = lay->dirtyRects[r * 4], y0 = lay->dirtyRects[r * 4 + 1], x1 = lay->dirtyRects[r * 4 + 2], y1 = lay->dirtyRects[r * 4 + 3];
    blobPush16(x0); blobPush16(y0); blobPush16(x1); blobPush16(y1);
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) blob.push_back(lay->grid[y * E.cols + x]);
  }
}
int NetSync::serializeDiff() {
  blob.clear();
  writeDiffLayer(false);
  writeDiffLayer(true);
  return (int)blob.size();
}
int NetSync::readDiffLayer(const uint8_t* buf, int len, int p, bool background) {
  Layer* lay = background ? &E.bg : &E.fg;
  if (p + 2 > len) return p;
  int rc = readLE16(buf, p); p += 2;
  E.useLayer(lay);
  for (int r = 0; r < rc; r++) {
    if (p + 8 > len) break;
    int x0 = readLE16(buf, p), y0 = readLE16(buf, p + 2), x1 = readLE16(buf, p + 4), y1 = readLE16(buf, p + 6);
    p += 8;
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) { if (p >= len) return p; if (x >= 0 && x < E.cols && y >= 0 && y < E.rows) lay->grid[y * E.cols + x] = buf[p]; p++; }
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

void NetSync::applyDiffMirror(const uint8_t* buf, int len) {
  if (len < 2) return;
  int p = readDiffLayer(buf, len, 0, false);
  readDiffLayer(buf, len, p, true);
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
