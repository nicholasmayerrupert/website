import { normalizeDayPhase, sampleDayNight } from './dayNightCycle.js';
import { BIOME_BACKGROUND_PROFILES, biomeBackgroundStyle } from './biomeBackground.js';
import {
  DEFAULT_WEATHER_ID,
  applyWeatherToPalette,
  getWeatherProfile,
  resolveWeatherId,
} from './weather.js';
import {
  BIOME, SURFACE_BIOME_COUNT, PLANET, PLANET_PRESENTATION, PLANET_PRESENTATION_BY_ID, WEATHER,
} from '../wasmBridge/abi.generated.js';

const PIXEL_SCALE = 4;

const NIGHT = Object.freeze({
  skyTop: '#071327', skyMid: '#102b47', skyGlow: '#24455e', skyLow: '#3b5970',
  cloudDark: '#71899a', cloudLight: '#a7bac3',
  ridgeFar: '#31485f', ridgeMid: '#263f43', ridgeNear: '#17352f', ridgeDeep: '#11171a',
});
const TWILIGHT = Object.freeze({
  skyTop: '#242849', skyMid: '#5c416b', skyGlow: '#b45f73', skyLow: '#e69a81',
  cloudDark: '#9a7d94', cloudLight: '#d9aaa6',
  ridgeFar: '#685b70', ridgeMid: '#4c4b4f', ridgeNear: '#30433b', ridgeDeep: '#1b1e22',
});
const GOLDEN = Object.freeze({
  skyTop: '#346b99', skyMid: '#7f9cad', skyGlow: '#d99a75', skyLow: '#f1bf89',
  cloudDark: '#af9a91', cloudLight: '#ead0b1',
  ridgeFar: '#776d70', ridgeMid: '#596054', ridgeNear: '#3c5542', ridgeDeep: '#242725',
});
const NOON = Object.freeze({
  skyTop: '#448cc6', skyMid: '#78b7d5', skyGlow: '#add5e1', skyLow: '#d4e8ea',
  cloudDark: '#b8cdd5', cloudLight: '#edf4f2',
  ridgeFar: '#718d9a', ridgeMid: '#527264', ridgeNear: '#35634f', ridgeDeep: '#222b29',
});
const MOON_PALETTE = Object.freeze({
  skyTop: '#03050b', skyMid: '#080d19', skyGlow: '#11192a', skyLow: '#202738',
  ridgeFar: '#555c68', ridgeMid: '#3c424c', ridgeNear: '#292e36', ridgeDeep: '#171a20',
});
const MARS_PALETTE = Object.freeze({
  skyTop: '#351315', skyMid: '#713328', skyGlow: '#b35d3d', skyLow: '#d78b5b',
  ridgeFar: '#8e5543', ridgeMid: '#683b32', ridgeNear: '#4b2d29', ridgeDeep: '#271b1d',
});
const HORIZON_RATIO = 0.36;
export const SURFACE_CAM_Y = -120;
const STAR_FIELD_FRACTION = 0.72;
const BACKGROUND_VERTICAL_PARALLAX = 0.55;
const FAR_RIDGE_DEPTH = 0.18;
const RIDGE_FACET_FLOOR_DEPTH = 3.5;
const RIDGE_FACET_FLOOR_X_RATIO = 0.20;
const MAX_VERTICAL_DRIFT_DOWN = 120;
const CLOUD_CYCLE_TILES = 4;
const RIDGE_SAMPLE_STEP = 4;

