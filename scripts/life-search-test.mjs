import assert from 'node:assert/strict';
import { createLifeSearchEngine } from '../src/life/searchEngineWasm.js';

function referenceStep(cells, size) {
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = (x + dx + size) % size;
          const ny = (y + dy + size) % size;
          neighbors += cells[ny * size + nx];
        }
      }
      const alive = cells[y * size + x];
      out[y * size + x] = neighbors === 3 || (alive && neighbors === 2) ? 1 : 0;
    }
  }
  return out;
}

function boardFromBits(bits, size) {
  const cells = new Uint8Array(size * size);
  for (let i = 0; i < cells.length; i++) cells[i] = (bits >> i) & 1;
  return cells;
}

function bitsFromBoard(cells) {
  let bits = 0;
  for (let i = 0; i < cells.length; i++) bits |= cells[i] << i;
  return bits;
}

function equalBoard(actual, expected, label) {
  assert.deepEqual(Array.from(actual), Array.from(expected), label);
}

// Bit-parallel WASM evolution must match the browser's scalar Conway rule.
for (const size of [8, 17, 32, 64]) {
  const engine = await createLifeSearchEngine(size);
  let state = 0x12345678 ^ size;
  for (let sample = 0; sample < 12; sample++) {
    const cells = new Uint8Array(size * size);
    for (let i = 0; i < cells.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      cells[i] = state >>> 29 ? 1 : 0;
    }
    equalBoard(engine.step(cells), referenceStep(cells, size), `forward ${size} sample ${sample}`);
  }
  engine.destroy();
}

// Exhaustively establish the predecessor relation for every 3x3 torus, then
// compare the exact SAT answer and verify every returned model in forward time.
const size = 3;
const predecessorExists = new Uint8Array(1 << (size * size));
for (let predecessor = 0; predecessor < predecessorExists.length; predecessor++) {
  predecessorExists[bitsFromBoard(referenceStep(boardFromBits(predecessor, size), size))] = 1;
}
const exact = await createLifeSearchEngine(size);
let gardens = 0;
for (let targetBits = 0; targetBits < predecessorExists.length; targetBits++) {
  const target = boardFromBits(targetBits, size);
  exact.startReverse(target, { maxDepth: 1, seed: 7n });
  let snapshot;
  for (let attempts = 0; attempts < 100; attempts++) {
    exact.pumpReverse(1000000);
    snapshot = exact.reverseSnapshot(true);
    if (snapshot.parents > 0 || snapshot.status === 2) break;
  }
  assert.ok(snapshot.parents > 0 || snapshot.status === 2, `solver resolved target ${targetBits}`);
  assert.equal(snapshot.parents > 0, Boolean(predecessorExists[targetBits]), `predecessor existence ${targetBits}`);
  if (snapshot.bestDepth > 0) {
    equalBoard(exact.step(snapshot.layers[0]), target, `returned predecessor ${targetBits}`);
  } else if (snapshot.parents > 0) {
    equalBoard(exact.step(target), target, `cycle predecessor ${targetBits}`);
  } else {
    gardens++;
    assert.equal(snapshot.goeLeaves, 1, `Garden of Eden proof ${targetBits}`);
  }
}
assert.ok(gardens > 0, '3x3 torus includes at least one Garden of Eden');

// A stopped limited search stays unknown, while a depth cap is recorded as a cut.
const blinker = new Uint8Array(size * size);
blinker[3] = blinker[4] = blinker[5] = 1;
exact.startReverse(referenceStep(blinker, size), { maxDepth: 1, seed: 11n });
for (let i = 0; i < 10 && exact.reverseSnapshot().bestDepth < 1; i++) exact.pumpReverse(100000);
exact.pumpReverse(100000);
assert.ok(exact.reverseSnapshot().depthCuts >= 1, 'maximum depth produces a recorded cut');
exact.startReverse(referenceStep(blinker, size), { maxDepth: 0, seed: 11n });
exact.stop();
assert.equal(exact.reverseSnapshot().status, 1, 'stopped reverse work remains unknown');
exact.destroy();

