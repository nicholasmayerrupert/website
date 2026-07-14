import { normalizeDayPhase, sampleDayNight } from './dayNightCycle.js';

const PIXEL_SCALE = 4;

const NIGHT = Object.freeze({
  skyTop: '#111827', skyMid: '#1f3b57', skyLow: '#4a6b72',
  cloudDark: '#b8c7ca', cloudLight: '#e6ece8',
  ridgeFar: '#31455b', ridgeMid: '#263c44', ridgeNear: '#1a2d2f', ridgeDeep: '#14171a',
});
const TWILIGHT = Object.freeze({
  skyTop: '#352b50', skyMid: '#a6536c', skyLow: '#e27d83',
  cloudDark: '#bc8e9d', cloudLight: '#edc4b4',
  ridgeFar: '#6b586c', ridgeMid: '#514651', ridgeNear: '#37383f', ridgeDeep: '#1c1e22',
});
const GOLDEN = Object.freeze({
  skyTop: '#4f7595', skyMid: '#d17a52', skyLow: '#f0a05f',
  cloudDark: '#c5a28e', cloudLight: '#f5d5aa',
  ridgeFar: '#7b6c68', ridgeMid: '#625955', ridgeNear: '#454845', ridgeDeep: '#252525',
});
const NOON = Object.freeze({
  skyTop: '#5d9dca', skyMid: '#8fc2d5', skyLow: '#c8d8c9',
  cloudDark: '#d8dedc', cloudLight: '#f4f2e8',
  ridgeFar: '#738f98', ridgeMid: '#587579', ridgeNear: '#3d5958', ridgeDeep: '#242a2b',
});
const HORIZON_RATIO = 0.36;
const SURFACE_CAM_Y = -120;
const MAX_VERTICAL_DRIFT_UP = 18;
const MAX_VERTICAL_DRIFT_DOWN = 120;

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
    for (let i = 0; i < 34; i++) {
      const seed = tile * 131 + i * 977;
      const x = tile + Math.floor(rand01(seed) * period) - offX;
      const y = Math.floor(rand01(seed + 7) * Math.max(18, horizon * 0.72)) - offY;
      if (x < 0 || x >= w || y < 0 || y >= horizon) continue;
      ctx.fillStyle = rand01(seed + 13) > 0.78 ? '#f9f3c6' : '#d6edf2';
      ctx.fillRect(x, y, 1, 1);
      if (rand01(seed + 31) > 0.93) ctx.fillRect(x + 1, y, 1, 1);
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
    drawPixelOrb(ctx, orbitX(t), horizon - Math.sin(Math.PI * t) * arcHeight, '#ffe39a', '#ffe39a', true);
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
}

function drawCloudLayer(ctx, w, horizon, camX, camY, depth, color, count, period, motionMs) {
  const drift = (motionMs / 1000) * (0.75 + depth * 4.5);
  const offX = camX * depth - w * 0.5 - drift;
  const offY = backgroundDriftY(camY) * depth;
  const start = Math.floor((offX - 40) / period) * period;
  for (let tile = start; tile < offX + w + period; tile += period) {
    for (let i = 0; i < count; i++) {
      const seed = tile * 43 + i * 593;
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

  // `camX` is the absolute world coordinate at the horizontal center of the
  // viewport. Each layer subtracts half its logical width from the parallax
  // offset, keeping that center anchored while zoom changes the visible span.
  // `scale` is the in-game zoom relative to the default (1 = default, >1 = zoomed
  // in). The whole backdrop is drawn into a logical box of size (w/scale, h/scale)
  // and then uniformly scaled to fill the canvas, so the mountains/clouds/stars and
  // the pan rate grow and shrink in lockstep with the simulation — no desync. The
  // horizon stays at a fixed fraction of the screen because it's a ratio of the
  // logical height.
  const draw = ({ camX = 0, camY = 0, scale = 1, dayNight = sampleDayNight(0), dayVisualKey = 0, motionMs = 0 } = {}) => {
    if (!canvas.width || !canvas.height) return;
    const s = scale > 0 ? scale : 1;
    const qx = Math.round(camX * 4) / 4;
    const qy = Math.round(camY * 4) / 4;
    const motionKey = Math.floor(motionMs / 100);
    const key = `${canvas.width}:${canvas.height}:${qx}:${qy}:${s.toFixed(3)}:${dayVisualKey}:${motionKey}`;
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
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.48, palette.skyMid);
    sky.addColorStop(1, palette.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawDither(ctx, w, h, skyHeight, dayNight.daylight);
    drawStars(ctx, w, skyHeight, qx, qy, dayNight.starOpacity);
    // Celestial bodies belong behind the weather: either cloud layer may pass
    // over and partially occlude the sun or moon as it drifts.
    drawCelestialBodies(ctx, w, skyHeight, dayNight);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.08, palette.cloudDark, 1, 170, motionMs);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.14, palette.cloudLight, 2, 210, motionMs);
    drawRidge(ctx, w, h, qx, qy, 0.18, horizon + 9, 13, palette.ridgeFar, 3.2, palette.skyLow, 1);
    drawRidge(ctx, w, h, qx, qy, 0.34, horizon + 24, 17, palette.ridgeMid, 7.9, palette.skyLow, 2);
    drawRidge(ctx, w, h, qx, qy, 0.52, horizon + 43, 21, palette.ridgeNear, 12.4, palette.skyLow, 3);
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
