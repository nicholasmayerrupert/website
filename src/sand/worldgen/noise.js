// Seeded, dependency-free noise for world generation.
//
// Everything here is deterministic given a seed, so a world is coherent within a
// single page load and reproducible if you reuse the seed. The scene derives its
// seed from the engine's rand() (see context.js), which is fresh each load.

// Hash an integer lattice point to a stable float in [0, 1). Seed-mixed so
// different seeds give independent fields.
function hash2(seed, x, y) {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
const lerp = (a, b, t) => a + (b - a) * t;

// 1D value noise: smooth interpolation between hashed lattice values. Output in
// [0, 1). `x` is continuous (can be fractional / negative).
export function valueNoise1D(seed, x) {
  const xi = Math.floor(x);
  const xf = x - xi;
  const a = hash2(seed, xi, 0);
  const b = hash2(seed, xi + 1, 0);
  return lerp(a, b, fade(xf));
}

// 2D value noise. Output in [0, 1). Continuous in both axes.
export function valueNoise2D(seed, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const aa = hash2(seed, xi, yi);
  const ba = hash2(seed, xi + 1, yi);
  const ab = hash2(seed, xi, yi + 1);
  const bb = hash2(seed, xi + 1, yi + 1);
  return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
}

// Fractal (fBm) sum of octaves. `opts.dim` selects 1D or 2D sampling. Output is
// normalized back to roughly [0, 1).
export function fbm(seed, x, y = 0, opts = {}) {
  const {
    octaves = 4,
    lacunarity = 2,
    gain = 0.5,
    frequency = 1,
    dim = 2,
  } = opts;
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n =
      dim === 1
        ? valueNoise1D(seed + o * 1013, x * freq)
        : valueNoise2D(seed + o * 1013, x * freq, y * freq);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged fractal noise: sharp ridges/veins, ideal for cave tunnels. Output in
// [0, 1) where values near 1 are the ridge crests.
export function ridged(seed, x, y = 0, opts = {}) {
  const {
    octaves = 4,
    lacunarity = 2,
    gain = 0.5,
    frequency = 1,
  } = opts;
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise2D(seed + o * 1013, x * freq, y * freq);
    const r = 1 - Math.abs(n * 2 - 1); // fold to a ridge
    sum += r * r * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
