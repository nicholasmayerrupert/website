// Validates incremental grounding against a full reflood using per-cell mismatch
// checks and per-step grid checksums over deterministic mixed-material edits.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
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

// ---------------------------------------------------------------------------
// 5. LOOSE-STATIC SKIP: powder/liquid sitting still must not change outcomes vs a
//    forced full reflood every step. This locks the looseGroundDirty gate (powder
//    presence alone no longer forces joint/overlay work) — a wrong dirty signal
//    would desync free-body support / buoyancy and the grid checksum.
{
  console.log('loose-static skip: settled powder/liquid matches forced-full every step');
  const sum = (e) => { const g = e.getGrid(); let h = 0; for (let i = 0; i < g.length; i++) h = (h * 31 + g[i]) >>> 0; return h; };
  const buildLoose = (e) => {
    for (let x = 0; x < COLS; x++) e.paintDisc(x, ROWS - 1, 0, STONE, true);
    for (let y = ROWS - 40; y < ROWS - 1; y++) for (let x = 20; x < COLS - 20; x++) e.paintDisc(x, y, 0, STONE, true);
    e.syncComponents();
    // soil-like powder cap + a small water puddle that settles
    for (let x = 30; x < COLS - 30; x++) e.paintDisc(x, ROWS - 41, 0, SAND, true);
    for (let y = ROWS - 50; y < ROWS - 42; y++) for (let x = 60; x < 90; x++) e.paintDisc(x, y, 0, WATER, true);
  };
  const a = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 19, sinksOn: false, bgEnabled: true });
  const b = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 19, sinksOn: false, bgEnabled: true });
  a.setGroundingDebug(false, false);
  b.setGroundingDebug(false, true);
  buildLoose(a); buildLoose(b);
  let t = 0, diverged = -1, steps = 0;
  // Settle, then many idle steps (the skip path), then a sand drop + more idle.
  for (let i = 0; i < 80; i++) { t += 16; a.step(t); b.step(t); steps++; if (sum(a) !== sum(b)) { diverged = steps; break; } }
  if (diverged < 0) {
    for (let i = 0; i < 120; i++) { t += 16; a.step(t); b.step(t); steps++; if (sum(a) !== sum(b)) { diverged = steps; break; } }
  }
  if (diverged < 0) {
    a.paintDisc(80, 20, 4, SAND, true);
    b.paintDisc(80, 20, 4, SAND, true);
    for (let i = 0; i < 100; i++) { t += 16; a.step(t); b.step(t); steps++; if (sum(a) !== sum(b)) { diverged = steps; break; } }
  }
  check(`loose-static grids identical across ${steps} steps (first divergence: ${diverged})`, diverged === -1);
  // Dual-layer verify: grounded arrays still match a forced full path under powder load.
  const v = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 23, sinksOn: false, bgEnabled: true });
  v.setGroundingDebug(true, false);
  buildLoose(v);
  t = 0;
  for (let i = 0; i < 60; i++) { t += 16; v.step(t); }
  v.paintDisc(70, 15, 5, SAND, true);
  for (let i = 0; i < 40; i++) { t += 16; v.step(t); }
  check(`loose-static dual-layer grounding mismatches (${v.groundingMismatches()})`, v.groundingMismatches() === 0);
  a.destroy(); b.destroy(); v.destroy();
}

