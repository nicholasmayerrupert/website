const PIXEL_SCALE = 4;

const SKY_TOP = '#111827';
const SKY_MID = '#1f3b57';
const SKY_LOW = '#4a6b72';
const CLOUD_DARK = '#b8c7ca';
const CLOUD_LIGHT = '#e6ece8';
const RIDGE_FAR = '#31455b';
const RIDGE_MID = '#263c44';
const RIDGE_NEAR = '#1a2d2f';
// A very dark grey ridge sitting low on the screen: a subtle dim rocky band behind
// freshly-dug caves. Kept low/short so it reads as a distant floor, not a mountain.
const RIDGE_DEEP = '#14171a';
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

function backgroundDriftY(camY) {
  return clamp((camY - SURFACE_CAM_Y) * 0.55, -MAX_VERTICAL_DRIFT_UP, MAX_VERTICAL_DRIFT_DOWN);
}

function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}

function drawDither(ctx, w, h, horizon) {
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < horizon; y += 9) {
    const row = Math.floor(y / 9);
    for (let x = (row & 1) * 7; x < w; x += 14) {
      if (((x + row * 11) & 31) < 10) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawStars(ctx, w, horizon, camX, camY) {
  const offX = Math.floor(camX * 0.025);
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
}

function drawCloud(ctx, x, y, size, color) {
  fillRect(ctx, x, y + size, size * 7, size * 2, color);
  fillRect(ctx, x + size, y, size * 2, size * 4, color);
  fillRect(ctx, x + size * 3, y - size, size * 2, size * 5, color);
  fillRect(ctx, x + size * 5, y + size, size * 2, size * 3, color);
}

function drawCloudLayer(ctx, w, horizon, camX, camY, depth, color, count, period) {
  const offX = camX * depth;
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
  const a = Math.sin(worldX * 0.045 + seed) * amp;
  const b = Math.sin(worldX * 0.017 + seed * 1.7) * amp * 0.65;
  const c = Math.sin(worldX * 0.009 + seed * 2.9) * amp * 0.85;
  return base + a + b + c;
}

function drawRidge(ctx, w, h, camX, camY, depth, base, amp, color, seed) {
  const offX = camX * depth;
  const offY = backgroundDriftY(camY) * depth;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 4; x += 4) {
    ctx.lineTo(x, Math.round(ridgeY(x + offX, base - offY, amp, seed)));
  }
  ctx.lineTo(w + 4, h);
  ctx.closePath();
  ctx.fill();
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

  // `scale` is the in-game zoom relative to the default (1 = default, >1 = zoomed
  // in). The whole backdrop is drawn into a logical box of size (w/scale, h/scale)
  // and then uniformly scaled to fill the canvas, so the mountains/clouds/stars and
  // the pan rate grow and shrink in lockstep with the simulation — no desync. The
  // horizon stays at a fixed fraction of the screen because it's a ratio of the
  // logical height.
  const draw = ({ camX = 0, camY = 0, scale = 1 } = {}) => {
    if (!canvas.width || !canvas.height) return;
    const s = scale > 0 ? scale : 1;
    const qx = Math.round(camX * 4) / 4;
    const qy = Math.round(camY * 4) / 4;
    const key = `${canvas.width}:${canvas.height}:${qx}:${qy}:${s.toFixed(3)}`;
    if (key === lastKey) return;
    lastKey = key;

    // Logical drawing size: scaling it by `s` exactly fills the backing store, so
    // there are never edge gaps (zoom-out draws a larger logical area, shrunk to fit).
    const w = canvas.width / s;
    const h = canvas.height / s;
    ctx.setTransform(s, 0, 0, s, 0, 0);

    const horizon = Math.round(clamp(h * HORIZON_RATIO - backgroundDriftY(qy), -28, h - 36));
    const skyHeight = Math.max(0, horizon);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(0.48, SKY_MID);
    sky.addColorStop(1, SKY_LOW);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawDither(ctx, w, h, skyHeight);
    drawStars(ctx, w, skyHeight, qx, qy);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.08, CLOUD_DARK, 1, 170);
    drawCloudLayer(ctx, w, skyHeight, qx, qy, 0.14, CLOUD_LIGHT, 2, 210);
    drawRidge(ctx, w, h, qx, qy, 0.18, horizon + 8, 9, RIDGE_FAR, 3.2);
    drawRidge(ctx, w, h, qx, qy, 0.34, horizon + 20, 13, RIDGE_MID, 7.9);
    drawRidge(ctx, w, h, qx, qy, 0.52, horizon + 34, 16, RIDGE_NEAR, 12.4);
    // Dark backdrop band: pushed low (large base offset) and short (small amp) so
    // it's a subtle distant floor behind caves, not a looming mountain.
    drawRidge(ctx, w, h, qx, qy, 0.70, horizon + 96, 11, RIDGE_DEEP, 18.5);
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
