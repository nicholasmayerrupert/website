import { normalizeDayPhase, sampleDayNight } from './dayNightCycle.js';
import {
  BIOME, BIOME_FAMILY, PLANET, PLANET_PRESENTATION,
  PLANET_PRESENTATION_BY_ID,
} from '../wasmBridge/abi.generated.js';
import { resolveBackdropProfile } from './parallaxProfiles.js';

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

function drawCloud(ctx, x, y, size, color, variant) {
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
  ctx.globalAlpha = 0.34;
  fillRect(ctx, x + size * 2, y + size * 3, size * 5, 1, shadow);
  ctx.globalAlpha = 1;
}

export function cloudCycleOffset(phase, period) {
  return normalizeDayPhase(phase) * period * CLOUD_CYCLE_TILES;
}

function drawCloudLayer(ctx, w, horizon, camX, camY, depth, color, count, period, phase, scale) {
  const drift = cloudCycleOffset(phase, period);
  const offX = camX * depth - w * 0.5 - drift;
  const offY = snapScreenPixel(backgroundDriftY(camY) * (1 + depth), scale);
  const start = Math.floor((offX - 40) / period) * period;
  for (let tile = start; tile < offX + w + period; tile += period) {
    for (let i = 0; i < count; i++) {
      // The cloud field repeats after exactly four tiles, matching its travel
      // over a day so midnight joins dawn without a visible position jump.
      const tileIndex = Math.round(tile / period);
      const cycleTile = ((tileIndex % CLOUD_CYCLE_TILES) + CLOUD_CYCLE_TILES) % CLOUD_CYCLE_TILES;
      const seed = cycleTile * 1847 + i * 593;
      const size = 2 + Math.floor(rand01(seed + 2) * 2);
      const x = tile + rand01(seed) * period - offX;
      const y = 10 + rand01(seed + 1) * Math.max(16, horizon * 0.34) - offY;
      drawCloud(ctx, x, y, size, color, rand01(seed + 12));
    }
  }
}

