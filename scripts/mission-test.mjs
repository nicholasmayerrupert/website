// Authored mission progression, rescue-beam interaction, and extraction.
/* global process */

import {
  createEngineWasm,
  initSandWasm,
} from '../src/sand/wasmBridge/engineFactory.js';
import { KIND, MATERIALS, MAT } from '../src/sand/materials.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import {
  CREATURE,
  INPUT,
  ITEM_KIND,
  MISSION,
  MISSION_PHASE,
  OBJECTIVE_KIND,
  OBJECTIVE_STATE,
  PLANET,
} from '../src/sand/wasmBridge/abi.generated.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('IRIS mission authority');

const PLANET_FOR_MISSION = {
  [MISSION.GREENFALL_RECOVERY]: PLANET.EARTH,
  [MISSION.SILENT_QUARRY]: PLANET.MOON,
  [MISSION.RED_FURNACE]: PLANET.MARS,
};

function makeMissionEngine(missionId) {
  const engine = attachTestHooks(createEngineWasm({
    cols: 512,
    rows: 448,
    worldSeed: 0x1A15BEEF,
    sinksOn: false,
    infinite: true,
    planetId: PLANET_FOR_MISSION[missionId],
  }));
  engine.setSurvivalInventory(true);
  engine.setCreatureRuntime(true, false);
  const playerId = engine.spawnPlayerAtSurface(256);
  return { engine, playerId };
}

function livingSpecies(engine, species) {
  return engine.getCreatures().filter((creature) =>
    creature.alive && creature.species === species);
}

function safelyPlacedInWorld(engine, creature) {
  const grid = engine.getGrid();
  const x0 = Math.floor(creature.x);
  const x1 = Math.floor(creature.x + creature.w - 1e-6);
  const y0 = Math.floor(creature.y);
  const y1 = Math.floor(creature.y + creature.h - 1e-6);
  const dangerous = new Set([
    MAT.FIRE, MAT.ACID, MAT.LAVA, MAT.OIL, MAT.METHANE, MAT.TNT,
  ]);
  for (let y = y0 - 4; y <= y1 + 4; y++) {
    for (let x = x0 - 4; x <= x1 + 4; x++) {
      if (x < 0 || x >= engine.cols || y < 0 || y >= engine.rows ||
          dangerous.has(grid[y * engine.cols + x])) return false;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const kind = MATERIALS[grid[y * engine.cols + x]].kind;
      if (kind !== KIND.NONE && kind !== KIND.GAS) return false;
    }
  }
  let support = 0;
  for (let x = x0; x <= x1; x++) {
    const material = grid[(y1 + 1) * engine.cols + x];
    const kind = MATERIALS[material].kind;
    if (kind !== KIND.NONE && kind !== KIND.GAS && kind !== KIND.LIQUID &&
        !dangerous.has(material)) support++;
  }
  return support >= Math.max(2, Math.ceil(creature.w / 2));
}

function eliminate(engine, creatures) {
  for (const creature of creatures) {
    engine.damageCreatures(
      Math.floor(creature.x + creature.w * 0.5),
      Math.floor(creature.y + creature.h * 0.5),
      2,
      100000,
    );
  }
  engine.stepActors();
}

function moveToExtraction(engine, playerId, snapshot) {
  const player = engine.getPlayer(playerId);
  engine.setPlayerState(playerId, {
    x: snapshot.extractionX - engine.getWorldOffsetX() - player.w * 0.5,
    y: snapshot.extractionY - engine.getWorldOffsetY() - player.h * 0.5,
  });
  engine.setPlayerInput(playerId, {});
  engine.stepActors();
}

function rescueSurveyors(engine, playerId) {
  const inventory = engine.getInventory(playerId);
  const rescueSlot = inventory.slots.findIndex(({ itemKind, count }) =>
    itemKind === ITEM_KIND.RESCUE_BEAM && count > 0);
  check('Greenfall issues a rescue beam', rescueSlot >= 0);
  engine.setSelectedSlot(playerId, rescueSlot);

  for (let attempt = 0; attempt < 8; attempt++) {
    const target = livingSpecies(engine, CREATURE.SURVEYOR)[0];
    if (!target) break;
    engine.setPlayerState(playerId, {
      x: target.x - 5,
      y: target.y,
      facing: 1,
    });
    engine.setPlayerInput(playerId, {
      bits: INPUT.PRIMARY,
      aimX: target.x + target.w * 0.5,
      aimY: target.y + target.h * 0.5,
    });
    engine.stepActors();
    engine.setPlayerInput(playerId, {});
    for (let tick = 0; tick < 12; tick++) engine.stepActors();
  }
}

const EXTRACTION_ENEMIES = new Set([
  CREATURE.CRAWLER,
  CREATURE.DYNAMITEER,
  CREATURE.BORE_SENTINEL,
  CREATURE.CAUSTIC_MORTARMAN,
  CREATURE.CLUSTER_WASP,
  CREATURE.MINIGUNNER,
]);

