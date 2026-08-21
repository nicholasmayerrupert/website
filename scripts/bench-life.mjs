import { performance } from 'node:perf_hooks';
import { createLifeSearchEngine } from '../src/life/searchEngineWasm.js';

const engine = await createLifeSearchEngine(16);
const config = { density: 37.5, horizon: 0, seed: 0x5eedn, leaderboardSize: 10 };
const warmupSoups = 250;
const sampleSize = 5000;
const rounds = 7;
const rates = [];
engine.startSoup(config);
engine.pumpSoup(warmupSoups);
for (let round = 0; round < rounds; round++) {
  engine.startSoup(config);
  const soupStart = performance.now();
  engine.pumpSoup(sampleSize);
  const soupMs = performance.now() - soupStart;
  rates.push(sampleSize * 1000 / soupMs);
}
rates.sort((left, right) => left - right);
const soup = engine.soupSnapshot();

const best = soup.results[0];
let checksum = 2166136261;
for (const cell of best.cells) checksum = Math.imul(checksum ^ cell, 16777619) >>> 0;
console.log(JSON.stringify({
  board: '16x16 B3/S23 torus',
  warmupSoups,
  rounds,
  soupsPerRound: soup.searched,
  soupsPerSecond: Math.round(rates[Math.floor(rates.length / 2)]),
  slowestSoupsPerSecond: Math.round(rates[0]),
  fastestSoupsPerSecond: Math.round(rates.at(-1)),
  bestLifetime: best.lifetime,
  bestPeriod: soup.loops[0]?.period || 0,
  leaderboardChecksum: checksum.toString(16).padStart(8, '0'),
}, null, 2));
engine.destroy();
