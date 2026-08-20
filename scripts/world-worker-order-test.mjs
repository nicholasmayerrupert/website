import { Worker } from 'node:worker_threads';
import {
  decodeWorkerLiveness,
  WORKER_LIVENESS_STAGE,
} from '../src/sand/worker/workerLiveness.js';
import { WEATHER } from '../src/sand/wasmBridge/abi.generated.js';

const worker = new Worker(new URL('./world-worker-node-harness.mjs', import.meta.url), {
  type: 'module',
});
const inbox = [];
const waiters = [];
const deliveryOrder = new WeakMap();
const phaseSignals = [];
let delivered = 0;
let failures = 0;

const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};
const deliver = (message) => {
  const order = ++delivered;
  if (message && typeof message === 'object')
    deliveryOrder.set(message, order);
  const packedLiveness = Number.isSafeInteger(message)
    ? message
    : message?.liveness;
  const phase = decodeWorkerLiveness(packedLiveness);
  if (phase) phaseSignals.push({ ...phase, order });
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
    planetId: 0, weatherId: WEATHER.RAIN,
    gravityScale: 1, missionId: 0, loadout: [],
  });
  const full = await waitFor((message) => message.type === 'full', 15000);
  const journalReset = await waitFor(
    (message) => message.type === 'replay-journal-reset', 5000,
  );
  check('worker publishes its normalized replay initialization independently',
    journalReset.init.worldSeed === 0x51f7
      && journalReset.init.cols === 256 && journalReset.init.rows === 192
      && journalReset.init.weatherId === WEATHER.RAIN);
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
  const triggerJournalEvent = await waitFor((message) =>
    message.type === 'replay-journal-event'
      && message.event.message.type === 'test-paint-disc', 5000);
  const trigger = triggerJournalEvent.event;
  const triggerJournal = await waitFor(
    (message) => message.type === 'replay-journal-turn'
      && message.turns === trigger.tick + 1,
    5000,
  );
  const worldPhaseSignal = await waitFor((message) => {
    const signal = decodeWorkerLiveness(message);
    return signal?.stage === WORKER_LIVENESS_STAGE.STEP_WORLD
      && signal.turn === triggerJournal.turns;
  }, 5000);
  check('worker publishes the world-step phase before entering synchronous work',
    decodeWorkerLiveness(worldPhaseSignal)?.turn === triggerJournal.turns);
  await waitFor((message) => {
    const signal = decodeWorkerLiveness(message);
    return signal?.stage === WORKER_LIVENESS_STAGE.SCHEDULED
      && signal.turn === triggerJournal.turns;
  }, 5000);
  const expectedPhases = [
    WORKER_LIVENESS_STAGE.STREAM,
    WORKER_LIVENESS_STAGE.APPLY_TOOLS,
    WORKER_LIVENESS_STAGE.STEP_ACTORS,
    WORKER_LIVENESS_STAGE.STEP_WORLD,
    WORKER_LIVENESS_STAGE.TRANSPORT,
    WORKER_LIVENESS_STAGE.SCHEDULED,
  ];
  const turnSignals = phaseSignals.filter(
    (signal) => signal.turn === triggerJournal.turns,
  );
  const phaseOrders = expectedPhases.map(
    (stage) => turnSignals.find((signal) => signal.stage === stage)?.order,
  );
  check('a live turn publishes ordered phase breadcrumbs without a probe',
    phaseOrders.every(Number.isSafeInteger)
      && phaseOrders.every((order, index) => !index || order > phaseOrders[index - 1]),
    turnSignals.map((signal) => signal.stageName).join(' > '));
  const diff = await waitFor((message) => message.type === 'diff'
    && message.worldTick > triggerJournal.worldTick, 5000);
  check('accepted trigger is durable before synchronous apply and its world result',
    deliveryOrder.get(triggerJournalEvent) < deliveryOrder.get(triggerJournal)
      && deliveryOrder.get(triggerJournal) < deliveryOrder.get(diff));

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

  worker.postMessage({
    type: 'replay-export', requestId: 77,
    view: {
      cameraWorldX: centeredControl.camWorldX,
      cameraWorldY: centeredControl.camWorldY,
      viewCols: centeredControl.viewCols,
      viewRows: centeredControl.viewRows,
      zoom: 1,
    },
  });
  const exported = await waitFor(
    (message) => message.type === 'replay-capsule' && message.requestId === 77,
    5000,
  );
  const exportedTrigger = exported.capsule.events.find(
    (event) => event.message.type === 'test-paint-disc',
  );
  check('independent journal uses the canonical authority event tick',
    exportedTrigger?.tick === trigger.tick
      && exported.capsule.turns >= triggerJournal.turns
      && exported.capsule.init.weatherId === WEATHER.RAIN);

  const replaySignalStart = phaseSignals.length;
  worker.postMessage({
    type: 'replay-run', requestId: 78, capsule: exported.capsule,
  });
  const replayed = await waitFor(
    (message) => (message.type === 'replay-complete' || message.type === 'replay-error')
      && message.requestId === 78,
    15000,
  );
  check('authority export still round-trips through deterministic replay',
    replayed.type === 'replay-complete' && replayed.matched,
    replayed.message || `matched=${replayed.matched}`);
  check('bulk replay emits no per-turn phase breadcrumbs',
    phaseSignals.length === replaySignalStart,
    `${phaseSignals.length - replaySignalStart} signal(s)`);

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
