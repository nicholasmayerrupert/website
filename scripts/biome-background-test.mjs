import { SURFACE_REGION_WIDTH as REGION } from '../src/sand/wasmBridge/biomes.generated.js';
import process from 'node:process';
import { BIOME, SURFACE_BIOME_COUNT } from '../src/sand/wasmBridge/abi.generated.js';
import { BIOME_BACKGROUND_PROFILES, createBiomeBackgroundBlend, biomeBackgroundStyle, createBiomeScenerySampler } from '../src/sand/game/biomeBackground.js';
import { biomeRidgeY, paletteForPhase, createBiomeRidgeSampler } from '../src/sand/game/parallaxBackground.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('biome background');
const close = (a, b) => Math.abs(a - b) < 1e-9;
let queries = 0;
const engine = { worldBiomeAt: (x) => { queries++; return x < 0 ? BIOME.FOREST : BIOME.DESERT; } };
const sample = createBiomeBackgroundBlend();
const forest = sample(engine, -160, 0);
check('inside a biome the scenery has a single full weight', forest[BIOME.FOREST] === 1);
const boundary = sample(engine, -2, 0, true);
check('a boundary blends its two neighboring biomes evenly', close(boundary[BIOME.FOREST], 0.5) && close(boundary[BIOME.DESERT], 0.5));
let previous = 0;
let maxJump = 0;
let normalized = true;
for (let x = -100; x <= 100; x += 0.25) {
  const weights = sample(engine, x, 0, true);
  maxJump = Math.max(maxJump, Math.abs(weights[BIOME.DESERT] - previous));
  previous = weights[BIOME.DESERT];
  normalized &&= weights.every((weight) => weight >= 0 && weight <= 1)
    && close(weights.reduce((sum, weight) => sum + weight, 0), 1);
}
check('subcell movement through the sample lattice stays continuous and normalized', maxJump < 0.003 && normalized);
const before = queries;
sample(engine, 100, 0, true);
sample(engine, 100.25, 0, true);
check('nearby camera movement reuses cached absolute-world biome queries', queries === before);

const fade = createBiomeBackgroundBlend();
fade(engine, -96, 0);
const entering = fade(engine, 96, 90);
const reversing = fade(engine, -96, 180);
check('turning back mid-fade eases from the visible mix', entering[BIOME.DESERT] > 0 && entering[BIOME.DESERT] < 1
  && reversing[BIOME.DESERT] > 0 && reversing[BIOME.DESERT] < entering[BIOME.DESERT]);
const fast = createBiomeBackgroundBlend(), slow = createBiomeBackgroundBlend();
fast(engine, -96, 0);
slow(engine, -96, 0);
let a, b;
for (let t = 10; t <= 500; t += 10) a = fast(engine, 96, t);
for (let t = 50; t <= 500; t += 50) b = slow(engine, 96, t);
check('fade duration is independent of frame rate', a.every((weight, i) => close(weight, b[i])) && a[BIOME.DESERT] > 0.93);
check('teleports immediately select the destination scenery', fade(engine, 10000, 190)[BIOME.DESERT] === 1);
check('paused views immediately sample the requested position', fade(engine, 9999, 200, true)[BIOME.DESERT] === 1);
check('replacing the engine discards cached biome identities', fade({ worldBiomeAt: () => BIOME.TUNDRA }, 9999, 210)[BIOME.TUNDRA] === 1);

const scenery = createBiomeScenerySampler();
const at = scenery(engine);
check('fixed vegetation mixtures put forest to the left and desert to the right',
  at(-140)[BIOME.FOREST] === 1 && at(140)[BIOME.DESERT] === 1);
check('a scenery sampler retains its identity for the same world', scenery(engine) === at);
const saved = at(12.25);
for (let x = -20000; x < 20000; x += 16) at(x);
check('reversals, teleports, and cache eviction cannot change a location',
  at(12.25).every((weight, id) => close(weight, saved[id])));
const islandAt = scenery({ worldBiomeAt: (x) => Math.abs(x) < 96 ? BIOME.WATCHWOOD : BIOME.DESERT });
check('a biome enclosed on both sides keeps its own fixed patch of scenery',
  islandAt(0)[BIOME.WATCHWOOD] > 0.99
  && islandAt(-320)[BIOME.WATCHWOOD] === 0 && islandAt(320)[BIOME.WATCHWOOD] === 0);
check('replacing the world resets scenery samples',
  scenery({ worldBiomeAt: () => BIOME.TUNDRA })(12.25)[BIOME.TUNDRA] === 1);

const pure = (id) => Array.from({ length: SURFACE_BIOME_COUNT }, (_, i) => i === id ? 1 : 0);
const noon = paletteForPhase(0.5);
const desert = biomeBackgroundStyle(noon, pure(BIOME.DESERT));
const tundra = biomeBackgroundStyle(noon, pure(BIOME.TUNDRA));
check('desert removes forest and snow scenery', desert.forest === 0 && desert.snow === 0);
check('biomes use distinct silhouettes and vegetation',
  BIOME_BACKGROUND_PROFILES[BIOME.DESERT].shape === 'dunes'
  && BIOME_BACKGROUND_PROFILES[BIOME.DESERT].plants === 'cactus'
  && BIOME_BACKGROUND_PROFILES[BIOME.ROCKY].shape === 'crags'
  && BIOME_BACKGROUND_PROFILES[BIOME.JUNGLE].plants === 'jungle'
  && BIOME_BACKGROUND_PROFILES[BIOME.SWAMP].plants === 'willow');
