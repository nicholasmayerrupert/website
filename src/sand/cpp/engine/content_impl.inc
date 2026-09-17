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
    if (value != INT_MIN && (value < -100064 || value > 100000)) valid = false;
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
  if (r.take() != 0x41535452 || r.take() != 11) return false;
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
  bool nextPlayerLayers = r.bounded(0, 1) != 0;
  std::array<int, 10> nextPartSlots{};
  std::array<std::array<ContentPlayerPart, 10>, 7> nextPlayerParts{};
  std::vector<std::vector<ContentPlayerPlacement>> nextPlayerPoses;
  if (nextPlayerLayers) {
    for (int& slot : nextPartSlots) slot = r.bounded(0, 5);
    for (auto& set : nextPlayerParts) for (auto& part : set) {
      part.width = r.bounded(1, 32); part.height = r.bounded(1, 32);
      part.pivotX = r.bounded(0, part.width); part.pivotY = r.bounded(0, part.height);
      for (int i = 0; i < part.width * part.height && r.valid; i++) part.pixels.push_back((uint32_t)r.take());
    }
    for (int f = 0; f < frameCount && r.valid; f++) {
      int count = r.bounded(1, 16);
      std::vector<ContentPlayerPlacement> pose;
      for (int i = 0; i < count && r.valid; i++) pose.push_back({r.bounded(0, 9), r.bounded(-64, 96), r.bounded(-64, 96), r.bounded(-360, 360), r.bounded(0, 100)});
      nextPlayerPoses.push_back(std::move(pose));
    }
  }
  if (!r.valid) return false;
  std::array<bool, 256> nextHasTexture{};
  std::vector<std::array<uint32_t, 32 * 32>> nextTextures(256);
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
    art.width = r.bounded(1, 192); art.height = r.bounded(1, 128);
    art.scale = r.bounded(100, 2000) / 1000.0;
    int colorCount = r.bounded(2, 32), frames = r.bounded(CC_COUNT, CC_COUNT * 32);
    expectedOffset = 0;
    for (auto& clip : art.clips) {
      clip = r.clip(frames);
      if (!r.valid || clip.offset != expectedOffset) return false;
      expectedOffset += clip.count;
    }
    if (expectedOffset != frames) return false;
    for (auto& attack : art.attacks) for (auto& range : attack) {
      range.clip = r.bounded(0, CC_COUNT - 1);
      if (!r.valid) return false;
      const auto& clip = art.clips[range.clip];
      range.start = r.bounded(0, clip.count - 1);
      range.count = r.bounded(1, clip.count - range.start);
      range.loop = r.bounded(0, 1) != 0;
    }
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
    ContentGear g{r.bounded(1, 10000), r.bounded(GF_SWORD, GF_UPGRADE), r.bounded(-1, 8), r.bounded(0, 200),
      r.bounded(0, 50), r.bounded(0, 100), r.bounded(0, 100), r.bounded(1, 300), r.bounded(0, 256),
      r.bounded(0, SP_SPARKS), r.bounded(0, 6), r.bounded(0, 10000)};
    g.spellSlots = r.bounded(0, WAND_MAX_SPELLS);
    g.upgradeSlots = r.bounded(0, WAND_MAX_UPGRADES);
    g.initialSpell = r.bounded(0, 10000);
    int effectCount = r.bounded(0, 4);
    for (int j = 0; j < effectCount && r.valid; j++) {
      int effect = r.bounded(1, STATUS_EFFECT_COUNT - 1);
      int duration = r.bounded(0, 216000);
      if (!r.valid || duration > STATUS_DEFINITIONS[effect].maxTicks) return false;
      g.statusEffects.push_back({effect, duration});
    }
    g.cleanseTags = r.bounded(0, 255);
    if (g.family == GF_WAND) {
      if (g.spellSlots == 0 || g.initialSpell == 0 || g.spell || g.mana || g.power) return false;
    } else if (g.spellSlots || g.upgradeSlots || g.initialSpell) return false;
    for (auto& pixel : g.icon) {
      pixel=(uint32_t)r.take();
      if (pixel && (pixel>>24)!=255) return false;
    }
    if (!nextEquipment.emplace(g.id, g).second) return false;
  }
  for (const auto& [id, gear] : nextEquipment) if (gear.family == GF_WAND) {
    auto spell = nextEquipment.find(gear.initialSpell);
    if (spell == nextEquipment.end() || spell->second.family != GF_SPELL) return false;
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
  std::vector<ContentPlacement> nextPlacements;
  int placementCount = r.bounded(0, 64);
  for (int i = 0; i < placementCount && r.valid; i++) {
    ContentPlacement p{r.coordinate(), r.coordinate(), r.coordinate(), r.coordinate(),
      r.coordinate(), r.bounded(0, 1024), r.bounded(16, 256), r.bounded(0, 1)};
    if (p.left >= p.right) return false;
    int points = r.bounded(0, 32);
    for (int j = 0; j < points && r.valid; j++) {
      int x = r.coordinate(), y = r.coordinate();
      if (x < p.left || x > p.right || (j && x <= p.terrain.back()[0])) return false;
      p.terrain.push_back({x, y});
    }
    if (!r.valid) return false;
    if (points && (points < 2 || p.terrain.front()[1] || p.terrain.back()[1])) return false;
    nextPlacements.push_back(p);
  }
  auto validSurface = [&](int surface) {
    return surface == INT_MIN || surface >= -100000 || -100001 - surface < placementCount;
  };
  for (const auto& rect : nextRects) if (!validSurface(rect.surface)) return false;
  for (const auto& quest : nextQuests) if (!validSurface(quest.surface) || !validSurface(quest.areaSurface)) return false;
  for (const auto& resident : nextResidents) if (!validSurface(resident.surface)) return false;
  for (const auto& chest : nextChests) if (!validSurface(chest.surface)) return false;
  if (!r.valid || r.at != length) return false;
  placements = std::move(nextPlacements); placementsReady = false;
  for (const auto& quest : nextQuests) {
    if (quest.rewardKind == 3 && !nextEquipment.count(quest.rewardId)) return false;
    if (quest.giver && std::none_of(nextResidents.begin(), nextResidents.end(), [&](const auto& n) { return n.id == quest.giver; })) return false;
  }
  chests = std::move(nextChests);
  equipment = std::move(nextEquipment);
  fingerprint = nextFingerprint; spriteWidth = width; spriteHeight = height; pixelScale = scale;
  repairBounds = repair; spawn = nextSpawn; ambient = nextAmbient; backgroundTint = tint;
  rectangles = std::move(nextRects); quests = std::move(nextQuests); residents = std::move(nextResidents);
  // Interior details do not enlarge a site's reservation. Keep the hot world
  // queries independent of its furniture and rasterized decorative detail.
  reservations.clear();
  for (const ContentRect& rect : rectangles) {
    auto contains = [](const ContentRect& a, const ContentRect& b) {
      return a.surface == b.surface && a.left <= b.left && a.right >= b.right
        && a.top <= b.top && a.bottom >= b.bottom;
    };
    if (std::any_of(reservations.begin(), reservations.end(),
        [&](const ContentRect& existing) { return contains(existing, rect); })) continue;
    reservations.erase(std::remove_if(reservations.begin(), reservations.end(),
      [&](const ContentRect& existing) { return contains(rect, existing); }), reservations.end());
    reservations.push_back(rect);
  }
  clips = std::move(nextClips); palette = std::move(nextPalette); pixels = std::move(nextPixels);
  playerLayers = nextPlayerLayers; playerPartSlots = nextPartSlots;
  playerParts = std::move(nextPlayerParts); playerPoses = std::move(nextPlayerPoses);
  hasTexture = nextHasTexture;
  std::copy(nextTextures.begin(), nextTextures.end(), textures.begin());
  for (int m = 0; m < TABLE; m++) {
    if (!hasTexture[m] || (MAT_CLASS[m] != MC_LIQUID && MAT_CLASS[m] != MC_GAS)) continue;
    std::map<uint32_t, int> counts;
    for (uint32_t color : textures[m]) counts[color & 0xffffffu]++;
    std::vector<uint32_t> colors;
    uint32_t dominant = counts.begin()->first;
    for (const auto& entry : counts) {
      colors.push_back(entry.first);
      if (entry.second > counts[dominant]) dominant = entry.first;
    }
    auto luminance = [](uint32_t c) {
      return (c & 255u) * 54 + ((c >> 8) & 255u) * 183 + ((c >> 16) & 255u) * 19;
    };
    std::sort(colors.begin(), colors.end(), [&](uint32_t a, uint32_t b) {
      return luminance(a) < luminance(b);
    });
    fluidColors[m] = {colors.front(), dominant,
      colors[colors.size() > 1 ? colors.size() - 2 : 0], colors.back()};
  }
  creatureArt = std::move(nextCreatureArt);
  limbColors = nextLimbColors;
  return true;
}

