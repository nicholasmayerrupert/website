#pragma once

struct Engine;
struct ContentRect { int layer, surface, left, top, right, bottom, material; };
struct ContentQuest {
  int type, prerequisiteCount, x, y, surface, giver;
  int left, top, right, bottom, areaSurface, radius;
  int rewardKind, rewardId, rewardCount;
  int material, count, species;
  std::vector<int> prerequisites;
};
struct ContentGear { int id, family, slot, power, defense, stamina, mana, cooldown, reach, spell, style, price; };
struct ContentResident { int id, species, x, y, surface, roamRadius; };
struct ContentClip {
  int count = 1, ticks = 8, offset = 0, duration = 8;
  std::vector<int> durations{8};
  int frameAt(int tick) const {
    int phase = imax(0, tick) % duration;
    for (int i = 0; i < count; i++) {
      if (phase < durations[(size_t)i]) return i;
      phase -= durations[(size_t)i];
    }
    return count - 1;
  }
};
enum CreatureClip { CC_IDLE, CC_MOVE, CC_WINDUP, CC_ATTACK, CC_RECOVER, CC_HURT, CC_DEATH, CC_SPECIAL, CC_COUNT };
struct ContentCreatureArt {
  int width = 0, height = 0;
  double scale = 1;
  std::array<ContentClip, CC_COUNT> clips;
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
  std::array<ContentClip, AS_COUNT> clips{};
  std::array<int, 4> limbColors{};
  std::vector<ContentRect> rectangles;
  std::vector<ContentQuest> quests;
  std::vector<ContentResident> residents;
  std::vector<std::array<float, 4>> palette;
  std::vector<uint8_t> pixels;
  std::array<ContentCreatureArt, CS_COUNT> creatureArt;
  std::vector<ContentChest> chests;
  std::map<int, ContentGear> equipment;
  const ContentGear* gear(int id) const { auto it = equipment.find(id); return it == equipment.end() ? nullptr : &it->second; }
  bool load(const int32_t* data, int length);
  int surfaceOffset(int surface);
  int ambientAt(int worldY) const;
  void stamp(int colStart, int colEnd, int rowStart, int rowEnd);
  const uint8_t* spriteRow(int state, int frame, int row) const;
 private:
  Engine& E;
};
