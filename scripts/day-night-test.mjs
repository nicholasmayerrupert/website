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
import { cloudCycleOffset, paletteForPhase } from '../src/sand/game/parallaxBackground.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('day/night cycle');
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

check('full cycle is ten real-time minutes', DAY_CYCLE_MS === 600000);
check('clock starts at dawn and maps noon/sunset/midnight',
  DEFAULT_DAY_PHASE === 0.25 && close(dayPhaseAt(0), 0.25) &&
  close(dayPhaseAt(150000), 0.5) && close(dayPhaseAt(300000), 0.75) &&
  close(dayPhaseAt(450000), 0));
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
  skyTop: '#081226', skyMid: '#19334f', skyGlow: '#38566b', skyLow: '#6f7c78',
  cloudDark: '#96abb4', cloudLight: '#cedde0',
  ridgeFar: '#31485f', ridgeMid: '#263f43', ridgeNear: '#17352f', ridgeDeep: '#11171a',
}));
check('day palette reaches the intended noon colors', JSON.stringify(paletteForPhase(0.5)) === JSON.stringify({
  skyTop: '#4d90c6', skyMid: '#84bcd2', skyGlow: '#bdd4d3', skyLow: '#e4d8b5',
  cloudDark: '#c9d8dc', cloudLight: '#f4f2e8',
  ridgeFar: '#718d9a', ridgeMid: '#527264', ridgeNear: '#35634f', ridgeDeep: '#222b29',
}));
check('sunset transitions from blue through orange before pink',
  paletteForPhase(0.72).skyLow === '#f5d3a0' && paletteForPhase(0.80).skyLow === '#f3a184');

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

const failures = done();
process.exit(failures === 0 ? 0 : 1);