check('bone highlands have fossil scenery without snow or trees',
  BIOME_BACKGROUND_PROFILES[BIOME.ROCKY].plants === 'bones'
  && BIOME_BACKGROUND_PROFILES[BIOME.ROCKY].snow === 0
  && BIOME_BACKGROUND_PROFILES[BIOME.ROCKY].forest === 0);
const watchwood = biomeBackgroundStyle(noon, pure(BIOME.WATCHWOOD));
check('Watchwood has its own eye silhouettes and a snow-free plum landscape',
  BIOME_BACKGROUND_PROFILES[BIOME.WATCHWOOD].plants === 'eyes'
  && watchwood.snow === 0 && watchwood.forest === 0
  && watchwood.palette.ridgeNear !== desert.palette.ridgeNear
  && watchwood.palette.ridgeNear !== noon.ridgeNear);
check('tundra retains full snow coverage with sparse forest', tundra.snow === 1 && tundra.forest < 0.3);
check('celestial and cloud palette colors remain shared', desert.palette.cloudLight === noon.cloudLight && desert.palette.cloudDark === noon.cloudDark);
const night = biomeBackgroundStyle(paletteForPhase(0), pure(BIOME.DESERT));
check('biome tint preserves dark nighttime scenery', Number.parseInt(night.palette.ridgeNear.slice(1, 3), 16)
  < Number.parseInt(desert.palette.ridgeNear.slice(1, 3), 16) / 2);
check('standalone backdrops retain their default palette', biomeBackgroundStyle(noon, null).palette === noon);
const contours = [{ shape: 'crags', relief: 1.6, weight: 1 }, { shape: 'rolling', relief: 0.45, weight: 1 }];
let solidBlend = true;
for (let x = -600; x <= 600; x++) {
  const a = biomeRidgeY(x, 60, 20, 3.2, [contours[0]]);
  const b = biomeRidgeY(x, 60, 20, 3.2, [contours[1]]);
  const middle = biomeRidgeY(x, 60, 20, 3.2, contours.map((contour) => ({ ...contour, weight: 0.5 })));
  solidBlend &&= close(middle, (a + b) / 2);
}
check('a transition interpolates one contour between both landscape shapes', solidBlend);
const mountain = { ...contours[0], rise: BIOME_BACKGROUND_PROFILES[BIOME.ROCKY].rise[0] };
check('mountain elevation raises the complete contour as well as its peaks',
  mountain.rise > 0 && [-200, 0, 200].every((x) => close(
    biomeRidgeY(x, 60, 20, 3.2, [mountain]),
    biomeRidgeY(x, 60, 20, 3.2, [contours[0]]) - mountain.rise,
  )));

const ridgeAt = (sampler, depth = 0.52, layer = 2, fallback = pure(BIOME.PLAINS)) =>
  createBiomeRidgeSampler(sampler, fallback, noon, depth, layer, 100, 22, 12.4);
const fixed = ridgeAt(at);
const landmarks = [-72, -19.25, 0, 19.25, 72].map((x) => [x, JSON.stringify(fixed(x))]);
const revisit = ridgeAt(at, 0.52, 2, pure(BIOME.DESERT));
check('ridge height, facets, colors, snow, and vegetation ignore the player biome mix',
  landmarks.every(([x, value]) => JSON.stringify(revisit(x)) === value));
check('independent parallax layers project the same real biome boundaries',
  [-140, -48, 0, 48, 140].every((x) => {
    const samples = [0.18, 0.34, 0.52, 0.7].map((depth, layer) => ridgeAt(at, depth, layer)(x * depth));
    return samples.every((sample) => Object.keys(sample.plants).every((kind) => close(sample.plants[kind], samples[0].plants[kind]))
      && close(sample.snow, samples[0].snow));
  }));
const changingAt = createBiomeScenerySampler()({
  worldBiomeAt: (x) => ((Math.floor(x / REGION) % SURFACE_BIOME_COUNT) + SURFACE_BIOME_COUNT) % SURFACE_BIOME_COUNT,
});
const dominant = (weights) => weights.indexOf(Math.max(...weights));
check('scenery preserves each real biome rather than replacing a district by majority vote',
  Array.from({length: SURFACE_BIOME_COUNT}, (_, id) => id).every((id) =>
    dominant(changingAt((id + 0.5) * REGION)) === id));
const boundarySaved = changingAt(REGION - 56);
for (let i = -300; i < 300; i++) changingAt(i * REGION + 200);
check('spatial boundaries survive cache eviction and return trips unchanged',
  changingAt(REGION - 56).every((weight, id) => close(weight, boundarySaved[id])));
check('rounded hills suppress angular mountain facets',
  ridgeAt(null, 0.52, 2, pure(BIOME.WATCHWOOD))(0).facets === 0
  && ridgeAt(null, 0.52, 2, pure(BIOME.ROCKY))(0).facets === 1);

let allPairsJoin = true;
for (let left = 0; left < SURFACE_BIOME_COUNT; left++) {
  for (let right = left + 1; right < SURFACE_BIOME_COUNT; right++) {
    const pairAt = createBiomeScenerySampler()({ worldBiomeAt: (x) => x < 0 ? left : right });
    const ridge = ridgeAt(pairAt);
    for (let x = -60; x < 60; x += 0.25) {
      const weights = pairAt(x);
      allPairsJoin &&= Math.abs(ridge(x + 0.01).height - ridge(x).height) < 0.1
        && close(weights.reduce((sum, weight) => sum + weight, 0), 1);
    }
  }
}
check('every biome pair joins continuously through the same generic sampler', allPairsJoin);

process.exit(done() === 0 ? 0 : 1);
