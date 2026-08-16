import {
  createWorkerLivenessMonitor,
  decodeWorkerLiveness,
  encodeWorkerLiveness,
  WORKER_LIVENESS_STAGE as STAGE,
} from '../src/sand/worker/workerLiveness.js';
/* global process */

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

let clock = 0;
const monitor = () => createWorkerLivenessMonitor({
  now: () => clock,
  stallMs: 100,
  noDiffMs: 50,
});
const signal = (target, stage, turn, awaitingAck = false, hasControl = true) => {
  target.noteSignal(
    encodeWorkerLiveness(stage, turn, awaitingAck, hasControl),
    clock,
  );
};

console.log('worker liveness classification');

{
  const encoded = encodeWorkerLiveness(STAGE.STEP_WORLD, 123, true, true);
  const decoded = decodeWorkerLiveness(encoded);
  check('packed stage pulse preserves phase, turn, and gates',
    decoded?.stage === STAGE.STEP_WORLD && decoded.turn === 123
      && decoded.awaitingAck && decoded.hasControl);
}

for (const [stage, expected] of [
  [STAGE.STREAM, 'blocked-streaming'],
  [STAGE.STEP_ACTORS, 'blocked-step-actors'],
  [STAGE.STEP_WORLD, 'blocked-step-world'],
  [STAGE.TRANSPORT, 'blocked-transport'],
]) {
  clock = 0;
  const target = monitor();
  signal(target, stage, 1);
  clock = 101;
  const actual = target.snapshot().status;
  check(`${expected} is attributed to its last entered phase`, actual === expected, actual);
}

{
  clock = 0;
  const target = monitor();
  clock = 60;
  check('startup is not mislabeled as a quiet live worker',
    target.snapshot().status === 'initializing');
}

{
  clock = 0;
  const target = monitor();
  signal(target, STAGE.SCHEDULED, 5);
  clock = 50;
  // A sparse probe refreshes message receipt, but an unchanged completed turn
  // is not execution progress.
  signal(target, STAGE.SCHEDULED, 5);
  clock = 101;
  const actual = target.snapshot().status;
  check('an idle event loop with no new turn reports stopped scheduling',
    actual === 'stopped-scheduling', actual);
}

{
  clock = 0;
  const target = monitor();
  target.notePacket(7);
  target.noteApplied(7);
  signal(target, STAGE.SCHEDULED, 1);
  clock = 60;
  target.noteAuthorityTick(70);
  signal(target, STAGE.STREAM, 2);
  const state = target.snapshot();
  check('turn progress without packets remains healthy and explicitly idle',
    state.status === 'live-no-diffs' && state.progressAgeMs === 0
      && state.tickLag === 0, `${state.status}, lag=${state.tickLag}`);
}

{
  clock = 0;
  const target = monitor();
  target.notePacket(11);
  target.noteApplied(10);
  signal(target, STAGE.SCHEDULED, 1, true);
  clock = 101;
  signal(target, STAGE.STREAM, 2, true);
  const state = target.snapshot();
  check('a live worker waiting too long for the mirror ack is distinct from no diffs',
    state.status === 'waiting-ack' && state.tickLag === 1, state.status);
}

{
  clock = 0;
  const target = monitor();
  signal(target, STAGE.SCHEDULED, 1, true);
  clock = 50;
  target.noteAck();
  clock = 60;
  signal(target, STAGE.STREAM, 2, true);
  clock = 150;
  signal(target, STAGE.STEP_ACTORS, 2, true);
  check('a newly posted packet gets a fresh ack-wait deadline',
    target.snapshot().status !== 'waiting-ack');
  clock = 161;
  signal(target, STAGE.STEP_WORLD, 2, true);
  check('the fresh packet is reported if its own ack deadline expires',
    target.snapshot().status === 'waiting-ack');
}

{
  clock = 0;
  const target = monitor();
  signal(target, STAGE.PAUSED, 9, false, true);
  clock = 1000;
  check('an intentional pause never reports a stall', target.snapshot().status === 'paused');
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
