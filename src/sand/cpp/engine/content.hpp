#pragma once

struct Engine;
struct ContentRect { int layer, surface, left, top, right, bottom, material; };
struct ContentQuest {
  int type, prerequisites, x, y, surface;
  int left, top, right, bottom, areaSurface, radius;
  int rewardKind, rewardId, rewardCount;
  int material, count, species;
};
struct ContentResident { int species, x, y, surface, roamRadius; };
struct ContentClip { int count = 1, ticks = 8, offset = 0; };
struct ContentCreatureArt {
  int width = 0, height = 0;
  double scale = 1;
  std::vector<std::array<float, 4>> palette;
  std::vector<uint8_t> pixels;
};

// Immutable authored definitions belong to an engine instance. Mutable quest,
// actor, and terrain state remains with the subsystem that simulates it.
class ContentSystem {
 public:
  explicit ContentSystem(Engine& engine) : E(engine) {}
  uint32_t fingerprint = 0;
  int spriteWidth = 0, spriteHeight = 0;
  double pixelScale = .5;
  float backgroundTint = .55f;
  std::array<bool, 256> hasTexture{};
  std::array<std::array<uint32_t, 64>, 256> textures{};
  std::array<int, 4> repairBounds{};
  std::array<int, 2> spawn{};
  std::array<int, 4> ambient{};
  std::array<ContentClip, 7> clips{};
  std::array<int, 4> limbColors{};
  std::vector<ContentRect> rectangles;
  std::vector<ContentQuest> quests;
  std::vector<ContentResident> residents;
  std::vector<std::array<float, 4>> palette;
  std::vector<uint8_t> pixels;
  std::array<ContentCreatureArt, CS_COUNT> creatureArt;
  bool load(const int32_t* data, int length);
  int surfaceOffset(int surface);
  int ambientAt(int worldY) const;
  void stamp(int colStart, int colEnd, int rowStart, int rowEnd);
  const uint8_t* spriteRow(int state, int frame, int row) const;
 private:
  Engine& E;
};
