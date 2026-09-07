#pragma once
struct Engine;
// Versioned authority checkpoints. Render data and pointers never cross the save boundary.
class CheckpointSystem {
 public:
  explicit CheckpointSystem(Engine& engine) : E(engine) {}
  std::vector<uint8_t> bytes;
  int write();
  bool read(const uint8_t* data, int length);
 private:
  Engine& E;
};
