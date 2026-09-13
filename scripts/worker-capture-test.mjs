import assert from 'node:assert/strict';
import { installWorkerMock, installTestClock } from './worker-test-harness.mjs';
import { encodeWorkerLiveness, WORKER_LIVENESS_STAGE as STAGE } from '../src/sand/worker/workerLiveness.js';

const workers = installWorkerMock();
const { createWorldWorkerClient } = await import('../src/sand/worker/worldWorkerClient.js');
const clock = installTestClock();
const timers = clock.timeouts;
globalThis.document = { hidden: false };
let stallMessage = null;
const client = createWorldWorkerClient({
  cols: 128, rows: 96, engine: null,
  setAuthorityStall: (message) => { stallMessage = message; },
});
const worker = workers[0];
const probe = [...clock.intervals.values()][0].callback;

const first = client.exportReplay({});
const superseded = assert.rejects(first, /superseded/);
const second = client.exportReplay({});
await superseded;
assert.equal(timers.size, 1, 'superseding a capture clears its timer');
const timeout = assert.rejects(second, /within 5 seconds/);
const [timerId, timer] = [...timers][0];
assert.equal(timer.delay, 5000);
timers.delete(timerId);
timer.callback();
await timeout;
worker.onmessage({ data: {
  type: 'replay-capsule', requestId: 2, capsule: {},
} });
assert.equal(timers.size, 0, 'late responses do not revive expired requests');

const successful = client.exportReplay({});
worker.onmessage({ data: {
  type: 'replay-capsule', requestId: 3, capsule: { final: {} },
} });
assert.equal((await successful).final.diagnostics.authorityResponded, true);
assert.equal(timers.size, 0, 'successful captures clear their timer');

worker.onmessage({ data: encodeWorkerLiveness(STAGE.STEP_WORLD, 10, false, true) });
probe();
clock.setNow(6000);
probe();
assert.match(stallMessage, /Press L/, 'a pending probe cannot suppress stall reporting');
document.hidden = true;
probe();
assert.equal(stallMessage, null, 'hidden pages suppress stall notices');
document.hidden = false;
worker.onmessage({ data: encodeWorkerLiveness(STAGE.SCHEDULED, 10, false, true) });
probe();
assert.equal(stallMessage, null, 'progress clears the stall notice');

const closing = assert.rejects(client.exportReplay({}), /closed/);
client.destroy();
await closing;
worker.onmessage({ data: { type: 'destroyed' } });
assert.equal(timers.size, 0, 'shutdown clears pending export and destruction timers');

const replayClient = createWorldWorkerClient({
  cols: 128, rows: 96, engine: null, survival: false, planetId: 0, fns: {},
});
const liveWorker = workers.at(-1);
const startingReplay = replayClient.startBufferedReplay({
  init: { cols: 128, rows: 96, survival: false, planetId: 0, worldSeed: 1 }, turns: 1,
});
const replayFailure = assert.rejects(startingReplay, /Buffered replay failed: test initialization error/);
workers.at(-1).onmessage({ data: { type: 'error', phase: 'init', message: 'test initialization error' } });
await replayFailure;
replayClient.config({ paused: false });
assert.deepEqual(liveWorker.messages.at(-1), { type: 'config', paused: false },
  'a failed replay restores the live worker');
replayClient.destroy();
console.log('worker capture timeouts, cancellation, and stall notices pass');
