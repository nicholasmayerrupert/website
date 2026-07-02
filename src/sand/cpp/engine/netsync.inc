// World replication for multiplayer (Phase 6, extended to two layers). The host
// serializes BOTH grids (foreground then background) and the client applies them
// so both peers see the same two-layer world:
//   - full snapshot: RLE over fg then bg (sent once on join / on resync).
//   - diff: the dirty-rect cells of fg then bg (sent at a low rate).
// A FNV grid hash over both layers lets the client detect divergence (a lost
// diff) and request a resync. The wire format is opaque to JS/protocol, so this
// widening needs no changes there as long as host + client compute it the same.

// RLE-encode one grid into netBlob: repeated [u32 run][u8 value].
void rleEncode(uint8_t* g) {
  size_t n = (size_t)cols * rows, i = 0;
  while (i < n) {
    uint8_t v = g[i];
    size_t j = i + 1;
    while (j < n && g[j] == v) j++;
    uint32_t run = (uint32_t)(j - i);
    netBlob.push_back(run & 0xff); netBlob.push_back((run >> 8) & 0xff);
    netBlob.push_back((run >> 16) & 0xff); netBlob.push_back((run >> 24) & 0xff);
    netBlob.push_back(v);
    i = j;
  }
}
int serializeWorld() {
  netBlob.clear();
  rleEncode(fg.grid);
  rleEncode(bg.grid);
  return (int)netBlob.size();
}
// Decode one grid's worth of RLE (cols*rows cells) starting at buf[p]; returns
// the new p (start of the next grid's stream).
int rleDecode(const uint8_t* buf, int len, int p, uint8_t* g) {
  size_t idx = 0, n = (size_t)cols * rows;
  while (p + 5 <= len && idx < n) {
    uint32_t run = (uint32_t)buf[p] | ((uint32_t)buf[p + 1] << 8) | ((uint32_t)buf[p + 2] << 16) | ((uint32_t)buf[p + 3] << 24);
    uint8_t v = buf[p + 4]; p += 5;
    for (uint32_t k = 0; k < run && idx < n; k++) g[idx++] = v;
  }
  return p;
}
void applyWorld(const uint8_t* buf, int len) {
  int p = rleDecode(buf, len, 0, fg.grid);
  rleDecode(buf, len, p, bg.grid);
  fg.skyWorldReachY.clear(); fg.skyValid = false; fg.skyDirty = true;
  bg.skyWorldReachY.clear(); bg.skyValid = false; bg.skyDirty = true;
  useLayer(&fg); registerSeededComponents(0, cols); markAllDirty();
  useLayer(&bg); registerSeededComponents(0, cols); markAllDirty();
  useLayer(&fg);
}

// Diff per layer: [u16 rectCount] then per rect [u16 x0,y0,x1,y1][raw cells,
// row-major]. x1/y1 EXCLUSIVE. fg section then bg section, concatenated.
void writeDiffLayer(Layer* lay) {
  useLayer(lay); buildDirtyRects();
  int rc = (int)(lay->dirtyRects.size() / 4);
  netBlob.push_back(rc & 0xff); netBlob.push_back((rc >> 8) & 0xff);
  for (int r = 0; r < rc; r++) {
    int x0 = lay->dirtyRects[r * 4], y0 = lay->dirtyRects[r * 4 + 1], x1 = lay->dirtyRects[r * 4 + 2], y1 = lay->dirtyRects[r * 4 + 3];
    auto pw = [&](int v) { netBlob.push_back(v & 0xff); netBlob.push_back((v >> 8) & 0xff); };
    pw(x0); pw(y0); pw(x1); pw(y1);
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) netBlob.push_back(lay->grid[y * cols + x]);
  }
}
int serializeDiff() {
  netBlob.clear();
  writeDiffLayer(&fg);
  writeDiffLayer(&bg);
  return (int)netBlob.size();
}
int readDiffLayer(const uint8_t* buf, int len, int p, Layer* lay) {
  if (p + 2 > len) return p;
  int rc = (int)buf[p] | ((int)buf[p + 1] << 8); p += 2;
  useLayer(lay);
  for (int r = 0; r < rc; r++) {
    if (p + 8 > len) break;
    auto rd = [&]() { int v = (int)buf[p] | ((int)buf[p + 1] << 8); p += 2; return v; };
    int x0 = rd(), y0 = rd(), x1 = rd(), y1 = rd();
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) { if (p >= len) return p; if (x >= 0 && x < cols && y >= 0 && y < rows) lay->grid[y * cols + x] = buf[p]; p++; }
    if (x1 > x0 && y1 > y0) markDirtyRect(x0, y0, x1 - 1, y1 - 1);
  }
  return p;
}
void applyDiff(const uint8_t* buf, int len) {
  if (len < 2) return;
  int p = readDiffLayer(buf, len, 0, &fg);
  readDiffLayer(buf, len, p, &bg);
  fg.skyDirty = true; bg.skyDirty = true;
  useLayer(&fg); registerSeededComponents(0, cols);
  useLayer(&bg); registerSeededComponents(0, cols);
  useLayer(&fg);
}

// FNV-1a over BOTH grids (divergence / resync check). Host + client fold the two
// layers in the same order, so the single u32 still detects any divergence.
uint32_t gridHashFNV() {
  uint32_t h = 0x811c9dc5u; size_t n = (size_t)cols * rows;
  for (size_t i = 0; i < n; i++) { h ^= fg.grid[i]; h *= 0x01000193u; }
  for (size_t i = 0; i < n; i++) { h ^= bg.grid[i]; h *= 0x01000193u; }
  return h;
}
