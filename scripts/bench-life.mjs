import { performance } from 'node:perf_hooks';
import { createLifeSearchEngine } from '../src/life/searchEngineWasm.js';

const engine = await createLifeSearchEngine(16);
engine.startSoup({ density: 37.5, horizon: 1000, seed: 0x5eedn, leaderboardSize: 10 });
const soupStart = performance.now();
engine.pumpSoup(1000);
const soupMs = performance.now() - soupStart;
const soup = engine.soupSnapshot();

let state = 0x12345678;
let reverseMs = 0;
let reverseConflicts = 0;
for (let sample = 0; sample < 20; sample++) {
  const predecessor = new Uint8Array(16 * 16);
  for (let i = 0; i < predecessor.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    predecessor[i] = state >>> 30 ? 1 : 0;
  }
  const target = engine.step(predecessor);
  const started = performance.now();
  engine.startReverse(target, { maxDepth: 1, seed: BigInt(sample + 1) });
  for (let pump = 0; pump < 1000 && engine.reverseSnapshot().bestDepth < 1; pump++) {
    engine.pumpReverse(5000);
  }
  reverseMs += performance.now() - started;
  reverseConflicts += engine.reverseSnapshot().conflicts;
}

const best = soup.results[0];
let checksum = 2166136261;
for (const cell of best.cells) checksum = Math.imul(checksum ^ cell, 16777619) >>> 0;
console.log(JSON.stringify({
  board: '16x16 B3/S23 torus',
  soups: soup.searched,
  soupsPerSecond: Math.round(soup.searched * 1000 / soupMs),
  bestLifetime: best.lifetime,
  leaderboardChecksum: checksum.toString(16).padStart(8, '0'),
  reverseKnownSatSamples: 20,
  reverseMeanMs: +(reverseMs / 20).toFixed(3),
  reverseMeanConflicts: Math.round(reverseConflicts / 20),
}, null, 2));
engine.destroy();
