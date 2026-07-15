#include <algorithm>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "minisat/core/Solver.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define LIFE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define LIFE_EXPORT
#endif

namespace {

using Minisat::Lit;
using Minisat::Solver;
using Minisat::Var;
using Minisat::lbool;
using Minisat::mkLit;

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
  uint64_t h = 0xcbf29ce484222325ULL;
  for (uint64_t row : board.rows) {
    h ^= mix64(row + h);
    h *= 0x100000001b3ULL;
  }
  return h;
}

class Random64 {
 public:
  explicit Random64(uint64_t seed) : state_(seed ? seed : 0x6a09e667f3bcc909ULL) {}

  uint64_t next() {
    state_ += 0x9e3779b97f4a7c15ULL;
    return mix64(state_);
  }

 private:
  uint64_t state_;
};

class LifeStepper {
 public:
  explicit LifeStepper(int size) : size_(size), mask_(size == 64 ? ~0ULL : ((1ULL << size) - 1ULL)) {}

  Board step(const Board& current) const {
    Board next{std::vector<uint64_t>(size_, 0)};
    for (int y = 0; y < size_; ++y) {
      const uint64_t up = current.rows[(y + size_ - 1) % size_];
      const uint64_t mid = current.rows[y];
      const uint64_t down = current.rows[(y + 1) % size_];
      uint64_t ones = 0, twos = 0, fours = 0, eights = 0;
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
    for (uint64_t row : board.rows) if (row) return false;
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

struct ReverseNode {
  Board state;
  std::vector<Lit> blockers;
  bool hadParent = false;
  uint64_t attemptStartConflicts = 0;
  uint64_t softConflictBudget = 0;
};

struct ReverseTask {
  std::vector<ReverseNode> path;
  int baseDepth = 0;
};

class SearchEngine {
 public:
  explicit SearchEngine(int size)
      : size(std::clamp(size, 3, 64)), stepper(this->size), scratch(this->size * this->size, 0) {}

  void startSoup(int densityBasisPoints, int horizon, uint64_t seed, int leaderboardSize) {
    soupDensity = std::clamp(densityBasisPoints, 1, 9999);
    soupHorizon = std::clamp(horizon, 1, 100000);
    soupLeaderboardSize = std::clamp(leaderboardSize, 1, 100);
    soupRng = std::make_unique<Random64>(seed);
    soupResults.clear();
    soupsSearched = 0;
    soupRunning = true;
    reverseRunning = false;
    extensionRunning = false;
    extensionStatus = 0;
  }

  int pumpSoup(int batchSize) {
    if (!soupRunning || !soupRng) return 0;
    const int count = std::clamp(batchSize, 1, 10000);
    for (int i = 0; i < count; ++i) evaluateSoup(randomSoup());
    return count;
  }

  void startReverse(const uint8_t* cells, int maximumDepth, int branchConflictBudget, uint64_t seed) {
    reverseSolver = std::make_unique<Solver>();
    reverseSolver->random_seed = static_cast<double>((seed % 1000003ULL) + 1ULL);
    reverseSolver->random_var_freq = 0.02;
    predVars.clear();
    outputVars.clear();
    predVars.reserve(size * size);
    outputVars.reserve(size * size);
    for (int i = 0; i < size * size; ++i) predVars.push_back(reverseSolver->newVar());
    for (int i = 0; i < size * size; ++i) outputVars.push_back(reverseSolver->newVar());
    encodeLifeTransition(predVars, outputVars);

    Board target{std::vector<uint64_t>(size, 0)};
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        if (cells[y * size + x]) target.rows[y] |= 1ULL << x;
      }
    }
    reverseInitialBranchBudget = static_cast<uint64_t>(
        std::clamp(branchConflictBudget, 1000, 1000000000));
    reversePath.clear();
    reversePath.push_back({target, {}, false, reverseSolver->conflicts, reverseInitialBranchBudget});
    reverseTaskBaseDepth = 0;
    deferredTasks.clear();
    bestPath.clear();
    bestPath.push_back(target);
    reverseMaxDepth = std::max(0, maximumDepth);
    reverseParents = 0;
    reverseBacktracks = 0;
    reverseCyclePrunes = 0;
    reverseGoeLeaves = 0;
    reverseDepthCuts = 0;
    reverseDeferrals = 0;
    reverseTaskResumes = 0;
    reverseStatus = 1;
    reverseRunning = true;
    extensionRunning = false;
    extensionStatus = 0;
    soupRunning = false;
  }

  void startExtension(const uint8_t* targetCells, const uint8_t* excludedCells,
                      int transitionDepth, uint64_t seed) {
    reverseSolver = std::make_unique<Solver>();
    reverseSolver->random_seed = static_cast<double>((seed % 1000003ULL) + 1ULL);
    reverseSolver->random_var_freq = 0.01 + static_cast<double>(seed % 10ULL) * 0.01;
    reverseSolver->rnd_init_act = true;
    Random64 polarityRng(seed ^ 0x9e3779b97f4a7c15ULL);

    extensionDepth = std::clamp(transitionDepth, 1, 16);
    extensionLayers.assign(extensionDepth + 1, {});
    for (std::vector<Var>& layer : extensionLayers) {
      layer.reserve(size * size);
      for (int i = 0; i < size * size; ++i) {
        layer.push_back(reverseSolver->newVar((polarityRng.next() & 1ULL) != 0));
      }
    }
    for (int depth = 0; depth < extensionDepth; ++depth) {
      encodeLifeTransition(extensionLayers[depth], extensionLayers[depth + 1]);
    }

    const std::vector<Var>& targetVars = extensionLayers.back();
    for (int i = 0; i < size * size; ++i) {
      const Lit target = mkLit(targetVars[i]);
      addClause({targetCells[i] ? target : ~target});
    }

    std::vector<Lit> differsFromInput;
    differsFromInput.reserve(size * size);
    for (int i = 0; i < size * size; ++i) {
      const Lit candidate = mkLit(extensionLayers.front()[i]);
      differsFromInput.push_back(excludedCells[i] ? ~candidate : candidate);
    }
    addClause(differsFromInput);

    extensionResult = Board{std::vector<uint64_t>(size, 0)};
    extensionRejected = 0;
    extensionStatus = 1;
    extensionRunning = true;
    reverseRunning = false;
    reverseStatus = 0;
    soupRunning = false;
  }

  int pumpExtension(int conflictBudget) {
    if (!extensionRunning || !reverseSolver) return extensionStatus;
    Minisat::vec<Lit> assumptions;
    reverseSolver->setConfBudget(std::clamp(conflictBudget, 10, 1000000));
    const Minisat::lbool answer = reverseSolver->solveLimited(assumptions);
    if (answer == l_Undef) return extensionStatus;
    if (answer == l_False) {
      extensionRunning = false;
      extensionStatus = 3;
      return extensionStatus;
    }

    extensionResult = Board{std::vector<uint64_t>(size, 0)};
    for (int i = 0; i < size * size; ++i) {
      if (reverseSolver->modelValue(extensionLayers.front()[i]) == l_True) {
        extensionResult.rows[i / size] |= 1ULL << (i % size);
      }
    }
    extensionRunning = false;
    extensionStatus = 2;
    return extensionStatus;
  }

  void rejectExtensionResult() {
    if (extensionStatus != 2 || !reverseSolver || extensionLayers.empty()) return;
    std::vector<Lit> blocker;
    blocker.reserve(size * size);
    for (int i = 0; i < size * size; ++i) {
      const Lit candidate = mkLit(extensionLayers.front()[i]);
      const bool alive = (extensionResult.rows[i / size] >> (i % size)) & 1ULL;
      blocker.push_back(alive ? ~candidate : candidate);
    }
    addClause(blocker);
    ++extensionRejected;
    extensionRunning = true;
    extensionStatus = 1;
  }

  int pumpReverse(int conflictBudget) {
    if (!reverseRunning || !reverseSolver || reversePath.empty()) return reverseStatus;
    if (reverseMaxDepth > 0 && static_cast<int>(reversePath.size()) - 1 >= reverseMaxDepth) {
      ++reverseDepthCuts;
      backtrack();
      return reverseStatus;
    }

    ReverseNode& node = reversePath.back();
    Minisat::vec<Lit> assumptions;
    for (int i = 0; i < size * size; ++i) {
      const bool alive = (node.state.rows[i / size] >> (i % size)) & 1ULL;
      assumptions.push(mkLit(outputVars[i], !alive));
    }
    for (Lit blocker : node.blockers) assumptions.push(blocker);

    reverseSolver->setConfBudget(std::clamp(conflictBudget, 10, 1000000));
    const Minisat::lbool answer = reverseSolver->solveLimited(assumptions);
    if (answer == l_Undef) {
      if (reverseSolver->conflicts - node.attemptStartConflicts >= node.softConflictBudget) {
        deferCurrentNode();
      }
      reverseStatus = 1;
      return reverseStatus;
    }
    if (answer == l_False) {
      if (!node.hadParent) ++reverseGoeLeaves;
      backtrack();
      return reverseStatus;
    }

    Board parent{std::vector<uint64_t>(size, 0)};
    for (int i = 0; i < size * size; ++i) {
      if (reverseSolver->modelValue(predVars[i]) == l_True) {
        parent.rows[i / size] |= 1ULL << (i % size);
      }
    }
    addParentBlocker(node, parent);
    node.hadParent = true;
    ++reverseParents;

    if (onCurrentPath(parent)) {
      ++reverseCyclePrunes;
      node.attemptStartConflicts = reverseSolver->conflicts;
      reverseStatus = 1;
      return reverseStatus;
    }

    reversePath.push_back({std::move(parent), {}, false, reverseSolver->conflicts, reverseInitialBranchBudget});
    if (reversePath.size() > bestPath.size()) {
      bestPath.clear();
      bestPath.reserve(reversePath.size());
      for (const ReverseNode& pathNode : reversePath) bestPath.push_back(pathNode.state);
    }
    reverseStatus = 1;
    return reverseStatus;
  }

  void stop() {
    soupRunning = false;
    reverseRunning = false;
    extensionRunning = false;
    if (reverseSolver) reverseSolver->interrupt();
  }

  const uint8_t* soupResultCells(int index) {
    if (index < 0 || index >= static_cast<int>(soupResults.size())) return nullptr;
    fillScratch(soupResults[index].seed);
    return scratch.data();
  }

  const uint8_t* bestLayerCells(int chronologicalIndex) {
    if (chronologicalIndex < 0 || chronologicalIndex >= static_cast<int>(bestPath.size())) return nullptr;
    const int pathIndex = static_cast<int>(bestPath.size()) - 1 - chronologicalIndex;
    fillScratch(bestPath[pathIndex]);
    return scratch.data();
  }

  const uint8_t* extensionResultCells() {
    if (extensionStatus != 2) return nullptr;
    fillScratch(extensionResult);
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

  bool reverseRunning = false;
  int reverseMaxDepth = 0;
  int reverseStatus = 0;  // 0 idle, 1 running, 2 complete
  uint64_t reverseParents = 0;
  uint64_t reverseBacktracks = 0;
  uint64_t reverseCyclePrunes = 0;
  uint64_t reverseGoeLeaves = 0;
  uint64_t reverseDepthCuts = 0;
  uint64_t reverseDeferrals = 0;
  uint64_t reverseTaskResumes = 0;
  uint64_t reverseInitialBranchBudget = 250000;
  int reverseTaskBaseDepth = 0;
  bool extensionRunning = false;
  int extensionStatus = 0;  // 0 idle, 1 running, 2 found, 3 unsatisfiable
  int extensionDepth = 1;
  uint64_t extensionRejected = 0;
  std::unique_ptr<Solver> reverseSolver;
  std::vector<Var> predVars;
  std::vector<Var> outputVars;
  std::vector<ReverseNode> reversePath;
  std::deque<ReverseTask> deferredTasks;
  std::vector<Board> bestPath;
  Board extensionResult;
  std::vector<std::vector<Var>> extensionLayers;
  std::vector<uint8_t> scratch;

 private:
  void fillScratch(const Board& board) {
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        scratch[y * size + x] = static_cast<uint8_t>((board.rows[y] >> x) & 1ULL);
      }
    }
  }

