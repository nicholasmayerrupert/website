/* eslint-env node */
// Survival populations use broad physical-realm pools. Biomes and generated
// structures adjust affinity, while every final candidate still has to satisfy
// its semantic context and live material habitat.

import {
  initSandWasm, createEngineWasm, PLANET, BIOME, CAVE_BIOME,
  WORLD_AREA, WORLD_FEATURE,
} from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('survival semantic spawning');
const SEED = 0xC0FFEE;
const SURFACE_ROSTER = [
  CREATURE.DYNAMITEER,
  CREATURE.CAUSTIC_MORTARMAN,
  CREATURE.CLUSTER_WASP,
];
const CAVE_ROSTER = [
  CREATURE.BORE_SENTINEL,
  CREATURE.MINIGUNNER,
];
const COMBAT_ROSTER = [...SURFACE_ROSTER, ...CAVE_ROSTER];
const LABEL = new Map([
  [CREATURE.DYNAMITEER, 'dynamiteer'],
  [CREATURE.BORE_SENTINEL, 'bore sentinel'],
  [CREATURE.CAUSTIC_MORTARMAN, 'caustic mortarman'],
  [CREATURE.CLUSTER_WASP, 'cluster wasp'],
  [CREATURE.MINIGUNNER, 'minigunner'],
]);
const make = (options = {}) => attachTestHooks(createEngineWasm({
  cols: 320,
  rows: 240,
  worldSeed: SEED,
  sinksOn: false,
  infinite: true,
  ...options,
}));
const has = (context, tag) => (context.tags & tag) !== 0;
const poolAt = (engine, x, y) =>
  COMBAT_ROSTER.filter((species) =>
    engine._spawnWorldWeight(species, x, y) > 0);
const poolNames = (pool) =>
  pool.map((species) => LABEL.get(species)).join(', ');
const samePool = (actual, expected) =>
  actual.length === expected.length
    && actual.every((species, index) => species === expected[index]);

function findContext(engine, predicate, {
  minX = -24000,
  maxX = 24000,
  xStep = 8,
  minDepth = -80,
  maxDepth = 1200,
  depthStep = 8,
} = {}) {
  for (let x = minX; x <= maxX; x += xStep) {
    const surface = engine.worldSurfaceAbsAt(x);
    for (let depth = minDepth; depth <= maxDepth; depth += depthStep) {
      const y = surface + depth;
      const context = engine.worldContextAt(x, y);
      if (predicate(context, x, y)) return { context, x, y };
    }
  }
  return null;
}

function moveWindowTo(engine, worldX, worldY, localX, localY) {
  while (engine.getWorldOffsetX() + localX !== worldX) {
    const remaining = worldX - (engine.getWorldOffsetX() + localX);
    engine.shiftWorldXY(
      Math.sign(remaining) * Math.min(128, Math.abs(remaining)), 0);
  }
  while (engine.getWorldOffsetY() + localY !== worldY) {
    const remaining = worldY - (engine.getWorldOffsetY() + localY);
    engine.shiftWorldXY(
      0, Math.sign(remaining) * Math.min(128, Math.abs(remaining)));
  }
}

function spawnInsideFeature(engine, species, point, predicate) {
  const localCenterX = Math.floor(engine.cols / 2);
  const localCenterY = Math.floor(engine.rows / 2);
  moveWindowTo(engine, point.x, point.y, localCenterX, localCenterY);
  const offsetX = engine.getWorldOffsetX();
  const offsetY = engine.getWorldOffsetY();
  const bounds = point.context.bounds;
  const x0 = Math.max(2, bounds.left - offsetX - 10);
  const x1 = Math.min(engine.cols - 12, bounds.right - offsetX + 10);
  const y0 = Math.max(2, bounds.top - offsetY - 10);
  const y1 = Math.min(engine.rows - 9, bounds.bottom - offsetY + 10);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const worldX = offsetX + x;
      const worldY = offsetY + y;
      const context = engine.worldContextAt(worldX + 4, worldY + 3);
      if (!predicate(context)) continue;
      const id = engine._spawnNaturalAt(species, worldX, worldY);
      if (id) return { id, context, worldX, worldY };
    }
  }
  return null;
}

const earth = make();
const surfacePoints = new Map();
for (let radius = 0; radius <= 24000
    && surfacePoints.size < Object.keys(BIOME).length; radius += 8) {
  for (const x of radius === 0 ? [0] : [radius, -radius]) {
    const y = earth.worldSurfaceAbsAt(x);
    const context = earth.worldContextAt(x, y);
    if (context.featureKind !== WORLD_FEATURE.NONE
        || !has(context, WORLD_AREA.SURFACE)
        || surfacePoints.has(context.surfaceBiome)) continue;
    surfacePoints.set(context.surfaceBiome, { context, x, y });
  }
}
for (const biome of Object.values(BIOME)) {
  const point = surfacePoints.get(biome);
  const actual = point ? poolAt(earth, point.x, point.y) : [];
  check(`surface biome ${biome} admits the general surface roster (${poolNames(actual) || 'none'})`,
    !!point && samePool(actual, SURFACE_ROSTER));
}

