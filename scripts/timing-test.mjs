import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import {
  SIM_STEP_MS,
  createFixedRateClock,
  createTurnDeadline,
} from '../src/sand/timing/fixedRateClock.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';
import { createGameLoop } from '../src/sand/game/gameLoop.js';

const { check, done } = makeChecker('split actor/world timing');

check(`shared simulation interval is exactly 1000/60ms (${SIM_STEP_MS})`,
  SIM_STEP_MS === 1000 / 60);

{
  const turns = createTurnDeadline({ now: 0 });
  let now = 0;
  for (let i = 0; i < 120; i++) {
    const delay = turns.nextDelay(now);
    now += Math.max(1, Math.trunc(delay));
  }
  check(`fractional deadlines average exactly 60 turns/sec (${now}ms/120)`,
    Math.abs(now - 2000) <= 1);

  const overrun = createTurnDeadline({ now: 0 });
  const first = Math.trunc(overrun.nextDelay(0));
  const afterWork = first + 25;
  check('a true turn overrun schedules one immediate recovery turn',
    overrun.nextDelay(afterWork) === 0);
  check('an overrun does not queue a second catch-up turn',
    overrun.nextDelay(afterWork) >= SIM_STEP_MS - 0.01);
}

{
  const actors = createFixedRateClock({ now: 0 });
  let n = 0;
  const stats = actors.advance(1000, () => n++);
  check(`presentation clock caps recovery at three steps (${n})`, n === 3);
  check(`long stall reports dropped actor debt (${stats.droppedDebtMs.toFixed(1)}ms)`, stats.droppedDebtMs >= 900);
}

await initSandWasm();
const COLS = 200, ROWS = 120, FLOOR = 90;
const makeFloorEngine = () => {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false });
  for (let x = 20; x < 180; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  for (let i = 0; i < 20; i++) e.stepWorld();
  return e;
};

// Actor-only motion must not advance or mutate the cellular world.
{
  const e = makeFloorEngine();
  const worldTick = e.getTick();
  const hash = gridHash(e.getGrid());
  const id = e.spawnPlayer(80, 80);
  for (let i = 0; i < 60; i++) {
    e.setPlayerInput(id, { bits: INPUT.RIGHT, seq: i });
    e.stepActors();
  }
  check(`actor clock advanced independently (${e.getActorTick()})`, e.getActorTick() === 60);
  check('actor-only steps leave world tick unchanged', e.getTick() === worldTick);
  check('actor-only steps leave the grid unchanged', gridHash(e.getGrid()) === hash);
  check(`player moved during actor-only steps (${e.getPlayer(id).x.toFixed(1)})`, e.getPlayer(id).x > 90);
  e.destroy();
}

// Player motion is a function of actor ticks, not how many idle world attempts
// are interleaved with them.
{
  const a = makeFloorEngine(), b = makeFloorEngine();
  const aid = a.spawnPlayer(80, 80), bid = b.spawnPlayer(80, 80);
  for (let i = 0; i < 60; i++) {
    a.setPlayerInput(aid, { bits: INPUT.RIGHT, seq: i });
    b.setPlayerInput(bid, { bits: INPUT.RIGHT, seq: i });
    a.stepActors(); b.stepActors();
    a.stepWorld();
    if (i < 50) b.stepWorld();
  }
  const pa = a.getPlayer(aid), pb = b.getPlayer(bid);
  check(`60 actor ticks match across world rates (${pa.x.toFixed(4)})`, pa.x === pb.x && pa.y === pb.y && pa.vx === pb.vx && pa.vy === pb.vy);
  check('idle world checksum is independent of actor cadence', gridHash(a.getGrid()) === gridHash(b.getGrid()));
  a.destroy(); b.destroy();
}

// The fixed-tick camera adapter remains available to deterministic callers.
{
  const direct = createEngineWasm({ cols: 200, rows: 120, worldSeed: 1, sinksOn: false });
  const grouped = createEngineWasm({ cols: 200, rows: 120, worldSeed: 1, sinksOn: false });
  for (const e of [direct, grouped]) {
    e.setViewport(1, 4, 80, 60);
    e.setPlayMode(false);
    e.cameraSet(20, 20);
    e.inputKey(1, true);
  }
  for (let i = 0; i < 60; i++) direct.cameraPanTick();
  const clock = createFixedRateClock({ now: 0 });
  for (let frame = 1; frame <= 50; frame++) clock.advance(frame * 20, () => grouped.cameraPanTick());
  check(`creative camera displacement is clock-group invariant (${direct.getCam().x.toFixed(4)})`, direct.getCam().x === grouped.getCam().x);
  direct.destroy(); grouped.destroy();
}

