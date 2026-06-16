// Material transformations applied directly on the grid each tick, before the
// double-buffer flip so the results affect that same step's movement:
//   - water + fire -> steam (and the fire is extinguished)
//   - fire ignites adjacent oil/plant (probabilistic spread)
//   - acid dissolves adjacent solids, sometimes consuming itself
//   - lava hardens to stone on water/acid contact, ignites flammables, sheds fire
//   - ice melts beside fire/lava and slowly freezes adjacent water
//
// Created with the shared engine context `S`. Reassigned engine bindings (grid,
// component lists, id counters) are read/written through S; stable refs are
// destructured once.

export function createReactions(S) {
  const {
    cols, rows, I, rand,
    EMPTY, WATER, FIRE, STEAM, OIL, STONE, LAVA, ACID, ICE,
    writeGridIndex, isDissolvable, isPlantMaterial, isFlammable,
    registerStoneCells, splitComponentsAfterErase, splitRigidAfterErase,
    activeRowMin, activeRowMax,
    reactionFlags, reactionSteam, reactionFires, reactionIgnite,
    OIL_IGNITE_P, FIRE_SPREAD_P, PLANT_IGNITE_P,
    ACID_DISSOLVE_P, ACID_DECAY_P, LAVA_EMIT_FIRE_P, ICE_FREEZE_P,
  } = S;

  const applyReactions = () => {
    const grid = S.grid;
    let steamCount = 0;
    let fireCount = 0;
    let igniteCount = 0;
    let plantBurned = false;

    for (let y = 1; y < rows; y++) {
      const minX = Math.max(1, activeRowMin[y]);
      const maxX = Math.min(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      for (let x = minX; x <= maxX; x++) {
        const k = I(x, y);
        if (grid[k] !== WATER) continue;

        let nk = grid[k + 1] === FIRE ? k + 1 : grid[k - 1] === FIRE ? k - 1 : -1;
        if (nk < 0 && y < rows - 1 && grid[k + cols] === FIRE) nk = k + cols;
        if (nk < 0 && grid[k - cols] === FIRE) nk = k - cols;
        if (nk >= 0) {
          reactionSteam[steamCount++] = k;
          if (!reactionFlags[nk]) {
            reactionFlags[nk] = 1;
            reactionFires[fireCount++] = nk;
          }
        }
      }
    }

    for (let y = 1; y < rows; y++) {
      const minX = Math.max(1, activeRowMin[y]);
      const maxX = Math.min(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      for (let x = minX; x <= maxX; x++) {
        const k = I(x, y);
        if (grid[k] !== FIRE || reactionFlags[k]) continue;

        const neighbors = y < rows - 1 ? [k + 1, k - 1, k + cols, k - cols] : [k + 1, k - 1, k - cols];
        for (const nk of neighbors) {
          if (grid[nk] === OIL) {
            if (rand() > OIL_IGNITE_P) continue;
            if (igniteCount < reactionIgnite.length) reactionIgnite[igniteCount++] = nk;
            if (rand() < FIRE_SPREAD_P) {
              const oilY = (nk / cols) | 0;
              const oilNeighbors = oilY < rows - 1 ? [nk + 1, nk - 1, nk + cols, nk - cols] : [nk + 1, nk - 1, nk - cols];
              for (const ok of oilNeighbors) {
                if (grid[ok] === OIL && rand() < 0.12 && igniteCount < reactionIgnite.length) reactionIgnite[igniteCount++] = ok;
              }
            }
          } else if (isPlantMaterial(grid[nk]) && rand() < PLANT_IGNITE_P) {
            if (igniteCount < reactionIgnite.length) reactionIgnite[igniteCount++] = nk;
          }
        }
      }
    }

    for (let i = 0; i < fireCount; i++) {
      const k = reactionFires[i];
      if (grid[k] === FIRE) writeGridIndex(k, EMPTY);
      reactionFlags[k] = 0;
    }
    for (let i = 0; i < steamCount; i++) {
      const k = reactionSteam[i];
      if (grid[k] === WATER) writeGridIndex(k, STEAM);
    }
    for (let i = 0; i < igniteCount; i++) {
      const k = reactionIgnite[i];
      if (grid[k] === OIL || isPlantMaterial(grid[k])) {
        plantBurned = plantBurned || isPlantMaterial(grid[k]);
        writeGridIndex(k, FIRE);
      }
    }
    if (plantBurned) S.plantComponents = splitComponentsAfterErase(S.plantComponents, isPlantMaterial);
  };

  // Acid dissolves an adjacent solid each tick (probabilistically) and may
  // consume itself when it does. Runs on the grid before the buffer flip.
  const applyAcid = () => {
    const grid = S.grid;
    let dissolvedStone = false;
    let dissolvedPlant = false;
    const erasedStoneCells = [];
    for (let y = 1; y < rows - 1; y++) {
      const minX = Math.max(1, activeRowMin[y]);
      const maxX = Math.min(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      for (let x = minX; x <= maxX; x++) {
        const k = I(x, y);
        if (grid[k] !== ACID) continue;

        const right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        if (
          !isDissolvable(grid[right]) &&
          !isDissolvable(grid[left]) &&
          !isDissolvable(grid[down]) &&
          !isDissolvable(grid[up])
        ) continue;
        if (rand() >= ACID_DISSOLVE_P) continue;

        const horizFirst = rand() < 0.5;
        const a = horizFirst ? right : down;
        const b = horizFirst ? left : up;
        const c = horizFirst ? down : right;
        const d = horizFirst ? up : left;
        let target = -1;
        if (isDissolvable(grid[a])) target = a;
        else if (isDissolvable(grid[b])) target = b;
        else if (isDissolvable(grid[c])) target = c;
        else if (isDissolvable(grid[d])) target = d;
        if (target < 0) continue;

        const tm = grid[target];
        if (tm === STONE) { erasedStoneCells.push(target); dissolvedStone = true; }
        else if (isPlantMaterial(tm)) dissolvedPlant = true;
        writeGridIndex(target, EMPTY);
        if (rand() < ACID_DECAY_P) writeGridIndex(k, EMPTY);
      }
    }
    if (dissolvedStone) S.stoneComponents = splitRigidAfterErase(S.stoneComponents, erasedStoneCells, () => S.nextStoneId++);
    if (dissolvedPlant) S.plantComponents = splitComponentsAfterErase(S.plantComponents, isPlantMaterial);
  };

  // Lava hardens to stone where it touches water or acid (turning the touched
  // liquid to steam), ignites touched oil, and slowly sheds fire from any
  // surface exposed to air.
  const applyLava = () => {
    const grid = S.grid;
    const hardenedCells = new Set();
    let hardenedYMax = 0;
    let plantBurned = false;
    for (let y = 1; y < rows - 1; y++) {
      const minX = Math.max(1, activeRowMin[y]);
      const maxX = Math.min(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      for (let x = minX; x <= maxX; x++) {
        const k = I(x, y);
        if (grid[k] !== LAVA) continue;

        const right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        let burnK = -1;
        if (isFlammable(grid[right])) burnK = right;
        else if (isFlammable(grid[left])) burnK = left;
        else if (isFlammable(grid[down])) burnK = down;
        else if (isFlammable(grid[up])) burnK = up;
        if (burnK >= 0) {
          if (isPlantMaterial(grid[burnK])) plantBurned = true;
          writeGridIndex(burnK, FIRE);
          continue;
        }

        // Harden on water/acid contact; the touched liquid flashes to steam.
        let liquidK = -1;
        if (grid[right] === WATER || grid[right] === ACID) liquidK = right;
        else if (grid[left] === WATER || grid[left] === ACID) liquidK = left;
        else if (grid[down] === WATER || grid[down] === ACID) liquidK = down;
        else if (grid[up] === WATER || grid[up] === ACID) liquidK = up;
        if (liquidK >= 0) {
          writeGridIndex(liquidK, STEAM);
          writeGridIndex(k, STONE);
          hardenedCells.add(k);
          if (y > hardenedYMax) hardenedYMax = y;
          continue;
        }

        // Emit fire from a surface exposed to air.
        if (rand() < LAVA_EMIT_FIRE_P) {
          let airK = -1;
          if (grid[up] === EMPTY) airK = up;
          else if (grid[right] === EMPTY) airK = right;
          else if (grid[left] === EMPTY) airK = left;
          if (airK >= 0) writeGridIndex(airK, FIRE);
        }
      }
    }
    if (hardenedCells.size > 0) registerStoneCells(hardenedCells, hardenedYMax);
    if (plantBurned) S.plantComponents = splitComponentsAfterErase(S.plantComponents, isPlantMaterial);
  };

  // Ice melts to water beside fire or lava, and slowly freezes adjacent water.
  const applyIce = () => {
    const grid = S.grid;
    let melted = false;
    const meltedCells = [];
    for (const comp of S.iceComponents) {
      // Snapshot membership: freezing mutates comp.cells during iteration.
      const cells = Array.from(comp.cells);
      for (const k of cells) {
        if (grid[k] !== ICE) continue;
        const right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        const rm = grid[right], lm = grid[left], dm = grid[down], um = grid[up];

        if (rm === FIRE || rm === LAVA || lm === FIRE || lm === LAVA ||
            dm === FIRE || dm === LAVA || um === FIRE || um === LAVA) {
          writeGridIndex(k, WATER);
          meltedCells.push(k);
          melted = true;
          continue;
        }

        if (rand() < ICE_FREEZE_P) {
          let waterK = -1;
          if (rm === WATER) waterK = right;
          else if (lm === WATER) waterK = left;
          else if (dm === WATER) waterK = down;
          else if (um === WATER) waterK = up;
          if (waterK >= 0) {
            writeGridIndex(waterK, ICE);
            comp.cells.add(waterK);
            const wy = (waterK / cols) | 0;
            if (wy > comp.yMax) comp.yMax = wy;
            comp.cacheDirty = true;
          }
        }
      }
    }
    if (melted) S.iceComponents = splitRigidAfterErase(S.iceComponents, meltedCells, () => S.nextIceId++, () => ({ cacheDirty: true }));
  };

  return { applyReactions, applyAcid, applyLava, applyIce };
}
