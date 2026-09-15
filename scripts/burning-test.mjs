import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { createFixtureEngine } from './sand-fixtures.mjs';
import { MISSION } from '../src/sand/wasmBridge/abi.generated.js';
import { isValidWorldRle, isValidWorldDiff } from '../src/sand/worldPacketValidation.js';
import { prepareMirrorShift } from '../src/sand/worker/mirrorShift.js';

await initSandWasm();
const cols = 96, rows = 96, x = 40, y = 50, cell = y * cols + x;
const grid = (e, layer = 0) => layer ? e.getGridBg() : e.getGrid();
// The third registered persistent channel is the remaining burn time.
const fuel = (e, k = cell, layer = 0) => e._motionCellState(layer, k)[4];
const make = (material = MAT.WOOD, layer = 0, infinite = false, worldSeed = 0xc0ffee) => {
  const e = createFixtureEngine({ cols, rows, worldSeed, planetId: PLANET.FRONTIER, infinite });
  e.startMission(MISSION.FRONTIER, e.spawnPlayer(10, 10));
  for (let yy = y + 1; yy < rows; yy++)
    e.paintDiscLayer(layer, x, yy, 0, MAT.STONE, true);
  e.paintDiscLayer(layer, x, y, 0, material, true);
  e.syncComponentsLayer(layer);
  return e;
};
const clearFlames = (e) => {
  for (const layer of [0, 1]) {
    const g = grid(e, layer);
    for (let k = 0; k < g.length; k++)
      if (g[k] === MAT.FIRE) e.eraseDiscLayer(layer, k % cols, Math.floor(k / cols), 0);
  }
};
const light = (e, layer = 0) => {
  for (let tick = 0; tick < 60 && !fuel(e, cell, layer); tick++) {
    e.paintDiscLayer(layer, x - 1, y, 0, MAT.FIRE, true);
    e.stepWorld();
  }
  assert.ok(fuel(e, cell, layer) > 0, 'flame contact ignites solid fuel');
  clearFlames(e);
};

for (const material of [MAT.WOOD, MAT.OAK_WOOD, MAT.OAK_LEAF]) {
  const e = make(material);
  light(e);
  const duration = fuel(e);
  assert.equal(grid(e)[cell], material, 'ignition preserves the original material');
  assert.ok(e._bodyOwnerGrid(0)[cell] < 0, 'supported burning fuel remains static');
  let flames = 0;
  for (let tick = 0; tick < duration - 1; tick++) {
    e.stepWorld();
    assert.equal(grid(e)[cell], material, 'fuel remains solid until its timer expires');
    flames += grid(e).includes(MAT.FIRE) ? 1 : 0;
  }
  assert.ok(flames > 0, 'burning fuel emits flames after the ignition source is removed');
  e.stepWorld();
  assert.notEqual(grid(e)[cell], material, 'spent fuel is consumed');
  assert.ok(material === MAT.OAK_LEAF ? duration >= 101 && duration <= 138 : duration >= 305 && duration <= 414,
    'leaves burn faster than timber');
  e.destroy();
}
console.log('ok: independent ignition, flame emission, fuel lifetime and material identity');

const durations = new Set();
for (let seed = 1; seed <= 8; seed++) {
  const e = make(MAT.WOOD, 0, false, seed);
  light(e); durations.add(fuel(e)); e.destroy();
}
assert.ok(durations.size > 4, 'ignitions vary the fuel lifetime slightly');

