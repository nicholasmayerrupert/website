import { createGameLoop } from '../src/sand/game/gameLoop.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const frames = new Map();
const cancelled = [];
let nextFrame = 1;
globalThis.requestAnimationFrame = (callback) => {
  const id = nextFrame++;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  cancelled.push(id);
  frames.delete(id);
};

const workerPauseStates = [];
const ctx = {
  engine: null,
  worldWorker: {
    config(value) { workerPauseStates.push(value.paused); },
    applyPending() { return false; },
    updateControl() {},
  },
  net: { connected: false },
  netClientReady() { return false; },
  reduced: false,
  testPaused: false,
  dayPhaseOverride: null,
  clientX: -1,
  clientY: -1,
  survival: false,
  playMode: false,
  lastCamX: 0,
  lastCamY: 0,
  previewDirty: false,
  timingStats: {},
};

const loop = createGameLoop(ctx, {
  fit() {},
  parallaxCamera(value) { return value; },
  updatePointer() {},
  updateMineProgress() {},
});

console.log('sand viewport pause policy');

loop.start();
check('starting schedules one presentation frame', frames.size === 1, String(frames.size));
const firstFrame = [...frames.keys()][0];

loop.setViewportPaused(true);
check('pausing cancels the pending presentation frame', frames.size === 0 && cancelled.includes(firstFrame));
check('pausing stops the authority worker', workerPauseStates.at(-1) === true, String(workerPauseStates.at(-1)));

loop.setViewportPaused(false);
check('resuming restores the ordinary worker policy', workerPauseStates.at(-1) === false, String(workerPauseStates.at(-1)));
check('resuming schedules presentation again', frames.size === 1, String(frames.size));

const resumedFrame = [...frames.values()][0];
frames.clear();
resumedFrame(performance.now() + 1);
check('the resumed loop continues normally', frames.size === 1, String(frames.size));

loop.stop();
check('stopping removes the active frame', frames.size === 0, String(frames.size));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
