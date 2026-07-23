// Destroyed cells drop items only when the held tool satisfies the material's
// class and tier gate. Hand-tier materials accept any tool; a mismatch still
// destroys the cell but yields nothing.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { makeChecker, gridHash } from './sand-test-util.mjs';

const COLS = 120, ROWS = 100;
await initSandWasm();
const { check, done } = makeChecker('mining drops');

// Place a blob of `mat`, equip (cls,tier), mine its center until destroyed. No
// stepping: items persist where spawned and the placed solid stays put.
function mineBlob(mat, cls, tier, { hits = 200, placeR = 2 } = {}) {
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

// 1) Dig tool + tier: dig (wood) on stone -> stone drops (universal class match).
{
  const r = mineBlob(MAT.STONE, TC.dig, TT.wood);
  check(`dig tool mines stone into stone drops (${r.drops})`, r.drops > 0);
  check('stone block is destroyed', r.centerEmpty);
}

// 1b) Dig also drops axe-class and shovel-class materials.
{
  const wood = mineBlob(MAT.WOOD, TC.dig, TT.wood);
  check(`dig tool drops wood (${wood.drops})`, wood.drops > 0);
  const dirt = mineBlob(MAT.DIRT, TC.dig, TT.wood);
  check(`dig tool drops dirt (${dirt.drops})`, dirt.drops > 0);
}

// 2) Wrong specialized class: shovel on stone -> destroyed, no stone drop.
{
  const r = mineBlob(MAT.STONE, TC.shovel, TT.wood);
  check('shovel still breaks the stone', r.centerEmpty);
  check(`shovel yields no stone drop (${r.drops})`, r.drops === 0);
}

// 3) Too-low tier: dig (stone tier) on gold ore -> no drop; iron tier -> drops.
{
  const low = mineBlob(MAT.GOLD_ORE, TC.dig, TT.stone);
  check('low-tier dig tool breaks gold ore', low.centerEmpty);
  check(`low-tier dig tool yields no gold drop (${low.drops})`, low.drops === 0);
  const ok = mineBlob(MAT.GOLD_ORE, TC.dig, TT.iron);
  check(`iron-tier dig tool drops gold ore (${ok.drops})`, ok.drops > 0);
}

// 4) Bare hand: drops loose soils (dirt), but not stone.
{
  const dirt = mineBlob(MAT.DIRT, TC.hand, TT.hand);
  check(`hand drops dirt (${dirt.drops})`, dirt.drops > 0);
  const pickDirt = mineBlob(MAT.DIRT, TC.pickaxe, TT.wood);
  check(`pickaxe also drops hand-tier dirt (${pickDirt.drops})`, pickDirt.drops > 0);
  const stone = mineBlob(MAT.STONE, TC.hand, TT.hand);
  check('hand breaks stone', stone.centerEmpty);
  check(`hand yields no stone drop (${stone.drops})`, stone.drops === 0);
}

// 4b) Liquids are scoopable by ANY tool/hand (1 unit per destroyed cell).
{
  const hand = mineBlob(MAT.WATER, TC.hand, TT.hand);
  check(`hand scoops water into water drops (${hand.drops})`, hand.drops > 0 && hand.centerEmpty);
  const pick = mineBlob(MAT.LAVA, TC.pickaxe, TT.wood);
  check(`a tool also scoops lava (${pick.drops})`, pick.drops > 0);
  const oil = mineBlob(MAT.OIL, TC.shovel, TT.wood);
  check(`oil is collectible too (${oil.drops})`, oil.drops > 0);
}

// 4c) The universal dig tool harvests leaves, with a small deterministic chance
// for a species-tagged seed instead of the leaf.
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 3, sinksOn: false, infinite: false });
  const id = e.spawnPlayer(40, 40);
  e.setPlayerTool(id, TC.dig, TT.wood);
  e.placeMaterial(60, 50, 5, MAT.PLANT);
  for (let i = 0; i < 200; i++) e.playerMine(id, 60, 50);
  const items = e.getItems();
  const leafDrops = items.filter((it) => it.kind === 0 && it.material === MAT.PLANT)
    .reduce((count, it) => count + it.count, 0);
  const seedDrops = items.filter((it) => it.kind === 0 && it.material === MAT.SEED)
    .reduce((count, it) => count + it.count, 0);
  check(`dig-harvested leaves usually drop leaf items (${leafDrops})`, leafDrops > seedDrops);
  check(`dig-harvested leaves sometimes drop seeds (${seedDrops})`, seedDrops > 0);
  check('mined oak seeds retain their species', items.filter((it) => it.kind === 0 && it.material === MAT.SEED).every((it) => it.plantType === 0));
  e.destroy();
}

// 5) Determinism: an identical mining script produces identical grid + item counts.
{
  const a = mineBlob(MAT.STONE, TC.dig, TT.wood);
  const b = mineBlob(MAT.STONE, TC.dig, TT.wood);
  check(`mining is deterministic (hash ${a.hash === b.hash ? 'match' : 'DIFFER'}, items ${a.itemCount}/${b.itemCount})`, a.hash === b.hash && a.itemCount === b.itemCount && a.drops === b.drops);
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
