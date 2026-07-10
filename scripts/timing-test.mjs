import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { createFixedRateClock, createNoCatchupGate } from '../src/sand/timing/fixedRateClock.js';
import { Host } from '../src/sand/net/server/host.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('split actor/world timing');

// A sustained 20 ms frame cadence is 50 FPS. Actors repay the small remainder
// and reach 60 Hz; world work is admitted at most once per frame.
{
  const actors = createFixedRateClock({ now: 0 });
  const world = createNoCatchupGate({ stepMs: 16, now: 0 });
  let actorSteps = 0, worldSteps = 0, maxWorldPerFrame = 0;
  for (let frame = 1; frame <= 50; frame++) {
    const now = frame * 20;
    actors.advance(now, () => actorSteps++);
    let thisFrame = 0;
    if (world.take(now)) { worldSteps++; thisFrame++; }
    maxWorldPerFrame = Math.max(maxWorldPerFrame, thisFrame);
  }
  check(`20ms frames keep actors at 60Hz (${actorSteps})`, actorSteps === 60);
  check(`20ms frames run 50 world steps (${worldSteps})`, worldSteps === 50);
  check('world never runs twice in one frame', maxWorldPerFrame === 1);
}

{
  const actors = createFixedRateClock({ now: 0 });
  let n = 0;
  const stats = actors.advance(1000, () => n++);
  check(`long stall caps actor recovery at three steps (${n})`, n === 3);
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

// Creative camera consumes the same actor clock, so grouping ticks into 20 ms
// frames produces exactly the same displacement as 60 direct ticks.
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

// The authoritative host exposes the same split while retaining its combined
// compatibility step and actor-tick snapshot semantics.
{
  const e = createEngineWasm({ cols: 80, rows: 60, worldSeed: 3, sinksOn: false });
  const host = new Host({ engine: e });
  for (let i = 0; i < 5; i++) host.stepActors();
  check(`server actor clock advances alone (${host.actorTick})`, host.actorTick === 5 && host.worldTick === 0);
  host.stepWorld();
  check(`server world clock advances independently (${host.worldTick})`, host.actorTick === 5 && host.worldTick === e.getTick());
  check('server snapshots are keyed to actor tick', host.snapshot().tick === host.actorTick);
  host.step();
  check('server compatibility step advances both phases', host.actorTick === 6 && host.tick === 6 && host.worldTick === e.getTick());
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