int ContentSystem::ambientAt(int worldY) const {
  double t = std::clamp((worldY - ambient[2]) / (double)(ambient[3] - ambient[2]), 0.0, 1.0);
  return (int)(ambient[0] + (ambient[1] - ambient[0]) * t);
}

void ContentSystem::ensurePlacements() {
  if (placementsReady && placementSeed == E.fg.worldSeed) return;
  placementSeed = E.fg.worldSeed;
  placementsReady = true;
  std::vector<size_t> order;
  for (size_t i = 0; i < placements.size(); i++) order.push_back(i);
  std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) {
    return std::abs(placements[a].x) < std::abs(placements[b].x);
  });
  std::vector<size_t> placed;
  for (size_t id : order) {
    auto& p = placements[id];
    double best = 1e30;
    for (int shift = -p.search; shift <= p.search; shift += 8) {
      int center = p.x + shift, left = center + p.left, right = center + p.right;
      // Keep the starting terrace and each site's earthworks separate.
      if (left - p.blend < 352 && right + p.blend > -352) continue;
      bool overlap = false;
      for (size_t other : placed) {
        const auto& q = placements[other];
        int gap = p.blend + q.blend + 16;
        if (right + gap >= q.x + q.dx + q.left && left - gap <= q.x + q.dx + q.right) { overlap = true; break; }
      }
      if (overlap) continue;
      std::vector<int> samples;
      for (int x = left; x <= right; x += 8) samples.push_back(E.terrain.genNaturalSurfaceAbs(x));
      samples.push_back(E.terrain.genNaturalSurfaceAbs(right));
      std::sort(samples.begin(), samples.end());
      int level = samples[samples.size() / 2];
      double cost = std::abs(shift) * .025;
      for (int height : samples) cost += std::abs(height - level) / (double)samples.size();
      cost += (samples.back() - samples.front()) * .8;
      cost += std::abs(E.terrain.genNaturalSurfaceAbs(left - p.blend) - level) * .2;
      cost += std::abs(E.terrain.genNaturalSurfaceAbs(right + p.blend) - level) * .2;
      if (p.preferHigh) cost += level * .18;
      if (cost < best) { best = cost; p.dx = shift; p.dy = level - p.y - p.ground; }
    }
    // A crowded search corridor extends outward, preserving disjoint shoulders.
    if (best == 1e30) {
      int center = p.x < 0 ? -352 - p.blend - p.right - 16 : 352 + p.blend - p.left + 16;
      for (size_t other : placed) {
        const auto& q = placements[other];
        int gap = p.blend + q.blend + 16;
        if (p.x < 0) center = imin(center, q.x + q.dx + q.left - gap - p.right - 1);
        else center = imax(center, q.x + q.dx + q.right + gap - p.left + 1);
      }
      p.dx = center - p.x;
      p.dy = E.terrain.genNaturalSurfaceAbs(center) - p.y - p.ground;
    }
    placed.push_back(id);
  }
}

