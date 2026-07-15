#include <algorithm>
#include <cstdint>
#include <memory>
#include <unordered_map>
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

uint64_t boardHash(const Board& board) {
  uint64_t hash = 0xcbf29ce484222325ULL;
  for (uint64_t row : board.rows) {
    hash ^= mix64(row + hash);
    hash *= 0x100000001b3ULL;
  }
  return hash;
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
  int lifetime = 0;
  int reason = 0;  // 1 empty, 2 repeated, 3 horizon
  uint64_t serial = 0;
};

class SearchEngine {
 public:
  explicit SearchEngine(int size)
      : size(std::clamp(size, 3, 64)),
        stepper(this->size),
        scratch(this->size * this->size, 0) {}

  void startSoup(int densityBasisPoints, int horizon, uint64_t seed,
                 int leaderboardSize) {
    soupDensity = std::clamp(densityBasisPoints, 1, 9999);
    soupHorizon = std::clamp(horizon, 1, 100000);
    soupLeaderboardSize = std::clamp(leaderboardSize, 1, 100);
    soupRng = std::make_unique<Random64>(seed);
    soupResults.clear();
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

  int size;
  LifeStepper stepper;
  bool soupRunning = false;
  int soupDensity = 3750;
  int soupHorizon = 5000;
  int soupLeaderboardSize = 10;
  uint64_t soupsSearched = 0;
  std::unique_ptr<Random64> soupRng;
  std::vector<SoupResult> soupResults;

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
    Board current = seed;
    int reason = 3;
    int lifetime = 0;
    std::vector<Board> history;
    history.reserve(std::min(soupHorizon, 4096));
    std::unordered_map<uint64_t, std::vector<int>> seen;

    while (lifetime < soupHorizon && !stepper.empty(current)) {
      const uint64_t hash = boardHash(current);
      bool repeated = false;
      auto found = seen.find(hash);
      if (found != seen.end()) {
        for (int index : found->second) {
          if (history[index] == current) {
            repeated = true;
            break;
          }
        }
      }
      if (repeated) {
        reason = 2;
        break;
      }
      seen[hash].push_back(static_cast<int>(history.size()));
      history.push_back(current);
      ++lifetime;
      current = stepper.step(current);
    }
    if (stepper.empty(current)) reason = 1;
    else if (lifetime >= soupHorizon) reason = 3;

    soupResults.push_back({std::move(seed), lifetime, reason, soupsSearched++});
    std::stable_sort(
        soupResults.begin(), soupResults.end(),
        [](const SoupResult& left, const SoupResult& right) {
          if (left.lifetime != right.lifetime) return left.lifetime > right.lifetime;
          return left.serial < right.serial;
        });
    if (static_cast<int>(soupResults.size()) > soupLeaderboardSize) {
      soupResults.resize(soupLeaderboardSize);
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

LIFE_EXPORT int life_soup_result_lifetime(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? engine->soupResults[index].lifetime
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
  horizon = std::clamp(horizon, 1, 100000);
  Board current = boardFromCells(size, input);
  LifeStepper stepper(size);
  std::vector<Board> history;
  std::unordered_map<uint64_t, std::vector<int>> seen;
  int lifetime = 0;
  int reason = 3;
  while (lifetime < horizon && !stepper.empty(current)) {
    const uint64_t hash = boardHash(current);
    bool repeated = false;
    auto found = seen.find(hash);
    if (found != seen.end()) {
      for (int index : found->second) {
        if (history[index] == current) {
          repeated = true;
          break;
        }
      }
    }
    if (repeated) {
      reason = 2;
      break;
    }
    seen[hash].push_back(static_cast<int>(history.size()));
    history.push_back(current);
    ++lifetime;
    current = stepper.step(current);
  }
  if (stepper.empty(current)) reason = 1;
  else if (lifetime >= horizon) reason = 3;
  return (lifetime << 2) | reason;
}

}  // extern "C"
