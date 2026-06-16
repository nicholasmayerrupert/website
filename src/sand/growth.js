// Plant growth: each tick, a plant component touching water may spend it to grow
// wood (trunk + branches, with trunk thickening) or sprout leaves. Operates on
// grid directly, before the buffer flip. Plant connectivity/splitting lives in
// the engine core (components); this module only adds cells to existing plant
// components.
//
// Created with the shared engine context `S`. `grid` is read live through S;
// plant components are read (and their cells/cache mutated) in place.

export function createGrowth(S) {
  const {
    cols, rows, I, isInBounds, rand,
    EMPTY, WATER, SEED, WOOD, PLANT,
    writeGridIndex, markCellIndex,
    DIRS_LEFT_FIRST, DIRS_RIGHT_FIRST,
    TRUNK_THICKEN_UNTIL_WOOD, TRUNK_SIDE_FILL_P, TRUNK_DOUBLE_SIDE_FILL_P, TRUNK_WIDE_SIDE_FILL_P,
    MAX_WOOD_CELLS, MAX_LEAF_CELLS, GROWTH_P, LEAF_GROWTH_P, WATER_PER_GROWTH,
  } = S;

  function findWaterTouchingComponent(comp, count = 1) {
    const grid = S.grid;
    const candidates = [];
    const seen = new Set();
    const consider = (nk) => {
      if (grid[nk] !== WATER) return;
      if (seen.has(nk)) return;
      seen.add(nk);
      candidates.push(nk);
    };
    for (const k of comp.cells) {
      const material = grid[k];
      if (material !== SEED && material !== WOOD) continue;
      const x = k % cols;
      const y = Math.floor(k / cols);
      if (x < cols - 2) consider(k + 1);
      if (x > 1) consider(k - 1);
      if (y < rows - 1) consider(k + cols);
      if (y > 1) consider(k - cols);
    }
    if (candidates.length < count) return null;
    const picked = [];
    while (picked.length < count && candidates.length > 0) {
      const i = Math.floor(rand() * candidates.length);
      const [k] = candidates.splice(i, 1);
      picked.push(k);
    }
    return picked.length === count ? picked : null;
  }

  function refreshPlantCache(comp) {
    if (!comp.cacheDirty && comp.woodCells && comp.seedWoodCells) return;
    const grid = S.grid;
    const woodCells = [];
    const seedWoodCells = [];
    for (const k of comp.cells) {
      const material = grid[k];
      if (material === WOOD) {
        woodCells.push(k);
        seedWoodCells.push(k);
      } else if (material === SEED) {
        seedWoodCells.push(k);
      }
    }
    woodCells.sort((a, b) => Math.floor(a / cols) - Math.floor(b / cols));
    seedWoodCells.sort((a, b) => Math.floor(a / cols) - Math.floor(b / cols));
    comp.woodCells = woodCells;
    comp.seedWoodCells = seedWoodCells;
    comp.cacheDirty = false;
  }

  function tryGrowWood(comp, reserved = new Set()) {
    refreshPlantCache(comp);
    const grid = S.grid;
    const sources = comp.woodCells.length > 0 ? comp.woodCells : comp.seedWoodCells;

    for (const source of sources) {
      const y = (source / cols) | 0; const x = source - y * cols;
      const branchReady = comp.woodCount > 16;
      const branchDir = rand() < 0.5 ? -1 : 1;
      const candidates = branchReady && rand() < 0.55
        ? [
            [x + branchDir, y - 1],
            [x + branchDir * 2, y - 1],
            [x + branchDir, y],
            [x, y - 1],
            [x - branchDir, y - 1],
          ]
        : [
            [x, y - 1],
            [x - 1, y - 1],
            [x + 1, y - 1],
            [x - 1, y],
            [x + 1, y],
          ];

      for (const [tx, ty] of candidates) {
        if (!isInBounds(tx, ty)) continue;
        const tk = I(tx, ty);
        if (grid[tk] === EMPTY && !reserved.has(tk)) return tk;
      }
    }
    return -1;
  }

  function addWoodIfOpen(k, growth, reserved) {
    const grid = S.grid;
    if (k < 0 || k >= grid.length || grid[k] !== EMPTY || reserved.has(k)) return false;
    growth.push([k, WOOD]);
    reserved.add(k);
    return true;
  }

  function thickenTrunkAround(k, comp, growth, reserved) {
    if (comp.woodCount >= TRUNK_THICKEN_UNTIL_WOOD || rand() > TRUNK_SIDE_FILL_P) return;
    const y = (k / cols) | 0; const x = k - y * cols;
    const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;

    for (const dx of dirs) {
      const tx = x + dx;
      if (!isInBounds(tx, y)) continue;
      if (addWoodIfOpen(I(tx, y), growth, reserved)) break;
    }

    if (rand() > TRUNK_DOUBLE_SIDE_FILL_P) return;
    for (const dx of dirs) {
      const tx = x - dx;
      if (!isInBounds(tx, y)) continue;
      if (addWoodIfOpen(I(tx, y), growth, reserved)) break;
    }

    if (rand() > TRUNK_WIDE_SIDE_FILL_P) return;
    for (const dx of dirs) {
      const tx = x + dx * 2;
      if (!isInBounds(tx, y)) continue;
      if (addWoodIfOpen(I(tx, y), growth, reserved)) break;
    }
  }

  function tryGrowLeaf(comp, reserved = new Set()) {
    refreshPlantCache(comp);
    const grid = S.grid;
    const woodCells = comp.woodCells;
    if (woodCells.length === 0) return -1;

    for (const source of woodCells) {
      const y = (source / cols) | 0; const x = source - y * cols;
      const candidates = [
        [x, y - 1],
        [x - 1, y],
        [x + 1, y],
        [x - 1, y - 1],
        [x + 1, y - 1],
        [x - 2, y],
        [x + 2, y],
        [x - 2, y - 1],
        [x + 2, y - 1],
        [x - 3, y],
        [x + 3, y],
      ];
      const start = Math.floor(rand() * candidates.length);
      const step = rand() < 0.5 ? 1 : -1;

      for (let i = 0; i < candidates.length; i++) {
        const [tx, ty] = candidates[(start + i * step + candidates.length) % candidates.length];
        if (!isInBounds(tx, ty)) continue;
        const tk = I(tx, ty);
        if (grid[tk] === EMPTY && !reserved.has(tk)) return tk;
      }
    }
    return -1;
  }

  function growPlantComponents() {
    const plantComponents = S.plantComponents;
    if (plantComponents.length === 0) return;
    const grid = S.grid;

    for (const comp of plantComponents) {
      comp.age = (comp.age ?? 0) + 1;
      const waterCells = findWaterTouchingComponent(comp, WATER_PER_GROWTH);
      if (!waterCells) continue;
      for (const waterK of waterCells) markCellIndex(waterK);
      if (rand() > GROWTH_P) continue;

      const growth = [];
      const reserved = new Set();
      const shouldGrowWood = comp.woodCount < MAX_WOOD_CELLS && (comp.woodCount < 18 || rand() > LEAF_GROWTH_P);
      if (shouldGrowWood) {
        const firstWood = tryGrowWood(comp, reserved);
        if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) {
          thickenTrunkAround(firstWood, comp, growth, reserved);
        }

        const extraWood = tryGrowWood(comp, reserved);
        if (extraWood >= 0 && rand() < 0.72) {
          addWoodIfOpen(extraWood, growth, reserved);
        }
      }
      if (growth.length === 0 && comp.woodCount >= 6 && comp.leafCount < MAX_LEAF_CELLS) {
        const leafCount = rand() < 0.35 ? 2 : 1;
        for (let i = 0; i < leafCount; i++) {
          const leafK = tryGrowLeaf(comp, reserved);
          if (leafK >= 0) {
            growth.push([leafK, PLANT]);
            reserved.add(leafK);
          }
        }
      }
      if (growth.length === 0) continue;

      for (const waterK of waterCells) writeGridIndex(waterK, EMPTY);
      for (const [targetK, material] of growth) {
        if (grid[targetK] !== EMPTY) continue;
        writeGridIndex(targetK, material);
        comp.cells.add(targetK);
        const y = (targetK / cols) | 0;
        if (y > comp.yMax) comp.yMax = y;
        if (material === WOOD) comp.woodCount++;
        else comp.leafCount++;
        comp.cacheDirty = true;
      }
    }
  }

  return { growPlantComponents };
}
