import assert from 'node:assert/strict';
import { createLifeSearchEngine } from '../src/life/searchEngineWasm.js';
import {
  MAX_LIFE_SEARCH_WORKERS,
  getLifeSearchWorkerLimit,
  normalizeLifeSearchSettings,
  normalizeLifeSearchWorkers,
  tuneLifeSearchBatch,
} from '../src/life/searchLimits.js';

assert.equal(normalizeLifeSearchWorkers(0), 1, 'worker pool has a minimum');
assert.equal(normalizeLifeSearchWorkers(3.6), 4, 'worker pool rounds numeric input');
assert.equal(normalizeLifeSearchWorkers(1000000), MAX_LIFE_SEARCH_WORKERS, 'worker pool has a hard maximum');
assert.equal(getLifeSearchWorkerLimit(6), 4, 'worker pool leaves capacity for the page');
assert.equal(getLifeSearchWorkerLimit(2), 1, 'small systems retain one worker');
assert.equal(getLifeSearchWorkerLimit(64), MAX_LIFE_SEARCH_WORKERS, 'large systems use the hard maximum');
assert.equal(normalizeLifeSearchWorkers(1000, getLifeSearchWorkerLimit(6)), 4, 'worker input uses the hardware ceiling');
assert.deepEqual(
  normalizeLifeSearchSettings({
    size: Infinity,
    density: 0,
    horizon: Infinity,
    batchSize: -5,
    leaderboardSize: 0,
  }),
  { size: 64, density: 0.01, horizon: 0x7fffffff, batchSize: 1, leaderboardSize: 1 },
  'search settings clamp finite ranges',
);
assert.deepEqual(
  normalizeLifeSearchSettings({}),
  { size: 16, density: 37.5, horizon: 0, batchSize: 32, leaderboardSize: 10 },
  'search settings apply defaults',
);
assert.equal(tuneLifeSearchBatch(32, 32, 1), 80, 'batch tuning grows toward its time budget');
assert.equal(tuneLifeSearchBatch(32, 32, 64), 24, 'batch tuning shrinks gradually');
assert.equal(tuneLifeSearchBatch(10000, 10000, 1), 10000, 'batch tuning honors its maximum');
assert.equal(tuneLifeSearchBatch(32, 0, 0), 32, 'batch tuning ignores empty timing samples');

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

function equalBoard(actual, expected, label) {
  assert.deepEqual(Array.from(actual), Array.from(expected), label);
}

function referenceOrbit(seed, size, horizon) {
  let current = seed.slice();
  const seen = new Map();
  let generation = 0;
  while (true) {
    if (!current.some(Boolean)) {
      return { lifetime: generation, reason: 1, transient: 0, period: 0 };
    }
    const key = Array.from(current).join('');
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      return {
        lifetime: generation,
        reason: 2,
        transient: firstSeen,
        period: generation - firstSeen,
      };
    }
    if (horizon > 0 && generation >= horizon) {
      return { lifetime: horizon, reason: 3, transient: 0, period: 0 };
    }
    seen.set(key, generation);
    current = referenceStep(current, size);
    generation++;
  }
}

