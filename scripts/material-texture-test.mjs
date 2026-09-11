import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MISSION } from '../src/sand/wasmBridge/abi.generated.js';
import { prepareMirrorShift } from '../src/sand/worker/mirrorShift.js';

await initSandWasm();
const options = { cols:128, rows:128, worldSeed:42, infinite:false, sinksOn:false, planetId:PLANET.FRONTIER };
const make = (extra = {}) => attachTestHooks(createEngineWasm({ ...options, ...extra }));
const phase = (x, y) => ((y & 31) << 5) | (x & 31);
const sameTextures = (a, b) => {
  for (const bg of [false, true]) assert.deepEqual(a.getTextureTexels(bg), b.getTextureTexels(bg));
};
const saveRoundTrip = (e, extra = {}) => {
  const restored = make(extra);
  assert.ok(restored.readCheckpoint(e.writeCheckpoint()), 'checkpoint restores');
  sameTextures(e, restored);
  restored.destroy();
};

// A body carries the source tile under both translations and non-cardinal rotation.
for (const layer of [0, 1]) {
  const e = make(), mirror = make({ storageRole:'presentation' });
  e.setBgEnabled(true);
  e.startMission(MISSION.FRONTIER, e.spawnPlayerAtSurface(10));
  e._spawnBoxLayer(layer, 35, 30, 6, 4, MAT.BRICK);
  const initial = e._bodyStateLayer(layer, 0);
  const sourceCells = new Map();
  const grid = layer ? e.getGridBg() : e.getGrid();
  for (let k = 0; k < grid.length; k++) if (grid[k] === MAT.BRICK) sourceCells.set(k, e.getTextureTexels(!!layer)[k]);
  assert.equal(sourceCells.size, 96);
  assert.ok(mirror.applyWorldMirror(e.serializeWorld(), 0, 0));
  sameTextures(e, mirror);
  e.resetDirty();
  // Foreground motion hook drives the shared joint leader; background gets gravity translation.
  if (!layer) e._setBodyMotion(0, .7, .4, .03);
  for (let turn = 0; turn < 8; turn++) e.stepWorld();
  const pose = e._bodyStateLayer(layer, 0), owners = e._bodyOwnerGrid(layer);
  const texels = e.getTextureTexels(!!layer);
  let checked = 0, changedUnderSameMaterial = 0;
  for (let k = 0; k < grid.length; k++) if (owners[k] >= 0) {
    const dx = k % e.cols + .5 - pose.px, dy = Math.floor(k / e.cols) + .5 - pose.py;
    const x = Math.floor(initial.px + dx * Math.cos(pose.angle) + dy * Math.sin(pose.angle));
    const y = Math.floor(initial.py - dx * Math.sin(pose.angle) + dy * Math.cos(pose.angle));
    assert.equal(texels[k], phase(x, y), `source sample at ${k}, layer ${layer}`);
    if (sourceCells.has(k) && sourceCells.get(k) !== texels[k]) changedUnderSameMaterial++;
    checked++;
  }
  assert.ok(checked > 80 && changedUnderSameMaterial >= 10, `layer ${layer}: ${checked} checked, ${changedUnderSameMaterial} changed`);
  assert.ok(mirror.applyDiffMirror(e.serializeDiff()));
  sameTextures(e, mirror);
  saveRoundTrip(e);

  // Welding freezes the visible raster's addresses into the merged local shape.
  const before = texels.slice(), beforeGrid = (layer ? e.getGridBg() : e.getGrid()).slice();
  let target = -1;
  for (let k = 129; k < grid.length - 129; k++) if (beforeGrid[k] === MAT.EMPTY && owners[k - 1] >= 0) { target = k; break; }
  assert.ok(target >= 0);
  assert.ok(e.placeMaterial(target % 128, Math.floor(target / 128), 0, MAT.BRICK, layer));
  const after = e.getTextureTexels(!!layer), afterGrid = layer ? e.getGridBg() : e.getGrid();
  for (let k = 0; k < before.length; k++) if (beforeGrid[k] === MAT.BRICK && afterGrid[k] === MAT.BRICK)
    assert.equal(after[k], before[k], `weld retains sample ${k}`);
  saveRoundTrip(e);
  const weldedGrid = afterGrid.slice(), weldedTextures = after.slice();
  const cutX = Math.floor(e._bodyStateLayer(layer, 0).px);
  for (let y = 10; y < 80; y++) e.eraseDiscLayer(layer, cutX, y, 0);
  assert.ok(e._bodyCountLayer(layer) >= 2, 'cut fractures the welded body');
  const fracturedGrid = layer ? e.getGridBg() : e.getGrid();
  for (let k = 0; k < fracturedGrid.length; k++) if (fracturedGrid[k] === MAT.BRICK && weldedGrid[k] === MAT.BRICK)
    assert.equal(e.getTextureTexels(!!layer)[k], weldedTextures[k], 'fracture keeps each surviving sample');
  saveRoundTrip(e);
  e.destroy(); mirror.destroy();
}

