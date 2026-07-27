// Erasing, dissolving, or mining a structural cell must remove both its grid cell
// and component membership so no invisible collision remains.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 40, ROWS = 60;
await initSandWasm();
const { check, done } = makeChecker('component destruction frees rigid cells');

const fresh = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
const run = (e, n, t0 = 0) => { let t = t0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } return t; };
const lowestSand = (e) => { const g = e.getGrid(); let low = -1; for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === MAT.SAND) low = Math.max(low, y); return low; };

// Carve a hole through a grounded slab, then confirm dropped sand falls THROUGH it
// (past the slab bottom) instead of resting on an invisible component remnant.
function fallsThrough(label, mat, carve) {
  const e = fresh();
  for (let y = 40; y <= 50; y++) for (let x = 5; x <= 34; x++) e.placeMaterial(x, y, 0, mat);
  for (let y = 51; y < ROWS; y++) e.placeMaterial(5, y, 0, mat);
  let t = run(e, 3);
  carve(e); // open a vertical channel around x=20
  t = run(e, 5, t);
  for (let x = 18; x <= 22; x++) e.placeMaterial(x, 20, 0, MAT.SAND);
  run(e, 70, t);
  // slab bottom is row 50; falling through lands the sand below it.
  check(`${label}: sand falls through the carved hole (lowest row ${lowestSand(e)} > 50)`, lowestSand(e) > 50);
  e.destroy();
}

for (const [name, mat] of [['stone', MAT.STONE], ['sandstone', MAT.SANDSTONE], ['iron ore', MAT.IRON_ORE], ['brick', MAT.BRICK]]) {
  fallsThrough(`erase ${name}`, mat, (e) => e.eraseDisc(20, 45, 6));
}

// Acid boring a channel through a non-STONE component must not leave invisible
// blockers. Acid only decays as it dissolves (it otherwise pools), so we instead
// clear the leftover acid LIQUID out of the channel before probing — that clears
// only non-empty cells, so any stale dissolved-component cell (already grid-EMPTY)
// is left intact and would still block the dropped sand if the fix were missing.
{
  const e = fresh();
  for (let y = 35; y <= 50; y++) for (let x = 5; x <= 34; x++) e.placeMaterial(x, y, 0, MAT.SANDSTONE);
  for (let y = 51; y < ROWS; y++) e.placeMaterial(5, y, 0, MAT.SANDSTONE);
  let t = run(e, 3);
  const ssBefore = (() => { let n = 0; for (const v of e.getGrid()) if (v === MAT.SANDSTONE) n++; return n; })();
  for (let s = 0; s < 280; s++) { if (s % 3 === 0) for (let x = 19; x <= 21; x++) e.placeMaterial(x, 30, 0, MAT.ACID); t = run(e, 1, t); }
  const ssAfter = (() => { let n = 0; for (const v of e.getGrid()) if (v === MAT.SANDSTONE) n++; return n; })();
  check(`acid actually dissolved sandstone (${ssBefore} -> ${ssAfter})`, ssAfter < ssBefore - 20);
  // sweep out every remaining acid cell (does not touch the dissolved EMPTY cells).
  const g = e.getGrid(); const acidCells = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === MAT.ACID) acidCells.push([x, y]);
  for (const [x, y] of acidCells) e.eraseDisc(x, y, 0);
  t = run(e, 4, t);
  for (let x = 19; x <= 21; x++) e.placeMaterial(x, 20, 0, MAT.SAND);
  run(e, 110, t);
  // slab bottom is row 50; sand resting on an invisible remnant would stop above it.
  check(`acid-bored sandstone leaves no invisible blockers (sand reached row ${lowestSand(e)} > 50)`, lowestSand(e) > 50);
  e.destroy();
}

// Tool mining (mineDisc -> mineDamageDisc path) of an ore body must also free the
// cells. Use a THIN grounded ore slab so a real survival player can fully bore a
// vertical gap within a few swings (sidestepping durability/cooldown depth limits).
{
  const e = fresh();
  e.setSurvivalInventory(true);
  for (let y = 44; y <= 46; y++) for (let x = 5; x <= 34; x++) e.placeMaterial(x, y, 0, MAT.COPPER_ORE);
  const id = e.spawnPlayer(20, 40); // standing just above the slab, in reach
  let t = run(e, 4);
  e.setSelectedSlot(id, 0); // wood dig tool
  const oreAtCol = () => { const g = e.getGrid(); let n = 0; for (let y = 44; y <= 46; y++) if (g[y * COLS + 20] === MAT.COPPER_ORE) n++; return n; };
  for (let pass = 0; pass < 60 && oreAtCol() > 0; pass++) {
    for (let y = 44; y <= 46; y++) { e.playerMine(id, 20, y); t = run(e, 1, t); }
  }
  t = run(e, 6, t);
  check(`mining fully bored the copper-ore gap (${oreAtCol()} left)`, oreAtCol() === 0);
  for (let x = 19; x <= 21; x++) e.placeMaterial(x, 20, 0, MAT.SAND);
  run(e, 80, t);
  check(`mined copper ore frees the rigid cells (sand fell to row ${lowestSand(e)} > 46)`, lowestSand(e) > 46);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
