// Behavior of the Phase-1 materials: they reuse existing physics with no engine
// edits beyond the schema. Verifies that
//   - new POWDERs (DIRT/SNOW/MUD/GRASS) fall and SETTLE TO INERT (no churn), like SAND;
//   - new stone-group COMPONENTs (ores/brick) GROUND like STONE when supported;
//   - a falling stone-group component KEEPS ITS MATERIAL (ore stays ore, not STONE)
//     — the matOf fix in moveRigidAssemblies.
// Run: node scripts/material-behavior-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 160, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const mk = (opts = {}) => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false, ...opts });
const { check, done } = makeChecker('material behavior (Phase 1)');

const count = (g, m) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
const minRow = (g, m) => { let r = ROWS; for (let i = 0; i < g.length; i++) if (g[i] === m) r = Math.min(r, (i / COLS) | 0); return r; };
const maxRow = (g, m) => { let r = -1; for (let i = 0; i < g.length; i++) if (g[i] === m) r = Math.max(r, (i / COLS) | 0); return r; };
const fillDisc = (e, cx, cy, r, mat) => e.placeMaterial(cx, cy, r, mat);

// --- new powders fall and settle to inert (no shimmer) ---
for (const name of ['DIRT', 'SNOW', 'MUD', 'GRASS']) {
  const e = mk();
  const mat = MAT[name];
  fillDisc(e, COLS / 2, 18, 7, mat);
  const before = count(e.getGrid(), mat);
  let t = 0, settledAt = -1;
  for (let i = 0; i < 3000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  const g = e.getGrid();
  check(`${name} powder settles to inert (step ${settledAt})`, settledAt > 0 && settledAt < 3000);
  check(`${name} conserved (${before} -> ${count(g, mat)})`, count(g, mat) === before && before > 0);
  check(`${name} fell to the floor (bottom row ${maxRow(g, mat)})`, maxRow(g, mat) >= ROWS - 4);
  e.destroy();
}

// --- stone-group ore grounds like STONE when it rests on the floor ---
{
  const e = mk();
  const ORE = MAT.COPPER_ORE;
  fillDisc(e, COLS / 2, ROWS - 8, 6, ORE); // disc whose bottom reaches the world floor
  const before = count(e.getGrid(), ORE);
  const top0 = minRow(e.getGrid(), ORE);
  let t = 0; for (let i = 0; i < 300; i++) { t += 16; e.step(t); }
  const g = e.getGrid();
  check(`COPPER_ORE registered + grounded (did not fall, top ${minRow(g, ORE)} ~ ${top0})`, minRow(g, ORE) <= top0 + 1);
  check(`COPPER_ORE conserved (${before})`, count(g, ORE) === before && before > 0);
  check(`grounded ore stayed COPPER_ORE, no STONE conjured`, count(g, MAT.STONE) === 0);
  e.destroy();
}

// --- a FALLING stone-group component keeps its real material (matOf fix) ---
{
  const e = mk();
  const ORE = MAT.IRON_ORE;
  fillDisc(e, COLS / 2, 16, 6, ORE); // floating, nothing beneath
  const before = count(e.getGrid(), ORE);
  const top0 = minRow(e.getGrid(), ORE);
  let t = 0; for (let i = 0; i < 400; i++) { t += 16; e.step(t); }
  const g = e.getGrid();
  check(`floating IRON_ORE fell (top ${top0} -> ${minRow(g, ORE)})`, minRow(g, ORE) > top0 + 8);
  check(`fallen ore is STILL IRON_ORE, not STONE (${count(g, ORE)} ore, ${count(g, MAT.STONE)} stone)`, count(g, ORE) === before && before > 0 && count(g, MAT.STONE) === 0);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
