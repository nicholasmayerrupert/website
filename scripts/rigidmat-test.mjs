// Material-identity rigid bodies + solidify-on-rest (see the BODY-MATERIAL INVARIANT
// in members.inc). A free body stamps its REAL material into the grid; a non-RIGID
// body BAKES into a static component when it sleeps, while a RIGID body stays a free
// body forever.
//   - a STONE body renders as STONE while airborne (grid cells == STONE), then bakes
//     into a grounded stone component on rest (body count 1 -> 0, stone conserved);
//   - a RIGID body never bakes (count stays 1).
// Run: node scripts/rigidmat-test.mjs
import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
// Every engine in this file gets the test hooks (grounding/body/particle pokes).
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
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

// --- a body that cannot stamp any visible cell is culled instead of surviving as
//     an invisible solver participant ---
{
  const e = mk();
  for (let y = 30; y < 70; y++) for (let x = 40; x < 80; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
  e.spawnBox(60, 50, 4, 4, MAT.RIGID);
  e.step(16);
  check(`fully embedded body is culled (count ${e._bodyCount()})`, e._bodyCount() === 0);
  e.destroy();
}

// --- a WOOD body renders as WOOD and BAKES into a plant component when it beaches on
//     solid ground (wood/plant solidify like stone/ice now) ---
{
  const e = mk();
  e.spawnBox(60, 14, 4, 4, MAT.WOOD); // 8x8 wood body up high over empty floor
  e.step(16);
  const airWood = count(e.getGrid(), MAT.WOOD);
  check(`WOOD body renders as WOOD in flight (cells ${airWood})`, airWood > 0);
  let baked = -1;
  for (let i = 0; i < 600; i++) { e.step((i + 2) * 16); if (e._bodyCount() === 0) { baked = i; break; } }
  check(`WOOD body solidified on solid rest (body count -> 0 at step ${baked})`, baked > 0 && e._bodyCount() === 0);
  check(`baked wood conserved (~${airWood} -> ${count(e.getGrid(), MAT.WOOD)})`, count(e.getGrid(), MAT.WOOD) >= airWood - 4 && count(e.getGrid(), MAT.WOOD) > 0);
  e.destroy();
}

// --- a WOOD body FLOATING on water does NOT bake: it keeps bobbing as a free body
//     (baking it there would strip its buoyancy and sink it) ---
{
  const e = mk();
  const x0 = 40, x1 = 80, yTop = 50, yBot = 80;        // small walled pool with a stone floor
  for (let y = yTop - 1; y <= yBot + 1; y++) { e.paintDisc(x0 - 1, y, 0, MAT.STONE, true); e.paintDisc(x1 + 1, y, 0, MAT.STONE, true); }
  for (let x = x0 - 1; x <= x1 + 1; x++) e.paintDisc(x, yBot + 1, 0, MAT.STONE, true);
  e.syncComponents();
  for (let y = yTop; y <= yBot; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, MAT.WATER, true);
  for (let i = 0; i < 120; i++) e.step((i + 1) * 16); // settle the pool
  e.spawnBox(60, 35, 4, 4, MAT.WOOD);                  // drop a wood body onto the water
  for (let i = 0; i < 700; i++) e.step((i + 122) * 16); // plunge, find float depth, bob a long while
  check(`WOOD body floating on water does NOT bake (stays a free body, count ${e._bodyCount()})`, e._bodyCount() === 1);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