// Drive the real browser loop with synthetic display deadlines and a real WASM
// camera. Each frame must move, including frames with no actor tick.
{
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let pendingFrame;
  globalThis.requestAnimationFrame = (callback) => { pendingFrame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { pendingFrame = null; };
  const e = createEngineWasm({ cols: 200, rows: 120, worldSeed: 1, sinksOn: false });
  e.setViewport(1, 4, 80, 60);
  e.setPlayMode(false);
  e.inputKey(1, true);
  const ctx = {
    engine: e, playMode: false, reduced: false, testPaused: false,
    dayPhaseOverride: 0.5, clientX: -1, clientY: -1,
    viewCols: 80, viewRows: 60,
    worldWorker: {
      state: { ready: false, replayPlaying: false },
      applyPending() { return false; }, config() {}, updateControl() {},
      consumeSoundEvents() { return []; },
    },
    audio: { updatePlayerEffects() {} },
  };
  const loop = createGameLoop(ctx, {
    parallaxCamera: (value) => value, updatePointer() {}, updateMineProgress() {},
  });
  let now = performance.now();
  const frame = (ms) => { now += ms; pendingFrame(now); };
  try {
    loop.start();
    frame(0);
    for (const hz of [60, 120, 144]) {
      e.cameraSet(10, 20);
      let worstError = 0;
      for (let i = 0; i < hz; i++) {
        const before = e.getCam().x;
        frame(1000 / hz);
        worstError = Math.max(worstError, Math.abs(e.getCam().x - before - 100 / hz));
      }
      check(`${hz} Hz pan moves on every frame at 100 cells/sec`,
        worstError < 1e-8 && Math.abs(e.getCam().x - 110) < 1e-8);
    }
    e.cameraSet(10, 20);
    let worstError = 0;
    for (let i = 0; i < 20; i++) for (const ms of [15, 18, 16, 20, 14, 17]) {
      const before = e.getCam().x;
      frame(ms);
      worstError = Math.max(worstError, Math.abs(e.getCam().x - before - ms / 10));
      // Keep the sample clear of the loaded-window clamp.
      e.cameraSet(10, 20);
    }
    check('irregular frame deadlines never repeat or double a camera tick', worstError < 1e-8);
    ctx.reduced = true;
    frame(10);
    check('reduced-motion mode preserves manual panning', Math.abs(e.getCam().x - 11) < 1e-8);
    ctx.testPaused = true;
    frame(10);
    check('test pause freezes camera motion', Math.abs(e.getCam().x - 11) < 1e-8);
    ctx.testPaused = false;
    ctx.worldWorker.state.replayPlaying = true;
    frame(10);
    check('replay owns camera motion while playing', Math.abs(e.getCam().x - 11) < 1e-8);
    ctx.worldWorker.state.replayPlaying = false;
    frame(1000);
    check('a stalled frame has bounded camera recovery', Math.abs(e.getCam().x - 16) < 1e-8);
    loop.setViewportPaused(true);
    loop.setViewportPaused(false);
    frame(5000);
    check('viewport resume discards suspended camera time', Math.abs(e.getCam().x - 16) < 1e-8);
    e.inputClearKeys();
    frame(10);
    check('releasing input stops panning immediately', Math.abs(e.getCam().x - 16) < 1e-8);
    e.inputStick(0.3, -0.4);
    frame(10);
    check('analog camera input uses the frame duration on both axes',
      Math.abs(e.getCam().x - 16.3) < 1e-8 && Math.abs(e.getCam().y - 19.6) < 1e-8);
    e.setPlayMode(true);
    frame(10);
    check('free-camera input does not move the play-mode camera', Math.abs(e.getCam().x - 16.3) < 1e-8);
  } finally {
    loop.stop();
    e.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