const cavePoints = new Map();
for (let x = -12000; x <= 12000
    && cavePoints.size < Object.keys(CAVE_BIOME).length; x += 8) {
  const surface = earth.worldSurfaceAbsAt(x);
  for (let depth = 16; depth <= 1200
      && cavePoints.size < Object.keys(CAVE_BIOME).length; depth += 16) {
    const y = surface + depth;
    const context = earth.worldContextAt(x, y);
    if (context.featureKind !== WORLD_FEATURE.NONE
        || !has(context, WORLD_AREA.UNDERGROUND)
        || cavePoints.has(context.caveBiome)) continue;
    cavePoints.set(context.caveBiome, { context, x, y });
  }
}
for (const biome of Object.values(CAVE_BIOME)) {
  const point = cavePoints.get(biome);
  const actual = point ? poolAt(earth, point.x, point.y) : [];
  check(`cave biome ${biome} admits the general cave roster (${poolNames(actual) || 'none'})`,
    !!point && samePool(actual, CAVE_ROSTER));
}

const weightAt = (species, point) =>
  point ? earth._spawnWorldWeight(species, point.x, point.y) : 0;
check('dynamiteers prefer open plains over forest',
  weightAt(CREATURE.DYNAMITEER, surfacePoints.get(BIOME.PLAINS))
    > weightAt(CREATURE.DYNAMITEER, surfacePoints.get(BIOME.FOREST)));
check('mortarmen prefer desert over plains',
  weightAt(CREATURE.CAUSTIC_MORTARMAN, surfacePoints.get(BIOME.DESERT))
    > weightAt(CREATURE.CAUSTIC_MORTARMAN, surfacePoints.get(BIOME.PLAINS)));
check('wasps prefer forest over desert',
  weightAt(CREATURE.CLUSTER_WASP, surfacePoints.get(BIOME.FOREST))
    > weightAt(CREATURE.CLUSTER_WASP, surfacePoints.get(BIOME.DESERT)));
check('bore sentinels prefer geode caves over default caves',
  weightAt(CREATURE.BORE_SENTINEL,
    cavePoints.get(CAVE_BIOME.DEEP_GEODE))
    > weightAt(CREATURE.BORE_SENTINEL,
      cavePoints.get(CAVE_BIOME.DEFAULT)));
check('minigunners prefer crystal caves over default caves',
  weightAt(CREATURE.MINIGUNNER, cavePoints.get(CAVE_BIOME.CRYSTAL))
    > weightAt(CREATURE.MINIGUNNER, cavePoints.get(CAVE_BIOME.DEFAULT)));

const interior = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.VILLAGE_BUILDING
    && has(context, WORLD_AREA.INDOOR),
  { minDepth: -80, maxDepth: 8, depthStep: 2 });
check('village interiors exclude combat encounters but admit residents',
  interior
    && poolAt(earth, interior.x, interior.y).length === 0
    && earth._spawnWorldAllowed(
      CREATURE.VILLAGER, interior.x, interior.y));

const settlement = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.VILLAGE
    && has(context, WORLD_AREA.SETTLEMENT)
    && !has(context, WORLD_AREA.INDOOR),
  { minX: -60000, maxX: 60000, xStep: 4, minDepth: -4, maxDepth: 0 });
const ordinarySettlementBiome = settlement
  ? surfacePoints.get(settlement.context.surfaceBiome) : null;
check('settlements raise dynamiteer affinity without narrowing the surface pool',
  settlement && ordinarySettlementBiome
    && samePool(poolAt(earth, settlement.x, settlement.y), SURFACE_ROSTER)
    && earth._spawnWorldWeight(
      CREATURE.DYNAMITEER, settlement.x, settlement.y)
      > weightAt(CREATURE.DYNAMITEER, ordinarySettlementBiome));

const mine = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.MINE
    && has(context, WORLD_AREA.MINE)
    && has(context, WORLD_AREA.UNDERGROUND)
    && !has(context, WORLD_AREA.SETTLEMENT),
  {
    minX: -6000,
    maxX: 6000,
    xStep: 8,
    minDepth: 32,
    maxDepth: 700,
    depthStep: 8,
  });
const minePool = mine ? poolAt(earth, mine.x, mine.y) : [];
check(`mine galleries retain both cave enemies (${poolNames(minePool) || 'none'})`,
  mine && samePool(minePool, CAVE_ROSTER)
    && earth._spawnWorldWeight(
      CREATURE.BORE_SENTINEL, mine.x, mine.y) >= 30
    && earth._spawnWorldWeight(
      CREATURE.MINIGUNNER, mine.x, mine.y) >= 30);
const mineSpawn = mine && spawnInsideFeature(
  earth,
  CREATURE.MINIGUNNER,
  mine,
  (context) => context.featureKind === WORLD_FEATURE.MINE
    && has(context, WORLD_AREA.MINE)
    && has(context, WORLD_AREA.UNDERGROUND)
    && !has(context, WORLD_AREA.SETTLEMENT),
);
check('a material-valid minigunner can spawn in a mine gallery', !!mineSpawn);
earth.destroy();

