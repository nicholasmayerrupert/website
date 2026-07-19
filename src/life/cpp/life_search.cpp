#include <algorithm>
#include <cstdint>
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
  std::vector<uint64_t> rows;

  bool operator==(const Board& other) const { return rows == other.rows; }
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
      : size_(size), mask_(size == 64 ? ~0ULL : ((1ULL << size) - 1ULL)) {}

  Board step(const Board& current) const {
    Board next{std::vector<uint64_t>(size_, 0)};
    for (int y = 0; y < size_; ++y) {
      const uint64_t up = current.rows[(y + size_ - 1) % size_];
      const uint64_t mid = current.rows[y];
      const uint64_t down = current.rows[(y + 1) % size_];
      uint64_t ones = 0;
      uint64_t twos = 0;
      uint64_t fours = 0;
      uint64_t eights = 0;
      addBits(rotateLeft(up), ones, twos, fours, eights);
      addBits(up, ones, twos, fours, eights);
      addBits(rotateRight(up), ones, twos, fours, eights);
      addBits(rotateLeft(mid), ones, twos, fours, eights);
      addBits(rotateRight(mid), ones, twos, fours, eights);
      addBits(rotateLeft(down), ones, twos, fours, eights);
      addBits(down, ones, twos, fours, eights);
      addBits(rotateRight(down), ones, twos, fours, eights);
      const uint64_t lower = ~(fours | eights) & mask_;
      const uint64_t exactlyTwo = ~ones & twos & lower;
      const uint64_t exactlyThree = ones & twos & lower;
      next.rows[y] = (exactlyThree | (mid & exactlyTwo)) & mask_;
    }
    return next;
  }

  bool empty(const Board& board) const {
    for (uint64_t row : board.rows) {
      if (row) return false;
    }
    return true;
  }

 private:
  int size_;
  uint64_t mask_;

  uint64_t rotateLeft(uint64_t row) const {
    return ((row << 1) & mask_) | (row >> (size_ - 1));
  }

  uint64_t rotateRight(uint64_t row) const {
    return (row >> 1) | ((row & 1ULL) << (size_ - 1));
  }

  static void addBits(uint64_t value, uint64_t& ones, uint64_t& twos,
                      uint64_t& fours, uint64_t& eights) {
    uint64_t carry = ones & value;
    ones ^= value;
    value = carry;
    carry = twos & value;
    twos ^= value;
    value = carry;
    carry = fours & value;
    fours ^= value;
    eights ^= carry;
  }
};

struct SoupResult {
  Board seed;
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

OrbitResult measureOrbit(const LifeStepper& stepper, const Board& seed,
                         uint64_t horizon) {
  if (stepper.empty(seed)) return {0, 0, 0, 1};

  Board tortoise = stepper.step(seed);
  Board hare = stepper.step(stepper.step(seed));
  uint64_t generation = 1;
  while (tortoise != hare && (horizon == 0 || generation < horizon)) {
    if (stepper.empty(tortoise)) return {generation, 0, 0, 1};
    tortoise = stepper.step(tortoise);
    hare = stepper.step(stepper.step(hare));
    ++generation;
  }
  if (stepper.empty(tortoise)) return {generation, 0, 0, 1};
  if (tortoise != hare) return {horizon, 0, 0, 3};

  uint64_t transient = 0;
  tortoise = seed;
  while (tortoise != hare) {
    tortoise = stepper.step(tortoise);
    hare = stepper.step(hare);
    ++transient;
  }

  uint64_t period = 1;
  hare = stepper.step(tortoise);
  while (tortoise != hare) {
    hare = stepper.step(hare);
    ++period;
  }
  const uint64_t lifetime = transient + period;
  if (horizon != 0 && lifetime > horizon) return {horizon, 0, 0, 3};
  return {lifetime, transient, period, 2};
}

class SearchEngine {
 public:
  explicit SearchEngine(int size)
      : size(std::clamp(size, 3, 64)),
        stepper(this->size),
        scratch(this->size * this->size, 0) {}

  void startSoup(int densityBasisPoints, int horizon, uint64_t seed,
                 int leaderboardSize) {
    soupDensity = std::clamp(densityBasisPoints, 1, 9999);
    soupHorizon = horizon > 0 ? static_cast<uint64_t>(horizon) : 0;
    soupLeaderboardSize = std::clamp(leaderboardSize, 1, 100);
    soupRng = std::make_unique<Random64>(seed);
    soupResults.clear();
    soupLoopResults.clear();
    soupsSearched = 0;
    soupRunning = true;
  }

