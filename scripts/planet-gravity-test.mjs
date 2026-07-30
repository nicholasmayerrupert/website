// Planet configuration, deterministic terrain, and gravity ordering.
/* global process */

import {
  initSandWasm, createEngineWasm, MAT, PLANET,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('planet terrain and gravity');
const WORLD = {
  cols: 256, rows: 256, worldSeed: 0xBEEF77, sinksOn: false, infinite: true,
};

const signature = (planetId) => {
  const options = planetId === undefined ? WORLD : { ...WORLD, planetId };
  const engine = createEngineWasm(options);
  const result = {
    planet: engine.getPlanet(),
    gravity: engine.getGravityScale(),
    foreground: gridHash(engine.getGrid()),
    background: gridHash(engine.getGridBg()),
    surfaces: [-192, -64, 0, 64, 192].map((x) => engine.worldSurfaceAbsAt(x)),
  };
  engine.destroy();
  return result;
};

const defaultEarth = signature();
const earth = signature(PLANET.EARTH);
const moonA = signature(PLANET.MOON);
const moonB = signature(PLANET.MOON);
const marsA = signature(PLANET.MARS);
const marsB = signature(PLANET.MARS);

check('default engine is explicit Earth',
  defaultEarth.planet === PLANET.EARTH
    && JSON.stringify(defaultEarth) === JSON.stringify(earth));
check(`Earth foreground checksum remains frozen (0x${earth.foreground.toString(16)})`,
  earth.foreground === 0x400dc742);
check(`Earth background checksum remains frozen (0x${earth.background.toString(16)})`,
  earth.background === 0x4b2c4787);
check('Moon generation repeats for the same seed',
  JSON.stringify(moonA) === JSON.stringify(moonB));
check('Mars generation repeats for the same seed',
  JSON.stringify(marsA) === JSON.stringify(marsB));
check('all three planets generate distinct foreground terrain',
  new Set([earth.foreground, moonA.foreground, marsA.foreground]).size === 3);
check('all three planets generate distinct surface profiles',
  new Set([
    earth.surfaces.join(','), moonA.surfaces.join(','), marsA.surfaces.join(','),
  ]).size === 3);
check('planet defaults expose 1.0g, 0.165g, and 0.38g',
  earth.gravity === 1 && Math.abs(moonA.gravity - 0.165) < 1e-12
    && Math.abs(marsA.gravity - 0.38) < 1e-12);

const fallSample = (planetId) => {
  const engine = attachTestHooks(createEngineWasm({
    cols: 128, rows: 160, worldSeed: 7, sinksOn: false, infinite: false, planetId,
  }));
  const playerId = engine.spawnPlayer(64, 30);
  engine.paintDisc(28, 10, 0, MAT.SAND, true);
  engine.paintDisc(100, 10, 0, MAT.WATER, true);
  engine.spawnBox(48, 16, 2, 2, MAT.RIGID);
  for (let i = 0; i < 12; i++) {
    engine.stepActors();
    engine.stepWorld();
  }
  const rowOf = (material, x) => {
    const grid = engine.getGrid();
    for (let y = 0; y < engine.rows; y++)
      if (grid[y * engine.cols + x] === material) return y;
    return -1;
  };
  const result = {
    playerY: engine.getPlayer(playerId).y,
    sandY: rowOf(MAT.SAND, 28),
    waterY: rowOf(MAT.WATER, 100),
    rigidY: engine._bodyState(0)?.py ?? -1,
  };
  engine.destroy();
  return result;
};

const earthFall = fallSample(PLANET.EARTH);
const marsFall = fallSample(PLANET.MARS);
const moonFall = fallSample(PLANET.MOON);
check('player freefall orders Earth > Mars > Moon',
  earthFall.playerY > marsFall.playerY && marsFall.playerY > moonFall.playerY);
check('loose-solid freefall orders Earth > Mars > Moon',
  earthFall.sandY > marsFall.sandY && marsFall.sandY > moonFall.sandY);
check('fluid freefall orders Earth > Mars > Moon',
  earthFall.waterY > marsFall.waterY && marsFall.waterY > moonFall.waterY);
check('rigid-body freefall orders Earth > Mars > Moon',
  earthFall.rigidY > marsFall.rigidY && marsFall.rigidY > moonFall.rigidY);

{
  const engine = createEngineWasm({
    cols: 96,
    rows: 80,
    worldSeed: 9,
    sinksOn: false,
    infinite: false,
    gravityScale: 0.05,
  });
  for (let y = 31; y < engine.rows; y++) engine.addDiscToStoneDraft(48, y, 0);
  engine.finalizeStoneDraft();
  engine.paintDisc(48, 29, 0, MAT.WATER, true);
  const waterRow = () => {
    const grid = engine.getGrid();
    for (let y = 1; y < engine.rows; y++)
      if (grid[y * engine.cols + 48] === MAT.WATER) return y;
    return -1;
  };
  for (let tick = 0; tick < 19; tick++) engine.stepWorld();
  check('fractional gravity keeps vertical liquid gaps parked before its pulse',
    waterRow() === 29);
  engine.stepWorld();
  check('fractional gravity advances the liquid on its fixed-point pulse',
    waterRow() === 30);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
