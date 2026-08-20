import { PLANET, WEATHER } from '../wasmBridge/abi.generated.js';

export const DEFAULT_WEATHER_ID = WEATHER.CLEAR;

const WEATHER_BY_NAME = Object.freeze({
  clear: WEATHER.CLEAR,
  rain: WEATHER.RAIN,
});

const CLEAR_PROFILE = Object.freeze({
  id: WEATHER.CLEAR,
  name: 'clear',
  skyTint: '#808890',
  skyTintAmount: 0,
  cloudTint: '#707980',
  cloudTintAmount: 0,
  cloudCounts: Object.freeze([1, 2]),
  skyLightScale: 1,
  planetIds: null,
  precipitation: null,
});

const RAIN_PROFILE = Object.freeze({
  id: WEATHER.RAIN,
  name: 'rain',
  skyTint: '#747d85',
  skyTintAmount: 0.18,
  cloudTint: '#69747c',
  cloudTintAmount: 0.28,
  cloudCounts: Object.freeze([3, 4]),
  skyLightScale: 0.9,
  planetIds: Object.freeze([PLANET.EARTH]),
  precipitation: Object.freeze({
    kind: 'rain',
    color: '#a9c3cf',
    opacity: 0.48,
    spacing: 4,
  }),
});

const WEATHER_PROFILES = Object.freeze({
  [WEATHER.CLEAR]: CLEAR_PROFILE,
  [WEATHER.RAIN]: RAIN_PROFILE,
});

const SKY_FIELDS = Object.freeze(['skyTop', 'skyMid', 'skyGlow', 'skyLow']);
const CLOUD_FIELDS = Object.freeze(['cloudDark', 'cloudLight']);

export function isWeatherId(value) {
  return Number.isInteger(value) && Object.hasOwn(WEATHER_PROFILES, value);
}

function mixColor(a, b, amount) {
  if (amount <= 0) return a;
  if (amount >= 1) return b;
  const av = Number.parseInt(a.slice(1), 16);
  const bv = Number.parseInt(b.slice(1), 16);
  const channel = (shift) => Math.round(
    ((av >> shift) & 255)
      + (((bv >> shift) & 255) - ((av >> shift) & 255)) * amount,
  );
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0))
    .toString(16).padStart(6, '0')}`;
}

export function resolveWeatherId(value = DEFAULT_WEATHER_ID) {
  if (typeof value === 'number') {
    return isWeatherId(value) ? value : DEFAULT_WEATHER_ID;
  }
  const name = String(value).trim().toLowerCase();
  if (Object.hasOwn(WEATHER_BY_NAME, name)) return WEATHER_BY_NAME[name];
  if (/^\d+$/.test(name)) {
    const numericId = Number(name);
    if (isWeatherId(numericId)) return numericId;
  }
  return DEFAULT_WEATHER_ID;
}

export function resolveWeatherIdForPlanet(value, planetId) {
  const id = resolveWeatherId(value);
  const supportedPlanets = WEATHER_PROFILES[id].planetIds;
  return !supportedPlanets || supportedPlanets.includes(planetId)
    ? id
    : DEFAULT_WEATHER_ID;
}

export function getWeatherProfile(id = DEFAULT_WEATHER_ID) {
  return WEATHER_PROFILES[resolveWeatherId(id)];
}

export function weatherSkyLight(base, id = DEFAULT_WEATHER_ID) {
  const value = Number.isFinite(base) ? Math.max(0, Math.min(255, Math.round(base))) : 0;
  const scale = getWeatherProfile(id).skyLightScale;
  if (scale === 1) return value;
  return Math.max(0, Math.min(255, Math.round((value * scale) / 4) * 4));
}

export function applyWeatherToPalette(palette, id = DEFAULT_WEATHER_ID) {
  const profile = getWeatherProfile(id);
  if (profile === CLEAR_PROFILE) return palette;
  const result = { ...palette };
  for (const field of SKY_FIELDS) {
    result[field] = mixColor(palette[field], profile.skyTint, profile.skyTintAmount);
  }
  for (const field of CLOUD_FIELDS) {
    result[field] = mixColor(
      palette[field], profile.cloudTint, profile.cloudTintAmount,
    );
  }
  return result;
}
