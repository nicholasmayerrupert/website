#pragma once
// World replication for multiplayer (extracted from the Engine in 5c). The
// host serializes BOTH grids (foreground then background) and the client
// applies them so both peers see the same two-layer world:
//   - full snapshot: RLE over fg then bg (sent once on join / on resync).
//   - diff: the dirty-rect cells of fg then bg (sent at a low rate).
// A FNV grid hash over both layers lets the client detect divergence (a lost
// diff) and request a resync. The wire format is opaque to JS/protocol.
//
// NetSync owns the serialization scratch (`blob`, exposed to the ABI) and the
// wire format; it reaches back into the Engine for the grids, dirty rects, and
// post-apply reconciliation. Method bodies live in netsync_impl.inc (they need
// the full Engine definition).

struct Engine;

class NetSync {
 public:
  explicit NetSync(Engine& e) : E(e) {}

  std::vector<uint8_t> blob; // snapshot / diff serialization scratch (ABI reads it)
  std::vector<size_t> diffRectOffsets;
#ifdef __EMSCRIPTEN_PTHREADS__
  struct RleRun { uint32_t count; uint8_t value; };
  struct DecodeRun { size_t offset; uint32_t count; uint8_t value; };
  std::vector<std::vector<RleRun>> rleRows;
  std::vector<DecodeRun> decodeRuns;
#endif

  int serializeWorld();
  int serializeDiff();
  void applyWorld(const uint8_t* buf, int len);
  void applyDiff(const uint8_t* buf, int len);
  void applyWorldMirror(const uint8_t* buf, int len);
  void applyDiffMirror(const uint8_t* buf, int len);
  uint32_t gridHashFNV();

 private:
  Engine& E;

  // Little-endian wire helpers (blob is the shared output buffer).
  void blobPush16(int v) { blob.push_back(v & 0xff); blob.push_back((v >> 8) & 0xff); }
  void blobPush32(uint32_t v) { blobPush16(v & 0xffff); blobPush16((v >> 16) & 0xffff); }
  static int readLE16(const uint8_t* buf, int p) { return (int)buf[p] | ((int)buf[p + 1] << 8); }

  void rleEncode(const uint8_t* g);
  int rleDecode(const uint8_t* buf, int len, int p, uint8_t* g);
  // Layer is Engine-nested (incomplete here), so the per-layer halves take a
  // background flag and resolve E.fg/E.bg in the impl.
  void writeDiffLayer(bool background);
  int readDiffLayer(const uint8_t* buf, int len, int p, bool background);
};
