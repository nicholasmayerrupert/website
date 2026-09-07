// The captured cut detaches neutronium-bearing land at world tick 5768.
// Its crowded collision island must fall and retain the neutronium.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { decodeReplayCapsule } from '../src/sand/game/replayCapsule.js';
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';

const capsule = await decodeReplayCapsule(readFileSync(
  new URL('./neutronium-cut.sand-replay', import.meta.url), 'utf8',
));
await initSandWasm();
const mirror = createEngineWasm({
  cols: capsule.init.cols, rows: capsule.init.rows, storageRole: 'presentation',
});
const worker = new Worker(new URL('./world-worker-node-harness.mjs', import.meta.url));
let timer;
let finalWorld;
let lastTurn = 0;
try {
  const result = await new Promise((resolve, reject) => {
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new Error(
        `Neutronium cut replay stalled at turn ${lastTurn}/${capsule.turns}`,
      )), 30_000);
    };
    arm();
    worker.on('error', reject);
    worker.on('exit', (code) => reject(new Error(`Replay worker exited: ${code}`)));
    worker.on('message', (message) => {
      if (message?.type === 'harness-ready') {
        arm();
        worker.postMessage({ type: 'replay-run', requestId: 1, capsule });
      } else if (message?.type === 'replay-progress') {
        lastTurn = message.turn;
        arm();
      } else if (message?.type === 'full' && message.reason === 'replay') {
        finalWorld = message;
      } else if (message?.type === 'replay-complete') {
        resolve(message);
      } else if (message?.type === 'error' || message?.type === 'replay-error') {
        reject(new Error(message.message));
      }
    });
  });
  assert.equal(result.actual.actorTick, capsule.turns);
  assert.ok(result.actual.tick >= 6000, 'the replay advances beyond the support cut');
  assert.ok(finalWorld, 'the authority publishes the final world');
  assert.ok(mirror.applyWorldMirror(new Uint8Array(finalWorld.data),
    finalWorld.worldOffsetX, finalWorld.worldOffsetY));
  let count = 0, sumY = 0, minY = Infinity;
  for (const grid of [mirror.getGrid(), mirror.getGridBg()]) {
    for (let k = 0; k < grid.length; k++) {
      if (grid[k] !== MAT.NEUTRONIUM) continue;
      const y = Math.floor(k / mirror.cols) + finalWorld.worldOffsetY;
      count++;
      sumY += y;
      minY = Math.min(minY, y);
    }
  }
  assert.equal(count, 76, 'the falling chunk retains all neutronium cells');
  assert.ok(minY > 145,
    `the whole neutronium cluster falls from the cut near y=110 (min y=${minY})`);
  console.log(`Neutronium cut: ${count} cells settled at mean world y=${(sumY / count).toFixed(2)}`);
} finally {
  clearTimeout(timer);
  await worker.terminate();
  mirror.destroy();
}
