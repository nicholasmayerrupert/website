// Pure falling-sand simulation core. No DOM/React dependencies — consumed by
// the SandOverlay canvas wrapper (src/About.jsx) and the headless benchmark
// (scripts/bench-sand.mjs). The RNG is injectable so benchmark runs are
// deterministic.

export const MAT = {
  EMPTY: 0,
  SAND: 1,
  WATER: 2,
  STONE: 3,
  OIL: 4,
  FIRE: 5,
  STEAM: 6,
  SEED: 7,
  WOOD: 8,
  PLANT: 9,
  ACID: 10,
  LAVA: 11,
  ICE: 12,
};

export const CHUNK_SIZE = 32;
const CHUNK_SHIFT = 5; // log2(CHUNK_SIZE)
export const SEED_SIZE = 2;

const EMPTY = MAT.EMPTY;
const SAND = MAT.SAND;
const WATER = MAT.WATER;
const STONE = MAT.STONE;
const OIL = MAT.OIL;
const FIRE = MAT.FIRE;
const STEAM = MAT.STEAM;
const SEED = MAT.SEED;
const WOOD = MAT.WOOD;
const PLANT = MAT.PLANT;
const ACID = MAT.ACID;
const LAVA = MAT.LAVA;
const ICE = MAT.ICE;

// ---- Tunables ----
const MAX_WATER_FLOW = 10;
const STEAM_DECAY_P = 0.018;
const FIRE_DECAY_P = 0.006;
const OIL_IGNITE_P = 0.25;
const PLANT_IGNITE_P = OIL_IGNITE_P * 0.67;
const FIRE_SPREAD_P = 0.11;

// Acid / lava / ice tunables
const ACID_DISSOLVE_P = 0.12;
const ACID_DECAY_P = 0.4;
const LAVA_VISCOSITY_P = 0.35;
const LAVA_EMIT_FIRE_P = 0.001;
const ICE_FREEZE_P = 0.03;

// Side-sink settings (bottom is NOT a sink)
const SINK_STRIP_W = 2;
const INNER_STRIP_W = 1;
const SINK_WATER_P = 0.85;
const SINK_OIL_P = 0.85;
const SINK_SAND_P = 0.35;
const INNER_WATER_P = 0.35;
const INNER_OIL_P = 0.35;
const INNER_SAND_P = 0.10;

// Emitters (normalized positions) + buffers
const EMITTER_EDGE_BUFFER = 3; // cells from side
const EMITTER_TOP_BUFFER = 3; // cells from top
const DIRTY_PAD_X = MAX_WATER_FLOW + 2;
const DIRTY_PAD_Y = 2;

const MAX_WOOD_CELLS = 120;
const MAX_LEAF_CELLS = 105;
const GROWTH_P = 0.58;
const LEAF_GROWTH_P = 0.54;
const WATER_PER_GROWTH = 2;
const TRUNK_THICKEN_UNTIL_WOOD = 52;
const TRUNK_SIDE_FILL_P = 0.96;
const TRUNK_DOUBLE_SIDE_FILL_P = 0.78;
const TRUNK_WIDE_SIDE_FILL_P = 0.34;

const DIRS_LEFT_FIRST = [-1, 1];
const DIRS_RIGHT_FIRST = [1, -1];

