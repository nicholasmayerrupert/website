// Streaming world generation.
//
// Unlike the scene builders (which fill one fixed grid via a shadow buffer), this
// generates the world a vertical BAND of columns at a time, as a pure function of
// the absolute world-x coordinate and a single world seed. That makes it
// reproducible and seamless: a column generated now matches the same column
// generated later from the other side, so the sliding window (worldWindow.js) can
// reveal fresh terrain on an edge without seams.
//
// The world is infinite horizontally and a fixed `worldRows` tall: a surface band
// near the top, a soil layer, then a stone core carved by coordinate-noise caves,
// with water pooling in basins below sea level and the occasional tree.

import { fbm, ridged, hash1 } from './noise.js';

export function createStreamGen({ worldRows, MAT, seed }) {
  // --- Tunables (cells, fractions of world height) ---
  const SURFACE_FREQ = 0.010;        // cycles/cell of the base surface octave
  const SURFACE_OCT = 5;
  const surfaceAmp = Math.max(16, Math.floor(worldRows * 0.16)); // vertical relief
  // Surface sits high so most of the world is diggable ground below it.
  const surfaceBase = Math.max(8, Math.floor(worldRows * 0.24));
  const SKIN = 1;                                          // grass/sand dressing
  const SOIL = Math.max(3, Math.floor(worldRows * 0.045)); // sand/dirt band
  const seaRow = surfaceBase + Math.max(2, Math.floor(worldRows * 0.05));
  const CAVE_FREQ = 0.05;
  const CAVE_THRESH = 0.66;          // ridged-noise crest above which stone is air
  const CAVE_SEED = (seed ^ 0x5bd1e995) >>> 0;
  const TREE_SEED = (seed ^ 0x1b56c4f9) >>> 0;
  const TREE_PROB = 0.05;            // chance per land column to root a tree

  // Surface row for a world column. Higher noise -> higher ground (smaller row).
  const surfaceAt = (worldX) => {
    const n = fbm(seed, worldX * SURFACE_FREQ, 0.5, { octaves: SURFACE_OCT, gain: 0.5 });
    let y = Math.round(surfaceBase - (n - 0.5) * 2 * surfaceAmp);
    if (y < 2) y = 2;
    if (y > worldRows - 4) y = worldRows - 4;
    return y;
  };

  // True where the stone core should be hollowed into an (air) cave.
  const isCave = (worldX, y) =>
    ridged(CAVE_SEED, worldX * CAVE_FREQ, y * CAVE_FREQ, { octaves: 3, gain: 0.5 }) > CAVE_THRESH;

  // Material for one world cell (before trees are overlaid). EMPTY = air/water-air.
  const cellAt = (worldX, surf, slope, y) => {
    if (y < surf) return y >= seaRow ? MAT.WATER : MAT.EMPTY; // basin water or air
    const depth = y - surf;
    if (depth < SKIN) return slope <= 1 ? MAT.PLANT : MAT.SAND; // grass on flat ground
    if (depth < SKIN + SOIL) return MAT.SAND;
    // Stone core, carved by caves (kept solid for a couple rows under the soil).
    if (depth >= SKIN + SOIL + 2 && isCave(worldX, y)) return MAT.EMPTY;
    return MAT.STONE;
  };

  const treeAt = (worldX, surf) =>
    surf <= seaRow && hash1(TREE_SEED, worldX) < TREE_PROB;

  // Fill local columns [colStart, colStart+colCount) of a buffer of width
  // `bufCols`, where local column L maps to world-x (worldOffsetX + L). Writes
  // every cell (air included) into `grid`, mirrors the band into `next` so the
  // two buffers stay coherent, and overlays trees clipped to the band.
  const generateBand = ({ grid, next, bufCols, colStart, colCount, worldOffsetX }) => {
    const colEnd = colStart + colCount;
    const inBand = (lx) => lx >= colStart && lx < colEnd;
    const put = (lx, y, m) => {
      if (lx < colStart || lx >= colEnd || y < 0 || y >= worldRows) return;
      grid[y * bufCols + lx] = m;
    };

    for (let lx = colStart; lx < colEnd; lx++) {
      const worldX = worldOffsetX + lx;
      const surf = surfaceAt(worldX);
      const slope = Math.abs(surfaceAt(worldX + 1) - surfaceAt(worldX - 1));
      for (let y = 0; y < worldRows; y++) {
        grid[y * bufCols + lx] = cellAt(worldX, surf, slope, y);
      }
    }

    // Trees: consider every center column whose canopy could reach this band, and
    // draw the part that falls inside it — so a tree on a seam is completed by
    // whichever band owns each of its columns. Deterministic per center column.
    const TREE_REACH = 4;
    for (let lx = colStart - TREE_REACH; lx < colEnd + TREE_REACH; lx++) {
      const worldX = worldOffsetX + lx;
      const surf = surfaceAt(worldX);
      if (!treeAt(worldX, surf)) continue;
      const h = 6 + (hash1(TREE_SEED + 1, worldX) * 7 | 0);
      const top = surf - h;
      for (let y = top; y < surf; y++) put(lx, y, MAT.WOOD); // trunk
      for (let oy = -3; oy <= 1; oy++) {                     // leaf canopy
        for (let ox = -3; ox <= 3; ox++) {
          if (ox * ox + oy * oy > 9) continue;
          put(lx + ox, top + oy, MAT.PLANT);
        }
      }
    }

    // Mirror the band into the back buffer so inactive cells match across buffers.
    for (let lx = colStart; lx < colEnd; lx++) {
      if (!inBand(lx)) continue;
      for (let y = 0; y < worldRows; y++) {
        const k = y * bufCols + lx;
        next[k] = grid[k];
      }
    }
  };

  return { generateBand, surfaceAt, seaRow, surfaceBase };
}
