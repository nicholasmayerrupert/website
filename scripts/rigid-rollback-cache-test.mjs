// Replay a cross-layer collision, then keep stepping with an unchanged body roster.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { decodeReplayCapsule } from '../src/sand/game/replayCapsule.js';

const capsule = await decodeReplayCapsule(readFileSync(
  new URL('./rigid-rollback-cache.sand-replay', import.meta.url), 'utf8',
));
const recordedTurns = capsule.turns;
capsule.turns += 120;
const worker = new Worker(new URL('./world-worker-node-harness.mjs', import.meta.url));
let lastTurn = 0;
let timer;
try {
  const result = await new Promise((resolve, reject) => {
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new Error(
        `Rigid rollback replay stalled after turn ${lastTurn}/${capsule.turns}`,
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
      } else if (message?.type === 'replay-complete') {
        resolve(message);
      } else if (message?.type === 'error' || message?.type === 'replay-error') {
        reject(new Error(message.message));
      }
    });
  });
  // The captured endpoint precedes the stalled turn; completion and continued
  // authority progress are the assertions, rather than that endpoint's checksum.
  assert.equal(result.actual.actorTick, capsule.turns);
  assert.ok(result.actual.tick >= capsule.final.tick + 120,
    'the world keeps simulating after the recorded collision');
  assert.equal(result.actual.cols, capsule.init.cols);
  assert.equal(result.actual.rows, capsule.init.rows);
  console.log(`Rigid rollback replay completed ${capsule.turns} turns `
    + `(${capsule.turns - recordedTurns} beyond the freeze), world tick ${result.actual.tick}`);
} finally {
  clearTimeout(timer);
  await worker.terminate();
}
