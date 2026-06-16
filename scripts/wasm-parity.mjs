// Headless parity: JS engine vs WASM engine (Stages 1-3).
import { createEngine } from '../src/sand/engine.js';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { mulberry32 } from '../src/sand/rng.js';

const COLS = 160, ROWS = 100, SEED = 0xC0FFEE;
const NAMES = ['EMPTY', 'SAND', 'WATER', 'STONE', 'OIL', 'FIRE', 'STEAM', 'SEED', 'WOOD', 'PLANT', 'ACID', 'LAVA', 'ICE', 'RIGID', 'DRIFTWOOD'];
const counts = (g) => { const c = new Array(16).fill(0); for (let i = 0; i < g.length; i++) c[g[i]]++; return c; };
const mk = (kind) => kind === 'js'
  ? createEngine({ cols: COLS, rows: ROWS, rng: mulberry32(SEED), sinksOn: false, emittersOn: false })
  : createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false });

await initSandWasm();
let allOk = true;
const check = (label, cond) => { if (!cond) allOk = false; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`); };

// --- A. conservation of loose materials ---
{
  console.log('A. loose-material conservation (sand/water/oil)');
  for (const kind of ['js', 'wasm']) {
    const e = mk(kind);
    for (let i = 0; i < 40; i++) e.paintDisc(40 + (i % 20), 10 + ((i * 7) % 15), 4, 1, false);
    for (let i = 0; i < 40; i++) e.paintDisc(100 + (i % 20), 10 + ((i * 5) % 15), 4, 2, false);
    const c0 = counts(e.getGrid());
    let now = 0; for (let s = 0; s < 300; s++) { now += 16; e.step(now); }
    const c1 = counts(e.getGrid());
    check(`${kind}: SAND conserved (${c0[1]}=${c1[1]})`, c0[1] === c1[1]);
    check(`${kind}: WATER conserved (${c0[2]}=${c1[2]})`, c0[2] === c1[2]);
    e.destroy?.();
  }
}

// --- B. stone component falls as a rigid block and is conserved ---
{
  console.log('B. stone component (draft -> finalize -> fall, conserved)');
  for (const kind of ['js', 'wasm']) {
    const e = mk(kind);
    // a 12x8 stone block floating in mid-air
    for (let y = 20; y < 28; y++) for (let x = 70; x < 82; x++) e.addDiscToStoneDraft(x, y, 0);
    e.finalizeStoneDraft();
    const c0 = counts(e.getGrid());
    let maxY0 = 0; { const g = e.getGrid(); for (let i = 0; i < g.length; i++) if (g[i] === 3) maxY0 = Math.max(maxY0, (i / COLS) | 0); }
    let now = 0; for (let s = 0; s < 250; s++) { now += 16; e.step(now); }
    const c1 = counts(e.getGrid());
    let maxY1 = 0; { const g = e.getGrid(); for (let i = 0; i < g.length; i++) if (g[i] === 3) maxY1 = Math.max(maxY1, (i / COLS) | 0); }
    check(`${kind}: STONE conserved (${c0[3]}=${c1[3]})`, c0[3] === c1[3] && c1[3] > 0);
    check(`${kind}: STONE fell to floor (y ${maxY0} -> ${maxY1})`, maxY1 > maxY0 && maxY1 >= ROWS - 3);
    e.destroy?.();
  }
}

// --- C. fire + water -> steam reaction occurs ---
{
  console.log('C. reactions: fire + water -> steam');
  for (const kind of ['js', 'wasm']) {
    const e = mk(kind);
    // water block + a fire line in the empty cells directly above it (adjacent)
    for (let y = 70; y <= 80; y++) for (let x = 70; x <= 90; x++) e.paintDisc(x, y, 0, 2, false);
    let peak = 0; let now = 0;
    for (let s = 0; s < 60; s++) {
      if (s % 6 === 0) for (let x = 70; x <= 90; x++) e.paintDisc(x, 69, 0, 5, false); // re-seed fire above water
      now += 16; e.step(now);
      const g = e.getGrid(); let st = 0; for (let i = 0; i < g.length; i++) if (g[i] === 6) st++;
      peak = Math.max(peak, st);
    }
    check(`${kind}: STEAM produced (peak ${peak} cells)`, peak > 0);
    e.destroy?.();
  }
}

// --- D. seed grows into plant when watered ---
{
  console.log('D. growth: watered seed grows wood');
  for (const kind of ['js', 'wasm']) {
    const e = mk(kind);
    // ground platform so seed rests
    for (let x = 60; x < 100; x++) for (let y = 80; y < 82; y++) e.addDiscToStoneDraft(x, y, 0);
    e.finalizeStoneDraft();
    e.placeSeedAt(78, 78);
    for (let s = 0; s < 5; s++) e.paintDisc(80, 77, 2, 2, false); // water beside seed
    let now = 0; for (let s = 0; s < 400; s++) { now += 16; if (s % 40 === 0) e.paintDisc(80, 77, 2, 2, false); e.step(now); }
    const c1 = counts(e.getGrid());
    check(`${kind}: plant material present (seed+wood+plant=${c1[7] + c1[8] + c1[9]})`, (c1[7] + c1[8] + c1[9]) > 0);
    e.destroy?.();
  }
}

console.log(allOk ? '\nALL PARITY CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