  Board randomSoup() {
    Board board{std::vector<uint64_t>(size, 0)};
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) {
        if (static_cast<int>(soupRng->next() % 10000ULL) < soupDensity) board.rows[y] |= 1ULL << x;
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

    SoupResult result{std::move(seed), lifetime, reason, soupsSearched++};
    soupResults.push_back(std::move(result));
    std::stable_sort(soupResults.begin(), soupResults.end(), [](const SoupResult& a, const SoupResult& b) {
      if (a.lifetime != b.lifetime) return a.lifetime > b.lifetime;
      return a.serial < b.serial;
    });
    if (static_cast<int>(soupResults.size()) > soupLeaderboardSize) soupResults.resize(soupLeaderboardSize);
  }

  void addClause(std::initializer_list<Lit> literals) {
    Minisat::vec<Lit> clause;
    for (Lit literal : literals) clause.push(literal);
    reverseSolver->addClause(clause);
  }

  void addClause(const std::vector<Lit>& literals) {
    Minisat::vec<Lit> clause;
    for (Lit literal : literals) clause.push(literal);
    reverseSolver->addClause(clause);
  }

  Lit freshLit() { return mkLit(reverseSolver->newVar()); }

  void encodeTruthGate(const std::vector<Lit>& inputs, Lit output,
                       const std::function<bool(int)>& truth) {
    const int combinations = 1 << static_cast<int>(inputs.size());
    for (int bits = 0; bits < combinations; ++bits) {
      const bool expected = truth(bits);
      for (int wrong = 0; wrong <= 1; ++wrong) {
        if (static_cast<bool>(wrong) == expected) continue;
        std::vector<Lit> clause;
        clause.reserve(inputs.size() + 1);
        for (int i = 0; i < static_cast<int>(inputs.size()); ++i) {
          const bool value = (bits >> i) & 1;
          clause.push_back(value ? ~inputs[i] : inputs[i]);
        }
        clause.push_back(wrong ? ~output : output);
        addClause(clause);
      }
    }
  }