export function createEngine({
  cols,
  rows,
  rng = Math.random,
  initialScene = null,
  emitters: emitterDefs = [],
  emittersOn = true,
  sinksOn = true,
} = {}) {
  const rand = rng;
  let emittersEnabled = emittersOn;
  let sinksEnabled = sinksOn;

  // Grid
  let gridA = new Uint8Array(cols * rows);
  let gridB = new Uint8Array(cols * rows);
  let grid = gridA, next = gridB;
  const chunkCols = Math.ceil(cols / CHUNK_SIZE);
  const chunkRows = Math.ceil(rows / CHUNK_SIZE);
  const dirtyRender = new Uint8Array(chunkCols * chunkRows);
  // Raw (unpadded) per-row dirty spans accumulated by cell writes. Padding and
  // render-chunk derivation happen once per step instead of on every write.
  const rowMarkMin = new Int32Array(rows).fill(cols);
  const rowMarkMax = new Int32Array(rows).fill(-1);
  const chunkStamp = new Int32Array(chunkCols * chunkRows).fill(-1);
  let stepSerial = 0;
  const activeRowMin = new Int32Array(rows);
  const activeRowMax = new Int32Array(rows);
  const reactionFlags = new Uint8Array(cols * rows);
  const reactionSteam = new Int32Array(cols * rows);
  const reactionFires = new Int32Array(cols * rows);
  const reactionIgnite = new Int32Array(cols * rows);
  // Coherence tracking for component (stone/plant) cells across the double
  // buffer. A stone/plant cell survives only via the carry-forward, and a dirty
  // mark lives one step, so a vacated component cell gets cleared in only one of
  // the two buffers — the other keeps a ghost that flickers every other frame.
  // Each step we clear cells that were occupied last step but no longer are.
  const compOccStamp = new Int32Array(cols * rows).fill(-1);
  let prevCompCells = [];
  let curCompCells = [];
  let dirtyRenderCount = 0;
  let tick = 0;
  let perfStepMs = 0;
  let perfDirtyChunks = 0;
  const perfPhases = {
    rigid: 0, plants: 0, reactions: 0, prepare: 0,
    sand: 0, liquids: 0, risers: 0, relax: 0, separate: 0, sinks: 0,
  };
  const I = (x, y) => y * cols + x;

  // Stone components (rigid bodies)
  /** @type {Array<{id:number,cells:Set<number>,yMax:number}>} */
  let stoneComponents = [];
  let nextStoneId = 1;
  /** @type {Array<{id:number,cells:Set<number>,yMax:number,woodCount:number,leafCount:number,age:number,cacheDirty?:boolean,woodCells?:number[],seedWoodCells?:number[]}>} */
  let plantComponents = [];
  let nextPlantId = 1;
  /** @type {Array<{id:number,cells:Set<number>,yMax:number,cacheDirty?:boolean}>} */
  let iceComponents = [];
  let nextIceId = 1;

  /** @type {Set<number>} */
  const stoneDraft = new Set();
  /** @type {Set<number>} */
  const iceDraft = new Set();

  // Emitters (grid coords with timing)
  const emitters = emitterDefs.map(e => {
    const rawX = Math.floor(e.pos.x * cols);
    const rawY = Math.floor(e.pos.y * rows);
    const gx = clamp(rawX, 1 + EMITTER_EDGE_BUFFER, cols - 2 - EMITTER_EDGE_BUFFER);
    const gy = clamp(rawY, 1 + EMITTER_TOP_BUFFER, rows - 2 - EMITTER_EDGE_BUFFER);
    return { ...e, material: e.material ?? SAND, gx, gy, last: 0 };
  });

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  const markCellIndex = (k) => {
    const y = (k / cols) | 0;
    const x = k - y * cols;
    if (x < rowMarkMin[y]) rowMarkMin[y] = x;
    if (x > rowMarkMax[y]) rowMarkMax[y] = x;
  };
  const markDirtyRect = (x0, y0, x1, y1) => {
    const mx0 = x0 < 0 ? 0 : x0;
    const mx1 = x1 > cols - 1 ? cols - 1 : x1;
    const my0 = y0 < 0 ? 0 : y0;
    const my1 = y1 > rows - 1 ? rows - 1 : y1;
    for (let y = my0; y <= my1; y++) {
      if (mx0 < rowMarkMin[y]) rowMarkMin[y] = mx0;
      if (mx1 > rowMarkMax[y]) rowMarkMax[y] = mx1;
    }
  };
  const markAllDirty = () => {
    rowMarkMin.fill(0);
    rowMarkMax.fill(cols - 1);
  };
  // Fold the current raw row marks into render-chunk flags (padded), without
  // consuming the marks. Called at step start (covers marks from the previous
  // step plus edits) and by getRenderDirty() (covers marks made during the
  // current step).
  const foldRowMarksToRender = () => {
    for (let y = 0; y < rows; y++) {
      const mn = rowMarkMin[y];
      const mx = rowMarkMax[y];
      if (mx < mn) continue;
      const px0 = mn - DIRTY_PAD_X < 0 ? 0 : mn - DIRTY_PAD_X;
      const px1 = mx + DIRTY_PAD_X > cols - 1 ? cols - 1 : mx + DIRTY_PAD_X;
      const py0 = y - DIRTY_PAD_Y < 0 ? 0 : y - DIRTY_PAD_Y;
      const py1 = y + DIRTY_PAD_Y > rows - 1 ? rows - 1 : y + DIRTY_PAD_Y;
      const c0 = px0 >> CHUNK_SHIFT;
      const c1 = px1 >> CHUNK_SHIFT;
      const cy0 = py0 >> CHUNK_SHIFT;
      const cy1 = py1 >> CHUNK_SHIFT;
      for (let cy = cy0; cy <= cy1; cy++) {
        const rowBase = cy * chunkCols;
        for (let cx = c0; cx <= c1; cx++) {
          const ci = rowBase + cx;
          if (!dirtyRender[ci]) {
            dirtyRender[ci] = 1;
            dirtyRenderCount++;
          }
        }
      }
    }
  };
  const beginStepDirty = () => {
    foldRowMarksToRender();
    activeRowMin.fill(cols);
    activeRowMax.fill(-1);
    let hasActive = false;
    for (let y = 0; y < rows; y++) {
      const mn = rowMarkMin[y];
      const mx = rowMarkMax[y];
      if (mx < mn) continue;
      hasActive = true;
      rowMarkMin[y] = cols;
      rowMarkMax[y] = -1;
      const px0 = mn - DIRTY_PAD_X < 0 ? 0 : mn - DIRTY_PAD_X;
      const px1 = mx + DIRTY_PAD_X > cols - 1 ? cols - 1 : mx + DIRTY_PAD_X;
      const py0 = y - DIRTY_PAD_Y < 0 ? 0 : y - DIRTY_PAD_Y;
      const py1 = y + DIRTY_PAD_Y > rows - 1 ? rows - 1 : y + DIRTY_PAD_Y;
      for (let yy = py0; yy <= py1; yy++) {
        if (px0 < activeRowMin[yy]) activeRowMin[yy] = px0;
        if (px1 > activeRowMax[yy]) activeRowMax[yy] = px1;
      }
    }
    if (!hasActive) return false;
    // Perf telemetry: distinct chunks under the active spans this step.
    stepSerial++;
    perfDirtyChunks = 0;
    for (let y = 0; y < rows; y++) {
      const mn = activeRowMin[y];
      const mx = activeRowMax[y];
      if (mx < mn) continue;
      const rowBase = (y >> CHUNK_SHIFT) * chunkCols;
      for (let cx = mn >> CHUNK_SHIFT, c1 = mx >> CHUNK_SHIFT; cx <= c1; cx++) {
        const ci = rowBase + cx;
        if (chunkStamp[ci] !== stepSerial) {
          chunkStamp[ci] = stepSerial;
          perfDirtyChunks++;
        }
      }
    }
    return true;
  };
  const prepareNextBuffer = () => {
    // Only active spans need claim clearing. Inactive spans already match across
    // buffers once their dirty chunk has settled.
    for (let y = 0; y < rows; y++) {
      const rowStart = y * cols;
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX >= minX) next.fill(EMPTY, rowStart + minX, rowStart + maxX + 1);
    }
  };

  const putInitial = (x, y, material) => {
    if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return;
    grid[I(x, y)] = material;
  };
  const rectInitial = (x0, y0, w, h, material) => {
    const x1 = Math.min(cols - 2, x0 + w - 1);
    const y1 = Math.min(rows - 1, y0 + h - 1);
    for (let y = Math.max(1, y0); y <= y1; y++) {
      for (let x = Math.max(1, x0); x <= x1; x++) putInitial(x, y, material);
    }
  };
  const registerSeededComponents = () => {
    const registerComponents = (materialCheck, components, makeComponent) => {
      const seen = new Uint8Array(cols * rows);
      // Cells already owned by an existing component must not be re-registered.
      // Pre-seeding `seen` makes this function idempotent: both the outer scan and
      // the neighbor flood-fill skip owned cells, so it can run again after runtime
      // placement to adopt orphaned cells without duplicating existing components.
      for (const comp of components) {
        for (const k of comp.cells) seen[k] = 1;
      }
      for (let k = 0; k < grid.length; k++) {
        if (seen[k] || !materialCheck(grid[k])) continue;
        const cells = new Set([k]);
        const queue = [k];
        seen[k] = 1;
        let yMax = (k / cols) | 0;

        while (queue.length) {
          const cur = queue.shift();
          const y = (cur / cols) | 0;
          const x = cur - y * cols;
          if (y > yMax) yMax = y;

          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const nx = x + ox;
              const ny = y + oy;
              if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows) continue;
              const nk = I(nx, ny);
              if (seen[nk] || !materialCheck(grid[nk])) continue;
              seen[nk] = 1;
              cells.add(nk);
              queue.push(nk);
            }
          }
        }

        components.push(makeComponent(cells, yMax));
      }
    };

    registerComponents(
      material => material === STONE,
      stoneComponents,
      (cells, yMax) => ({ id: nextStoneId++, cells, yMax })
    );
    registerComponents(
      isPlantMaterial,
      plantComponents,
      (cells, yMax) => {
        let woodCount = 0;
        let leafCount = 0;
        for (const k of cells) {
          if (grid[k] === WOOD) woodCount++;
          else if (grid[k] === PLANT) leafCount++;
        }
        return {
          id: nextPlantId++,
          cells,
          yMax,
          woodCount,
          leafCount,
          age: 0,
          cacheDirty: true,
        };
      }
    );
    registerComponents(
      material => material === ICE,
      iceComponents,
      (cells, yMax) => ({ id: nextIceId++, cells, yMax, cacheDirty: true })
    );
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

  // Register a set of grid cells (already written as STONE) as a stone
  // component, merging with any adjacent existing stone components.
  function registerStoneCells(cells, yMax) {
    if (cells.size === 0) return;

    const touchingComponentIds = new Set();
    for (const k of cells) {
      const y = (k / cols) | 0; const x = k - y * cols;
      const nks = neighborIndices8(x, y)
        .filter(nk => nk >= 0 && nk < grid.length && grid[nk] === STONE && !cells.has(nk));
      for (const nk of nks) {
        for (const comp of stoneComponents) {
          if (comp.cells.has(nk)) { touchingComponentIds.add(comp.id); break; }
        }
      }
    }

    let newComp = { id: nextStoneId++, cells, yMax };
    if (touchingComponentIds.size > 0) {
      const keep = [];
      for (const comp of stoneComponents) {
        if (touchingComponentIds.has(comp.id)) {
          for (const k of comp.cells) {
            newComp.cells.add(k);
            const y = (k / cols) | 0;
            if (y > newComp.yMax) newComp.yMax = y;
          }
        } else {
          keep.push(comp);
        }
      }
      stoneComponents = keep;
    }
    stoneComponents.push(newComp);
  }

  // Register a set of grid cells (already written as ICE) as an ice component,
  // merging with any adjacent existing ice components.
  function registerIceCells(cells, yMax) {
    if (cells.size === 0) return;

    const touchingComponentIds = new Set();
    for (const k of cells) {
      const y = (k / cols) | 0; const x = k - y * cols;
      const nks = neighborIndices8(x, y)
        .filter(nk => nk >= 0 && nk < grid.length && grid[nk] === ICE && !cells.has(nk));
      for (const nk of nks) {
        for (const comp of iceComponents) {
          if (comp.cells.has(nk)) { touchingComponentIds.add(comp.id); break; }
        }
      }
    }

    let newComp = { id: nextIceId++, cells, yMax, cacheDirty: true };
    if (touchingComponentIds.size > 0) {
      const keep = [];
      for (const comp of iceComponents) {
        if (touchingComponentIds.has(comp.id)) {
          for (const k of comp.cells) {
            newComp.cells.add(k);
            const y = (k / cols) | 0;
            if (y > newComp.yMax) newComp.yMax = y;
          }
        } else {
          keep.push(comp);
        }
      }
      iceComponents = keep;
    }
    iceComponents.push(newComp);
  }

  // Ice is placed via a draft (hold to build a shape, release to drop), mirroring
  // stone, so it doesn't fall instantly while the user is still painting.
  function addDiscToIceDraft(cx, cy, radius) {
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

  function isPlantMaterial(material) {
    return material === SEED || material === WOOD || material === PLANT;
  }

  function isDissolvable(material) {
    return material === SAND || material === STONE || material === WOOD ||
      material === PLANT || material === SEED;
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
    for (let y = y0; y < y0 + SEED_SIZE; y++) {
      for (let x = x0; x < x0 + SEED_SIZE; x++) {
        if (grid[I(x, y)] !== EMPTY) return false;
      }
    }
    return true;
  }

  function placeSeedAt(x0, y0) {
    if (!canPlaceSeedAt(x0, y0)) return false;
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
    plantComponents.push({
      id: nextPlantId++,
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

  function splitComponentsAfterErase(components, allowedMaterial) {
    const updated = [];
    for (const comp of components) {
      const remaining = new Set();
      let reusedOriginalId = false;
      for (const k of comp.cells) {
        if (allowedMaterial(grid[k])) remaining.add(k);
      }
      while (remaining.size > 0) {
        const [start] = remaining;
        const queue = [start];
        const part = new Set([start]);
        remaining.delete(start);
        while (queue.length) {
          const cur = queue.shift();
          const y = (cur / cols) | 0; const x = cur - y * cols;
          const neigh = neighborIndices8(x, y);
          for (const nk of neigh) {
            if (remaining.has(nk)) {
              remaining.delete(nk);
              part.add(nk);
              queue.push(nk);
            }
          }
        }
        let yMax = 0;
        let woodCount = 0;
        let leafCount = 0;
        for (const k of part) {
          const y = (k / cols) | 0;
          if (y > yMax) yMax = y;
          if (grid[k] === WOOD) woodCount++;
          else if (grid[k] === PLANT) leafCount++;
        }
        updated.push({
          id: reusedOriginalId ? nextPlantId++ : comp.id,
          cells: part,
          yMax,
          woodCount,
          leafCount,
          age: comp.age ?? 0,
          cacheDirty: true,
        });
        reusedOriginalId = true;
      }
    }
    return updated;
  }

  // Re-split rigid components (stone/ice) after some of their cells were removed
  // from the grid. erasedCells lists the removed grid indices. makeId assigns
  // ids to the resulting fragments; extra() supplies any extra per-component
  // fields (e.g. cacheDirty for ice).
  function splitRigidAfterErase(components, erasedCells, makeId, extra = null) {
    if (erasedCells.length === 0 || components.length === 0) return components;
    const updated = [];
    for (const comp of components) {
      let touched = false;
      for (const k of erasedCells) {
        if (comp.cells.delete(k)) touched = true;
      }
      if (!touched) { updated.push(comp); continue; }
      if (comp.cells.size === 0) continue;

      const remaining = new Set(comp.cells);
      while (remaining.size > 0) {
        const [start] = remaining;
        const queue = [start];
        const part = new Set([start]);
        remaining.delete(start);
        while (queue.length) {
          const cur = queue.shift();
          const y = (cur / cols) | 0; const x = cur - y * cols;
          const neigh = neighborIndices8(x, y);
          for (const nk of neigh) {
            if (remaining.has(nk)) {
              remaining.delete(nk);
              part.add(nk);
              queue.push(nk);
            }
          }
        }
        let yMax = 0;
        for (const k of part) { const y = (k / cols) | 0; if (y > yMax) yMax = y; }
        updated.push({ id: makeId(), cells: part, yMax, ...(extra ? extra() : {}) });
      }
    }
    return updated;
  }

  // Brushes (for sand, water, RMB eraser)
  const paintDisc = (cx, cy, radius, material, overwrite = false) => {
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
    const erasedStoneCells = [];
    const erasedIceCells = [];
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
        if (grid[k] !== EMPTY) {
          if (grid[k] === STONE) erasedStoneCells.push(k);
          else if (grid[k] === ICE) erasedIceCells.push(k);
          if (isPlantMaterial(grid[k])) erasedPlant = true;
          grid[k] = EMPTY;
          changed = true;
        }
        if (stoneDraft.delete(k)) changed = true;
        if (iceDraft.delete(k)) changed = true;
      }
    }
    if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    stoneComponents = splitRigidAfterErase(stoneComponents, erasedStoneCells, () => nextStoneId++);
    iceComponents = splitRigidAfterErase(iceComponents, erasedIceCells, () => nextIceId++, () => ({ cacheDirty: true }));
    if (erasedPlant && plantComponents.length > 0) {
      plantComponents = splitComponentsAfterErase(plantComponents, isPlantMaterial);
    }
    return changed;
  };

  // --- Emitters ---
  const applyEmitters = (now) => {
    if (!emittersEnabled) return;
    for (const e of emitters) {
      if (now - e.last < e.rateMs) continue;
      e.last = now;
      paintDisc(e.gx, e.gy, e.r, e.material, false);
    }
  };

  // Helpers
  const emptyAt = (x, y) =>
    x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] === EMPTY && next[I(x, y)] === EMPTY;
  const touchesGridEmpty = (k) => {
    const x = k % cols;
    const y = Math.floor(k / cols);
    return (
      (x > 1 && grid[k - 1] === EMPTY) ||
      (x < cols - 2 && grid[k + 1] === EMPTY) ||
      (y > 1 && grid[k - cols] === EMPTY) ||
      (y < rows - 1 && grid[k + cols] === EMPTY)
    );
  };
  const writeGridIndex = (k, material) => {
    if (grid[k] === material) return;
    grid[k] = material;
    markCellIndex(k);
  };
  const writeNextIndex = (k, material) => {
    if (next[k] === material) return;
    next[k] = material;
    if (
      grid[k] !== material ||
      material === FIRE ||
      material === STEAM ||
      (material === WATER && touchesGridEmpty(k))
    ) {
      markCellIndex(k);
    }
  };
  const isDisplacedLiquid = (material, displaced) => {
    if (material === WATER) return displaced === OIL;
    if (material === ACID) return displaced === WATER || displaced === OIL;
    if (material === LAVA) return displaced === ACID || displaced === WATER || displaced === OIL;
    return false;
  };
  const isGas = (material) => material === FIRE || material === STEAM;
  const canDisplaceMaterial = (material, displaced) => {
    if (isGas(displaced)) return true;
    if (material === SAND) return displaced === WATER || displaced === OIL;
    return isDisplacedLiquid(material, displaced);
  };
  const canEnterIndex = (k, material) =>
    next[k] === EMPTY && (grid[k] === EMPTY || canDisplaceMaterial(material, grid[k]));
  const canLiquidEnter = (x, y, material) =>
    x >= 0 && x < cols && y >= 0 && y < rows && canEnterIndex(I(x, y), material);
  const supportsLiquid = (support, material) =>
    support !== EMPTY && support !== material && !canDisplaceMaterial(material, support);
  const moveMaterialInto = (fromK, toK, material) => {
    const displaced = grid[toK];
    writeNextIndex(toK, material);
    if (displaced !== EMPTY && canDisplaceMaterial(material, displaced) && next[fromK] === EMPTY) {
      writeNextIndex(fromK, displaced);
    }
  };
  const moveLiquidInto = (fromK, x, y, material) => {
    const toK = I(x, y);
    moveMaterialInto(fromK, toK, material);
  };
  const moveOilIntoWater = (fromK, x, y) => {
    const toK = I(x, y);
    writeNextIndex(toK, OIL);
    if (next[fromK] === EMPTY) writeNextIndex(fromK, WATER);
  };
  const isInBounds = (x, y) => x > 0 && x < cols - 1 && y > 0 && y < rows;
  const neighborIndices8 = (x, y) => {
    const indices = [];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (isInBounds(nx, ny)) indices.push(I(nx, ny));
      }
    }
    return indices;
  };

  // --- Cohesive STONE chunks ---
  function moveStoneComponentsDown() {
    if (stoneComponents.length === 0) return;

    for (const comp of stoneComponents) {
      let ym = 0;
      for (const k of comp.cells) { const y = (k / cols) | 0; if (y > ym) ym = y; }
      comp.yMax = ym;
    }
    stoneComponents.sort((a, b) => b.yMax - a.yMax);

    for (const comp of stoneComponents) {
      let canMove = true;

      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const ny = y + 1;
        if (ny >= rows) { canMove = false; break; }
        const belowK = I(x, ny);
        if (comp.cells.has(belowK)) continue;
        const mat = grid[belowK];
        if (mat !== EMPTY && !canDisplaceMaterial(SAND, mat)) { canMove = false; break; }
      }
      if (!canMove) continue;

      // Track displaced material to bubble up.
      const displacedCells = [];
      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const belowK = I(x, y + 1);
        const below = grid[belowK];
        if (!comp.cells.has(belowK) && canDisplaceMaterial(SAND, below)) {
          displacedCells.push([belowK, k, below]); // [displacedIndexBelow, stoneOriginIndex, material]
        }
      }

      // Clear old stones
      for (const k of comp.cells) writeGridIndex(k, EMPTY);

      // Bubble displaced material up into vacated cells.
      for (const [displacedIdx, originIdx, material] of displacedCells) {
        writeGridIndex(originIdx, material);
        markCellIndex(displacedIdx);
      }

      // Move stones down
      const newCells = new Set();
      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const nk = I(x, y + 1);
        newCells.add(nk);
      }
      for (const nk of newCells) writeGridIndex(nk, STONE);

      comp.cells = newCells;
      comp.yMax = Math.min(rows - 1, comp.yMax + 1);
    }
  }

  function movePlantComponentsDown() {
    if (plantComponents.length === 0) return;

    for (const comp of plantComponents) {
      let ym = 0;
      for (const k of comp.cells) { const y = (k / cols) | 0; if (y > ym) ym = y; }
      comp.yMax = ym;
    }
    plantComponents.sort((a, b) => b.yMax - a.yMax);

    for (const comp of plantComponents) {
      let canMove = true;

      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const ny = y + 1;
        if (ny >= rows) { canMove = false; break; }
        const belowK = I(x, ny);
        if (comp.cells.has(belowK)) continue;
        const mat = grid[belowK];
        if (mat !== EMPTY && !canDisplaceMaterial(SAND, mat)) { canMove = false; break; }
      }
      if (!canMove) continue;

      const displacedCells = [];
      const vacatedCells = [];
      const movedCells = [];
      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const belowK = I(x, y + 1);
        const below = grid[belowK];
        if (!comp.cells.has(belowK) && canDisplaceMaterial(SAND, below)) {
          displacedCells.push([belowK, below]);
        }
        if (!comp.cells.has(k - cols)) vacatedCells.push(k);
        movedCells.push([k + cols, grid[k]]);
      }

      for (const k of comp.cells) writeGridIndex(k, EMPTY);

      const newCells = new Set();
      let woodCount = 0;
      let leafCount = 0;
      for (const [nk, material] of movedCells) {
        writeGridIndex(nk, material);
        newCells.add(nk);
        if (material === WOOD) woodCount++;
        else if (material === PLANT) leafCount++;
      }

      vacatedCells.sort((a, b) => Math.floor(a / cols) - Math.floor(b / cols));
      for (let i = 0; i < displacedCells.length && i < vacatedCells.length; i++) {
        const [displacedIdx, material] = displacedCells[i];
        writeGridIndex(vacatedCells[i], material);
        markCellIndex(displacedIdx);
      }

      comp.cells = newCells;
      comp.woodCount = woodCount;
      comp.leafCount = leafCount;
      comp.cacheDirty = true;
      comp.yMax = Math.min(rows - 1, comp.yMax + 1);
    }
  }

  // Ice falls as a cohesive rigid chunk, same as stone.
  function moveIceComponentsDown() {
    if (iceComponents.length === 0) return;

    for (const comp of iceComponents) {
      let ym = 0;
      for (const k of comp.cells) { const y = (k / cols) | 0; if (y > ym) ym = y; }
      comp.yMax = ym;
    }
    iceComponents.sort((a, b) => b.yMax - a.yMax);

    for (const comp of iceComponents) {
      let canMove = true;

      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const ny = y + 1;
        if (ny >= rows) { canMove = false; break; }
        const belowK = I(x, ny);
        if (comp.cells.has(belowK)) continue;
        const mat = grid[belowK];
        if (mat !== EMPTY && !canDisplaceMaterial(SAND, mat)) { canMove = false; break; }
      }
      if (!canMove) continue;

      const displacedCells = [];
      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        const belowK = I(x, y + 1);
        const below = grid[belowK];
        if (!comp.cells.has(belowK) && canDisplaceMaterial(SAND, below)) {
          displacedCells.push([belowK, k, below]);
        }
      }

      for (const k of comp.cells) writeGridIndex(k, EMPTY);

      for (const [displacedIdx, originIdx, material] of displacedCells) {
        writeGridIndex(originIdx, material);
        markCellIndex(displacedIdx);
      }

      const newCells = new Set();
      for (const k of comp.cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        newCells.add(I(x, y + 1));
      }
      for (const nk of newCells) writeGridIndex(nk, ICE);

      comp.cells = newCells;
      comp.yMax = Math.min(rows - 1, comp.yMax + 1);
    }
  }

  function findWaterTouchingComponent(comp, count = 1) {
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
    if (plantComponents.length === 0) return;

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

  // Sand physics
  const settleSand = (x, y, k) => {
    const belowK = k + cols;
    // Fast path: resting on sand with sand diagonals — cannot fall or slide.
    // writeNextIndex never marks a stationary sand cell, so write directly.
    if (
      y + 1 < rows && x > 0 && x < cols - 1 &&
      grid[belowK] === SAND && grid[belowK - 1] === SAND && grid[belowK + 1] === SAND
    ) {
      if (next[k] === EMPTY) next[k] = SAND;
      return;
    }
    if (y + 1 < rows && grid[belowK] === EMPTY && next[belowK] === EMPTY) {
      writeNextIndex(belowK, SAND); return;
    }
    if (y + 1 < rows && canDisplaceMaterial(SAND, grid[belowK]) && next[belowK] === EMPTY) {
      moveMaterialInto(k, belowK, SAND);
      return;
    }

    const firstDx = rand() < 0.5 ? -1 : 1;
    const secondDx = -firstDx;
    for (let i = 0; i < 2; i++) {
      const dx = i === 0 ? firstDx : secondDx;
      const nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      const ik = belowK + dx;
      const material = grid[ik];
      if (material === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, SAND); return; }
      if (canDisplaceMaterial(SAND, material) && next[ik] === EMPTY) {
        moveMaterialInto(k, ik, SAND); return;
      }
    }

    if (next[k] === EMPTY) writeNextIndex(k, SAND);
  };

  const settleWaterLikeLiquid = (x, y, k, material) => {
    if (next[k] !== EMPTY) return;

    const belowK = k + cols;
    // Fast paths for liquids that cannot fall, slide, or flow: either fully
    // embedded in their own material, or resting on solid support with same-material sides
    // and no openings diagonally below. Stays dirty only while exposed to air
    // above (writeNextIndex semantics inlined: sides/below are known blocked,
    // so only the above cell matters).
    if (y + 1 < rows && x > 0 && x < cols - 1 && grid[k - 1] === material && grid[k + 1] === material) {
      const below = grid[belowK];
      const bl = grid[belowK - 1];
      const br = grid[belowK + 1];
      if (
        (below === material && bl === material && br === material) ||
        (supportsLiquid(below, material) && bl !== EMPTY && !canDisplaceMaterial(material, bl) && br !== EMPTY && !canDisplaceMaterial(material, br))
      ) {
        next[k] = material;
        if (y > 1 && grid[k - cols] === EMPTY) markCellIndex(k);
        return;
      }
    }
    if (y + 1 < rows && grid[belowK] === EMPTY && next[belowK] === EMPTY) {
      writeNextIndex(belowK, material); return;
    }
    if (y + 1 < rows && canDisplaceMaterial(material, grid[belowK]) && next[belowK] === EMPTY) {
      moveLiquidInto(k, x, y + 1, material);
      return;
    }

    const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
    for (const dx of dirs) {
      const nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      const ik = I(nx, ny);
      if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, material); return; }
      if (canDisplaceMaterial(material, grid[ik]) && next[ik] === EMPTY) {
        moveLiquidInto(k, nx, ny, material);
        return;
      }
    }

    let flow = 0;
    const firstFlowDir = rand() < 0.5 ? 1 : -1;
    for (let dirIndex = 0; dirIndex < 2 && flow === 0; dirIndex++) {
      const sgn = dirIndex === 0 ? firstFlowDir : -firstFlowDir;
      for (let d = 1; d <= MAX_WATER_FLOW; d++) {
        const nx = x + sgn * d;
        if (nx <= 0 || nx >= cols - 1) break;
        const sideK = k + sgn * d;
        if (!canEnterIndex(sideK, material)) break;
        if (y + 1 < rows) {
          const lowerK = sideK + cols;
          if (canEnterIndex(lowerK, material)) {
            const stepK = k + sgn;
            if (canEnterIndex(stepK, material)) flow = sgn;
            break;
          }
        }
      }
    }
    if (flow !== 0) {
      const stepX = x + flow;
      if (canLiquidEnter(stepX, y, material)) { moveLiquidInto(k, stepX, y, material); return; }
    }

    if (y + 1 < rows && supportsLiquid(grid[belowK], material)) {
      const aboveK = k - cols;
      if (y > 1 && grid[aboveK] === material) {
        for (const dx of dirs) {
          const sideK = k + dx;
          if (x + dx <= 0 || x + dx >= cols - 1) continue;
          if (canEnterIndex(sideK, material) && supportsLiquid(grid[sideK + cols], material)) {
            moveMaterialInto(k, sideK, material);
            return;
          }
        }
      }
      if (next[k] === EMPTY) writeNextIndex(k, material);
      return;
    }

    for (const dx of dirs) {
      if (canLiquidEnter(x + dx, y, material)) { moveLiquidInto(k, x + dx, y, material); return; }
    }

    if (next[k] === EMPTY) writeNextIndex(k, material);
  };

  // Water physics
  const settleWater = (x, y, k) => {
    settleWaterLikeLiquid(x, y, k, WATER);
  };

  const settleOil = (x, y, k) => {
    if (next[k] !== EMPTY) return;

    const aboveK = k - cols;
    const belowK = k + cols;
    // Fast paths for oil that cannot move: embedded in oil, or floating on
    // water (its stable state), with no water above to rise through.
    // writeNextIndex never marks a stationary oil cell, so write directly.
    if (
      y + 1 < rows && y - 1 > 0 && x > 0 && x < cols - 1 &&
      grid[k - 1] === OIL && grid[k + 1] === OIL &&
      grid[aboveK] !== WATER && grid[aboveK - 1] !== WATER && grid[aboveK + 1] !== WATER &&
      (grid[belowK] === WATER ||
        (grid[belowK] === OIL && grid[belowK - 1] === OIL && grid[belowK + 1] === OIL))
    ) {
      next[k] = OIL;
      return;
    }
    if (y - 1 > 0 && grid[aboveK] === WATER && next[aboveK] === EMPTY) {
      moveOilIntoWater(k, x, y - 1);
      return;
    }

    const riseDirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
    for (const dx of riseDirs) {
      const nx = x + dx, ny = y - 1;
      if (nx <= 0 || nx >= cols - 1 || ny <= 0) continue;
      if (grid[I(nx, ny)] === WATER && next[I(nx, ny)] === EMPTY) {
        moveOilIntoWater(k, nx, ny);
        return;
      }
    }

    if (y + 1 < rows && canEnterIndex(belowK, OIL)) {
      moveMaterialInto(k, belowK, OIL); return;
    }

    const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
    for (const dx of dirs) {
      const nx = x + dx, ny = y + 1;
      if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
      const ik = I(nx, ny);
      if (canEnterIndex(ik, OIL) && grid[belowK] !== WATER) { moveMaterialInto(k, ik, OIL); return; }
    }

    let flow = 0;
    const firstFlowDir = rand() < 0.5 ? 1 : -1;
    for (let dirIndex = 0; dirIndex < 2 && flow === 0; dirIndex++) {
      const sgn = dirIndex === 0 ? firstFlowDir : -firstFlowDir;
      for (let d = 1; d <= MAX_WATER_FLOW; d++) {
        const nx = x + sgn * d;
        if (nx <= 0 || nx >= cols - 1) break;
        const sideK = k + sgn * d;
        if (!canEnterIndex(sideK, OIL)) break;
        const below = y + 1 < rows ? grid[sideK + cols] : STONE;
        if (below === EMPTY || canDisplaceMaterial(OIL, below)) {
          const stepK = k + sgn;
          if (canEnterIndex(stepK, OIL)) flow = sgn;
          break;
        }
      }
    }
    if (flow !== 0) {
      const stepX = x + flow;
      const stepK = I(stepX, y);
      if (canEnterIndex(stepK, OIL)) { moveMaterialInto(k, stepK, OIL); return; }
    }

    const jiggle = rand() < 0.5 ? -1 : 1;
    if (x + jiggle > 0 && x + jiggle < cols - 1) {
      const sideK = I(x + jiggle, y);
      if (canEnterIndex(sideK, OIL)) { moveMaterialInto(k, sideK, OIL); return; }
    }

    if (next[k] === EMPTY) writeNextIndex(k, OIL);
  };

  const settleAcid = (x, y, k) => {
    settleWaterLikeLiquid(x, y, k, ACID);
  };

  // Lava: a viscous liquid. Most ticks it does not move (LAVA_VISCOSITY_P gate),
  // giving it a slow, sticky flow. Water/acid contact and fire emission handled in
  // applyLava (grid phase) before this runs.
  const settleLava = (x, y, k) => {
    if (next[k] !== EMPTY) return;
    if (rand() >= LAVA_VISCOSITY_P) { writeNextIndex(k, LAVA); return; }
    settleWaterLikeLiquid(x, y, k, LAVA);
  };

  const relaxLiquidGaps = () => {
    for (let pass = 0; pass < 2; pass++) {
      for (let y = rows - 2; y > 0; y--) {
        const minX = Math.max(1, activeRowMin[y]);
        const maxX = Math.min(cols - 2, activeRowMax[y]);
        if (maxX < minX) continue;
        const ltr = rand() < 0.5;
        const start = ltr ? minX : maxX;
        const end = ltr ? maxX + 1 : minX - 1;
        const stepX = ltr ? 1 : -1;

        for (let x = start; x !== end; x += stepX) {
          const k = I(x, y);
          if (grid[k] !== EMPTY) continue;

          const below = grid[I(x, y + 1)];
          if (below === EMPTY) continue;

          const aboveK = I(x, y - 1);
          const above = grid[aboveK];
          if (above === WATER || above === ACID) {
            writeGridIndex(k, above);
            writeGridIndex(aboveK, EMPTY);
            continue;
          }

          const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
          for (const dx of dirs) {
            const sx = x + dx;
            if (sx <= 0 || sx >= cols - 1) continue;
            const sk = I(sx, y);
            const side = grid[sk];
            if (side !== WATER && side !== OIL && side !== ACID) continue;
            writeGridIndex(k, side);
            writeGridIndex(sk, EMPTY);
            if (grid[k] !== EMPTY) break;
          }

          if (grid[k] !== EMPTY) continue;

          if (above !== WATER && above !== OIL && above !== ACID) continue;

          const left = grid[I(x - 1, y)];
          const right = grid[I(x + 1, y)];
          if (left === above || right === above || below === above) {
            writeGridIndex(k, above);
            writeGridIndex(aboveK, EMPTY);
          }
        }
      }
    }
  };

  const separateLiquidsByDensity = () => {
    const parity = rand() < 0.5 ? 0 : 1;
    for (let y = 1; y < rows; y++) {
      const minX = Math.max(1, activeRowMin[y]);
      const maxX = Math.min(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      const ltr = y % 2 === 0;
      const start = ltr ? minX : maxX;
      const end = ltr ? maxX + 1 : minX - 1;
      const stepX = ltr ? 1 : -1;

      for (let x = start; x !== end; x += stepX) {
        if ((x + y) % 2 !== parity) continue;
        const k = I(x, y);
        const m = grid[k];
        if (m === OIL) {
          const aboveK = I(x, y - 1);
          if (grid[aboveK] === WATER) {
            writeGridIndex(aboveK, OIL);
            writeGridIndex(k, WATER);
          }
        } else if (m === ACID) {
          const belowK = I(x, y + 1);
          if (grid[belowK] === WATER || grid[belowK] === OIL) {
            const displaced = grid[belowK];
            writeGridIndex(belowK, ACID);
            writeGridIndex(k, displaced);
          }
        } else if (m === LAVA) {
          const belowK = I(x, y + 1);
          if (grid[belowK] === ACID || grid[belowK] === WATER || grid[belowK] === OIL) {
            const displaced = grid[belowK];
            writeGridIndex(belowK, LAVA);
            writeGridIndex(k, displaced);
          }
        }
      }
    }
  };

  const riseSteam = (x, y, k) => {
    if (next[k] !== EMPTY) return;
    if (rand() < STEAM_DECAY_P || y <= 1) {
      markCellIndex(k);
      return;
    }

    const up = I(x, y - 1);
    if (grid[up] === EMPTY && next[up] === EMPTY && rand() < 0.72) {
      writeNextIndex(up, STEAM); return;
    }

    const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
    for (const dx of dirs) {
      const nx = x + dx;
      const ny = y - 1;
      if (!isInBounds(nx, ny)) continue;
      const ik = I(nx, ny);
      if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, STEAM); return; }
    }

    if (rand() < 0.65) {
      for (const dx of dirs) {
        if (emptyAt(x + dx, y)) { writeNextIndex(I(x + dx, y), STEAM); return; }
      }
    }

    if (next[k] === EMPTY) writeNextIndex(k, STEAM);
  };

  const riseFire = (x, y, k) => {
    if (next[k] !== EMPTY) return;
    if (rand() < FIRE_DECAY_P || y <= 1) {
      markCellIndex(k);
      return;
    }

    const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
    if (rand() < 0.36) {
      const up = I(x, y - 1);
      if (grid[up] === EMPTY && next[up] === EMPTY) { writeNextIndex(up, FIRE); return; }
    }

    for (const dx of dirs) {
      const nx = x + dx;
      const ny = rand() < 0.55 ? y - 1 : y;
      if (!isInBounds(nx, ny)) continue;
      const ik = I(nx, ny);
      if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, FIRE); return; }
    }

    if (next[k] === EMPTY) writeNextIndex(k, FIRE);
  };

  const applyReactions = () => {
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
    if (plantBurned) plantComponents = splitComponentsAfterErase(plantComponents, isPlantMaterial);
  };

  // Acid dissolves an adjacent solid each tick (probabilistically) and may
  // consume itself when it does. Runs on the grid before the buffer flip.
  const applyAcid = () => {
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
    if (dissolvedStone) stoneComponents = splitRigidAfterErase(stoneComponents, erasedStoneCells, () => nextStoneId++);
    if (dissolvedPlant) plantComponents = splitComponentsAfterErase(plantComponents, isPlantMaterial);
  };

  // Lava hardens to stone where it touches water or acid (turning the touched
  // liquid to steam), ignites touched oil, and slowly sheds fire from any
  // surface exposed to air.
  const applyLava = () => {
    const hardenedCells = new Set();
    let hardenedYMax = 0;
    for (let y = 1; y < rows - 1; y++) {
      const minX = Math.max(1, activeRowMin[y]);
      const maxX = Math.min(cols - 2, activeRowMax[y]);
      if (maxX < minX) continue;
      for (let x = minX; x <= maxX; x++) {
        const k = I(x, y);
        if (grid[k] !== LAVA) continue;

        const right = k + 1, left = k - 1, down = k + cols, up = k - cols;
        let oilK = -1;
        if (grid[right] === OIL) oilK = right;
        else if (grid[left] === OIL) oilK = left;
        else if (grid[down] === OIL) oilK = down;
        else if (grid[up] === OIL) oilK = up;
        if (oilK >= 0) {
          writeGridIndex(oilK, FIRE);
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
  };

  // Ice melts to water beside fire or lava, and slowly freezes adjacent water.
  const applyIce = () => {
    let melted = false;
    const meltedCells = [];
    for (const comp of iceComponents) {
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
    if (melted) iceComponents = splitRigidAfterErase(iceComponents, meltedCells, () => nextIceId++, () => ({ cacheDirty: true }));
  };

  // --- Side sinks only (bottom preserved) ---
  const applySideSinks = () => {
    if (!sinksEnabled) return;
    if (cols < 6) return;

    const leftStart = 1;
    const leftEnd = leftStart + SINK_STRIP_W - 1;
    const rightStart = cols - 2 - (SINK_STRIP_W - 1);
    const rightEnd = cols - 2;

    const innerLeftStart = leftEnd + 1;
    const innerLeftEnd = innerLeftStart + INNER_STRIP_W - 1;
    const innerRightEnd = rightStart - 1;
    const innerRightStart = innerRightEnd - (INNER_STRIP_W - 1);

    for (let y = 1; y < rows; y++) {
      // hard sinks near the side walls
      for (let x = leftStart; x <= leftEnd; x++) {
        const k = I(x, y);
        const m = grid[k];
        if (m === WATER) { if (rand() < SINK_WATER_P) writeGridIndex(k, EMPTY); }
        else if (m === OIL) { if (rand() < SINK_OIL_P) writeGridIndex(k, EMPTY); }
        else if (m === SAND) { if (rand() < SINK_SAND_P) writeGridIndex(k, EMPTY); }
      }
      for (let x = rightStart; x <= rightEnd; x++) {
        const k = I(x, y);
        const m = grid[k];
        if (m === WATER) { if (rand() < SINK_WATER_P) writeGridIndex(k, EMPTY); }
        else if (m === OIL) { if (rand() < SINK_OIL_P) writeGridIndex(k, EMPTY); }
        else if (m === SAND) { if (rand() < SINK_SAND_P) writeGridIndex(k, EMPTY); }
      }

      // gentle inner relief (helps sand/water reach the sink)
      for (let x = innerLeftStart; x <= innerLeftEnd; x++) {
        const k = I(x, y);
        const m = grid[k];
        if (m === WATER) { if (rand() < INNER_WATER_P) writeGridIndex(k, EMPTY); }
        else if (m === OIL) { if (rand() < INNER_OIL_P) writeGridIndex(k, EMPTY); }
        else if (m === SAND) { if (rand() < INNER_SAND_P) writeGridIndex(k, EMPTY); }
      }
      for (let x = innerRightStart; x <= innerRightEnd; x++) {
        const k = I(x, y);
        const m = grid[k];
        if (m === WATER) { if (rand() < INNER_WATER_P) writeGridIndex(k, EMPTY); }
        else if (m === OIL) { if (rand() < INNER_OIL_P) writeGridIndex(k, EMPTY); }
        else if (m === SAND) { if (rand() < INNER_SAND_P) writeGridIndex(k, EMPTY); }
      }
    }
  };

  // Physics step
  const step = (nowMs) => {
    applyEmitters(nowMs);
    if (!beginStepDirty()) return false;
    const stepStart = performance.now();
    let phaseT = stepStart;
    const phase = (name) => {
      const now = performance.now();
      perfPhases[name] += now - phaseT;
      phaseT = now;
    };
    tick++;

    // 1) Move rigid bodies first, directly on grid
    moveStoneComponentsDown();
    movePlantComponentsDown();
    moveIceComponentsDown();
    phase('rigid');

    // 2) Grow plants and apply material reactions directly on grid
    growPlantComponents();
    phase('plants');
    applyReactions();
    applyAcid();
    applyLava();
    applyIce();
    phase('reactions');

    // 3) Prepare next buffer & carry rigid bodies forward
    prepareNextBuffer();
    for (const comp of stoneComponents) {
      for (const k of comp.cells) next[k] = STONE;
    }
    // Plant cells churn every step as the canopy grows/sheds; a vacated plant
    // cell gets cleared in only one of the two buffers (a dirty mark lives one
    // step), leaving a ghost that flickers every other frame. Track plant cells
    // and clear any occupied last step but not this one. (Resting stone never
    // vacates, so it needs no per-step tracking.)
    curCompCells.length = 0;
    for (const comp of plantComponents) {
      for (const k of comp.cells) { next[k] = grid[k]; compOccStamp[k] = tick; curCompCells.push(k); }
    }
    // Writing next[k] clears the about-to-be-displayed buffer; markCellIndex
    // makes the cell active next step so the other buffer is cleared too. Guard
    // on grid[k] === EMPTY so we never erase a fluid that moved into the cell.
    for (const k of prevCompCells) {
      if (compOccStamp[k] !== tick && grid[k] === EMPTY) { next[k] = EMPTY; markCellIndex(k); }
    }
    const swapComp = prevCompCells; prevCompCells = curCompCells; curCompCells = swapComp;
    for (const comp of iceComponents) {
      for (const k of comp.cells) next[k] = ICE;
    }
    phase('prepare');

    // 4) Dense falling material. Sand gets first claim on water/oil swaps so
    // stationary liquid claims cannot block density displacement.
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          if (grid[rowBase + x] === SAND) settleSand(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          if (grid[rowBase + x] === SAND) settleSand(x, y, rowBase + x);
        }
      }
    }
    phase('sand');

    // 5) Lava gets first liquid claim; it is the densest fluid.
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          if (grid[rowBase + x] === LAVA) settleLava(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          if (grid[rowBase + x] === LAVA) settleLava(x, y, rowBase + x);
        }
      }
    }

    // 6) Acid gets first claim after lava so lighter liquids cannot pin it above
    // water/oil.
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          if (grid[rowBase + x] === ACID) settleAcid(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          if (grid[rowBase + x] === ACID) settleAcid(x, y, rowBase + x);
        }
      }
    }

    // 7) Lighter liquids
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          const material = grid[rowBase + x];
          if (material === WATER) settleWater(x, y, rowBase + x);
          else if (material === OIL) settleOil(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          const material = grid[rowBase + x];
          if (material === WATER) settleWater(x, y, rowBase + x);
          else if (material === OIL) settleOil(x, y, rowBase + x);
        }
      }
    }
    phase('liquids');

    // 8) Rising materials
    for (let y = 0; y < rows; y++) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          const material = grid[rowBase + x];
          if (material === FIRE) riseFire(x, y, rowBase + x);
          else if (material === STEAM) riseSteam(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          const material = grid[rowBase + x];
          if (material === FIRE) riseFire(x, y, rowBase + x);
          else if (material === STEAM) riseSteam(x, y, rowBase + x);
        }
      }
    }

    // 9) Flip
    const tmp = grid; grid = next; next = tmp;
    phase('risers');

    // 10) Collapse small liquid air pockets. The relax pass also seals water
    // pockets: its above-pull rule covers water-above-water gaps directly.
    if ((tick & 1) === 0) relaxLiquidGaps();
    phase('relax');

    // 11) Let buried liquids separate by density after crowded movement claims settle
    if (tick % 3 === 0) separateLiquidsByDensity();
    phase('separate');

    // 12) Side sinks (stones unaffected)
    applySideSinks();
    phase('sinks');
    perfStepMs = performance.now() - stepStart;
    return true;
  };

  applyInitialScene();
  markAllDirty();

  return {
    cols,
    rows,
    chunkCols,
    chunkRows,
    step,
    setEmittersOn(v) { emittersEnabled = !!v; },
    setSinksOn(v) { sinksEnabled = !!v; },
    paintDisc,
    eraseDisc,
    getSeedOrigin,
    canPlaceSeedAt,
    placeSeedAt,
    addDiscToStoneDraft,
    finalizeStoneDraft,
    clearStoneDraft() { stoneDraft.clear(); },
    getStoneDraftCells() { return stoneDraft; },
    addDiscToIceDraft,
    finalizeIceDraft,
    clearIceDraft() { iceDraft.clear(); },
    getIceDraftCells() { return iceDraft; },
    getGrid() { return grid; },
    // Adopt any stone/plant cells that are in the grid but not yet owned by a
    // component (e.g. placed via paintDisc or raw grid writes). Without this,
    // such cells are erased each step by prepareNextBuffer and flicker, because
    // only component membership carries stone/plant forward. Idempotent.
    syncComponents() { registerSeededComponents(); },
    getRenderDirty() {
      // Marks made during the current step have not been folded yet.
      foldRowMarksToRender();
      return { dirtyRender, dirtyRenderCount, chunkCols, chunkRows };
    },
    clearRenderDirty() {
      dirtyRender.fill(0);
      dirtyRenderCount = 0;
    },
    getPerf() { return { stepMs: perfStepMs, dirtyChunks: perfDirtyChunks, phases: perfPhases }; },
    getTick() { return tick; },
  };
}
