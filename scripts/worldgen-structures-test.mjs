// Phase 3 worldgen: ore veins + cave-wall MOSS + stamped ruins/themed cave biomes. All are pure
// functions of world coords, inert (solid-in-solid or carved air), and must be
// BYTE-IDENTICAL across streaming (a structure straddling a band seam regenerates
// the same), persisted by the tile store. Run: node scripts/worldgen-structures-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 220, ROWS = 160, SEED = 0xBED;
await initSandWasm();
const { check, done } = makeChecker('worldgen structures (Phase 3)');
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true });

function materialComponents(g, mat) {
  const seen = new Uint8Array(g.length);
  const comps = [];
  const stack = [];
  for (let i = 0; i < g.length; i++) {
    if (seen[i] || g[i] !== mat) continue;
    seen[i] = 1;
    stack.length = 0;
    stack.push(i);
    let n = 0, minX = COLS, maxX = -1, minY = ROWS, maxY = -1, edge = false;
    const colCounts = new Map();
    while (stack.length) {
      const k = stack.pop();
      const x = k % COLS, y = (k / COLS) | 0;
      n++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) edge = true;
      colCounts.set(x, (colCounts.get(x) || 0) + 1);
      const ns = [];
      if (x > 0) ns.push(k - 1);
      if (x + 1 < COLS) ns.push(k + 1);
      if (y > 0) ns.push(k - COLS);
      if (y + 1 < ROWS) ns.push(k + COLS);
      for (const nk of ns) if (!seen[nk] && g[nk] === mat) { seen[nk] = 1; stack.push(nk); }
    }
    comps.push({ n, minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1, edge, colCounts });
  }
  return comps;
}
const acidComponents = (g) => materialComponents(g, MAT.ACID);
const lavaComponents = (g) => materialComponents(g, MAT.LAVA);

// --- ores + ruins actually generate while exploring ---
{
  const tally = { ore: 0, brick: 0, moss: 0, acid: 0, salt: 0, lava: 0, crystal: 0, mycelium: 0, mushroom: 0, plant: 0, vine: 0 };
  const oreIds = new Set([MAT.COPPER_ORE, MAT.IRON_ORE, MAT.COAL_ORE, MAT.GOLD_ORE]);
  for (let depth = 0; depth < 3; depth++) {
    const e = mk();
    for (let d = 0; d < depth; d++) e.shiftWorldXY(0, 96);
    for (let i = 0; i < 25; i++) {
      const g = e.getGrid();
      for (const v of g) {
        if (oreIds.has(v)) tally.ore++;
        else if (v === MAT.BRICK) tally.brick++;
        else if (v === MAT.MOSS) tally.moss++;
        else if (v === MAT.ACID) tally.acid++;
        else if (v === MAT.SALT) tally.salt++;
        else if (v === MAT.LAVA) tally.lava++;
        else if (v === MAT.CRYSTAL) tally.crystal++;
        else if (v === MAT.MYCELIUM) tally.mycelium++;
        else if (v === MAT.MUSH_STEM || v === MAT.MUSH_CAP) tally.mushroom++;
        else if (v === MAT.PLANT) tally.plant++;
        else if (v === MAT.VINE) tally.vine++;
      }
      e.shiftWorldXY(128, 0);
    }
    e.destroy();
  }
  check(`ore veins generate (${tally.ore} cells)`, tally.ore > 500);
  check(`ruins (BRICK) generate (${tally.brick} cells)`, tally.brick > 30);
  check(`cave-wall MOSS generates (${tally.moss} cells)`, tally.moss > 30);
  check(`crystal caves generate acid basins (${tally.acid}/${tally.crystal})`, tally.acid > 4000 && tally.crystal > 5000);
  check(`crystal caves contain salt piles (${tally.salt} cells)`, tally.salt > 800);
  check(`lava pits generate but stay rarer than acid (${tally.lava} cells)`, tally.lava > 100 && tally.lava < tally.crystal * 0.08);
  check(`crystal caverns generate (${tally.crystal} cells)`, tally.crystal > 40);
  check(`mycelium mushroom caves generate (${tally.mycelium}/${tally.mushroom} cells)`, tally.mycelium > 40 && tally.mushroom > 20);
  check(`lush caves generate plants and vines (${tally.plant}/${tally.vine} cells)`, tally.plant > 40 && tally.vine > 40);
  check(`crystal volume stays comparable to lush/mycelium caves (${tally.crystal} vs ${tally.mycelium + tally.mushroom + tally.plant + tally.vine})`, tally.crystal < tally.mycelium + tally.mushroom + tally.plant + tally.vine);
}

