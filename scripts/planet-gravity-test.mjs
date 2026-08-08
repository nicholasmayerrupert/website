// Planet configuration, deterministic terrain, and gravity ordering.
/* global process */

import {
  initSandWasm, createEngineWasm, MAT, PLANET,
} from '../src/sand/wasmBridge/engineFactory.js';
import {
  CREATURE, INPUT, OFF, SOUND_EVENT, STRIDES,
} from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('planet terrain and gravity');
const WORLD = {
  cols: 256, rows: 256, worldSeed: 0xBEEF77, sinksOn: false, infinite: true,
};
const BIOME_SAMPLE_X = Array.from({ length: 65 }, (_, index) => (index - 32) * 1024);

const signature = (planetId) => {
  const options = planetId === undefined ? WORLD : { ...WORLD, planetId };
  const engine = createEngineWasm(options);
  const result = {
    planet: engine.getPlanet(),
    gravity: engine.getGravityScale(),
    foreground: gridHash(engine.getGrid()),
    background: gridHash(engine.getGridBg()),
    surfaces: [-192, -64, 0, 64, 192].map((x) => engine.worldSurfaceAbsAt(x)),
    biomes: BIOME_SAMPLE_X.map((x) => engine.worldBiomeAt(x)),
    caveBiomes: BIOME_SAMPLE_X.flatMap((x) =>
      [96, 320, 700, 900].map((y) => engine.worldCaveBiomeAt(x, y))),
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
const shipA = signature(PLANET.SHIP);
const shipB = signature(PLANET.SHIP);

check('default engine is explicit Earth',
  defaultEarth.planet === PLANET.EARTH
    && JSON.stringify(defaultEarth) === JSON.stringify(earth));
check(`Earth foreground checksum remains frozen (0x${earth.foreground.toString(16)})`,
  earth.foreground === 0x400dc742);
check(`Earth background checksum remains frozen (0x${earth.background.toString(16)})`,
  earth.background === 0x4a88ebda);
check('Moon generation repeats for the same seed',
  JSON.stringify(moonA) === JSON.stringify(moonB));
check('Mars generation repeats for the same seed',
  JSON.stringify(marsA) === JSON.stringify(marsB));
check('Kestrel generation repeats for the same seed and uses shipboard gravity',
  JSON.stringify(shipA) === JSON.stringify(shipB)
    && shipA.planet === PLANET.SHIP && shipA.gravity === 1);
check('Kestrel is a physical foreground/background world',
  shipA.foreground !== earth.foreground && shipA.background !== earth.background);
{
  const engine = attachTestHooks(createEngineWasm({
    ...WORLD,
    cols: 512,
    rows: 352,
    planetId: PLANET.SHIP,
  }));
  const lightCount = engine.getGrid().reduce(
    (count, material) => count + (material === MAT.LIGHT ? 1 : 0),
    0,
  );
  check(`Kestrel has authored maximum-emission light panels (${lightCount})`,
    lightCount >= 20);
  const localCell = (worldX, worldY) => {
    const x = worldX - engine.getWorldOffsetX();
    const y = worldY - engine.getWorldOffsetY();
    return engine.getGrid()[y * engine.cols + x];
  };
  const blockedMainDeckCells = () => {
    let blocked = 0;
    for (let worldY = 6; worldY <= 17; worldY++) {
      for (let worldX = -88; worldX <= 88; worldX++) {
        if (localCell(worldX, worldY) !== MAT.EMPTY) blocked++;
      }
    }
    return blocked;
  };
  check('Kestrel keeps the crew-level main corridor clear of foreground scenery',
    blockedMainDeckCells() === 0, String(blockedMainDeckCells()));
  engine.setSurvivalInventory(true);
  engine.setCreatureRuntime(true, false);
  const playerId = engine.spawnPlayerAtSurface(engine.cols / 2);
  const crewIds = [
    engine.spawnScriptedCreature(CREATURE.IRIS_COMMANDER, -64, 8),
    engine.spawnScriptedCreature(CREATURE.IRIS_ENGINEER, 64, 8),
    engine.spawnScriptedCreature(CREATURE.SURVEYOR, 30, -23),
  ];
  const crewStart = crewIds.map((id) => {
    const crew = engine.getCreatures().find((creature) => creature.id === id);
    return {
      x: engine.getWorldOffsetX() + crew.x,
      y: engine.getWorldOffsetY() + crew.y,
    };
  });
  const spawn = engine.getPlayer(playerId);
  const pristineForeground = gridHash(engine.getGrid());
  const pristineBackground = gridHash(engine.getGridBg());
  engine.stepActors();
  const shipWorldAdvanced = engine.stepWorld();
  for (let tick = 1; tick < 30; tick++) {
    engine.stepActors();
    engine.stepWorld();
  }
  const settledForeground = gridHash(engine.getGrid());
  const settledBackground = gridHash(engine.getGridBg());
  for (let tick = 30; tick < 120; tick++) {
    engine.stepActors();
    engine.stepWorld();
  }
  check('Kestrel advances its full cellular world physics',
    shipWorldAdvanced &&
      (settledForeground !== pristineForeground ||
       settledBackground !== pristineBackground));
  check('the untouched Kestrel settles without destabilizing its authored hull',
    gridHash(engine.getGrid()) === settledForeground &&
      gridHash(engine.getGridBg()) === settledBackground &&
      blockedMainDeckCells() === 0 &&
      engine.getGrid().reduce(
        (count, material) => count + (material === MAT.LIGHT ? 1 : 0),
        0,
      ) === lightCount);
  check('the Kestrel frame keeps its player and crew on their authored decks',
    Math.abs(engine.getPlayer(playerId).y - spawn.y) < 0.01 &&
      crewIds.every((id, index) => {
        const crew = engine.getCreatures().find((creature) => creature.id === id);
        return Math.abs(engine.getWorldOffsetX() + crew.x - crewStart[index].x) < 0.01 &&
          Math.abs(engine.getWorldOffsetY() + crew.y - crewStart[index].y) < 0.01;
      }));
  engine.setPlayerState(playerId, {
    x: spawn.x,
    y: 60 - engine.getWorldOffsetY(),
  });
  engine.drainSoundEvents();
  for (let tick = 0; tick < 40; tick++) engine.stepActors();
  const falling = engine.getPlayer(playerId);
  check('Kestrel waits briefly before recovering a player below the hull',
    engine.getWorldOffsetY() + falling.y > 52);
  for (let tick = 0; tick < 4; tick++) engine.stepActors();
  const recovered = engine.getPlayer(playerId);
  check('Kestrel automatically beams a player back from open space',
    Math.abs(recovered.x - spawn.x) < 12 &&
      Math.abs(recovered.y - spawn.y) < 12);
  const recoverySounds = engine.drainSoundEvents();
  check('Kestrel recovery emits a transporter beam cue',
    Array.from({ length: recoverySounds.length / STRIDES.soundEvent },
      (_, index) => recoverySounds[index * STRIDES.soundEvent + OFF.soundEvent.type])
      .includes(SOUND_EVENT.BEAM));
  for (const id of crewIds) {
    const crew = engine.getCreatures().find((creature) => creature.id === id);
    engine.damageCreatures(
      Math.floor(crew.x + crew.w * 0.5),
      Math.floor(crew.y + crew.h * 0.5),
      2,
      100000,
    );
  }
  engine.stepActors();
  check('the Kestrel commander and authored crew cannot be killed',
    crewIds.every((id) => {
      const crew = engine.getCreatures().find((creature) => creature.id === id);
      return crew?.alive && crew.health === crew.maxHealth;
    }));

  engine.drainSoundEvents();
  const shooter = engine.getPlayer(playerId);
  const gunForegroundBefore = gridHash(engine.getGrid());
  const gunBackgroundBefore = gridHash(engine.getGridBg());
  const gunItemsBefore = engine.itemCount();
  const gunSounds = new Set();
  engine.setPlayerInput(playerId, {
    bits: INPUT.PRIMARY,
    aimX: shooter.x + 20,
    aimY: 18 - engine.getWorldOffsetY(),
    seq: 1,
  });
  engine.stepActors();
  engine.setPlayerInput(playerId, {
    bits: 0,
    aimX: shooter.x + 20,
    aimY: 18 - engine.getWorldOffsetY(),
    seq: 2,
  });
  let gunPeakItems = engine.itemCount();
  for (let tick = 0; tick < 8; tick++) {
    engine.stepActors();
    gunPeakItems = Math.max(gunPeakItems, engine.itemCount());
    const sounds = engine.drainSoundEvents();
    for (let i = 0; i < sounds.length; i += STRIDES.soundEvent)
      gunSounds.add(sounds[i + OFF.soundEvent.type]);
  }
  check('the blast gun still produces a full impact explosion aboard Kestrel',
    gunSounds.has(SOUND_EVENT.BLAST_GUN) &&
      gunSounds.has(SOUND_EVENT.WEAPON_EXPLOSION) &&
      gunPeakItems > gunItemsBefore);
  check('player blast-gun impacts carve the Kestrel hull',
    gridHash(engine.getGrid()) !== gunForegroundBefore ||
      gridHash(engine.getGridBg()) !== gunBackgroundBefore);
  const blastForeground = gridHash(engine.getGrid());
  const blastBackground = gridHash(engine.getGridBg());
  for (let tick = 0; tick < 24; tick++) engine.stepWorld();
  check('Kestrel blast aftermath continues evolving under world physics',
    gridHash(engine.getGrid()) !== blastForeground ||
      gridHash(engine.getGridBg()) !== blastBackground);
  for (let tick = 0; tick < 24; tick++) engine.stepActors();

  const foregroundBefore = gridHash(engine.getGrid());
  const backgroundBefore = gridHash(engine.getGridBg());
  engine._detonateTnt(
    -engine.getWorldOffsetX(),
    18 - engine.getWorldOffsetY(),
  );
  check('ordinary Kestrel detonations use full two-layer blast physics',
    gridHash(engine.getGrid()) !== foregroundBefore ||
      gridHash(engine.getGridBg()) !== backgroundBefore);
  engine.destroy();
}
check('all three planets generate distinct foreground terrain',
  new Set([earth.foreground, moonA.foreground, marsA.foreground]).size === 3);
check('all three planets generate distinct surface profiles',
  new Set([
    earth.surfaces.join(','), moonA.surfaces.join(','), marsA.surfaces.join(','),
  ]).size === 3);
check('Moon and Mars each expose six surface biome families',
  new Set(moonA.biomes).size === 6 && new Set(marsA.biomes).size === 6);
check('Moon and Mars each expose upper and deep cave biome families',
  new Set(moonA.caveBiomes).size >= 7 && new Set(marsA.caveBiomes).size >= 7);
check('planet defaults expose 1.0g, 0.33g, and 0.76g',
  earth.gravity === 1 && Math.abs(moonA.gravity - 0.33) < 1e-12
    && Math.abs(marsA.gravity - 0.76) < 1e-12);

const surveyOffworldStructures = (planetId) => {
  const cols = 384, rows = 320;
  const engine = createEngineWasm({
    cols, rows, worldSeed: WORLD.worldSeed, sinksOn: false, infinite: true, planetId,
  });
  engine.shiftWorldXY(0, -64);
  const structures = new Map();
  const constructed = new Set([
    MAT.COPPER_ORE, MAT.IRON_ORE, MAT.GOLD_ORE, MAT.BRICK, MAT.PINE_WOOD,
    MAT.CRYSTAL, MAT.GLASS, MAT.LIGHT, MAT.PLANT, MAT.GLOWBERRY,
  ]);
  let furnishedCells = 0;
  for (let band = 0; band < 36; band++) {
    const foreground = engine.getGrid(), background = engine.getGridBg();
    const offsetX = engine.getWorldOffsetX(), offsetY = engine.getWorldOffsetY();
    const seen = new Uint8Array(foreground.length);
    const stack = [];
    for (let start = 0; start < foreground.length; start++) {
      if (seen[start]) continue;
      const startX = start % cols, startY = (start / cols) | 0;
      const startWorldY = offsetY + startY;
      if (startWorldY >= engine.worldSurfaceAbsAt(offsetX + startX)
          || (foreground[start] === MAT.EMPTY && background[start] === MAT.EMPTY)) continue;
      seen[start] = 1;
      stack.push(start);
      let cells = 0, minX = cols, maxX = -1, minY = rows, maxY = -1;
      const materials = new Set();
      while (stack.length) {
        const k = stack.pop();
        const x = k % cols, y = (k / cols) | 0;
        cells++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (foreground[k] !== MAT.EMPTY) materials.add(foreground[k]);
        if (background[k] !== MAT.EMPTY) materials.add(background[k]);
        const neighbors = [
          x ? k - 1 : -1, x + 1 < cols ? k + 1 : -1,
          y ? k - cols : -1, y + 1 < rows ? k + cols : -1,
        ];
        for (const next of neighbors) {
          if (next < 0 || seen[next]) continue;
          const nx = next % cols, ny = (next / cols) | 0;
          if (offsetY + ny >= engine.worldSurfaceAbsAt(offsetX + nx)
              || (foreground[next] === MAT.EMPTY && background[next] === MAT.EMPTY)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      const width = maxX - minX + 1, height = maxY - minY + 1;
      if (cells < 180 || width < 70 || height < 18 || minX === 0 || maxX === cols - 1)
        continue;
      const centerX = offsetX + Math.round((minX + maxX) / 2);
      const key = Math.round(centerX / 48);
      const existing = structures.get(key);
      if (!existing || cells > existing.cells)
        structures.set(key, { centerX, cells, width, height, materials });
    }
    for (let k = 0; k < background.length; k++) {
      const x = k % cols, y = (k / cols) | 0;
      const worldY = offsetY + y;
      const depth = worldY - engine.worldSurfaceAbsAt(offsetX + x);
      if (depth >= 18 && depth <= 160 && constructed.has(background[k]))
        furnishedCells++;
    }
    engine.shiftWorldXY(128, 0);
  }
  engine.destroy();
  const profiles = new Set([...structures.values()].map((structure) => {
    const marker = [
      structure.materials.has(MAT.PLANT), structure.materials.has(MAT.COPPER_ORE),
      structure.materials.has(MAT.LIGHT), structure.materials.has(MAT.BRICK),
    ].map(Number).join('');
    return `${Math.round(structure.width / 10)}:${Math.round(structure.height / 10)}:${marker}`;
  }));
  return { structures: [...structures.values()], profiles, furnishedCells };
};

const moonStructures = surveyOffworldStructures(PLANET.MOON);
const marsStructures = surveyOffworldStructures(PLANET.MARS);
for (const [name, survey] of [['Moon', moonStructures], ['Mars', marsStructures]]) {
  const widest = Math.max(...survey.structures.map((structure) => structure.width));
  const tallest = Math.max(...survey.structures.map((structure) => structure.height));
  const richest = Math.max(...survey.structures.map((structure) => structure.materials.size));
  check(`${name} landmarks are frequent and dramatically scaled (${survey.structures.length}, ${widest}x${tallest})`,
    survey.structures.length >= 6 && widest >= 185 && tallest >= 55);
  check(`${name} exposes at least three large structure silhouettes (${survey.profiles.size} profiles)`,
    survey.profiles.size >= 3);
  check(`${name} structures contain layered material detail (${richest} materials, ${survey.furnishedCells} furnished cells)`,
    richest >= 6 && survey.furnishedCells >= 40000);
}
check('Moon and Mars use separate architectural palettes',
  moonStructures.structures.every((structure) => !structure.materials.has(MAT.BRICK))
    && marsStructures.structures.every((structure) => structure.materials.has(MAT.BRICK)));
check('Moon generates observatory, mass-driver, and far-side relay silhouettes',
  moonStructures.structures.some((structure) =>
    structure.materials.has(MAT.GOLD_ORE))
    && moonStructures.structures.some((structure) =>
      structure.materials.has(MAT.IRON_ORE) && structure.materials.has(MAT.LIGHT)
        && !structure.materials.has(MAT.GOLD_ORE))
    && moonStructures.structures.some((structure) =>
      !structure.materials.has(MAT.IRON_ORE) && !structure.materials.has(MAT.GOLD_ORE)));
check('Martian greenhouse arcologies add a planet-unique inhabited silhouette',
  marsStructures.structures.some((structure) =>
    structure.materials.has(MAT.PLANT) && structure.materials.has(MAT.GLASS))
    && moonStructures.structures.every((structure) => !structure.materials.has(MAT.PLANT)));
check('Mars generates greenhouse, refinery, and canyon-foundry silhouettes',
  marsStructures.structures.some((structure) =>
    structure.materials.has(MAT.PLANT) && structure.materials.has(MAT.GLASS))
    && marsStructures.structures.some((structure) =>
      structure.materials.has(MAT.GOLD_ORE) && !structure.materials.has(MAT.PLANT))
    && marsStructures.structures.some((structure) =>
      structure.materials.has(MAT.GLASS) && !structure.materials.has(MAT.PLANT)));

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
