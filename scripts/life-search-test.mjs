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

console.log('life soup search: forward equivalence, lifetime, and determinism passed');