const residents = make({ cols: 768, rows: 360 });
if (interior) moveWindowTo(residents, interior.x, interior.y, 384, 180);
residents.setSurvivalInventory(true);
residents.setCreatureRuntime(true, true);
residents.stepActors();
const villagers = residents.getCreatures()
  .filter((creature) => creature.species === CREATURE.VILLAGER
    && creature.alive);
let indoorResidents = 0;
let outdoorResidents = 0;
let residentShapesValid = true;
for (const villager of villagers) {
  residentShapesValid &&= villager.w === 4 && villager.h === 8;
  const context = residents.worldContextAt(
    residents.getWorldOffsetX() + Math.floor(villager.x + villager.w / 2),
    residents.getWorldOffsetY() + Math.floor(villager.y + villager.h / 2));
  if (has(context, WORLD_AREA.INDOOR)) indoorResidents++;
  else if (has(context, WORLD_AREA.SETTLEMENT)) outdoorResidents++;
}
check(`villages populate building interiors (${indoorResidents}) and outdoor commons (${outdoorResidents})`,
  villagers.length >= 2 && indoorResidents > 0 && outdoorResidents > 0);
check('human residents use a tall, narrow 4x8 actor shape',
  villagers.length > 0 && residentShapesValid);
const residentIds = villagers.map((villager) => villager.id).sort((a, b) => a - b);
for (let tick = 0; tick < 240; tick++) residents.stepActors();
const residentIdsLater = residents.getCreatures()
  .filter((creature) => creature.species === CREATURE.VILLAGER
    && creature.alive)
  .map((villager) => villager.id)
  .sort((a, b) => a - b);
check('revisiting the population cadence does not duplicate resident sites',
  residentIdsLater.join(',') === residentIds.join(','));
residents.destroy();

const moon = make({ planetId: PLANET.MOON });
const facility = findContext(moon,
  (context) => context.featureKind === WORLD_FEATURE.OFFWORLD_FACILITY
    && has(context, WORLD_AREA.FACILITY)
    && has(context, WORLD_AREA.UNDERGROUND),
  {
    minX: -6000,
    maxX: 6000,
    xStep: 8,
    minDepth: 16,
    maxDepth: 240,
    depthStep: 4,
  });
const facilityPool = facility ? poolAt(moon, facility.x, facility.y) : [];
check(`off-world facilities keep the general cave roster (${poolNames(facilityPool) || 'none'})`,
  facility && samePool(facilityPool, CAVE_ROSTER)
    && moon._spawnWorldWeight(
      CREATURE.MINIGUNNER, facility.x, facility.y)
      > moon._spawnWorldWeight(
        CREATURE.BORE_SENTINEL, facility.x, facility.y));
const facilitySpawn = facility && spawnInsideFeature(
  moon,
  CREATURE.MINIGUNNER,
  facility,
  (context) => context.featureKind === WORLD_FEATURE.OFFWORLD_FACILITY
    && has(context, WORLD_AREA.FACILITY)
    && has(context, WORLD_AREA.UNDERGROUND),
);
check('a material-valid minigunner can spawn inside a facility',
  !!facilitySpawn);
moon.destroy();

// The live director may choose any member of the broad realm pool. Its observed
// candidates must still pass their final semantic validation after habitat
// snapping.
for (const biome of [BIOME.PLAINS]) {
  const point = surfacePoints.get(biome);
  if (!point) {
    check(`the live director has a biome-${biome} fixture`, false);
    continue;
  }
  const engine = make({ cols: 448, rows: 320 });
  moveWindowTo(engine, point.x, engine.getWorldOffsetY() + 160, 224, 160);
  engine.setViewport(1, 1, 120, 80);
  const playerId = engine.spawnPlayerAtSurface(224);
  const player = engine.getPlayer(playerId);
  engine.cameraSet(
    player.x + player.w * 0.5 - 60,
    player.y + player.h * 0.5 - 54,
  );
  engine.setSurvivalInventory(true);
  engine.setCreatureRuntime(true, true);
  const seen = new Set();
  const seenCombat = [];
  let candidatesValid = true;
  for (let tick = 0; tick < 1200; tick++) {
    engine.stepActors();
    for (const creature of engine.getCreatures()) {
      if (seen.has(creature.id)) continue;
      seen.add(creature.id);
      if (COMBAT_ROSTER.includes(creature.species))
        seenCombat.push(creature.species);
      candidatesValid &&= engine._spawnWorldAllowed(
        creature.species,
        engine.getWorldOffsetX() + creature.x + creature.w * 0.5,
        engine.getWorldOffsetY() + creature.y + creature.h * 0.5,
      );
    }
  }
  check(`the live director uses the general biome-${biome} surface pool`,
    seenCombat.length > 0
      && seenCombat.every((species) =>
        SURFACE_ROSTER.includes(species)));
  check(`every biome-${biome} candidate passes semantic validation`,
    seen.size > 0 && candidatesValid);
  engine.destroy();
}

const failures = done();
console.log(failures === 0
  ? '\nall checks passed'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
