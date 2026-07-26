export const DAY_CYCLE_MS = 10 * 60 * 1000;
// Automatic sky visuals update at 10 Hz. Manual changes render on the next frame.
export const DAY_VISUAL_STEP_MS = 100;
export const NIGHT_SKY_LIGHT = 88;
export const NOON_SKY_LIGHT = 255;
export const DEFAULT_DAY_PHASE = 5 / 24;
export const SUNRISE_PHASE = 0.20;
export const SUNSET_PHASE = 0.80;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function normalizeDayPhase(phase) {
  if (!Number.isFinite(phase)) return 0;
  if (phase >= 0 && phase < 1) return phase;
  return ((phase % 1) + 1) % 1;
}

export function dayPhaseAt(elapsedMs) {
  return normalizeDayPhase(DEFAULT_DAY_PHASE + Math.max(0, elapsedMs) / DAY_CYCLE_MS);
}

function quantizeSkyLight(value) {
  if (value >= NOON_SKY_LIGHT - 2) return NOON_SKY_LIGHT;
  return NIGHT_SKY_LIGHT + Math.round((value - NIGHT_SKY_LIGHT) / 4) * 4;
}

export function sampleDayNight(phase) {
  const p = normalizeDayPhase(phase);
  // Give the sun six of the ten cycle minutes while keeping noon and midnight
  // fixed. The softened daytime arc holds useful brightness longer; the night
  // arc still reaches the same moonlit minimum at midnight.
  let solar;
  if (p >= SUNRISE_PHASE && p <= SUNSET_PHASE) {
    const dayProgress = (p - SUNRISE_PHASE) / (SUNSET_PHASE - SUNRISE_PHASE);
    solar = 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * dayProgress), 0.72);
  } else {
    const wrapped = p < SUNRISE_PHASE ? p + 1 : p;
    const nightProgress = (wrapped - SUNSET_PHASE) / (1 + SUNRISE_PHASE - SUNSET_PHASE);
    solar = 0.5 - 0.5 * Math.pow(Math.sin(Math.PI * nightProgress), 0.8);
  }
  // Sunrise/sunset should read clearly brighter than midnight, not as a tiny
  // step above moonlight. At the horizon (solar=0.5) this yields ~156/255.
  const daylight = smoothstep(0.12, 1, solar);
  const rawSkyLight = NIGHT_SKY_LIGHT + (NOON_SKY_LIGHT - NIGHT_SKY_LIGHT) * daylight;

  let starOpacity = 0;
  if (p < 0.12 || p >= 0.88) starOpacity = 1;
  else if (p < 0.28) starOpacity = 1 - smoothstep(0.12, 0.28, p);
  else if (p >= 0.72) starOpacity = smoothstep(0.72, 0.88, p);

  const sunProgress = clamp01((p - SUNRISE_PHASE) / (SUNSET_PHASE - SUNRISE_PHASE));
  const wrappedNight = p <= SUNRISE_PHASE ? p + 1 : p;
  const moonProgress = clamp01((wrappedNight - SUNSET_PHASE) / (1 + SUNRISE_PHASE - SUNSET_PHASE));

  return Object.freeze({
    phase: p,
    daylight,
    starOpacity,
    skyLight: quantizeSkyLight(rawSkyLight),
    rawSkyLight,
    sunVisible: p >= SUNRISE_PHASE && p <= SUNSET_PHASE,
    sunProgress,
    moonVisible: p <= SUNRISE_PHASE || p >= SUNSET_PHASE,
    moonProgress,
  });
}
