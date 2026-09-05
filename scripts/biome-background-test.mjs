import process from 'node:process';
import { BIOME, SURFACE_BIOME_COUNT } from '../src/sand/wasmBridge/abi.generated.js';
import { BIOME_BACKGROUND_PROFILES, createBiomeBackgroundBlend, biomeBackgroundStyle } from '../src/sand/game/biomeBackground.js';
import { biomeRidgeY, paletteForPhase } from '../src/sand/game/parallaxBackground.js';
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

process.exit(done() === 0 ? 0 : 1);
