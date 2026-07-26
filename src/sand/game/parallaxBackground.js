import { normalizeDayPhase, sampleDayNight } from './dayNightCycle.js';

const PIXEL_SCALE = 4;

const NIGHT = Object.freeze({
  skyTop: '#081226', skyMid: '#19334f', skyGlow: '#38566b', skyLow: '#6f7c78',
  cloudDark: '#96abb4', cloudLight: '#cedde0',
  ridgeFar: '#31485f', ridgeMid: '#263f43', ridgeNear: '#17352f', ridgeDeep: '#11171a',
});
const TWILIGHT = Object.freeze({
  skyTop: '#2f294f', skyMid: '#874b70', skyGlow: '#d66d79', skyLow: '#f3a184',
  cloudDark: '#ad849a', cloudLight: '#e7b5aa',
  ridgeFar: '#685b70', ridgeMid: '#4c4b4f', ridgeNear: '#30433b', ridgeDeep: '#1b1e22',
});
const GOLDEN = Object.freeze({
  skyTop: '#3c6c91', skyMid: '#ba6b59', skyGlow: '#e99a67', skyLow: '#f5d3a0',
  cloudDark: '#bd988c', cloudLight: '#f0caa5',
  ridgeFar: '#776d70', ridgeMid: '#596054', ridgeNear: '#3c5542', ridgeDeep: '#242725',
});
const NOON = Object.freeze({
  skyTop: '#4d90c6', skyMid: '#84bcd2', skyGlow: '#bdd4d3', skyLow: '#e4d8b5',
  cloudDark: '#c9d8dc', cloudLight: '#f4f2e8',
  ridgeFar: '#718d9a', ridgeMid: '#527264', ridgeNear: '#35634f', ridgeDeep: '#222b29',
});
const HORIZON_RATIO = 0.36;
const SURFACE_CAM_Y = -120;
const MAX_VERTICAL_DRIFT_UP = 18;
const MAX_VERTICAL_DRIFT_DOWN = 120;
const CLOUD_CYCLE_TILES = 4;

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
  return clamp((camY - SURFACE_CAM_Y) * 0.55, -MAX_VERTICAL_DRIFT_UP, MAX_VERTICAL_DRIFT_DOWN);
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

function drawStars(ctx, w, horizon, camX, camY, opacity) {
  if (opacity <= 0) return;
  ctx.globalAlpha = opacity;
  const offX = Math.floor(camX * 0.025 - w * 0.5);
  const offY = Math.floor(backgroundDriftY(camY) * 0.2);
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
  ctx.fillRect(px - 3, py - 2, 7, 5);
  ctx.fillRect(px - 2, py - 3, 5, 7);
  if (rays) {
    ctx.fillRect(px - 5, py, 1, 1); ctx.fillRect(px + 5, py, 1, 1);
    ctx.fillRect(px, py - 5, 1, 1); ctx.fillRect(px, py + 5, 1, 1);
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

function drawCelestialBodies(ctx, w, horizon, dayNight) {
  const arcHeight = Math.max(12, horizon * 0.68);
  // The centered site navigation occupies the geometric apex of the sky.
  // Bias the visible arc left so noon/midnight bodies remain unobstructed.
  const orbitX = (t) => w * (0.04 + 0.56 * t);
  if (dayNight.sunVisible) {
    const t = dayNight.sunProgress;
    const x = orbitX(t);
    const y = horizon - Math.sin(Math.PI * t) * arcHeight;
    ctx.globalAlpha = 0.07 + dayNight.daylight * 0.05;
    fillRect(ctx, x - 10, y - 5, 21, 11, '#fff1bd');
    fillRect(ctx, x - 6, y - 8, 13, 17, '#fff1bd');
    ctx.globalAlpha = 1;
    drawPixelOrb(ctx, x, y, '#ffe39a', '#fff1bd', true);
  }
  if (dayNight.moonVisible) {
    const t = dayNight.moonProgress;
    drawPixelMoon(ctx, orbitX(t), horizon - Math.sin(Math.PI * t) * arcHeight);
  }
}

function drawCloud(ctx, x, y, size, color) {
  fillRect(ctx, x, y + size, size * 7, size * 2, color);
  fillRect(ctx, x + size, y, size * 2, size * 4, color);
  fillRect(ctx, x + size * 3, y - size, size * 2, size * 5, color);
  fillRect(ctx, x + size * 5, y + size, size * 2, size * 3, color);
  ctx.globalAlpha = 0.26;
  fillRect(ctx, x + size, y, size * 2, 1, mixColor(color, '#ffffff', 0.44));
  fillRect(ctx, x + size * 3, y - size, size * 2, 1, mixColor(color, '#ffffff', 0.44));
  ctx.globalAlpha = 1;
}

export function cloudCycleOffset(phase, period) {
  return normalizeDayPhase(phase) * period * CLOUD_CYCLE_TILES;
}

function drawCloudLayer(ctx, w, horizon, camX, camY, depth, color, count, period, phase) {
  const drift = cloudCycleOffset(phase, period);
  const offX = camX * depth - w * 0.5 - drift;
  const offY = backgroundDriftY(camY) * depth;
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
      drawCloud(ctx, x, y, size, color);
    }
  }
}