for (const layer of [0, 1]) for (const cross of [false, true])
for (const water of [MAT.WATER, MAT.BRINE, MAT.ACID]) {
  const e = make(MAT.WOOD, layer);
  light(e, layer);
  const liquidLayer = cross ? 1 - layer : layer;
  e.paintDiscLayer(liquidLayer, cross ? x : x - 1, y, 0, water, true);
  e.stepWorld();
  assert.equal(fuel(e, cell, layer), 0, `liquid ${water} extinguishes layer ${layer}, cross=${cross}`);
  clearFlames(e);
  if (water === MAT.ACID) { e.destroy(); continue; }
  for (let tick = 0; tick < 400; tick++) e.stepWorld();
  assert.equal(grid(e, layer)[cell], MAT.WOOD, 'extinguished wood survives');
  assert.equal(fuel(e, cell, layer), 0, 'extinguished fuel does not restart itself');
  e.destroy();
}
for (const cross of [false, true]) for (const liquid of [MAT.OIL, MAT.LAVA]) {
  const e = make(); light(e);
  e.paintDiscLayer(cross ? 1 : 0, cross ? x : x - 1, y, 0, liquid, true);
  e.stepWorld();
  assert.ok(fuel(e) > 0, 'oil and lava do not extinguish burning wood');
  e.destroy();
}
for (const layer of [0, 1]) for (const cross of [false, true])
for (const liquid of [MAT.WATER, MAT.BRINE, MAT.ACID]) {
  const e = make(MAT.WOOD, layer);
  e.paintDiscLayer(layer, x, y, 0, MAT.FIRE, true);
  e.paintDiscLayer(cross ? 1 - layer : layer, cross ? x : x - 1, y, 0, liquid, true);
  e.stepWorld();
  assert.ok(!grid(e, layer).includes(MAT.FIRE), 'quenching liquids also extinguish loose flames');
  e.destroy();
}
console.log('ok: randomized lifetimes; water, brine and acid quench in either layer; oil/lava stay hot');

{
  const e = make(); light(e);
  e.paintDisc(x - 1, y, 0, MAT.WATER, true);
  e.paintDisc(x - 2, y, 0, MAT.FIRE, true);
  e.stepWorld();
  assert.equal(fuel(e), 0, 'contact quenches wood before adjacent flames evaporate the water');
  e.destroy();
}

{
  const e = make();
  e.paintDisc(x + 1, y, 0, MAT.OAK_WOOD, true);
  e.syncComponents();
  light(e);
  for (let tick = 0; tick < 180 && !fuel(e, cell + 1); tick++) {
    clearFlames(e);
    e.stepWorld();
  }
  assert.ok(fuel(e, cell + 1) > 0, 'burning wood ignites adjacent wood without consuming itself');
  assert.equal(grid(e)[cell], MAT.WOOD);
  e.destroy();
}

{
  const e = make();
  for (let yy = y + 1; yy < rows; yy++) e.paintDiscLayer(1, x, yy, 0, MAT.STONE, true);
  e.paintDiscLayer(1, x, y, 0, MAT.WOOD, true);
  e.syncComponentsLayer(1);
  light(e);
  for (let tick = 0; tick < 120 && !fuel(e, cell, 1); tick++) e.stepWorld();
  assert.ok(fuel(e, cell, 1) > 0, 'solid burning fuel spreads across layers');
  assert.equal(grid(e, 1)[cell], MAT.WOOD);
  const checkpoint = e.writeCheckpoint();
  const before = fuel(e, cell, 1);
  for (let tick = 0; tick < 30; tick++) e.stepWorld();
  const expected = [e.gridHash(), fuel(e), fuel(e, cell, 1)];
  assert.ok(e.readCheckpoint(checkpoint));
  assert.equal(fuel(e, cell, 1), before, 'checkpoint restores remaining burn time');
  for (let tick = 0; tick < 30; tick++) e.stepWorld();
  assert.deepEqual([e.gridHash(), fuel(e), fuel(e, cell, 1)], expected,
    'checkpoint continuation is deterministic');
  e.destroy();
}
console.log('ok: local and cross-layer spread; checkpoint preserves fuel and continuation');