// --- ocean flora stays submerged: background VINE/GLOWBERRY only comes from
// fillOceanFlora, so its foreground counterpart must still be generated water.
{
  const e = mk();
  let flora = 0, exposed = 0;
  for (let band = 0; band < 100; band++) {
    const fg = e.getGrid(), bg = e.getGridBg();
    for (let k = 0; k < bg.length; k++) {
      if (bg[k] !== MAT.VINE && bg[k] !== MAT.GLOWBERRY) continue;
      flora++;
      if (fg[k] !== MAT.WATER) exposed++;
    }
    e.shiftWorldXY(128, 0);
  }
  check(`ocean kelp and glowberries remain underwater (${flora} cells, ${exposed} exposed)`, flora > 0 && exposed === 0);
  e.destroy();
}

// --- crystal-acid basins keep acid off dissolvable stone at generation time ---
{
  const dissolvable = new Set([
    MAT.SAND, MAT.STONE, MAT.DIRT, MAT.SNOW, MAT.MUD, MAT.CLAY, MAT.SANDSTONE, MAT.MOSS,
    MAT.COPPER_ORE, MAT.IRON_ORE, MAT.COAL_ORE, MAT.GOLD_ORE, MAT.BRICK, MAT.MYCELIUM,
    MAT.MYCELIUM_SPORE, MAT.DEBRIS,
  ]);
  let acid = 0, acidTouchCrystal = 0, acidOverCrystal = 0, acidTouchDissolvable = 0;
  let acidBottomBoundary = 0, acidBottomCrystal = 0, acidSideBoundary = 0, acidSideCrystal = 0;
  let roundedAcid = 0, flatSmearAcid = 0, basinComponents = 0, stoneBankComponents = 0;
  for (let depth = 0; depth < 3; depth++) {
    const e = mk();
    for (let d = 0; d < depth; d++) e.shiftWorldXY(0, 96);
    for (let s = 0; s < 30; s++) {
      const g = e.getGrid();
      for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
        const k = y * COLS + x;
        if (g[k] !== MAT.ACID) continue;
        acid++;
        const ns = [k - 1, k + 1, k - COLS, k + COLS].map((i) => g[i]);
        if (ns.includes(MAT.CRYSTAL)) acidTouchCrystal++;
        if (g[k + COLS] === MAT.CRYSTAL) acidOverCrystal++;
        if (ns.some((m) => dissolvable.has(m))) acidTouchDissolvable++;
        if (g[k + COLS] !== MAT.ACID) {
          acidBottomBoundary++;
          if (g[k + COLS] === MAT.CRYSTAL) acidBottomCrystal++;
        }
        for (const side of [g[k - 1], g[k + 1]]) {
          if (side === MAT.ACID || side === MAT.EMPTY) continue;
          acidSideBoundary++;
          if (side === MAT.CRYSTAL) acidSideCrystal++;
        }
      }
      for (const c of acidComponents(g)) {
        if (c.edge || c.n < 12) continue;
        const leftDepth = c.colCounts.get(c.minX) || 0;
        const rightDepth = c.colCounts.get(c.maxX) || 0;
        const centerDepth = c.colCounts.get((c.minX + c.maxX) >> 1) || 0;
        const rounded = c.width >= 8 && c.height >= 3 && c.width / c.height <= 6.5
          && centerDepth >= Math.max(leftDepth, rightDepth) + 2;
        if (rounded) { roundedAcid += c.n; basinComponents++; }
        if (c.width >= 8 && c.height <= 2) flatSmearAcid += c.n;
        let leftStone = false, rightStone = false;
        for (let yy = Math.max(1, c.minY - 2); yy <= Math.min(ROWS - 2, c.maxY + 3); yy++) {
          for (let xx = Math.max(0, c.minX - 4); xx < c.minX; xx++) if (g[yy * COLS + xx] === MAT.STONE) leftStone = true;
          for (let xx = c.maxX + 1; xx <= Math.min(COLS - 1, c.maxX + 4); xx++) if (g[yy * COLS + xx] === MAT.STONE) rightStone = true;
        }
        if (leftStone && rightStone) stoneBankComponents++;
      }
      e.shiftWorldXY(128, 0);
    }
    e.destroy();
  }
  check(`large acid pits are easy to find (${acid} acid cells)`, acid > 2000);
  check(`acid basins have rounded depth (${roundedAcid}/${acid} acid cells in ${basinComponents} rounded components)`, roundedAcid > acid * 0.65 && basinComponents > 8);
  check(`acid is not smeared into flat cave-floor streaks (${flatSmearAcid}/${acid} flat-streak cells)`, flatSmearAcid < acid * 0.08);
  check(`acid basin bottoms are crystal-lined (${acidBottomCrystal}/${acidBottomBoundary})`, acidBottomBoundary > 0 && acidBottomCrystal === acidBottomBoundary);
  check(`acid basin solid side walls are crystal (${acidSideCrystal}/${acidSideBoundary})`, acidSideBoundary > 0 && acidSideCrystal === acidSideBoundary);
  check(`acid basin edges are grounded into stone (${stoneBankComponents}/${basinComponents})`, basinComponents > 0 && stoneBankComponents > basinComponents * 0.80);
  // Acid basins are now large lakes, so the crystal lining (a perimeter) is a
  // smaller fraction of the acid VOLUME than it was for the old small ponds — but
  // every basin bottom/wall is still crystal (asserted above). Contact stays well
  // above a tenth of the acid.
  check(`acid has substantial crystal contact (${acidTouchCrystal}/${acid} touch crystal, ${acidOverCrystal} sit directly on crystal)`, acidTouchCrystal > acid * 0.10 && acidOverCrystal > acid * 0.05);
  check(`acid does not start adjacent to dissolvable cave walls (${acidTouchDissolvable})`, acidTouchDissolvable === 0);
}

