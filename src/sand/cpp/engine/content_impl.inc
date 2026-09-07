namespace {
struct ContentReader {
  const int32_t* data;
  int length, at = 0;
  bool valid = true;
  int take() {
    if (at >= length) { valid = false; return 0; }
    return data[at++];
  }
  int bounded(int low, int high) {
    int value = take();
    if (value < low || value > high) valid = false;
    return value;
  }
  int coordinate() { return bounded(-100000, 100000); }
  int surface() {
    int value = take();
    if (value != INT_MIN && (value < -100000 || value > 100000)) valid = false;
    return value;
  }
  int material() {
    int value = take();
    if (!isMaterialId(value)) valid = false;
    return value;
  }
  ContentClip clip(int frames) {
    ContentClip value;
    value.count = bounded(1, 32); value.offset = bounded(0, frames - 1);
    if (!valid) return value;
    if (value.offset + value.count > frames) valid = false;
    value.durations.clear(); value.duration = 0;
    for (int i = 0; i < value.count; i++) {
      int ticks = bounded(1, 120);
      value.durations.push_back(ticks); value.duration += ticks;
    }
    value.ticks = value.durations.front();
    return value;
  }
  std::vector<std::array<float, 4>> colors(int count) {
    std::vector<std::array<float, 4>> result;
    for (int i = 0; i < count; i++) {
      uint32_t color = (uint32_t)take();
      if ((i == 0 && color != 0) || (i > 0 && (color >> 24) != 255)) valid = false;
      result.push_back({((color >> 16) & 255) / 255.f, ((color >> 8) & 255) / 255.f,
                        (color & 255) / 255.f, ((color >> 24) & 255) / 255.f});
    }
    return result;
  }
  std::vector<uint8_t> pixels(int count, int paletteSize) {
    std::vector<uint8_t> result;
    if (!valid || count < 0 || count > length - at) { valid = false; return result; }
    result.reserve((size_t)count);
    for (int i = 0; i < count; i++) result.push_back((uint8_t)bounded(0, paletteSize - 1));
    return result;
  }
};
}

