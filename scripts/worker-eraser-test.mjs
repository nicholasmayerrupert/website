import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { ABI_VERSION, ABI_FINGERPRINT, CREATIVE_KIND, PLANET, MISSION } from '../src/sand/wasmBridge/abi.generated.js';
import { MAT } from '../src/sand/materials.js';
import { encodeAdventureOrigin } from '../src/sand/worker/adventureSaveStore.js';
import { normalizeReplayInit, REPLAY_FORMAT, REPLAY_VERSION } from '../src/sand/game/replayCapsule.js';

await initSandWasm();
const cols = 128, rows = 96;
const fixture = createEngineWasm({ cols, rows, worldSeed: 1, planetId: PLANET.FRONTIER, infinite: false, sinksOn: false });
const mirror = createEngineWasm({ cols, rows, storageRole: 'presentation' });
const worker = new Worker(new URL('./world-worker-node-harness.mjs', import.meta.url));
worker.on('message', (message) => { if (message.type === 'error') console.error(message); });
const waitFor = (predicate) => new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); };
  const fail = (error) => { cleanup(); reject(error); };
  const receive = (message) => { if (predicate(message)) { cleanup(); resolve(message); } };
  const timer = setTimeout(() => fail(new Error('worker eraser test timed out')), 15000);
  worker.on('message', receive);
  worker.on('error', fail);
});
try {
  await waitFor((message) => message.type === 'harness-ready');
  assert.ok(fixture.startMission(MISSION.FRONTIER, fixture.spawnPlayer(20, 20)));
  for (const layer of [0, 1]) {
    fixture.paintDiscLayer(layer, 80, rows - 1, 12, MAT.STONE, true);
    fixture.syncComponentsLayer(layer);
  }
  for (let i = 0; i < 120; i++) { fixture.stepActors(); fixture.stepWorld(); }
  const sleepingTick = fixture.getTick();
  for (let i = 0; i < 10; i++) { fixture.stepActors(); fixture.stepWorld(); }
  assert.equal(fixture.getTick(), sleepingTick, 'fixture terrain is asleep');
  const target = 90 * cols + 80;
  assert.equal(fixture.getGrid()[target], MAT.STONE);
  assert.equal(fixture.getGridBg()[target], MAT.STONE);
  const checkpoint = await encodeAdventureOrigin(fixture.writeCheckpoint());
  const init = normalizeReplayInit({ cols, rows, worldSeed: 1, gravityScale: 1,
    drawMode: true, planetId: PLANET.FRONTIER, checkpoint });
  for (const button of [0, 2]) {
    const buttons = button === 0 ? 1 : 2;
    const control = { type: 'control', worldX: 32, worldY: 20, buttons,
      inside: true, drawMode: true, camWorldX: 32, camWorldY: 24,
      viewCols: 64, viewRows: 48, suspendStreaming: true };
    const capsule = {
      format: REPLAY_FORMAT, version: REPLAY_VERSION, abiVersion: ABI_VERSION,
      abiFingerprint: ABI_FINGERPRINT, init, turns: 120, gates: [],
      events: [
        { tick: 0, message: { type: 'config', creativeKind: CREATIVE_KIND.ERASER, creativeValue: 0 } },
        { tick: 0, message: control },
        { tick: 0, message: { ...control, type: 'edge', kind: 'down', button } },
        // Hold over empty sky long enough to exhaust any residual terrain activity.
        { tick: 100, message: { ...control, worldX: 80, worldY: 90 } },
        { tick: 119, message: { ...control, type: 'edge', kind: 'up', button, buttons: 0, worldX: 80, worldY: 90 } },
      ],
      final: { tick: 0, actorTick: 0, cols, rows, gridHash: 0, worldOffsetX: 0, worldOffsetY: 0 },
    };
    const snapshot = waitFor((message) => message.type === 'full' && message.reason === 'replay');
    const completion = waitFor((message) => message.type === 'replay-complete' || message.type === 'replay-error');
    worker.postMessage({ type: 'replay-run', requestId: button + 1, capsule });
    const result = await completion;
    assert.equal(result.type, 'replay-complete', result.message);
    const full = await snapshot;
    assert.ok(mirror.applyWorldMirror(new Uint8Array(full.data), full.worldOffsetX, full.worldOffsetY));
    const selected = button === 0 ? mirror.getGrid() : mirror.getGridBg();
    const other = button === 0 ? mirror.getGridBg() : mirror.getGrid();
    assert.equal(selected[target], MAT.EMPTY, `button ${button}: eraser resumes after dragging across sleeping empty terrain`);
    assert.equal(other[target], MAT.STONE, 'erasing preserves the other layer');
    // The actual result becomes the expected state for an exact replay round trip.
    const replayed = waitFor((message) => message.type === 'replay-complete' || message.type === 'replay-error');
    worker.postMessage({ type: 'replay-run', requestId: button + 10, capsule: { ...capsule, final: result.actual } });
    assert.equal((await replayed).matched, true, 'held eraser replay is deterministic');
  }
  console.log('worker eraser resumes on sleeping terrain in both layers and replays exactly');
} finally {
  await worker.terminate();
  fixture.destroy();
  mirror.destroy();
}