for (const layer of [0, 1]) {
  const e = make(MAT.WOOD, layer), peer = 1 - layer;
  for (let xx = 10; xx <= 85; xx++) {
    e.paintDiscLayer(layer, xx, y, 0, MAT.WOOD, true);
    e.paintDiscLayer(layer, xx, y + 1, 0, MAT.STONE, true);
  }
  e.syncComponentsLayer(layer);
  for (let tick = 0; tick < 60; tick++) {
    for (let xx = 10; xx <= 85; xx += 3) e.paintDiscLayer(layer, xx, y - 1, 0, MAT.FIRE, true);
    e.stepWorld();
  }
  clearFlames(e);
  for (let xx = 9; xx <= 86; xx++) e.paintDiscLayer(layer, xx, y - 1, 0, MAT.STONE, true);
  for (const xx of [9, 86]) e.paintDiscLayer(layer, xx, y, 0, MAT.STONE, true);
  for (let yy = y + 1; yy < rows; yy++) e.paintDiscLayer(peer, x, yy, 0, MAT.STONE, true);
  for (let xx = 10; xx <= 45; xx++) e.paintDiscLayer(peer, xx, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(layer); e.syncComponentsLayer(peer);
  let vented = 0, opportunities = 0;
  for (let tick = 0; tick < 200; tick++) {
    clearFlames(e);
    for (let xx = 46; xx <= 85; xx++) if (fuel(e, y * cols + xx, layer)) opportunities++;
    e.stepWorld();
    for (let xx = 46; xx <= 85; xx++) vented += grid(e, peer)[y * cols + xx] === MAT.FIRE ? 1 : 0;
    for (let xx = 10; xx <= 45; xx++) assert.equal(grid(e, peer)[y * cols + xx], MAT.STONE,
      'cross-layer flames never replace occupied space');
    assert.ok(!grid(e, layer).includes(MAT.FIRE), 'enclosed fuel has no exposed edge for local flames');
  }
  assert.ok(vented > 0, 'enclosed burning fuel occasionally vents into the other layer');
  assert.ok(vented < opportunities * 0.01, 'cross-layer emission is much rarer than edge emission');
  e.destroy();
}
console.log('ok: enclosed fuel rarely vents flames into empty space in either adjacent layer');

{
  const e = make();
  light(e);
  const before = fuel(e);
  e.eraseDisc(x, y + 1, 0);
  for (let tick = 0; tick < 12; tick++) e.stepWorld();
  const owned = [...grid(e).keys()].filter(k => grid(e)[k] === MAT.WOOD
    && e._bodyOwnerGrid(0)[k] >= 0 && fuel(e, k) > 0);
  assert.ok(owned.length > 0, 'detached burning wood keeps a body-local timer');
  assert.ok(owned.some(k => k !== cell), 'burning wood moves with its body');
  assert.ok(owned.every(k => fuel(e, k) === before - 12), 'motion does not reset or accelerate burning');
  const checkpoint = e.writeCheckpoint();
  assert.ok(e.readCheckpoint(checkpoint), 'burning body checkpoint loads');
  assert.equal(fuel(e, owned[0]), before - 12);
  e.destroy();
}
console.log('ok: burning wood retains its remaining fuel through detachment and movement');

for (const layer of [0, 1]) {
  const e = make(MAT.WOOD, layer, true);
  light(e, layer);
  const before = fuel(e, cell, layer);
  for (let i = 0; i < 4; i++) e.shiftWorldXY(32, 0);
  for (let i = 0; i < 4; i++) e.shiftWorldXY(-32, 0);
  assert.equal(grid(e, layer)[cell], MAT.WOOD, 'streamed burning wood retains its material');
  assert.equal(fuel(e, cell, layer), before, 'streaming preserves remaining fuel');
  const worldX = e.getWorldOffsetX() + x, worldY = e.getWorldOffsetY() + y;
  assert.ok(e.resizeLoadedWindow(160, 128));
  const resizedCell = (worldY - e.getWorldOffsetY()) * 160 + worldX - e.getWorldOffsetX();
  assert.equal(fuel(e, resizedCell, layer), before, 'resize preserves remaining fuel');
  e.stepWorld();
  assert.equal(fuel(e, resizedCell, layer), before - 1, 'restored burning cells stay scheduled');
  e.destroy();
}
console.log('ok: both layers preserve burning state through streaming and resizing');

{
  const e = make();
  for (let xx = x - 4; xx <= x + 4; xx++) e.paintDisc(xx, y, 0, MAT.WOOD, true);
  e.syncComponents();
  light(e);
  e.eraseDisc(x, y + 1, 0);
  e.stepWorld();
  const before = [...grid(e).keys()].filter(k => grid(e)[k] === MAT.WOOD && fuel(e, k) > 0);
  assert.ok(before.length > 0);
  const lit = before.find(k => k % cols === x);
  assert.ok(lit !== undefined);
  const remaining = fuel(e, lit);
  const row = Math.floor(lit / cols);
  e.eraseDisc(x - 2, row, 0);
  assert.equal(e._bodyCount(), 2, 'cutting burning wood creates separate bodies');
  assert.equal(fuel(e, lit), remaining, 'splitting preserves the burning cell timer');
  e.spawnBox(x + 5, row, 0, 0, MAT.WOOD);
  assert.equal(fuel(e, lit), remaining, 'placement welding preserves existing burning fuel');
  e.stepWorld();
  assert.ok([...grid(e).keys()].some(k => grid(e)[k] === MAT.WOOD && fuel(e, k) === remaining - 1),
    'split and welded burning fuel continues counting down');
  e.destroy();
}
console.log('ok: splitting and placement welding preserve burning fuel');

{
  const e = make();
  for (let yy = y - 2; yy <= y + 2; yy++)
    for (let xx = x - 3; xx <= x + 3; xx++) e.paintDisc(xx, yy, 0, MAT.STONE, true);
  e.paintDisc(x, y, 0, MAT.WOOD, true);
  e.syncComponents(); light(e);
  const before = fuel(e);
  for (let yy = y + 3; yy < rows; yy++) e.eraseDisc(x, yy, 0);
  e.stepWorld();
  assert.equal(e._bodyCount(), 1, 'mixed wood and stone detach as one body');
  e._setBodyMotion(0, 0.45, -0.2, 0.08);
  let visibleTicks = 0;
  for (let tick = 1; tick <= 45; tick++) {
    e.stepWorld();
    const burning = [...grid(e).keys()].filter(k => grid(e)[k] === MAT.WOOD && fuel(e, k) > 0);
    if (burning.length) visibleTicks++;
    assert.ok(burning.every(k => fuel(e, k) === before - tick - 1),
      'rotation and multiple raster samples advance each fuel cell exactly once');
  }
  assert.ok(visibleTicks > 30, 'burning fuel reappears after gaps in the rotated raster');
  assert.ok(e.readCheckpoint(e.writeCheckpoint()), 'mixed burning-body state is valid');
  const burning = [...grid(e).keys()].find(k => grid(e)[k] === MAT.WOOD && fuel(e, k) > 0);
  assert.ok(burning !== undefined);
  e.paintDiscLayer(1, burning % cols, Math.floor(burning / cols), 4, MAT.WATER, true);
  e.stepWorld();
  assert.ok(![...grid(e).keys()].some(k => grid(e)[k] === MAT.WOOD && fuel(e, k) > 0),
    'water extinguishes fuel attached to a moving rigid body');
  e.destroy();
}
console.log('ok: rotating mixed rigid bodies burn once per fuel cell and can be extinguished');

{
  const e = make();
  for (let xx = x - 4; xx <= x + 4; xx++) {
    e.paintDiscLayer(0, xx, y, 0, xx === x ? MAT.WOOD : MAT.STONE, true);
    e.paintDiscLayer(1, xx, y, 0, MAT.STONE, true);
  }
  e.syncComponentsLayer(0); e.syncComponentsLayer(1); light(e);
  for (let yy = y + 1; yy < rows; yy++) e.eraseDisc(x, yy, 0);
  e.stepWorld();
  assert.equal(e._bodyJointRoleLayer(0, 0), 1, 'overlapping layers detach as a joined rigid body');
  assert.ok(e.readCheckpoint(e.writeCheckpoint()), 'joined burning-body state is valid');
  for (let tick = 0; tick < 430; tick++) e.stepWorld();
  assert.ok(!grid(e).includes(MAT.WOOD), 'joined wood burns away');
  assert.ok(grid(e, 1).includes(MAT.STONE), 'burnout preserves the nonflammable peer body');
  e.destroy();
}

{
  const e = make(); light(e);
  const remaining = fuel(e);
  for (let yy = y + 1; yy < rows; yy++) e.eraseDisc(x, yy, 0);
  for (let tick = 0; tick < remaining; tick++) e.stepWorld();
  assert.ok(!grid(e).includes(MAT.WOOD), 'detached fuel burns out through movement and settling');
  assert.equal(e._bodyCount(), 0, 'spent fuel leaves no invisible rigid body');
  e.destroy();
}

for (const layer of [0, 1]) {
  const e = make(MAT.WOOD, layer);
  const mirror = createEngineWasm({ cols, rows, storageRole: 'presentation', planetId: PLANET.FRONTIER });
  mirror.setSkyLight(0);
  assert.ok(mirror.applyWorldMirror(e.serializeWorld(), 0, 0));
  mirror.renderFullLayer(layer);
  const unlit = [...mirror.getRenderPixelsLayer(layer).slice(cell * 4, cell * 4 + 4)];
  const neighbor = (cell + cols) * 4;
  const brightness = pixels => pixels[neighbor] + pixels[neighbor + 1] + pixels[neighbor + 2];
  const coldNeighbor = brightness(mirror.getRenderPixelsLayer(layer));
  light(e, layer);
  const packet = e.serializeWorld();
  assert.ok(isValidWorldRle(packet, cols * rows));
  assert.ok(mirror.applyWorldMirror(packet, 0, 0));
  assert.equal(mirror.getBurningVisual(!!layer)[cell], 1, 'full snapshot carries the burning filter');
  const colors = new Set();
  const originalGrid = grid(mirror, layer).slice();
  for (let frame = 0; frame < 16; frame++) {
    mirror.renderFullLayer(layer);
    const color = [...mirror.getRenderPixelsLayer(layer).slice(cell * 4, cell * 4 + 4)];
    colors.add(color.join(','));
    assert.equal(color[3], unlit[3], 'the filter preserves material opacity');
    assert.ok(color[0] + color[1] > unlit[0] + unlit[1], 'the filter adds warm orange/yellow light');
    assert.ok(color[0] >= 140 && color[1] >= 75, 'burning fuel stays incandescent in the dark');
  }
  assert.ok(brightness(mirror.getRenderPixelsLayer(layer)) > coldNeighbor + 20,
    'burning fuel emits light onto neighboring material');
  assert.ok(colors.size > 4, 'burning pixels flicker without simulation or new worker packets');
  assert.deepEqual(grid(mirror, layer), originalGrid, 'flicker does not change simulation materials');
  e.resetDirty();
  e.paintDiscLayer(layer, x - 1, y, 0, MAT.WATER, true);
  e.stepWorld();
  const diff = e.serializeDiff();
  assert.ok(isValidWorldDiff(diff, cols, rows));
  assert.ok(mirror.applyDiffMirror(diff));
  assert.equal(mirror.getBurningVisual(!!layer)[cell], 0, 'extinguishing removes the replicated filter');
  light(e, layer);
  assert.ok(mirror.applyWorldMirror(e.serializeWorld(), 0, 0));
  const shift = { cols, rows, shiftDx: 1, shiftDy: 1, worldOffsetX: 1, worldOffsetY: 1 };
  assert.ok(prepareMirrorShift(mirror, shift, Uint8Array.of(0, 0, 0, 0)));
  assert.equal(mirror.getBurningVisual(!!layer)[cell - cols - 1], 1, 'the filter follows mirror streaming');
  e.destroy(); mirror.destroy();
}
console.log('ok: both layers replicate a warm flickering filter without changing material or opacity');
