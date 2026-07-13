import {
  DAY_CYCLE_MS,
  NIGHT_SKY_LIGHT,
  NOON_SKY_LIGHT,
  dayPhaseAt,
  sampleDayNight,
} from '../src/sand/game/dayNightCycle.js';
import { paletteForPhase } from '../src/sand/game/parallaxBackground.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('day/night cycle');
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

check('full cycle is ten real-time minutes', DAY_CYCLE_MS === 600000);
check('clock maps midnight/sunrise/noon/sunset',
  close(dayPhaseAt(0), 0) && close(dayPhaseAt(150000), 0.25) &&
  close(dayPhaseAt(300000), 0.5) && close(dayPhaseAt(450000), 0.75));
check('clock wraps exactly after one cycle', close(dayPhaseAt(DAY_CYCLE_MS), 0));

const midnight = sampleDayNight(0);
const sunrise = sampleDayNight(0.25);
const noon = sampleDayNight(0.5);
const sunset = sampleDayNight(0.75);
check('midnight has moonlight, stars, and the moon at its apex',
  midnight.skyLight === NIGHT_SKY_LIGHT && midnight.starOpacity === 1 &&
  midnight.moonVisible && close(midnight.moonProgress, 0.5) && !midnight.sunVisible);
check('noon has full skylight, no stars, and the sun at its apex',
  noon.skyLight === NOON_SKY_LIGHT && noon.starOpacity === 0 &&
  noon.sunVisible && close(noon.sunProgress, 0.5) && !noon.moonVisible);
check('sun and moon meet their opposite horizons at sunrise/sunset',
  sunrise.sunVisible && sunrise.moonVisible && close(sunrise.sunProgress, 0) && close(sunrise.moonProgress, 1) &&
  sunset.sunVisible && sunset.moonVisible && close(sunset.sunProgress, 1) && close(sunset.moonProgress, 0));

check('the existing midnight palette is unchanged', JSON.stringify(paletteForPhase(0)) === JSON.stringify({
  skyTop: '#111827', skyMid: '#1f3b57', skyLow: '#4a6b72',
  cloudDark: '#b8c7ca', cloudLight: '#e6ece8',
  ridgeFar: '#31455b', ridgeMid: '#263c44', ridgeNear: '#1a2d2f', ridgeDeep: '#14171a',
}));
check('day palette reaches the intended noon colors', JSON.stringify(paletteForPhase(0.5)) === JSON.stringify({
  skyTop: '#5d9dca', skyMid: '#8fc2d5', skyLow: '#c8d8c9',
  cloudDark: '#d8dedc', cloudLight: '#f4f2e8',
  ridgeFar: '#738f98', ridgeMid: '#587579', ridgeNear: '#3d5958', ridgeDeep: '#242a2b',
}));

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

const failures = done();
process.exit(failures === 0 ? 0 : 1);