function ridgeY(worldX, base, amp, seed) {
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

function drawRidge(ctx, w, h, camX, camY, depth, base, amp, color, seed, skyLow, detail = 1, scale = 1) {
  const offX = snapScreenPixel(camX * depth - w * 0.5, scale);
  // Round the stable contour before applying the screen-pixel offset. The
  // complete ridge then moves together without reshaping or four-pixel jumps.
  const offY = snapScreenPixel(backgroundDriftY(camY) * (1 + depth), scale);
  const surfaceWorldBaseRawY = (worldX) => ridgeY(worldX, base, amp, seed);
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

  ctx.fillStyle = color;
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
    ctx.fillRect(left.x, left.y + 1, right.x - left.x, 1);
  }

  // Alternating faces give each ridge structure as the camera pans.
  const facetPeriod = 48 + detail * 12;
  const firstFacet = Math.floor((offX - facetPeriod) / facetPeriod) * facetPeriod;
  for (let worldX = firstFacet; worldX < offX + w + facetPeriod; worldX += facetPeriod) {
    const x = worldX - offX;
    const peakY = surfaceY(x);
    const width = facetPeriod * (0.55 + rand01(worldX + seed * 101) * 0.3);
    const facet = ridgeFacetDepths(peakY, base, amp, offY);
    ctx.globalAlpha = 0.13 + detail * 0.025;
    ctx.fillStyle = rand01(worldX + seed * 37) > 0.5 ? '#071116' : '#000000';
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x + width, facet.shoulderY);
    ctx.lineTo(x + width * RIDGE_FACET_FLOOR_X_RATIO, facet.floorY);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = mixColor(color, skyLow, 0.52);
    ctx.beginPath();
    ctx.moveTo(x, peakY + 1);
    ctx.lineTo(x - width * 0.28, peakY + amp * 0.62);
    ctx.lineTo(x + width * 0.12, peakY + amp * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  // Sparse deterministic ledges add texture without animated noise.
  ctx.globalAlpha = 0.16 + detail * 0.025;
  ctx.fillStyle = mixColor(color, skyLow, 0.58);
  const textureStep = Math.max(12, 22 - detail * 2);
  const firstMark = Math.floor((offX - textureStep) / textureStep) * textureStep;
  for (let worldX = firstMark; worldX < offX + w + textureStep; worldX += textureStep) {
    const x = worldX - offX;
    const y = surfaceWorldY(worldX) + 5 + Math.floor(rand01(worldX + seed * 211) * (amp * 1.8 + 8));
    const length = 2 + Math.floor(rand01(worldX + seed * 307) * (3 + detail));
    ctx.fillRect(x, y, length, 1);
    if (detail > 1 && rand01(worldX + seed * 401) > 0.6) ctx.fillRect(x + length - 1, y + 1, 1, 2);
  }
  ctx.restore();
  return {
    offX,
    offY,
    minimumSurfaceY: base - offY - amp * 1.23,
    surfaceRawY,
    surfaceWorldRawY,
    surfaceWorldY,
    surfaceY,
    surfacePoints,
  };
}

function drawSnowCap(ctx, points, snow, snowLine, amp) {
  if (points.length < 4) return;
  const capPoints = points.map((point) => {
    const { rawY, worldX } = point;
    const altitude = clamp((snowLine - rawY) / Math.max(1, amp * 0.7), 0, 1);
    const variation = 0.24 + smoothNoise1D(worldX / 18, 419) * 0.08;
    return {
      ...point,
      depth: Math.round(Math.pow(altitude, 0.72) * amp * variation),
    };
  });

  ctx.fillStyle = snow;
  for (let i = 1; i < capPoints.length; i++) {
    const left = capPoints[i - 1];
    const right = capPoints[i];
    const columns = Math.max(1, Math.round(right.x - left.x));
    for (let column = 0; column < columns; column++) {
      const t = column / columns;
      const x = left.x + column;
      const depth = Math.round(left.depth + (right.depth - left.depth) * t);
      if (depth > 0) ctx.fillRect(x, left.y, 1, depth);
    }
  }
}

function drawSnowCaps(ctx, ridge, base, amp, color, daylight) {
  const snowLine = base - ridge.offY - amp * 0.16;
  const snow = mixColor(color, '#f5f5e9', 0.42 + daylight * 0.34);
  const points = ridge.surfacePoints;

  let previous = points[0];
  let cap = [];
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (point.rawY < snowLine) {
      if (cap.length === 0) cap.push(previous);
      cap.push(point);
    } else if (cap.length) {
      cap.push(point);
      drawSnowCap(ctx, cap, snow, snowLine, amp);
      cap = [];
    }
    previous = point;
  }
  if (cap.length) drawSnowCap(ctx, cap, snow, snowLine, amp);
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

function drawLodgeWindow(ctx, x, y, light) {
  if (light > 0) {
    ctx.globalAlpha = 0.14 * light;
    fillRect(ctx, x - 2, y - 2, 7, 7, '#ffd36d');
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#241b18';
  ctx.fillRect(x - 1, y - 1, 5, 5);
  ctx.fillStyle = light > 0.08 ? mixColor('#7b603f', '#ffd36d', light) : '#769297';
  ctx.fillRect(x, y, 3, 3);
  ctx.fillStyle = '#3b2b21';
  ctx.fillRect(x + 1, y, 1, 3);
  ctx.fillRect(x, y + 1, 3, 1);
}

function drawLodge(ctx, x, platformY, variant, light, ridge, worldX) {
  const width = variant ? 21 : 18;
  const left = Math.round(worldX - width * 0.5) - ridge.offX;
  const wallHeight = variant ? 9 : 8;
  const wallTop = platformY - wallHeight;
  const peakX = left + Math.floor(width * 0.5);
  const peakY = wallTop - 7;
  const roof = '#252323';
  const roofLight = '#514c48';
  const timber = variant ? '#514943' : '#5a5048';
  const timberDark = '#34302d';
  const wallLight = mixColor(timber, '#aaa093', 0.3);

  // A level beam and short stone-and-timber piers seat the lodge on the ridge.
  ctx.fillStyle = '#2a201c';
  ctx.fillRect(left - 2, platformY - 1, width + 4, 2);
  for (const postX of [left + 2, left + width - 4]) {
    const terrainY = ridge.surfaceWorldY(worldX + postX - x) + 2;
    ctx.fillRect(postX, platformY, 2, Math.max(2, terrainY - platformY));
    ctx.fillStyle = '#5e6460';
    ctx.fillRect(postX - 1, Math.max(platformY + 1, terrainY - 1), 4, 2);
    ctx.fillStyle = '#2a201c';
  }

  ctx.fillStyle = timber;
  ctx.fillRect(left, wallTop, width, wallHeight);
  ctx.fillStyle = wallLight;
  for (let y = wallTop + 1; y < platformY - 1; y += 2) ctx.fillRect(left + 1, y, width - 2, 1);

  // Exposed framing and a recessed central door give the facade readable scale.
  ctx.fillStyle = timberDark;
  ctx.fillRect(left, wallTop, 2, wallHeight);
  ctx.fillRect(left + width - 2, wallTop, 2, wallHeight);
  ctx.fillRect(left, wallTop, width, 1);
  ctx.fillRect(left, platformY - 2, width, 2);
  ctx.fillRect(peakX - 1, wallTop, 2, wallHeight);
  ctx.fillRect(peakX - 2, platformY - 6, 4, 6);
  ctx.fillStyle = '#9a7147';
  ctx.fillRect(peakX, platformY - 4, 1, 1);

  drawLodgeWindow(ctx, left + 3, wallTop + 3, light);
  drawLodgeWindow(ctx, left + width - 6, wallTop + 3, light);
  if (variant) {
    ctx.fillStyle = timberDark;
    ctx.fillRect(left + 7, wallTop + 1, 1, wallHeight - 2);
  }

  // The chimney is behind a stepped gable roof, with a brighter windward edge.
  const chimneyX = left + width - 5;
  ctx.fillStyle = '#3b3030';
  ctx.fillRect(chimneyX, wallTop - 8, 3, 7);
  ctx.fillStyle = '#78615a';
  ctx.fillRect(chimneyX - 1, wallTop - 9, 5, 1);
  ctx.fillStyle = roof;
  const roofRows = 7;
  for (let row = 0; row < roofRows; row++) {
    const half = 1 + Math.round(((width + 3) * 0.5) * row / (roofRows - 1));
    ctx.fillRect(peakX - half, peakY + row, half * 2 + 1, 1);
  }
  ctx.fillStyle = roofLight;
  for (let row = 1; row < roofRows - 1; row++) {
    const half = 1 + Math.round(((width + 3) * 0.5) * row / (roofRows - 1));
    ctx.fillRect(peakX - half + 1, peakY + row, Math.min(3, half), 1);
  }
  ctx.fillStyle = '#1b1717';
  ctx.fillRect(left - 2, wallTop - 1, width + 4, 1);

  // Porch rails, a lamp, and a short trail keep the landmark from reading as
  // a single isolated icon.
  ctx.fillStyle = '#3a281f';
  ctx.fillRect(left - 3, platformY - 1, width + 6, 2);
  ctx.fillRect(left - 2, platformY - 4, 1, 4);
  ctx.fillRect(left + width + 1, platformY - 4, 1, 4);
  ctx.fillRect(left - 2, platformY - 4, 5, 1);
  ctx.fillRect(left + width - 3, platformY - 4, 5, 1);
  const lampX = peakX + 3;
  if (light > 0) {
    ctx.globalAlpha = 0.16 * light;
    fillRect(ctx, lampX - 2, platformY - 7, 5, 6, '#ffd36d');
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = light > 0.08 ? mixColor('#705637', '#ffd36d', light) : '#687d80';
  ctx.fillRect(lampX, platformY - 5, 1, 2);

  ctx.fillStyle = '#827765';
  ctx.globalAlpha = 0.44;
  for (let step = 0; step < 4; step++) {
    const trailX = left + width + 4 + step * 3;
    const trailY = ridge.surfaceWorldY(worldX + trailX - x) + 2;
    ctx.fillRect(trailX, trailY, 2, 1);
  }

  const smoke = mixColor('#788182', '#dbe1da', light * 0.38);
  ctx.fillStyle = smoke;
  ctx.globalAlpha = 0.26 + light * 0.26;
  ctx.fillRect(chimneyX + 1, wallTop - 11, 2, 1);
  ctx.fillRect(chimneyX + 3, wallTop - 14, 2, 2);
  ctx.fillRect(chimneyX + 5, wallTop - 17, 3, 1);
  ctx.globalAlpha = 1;
}

function drawLodges(ctx, w, ridge, seed, daylight) {
  const period = 540;
  const first = Math.floor((ridge.offX - period) / period) * period;
  const light = 1 - smooth01((daylight - 0.08) / 0.68);
  for (let tile = first; tile < ridge.offX + w + period; tile += period) {
    const startX = tile + 52 + Math.floor(rand01(tile + seed * 977) * (period - 104));
    let worldX = startX;
    let slope = Infinity;
    for (const shift of [0, -22, 22, -44, 44]) {
      const candidate = startX + shift;
      const ys = [-11, 0, 11].map((dx) => ridge.surfaceWorldRawY(candidate + dx));
      const candidateSlope = Math.max(...ys) - Math.min(...ys);
      if (candidateSlope < slope) {
        slope = candidateSlope;
        worldX = candidate;
      }
    }
    const x = worldX - ridge.offX;
    if (x < -28 || x > w + 28 || slope > 6) continue;
    const platformY = Math.min(
      ridge.surfaceWorldY(worldX - 11),
      ridge.surfaceWorldY(worldX),
      ridge.surfaceWorldY(worldX + 11),
    ) + 6;
    drawLodge(ctx, x, platformY, rand01(tile + seed * 1217) > 0.58 ? 1 : 0, light, ridge, worldX);
  }
}

function paletteForPresentation(presentationProfile, dayNight) {
  if (presentationProfile === PLANET_PRESENTATION.EARTH)
    return paletteForPhase(dayNight.phase);
  if (presentationProfile === PLANET_PRESENTATION.MOON) return MOON_PALETTE;
  if (presentationProfile === PLANET_PRESENTATION.MARS) return MARS_PALETTE;
  return NIGHT;
}

function biomePalette(palette, profile, planet) {
  const tint = {
    grass: '#789467', pine: '#315f4a', cactus: '#b5784b',
    spire: '#77777a', tundra: '#b6ccd1', jungle: '#26704a',
    reeds: '#405d4c',
  }[profile.motif] || palette.ridgeNear;
  const amount = planet.key === 'earth' ? 0.22 : 0.10;
  return {
    ...palette,
    ridgeFar: mixColor(palette.ridgeFar, tint, amount * 0.42),
    ridgeMid: mixColor(palette.ridgeMid, tint, amount * 0.68),
    ridgeNear: mixColor(palette.ridgeNear, tint, amount),
  };
}

export function surfaceRidgeColors(presentationProfile, dayNight, biomeRef) {
  const resolved = resolveBackdropProfile(presentationProfile, biomeRef);
  if (resolved.biome.cave) throw new RangeError('surface biome required');
  const palette = biomePalette(
    paletteForPresentation(presentationProfile, dayNight),
    resolved.biome,
    resolved.planet,
  );
  return [
    palette.ridgeFar, palette.ridgeMid, palette.ridgeNear, palette.ridgeDeep,
  ];
}

function resolvedSurfaceMotif(profile, planet) {
  if (planet.key === 'earth') return profile.motif;
  if (planet.key === 'mars' && profile.motif === 'cactus') return 'cactus';
  return ['pine', 'jungle', 'reeds', 'grass', 'tundra'].includes(profile.motif)
    ? 'spire' : profile.motif;
}

function drawSurfaceMotifs(ctx, w, h, ridge, profile, palette, planet, seed) {
  const motif = resolvedSurfaceMotif(profile, planet);
  const spacing = Math.max(6, Math.round(19 - profile.density * 10));
  const first = Math.floor((ridge.offX - spacing) / spacing) * spacing;
  const dark = mixColor(palette.ridgeNear, '#050b09', 0.62);
  const light = mixColor(palette.ridgeNear, palette.skyLow, 0.34);
  for (let worldX = first; worldX < ridge.offX + w + spacing; worldX += spacing) {
    const roll = rand01(worldX + seed * 613);
    if (roll > profile.density) continue;
    const x = worldX - ridge.offX;
    const ground = ridge.surfaceWorldY(worldX) + 1;
    const height = 3 + Math.floor(rand01(worldX + seed * 991) * 7);
    if (ground - height > h) continue;
    ctx.fillStyle = dark;
    if (motif === 'pine' || motif === 'tundra') {
      drawPine(ctx, x, ground, motif === 'tundra' ? Math.max(4, height - 2) : height, dark, light);
    } else if (motif === 'grass') {
      ctx.fillRect(x, ground - 2, 1, 3);
      ctx.fillRect(x - 1, ground - 1, 1, 1);
      if (roll > 0.42) ctx.fillRect(x + 2, ground - 1, 1, 2);
    } else if (motif === 'cactus') {
      ctx.fillRect(x, ground - height, 2, height + 1);
      const arm = Math.max(2, Math.floor(height * 0.45));
      ctx.fillRect(x - 2, ground - arm, 2, 1);
      ctx.fillRect(x - 2, ground - arm - 2, 1, 3);
      if (height > 6) {
        ctx.fillRect(x + 2, ground - arm - 2, 2, 1);
        ctx.fillRect(x + 3, ground - arm - 3, 1, 2);
      }
      ctx.fillStyle = light;
      ctx.fillRect(x + 1, ground - height + 1, 1, Math.max(1, height - 2));
    } else if (motif === 'spire') {
      for (let row = 0; row < height; row++) {
        const half = Math.floor((height - row) / 4);
        ctx.fillRect(x - half, ground - row, half * 2 + 1, 1);
      }
      ctx.fillStyle = light;
      ctx.fillRect(x, ground - height + 2, 1, Math.max(1, height - 3));
    } else if (motif === 'jungle') {
      ctx.fillRect(x, ground - height, 2, height + 1);
      ctx.fillStyle = light;
      ctx.fillRect(x - 4, ground - height - 2, 9, 3);
      ctx.fillRect(x - 2, ground - height - 4, 6, 3);
      if (roll > 0.45) ctx.fillRect(x + 4, ground - height, 1, 5);
    } else if (motif === 'reeds') {
      const count = 2 + Math.floor(roll * 3);
      for (let i = 0; i < count; i++) {
        const reedH = 2 + ((height + i * 3) % 6);
        ctx.fillRect(x + i * 2, ground - reedH, 1, reedH + 1);
        if (reedH > 4) ctx.fillRect(x + i * 2 + 1, ground - reedH, 1, 1);
      }
    }
  }
}

function drawSurfaceBase(ctx, w, h, args, resolved) {
  const { camX, camY, scale, dayNight, horizon, skyHeight } = args;
  const { planet, biome: profile } = resolved;
  const palette = biomePalette(
    paletteForPresentation(args.presentationProfile, dayNight), profile, planet,
  );
  const altitude = skyAltitudeLayout(camY, h, horizon);
  const sky = ctx.createLinearGradient(
    0, planet.key === 'earth' ? altitude.gradientTop : 0,
    0, Math.max(1, planet.key === 'earth'
      ? altitude.gradientTop + skyHeight : skyHeight),
  );
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(0.55, palette.skyMid);
  sky.addColorStop(0.86, palette.skyGlow);
  sky.addColorStop(1, palette.skyLow);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  drawDither(ctx, w, h, planet.key === 'earth'
    ? Math.min(h, Math.max(0, altitude.gradientBottom)) : skyHeight,
  dayNight.daylight);
  drawStars(ctx, w, skyHeight,
    planet.key === 'moon' ? 0.92 : dayNight.starOpacity * planet.stars,
  planet.key === 'earth' ? { visibleBottom: altitude.starBottom, layoutBottom: h } : null);
  if (planet.key === 'earth') drawCelestialBodies(ctx, w, skyHeight, h, dayNight);
  else if (planet.key === 'moon')
    drawPixelOrb(ctx, w * 0.78, skyHeight * 0.28, '#397db4', '#a9d5e9');
  else if (dayNight.sunVisible) {
    const t = dayNight.sunProgress;
    drawPixelOrb(ctx, w * (0.08 + t * 0.64),
      celestialOrbitY(skyHeight, t, h), '#f3bb76', '#fff0bd', true);
  }
  if (planet.clouds) {
    drawCloudLayer(ctx, w, skyHeight, camX, camY, 0.08,
      palette.cloudDark, 1, 170, dayNight.phase, scale);
    drawCloudLayer(ctx, w, skyHeight, camX, camY, 0.14,
      palette.cloudLight, 2, 210, dayNight.phase, scale);
  }
  const relief = profile.relief * planet.relief;
  const far = drawRidge(ctx, w, h, camX, camY, FAR_RIDGE_DEPTH,
    horizon + 17, 18 * relief, palette.ridgeFar, 3.2,
    palette.skyLow, 2, scale);
  if (profile.snow) drawSnowCaps(ctx, far, horizon + 17, 18 * relief,
    palette.ridgeFar, dayNight.daylight);
  const mid = drawRidge(ctx, w, h, camX, camY, 0.34,
    horizon + 29, 17 * relief, palette.ridgeMid, 7.9,
    palette.skyLow, 3, scale);
  if (profile.landmark && planet.key === 'earth')
    drawLodges(ctx, w, mid, 7.9, dayNight.daylight);
  if (profile.haze) {
    ctx.globalAlpha = profile.haze * 0.12;
    ctx.fillStyle = palette.skyLow;
    ctx.fillRect(0, horizon + 22, w, 3 + profile.haze * 5);
    ctx.globalAlpha = 1;
  }
}

function drawSurfaceNear(ctx, w, h, args, resolved) {
  const { camX, camY, scale, dayNight, horizon } = args;
  const { planet, biome: profile } = resolved;
  const palette = biomePalette(
    paletteForPresentation(args.presentationProfile, dayNight), profile, planet,
  );
  const relief = profile.relief * planet.relief;
  const near = drawRidge(ctx, w, h, camX, camY, 0.52,
    horizon + 47, 21 * relief, palette.ridgeNear, 12.4,
    palette.skyLow, 4, scale);
  if (profile.snow) drawSnowCaps(ctx, near, horizon + 47, 21 * relief,
    palette.ridgeNear, dayNight.daylight);
  drawSurfaceMotifs(ctx, w, h, near, profile, palette, planet, 12.4);
  drawRidge(ctx, w, h, camX, camY, 0.70,
    horizon + 103, 13, palette.ridgeDeep, 18.5,
    palette.skyLow, 2, scale);
}

function drawCaveBand(ctx, w, h, camX, camY, depth, fromTop,
  thickness, amplitude, color, seed, scale) {
  const offX = snapScreenPixel(camX * depth - w * 0.5, scale);
  const offY = snapScreenPixel(backgroundDriftY(camY) * depth * 0.35, scale);
  const contour = (worldX) => {
    const wave = Math.sin(worldX * 0.017 + seed) * 0.42
      + Math.sin(worldX * 0.043 + seed * 1.7) * 0.23
      + (smoothNoise1D(worldX / 36, Math.round(seed * 97)) - 0.5) * 0.7;
    const edge = thickness + wave * amplitude - offY;
    return fromTop ? edge : h - edge;
  };
  const first = Math.floor((offX - RIDGE_SAMPLE_STEP) / RIDGE_SAMPLE_STEP)
    * RIDGE_SAMPLE_STEP;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(first - offX, fromTop ? 0 : h);
  for (let worldX = first; worldX <= offX + w + RIDGE_SAMPLE_STEP;
    worldX += RIDGE_SAMPLE_STEP) {
    const x = worldX - offX;
    const y = Math.round(contour(worldX));
    ctx.lineTo(x, y);
    ctx.lineTo(x + RIDGE_SAMPLE_STEP, y);
  }
  ctx.lineTo(w + RIDGE_SAMPLE_STEP, fromTop ? 0 : h);
  ctx.closePath();
  ctx.fill();
  return { offX, contour };
}

function drawCaveBase(ctx, w, h, args, resolved) {
  const { planet, biome: profile } = resolved;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, mixColor(planet.caveFar, profile.glow, 0.08));
  gradient.addColorStop(0.5, planet.caveRock);
  gradient.addColorStop(1, planet.caveNear);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.14 + profile.density * 0.10;
  ctx.fillStyle = profile.glow;
  ctx.fillRect(0, h * 0.39, w, Math.max(2, h * 0.13));
  ctx.globalAlpha = 1;
  drawCaveBand(ctx, w, h, args.camX, args.camY, 0.16, true,
    h * 0.18, h * 0.09, mixColor(planet.caveFar, profile.glow, 0.22),
    3.7, args.scale);
  drawCaveBand(ctx, w, h, args.camX, args.camY, 0.22, false,
    h * 0.18, h * 0.08, mixColor(planet.caveFar, profile.glow, 0.18),
    8.3, args.scale);
  const landmarkPeriod = 52;
  const landmarkOffset = args.camX * 0.28 - w * 0.5;
  const landmarkFirst = Math.floor((landmarkOffset - landmarkPeriod)
    / landmarkPeriod) * landmarkPeriod;
  ctx.globalAlpha = 0.34;
  for (let worldX = landmarkFirst;
    worldX < landmarkOffset + w + landmarkPeriod; worldX += landmarkPeriod) {
    const x = worldX - landmarkOffset;
    const roll = rand01(worldX + profile.motif.length * 811);
    if (roll > 0.42 + profile.density * 0.48) continue;
    const size = 8 + Math.floor(rand01(worldX + 97) * 10);
    const baseY = h * (0.70 + rand01(worldX + 131) * 0.11);
    ctx.fillStyle = profile.glow;
    if (profile.motif === 'crystal' || profile.motif === 'geode') {
      for (let row = 0; row < size; row++) {
        const half = Math.floor((size - row) / 5);
        ctx.fillRect(x - half, baseY - row, half * 2 + 1, 1);
      }
      ctx.fillStyle = mixColor(profile.glow, '#ffffff', 0.52);
      ctx.fillRect(x, baseY - size + 2, 1, Math.max(2, size - 5));
      if (profile.motif === 'geode') {
        ctx.fillStyle = mixColor(planet.caveRock, profile.glow, 0.48);
        ctx.fillRect(x - size, baseY + 3, size * 2, 2);
      }
    } else if (profile.motif === 'mushroom') {
      ctx.fillStyle = mixColor(profile.glow, '#e5d4c4', 0.55);
      ctx.fillRect(x - 1, baseY - size, 3, size);
      ctx.fillStyle = profile.glow;
      ctx.fillRect(x - size / 2, baseY - size - 4, size + 1, 4);
      ctx.fillRect(x - size / 3, baseY - size - 6, size * 0.66, 2);
    } else if (profile.motif === 'roots') {
      const top = h * 0.17;
      ctx.fillRect(x, top, 2, size + 7);
      ctx.fillRect(x - 4, top + 5, 1, size);
      ctx.fillRect(x + 4, top + 2, 1, size + 3);
    } else if (profile.motif === 'magma') {
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x - size, baseY - 5, size * 2, 7);
      ctx.globalAlpha = 0.58;
      ctx.fillRect(x - size, baseY - 1, size * 2, 2);
      ctx.fillRect(x, baseY - size, 2, size);
    } else if (profile.motif === 'fossil') {
      ctx.fillStyle = mixColor(profile.glow, '#f3e0b9', 0.42);
      ctx.fillRect(x, baseY - size, 2, size);
      for (let rib = 2; rib < size; rib += 3) {
        const reach = Math.min(9, rib);
        ctx.fillRect(x - reach, baseY - size + rib, reach * 2 + 2, 1);
      }
    } else if (profile.motif === 'void') {
      ctx.globalAlpha = 0.52;
      ctx.fillRect(x - 2, h * (0.30 + roll * 0.35), 5, 1);
      ctx.fillRect(x, h * (0.30 + roll * 0.35) - 2, 1, 5);
    } else {
      ctx.fillStyle = mixColor(planet.caveRock, '#aab1b5', 0.24);
      ctx.fillRect(x - size / 2, baseY - 3, size, 3);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = profile.glow;
  for (let x = 3; x < w; x += 17) {
    const y = 8 + Math.floor(rand01(x * 71 + profile.motif.length * 37) * (h - 16));
    if (rand01(x * 113) < profile.density * 0.42) ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function drawCaveNear(ctx, w, h, args, resolved) {
  const { planet, biome: profile } = resolved;
  const ceiling = drawCaveBand(ctx, w, h, args.camX, args.camY, 0.48, true,
    h * 0.11, h * 0.08, mixColor(planet.caveNear, profile.glow, 0.08),
    12.1, args.scale);
  const floor = drawCaveBand(ctx, w, h, args.camX, args.camY, 0.56, false,
    h * 0.13, h * 0.09, mixColor(planet.caveNear, profile.glow, 0.10),
    17.9, args.scale);
  const spacing = Math.max(7, Math.round(18 - profile.density * 9));
  const first = Math.floor((floor.offX - spacing) / spacing) * spacing;
  for (let worldX = first; worldX < floor.offX + w + spacing; worldX += spacing) {
    if (rand01(worldX + profile.motif.length * 401) > profile.density) continue;
    const x = worldX - floor.offX;
    const floorY = Math.round(floor.contour(worldX));
    const ceilingY = Math.round(ceiling.contour(worldX));
    const size = 3 + Math.floor(rand01(worldX * 7 + 19) * 6);
    ctx.fillStyle = profile.glow;
    if (profile.motif === 'crystal' || profile.motif === 'geode') {
      for (let row = 0; row < size; row++) {
        const half = Math.floor((size - row) / 4);
        ctx.fillRect(x - half, floorY - row, half * 2 + 1, 1);
      }
      if (profile.motif === 'geode' && size > 5)
        ctx.fillRect(x + 3, ceilingY, 1, Math.floor(size * 0.7));
    } else if (profile.motif === 'mushroom') {
      ctx.fillStyle = mixColor(profile.glow, '#e9d5c2', 0.52);
      ctx.fillRect(x, floorY - size, 1, size);
      ctx.fillStyle = profile.glow;
      ctx.fillRect(x - 3, floorY - size - 2, 7, 2);
      ctx.fillRect(x - 2, floorY - size - 3, 5, 1);
    } else if (profile.motif === 'roots') {
      ctx.fillRect(x, ceilingY, 1, size + 4);
      ctx.fillRect(x + 1, ceilingY + size, 1, 3);
      if (size > 5) ctx.fillRect(x - 1, ceilingY + 3, 1, size - 2);
    } else if (profile.motif === 'magma') {
      ctx.globalAlpha = 0.24;
      ctx.fillRect(x - 3, floorY - 3, 7, 4);
      ctx.globalAlpha = 1;
      ctx.fillRect(x - 2, floorY - 1, 5, 1);
      ctx.fillRect(x, floorY - size, 1, size);
    } else if (profile.motif === 'fossil') {
      const bone = mixColor(profile.glow, '#f0dfb6', 0.48);
      ctx.fillStyle = bone;
      ctx.fillRect(x, floorY - size, 1, size);
      for (let rib = 1; rib < size; rib += 2)
        ctx.fillRect(x - Math.min(4, rib), floorY - size + rib,
          Math.min(8, rib * 2) + 1, 1);
    } else if (profile.motif === 'void') {
      ctx.globalAlpha = 0.34;
      ctx.fillRect(x - 1, ceilingY + size, 3, 1);
      ctx.fillRect(x, ceilingY + size - 1, 1, 3);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = mixColor(planet.caveRock, '#aab1b5', 0.2);
      ctx.fillRect(x - 2, floorY - 1, 5, 1);
    }
  }
}

const DEFAULT_BIOME_SAMPLE = Object.freeze({
  owner: Object.freeze({ family: BIOME_FAMILY.SURFACE, biome: BIOME.FOREST }),
  neighbor: Object.freeze({ family: BIOME_FAMILY.SURFACE, biome: BIOME.FOREST }),
  blend: 0,
});

function biomeRefKey(ref) {
  return ref.family * 256 + ref.biome;
}

export function neighborDitherSelected(rankIndex, blend, ownerFirst) {
  const rank = (rankIndex + 0.5) / 16;
  return ownerFirst ? rank < blend : rank >= 1 - blend;
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

  const makeLayer = (alpha) => {
    const layerCanvas = document.createElement('canvas');
    const layerCtx = layerCanvas.getContext('2d', { alpha });
    layerCtx.imageSmoothingEnabled = false;
    return { canvas: layerCanvas, ctx: layerCtx };
  };
  const baseA = makeLayer(false);
  const baseB = makeLayer(false);
  const nearA = makeLayer(true);
  const nearB = makeLayer(true);
  const maskA = document.createElement('canvas');
  const maskB = document.createElement('canvas');
  maskA.width = maskA.height = maskB.width = maskB.height = 4;
  const maskACtx = maskA.getContext('2d');
  const maskBCtx = maskB.getContext('2d');
  const maskAImage = maskACtx.createImageData(4, 4);
  const maskBImage = maskBCtx.createImageData(4, 4);
  const maskAPattern = nearA.ctx.createPattern(maskA, 'repeat');
  const maskBPattern = nearB.ctx.createPattern(maskB, 'repeat');
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  let lastKey = '';
  let lastState = null;
  let sampleOverride = null;

  const resize = (width, height) => {
    const cssW = Math.max(1, Math.floor(width));
    const cssH = Math.max(1, Math.floor(height));
    const pxW = Math.max(1, Math.ceil(cssW));
    const pxH = Math.max(1, Math.ceil(cssH));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      for (const layer of [baseA, baseB, nearA, nearB]) {
        layer.canvas.width = pxW;
        layer.canvas.height = pxH;
        layer.ctx.imageSmoothingEnabled = false;
      }
      ctx.imageSmoothingEnabled = false;
      lastKey = '';
    }
  };

  const renderLayer = (layer, args, resolved, near) => {
    const layerCtx = layer.ctx;
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.globalAlpha = 1;
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layerCtx.setTransform(
      PIXEL_SCALE * args.scale, 0, 0, PIXEL_SCALE * args.scale, 0, 0,
    );
    if (presentationProfile === PLANET_PRESENTATION.SHIP) {
      if (!near) {
        layerCtx.fillStyle = '#02040a';
        layerCtx.fillRect(0, 0, args.w, args.h);
        drawStars(layerCtx, args.w, args.h, 1);
        drawPixelOrb(layerCtx, args.w * 0.82, args.h * 0.22,
          '#174a76', '#74b9d7');
      }
      return;
    }
    if (resolved.biome.cave) {
      if (near) drawCaveNear(layerCtx, args.w, args.h, args, resolved);
      else drawCaveBase(layerCtx, args.w, args.h, args, resolved);
    } else if (near) {
      drawSurfaceNear(layerCtx, args.w, args.h, args, resolved);
    } else {
      drawSurfaceBase(layerCtx, args.w, args.h, args, resolved);
    }
  };

  const updateNearMasks = (blend, ownerFirst) => {
    for (let i = 0; i < 16; i++) {
      const neighbor = neighborDitherSelected(bayer[i], blend, ownerFirst);
      const p = i * 4;
      for (const image of [maskAImage, maskBImage]) {
        image.data[p] = 255;
        image.data[p + 1] = 255;
        image.data[p + 2] = 255;
      }
      maskAImage.data[p + 3] = neighbor ? 0 : 255;
      maskBImage.data[p + 3] = neighbor ? 255 : 0;
    }
    maskACtx.putImageData(maskAImage, 0, 0);
    maskBCtx.putImageData(maskBImage, 0, 0);
  };

  const applyNearMask = (layer, pattern, args) => {
    layer.ctx.save();
    layer.ctx.setTransform(
      PIXEL_SCALE * args.scale, 0, 0, PIXEL_SCALE * args.scale, 0, 0,
    );
    layer.ctx.globalCompositeOperation = 'destination-in';
    layer.ctx.fillStyle = pattern;
    layer.ctx.fillRect(0, 0, args.w, args.h);
    layer.ctx.restore();
  };

  // `camX` is the viewport center in absolute world coordinates. Draw into a
  // scale-adjusted logical box so backdrop size and parallax track game zoom while
  // the horizon remains at a fixed screen fraction.
  const draw = ({
    camX = 0,
    camY = 0,
    scale = 1,
    dayNight = sampleDayNight(0),
    biomeSample = DEFAULT_BIOME_SAMPLE,
  } = {}) => {
    if (!canvas.width || !canvas.height) return;
    const s = scale > 0 ? scale : 1;
    const qx = Math.round(camX * 4) / 4;
    const qy = Math.round(camY * 4) / 4;
    const activeSample = sampleOverride || biomeSample || DEFAULT_BIOME_SAMPLE;
    const owner = activeSample.owner || DEFAULT_BIOME_SAMPLE.owner;
    const neighbor = activeSample.neighbor || owner;
    const sameBiome = owner.family === neighbor.family
      && owner.biome === neighbor.biome;
    const blend = sameBiome ? 0 : clamp(Number(activeSample.blend) || 0, 0, 0.5);
    const blendKey = Math.round(blend * 255);
    const key = `${canvas.width}:${canvas.height}:${qx}:${qy}:${s.toFixed(3)}`
      + `:${dayNight.phase}:${owner.family}:${owner.biome}`
      + `:${neighbor.family}:${neighbor.biome}:${blendKey}`;
    if (key === lastKey) return;
    lastKey = key;

    // Logical drawing size: the pixel-art scale plus runtime zoom exactly fills
    // the backing store, so zoom-out cannot expose edge gaps.
    const w = canvas.width / (PIXEL_SCALE * s);
    const h = canvas.height / (PIXEL_SCALE * s);
    const horizon = Math.round(clamp(h * HORIZON_RATIO, -28, h - 36));
    const skyHeight = Math.max(0, horizon);
    const args = {
      camX: qx, camY: qy, scale: s, dayNight,
      presentationProfile, w, h, horizon, skyHeight,
    };
    const resolvedOwner = resolveBackdropProfile(presentationProfile, owner);
    const resolvedNeighbor = blend > 0
      ? resolveBackdropProfile(presentationProfile, neighbor) : resolvedOwner;
    renderLayer(baseA, args, resolvedOwner, false);
    renderLayer(nearA, args, resolvedOwner, true);
    if (blend > 0) {
      renderLayer(baseB, args, resolvedNeighbor, false);
      renderLayer(nearB, args, resolvedNeighbor, true);
      const ownerFirst = biomeRefKey(owner) < biomeRefKey(neighbor);
      updateNearMasks(blend, ownerFirst);
      applyNearMask(nearA, maskAPattern, args);
      applyNearMask(nearB, maskBPattern, args);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(baseA.canvas, 0, 0);
    if (blend > 0) {
      ctx.globalAlpha = blend;
      ctx.drawImage(baseB.canvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(nearA.canvas, 0, 0);
    if (blend > 0) ctx.drawImage(nearB.canvas, 0, 0);
    lastState = {
      owner: { ...owner },
      neighbor: { ...neighbor },
      blend,
      presentationProfile,
    };
  };

  return {
    resize,
    draw,
    getState: () => lastState && structuredClone(lastState),
    setBiomeSampleOverride(sample) {
      sampleOverride = sample || null;
      lastKey = '';
    },
    destroy() {
      canvas.remove();
    },
  };
}