// ---------------------------------------------------------------------------
// 6. JOINT-IDLE SKIP: dual-layer structure that settles, then idles many steps,
//    then is edited / given falling loose material. Optimized path must match
//    forced-full joint on grids every step. Locks the idle-structure joint gate
//    (no always-on joint solely because stone exists in marked rows).
{
  console.log('joint-idle skip: settled dual-layer structure matches forced-full every step');
  const sumBoth = (e) => {
    const fg = e.getGrid(), bg = e.getGridBg ? e.getGridBg() : null;
    let h = 0;
    for (let i = 0; i < fg.length; i++) h = (h * 31 + fg[i]) >>> 0;
    if (bg) for (let i = 0; i < bg.length; i++) h = (h * 31 + bg[i]) >>> 0;
    return h;
  };
  // Dual-layer place via shipped placeMaterial (layer 0|1).
  const mk = (forceFull) => {
    const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 29, sinksOn: false, bgEnabled: true });
    e.setGroundingDebug(false, forceFull);
    if (typeof e.setBgEnabled === 'function') e.setBgEnabled(true);
    return e;
  };
  const paintBoth = (e, x, y, r, m, layer /* 0|1|both */) => {
    if (layer === 0 || layer === 'both' || layer == null) {
      if (typeof e.placeMaterial === 'function') e.placeMaterial(x, y, r, m, 0);
      else e.paintDisc(x, y, r, m, true);
    }
    if (layer === 1 || layer === 'both' || layer == null) {
      if (typeof e.placeMaterial === 'function') e.placeMaterial(x, y, r, m, 1);
      else if (typeof e.paintDiscBg === 'function') e.paintDiscBg(x, y, r, m, true);
    }
  };
  const buildDualPlace = (e) => {
    for (let x = 0; x < COLS; x++) {
      paintBoth(e, x, ROWS - 1, 0, STONE, 'both');
    }
    for (let y = ROWS - 50; y < ROWS - 1; y++) {
      for (let x = 40; x < 55; x++) paintBoth(e, x, y, 0, STONE, 'both');
    }
    for (let y = ROWS - 52; y < ROWS - 48; y++) {
      for (let x = 40; x < 100; x++) paintBoth(e, x, y, 0, STONE, 0);
    }
    for (let y = ROWS - 48; y < ROWS - 1; y++) {
      for (let x = 90; x < 100; x++) paintBoth(e, x, y, 0, STONE, 1);
    }
    e.syncComponents();
  };
  const a = mk(false);
  const b = mk(true);
  buildDualPlace(a); buildDualPlace(b);
  let t = 0, diverged = -1, steps = 0;
  // Settle structure
  for (let i = 0; i < 40; i++) {
    t += 16; a.step(t); b.step(t); steps++;
    if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
  }
  // Idle many steps — joint must be skippable without desync vs forced-full
  if (diverged < 0) {
    for (let i = 0; i < 160; i++) {
      t += 16; a.step(t); b.step(t); steps++;
      if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
    }
  }
  // Erode part of the bg support post, then idle again — joint must re-run and stay correct
  if (diverged < 0) {
    for (let y = ROWS - 40; y < ROWS - 10; y++) {
      for (let x = 90; x < 100; x++) {
        if (typeof a.placeMaterial === 'function') {
          a.placeMaterial(x, y, 0, EMPTY, 1);
          b.placeMaterial(x, y, 0, EMPTY, 1);
        }
      }
    }
    a.syncComponents(); b.syncComponents();
    for (let i = 0; i < 120; i++) {
      t += 16; a.step(t); b.step(t); steps++;
      if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
    }
  }
  // Drop loose sand onto the structure
  if (diverged < 0) {
    for (let x = 50; x < 80; x++) {
      paintBoth(a, x, 20, 2, SAND, 0);
      paintBoth(b, x, 20, 2, SAND, 0);
    }
    for (let i = 0; i < 100; i++) {
      t += 16; a.step(t); b.step(t); steps++;
      if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
    }
  }
  check(`joint-idle grids identical across ${steps} steps (first divergence: ${diverged})`, diverged === -1);

  // VERIFY mode: grounded arrays match forced full under idle + edit
  const v = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 31, sinksOn: false, bgEnabled: true });
  v.setGroundingDebug(true, false);
  if (typeof v.setBgEnabled === 'function') v.setBgEnabled(true);
  buildDualPlace(v);
  t = 0;
  for (let i = 0; i < 50; i++) { t += 16; v.step(t); }
  for (let i = 0; i < 80; i++) { t += 16; v.step(t); }
  for (let x = 50; x < 70; x++) paintBoth(v, x, 15, 3, SAND, 0);
  for (let i = 0; i < 60; i++) { t += 16; v.step(t); }
  check(`joint-idle dual-layer grounding mismatches (${v.groundingMismatches()})`, v.groundingMismatches() === 0);
  a.destroy(); b.destroy(); v.destroy();
}

// ---------------------------------------------------------------------------
// 7. LOCALIZED LOOSE OVERLAY + STREAM: dual-layer world with streaming and local
//    powder motion must stay grid-identical to forced-full. Locks column-local
//    only-loose refresh (and that stream still refloods correctly).
{
  console.log('stream+loose overlay: optimized matches forced-full across shifts');
  const sumBoth = (e) => {
    const fg = e.getGrid(), bg = e.getGridBg ? e.getGridBg() : null;
    let h = 0;
    for (let i = 0; i < fg.length; i++) h = (h * 31 + fg[i]) >>> 0;
    if (bg) for (let i = 0; i < bg.length; i++) h = (h * 31 + bg[i]) >>> 0;
    return h;
  };
  const mk = (forceFull) => {
    const e = createEngineWasm({
      cols: 128, rows: 96, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true, bgEnabled: true,
    });
    e.setGroundingDebug(false, forceFull);
    if (typeof e.setBgEnabled === 'function') e.setBgEnabled(true);
    return e;
  };
  const a = mk(false), b = mk(true);
  // Seed some loose motion, step, shift, drop more sand, step.
  for (let i = 0; i < 20; i++) {
    a.paintDisc(30 + (i % 10) * 4, 20 + (i % 5), 2, SAND, true);
    b.paintDisc(30 + (i % 10) * 4, 20 + (i % 5), 2, SAND, true);
  }
  let t = 0, diverged = -1, steps = 0;
  for (let i = 0; i < 40; i++) {
    t += 16; a.step(t); b.step(t); steps++;
    if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
  }
  if (diverged < 0 && typeof a.shiftWorld === 'function') {
    a.shiftWorld(32); b.shiftWorld(32);
    for (let i = 0; i < 24; i++) {
      t += 16; a.step(t); b.step(t); steps++;
      if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
    }
    a.shiftWorld(-32); b.shiftWorld(-32);
    for (let i = 0; i < 16; i++) {
      a.paintDisc(40 + i, 15, 2, SAND, true);
      b.paintDisc(40 + i, 15, 2, SAND, true);
    }
    for (let i = 0; i < 40; i++) {
      t += 16; a.step(t); b.step(t); steps++;
      if (sumBoth(a) !== sumBoth(b)) { diverged = steps; break; }
    }
  }
  check(`stream+loose grids identical across ${steps} steps (first divergence: ${diverged})`, diverged === -1);
  a.destroy(); b.destroy();
}

console.log(failures ? `\n${failures} checks FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
