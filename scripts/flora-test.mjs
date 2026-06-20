// Phase 4 flora: per-species trees grow with distinct rules/materials. PT_OAK is
// the original behavior. Cactus/mushroom grow WITHOUT water (desert/cave); each
// species is made of its own wood/leaf material so the type survives streaming.
// Run: node scripts/flora-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 160, ROWS = 120;
const PT = { OAK: 0, PINE: 1, WILLOW: 2, CACTUS: 3, MUSHROOM: 4, BUSH: 5 };
await initSandWasm();
const { check, done } = makeChecker('flora types (Phase 4)');

const LEAF = new Set([MAT.PLANT, MAT.MUSH_CAP]);
const PLANTISH = new Set([MAT.SEED, MAT.WOOD, MAT.PLANT, MAT.PINE_WOOD, MAT.CACTUS, MAT.MUSH_STEM, MAT.MUSH_CAP, MAT.VINE]);

// Grow one seeded tree on a stone floor; water it unless it's a dry species.
function grow(type, water, steps = 1100) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 20; x < 140; x++) for (let y = 90; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.placeSeedTyped(70, 88, type);
  let t = 0;
  for (let s = 0; s < steps; s++) { if (water && s % 15 === 0) e.paintDisc(70, 86, 2, MAT.WATER, false); t += 16; e.step(t); }
  const g = e.getGrid();
  const cnt = {}; let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, leaves = 0;
  for (let i = 0; i < g.length; i++) {
    if (!PLANTISH.has(g[i])) continue;
    const x = i % COLS, y = (i / COLS) | 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    cnt[g[i]] = (cnt[g[i]] || 0) + 1; if (LEAF.has(g[i])) leaves++;
  }
  e.destroy();
  return { cnt, leaves, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const oak = grow(PT.OAK, true);
check(`oak grows wood + foliage (${oak.cnt[MAT.WOOD]}w ${oak.cnt[MAT.PLANT]}l)`, oak.cnt[MAT.WOOD] > 10 && oak.cnt[MAT.PLANT] > 10);

const pine = grow(PT.PINE, true);
check(`pine is its own wood (PINE_WOOD ${pine.cnt[MAT.PINE_WOOD] || 0})`, (pine.cnt[MAT.PINE_WOOD] || 0) > 10);
check(`pine grows tall & narrow (h ${pine.h} > w ${pine.w})`, pine.h > pine.w * 2);

const willow = grow(PT.WILLOW, true);
check(`willow is narrower than oak (w ${willow.w} < oak w ${oak.w})`, willow.w < oak.w);

const bush = grow(PT.BUSH, true);
check(`bush stays short & leafy (h ${bush.h}, leaves ${bush.leaves})`, bush.h < oak.h / 2 && bush.leaves > 0);

const cactus = grow(PT.CACTUS, false); // NO water
check(`cactus grows WITHOUT water as CACTUS (${cactus.cnt[MAT.CACTUS] || 0})`, (cactus.cnt[MAT.CACTUS] || 0) > 8);
check(`cactus has zero foliage (leaves ${cactus.leaves})`, cactus.leaves === 0);

const mush = grow(PT.MUSHROOM, false); // NO water
check(`mushroom grows WITHOUT water: stem + cap (${mush.cnt[MAT.MUSH_STEM] || 0} stem, ${mush.cnt[MAT.MUSH_CAP] || 0} cap)`, (mush.cnt[MAT.MUSH_STEM] || 0) > 4 && (mush.cnt[MAT.MUSH_CAP] || 0) > 4);

// Worldgen produces typed flora (trees are stamped into the background layer).
{
  const e = createEngineWasm({ cols: 220, rows: 160, worldSeed: 0xBED, sinksOn: false, infinite: true });
  const woods = new Set();
  for (let i = 0; i < 40; i++) {
    const g = e.getGridBg();
    for (const v of g) if (v === MAT.WOOD || v === MAT.PINE_WOOD || v === MAT.CACTUS) woods.add(v);
    e.shiftWorldXY(128, 0);
  }
  check(`worldgen stamps multiple tree species (${[...woods].length} wood types)`, woods.size >= 2);
  e.destroy();
}

// Type persistence across streaming: a grown cactus's cells (which ENCODE the
// species) survive a shift off-buffer and back via the tile store.
{
  const C = 220, R = 140, SX = 110;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: 9, sinksOn: false, infinite: true });
  // find the solid surface top in column SX and seat the seed just above it
  let top = R; { const g = e.getGrid(); for (let y = 0; y < R; y++) { const v = g[y * C + SX]; if (v !== MAT.EMPTY && v !== MAT.WATER) { top = y; break; } } }
  const placed = e.placeSeedTyped(SX, top - 3, PT.CACTUS);
  check('cactus seed placed in the infinite world', placed);
  let t = 0; for (let s = 0; s < 900; s++) { t += 16; e.step(t); }
  const count = (en) => { const g = en.getGrid(); let n = 0; for (const v of g) if (v === MAT.CACTUS) n++; return n; };
  const before = count(e);
  e.shiftWorldXY(128, 0); // stream the cactus off the left edge
  const offEdge = count(e);
  e.shiftWorldXY(-128, 0); // stream it back in from the tile store
  const after = count(e);
  check(`grown cactus persists across streaming (${before} -> off ${offEdge} -> ${after})`, before > 8 && offEdge === 0 && after === before);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
