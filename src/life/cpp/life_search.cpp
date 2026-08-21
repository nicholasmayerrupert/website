#include <algorithm>
#include <cstdint>
#include <limits>
#include <memory>
#include <utility>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define LIFE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define LIFE_EXPORT
#endif

namespace {

struct Board {
  explicit Board(int wordCount = 0) : words(wordCount, 0) {}

  std::vector<uint64_t> words;
};

uint64_t mix64(uint64_t x) {
  x += 0x9e3779b97f4a7c15ULL;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
  return x ^ (x >> 31);
}

class Random64 {
 public:
  explicit Random64(uint64_t seed)
      : state_(seed ? seed : 0x6a09e667f3bcc909ULL) {}

  uint64_t next() {
    state_ += 0x9e3779b97f4a7c15ULL;
    return mix64(state_);
  }

 private:
  uint64_t state_;
};

class LifeStepper {
 public:
  explicit LifeStepper(int size)
      : size_(size),
        mask_(size == 64 ? ~0ULL : ((1ULL << size) - 1ULL)),
        wordCount_(size == 16 ? 4 : size) {}

  Board makeBoard() const { return Board(wordCount_); }

  void copy(const Board& source, Board& target) const {
    std::copy(source.words.begin(), source.words.end(), target.words.begin());
  }

  bool equal(const Board& left, const Board& right) const {
    return left.words == right.words;
  }

  void step(const Board& current, Board& next) const {
    if (size_ == 16) {
      stepPacked16(current, next);
      return;
    }
    for (int y = 0; y < size_; ++y) {
      const uint64_t up = current.words[(y + size_ - 1) % size_];
      const uint64_t mid = current.words[y];
      const uint64_t down = current.words[(y + 1) % size_];
      next.words[y] = evolve(up, mid, down, mask_);
    }
  }

  bool empty(const Board& board) const {
    for (uint64_t word : board.words) {
      if (word) return false;
    }
    return true;
  }

  void setCell(Board& board, int x, int y) const {
    if (size_ == 16) {
      board.words[y >> 2] |= 1ULL << ((y & 3) * 16 + x);
    } else {
      board.words[y] |= 1ULL << x;
    }
  }

  bool cell(const Board& board, int x, int y) const {
    if (size_ == 16) {
      return (board.words[y >> 2] >> ((y & 3) * 16 + x)) & 1ULL;
    }
    return (board.words[y] >> x) & 1ULL;
  }

 private:
  int size_;
  uint64_t mask_;
  int wordCount_;

  uint64_t rotateLeft(uint64_t row) const {
    return ((row << 1) & mask_) | (row >> (size_ - 1));
  }

  uint64_t rotateRight(uint64_t row) const {
    return (row >> 1) | ((row & 1ULL) << (size_ - 1));
  }

  struct BitSum {
    uint64_t ones;
    uint64_t twos;
  };

  static BitSum addThree(uint64_t a, uint64_t b, uint64_t c) {
    const uint64_t aXorB = a ^ b;
    return {aXorB ^ c, (a & b) | (aXorB & c)};
  }

  static uint64_t applyRule(uint64_t upLeft, uint64_t up,
                            uint64_t upRight, uint64_t midLeft,
                            uint64_t mid, uint64_t midRight,
                            uint64_t downLeft, uint64_t down,
                            uint64_t downRight) {
    const BitSum top = addThree(upLeft, up, upRight);
    const BitSum bottom = addThree(downLeft, down, downRight);
    const uint64_t middleOnes = midLeft ^ midRight;
    const uint64_t middleTwos = midLeft & midRight;
    const BitSum low = addThree(top.ones, middleOnes, bottom.ones);

    // A count of two or three has exactly one contribution to the high bit.
    const uint64_t highParity =
        top.twos ^ middleTwos ^ bottom.twos ^ low.twos;
    const uint64_t firstPair = top.twos & middleTwos;
    const uint64_t secondPair = bottom.twos & low.twos;
    const uint64_t crossPair = (top.twos | middleTwos) &
                               (bottom.twos | low.twos);
    const uint64_t multipleHighBits = firstPair | secondPair | crossPair;
    const uint64_t exactlyTwoOrThree = highParity & ~multipleHighBits;
    return exactlyTwoOrThree & (low.ones | mid);
  }

