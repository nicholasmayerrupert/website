// Free rigid bodies: a continuous (float pose + rotation) physics layer, solved
// in rigid2d.js, that the cellular grid interacts with. Each tick the engine
// rasterizes body footprints into the grid as RIGID cells and clears the prior
// footprint; this module owns that rasterization, the post-solve depenetration
// validator, displaced-material spill, and grid-driven erosion/erasure of body
// cells. It is grid-aligned-component-agnostic — those live in the engine core.
//
// Created with a shared engine context `S` (see createEngine). Reassigned engine
// bindings (grid, bodyCells, diagnostics) are read/written through S; stable
// refs (dims, tables, helpers, rigidWorld) are destructured once.

export function createRigidBodies(S) {
  const {
    cols, rows, rand,
    EMPTY, SAND, STONE, WOOD, PLANT, SEED, ICE, FIRE, STEAM, ACID, LAVA, RIGID,
    DENSITY, ACID_DISSOLVE_P, RIGID_LAVA_ERODE_P, RIGID_FIRE_ERODE_P,
    rigidWorld, bodyOwner, groundedCell,
    isLiquid, isGas, writeGridIndex, markDirtyRect, computeGrounded,
  } = S;

  // Terrain a body collides against: settled solids, not liquids/gas/empty and
  // not RIGID (body cells are cleared from the grid before the solver runs).
  const isBodyTerrain = (x, y) => {
    const grid = S.grid;
    const k = y * cols + x;
    const m = grid[k];
    if (m === SAND) return groundedCell[k] === 1;
    return m === STONE || m === WOOD || m === PLANT || m === SEED || m === ICE;
  };
  const fluidDensityAt = (x, y) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return 0;
    const m = S.grid[y * cols + x];
    return isLiquid(m) ? DENSITY[m] : 0;
  };
  const isBodyRelocatable = (material, k) =>
    isLiquid(material) || (material === SAND && groundedCell[k] !== 1);
  const canBodyOccupy = (material, k) =>
    material === EMPTY || material === FIRE || material === STEAM || isBodyRelocatable(material, k);
  const spillDisplacedBodyMaterial = (displaced, footprint, edgeFootprint) => {
    if (displaced.length === 0) return;
    const grid = S.grid;
    const neighborOffsets = [-cols, -1, 1, cols];
    const seen = new Set();
    const queue = [];
    // Cells the search can move through: empty, fluid, gas, or ungrounded sand.
    const isPassable = (m, k) =>
      m === EMPTY || isLiquid(m) || isGas(m) || (m === SAND && groundedCell[k] !== 1);
    const canVisit = (k) => {
      if (k <= 0 || k >= grid.length || footprint.has(k) || seen.has(k)) return false;
      const y = (k / cols) | 0;
      const x = k - y * cols;
      return x > 0 && x < cols - 1 && y > 0 && y < rows && isPassable(grid[k], k);
    };
    // A displaced pixel of `mat` can land here if the cell is empty, or holds a
    // gas/fluid strictly lighter than `mat` (which then gets displaced in turn).
    // Gas density is 0, so it is always lighter than any fluid/powder.
    const isDropTarget = (k, mat) => {
      if (footprint.has(k)) return false;
      const m = grid[k];
      if (m === EMPTY) return true;
      return (isLiquid(m) || isGas(m)) && DENSITY[m] < DENSITY[mat];
    };
    // Fallback search seeds only from the displacing body's own footprint edge,
    // so water a submerged body sheds can never be routed out next to a
    // different body that happens to be sitting in open air.
    const footprintEdgeStarts = [];
    const footprintEdgeSeen = new Set();
    const sortedFootprint = [...edgeFootprint].sort((a, b) => a - b);
    for (const k of sortedFootprint) {
      for (const off of neighborOffsets) {
        const nk = k + off;
        if (footprintEdgeSeen.has(nk)) continue;
        const y = (nk / cols) | 0;
        const x = nk - y * cols;
        if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) continue;
        if (isPassable(grid[nk], nk)) {
          footprintEdgeSeen.add(nk);
          footprintEdgeStarts.push(nk);
        }
      }
    }

    // Worklist of materials needing a home. Heaviest-first so heavy pixels
    // settle before the lighter material they evict is re-placed. Every evicted
    // pixel is strictly lighter than the one that displaced it, so the density
    // chain monotonically descends and the loop terminates.
    const worklist = [...displaced].sort((a, b) => DENSITY[b.material] - DENSITY[a.material]);
    for (let wi = 0; wi < worklist.length; wi++) {
      const d = worklist[wi];
      seen.clear();
      queue.length = 0;
      let target = -1;
      for (const off of neighborOffsets) {
        const nk = d.from + off;
        if (!canVisit(nk)) continue;
        seen.add(nk);
        queue.push(nk);
      }
      if (queue.length === 0) {
        for (const nk of footprintEdgeStarts) {
          if (!canVisit(nk)) continue;
          seen.add(nk);
          queue.push(nk);
        }
      }
      for (let qi = 0; qi < queue.length; qi++) {
        const k = queue[qi];
        if (isDropTarget(k, d.material)) { target = k; break; }
        for (const off of neighborOffsets) {
          const nk = k + off;
          if (!canVisit(nk)) continue;
          seen.add(nk);
          queue.push(nk);
        }
      }
      if (target >= 0) {
        const evicted = grid[target];
        if (evicted !== EMPTY) worklist.push({ material: evicted, from: target });
        writeGridIndex(target, d.material);
      }
    }
  };
  const rigidErodeProbabilityAt = (k) => {
    const grid = S.grid;
    let p = 0;
    const consider = (nk) => {
      const m = grid[nk];
      if (m === ACID) p = Math.max(p, ACID_DISSOLVE_P);
      else if (m === LAVA) p = Math.max(p, RIGID_LAVA_ERODE_P);
      else if (m === FIRE) p = Math.max(p, RIGID_FIRE_ERODE_P);
    };
    const x = k % cols;
    const y = (k / cols) | 0;
    if (x < cols - 1) consider(k + 1);
    if (x > 0) consider(k - 1);
    if (y < rows - 1) consider(k + cols);
    if (y > 0) consider(k - cols);
    return p;
  };
  const eraseBodyCellIndex = (k, bodyById, dirtyBodies) => {
    const grid = S.grid;
    const id = bodyOwner[k];
    if (id < 0 || grid[k] !== RIGID) return false;
    const b = bodyById.get(id);
    if (!b) return false;
    const y = (k / cols) | 0;
    const x = k - y * cols;
    const idx = rigidWorld.localCellAt(b, x + 0.5, y + 0.5);
    if (idx < 0 || !rigidWorld.eraseLocalCell(b, idx)) return false;
    writeGridIndex(k, EMPTY);
    bodyOwner[k] = -1;
    dirtyBodies.add(b);
    return true;
  };
  const finishErasedBodies = (dirtyBodies, cells) => {
    if (dirtyBodies.size === 0) return cells;
    const grid = S.grid;
    const removedIds = new Set();
    for (const b of dirtyBodies) {
      if (rigidWorld.recomputeBody(b)) {
        rigidWorld.splitDisconnectedBody(b);
        continue;
      }
      removedIds.add(b.id);
    }
    if (removedIds.size > 0) {
      for (let i = rigidWorld.bodies.length - 1; i >= 0; i--) {
        if (removedIds.has(rigidWorld.bodies[i].id)) rigidWorld.bodies.splice(i, 1);
      }
      for (const k of cells) {
        if (!removedIds.has(bodyOwner[k])) continue;
        if (grid[k] === RIGID) writeGridIndex(k, EMPTY);
        bodyOwner[k] = -1;
      }
    }
    for (const k of cells) {
      if (grid[k] === RIGID) bodyOwner[k] = -1;
    }
    const kept = [];
    const claimed = new Set();
    for (const b of rigidWorld.bodies) {
      rigidWorld.forEachBodyCell(b, (x, y) => {
        const k = y * cols + x;
        if (grid[k] !== RIGID || claimed.has(k)) return;
        bodyOwner[k] = b.id;
        claimed.add(k);
        kept.push(k);
      });
    }
    for (const k of cells) {
      if (grid[k] === RIGID && !claimed.has(k)) {
        writeGridIndex(k, EMPTY);
        bodyOwner[k] = -1;
      }
    }
    return kept;
  };
  const erodeBodies = (cells) => {
    if (cells.length === 0) return cells;
    const bodyById = new Map();
    for (const b of rigidWorld.bodies) bodyById.set(b.id, b);
    const dirtyBodies = new Set();

    for (const k of cells) {
      const p = rigidErodeProbabilityAt(k);
      if (p <= 0 || rand() >= p) continue;
      eraseBodyCellIndex(k, bodyById, dirtyBodies);
    }
    return finishErasedBodies(dirtyBodies, cells);
  };
  // Post-solve raster overlap validator. The continuous rigid solver works in
  // float poses; its rasterized footprint can dip a row into terrain even when
  // the solver thought it was resting. These helpers validate/correct the pose
  // before it is stamped, so a body never accepts a footprint that overlaps
  // terrain (which the final raster would otherwise silently drop, leaving a
  // visibly chewed-off body).
  const capturePose = (b) => ({ px: b.px, py: b.py, angle: b.angle });
  const applyPose = (b, px, py, angle) => { b.px = px; b.py = py; b.angle = angle; };
  // How many of a body's rasterized cells land on non-occupiable terrain.
  const bodyFootprintBlocked = (b) => {
    const grid = S.grid;
    let blocked = 0;
    rigidWorld.forEachBodyCell(b, (x, y) => {
      const k = y * cols + x;
      const m = grid[k];
      // Ignore the body's own already-stamped footprint (RIGID owned by b) so
      // the count means "overlapping terrain / another body". During the
      // in-engine validator pass footprints are cleared, so this is a no-op
      // there; it matters when the helper is called after rasterization.
      if (m === RIGID && bodyOwner[k] === b.id) return;
      if (!canBodyOccupy(m, k)) blocked++;
    });
    return blocked;
  };
  // Shallow edge/corner overlap is tolerated so a body can tip and roll across
  // a ledge: rotating a corner momentarily dips a cell or two into terrain, and
  // the final rasterizer defensively skips those few cells. The validator is a
  // safety net for *deep* clipping (a body sunk well into the ground), not a
  // hard constraint that forbids that borderline overlap. The allowance scales
  // with the body's smaller dimension so a full submerged row always trips it.
  const bodyDepenTolerance = (b) => Math.max(1, Math.floor(Math.min(b.w, b.h) * 0.34));
  // Push a body out of terrain its post-step footprint *deeply* overlaps.
  // Rotation is never rolled back (tipping/rolling must survive) — only the
  // translation this step is undone:
  // 1) If the pre-step position (at the new angle) is within tolerance,
  //    binary-search the straight translation old->new and accept the latest
  //    in-tolerance pose, then kill the velocity component driving into terrain.
  // 2) Otherwise lift straight up in small cell fractions, holding the new
  //    angle. Returns true if the pose was corrected.
  const depenetrateBodyRaster = (b, prePose) => {
    const tol = bodyDepenTolerance(b);
    if (bodyFootprintBlocked(b) <= tol) return false;
    const newPx = b.px, newPy = b.py, newAngle = b.angle;

    if (prePose) {
      // Hold the solver's new angle; only the position is pulled back.
      applyPose(b, prePose.px, prePose.py, newAngle);
      if (bodyFootprintBlocked(b) <= tol) {
        // lo is always an in-tolerance fraction along old->new, hi always over.
        let lo = 0, hi = 1;
        for (let iter = 0; iter < 6; iter++) {
          const mid = (lo + hi) * 0.5;
          applyPose(b,
            prePose.px + (newPx - prePose.px) * mid,
            prePose.py + (newPy - prePose.py) * mid,
            newAngle);
          if (bodyFootprintBlocked(b) <= tol) lo = mid; else hi = mid;
        }
        applyPose(b,
          prePose.px + (newPx - prePose.px) * lo,
          prePose.py + (newPy - prePose.py) * lo,
          newAngle);
        // Remove the velocity component along the motion we just undid so the
        // body stops pushing into the terrain next step (e.g. zeroes vy when it
        // was falling onto a floor, vx when sliding into a wall).
        const mvx = newPx - prePose.px, mvy = newPy - prePose.py;
        const len = Math.hypot(mvx, mvy);
        if (len > 1e-6) {
          const nx = mvx / len, ny = mvy / len;
          const vn = b.vx * nx + b.vy * ny;
          if (vn > 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
        }
        b.awake = true;
        b.stillTicks = 0;
        return true;
      }
    }

    // Fallback: vertical lift out of the ground, holding the new angle.
    applyPose(b, newPx, newPy, newAngle);
    const maxLift = 3.0;
    const step = 0.125;
    for (let lift = step; lift <= maxLift + 1e-9; lift += step) {
      b.py = newPy - lift;
      if (bodyFootprintBlocked(b) <= tol) {
        if (b.vy > 0) b.vy = 0;
        b.awake = true;
        b.stillTicks = 0;
        return true;
      }
    }
    // No in-tolerance pose found: restore the solver pose. The final
    // rasterization stays defensive and simply won't overwrite terrain cells.
    applyPose(b, newPx, newPy, newAngle);
    return false;
  };

  const moveBodies = () => {
    const grid = S.grid;
    if (rigidWorld.bodies.length === 0 && S.bodyCells.length === 0) return;
    // Ground while body footprints are still rasterized, so sand resting on a
    // grounded body (RIGID is bearing) is itself recognized as grounded terrain.
    // Clearing first would leave that sand floating above EMPTY and a body
    // dropped onto it would treat it as loose and fall through.
    computeGrounded();
    // Now clear the footprint (rasterized last tick) so the solver sees only
    // terrain and no stale ghost trails behind a moving body.
    for (const k of S.bodyCells) {
      if (grid[k] === RIGID) writeGridIndex(k, EMPTY);
      bodyOwner[k] = -1;
    }
    // Snapshot pre-step poses so the validator can binary-search the path each
    // body travelled this step when its new footprint overlaps terrain.
    const prePoses = new Map();
    for (const b of rigidWorld.bodies) prePoses.set(b.id, capturePose(b));
    rigidWorld.step(isBodyTerrain, fluidDensityAt);
    // Validate/correct each body's rasterized footprint before stamping it, so
    // a continuous pose that has partly entered the ground is pushed back out
    // rather than silently clipped during rasterization below.
    S.rigidRejectedCells = 0;
    S.rigidDepenetrations = 0;
    for (const b of rigidWorld.bodies) {
      if (depenetrateBodyRaster(b, prePoses.get(b.id))) S.rigidDepenetrations++;
    }
    // Rasterize the new footprint. A cell already claimed by terrain stays
    // terrain (the body rests against it); empty/liquid/loose-sand cells become
    // RIGID and the displaced material is spilled into connected empty space.
    const cells = [];
    const footprint = new Set();
    const perBody = new Map();
    for (const b of rigidWorld.bodies) {
      let pb = perBody.get(b.id);
      if (!pb) { pb = { displaced: [], footprint: new Set() }; perBody.set(b.id, pb); }
      rigidWorld.forEachBodyCell(b, (x, y) => {
        const k = y * cols + x;
        if (bodyOwner[k] !== -1) return;
        const m = grid[k];
        // Defensive: the validator should have cleared terrain overlap, but a
        // body that couldn't be depenetrated still must not overwrite terrain.
        // Count these so clipping failures are visible in dev.
        if (!canBodyOccupy(m, k)) { S.rigidRejectedCells++; return; }
        if (isBodyRelocatable(m, k)) pb.displaced.push({ material: m, from: k });
        writeGridIndex(k, RIGID);
        bodyOwner[k] = b.id;
        cells.push(k);
        footprint.add(k);
        pb.footprint.add(k);
      });
    }
    for (const pb of perBody.values()) {
      spillDisplacedBodyMaterial(pb.displaced, footprint, pb.footprint);
    }
    S.bodyCells = erodeBodies(cells);
    // Dev-only: surface clipping failures the validator couldn't resolve.
    if (S.rigidRejectedCells > 0 && import.meta.env?.DEV && typeof console !== 'undefined') {
      console.warn(`[sand] rigid raster overlap: ${S.rigidRejectedCells} cell(s) skipped after ${S.rigidDepenetrations} depenetration(s)`);
    }
  };

  return { moveBodies, eraseBodyCellIndex, finishErasedBodies, bodyFootprintBlocked };
}