function hash(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function rand01(n) {
  return hash(n) / 4294967295;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

// The atmospheric transition shares the far ridge's vertical displacement,
// preserving their separation while the deep sky opens above them.
export function skyAltitudeLayout(camY, height, horizon) {
  const h = Math.max(1, height);
  const surfaceStarBottom = clamp(
    Math.max(18, horizon * STAR_FIELD_FRACTION), 0, h,
  );
  const farRidgeShift = -backgroundDriftY(camY) * (1 + FAR_RIDGE_DEPTH);
  return {
    surfaceStarBottom,
    starBottom: clamp(surfaceStarBottom + farRidgeShift, 0, h),
    gradientTop: farRidgeShift,
    gradientBottom: farRidgeShift + horizon,
  };
}

function smoothNoise1D(value, seed) {
  const cell = Math.floor(value);
  const t = smooth01(value - cell);
  const a = rand01(cell + seed);
  const b = rand01(cell + seed + 1);
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const av = Number.parseInt(a.slice(1), 16);
  const bv = Number.parseInt(b.slice(1), 16);
  const channel = (shift) => Math.round(((av >> shift) & 255) + (((bv >> shift) & 255) - ((av >> shift) & 255)) * t);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

function mixPalette(a, b, t) {
  const out = {};
  for (const key of Object.keys(NIGHT)) out[key] = mixColor(a[key], b[key], t);
  return out;
}

export function paletteForPhase(phase) {
  const p = normalizeDayPhase(phase);
  if (p < 0.12) return NIGHT;
  if (p < 0.20) return mixPalette(NIGHT, TWILIGHT, smooth01((p - 0.12) / 0.08));
  if (p < 0.30) return mixPalette(TWILIGHT, GOLDEN, smooth01((p - 0.20) / 0.10));
  if (p < 0.38) return mixPalette(GOLDEN, NOON, smooth01((p - 0.30) / 0.08));
  if (p < 0.62) return NOON;
  if (p < 0.72) return mixPalette(NOON, GOLDEN, smooth01((p - 0.62) / 0.10));
  if (p < 0.80) return mixPalette(GOLDEN, TWILIGHT, smooth01((p - 0.72) / 0.08));
  if (p < 0.90) return mixPalette(TWILIGHT, NIGHT, smooth01((p - 0.80) / 0.10));
  return NIGHT;
}

function backgroundDriftY(camY) {
  return Math.min(
    (camY - SURFACE_CAM_Y) * BACKGROUND_VERTICAL_PARALLAX,
    MAX_VERTICAL_DRIFT_DOWN,
  );
}

function snapScreenPixel(value, scale) {
  const pixelsPerUnit = PIXEL_SCALE * Math.max(scale, 0.001);
  return Math.round(value * pixelsPerUnit) / pixelsPerUnit;
}

function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}

function drawDither(ctx, w, h, horizon, daylight) {
  ctx.fillStyle = `rgba(255,255,255,${0.05 - daylight * 0.025})`;
  for (let y = 0; y < horizon; y += 9) {
    const row = Math.floor(y / 9);
    for (let x = (row & 1) * 7; x < w; x += 14) {
      if (((x + row * 11) & 31) < 10) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawStars(ctx, w, horizon, opacity, field = null) {
  if (opacity <= 0) return;
  ctx.globalAlpha = opacity;
  const offX = Math.floor(-w * 0.5);
  const period = 240;
  const naturalBottom = Math.max(18, horizon * STAR_FIELD_FRACTION);
  const layoutBottom = Math.max(naturalBottom, field?.layoutBottom ?? naturalBottom);
  const visibleBottom = clamp(
    field?.visibleBottom ?? naturalBottom, 0, layoutBottom,
  );
  const starCount = Math.max(
    42, Math.ceil(42 * layoutBottom / naturalBottom),
  );
  const start = Math.floor((offX - 16) / period) * period;
  for (let tile = start; tile < offX + w + period; tile += period) {
    for (let i = 0; i < starCount; i++) {
      const seed = tile * 131 + i * 977;
      const x = tile + Math.floor(rand01(seed) * period) - offX;
      const y = Math.floor(rand01(seed + 7) * layoutBottom);
      if (x < 0 || x >= w || y < 0 || y >= visibleBottom) continue;
      const warmth = rand01(seed + 13);
      ctx.fillStyle = warmth > 0.84 ? '#f9e7b7' : warmth < 0.13 ? '#b9dcff' : '#e1f1f3';
      ctx.fillRect(x, y, 1, 1);
      if (rand01(seed + 31) > 0.965) {
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x, y - 1, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
      } else if (rand01(seed + 31) > 0.91) {
        ctx.fillRect(x + 1, y, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawPixelOrb(ctx, x, y, color, detail, rays = false) {
  const px = Math.round(x), py = Math.round(y);
  ctx.fillStyle = color;
  ctx.fillRect(px - 4, py - 3, 9, 7);
  ctx.fillRect(px - 3, py - 4, 7, 9);
  if (rays) {
    ctx.fillRect(px - 7, py, 2, 1); ctx.fillRect(px + 6, py, 2, 1);
    ctx.fillRect(px, py - 7, 1, 2); ctx.fillRect(px, py + 6, 1, 2);
    ctx.fillRect(px - 5, py - 5, 1, 1); ctx.fillRect(px + 5, py - 5, 1, 1);
    ctx.fillRect(px - 5, py + 5, 1, 1); ctx.fillRect(px + 5, py + 5, 1, 1);
    ctx.fillStyle = detail;
    ctx.fillRect(px - 2, py - 2, 5, 5);
  } else {
    ctx.fillStyle = detail;
    ctx.fillRect(px - 1, py - 2, 2, 1);
    ctx.fillRect(px + 1, py + 1, 1, 2);
    ctx.fillRect(px - 2, py + 1, 1, 1);
  }
}

function drawPixelMoon(ctx, x, y) {
  const px = Math.round(x), py = Math.round(y);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#dff4ff';
  ctx.fillRect(px - 6, py - 4, 13, 9);
  ctx.fillRect(px - 4, py - 6, 9, 13);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f4fbff';
  ctx.fillRect(px - 5, py - 3, 11, 7);
  ctx.fillRect(px - 3, py - 5, 7, 11);
  ctx.fillRect(px - 4, py - 4, 9, 9);
  ctx.fillStyle = '#b8cad1';
  ctx.fillRect(px - 2, py - 3, 2, 2);
  ctx.fillRect(px + 2, py, 2, 3);
  ctx.fillRect(px - 3, py + 2, 2, 1);
}

export function celestialOrbitY(horizon, progress, viewportHeight) {
  const arcHeight = Math.max(12, horizon * 0.68);
  const bottom = Math.max(1, viewportHeight);
  const apex = horizon - arcHeight;
  return bottom
    - Math.sin(Math.PI * clamp(progress, 0, 1)) * (bottom - apex);
}

function drawCelestialBodies(ctx, w, horizon, viewportHeight, dayNight) {
  // The centered site navigation occupies the geometric apex of the sky.
  // Bias the visible arc left so noon/midnight bodies remain unobstructed.
  // The screen bottom is the shared rise/set endpoint; terrain occludes that
  // portion of the orbit while the camera remains near the surface.
  const orbitX = (t) => w * (0.04 + 0.56 * t);
  if (dayNight.sunVisible) {
    const t = dayNight.sunProgress;
    const x = orbitX(t);
    const y = celestialOrbitY(horizon, t, viewportHeight);
    const horizonWarmth = 1 - Math.sin(Math.PI * t);
    const outer = mixColor('#ffe39a', '#ffc477', horizonWarmth * 0.48);
    const inner = mixColor('#fff5c9', '#ffe7ad', horizonWarmth * 0.3);
    ctx.globalAlpha = 0.055 + dayNight.daylight * 0.045;
    fillRect(ctx, x - 14, y - 6, 29, 13, outer);
    fillRect(ctx, x - 9, y - 10, 19, 21, outer);
    ctx.globalAlpha = 0.09 + dayNight.daylight * 0.035;
    fillRect(ctx, x - 7, y - 7, 15, 15, inner);
    ctx.globalAlpha = 1;
    drawPixelOrb(ctx, x, y, outer, inner, true);
  }
  if (dayNight.moonVisible) {
    const t = dayNight.moonProgress;
    drawPixelMoon(
      ctx, orbitX(t), celestialOrbitY(horizon, t, viewportHeight),
    );
  }
}

function drawCloud(ctx, x, y, size, color, variant, scale) {
  // Keep the block geometry on its logical grid while the complete cloud moves
  // in backing-store-pixel steps. Returns the cloud's footprint so precipitation
  // can fall from the cloud base instead of the top of the sky.
  const baseAlpha = ctx.globalAlpha;
  const originX = x;
  const originY = y;
  ctx.save();
  ctx.translate(snapScreenPixel(x, scale), snapScreenPixel(y, scale));
  x = 0;
  y = 0;
  const shadow = mixColor(color, '#435566', 0.28);
  const highlight = mixColor(color, '#ffffff', 0.32);
  const wide = variant > 0.48;

  fillRect(ctx, x + size, y + size * 2, size * (wide ? 8 : 7), size * 2, shadow);
  fillRect(ctx, x + size * 2, y + size, size * 2, size * 3, shadow);
  fillRect(ctx, x + size * 4, y, size * 2, size * 4, shadow);
  fillRect(ctx, x + size * 6, y + size, size * 2, size * 3, shadow);

  fillRect(ctx, x, y + size, size * (wide ? 9 : 8), size * 2, color);
  fillRect(ctx, x + size, y, size * 2, size * 3, color);
  fillRect(ctx, x + size * 3, y - size, size * 3, size * 4, color);
  fillRect(ctx, x + size * 6, y, size * 2, size * 3, color);
  if (wide) {
    fillRect(ctx, x + size * 8, y + size * 2, size * 3, size, shadow);
    fillRect(ctx, x + size * 8, y + size, size * 2, size * 2, color);
  } else {
    fillRect(ctx, x - size * 2, y + size * 2, size * 2, size, color);
  }

  fillRect(ctx, x + size, y, size * 2, 1, highlight);
  fillRect(ctx, x + size * 3, y - size, size * 3, 1, highlight);
  fillRect(ctx, x + size * 6, y, size * 2, 1, highlight);
  ctx.globalAlpha = 0.34 * baseAlpha;
  fillRect(ctx, x + size * 2, y + size * 3, size * 5, 1, shadow);
  ctx.restore();
  return wide
    ? { x0: originX + size, x1: originX + size * 11, yBase: originY + size * 3 }
    : { x0: originX - size * 2, x1: originX + size * 8, yBase: originY + size * 3 };
}

export function cloudCycleOffset(phase, period) {
  return normalizeDayPhase(phase) * period * CLOUD_CYCLE_TILES;
}

function drawCloudLayer(ctx, w, horizon, camX, camY, depth, color, count, period, phase, scale, spans = null) {
  const drift = cloudCycleOffset(phase, period);
  const offX = camX * depth - w * 0.5 - drift;
  const offY = snapScreenPixel(backgroundDriftY(camY) * (1 + depth), scale);
  const start = Math.floor((offX - 40) / period) * period;
  const whole = Math.floor(count);
  const fraction = count - whole;
  for (let tile = start; tile < offX + w + period; tile += period) {
    for (let i = 0; i < whole + (fraction > 0.01 ? 1 : 0); i++) {
      // The cloud field repeats after exactly four tiles, matching its travel
      // over a day so midnight joins dawn without a visible position jump.
      const tileIndex = Math.round(tile / period);
      const cycleTile = ((tileIndex % CLOUD_CYCLE_TILES) + CLOUD_CYCLE_TILES) % CLOUD_CYCLE_TILES;
      const seed = cycleTile * 1847 + i * 593;
      const size = 2 + Math.floor(rand01(seed + 2) * 2);
      const x = tile + rand01(seed) * period - offX;
      const y = 10 + rand01(seed + 1) * Math.max(16, horizon * 0.34) - offY;
      // A fractional count fades the newest cloud in place instead of popping.
      ctx.globalAlpha = i < whole ? 1 : fraction;
      const span = drawCloud(ctx, x, y, size, color, rand01(seed + 12), scale);
      ctx.globalAlpha = 1;
      if (spans && (i < whole || fraction > 0.01)) spans.push(span);
    }
  }
}

function weatherVisualFrame(value) {
  if (Number.isFinite(value)) return Math.floor(value);
  const source = String(value);
  let result = 0;
  for (let i = 0; i < source.length; i++) {
    result = Math.imul(result ^ source.charCodeAt(i), 0x45d9f3b);
  }
  return result >>> 0;
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function drawWeatherPrecipitation(ctx, w, h, visualKey, profile, mix, cloudSpans, surfacePts) {
  const precipitation = profile.precipitation;
  if (precipitation?.kind !== 'rain') return;
  const intensity = Math.max(0, Math.min(1, mix));
  if (intensity <= 0.02) return;
  const frame = weatherVisualFrame(visualKey);
  const spacing = Math.max(2, precipitation.spacing);
  const fullCount = Math.max(12, Math.ceil(w / spacing));
  const count = Math.max(1, Math.round(fullCount * intensity));
  // Showers hang under the visible cloud bases and keep falling through the
  // rest of the backdrop; the scenery layers and world terrain painted after
  // this occlude the stream, so drops never appear in front of hills or
  // structures. With no visible cloud footprint there is no rain at all.
  const columns = [];
  let columnsWidth = 0;
  for (const span of cloudSpans ?? []) {
    const width = span.x1 - span.x0;
    if (width < 4 || h - span.yBase < 12) continue;
    columns.push({ ...span, width });
    columnsWidth += width;
  }
  if (columnsWidth <= 0) return;

  // Each drop cycles over one full viewport of travel anchored to its cloud
  // base. Nothing here depends on camera altitude, so vertical pans translate
  // the field rigidly instead of compressing it or reshuffling drop phases
  // into apparent extra speed and density.
  const fallSpan = h;
  ctx.save();
  ctx.beginPath();
  if (surfacePts && surfacePts.length > 1) {
    // Keep only the air above the simulated surface: drops disappear behind
    // the world's own back layer rather than showing through cave openings.
    ctx.moveTo(surfacePts[0].x, surfacePts[0].y);
    for (let i = 1; i < surfacePts.length; i++) {
      ctx.lineTo(surfacePts[i].x, surfacePts[i].y);
    }
    const last = surfacePts[surfacePts.length - 1];
    ctx.lineTo(last.x, -4);
    ctx.lineTo(surfacePts[0].x, -4);
  } else {
    ctx.rect(0, 0, w, h);
  }
  ctx.clip();
  ctx.fillStyle = precipitation.color;
  ctx.globalAlpha = precipitation.opacity * (0.35 + 0.65 * intensity);
  for (let i = 0; i < count; i++) {
    const seed = i * 1597 + 0x2d53;
    const speed = 3 + (hash(seed + 17) % 3);
    const wind = Math.floor(frame * (0.45 + rand01(seed + 23) * 0.25));
    let pick = rand01(seed) * columnsWidth;
    let column = columns[columns.length - 1];
    for (const candidate of columns) {
      if (pick < candidate.width) { column = candidate; break; }
      pick -= candidate.width;
    }
    const drift = (wind % (column.width + 8)) - 4;
    const x = column.x0 + rand01(seed + 31) * column.width + drift;
    const y = column.yBase - 6 + positiveModulo(
      Math.floor(rand01(seed + 7) * fallSpan) + frame * speed, fallSpan,
    );
    ctx.fillRect(x, y, 1, 3);
    ctx.fillRect(x + 1, y + 3, 1, 2);
  }
  ctx.restore();
}

function ridgeY(worldX, base, amp, seed, shape) {
  if (shape === 'dunes') {
    return base + Math.sin(worldX * 0.014 + seed) * amp * 0.8
      + Math.sin(worldX * 0.027 + seed * 2) * amp * 0.2;
  }
  if (shape === 'rolling') {
    return base + Math.sin(worldX * 0.011 + seed) * amp * 0.65
      + Math.sin(worldX * 0.024 + seed * 1.7) * amp * 0.25;
  }
  if (shape === 'crags') {
    const peak = 1 - Math.abs(Math.sin(worldX * 0.025 + seed));
    return base + amp * 0.5 - peak ** 2 * amp * 1.7
      + Math.sin(worldX * 0.071 + seed) * amp * 0.14;
  }
  const broad = Math.pow(Math.abs(Math.sin(worldX * 0.0105 + seed)), 1.7);
  const shoulder = Math.pow(Math.abs(Math.sin(worldX * 0.022 + seed * 1.9)), 1.35);
  const brokenEdge = Math.sin(worldX * 0.063 + seed * 3.1) * amp * 0.12;
  return base + amp * 0.72 - broad * amp * 1.35 - shoulder * amp * 0.48 + brokenEdge;
}

function tracePixelSurface(ctx, points, yOffset = 0) {
  ctx.lineTo(points[0].x, points[0].y + yOffset);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i - 1].y + yOffset);
    ctx.lineTo(points[i].x, points[i].y + yOffset);
  }
}

export function ridgeFacetDepths(peakY, base, amp, offY) {
  const floorY = base + amp * RIDGE_FACET_FLOOR_DEPTH - offY;
  return {
    shoulderY: Math.min(peakY + amp * 1.5, floorY),
    floorY,
  };
}

export function biomeRidgeY(worldX, base, amp, seed, contours) {
  return contours.reduce((height, contour) => height
    + ridgeY(worldX, base - (contour.rise ?? 0), amp * contour.relief, seed, contour.shape) * contour.weight, 0);
}

// Each layer projects the same real biome sequence at its own parallax depth.
// Coordinates, silhouettes, and decorations remain fixed in that layer.
export function createBiomeRidgeSampler(biomeAt, fallback, palette, depth, layer, base, amp, seed) {
  const samples = new Map(), palettes = new Map();
  const colorKey = ['ridgeFar', 'ridgeMid', 'ridgeNear', 'ridgeDeep'][layer];
  return (worldX) => {
    if (samples.has(worldX)) return samples.get(worldX);
    const weights = biomeAt ? biomeAt(worldX / depth) : fallback;
    let height = 0, relief = 0, rise = 0, snow = 0, facets = 0;
    const plants = {};
    weights.forEach((weight, id) => {
      if (weight <= 0) return;
      const profile = BIOME_BACKGROUND_PROFILES[id];
      const localRelief = layer < 3 ? profile.relief[layer] : 0.6;
      const localRise = profile.rise?.[layer] ?? 0;
      height += ridgeY(worldX, base - localRise, amp * localRelief, seed, profile.shape) * weight;
      relief += localRelief * weight;
      rise += localRise * weight;
      snow += profile.snow * weight;
      if (profile.shape === 'crags' || profile.shape === 'alpine') facets += weight;
      plants[profile.plants] = (plants[profile.plants] ?? 0)
        + weight * (profile.plants === 'pine' ? profile.forest : 1);
    });
    const paletteKey = weights.join(':');
    if (!palettes.has(paletteKey)) {
      if (palettes.size >= 512) palettes.delete(palettes.keys().next().value);
      palettes.set(paletteKey, biomeBackgroundStyle(palette, weights).palette);
    }
    const localPalette = palettes.get(paletteKey);
    const sample = { height, base: base - rise, amp: amp * relief, snow, plants, facets,
      grove: 0.3 + 0.7 * smooth01((smoothNoise1D(worldX / 65, 947) - 0.2) / 0.6),
      palette: localPalette, color: localPalette[colorKey], skyLow: localPalette.skyLow };
    if (samples.size >= 4096) samples.delete(samples.keys().next().value);
    samples.set(worldX, sample);
    return sample;
  };
}

function drawRidge(ctx, w, h, camX, camY, depth, base, amp, color, seed, skyLow, detail = 1, scale = 1, sceneryAt = null) {
  const offX = snapScreenPixel(camX * depth - w * 0.5, scale);
  // Round the stable contour before applying the screen-pixel offset. The
  // complete ridge then moves together without reshaping or four-pixel jumps.
  const offY = snapScreenPixel(backgroundDriftY(camY) * (1 + depth), scale);
  const surfaceWorldBaseRawY = (worldX) => sceneryAt
    ? sceneryAt(worldX).height : ridgeY(worldX, base, amp, seed, 'alpine');
  const surfaceWorldRawY = (worldX) => surfaceWorldBaseRawY(worldX) - offY;
  const surfaceWorldY = (worldX) => Math.round(surfaceWorldBaseRawY(worldX)) - offY;
  const surfaceRawY = (x) => surfaceWorldRawY(x + offX);
  const surfaceY = (x) => surfaceWorldY(x + offX);
  const surfacePoints = [];
  const firstWorldX = Math.floor((offX - RIDGE_SAMPLE_STEP) / RIDGE_SAMPLE_STEP) * RIDGE_SAMPLE_STEP;
  const lastWorldX = Math.ceil((offX + w + RIDGE_SAMPLE_STEP) / RIDGE_SAMPLE_STEP) * RIDGE_SAMPLE_STEP;
  for (let worldX = firstWorldX; worldX <= lastWorldX; worldX += RIDGE_SAMPLE_STEP) {
    const rawY = surfaceWorldRawY(worldX);
    surfacePoints.push({
      x: worldX - offX,
      y: surfaceWorldY(worldX),
      rawY,
      worldX,
    });
  }

  if (sceneryAt) {
    const first = surfacePoints[0], last = surfacePoints[surfacePoints.length - 1];
    const gradient = ctx.createLinearGradient(first.x, 0, last.x, 0);
    for (const point of surfacePoints)
      gradient.addColorStop((point.x - first.x) / (last.x - first.x), sceneryAt(point.worldX).color);
    ctx.fillStyle = gradient;
  } else ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(surfacePoints[0].x, h);
  tracePixelSurface(ctx, surfacePoints);
  ctx.lineTo(surfacePoints[surfacePoints.length - 1].x, h);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();

  // A narrow crest light separates overlapping silhouettes while preserving
  // the intentionally hard pixel edge.
  ctx.fillStyle = mixColor(color, skyLow, 0.34);
  for (let i = 1; i < surfacePoints.length; i++) {
    const left = surfacePoints[i - 1];
    const right = surfacePoints[i];
    if (sceneryAt) {
      const local = sceneryAt(left.worldX);
      ctx.fillStyle = mixColor(local.color, local.skyLow, 0.34);
    }
    ctx.fillRect(left.x, left.y + 1, right.x - left.x, 1);
  }

  // Facets run downhill from local peaks and stop within the neighboring slope.
  if (sceneryAt) {
    const step = RIDGE_SAMPLE_STEP;
    const firstPeak = Math.floor((offX - 36) / step) * step;
    for (let wx = firstPeak; wx < offX + w + 36; wx += step) {
      const local = sceneryAt(wx);
      if (local.facets < 0.01) continue;
      const peak = surfaceWorldY(wx);
      if (peak >= surfaceWorldY(wx - step) || peak > surfaceWorldY(wx + step)) continue;
      let end = wx + step;
      while (end < wx + 32 && surfaceWorldY(end + step) >= surfaceWorldY(end)) end += step;
      const bottom = surfaceWorldY(end);
      if (bottom - peak < 3) continue;
      ctx.globalAlpha = 0.14 * Math.min(local.facets, sceneryAt(end).facets);
      ctx.fillStyle = '#11131a';
      ctx.beginPath();
      ctx.moveTo(wx - offX, peak);
      ctx.lineTo(end - offX, bottom + 2);
      ctx.lineTo(wx - offX + (end - wx) * 0.3, bottom + Math.min(8, local.amp * 0.4));
      ctx.closePath();
      ctx.fill();
    }
  } else {
  // Offworld formations carry alternating angular faces.
  const facetPeriod = 48 + detail * 12;
  const firstFacet = Math.floor((offX - facetPeriod) / facetPeriod) * facetPeriod;
  for (let worldX = firstFacet; worldX < offX + w + facetPeriod; worldX += facetPeriod) {
    const x = worldX - offX;
    const peakY = surfaceY(x);
    const width = facetPeriod * (0.55 + rand01(worldX + seed * 101) * 0.3);
    const local = sceneryAt?.(worldX) ?? { base, amp, color, skyLow };
    const facet = ridgeFacetDepths(peakY, local.base, local.amp, offY);
    ctx.globalAlpha = 0.13 + detail * 0.025;
    ctx.fillStyle = rand01(worldX + seed * 37) > 0.5 ? '#071116' : '#000000';
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x + width, facet.shoulderY);
    ctx.lineTo(x + width * RIDGE_FACET_FLOOR_X_RATIO, facet.floorY);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = mixColor(local.color, local.skyLow, 0.52);
    ctx.beginPath();
    ctx.moveTo(x, peakY + 1);
    ctx.lineTo(x - width * 0.28, peakY + local.amp * 0.62);
    ctx.lineTo(x + width * 0.12, peakY + local.amp * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  }

  // Sparse deterministic ledges add texture without animated noise.
  ctx.globalAlpha = 0.16 + detail * 0.025;
  ctx.fillStyle = mixColor(color, skyLow, 0.58);
  const textureStep = Math.max(12, 22 - detail * 2);
  const firstMark = Math.floor((offX - textureStep) / textureStep) * textureStep;
  for (let worldX = firstMark; worldX < offX + w + textureStep; worldX += textureStep) {
    const x = worldX - offX;
    const local = sceneryAt?.(worldX) ?? { amp, color, skyLow };
    ctx.fillStyle = mixColor(local.color, local.skyLow, 0.58);
    const y = surfaceWorldY(worldX) + 5 + Math.floor(rand01(worldX + seed * 211) * (local.amp * 1.8 + 8));
    const length = 2 + Math.floor(rand01(worldX + seed * 307) * (3 + detail));
    ctx.fillRect(x, y, length, 1);
    if (detail > 1 && rand01(worldX + seed * 401) > 0.6) ctx.fillRect(x + length - 1, y + 1, 1, 2);
  }
  ctx.restore();
  return {
    offX,
    offY,
    minimumSurfaceY: Math.min(...surfacePoints.map((point) => point.y)),
    sceneryAt,
    surfaceRawY,
    surfaceWorldRawY,
    surfaceWorldY,
    surfaceY,
    surfacePoints,
  };
}

function drawSnowCaps(ctx, ridge, daylight) {
  const points = ridge.surfacePoints.map((point) => {
    const local = ridge.sceneryAt(point.worldX);
    const snowLine = local.base - ridge.offY - local.amp * 0.16;
    const altitude = clamp((snowLine - point.rawY) / Math.max(1, local.amp * 0.7), 0, 1);
    const variation = 0.24 + smoothNoise1D(point.worldX / 18, 419) * 0.08;
    return { ...point, depth: Math.round(Math.pow(altitude, 0.72) * local.amp * variation * local.snow) };
  });
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1], right = points[i];
    const columns = Math.max(1, Math.round(right.x - left.x));
    for (let column = 0; column < columns; column++) {
      const t = column / columns;
      const depth = Math.round(left.depth + (right.depth - left.depth) * t);
      if (depth <= 0) continue;
      const local = ridge.sceneryAt(left.worldX + column);
      ctx.fillStyle = mixColor(local.color, '#f5f5e9', 0.42 + daylight * 0.34);
      ctx.fillRect(left.x + column, left.y, 1, depth);
    }
  }
}

function drawPine(ctx, x, groundY, height, dark, light) {
  const top = groundY - height;
  ctx.fillStyle = dark;
  ctx.fillRect(x, top, 1, height + 1);
  ctx.fillRect(x - 1, top + 1, 3, 1);
  ctx.fillRect(x - 2, top + 3, 5, 1);
  if (height >= 6) ctx.fillRect(x - 2, top + 5, 5, 1);
  ctx.fillStyle = light;
  ctx.fillRect(x, top + 1, 1, Math.max(1, height - 2));
  ctx.fillRect(x - 1, top + 3, 1, 1);
}

function drawForest(ctx, w, h, ridge, seed) {
  ctx.globalAlpha = 1;
  const bandStep = 9;
  const bandCount = Math.ceil(Math.max(0, h - ridge.minimumSurfaceY) / bandStep) + 1;

  for (let band = 0; band < bandCount; band++) {
    const spacing = 11 + (band % 3);
    const stagger = (band * 7) % spacing;
    const first = Math.floor((ridge.offX - stagger - spacing) / spacing) * spacing + stagger;
    for (let worldX = first; worldX < ridge.offX + w + spacing; worldX += spacing) {
      const treeSeed = worldX + seed * 613 + band * 1877;
      const local = ridge.sceneryAt(worldX);
      if (rand01(treeSeed + 801) >= (local.plants.pine ?? 0) * local.grove) continue;
      if (rand01(treeSeed) < Math.min(0.24, 0.1 + band * 0.006)) continue;
      const x = worldX - ridge.offX;
      const height = 4 + Math.floor(rand01(treeSeed + 106) * 4);
      const groundY = ridge.surfaceWorldY(worldX) + 1 + band * bandStep
        + Math.floor(rand01(treeSeed + 198) * 4);
      if (groundY - height > h || groundY > h + 4) continue;

      const dark = mixColor(local.color, '#061713', 0.62);
      const light = mixColor(local.color, local.skyLow, 0.28);
      drawPine(ctx, x, groundY, height, dark, light);
      if (rand01(treeSeed + 294) > 0.56) {
        ctx.fillStyle = light;
        ctx.fillRect(x - 3, groundY + 2, 2 + Math.floor(rand01(treeSeed + 388) * 4), 1);
      }
    }
  }
}

function drawEyeGrove(ctx, w, h, ridge) {
  ctx.globalAlpha = 1;
  for (let band = 0; band < 3; band++) {
    const spacing = 51 + band * 9;
    const first = Math.floor((ridge.offX - 64) / spacing) * spacing;
    for (let slot = first; slot < ridge.offX + w + 64; slot += spacing) {
      const seed = slot * 7 + band * 1397;
      if (rand01(seed + 801) >= 0.82) continue;
      const wx = slot + Math.floor(rand01(seed + 17) * 29) + band * 13;
      const screenX = wx - ridge.offX;
      const local = ridge.sceneryAt(wx);
      if (rand01(seed + 803) >= (local.plants.eyes ?? 0) * local.grove) continue;
      const palette = local.palette;
      const dark = mixColor(local.color, '#321f32', 0.38 + band * 0.1);
      const white = mixColor(local.color, local.skyLow, 0.23 + band * 0.045);
      const screenY = ridge.surfaceWorldY(wx) + 9 + band * 17
        + Math.floor(rand01(seed + 31) * 19);
      const height = 15 + Math.floor(rand01(seed + 53) * 29);
      if (screenY - height > h || screenY < -12) continue;
      // Rasterize limbs in tree-local pixels, then translate the entire tree
      // by the ridge's screen-pixel offset so branches and eyes move together.
      ctx.save();
      ctx.translate(screenX, screenY);
      const x = 0, y = 0;
      const lean = Math.floor(rand01(seed + 71) * 19) - 9;
      const ry = 3 + Math.floor(rand01(seed + 93) * 5);
      const rx = ry + 1 + Math.floor(rand01(seed + 113) * 5);
      const crownX = x + lean, crownY = y - height;
      const iris = mixColor(palette.ridgeNear,
        rand01(seed + 129) < 0.7 ? '#74bcb1' : '#bf9b78', 0.35);
      const limb = (ax, ay, bx, by, width = 2) => {
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        ctx.fillStyle = dark;
        for (let i = 0; i <= steps; i++) {
          ctx.fillRect(Math.round(ax + (bx - ax) * i / steps),
            Math.round(ay + (by - ay) * i / steps), width, 1);
        }
      };
      const eye = (cx, cy, ex, ey, gaze) => {
        for (let dy = -ey; dy <= ey; dy++) {
          const span = Math.floor(ex * Math.sqrt(1 - (dy / ey) ** 2));
          ctx.fillStyle = dark;
          ctx.fillRect(cx - span, cy + dy, span * 2 + 1, 1);
          if (span > 1 && Math.abs(dy) < ey) {
            ctx.fillStyle = white;
            ctx.fillRect(cx - span + 1, cy + dy, span * 2 - 1, 1);
          }
        }
        ctx.fillStyle = iris;
        ctx.fillRect(cx + gaze - 1, cy - ey + 2, 3, ey * 2 - 3);
        ctx.fillStyle = dark;
        ctx.fillRect(cx + gaze, cy - ey + 2, 1, ey * 2 - 3);
      };
      limb(x, y, x + Math.round(lean * 0.3), y - Math.floor(height * 0.45), 3);
      limb(x + Math.round(lean * 0.3), y - Math.floor(height * 0.45),
        crownX, crownY + ry, 2);
      // Single stalks, asymmetric forks, and clusters share the same rooted silhouette.
      const form = rand01(seed + 151);
      const branches = form < 0.4 ? 0 : form < 0.76 ? 1 : 2;
      for (let branch = 0; branch < branches; branch++) {
        const side = (rand01(seed + 173) < 0.5 ? -1 : 1) * (branch ? -1 : 1);
        const bx = crownX + side * (8 + Math.floor(rand01(seed + 191 + branch) * 9));
        const by = crownY + 8 + Math.floor(rand01(seed + 213 + branch) * 11);
        const br = 3 + Math.floor(rand01(seed + 239 + branch) * 2);
        limb(x + Math.round(lean * 0.4), y - 5, bx, by + br);
        eye(bx, by, br + 2, br, side);
      }
      eye(crownX, crownY, rx, ry, Math.floor(rand01(seed + 263) * 3) - 1);
      if (form > 0.88) {
        const bx = x - Math.sign(lean || 1) * 7;
        limb(x, y, bx, y - 5, 1);
        eye(bx, y - 7, 3, 2, 0);
      }
      ctx.restore();
    }
  }
}

function drawBoneField(ctx, w, h, ridge) {
  ctx.globalAlpha = 1;
  for (let band = 0; band < 2; band++) {
    const spacing = 63 + band * 16;
    const first = Math.floor((ridge.offX - 40) / spacing) * spacing;
    for (let slot = first; slot < ridge.offX + w + 40; slot += spacing) {
      const seed = slot * 13 + band * 1733;
      const wx = slot + Math.floor(rand01(seed + 19) * 27) + band * 21;
      const local = ridge.sceneryAt(wx);
      if (rand01(seed + 803) >= (local.plants.bones ?? 0) * (0.5 + local.grove * 0.5)) continue;
      const height = 15 + Math.floor(rand01(seed + 53) * 9);
      const ground = Math.max(ridge.surfaceWorldY(wx), ridge.surfaceWorldY(wx - 18),
        ridge.surfaceWorldY(wx + 18)) + Math.round(height * 0.45) + band * 20;
      if (ground - height > h || ground < -12) continue;
      const bone = mixColor(local.color, local.skyLow, 0.35 - band * 0.06);
      const worn = mixColor(local.color, local.skyLow, 0.23);
      const shadow = mixColor(local.color, '#312a24', 0.27);
      ctx.save();
      ctx.translate(wx - ridge.offX, ground);
      const form = Math.floor(rand01(seed + 97) * 3);
      const lean = rand01(seed + 137) < 0.5 ? -1 : 1;
      if (form === 0) {
        // Scanline runs give the skull rounded, tilted sockets and a tapered jaw.
        const reach = Math.ceil(height * 0.8);
        const pixel = (dx, dy) => {
          const x = dx + lean * dy * 0.13;
          const ellipse = (x / (height * 0.66)) ** 2 + ((dy - height * 0.53) / (height * 0.47)) ** 2;
          const jaw = dy <= height * 0.28 && Math.abs(x) <= height * 0.33 + dy * 0.2;
          if (ellipse > 1 && !jaw) return 0;
          const socket = ((Math.abs(x) - height * 0.28) / (height * (x < 0 ? 0.16 : 0.14))) ** 2
            + ((dy - height * 0.57 - x * 0.12) / (height * 0.16)) ** 2;
          if (socket < 1) return 2;
          if (dy > height * 0.29 && dy < height * 0.47 && Math.abs(x) < (height * 0.48 - dy) * 0.45) return 2;
          if (dy > height * 0.17 && dy < height * 0.24 && Math.abs(x) < height * 0.28
              && (Math.floor(x) + height * 2) % 3 !== 0) return 2;
          return ellipse > 0.77 || dy < height * 0.25 ? 3 : 1;
        };
        for (let dy = 0; dy <= height; dy++) {
          let start = -reach, kind = pixel(start, dy);
          for (let dx = start + 1; dx <= reach + 1; dx++) {
            const next = dx <= reach ? pixel(dx, dy) : 0;
            if (next === kind) continue;
            if (kind) {
              ctx.fillStyle = kind === 1 ? bone : kind === 2 ? shadow : worn;
              ctx.fillRect(start, -dy + 3, dx - start, 1);
            }
            start = dx; kind = next;
          }
        }
      } else if (form === 1) {
        // A curved spine carries tapering, broken ribs rather than closed hoops.
        ctx.fillStyle = worn;
        for (let dx = -22; dx <= 22; dx++) {
          const top = Math.round(-height * (0.45 + 0.4 * Math.cos(dx / 23)));
          ctx.fillRect(dx, top, 1, 2);
        }
        for (let rib = 0; rib < 6; rib++) {
          const x = -20 + rib * 7;
          const top = Math.round(-height * (0.45 + 0.4 * Math.cos(x / 23)));
          const length = -top - 2 - Math.floor(rand01(seed + rib * 31) * 5);
          ctx.fillStyle = rib % 2 ? worn : bone;
          for (let dy = 0; dy < length; dy++) {
            const bend = Math.round(Math.sin(dy / length * Math.PI * 0.85) * 5);
            ctx.fillRect(x + lean * bend, top + dy, 2, 1);
          }
        }
      } else {
        ctx.fillStyle = worn;
        for (let dy = 0; dy <= height; dy++) {
          const spine = lean * Math.floor(dy / 6);
          ctx.fillRect(spine - 1, -dy, 3, 1);
          if (dy % 5 < 3 && dy < height - 2) {
            const half = 3 + (Math.floor(dy / 5) % 2);
            ctx.fillStyle = bone;
            ctx.fillRect(spine - half, -dy, half * 2 + 1, 1);
            ctx.fillStyle = worn;
          }
        }
      }
      // Broken fragments and a low soil lip seat each fossil on the hillside.
      ctx.fillStyle = local.color;
      ctx.fillRect(-13, 1, 27, 2);
      ctx.fillStyle = worn;
      for (let chip = 0; chip < 3; chip++) {
        const dx = -16 + Math.floor(rand01(seed + chip * 79 + 211) * 31);
        ctx.fillRect(dx, 1 + (chip % 2), 2 + (chip % 2), 1);
      }
      ctx.restore();
    }
  }
}

function drawBiomePlants(ctx, w, h, ridge, kind) {
  ctx.globalAlpha = 1;
  if (kind === 'none') return;
  if (kind === 'eyes') {
    drawEyeGrove(ctx, w, h, ridge);
    return;
  }
  if (kind === 'bones') {
    drawBoneField(ctx, w, h, ridge);
    return;
  }
  const spacing = kind === 'jungle' ? 19 : kind === 'willow' ? 29 : 37;
  const rowSpacing = kind === 'jungle' || kind === 'willow' ? 16 : 23;
  for (let band = 0; band < 3; band++) {
    const first = Math.floor(ridge.offX / spacing) * spacing - spacing;
    for (let wx = first; wx < ridge.offX + w + spacing; wx += spacing) {
      const seed = wx + band * 139;
      const x = wx - ridge.offX + band * 11;
      const local = ridge.sceneryAt(wx + band * 11);
      if (rand01(seed + 801) >= (local.plants[kind] ?? 0) * local.grove) continue;
      const palette = local.palette;
      const dark = mixColor(local.color, '#061713', 0.6);
      const light = mixColor(local.color, local.skyLow, 0.25);
      const y = ridge.surfaceWorldY(wx + band * 11) + 28 + (band - 1) * rowSpacing;
      if (y > h + 30) continue;
      const height = 11 + Math.floor(rand01(seed) * 10);
      ctx.fillStyle = dark;
      if (kind === 'cactus') {
        ctx.fillRect(x, y - height, 3, height);
        ctx.fillRect(x - 5, y - height + 7, 7, 3);
        ctx.fillRect(x - 5, y - height + 3, 2, 5);
        ctx.fillRect(x + 2, y - height + 10, 6, 3);
        ctx.fillRect(x + 6, y - height + 5, 2, 7);
        ctx.fillStyle = light;
        ctx.fillRect(x + 1, y - height + 1, 1, height - 1);
      } else if (kind === 'jungle' || kind === 'willow') {
        const crown = kind === 'jungle' ? 14 : 10;
        const top = y - height - (kind === 'jungle' ? 12 : 0);
        ctx.fillRect(x, top, 3, y - top);
        ctx.fillRect(x - crown, top + 4, crown * 2 + 4, 7);
        ctx.fillRect(x - crown + 4, top, crown * 2 - 4, 6);
        ctx.fillStyle = light;
        ctx.fillRect(x - crown + 5, top + 1, crown, 2);
        ctx.fillStyle = dark;
        for (let dx = -crown + 2; dx < crown; dx += 4) {
          const length = 5 + Math.floor(rand01(seed + dx) * (kind === 'willow' ? 13 : 8));
          ctx.fillRect(x + dx, top + 9, 1, length);
        }
        if (kind === 'willow') {
          ctx.fillStyle = mixColor(palette.ridgeNear, '#789eaa', 0.5);
          ctx.fillRect(x - 10, y + 4, 22, 1);
          ctx.fillRect(x + 4, y + 7, 13, 1);
          ctx.fillStyle = dark;
          ctx.fillRect(x + 12, y - 3, 1, 7);
          ctx.fillRect(x + 15, y - 5, 1, 9);
        }
      } else {
        // Open meadows carry low grasses and occasional broad-crowned trees.
        ctx.fillRect(x, y - 2, 1, 3);
        ctx.fillRect(x + 3, y - 4, 1, 5);
        ctx.fillRect(x + 5, y - 1, 2, 2);
        if (rand01(seed) > 0.8) {
          ctx.fillRect(x + 12, y - 10, 2, 10);
          ctx.fillRect(x + 6, y - 13, 14, 6);
          ctx.fillRect(x + 9, y - 16, 9, 4);
        }
      }
    }
  }
}

const BIOME_WEIGHTS = Array.from({ length: SURFACE_BIOME_COUNT }, (_, id) =>
  Array.from({ length: SURFACE_BIOME_COUNT }, (__, other) => other === id ? 1 : 0));

function drawBiomeScenery(ctx, w, h, qx, qy, horizon, scale, dayNight, weights, biomeAt, cache) {
  const palette = paletteForPhase(dayNight.phase);
  const key = [horizon, ...Object.values(palette), ...(biomeAt ? [] : weights)].join(':');
  if (cache.source !== biomeAt || cache.key !== key) {
    cache.source = biomeAt;
    cache.key = key;
    cache.layers = [];
  }
  const ridge = (depth, base, amp, color, seed, detail, layer) => {
    const sceneryAt = cache.layers[layer] ??= createBiomeRidgeSampler(biomeAt, weights, palette, depth, layer, base, amp, seed);
    return drawRidge(ctx, w, h, qx, qy, depth, base, amp, color, seed,
      palette.skyLow, detail, scale, sceneryAt);
  };
  const far = ridge(FAR_RIDGE_DEPTH, horizon + 17, 20, palette.ridgeFar, 3.2, 2, 0);
  drawSnowCaps(ctx, far, dayNight.daylight);
  ridge(0.34, horizon + 26, 18, palette.ridgeMid, 7.9, 2, 1);
  const near = ridge(0.52, horizon + 45, 22, palette.ridgeNear, 12.4, 3, 2);
  drawForest(ctx, w, h, near, 12.4);
  const kinds = new Set(Object.values(BIOME_BACKGROUND_PROFILES).map((profile) => profile.plants));
  for (const kind of kinds) if (kind !== 'pine' && kind !== 'none')
    drawBiomePlants(ctx, w, h, near, kind);
  ridge(0.70, horizon + 103, 13, palette.ridgeDeep, 18.5, 2, 3);
}

export function createParallaxBackground(container, { planetId = PLANET.EARTH } = {}) {
  const presentationProfile = PLANET_PRESENTATION_BY_ID[planetId];
  if (![PLANET_PRESENTATION.EARTH, PLANET_PRESENTATION.MOON,
    PLANET_PRESENTATION.MARS, PLANET_PRESENTATION.SHIP].includes(presentationProfile)) {
    throw new RangeError(`unsupported planet presentation profile for id ${planetId}`);
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'sand-parallax-bg';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.zIndex = '0';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const sceneryCache = { source: null, key: null, layers: [] };
  let lastKey = '';
  let lastScenery = null;
  let lastPalette = null;

  const resize = (width, height) => {
    const cssW = Math.max(1, Math.floor(width));
    const cssH = Math.max(1, Math.floor(height));
    const pxW = Math.max(1, Math.ceil(cssW));
    const pxH = Math.max(1, Math.ceil(cssH));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      ctx.imageSmoothingEnabled = false;
      lastKey = '';
    }
  };

  // `camX` is the viewport center in absolute world coordinates. Draw into a
  // scale-adjusted logical box so backdrop size and parallax track game zoom while
  // the horizon remains at a fixed screen fraction.
  const draw = ({
    camX = 0,
    camY = 0,
    scale = 1,
    dayNight = sampleDayNight(0),
    dayVisualKey = 0,
    // Simulated-surface sampler (absolute world X -> absolute Y). When absent,
    // rain fills the whole backdrop and only scenery occludes it.
    surfaceYAt = null,
    weatherId = DEFAULT_WEATHER_ID,
    weatherVisualKey = 0,
    // Callers that don't track the auto-cycle mix get the profile's own look.
    weatherMix,
    biomeWeights = null,
    biomeSceneryAt = null,
  } = {}) => {
    if (!canvas.width || !canvas.height) return;
    const s = scale > 0 ? scale : 1;
    const qx = Math.round(camX * 4) / 4;
    const qy = Math.round(camY * 4) / 4;
    const resolvedWeatherId = resolveWeatherId(weatherId);
    const weatherMixBucket = Math.round(
      Math.max(0, Math.min(1, weatherMix
        ?? (resolvedWeatherId === WEATHER.RAIN ? 1 : 0))) * 16,
    );
    const key = [
      canvas.width, canvas.height, qx, qy, s.toFixed(3), dayVisualKey,
      resolvedWeatherId, weatherVisualKey, weatherMixBucket,
      ...(biomeWeights?.map((weight) => Math.round(weight * 1024)) ?? []),
    ].join(':');
    if (key === lastKey && biomeSceneryAt === lastScenery) return;
    lastKey = key;
    lastScenery = biomeSceneryAt;

    // Logical drawing size: the pixel-art scale plus runtime zoom exactly fills
    // the backing store, so zoom-out cannot expose edge gaps.
    const w = canvas.width / (PIXEL_SCALE * s);
    const h = canvas.height / (PIXEL_SCALE * s);
    ctx.setTransform(PIXEL_SCALE * s, 0, 0, PIXEL_SCALE * s, 0, 0);

    // Vertical parallax belongs to the finite scenery layers. Changing the
    // horizon would regenerate the sky and rescale seeded scenery on every pan.
    const horizon = Math.round(clamp(h * HORIZON_RATIO, -28, h - 36));
    const skyHeight = Math.max(0, horizon);
    if (presentationProfile === PLANET_PRESENTATION.SHIP) {
      ctx.fillStyle = '#02040a';
      ctx.fillRect(0, 0, w, h);
      drawStars(ctx, w, h, 1);
      drawPixelOrb(ctx, w * .82, h * .22, '#174a76', '#74b9d7');
      return;
    }
    if (presentationProfile !== PLANET_PRESENTATION.EARTH) {
      const moon = presentationProfile === PLANET_PRESENTATION.MOON;
      const palette = moon ? MOON_PALETTE : MARS_PALETTE;
      lastPalette = palette;
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, skyHeight));
      sky.addColorStop(0, palette.skyTop);
      sky.addColorStop(0.58, palette.skyMid);
      sky.addColorStop(0.86, palette.skyGlow);
      sky.addColorStop(1, palette.skyLow);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      drawDither(ctx, w, h, skyHeight, dayNight.daylight);
      drawStars(
        ctx,
        w,
        skyHeight,
        moon ? 0.92 : Math.max(0.08, dayNight.starOpacity * 0.55),
      );
      if (moon) {
        drawPixelOrb(ctx, w * 0.78, skyHeight * 0.28, '#397db4', '#a9d5e9');
      } else if (dayNight.sunVisible) {
        const t = dayNight.sunProgress;
        drawPixelOrb(
          ctx,
          w * (0.08 + t * 0.64),
          celestialOrbitY(skyHeight, t, h),
          '#f3bb76',
          '#fff0bd',
          true,
        );
      }
      drawRidge(ctx, w, h, qx, qy, FAR_RIDGE_DEPTH, horizon + 18, 17, palette.ridgeFar, 5.1, palette.skyLow, 2, s);
      drawRidge(ctx, w, h, qx, qy, 0.35, horizon + 31, 19, palette.ridgeMid, 9.7, palette.skyLow, 3, s);
      drawRidge(ctx, w, h, qx, qy, 0.53, horizon + 53, 22, palette.ridgeNear, 14.2, palette.skyLow, 4, s);
      drawRidge(ctx, w, h, qx, qy, 0.70, horizon + 105, 13, palette.ridgeDeep, 19.6, palette.skyLow, 2, s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    // The rain profile owns every weather-driven visual; the continuous mix
    // scales its tints, cloud counts, and precipitation so transitions fade.
    const weather = getWeatherProfile(WEATHER.RAIN);
    const mix = weatherMixBucket / 16;
    const biome = biomeBackgroundStyle(paletteForPhase(dayNight.phase), biomeWeights);
    const basePalette = biome.palette;
    lastPalette = basePalette;
    const palette = applyWeatherToPalette(
      basePalette, WEATHER.RAIN, mix,
    );
    const altitude = skyAltitudeLayout(qy, h, horizon);
    const sky = ctx.createLinearGradient(
      0, altitude.gradientTop,
      0, altitude.gradientTop + Math.max(1, skyHeight),
    );
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.52, palette.skyMid);
    sky.addColorStop(0.84, palette.skyGlow);
    sky.addColorStop(1, palette.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawDither(
      ctx, w, h,
      Math.min(h, Math.max(0, altitude.gradientBottom)),
      dayNight.daylight,
    );
    drawStars(ctx, w, skyHeight, dayNight.starOpacity, {
      visibleBottom: altitude.starBottom,
      layoutBottom: h,
    });
    // Celestial bodies belong behind the weather: either cloud layer may pass
    // over and partially occlude the sun or moon as it drifts.
    drawCelestialBodies(ctx, w, skyHeight, h, dayNight);
    const clearCounts = getWeatherProfile(WEATHER.CLEAR).cloudCounts;
    const cloudCount = (layer) => mix <= 0
      ? clearCounts[layer]
      : clearCounts[layer]
        + (weather.cloudCounts[layer] - clearCounts[layer]) * mix;
    // The front (light) layer's footprints anchor the precipitation columns.
    const cloudSpans = mix > 0.02 ? [] : null;
    drawCloudLayer(
      ctx, w, skyHeight, qx, qy, 0.08, palette.cloudDark,
      cloudCount(0), 170, dayNight.phase, s,
    );
    drawCloudLayer(
      ctx, w, skyHeight, qx, qy, 0.14, palette.cloudLight,
      cloudCount(1), 210, dayNight.phase, s, cloudSpans,
    );
    drawBiomeScenery(ctx, w, h, qx, qy, horizon, s, dayNight,
      biomeWeights ?? BIOME_WEIGHTS[BIOME.FOREST], biomeSceneryAt, sceneryCache);
    // Precipitation paints in front of every backdrop layer but clips to the
    // air above the simulated surface, so the world's own layers occlude it.
    const surfacePts = surfaceYAt ? [] : null;
    if (surfacePts) {
      const leftWorldX = Math.round(qx - w * 0.5);
      for (let x = -8; x <= w + 8; x += 8) {
        surfacePts.push({ x, y: surfaceYAt(leftWorldX + x) - qy });
      }
    }
    drawWeatherPrecipitation(
      ctx, w, h, weatherVisualKey, weather, mix, cloudSpans, surfacePts,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  return {
    getPalette: () => lastPalette && { ...lastPalette },
    resize,
    draw,
    destroy() {
      canvas.remove();
    },
  };
}
