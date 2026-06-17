// World replication for multiplayer (Phase 6). The host serializes its grid and
// the client applies it so both see the same sand world:
//   - full snapshot: RLE over the whole grid (sent once on join / on resync).
//   - diff: the raw cells inside the current dirty rects (sent at a low rate).
// A FNV grid hash lets the client detect divergence (a lost diff) and request a
// resync. Host and client must share the same buffer dimensions + world seed.

// RLE-encode the full grid into netBlob: repeated [u32 run][u8 value].
int serializeWorld() {
  netBlob.clear();
  size_t n = (size_t)cols * rows, i = 0;
  while (i < n) {
    uint8_t v = grid[i];
    size_t j = i + 1;
    while (j < n && grid[j] == v) j++;
    uint32_t run = (uint32_t)(j - i);
    netBlob.push_back(run & 0xff); netBlob.push_back((run >> 8) & 0xff);
    netBlob.push_back((run >> 16) & 0xff); netBlob.push_back((run >> 24) & 0xff);
    netBlob.push_back(v);
    i = j;
  }
  return (int)netBlob.size();
}
void applyWorld(const uint8_t* buf, int len) {
  size_t idx = 0, n = (size_t)cols * rows; int p = 0;
  while (p + 5 <= len && idx < n) {
    uint32_t run = (uint32_t)buf[p] | ((uint32_t)buf[p + 1] << 8) | ((uint32_t)buf[p + 2] << 16) | ((uint32_t)buf[p + 3] << 24);
    uint8_t v = buf[p + 4]; p += 5;
    for (uint32_t k = 0; k < run && idx < n; k++) grid[idx++] = v;
  }
  registerSeededComponents(0, cols); // rebuild stone/plant components so they don't flicker
  markAllDirty();
}

// Diff: [u16 rectCount] then per rect [u16 x0,y0,x1,y1][raw cells, row-major].
// x1/y1 are EXCLUSIVE (matching buildDirtyRects).
int serializeDiff() {
  buildDirtyRects();
  netBlob.clear();
  int rc = (int)(dirtyRects.size() / 4);
  netBlob.push_back(rc & 0xff); netBlob.push_back((rc >> 8) & 0xff);
  for (int r = 0; r < rc; r++) {
    int x0 = dirtyRects[r * 4], y0 = dirtyRects[r * 4 + 1], x1 = dirtyRects[r * 4 + 2], y1 = dirtyRects[r * 4 + 3];
    auto pw = [&](int v) { netBlob.push_back(v & 0xff); netBlob.push_back((v >> 8) & 0xff); };
    pw(x0); pw(y0); pw(x1); pw(y1);
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) netBlob.push_back(grid[y * cols + x]);
  }
  return (int)netBlob.size();
}
void applyDiff(const uint8_t* buf, int len) {
  if (len < 2) return;
  int rc = (int)buf[0] | ((int)buf[1] << 8), p = 2;
  for (int r = 0; r < rc; r++) {
    if (p + 8 > len) break;
    auto rd = [&]() { int v = (int)buf[p] | ((int)buf[p + 1] << 8); p += 2; return v; };
    int x0 = rd(), y0 = rd(), x1 = rd(), y1 = rd();
    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) { if (p >= len) return; if (x >= 0 && x < cols && y >= 0 && y < rows) grid[y * cols + x] = buf[p]; p++; }
    if (x1 > x0 && y1 > y0) markDirtyRect(x0, y0, x1 - 1, y1 - 1);
  }
  registerSeededComponents(0, cols);
}

// FNV-1a over the whole grid (divergence / resync check). Matches gridHashU8 in JS.
uint32_t gridHashFNV() {
  uint32_t h = 0x811c9dc5u; size_t n = (size_t)cols * rows;
  for (size_t i = 0; i < n; i++) { h ^= grid[i]; h *= 0x01000193u; }
  return h;
}
