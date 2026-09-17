#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

struct ContentClip {
  int count = 1, ticks = 8, offset = 0, duration = 8;
  std::vector<int> durations{8};
  int frameAt(int tick) const {
    int phase = std::max(0, tick) % duration;
    for (int i = 0; i < count; i++) {
      if (phase < durations[(size_t)i]) return i;
      phase -= durations[(size_t)i];
    }
    return count - 1;
  }
};
enum CreatureClip { CC_IDLE, CC_MOVE, CC_WINDUP, CC_ATTACK, CC_RECOVER, CC_HURT, CC_DEATH, CC_SPECIAL, CC_SWIM, CC_COUNT };
struct CreatureAnimationRange {
  int clip = CC_IDLE, start = 0, count = 1;
  bool loop = false;
};
struct ContentCreatureArt {
  int width = 0, height = 0;
  double scale = 1;
  std::array<ContentClip, CC_COUNT> clips;
  std::array<std::array<CreatureAnimationRange, 3>, 3> attacks;
  std::vector<std::array<float, 4>> palette;
  std::vector<uint8_t> pixels;
};

// Presentation-only playback. Gameplay owns attack progress and the death frame.
// Native and replicated actors supply the same input on the same actor clock.
class CreatureAnimationController {
 public:
  enum Motion { GROUND, SWIM, FLY, STILL };
  struct Input {
    int id = 0, tick = 0, stage = CC_IDLE, pattern = 0, deathFrame = 0, hurtAge = -1;
    bool alive = true, stunned = false, rescuing = false;
    Motion motion = GROUND;
    double vx = 0, vy = 0, referenceSpeed = .15, progress = 0;
  };
  struct Pose { int clip, frame; };

  Pose sample(const ContentCreatureArt& art, const Input& input) {
    auto& state = actors[input.id];
    if (state.tick < 0 || input.tick < state.tick || input.tick - state.tick > 120) state = State{};
    const int elapsed = state.tick < 0 ? 0 : input.tick - state.tick;
    const double speed = input.motion == GROUND ? std::abs(input.vx) : std::hypot(input.vx, input.vy);
    if (state.tick < 0) state.speed = speed;
    else if (elapsed) state.speed += (speed - state.speed) * (1 - std::pow(.75, elapsed));
    if (state.walking ? state.speed < .025 : state.speed > .06) state.walking = !state.walking;
    bool moving = input.motion == FLY || (input.motion != STILL && state.walking);
    if (input.motion == GROUND && std::abs(input.vy) > .06) moving = true;
    const bool reacting = input.alive && (input.hurtAge >= 0 || input.stunned);
    int clip = !input.alive ? CC_DEATH : reacting ? CC_HURT : input.rescuing ? CC_SPECIAL
      : input.stage != CC_IDLE ? input.stage : input.motion == SWIM ? CC_SWIM : moving ? CC_MOVE : CC_IDLE;
    CreatureAnimationRange range{clip, 0, art.clips[clip].count, true};
    const bool attacking = input.alive && !reacting && !input.rescuing && input.stage >= CC_WINDUP && input.stage <= CC_RECOVER;
    if (attacking) range = art.attacks[std::clamp(input.pattern, 0, 2)][input.stage - CC_WINDUP];
    if (state.clip != clip || state.pattern != input.pattern) state.phase = 0;
    else {
      // At nominal travel speed the authored frame durations apply. Slower travel
      // advances feet more slowly; wings retain their time-based flap cadence.
      double rate = (clip == CC_MOVE || clip == CC_SWIM) && input.motion != FLY
        ? std::clamp(speed / std::max(.01, input.referenceSpeed), clip == CC_SWIM ? .5 : 0.0, 3.0) : 1.0;
      // Snapshot velocities are floats; nominal cadence must not drift at frame boundaries.
      if (std::abs(rate - 1) < .000001) rate = 1;
      state.phase += elapsed * rate;
    }
    state.tick = input.tick; state.clip = clip; state.pattern = input.pattern;
    const auto& frames = art.clips[range.clip];
    int duration = 0;
    for (int i = 0; i < range.count; i++) duration += frames.durations[range.start + i];
    int phase = attacking && !range.loop
      ? std::min(duration - 1, (int)(std::clamp(input.progress, 0.0, 1.0) * duration))
      : (int)std::fmod(state.phase, duration);
    int pose = 0;
    while (pose < range.count - 1 && phase >= frames.durations[range.start + pose]) phase -= frames.durations[range.start + pose++];
    if (!input.alive) pose = std::clamp(input.deathFrame, 0, range.count - 1);
    else if (reacting) pose = input.stunned ? std::min(1, range.count - 1) : std::min(range.count - 1, 1 + input.hurtAge / 5);
    return {range.clip, frames.offset + range.start + pose};
  }

  void prune(int tick) {
    for (auto it = actors.begin(); it != actors.end();) {
      if (tick < it->second.tick || tick - it->second.tick > 120) it = actors.erase(it);
      else ++it;
    }
  }
 private:
  struct State { int tick = -1, clip = -1, pattern = -1; double phase = 0, speed = 0; bool walking = false; };
  std::unordered_map<int, State> actors;
};
