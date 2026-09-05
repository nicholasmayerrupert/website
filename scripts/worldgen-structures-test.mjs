// World structures are deterministic functions of world coordinates, remain
// inert, reproduce exactly across stream boundaries, and persist in the tile store.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 256, ROWS = 256, SEED = 0xBED;
const PLAYER_CLEAR = 11;
await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('worldgen structures');
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

function surfaceMasonryComponents(g, engine) {
  const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
  const surfaceY = new Int32Array(COLS);
  for (let x = 0; x < COLS; x++) surfaceY[x] = engine.worldSurfaceAbsAt(offX + x) - offY;
  const seen = new Uint8Array(g.length);
  const stack = [];
  const builtAt = (k) => {
    const x = k % COLS, y = (k / COLS) | 0, mat = g[k];
    return (mat === MAT.BRICK || mat === MAT.SANDSTONE) && y <= surfaceY[x];
  };
  const comps = [];
  for (let start = 0; start < g.length; start++) {
    if (seen[start] || !builtAt(start)) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    let n = 0, minX = COLS, maxX = -1, minY = ROWS, maxY = -1;
    let edge = false, groundContacts = 0;
    while (stack.length) {
      const k = stack.pop();
      const x = k % COLS, y = (k / COLS) | 0;
      n++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      edge ||= x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1;
      groundContacts += y >= surfaceY[x] - 1;
      const neighbors = [
        x ? k - 1 : -1, x + 1 < COLS ? k + 1 : -1,
        y ? k - COLS : -1, y + 1 < ROWS ? k + COLS : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || seen[next] || !builtAt(next)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    comps.push({
      n, width: maxX - minX + 1, height: maxY - minY + 1,
      edge, groundContacts,
    });
  }
  return comps;
}

// --- ores + ruins actually generate while exploring ---
{
  const tally = {
    ore: 0, brick: 0, moss: 0, acid: 0, salt: 0, lava: 0, crystal: 0,
    mycelium: 0, mushroom: 0, plant: 0, vine: 0,
    mineRailRows: 0, roomyRailRows: 0, coherentRailCells: 0, railCells: 0, maxRailSpan: 0,
    decoratedMineRows: 0, surfaceFurnishings: 0, undergroundFurnishings: 0, alignedBrick: 0,
    surfaceShells: 0, groundedSurfaceShells: 0, surfaceGroundContacts: 0,
    streetLamps: 0, looseStreetApproaches: 0, pavedStreetApproaches: 0, collidingStreetLamps: 0,
  };
  const oreIds = new Set([MAT.COPPER_ORE, MAT.IRON_ORE, MAT.COAL_ORE, MAT.GOLD_ORE]);
  const furnishingIds = new Set([
    MAT.CLAY, MAT.CRYSTAL, MAT.COPPER_ORE, MAT.GOLD_ORE, MAT.MUSH_CAP, MAT.GLOWBERRY, MAT.GLOWSHROOM,
  ]);
  const mineDetailIds = new Set([
    MAT.CRYSTAL, MAT.COPPER_ORE, MAT.GOLD_ORE, MAT.COAL_ORE, MAT.CLAY,
    MAT.MYCELIUM, MAT.MUSH_CAP, MAT.GLOWBERRY, MAT.PINE_WOOD, MAT.SANDSTONE,
  ]);
  for (let depth = 0; depth < 3; depth++) {
    const e = mk();
    for (let d = 0; d < depth; d++) e.shiftWorldXY(0, 96);
    for (let i = 0; i < 50; i++) {
      if (depth === 0) {
        const targetY = Math.floor((e.worldSurfaceAbsAt(e.getWorldOffsetX() + COLS / 2) - 96) / 32) * 32;
        while (Math.abs(targetY - e.getWorldOffsetY()) >= 32)
          e.shiftWorldXY(0, Math.max(-96, Math.min(96, targetY - e.getWorldOffsetY())));
      }
      const g = e.getGrid(), bg = e.getGridBg();
      const offX = e.getWorldOffsetX(), offY = e.getWorldOffsetY();
      for (let k = 0; k < g.length; k++) {
        const v = g[k];
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
        const x = k % COLS, y = (k / COLS) | 0;
        const worldX = offX + x, worldY = offY + y;
        const depthBelowSurface = worldY - e.worldSurfaceAbsAt(worldX);
        if (furnishingIds.has(bg[k]) && v === MAT.EMPTY) {
          let framed = false;
          for (let dy = -2; dy <= 2 && !framed; dy++) for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            const nearby = bg[ny * COLS + nx];
            if (nearby === MAT.BRICK || nearby === MAT.PINE_WOOD) { framed = true; break; }
          }
          if (framed && depthBelowSurface < 0) tally.surfaceFurnishings++;
          else if (framed && depthBelowSurface > 30) tally.undergroundFurnishings++;
        }
        if (v === MAT.BRICK && bg[k] !== MAT.STONE && bg[k] !== MAT.EMPTY) tally.alignedBrick++;
      }
      for (let y = PLAYER_CLEAR; y < ROWS; y++) {
        const rails = [];
        for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === MAT.IRON_ORE) rails.push(x);
        if (rails.length < 50) continue; // natural ore never forms a room-wide horizontal bed
        tally.mineRailRows++;
        tally.maxRailSpan = Math.max(tally.maxRailSpan, rails.at(-1) - rails[0] + 1);
        let clear = 0;
        for (const x of rails) {
          let roomy = true;
          for (let dy = 1; dy <= PLAYER_CLEAR; dy++) {
            if (g[(y - dy) * COLS + x] !== MAT.EMPTY) { roomy = false; break; }
          }
          clear += roomy;
          tally.coherentRailCells += bg[y * COLS + x] === MAT.IRON_ORE;
        }
        tally.railCells += rails.length;
        if (clear > rails.length * 0.70) tally.roomyRailRows++;
        let details = 0;
        for (let yy = Math.max(0, y - 18); yy <= y - 2; yy++)
          for (let x = rails[0]; x <= rails.at(-1); x++)
            details += mineDetailIds.has(bg[yy * COLS + x]);
        if (details >= 18) tally.decoratedMineRows++;
      }
      if (depth === 0) for (const c of surfaceMasonryComponents(g, e)) {
        // Ignore natural one-cell sandstone crusts and structures clipped by the
        // streaming window. A full facade is substantial in both dimensions.
        if (c.edge || c.n < 80 || c.width < 12 || c.height < 8) continue;
        tally.surfaceShells++;
        tally.surfaceGroundContacts += c.groundContacts;
        if (c.groundContacts >= 3) tally.groundedSurfaceShells++;
      }
      if (depth === 0) for (let y = 0; y < ROWS - 10; y++) for (let x = 3; x < COLS - 3; x++) {
        let lamp = bg[(y + 1) * COLS + x - 3] === MAT.CRYSTAL
          && bg[(y + 1) * COLS + x + 3] === MAT.CRYSTAL;
        for (let dx = -3; dx <= 3 && lamp; dx++)
          lamp = bg[y * COLS + x + dx] === MAT.PINE_WOOD;
        for (let dy = 0; dy <= 9 && lamp; dy++)
          lamp = bg[(y + dy) * COLS + x] === MAT.PINE_WOOD;
        if (!lamp) continue;
        tally.streetLamps++;
        let looseStreet = false;
        let pavedStreet = false;
        for (let dx = -5; dx <= 5; dx++) {
          const surface = e.worldSurfaceAbsAt(offX + x + dx) - offY;
          looseStreet ||= surface >= 0 && surface < ROWS
            && g[surface * COLS + x + dx] === MAT.SAND;
          // Building foundations and their stairs occupy the street where a
          // raised terrace meets the natural grade.
          pavedStreet ||= surface >= 0 && surface < ROWS
            && [MAT.BRICK, MAT.SANDSTONE].includes(g[surface * COLS + x + dx]);
        }
        tally.looseStreetApproaches += looseStreet;
        tally.pavedStreetApproaches += looseStreet || pavedStreet;
        // A duplicated fixture contributes a run of foreground cells. An
        // isolated roof-edge cell is not a foreground lamp post.
        let foregroundFixtureCells = 0;
        for (let dx = -3; dx <= 3; dx++)
          foregroundFixtureCells += g[y * COLS + x + dx] === MAT.PINE_WOOD || g[y * COLS + x + dx] === MAT.CRYSTAL ? 1 : 0;
        for (let dy = 1; dy <= 9; dy++)
          foregroundFixtureCells += g[(y + dy) * COLS + x] === MAT.PINE_WOOD || g[(y + dy) * COLS + x] === MAT.CRYSTAL ? 1 : 0;
        tally.collidingStreetLamps += foregroundFixtureCells >= 4;
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
  check(`large railroad mines generate (${tally.mineRailRows} rail rows, widest ${tally.maxRailSpan} cells)`,
    tally.mineRailRows > 20 && tally.maxRailSpan > 100);
  check(`mine galleries easily clear the player (${tally.roomyRailRows}/${tally.mineRailRows} roomy rail rows)`,
    tally.roomyRailRows > tally.mineRailRows * 0.70);
  check(`mine rails align across foreground/background (${tally.coherentRailCells}/${tally.railCells} cells)`,
    tally.railCells > 0 && tally.coherentRailCells > tally.railCells * 0.90);
  check(`mine levels contain machinery, cargo, lamps, and themed rooms (${tally.decoratedMineRows}/${tally.mineRailRows})`,
    tally.decoratedMineRows > tally.mineRailRows * 0.80);
  check(`surface buildings contain visible furnishings (${tally.surfaceFurnishings} cells)`, tally.surfaceFurnishings > 200);
  check(`surface structures are masonry-connected to the terrain (${tally.groundedSurfaceShells}/${tally.surfaceShells}, ${tally.surfaceGroundContacts} ground contacts)`,
    tally.surfaceShells > 10 && tally.groundedSurfaceShells === tally.surfaceShells
      && tally.surfaceGroundContacts > tally.surfaceShells * 3);
  check(`village streets use sand with masonry terrace approaches (${tally.looseStreetApproaches} sandy, ${tally.pavedStreetApproaches}/${tally.streetLamps} accessible)`,
    tally.streetLamps > 10 && tally.looseStreetApproaches > tally.streetLamps * 0.75
      && tally.pavedStreetApproaches === tally.streetLamps);
  check(`streetlamps remain visible but non-colliding (${tally.streetLamps} lamps, ${tally.collidingStreetLamps} foreground fixtures)`,
    tally.streetLamps > 10 && tally.collidingStreetLamps === 0);
  check(`underground structures contain visible furnishings (${tally.undergroundFurnishings} cells)`, tally.undergroundFurnishings > 200);
  check(`foreground brickwork has a coordinated background wall (${tally.alignedBrick}/${tally.brick})`,
    tally.brick > 0 && tally.alignedBrick > tally.brick * 0.65);
}

// --- the archive archetype remains a real furnished library, not an empty shell ---
{
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x1234, sinksOn: false, infinite: true });
  const bookIds = new Set([MAT.CLAY, MAT.MOSS, MAT.CRYSTAL, MAT.COPPER_ORE, MAT.COAL_ORE]);
  let archiveBays = 0;
  e.shiftWorldXY(0, 96);
  for (let band = 0; band < 50; band++) {
    const fg = e.getGrid(), bg = e.getGridBg();
    const offX = e.getWorldOffsetX(), offY = e.getWorldOffsetY();
    for (let y = 5; y < ROWS - 6; y++) for (let x = 1; x < COLS - 11; x++) {
      const worldX = offX + x, worldY = offY + y;
      if (worldY < e.worldSurfaceAbsAt(worldX) + 30) continue;
      let upperShelf = true, lowerShelf = true;
      for (let dx = 0; dx < 10; dx++) {
        upperShelf &&= bg[y * COLS + x + dx] === MAT.WOOD;
        lowerShelf &&= bg[(y + 5) * COLS + x + dx] === MAT.WOOD;
      }
      if (!upperShelf || !lowerShelf) continue;
      let books = 0, framing = 0, visible = 0;
      for (let yy = y - 4; yy < y; yy++) for (let dx = 0; dx < 10; dx++) {
        const k = yy * COLS + x + dx;
        books += bookIds.has(bg[k]);
        framing += bg[k] === MAT.PINE_WOOD;
        visible += bookIds.has(bg[k]) && fg[k] === MAT.EMPTY;
      }
      if (books >= 4 && framing >= 4 && visible >= 2) archiveBays++;
    }
    e.shiftWorldXY(128, 0);
  }
  check(`lost archives contain framed, visible book bays (${archiveBays} bays)`, archiveBays >= 4);
  e.destroy();
}

// --- ocean flora stays submerged. Surface markets and cave ruins now also use
// vines/glowberries, so only classify plants in the actual sea water column.
{
  const e = mk();
  let flora = 0, exposed = 0;
  for (let band = 0; band < 100; band++) {
    const fg = e.getGrid(), bg = e.getGridBg();
    const offX = e.getWorldOffsetX(), offY = e.getWorldOffsetY();
    for (let k = 0; k < bg.length; k++) {
      if (bg[k] !== MAT.VINE && bg[k] !== MAT.GLOWBERRY) continue;
      const x = k % COLS, y = (k / COLS) | 0;
      const worldX = offX + x, worldY = offY + y;
      if (worldY < 18 || worldY >= e.worldSurfaceAbsAt(worldX)) continue;
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
  let inspectableAcid = 0, roundedAcid = 0, flatSmearAcid = 0, basinComponents = 0, stoneBankComponents = 0;
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
        inspectableAcid += c.n;
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
  check(`acid basins have rounded depth (${roundedAcid}/${inspectableAcid} inspectable acid cells in ${basinComponents} rounded components)`,
    inspectableAcid > 0 && roundedAcid > inspectableAcid * 0.90 && basinComponents > 8);
  check(`acid is not smeared into flat cave-floor streaks (${flatSmearAcid}/${acid} flat-streak cells)`, flatSmearAcid < acid * 0.08);
  check(`acid basin bottoms are crystal-lined (${acidBottomCrystal}/${acidBottomBoundary})`, acidBottomBoundary > 0 && acidBottomCrystal === acidBottomBoundary);
  check(`acid basin solid side walls are crystal (${acidSideCrystal}/${acidSideBoundary})`, acidSideBoundary > 0 && acidSideCrystal === acidSideBoundary);
  check(`acid basin edges are grounded into stone (${stoneBankComponents}/${basinComponents})`, basinComponents > 0 && stoneBankComponents > basinComponents * 0.80);
  // Crystal contact covers the basin perimeter, while the bottom and side-wall
  // assertions above verify the complete protective lining.
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
  // Find an actual underground structure independently of the spawn window.
  e.shiftWorldXY(0, 96);
  let bx = -1, by = -1;
  for (let band = 0; band < 30 && bx < 0; band++) {
    const g = e.getGrid();
    for (let y = 9; y < ROWS - 16 && bx < 0; y++) for (let x = 13; x < COLS - 17; x++) {
      if (g[y * COLS + x] === MAT.BRICK) { bx = x; by = y; break; }
    }
    if (bx < 0) e.shiftWorldXY(128, 0);
  }
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
    const offX = e.getWorldOffsetX(), offY = e.getWorldOffsetY();
    for (let i = 0; i < g.length; i++) {
      if (!featureMats.has(g[i])) continue;
      const x = i % COLS, y = (i / COLS) | 0;
      if (offY + y <= e.worldSurfaceAbsAt(offX + x) + 30) continue;
      bx = x; by = y; break;
    }
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

// Surface buildings reach static rock through the loose soil mantle, so their
// mixed masonry/timber shell does not enter the body solver on its first tick.
{
  const e = mk();
  e.shiftWorldXY(608, 0);
  e.stepWorld();
  let ownedMasonry = 0, ownedBuildingWood = 0;
  for (let layer = 0; layer < 2; layer++) {
    const grid = layer ? e.getGridBg() : e.getGrid();
    const owners = e._bodyOwnerGrid(layer);
    for (let k = 0; k < grid.length; k++) {
      if (owners[k] >= 0 && (grid[k] === MAT.BRICK || grid[k] === MAT.SANDSTONE))
        ownedMasonry++;
      const x = k % COLS, y = (k / COLS) | 0;
      if (owners[k] >= 0 && x >= 120 && x <= 190 && y <= 80
          && (grid[k] === MAT.WOOD || grid[k] === MAT.PINE_WOOD))
        ownedBuildingWood++;
    }
  }
  check(`generated surface buildings remain static on spawn (${ownedMasonry} body-owned masonry cells)`,
    ownedMasonry === 0);
  check(`generated building timber stays attached on spawn (${ownedBuildingWood} body-owned wood cells)`,
    ownedBuildingWood === 0);
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
