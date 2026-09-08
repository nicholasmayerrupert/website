import assert from 'node:assert/strict';
import { createEngineWasm, initSandWasm, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { MISSION } from '../src/sand/wasmBridge/abi.generated.js';
import { Predictor } from '../src/sand/worker/playerPrediction.js';

// The browser starts a new input sequence when reopening an adventure.
await initSandWasm();
const options = { cols: 240, rows: 160, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER };
const saved = createEngineWasm(options), restored = createEngineWasm(options), mirror = createEngineWasm(options);
try {
  saved.setSurvivalInventory(true);
  const id = saved.spawnPlayer(50, 80);
  assert.ok(saved.startMission(MISSION.FRONTIER, id));
  saved.setPlayerInput(id, { seq: 90000, bits: 0, aimX: 70, aimY: 80 });
  saved.stepActors();
  assert.equal(saved.getPlayer(id).inputSeq, 90000);
  assert.ok(restored.readCheckpoint(saved.writeCheckpoint()));
  const first = restored.getPlayer(id);
  assert.equal(first.inputSeq, 0, 'a checkpoint cannot acknowledge inputs from a new browser session');
  const predictor = new Predictor(mirror, mirror.spawnPlayer(first.x, first.y));
  predictor.reconcile(first, first.inputSeq, restored.getActorTick());
  // A collision/knockback correction must reach the visible player immediately,
  // even though this session's sequence is smaller than the saved sequence.
  restored.setPlayerState(id, { ...first, x: 100, y: 80 });
  restored.setPlayerInput(id, { seq: 1, bits: 0, aimX: 100, aimY: 80 });
  restored.stepActors();
  predictor.predict(1, { bits: 0, aimX: 100, aimY: 80 });
  const next = restored.getPlayer(id);
  predictor.reconcile(next, next.inputSeq, restored.getActorTick());
  assert.equal(predictor.lastAck, 1);
  assert.equal(predictor.renderState().x, next.x, 'the visible player follows the current authoritative body');
  assert.equal(predictor.renderState().y, next.y);
  assert.equal(predictor.pending.length, 0);
  console.log('ok: saved input acknowledgements cannot strand a visible ghost player');
} finally { saved.destroy(); restored.destroy(); mirror.destroy(); }

{
  const engine = {
    pose: { x: 0, y: 0 },
    getPlayer() { return { ...this.pose }; },
    setPlayerState(_id, pose) { this.pose = { ...pose }; },
    setPlayerInput() {}, syncActorTick() {},
    stepPlayerOnly() { this.pose.x++; },
  };
  const predictor = new Predictor(engine, 1);
  predictor.reconcile({ x: 0, y: 0 }, 0, 0);
  for (let seq = 1; seq <= 500; seq++) predictor.predict(seq, { bits: 2 });
  assert.equal(predictor.state().x, Predictor.MAX_PREDICTION_STEPS,
    'a stalled worker cannot leave the player running indefinitely ahead of combat');
  assert.equal(predictor.pending.at(-1).seq, 500, 'fresh controls remain recorded during a stall');
  assert.equal(predictor.pending.length, Predictor.MAX_PENDING);
  predictor.reconcile({ x: 1, y: 0 }, 400, 1);
  assert.equal(predictor.state().x, 1 + Predictor.MAX_PREDICTION_STEPS,
    'replaying a backlog obeys the same prediction horizon');
  predictor.reconcile({ x: 100, y: 0 }, 500, 2);
  assert.equal(predictor.renderState().x, 100, 'confirmed recovery replaces the stalled prediction');
  predictor.predict(501, { bits: 2 });
  assert.equal(predictor.state().x, 101, 'prediction resumes after authority catches up');
  console.log('ok: bounded speculation, bounded replay, and recovery');
}
