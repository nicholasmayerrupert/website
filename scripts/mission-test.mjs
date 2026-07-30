// Authored mission progression, rescue-beam interaction, and extraction.
/* global process */

import {
  createEngineWasm,
  initSandWasm,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
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
import { makeChecker } from './sand-test-util.mjs';

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

function backgroundBodyBaseline(missionId) {
  const engine = attachTestHooks(createEngineWasm({
    cols: 512,
    rows: 448,
    worldSeed: 0x1A15BEEF,
    sinksOn: false,
    infinite: true,
    planetId: PLANET_FOR_MISSION[missionId],
  }));
  for (let tick = 0; tick < 3; tick++) engine.stepWorld();
  const count = engine._bodyCountLayer(1);
  engine.destroy();
  return count;
}

function livingSpecies(engine, species) {
  return engine.getCreatures().filter((creature) =>
    creature.alive && creature.species === species);
}

function insideFurnishedFacility(engine, creature) {
  const foreground = engine.getGrid();
  const background = engine.getGridBg();
  const cx = Math.floor(creature.x + creature.w * 0.5);
  const cy = Math.floor(creature.y + creature.h * 0.5);
  let frame = 0;
  const details = new Set();
  for (let y = Math.max(1, cy - 22); y <= Math.min(engine.rows - 2, cy + 22); y++) {
    for (let x = Math.max(1, cx - 24); x <= Math.min(engine.cols - 2, cx + 24); x++) {
      const k = y * engine.cols + x;
      if (foreground[k] === MAT.BRICK || foreground[k] === MAT.STONE) frame++;
      if (background[k] === MAT.LIGHT || background[k] === MAT.GLASS ||
          background[k] === MAT.PINE_WOOD || background[k] === MAT.IRON_ORE)
        details.add(background[k]);
    }
  }
  return frame >= 30 && details.size >= 3;
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

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  const backgroundBodies = engine._bodyCountLayer(1);
  const settledBackgroundBodies = backgroundBodyBaseline(MISSION.GREENFALL_RECOVERY);
  check('Greenfall starts only on Earth',
    engine.startMission(MISSION.GREENFALL_RECOVERY, playerId));
  check('Greenfall facilities begin as grounded background structure',
    engine._bodyCountLayer(1) === backgroundBodies);
  for (let tick = 0; tick < 3; tick++) engine.stepWorld();
  check('Greenfall facilities remain grounded after world steps',
    engine._bodyCountLayer(1) === settledBackgroundBodies);
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
  check('Greenfall surveyors wait inside furnished facility rooms',
    livingSpecies(engine, CREATURE.SURVEYOR)
      .every((creature) => insideFurnishedFacility(engine, creature)));

  rescueSurveyors(engine, playerId);
  snapshot = engine.getMission();
  check('three rescue-beam tags activate extraction',
    snapshot.objectives[1].current === 3 &&
    snapshot.phase === MISSION_PHASE.EXTRACTION);
  moveToExtraction(engine, playerId, snapshot);
  check('Greenfall completes at its surface beacon',
    engine.getMission().phase === MISSION_PHASE.COMPLETE);
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.SILENT_QUARRY);
  const backgroundBodies = engine._bodyCountLayer(1);
  const settledBackgroundBodies = backgroundBodyBaseline(MISSION.SILENT_QUARRY);
  check('Silent Quarry starts on the Moon',
    engine.startMission(MISSION.SILENT_QUARRY, playerId));
  check('Moon facilities begin as grounded background structure',
    engine._bodyCountLayer(1) === backgroundBodies);
  for (let tick = 0; tick < 3; tick++) engine.stepWorld();
  check('Moon facilities remain grounded after world steps',
    engine._bodyCountLayer(1) === settledBackgroundBodies);
  check('Moon human residents occupy furnished facility rooms',
    [...livingSpecies(engine, CREATURE.IRIS_ENGINEER),
      ...livingSpecies(engine, CREATURE.SURVEYOR)]
      .every((creature) => insideFurnishedFacility(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  let snapshot = engine.getMission();
  check('two Moon anchors unlock the quarry foreman',
    snapshot.objectives[0].current === 2 &&
    livingSpecies(engine, CREATURE.QUARRY_FOREMAN).length === 1);
  eliminate(engine, livingSpecies(engine, CREATURE.QUARRY_FOREMAN));
  snapshot = engine.getMission();
  check('defeating the foreman starts the Moon extraction',
    snapshot.phase === MISSION_PHASE.EXTRACTION);
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
  const backgroundBodies = engine._bodyCountLayer(1);
  const settledBackgroundBodies = backgroundBodyBaseline(MISSION.RED_FURNACE);
  check('Red Furnace starts on Mars',
    engine.startMission(MISSION.RED_FURNACE, playerId));
  check('Mars facilities begin as grounded background structure',
    engine._bodyCountLayer(1) === backgroundBodies);
  for (let tick = 0; tick < 3; tick++) engine.stepWorld();
  check('Mars facilities remain grounded after world steps',
    engine._bodyCountLayer(1) === settledBackgroundBodies);
  check('Mars human residents occupy furnished facility rooms',
    [...livingSpecies(engine, CREATURE.IRIS_ENGINEER),
      ...livingSpecies(engine, CREATURE.SURVEYOR)]
      .every((creature) => insideFurnishedFacility(engine, creature)));
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  let snapshot = engine.getMission();
  check('three Mars anchors unlock the reactor warden',
    snapshot.objectives[0].current === 3 &&
    livingSpecies(engine, CREATURE.REACTOR_WARDEN).length === 1);
  eliminate(engine, livingSpecies(engine, CREATURE.REACTOR_WARDEN));
  snapshot = engine.getMission();
  check('defeating the warden exposes the reactor core',
    snapshot.objectives[2].state === OBJECTIVE_STATE.ACTIVE &&
    livingSpecies(engine, CREATURE.REACTOR_CORE).length === 1);
  eliminate(engine, livingSpecies(engine, CREATURE.REACTOR_CORE));
  snapshot = engine.getMission();
  check('breaching the core triggers the severe threat spike',
    snapshot.phase === MISSION_PHASE.EXTRACTION &&
    snapshot.threatLevel === 3);
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

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
