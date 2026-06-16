// Pure pixel-fill core for the sand renderer. Kept DOM-free so the benchmark
// can measure render fill cost headlessly.

import { MAT, buildColorLUT, buildTextureAmp } from './materials.js';
import { PACKED_FIRE, PACKED_FIRE_HOT, PACKED_LAVA_HOT } from './materials.generated.js';

// Animation-only colors (not base material colors): the hot/flicker shades the
// shimmer logic below swaps in. Base colors live in the materials.js registry;
// these are generated from materials.schema.json (the single source).
export { PACKED_FIRE, PACKED_FIRE_HOT };

// Base per-material colors come straight from the registry (single source).
export function makeColorLUT() {
  return buildColorLUT();
}

// --- Static grain texture ---
// Each material gets VARIANTS brightness-shifted shades; a fixed noise tile
// picks one per cell by position, so the grain is stable across frames and
// identical whether a cell is drawn by the full-render or per-chunk path.
const VARIANTS = 8;
const VAR_SHIFT = 3; // log2(VARIANTS)
const NOISE_SIZE = 64;
const NOISE_SHIFT = 6; // log2(NOISE_SIZE)
const NOISE_MASK = NOISE_SIZE - 1;

// Per-material grain strength (max +/- shift per channel, 0-255), from the
// registry. Solids read grittier; liquids stay subtle; fire/steam/lava animate.
const TEXTURE_AMP = buildTextureAmp();

const jitterShade = (packed, delta) => {
  if (packed === 0) return 0;
  const a = packed & 0xff000000;
  let r = packed & 0xff;
  let g = (packed >>> 8) & 0xff;
  let b = (packed >>> 16) & 0xff;
  r += delta; if (r < 0) r = 0; else if (r > 255) r = 255;
  g += delta; if (g < 0) g = 0; else if (g > 255) g = 255;
  b += delta; if (b < 0) b = 0; else if (b > 255) b = 255;
  return (a | (b << 16) | (g << 8) | r) >>> 0;
};

export function makeTexture(lut, rng = Math.random) {
  const variants = new Uint32Array(16 * VARIANTS);
  for (let m = 0; m < 16; m++) {
    const base = lut[m];
    const amp = TEXTURE_AMP[m];
    for (let i = 0; i < VARIANTS; i++) {
      const t = (i / (VARIANTS - 1)) * 2 - 1; // -1..1
      variants[(m << VAR_SHIFT) + i] = jitterShade(base, Math.round(t * amp));
    }
  }
  const noise = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < noise.length; i++) noise[i] = (rng() * VARIANTS) | 0;
  return { variants, noise, mask: NOISE_MASK, shift: NOISE_SHIFT };
}

const STEAM_ID = MAT.STEAM;
const FIRE_ID = MAT.FIRE;
const LAVA_ID = MAT.LAVA;

// Fills pixels[k] for every cell in the inclusive rect, including EMPTY (0).
// When `texture` is provided, static per-cell grain is applied; steam shimmers
// by randomly skipping cells, fire flickers, and lava sparkles regardless.
export function fillPixelSpan(pixels, grid, cols, x0, y0, x1, y1, lut, texture = null, rng = Math.random) {
  const variants = texture && texture.variants;
  const noise = texture && texture.noise;
  const nmask = texture ? texture.mask : 0;
  const nshift = texture ? texture.shift : 0;
  for (let y = y0; y <= y1; y++) {
    const rowBase = y * cols;
    const noiseRow = noise ? ((y & nmask) << nshift) : 0;
    for (let x = x0; x <= x1; x++) {
      const k = rowBase + x;
      const m = grid[k];
      let c = variants ? variants[(m << VAR_SHIFT) + noise[noiseRow + (x & nmask)]] : lut[m];
      if (m === STEAM_ID) {
        if (rng() <= 0.18) c = 0;
      } else if (m === FIRE_ID) {
        if (rng() < 0.35) c = PACKED_FIRE_HOT;
      } else if (m === LAVA_ID) {
        if (((x * 17 + y * 31) & 7) === 0) c = PACKED_LAVA_HOT;
      }
      pixels[k] = c;
    }
  }
}
