import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';

await initSandWasm();
for (const shift of [0, -128]) {
  const e = createEngineWasm({ cols: 200, rows: 160, worldSeed: 73, infinite: true,
    sinksOn: false, planetId: PLANET.FRONTIER });
  try {
    e.setCreatureRuntime(false, false);
    if (shift) e.shiftWorldXY(shift, shift);
    for (let layer = 0; layer < 2; layer++) {
      e.eraseDiscLayer(layer, 100, 80, 150);
      e.syncComponentsLayer(layer);
    }
    for (let x = 1; x < 199; x++) for (let y = 128; y < 160; y++)
      e.paintDisc(x, y, 0, MAT.STONE, true);
    for (let y = 1; y < 128; y++) for (let x = 112; x < 116; x++)
      e.paintDisc(x, y, 0, MAT.STONE, true);
    for (let y = 108; y < 128; y++) for (let x = 88; x < 96; x++)
      e.paintDiscLayer(1, x, y, 0, MAT.OAK_WOOD, true);
    e.syncComponents(); e.syncComponentsLayer(1);
    const id = e.spawnPlayer(76, 120);
    const tick = () => { for (let i = 0; i < 24; i++) e.stepActors(); };
    const tiles = () => {
      const data = e.getDiscovery(), result = new Map();
      for (let i = 0; i < data.length; i += 3) result.set(`${data[i]},${data[i + 1]}`, data[i + 2]);
      return result;
    };
    const key = (x, y) => `${Math.floor((x + e.getWorldOffsetX()) / 4) * 4},${Math.floor((y + e.getWorldOffsetY()) / 4) * 4}`;
    tick();
    const seen = tiles();
    assert.equal(seen.get(key(88, 120)), MAT.OAK_WOOD, 'empty foreground reveals the rear wall');
    assert.equal(seen.get(key(100, 120)), MAT.EMPTY, 'rear walls do not stop sight');
    assert.equal(seen.get(key(112, 120)), MAT.STONE, 'the opaque foreground wall is recorded');
    assert.ok(!seen.has(key(132, 120)), 'foreground walls conceal the room beyond');
    const revision = e.getDiscoveryRevision(), snapshot = e.getDiscovery();
    tick();
    assert.equal(e.getDiscoveryRevision(), revision, 'unchanged visibility keeps its revision');
    assert.deepEqual(e.getDiscovery(), snapshot);
    e.eraseDisc(114, 112, 20); e.syncComponents(); tick();
    assert.equal(tiles().get(key(132, 120)), MAT.EMPTY, 'a breached wall reveals the room');
    assert.ok(e.getDiscoveryRevision() > revision);
    for (let residue = 0; residue < 4; residue++) {
      e.setPlayerState(id, { x: 76 + residue, y: 120 }); tick();
      assert.equal(tiles().get(key(132, 120)), MAT.EMPTY);
    }
    console.log(`ok: discovery occlusion, breach, revision and tile alignment at offset ${shift}`);
  } finally { e.destroy(); }
}
