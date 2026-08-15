import { normalizeDayPhase, sampleDayNight } from './dayNightCycle.js';
import { PLANET } from '../wasmBridge/abi.generated.js';

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
  return Math.min((camY - SURFACE_CAM_Y) * 0.55, MAX_VERTICAL_DRIFT_DOWN);
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

function drawStars(ctx, w, horizon, camX, camY, opacity, scale) {
  if (opacity <= 0) return;
  ctx.globalAlpha = opacity;
  const offX = Math.floor(camX * 0.025 - w * 0.5);
  const offY = snapScreenPixel(backgroundDriftY(camY) * 1.2, scale);
  const period = 240;
  const start = Math.floor((offX - 16) / period) * period;
  for (let tile = start; tile < offX + w + period; tile += period) {
    for (let i = 0; i < 42; i++) {
      const seed = tile * 131 + i * 977;
      const x = tile + Math.floor(rand01(seed) * period) - offX;
      const y = Math.floor(rand01(seed + 7) * Math.max(18, horizon * 0.72)) - offY;
      if (x < 0 || x >= w || y < 0 || y >= horizon) continue;
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

export function celestialOrbitY(horizon, progress) {
  const arcHeight = Math.max(12, horizon * 0.68);
  const belowHorizon = clamp(horizon * 1.05, 68, 96);
  return horizon + belowHorizon
    - Math.sin(Math.PI * clamp(progress, 0, 1)) * (arcHeight + belowHorizon);
}

function drawCelestialBodies(ctx, w, horizon, dayNight, offY) {
  // The centered site navigation occupies the geometric apex of the sky.
  // Bias the visible arc left so noon/midnight bodies remain unobstructed.
  const orbitX = (t) => w * (0.04 + 0.56 * t);
  if (dayNight.sunVisible) {
    const t = dayNight.sunProgress;
    const x = orbitX(t);
    const y = celestialOrbitY(horizon, t) - offY;
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
    drawPixelMoon(ctx, orbitX(t), celestialOrbitY(horizon, t) - offY);
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
    ctx.globalAlpha = 0.13 + detail * 0.025;
    ctx.fillStyle = rand01(worldX + seed * 37) > 0.5 ? '#071116' : '#000000';
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x + width, peakY + amp * 1.5);
    ctx.lineTo(x + width * 0.55, h);
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

function drawForest(ctx, w, h, ridge, color, skyLow, seed) {
  const dark = mixColor(color, '#061713', 0.62);
  const light = mixColor(color, skyLow, 0.28);
  const bandStep = 9;
  const bandCount = Math.ceil(Math.max(0, h - ridge.minimumSurfaceY) / bandStep) + 1;

  for (let band = 0; band < bandCount; band++) {
    const spacing = 11 + (band % 3);
    const stagger = (band * 7) % spacing;
    const first = Math.floor((ridge.offX - stagger - spacing) / spacing) * spacing + stagger;
    for (let worldX = first; worldX < ridge.offX + w + spacing; worldX += spacing) {
      const treeSeed = worldX + seed * 613 + band * 1877;
      if (rand01(treeSeed) < Math.min(0.24, 0.1 + band * 0.006)) continue;
      const x = worldX - ridge.offX;
      const height = 4 + Math.floor(rand01(treeSeed + 106) * 4);
      const groundY = ridge.surfaceWorldY(worldX) + 1 + band * bandStep
        + Math.floor(rand01(treeSeed + 198) * 4);
      if (groundY - height > h || groundY > h + 4) continue;

      ctx.globalAlpha = Math.max(0.58, 1 - band * 0.035);
      drawPine(ctx, x, groundY, height, dark, light);
      if (rand01(treeSeed + 294) > 0.56) {
        ctx.fillStyle = light;
        ctx.fillRect(x - 3, groundY + 2, 2 + Math.floor(rand01(treeSeed + 388) * 4), 1);
      }
    }
  }
  ctx.globalAlpha = 1;
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

export function createParallaxBackground(container, { planetId = PLANET.EARTH } = {}) {
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

  let lastKey = '';

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
  const draw = ({ camX = 0, camY = 0, scale = 1, dayNight = sampleDayNight(0), dayVisualKey = 0 } = {}) => {
    if (!canvas.width || !canvas.height) return;
    const s = scale > 0 ? scale : 1;
    const qx = Math.round(camX * 4) / 4;
    const qy = Math.round(camY * 4) / 4;
    const key = `${canvas.width}:${canvas.height}:${qx}:${qy}:${s.toFixed(3)}:${dayVisualKey}`;
    if (key === lastKey) return;
    lastKey = key;

    // Logical drawing size: the pixel-art scale plus runtime zoom exactly fills
    // the backing store, so zoom-out cannot expose edge gaps.
    const w = canvas.width / (PIXEL_SCALE * s);
    const h = canvas.height / (PIXEL_SCALE * s);
    ctx.setTransform(PIXEL_SCALE * s, 0, 0, PIXEL_SCALE * s, 0, 0);

    // Vertical parallax belongs in each layer's offset. Changing the horizon
    // would regenerate the sky and rescale seeded scenery on every vertical pan.
    const horizon = Math.round(clamp(h * HORIZON_RATIO, -28, h - 36));
    const verticalDrift = snapScreenPixel(backgroundDriftY(qy), s);
    const skyHeight = Math.max(0, horizon);
    if (planetId === PLANET.SHIP) {
      ctx.fillStyle = '#02040a';
      ctx.fillRect(0, 0, w, h);
      drawStars(ctx, w, h, qx, qy, 1, s);
      drawPixelOrb(ctx, w * .82, h * .22 - verticalDrift * .08, '#174a76', '#74b9d7');
      return;
    }
    if (planetId !== PLANET.EARTH) {
      const palette = planetId === PLANET.MOON ? MOON_PALETTE : MARS_PALETTE;
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
        qx,
        qy,
        planetId === PLANET.MOON ? 0.92 : Math.max(0.08, dayNight.starOpacity * 0.55),
        s,
      );
      if (planetId === PLANET.MOON) {
        drawPixelOrb(ctx, w * 0.78, skyHeight * 0.28 - verticalDrift, '#397db4', '#a9d5e9');
      } else if (dayNight.sunVisible) {
        const t = dayNight.sunProgress;
        drawPixelOrb(
          ctx,
          w * (0.08 + t * 0.64),
          celestialOrbitY(skyHeight, t) - verticalDrift,
          '#f3bb76',
          '#fff0bd',
          true,
        );
      }
      drawRidge(ctx, w, h, qx, qy, 0.18, horizon + 18, 17, palette.ridgeFar, 5.1, palette.skyLow, 2, s);
      drawRidge(ctx, w, h, qx, qy, 0.35, horizon + 31, 19, palette.ridgeMid, 9.7, palette.skyLow, 3, s);
      drawRidge(ctx, w, h, qx, qy, 0.53, horizon + 53, 22, palette.ridgeNear, 14.2, palette.skyLow, 4, s);
      drawRidge(ctx, w, h, qx, qy, 0.70, horizon + 105, 13, palette.ridgeDeep, 19.6, palette.skyLow, 2, s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    const palette = paletteForPhase(dayNight.phase);
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, skyHeight));
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.52, palette.skyMid);
    sky.addColorStop(0.84, palette.skyGlow);
    sky.addColorStop(1, palette.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawDither(ctx, w, h, skyHeight, dayNight.daylight);
    drawStars(ctx, w, skyHeight, qx, qy, dayNight.starOpacity, s);
    // Celestial bodies belong behind the weather: either cloud layer may pass
    // over and partially occlude the sun or moon as it drifts.
    drawCelestialBodies(ctx, w, skyHeight, dayNight, verticalDrift);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.08, palette.cloudDark, 1, 170, dayNight.phase, s);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.14, palette.cloudLight, 2, 210, dayNight.phase, s);
    const farRidge = drawRidge(ctx, w, h, qx, qy, 0.18, horizon + 17, 20, palette.ridgeFar, 3.2, palette.skyLow, 2, s);
    drawSnowCaps(ctx, farRidge, horizon + 17, 20, palette.ridgeFar, dayNight.daylight);
    const midRidge = drawRidge(ctx, w, h, qx, qy, 0.34, horizon + 26, 18, palette.ridgeMid, 7.9, palette.skyLow, 3, s);
    drawLodges(ctx, w, midRidge, 7.9, dayNight.daylight);
    const nearRidge = drawRidge(ctx, w, h, qx, qy, 0.52, horizon + 45, 22, palette.ridgeNear, 12.4, palette.skyLow, 4, s);
    drawForest(ctx, w, h, nearRidge, palette.ridgeNear, palette.skyLow, 12.4);
    // Dark backdrop band: pushed low (large base offset) and short (small amp) so
    // it's a subtle distant floor behind caves, not a looming mountain.
    drawRidge(ctx, w, h, qx, qy, 0.70, horizon + 103, 13, palette.ridgeDeep, 18.5, palette.skyLow, 2, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  return {
    resize,
    draw,
    destroy() {
      canvas.remove();
    },
  };
}
