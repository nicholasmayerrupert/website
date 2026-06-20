// Dropped/mined items must FLOAT on fluids: an item that lands in (or is spawned
// inside) water/oil/acid/lava rises to the surface and rests there instead of sinking
// to the bottom. Cosmetic particles still splash through. Run: node scripts/item-float-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 40, ROWS = 60;
await initSandWasm();
const { check, done } = makeChecker('items float on fluids');

// Build a pool: stone floor at the bottom, a column of `liquid` sitting on it with a
// known surface row. Returns the engine + the surface row (topmost liquid cell).
function pool(liquid, depth = 16) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
  const floorY = ROWS - 4;            // stone floor rows [floorY .. ROWS-1]
  for (let y = floorY; y < ROWS; y++) for (let x = 0; x < COLS; x++) e.placeMaterial(x, y, 0, MAT.STONE);
  const surfaceY = floorY - depth;    // liquid fills [surfaceY .. floorY-1]
  for (let y = surfaceY; y < floorY; y++) for (let x = 4; x < COLS - 4; x++) e.placeMaterial(x, y, 0, liquid);
  let t = 0; const run = (n) => { for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
  run(40); // let the liquid settle to a flat surface
  // measure the actual settled surface row in the middle column
  const g = e.getGrid(); let topLiquid = ROWS;
  for (let y = 0; y < ROWS; y++) if (g[y * COLS + 20] === liquid) { topLiquid = y; break; }
  return { e, run, surfaceY: topLiquid, floorY };
}
const itemY = (e) => { const it = e.getItems().find((o) => o.kind === 0 /*IT_ITEM*/); return it ? it.y : null; };

for (const [name, mat] of [['water', MAT.WATER], ['oil', MAT.OIL], ['acid', MAT.ACID], ['lava', MAT.LAVA]]) {
  // 1) Drop an item from the air above the pool: it should come to rest at the surface.
  {
    const { e, run, surfaceY, floorY } = pool(mat);
    e.spawnItem(MAT.WOOD, 1, 20, surfaceY - 8); // well above the surface
    run(160);
    const y = itemY(e);
    const restingNearSurface = y !== null && Math.abs(y - surfaceY) <= 2.5;
    const notAtBottom = y !== null && y < floorY - 2;
    check(`${name}: dropped item floats at the surface (y=${y?.toFixed(1)}, surface=${surfaceY})`, restingNearSurface && notAtBottom);
    e.destroy();
  }
  // 2) Spawn an item deep INSIDE the fluid: buoyancy must lift it back to the surface.
  {
    const { e, run, surfaceY, floorY } = pool(mat);
    e.spawnItem(MAT.WOOD, 1, 20, floorY - 2); // submerged near the bottom
    run(200);
    const y = itemY(e);
    const rose = y !== null && Math.abs(y - surfaceY) <= 2.5;
    check(`${name}: submerged item rises and floats (y=${y?.toFixed(1)}, surface=${surfaceY})`, rose);
    e.destroy();
  }
}

// 3) Sanity: an item dropped over DRY ground still rests on the ground (no regression).
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
  const floorY = ROWS - 4;
  for (let y = floorY; y < ROWS; y++) for (let x = 0; x < COLS; x++) e.placeMaterial(x, y, 0, MAT.STONE);
  let t = 0; const run = (n) => { for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
  run(4);
  e.spawnItem(MAT.WOOD, 1, 20, 10);
  run(160);
  const y = e.getItems().find((o) => o.kind === 0)?.y ?? null;
  check(`dry ground: item still settles on the floor (y=${y?.toFixed(1)}, floor=${floorY})`, y !== null && Math.abs(y - (floorY - 1)) <= 1.5);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
