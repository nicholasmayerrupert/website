bool ContentSystem::load(const int32_t* data, int length) {
  if (!data || length < 22 || length > 1000000 || data[0] != 0x41535452 || data[1] != 1) return false;
  int nr = data[3], nq = data[4], w = data[5], h = data[6], nf = data[7], np = data[8];
  if (nr < 0 || nr > 20000 || nq < 1 || nq > 16 || w < 1 || w > 64 || h < 1 || h > 64 ||
      nf < 7 || nf > 112 || np < 2 || np > 32 || data[9] < 100 || data[9] > 2000) return false;
  int textureStart = 21 + nr * 7 + nq * 14 + 21 + np + nf * w * h;
  if (textureStart >= length || data[textureStart] < 0 || data[textureStart] > 256 ||
      textureStart + 1 + data[textureStart] * 65 >= length || data[20] < 100 || data[20] > 1000) return false;
  auto coordinate = [](int v) { return v >= -100000 && v <= 100000; };
  auto surface = [&](int v) { return v == INT_MIN || coordinate(v); };
  for (int i = 10; i < 16; i++) if (!coordinate(data[i])) return false;
  if (data[10] > data[12] || data[11] > data[13]) return false;
  if (data[16] < 0 || data[16] > 255 || data[17] < 0 || data[17] > 255 ||
      !coordinate(data[18]) || !coordinate(data[19]) || data[18] >= data[19]) return false;
  int at = 21;
  std::vector<ContentRect> nextRects;
  for (int i = 0; i < nr; i++, at += 7) {
    const int32_t* d = data + at;
    if (d[0] < 0 || d[0] > 2 || !surface(d[1]) || !isMaterialId(d[6]) ||
        d[2] > d[4] || d[3] > d[5]) return false;
    for (int j = 2; j < 6; j++) if (!coordinate(d[j])) return false;
    nextRects.push_back({d[0], d[1], d[2], d[3], d[4], d[5], d[6]});
  }
  std::vector<ContentQuest> nextQuests;
  for (int i = 0; i < nq; i++, at += 14) {
    const int32_t* d = data + at;
    if ((d[0] != OK_PASSAGE && d[0] != OK_DRAIN && d[0] != OK_SURVEY) ||
        d[1] < 0 || d[1] >= (1 << i) || !surface(d[4]) || !surface(d[9]) ||
        d[5] > d[7] || d[6] > d[8] || d[10] < 1 || d[10] > 100 ||
        d[11] < 0 || d[11] > 2 || d[13] < 0 || d[13] > 10000) return false;
    for (int j : {2, 3, 5, 6, 7, 8}) if (!coordinate(d[j])) return false;
    if ((d[11] == 1 && !isMaterialId(d[12])) ||
        (d[11] == 2 && (d[12] < IK_BLAST_GUN || d[12] > IK_RESCUE_BEAM))) return false;
    nextQuests.push_back({d[0],d[1],d[2],d[3],d[4],d[5],d[6],d[7],d[8],d[9],d[10],d[11],d[12],d[13]});
  }
  std::array<ContentClip, 7> nextClips;
  for (auto& clip : nextClips) {
    clip = {data[at], data[at + 1], data[at + 2]}; at += 3;
    if (clip.count < 1 || clip.count > 16 || clip.ticks < 1 || clip.ticks > 120 ||
        clip.offset < 0 || clip.offset + clip.count > nf) return false;
  }
  std::vector<std::array<float, 4>> nextPalette;
  for (int i = 0; i < np; i++) {
    uint32_t color = (uint32_t)data[at++];
    nextPalette.push_back({((color >> 16) & 255) / 255.f, ((color >> 8) & 255) / 255.f,
                           (color & 255) / 255.f, ((color >> 24) & 255) / 255.f});
  }
  std::vector<uint8_t> nextPixels;
  for (; at < textureStart; at++) {
    if (data[at] < 0 || data[at] >= np) return false;
    nextPixels.push_back((uint8_t)data[at]);
  }
  fingerprint = (uint32_t)data[2]; spriteWidth = w; spriteHeight = h; pixelScale = data[9] / 1000.0;
  for (int i = 0; i < 4; i++) repairBounds[i] = data[10 + i];
  spawn = {data[14], data[15]};
  backgroundTint = data[20] / 1000.f;
  for (int i = 0; i < 4; i++) ambient[i] = data[16 + i];
  rectangles = std::move(nextRects); quests = std::move(nextQuests);
  clips = nextClips; palette = std::move(nextPalette); pixels = std::move(nextPixels);
  hasTexture.fill(false);
  int textureCount = data[at++];
  for (int i = 0; i < textureCount; i++) {
    int material = data[at++];
    if (!isMaterialId(material)) return false;
    hasTexture[(size_t)material] = true;
    for (int j = 0; j < 64; j++) textures[(size_t)material][j] = (uint32_t)data[at++];
  }
  int creatureCount = data[at++];
  if (creatureCount < 0 || creatureCount > CS_COUNT) return false;
  std::array<bool, CS_COUNT> seen{};
  for (int i = 0; i < creatureCount; i++) {
    if (at + 5 > length) return false;
    int species = data[at++], aw = data[at++], ah = data[at++], scale = data[at++], colors = data[at++];
    if (species < 0 || species >= CS_COUNT || seen[(size_t)species] || aw < 1 || aw > 64 || ah < 1 || ah > 64 ||
        scale < 100 || scale > 2000 || colors < 2 || colors > 32 || at + colors + aw * ah * 4 > length) return false;
    seen[(size_t)species] = true;
    auto& art = creatureArt[(size_t)species];
    art.width = aw; art.height = ah; art.scale = scale / 1000.0;
    for (int j = 0; j < colors; j++) {
      uint32_t c = (uint32_t)data[at++];
      art.palette.push_back({((c >> 16) & 255) / 255.f, ((c >> 8) & 255) / 255.f, (c & 255) / 255.f, ((c >> 24) & 255) / 255.f});
    }
    for (int j = 0; j < aw * ah * 4; j++) {
      int color = data[at++];
      if (color < 0 || color >= colors) return false;
      art.pixels.push_back((uint8_t)color);
    }
  }
  if (at != length) return false;
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
