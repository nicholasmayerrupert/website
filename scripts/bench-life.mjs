import { performance } from 'node:perf_hooks';
import { createLifeSearchEngine } from '../src/life/searchEngineWasm.js';

const engine = await createLifeSearchEngine(16);
engine.startSoup({ density: 37.5, horizon: 1000, seed: 0x5eedn, leaderboardSize: 10 });
const soupStart = performance.now();
engine.pumpSoup(1000);
const soupMs = performance.now() - soupStart;
const soup = engine.soupSnapshot();

const best = soup.results[0];
let checksum = 2166136261;
for (const cell of best.cells) checksum = Math.imul(checksum ^ cell, 16777619) >>> 0;
console.log(JSON.stringify({
  board: '16x16 B3/S23 torus',
  soups: soup.searched,
  soupsPerSecond: Math.round(soup.searched * 1000 / soupMs),
  bestLifetime: best.lifetime,
  leaderboardChecksum: checksum.toString(16).padStart(8, '0'),
}, null, 2));
engine.destroy();
