// Detaching a joint must not eject existing bodies from the opposite layer.
import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

await initSandWasm();
for (const layer of [0, 1]) for (const joint of [false, true]) {
  const engine = attachTestHooks(createEngineWasm({
    cols: 120, rows: 100, worldSeed: 23, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(true);
  const rect = (target, x0, x1, material) => {
    for (let y = 20; y < 40; y++) for (let x = x0; x < x1; x++)
      engine.paintDiscLayer(target, x, y, 0, material, true);
  };
  const sync = () => {
    engine.syncComponentsLayer(0);
    engine.syncComponentsLayer(1);
  };
  try {
    if (joint) {
      rect(layer, 20, 45, MAT.STONE);
      rect(1 - layer, 40, 50, MAT.BRICK);
      sync();
    } else {
      engine._spawnBoxLayer(layer, 30, 30, 3, 3, MAT.RIGID);
    }
    engine.stepWorld();
    const id = engine._bodyIdLayer(layer, 0);
    const before = engine._bodyStateLayer(layer, 0);
    assert.ok(before);
    assert.equal(engine._bodyJointRoleLayer(layer, 0), joint ? layer + 1 : 0);

    // Each new joint spans both layers; its broad face is opposite the old
    // body's broad face. Their projected union overlaps without material contact.
    if (joint) {
      rect(1 - layer, 18, 35, MAT.STONE);
      rect(layer, 10, 20, MAT.BRICK);
    } else {
      rect(1 - layer, 20, 45, MAT.STONE);
      rect(layer, 40, 50, MAT.BRICK);
    }
    sync();
    engine.stepWorld();
    assert.equal(engine._bodyCountLayer(layer), 2, 'new joint detaches beside the existing body');
    assert.equal(engine._bodyCountLayer(1 - layer), joint ? 2 : 1);
    assert.equal(engine.getRigidSolverDebug().spawnSeparations, 0,
      'opposite-layer overlap is not a spawn collision');
    for (let tick = 0; tick < 12; tick++) {
      const index = Array.from({ length: engine._bodyCountLayer(layer) }, (_, i) => i)
        .find((i) => engine._bodyIdLayer(layer, i) === id);
      assert.notEqual(index, undefined, 'existing body survives');
      const body = engine._bodyStateLayer(layer, index);
      assert.equal(body.nPts, before.nPts, 'material survives');
      assert.ok(Math.abs(body.px - before.px) < 0.1, 'no horizontal ejection');
      if (tick === 0) assert.ok(Math.abs(body.py - before.py) < 0.2, 'no vertical ejection');
      assert.equal(engine._bodyTerrainBlockedLayer(layer, index), 0);
      assert.equal(engine.getRigidSolverDebug().ownershipConflicts, 0);
      engine.stepWorld();
    }
    const after = engine._bodyStateLayer(layer, 0);
    assert.ok(after.py > before.py + 1, 'body keeps falling');
    console.log(`layer ${layer}, ${joint ? 'joint' : 'single-layer'} body: no false separation, continued fall`);
  } finally {
    engine.destroy();
  }
}
