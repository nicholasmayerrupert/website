// Terrain grain is keyed to absolute coordinates and must stay visually stable
// across a vertical world shift. Sparse exposure-edge lighting changes are allowed.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 256, ROWS = 256, SEED = 0xBEEF77; // chunk-aligned (multiples of 32)
const VISR = 96, MARGIN = 40;                  // MARGIN matches CAM_SHIFT_EDGE_MARGIN

let failures = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failures++; };

await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

console.log('schema-driven animated textures');
{
  const animated = ['FIRE', 'STEAM', 'ACRID_SMOKE', 'METHANE', 'WATER', 'OIL', 'ACID', 'LAVA', 'BRINE'];
  for (const name of animated) {
    const e = createEngineWasm({ cols: 64, rows: 64, worldSeed: SEED, sinksOn: false, infinite: false });
    e.getGrid().fill(MAT[name]);
    e.renderFull();
    const first = new Uint32Array(e.getRenderPixels().slice().buffer);
    let changed = 0;
    // Slow materials intentionally shimmer only every few 12 Hz presentation frames.
    for (let frame = 0; frame < 12 && changed === 0; frame++) {
      e.renderFull();
      const next = new Uint32Array(e.getRenderPixels().slice().buffer);
      for (let i = 0; i < first.length; i++) if (first[i] !== next[i]) changed++;
    }
    check(`${name.toLowerCase()} texture advances`, changed > first.length * 0.01, `(${changed}/${first.length} cells changed)`);
    e.destroy();
  }
  const e = createEngineWasm({ cols: 64, rows: 64, worldSeed: SEED, sinksOn: false, infinite: false });
  e.getGrid().fill(MAT.STONE);
  e.renderFull(); const first = new Uint32Array(e.getRenderPixels().slice().buffer);
  e.renderFull(); const next = new Uint32Array(e.getRenderPixels().slice().buffer);
  let changed = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== next[i]) changed++;
  check('non-animated terrain remains world-locked', changed === 0, `(${changed} cells changed)`);
  e.destroy();

  for (const name of ['FIRE', 'STEAM', 'ACRID_SMOKE', 'METHANE']) {
    const gas = createEngineWasm({ cols: 64, rows: 64, worldSeed: SEED, sinksOn: false, infinite: false });
    gas.getGrid().fill(MAT[name]);
    let hidden = 0, minAlpha = 255, maxAlpha = 0;
    for (let frame = 0; frame < 20; frame++) {
      gas.renderFull();
      const px = new Uint32Array(gas.getRenderPixels().slice().buffer);
      for (const c of px) {
        if (c === 0) hidden++;
        const alpha = c >>> 24;
        if (alpha < minAlpha) minAlpha = alpha;
        if (alpha > maxAlpha) maxAlpha = alpha;
      }
    }
    check(`${name.toLowerCase()} shimmer never creates invisible air holes`, hidden === 0, `(${hidden} hidden samples)`);
    if (name === 'METHANE') check('methane wisps have clear translucent density variation',
      minAlpha > 0 && maxAlpha < 255 && maxAlpha - minAlpha >= 40,
      `(alpha ${minAlpha}..${maxAlpha})`);
    gas.destroy();
  }
}

