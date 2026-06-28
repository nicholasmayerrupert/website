// Material-identity rigid bodies + solidify-on-rest (see the BODY-MATERIAL INVARIANT
// in members.inc). A free body stamps its REAL material into the grid; a non-RIGID
// body BAKES into a static component when it sleeps, while a RIGID body stays a free
// body forever.
//   - a STONE body renders as STONE while airborne (grid cells == STONE), then bakes
//     into a grounded stone component on rest (body count 1 -> 0, stone conserved);
//   - a RIGID body never bakes (count stays 1).
// Run: node scripts/rigidmat-test.mjs
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 120, ROWS = 90, SEED = 0xC0FFEE;
await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false });
const { check, done } = makeChecker('material-identity bodies + solidify-on-rest');
const count = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };

// --- a STONE body looks like stone in flight, then bakes into a stone component ---
{
  const e = mk();
  e.spawnBox(60, 14, 4, 4, MAT.STONE); // 8x8 stone body up high
  e.step(16);                          // one step to integrate + stamp into the grid
  const airStone = count(e.getGrid(), MAT.STONE);
  const airBodies = e._bodyCount();
  check(`STONE body is a body in flight (count ${airBodies})`, airBodies === 1);
  check(`STONE body renders as STONE in flight (cells ${airStone})`, airStone > 0);
  check(`STONE body is NOT generic RIGID (rigid cells ${count(e.getGrid(), MAT.RIGID)})`, count(e.getGrid(), MAT.RIGID) === 0);

  let baked = -1;
  for (let i = 0; i < 600; i++) { e.step((i + 2) * 16); if (e._bodyCount() === 0) { baked = i; break; } }
  const g = e.getGrid();
  check(`STONE body solidified on rest (body count -> 0 at step ${baked})`, baked > 0 && e._bodyCount() === 0);
  check(`baked stone conserved (~${airStone} -> ${count(g, MAT.STONE)})`, count(g, MAT.STONE) >= airStone - 4 && count(g, MAT.STONE) > 0);
  check(`baked stone rests near the floor (bottom row ${(() => { let r = 0; for (let i = 0; i < g.length; i++) if (g[i] === MAT.STONE) r = Math.max(r, (i / COLS) | 0); return r; })()})`,
    (() => { let r = 0; for (let i = 0; i < g.length; i++) if (g[i] === MAT.STONE) r = Math.max(r, (i / COLS) | 0); return r; })() >= ROWS - 6);
  // after baking, mining/erasing it behaves like a normal stone component
  e.eraseDisc(60, ROWS - 4, 6);
  e.step((baked + 3) * 16);
  e.destroy();
}

// --- a RIGID body NEVER bakes: it stays a free body forever ---
{
  const e = mk();
  e.spawnBox(60, 14, 4, 4, MAT.RIGID);
  for (let i = 0; i < 600; i++) e.step((i + 1) * 16);
  check(`RIGID body never bakes (count still ${e._bodyCount()})`, e._bodyCount() === 1);
  check(`RIGID body still renders as RIGID (cells ${count(e.getGrid(), MAT.RIGID)})`, count(e.getGrid(), MAT.RIGID) > 0);
  e.destroy();
}

// --- a WOOD body works and renders as WOOD, but (like driftwood) stays a free body
//     forever: only stone/ice-group materials have a static form to bake into ---
{
  const e = mk();
  e.spawnBox(60, 14, 4, 4, MAT.WOOD);
  e.step(16);
  check(`WOOD body renders as WOOD in flight (cells ${count(e.getGrid(), MAT.WOOD)})`, count(e.getGrid(), MAT.WOOD) > 0);
  for (let i = 0; i < 600; i++) e.step((i + 2) * 16); // fall + rest on the floor
  check(`WOOD body does NOT bake (stays a free body, count ${e._bodyCount()})`, e._bodyCount() === 1);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