bool ContentSystem::load(const int32_t* data, int length) {
  if (!data || length < 22 || length > 8000000) return false;
  ContentReader r{data, length};
  if (r.take() != 0x41535452 || r.take() != 3) return false;
  uint32_t nextFingerprint = (uint32_t)r.take();
  int rectangleCount = r.bounded(0, 20000), questCount = r.bounded(1, 128);
  int width = r.bounded(1, 64), height = r.bounded(1, 64);
  int frameCount = r.bounded(AS_COUNT, AS_COUNT * 32), paletteSize = r.bounded(2, 32);
  double scale = r.bounded(100, 2000) / 1000.0;
  std::array<int, 4> repair;
  for (int& v : repair) v = r.coordinate();
  if (repair[0] > repair[2] || repair[1] > repair[3]) return false;
  std::array<int, 2> nextSpawn{r.coordinate(), r.coordinate()};
  std::array<int, 4> nextAmbient{r.bounded(0, 255), r.bounded(0, 255), r.coordinate(), r.coordinate()};
  if (nextAmbient[2] >= nextAmbient[3]) return false;
  float tint = r.bounded(100, 1000) / 1000.f;
  if (!r.valid) return false;
  std::vector<ContentRect> nextRects;
  for (int i = 0; i < rectangleCount && r.valid; i++) {
    ContentRect rect{r.bounded(0, 2), r.surface(), r.coordinate(), r.coordinate(),
                     r.coordinate(), r.coordinate(), r.material()};
    if (rect.left > rect.right || rect.top > rect.bottom) return false;
    nextRects.push_back(rect);
  }
  std::vector<ContentQuest> nextQuests;
  for (int i = 0; i < questCount && r.valid; i++) {
    ContentQuest quest{};
    quest.type = r.take(); quest.prerequisiteCount = r.bounded(0, i);
    quest.x = r.coordinate(); quest.y = r.coordinate(); quest.surface = r.surface();
    quest.left = r.coordinate(); quest.top = r.coordinate();
    quest.right = r.coordinate(); quest.bottom = r.coordinate(); quest.areaSurface = r.surface();
    quest.radius = r.bounded(1, 100); quest.rewardKind = r.bounded(0, 3);
    quest.rewardId = r.take(); quest.rewardCount = r.bounded(0, 10000);
    quest.material = r.material(); quest.count = r.bounded(1, 10000); quest.species = r.bounded(0, CS_COUNT - 1); quest.giver = r.bounded(0, 64);
    if ((quest.type != OK_PASSAGE && quest.type != OK_DRAIN && quest.type != OK_SURVEY &&
         quest.type != OK_BUILD && quest.type != OK_DELIVER && quest.type != OK_DEFEAT) ||
        quest.left > quest.right || quest.top > quest.bottom) return false;
    if ((quest.rewardKind == 1 && !isMaterialId(quest.rewardId)) ||
        (quest.rewardKind == 2 && (quest.rewardId < IK_BLAST_GUN || quest.rewardId > IK_RESCUE_BEAM))) return false;
    if ((quest.type == OK_BUILD || quest.type == OK_DELIVER) && quest.material == EMPTY) return false;
    if (quest.type == OK_BUILD && (quest.right - quest.left > 128 || quest.bottom - quest.top > 64 ||
                                 quest.count != quest.right - quest.left + 1)) return false;
    for (int j = 0; j < quest.prerequisiteCount; j++) {
      int id = r.bounded(0, i - 1);
      if (std::find(quest.prerequisites.begin(), quest.prerequisites.end(), id) != quest.prerequisites.end()) return false;
      quest.prerequisites.push_back(id);
    }
    nextQuests.push_back(std::move(quest));
  }
  std::array<ContentClip, AS_COUNT> nextClips;
  int expectedOffset = 0;
  for (auto& clip : nextClips) {
    clip = r.clip(frameCount);
    if (!r.valid || clip.offset != expectedOffset) return false;
    expectedOffset += clip.count;
  }
  if (expectedOffset != frameCount) return false;
  auto nextPalette = r.colors(paletteSize);
  auto nextPixels = r.pixels(frameCount * width * height, paletteSize);
  std::array<bool, 256> nextHasTexture{};
  std::vector<std::array<uint32_t, 64>> nextTextures(256);
  int textureCount = r.bounded(0, 256);
  for (int i = 0; i < textureCount && r.valid; i++) {
    int material = r.material();
    if (!r.valid || nextHasTexture[(size_t)material]) return false;
    nextHasTexture[(size_t)material] = true;
    for (uint32_t& pixel : nextTextures[(size_t)material]) pixel = (uint32_t)r.take();
  }
  std::array<ContentCreatureArt, CS_COUNT> nextCreatureArt;
  std::array<bool, CS_COUNT> seen{};
  int creatureCount = r.bounded(0, CS_COUNT);
  for (int i = 0; i < creatureCount && r.valid; i++) {
    int species = r.bounded(0, CS_COUNT - 1);
    if (!r.valid || seen[(size_t)species]) return false;
    seen[(size_t)species] = true;
    auto& art = nextCreatureArt[(size_t)species];
    art.width = r.bounded(1, 128); art.height = r.bounded(1, 128);
    art.scale = r.bounded(100, 2000) / 1000.0;
    int colorCount = r.bounded(2, 32), frames = r.bounded(CC_COUNT, CC_COUNT * 32);
    expectedOffset = 0;
    for (auto& clip : art.clips) {
      clip = r.clip(frames);
      if (!r.valid || clip.offset != expectedOffset) return false;
      expectedOffset += clip.count;
    }
    if (expectedOffset != frames) return false;
    art.palette = r.colors(colorCount);
    art.pixels = r.pixels(art.width * art.height * frames, colorCount);
  }
  int residentCount = r.bounded(0, 64);
  std::vector<ContentResident> nextResidents;
  for (int i = 0; i < residentCount && r.valid; i++)
    nextResidents.push_back({r.bounded(1, 64), r.bounded(0, CS_COUNT - 1), r.coordinate(), r.coordinate(), r.surface(), r.bounded(0, 48)});
  std::array<int, 4> nextLimbColors;
  for (int& color : nextLimbColors) color = r.bounded(1, paletteSize - 1);
  std::map<int, ContentGear> nextEquipment;
  int gearCount = r.bounded(1, 512);
  for (int i = 0; i < gearCount && r.valid; i++) {
    ContentGear g{r.bounded(1, 10000), r.bounded(1, 11), r.bounded(-1, 8), r.bounded(0, 200),
      r.bounded(0, 50), r.bounded(0, 100), r.bounded(0, 100), r.bounded(1, 300), r.bounded(0, 100),
      r.bounded(0, 6), r.bounded(0, 6), r.bounded(0, 10000)};
    if (!nextEquipment.emplace(g.id, g).second) return false;
  }
  std::vector<ContentChest> nextChests;
  std::unordered_set<int> chestIds;
  int chestCount = r.bounded(0, 512);
  for (int i = 0; i < chestCount && r.valid; i++) {
    ContentChest chest{r.bounded(1, 100000), r.coordinate(), r.coordinate(), r.surface(), {}};
    if (!chestIds.insert(chest.id).second) return false;
    int stacks = r.bounded(0, 24);
    for (int j = 0; j < stacks && r.valid; j++) {
      InvSlot item; item.itemKind = r.bounded(0, IK_GEAR); int value = r.take(); item.count = r.bounded(1, 999);
      if (item.itemKind == IK_GEAR) { if (!nextEquipment.count(value)) return false; item.definitionId = value; }
      else if (item.itemKind == IK_MATERIAL) { if (!isMaterialId(value)) return false; item.material = value; }
      else if (item.itemKind != IK_ARROW) return false;
      chest.loot.push_back(item);
    }
    nextChests.push_back(std::move(chest));
  }
  if (!r.valid || r.at != length) return false;
  for (const auto& quest : nextQuests) {
    if (quest.rewardKind == 3 && !nextEquipment.count(quest.rewardId)) return false;
    if (quest.giver && std::none_of(nextResidents.begin(), nextResidents.end(), [&](const auto& n) { return n.id == quest.giver; })) return false;
  }
  chests = std::move(nextChests);
  equipment = std::move(nextEquipment);
  fingerprint = nextFingerprint; spriteWidth = width; spriteHeight = height; pixelScale = scale;
  repairBounds = repair; spawn = nextSpawn; ambient = nextAmbient; backgroundTint = tint;
  rectangles = std::move(nextRects); quests = std::move(nextQuests); residents = std::move(nextResidents);
  clips = std::move(nextClips); palette = std::move(nextPalette); pixels = std::move(nextPixels);
  hasTexture = nextHasTexture;
  std::copy(nextTextures.begin(), nextTextures.end(), textures.begin());
  creatureArt = std::move(nextCreatureArt);
  limbColors = nextLimbColors;
  return true;
}

