/* eslint-env node */
// Semantic world records are deterministic absolute-coordinate plans shared by
// generation and natural spawning. They must not depend on viewport or streaming.

import {
  initSandWasm, createEngineWasm, PLANET, BIOME, WORLD_AREA, WORLD_FEATURE,
  WORLD_SITE_ROLE, MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('semantic world context');
const SEED = 0xC0FFEE;
const make = (options = {}) => attachTestHooks(createEngineWasm({
  cols: 320,
  rows: 240,
  worldSeed: SEED,
  sinksOn: false,
  infinite: true,
  ...options,
}));
const has = (context, tag) => (context.tags & tag) !== 0;

function findContext(engine, predicate, {
  minX = -6000,
  maxX = 6000,
  xStep = 4,
  minDepth = -80,
  maxDepth = 420,
  yStep = 4,
} = {}) {
  for (let x = minX; x <= maxX; x += xStep) {
    const surface = engine.worldSurfaceAbsAt(x);
    for (let depth = minDepth; depth <= maxDepth; depth += yStep) {
      const y = surface + depth;
      const context = engine.worldContextAt(x, y);
      if (predicate(context, x, y)) return { context, x, y };
    }
  }
  return null;
}

const earth = make();
const building = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.VILLAGE_BUILDING
    && has(context, WORLD_AREA.INDOOR),
  { maxDepth: 0, yStep: 2 });
check('a nested village building record is discoverable', !!building);
check('building records retain their settlement parent and semantic role',
  building?.context.parentFeatureId > 0
    && building.context.featureId > 0
    && building.context.siteRole >= WORLD_SITE_ROLE.HOME
    && building.context.siteRole <= WORLD_SITE_ROLE.MEETING_HALL
    && has(building.context, WORLD_AREA.STRUCTURE)
    && has(building.context, WORLD_AREA.SETTLEMENT)
    && has(building.context, WORLD_AREA.BUILDING)
    && has(building.context, WORLD_AREA.INDOOR));
check('feature bounds contain the queried coordinate',
  building
    && building.x >= building.context.bounds.left
    && building.x <= building.context.bounds.right
    && building.y >= building.context.bounds.top
    && building.y <= building.context.bounds.bottom);
const steepVillageEdge = earth.worldContextAt(-12000, -100);
check('parent feature membership uses its returned inclusive bounds',
  steepVillageEdge.featureKind === WORLD_FEATURE.NONE
    || (-12000 >= steepVillageEdge.bounds.left
      && -12000 <= steepVillageEdge.bounds.right
      && -100 >= steepVillageEdge.bounds.top
      && -100 <= steepVillageEdge.bounds.bottom));

const villageCommons = building && findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.VILLAGE
    && context.featureId === building.context.parentFeatureId
    && !has(context, WORLD_AREA.INDOOR),
  {
    minX: building.context.bounds.left - 240,
    maxX: building.context.bounds.right + 240,
    minDepth: -24,
    maxDepth: 8,
    yStep: 2,
  });
check('settlements expose commons outside their child buildings',
  villageCommons
    && has(villageCommons.context, WORLD_AREA.SETTLEMENT)
    && !has(villageCommons.context, WORLD_AREA.BUILDING));

const mine = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.MINE
    && context.siteRole === WORLD_SITE_ROLE.MINE_GALLERY
    && !has(context, WORLD_AREA.SETTLEMENT),
  { minDepth: 40, maxDepth: 420, xStep: 8, yStep: 8 });
check('mines expose stable underground regions independently of cave materials',
  mine
    && has(mine.context, WORLD_AREA.MINE)
    && has(mine.context, WORLD_AREA.UNDERGROUND)
    && mine.context.featureId > 0);
const mineSky = mine && earth.worldContextAt(
  mine.x, earth.worldSurfaceAbsAt(mine.x) - 24);
check('mine galleries do not claim untouched sky above their structure',
  mineSky
    && !(mineSky.featureKind === WORLD_FEATURE.MINE
      && mineSky.siteRole === WORLD_SITE_ROLE.MINE_GALLERY));

const ruin = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.RUIN,
  { minDepth: 24, maxDepth: 760, xStep: 12, yStep: 6 });
check('cave ruins are planned and exposed by the shared feature catalogue',
  ruin
    && ruin.context.siteRole === WORLD_SITE_ROLE.RUIN
    && has(ruin.context, WORLD_AREA.STRUCTURE)
    && has(ruin.context, WORLD_AREA.INDOOR)
    && ruin.context.featureId > 0);

