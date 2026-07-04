// Rigorous validation of incremental grounding (the acid-on-stone speedup).
//
//   node scripts/grounding-incremental-test.mjs
//
// groundedCell[] is a pure function of the grid, so the incremental fast path is
// correct iff it produces the identical array to a full reflood. Two guarantees:
//   1. VERIFY: run the fast path AND a full reflood every step, assert 0 mismatches
//      across a long randomized fuzz of paint/erase/acid/lava/ice/water/sand ops.
//   2. CHECKSUM: run the same scenario twice — fast path vs forced-full-reflood —
//      and assert the grid checksum matches at EVERY step (byte-identical behavior).

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
// Every engine in this file gets the test hooks (grounding/body/particle pokes).
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));

await initSandWasm();
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

const COLS = 160, ROWS = 160;
const EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, OIL = 4, ACID = 10, LAVA = 11, ICE = 12, PLANT = 9, WOOD = 8;

// A small deterministic PRNG so the fuzz scenario is reproducible (no Math.random).
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Apply one scripted operation to an engine. Same script must be replayable on two
// engines so their grids stay comparable. `op` is a plain data object.
function applyOp(e, op) {
  if (op.t === 'paint') e.paintDisc(op.x, op.y, op.r, op.m, true);
  else if (op.t === 'erase') e.paintDisc(op.x, op.y, op.r, EMPTY, true);
  else if (op.t === 'sync') e.syncComponents();
}

// Build a reproducible op script: a stone structure, then rounds of acid/lava/water/
// sand drops, erases, and re-syncs — the full variety of grounding-relevant changes.
function buildScript(seed) {
  const rand = rng(seed);
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const ops = [];
  // initial terrain: floor + a few stone/ice/plant blobs
  for (let x = 0; x < COLS; x++) ops.push({ t: 'paint', x, y: ROWS - 2, r: 1, m: STONE });
  for (let i = 0; i < 6; i++) ops.push({ t: 'paint', x: ri(20, 140), y: ri(60, 150), r: ri(6, 16), m: STONE });
  ops.push({ t: 'paint', x: 40, y: 120, r: 10, m: ICE });
  ops.push({ t: 'paint', x: 120, y: 120, r: 8, m: PLANT });
  ops.push({ t: 'sync' });
  // interleave step markers (null) with random material drops / erases
  const mats = [ACID, LAVA, WATER, SAND, OIL, STONE, ICE];
  for (let round = 0; round < 240; round++) {
    if (rand() < 0.5) ops.push({ t: 'paint', x: ri(10, 150), y: ri(10, 60), r: ri(2, 7), m: mats[ri(0, mats.length - 1)] });
    if (rand() < 0.25) ops.push({ t: 'erase', x: ri(10, 150), y: ri(60, 150), r: ri(2, 6) });
    if (rand() < 0.10) ops.push({ t: 'sync' });
    ops.push({ t: 'step' });
    if (rand() < 0.15) ops.push({ t: 'step' }); // sometimes several steps between edits
  }
  return ops;
}

// ---------------------------------------------------------------------------
// 1. VERIFY: fast path vs full reflood agree on groundedCell/cellComp every step.
{
  console.log('verify: incremental grounding matches a full reflood every step');
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false });
  e.setGroundingDebug(true, false); // verify on, fast path active
  const ops = buildScript(0xABCDEF);
  let t = 0;
  for (const op of ops) {
    if (op.t === 'step') { t += 16; e.step(t); } else applyOp(e, op);
  }
  const mism = e.groundingMismatches();
  check(`zero grounding mismatches across the fuzz (${mism})`, mism === 0);
  e.destroy();
}

// ---------------------------------------------------------------------------
// 2. CHECKSUM: fast path and forced-full-reflood produce byte-identical grids.
{
  console.log('checksum: fast path == forced full reflood, every step');
  const ops = buildScript(0x13579B);
  const mkEngine = (forceFull) => {
    const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 9, sinksOn: false });
    e.setGroundingDebug(false, forceFull);
    return e;
  };
  const a = mkEngine(false); // incremental fast path
  const b = mkEngine(true);  // always full reflood (the reference)
  const sum = (e) => { const g = e.getGrid(); let h = 0; for (let i = 0; i < g.length; i++) h = (h * 31 + g[i]) >>> 0; return h; };
  let t = 0, diverged = -1, steps = 0;
  for (const op of ops) {
    if (op.t === 'step') {
      t += 16; a.step(t); b.step(t); steps++;
      if (sum(a) !== sum(b)) { diverged = steps; break; }
    } else { applyOp(a, op); applyOp(b, op); }
  }
  check(`grids identical across all ${steps} steps (first divergence: ${diverged})`, diverged === -1);
  a.destroy(); b.destroy();
}