console.log('evolving gas wisps');
{
  const size = 96;
  for (const name of ['FIRE', 'STEAM', 'ACRID_SMOKE', 'METHANE']) {
    const e = createEngineWasm({ cols: size, rows: size, worldSeed: SEED, sinksOn: false, infinite: false });
    const grid = e.getGrid();
    grid.fill(MAT[name]);
    // A gap and isolated cell exercise the real occupied mask and exposed edges.
    grid[48 * size + 48] = MAT.EMPTY;
    for (let y = 8; y <= 10; y++) for (let x = 8; x <= 10; x++) grid[y * size + x] = MAT.EMPTY;
    grid[9 * size + 9] = MAT[name];
    const hash = e.gridHash();
    e.renderFull();
    const before = new Uint32Array(e.getRenderPixels().slice().buffer);
    let repeated = 0, compared = 0;
    for (let y = 16; y < 80; y++) for (let x = 8; x < 40; x++) {
      if (before[y * size + x] === before[y * size + x + 32]) repeated++;
      compared++;
    }
    check(`${name.toLowerCase()} wisps do not repeat a 32-cell stencil`, repeated < compared / 4,
      `(${repeated}/${compared} repeat)`);
    let contrast = 0, neighbors = 0;
    for (let y = 16; y < 80; y++) for (let x = 16; x < 79; x++) {
      for (const offset of [1, size]) {
        const a = before[y * size + x], b = before[y * size + x + offset];
        for (const shift of [0, 8, 16, 24]) contrast += Math.abs(((a >>> shift) & 255) - ((b >>> shift) & 255));
        neighbors++;
      }
    }
    check(`${name.toLowerCase()} texture retains fine detail between adjacent cells`, contrast / neighbors > (name === 'FIRE' ? 28 : 16),
      `(mean RGBA contrast ${(contrast / neighbors).toFixed(1)})`);
    for (let frame = 0; frame < 12; frame++) e.renderFull();
    const after = new Uint32Array(e.getRenderPixels().slice().buffer);
    let changed = 0, wrongMask = 0;
    for (let i = 0; i < after.length; i++) {
      if (before[i] !== after[i]) changed++;
      if (((after[i] >>> 24) > 0) !== (grid[i] !== MAT.EMPTY)) wrongMask++;
    }
    check(`${name.toLowerCase()} wisps visibly evolve`, changed > after.length / 3);
    check(`${name.toLowerCase()} opacity preserves empty gaps and isolated gas`, wrongMask === 0);
    check(`${name.toLowerCase()} animation leaves simulation state unchanged`, hash === e.gridHash());
    e.destroy();
  }
  // Equal presentation frames at the same absolute position must have equal
  // density after horizontal and vertical streaming, including negative offsets.
  const a = mk(), b = mk();
  b.shiftWorldXY(-32, 0); b.shiftWorldXY(0, -32);
  for (const name of ['FIRE', 'STEAM', 'ACRID_SMOKE', 'METHANE']) {
    a.getGrid().fill(MAT[name]); b.getGrid().fill(MAT[name]);
    a.renderFull(); b.renderFull();
    const ap = new Uint32Array(a.getRenderPixels().slice().buffer);
    const bp = new Uint32Array(b.getRenderPixels().slice().buffer);
    const dx = a.getWorldOffsetX() - b.getWorldOffsetX();
    const dy = a.getWorldOffsetY() - b.getWorldOffsetY();
    let mismatch = 0;
    for (let y = 16; y < 160; y++) for (let x = 16; x < 160; x++) {
      if ((ap[y * COLS + x] >>> 24) !== (bp[(y + dy) * COLS + x + dx] >>> 24)) mismatch++;
    }
    check(`${name.toLowerCase()} wisps remain continuous through two-axis streaming`, mismatch === 0);
  }
  a.destroy(); b.destroy();
}

console.log('animated liquid currents');
{
  const size = 64;
  const e = createEngineWasm({ cols: size, rows: size, worldSeed: SEED, sinksOn: false, infinite: false });
  e.getGrid().fill(MAT.WATER);
  e.renderFull();
  const before = new Uint32Array(e.getRenderPixels().slice().buffer);
  for (let i = 0; i < 16; i++) e.renderFull();
  const after = new Uint32Array(e.getRenderPixels().slice().buffer);
  let unchanged = 0, changed = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) unchanged++;
    else changed++;
  }
  check('water currents animate while retaining quiet interior areas', changed > size && unchanged > size,
    `(${changed} changed, ${unchanged} retained)`);
  e.destroy();
}