// --- lava pits are contained, not free-flowing sheets ---
{
  let lava = 0, lavaBottomBoundary = 0, lavaBottomStone = 0, lavaSideBoundary = 0, lavaSideStone = 0, lavaBasins = 0;
  for (let depth = 0; depth < 3; depth++) {
    const e = mk();
    for (let d = 0; d < depth; d++) e.shiftWorldXY(0, 96);
    for (let s = 0; s < 30; s++) {
      const g = e.getGrid();
      for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
        const k = y * COLS + x;
        if (g[k] !== MAT.LAVA) continue;
        lava++;
        if (g[k + COLS] !== MAT.LAVA) {
          lavaBottomBoundary++;
          if (g[k + COLS] === MAT.STONE) lavaBottomStone++;
        }
        for (const side of [g[k - 1], g[k + 1]]) {
          if (side === MAT.LAVA || side === MAT.EMPTY) continue;
          lavaSideBoundary++;
          if (side === MAT.STONE) lavaSideStone++;
        }
      }
      for (const c of lavaComponents(g)) if (!c.edge && c.n >= 10 && c.width >= 6 && c.height >= 3 && c.width / c.height <= 7.0) lavaBasins++;
      e.shiftWorldXY(128, 0);
    }
    e.destroy();
  }
  check(`lava pits are present but rarer (${lava} lava cells)`, lava > 100 && lava < 2000);
  check(`lava components are basin-shaped (${lavaBasins} basin components)`, lavaBasins >= 4);
  check(`lava basin bottoms are stone-lined (${lavaBottomStone}/${lavaBottomBoundary})`, lavaBottomBoundary > 0 && lavaBottomStone === lavaBottomBoundary);
  check(`lava basin solid side walls are stone (${lavaSideStone}/${lavaSideBoundary})`, lavaSideBoundary > 0 && lavaSideStone === lavaSideBoundary);
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

// --- a themed cave region is byte-identical across streaming ---
{
  const e = mk();
  const featureMats = new Set([MAT.ACID, MAT.SALT, MAT.LAVA, MAT.CRYSTAL, MAT.MYCELIUM, MAT.MUSH_STEM, MAT.MUSH_CAP, MAT.PLANT, MAT.VINE]);
  let bx = -1, by = -1;
  for (let s = 0; s < 20 && bx < 0; s++) {
    const g = e.getGrid();
    for (let i = 0; i < g.length; i++) if (featureMats.has(g[i])) { bx = i % COLS; by = (i / COLS) | 0; break; }
    if (bx < 0) e.shiftWorldXY(128, 0);
  }
  check('found a themed cave feature to test', bx >= 0);
  const wx0 = e.getWorldOffsetX() + bx - 22, wy0 = e.getWorldOffsetY() + by - 18, W = 54, H = 44;
  const snap = (en) => {
    const g = en.getGrid(), ox = en.getWorldOffsetX(), oy = en.getWorldOffsetY(), m = [];
    for (let wy = wy0; wy < wy0 + H; wy++) for (let wx = wx0; wx < wx0 + W; wx++) {
      const cx = wx - ox, cy = wy - oy;
      m.push(cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS ? -1 : g[cy * COLS + cx]);
    }
    return m;
  };
  const ref = snap(e);
  e.shiftWorldXY(128, 0); e.shiftWorldXY(128, 0); e.shiftWorldXY(0, 96);
  e.shiftWorldXY(-128, 0); e.shiftWorldXY(-128, 0); e.shiftWorldXY(0, -96);
  const after = snap(e);
  let mism = 0, featureCells = 0;
  for (let i = 0; i < ref.length; i++) { if (featureMats.has(ref[i])) featureCells++; if (ref[i] !== after[i]) mism++; }
  check(`region contains a themed feature (${featureCells} cells)`, featureCells > 8);
  check(`themed cave region is byte-identical after streaming (mismatches ${mism})`, mism === 0);
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