function ridgeY(worldX, base, amp, seed) {
  const broad = Math.pow(Math.abs(Math.sin(worldX * 0.0105 + seed)), 1.7);
  const shoulder = Math.pow(Math.abs(Math.sin(worldX * 0.022 + seed * 1.9)), 1.35);
  const brokenEdge = Math.sin(worldX * 0.063 + seed * 3.1) * amp * 0.12;
  return base + amp * 0.72 - broad * amp * 1.35 - shoulder * amp * 0.48 + brokenEdge;
}

function drawRidge(ctx, w, h, camX, camY, depth, base, amp, color, seed, skyLow, detail = 1) {
  const offX = camX * depth - w * 0.5;
  const offY = backgroundDriftY(camY) * depth;
  const surfaceY = (x) => Math.round(ridgeY(x + offX, base - offY, amp, seed));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 4; x += 4) {
    ctx.lineTo(x, surfaceY(x));
  }
  ctx.lineTo(w + 4, h);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();

  // A narrow crest light separates overlapping silhouettes while preserving
  // the intentionally hard pixel edge.
  ctx.strokeStyle = mixColor(color, skyLow, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w + 4; x += 4) {
    const y = surfaceY(x) + 1;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

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
    const x = Math.round(worldX - offX);
    const y = surfaceY(x) + 5 + Math.floor(rand01(worldX + seed * 211) * (amp * 1.8 + 8));
    const length = 2 + Math.floor(rand01(worldX + seed * 307) * (3 + detail));
    ctx.fillRect(x, y, length, 1);
    if (detail > 1 && rand01(worldX + seed * 401) > 0.6) ctx.fillRect(x + length - 1, y + 1, 1, 2);
  }
  ctx.restore();
  return { offX, offY, surfaceY };
}