  int pumpSoup(int batchSize) {
    if (!soupRunning || !soupRng) return 0;
    const int count = std::clamp(batchSize, 1, 10000);
    for (int i = 0; i < count; ++i) evaluateSoup(randomSoup());
    return count;
  }

  void stop() { soupRunning = false; }

  const uint8_t* soupResultCells(int index) {
    if (index < 0 || index >= static_cast<int>(soupResults.size())) return nullptr;
    fillScratch(soupResults[index].seed);
    return scratch.data();
  }

  const uint8_t* soupLoopResultCells(int index) {
    if (index < 0 || index >= static_cast<int>(soupLoopResults.size())) return nullptr;
    fillScratch(soupLoopResults[index].seed);
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
  std::vector<uint8_t> scratch;

  void fillScratch(const Board& board) {
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        scratch[y * size + x] =
            static_cast<uint8_t>((board.rows[y] >> x) & 1ULL);
      }
    }
  }

  Board randomSoup() {
    Board board{std::vector<uint64_t>(size, 0)};
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        if (static_cast<int>(soupRng->next() % 10000ULL) < soupDensity) {
          board.rows[y] |= 1ULL << x;
        }
      }
    }
    return board;
  }

  void evaluateSoup(Board seed) {
    const OrbitResult orbit = measureOrbit(stepper, seed, soupHorizon);
    const uint64_t serial = soupsSearched++;
    soupResults.push_back(
        {seed, orbit.lifetime, orbit.transient, orbit.period, orbit.reason, serial});
    std::stable_sort(
        soupResults.begin(), soupResults.end(),
        [](const SoupResult& left, const SoupResult& right) {
          if (left.lifetime != right.lifetime) return left.lifetime > right.lifetime;
          return left.serial < right.serial;
        });
    if (static_cast<int>(soupResults.size()) > soupLeaderboardSize) {
      soupResults.resize(soupLeaderboardSize);
    }

    if (orbit.reason != 2 || orbit.period <= 2) return;
    soupLoopResults.push_back(
        {std::move(seed), orbit.lifetime, orbit.transient, orbit.period, orbit.reason, serial});
    std::stable_sort(
        soupLoopResults.begin(), soupLoopResults.end(),
        [](const SoupResult& left, const SoupResult& right) {
          if (left.period != right.period) return left.period > right.period;
          if (left.lifetime != right.lifetime) return left.lifetime > right.lifetime;
          return left.serial < right.serial;
        });
    if (static_cast<int>(soupLoopResults.size()) > soupLeaderboardSize) {
      soupLoopResults.resize(soupLeaderboardSize);
    }
  }
};

SearchEngine* asEngine(uintptr_t handle) {
  return reinterpret_cast<SearchEngine*>(handle);
}

uint64_t joinSeed(uint32_t low, uint32_t high) {
  return static_cast<uint64_t>(low) | (static_cast<uint64_t>(high) << 32);
}

Board boardFromCells(int size, const uint8_t* cells) {
  Board board{std::vector<uint64_t>(size, 0)};
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) {
      if (cells[y * size + x]) board.rows[y] |= 1ULL << x;
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
  Board next = LifeStepper(size).step(boardFromCells(size, input));
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) {
      output[y * size + x] =
          static_cast<uint8_t>((next.rows[y] >> x) & 1ULL);
    }
  }
}

LIFE_EXPORT int life_measure_lifetime(int size, const uint8_t* input,
                                      int horizon) {
  size = std::clamp(size, 3, 64);
  LifeStepper stepper(size);
  const OrbitResult orbit =
      measureOrbit(stepper, boardFromCells(size, input), horizon > 0 ? horizon : 0);
  return (static_cast<int>(orbit.lifetime) << 2) | orbit.reason;
}

LIFE_EXPORT double life_measure_period(int size, const uint8_t* input,
                                       int horizon) {
  size = std::clamp(size, 3, 64);
  return static_cast<double>(measureOrbit(
      LifeStepper(size), boardFromCells(size, input), horizon > 0 ? horizon : 0).period);
}

LIFE_EXPORT double life_measure_transient(int size, const uint8_t* input,
                                          int horizon) {
  size = std::clamp(size, 3, 64);
  return static_cast<double>(measureOrbit(
      LifeStepper(size), boardFromCells(size, input), horizon > 0 ? horizon : 0).transient);
}

}  // extern "C"