// Bit-parallel WASM evolution must match the browser's scalar Conway rule.
for (const size of [8, 16, 17, 32, 64]) {
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

// Orbit shortcuts and bounded fallback must agree with exact state history.
const differentialEngine = await createLifeSearchEngine(5);
let differentialState = 0x8badf00d;
for (let sample = 0; sample < 20; sample++) {
  const cells = new Uint8Array(25);
  for (let i = 0; i < cells.length; i++) {
    differentialState = (Math.imul(differentialState, 1664525) + 1013904223) >>> 0;
    cells[i] = differentialState >>> 30 ? 1 : 0;
  }
  for (const horizon of [0, 1, 2, 3, 7, 25, 100]) {
    assert.deepEqual(
      differentialEngine.measureOrbit(cells, horizon),
      referenceOrbit(cells, 5, horizon),
      `orbit 5 sample ${sample} horizon ${horizon}`,
    );
  }
}
differentialEngine.destroy();

const differential16Engine = await createLifeSearchEngine(16);
let differential16State = 0x51ced00d;
for (let sample = 0; sample < 6; sample++) {
  const cells = new Uint8Array(16 * 16);
  for (let i = 0; i < cells.length; i++) {
    differential16State = (Math.imul(differential16State, 1664525) + 1013904223) >>> 0;
    cells[i] = differential16State >>> 30 ? 1 : 0;
  }
  for (const horizon of [1, 2, 3, 7, 25]) {
    assert.deepEqual(
      differential16Engine.measureOrbit(cells, horizon),
      referenceOrbit(cells, 16, horizon),
      `orbit 16 sample ${sample} horizon ${horizon}`,
    );
  }
}
differential16Engine.destroy();

// Lifetime is the number of unique non-empty states before empty/repeat/horizon.
const lifetimeEngine = await createLifeSearchEngine(8);
const empty = new Uint8Array(64);
assert.deepEqual(lifetimeEngine.measureLifetime(empty, 100), { lifetime: 0, reason: 1 });
assert.deepEqual(lifetimeEngine.measureOrbit(empty, 0), { lifetime: 0, reason: 1, transient: 0, period: 0 });
const block = new Uint8Array(64);
for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) block[y * 8 + x] = 1;
assert.deepEqual(lifetimeEngine.measureLifetime(block, 100), { lifetime: 1, reason: 2 });
assert.deepEqual(lifetimeEngine.measureOrbit(block, 0), { lifetime: 1, reason: 2, transient: 0, period: 1 });
const oscillator = new Uint8Array(64);
oscillator[3 * 8 + 2] = oscillator[3 * 8 + 3] = oscillator[3 * 8 + 4] = 1;
assert.deepEqual(lifetimeEngine.measureLifetime(oscillator, 100), { lifetime: 2, reason: 2 });
assert.deepEqual(lifetimeEngine.measureOrbit(oscillator, 0), { lifetime: 2, reason: 2, transient: 0, period: 2 });
assert.deepEqual(lifetimeEngine.measureLifetime(oscillator, 1), { lifetime: 1, reason: 3 });
const transientOscillator = oscillator.slice();
transientOscillator[7 * 8 + 7] = 1;
assert.deepEqual(lifetimeEngine.measureOrbit(transientOscillator, 0), { lifetime: 3, reason: 2, transient: 1, period: 2 });

const pulsarEngine = await createLifeSearchEngine(17);
const pulsar = new Uint8Array(17 * 17);
const pulsarRows = [
  '..111...111..',
  '.............',
  '1....1.1....1',
  '1....1.1....1',
  '1....1.1....1',
  '..111...111..',
  '.............',
  '..111...111..',
  '1....1.1....1',
  '1....1.1....1',
  '1....1.1....1',
  '.............',
  '..111...111..',
];
for (let y = 0; y < pulsarRows.length; y++) {
  for (let x = 0; x < pulsarRows[y].length; x++) {
    if (pulsarRows[y][x] === '1') pulsar[(y + 2) * 17 + x + 2] = 1;
  }
}
assert.deepEqual(pulsarEngine.measureOrbit(pulsar, 0), { lifetime: 3, reason: 2, transient: 0, period: 3 });
assert.deepEqual(pulsarEngine.measureOrbit(pulsar, 2), { lifetime: 2, reason: 3, transient: 0, period: 0 });
assert.deepEqual(pulsarEngine.measureOrbit(pulsar, 3), { lifetime: 3, reason: 2, transient: 0, period: 3 });
pulsarEngine.destroy();

const clampedEngine = await createLifeSearchEngine(1000);
assert.equal(clampedEngine.size, 64, 'wrapper and native engine agree on clamped size');
assert.equal(clampedEngine.step(new Uint8Array(64 * 64)).length, 64 * 64, 'clamped engine uses safe buffers');
clampedEngine.destroy();

