void DiscoverySystem::update() {
  if (E.planetId != PL_FRONTIER || E.actorTick % 24 != 0) return;
  for (const Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    int px = (int)(player.px + player.w * .5), py = (int)(player.py + player.h * .5);
    bool changed = false;
    // The 64-cell sight radius covers at most 33 four-cell map tiles per axis.
    // Repeated ray visits share a bounded scratch tile instead of a tree lookup.
    static constexpr int SIDE = 33;
    int originX = (int)std::floor((px + E.fg.worldOffsetX - 64) / 4.0);
    int originY = (int)std::floor((py + E.fg.worldOffsetY - 64) / 4.0);
    std::array<int16_t, SIDE * SIDE> visible;
    visible.fill(-1);
    // Rays stop at the first opaque foreground cell; rear walls do not hide rooms.
    for (int ray = 0; ray < 192; ray++) {
      double angle = ray * 6.283185307179586 / 192;
      double dx = std::cos(angle), dy = std::sin(angle);
      for (int distance = 0; distance <= 64; distance++) {
        int x = (int)std::floor(px + dx * distance), y = (int)std::floor(py + dy * distance);
        if (x < 1 || y < 1 || x >= E.cols - 1 || y >= E.rows - 1) break;
        int material = E.fg.grid[E.I(x, y)];
        int wx = x + E.fg.worldOffsetX, wy = y + E.fg.worldOffsetY;
        int tileX = (int)std::floor(wx / 4.0) - originX;
        int tileY = (int)std::floor(wy / 4.0) - originY;
        int display = material != EMPTY ? material : E.bg.grid[E.I(x, y)];
        int16_t& tile = visible[tileX * SIDE + tileY];
        if (tile < 0 || (display != EMPTY && tile == EMPTY)) tile = (int16_t)display;
        if (E.isBlockingForActor(material)) break;
      }
    }
    for (int x = 0; x < SIDE; x++) for (int y = 0; y < SIDE; y++) {
      int display = visible[x * SIDE + y];
      if (display < 0) continue;
      auto key = std::make_pair(originX + x, originY + y);
      auto found = cells.find(key);
      if (found == cells.end() || found->second != display) { cells[key] = display; changed = true; }
    }
    if (changed) revision++;
  }
}

int DiscoverySystem::buildSnapshot() {
  if (snapshotRevision != revision) {
    snapshot.clear(); snapshot.reserve(cells.size() * 3);
    for (const auto& [position, material] : cells) {
      snapshot.push_back(position.first * 4); snapshot.push_back(position.second * 4);
      snapshot.push_back(material);
    }
    snapshotRevision = revision;
  }
  return (int)cells.size();
}