function collectExtractionWaves(engine, baselineIds, required, maxTicks) {
  const reinforcementIds = new Set();
  for (let tick = 0; tick < maxTicks && reinforcementIds.size < required; tick++) {
    engine.stepActors();
    const targets = engine.getCreatures().filter((creature) =>
      creature.alive &&
      creature.spawnProgress === 0 &&
      !baselineIds.has(creature.id) &&
      EXTRACTION_ENEMIES.has(creature.species));
    for (const target of targets) {
      reinforcementIds.add(target.id);
      engine.damageCreatures(
        Math.floor(target.x + target.w * 0.5),
        Math.floor(target.y + target.h * 0.5),
        2,
        100000,
      );
    }
  }
  return reinforcementIds.size;
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  const terrainBefore = [gridHash(engine.getGrid()), gridHash(engine.getGridBg())];
  check('Greenfall starts only on Earth',
    engine.startMission(MISSION.GREENFALL_RECOVERY, playerId));
  check('Greenfall places actors without carving or authoring terrain',
    gridHash(engine.getGrid()) === terrainBefore[0] &&
    gridHash(engine.getGridBg()) === terrainBefore[1]);
  check('Greenfall enemies begin in clear, supported, hazard-free world space',
    [...livingSpecies(engine, CREATURE.DYNAMITEER),
      ...livingSpecies(engine, CREATURE.CAUSTIC_MORTARMAN)]
      .every((creature) => safelyPlacedInWorld(engine, creature)));
  check('a mission engine rejects a second authored operation',
    !engine.startMission(MISSION.GREENFALL_RECOVERY, playerId));
  let snapshot = engine.getMission();
  check('Greenfall begins with a three-enemy clear objective',
    snapshot.phase === MISSION_PHASE.ACTIVE &&
    snapshot.objectives[0].type === OBJECTIVE_KIND.CLEAR &&
    snapshot.objectives[0].required === 3);

  eliminate(engine, [
    ...livingSpecies(engine, CREATURE.DYNAMITEER),
    ...livingSpecies(engine, CREATURE.CAUSTIC_MORTARMAN),
  ]);
  snapshot = engine.getMission();
  check('clearing Greenfall activates the rescue objective',
    snapshot.objectives[0].state === OBJECTIVE_STATE.COMPLETE &&
    snapshot.objectives[1].state === OBJECTIVE_STATE.ACTIVE &&
    livingSpecies(engine, CREATURE.SURVEYOR).length === 3);
  check('Greenfall surveyors wait in clear, supported, hazard-free world space',
    livingSpecies(engine, CREATURE.SURVEYOR)
      .every((creature) => safelyPlacedInWorld(engine, creature)));

  rescueSurveyors(engine, playerId);
  snapshot = engine.getMission();
  check('three rescue-beam tags activate extraction',
    snapshot.objectives[1].current === 3 &&
    snapshot.phase === MISSION_PHASE.EXTRACTION);
  check('Greenfall extraction immediately opens a visible reinforcement breach',
    engine.getCreatures().some(({ spawnProgress }) => spawnProgress > 0));
  const greenfallBaseline = new Set(engine.getCreatures()
    .filter(({ spawnProgress }) => spawnProgress === 0)
    .map(({ id }) => id));
  check('Greenfall extraction sends repeated reinforcements',
    collectExtractionWaves(engine, greenfallBaseline, 2, 600) >= 2);
  moveToExtraction(engine, playerId, snapshot);
  check('Greenfall completes at its surface beacon',
    engine.getMission().phase === MISSION_PHASE.COMPLETE);
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.SILENT_QUARRY);
  const terrainBefore = [gridHash(engine.getGrid()), gridHash(engine.getGridBg())];
  check('Silent Quarry starts on the Moon',
    engine.startMission(MISSION.SILENT_QUARRY, playerId));
  check('Silent Quarry places actors without carving or authoring terrain',
    gridHash(engine.getGrid()) === terrainBefore[0] &&
    gridHash(engine.getGridBg()) === terrainBefore[1]);
  check('Moon actors begin in clear, supported, hazard-free world space',
    [...livingSpecies(engine, CREATURE.IRIS_ENGINEER),
      ...livingSpecies(engine, CREATURE.SURVEYOR),
      ...livingSpecies(engine, CREATURE.SHIELD_ANCHOR)]
      .every((creature) => safelyPlacedInWorld(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  let snapshot = engine.getMission();
  check('two Moon anchors unlock the quarry foreman',
    snapshot.objectives[0].current === 2 &&
    livingSpecies(engine, CREATURE.QUARRY_FOREMAN).length === 1);
  check('the quarry foreman materializes in safe existing world space',
    livingSpecies(engine, CREATURE.QUARRY_FOREMAN)
      .every((creature) => safelyPlacedInWorld(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.QUARRY_FOREMAN));
  snapshot = engine.getMission();
  check('defeating the foreman starts the Moon extraction',
    snapshot.phase === MISSION_PHASE.EXTRACTION);
  check('Silent Quarry extraction immediately opens a visible reinforcement breach',
    engine.getCreatures().some(({ spawnProgress }) => spawnProgress > 0));
  const quarryBaseline = new Set(engine.getCreatures()
    .filter(({ spawnProgress }) => spawnProgress === 0)
    .map(({ id }) => id));
  check('Silent Quarry extraction sends repeated reinforcements',
    collectExtractionWaves(engine, quarryBaseline, 2, 600) >= 2);
  engine.addSpecialItem(playerId, ITEM_KIND.BORE_CANNON, 4);
  const boreSlot = engine.getInventory(playerId).slots.findIndex(({ itemKind }) =>
    itemKind === ITEM_KIND.BORE_CANNON);
  engine.inventoryCursorPick(playerId, boreSlot, false);
  check('Moon beacon follows the surface at its own world column',
    snapshot.extractionY === engine.worldSurfaceAbsAt(snapshot.extractionX) - 5);
  moveToExtraction(engine, playerId, snapshot);
  snapshot = engine.getMission();
  check('Moon extraction records cursor-carried enemy weapons',
    snapshot.phase === MISSION_PHASE.COMPLETE &&
    (snapshot.recoveredWeaponMask & (1 << (
      ITEM_KIND.BORE_CANNON - ITEM_KIND.DYNAMITE_SATCHEL
    ))) !== 0);
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.RED_FURNACE);
  const terrainBefore = [gridHash(engine.getGrid()), gridHash(engine.getGridBg())];
  check('Red Furnace starts on Mars',
    engine.startMission(MISSION.RED_FURNACE, playerId));
  check('Red Furnace places actors without carving or authoring terrain',
    gridHash(engine.getGrid()) === terrainBefore[0] &&
    gridHash(engine.getGridBg()) === terrainBefore[1]);
  check('Mars actors begin in clear, supported, hazard-free world space',
    [...livingSpecies(engine, CREATURE.IRIS_ENGINEER),
      ...livingSpecies(engine, CREATURE.SURVEYOR),
      ...livingSpecies(engine, CREATURE.SHIELD_ANCHOR)]
      .every((creature) => safelyPlacedInWorld(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  let snapshot = engine.getMission();
  check('three Mars anchors unlock the reactor warden',
    snapshot.objectives[0].current === 3 &&
    livingSpecies(engine, CREATURE.REACTOR_WARDEN).length === 1);
  check('the reactor warden materializes in safe existing world space',
    livingSpecies(engine, CREATURE.REACTOR_WARDEN)
      .every((creature) => safelyPlacedInWorld(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.REACTOR_WARDEN));
  snapshot = engine.getMission();
  check('defeating the warden exposes the reactor core',
    snapshot.objectives[2].state === OBJECTIVE_STATE.ACTIVE &&
    livingSpecies(engine, CREATURE.REACTOR_CORE).length === 1);
  check('the reactor core materializes in safe existing world space',
    livingSpecies(engine, CREATURE.REACTOR_CORE)
      .every((creature) => safelyPlacedInWorld(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.REACTOR_CORE));
  snapshot = engine.getMission();
  check('breaching the core triggers the severe threat spike',
    snapshot.phase === MISSION_PHASE.EXTRACTION &&
    snapshot.threatLevel === 3);
  check('Red Furnace extraction immediately opens a visible reinforcement breach',
    engine.getCreatures().some(({ spawnProgress }) => spawnProgress > 0));
  const furnaceBaseline = new Set(engine.getCreatures()
    .filter(({ spawnProgress }) => spawnProgress === 0)
    .map(({ id }) => id));
  check('Red Furnace extraction sends repeated reinforcements',
    collectExtractionWaves(engine, furnaceBaseline, 2, 600) >= 2);
  moveToExtraction(engine, playerId, snapshot);
  check('Red Furnace completes after the altered return route',
    engine.getMission().phase === MISSION_PHASE.COMPLETE);
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.SILENT_QUARRY);
  check('mission/planet mismatches fail closed',
    !engine.startMission(MISSION.RED_FURNACE, playerId));
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  engine.startMission(MISSION.GREENFALL_RECOVERY, playerId);
  eliminate(engine, [
    ...livingSpecies(engine, CREATURE.DYNAMITEER),
    ...livingSpecies(engine, CREATURE.CAUSTIC_MORTARMAN),
  ]);
  eliminate(engine, [livingSpecies(engine, CREATURE.SURVEYOR)[0]]);
  check('planetside Greenfall hostages remain vulnerable mission actors',
    engine.getMission().phase === MISSION_PHASE.FAILED);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
