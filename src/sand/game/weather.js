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
  skyTint: '#5d6a74',
  skyTintAmount: 0.52,
  cloudTint: '#59646d',
  cloudTintAmount: 0.55,
  cloudCounts: Object.freeze([6, 9]),
  skyLightScale: 0.78,
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

// 'auto' (or an unset value) runs the deterministic clear/rain cycle; any
// explicit weather id pins the session to that profile.
export function resolveWeatherMode(value) {
  if (value === undefined || value === null || value === '') return 'auto';
  const name = String(value).trim().toLowerCase();
  return name === 'auto' ? 'auto' : 'pin';
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

// ---- auto weather cycle ----------------------------------------------------
// Presentation-only schedule in the shape of the day/night cycle: a pure
// function of elapsed wall-clock time. The discrete clear/rain flip is sent to
// the authority as a journaled message; everything visual interpolates on the
// continuous mix so transitions fade instead of popping.

export const WEATHER_CYCLE_MS = 6 * 60 * 1000;
export const WEATHER_TRANSITION_MS = 14 * 1000;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// Rain holds the middle of each cycle: full rain between 40% and 70%, with
// smoothstep ramps on both sides. Phase 0 is fully clear so a fresh mount
// starts in calm weather.
export function sampleAutoWeather(elapsedMs) {
  const phase = (Math.max(0, elapsedMs) % WEATHER_CYCLE_MS) / WEATHER_CYCLE_MS;
  const ramp = WEATHER_TRANSITION_MS / WEATHER_CYCLE_MS;
  const mix = smoothstep(0.40 - ramp, 0.40, phase)
    * (1 - smoothstep(0.70, 0.70 + ramp, phase));
  return Object.freeze({
    mix,
    id: mix >= 0.5 ? WEATHER.RAIN : WEATHER.CLEAR,
  });
}

export function getWeatherProfile(id = DEFAULT_WEATHER_ID) {
  return WEATHER_PROFILES[resolveWeatherId(id)];
}

export function weatherSkyLight(base, id = DEFAULT_WEATHER_ID, mix = 1) {
  const value = Number.isFinite(base) ? Math.max(0, Math.min(255, Math.round(base))) : 0;
  const scale = 1 + (getWeatherProfile(id).skyLightScale - 1) * clamp01(mix);
  if (scale === 1) return value;
  return Math.max(0, Math.min(255, Math.round((value * scale) / 4) * 4));
}

export function applyWeatherToPalette(palette, id = DEFAULT_WEATHER_ID, mix = 1) {
  const profile = getWeatherProfile(id);
  const amount = clamp01(mix);
  if (profile === CLEAR_PROFILE || amount === 0) return palette;
  const result = { ...palette };
  for (const field of SKY_FIELDS) {
    result[field] = mixColor(
      palette[field], profile.skyTint, profile.skyTintAmount * amount,
    );
  }
  for (const field of CLOUD_FIELDS) {
    result[field] = mixColor(
      palette[field], profile.cloudTint, profile.cloudTintAmount * amount,
    );
  }
  return result;
}
