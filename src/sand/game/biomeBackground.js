import { BIOME, SURFACE_BIOME_COUNT } from '../wasmBridge/abi.generated.js';

const BLEND_RADIUS = 96;
const SAMPLE_STEP = 4;
const FADE_MS = 180;

// Colors describe the noon scenery; day/night colors modulate these palettes.
export const BIOME_BACKGROUND_PROFILES = {
  [BIOME.PLAINS]: { sky: [1.02, 1.02, 0.97], ridges: ['#859a92', '#738568', '#59734c', '#293126'], forest: 0.25, snow: 0.3, shape: 'rolling', relief: [0.45, 0.4, 0.4], plants: 'meadow' },
  [BIOME.FOREST]: { sky: [1, 1, 1], ridges: ['#718d9a', '#527264', '#35634f', '#222b29'], forest: 1, snow: 0.7, shape: 'alpine', relief: [1, 0.85, 0.8], plants: 'pine' },
  [BIOME.DESERT]: { sky: [1.13, 1.01, 0.88], ridges: ['#b6a18c', '#a88b68', '#99734d', '#3d3028'], forest: 0, snow: 0, shape: 'dunes', relief: [0.45, 0.65, 0.65], plants: 'cactus' },
  [BIOME.ROCKY]: { sky: [0.96, 0.99, 1.02], ridges: ['#8b929e', '#747b80', '#5b6669', '#282c32'], forest: 0.12, snow: 0.85, shape: 'crags', relief: [1.6, 1.4, 1.2], rise: [18, 12, 7], plants: 'none' },
  [BIOME.TUNDRA]: { sky: [0.94, 1.02, 1.05], ridges: ['#a0b2bc', '#879c9e', '#708b85', '#303b40'], forest: 0.2, snow: 1, shape: 'alpine', relief: [1.25, 0.85, 0.55], plants: 'pine' },
  [BIOME.JUNGLE]: { sky: [0.94, 1.02, 0.94], ridges: ['#779a91', '#4b806b', '#2c704d', '#1b3028'], forest: 1, snow: 0, shape: 'rolling', relief: [0.65, 0.6, 0.6], plants: 'jungle' },
  [BIOME.SWAMP]: { sky: [1.02, 1, 0.88], ridges: ['#939b83', '#707e60', '#526745', '#2b3025'], forest: 0.65, snow: 0, shape: 'rolling', relief: [0.22, 0.18, 0.15], plants: 'willow' },
};

export function createBiomeBackgroundBlend() {
  let source = null;
  const samples = new Map();
  let weights = null;
  let lastX = 0;
  let lastMs = 0;

  return (engine, worldX, nowMs, immediate = false) => {
    if (source !== engine) {
      source = engine;
      samples.clear();
      weights = null;
    }
    const target = Array(SURFACE_BIOME_COUNT).fill(0);
    const left = Math.ceil((worldX - BLEND_RADIUS) / SAMPLE_STEP) * SAMPLE_STEP;
    const right = worldX + BLEND_RADIUS;
    let total = 0;
    // A fixed world lattice and a smooth kernel keep four-cell ecotone patches
    // from switching the whole backdrop as the player crosses them.
    for (let x = left; x <= right; x += SAMPLE_STEP) {
      if (!samples.has(x)) samples.set(x, engine.worldBiomeAt(x));
      const distance = (x - worldX) / BLEND_RADIUS;
      const weight = (1 - distance * distance) ** 2;
      target[samples.get(x)] += weight;
      total += weight;
    }
    for (const x of samples.keys()) {
      if (x < left - BLEND_RADIUS || x > right + BLEND_RADIUS) samples.delete(x);
    }
    for (let i = 0; i < target.length; i++) target[i] /= total;
    // New worlds, teleports, and paused/reduced-motion views sample immediately.
    const snap = !weights || immediate || Math.abs(worldX - lastX) > BLEND_RADIUS * 2;
    const alpha = snap ? 1 : 1 - Math.exp(-Math.max(0, nowMs - lastMs) / FADE_MS);
    weights = target.map((value, i) => {
      const previous = weights?.[i] ?? value;
      return previous + (value - previous) * alpha;
    });
    lastX = worldX;
    lastMs = nowMs;
    return weights;
  };
}

const rgb = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
const RIDGE_KEYS = ['ridgeFar', 'ridgeMid', 'ridgeNear', 'ridgeDeep'];
const REFERENCE_RIDGES = BIOME_BACKGROUND_PROFILES[BIOME.FOREST].ridges.map(rgb);
const RIDGE_COLORS = Object.fromEntries(
  Object.entries(BIOME_BACKGROUND_PROFILES).map(([id, profile]) => [id, profile.ridges.map(rgb)]),
);

export function biomeBackgroundStyle(palette, weights) {
  if (!weights) return { palette, forest: 1, snow: 1 };
  const sky = [0, 0, 0];
  const ridges = RIDGE_KEYS.map(() => [0, 0, 0]);
  const style = { palette: { ...palette }, forest: 0, snow: 0 };
  weights.forEach((weight, id) => {
    const profile = BIOME_BACKGROUND_PROFILES[id];
    for (const key of ['forest', 'snow']) style[key] += profile[key] * weight;
    for (let c = 0; c < 3; c++) {
      sky[c] += profile.sky[c] * weight;
      for (let r = 0; r < ridges.length; r++) ridges[r][c] += RIDGE_COLORS[id][r][c] * weight;
    }
  });
  const tint = (color, factors) => `#${rgb(color).map((value, c) =>
    Math.max(0, Math.min(255, Math.round(value * factors[c]))).toString(16).padStart(2, '0')).join('')}`;
  for (const key of ['skyTop', 'skyMid', 'skyGlow', 'skyLow']) style.palette[key] = tint(palette[key], sky);
  RIDGE_KEYS.forEach((key, r) => {
    style.palette[key] = tint(palette[key], ridges[r].map((value, c) => value / REFERENCE_RIDGES[r][c]));
  });
  return style;
}
