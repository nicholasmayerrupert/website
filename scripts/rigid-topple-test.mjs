// Imbalanced free bodies must topple promptly, while balanced bodies damp contact
// jitter and settle to sleep.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
// Every engine in this file gets the test hooks (grounding/body/particle pokes).
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));

const COLS = 160, ROWS = 140, SEED = 0xC0FFEE;
const STONE = 3, RIGID = 13;
await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false });

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

const stoneRect = (e, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, STONE, true); };
// w-wide, len-tall solid bar of body cells (a hand-drawn "vertical line"/slab).
const vSlab = (cxLeft, yTop, w, len) => { const c = []; for (let y = 0; y < len; y++) for (let x = 0; x < w; x++) c.push([cxLeft + x, yTop + y]); return c; };
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const degAbs = (r) => Math.abs(norm(r) * 180 / Math.PI);

// Drive the body and report when |angle| first crosses `thresh` deg, the max angle
// reached, and the tick it fell asleep.
function topple(e, idx, steps, thresh = 45) {
  let t = 0, crossed = -1, maxA = 0, slept = -1;
  for (let i = 0; i < steps; i++) {
    t += 16; e.step(t);
    const s = e._bodyState(idx); if (!s) break;
    const a = degAbs(s.angle); if (a > maxA) maxA = a;
    if (a >= thresh && crossed < 0) crossed = i;
    if (!e._bodyAwake(idx) && slept < 0) slept = i;
  }
  return { crossed, maxA, slept };
}

// ---------------------------------------------------------------------------
// 1. Thin/tall drawn bars straddling a stone STEP edge: COM ends up past the
//    step, so they must tip to the low side and do it promptly.
for (const w of [1, 3]) {
  console.log(`thin drawn bar (w=${w}) topples off a stone step edge`);
  const e = mk();
  const floorY = ROWS - 2;
  stoneRect(e, 0, floorY, COLS - 1, ROWS - 1);
  stoneRect(e, 0, floorY - 3, COLS / 2, floorY - 1);     // raised left platform
  e.syncComponents();
  const idx = e._bodyCount();
  e.spawnBody(vSlab((COLS / 2) - ((w / 2) | 0), floorY - 3 - 20, w, 20));
  const r = topple(e, idx, 400);
  check(`bar w=${w} fully topples (max |angle| ${r.maxA.toFixed(0)} >= 80)`, r.maxA >= 80);
  check(`bar w=${w} tips past 45 deg promptly (@tick ${r.crossed}, want >=0 && < 100)`, r.crossed >= 0 && r.crossed < 100);
  e.destroy();
}

// ---------------------------------------------------------------------------
// 2. Two drawn bars in contact: a bar dropped leaning onto a standing bar must
//    still rotate over (contact with another body must not freeze rotation).
{
  console.log('drawn bar leaning onto another drawn bar topples over');
  const e = mk();
  const floorY = ROWS - 2;
  stoneRect(e, 0, floorY, COLS - 1, ROWS - 1); e.syncComponents();
  e.spawnBody(vSlab(80, floorY - 22, 2, 22));            // standing bar A
  const idxB = e._bodyCount();
  e.spawnBody(vSlab(74, floorY - 30, 2, 24));            // bar B, dropped tilted toward A
  e._setBodyMotion(idxB, 0.3, 0, 0.05);
  const r = topple(e, idxB, 500);
  check(`leaning bar topples (max |angle| ${r.maxA.toFixed(0)} >= 70)`, r.maxA >= 70);
  check(`leaning bar tips promptly (@tick ${r.crossed}, want >=0 && < 50)`, r.crossed >= 0 && r.crossed < 50);
  e.destroy();
}

// ---------------------------------------------------------------------------
// 3. STABILITY guard: a bar standing centred on FLAT ground (COM over its base)
//    must NOT spuriously topple, and must settle to sleep. This is what the
//    damping protects; the fix must not break it.
for (const w of [3, 5]) {
  console.log(`centred drawn bar (w=${w}) stays upright + sleeps on flat ground`);
  const e = mk();
  const floorY = ROWS - 2;
  stoneRect(e, 0, floorY, COLS - 1, ROWS - 1); e.syncComponents();
  const idx = e._bodyCount();
  e.spawnBody(vSlab(80 - ((w / 2) | 0), floorY - 20, w, 20));
  const r = topple(e, idx, 600);
  check(`centred bar w=${w} stays upright (max |angle| ${r.maxA.toFixed(1)} < 12)`, r.maxA < 12);
  check(`centred bar w=${w} settles to sleep (@tick ${r.slept})`, r.slept >= 0);
  e.destroy();
}

// ---------------------------------------------------------------------------
// 4. Determinism: the same scene twice yields the identical pose.
{
  console.log('topple is deterministic');
  const drive = () => {
    const e = mk();
    const floorY = ROWS - 2;
    stoneRect(e, 0, floorY, COLS - 1, ROWS - 1);
    stoneRect(e, 0, floorY - 3, COLS / 2, floorY - 1);
    e.syncComponents();
    const idx = e._bodyCount();
    e.spawnBody(vSlab((COLS / 2) - 1, floorY - 3 - 20, 3, 20));
    let t = 0; for (let i = 0; i < 200; i++) { t += 16; e.step(t); }
    const s = e._bodyState(idx); e.destroy(); return s;
  };
  const a = drive(), b = drive();
  check(`deterministic angle (${a.angle.toFixed(6)} == ${b.angle.toFixed(6)})`, a.angle === b.angle);
  check(`deterministic px/py`, a.px === b.px && a.py === b.py);
}

console.log(failures ? `\n${failures} checks FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
