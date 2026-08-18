// Biomes vary surface and soil materials without affecting terrain height, and
// the generated loose mantle must settle without churn.

import {
  initSandWasm, createEngineWasm, BIOME, CAVE_BIOME,
  PLANET, PLANET_COUNT,
  SURFACE_BIOME_COUNT, SURFACE_BIOME_ALL_MASK,
  CAVE_BIOME_COUNT, CAVE_BIOME_ALL_MASK,
  BIOME_FAMILY,
  SURFACE_BIOME_DEFS, CAVE_BIOME_DEFS,
  SURFACE_BIOME_SELECTION_ORDER,
  SHALLOW_CAVE_BIOME_SELECTION_ORDER,
  DEEP_CAVE_BIOME_SELECTION_ORDER,
} from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { MAT_FLAGS, MF } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 220, ROWS = 140, SEED = 0xBED;
await initSandWasm();
const { check, done } = makeChecker('worldgen biomes');
check('surface biome ABI metadata is dense and exhaustive',
  Object.keys(BIOME).length === SURFACE_BIOME_COUNT
    && SURFACE_BIOME_ALL_MASK === (2 ** SURFACE_BIOME_COUNT) - 1);
check('cave biome ABI metadata is dense and exhaustive',
  Object.keys(CAVE_BIOME).length === CAVE_BIOME_COUNT
    && CAVE_BIOME_ALL_MASK === (2 ** CAVE_BIOME_COUNT) - 1);
