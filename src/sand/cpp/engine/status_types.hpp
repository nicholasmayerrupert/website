#pragma once

struct StatusInstance {
  int effect = STATUS_NONE;
  int remainingTicks = 0, durationTicks = 0, periodTicks = 0;
  int strength = 1, sourceKind = SA_NONE, sourceId = 0;
};

// Only affected actors allocate instances. Derived modifiers never change base stats.
struct StatusState {
  std::vector<StatusInstance> instances;
  double movementScale = 1;
  int controls = 0, immunityTags = 0, visuals = 0;
};

struct StatusApplication { int effect = STATUS_NONE, durationTicks = 0; };
