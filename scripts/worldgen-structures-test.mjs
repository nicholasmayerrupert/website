// Phase 3 worldgen: ore veins + cave-wall MOSS + stamped ruins. All are pure
// functions of world coords, inert (solid-in-solid or carved air), and must be
// BYTE-IDENTICAL across streaming (a ruin straddling a band seam regenerates
// the same), persisted by the tile store. Run: node scripts/worldgen-structures-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 220, ROWS = 160, SEED = 0xBED;
await initSandWasm();
const { check, done } = makeChecker('worldgen structures (Phase 3)');
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

// --- ores + ruins actually generate while exploring ---
{
  const e = mk();
  const tally = { ore: 0, brick: 0, moss: 0 };
  const oreIds = new Set([MAT.COPPER_ORE, MAT.IRON_ORE, MAT.COAL_ORE, MAT.GOLD_ORE]);
  for (let i = 0; i < 25; i++) {
    const g = e.getGrid();
    for (const v of g) { if (oreIds.has(v)) tally.ore++; else if (v === MAT.BRICK) tally.brick++; else if (v === MAT.MOSS) tally.moss++; }
    e.shiftWorldXY(128, 0);
  }
  check(`ore veins generate (${tally.ore} cells)`, tally.ore > 500);
  check(`ruins (BRICK) generate (${tally.brick} cells)`, tally.brick > 30);
  check(`cave-wall MOSS generates (${tally.moss} cells)`, tally.moss > 30);
  e.destroy();
}

// --- a ruin region is byte-identical across streaming (seam determinism) ---
{
  const e = mk();
  // locate a ruin in the current buffer
  let bx = -1, by = -1;
  { const g = e.getGrid(); for (let i = 0; i < g.length; i++) if (g[i] === MAT.BRICK) { bx = i % COLS; by = (i / COLS) | 0; break; } }
  check('found a ruin to test', bx >= 0);
  const wx0 = e.getWorldOffsetX() + bx - 12, wy0 = e.getWorldOffsetY() + by - 8, W = 28, H = 24;
  const snap = (en) => {
    const g = en.getGrid(), ox = en.getWorldOffsetX(), oy = en.getWorldOffsetY(), m = [];
    for (let wy = wy0; wy < wy0 + H; wy++) for (let wx = wx0; wx < wx0 + W; wx++) {
      const cx = wx - ox, cy = wy - oy;
      m.push(cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS ? -1 : g[cy * COLS + cx]);
    }
    return m;
  };
  const ref = snap(e);
  // stream the region fully off-buffer and back, so it is rebuilt by BAND fills
  // (with the structure overscan) rather than the initial whole-buffer fill.
  e.shiftWorldXY(128, 0); e.shiftWorldXY(128, 0); e.shiftWorldXY(0, 96);
  e.shiftWorldXY(-128, 0); e.shiftWorldXY(-128, 0); e.shiftWorldXY(0, -96);
  const after = snap(e);
  let mism = 0, brickCells = 0;
  for (let i = 0; i < ref.length; i++) { if (ref[i] === MAT.BRICK) brickCells++; if (ref[i] !== after[i]) mism++; }
  check(`region contains a ruin (${brickCells} brick cells)`, brickCells > 8);
  check(`ruin region is byte-identical after streaming (mismatches ${mism})`, mism === 0);
  e.destroy();
}

// --- structures/ores keep the generated world inert ---
{
  const e = mk();
  for (let i = 0; i < 6; i++) e.shiftWorldXY(0, 96); // descend into the cave/ruin/ore zone
  let t = 0, settledAt = -1;
  for (let i = 0; i < 1500; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  check(`world with ores/ruins settles to inert (step ${settledAt})`, settledAt >= 0 && settledAt < 1500);
  e.destroy();
}

// --- caves are carved (traversable EMPTY) within the cave zone ---
{
  const e = mk();
  for (let i = 0; i < 2; i++) e.shiftWorldXY(0, 96); // mid cave zone (above caveBottom ~ rows*9/5)
  const g = e.getGrid();
  let empty = 0; for (const v of g) if (v === MAT.EMPTY) empty++;
  const frac = empty / g.length;
  check(`caves are carved in the cave zone (empty frac ${frac.toFixed(2)})`, frac > 0.05);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