const deepStructure = findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.DEEP_STRUCTURE,
  { minDepth: 560, maxDepth: 1500, xStep: 18, yStep: 10 });
check('deep monuments are planned and exposed by the shared feature catalogue',
  deepStructure
    && deepStructure.context.siteRole === WORLD_SITE_ROLE.DEEP_STRUCTURE
    && has(deepStructure.context, WORLD_AREA.DEEP)
    && has(deepStructure.context, WORLD_AREA.STRUCTURE)
    && deepStructure.context.featureId > 0);

const ordinarySurface = villageCommons && findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.NONE
    && context.surfaceBiome === villageCommons.context.surfaceBiome
    && has(context, WORLD_AREA.SURFACE),
  {
    minX: villageCommons.x - 1000,
    maxX: villageCommons.x + 1000,
    minDepth: -2,
    maxDepth: 2,
    yStep: 2,
  });
check('ordinary terrain remains unclaimed by a generated feature',
  ordinarySurface?.context.featureKind === WORLD_FEATURE.NONE);
check('surface enemies cannot naturally materialize inside a designated building',
  building
    && !earth._spawnWorldAllowed(
      CREATURE.DYNAMITEER, building.x, building.y));
check('settlements raise the dynamiteer spawn-pool affinity',
  villageCommons && ordinarySurface
    && earth._spawnWorldWeight(
      CREATURE.DYNAMITEER, villageCommons.x, villageCommons.y)
      > earth._spawnWorldWeight(
        CREATURE.DYNAMITEER, ordinarySurface.x, ordinarySurface.y));

const plains = findContext(earth,
  (context) => context.surfaceBiome === BIOME.PLAINS
    && context.featureKind === WORLD_FEATURE.NONE,
  { minX: -12000, maxX: 12000, minDepth: 0, maxDepth: 0, xStep: 16 });
const swamp = findContext(earth,
  (context) => context.surfaceBiome === BIOME.SWAMP
    && context.featureKind === WORLD_FEATURE.NONE,
  { minX: -12000, maxX: 12000, minDepth: 0, maxDepth: 0, xStep: 16 });
check('surface biome changes caustic-mortarman spawn-pool affinity',
  plains && swamp
    && earth._spawnWorldWeight(CREATURE.CAUSTIC_MORTARMAN, swamp.x, swamp.y)
      > earth._spawnWorldWeight(
        CREATURE.CAUSTIC_MORTARMAN, plains.x, plains.y));

const ordinaryCave = mine && findContext(earth,
  (context) => context.featureKind === WORLD_FEATURE.NONE
    && context.caveBiome === mine.context.caveBiome
    && has(context, WORLD_AREA.UNDERGROUND)
    === has(mine.context, WORLD_AREA.UNDERGROUND)
    && has(context, WORLD_AREA.DEEP) === has(mine.context, WORLD_AREA.DEEP),
  {
    minX: mine.x - 1600,
    maxX: mine.x + 1600,
    minDepth: mine.context.depth,
    maxDepth: mine.context.depth,
    yStep: 1,
  });
check('mine regions raise the minigunner spawn-pool affinity',
  mine && ordinaryCave
    && earth._spawnWorldWeight(CREATURE.MINIGUNNER, mine.x, mine.y)
      > earth._spawnWorldWeight(
        CREATURE.MINIGUNNER, ordinaryCave.x, ordinaryCave.y));

const point = building && [building.x, building.y];
const beforeShift = point && earth.worldContextAt(...point);
for (let i = 0; i < 12; i++) earth.shiftWorldXY(128, 0);
const afterShift = point && earth.worldContextAt(...point);
check('streaming does not change semantic feature identity',
  beforeShift && afterShift
    && beforeShift.featureId === afterShift.featureId
    && beforeShift.parentFeatureId === afterShift.parentFeatureId
    && beforeShift.tags === afterShift.tags);

const wide = make({ cols: 768, rows: 384 });
const wideContext = point && wide.worldContextAt(...point);
check('viewport size does not change semantic world records',
  beforeShift && wideContext
    && beforeShift.featureId === wideContext.featureId
    && beforeShift.siteRole === wideContext.siteRole
    && beforeShift.surfaceBiome === wideContext.surfaceBiome);
wide.destroy();
earth.destroy();

const overlapRegression = make({ worldSeed: 7, cols: 768 });
const overlapX = -376;
const overlapSurface = overlapRegression.worldSurfaceAbsAt(overlapX);
const overlapY = 12;
const overlapContext = overlapRegression.worldContextAt(overlapX, overlapY);
const overlapGridX = overlapX - overlapRegression.getWorldOffsetX();
const overlapGridY = overlapY - overlapRegression.getWorldOffsetY();
const overlapMaterial = overlapRegression.getGrid()[
  overlapGridY * overlapRegression.cols + overlapGridX];
