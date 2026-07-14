// Phase 2 worldgen: expanded biomes drive the surface SKIN and soil MANTLE
// material (snow/sand/grass/mud/dirt/...) while the surface HEIGHT stays
// biome-independent (no cliffs at biome seams that would avalanche forever), and
// the generated world still settles to INERT (the new loose-powder mantle must
// not churn). Run: node scripts/worldgen-biome-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 220, ROWS = 140, SEED = 0xBED;
await initSandWasm();
const { check, done } = makeChecker('worldgen biomes (Phase 2)');
const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

// Surface height is a pure function of worldX (no biome term), so it must be
// smooth — adjacent columns differ by ~1 cell, never a biome-seam cliff.
let maxJump = 0;
for (let wx = -3000; wx < 3000; wx++) maxJump = Math.max(maxJump, Math.abs(e.worldSurfaceAt(wx) - e.worldSurfaceAt(wx + 1)));
check(`surface height is continuous across biome seams (max adjacent jump ${maxJump})`, maxJump <= 4);

// Scan the surface skin + the mantle just under it, panning across many biomes.
const skins = new Set();
let sawDirtMantle = false;
let matchedBackgroundStrata = 0;
let mismatchedBackgroundStrata = 0;
const scan = () => {
  const g = e.getGrid(), bg = e.getGridBg();
  for (let x = 1; x < COLS - 1; x++) {
    let surfY = -1;
    for (let y = 0; y < ROWS; y++) { const m = g[y * COLS + x]; if (m !== MAT.EMPTY && m !== MAT.WATER) { surfY = y; break; } }
    if (surfY < 0) continue;
    skins.add(g[surfY * COLS + x]);
    for (let y = surfY; y < Math.min(ROWS, surfY + 8); y++) {
      const k = y * COLS + x, m = g[k];
      if (m === MAT.DIRT) sawDirtMantle = true;
      if (m === MAT.SAND || m === MAT.DIRT || m === MAT.MUD || m === MAT.SNOW || m === MAT.GRASS) {
        if (bg[k] === m) matchedBackgroundStrata++;
        else mismatchedBackgroundStrata++;
      }
    }
  }
};
scan();
for (let i = 0; i < 40; i++) { e.shiftWorldXY(128, 0); scan(); }

// Multiple biomes produce multiple skin materials; tundra's SNOW in particular.
const named = [...skins].map((m) => Object.keys(MAT).find((k) => MAT[k] === m));
check(`several biome skins generate (${named.sort().join(', ')})`, skins.size >= 3);
check('plains/forest GRASS skin appears', skins.has(MAT.GRASS));
check('tundra SNOW skin appears', skins.has(MAT.SNOW));
check('a new soil material (DIRT mantle) is generated under grass', sawDirtMantle);
check(`background matches exposed loose surface strata (${matchedBackgroundStrata} cells)`,
  matchedBackgroundStrata > 0 && mismatchedBackgroundStrata === 0);
e.destroy();

// The freshly generated world (loose dirt/sand/snow mantle included) settles to
// inert quickly — guards the worldgen-churn constraint for the new powders.
{
  const e2 = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });
  let t = 0, settledAt = -1;
  for (let i = 0; i < 600; i++) { t += 16; if (!e2.step(t)) { settledAt = i; break; } }
  check(`generated world settles to inert (step ${settledAt})`, settledAt >= 0 && settledAt < 600);
  e2.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
