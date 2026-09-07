#pragma once

struct Engine;
struct DiscoveredCell { int x, y, material; };

// Exploration belongs to the player, independently of camera zoom and streaming.
class DiscoverySystem {
 public:
  explicit DiscoverySystem(Engine& engine) : E(engine) {}
  std::map<std::pair<int, int>, int> cells;
  std::vector<int32_t> snapshot;
  int revision = 0;
  void update();
  int buildSnapshot();
 private:
  Engine& E;
  int snapshotRevision = -1;
};