check('unclaimed rock has no stale settlement ownership',
  [MAT.STONE, MAT.SHALE, MAT.SLATE, MAT.ROOTSTONE, MAT.VEIN_ROCK, MAT.PALESTONE, MAT.SANDSTONE, MAT.BONE].includes(overlapMaterial)
    && overlapContext.featureKind === WORLD_FEATURE.NONE
    && !has(overlapContext, WORLD_AREA.SETTLEMENT)
    && !has(overlapContext, WORLD_AREA.MINE));
const overlapSky = overlapRegression.worldContextAt(
  overlapX, overlapSurface - 40);
check('a mine planning box cannot claim untouched sky above an overlapping settlement',
  !(overlapSky.featureKind === WORLD_FEATURE.MINE
    && overlapSky.siteRole === WORLD_SITE_ROLE.MINE_GALLERY)
    && !(has(overlapSky, WORLD_AREA.MINE)
      && has(overlapSky, WORLD_AREA.SETTLEMENT)));
overlapRegression.destroy();

// Discover reservations independently through public semantic queries. Exercise
// both sides of the origin and different biome/structure combinations.
for (const seed of [0xBED, 0xBEEF, 7]) {
  const e = make({ worldSeed: seed });
  const villages = new Map(), headhouses = new Map(), formations = new Map();
  for (let x = -24000; x <= 24000; x += 12) {
    const surface = e.worldSurfaceAbsAt(x);
    for (let depth = -72; depth <= 48; depth += 12) {
      const context = e.worldContextAt(x, surface + depth);
      if (context.featureKind === WORLD_FEATURE.VILLAGE)
        villages.set(context.featureId, context.bounds);
      if (context.siteRole === WORLD_SITE_ROLE.MINE_HEADHOUSE)
        headhouses.set(context.featureId, context.bounds);
      if (context.featureKind === WORLD_FEATURE.OUTCROP)
        formations.set(context.featureId, context.bounds);
    }
  }
  const streets = [...villages.values()].sort((a, b) => a.left - b.left);
  check(`seed ${seed}: settlement streets stay within a single biome`,
    streets.every((street) => {
      const biome = e.worldBiomeAt(street.left);
      for (let x = street.left; x <= street.right; x++)
        if (e.worldBiomeAt(x) !== biome) return false;
      return true;
    }));
  check(`seed ${seed}: natural formations are discoverable and respect settlement reservations`,
    formations.size > 0 && [...formations.values()].every((rock) => streets.every((street) =>
      rock.right < street.left || rock.left > street.right
      || rock.bottom < street.top || rock.top > street.bottom)));
  check(`seed ${seed}: settlements and standalone mine buildings remain discoverable`,
    streets.length >= 5 && headhouses.size >= 2);
  check(`seed ${seed}: neighboring settlements reserve separate streets`,
    streets.every((street, i) => i === 0 || street.left > streets[i - 1].right + 12));
  check(`seed ${seed}: mine roofs and entrances do not intersect settlements`,
    [...headhouses.values()].every((house) => streets.every((street) =>
      house.right + 2 < street.left || house.left - 2 > street.right
      || house.bottom < street.top || house.top > street.bottom)));
  e.destroy();
}

const moon = make({ planetId: PLANET.MOON });
const outcrop = findContext(moon,
  (context) => context.featureKind === WORLD_FEATURE.OUTCROP,
  {
    minX: -3000,
    maxX: 3000,
    minDepth: -32,
    maxDepth: 2,
    xStep: 2,
    yStep: 1,
  });
check('off-world natural formations participate in the feature catalogue',
  outcrop
    && outcrop.context.siteRole === WORLD_SITE_ROLE.OUTCROP
    && has(outcrop.context, WORLD_AREA.STRUCTURE)
    && outcrop.context.featureId > 0);
const facility = findContext(moon,
  (context) => context.featureKind === WORLD_FEATURE.OFFWORLD_FACILITY
    && has(context, WORLD_AREA.FACILITY),
  {
    minX: -3000,
    maxX: 3000,
    minDepth: -80,
    maxDepth: 220,
    xStep: 8,
    yStep: 4,
  });
check('off-world complexes participate in the same feature catalogue',
  facility
    && facility.context.siteRole === WORLD_SITE_ROLE.FACILITY
    && facility.context.featureId > 0);
moon.destroy();

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
