import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./world-worker-node-harness.mjs', import.meta.url), {
  type: 'module',
});
const inbox = [];
const waiters = [];
let failures = 0;

const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};
const deliver = (message) => {
  const index = waiters.findIndex(({ predicate }) => predicate(message));
  if (index >= 0) {
    const [{ resolve, timer }] = waiters.splice(index, 1);
    clearTimeout(timer);
    resolve(message);
  } else inbox.push(message);
};
worker.on('message', deliver);
worker.on('error', (error) => {
  for (const waiter of waiters.splice(0)) waiter.reject(error);
});
const waitFor = (predicate, timeoutMs = 5000) => {
  const index = inbox.findIndex(predicate);
  if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, timer: 0 };
    waiter.timer = setTimeout(() => {
      const at = waiters.indexOf(waiter);
      if (at >= 0) waiters.splice(at, 1);
      reject(new Error('worker message timeout'));
    }, timeoutMs);
    waiters.push(waiter);
  });
};
try {
  await waitFor((message) => message.type === 'harness-ready');
  worker.postMessage({
    type: 'init', cols: 256, rows: 192, worldSeed: 0x51f7,
    survival: false, creativeKind: 0, creativeValue: 0, tool: 0,
    drawMode: true, creatureNaturalSpawning: false,
  });
  const full = await waitFor((message) => message.type === 'full', 15000);
  worker.postMessage({ type: 'ack', epoch: full.epoch, sequence: full.sequence });

  const centeredControl = {
    type: 'control', buttons: 0, inside: false, drawMode: true,
    worldX: full.worldOffsetX + 96, worldY: full.worldOffsetY + 80,
    camWorldX: full.worldOffsetX + 80, camWorldY: full.worldOffsetY + 64,
    viewCols: 64, viewRows: 64, suspendStreaming: false,
  };
  worker.postMessage(centeredControl);
  worker.postMessage({
    type: 'test-paint-disc', material: 1, radius: 2,
    worldX: full.worldOffsetX + 120, worldY: full.worldOffsetY + 80,
  });
  const diff = await waitFor((message) => message.type === 'diff', 5000);

  worker.postMessage({
    ...centeredControl,
    camWorldX: full.worldOffsetX + 256 - 64 - 2,
  });
  await waitFor((message) => message.type === 'stats'
    && message.worldTick > diff.worldTick, 5000);
  check('streaming waits while an earlier world diff is unacknowledged',
    !inbox.some((message) => message.type === 'shift'));

  worker.postMessage({ type: 'ack', epoch: diff.epoch, sequence: diff.sequence });
  const shift = await waitFor((message) => message.type === 'shift', 5000);
  check('streaming resumes after the earlier world diff is acknowledged',
    shift.epoch > diff.epoch && shift.sequence > 0);

  worker.postMessage({ type: 'destroy' });
  await waitFor((message) => message.type === 'destroyed', 2000);
} catch (error) {
  failures++;
  console.error(error);
} finally {
  await worker.terminate();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
