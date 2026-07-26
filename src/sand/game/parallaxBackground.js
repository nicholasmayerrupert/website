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

function fract(value) {
  return value - Math.floor(value);
}

function mixColor(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const av = Number.parseInt(a.slice(1), 16);
  const bv = Number.parseInt(b.slice(1), 16);
  const channel = (shift) => Math.round(((av >> shift) & 255) + (((bv >> shift) & 255) - ((av >> shift) & 255)) * t);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

function rgbaColor(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
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

function drawHorizonBloom(ctx, w, horizon, palette, dayNight) {
  if (horizon <= 0) return;
  const spread = Math.max(22, horizon * 0.66);
  const warmth = dayNight.sunVisible
    ? Math.pow(1 - Math.sin(Math.PI * dayNight.sunProgress), 1.6)
    : 0;
  const haze = ctx.createLinearGradient(0, Math.max(0, horizon - spread), 0, horizon + 24);
  haze.addColorStop(0, rgbaColor(palette.skyMid, 0));
  haze.addColorStop(0.58, rgbaColor(palette.skyLow, 0.12 + dayNight.daylight * 0.05));
  haze.addColorStop(0.82, rgbaColor(mixColor(palette.skyLow, '#ffe7bc', warmth * 0.54), 0.34));
  haze.addColorStop(1, rgbaColor(palette.skyLow, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, Math.max(0, horizon - spread), w, spread + 24);
}

function drawSunShafts(ctx, w, horizon, dayNight) {
  if (!dayNight.sunVisible || horizon <= 0) return;
  const progress = dayNight.sunProgress;
  const sunX = orbitX(w, progress);
  const sunY = orbitY(horizon, progress);
  const lowSun = Math.pow(1 - Math.sin(Math.PI * progress), 1.35);
  const strength = (0.018 + lowSun * 0.052) * dayNight.daylight;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, Math.max(0, horizon + 8));
  ctx.clip();
  for (let i = 0; i < 6; i++) {
    const spread = 22 + i * 19;
    const lean = (i - 2.5) * 13;
    ctx.fillStyle = `rgba(255,235,195,${strength * (0.82 - i * 0.07)})`;
    ctx.beginPath();
    ctx.moveTo(sunX - 1, sunY + 1);
    ctx.lineTo(sunX + 2, sunY + 1);
    ctx.lineTo(sunX + lean + spread, horizon + 18);
    ctx.lineTo(sunX + lean - spread * 0.42, horizon + 18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawAurora(ctx, w, horizon, camX, dayNight) {
  const strength = smooth01((dayNight.starOpacity - 0.18) / 0.82);
  if (strength <= 0 || horizon <= 18) return;
  const colors = ['#55e6c1', '#78d9ef', '#ae8cff'];
  const drift = dayNight.phase * Math.PI * 8 + camX * 0.002;
  ctx.save();
  for (let band = 0; band < colors.length; band++) {
    const base = horizon * (0.18 + band * 0.095);
    ctx.strokeStyle = rgbaColor(colors[band], strength * (0.09 - band * 0.014));
    ctx.lineWidth = 5 - band * 0.8;
    ctx.beginPath();
    for (let x = -12; x <= w + 12; x += 7) {
      const y = base
        + Math.sin(x * 0.031 + drift + band * 1.7) * (4 + band)
        + Math.sin(x * 0.071 - drift * 0.37) * 2;
      if (x === -12) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = rgbaColor(mixColor(colors[band], '#ffffff', 0.48), strength * 0.075);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGalacticBand(ctx, w, horizon, camX, camY, opacity) {
  if (opacity <= 0 || horizon <= 12) return;
  const offX = Math.floor(camX * 0.018 - w * 0.5);
  const offY = Math.floor(backgroundDriftY(camY) * 0.12);
  const period = 360;
  const start = Math.floor((offX - period) / period) * period;
  ctx.save();
  for (let tile = start; tile < offX + w + period; tile += period) {
    for (let i = 0; i < 88; i++) {
      const seed = tile * 67 + i * 1291;
      const x = tile + rand01(seed) * period - offX;
      const centerY = horizon * 0.16 + fract((x + offX) / period) * horizon * 0.48 - offY;
      const y = centerY + (rand01(seed + 3) - 0.5) * horizon * 0.23;
      if (x < 0 || x >= w || y < 0 || y >= horizon) continue;
      const closeness = 1 - Math.min(1, Math.abs(y - centerY) / Math.max(1, horizon * 0.12));
      ctx.globalAlpha = opacity * (0.025 + closeness * 0.11);
      ctx.fillStyle = rand01(seed + 9) > 0.7 ? '#d5c7ff' : '#bfeaf1';
      ctx.fillRect(Math.round(x), Math.round(y), rand01(seed + 11) > 0.93 ? 2 : 1, 1);
    }
  }
  ctx.restore();
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
      if (rand01(seed + 31) > 0.93) {
        ctx.globalAlpha = opacity * 0.72;
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
        ctx.globalAlpha = opacity;
      } else if (rand01(seed + 31) > 0.78) {
        ctx.fillRect(x + 1, y, 1, 1);
      }
    }

    const constellationSeed = Math.round(tile / period) * 431;
    const points = [];
    for (let i = 0; i < 5; i++) {
      points.push({
        x: tile + 34 + i * 24 + rand01(constellationSeed + i * 17) * 9 - offX,
        y: 8 + rand01(constellationSeed + i * 29) * Math.max(12, horizon * 0.38) - offY,
      });
    }
    ctx.globalAlpha = opacity * 0.14;
    ctx.strokeStyle = '#c6e7f0';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.globalAlpha = opacity;
  }
  ctx.globalAlpha = 1;
}

function orbitX(w, progress) {
  return w * (0.04 + 0.56 * progress);
}

function orbitY(horizon, progress) {
  const arcHeight = Math.max(12, horizon * 0.68);
  return horizon - Math.sin(Math.PI * progress) * arcHeight;
}

function drawSkyGlow(ctx, w, horizon, dayNight) {
  if (horizon <= 0) return;
  const bodies = [];
  if (dayNight.sunVisible) bodies.push([dayNight.sunProgress, '255,211,126', 0.25]);
  if (dayNight.moonVisible) bodies.push([dayNight.moonProgress, '174,218,239', 0.14]);
  for (const [progress, rgb, alpha] of bodies) {
    const x = orbitX(w, progress);
    const y = orbitY(horizon, progress);
    const radius = Math.max(18, horizon * 0.38);
    const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
    glow.addColorStop(0, `rgba(${rgb},${alpha})`);
    glow.addColorStop(0.38, `rgba(${rgb},${alpha * 0.42})`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    ctx.globalAlpha = alpha * 0.42;
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.lineWidth = 1;
    for (let ring = 10; ring <= 16; ring += 3) {
      ctx.strokeRect(Math.round(x - ring), Math.round(y - ring * 0.62), ring * 2, Math.round(ring * 1.24));
    }
    ctx.globalAlpha = 1;
  }
}

function drawPixelOrb(ctx, x, y, color, detail, rays = false) {
  const px = Math.round(x), py = Math.round(y);
  if (rays) {
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#fff0b2';
    ctx.fillRect(px - 7, py, 15, 1);
    ctx.fillRect(px, py - 7, 1, 15);
    ctx.fillRect(px - 5, py - 5, 2, 2);
    ctx.fillRect(px + 4, py - 5, 2, 2);
    ctx.fillRect(px - 5, py + 4, 2, 2);
    ctx.fillRect(px + 4, py + 4, 2, 2);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = color;
  ctx.fillRect(px - 4, py - 3, 9, 7);
  ctx.fillRect(px - 3, py - 4, 7, 9);
  if (rays) {
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(px - 2, py - 2, 5, 5);
    ctx.fillStyle = '#fff9de';
    ctx.fillRect(px - 1, py - 1, 3, 3);
  } else {
    ctx.fillStyle = detail;
    ctx.fillRect(px - 1, py - 2, 2, 1);
    ctx.fillRect(px + 1, py + 1, 1, 2);
    ctx.fillRect(px - 2, py + 1, 1, 1);
  }
}

function drawPixelMoon(ctx, x, y) {
  const px = Math.round(x), py = Math.round(y);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#dff4ff';
  ctx.fillRect(px - 8, py - 5, 17, 11);
  ctx.fillRect(px - 5, py - 8, 11, 17);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f4fbff';
  ctx.fillRect(px - 6, py - 4, 13, 9);
  ctx.fillRect(px - 4, py - 6, 9, 13);
  ctx.fillRect(px - 5, py - 5, 11, 11);
  ctx.fillStyle = '#b8cad1';
  ctx.fillRect(px - 3, py - 4, 3, 2);
  ctx.fillRect(px + 2, py - 1, 3, 3);
  ctx.fillRect(px - 4, py + 2, 3, 2);
  ctx.fillRect(px, py + 4, 2, 1);
  ctx.fillStyle = '#d8e5e8';
  ctx.fillRect(px + 3, py - 4, 2, 1);
  ctx.fillRect(px - 1, py, 2, 2);
}

function drawCelestialBodies(ctx, w, horizon, dayNight) {
  if (dayNight.sunVisible) {
    const t = dayNight.sunProgress;
    drawPixelOrb(ctx, orbitX(w, t), orbitY(horizon, t), '#ffe39a', '#ffe39a', true);
  }
  if (dayNight.moonVisible) {
    const t = dayNight.moonProgress;
    drawPixelMoon(ctx, orbitX(w, t), orbitY(horizon, t));
  }
}

function drawCloud(ctx, x, y, size, color, highlight, shadow, variant) {
  fillRect(ctx, x + size, y + size * 2, size * 6, size * 2, shadow);
  if (variant > 0.68) fillRect(ctx, x + size * 3, y + size * 3, size * 3, size, shadow);
  fillRect(ctx, x, y + size, size * 7, size * 2, color);
  fillRect(ctx, x + size, y, size * 2, size * 4, color);
  fillRect(ctx, x + size * 3, y - size, size * 2, size * 5, color);
  fillRect(ctx, x + size * 5, y + size, size * 2, size * 3, color);
  if (variant > 0.42) {
    fillRect(ctx, x + size * 2, y - size * 2, size * 2, size * 2, color);
    fillRect(ctx, x + size * 4, y, size * 2, size * 3, color);
  }
  fillRect(ctx, x + size, y, size * 2, size, highlight);
  fillRect(ctx, x + size * 3, y - size, size * 2, size, highlight);
  fillRect(ctx, x + size * 5, y + size, size, size, highlight);
  if (variant > 0.42) fillRect(ctx, x + size * 2, y - size * 2, size * 2, size, highlight);
}

export function cloudCycleOffset(phase, period) {
  return normalizeDayPhase(phase) * period * CLOUD_CYCLE_TILES;
}

function drawCloudLayer(ctx, w, horizon, camX, camY, depth, color, count, period, phase) {
  const drift = cloudCycleOffset(phase, period);
  const offX = camX * depth - w * 0.5 - drift;
  const offY = backgroundDriftY(camY) * depth;
  const highlight = mixColor(color, '#ffffff', 0.22);
  const shadow = mixColor(color, '#17202a', 0.20);
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
      drawCloud(ctx, x, y, size, color, highlight, shadow, rand01(seed + 12));
    }
  }
}

function drawHighCloudLayer(ctx, w, horizon, camX, camY, color, phase) {
  if (horizon <= 8) return;
  const period = 260;
  const drift = cloudCycleOffset(phase, period);
  const offX = camX * 0.04 - w * 0.5 - drift;
  const offY = backgroundDriftY(camY) * 0.05;
  const start = Math.floor((offX - period) / period) * period;
  const cycleColor = mixColor(color, '#ffffff', 0.42);
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = cycleColor;
  for (let tile = start; tile < offX + w + period; tile += period) {
    const tileIndex = Math.round(tile / period);
    const cycleTile = ((tileIndex % CLOUD_CYCLE_TILES) + CLOUD_CYCLE_TILES) % CLOUD_CYCLE_TILES;
    for (let i = 0; i < 2; i++) {
      const seed = cycleTile * 2003 + i * 733;
      const x = Math.round(tile + rand01(seed) * period - offX);
      const y = Math.round(7 + rand01(seed + 1) * Math.max(10, horizon * 0.25) - offY);
      const length = 32 + Math.floor(rand01(seed + 2) * 44);
      ctx.fillRect(x, y, length, 1);
      ctx.fillRect(x + 7, y + 1, Math.floor(length * 0.68), 1);
      ctx.fillRect(x + 18, y + 2, Math.floor(length * 0.32), 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSkyLife(ctx, w, horizon, camX, dayNight, palette) {
  if (horizon <= 12) return;
  const birdOpacity = smooth01((dayNight.daylight - 0.36) / 0.42);
  if (birdOpacity > 0) {
    const period = 280;
    const offX = camX * 0.09 - w * 0.5 - cloudCycleOffset(dayNight.phase, period);
    const start = Math.floor((offX - period) / period) * period;
    ctx.globalAlpha = birdOpacity * 0.48;
    ctx.fillStyle = mixColor(palette.ridgeFar, '#17202a', 0.35);
    for (let tile = start; tile < offX + w + period; tile += period) {
      const tileIndex = Math.round(tile / period);
      const cycleTile = ((tileIndex % CLOUD_CYCLE_TILES) + CLOUD_CYCLE_TILES) % CLOUD_CYCLE_TILES;
      const seed = cycleTile * 1223;
      const flockX = tile + 40 + rand01(seed) * 170 - offX;
      const flockY = 12 + rand01(seed + 1) * Math.max(8, horizon * 0.34);
      for (let bird = 0; bird < 5; bird++) {
        const x = Math.round(flockX + bird * 5);
        const y = Math.round(flockY + Math.abs(bird - 2) * 2 + rand01(seed + bird * 31) * 2);
        ctx.fillRect(x - 1, y, 2, 1);
        ctx.fillRect(x + 1, y - 1, 2, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  const meteorProgress = fract(dayNight.phase * 16);
  if (dayNight.starOpacity > 0.55 && meteorProgress < 0.12) {
    const travel = meteorProgress / 0.12;
    const x = w * (0.16 + travel * 0.54);
    const y = horizon * (0.16 + travel * 0.31);
    ctx.save();
    ctx.globalAlpha = dayNight.starOpacity * (1 - travel) * 0.72;
    ctx.fillStyle = '#e9fbff';
    for (let i = 0; i < 9; i++) ctx.fillRect(Math.round(x - i * 2), Math.round(y - i), Math.max(1, 3 - Math.floor(i / 4)), 1);
    ctx.restore();
  }
}

function drawMistLayer(ctx, w, horizon, camX, camY, color, depth = 0.24, yOffset = 13, alpha = 0.18) {
  const period = 132;
  const offX = camX * depth - w * 0.5;
  const offY = backgroundDriftY(camY) * depth;
  const start = Math.floor((offX - period) / period) * period;
  ctx.fillStyle = mixColor(color, '#ffffff', 0.18);
  ctx.globalAlpha = alpha;
  for (let tile = start; tile < offX + w + period; tile += period) {
    const seed = Math.round(tile / period) * 811;
    const x = Math.round(tile - offX + rand01(seed) * 28);
    const y = Math.round(horizon + yOffset + rand01(seed + 1) * 10 - offY);
    const length = 34 + Math.floor(rand01(seed + 2) * 42);
    ctx.fillRect(x, y, length, 1);
    ctx.fillRect(x + 9, y + 2, Math.max(8, length - 20), 1);
  }
  ctx.globalAlpha = 1;
}

function ridgeY(worldX, base, amp, seed) {
  const broad = Math.pow(Math.abs(Math.sin(worldX * 0.0105 + seed)), 1.7);
  const shoulder = Math.pow(Math.abs(Math.sin(worldX * 0.022 + seed * 1.9)), 1.35);
  const crown = Math.pow(Math.abs(Math.sin(worldX * 0.0042 + seed * 0.73)), 4.2);
  const brokenEdge = Math.sin(worldX * 0.063 + seed * 3.1) * amp * 0.12;
  return base + amp * 0.72 - broad * amp * 1.27 - shoulder * amp * 0.44 - crown * amp * 0.5 + brokenEdge;
}

function drawConifer(ctx, x, baseY, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, baseY - height, 1, height + 2);
  for (let row = 2; row < height; row += 2) {
    const halfWidth = Math.max(1, Math.floor(row * 0.38));
    ctx.fillRect(x - halfWidth, baseY - height + row, halfWidth * 2 + 1, 1);
    if (row + 1 < height) ctx.fillRect(x - Math.max(1, halfWidth - 1), baseY - height + row + 1, Math.max(3, halfWidth * 2 - 1), 1);
  }
}

function drawObservatory(ctx, x, groundY, color, skyLow, starOpacity) {
  const wall = mixColor(color, '#111820', 0.18);
  const shade = mixColor(color, '#070b10', 0.34);
  const edge = mixColor(color, skyLow, 0.5);
  const px = Math.round(x), py = Math.round(groundY);

  ctx.fillStyle = shade;
  ctx.fillRect(px - 13, py - 2, 27, 3);
  ctx.fillRect(px - 10, py - 5, 21, 4);
  ctx.fillStyle = wall;
  ctx.fillRect(px - 9, py - 12, 18, 8);
  ctx.fillRect(px - 12, py - 9, 4, 7);
  ctx.fillRect(px + 8, py - 10, 5, 8);
  ctx.fillRect(px - 5, py - 16, 11, 5);
  ctx.fillRect(px - 3, py - 18, 7, 2);
  ctx.fillRect(px, py - 22, 1, 5);
  ctx.fillRect(px - 2, py - 21, 5, 1);

  ctx.fillStyle = edge;
  ctx.globalAlpha = 0.54;
  ctx.fillRect(px - 9, py - 13, 18, 1);
  ctx.fillRect(px - 5, py - 17, 11, 1);
  ctx.fillRect(px - 12, py - 10, 4, 1);
  ctx.fillRect(px + 8, py - 11, 5, 1);
  ctx.globalAlpha = 1;

  const light = 0.12 + starOpacity * 0.88;
  ctx.globalAlpha = light;
  ctx.fillStyle = '#ffd36f';
  ctx.fillRect(px - 7, py - 9, 2, 2);
  ctx.fillRect(px - 2, py - 9, 2, 2);
  ctx.fillRect(px + 4, py - 9, 2, 2);
  ctx.fillRect(px + 10, py - 7, 1, 2);
  ctx.fillStyle = '#fff2ad';
  ctx.fillRect(px, py - 22, 1, 1);
  ctx.globalAlpha = 1;

  if (starOpacity > 0.12) {
    ctx.save();
    ctx.globalAlpha = starOpacity * 0.14;
    ctx.fillStyle = '#ffe99d';
    ctx.fillRect(px - 6, py - 24, 13, 5);
    ctx.fillRect(px - 2, py - 28, 5, 13);
    ctx.restore();
  }
}

function drawRidge(ctx, w, h, camX, camY, depth, base, amp, color, seed, skyLow, detail = 1, features = {}) {
  const offX = camX * depth - w * 0.5;
  const offY = backgroundDriftY(camY) * depth;
  const effectiveBase = base - offY;
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

  if (features.trees || detail >= 3) {
    const treeColor = mixColor(color, '#071116', 0.28);
    const treeStep = features.trees ? 10 : 15;
    const firstTree = Math.floor((offX - treeStep) / treeStep) * treeStep;
    for (let worldX = firstTree; worldX < offX + w + treeStep; worldX += treeStep) {
      const chance = rand01(worldX + seed * 557);
      if (chance < 0.16) continue;
      const x = Math.round(worldX - offX);
      const baseY = surfaceY(x) + 2;
      const treeHeight = 5 + Math.floor(chance * (features.trees ? 7 : 4));
      drawConifer(ctx, x, baseY, treeHeight, treeColor);
    }
  }

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

  // Alternating faces form broad lit and shadowed planes across the range.
  const facetPeriod = 48 + detail * 12;
  const firstFacet = Math.floor((offX - facetPeriod) / facetPeriod) * facetPeriod;
  for (let worldX = firstFacet; worldX < offX + w + facetPeriod; worldX += facetPeriod) {
    const x = worldX - offX;
    const peakY = surfaceY(x);
    const width = facetPeriod * (0.55 + rand01(worldX + seed * 101) * 0.3);
    const lightFromLeft = (features.lightX ?? w * 0.28) < x;
    ctx.globalAlpha = 0.14 + detail * 0.026;
    ctx.fillStyle = '#03070a';
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x + (lightFromLeft ? width : -width), peakY + amp * 1.5);
    ctx.lineTo(x + (lightFromLeft ? width * 0.55 : -width * 0.55), h);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.2;
    ctx.fillStyle = mixColor(color, skyLow, 0.52);
    ctx.beginPath();
    ctx.moveTo(x, peakY + 1);
    ctx.lineTo(x + (lightFromLeft ? -width * 0.34 : width * 0.34), peakY + amp * 0.68);
    ctx.lineTo(x + (lightFromLeft ? width * 0.1 : -width * 0.1), peakY + amp * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  if (features.snow) {
    const capColor = mixColor(skyLow, '#fff9e7', 0.46 + (features.daylight ?? 0) * 0.25);
    const shadeColor = mixColor(capColor, color, 0.36);
    let prevY = surfaceY(0);
    let x = 4, y = surfaceY(4);
    for (let nextX = 8; nextX <= w + 4; nextX += 4) {
      const nextY = surfaceY(nextX);
      if (y <= prevY && y < nextY && effectiveBase - y > amp * 0.34 && rand01(Math.round(x + offX) + seed * 719) < features.snow) {
        const width = 6 + Math.floor(rand01(Math.round(x + offX) + seed * 883) * 7);
        ctx.globalAlpha = 0.66 + (features.daylight ?? 0) * 0.2;
        ctx.fillStyle = shadeColor;
        ctx.beginPath();
        ctx.moveTo(x - width, y + width * 0.78);
        ctx.lineTo(x - width * 0.35, y + 3);
        ctx.lineTo(x, y);
        ctx.lineTo(x + width * 0.42, y + 4);
        ctx.lineTo(x + width, y + width * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = capColor;
        ctx.beginPath();
        ctx.moveTo(x - width * 0.62, y + width * 0.48);
        ctx.lineTo(x - width * 0.22, y + 3);
        ctx.lineTo(x, y);
        ctx.lineTo(x + width * 0.18, y + 3);
        ctx.lineTo(x + width * 0.38, y + 2);
        ctx.lineTo(x + width * 0.56, y + width * 0.46);
        ctx.closePath();
        ctx.fill();
      }
      prevY = y;
      x = nextX;
      y = nextY;
    }
  }

  if (features.waterfalls) {
    const period = 176;
    const firstFall = Math.floor((offX - period) / period) * period;
    for (let worldX = firstFall; worldX < offX + w + period; worldX += period) {
      if (rand01(worldX + seed * 977) < 0.42) continue;
      const x = Math.round(worldX + 43 + rand01(worldX + seed * 991) * 48 - offX);
      const startY = surfaceY(x) + 5;
      const length = Math.max(10, Math.floor(amp * (0.72 + rand01(worldX + seed * 1013) * 0.64)));
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#071116';
      ctx.fillRect(x - 1, startY - 1, 3, length + 3);
      ctx.globalAlpha = 0.34 + (features.daylight ?? 0) * 0.34;
      ctx.fillStyle = mixColor(skyLow, '#d5fbff', 0.58);
      ctx.fillRect(x, startY, 1, length);
      if (length > 18) ctx.fillRect(x + 1, startY + Math.floor(length * 0.58), 1, Math.floor(length * 0.33));
      ctx.globalAlpha = 0.2;
      ctx.fillRect(x - 3, startY + length, 7, 1);
    }
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

  if (features.lights && (features.starOpacity ?? 0) > 0.08) {
    const period = 74;
    const firstLight = Math.floor((offX - period) / period) * period;
    ctx.globalAlpha = (features.starOpacity ?? 0) * 0.78;
    for (let worldX = firstLight; worldX < offX + w + period; worldX += period) {
      const x = Math.round(worldX + 19 + rand01(worldX + seed * 1103) * 34 - offX);
      const y = surfaceY(x) - 2 - Math.floor(rand01(worldX + seed * 1117) * 6);
      ctx.fillStyle = rand01(worldX + seed * 1129) > 0.52 ? '#ffd36f' : '#9ef0c9';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  if (features.landmark && w >= 120) {
    const period = 760;
    const firstLandmark = Math.floor((offX - period) / period) * period;
    for (let tile = firstLandmark; tile < offX + w + period; tile += period) {
      const worldX = tile + 52;
      const x = worldX - offX;
      if (x < -18 || x > w + 18) continue;
      drawObservatory(ctx, x, surfaceY(x) + 1, color, skyLow, features.starOpacity ?? 0);
    }
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
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.34, mixColor(palette.skyTop, palette.skyMid, 0.62));
    sky.addColorStop(0.66, palette.skyMid);
    sky.addColorStop(1, palette.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawHorizonBloom(ctx, w, skyHeight, palette, dayNight);
    drawSunShafts(ctx, w, skyHeight, dayNight);
    drawAurora(ctx, w, skyHeight, qx, dayNight);
    drawGalacticBand(ctx, w, skyHeight, qx, qy, dayNight.starOpacity);
    drawSkyGlow(ctx, w, skyHeight, dayNight);
    drawDither(ctx, w, h, skyHeight, dayNight.daylight);
    drawSkyLife(ctx, w, skyHeight, qx, dayNight, palette);
    drawStars(ctx, w, skyHeight, qx, qy, dayNight.starOpacity);
    // Celestial bodies belong behind the weather: either cloud layer may pass
    // over and partially occlude the sun or moon as it drifts.
    drawCelestialBodies(ctx, w, skyHeight, dayNight);
    drawHighCloudLayer(ctx, w, skyHeight, qx, qy, palette.cloudLight, dayNight.phase);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.08, palette.cloudDark, 1, 170, dayNight.phase);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.14, palette.cloudLight, 2, 210, dayNight.phase);
    const lightProgress = dayNight.sunVisible ? dayNight.sunProgress : dayNight.moonProgress;
    const lightX = orbitX(w, lightProgress);
    const commonFeatures = {
      daylight: dayNight.daylight,
      starOpacity: dayNight.starOpacity,
      lightX,
    };
    drawRidge(ctx, w, h, qx, qy, 0.16, horizon + 14, 28, palette.ridgeFar, 3.2, palette.skyLow, 1, {
      ...commonFeatures,
      snow: 0.92,
      landmark: true,
    });
    drawMistLayer(ctx, w, horizon, qx, qy, palette.skyLow, 0.24, 16, 0.24);
    drawRidge(ctx, w, h, qx, qy, 0.32, horizon + 36, 32, palette.ridgeMid, 7.9, palette.skyLow, 2, {
      ...commonFeatures,
      snow: 0.36,
      waterfalls: true,
    });
    drawMistLayer(ctx, w, horizon, qx, qy, palette.cloudLight, 0.42, 43, 0.13);
    drawRidge(ctx, w, h, qx, qy, 0.52, horizon + 67, 36, palette.ridgeNear, 12.4, palette.skyLow, 3, {
      ...commonFeatures,
      trees: true,
      lights: true,
    });
    // Dark backdrop band: pushed low (large base offset) and short (small amp) so
    // it's a subtle distant floor behind caves, not a looming mountain.
    drawRidge(ctx, w, h, qx, qy, 0.72, horizon + 118, 16, palette.ridgeDeep, 18.5, palette.skyLow, 2, commonFeatures);
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