  uint64_t evolve(uint64_t up, uint64_t mid, uint64_t down,
                  uint64_t mask) const {
    return applyRule(rotateLeft(up), up, rotateRight(up), rotateLeft(mid),
                     mid, rotateRight(mid), rotateLeft(down), down,
                     rotateRight(down)) & mask;
  }

  static uint64_t rotatePackedLeft(uint64_t rows) {
    constexpr uint64_t lowBits = 0x0001000100010001ULL;
    constexpr uint64_t withoutLowBits = 0xfffefffefffefffeULL;
    return ((rows << 1) & withoutLowBits) | ((rows >> 15) & lowBits);
  }

  static uint64_t rotatePackedRight(uint64_t rows) {
    constexpr uint64_t lowBits = 0x0001000100010001ULL;
    constexpr uint64_t withoutHighBits = 0x7fff7fff7fff7fffULL;
    return ((rows >> 1) & withoutHighBits) | ((rows & lowBits) << 15);
  }

  static uint64_t evolvePacked(uint64_t up, uint64_t mid, uint64_t down) {
    return applyRule(rotatePackedLeft(up), up, rotatePackedRight(up),
                     rotatePackedLeft(mid), mid, rotatePackedRight(mid),
                     rotatePackedLeft(down), down, rotatePackedRight(down));
  }

  static void stepPacked16(const Board& current, Board& next) {
    for (int group = 0; group < 4; ++group) {
      const uint64_t mid = current.words[group];
      const uint64_t previous = current.words[(group + 3) & 3];
      const uint64_t following = current.words[(group + 1) & 3];
      const uint64_t up = (mid << 16) | (previous >> 48);
      const uint64_t down = (mid >> 16) | (following << 48);
      next.words[group] = evolvePacked(up, mid, down);
    }
  }
};

struct SoupResult {
  Board board;
  uint64_t lifetime = 0;
  uint64_t transient = 0;
  uint64_t period = 0;
  int reason = 0;  // 1 empty, 2 repeated, 3 horizon
  uint64_t serial = 0;
};

struct OrbitResult {
  uint64_t lifetime = 0;
  uint64_t transient = 0;
  uint64_t period = 0;
  int reason = 0;
};

struct OrbitWorkspace {
  explicit OrbitWorkspace(const LifeStepper& stepper)
      : checkpoint(stepper.makeBoard()),
        previous(stepper.makeBoard()),
        current(stepper.makeBoard()),
        next(stepper.makeBoard()) {}