// Tiny bodies can retain their last visible cell between raster sample centres.
{
  const e = make();
  e.startMission(MISSION.FRONTIER, e.spawnPlayerAtSurface(10));
  e.placeMaterial(40, 30, 0, MAT.BRICK, 0);
  e._setBodyMotion(0, .31, .13, .1);
  let placeholder = false;
  for (let turn = 0; turn < 20; turn++) {
    e.stepWorld();
    if (e.getRigidSolverDebug().rasterPlaceholderBodies) { placeholder = true; break; }
  }
  assert.ok(placeholder, 'tiny body enters a raster gap');
  saveRoundTrip(e);
  const cell = e.getGrid().findIndex(m => m === MAT.BRICK);
  assert.ok(cell >= 0 && e.getTextureTexels()[cell] !== 0xffff);
  e.eraseDisc(cell % 128, Math.floor(cell / 128), 0);
  assert.equal(e.getGrid()[cell], MAT.EMPTY);
  assert.equal(e.getTextureTexels()[cell], 0xffff, 'erasing a placeholder clears its texture');
  e.paintDisc(cell % 128, Math.floor(cell / 128), 0, MAT.SAND);
  assert.equal(e.getTextureTexels()[cell], 0xffff, 'loose replacement uses world coordinates');
  e.destroy();
}

// A settled body retains its artwork when baked and detached again.
{
  const e = make({ infinite:true });
  e.shiftWorldXY(512, 0);
  for (let y = 0; y < 100; y++) for (let x = 40; x < 61; x++) { e.eraseDisc(x, y, 0); e.eraseDiscLayer(1, x, y, 0); }
  e.startMission(MISSION.FRONTIER, e.spawnPlayerAtSurface(10));
  for (let y = 100; y < 128; y++) for (let x = 0; x < 128; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  e.spawnBox(50, 40, 5, 4, MAT.BRICK);
  const brickBody = () => Array.from({ length:e._bodyCount() }, (_, i) => i).find(i => e._bodyMaterial(i) === MAT.BRICK);
  let baked = false, beforeBake;
  for (let turn = 0; turn < 650; turn++) {
    if (brickBody() !== undefined) beforeBake = e.getTextureTexels().slice();
    e.stepWorld();
    if (brickBody() === undefined) { baked = true; break; }
  }
  assert.ok(baked, 'falling brick body bakes');
  const grid = e.getGrid(), bakedTextures = e.getTextureTexels().slice();
  let count = 0;
  for (let k = 0; k < grid.length; k++) if (grid[k] === MAT.BRICK) {
    assert.equal(bakedTextures[k], beforeBake[k], 'baking keeps the accepted source sample'); count++;
  }
  assert.equal(count, 80);
  saveRoundTrip(e, { infinite:true });
  for (let i = 0; i < 3; i++) e.shiftWorldXY(64, 0);
  for (let i = 0; i < 3; i++) e.shiftWorldXY(-64, 0);
  const returned = e.getTextureTexels();
  for (let k = 0; k < bakedTextures.length; k++) if (bakedTextures[k] !== 0xffff)
    assert.equal(returned[k], bakedTextures[k], 'streamed static component retains source samples');
  saveRoundTrip(e, { infinite:true });
  for (let y = 100; y < 128; y++) for (let x = 42; x < 58; x++) { e.eraseDisc(x, y, 0); e.eraseDiscLayer(1, x, y, 0); }
  e.stepWorld();
  assert.ok(brickBody() !== undefined, 'removing support detaches baked brick');
  const remaining = e.getTextureTexels();
  for (let k = 0; k < remaining.length; k++) if (e.getGrid()[k] === MAT.BRICK)
    assert.ok(remaining[k] !== 0xffff, 'detached baked cells retain explicit source addresses');
  saveRoundTrip(e);
  e.destroy();
}

// Streamed body state, full packets, and mirror shifts carry the same samples.
{
  const e = make({ infinite:true }), mirror = make({ storageRole:'presentation' });
  e.shiftWorldXY(0, -256);
  e.startMission(MISSION.FRONTIER, e.spawnPlayerAtSurface(10));
  e.spawnBox(50, 45, 5, 4, MAT.BRICK);
  e._setBodyMotion(0, .6, 0, .02);
  for (let turn = 0; turn < 5; turn++) e.stepWorld();
  const ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
  mirror.applyWorldMirror(e.serializeWorld(), ox, oy);
  e.resetDirty(); e.shiftWorldXY(32, 0);
  const data = e.serializeDiff();
  assert.ok(prepareMirrorShift(mirror, { cols:128, rows:128, shiftDx:32, shiftDy:0, worldOffsetX:ox + 32, worldOffsetY:oy }, data));
  assert.ok(mirror.applyDiffMirror(data)); sameTextures(e, mirror);
  const before = e.getTextureTexels().slice();
  e.shiftWorldXY(96, 0); e.shiftWorldXY(-96, 0);
  for (let k = 0; k < before.length; k++) if (before[k] !== 0xffff)
    assert.equal(e.getTextureTexels()[k], before[k], 'body stream return retains texels');
  saveRoundTrip(e, { infinite:true });
  e.destroy(); mirror.destroy();
}
console.log('material texture movement, weld, bake, save, and streaming checks passed');
