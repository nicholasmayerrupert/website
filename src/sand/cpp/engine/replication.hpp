#pragma once
// Binary authority-to-presentation replication for both layers: RLE full
// snapshots, dirty diffs, and an FNV divergence hash. JavaScript treats the
// payload as opaque bytes.

struct Engine;

class ReplicationSystem {
 public:
  explicit ReplicationSystem(Engine& e) : E(e) {}

  std::vector<uint8_t> blob; // snapshot / diff serialization scratch (ABI reads it)
  std::vector<size_t> diffRectOffsets;

  int serializeWorld();
  int serializeDiff();
  bool applyWorldMirror(const uint8_t* buf, int len);
  bool applyDiffMirror(const uint8_t* buf, int len, int lightEditX0, int lightEditX1);
  uint32_t gridHashFNV();

 private:
  Engine& E;

  // Little-endian blob helpers (blob is the shared output buffer).
  void blobPush16(int v) { blob.push_back(v & 0xff); blob.push_back((v >> 8) & 0xff); }
  void blobPush32(uint32_t v) { blobPush16(v & 0xffff); blobPush16((v >> 16) & 0xffff); }
  static int readLE16(const uint8_t* buf, int p) { return (int)buf[p] | ((int)buf[p + 1] << 8); }

  void rleEncode(const uint8_t* g);
  int rleDecode(const uint8_t* buf, int len, int p, uint8_t* g);
  int rleValidate(const uint8_t* buf, int len, int p) const;
  bool decodeWorldGrids(const uint8_t* buf, int len);
  // Layer is Engine-nested (incomplete here), so the per-layer halves take a
  // background flag and resolve E.fg/E.bg in the impl.
  void writeDiffLayer(bool background);
  int readDiffLayer(const uint8_t* buf, int len, int p, bool background,
                    int lightEditX0 = 1, int lightEditX1 = 0);
  int validateDiffLayer(const uint8_t* buf, int len, int p) const;
  bool applyDiffGrids(const uint8_t* buf, int len,
                      int lightEditX0, int lightEditX1);
};