  Board checkpoint;
  Board previous;
  Board current;
  Board next;
};

OrbitResult measureOrbitFloyd(const LifeStepper& stepper, const Board& seed,
                              uint64_t horizon, OrbitWorkspace& workspace) {
  if (stepper.empty(seed)) return {0, 0, 0, 1};

  stepper.step(seed, workspace.current);
  stepper.step(workspace.current, workspace.previous);
  uint64_t generation = 1;
  while (!stepper.equal(workspace.current, workspace.previous) &&
         generation < horizon) {
    if (stepper.empty(workspace.current)) return {generation, 0, 0, 1};
    stepper.step(workspace.current, workspace.next);
    std::swap(workspace.current.words, workspace.next.words);
    stepper.step(workspace.previous, workspace.next);
    stepper.step(workspace.next, workspace.checkpoint);
    std::swap(workspace.previous.words, workspace.checkpoint.words);
    ++generation;
  }
  if (stepper.empty(workspace.current)) return {generation, 0, 0, 1};
  if (!stepper.equal(workspace.current, workspace.previous)) {
    return {horizon, 0, 0, 3};
  }

  uint64_t transient = 0;
  stepper.copy(seed, workspace.current);
  while (!stepper.equal(workspace.current, workspace.previous)) {
    stepper.step(workspace.current, workspace.next);
    std::swap(workspace.current.words, workspace.next.words);
    stepper.step(workspace.previous, workspace.checkpoint);
    std::swap(workspace.previous.words, workspace.checkpoint.words);
    ++transient;
  }

  uint64_t period = 1;
  stepper.step(workspace.current, workspace.previous);
  while (!stepper.equal(workspace.current, workspace.previous)) {
    stepper.step(workspace.previous, workspace.next);
    std::swap(workspace.previous.words, workspace.next.words);
    ++period;
  }
  const uint64_t lifetime = transient + period;
  if (lifetime > horizon) return {horizon, 0, 0, 3};
  return {lifetime, transient, period, 2};
}

OrbitResult measureOrbit(const LifeStepper& stepper, const Board& seed,
                         uint64_t horizon, OrbitWorkspace& workspace) {
  if (stepper.empty(seed)) return {0, 0, 0, 1};

  // Direct checks resolve extinction and short cycles during the forward walk;
  // Brent checkpoints retain constant-memory detection for longer cycles. For
  // longer repeats, workspace.current holds the cycle entry on return.
  stepper.copy(seed, workspace.current);
  stepper.copy(seed, workspace.checkpoint);
  uint64_t generation = 0;
  uint64_t power = 1;
  uint64_t brentPeriod = 0;

  while (true) {
    stepper.step(workspace.current, workspace.next);
    ++generation;
    ++brentPeriod;

    if (stepper.empty(workspace.next)) return {generation, 0, 0, 1};
    if (stepper.equal(workspace.next, workspace.current)) {
      return {generation, generation - 1, 1, 2};
    }
    if (generation > 1 && stepper.equal(workspace.next, workspace.previous)) {
      return {generation, generation - 2, 2, 2};
    }

    if (stepper.equal(workspace.next, workspace.checkpoint)) {
      stepper.copy(seed, workspace.current);
      stepper.copy(seed, workspace.previous);
      for (uint64_t i = 0; i < brentPeriod; ++i) {
        stepper.step(workspace.previous, workspace.next);
        std::swap(workspace.previous.words, workspace.next.words);
      }

      uint64_t transient = 0;
      while (!stepper.equal(workspace.current, workspace.previous)) {
        stepper.step(workspace.current, workspace.next);
        std::swap(workspace.current.words, workspace.next.words);
        stepper.step(workspace.previous, workspace.checkpoint);
        std::swap(workspace.previous.words, workspace.checkpoint.words);
        ++transient;
      }
      return {transient + brentPeriod, transient, brentPeriod, 2};
    }

    if (horizon != 0 && generation >= horizon) {
      return measureOrbitFloyd(stepper, seed, horizon, workspace);
    }

    if (power == brentPeriod) {
      stepper.copy(workspace.next, workspace.checkpoint);
      power = power <= std::numeric_limits<uint64_t>::max() / 2
          ? power * 2
          : std::numeric_limits<uint64_t>::max();
      brentPeriod = 0;
    }

    std::swap(workspace.previous.words, workspace.current.words);
    std::swap(workspace.current.words, workspace.next.words);
  }
}

class SearchEngine {
 public:
  explicit SearchEngine(int size)
      : size(std::clamp(size, 3, 64)),
        stepper(this->size),
        orbitWorkspace(stepper),
        scratch(this->size * this->size, 0) {}

  void startSoup(int densityBasisPoints, int horizon, uint64_t seed,
                 int leaderboardSize) {
    soupDensity = std::clamp(densityBasisPoints, 1, 9999);
    soupHorizon = horizon > 0 ? static_cast<uint64_t>(horizon) : 0;
    soupLeaderboardSize = std::clamp(leaderboardSize, 1, 100);
    soupRng = std::make_unique<Random64>(seed);
    soupResults.clear();
    soupLoopResults.clear();
    soupResults.reserve(soupLeaderboardSize + 1);
    soupLoopResults.reserve(soupLeaderboardSize + 1);
    soupsSearched = 0;
    soupRunning = true;
  }

  int pumpSoup(int batchSize) {
    if (!soupRunning || !soupRng) return 0;
    const int count = std::clamp(batchSize, 1, 10000);
    for (int i = 0; i < count; ++i) {
      randomSoup();
      evaluateSoup(soupSeed);
    }
    return count;
  }

  void stop() { soupRunning = false; }

  void resume() {
    if (soupRng) soupRunning = true;
  }