console.log('lava texture');
{
  const size = 64;
  const e = createEngineWasm({ cols: size, rows: size, worldSeed: SEED, sinksOn: false, infinite: false });
  e.getGrid().fill(MAT.LAVA);
  e.renderFull();
  const px = new Uint32Array(e.getRenderPixels().slice().buffer);
  const colors = new Map();
  for (const c of px) colors.set(c, (colors.get(c) || 0) + 1);
  check('lava uses a layered molten palette', colors.size >= 3, `(${colors.size} colors)`);

  let repeated = 0, compared = 0;
  for (let y = 8; y < 56; y++) for (let x = 4; x < 28; x++) {
    if (px[y * size + x] === px[y * size + x + 32]) repeated++;
    compared++;
  }
  check('lava does not repeat a 32-cell stencil', repeated < compared / 4,
    `(${repeated}/${compared} repeat)`);
  const center = 32 * size + 32;
  const bank = createEngineWasm({ cols:size, rows:size, worldSeed:SEED, sinksOn:false, infinite:false });
  bank.getGrid().fill(MAT.LAVA);
  for (let y = 0; y < size; y++) bank.getGrid()[y * size + 31] = MAT.STONE;
  bank.renderFull();
  const bankPixel = new Uint32Array(bank.getRenderPixels().slice().buffer)[center];
  check('lava meets a solid bank without a dark rim', bankPixel === px[center]);
  bank.destroy();
  const hash = e.gridHash();
  for (let frame = 0; frame < 6; frame++) e.renderFull();
  const next = new Uint32Array(e.getRenderPixels().slice().buffer);
  let changed = 0;
  for (let i = 0; i < px.length; i++) if (next[i] !== px[i]) changed++;
  check('molten currents visibly evolve within half a second', changed > px.length / 3);
  check('fluid animation leaves simulation state unchanged', hash === e.gridHash());
  e.destroy();
}

// Pan DOWN until one vertical world-shift fires; return its dy (>0) or 0 if none.
function shiftDownOnce(e) {
  const trigger = ROWS - VISR - MARGIN;
  let cam = MARGIN + 6;
  for (let f = 0; f < 20000; f++) {
    cam += 2;
    if (cam >= trigger) { const d = e.maybeShiftWorldV(cam, VISR, MARGIN); if (d) return d; }
  }
  return 0;
}

// renderFull twice and return a Uint32 copy of the pixels PLUS a per-cell "stable"
// mask. Animated materials can differ between passes and are excluded. Static
// terrain remains keyed to absolute world position and is compared strictly.
function renderStable(e) {
  e.renderFull(); const a = new Uint32Array(e.getRenderPixels().slice().buffer);
  e.renderFull(); const b = new Uint32Array(e.getRenderPixels().slice().buffer);
  const stable = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) stable[i] = a[i] === b[i] ? 1 : 0;
  return { px: a, stable };
}

console.log('render-noise stability across a vertical world-shift (pan down)');
{
  const e = mk();
  const oy0 = e.getWorldOffsetY();
  const before = renderStable(e);
  const g0 = e.getGrid().slice();

  const dy = shiftDownOnce(e);
  const oy1 = e.getWorldOffsetY();
  const after = renderStable(e);
  const g1 = e.getGrid();

  check('a vertical shift fired', dy > 0, `dy=${dy}`);
  check('shift advanced worldOffsetY by a non-multiple of 64 (the trap)', ((oy1 - oy0) & 63) !== 0, `dOffY=${oy1 - oy0}`);

  // Overlap = world rows present in BOTH buffers. In buffer space: a world row WY is
  // at y0 = WY-oy0 before and y1 = WY-oy1 after. Compare cells whose material is
  // unchanged (the slid content) and stable in both renders.
  let compared = 0, mismatch = 0, firstBadWY = -1;
  const loWY = Math.max(oy0, oy1), hiWY = Math.min(oy0 + ROWS, oy1 + ROWS) - 1;
  for (let wy = loWY; wy <= hiWY; wy++) {
    const y0 = wy - oy0, y1 = wy - oy1;
    for (let x = 0; x < COLS; x++) {
      const k0 = y0 * COLS + x, k1 = y1 * COLS + x;
      if (g0[k0] !== g1[k1]) continue;             // content changed here (band edge) — skip
      if (!before.stable[k0] || !after.stable[k1]) continue; // animated cell — skip
      compared++;
      if (before.px[k0] !== after.px[k1]) { mismatch++; if (firstBadWY < 0) firstBadWY = wy; }
    }
  }
  check('meaningful number of overlapping cells compared', compared > 5000, `(${compared})`);
  const mismatchRate = compared ? mismatch / compared : 1;
  check('grain stays stable across the shift apart from sparse render-lighting changes',
    mismatchRate < 0.05,
    mismatch ? `${mismatch}/${compared} cells differed (${(mismatchRate * 100).toFixed(2)}%, first at worldRow ${firstBadWY})` : `(${compared} cells matched)`);
  e.destroy();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
