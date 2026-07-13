export const DAY_CYCLE_MS = 10 * 60 * 1000;
export const DAY_VISUAL_STEP_MS = 250;
export const NIGHT_SKY_LIGHT = 88;
export const NOON_SKY_LIGHT = 255;

const TAU = Math.PI * 2;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function normalizeDayPhase(phase) {
  if (!Number.isFinite(phase)) return 0;
  return ((phase % 1) + 1) % 1;
}

export function dayPhaseAt(elapsedMs) {
  return normalizeDayPhase(Math.max(0, elapsedMs) / DAY_CYCLE_MS);
}

function quantizeSkyLight(value) {
  if (value >= NOON_SKY_LIGHT - 2) return NOON_SKY_LIGHT;
  return NIGHT_SKY_LIGHT + Math.round((value - NIGHT_SKY_LIGHT) / 4) * 4;
}

export function sampleDayNight(phase) {
  const p = normalizeDayPhase(phase);
  // 0 at midnight, 0.5 at sunrise/sunset, 1 at noon. Keeping terrain
  // moonlit until the sun is genuinely above the horizon makes dawn/dusk
  // dramatic without ever turning the outside world completely black.
  const solar = 0.5 - 0.5 * Math.cos(TAU * p);
  const daylight = smoothstep(0.35, 1, solar);
  const rawSkyLight = NIGHT_SKY_LIGHT + (NOON_SKY_LIGHT - NIGHT_SKY_LIGHT) * daylight;

  let starOpacity = 0;
  if (p < 0.18 || p >= 0.82) starOpacity = 1;
  else if (p < 0.30) starOpacity = 1 - smoothstep(0.18, 0.30, p);
  else if (p >= 0.70) starOpacity = smoothstep(0.70, 0.82, p);

  const sunProgress = clamp01((p - 0.25) / 0.5);
  const wrappedNight = p <= 0.25 ? p + 1 : p;
  const moonProgress = clamp01((wrappedNight - 0.75) / 0.5);

  return Object.freeze({
    phase: p,
    daylight,
    starOpacity,
    skyLight: quantizeSkyLight(rawSkyLight),
    rawSkyLight,
    sunVisible: p >= 0.25 && p <= 0.75,
    sunProgress,
    moonVisible: p <= 0.25 || p >= 0.75,
    moonProgress,
  });
}