  const uint8_t* soupResultCells(int index) {
    if (index < 0 || index >= static_cast<int>(soupResults.size())) return nullptr;
    fillScratch(soupResults[index].board);
    return scratch.data();
  }

  const uint8_t* soupLoopResultCells(int index) {
    if (index < 0 || index >= static_cast<int>(soupLoopResults.size())) return nullptr;
    fillScratch(soupLoopResults[index].board);
    return scratch.data();
  }

  int size;
  LifeStepper stepper;
  bool soupRunning = false;
  int soupDensity = 3750;
  uint64_t soupHorizon = 0;
  int soupLeaderboardSize = 10;
  uint64_t soupsSearched = 0;
  std::unique_ptr<Random64> soupRng;
  std::vector<SoupResult> soupResults;
  std::vector<SoupResult> soupLoopResults;

 private:
  Board soupSeed = stepper.makeBoard();
  OrbitWorkspace orbitWorkspace;
  std::vector<uint8_t> scratch;

  void fillScratch(const Board& board) {
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        scratch[y * size + x] = static_cast<uint8_t>(stepper.cell(board, x, y));
      }
    }
  }

  void randomSoup() {
    std::fill(soupSeed.words.begin(), soupSeed.words.end(), 0);
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        if (static_cast<int>(soupRng->next() % 10000ULL) < soupDensity) {
          stepper.setCell(soupSeed, x, y);
        }
      }
    }
  }

  static bool betterLifetime(const SoupResult& left, const SoupResult& right) {
    if (left.lifetime != right.lifetime) return left.lifetime > right.lifetime;
    return left.serial < right.serial;
  }

  static bool betterLoop(const SoupResult& left, const SoupResult& right) {
    if (left.period != right.period) return left.period > right.period;
    if (left.lifetime != right.lifetime) return left.lifetime > right.lifetime;
    return left.serial < right.serial;
  }

  void insertLifetimeResult(const Board& seed, const OrbitResult& orbit,
                            uint64_t serial) {
    if (static_cast<int>(soupResults.size()) >= soupLeaderboardSize &&
        orbit.lifetime <= soupResults.back().lifetime) {
      return;
    }
    SoupResult result{
        seed, orbit.lifetime, orbit.transient, orbit.period, orbit.reason, serial};
    const auto position = std::lower_bound(
        soupResults.begin(), soupResults.end(), result, betterLifetime);
    soupResults.insert(position, std::move(result));
    if (static_cast<int>(soupResults.size()) > soupLeaderboardSize) {
      soupResults.pop_back();
    }
  }

  void insertLoopResult(const Board& seed, const OrbitResult& orbit,
                        uint64_t serial) {
    if (orbit.reason != 2 || orbit.period <= 2) return;
    if (static_cast<int>(soupLoopResults.size()) >= soupLeaderboardSize) {
      const SoupResult& last = soupLoopResults.back();
      if (orbit.period < last.period ||
          (orbit.period == last.period && orbit.lifetime <= last.lifetime)) {
        return;
      }
    }
    SoupResult result{
        seed, orbit.lifetime, orbit.transient, orbit.period, orbit.reason, serial};
    const auto position = std::lower_bound(
        soupLoopResults.begin(), soupLoopResults.end(), result, betterLoop);
    soupLoopResults.insert(position, std::move(result));
    if (static_cast<int>(soupLoopResults.size()) > soupLeaderboardSize) {
      soupLoopResults.pop_back();
    }
  }

  void evaluateSoup(const Board& seed) {
    const OrbitResult orbit =
        measureOrbit(stepper, seed, soupHorizon, orbitWorkspace);
    const uint64_t serial = soupsSearched++;
    insertLifetimeResult(seed, orbit, serial);
    insertLoopResult(seed, orbit, serial);
  }

};

SearchEngine* asEngine(uintptr_t handle) {
  return reinterpret_cast<SearchEngine*>(handle);
}

uint64_t joinSeed(uint32_t low, uint32_t high) {
  return static_cast<uint64_t>(low) | (static_cast<uint64_t>(high) << 32);
}

Board boardFromCells(int size, const uint8_t* cells) {
  LifeStepper stepper(size);
  Board board = stepper.makeBoard();
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) {
      if (cells[y * size + x]) stepper.setCell(board, x, y);
    }
  }
  return board;
}

}  // namespace

