// Pure falling-sand simulation core. No DOM/React dependencies — consumed by
// the SandOverlay canvas wrapper (src/About.jsx) and the headless benchmark
// (scripts/bench-sand.mjs). The RNG is injectable so benchmark runs are
// deterministic.

import { createRigidWorld } from './rigid2d.js';
import { MAT, KIND, buildDensity, buildLooseSorted, buildMobility, buildKind } from './materials.js';
import { createRigidBodies } from './rigidBodies.js';
import { createReactions } from './reactions.js';
import { createGrowth } from './growth.js';
import { createComponents } from './components.js';
import { createTools } from './tools.js';
import { createStreamGen } from './worldgen/streamGen.js';
import { createWorldWindow } from './worldWindow.js';
import { createChunkStore } from './chunkStore.js';

// Material identity (ids, densities, colors, kinds) lives in materials.js — the
// single place to edit when adding a material. Re-exported so existing importers
// (About.jsx, scenes, renderCore, benchmark) keep importing MAT from here.
export { MAT };

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
const RIGID = MAT.RIGID;
const DRIFTWOOD = MAT.DRIFTWOOD;

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
const LAVA_EMIT_FIRE_P = 0.001;
const ICE_FREEZE_P = 0.03;
const RIGID_FIRE_ERODE_P = FIRE_SPREAD_P;
const RIGID_LAVA_ERODE_P = ACID_DISSOLVE_P;

// Per-material physics tables, compiled from the materials.js registry. The hot
// loops read these as flat typed arrays (TABLE[m]).
//   DENSITY: rigid-assembly buoyancy weight. 0 = weightless (air/gas). For
//     liquids it is the buoyant fluid's density. An ungrounded assembly floats
//     when its summed weight is less than the liquid it displaces (avg density <
//     fluid), so ice (<1) floats ~90% submerged and stone (>1) sinks. Detached
//     wood/plant (<1) float too.
//   DENSITY_SORTED_LOOSE: 1 for powders/flowing liquids that density-sort.
//   LOOSE_MOBILITY_P: per-tick chance a loose material attempts to move (lava
//     < 1 is viscous; its settle gate also reads this table).
const DENSITY = buildDensity();
const DENSITY_SORTED_LOOSE = buildLooseSorted();
const LOOSE_MOBILITY_P = buildMobility();
// MAT_KIND[m] drives the step() motion dispatch: a new powder/liquid/gas routes
// automatically by its registry `kind` with no edit here.
const MAT_KIND = buildKind();
const { POWDER: K_POWDER, LIQUID: K_LIQUID, GAS: K_GAS } = KIND;

// Buoyancy deadband. Moving a body one row changes its wet contact by about its
// width, so the rest band must be ~half the body width for a stable
// resting depth to exist — a narrow band guarantees overshoot and the body buzzes.
// Buoyancy is measured from actual liquid contact around a rigid assembly. A
// large body touching a single splash should keep falling; it needs a meaningful
// wet perimeter before density-based floating/rising applies. Contact buoyancy is
// compared on the same perimeter scale so large light bodies do not become
// "heavier" just because their area grew.
const BUOY_BAND_FRAC = 0.5;
const BUOY_BAND_MIN = 1.5;
const BUOY_DRAFT_SCALE = 0.5;
const BUOY_WET_PERIMETER_FRAC = 0.75;
// Buoyant RISE is only allowed when at least this fraction of a body's underside
// rests in liquid. Water merely running down the sides (under a tap / in a
// waterfall) leaves the underside dry, so a light body falls instead of climbing
// the water column up to the source.
const BUOY_SUPPORT_FRAC = 0.5;

