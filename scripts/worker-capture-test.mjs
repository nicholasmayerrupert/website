import assert from 'node:assert/strict';
import { register } from 'node:module';
import { encodeWorkerLiveness, WORKER_LIVENESS_STAGE as STAGE } from '../src/sand/worker/workerLiveness.js';

// Replace only Vite's worker constructor; exercise the actual client protocol.
const fakeWorkerModule = 'data:text/javascript,' + encodeURIComponent(`
  export default class {
    constructor() { globalThis.captureTestWorker = this; this.messages = []; }
    postMessage(message) { this.messages.push(message); }
    terminate() {}
  }
`);
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === './worldWorkerConstructor.js')
      return { url: ${JSON.stringify(fakeWorkerModule)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`), import.meta.url);
const { createWorldWorkerClient } = await import('../src/sand/worker/worldWorkerClient.js');

let now = 0, nextTimer = 0, probe;
const timers = new Map();
globalThis.performance = { now: () => now };
globalThis.document = { hidden: false };
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextTimer;
  timers.set(id, { callback, delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.setInterval = (callback) => { probe = callback; return 1; };
globalThis.clearInterval = () => {};
let stallMessage = null;
const client = createWorldWorkerClient({
  cols: 128, rows: 96, engine: null,
  setAuthorityStall: (message) => { stallMessage = message; },
});
const worker = globalThis.captureTestWorker;

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
now = 6000;
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
console.log('worker capture timeouts, cancellation, and stall notices pass');
