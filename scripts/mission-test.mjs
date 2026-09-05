// Authored mission progression, rescue-beam interaction, and extraction.
/* global process */

import {
  createEngineWasm,
  initSandWasm,
} from '../src/sand/wasmBridge/engineFactory.js';
import { KIND, MATERIAL_BY_ID, MAT } from '../src/sand/materials.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import {
  CREATURE,
  INPUT,
  ITEM_KIND,
  MISSION,
  MISSION_PHASE,
  OBJECTIVE_KIND,
  OBJECTIVE_STATE,
  OFF,
  PLANET,
  PROJECTILE_KIND,
  SOUND_EVENT,
  STRIDES,
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
  const engine = attachTestHooks(
    createEngineWasm({
      cols: 512,
      rows: 448,
      worldSeed: 0x1a15beef,
      sinksOn: false,
      infinite: true,
      planetId: PLANET_FOR_MISSION[missionId],
    }),
  );
  engine.setSurvivalInventory(true);
  engine.setCreatureRuntime(true, false);
  const playerId = engine.spawnPlayerAtSurface(256);
  return { engine, playerId };
}

function livingSpecies(engine, species) {
  return engine
    .getCreatures()
    .filter((creature) => creature.alive && creature.species === species);
}

function safelyPlacedInWorld(engine, creature) {
  const grid = engine.getGrid();
  const x0 = Math.floor(creature.x);
  const x1 = Math.floor(creature.x + creature.w - 1e-6);
  const y0 = Math.floor(creature.y);
  const y1 = Math.floor(creature.y + creature.h - 1e-6);
  const dangerous = new Set([
    MAT.FIRE,
    MAT.ACID,
    MAT.LAVA,
    MAT.OIL,
    MAT.METHANE,
    MAT.TNT,
  ]);
  for (let y = y0 - 4; y <= y1 + 4; y++) {
    for (let x = x0 - 4; x <= x1 + 4; x++) {
      if (
        x < 0 ||
        x >= engine.cols ||
        y < 0 ||
        y >= engine.rows ||
        dangerous.has(grid[y * engine.cols + x])
      )
        return false;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const kind = MATERIAL_BY_ID[grid[y * engine.cols + x]].kind;
      if (kind !== KIND.NONE && kind !== KIND.GAS) return false;
    }
  }
  let support = 0;
  for (let x = x0; x <= x1; x++) {
    const material = grid[(y1 + 1) * engine.cols + x];
    const kind = MATERIAL_BY_ID[material].kind;
    if (
      kind !== KIND.NONE &&
      kind !== KIND.GAS &&
      kind !== KIND.LIQUID &&
      !dangerous.has(material)
    )
      support++;
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
  if (snapshot.missionId === MISSION.GREENFALL_RECOVERY) {
    for (let tick = 0; tick < 30; tick++) engine.stepActors();
    check(
      'entering the pad begins transport without completing immediately',
      engine.getMission().phase === MISSION_PHASE.EXTRACTION &&
        engine
          .getProjectiles()
          .some(
            (p) =>
              p.kind === PROJECTILE_KIND.EXTRACTION_BEAM &&
              p.charge > 0 &&
              p.charge < 1,
          ),
    );
    const pad = engine.getPlayer(playerId);
    engine.setPlayerState(playerId, { x: pad.x + 40, y: pad.y });
    engine.stepActors();
    check(
      'leaving the pad resets transport',
      engine
        .getProjectiles()
        .find((p) => p.kind === PROJECTILE_KIND.EXTRACTION_BEAM)?.charge === 0,
    );
    engine.setPlayerState(playerId, { x: pad.x, y: pad.y });
    for (let tick = 0; tick < 119; tick++) engine.stepActors();
    check(
      'transport requires a fresh uninterrupted two seconds',
      engine.getMission().phase === MISSION_PHASE.EXTRACTION,
    );
    engine.stepActors();
  }
}

function rescueSurveyors(engine, playerId) {
  const inventory = engine.getInventory(playerId);
  const rescueSlot = inventory.slots.findIndex(
    ({ itemKind, count }) => itemKind === ITEM_KIND.RESCUE_BEAM && count > 0,
  );
  check('Greenfall issues a rescue beam', rescueSlot >= 0);
  engine.setSelectedSlot(playerId, rescueSlot);
  let beamSounds = 0;
  engine.drainSoundEvents();

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
    for (let tick = 0; tick < 20; tick++) engine.stepActors();
    if (attempt === 0) {
      const partial = engine.getCreatures().find((c) => c.id === target.id);
      check(
        'a short beam hold starts a visible channel without rescuing',
        partial.alive &&
          partial.rescueProgress > 0.2 &&
          partial.rescueProgress < 0.5,
      );
      engine.setPlayerInput(playerId, {});
      for (let tick = 0; tick < 30; tick++) engine.stepActors();
      check(
        'releasing the beam loses unfinished rescue progress',
        engine.getCreatures().find((c) => c.id === target.id)
          ?.rescueProgress === 0,
      );
    }
    for (let tick = 0; tick < 90; tick++) {
      const current = engine
        .getCreatures()
        .find((c) => c.id === target.id && c.alive);
      if (!current) break;
      engine.setPlayerInput(playerId, {
        bits: INPUT.PRIMARY,
        aimX: current.x + current.w / 2,
        aimY: current.y + current.h / 2,
      });
      engine.stepActors();
    }
    const rescued = engine.getCreatures().find((c) => c.id === target.id);
    check(
      `researcher ${attempt + 1} leaves through an animated beam`,
      rescued &&
        !rescued.alive &&
        rescued.rescueProgress >= 1 &&
        rescued.rescueProgress < 2,
    );
    check(
      'holding the rescue beam keeps a bounded single beam effect',
      engine
        .getProjectiles()
        .filter((p) => p.kind === PROJECTILE_KIND.RESCUE_BEAM).length <= 1,
    );
    const sounds = engine.drainSoundEvents();
    for (let i = 0; i < sounds.length; i += STRIDES.soundEvent)
      if (sounds[i + OFF.soundEvent.type] === SOUND_EVENT.BEAM) beamSounds++;
    engine.setPlayerInput(playerId, {});
    for (let tick = 0; tick < 12; tick++) engine.stepActors();
  }
  check('successful rescue-beam tags emit beam cues', beamSounds === 3);
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
  for (
    let tick = 0;
    tick < maxTicks && reinforcementIds.size < required;
    tick++
  ) {
    engine.stepActors();
    const targets = engine
      .getCreatures()
      .filter(
        (creature) =>
          creature.alive &&
          creature.spawnProgress === 0 &&
          !baselineIds.has(creature.id) &&
          EXTRACTION_ENEMIES.has(creature.species),
      );
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
  const terrainBefore = [
    gridHash(engine.getGrid()),
    gridHash(engine.getGridBg()),
  ];
  check(
    'Greenfall starts only on Earth',
    engine.startMission(MISSION.GREENFALL_RECOVERY, playerId),
  );
  check(
    'Greenfall authors its relay and refuge in both simulated layers',
    gridHash(engine.getGrid()) !== terrainBefore[0] &&
      gridHash(engine.getGridBg()) !== terrainBefore[1],
  );
  check(
    'Greenfall enemies begin in clear, supported, hazard-free world space',
    [
      ...livingSpecies(engine, CREATURE.DYNAMITEER),
      ...livingSpecies(engine, CREATURE.MINIGUNNER),
      ...livingSpecies(engine, CREATURE.BORE_SENTINEL),
    ].every((creature) => safelyPlacedInWorld(engine, creature)),
  );
  const landing = engine.getMission();
  const siteCenter = landing.extractionX + 105 - engine.getWorldOffsetX();
  const siteSurface = landing.extractionY + 6 - engine.getWorldOffsetY();
  check(
    'guards remain on their authored encounter platforms',
    [
      [CREATURE.DYNAMITEER, -25, 19],
      [CREATURE.MINIGUNNER, 94, 77],
      [CREATURE.BORE_SENTINEL, -5, 127],
    ].every(([species, x, y]) => {
      const c = livingSpecies(engine, species)[0];
      return (
        c &&
        Math.abs(c.x + c.w / 2 - siteCenter - x) <= 6 &&
        Math.abs(c.y + c.h - siteSurface - y) <= 8
      );
    }),
  );
  const healthBeforeSettling = engine.getCreatures().map((c) => c.health);
  for (let tick = 0; tick < 120; tick++) engine.step((tick * 1000) / 60);
  check(
    'relay foundations and idle sentries survive two seconds of world physics',
    engine
      .getCreatures()
      .every((c, i) => c.alive && c.health === healthBeforeSettling[i]) &&
      engine.getPlayer(playerId).health === 100,
  );
  check(
    'a mission engine rejects a second authored operation',
    !engine.startMission(MISSION.GREENFALL_RECOVERY, playerId),
  );
  check(
    'rescue beam occupies the taught third hotbar slot',
    engine.getInventory(playerId).slots[2].itemKind === ITEM_KIND.RESCUE_BEAM,
  );
  let snapshot = engine.getMission();
  check(
    'Greenfall starts at the jammer with three objectives and all occupants present',
    snapshot.phase === MISSION_PHASE.ACTIVE &&
      snapshot.objectives.length === 3 &&
      snapshot.objectives[0].type === OBJECTIVE_KIND.ANCHOR &&
      snapshot.objectives[0].required === 1 &&
      livingSpecies(engine, CREATURE.SHIELD_ANCHOR).length === 1,
  );
  const crewIds = livingSpecies(engine, CREATURE.SURVEYOR).map((c) => c.id);
  check(
    'all three researchers begin in powered shelters',
    crewIds.length === 3 &&
      livingSpecies(engine, CREATURE.SURVEYOR).every(
        (c) => c.shelterCharge === 1,
      ),
  );
  eliminate(engine, livingSpecies(engine, CREATURE.SURVEYOR));
  check(
    'powered shelters protect researchers from collateral damage',
    livingSpecies(engine, CREATURE.SURVEYOR).length === 3 &&
      engine.getMission().phase === MISSION_PHASE.ACTIVE,
  );
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  snapshot = engine.getMission();
  check(
    'destroying the jammer unlocks rescue while all three guards are alive',
    snapshot.objectives[0].state === OBJECTIVE_STATE.COMPLETE &&
      snapshot.objectives[1].state === OBJECTIVE_STATE.ACTIVE &&
      [CREATURE.DYNAMITEER, CREATURE.MINIGUNNER, CREATURE.BORE_SENTINEL].every(
        (species) => livingSpecies(engine, species).length === 1,
      ),
  );
  check(
    'shelter opening animates on the same existing actors',
    livingSpecies(engine, CREATURE.SURVEYOR).every(
      (c) => crewIds.includes(c.id) && c.shelterCharge > 0,
    ),
  );
  eliminate(engine, [
    ...livingSpecies(engine, CREATURE.DYNAMITEER),
    ...livingSpecies(engine, CREATURE.MINIGUNNER),
    ...livingSpecies(engine, CREATURE.BORE_SENTINEL),
  ]);
  for (let tick = 0; tick < 46; tick++) engine.stepActors();
  check(
    'shelters finish opening without replacing their occupants',
    livingSpecies(engine, CREATURE.SURVEYOR).every(
      (c) => crewIds.includes(c.id) && c.shelterCharge === 0,
    ),
  );
  check(
    'the rescue phase equips the beam',
    engine.getInventory(playerId).selected === 2,
  );
  check(
    'researchers retain safe refuge positions after release',
    livingSpecies(engine, CREATURE.SURVEYOR).every((c) =>
      safelyPlacedInWorld(engine, c),
    ),
  );

  rescueSurveyors(engine, playerId);
  snapshot = engine.getMission();
  check(
    'three rescue-beam tags activate extraction',
    snapshot.objectives[1].current === 3 &&
      snapshot.phase === MISSION_PHASE.EXTRACTION,
  );
  check(
    'Greenfall extraction immediately opens a visible reinforcement breach',
    engine.getCreatures().some(({ spawnProgress }) => spawnProgress > 0),
  );
  const warning = engine.getCreatures().find((c) => c.spawnProgress > 0);
  const waitingPlayer = engine.getPlayer(playerId);
  check(
    'reinforcement warning is separated from player and extraction pad',
    warning &&
      Math.hypot(
        warning.x + warning.w / 2 - waitingPlayer.x - waitingPlayer.w / 2,
        warning.y + warning.h / 2 - waitingPlayer.y - waitingPlayer.h / 2,
      ) >= 48 &&
      Math.hypot(
        warning.x +
          warning.w / 2 +
          engine.getWorldOffsetX() -
          snapshot.extractionX,
        warning.y +
          warning.h / 2 +
          engine.getWorldOffsetY() -
          snapshot.extractionY,
      ) >= 32,
  );
  for (let tick = 0; tick < 90; tick++) engine.stepActors();
  check(
    'the warning remains visible through its two-second windup',
    engine
      .getCreatures()
      .some((c) => c.id === warning.id && c.spawnProgress > 0 && !c.alive),
  );
  for (let tick = 0; tick < 30; tick++) {
    engine.setPlayerState(playerId, {
      x: warning.x,
      y: warning.y,
      vx: 0,
      vy: 0,
    });
    engine.stepActors();
  }
  check(
    'moving into a warning cancels materialization',
    !engine.getCreatures().some((c) => c.id === warning.id),
  );
  engine.setPlayerState(playerId, {
    x: waitingPlayer.x,
    y: waitingPlayer.y,
    vx: 0,
    vy: 0,
  });
  const greenfallBaseline = new Set(
    engine
      .getCreatures()
      .filter(({ spawnProgress }) => spawnProgress === 0)
      .map(({ id }) => id),
  );
  check(
    'Greenfall extraction sends repeated reinforcements',
    collectExtractionWaves(engine, greenfallBaseline, 2, 1400) >= 2,
  );
  moveToExtraction(engine, playerId, snapshot);
  check(
    'Greenfall completes at its surface beacon',
    engine.getMission().phase === MISSION_PHASE.COMPLETE,
  );
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  engine.startMission(MISSION.GREENFALL_RECOVERY, playerId);
  eliminate(engine, engine.getCreatures());
  const mission = engine.getMission();
  const centerX = mission.extractionX + 105 - engine.getWorldOffsetX();
  const surfaceY = mission.extractionY + 6 - engine.getWorldOffsetY();
  const route = [
    ['access entrance', -60, 9],
    ['upper gallery', 45, 42],
    ['descending turn', 100, 77],
    ['research refuge', -45, 127],
    ['return shaft', 67, 125],
    ['shaft climb', 67, 0],
    ['surface exit', -60, 5],
    ['landing beacon', -105, 0],
  ];
  let tick = 0;
  for (const [label, dx, dy] of route) {
    // Release between climbs, just as the player lands to recharge the pack.
    engine.setPlayerInput(playerId, {});
    for (let idle = 0; idle < 12; idle++) engine.step((++tick * 1000) / 60);
    let previousX = 0,
      blockedTicks = 0,
      reached = false;
    for (let step = 0; step < 600; step++) {
      const player = engine.getPlayer(playerId);
      const x = player.x + player.w / 2;
      const deltaX = centerX + dx - x;
      const deltaY = surfaceY + dy - player.y - player.h;
      if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 12) {
        reached = true;
        break;
      }
      blockedTicks = Math.abs(x - previousX) < 0.1 ? blockedTicks + 1 : 0;
      previousX = x;
      let bits =
        Math.abs(deltaX) > 2 ? (deltaX > 0 ? INPUT.RIGHT : INPUT.LEFT) : 0;
      if (deltaY < -8 || blockedTicks > 10) bits |= INPUT.JUMP | INPUT.JETPACK;
      engine.setPlayerInput(playerId, { bits });
      engine.step((++tick * 1000) / 60);
    }
    check(
      `Greenfall route reaches ${label} with movement and jetpack only`,
      reached,
    );
    if (!reached) break;
  }
  check(
    'the complete descent and return leave the player alive',
    engine.getPlayer(playerId).alive &&
      engine.getPlayer(playerId).health === 100,
  );
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  engine.startMission(MISSION.GREENFALL_RECOVERY, playerId);
  eliminate(engine, livingSpecies(engine, CREATURE.DYNAMITEER));
  eliminate(engine, livingSpecies(engine, CREATURE.MINIGUNNER));
  const bore = livingSpecies(engine, CREATURE.BORE_SENTINEL)[0];
  const mission = engine.getMission();
  const centerX = mission.extractionX + 105 - engine.getWorldOffsetX();
  const surfaceY = mission.extractionY + 6 - engine.getWorldOffsetY();
  engine.setPlayerState(playerId, {
    x: centerX + 95,
    y: surfaceY + 52,
    vx: 0,
    vy: 0,
  });
  let firedAcrossFloors = false;
  for (let tick = 0; tick < 300; tick++) {
    engine.stepActors();
    const guard = engine.getCreatures().find((c) => c.id === bore.id);
    if (guard.attackState !== 0) firedAcrossFloors = true;
  }
  check(
    'the refuge guard cannot charge or fire through the upper gallery',
    !firedAcrossFloors,
  );
  engine.setPlayerState(playerId, {
    x: bore.x + 35,
    y: bore.y - 2,
    vx: 0,
    vy: 0,
  });
  let engaged = false;
  for (let tick = 0; tick < 120; tick++) {
    engine.stepActors();
    if (engine.getCreatures().find((c) => c.id === bore.id).attackState !== 0)
      engaged = true;
  }
  check('the refuge guard engages when the player enters its gallery', engaged);
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  engine.startMission(MISSION.GREENFALL_RECOVERY, playerId);
  const guardId = livingSpecies(engine, CREATURE.MINIGUNNER)[0].id;
  let charging = 0, firing = 0, recovery = 0, fired = false;
  for (let tick = 0; tick < 600; tick++) {
    const guard = engine.getCreatures().find(c => c.id === guardId);
    engine.setPlayerState(playerId, { x: guard.x + 13, y: guard.y - 2, vx: 0, vy: 0 });
    engine.setPlayerInput(playerId, { bits: INPUT.SHIELD, aimX: guard.x, aimY: guard.y + 3 });
    engine.stepActors();
    const state = engine.getCreatures().find(c => c.id === guardId).attackState;
    if (state === 1) {
      if (fired) break;
      charging++;
    } else if (state === 2) { fired = true; firing++; }
    else if (fired) recovery++;
  }
  check('relay minigunner gives a full windup, short burst, and recovery window',
    charging === 60 && firing === 48 && recovery >= 120);
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.SILENT_QUARRY);
  const terrainBefore = [
    gridHash(engine.getGrid()),
    gridHash(engine.getGridBg()),
  ];
  check(
    'Silent Quarry starts on the Moon',
    engine.startMission(MISSION.SILENT_QUARRY, playerId),
  );
  check(
    'Silent Quarry places actors without carving or authoring terrain',
    gridHash(engine.getGrid()) === terrainBefore[0] &&
      gridHash(engine.getGridBg()) === terrainBefore[1],
  );
  check(
    'Moon actors begin in clear, supported, hazard-free world space',
    [
      ...livingSpecies(engine, CREATURE.IRIS_ENGINEER),
      ...livingSpecies(engine, CREATURE.SURVEYOR),
      ...livingSpecies(engine, CREATURE.SHIELD_ANCHOR),
    ].every((creature) => safelyPlacedInWorld(engine, creature)),
  );
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  let snapshot = engine.getMission();
  check(
    'two Moon anchors unlock the quarry foreman',
    snapshot.objectives[0].current === 2 &&
      livingSpecies(engine, CREATURE.QUARRY_FOREMAN).length === 1,
  );
  check(
    'the quarry foreman materializes in safe existing world space',
    livingSpecies(engine, CREATURE.QUARRY_FOREMAN).every((creature) =>
      safelyPlacedInWorld(engine, creature),
    ),
  );
  eliminate(engine, livingSpecies(engine, CREATURE.QUARRY_FOREMAN));
  snapshot = engine.getMission();
  check(
    'defeating the foreman starts the Moon extraction',
    snapshot.phase === MISSION_PHASE.EXTRACTION,
  );
  check(
    'Silent Quarry extraction immediately opens a visible reinforcement breach',
    engine.getCreatures().some(({ spawnProgress }) => spawnProgress > 0),
  );
  const quarryBaseline = new Set(
    engine
      .getCreatures()
      .filter(({ spawnProgress }) => spawnProgress === 0)
      .map(({ id }) => id),
  );
  check(
    'Silent Quarry extraction sends repeated reinforcements',
    collectExtractionWaves(engine, quarryBaseline, 2, 600) >= 2,
  );
  engine.addSpecialItem(playerId, ITEM_KIND.BORE_CANNON, 4);
  const boreSlot = engine
    .getInventory(playerId)
    .slots.findIndex(({ itemKind }) => itemKind === ITEM_KIND.BORE_CANNON);
  engine.inventoryCursorPick(playerId, boreSlot, false);
  check(
    'Moon beacon follows the surface at its own world column',
    snapshot.extractionY === engine.worldSurfaceAbsAt(snapshot.extractionX) - 5,
  );
  moveToExtraction(engine, playerId, snapshot);
  snapshot = engine.getMission();
  check(
    'Moon extraction records cursor-carried enemy weapons',
    snapshot.phase === MISSION_PHASE.COMPLETE &&
      (snapshot.recoveredWeaponMask &
        (1 << (ITEM_KIND.BORE_CANNON - ITEM_KIND.DYNAMITE_SATCHEL))) !==
        0,
  );
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.RED_FURNACE);
  const terrainBefore = [
    gridHash(engine.getGrid()),
    gridHash(engine.getGridBg()),
  ];
  check(
    'Red Furnace starts on Mars',
    engine.startMission(MISSION.RED_FURNACE, playerId),
  );
  check(
    'Red Furnace places actors without carving or authoring terrain',
    gridHash(engine.getGrid()) === terrainBefore[0] &&
      gridHash(engine.getGridBg()) === terrainBefore[1],
  );
  check(
    'Mars actors begin in clear, supported, hazard-free world space',
    [
      ...livingSpecies(engine, CREATURE.IRIS_ENGINEER),
      ...livingSpecies(engine, CREATURE.SURVEYOR),
      ...livingSpecies(engine, CREATURE.SHIELD_ANCHOR),
    ].every((creature) => safelyPlacedInWorld(engine, creature)),
  );
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  let snapshot = engine.getMission();
  check(
    'three Mars anchors unlock the reactor warden',
    snapshot.objectives[0].current === 3 &&
      livingSpecies(engine, CREATURE.REACTOR_WARDEN).length === 1,
  );
  check(
    'the reactor warden materializes in safe existing world space',
    livingSpecies(engine, CREATURE.REACTOR_WARDEN).every((creature) =>
      safelyPlacedInWorld(engine, creature),
    ),
  );
  eliminate(engine, livingSpecies(engine, CREATURE.REACTOR_WARDEN));
  snapshot = engine.getMission();
  check(
    'defeating the warden exposes the reactor core',
    snapshot.objectives[2].state === OBJECTIVE_STATE.ACTIVE &&
      livingSpecies(engine, CREATURE.REACTOR_CORE).length === 1,
  );
  check(
    'the reactor core materializes in safe existing world space',
    livingSpecies(engine, CREATURE.REACTOR_CORE).every((creature) =>
      safelyPlacedInWorld(engine, creature),
    ),
  );
  eliminate(engine, livingSpecies(engine, CREATURE.REACTOR_CORE));
  snapshot = engine.getMission();
  check(
    'breaching the core triggers the severe threat spike',
    snapshot.phase === MISSION_PHASE.EXTRACTION && snapshot.threatLevel === 3,
  );
  check(
    'Red Furnace extraction immediately opens a visible reinforcement breach',
    engine.getCreatures().some(({ spawnProgress }) => spawnProgress > 0),
  );
  const furnaceBaseline = new Set(
    engine
      .getCreatures()
      .filter(({ spawnProgress }) => spawnProgress === 0)
      .map(({ id }) => id),
  );
  check(
    'Red Furnace extraction sends repeated reinforcements',
    collectExtractionWaves(engine, furnaceBaseline, 2, 600) >= 2,
  );
  moveToExtraction(engine, playerId, snapshot);
  check(
    'Red Furnace completes after the altered return route',
    engine.getMission().phase === MISSION_PHASE.COMPLETE,
  );
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.SILENT_QUARRY);
  check(
    'mission/planet mismatches fail closed',
    !engine.startMission(MISSION.RED_FURNACE, playerId),
  );
  engine.destroy();
}

{
  const { engine, playerId } = makeMissionEngine(MISSION.GREENFALL_RECOVERY);
  engine.startMission(MISSION.GREENFALL_RECOVERY, playerId);
  eliminate(engine, [
    ...livingSpecies(engine, CREATURE.DYNAMITEER),
    ...livingSpecies(engine, CREATURE.MINIGUNNER),
    ...livingSpecies(engine, CREATURE.BORE_SENTINEL),
  ]);
  eliminate(engine, livingSpecies(engine, CREATURE.SHIELD_ANCHOR));
  for (let tick = 0; tick < 46; tick++) engine.stepActors();
  eliminate(engine, [livingSpecies(engine, CREATURE.SURVEYOR)[0]]);
  check(
    'planetside Greenfall hostages remain vulnerable mission actors',
    engine.getMission().phase === MISSION_PHASE.FAILED,
  );
  engine.destroy();
}

const failures = done();
console.log(
  failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