// Side-sink settings (bottom is NOT a sink)
const SINK_STRIP_W = 2;
const INNER_STRIP_W = 1;
const SINK_LIQUID_P = 0.85;
const SINK_SAND_P = 0.35;
const INNER_LIQUID_P = 0.35;
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
  // Infinite mode: ignore the scene and stream a procedural world horizontally
  // (worldgen/streamGen.js + worldWindow.js). The buffer is a window onto an
  // endless world; `worldSeed` makes it reproducible.
  infinite = false,
  worldSeed = (Math.floor((rng() || Math.random()) * 4294967296) >>> 0),
} = {}) {
  const rand = rng;
  let emittersEnabled = emittersOn;
  let sinksEnabled = sinksOn;

  // Grid
  let gridA = new Uint8Array(cols * rows);
  let gridB = new Uint8Array(cols * rows);
  let grid = gridA, next = gridB;
  // Streaming-world state: world-x of buffer column 0, the generator, and the
  // sliding-window controller. Stay null/0 in non-infinite (scene) mode.
  let worldOffsetX = 0;
  let streamGen = null;
  let worldWindow = null;
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
  // Stamped with the current tick when a cell's particle relocates during a
  // settlement pass. `grid` is not mutated mid-pass, so a displacer reading
  // `grid[toK]` cannot otherwise tell whether that material is still present or
  // already moved this tick — the stamp distinguishes the two and stops a
  // displacement from fabricating a duplicate of an already-relocated liquid.
  const vacatedStamp = new Int32Array(cols * rows).fill(-1);
  // Support solver buffers (reused each step). A rigid body falls unless it is
  // "grounded" — connected through a chain of load-bearing material to the floor.
  // groundedCell marks bearing cells with a path to the floor; cellComp maps a
  // cell to its rigid component (for rigid coupling); groundStack is the BFS work
  // list.
  const groundedCell = new Uint8Array(cols * rows);
  const cellComp = new Int32Array(cols * rows);
  const groundStack = new Int32Array(cols * rows);
  let prevCompCells = [];
  let curCompCells = [];
  let dirtyRenderCount = 0;
  let tick = 0;
  let perfStepMs = 0;
  let perfDirtyChunks = 0;
  const perfPhases = {
    rigid: 0, bodies: 0, plants: 0, reactions: 0, prepare: 0,
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

  // Free rigid bodies (continuous pose + rotation) — a separate physics layer
  // from the grid-aligned stone/plant/ice components above. The solver lives in
  // rigid2d.js; the engine rasterizes body footprints into the grid as RIGID
  // cells each tick so the CA interacts with them, and clears the previous
  // footprint first. `bodyOwner` maps a RIGID cell back to its body id (-1 = none)
  // for the grid->body coupling. Body cells survive the double buffer via the
  // same carry-forward that keeps components alive.
  const rigidWorld = createRigidWorld({ cols, rows });
  const bodyOwner = new Int32Array(cols * rows).fill(-1);
  let bodyCells = [];
  // Dev diagnostics for the post-solve raster overlap validator (see
  // depenetrateBodyRaster / moveBodies). Reset each moveBodies() pass.
  // `rejectedCells` counts terrain cells the final rasterization had to skip
  // *after* depenetration ran — these should be rare/zero once the validator
  // works; a nonzero value flags a body still clipping into terrain.
  let rigidRejectedCells = 0;
  let rigidDepenetrations = 0;
  // Free rigid bodies live in rigidBodies.js (createRigidBodies); assigned below
  // once the engine context S and computeGrounded are available.
  let moveBodies, eraseBodyCellIndex, finishErasedBodies, bodyFootprintBlocked;

  // Emitters (grid coords with timing)
  // Tools (brushes, drafts, seed, emitters, scene init) live in tools.js
  // (createTools); assigned at module wiring below.
  let applyInitialScene, addDiscToStoneDraft, addDiscToIceDraft, finalizeStoneDraft, finalizeDriftwoodDraft,
    finalizeIceDraft, getSeedOrigin, canPlaceSeedAt, placeSeedAt, paintDisc, eraseDisc, applyEmitters;
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

  // putInitial/rectInitial live in tools.js.
  // Component bookkeeping + support/assembly solver live in components.js
  // (createComponents); assigned at module wiring below.
  let registerSeededComponents, registerStoneCells, registerIceCells,
    splitComponentsAfterErase, splitRigidAfterErase, computeGrounded, moveRigidAssemblies;

  // Scene init + stone/ice drafts live in tools.js.

  function isPlantMaterial(material) {
    return material === SEED || material === WOOD || material === PLANT ||
      material === DRIFTWOOD;
  }

  function isDissolvable(material) {
    return material === SAND || material === STONE || material === WOOD ||
      material === PLANT || material === SEED || material === DRIFTWOOD;
  }

  // Seed placement + brushes (paintDisc/eraseDisc) live in tools.js.

  // applyEmitters lives in tools.js.

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
  // Derived from the registry kind so a new LIQUID/GAS material is recognized by
  // the physics helpers automatically (same membership as the old hardcoded
  // lists: WATER/OIL/ACID/LAVA are LIQUID, FIRE/STEAM are GAS).
  const isLiquid = (material) => MAT_KIND[material] === K_LIQUID;
  const isFlammable = (material) => material === OIL || isPlantMaterial(material);
  const writeGridIndex = (k, material) => {
    if (grid[k] === material) return;
    grid[k] = material;
    markCellIndex(k);
  };
  const isLooseDensityMaterial = (material) => DENSITY_SORTED_LOOSE[material] === 1;
  const canDisplaceByLooseDensity = (material, displaced) =>
    isLooseDensityMaterial(material) && isLooseDensityMaterial(displaced) && DENSITY[material] > DENSITY[displaced];
  const touchesUnstableLooseDensityInterface = (k, material) => {
    if (!isLooseDensityMaterial(material)) return false;
    const y = (k / cols) | 0;
    return (
      (y < rows - 1 && canDisplaceByLooseDensity(material, grid[k + cols])) ||
      (y > 1 && canDisplaceByLooseDensity(grid[k - cols], material))
    );
  };
  const writeNextIndex = (k, material) => {
    if (next[k] === material) return;
    next[k] = material;
    if (
      grid[k] !== material ||
      material === FIRE ||
      material === STEAM ||
      (isLiquid(material) && touchesGridEmpty(k)) ||
      touchesUnstableLooseDensityInterface(k, material)
    ) {
      markCellIndex(k);
    }
  };
  const isGas = (material) => MAT_KIND[material] === K_GAS;
  const canDisplaceMaterial = (material, displaced) => {
    if (isGas(displaced)) return true;
    return canDisplaceByLooseDensity(material, displaced);
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
    vacatedStamp[fromK] = tick;
    // Only re-materialize the displaced material when it is genuinely still at
    // toK. If toK was already processed and relocated this tick, `grid[toK]` is
    // stale and fabricating it into fromK would duplicate it.
    if (
      displaced !== EMPTY &&
      canDisplaceMaterial(material, displaced) &&
      next[fromK] === EMPTY &&
      vacatedStamp[toK] !== tick
    ) {
      writeNextIndex(fromK, displaced);
    }
  };
  const moveLiquidInto = (fromK, x, y, material) => {
    const toK = I(x, y);
    moveMaterialInto(fromK, toK, material);
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

  // Load-bearing materials: rigid solids carry load as cohesive bodies, and
  // settled SAND bears load too. Liquids, gases and EMPTY do not.
  const isRigidMaterial = (m) =>
    m === STONE || m === WOOD || m === PLANT || m === SEED || m === ICE || m === RIGID ||
    m === DRIFTWOOD;
  // computeGrounded + moveRigidAssemblies (support solver, cohesive movement,
  // buoyancy) live in components.js (createComponents); assigned at wiring.

  // Plant growth lives in growth.js (createGrowth); assigned at wiring below.
  let growPlantComponents;

  const canLooseDensitySettleThisTick = (material) => {
    const mobility = LOOSE_MOBILITY_P[material];
    return mobility >= 1 || rand() < mobility;
  };

  const settleLooseDensityInterface = (x, y, k) => {
    const material = grid[k];
    if (!isLooseDensityMaterial(material) || next[k] !== EMPTY) return;
    if (!canLooseDensitySettleThisTick(material)) return;

    const belowK = k + cols;
    if (y + 1 < rows && canDisplaceByLooseDensity(material, grid[belowK]) && next[belowK] === EMPTY) {
      moveMaterialInto(k, belowK, material);
      return;
    }

    const dirs = rand() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
    for (const dx of dirs) {
      const nx = x + dx;
      if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
      const ik = belowK + dx;
      if (canDisplaceByLooseDensity(material, grid[ik]) && next[ik] === EMPTY) {
        moveMaterialInto(k, ik, material);
        return;
      }
    }
  };

  // Sand physics
  const settleSand = (x, y, k) => {
    if (next[k] !== EMPTY) return;
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
      vacatedStamp[k] = tick;
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
      if (material === EMPTY && next[ik] === EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, SAND); return; }
      if (canDisplaceMaterial(SAND, material) && next[ik] === EMPTY) {
        moveMaterialInto(k, ik, SAND); return;
      }
    }

    if (next[k] === EMPTY) writeNextIndex(k, SAND);
  };

  const settleLiquid = (x, y, k, material) => {
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
      vacatedStamp[k] = tick;
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
      if (grid[ik] === EMPTY && next[ik] === EMPTY) { vacatedStamp[k] = tick; writeNextIndex(ik, material); return; }
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

  // Lava: a viscous liquid. Most ticks it does not move (its mobility gate),
  // giving it a slow, sticky flow. Water/acid contact and fire emission handled in
  // applyLava (grid phase) before this runs.
  const settleLava = (x, y, k) => {
    if (next[k] !== EMPTY) return;
    if (rand() >= LOOSE_MOBILITY_P[LAVA]) { writeNextIndex(k, LAVA); return; }
    settleLiquid(x, y, k, LAVA);
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
          if (above === WATER || above === ACID || above === OIL) {
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
        }
      }
    }
  };

  const separateLooseByDensity = () => {
    const parity = rand() < 0.5 ? 0 : 1;
    for (let y = 1; y < rows - 1; y++) {
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
        const belowK = k + cols;
        const upper = grid[k];
        const lower = grid[belowK];
        if (canDisplaceByLooseDensity(upper, lower)) {
          writeGridIndex(belowK, upper);
          writeGridIndex(k, lower);
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

  // Material reactions live in reactions.js (createReactions); assigned at wiring.
  let applyReactions, applyAcid, applyLava, applyIce;

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

    const drain = (xStart, xEnd, y, liquidP, sandP) => {
      for (let x = xStart; x <= xEnd; x++) {
        const k = I(x, y);
        const m = grid[k];
        const p = isLiquid(m) ? liquidP : (m === SAND ? sandP : 0);
        if (p && rand() < p) writeGridIndex(k, EMPTY);
      }
    };

    for (let y = 1; y < rows; y++) {
      // hard sinks near the side walls
      drain(leftStart, leftEnd, y, SINK_LIQUID_P, SINK_SAND_P);
      drain(rightStart, rightEnd, y, SINK_LIQUID_P, SINK_SAND_P);

      // gentle inner relief (helps sand/liquid reach the sink)
      drain(innerLeftStart, innerLeftEnd, y, INNER_LIQUID_P, INNER_SAND_P);
      drain(innerRightStart, innerRightEnd, y, INNER_LIQUID_P, INNER_SAND_P);
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

    // 1) Move rigid bodies first, directly on grid. Solve support up front so a
    // body only stays if it has a path to the ground (no false support from
    // ungrounded sand/floating chunks).
    computeGrounded();
    moveRigidAssemblies();
    phase('rigid');

    // 1b) Advance free rigid bodies (continuous pose + rotation) and rasterize
    // their footprints into the grid as RIGID cells so the CA below treats them
    // as solid.
    moveBodies();
    phase('bodies');

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
    // All component cells (stone/plant/ice) survive only via the carry-forward.
    // A cell erased by acid, melting, or canopy shedding leaves its component but
    // gets cleared in only one of the two buffers (a dirty mark lives one step),
    // leaving a ghost that flickers every other frame. Stamp every component cell
    // so a vacated one can be detected and cleared in both buffers.
    curCompCells.length = 0;
    for (const comp of stoneComponents) {
      for (const k of comp.cells) { next[k] = STONE; compOccStamp[k] = tick; curCompCells.push(k); }
    }
    for (const comp of plantComponents) {
      for (const k of comp.cells) { next[k] = grid[k]; compOccStamp[k] = tick; curCompCells.push(k); }
    }
    for (const comp of iceComponents) {
      for (const k of comp.cells) { next[k] = ICE; compOccStamp[k] = tick; curCompCells.push(k); }
    }
    // Free rigid bodies are not components; carry their rasterized cells forward
    // the same way so a RIGID pixel is not cleared in the alternate buffer.
    for (const k of bodyCells) { next[k] = RIGID; compOccStamp[k] = tick; curCompCells.push(k); }
    // Writing next[k] clears the about-to-be-displayed buffer; markCellIndex
    // makes the cell active next step so the other buffer is cleared too. If a
    // fluid has moved into the vacated cell, mirror it into next only when next
    // still contains a stale component pixel from the alternate buffer.
    for (const k of prevCompCells) {
      if (compOccStamp[k] === tick) continue;
      if (grid[k] === EMPTY) {
        next[k] = EMPTY;
        markCellIndex(k);
      } else if (!isRigidMaterial(grid[k]) && isRigidMaterial(next[k])) {
        next[k] = grid[k];
        markCellIndex(k);
      }
    }
    const swapComp = prevCompCells; prevCompCells = curCompCells; curCompCells = swapComp;
    phase('prepare');

    // 4) Resolve unstable density interfaces between loose materials before
    // material-specific passes can claim stationary cells.
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) settleLooseDensityInterface(x, y, rowBase + x);
      } else {
        for (let x = maxX; x >= minX; x--) settleLooseDensityInterface(x, y, rowBase + x);
      }
    }

    // 4b) Dense falling material. Sand gets first claim on water/oil swaps so
    // stationary liquid claims cannot block density displacement.
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          if (MAT_KIND[grid[rowBase + x]] === K_POWDER) settleSand(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          if (MAT_KIND[grid[rowBase + x]] === K_POWDER) settleSand(x, y, rowBase + x);
        }
      }
    }
    phase('sand');

    // 5) Liquids settle in one pass. Density is resolved entirely by
    // canDisplaceMaterial (denser sinks, lighter rises), so every liquid
    // interface resolves against one shared next-buffer and reaches a fixed
    // point instead of trading cells across separate passes forever.
    for (let y = rows - 1; y >= 0; y--) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          const material = grid[rowBase + x];
          if (MAT_KIND[material] !== K_LIQUID) continue;
          if (material === LAVA) settleLava(x, y, rowBase + x);
          else settleLiquid(x, y, rowBase + x, material);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          const material = grid[rowBase + x];
          if (MAT_KIND[material] !== K_LIQUID) continue;
          if (material === LAVA) settleLava(x, y, rowBase + x);
          else settleLiquid(x, y, rowBase + x, material);
        }
      }
    }
    phase('liquids');

    // 6) Rising materials
    for (let y = 0; y < rows; y++) {
      const minX = activeRowMin[y];
      const maxX = activeRowMax[y];
      if (maxX < minX) continue;
      const rowBase = y * cols;
      const ltr = (y & 1) === 0;
      if (ltr) {
        for (let x = minX; x <= maxX; x++) {
          const material = grid[rowBase + x];
          if (MAT_KIND[material] !== K_GAS) continue;
          if (material === FIRE) riseFire(x, y, rowBase + x);
          else riseSteam(x, y, rowBase + x);
        }
      } else {
        for (let x = maxX; x >= minX; x--) {
          const material = grid[rowBase + x];
          if (MAT_KIND[material] !== K_GAS) continue;
          if (material === FIRE) riseFire(x, y, rowBase + x);
          else riseSteam(x, y, rowBase + x);
        }
      }
    }

    // 7) Flip
    const tmp = grid; grid = next; next = tmp;
    phase('risers');

    // 8) Collapse small liquid air pockets. The relax pass also seals water
    // pockets: its above-pull rule covers water-above-water gaps directly.
    if ((tick & 1) === 0) relaxLiquidGaps();
    phase('relax');

    // 9) Let buried loose materials separate by density after crowded movement claims settle
    if (tick % 3 === 0) separateLooseByDensity();
    phase('separate');

    // 10) Side sinks (stones unaffected)
    applySideSinks();
    phase('sinks');
    perfStepMs = performance.now() - stepStart;
    return true;
  };

  // ---- Module wiring ----
  // Shared engine context handed to extracted subsystems. Stable refs (dims,
  // tables, helpers, rigidWorld) are plain properties; bindings the engine
  // reassigns (grid/next buffers, the body-cell list, rigid diagnostics) are
  // exposed via accessors so modules always read the current value.
  const S = {
    cols, rows, rand, I, CHUNK_SHIFT, MAT, SEED_SIZE, emitterDefs, initialScene,
    EMPTY, SAND, WATER, STONE, OIL, FIRE, STEAM, SEED, WOOD, PLANT, ACID, LAVA, ICE, RIGID,
    DENSITY, DENSITY_SORTED_LOOSE, LOOSE_MOBILITY_P, MAT_KIND,
    ACID_DISSOLVE_P, ACID_DECAY_P, RIGID_LAVA_ERODE_P, RIGID_FIRE_ERODE_P,
    OIL_IGNITE_P, FIRE_SPREAD_P, PLANT_IGNITE_P, LAVA_EMIT_FIRE_P, ICE_FREEZE_P,
    EMITTER_EDGE_BUFFER, EMITTER_TOP_BUFFER,
    rigidWorld, bodyOwner, groundedCell, cellComp, groundStack, stoneDraft, iceDraft,
    activeRowMin, activeRowMax, reactionFlags, reactionSteam, reactionFires, reactionIgnite,
    isLiquid, isGas, isDissolvable, isPlantMaterial, isFlammable, isInBounds, isRigidMaterial,
    writeGridIndex, markDirtyRect, markCellIndex, neighborIndices8,
    BUOY_WET_PERIMETER_FRAC, BUOY_DRAFT_SCALE, BUOY_BAND_MIN, BUOY_BAND_FRAC, BUOY_SUPPORT_FRAC,
    DIRS_LEFT_FIRST, DIRS_RIGHT_FIRST,
    TRUNK_THICKEN_UNTIL_WOOD, TRUNK_SIDE_FILL_P, TRUNK_DOUBLE_SIDE_FILL_P, TRUNK_WIDE_SIDE_FILL_P,
    MAX_WOOD_CELLS, MAX_LEAF_CELLS, GROWTH_P, LEAF_GROWTH_P, WATER_PER_GROWTH,
    get grid() { return grid; }, set grid(v) { grid = v; },
    get next() { return next; }, set next(v) { next = v; },
    get emittersEnabled() { return emittersEnabled; },
    get bodyCells() { return bodyCells; }, set bodyCells(v) { bodyCells = v; },
    get rigidRejectedCells() { return rigidRejectedCells; }, set rigidRejectedCells(v) { rigidRejectedCells = v; },
    get rigidDepenetrations() { return rigidDepenetrations; }, set rigidDepenetrations(v) { rigidDepenetrations = v; },
    get stoneComponents() { return stoneComponents; }, set stoneComponents(v) { stoneComponents = v; },
    get plantComponents() { return plantComponents; }, set plantComponents(v) { plantComponents = v; },
    get iceComponents() { return iceComponents; }, set iceComponents(v) { iceComponents = v; },
    get nextStoneId() { return nextStoneId; }, set nextStoneId(v) { nextStoneId = v; },
    get nextPlantId() { return nextPlantId; }, set nextPlantId(v) { nextPlantId = v; },
    get nextIceId() { return nextIceId; }, set nextIceId(v) { nextIceId = v; },
  };
  // Components must be wired first: rigidBodies (computeGrounded) and reactions
  // (register*/split*) consume its functions via S.
  const componentsAPI = createComponents(S);
  Object.assign(S, componentsAPI);
  ({ registerSeededComponents, registerStoneCells, registerIceCells,
     splitComponentsAfterErase, splitRigidAfterErase, computeGrounded, moveRigidAssemblies } = componentsAPI);
  const rigidAPI = createRigidBodies(S);
  Object.assign(S, rigidAPI); // tools' eraseDisc needs eraseBodyCellIndex/finishErasedBodies
  ({ moveBodies, eraseBodyCellIndex, finishErasedBodies, bodyFootprintBlocked } = rigidAPI);
  ({ applyReactions, applyAcid, applyLava, applyIce } = createReactions(S));
  ({ growPlantComponents } = createGrowth(S));
  ({ applyInitialScene, addDiscToStoneDraft, addDiscToIceDraft, finalizeStoneDraft, finalizeIceDraft,
     finalizeDriftwoodDraft,
     getSeedOrigin, canPlaceSeedAt, placeSeedAt, paintDisc, eraseDisc, applyEmitters } = createTools(S));

  if (infinite) {
    // Fill the whole buffer from the streaming generator instead of a scene.
    // worldOffsetX is set so world-x 0 sits at the buffer's horizontal center.
    streamGen = createStreamGen({ worldRows: rows, MAT, seed: worldSeed });
    worldOffsetX = -Math.floor(cols / 2);
    streamGen.generateBand({ grid, next, bufCols: cols, colStart: 0, colCount: cols, worldOffsetX });
    registerSeededComponents();
    worldWindow = createWorldWindow(S, {
      bufCols: cols,
      worldRows: rows,
      compOccStamp,
      vacatedStamp,
      rowMarkMin,
      rowMarkMax,
      generateBand: streamGen.generateBand,
      getWorldOffsetX: () => worldOffsetX,
      setWorldOffsetX: (v) => { worldOffsetX = v; },
      chunkStore: createChunkStore({ worldRows: rows }),
    });
  } else {
    applyInitialScene();
  }
  markAllDirty();

  return {
    cols,
    rows,
    chunkCols,
    chunkRows,
    step,
    // Streaming world: world-x of buffer column 0, and the surface row for a
    // world column (used by the UI to spawn the camera near the surface).
    getWorldOffsetX() { return worldOffsetX; },
    worldSurfaceAt(worldX) { return streamGen ? streamGen.surfaceAt(worldX) : 0; },
    // Slide the loaded window by dx world-columns (dx>0 reveals the right edge).
    shiftWorld(dx) { if (worldWindow) worldWindow.shiftWorld(dx); },
    setEmittersOn(v) { emittersEnabled = !!v; },
    setSinksOn(v) { sinksEnabled = !!v; },
    paintDisc,
    eraseDisc,
    getSeedOrigin,
    canPlaceSeedAt,
    placeSeedAt,
    addDiscToStoneDraft,
    finalizeStoneDraft,
    finalizeDriftwoodDraft,
    clearStoneDraft() { stoneDraft.clear(); },
    getStoneDraftCells() { return stoneDraft; },
    addDiscToIceDraft,
    finalizeIceDraft,
    clearIceDraft() { iceDraft.clear(); },
    getIceDraftCells() { return iceDraft; },
    getGrid() { return grid; },
    // Spawn a free rigid body from integer cell coords [[x,y], ...]. Defaults to
    // RIGID material at DENSITY[RIGID]. Returns the body handle.
    spawnBody(cells, opts = {}) {
      const body = rigidWorld.spawnBody(cells, {
        material: RIGID,
        density: DENSITY[RIGID],
        ...opts,
      });
      if (body && cells.length > 0) {
        let minX = cols - 1, minY = rows - 1, maxX = 0, maxY = 0;
        for (const [x, y] of cells) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        markDirtyRect(minX, minY, maxX, maxY);
      }
      return body;
    },
    getBodies() { return rigidWorld.bodies; },
    // Number of a body's rasterized cells overlapping non-occupiable terrain.
    // Exposed for the raster overlap validator's tests/diagnostics.
    bodyFootprintBlocked(b) { return bodyFootprintBlocked(b); },
    // Diagnostics from the last moveBodies() pass: cells the final raster had
    // to skip (should be ~0) and how many bodies were depenetrated.
    getRigidDebug() { return { rejectedCells: rigidRejectedCells, depenetrations: rigidDepenetrations }; },
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
