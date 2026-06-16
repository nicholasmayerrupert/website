// User-facing tools and scene setup: brushes (paint/erase), the hold-to-build
// drafts for stone and ice, seed placement, material emitters, and initial
// scene population. These form the engine's interactive surface; they mutate the
// grid directly (outside the simulation step) and hand new solid cells to the
// component bookkeeping in components.js.
//
// Created with the shared engine context `S`. `grid` is read live through S;
// component lists / id counters / draft sets / body-cell list are read and
// written through S.

export function createTools(S) {
  const {
    cols, rows, I, MAT, rand, SEED_SIZE,
    EMPTY, SAND, STONE, ICE, SEED, RIGID,
    EMITTER_EDGE_BUFFER, EMITTER_TOP_BUFFER, emitterDefs, initialScene,
    markCellIndex, markDirtyRect, isPlantMaterial,
    rigidWorld, bodyOwner, stoneDraft, iceDraft,
    registerStoneCells, registerIceCells, registerSeededComponents,
    splitRigidAfterErase, splitComponentsAfterErase,
    eraseBodyCellIndex, finishErasedBodies,
  } = S;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Emitters (grid coords with timing), resolved once from normalized defs.
  const emitters = emitterDefs.map(e => {
    const rawX = Math.floor(e.pos.x * cols);
    const rawY = Math.floor(e.pos.y * rows);
    const gx = clamp(rawX, 1 + EMITTER_EDGE_BUFFER, cols - 2 - EMITTER_EDGE_BUFFER);
    const gy = clamp(rawY, 1 + EMITTER_TOP_BUFFER, rows - 2 - EMITTER_EDGE_BUFFER);
    return { ...e, material: e.material ?? SAND, gx, gy, last: 0 };
  });

  const putInitial = (x, y, material) => {
    if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return;
    S.grid[I(x, y)] = material;
  };
  const rectInitial = (x0, y0, w, h, material) => {
    const x1 = Math.min(cols - 2, x0 + w - 1);
    const y1 = Math.min(rows - 1, y0 + h - 1);
    for (let y = Math.max(1, y0); y <= y1; y++) {
      for (let x = Math.max(1, x0); x <= x1; x++) putInitial(x, y, material);
    }
  };

  const applyInitialScene = () => {
    if (typeof initialScene !== 'function') return;
    initialScene({
      cols,
      rows,
      MAT,
      rand,
      put: putInitial,
      rect: rectInitial,
    });
    registerSeededComponents();
  };

  // --- Draft helpers for stone ---
  function addDiscToStoneDraft(cx, cy, radius) {
    const grid = S.grid;
    let changed = false;
    for (let oy = -radius; oy <= radius; oy++) {
      const yy = cy + oy;
      if (yy <= 0 || yy >= rows) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const xx = cx + ox;
        if (xx <= 0 || xx >= cols - 1) continue;
        const k = I(xx, yy);
        if (grid[k] === EMPTY && !stoneDraft.has(k)) {
          stoneDraft.add(k);
          changed = true;
        }
      }
    }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }

  // Ice is placed via a draft (hold to build a shape, release to drop), mirroring
  // stone, so it doesn't fall instantly while the user is still painting.
  function addDiscToIceDraft(cx, cy, radius) {
    const grid = S.grid;
    let changed = false;
    for (let oy = -radius; oy <= radius; oy++) {
      const yy = cy + oy;
      if (yy <= 0 || yy >= rows - 1) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const xx = cx + ox;
        if (xx <= 0 || xx >= cols - 1) continue;
        const k = I(xx, yy);
        if (grid[k] === EMPTY && !iceDraft.has(k)) {
          iceDraft.add(k);
          changed = true;
        }
      }
    }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  }

  function finalizeIceDraft() {
    if (iceDraft.size === 0) return;
    const grid = S.grid;
    const cells = new Set();
    let yMax = 0;
    for (const k of iceDraft) {
      if (grid[k] === EMPTY) {
        grid[k] = ICE;
        markCellIndex(k);
        cells.add(k);
        const y = (k / cols) | 0;
        if (y > yMax) yMax = y;
      }
    }
    registerIceCells(cells, yMax);
  }

  function finalizeStoneDraft() {
    if (stoneDraft.size === 0) return;
    const grid = S.grid;

    const cells = new Set();
    let yMax = 0;

    for (const k of stoneDraft) {
      if (grid[k] === EMPTY) {
        grid[k] = STONE;
        markCellIndex(k);
        cells.add(k);
        const y = (k / cols) | 0;
        if (y > yMax) yMax = y;
      }
    }
    registerStoneCells(cells, yMax);
  }

  function getSeedOrigin(cx, cy) {
    const x0 = Math.floor(cx - SEED_SIZE / 2);
    const y0 = Math.floor(cy - SEED_SIZE / 2);
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return null;
    return [x0, y0];
  }

  function canPlaceSeedAt(x0, y0) {
    if (x0 == null || y0 == null) return false;
    if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE > rows) return false;
    const grid = S.grid;
    for (let y = y0; y < y0 + SEED_SIZE; y++) {
      for (let x = x0; x < x0 + SEED_SIZE; x++) {
        if (grid[I(x, y)] !== EMPTY) return false;
      }
    }
    return true;
  }

  function placeSeedAt(x0, y0) {
    if (!canPlaceSeedAt(x0, y0)) return false;
    const grid = S.grid;
    const cells = new Set();
    let yMax = 0;
    for (let y = y0; y < y0 + SEED_SIZE; y++) {
      for (let x = x0; x < x0 + SEED_SIZE; x++) {
        const k = I(x, y);
        grid[k] = SEED;
        cells.add(k);
        if (y > yMax) yMax = y;
      }
    }
    S.plantComponents.push({
      id: S.nextPlantId++,
      cells,
      yMax,
      woodCount: 0,
      leafCount: 0,
      age: 0,
      cacheDirty: true,
    });
    markDirtyRect(x0, y0, x0 + SEED_SIZE - 1, y0 + SEED_SIZE - 1);
    return true;
  }

  // Brushes (for sand, water, RMB eraser)
  const paintDisc = (cx, cy, radius, material, overwrite = false) => {
    const grid = S.grid;
    let changed = false;
    for (let oy = -radius; oy <= radius; oy++) {
      const yy = cy + oy;
      if (yy <= 0 || yy >= rows) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const xx = cx + ox;
        if (xx <= 0 || xx >= cols - 1) continue;
        const k = I(xx, yy);
        if ((overwrite || grid[k] === EMPTY) && grid[k] !== material) {
          grid[k] = material;
          changed = true;
        }
      }
    }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    return changed;
  };

  const eraseDisc = (cx, cy, radius) => {
    const grid = S.grid;
    const erasedStoneCells = [];
    const erasedIceCells = [];
    const bodyById = new Map();
    const dirtyBodies = new Set();
    let erasedPlant = false;
    let changed = false;
    for (let oy = -radius; oy <= radius; oy++) {
      const yy = cy + oy;
      if (yy <= 0 || yy >= rows) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const xx = cx + ox;
        if (xx <= 0 || xx >= cols - 1) continue;
        const k = I(xx, yy);
        if (grid[k] === RIGID) {
          if (bodyById.size === 0) {
            for (const b of rigidWorld.bodies) bodyById.set(b.id, b);
          }
          if (eraseBodyCellIndex(k, bodyById, dirtyBodies)) changed = true;
        }
        if (grid[k] !== EMPTY) {
          if (grid[k] === STONE) erasedStoneCells.push(k);
          else if (grid[k] === ICE) erasedIceCells.push(k);
          if (isPlantMaterial(grid[k])) erasedPlant = true;
          // A RIGID cell reaching here means eraseBodyCellIndex couldn't map it
          // back to a local body cell. Clear its owner too, or the stale id makes
          // later bodies skip this cell when rasterizing (a "dead pixel" hole).
          if (grid[k] === RIGID) bodyOwner[k] = -1;
          grid[k] = EMPTY;
          changed = true;
        }
        if (stoneDraft.delete(k)) changed = true;
        if (iceDraft.delete(k)) changed = true;
      }
    }
    S.bodyCells = finishErasedBodies(dirtyBodies, S.bodyCells);
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    S.stoneComponents = splitRigidAfterErase(S.stoneComponents, erasedStoneCells, () => S.nextStoneId++);
    S.iceComponents = splitRigidAfterErase(S.iceComponents, erasedIceCells, () => S.nextIceId++, () => ({ cacheDirty: true }));
    if (erasedPlant && S.plantComponents.length > 0) {
      S.plantComponents = splitComponentsAfterErase(S.plantComponents, isPlantMaterial);
    }
    return changed;
  };

  // --- Emitters ---
  const applyEmitters = (now) => {
    if (!S.emittersEnabled) return;
    for (const e of emitters) {
      if (now - e.last < e.rateMs) continue;
      e.last = now;
      paintDisc(e.gx, e.gy, e.r, e.material, false);
    }
  };

  return {
    applyInitialScene,
    addDiscToStoneDraft, addDiscToIceDraft, finalizeStoneDraft, finalizeIceDraft,
    getSeedOrigin, canPlaceSeedAt, placeSeedAt,
    paintDisc, eraseDisc, applyEmitters,
  };
}
