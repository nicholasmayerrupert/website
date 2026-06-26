// Phase C: the creative palette can spawn ANY material (components draft with a live
// preview then finalize; powders/liquids paint), place a seed for any species, and the
// eraser/cube. Driven through the engine's creative pointer state machine.
// Run: node scripts/creative-place-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const CK = { MATERIAL: 0, SEED: 1, ERASER: 2, CUBE: 3 };
const PT = { OAK: 0, PINE: 1, WILLOW: 2, CACTUS: 3, MUSHROOM: 4, BUSH: 5 };
const COLS = 100, ROWS = 80;
await initSandWasm();
const { check, done } = makeChecker('creative spawn-everything (Phase C)');
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
const at = (g, x, y) => g[y * COLS + x];

// 1) Any COMPONENT material drafts with a live preview, then finalizes into the grid.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.COPPER_ORE);
  e.pointerDown(50, 40, 0);
  check(`copper ore shows a draft preview (${e.getStoneDraftCells().length} cells)`, e.getStoneDraftCells().length > 0);
  e.pointerUp(0);
  check('copper ore finalized into the grid', at(e.getGrid(), 50, 40) === MAT.COPPER_ORE);
  e.destroy();
}

// 2) A different component (brick) drafts + finalizes the same generic way.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.BRICK);
  e.pointerDown(30, 30, 0);
  e.pointerUp(0);
  check('brick finalized into the grid', at(e.getGrid(), 30, 30) === MAT.BRICK);
  e.destroy();
}

// 3) A powder paints continuously (no draft).
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.SAND);
  e.pointerDown(50, 20, 0);
  let t = 0; for (let i = 0; i < 3; i++) { t += 20; e.applyTool(50, 20, t, true, true); }
  e.pointerUp(0);
  let sand = 0; for (const v of e.getGrid()) if (v === MAT.SAND) sand++;
  check(`sand painted continuously (${sand} cells)`, sand > 0);
  e.destroy();
}

// 4) Seed species: a pine seed drafts + places SEED cells.
{
  const e = mk();
  e.setCreativeMaterial(CK.SEED, PT.PINE);
  e.pointerDown(50, 40, 0);
  e.pointerUp(0);
  let seeds = 0; for (const v of e.getGrid()) if (v === MAT.SEED) seeds++;
  check(`pine seed placed one SEED cell (${seeds})`, seeds === 1);
  e.destroy();
}

// 5) Default material SEED follows the seed path too, not the generic solid draft.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.SEED);
  e.pointerDown(50, 40, 0);
  check('default seed does not create a stone-style draft preview', e.getStoneDraftCells().length === 0);
  e.pointerUp(0);
  let seeds = 0; for (const v of e.getGrid()) if (v === MAT.SEED) seeds++;
  check(`default seed placed one SEED cell (${seeds})`, seeds === 1);
  e.destroy();
}

// 6) Cube spawns a free rigid body.
{
  const e = mk();
  e.setCreativeMaterial(CK.CUBE, 0);
  e.pointerDown(50, 40, 0);
  check('cube spawned a rigid body', e._bodyCount() > 0);
  e.destroy();
}

// 7) The RIGID material selector drafts an arbitrary free body shape. The separate
// cube entry above stays the one-click cube tool.
{
  const e = mk();
  e.setCreativeMaterial(CK.MATERIAL, MAT.RIGID);
  e.pointerDown(50, 40, 0);
  check(`rigid material shows a draft preview (${e.getStoneDraftCells().length} cells)`, e.getStoneDraftCells().length > 0);
  check('rigid material did not spawn a cube on press', e._bodyCount() === 0);
  for (let x = 51; x <= 55; x++) e.pointerDraft(x, 40);
  e.pointerUp(0);
  check('rigid material finalized as one free rigid body', e._bodyCount() === 1);
  e.destroy();
}

// 8) Legacy stone/ice draft path (used by other tests + back-compat) still finalizes.
{
  const e = mk();
  e.addDiscToStoneDraft(60, 60, 0);
  e.finalizeStoneDraft();
  check('legacy stone draft still finalizes', at(e.getGrid(), 60, 60) === MAT.STONE);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