int ContentSystem::horizontalOffset(int surface) {
  if (surface == INT_MIN || surface > -100001) return 0;
  ensurePlacements();
  return placements[(size_t)(-100001 - surface)].dx;
}

int ContentSystem::stitchedSurface(int worldX, int natural) {
  ensurePlacements();
  double value = natural;
  for (const auto& p : placements) {
    int left = p.x + p.dx + p.left, right = p.x + p.dx + p.right;
    int distance = imax(left - worldX, worldX - right);
    if (distance >= p.blend) continue;
    double t = std::clamp(distance / (double)p.blend, 0.0, 1.0);
    // Quintic shoulders meet the untouched terrain with zero blend slope.
    double blend = t * t * t * (t * (t * 6 - 15) + 10);
    double level = p.y + p.ground + p.dy;
    int localX = worldX - p.x - p.dx;
    for (size_t i = 1; i < p.terrain.size(); i++) {
      const auto& a = p.terrain[i - 1]; const auto& b = p.terrain[i];
      if (localX < a[0] || localX > b[0]) continue;
      double u = (localX - a[0]) / (double)(b[0] - a[0]);
      u = u * u * u * (u * (u * 6 - 15) + 10);
      level += a[1] + (b[1] - a[1]) * u;
      break;
    }
    value = level + (value - level) * blend;
  }
  return (int)std::lround(value);
}

