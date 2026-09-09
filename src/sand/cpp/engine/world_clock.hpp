#pragma once

// The authority's ten-minute day advances with actors and survives checkpoints.
class WorldClockSystem {
 public:
  static constexpr int DAY_TICKS = 36000;
  int dayTick = 7500;
  bool held = false;
  double phase() const { return (double)dayTick / DAY_TICKS; }
  bool night() const { return dayTick < 7200 || dayTick >= 28800; }
  void tick() { if (!held) dayTick = (dayTick + 1) % DAY_TICKS; }
  void set(double value, bool hold) {
    if (!std::isfinite(value)) return;
    value -= std::floor(value);
    dayTick = (int)std::round(value * DAY_TICKS) % DAY_TICKS;
    held = hold;
  }
};
