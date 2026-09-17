#pragma once
#include "creature_animation.hpp"

struct Engine;
struct ContentRect { int layer, surface, left, top, right, bottom, material; };
struct ContentPlacement {
  int x, y, left, right, ground, search, blend, preferHigh;
  int dx = 0, dy = 0;
  std::vector<std::array<int, 2>> terrain{};
};
struct ContentQuest {
  int type, prerequisiteCount, x, y, surface, giver;
  int left, top, right, bottom, areaSurface, radius;
  int rewardKind, rewardId, rewardCount;
  int material, count, species;
  std::vector<int> prerequisites;
};
struct ContentGear { int id, family, slot, power, defense, stamina, mana, cooldown, reach, spell, style, price; int spellSlots = 0, upgradeSlots = 0, initialSpell = 0; std::vector<StatusApplication> statusEffects{}; int cleanseTags = 0; std::array<uint32_t,256> icon{}; };
struct ContentResident { int id, species, x, y, surface, roamRadius; };
struct ContentPlayerPart {
  int width = 0, height = 0, pivotX = 0, pivotY = 0;
  std::vector<uint32_t> pixels;
};
struct ContentPlayerPlacement { int part, x, y, angle, shade; };
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
  std::array<std::array<uint32_t, 32 * 32>, 256> textures{};
  // Dark, dominant, accent and highlight colors for procedural liquid and gas shading.
  std::array<std::array<uint32_t, 4>, 256> fluidColors{};
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
  bool playerLayers = false;
  std::array<int, 10> playerPartSlots{};
  std::array<std::array<ContentPlayerPart, 10>, 7> playerParts{};
  std::vector<std::vector<ContentPlayerPlacement>> playerPoses;
  std::array<ContentCreatureArt, CS_COUNT> creatureArt;
  std::vector<ContentChest> chests;
  std::map<int, ContentGear> equipment;
  const ContentGear* gear(int id) const { auto it = equipment.find(id); return it == equipment.end() ? nullptr : &it->second; }
  bool load(const int32_t* data, int length);
  int surfaceOffset(int surface);
  int horizontalOffset(int surface);
  int stitchedSurface(int worldX, int natural);
  void ensurePlacements();
  bool overlapsWorld(int left, int top, int right, int bottom);
  int ambientAt(int worldY) const;
  void stamp(int colStart, int colEnd, int rowStart, int rowEnd);
  const uint8_t* spriteRow(int state, int frame, int row) const;
 private:
  Engine& E;
  std::vector<ContentRect> reservations;
  std::vector<ContentPlacement> placements;
  uint32_t placementSeed = 0;
  bool placementsReady = false;
};