int ContentSystem::ambientAt(int worldY) const {
  double t = std::clamp((worldY - ambient[2]) / (double)(ambient[3] - ambient[2]), 0.0, 1.0);
  return (int)(ambient[0] + (ambient[1] - ambient[0]) * t);
}

int ContentSystem::surfaceOffset(int surface) {
  return surface == INT_MIN ? 0 : E.terrain.genSurfaceAbs(surface);
}

void ContentSystem::stamp(int colStart, int colEnd, int rowStart, int rowEnd) {
  const int layer = E.L->isBackground ? 1 : 0;
  for (const ContentRect& r : rectangles) {
    if (r.layer != 2 && r.layer != layer) continue;
    int left = imax(colStart, r.left - E.L->worldOffsetX);
    int right = imin(colEnd - 1, r.right - E.L->worldOffsetX);
    if (left > right) continue;
    int offset = surfaceOffset(r.surface) - E.L->worldOffsetY;
    int top = imax(rowStart, r.top + offset), bottom = imin(rowEnd - 1, r.bottom + offset);
    for (int y = top; y <= bottom; y++) for (int x = left; x <= right; x++)
      E.L->grid[E.I(x, y)] = (uint8_t)r.material;
  }
}

const uint8_t* ContentSystem::spriteRow(int state, int frame, int row) const {
  const ContentClip& clip = clips[(size_t)state];
  int index = clip.offset + frame % clip.count;
  return pixels.data() + (index * spriteHeight + row) * spriteWidth;
}