const surfaceIds = SURFACE_BIOME_DEFS.map((def) => def.id);
const caveIds = CAVE_BIOME_DEFS.map((def) => def.id);
check('surface biome behavior and selection metadata cover every stable ID',
  surfaceIds.length === SURFACE_BIOME_COUNT
    && surfaceIds.every((id, index) => id === index)
    && new Set(SURFACE_BIOME_SELECTION_ORDER).size
      === SURFACE_BIOME_SELECTION_ORDER.length
    && SURFACE_BIOME_SELECTION_ORDER.every((id) => surfaceIds.includes(id))
    && SURFACE_BIOME_DEFS.every((def) =>
      def.climate.length > 0 || Object.keys(def.profileSelection).length > 0)
    && SURFACE_BIOME_DEFS.every((def) => /^#[0-9a-f]{6}$/i.test(def.atlasColor)));
const caveSelection = [
  ...SHALLOW_CAVE_BIOME_SELECTION_ORDER,
  ...DEEP_CAVE_BIOME_SELECTION_ORDER,
];
check('cave biome behavior and selection metadata cover every stable ID',
  caveIds.length === CAVE_BIOME_COUNT
    && caveIds.every((id, index) => id === index)
    && new Set(caveSelection).size === caveSelection.length
    && caveSelection.every((id) => caveIds.includes(id))
    && CAVE_BIOME_DEFS.every((def) =>
      Object.values(def.profileSelection).some((entries) => entries.length > 0))
    && CAVE_BIOME_DEFS.every((def) => /^#[0-9a-f]{6}$/i.test(def.atlasColor)));

const reachedSurface = new Set();
const reachedCaves = new Set();
const caveReachByPlanet = new Map();
for (const planetId of Object.values(PLANET)) {
  const planetCaves = new Set();
  caveReachByPlanet.set(planetId, planetCaves);
  for (const reachSeed of [0xBED, 0xBEEF, 7]) {
    const reach = createEngineWasm({
      cols: 96, rows: 96, worldSeed: reachSeed, planetId,
      sinksOn: false, infinite: true,
    });
    for (let x = -30_000; x <= 30_000; x += 24) {
      const surface = reach.worldBiomeSample(x, reach.worldSurfaceAbsAt(x));
      if (surface.owner.family === BIOME_FAMILY.SURFACE)
        reachedSurface.add(surface.owner.biome);
      for (const y of [180, 420, 760, 960, 1400]) {
        const cave = reach.worldBiomeSample(x, y);
        if (cave.owner.family !== BIOME_FAMILY.CAVE) continue;
        reachedCaves.add(cave.owner.biome);
        planetCaves.add(cave.owner.biome);
      }
    }
    reach.destroy();
  }
}
check('runtime reachability scans every declared planet profile',
  caveReachByPlanet.size === PLANET_COUNT
    && [...caveReachByPlanet.values()].every((ids) => ids.size > 0));
check('every authored surface biome is reachable through descriptor selection',
  SURFACE_BIOME_DEFS.every((def) => reachedSurface.has(def.id)));
check('every authored cave biome is reachable through descriptor selection',
  CAVE_BIOME_DEFS.every((def) => reachedCaves.has(def.id)));
const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

let invalidSamples = 0;
let verticalSurfaceChanges = 0;
let verticalCaveChanges = 0;
let blendedSamples = 0;
for (let x = -4096; x <= 4096; x += 256) {
  const surface = e.worldSurfaceAbsAt(x);
  let previousSurface = null;
  let previousCave = null;
  for (let y = surface - 2048; y <= surface + 1600; y += 96) {
    const sample = e.worldBiomeSample(x, y);
    const ownerCount = sample.owner.family === BIOME_FAMILY.SURFACE
      ? SURFACE_BIOME_COUNT : CAVE_BIOME_COUNT;
    const neighborCount = sample.neighbor.family === BIOME_FAMILY.SURFACE
      ? SURFACE_BIOME_COUNT : CAVE_BIOME_COUNT;
    invalidSamples += ![BIOME_FAMILY.SURFACE, BIOME_FAMILY.CAVE]
      .includes(sample.owner.family)
      || ![BIOME_FAMILY.SURFACE, BIOME_FAMILY.CAVE]
        .includes(sample.neighbor.family)
      || sample.owner.biome < 0 || sample.owner.biome >= ownerCount
      || sample.neighbor.biome < 0 || sample.neighbor.biome >= neighborCount
      || sample.blend < 0 || sample.blend > 0.502;
    blendedSamples += sample.blend > 0;
    if (sample.owner.family === BIOME_FAMILY.SURFACE) {
      verticalSurfaceChanges += previousSurface !== null
        && previousSurface !== sample.owner.biome;
      previousSurface = sample.owner.biome;
    } else {
      verticalCaveChanges += previousCave !== null
        && previousCave !== sample.owner.biome;
      previousCave = sample.owner.biome;
    }
  }
}
check('the unified field returns one valid owner and a bounded visual neighbour',
  invalidSamples === 0 && blendedSamples > 0);
check('surface and cave biomes form finite 2D regions instead of vertical strips',
  verticalSurfaceChanges > 8 && verticalCaveChanges > 8);

// Surface height is a pure function of worldX (no biome term), so it must be
// smooth — adjacent columns differ by ~1 cell, never a biome-seam cliff.
let maxJump = 0;
for (let wx = -3000; wx < 3000; wx++) maxJump = Math.max(maxJump, Math.abs(e.worldSurfaceAt(wx) - e.worldSurfaceAt(wx + 1)));
check(`surface height is continuous across biome seams (max adjacent jump ${maxJump})`, maxJump <= 4);

// Scan the surface skin + the mantle just under it, panning across many biomes.
const skins = new Set();
let sawDirtMantle = false;
let matchedBackgroundStrata = 0;
let backgroundVegetationStrata = 0;
let mismatchedBackgroundStrata = 0;
const scan = () => {
  const g = e.getGrid(), bg = e.getGridBg();
  for (let x = 1; x < COLS - 1; x++) {
    let surfY = -1;
    for (let y = 0; y < ROWS; y++) { const m = g[y * COLS + x]; if (m !== MAT.EMPTY && m !== MAT.WATER) { surfY = y; break; } }
    if (surfY < 0) continue;
    skins.add(g[surfY * COLS + x]);
    for (let y = surfY; y < Math.min(ROWS, surfY + 8); y++) {
      const k = y * COLS + x, m = g[k];
      if (m === MAT.DIRT) sawDirtMantle = true;
      if (m === MAT.SAND || m === MAT.DIRT || m === MAT.MUD || m === MAT.SNOW || m === MAT.GRASS) {
        if (bg[k] === m) matchedBackgroundStrata++;
        else if (MAT_FLAGS[bg[k]] & MF.plantFamily) backgroundVegetationStrata++;
        else mismatchedBackgroundStrata++;
      }
    }
  }
};
scan();
for (let i = 0; i < 40; i++) { e.shiftWorldXY(128, 0); scan(); }

// Multiple biomes produce multiple skin materials; tundra's SNOW in particular.
const named = [...skins].map((m) => Object.keys(MAT).find((k) => MAT[k] === m));
check(`several biome skins generate (${named.sort().join(', ')})`, skins.size >= 3);
check('plains/forest GRASS skin appears', skins.has(MAT.GRASS));
check('tundra SNOW skin appears', skins.has(MAT.SNOW));
check('a DIRT mantle is generated under grass', sawDirtMantle);
check(`background matches exposed loose surface strata (${matchedBackgroundStrata} cells, ${backgroundVegetationStrata} vegetation occlusions)`,
  matchedBackgroundStrata > 0 && mismatchedBackgroundStrata === 0);
e.destroy();

// The freshly generated world (loose dirt/sand/snow mantle included) settles to
// inert quickly.
{
  const e2 = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });
  let t = 0, settledAt = -1;
  for (let i = 0; i < 600; i++) { t += 16; if (!e2.step(t)) { settledAt = i; break; } }
  check(`generated world settles to inert (step ${settledAt})`, settledAt >= 0 && settledAt < 600);
  e2.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