  std::pair<Lit, Lit> halfAdder(Lit a, Lit b) {
    Lit sum = freshLit();
    Lit carry = freshLit();
    encodeTruthGate({a, b}, sum, [](int bits) { return ((bits & 1) != 0) ^ ((bits & 2) != 0); });
    encodeTruthGate({a, b}, carry, [](int bits) { return (bits & 3) == 3; });
    return {sum, carry};
  }

  std::pair<Lit, Lit> fullAdder(Lit a, Lit b, Lit c) {
    Lit sum = freshLit();
    Lit carry = freshLit();
    encodeTruthGate({a, b, c}, sum, [](int bits) {
      return (__builtin_popcount(static_cast<unsigned>(bits)) & 1) != 0;
    });
    encodeTruthGate({a, b, c}, carry, [](int bits) {
      return __builtin_popcount(static_cast<unsigned>(bits)) >= 2;
    });
    return {sum, carry};
  }

  void encodeCell(int x, int y, const std::vector<Var>& inputVars,
                  const std::vector<Var>& resultVars) {
    auto pred = [&](int dx, int dy) {
      const int px = (x + dx + size) % size;
      const int py = (y + dy + size) % size;
      return mkLit(inputVars[py * size + px]);
    };
    const Lit center = pred(0, 0);
    const Lit n0 = pred(-1, -1), n1 = pred(0, -1), n2 = pred(1, -1);
    const Lit n3 = pred(-1, 0), n4 = pred(1, 0);
    const Lit n5 = pred(-1, 1), n6 = pred(0, 1), n7 = pred(1, 1);

    const auto a0 = fullAdder(n0, n1, n2);
    const auto a1 = fullAdder(n3, n4, n5);
    const auto a2 = halfAdder(n6, n7);
    const auto low = fullAdder(a0.first, a1.first, a2.first);
    const auto high0 = fullAdder(a0.second, a1.second, a2.second);
    const auto high1 = halfAdder(high0.first, low.second);
    const auto high2 = halfAdder(high0.second, high1.second);
    const Lit bit0 = low.first;
    const Lit bit1 = high1.first;
    const Lit bit2 = high2.first;
    const Lit bit3 = high2.second;

    const Lit aliveTerm = freshLit();
    addClause({~bit0, aliveTerm});
    addClause({~center, aliveTerm});
    addClause({~aliveTerm, bit0, center});

    const Lit output = mkLit(resultVars[y * size + x]);
    addClause({~output, ~bit3});
    addClause({~output, ~bit2});
    addClause({~output, bit1});
    addClause({~output, aliveTerm});
    addClause({output, bit3, bit2, ~bit1, ~aliveTerm});
  }