// A difficult child must not monopolize depth-first search. Once its soft
// budget is spent, queue it and return to the target to try another parent.
const fair = await createLifeSearchEngine(16);
let fairSeed = 0x12345679;
const knownParent = new Uint8Array(16 * 16);
for (let i = 0; i < knownParent.length; i++) {
  fairSeed = (Math.imul(fairSeed, 1664525) + 1013904223) >>> 0;
  knownParent[i] = (fairSeed >>> 28) < 1 ? 1 : 0;
}
fair.startReverse(fair.step(knownParent), { maxDepth: 0, branchBudget: 1000, seed: 99n });
let fairSnapshot;
for (let i = 0; i < 20; i++) {
  fair.pumpReverse(1000);
  fairSnapshot = fair.reverseSnapshot();
  if (fairSnapshot.deferrals > 0) break;
}
assert.ok(fairSnapshot.deferrals > 0, 'hard reverse branch is deferred');
assert.ok(fairSnapshot.deferred > 0, 'deferred branch remains queued and unknown');
const parentsBeforeSibling = fairSnapshot.parents;
for (let i = 0; i < 20 && fairSnapshot.parents === parentsBeforeSibling; i++) {
  fair.pumpReverse(1000);
  fairSnapshot = fair.reverseSnapshot();
}
assert.ok(fairSnapshot.parents > parentsBeforeSibling, 'search returns to a sibling after deferral');
assert.equal(fairSnapshot.goeLeaves, 0, 'deferred unknown branch is not called a Garden of Eden');
for (let i = 0; i < 30 && fairSnapshot.taskResumes === 0; i++) {
  fair.pumpReverse(1000);
  fairSnapshot = fair.reverseSnapshot();
}
assert.ok(fairSnapshot.taskResumes > 0, 'older deferred work is eventually resumed');
assert.ok(fairSnapshot.nodeBudget >= 2000, 'resumed work receives a larger budget');
fair.destroy();

// Lifetime is the number of unique non-empty states before empty/repeat/horizon.
const lifetimeEngine = await createLifeSearchEngine(8);
const empty = new Uint8Array(64);
assert.deepEqual(lifetimeEngine.measureLifetime(empty, 100), { lifetime: 0, reason: 1 });
const block = new Uint8Array(64);
for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) block[y * 8 + x] = 1;
assert.deepEqual(lifetimeEngine.measureLifetime(block, 100), { lifetime: 1, reason: 2 });
const oscillator = new Uint8Array(64);
oscillator[3 * 8 + 2] = oscillator[3 * 8 + 3] = oscillator[3 * 8 + 4] = 1;
assert.deepEqual(lifetimeEngine.measureLifetime(oscillator, 100), { lifetime: 2, reason: 2 });
assert.deepEqual(lifetimeEngine.measureLifetime(oscillator, 1), { lifetime: 1, reason: 3 });

const soupConfig = { density: 37.5, horizon: 200, seed: 123456789n, leaderboardSize: 5 };
lifetimeEngine.startSoup(soupConfig);
lifetimeEngine.pumpSoup(25);
const firstRun = lifetimeEngine.soupSnapshot();
lifetimeEngine.startSoup(soupConfig);
lifetimeEngine.pumpSoup(25);
const secondRun = lifetimeEngine.soupSnapshot();
assert.equal(secondRun.searched, firstRun.searched, 'deterministic soup count');
assert.deepEqual(
  secondRun.results.map(({ lifetime, reason, cells }) => [lifetime, reason, Array.from(cells)]),
  firstRun.results.map(({ lifetime, reason, cells }) => [lifetime, reason, Array.from(cells)]),
  'deterministic soup leaderboard'
);
lifetimeEngine.destroy();

console.log(`life search: forward equivalence, all 512 reverse states (${gardens} GoE), fair reverse scheduling, lifetime, and determinism passed`);
