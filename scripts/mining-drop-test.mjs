// Phase C: mining drops. A destroyed cell yields a dropped ITEM only when the
// player's held tool class + tier satisfies the material's gate (the bare hand also
// drops loose shovel-tier-0 soils). Wrong tool/tier still breaks the block, it just
// yields nothing. Run: node scripts/mining-drop-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { makeChecker, gridHash } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100;
await initSandWasm();
const { check, done } = makeChecker('mining drops (Phase C)');

// Place a blob of `mat`, equip (cls,tier), mine its center until destroyed. No
// stepping: items persist where spawned and the placed solid stays put.
function mineBlob(mat, cls, tier, { hits = 80, placeR = 2 } = {}) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 3, sinksOn: false, infinite: false });
  const id = e.spawnPlayer(40, 40);
  e.setPlayerTool(id, cls, tier);
  e.placeMaterial(60, 50, placeR, mat);
  for (let i = 0; i < hits; i++) e.playerMine(id, 60, 50);
  const items = e.getItems();
  const drops = items.filter((it) => it.kind === 0 && it.material === mat); // IT_ITEM of mat
  const centerEmpty = e.getGrid()[50 * COLS + 60] === MAT.EMPTY;
  const r = { drops: drops.length, centerEmpty, hash: gridHash(e.getGrid()), itemCount: e.itemCount() };
  e.destroy();
  return r;
}

// 1) Right tool + tier: pickaxe (wood) on stone -> stone drops.
{
  const r = mineBlob(MAT.STONE, TC.pickaxe, TT.wood);
  check(`pickaxe mines stone into stone drops (${r.drops})`, r.drops > 0);
  check('stone block is destroyed', r.centerEmpty);
}

// 2) Wrong class: shovel on stone -> destroyed, no stone drop.
{
  const r = mineBlob(MAT.STONE, TC.shovel, TT.wood);
  check('shovel still breaks the stone', r.centerEmpty);
  check(`shovel yields no stone drop (${r.drops})`, r.drops === 0);
}

// 3) Too-low tier: pickaxe (stone tier) on gold ore -> no drop; iron tier -> drops.
{
  const low = mineBlob(MAT.GOLD_ORE, TC.pickaxe, TT.stone);
  check('low-tier pickaxe breaks gold ore', low.centerEmpty);
  check(`low-tier pickaxe yields no gold drop (${low.drops})`, low.drops === 0);
  const ok = mineBlob(MAT.GOLD_ORE, TC.pickaxe, TT.iron);
  check(`iron-tier pickaxe drops gold ore (${ok.drops})`, ok.drops > 0);
}

// 4) Bare hand: drops loose soils (dirt), but not stone.
{
  const dirt = mineBlob(MAT.DIRT, TC.hand, TT.hand);
  check(`hand drops dirt (${dirt.drops})`, dirt.drops > 0);
  const stone = mineBlob(MAT.STONE, TC.hand, TT.hand);
  check('hand breaks stone', stone.centerEmpty);
  check(`hand yields no stone drop (${stone.drops})`, stone.drops === 0);
}

// 5) Determinism: an identical mining script produces identical grid + item counts.
{
  const a = mineBlob(MAT.STONE, TC.pickaxe, TT.wood);
  const b = mineBlob(MAT.STONE, TC.pickaxe, TT.wood);
  check(`mining is deterministic (hash ${a.hash === b.hash ? 'match' : 'DIFFER'}, items ${a.itemCount}/${b.itemCount})`, a.hash === b.hash && a.itemCount === b.itemCount && a.drops === b.drops);
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
