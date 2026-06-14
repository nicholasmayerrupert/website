// World-generation context: the seam that replaces "design in fractions of
// cols/rows" with a fixed-scale, center-anchored coordinate model.
//
// Scenes author content in GRID coordinates at a constant cell scale. The world
// is anchored at the horizontal center and the bottom, so a narrow viewport crops
// the sides (truncation) and a wide viewport reveals more world around the center.
//
// The context owns a shadow grid so generation can READ what it has placed
// (carve caves, flood only empty space, find the surface, etc.) — the engine only
// hands scenes write primitives. Call commit() at the end to flush into the
// engine; the engine's own clip rules are mirrored here so the two stay in sync.

import { mulberry32 } from '../rng.js';
import { fbm, ridged, valueNoise1D, valueNoise2D } from './noise.js';

export function createWorldContext({ cols, rows, MAT, rand, put }) {
  // One seed per build, derived from the engine rng (fresh each load/resize).
  const seed = Math.floor(rand() * 4294967296) >>> 0;
  const rng = mulberry32(seed);

  const center = Math.floor(cols / 2);

  // Shadow grid (mirrors the engine's playable interior: x in [1, cols-2],
  // y in [1, rows-1]). Cells outside that read as EMPTY and ignore writes.
  const cells = new Uint8Array(cols * rows); // 0 == EMPTY
  const inBounds = (x, y) => x >= 1 && x <= cols - 2 && y >= 1 && y <= rows - 1;
  const get = (x, y) => (inBounds(x, y) ? cells[y * cols + x] : MAT.EMPTY);
  const set = (x, y, m) => {
    if (inBounds(x, y)) cells[y * cols + x] = m;
  };
  const setIfEmpty = (x, y, m) => {
    if (inBounds(x, y) && cells[y * cols + x] === MAT.EMPTY) cells[y * cols + x] = m;
  };

  // Anchors. cx maps a world-x offset (0 = center) to a grid column; worldX is
  // the inverse, giving each column a viewport-independent x so noise stays
  // coherent as the window widens.
  const cx = (dx) => center + dx;
  const worldX = (gx) => gx - center;
  const fromBottom = (dy) => rows - 1 - dy;
  const fromTop = (dy) => dy;

  // Drawing primitives (grid coords) operating on the shadow grid.
  const putCell = (x, y, m) => set(x | 0, y | 0, m);

  const fillRect = (x0, y0, w, h, m) => {
    x0 |= 0; y0 |= 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) set(x, y, m);
    }
  };

  const fillColumn = (x, yTop, yBottom, m) => {
    x |= 0;
    const top = Math.min(yTop, yBottom) | 0;
    const bottom = Math.max(yTop, yBottom) | 0;
    for (let y = top; y <= bottom; y++) set(x, y, m);
  };

  const line = (x0, y0, x1, y1, m) => {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), m);
    }
  };

  const disc = (cxp, cyp, r, m) => {
    const r2 = r * r;
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (ox * ox + oy * oy <= r2) set((cxp + ox) | 0, (cyp + oy) | 0, m);
      }
    }
  };

  // Scan a column from the top and return the first solid row (the surface), or
  // rows if the column is empty. Handy for snapping structures to the ground.
  const surfaceAt = (x) => {
    for (let y = 1; y <= rows - 1; y++) if (get(x, y) !== MAT.EMPTY) return y;
    return rows;
  };

  // Flush everything placed into the engine grid.
  const commit = () => {
    for (let y = 1; y <= rows - 1; y++) {
      const base = y * cols;
      for (let x = 1; x <= cols - 2; x++) {
        const m = cells[base + x];
        if (m !== MAT.EMPTY) put(x, y, m);
      }
    }
  };

  const noise = {
    fbm1: (x, opts) => fbm(seed, x, 0, { ...opts, dim: 1 }),
    fbm2: (x, y, opts) => fbm(seed, x, y, { ...opts, dim: 2 }),
    ridged2: (x, y, opts) => ridged(seed, x, y, opts),
    value1: (x) => valueNoise1D(seed, x),
    value2: (x, y) => valueNoise2D(seed, x, y),
  };

  return {
    cols,
    rows,
    MAT,
    seed,
    rng,
    center,
    cx,
    worldX,
    fromBottom,
    fromTop,
    get,
    put: putCell,
    putIfEmpty: setIfEmpty,
    rect: fillRect,
    fillColumn,
    line,
    disc,
    surfaceAt,
    commit,
    noise,
  };
}