extern "C" {

LIFE_EXPORT uintptr_t life_create(int size) {
  return reinterpret_cast<uintptr_t>(new SearchEngine(size));
}

LIFE_EXPORT void life_destroy(uintptr_t handle) { delete asEngine(handle); }

LIFE_EXPORT void life_stop(uintptr_t handle) {
  if (SearchEngine* engine = asEngine(handle)) engine->stop();
}

LIFE_EXPORT void life_resume(uintptr_t handle) {
  if (SearchEngine* engine = asEngine(handle)) engine->resume();
}

LIFE_EXPORT void life_start_soup(uintptr_t handle, int densityBasisPoints,
                                 int horizon, uint32_t seedLow,
                                 uint32_t seedHigh, int leaderboardSize) {
  if (SearchEngine* engine = asEngine(handle)) {
    engine->startSoup(densityBasisPoints, horizon, joinSeed(seedLow, seedHigh),
                      leaderboardSize);
  }
}

LIFE_EXPORT int life_soup_pump(uintptr_t handle, int batchSize) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->pumpSoup(batchSize) : 0;
}

LIFE_EXPORT double life_soups_searched(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->soupsSearched) : 0;
}

LIFE_EXPORT int life_soup_result_count(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<int>(engine->soupResults.size()) : 0;
}

LIFE_EXPORT double life_soup_result_lifetime(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? static_cast<double>(engine->soupResults[index].lifetime)
      : 0;
}

LIFE_EXPORT double life_soup_result_transient(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? static_cast<double>(engine->soupResults[index].transient)
      : 0;
}

LIFE_EXPORT double life_soup_result_period(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? static_cast<double>(engine->soupResults[index].period)
      : 0;
}

LIFE_EXPORT double life_soup_result_serial(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? static_cast<double>(engine->soupResults[index].serial)
      : 0;
}

LIFE_EXPORT int life_soup_result_reason(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? engine->soupResults[index].reason
      : 0;
}

LIFE_EXPORT const uint8_t* life_soup_result_cells(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->soupResultCells(index) : nullptr;
}

LIFE_EXPORT int life_soup_loop_result_count(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<int>(engine->soupLoopResults.size()) : 0;
}

LIFE_EXPORT double life_soup_loop_result_lifetime(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupLoopResults.size())
      ? static_cast<double>(engine->soupLoopResults[index].lifetime)
      : 0;
}

LIFE_EXPORT double life_soup_loop_result_transient(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupLoopResults.size())
      ? static_cast<double>(engine->soupLoopResults[index].transient)
      : 0;
}

LIFE_EXPORT double life_soup_loop_result_period(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupLoopResults.size())
      ? static_cast<double>(engine->soupLoopResults[index].period)
      : 0;
}

LIFE_EXPORT double life_soup_loop_result_serial(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupLoopResults.size())
      ? static_cast<double>(engine->soupLoopResults[index].serial)
      : 0;
}

LIFE_EXPORT const uint8_t* life_soup_loop_result_cells(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->soupLoopResultCells(index) : nullptr;
}

LIFE_EXPORT void life_step(int size, const uint8_t* input, uint8_t* output) {
  size = std::clamp(size, 3, 64);
  LifeStepper stepper(size);
  Board next = stepper.makeBoard();
  stepper.step(boardFromCells(size, input), next);
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) {
      output[y * size + x] = static_cast<uint8_t>(stepper.cell(next, x, y));
    }
  }
}

LIFE_EXPORT void life_measure_orbit(int size, const uint8_t* input, int horizon,
                                    double* output) {
  if (!output) return;
  size = std::clamp(size, 3, 64);
  LifeStepper stepper(size);
  OrbitWorkspace workspace(stepper);
  const OrbitResult orbit =
      measureOrbit(stepper, boardFromCells(size, input),
                   horizon > 0 ? horizon : 0, workspace);
  output[0] = static_cast<double>(orbit.lifetime);
  output[1] = static_cast<double>(orbit.transient);
  output[2] = static_cast<double>(orbit.period);
  output[3] = static_cast<double>(orbit.reason);
}

}  // extern "C"