  void encodeLifeTransition(const std::vector<Var>& inputVars,
                            const std::vector<Var>& resultVars) {
    for (int y = 0; y < size; ++y) {
      for (int x = 0; x < size; ++x) encodeCell(x, y, inputVars, resultVars);
    }
  }

  void addParentBlocker(ReverseNode& node, const Board& parent) {
    const Lit activation = freshLit();
    std::vector<Lit> clause;
    clause.reserve(size * size + 1);
    clause.push_back(~activation);
    for (int i = 0; i < size * size; ++i) {
      const Lit pred = mkLit(predVars[i]);
      const bool alive = (parent.rows[i / size] >> (i % size)) & 1ULL;
      clause.push_back(alive ? ~pred : pred);
    }
    addClause(clause);
    node.blockers.push_back(activation);
  }

  bool onCurrentPath(const Board& candidate) const {
    for (const ReverseNode& node : reversePath) if (node.state == candidate) return true;
    return false;
  }

  bool resumeDeferredTask() {
    if (deferredTasks.empty()) return false;
    ReverseTask task = std::move(deferredTasks.front());
    deferredTasks.pop_front();
    reversePath = std::move(task.path);
    reverseTaskBaseDepth = task.baseDepth;
    if (!reversePath.empty()) reversePath.back().attemptStartConflicts = reverseSolver->conflicts;
    ++reverseTaskResumes;
    reverseStatus = 1;
    return true;
  }

