import {
  DAY_CYCLE_MS,
  DEFAULT_DAY_PHASE,
  NIGHT_SKY_LIGHT,
  NOON_SKY_LIGHT,
  SUNRISE_PHASE,
  SUNSET_PHASE,
  dayPhaseAt,
  sampleDayNight,
} from '../src/sand/game/dayNightCycle.js';
import {
  SURFACE_CAM_Y,
  celestialOrbitY,
  cloudCycleOffset,
  paletteForPhase,
  skyAltitudeLayout,
} from '../src/sand/game/parallaxBackground.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('day/night cycle');
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

check('full cycle is ten real-time minutes', DAY_CYCLE_MS === 600000);
check('clock starts at 5 AM and advances six hours per quarter-cycle',
  close(DEFAULT_DAY_PHASE, 5 / 24) && close(dayPhaseAt(0), 5 / 24) &&
  close(dayPhaseAt(150000), 11 / 24) && close(dayPhaseAt(300000), 17 / 24) &&
  close(dayPhaseAt(450000), 23 / 24));
check('clock wraps exactly after one cycle', close(dayPhaseAt(DAY_CYCLE_MS), DEFAULT_DAY_PHASE));

const midnight = sampleDayNight(0);
const sunrise = sampleDayNight(SUNRISE_PHASE);
const noon = sampleDayNight(0.5);
const sunset = sampleDayNight(SUNSET_PHASE);
check('midnight has moonlight, stars, and the moon at its apex',
  midnight.skyLight === NIGHT_SKY_LIGHT && midnight.starOpacity === 1 &&
  midnight.moonVisible && close(midnight.moonProgress, 0.5) && !midnight.sunVisible);
check('noon has full skylight, no stars, and the sun at its apex',
  noon.skyLight === NOON_SKY_LIGHT && noon.starOpacity === 0 &&
  noon.sunVisible && close(noon.sunProgress, 0.5) && !noon.moonVisible);
check('sun and moon meet their opposite horizons at sunrise/sunset',
  sunrise.sunVisible && sunrise.moonVisible && close(sunrise.sunProgress, 0) && close(sunrise.moonProgress, 1) &&
  sunset.sunVisible && sunset.moonVisible && close(sunset.sunProgress, 1) && close(sunset.moonProgress, 0));
check('daylight is extended to six minutes of the ten-minute cycle',
  close(SUNRISE_PHASE, 0.20) && close(SUNSET_PHASE, 0.80));
check('dawn and dusk terrain are visibly brighter than midnight',
  sunrise.skyLight >= midnight.skyLight + 60 && sunset.skyLight >= midnight.skyLight + 60);

check('midnight palette keeps a deep blue sky and moonlit mountain separation', JSON.stringify(paletteForPhase(0)) === JSON.stringify({
  skyTop: '#071327', skyMid: '#102b47', skyGlow: '#24455e', skyLow: '#3b5970',
  cloudDark: '#71899a', cloudLight: '#a7bac3',
  ridgeFar: '#31485f', ridgeMid: '#263f43', ridgeNear: '#17352f', ridgeDeep: '#11171a',
}));
check('day palette reaches the intended noon colors', JSON.stringify(paletteForPhase(0.5)) === JSON.stringify({
  skyTop: '#448cc6', skyMid: '#78b7d5', skyGlow: '#add5e1', skyLow: '#d4e8ea',
  cloudDark: '#b8cdd5', cloudLight: '#edf4f2',
  ridgeFar: '#718d9a', ridgeMid: '#527264', ridgeNear: '#35634f', ridgeDeep: '#222b29',
}));
check('sunset transitions from blue through orange before pink',
  paletteForPhase(0.72).skyLow === '#f1bf89' && paletteForPhase(0.80).skyLow === '#e69a81');
check('midnight and noon horizons stay cool while golden hour stays warm',
  paletteForPhase(0).skyLow === '#3b5970' &&
  paletteForPhase(0.5).skyLow === '#d4e8ea' &&
  paletteForPhase(0.72).skyLow === '#f1bf89');

let bounded = true, quantized = true;
for (let i = 0; i <= 1000; i++) {
  const light = sampleDayNight(i / 1000).skyLight;
  bounded &&= light >= NIGHT_SKY_LIGHT && light <= NOON_SKY_LIGHT;
  quantized &&= light === NOON_SKY_LIGHT || (light - NIGHT_SKY_LIGHT) % 4 === 0;
}
check('skylight stays moonlit and bounded', bounded);
check('terrain skylight uses four-point performance steps', quantized);
check('cycle joins smoothly at midnight',
  Math.abs(sampleDayNight(0.999999).rawSkyLight - sampleDayNight(0.000001).rawSkyLight) < 0.001);
check('cloud travel is phase-driven and loops exactly once per day',
  close(cloudCycleOffset(0.25, 170), 170) &&
  close(cloudCycleOffset(0.5, 170), 340) &&
  close(cloudCycleOffset(0, 170), cloudCycleOffset(1, 170)));
check('sun and moon paths begin below the mountain troughs before reaching the same apex',
  celestialOrbitY(70, 0) >= 138 &&
  celestialOrbitY(70, 1) >= 138 &&
  close(celestialOrbitY(70, 0.5), 70 - 70 * 0.68));

const surfaceSky = skyAltitudeLayout(SURFACE_CAM_Y, 180, 65);
const nearbySky = skyAltitudeLayout(SURFACE_CAM_Y - 8, 180, 65);
const highSky = skyAltitudeLayout(SURFACE_CAM_Y - 144, 180, 65);
const spaceSky = skyAltitudeLayout(SURFACE_CAM_Y - 320, 180, 65);
check('the surface star boundary remains above the mountain horizon',
  surfaceSky.starBottom <= 65 - 16 && surfaceSky.celestialDrop === 0);
check('ordinary camera movement keeps celestial layout screen-fixed',
  close(nearbySky.starBottom, surfaceSky.starBottom)
    && nearbySky.celestialDrop === 0);
check('high altitude expands the star field without moving the terrain horizon',
  highSky.starBottom > surfaceSky.starBottom + 70
    && highSky.gradientExtent > 120);
check('space fills the viewport and moves celestial bodies beyond its bottom',
  close(spaceSky.starBottom, 180)
    && spaceSky.gradientExtent > 180
    && spaceSky.celestialDrop > 180);

const failures = done();
process.exit(failures === 0 ? 0 : 1);