int ContentSystem::surfaceOffset(int surface) {
  if (surface == INT_MIN) return 0;
  if (surface <= -100001) { ensurePlacements(); return placements[(size_t)(-100001 - surface)].dy; }
  return E.terrain.genSurfaceAbs(surface);
}

bool ContentSystem::overlapsWorld(int left, int top, int right, int bottom) {
  if (E.planetId != PL_FRONTIER) return false;
  // Cleared interiors and access routes reserve space along with solid walls.
  constexpr int CLEARANCE = 12;
  for (const ContentRect& r : reservations) {
    int dx = horizontalOffset(r.surface);
    if (right < r.left + dx - CLEARANCE || left > r.right + dx + CLEARANCE) continue;
    int offset = surfaceOffset(r.surface);
    if (bottom >= r.top + offset - CLEARANCE && top <= r.bottom + offset + CLEARANCE)
      return true;
  }
  return false;
}

void ContentSystem::stamp(int colStart, int colEnd, int rowStart, int rowEnd) {
  const int layer = E.L->isBackground ? 1 : 0;
  ensurePlacements();
  // Ground-level masonry follows the local slope down to the bearing stratum.
  // Stamp it first so authored rooms and passages retain their clear space.
  for (const ContentRect& r : rectangles) {
    if (r.surface == INT_MIN || (r.layer != 2 && r.layer != layer)) continue;
    if (r.surface <= -100001) {
      const auto& p = placements[(size_t)(-100001 - r.surface)];
      int ground = p.y + p.ground;
      if (r.top > ground + 16 || r.bottom < ground - 4) continue;
    } else if (r.top < 0 || r.top > 16) continue;
    if (r.material != STONE && r.material != SANDSTONE
        && r.material != PALESTONE && r.material != BRICK) continue;
    int left = imax(colStart, r.left + horizontalOffset(r.surface) - E.L->worldOffsetX);
    int right = imin(colEnd - 1, r.right + horizontalOffset(r.surface) - E.L->worldOffsetX);
    if (left > right) continue;
    int top = imax(rowStart, r.bottom + surfaceOffset(r.surface) + 1 - E.L->worldOffsetY);
    for (int x = left; x <= right; x++) {
      int worldX = x + E.L->worldOffsetX;
      int ground = E.terrain.genSurfaceAbs(worldX) + TerrainGen::GEN_SKIN
        + E.terrain.genSoilDepthAt(worldX, E.terrain.genBiomeAt(worldX)) + 4;
      int bottom = imin(rowEnd - 1, ground - E.L->worldOffsetY);
      for (int y = top; y <= bottom; y++) E.L->grid[E.I(x, y)] = (uint8_t)r.material;
    }
  }
  for (const ContentRect& r : rectangles) {
    if (r.layer != 2 && r.layer != layer) continue;
    int left = imax(colStart, r.left + horizontalOffset(r.surface) - E.L->worldOffsetX);
    int right = imin(colEnd - 1, r.right + horizontalOffset(r.surface) - E.L->worldOffsetX);
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