  void finishCurrentTask() {
    reversePath.clear();
    if (!resumeDeferredTask()) {
      reverseRunning = false;
      reverseStatus = 2;
    }
  }

  void deferCurrentNode() {
    const int depth = static_cast<int>(reversePath.size()) - 1;
    ReverseTask deferred{reversePath, depth};
    // Ancestors are retained only for cycle detection and display; this task
    // will never search above its base, so their growing blocker lists are dead weight.
    for (int i = 0; i < depth; ++i) deferred.path[i].blockers.clear();
    ReverseNode& deferredNode = deferred.path.back();
    deferredNode.softConflictBudget = std::min<uint64_t>(
        deferredNode.softConflictBudget * 2ULL, 1000000000ULL);
    deferredNode.attemptStartConflicts = reverseSolver->conflicts;
    deferredTasks.push_back(std::move(deferred));
    ++reverseDeferrals;

    if (depth <= reverseTaskBaseDepth) {
      finishCurrentTask();
      return;
    }

    reversePath.pop_back();
    ++reverseBacktracks;
    reversePath.back().attemptStartConflicts = reverseSolver->conflicts;

    // Do not let a stream of fresh siblings starve older hard subtrees. Move
    // the active task to the back of the queue every fourth deferral.
    if (reverseDeferrals % 4 == 0 && !deferredTasks.empty()) {
      deferredTasks.push_back({std::move(reversePath), reverseTaskBaseDepth});
      resumeDeferredTask();
    }
    reverseStatus = 1;
  }

  void backtrack() {
    const int depth = static_cast<int>(reversePath.size()) - 1;
    if (depth <= reverseTaskBaseDepth) {
      finishCurrentTask();
      return;
    }
    reversePath.pop_back();
    ++reverseBacktracks;
    reversePath.back().attemptStartConflicts = reverseSolver->conflicts;
    reverseStatus = 1;
  }
};

SearchEngine* asEngine(uintptr_t handle) {
  return reinterpret_cast<SearchEngine*>(handle);
}

uint64_t joinSeed(uint32_t low, uint32_t high) {
  return static_cast<uint64_t>(low) | (static_cast<uint64_t>(high) << 32);
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

LIFE_EXPORT void life_start_soup(uintptr_t handle, int densityBasisPoints, int horizon,
                                 uint32_t seedLow, uint32_t seedHigh, int leaderboardSize) {
  if (SearchEngine* engine = asEngine(handle)) {
    engine->startSoup(densityBasisPoints, horizon, joinSeed(seedLow, seedHigh), leaderboardSize);
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
      ? engine->soupResults[index].lifetime : 0;
}

LIFE_EXPORT int life_soup_result_reason(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine && index >= 0 && index < static_cast<int>(engine->soupResults.size())
      ? engine->soupResults[index].reason : 0;
}

LIFE_EXPORT const uint8_t* life_soup_result_cells(uintptr_t handle, int index) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->soupResultCells(index) : nullptr;
}

LIFE_EXPORT void life_start_reverse(uintptr_t handle, const uint8_t* cells, int maxDepth,
                                    int branchConflictBudget, uint32_t seedLow, uint32_t seedHigh) {
  if (SearchEngine* engine = asEngine(handle)) {
    engine->startReverse(cells, maxDepth, branchConflictBudget, joinSeed(seedLow, seedHigh));
  }
}

LIFE_EXPORT int life_reverse_pump(uintptr_t handle, int conflictBudget) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->pumpReverse(conflictBudget) : 0;
}