const soupConfig = { density: 37.5, horizon: 200, seed: 123456789n, leaderboardSize: 5 };
lifetimeEngine.startSoup(soupConfig);
lifetimeEngine.pumpSoup(25);
const firstRun = lifetimeEngine.soupSnapshot();
lifetimeEngine.startSoup(soupConfig);
lifetimeEngine.pumpSoup(25);
const secondRun = lifetimeEngine.soupSnapshot();
assert.equal(secondRun.searched, firstRun.searched, 'deterministic soup count');
assert.deepEqual(
  secondRun.results.map(({ lifetime, transient, period, reason, cells }) => [lifetime, transient, period, reason, Array.from(cells)]),
  firstRun.results.map(({ lifetime, transient, period, reason, cells }) => [lifetime, transient, period, reason, Array.from(cells)]),
  'deterministic soup leaderboard'
);
assert.deepEqual(
  secondRun.loops.map(({ lifetime, transient, period, cells }) => [lifetime, transient, period, Array.from(cells)]),
  firstRun.loops.map(({ lifetime, transient, period, cells }) => [lifetime, transient, period, Array.from(cells)]),
  'deterministic loop leaderboard'
);
assert.ok(secondRun.loops.every((result) => result.period > 2), 'loop leaderboard excludes periods 1 and 2');
lifetimeEngine.stop();
const stoppedAt = lifetimeEngine.soupSnapshot().searched;
assert.equal(lifetimeEngine.pumpSoup(5), 0, 'stopped search does not advance');
lifetimeEngine.resume();
assert.equal(lifetimeEngine.pumpSoup(5), 5, 'resumed search accepts more work');
assert.equal(lifetimeEngine.soupSnapshot().searched, stoppedAt + 5, 'resumed search keeps its soup count');
lifetimeEngine.destroy();

const goldenEngine = await createLifeSearchEngine(16);
goldenEngine.startSoup({ density: 37.5, horizon: 0, seed: 0x5eedn, leaderboardSize: 10 });
goldenEngine.pumpSoup(1000);
const golden = goldenEngine.soupSnapshot();
const best = golden.results[0];
let checksum = 2166136261;
for (const cell of best.cells) checksum = Math.imul(checksum ^ cell, 16777619) >>> 0;
assert.deepEqual(
  { lifetime: best.lifetime, transient: best.transient, period: best.period, reason: best.reason },
  { lifetime: 698, transient: 696, period: 2, reason: 2 },
  'golden soup result metrics',
);
assert.equal(checksum.toString(16).padStart(8, '0'), '7ff074fb', 'golden soup result cells');
assert.equal(golden.loops[0].period, 64, 'golden loop period');
assert.deepEqual(
  golden.results.map(({ lifetime, transient, period, serial }) =>
    [lifetime, transient, period, serial]),
  [
    [698, 696, 2, 91],
    [647, 0, 0, 180],
    [569, 567, 2, 671],
    [568, 566, 2, 667],
    [559, 557, 2, 375],
    [551, 550, 1, 401],
    [549, 548, 1, 82],
    [535, 533, 2, 963],
    [525, 523, 2, 452],
    [514, 512, 2, 522],
  ],
  'golden lifetime leaderboard order',
);
assert.deepEqual(
  golden.loops.map(({ lifetime, transient, period, serial }) =>
    [lifetime, transient, period, serial]),
  [
    [330, 266, 64, 562],
    [301, 237, 64, 929],
    [250, 186, 64, 861],
    [242, 178, 64, 636],
    [231, 167, 64, 40],
    [212, 148, 64, 946],
    [201, 137, 64, 428],
    [154, 90, 64, 72],
    [152, 88, 64, 867],
    [142, 78, 64, 379],
  ],
  'golden loop leaderboard order',
);
assert.deepEqual(
  goldenEngine.measureOrbit(golden.loops[0].cells, 0),
  { lifetime: 330, reason: 2, transient: 266, period: 64 },
  'loop results load from their original seed',
);
goldenEngine.destroy();

console.log('life soup search: forward equivalence, lifetime, and determinism passed');
