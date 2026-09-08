// Compare atomic capture time with synchronous saving; integrity stays identical.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { initSandWasm, createEngineWasm, PLANET } from '../src/sand/wasmBridge/engineFactory.js';

await initSandWasm();
const results = [];
for (const cols of [512, 768, 1024]) {
  const engine = createEngineWasm({ cols, rows: 352, infinite: true, sinksOn: false,
    planetId: PLANET.FRONTIER, worldSeed: 73 });
  try {
    engine.setSurvivalInventory(true); engine.spawnPlayer(200, 50);
    for (let i = 0; i < 200; i++) { engine.stepActors(); engine.stepWorld(); }
    for (let repeat = 0; repeat < 3; repeat++) {
      let yields = 0, maxGapMs = 0, last = performance.now();
      const timer = setInterval(() => {
        const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last); last = now; yields++;
      }, 0);
      let saved;
      const start = performance.now();
      const pending = engine.writeCheckpointAsync();
      const captureMs = performance.now() - start;
      try { saved = await pending; } finally { clearInterval(timer); }
      const completeMs = performance.now() - start;
      const syncStart = performance.now();
      const synchronous = engine.writeCheckpoint();
      const synchronousMs = performance.now() - syncStart;
      assert.ok(saved.length > 1000 && yields > 0);
      assert.deepEqual(saved, synchronous, 'both save paths must produce identical bytes');
      const result = { cols, repeat, bytes: saved.length, captureMs, completeMs, maxGapMs, yields, synchronousMs };
      results.push(result); console.log(JSON.stringify(result));
    }
  } finally { engine.destroy(); }
}
const json = process.argv.indexOf('--json');
if (json >= 0) writeFileSync(process.argv[json + 1], JSON.stringify(results, null, 2) + '\n');
