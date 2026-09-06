// Biomes shape continuous surface relief, distinct soil, and vegetation. The
// generated loose mantle must settle without churn.

import {
  initSandWasm, createEngineWasm, BIOME, CAVE_BIOME,
  PLANET, PLANET_COUNT,
  SURFACE_BIOME_COUNT, SURFACE_BIOME_ALL_MASK,
  CAVE_BIOME_COUNT, CAVE_BIOME_ALL_MASK,
  SURFACE_BIOME_DEFS, CAVE_BIOME_DEFS,
  SURFACE_BIOME_SELECTION_ORDER,
  SHALLOW_CAVE_BIOME_SELECTION_ORDER,
  DEEP_CAVE_BIOME_SELECTION_ORDER,
} from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { MAT_FLAGS, MF } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';
import { SURFACE_REGION_WIDTH, SURFACE_REGION_JITTER } from '../src/sand/wasmBridge/biomes.generated.js';

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
      reachedSurface.add(reach.worldBiomeAt(x));
      for (const y of [180, 420, 760, 960, 1400]) {
        const cave = reach.worldCaveBiomeAt(x, y);
        reachedCaves.add(cave);
        planetCaves.add(cave);
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

// Blended relief stays continuous across biome seams.
let maxJump = 0;
for (let wx = -3000; wx < 3000; wx++) maxJump = Math.max(maxJump, Math.abs(e.worldSurfaceAt(wx) - e.worldSurfaceAt(wx + 1)));
check(`surface height is continuous across biome seams (max adjacent jump ${maxJump})`, maxJump <= 4);

const regionRuns = [];
let previousBiome = -1, runLength = 0;
for (let x = -30_000; x <= 30_000; x += 32) {
  const votes = Array(SURFACE_BIOME_COUNT).fill(0);
  for (let dx = -48; dx <= 48; dx += 16) votes[e.worldBiomeAt(x + dx)]++;
  const biome = votes.indexOf(Math.max(...votes));
  if (biome === previousBiome) runLength += 32;
  else {
    if (runLength) regionRuns.push(runLength);
    previousBiome = biome;
    runLength = 32;
  }
}
regionRuns.sort((a, b) => a - b);
const medianRegion = regionRuns[Math.floor(regionRuns.length / 2)];
check(`surface biomes have substantial continuous cores (median ${medianRegion} cells)`, medianRegion >= SURFACE_REGION_WIDTH);

// Count exact semantic runs, including every cell at borders. Large regions
// must not conceal four-cell biome flickers behind a smoothed voting metric.
for (const seed of [0, 0xBED, 0xBEEF, 7]) {
  const regionEngine = createEngineWasm({ cols: 96, rows: 96, worldSeed: seed, infinite: true });
  const runs = [];
  let start = -30000, previous = regionEngine.worldBiomeAt(start);
  for (let x = start + 1; x <= 30000; x++) {
    const biome = regionEngine.worldBiomeAt(x);
    if (biome !== previous) {
      runs.push(x - start);
      start = x;
      previous = biome;
    }
  }
  const shortest = Math.min(...runs.slice(1));
  check(`seed ${seed}: every complete biome run has a long uninterrupted core (${shortest} minimum)`,
    runs.length >= 8 && shortest >= SURFACE_REGION_WIDTH - SURFACE_REGION_JITTER * 2);
  regionEngine.destroy();
}

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

// Shallow swamp pools retain their muddy mantle across the waterline in both
// layers, with a sealed bed beneath them throughout settling and streaming.
{
  const swamp = createEngineWasm({ cols: 256, rows: 192, worldSeed: 0, sinksOn: false, infinite: true });
  const targetX = -11232, targetY = -64;
  while (swamp.getWorldOffsetX() !== targetX)
    swamp.shiftWorldXY(Math.max(-128, Math.min(128, targetX - swamp.getWorldOffsetX())), 0);
  while (swamp.getWorldOffsetY() !== targetY)
    swamp.shiftWorldXY(0, Math.max(-96, Math.min(96, targetY - swamp.getWorldOffsetY())));
  const beds = [];
  for (let x = 80; x < 192; x++) {
    const worldX = swamp.getWorldOffsetX() + x;
    const surface = swamp.worldSurfaceAbsAt(worldX) - swamp.getWorldOffsetY();
    if (swamp.worldBiomeAt(worldX) !== BIOME.SWAMP
        || swamp.getGrid()[(surface - 1) * swamp.cols + x] !== MAT.WATER) continue;
    for (let dy = 0; dy < 6; dy++) beds.push((surface + dy) * swamp.cols + x);
  }
  const muddy = () => beds.filter((k) => swamp.getGrid()[k] === MAT.MUD
    && swamp.getGridBg()[k] === MAT.MUD).length;
  const water = () => [swamp.getGrid(), swamp.getGridBg()]
    .reduce((count, grid) => count + grid.filter((mat) => mat === MAT.WATER).length, 0);
  check('swamp pool beds have mud skin and soil in both layers', beds.length > 300 && muddy() === beds.length);
  const initialWater = water();
  swamp.shiftWorldXY(128, 0); swamp.shiftWorldXY(128, 0);
  swamp.shiftWorldXY(-128, 0); swamp.shiftWorldXY(-128, 0);
  check('muddy pool beds survive streaming intact', muddy() === beds.length);
  for (let tick = 0; tick < 400; tick++) swamp.stepWorld();
  check('submerged swamp mud remains stable through settling', muddy() >= beds.length * 0.95);
  check('swamp pools retain water above their sealed bed', water() >= initialWater * 0.95);
  swamp.destroy();
}

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