// ---------------------------------------------------------------------------
// 3. ACID BURN: the scenario the fast path targets. Acid bores a channel through a
//    grounded stone wall. Assert the fast path is BYTE-identical to a full reflood
//    AND that it actually fires (a future change can't silently disable it), AND
//    that grids stay identical to forced-full every step.
{
  console.log('acid burn through stone: fast path is exercised and byte-identical');
  const STONE = 3, ACID = 10;
  const buildBurn = (e) => {
    for (let y = 30; y < ROWS - 1; y++) for (let x = 10; x < COLS - 10; x++) e.paintDisc(x, y, 0, STONE, true);
    for (let x = 0; x < COLS; x++) e.paintDisc(x, ROWS - 1, 0, STONE, true);
    e.syncComponents();
    for (let y = 14; y < 30; y++) for (let x = 70; x < 90; x++) e.paintDisc(x, y, 0, ACID, true); // narrow channel
  };
  // verify byte-equality + that the fast path fired
  const v = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 11, sinksOn: false });
  v.setGroundingDebug(true, false);
  buildBurn(v);
  let t = 0; for (let i = 0; i < 300; i++) { t += 16; v.step(t); }
  const diag = v.groundingDiag();
  check(`acid-burn grounding matches reflood (${v.groundingMismatches()} mismatches)`, v.groundingMismatches() === 0);
  check(`acid-burn fast path actually fired (fast=${diag.fast})`, diag.fast > 0);
  v.destroy();
  // checksum: fast vs forced-full identical every step
  const a = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 13, sinksOn: false }); a.setGroundingDebug(false, false);
  const b = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 13, sinksOn: false }); b.setGroundingDebug(false, true);
  buildBurn(a); buildBurn(b);
  const sum = (e) => { const g = e.getGrid(); let h = 0; for (let i = 0; i < g.length; i++) h = (h * 31 + g[i]) >>> 0; return h; };
  let t2 = 0, diverged = -1;
  for (let i = 0; i < 300; i++) { t2 += 16; a.step(t2); b.step(t2); if (sum(a) !== sum(b)) { diverged = i; break; } }
  check(`acid-burn grids identical to forced-full (first divergence ${diverged})`, diverged === -1);
  a.destroy(); b.destroy();
}

// ---------------------------------------------------------------------------
// 4. WIDE ACID FRONT: the partition's reason for existing. A broad acid pool eats a
//    broad stone surface; the per-step removed batch spans far more than SPAN (128),
//    so the OLD whole-batch check bailed on `span` every step and refooded. Partitioning
//    into 8-connected components must (a) stay byte-identical to a full reflood, and
//    (b) drive the whole-batch span bail to zero -- each small component fast-paths
//    instead. (Genuine chip detachments still reflood via `cut`; that is correct.)
{
  console.log('wide acid front: partitioned fast path is byte-identical and never span-bails');
  const STONE = 3, ACID = 10;
  const buildWide = (e) => {
    for (let y = 40; y < ROWS - 1; y++) for (let x = 6; x < COLS - 6; x++) e.paintDisc(x, y, 0, STONE, true);
    for (let x = 0; x < COLS; x++) e.paintDisc(x, ROWS - 1, 0, STONE, true);
    e.syncComponents();
    for (let y = 20; y < 40; y++) for (let x = 20; x < COLS - 20; x++) e.paintDisc(x, y, 0, ACID, true); // wide pool, ~SPAN wide
  };
  const v = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 17, sinksOn: false });
  v.setGroundingDebug(true, false);
  buildWide(v);
  let t = 0; for (let i = 0; i < 200; i++) { t += 16; v.step(t); }
  const diag = v.groundingDiag();
  check(`wide-front grounding matches reflood (${v.groundingMismatches()} mismatches)`, v.groundingMismatches() === 0);
  check(`wide-front never bails on the whole-batch span (span=${diag.span})`, diag.span === 0);
  check(`wide-front fast path actually fired (fast=${diag.fast})`, diag.fast > 0);
  v.destroy();
}

console.log(failures ? `\n${failures} checks FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
