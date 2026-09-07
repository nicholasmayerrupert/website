void DiscoverySystem::update() {
  if (E.planetId != PL_FRONTIER || E.actorTick % 24 != 0) return;
  for (const Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    int px = (int)(player.px + player.w * .5), py = (int)(player.py + player.h * .5);
    bool changed = false;
    std::map<std::pair<int, int>, int> visible;
    // Rays stop at the first opaque foreground cell; rear walls do not hide rooms.
    for (int ray = 0; ray < 192; ray++) {
      double angle = ray * 6.283185307179586 / 192;
      double dx = std::cos(angle), dy = std::sin(angle);
      for (int distance = 0; distance <= 64; distance++) {
        int x = (int)std::floor(px + dx * distance), y = (int)std::floor(py + dy * distance);
        if (x < 1 || y < 1 || x >= E.cols - 1 || y >= E.rows - 1) break;
        int material = E.fg.grid[E.I(x, y)];
        int wx = x + E.fg.worldOffsetX, wy = y + E.fg.worldOffsetY;
        auto key = std::make_pair((int)std::floor(wx / 4.0), (int)std::floor(wy / 4.0));
        int display = material != EMPTY ? material : E.bg.grid[E.I(x, y)];
        auto found = visible.find(key);
        if (found == visible.end() || (display != EMPTY && found->second == EMPTY)) visible[key] = display;
        if (E.isBlockingForActor(material)) break;
      }
    }
    for (const auto& [key, display] : visible) {
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