LIFE_EXPORT int life_reverse_status(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->reverseStatus : 0;
}

LIFE_EXPORT int life_reverse_current_depth(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine && !engine->reversePath.empty() ? static_cast<int>(engine->reversePath.size()) - 1 : 0;
}

LIFE_EXPORT int life_reverse_best_length(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<int>(engine->bestPath.size()) : 0;
}

LIFE_EXPORT const uint8_t* life_reverse_best_layer(uintptr_t handle, int chronologicalIndex) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->bestLayerCells(chronologicalIndex) : nullptr;
}

LIFE_EXPORT double life_reverse_parents(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseParents) : 0;
}

LIFE_EXPORT double life_reverse_backtracks(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseBacktracks) : 0;
}

LIFE_EXPORT double life_reverse_cycle_prunes(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseCyclePrunes) : 0;
}

LIFE_EXPORT double life_reverse_goe_leaves(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseGoeLeaves) : 0;
}

LIFE_EXPORT double life_reverse_depth_cuts(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseDepthCuts) : 0;
}

LIFE_EXPORT double life_reverse_conflicts(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine && engine->reverseSolver ? static_cast<double>(engine->reverseSolver->conflicts) : 0;
}

LIFE_EXPORT double life_reverse_node_conflicts(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  if (!engine || !engine->reverseSolver || engine->reversePath.empty()) return 0;
  return static_cast<double>(engine->reverseSolver->conflicts -
                             engine->reversePath.back().attemptStartConflicts);
}

LIFE_EXPORT double life_reverse_node_budget(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine && !engine->reversePath.empty()
      ? static_cast<double>(engine->reversePath.back().softConflictBudget) : 0;
}

LIFE_EXPORT double life_reverse_deferrals(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseDeferrals) : 0;
}

LIFE_EXPORT double life_reverse_deferred_count(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->deferredTasks.size()) : 0;
}

LIFE_EXPORT double life_reverse_task_resumes(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->reverseTaskResumes) : 0;
}

LIFE_EXPORT void life_start_extension(uintptr_t handle, const uint8_t* targetCells,
                                      const uint8_t* excludedCells, int transitionDepth,
                                      uint32_t seedLow, uint32_t seedHigh) {
  if (SearchEngine* engine = asEngine(handle)) {
    engine->startExtension(targetCells, excludedCells, transitionDepth,
                           joinSeed(seedLow, seedHigh));
  }
}

LIFE_EXPORT int life_extension_pump(uintptr_t handle, int conflictBudget) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->pumpExtension(conflictBudget) : 0;
}

LIFE_EXPORT int life_extension_status(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->extensionStatus : 0;
}

LIFE_EXPORT double life_extension_conflicts(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine && engine->reverseSolver ? static_cast<double>(engine->reverseSolver->conflicts) : 0;
}

LIFE_EXPORT double life_extension_rejected(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? static_cast<double>(engine->extensionRejected) : 0;
}

LIFE_EXPORT const uint8_t* life_extension_result_cells(uintptr_t handle) {
  SearchEngine* engine = asEngine(handle);
  return engine ? engine->extensionResultCells() : nullptr;
}

LIFE_EXPORT void life_extension_reject_result(uintptr_t handle) {
  if (SearchEngine* engine = asEngine(handle)) engine->rejectExtensionResult();
}

LIFE_EXPORT void life_step(int size, const uint8_t* input, uint8_t* output) {
  size = std::clamp(size, 3, 64);
  Board board{std::vector<uint64_t>(size, 0)};
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) if (input[y * size + x]) board.rows[y] |= 1ULL << x;
  }
  Board next = LifeStepper(size).step(board);
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) output[y * size + x] = static_cast<uint8_t>((next.rows[y] >> x) & 1ULL);
  }
}

LIFE_EXPORT int life_measure_lifetime(int size, const uint8_t* input, int horizon) {
  size = std::clamp(size, 3, 64);
  horizon = std::clamp(horizon, 1, 100000);
  Board current{std::vector<uint64_t>(size, 0)};
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) if (input[y * size + x]) current.rows[y] |= 1ULL << x;
  }
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
      for (int index : found->second) if (history[index] == current) { repeated = true; break; }
    }
    if (repeated) { reason = 2; break; }
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