function drawSnowCaps(ctx, w, ridge, base, amp, color, daylight) {
  const snowLine = base - ridge.offY + amp * 0.08;
  const snow = mixColor(color, '#f5f5e9', 0.42 + daylight * 0.34);
  const shade = mixColor(snow, color, 0.28);
  for (let x = 0; x <= w + 4; x += 4) {
    const y = ridge.surfaceY(x);
    if (y >= snowLine) continue;
    const depth = Math.max(1, Math.min(7, Math.round((snowLine - y) * 0.42)));
    ctx.fillStyle = snow;
    ctx.fillRect(x, y, 4, depth);
    if (((Math.round(x + ridge.offX) >> 2) & 3) === 0 && depth > 2) {
      ctx.fillStyle = shade;
      ctx.fillRect(x + 3, y + depth - 2, 1, 2);
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

function drawForest(ctx, w, ridge, color, skyLow, seed) {
  const dark = mixColor(color, '#061713', 0.62);
  const light = mixColor(color, skyLow, 0.28);
  const spacing = 11;
  const first = Math.floor((ridge.offX - spacing) / spacing) * spacing;
  for (let worldX = first; worldX < ridge.offX + w + spacing; worldX += spacing) {
    if (rand01(worldX + seed * 613) < 0.25) continue;
    const x = Math.round(worldX - ridge.offX);
    const groundY = ridge.surfaceY(x) + 1;
    const height = 4 + Math.floor(rand01(worldX + seed * 719) * 4);
    drawPine(ctx, x, groundY, height, dark, light);

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = light;
    const textureY = groundY + 3 + Math.floor(rand01(worldX + seed * 811) * 12);
    ctx.fillRect(x - 3, textureY, 2 + Math.floor(rand01(worldX + seed * 907) * 4), 1);
    ctx.globalAlpha = 1;
  }
}

function drawLodge(ctx, x, groundY, variant, light) {
  const width = 9 + variant * 2;
  const left = Math.round(x - width * 0.5);
  const wallTop = groundY - 4;
  const roof = '#211d1d';
  const timber = variant ? '#4a3226' : '#55392a';

  ctx.fillStyle = timber;
  ctx.fillRect(left, wallTop, width, 5);
  ctx.fillStyle = mixColor(timber, '#c49a65', 0.28);
  ctx.fillRect(left + 1, wallTop + 1, width - 2, 1);
  ctx.fillStyle = roof;
  ctx.fillRect(left - 1, wallTop - 2, width + 2, 2);
  ctx.fillRect(left + 1, wallTop - 3, width - 2, 1);
  if (variant) ctx.fillRect(left + 3, wallTop - 4, width - 6, 1);
  ctx.fillRect(left + width - 3, wallTop - 5, 2, 3);

  ctx.fillStyle = '#281d19';
  ctx.fillRect(left + Math.floor(width * 0.5), wallTop + 2, 2, 3);

  const windowX = left + 2;
  if (light > 0) {
    ctx.globalAlpha = 0.12 * light;
    fillRect(ctx, windowX - 2, wallTop - 1, 6, 7, '#ffd36d');
    if (variant) fillRect(ctx, left + width - 5, wallTop - 1, 6, 7, '#ffd36d');
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = light > 0.08 ? mixColor('#806037', '#ffd36d', light) : '#34464b';
  ctx.fillRect(windowX, wallTop + 1, 2, 2);
  if (variant) ctx.fillRect(left + width - 3, wallTop + 1, 2, 2);
  ctx.fillStyle = mixColor(roof, '#d8c8b1', 0.32);
  ctx.globalAlpha = 0.32 + light * 0.28;
  ctx.fillRect(left + width - 2, wallTop - 7, 1, 1);
  ctx.fillRect(left + width - 1, wallTop - 9, 1, 1);
  ctx.fillRect(left + width - 2, wallTop - 11, 2, 1);
  ctx.globalAlpha = 1;
}

function drawLodges(ctx, w, ridge, seed, daylight) {
  const period = 270;
  const first = Math.floor((ridge.offX - period) / period) * period;
  const light = 1 - smooth01((daylight - 0.08) / 0.68);
  for (let tile = first; tile < ridge.offX + w + period; tile += period) {
    const worldX = tile + 52 + Math.floor(rand01(tile + seed * 977) * (period - 104));
    const x = Math.round(worldX - ridge.offX);
    if (x < -16 || x > w + 16) continue;
    const groundY = ridge.surfaceY(x);
    if (Math.abs(ridge.surfaceY(x - 5) - ridge.surfaceY(x + 5)) > 4) continue;
    drawLodge(ctx, x, groundY, rand01(tile + seed * 1217) > 0.58 ? 1 : 0, light);
  }
}

export function createParallaxBackground(container) {
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
    const pxW = Math.max(1, Math.ceil(cssW / PIXEL_SCALE));
    const pxH = Math.max(1, Math.ceil(cssH / PIXEL_SCALE));
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

    // Logical drawing size: scaling it by `s` exactly fills the backing store, so
    // there are never edge gaps (zoom-out draws a larger logical area, shrunk to fit).
    const w = canvas.width / s;
    const h = canvas.height / s;
    ctx.setTransform(s, 0, 0, s, 0, 0);

    const horizon = Math.round(clamp(h * HORIZON_RATIO - backgroundDriftY(qy), -28, h - 36));
    const skyHeight = Math.max(0, horizon);
    const palette = paletteForPhase(dayNight.phase);
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, skyHeight));
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.52, palette.skyMid);
    sky.addColorStop(0.84, palette.skyGlow);
    sky.addColorStop(1, palette.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawDither(ctx, w, h, skyHeight, dayNight.daylight);
    drawStars(ctx, w, skyHeight, qx, qy, dayNight.starOpacity);
    // Celestial bodies belong behind the weather: either cloud layer may pass
    // over and partially occlude the sun or moon as it drifts.
    drawCelestialBodies(ctx, w, skyHeight, dayNight);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.08, palette.cloudDark, 1, 170, dayNight.phase);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.14, palette.cloudLight, 2, 210, dayNight.phase);
    const farRidge = drawRidge(ctx, w, h, qx, qy, 0.18, horizon + 17, 20, palette.ridgeFar, 3.2, palette.skyLow, 2);
    drawSnowCaps(ctx, w, farRidge, horizon + 17, 20, palette.ridgeFar, dayNight.daylight);
    const midRidge = drawRidge(ctx, w, h, qx, qy, 0.34, horizon + 26, 18, palette.ridgeMid, 7.9, palette.skyLow, 3);
    drawLodges(ctx, w, midRidge, 7.9, dayNight.daylight);
    const nearRidge = drawRidge(ctx, w, h, qx, qy, 0.52, horizon + 45, 22, palette.ridgeNear, 12.4, palette.skyLow, 4);
    drawForest(ctx, w, nearRidge, palette.ridgeNear, palette.skyLow, 12.4);
    // Dark backdrop band: pushed low (large base offset) and short (small amp) so
    // it's a subtle distant floor behind caves, not a looming mountain.
    drawRidge(ctx, w, h, qx, qy, 0.70, horizon + 103, 13, palette.ridgeDeep, 18.5, palette.skyLow, 2);
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
