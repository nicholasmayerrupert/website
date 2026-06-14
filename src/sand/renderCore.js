// Pure pixel-fill core for the sand renderer. Kept DOM-free so the benchmark
// can measure render fill cost headlessly.

import { MAT } from './engine.js';

// ABGR packed colors (little-endian Uint32 view over RGBA ImageData).
export const PACKED_FIRE = 0xb8_22_6c_ff;
export const PACKED_FIRE_HOT = 0x9e_50_cd_ff;
const PACKED_STEAM = 0x42_ff_e6_d2;
const PACKED_LAVA_HOT = 0xc8_30_90_ff;

export function makeColorLUT() {
  const lut = new Uint32Array(16);
  lut[MAT.SAND] = 0x79_78_c8_e6;
  lut[MAT.WATER] = 0x66_ff_aa_78;
  lut[MAT.STONE] = 0xb3_96_8c_8c;
  lut[MAT.OIL] = 0x8c_1c_48_69;
  lut[MAT.FIRE] = PACKED_FIRE;
  lut[MAT.STEAM] = PACKED_STEAM;
  lut[MAT.SEED] = 0xc7_16_2e_58;
  lut[MAT.WOOD] = 0xc2_23_4c_80;
  lut[MAT.PLANT] = 0xa3_54_aa_5b;
  lut[MAT.ACID] = 0x80_20_ff_80;
  lut[MAT.LAVA] = 0xc8_10_50_ff;
  lut[MAT.ICE] = 0x90_ff_f0_c0;
  return lut;
}

const STEAM_ID = MAT.STEAM;
const FIRE_ID = MAT.FIRE;
const LAVA_ID = MAT.LAVA;

// Fills pixels[k] for every cell in the inclusive rect, including EMPTY (0).
// Steam shimmers by randomly skipping cells; fire flickers between two colors.
export function fillPixelSpan(pixels, grid, cols, x0, y0, x1, y1, lut, rng = Math.random) {
  for (let y = y0; y <= y1; y++) {
    const rowBase = y * cols;
    for (let x = x0; x <= x1; x++) {
      const k = rowBase + x;
      const m = grid[k];
      let c = lut[m];
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
