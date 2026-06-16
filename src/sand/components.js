// Grid-aligned rigid components: connected sets of stone / wood-plant / ice
// cells tracked as cohesive structures (distinct from the continuous free
// bodies in rigidBodies.js). This module owns:
//   - the support solver (computeGrounded): which components have a load path
//     to the floor, so unsupported ones fall;
//   - cohesive movement + buoyancy (moveRigidAssemblies): touching components
//     of any type are unioned into one assembly that falls/sinks/floats together;
//   - component bookkeeping: registering seeded/painted cells into components,
//     and re-splitting components after cells are erased/dissolved/melted.
//
// Created with the shared engine context `S`. `grid` is read live through S;
// component lists and id counters are read/written through S accessors.

export function createComponents(S) {
  const {
    cols, rows, I, CHUNK_SHIFT,
    EMPTY, SAND, STONE, WOOD, PLANT, SEED, ICE, LAVA, RIGID,
    DENSITY, BUOY_WET_PERIMETER_FRAC, BUOY_DRAFT_SCALE, BUOY_BAND_MIN, BUOY_BAND_FRAC, BUOY_SUPPORT_FRAC,
    isLiquid, isGas, isPlantMaterial, isRigidMaterial, neighborIndices8, writeGridIndex,
    groundedCell, cellComp, groundStack,
  } = S;

  const isBearingMaterial = (m) => m === SAND || isRigidMaterial(m);
  // A falling rigid body may pass through liquids, plus EMPTY, plus
  // (ungrounded) SAND. It never reaches here resting on *grounded* sand — that
  // case is grounded and skipped — so treating SAND as passable only sinks a
  // body through genuinely unsupported sand.
  const componentDisplaceable = (m) =>
    m === EMPTY || m === SAND || isLiquid(m) || isGas(m);

  // Compute which rigid components have a support path to the floor. Sets
  // `comp.grounded` on every stone/plant/ice component. A component is grounded if
  // any of its cells rests (directly above) on a bearing cell that is itself
  // grounded — seeded from the floor row and propagated upward to a fixpoint, with
  // rigid components grounded as a whole (rigid coupling) so arches, battlements,
  // canopies and cave roofs bridged to their walls stay up.
  function computeGrounded() {
    const grid = S.grid;
    groundedCell.fill(0);
    cellComp.fill(-1);
    const comps = [];
    const indexComps = (list) => {
      for (const c of list) {
        c.grounded = false;
        const id = comps.length;
        comps.push(c);
        for (const k of c.cells) cellComp[k] = id;
      }
    };
    indexComps(S.stoneComponents);
    indexComps(S.plantComponents);
    indexComps(S.iceComponents);

    let sp = 0;
    const groundComp = (id) => {
      const c = comps[id];
      if (c.grounded) return;
      c.grounded = true;
      for (const k of c.cells) {
        if (!groundedCell[k]) { groundedCell[k] = 1; groundStack[sp++] = k; }
      }
    };
    const groundCellAt = (k, m) => {
      if (groundedCell[k]) return;
      if (isRigidMaterial(m)) {
        const id = cellComp[k];
        if (id >= 0) { groundComp(id); return; }
      }
      groundedCell[k] = 1;
      groundStack[sp++] = k;
    };

    // Seed: bearing cells resting on the floor.
    const floorBase = (rows - 1) * cols;
    for (let x = 0; x < cols; x++) {
      const k = floorBase + x;
      const m = grid[k];
      if (isBearingMaterial(m)) groundCellAt(k, m);
    }
    // Viscous lava can carry a settled sand crust. Seed those sand cells as
    // grounded so rigid bodies rest on the crust instead of treating it as loose.
    for (let y = rows - 2; y > 0; y--) {
      const rowBase = y * cols;
      for (let x = 1; x < cols - 1; x++) {
        const k = rowBase + x;
        if (grid[k] === SAND && grid[k + cols] === LAVA) groundCellAt(k, SAND);
      }
    }
    // Propagate upward: the cell resting on a grounded cell becomes grounded.
    while (sp > 0) {
      const k = groundStack[--sp];
      const above = k - cols;
      if (above < 0) continue;
      const m = grid[above];
      if (isBearingMaterial(m) && !groundedCell[above]) groundCellAt(above, m);
    }
  }

  // --- Cohesive STONE chunks ---
  // Move rigid bodies by one cell when unsupported: sink, rise or rest by
  // buoyancy when touching liquid, else fall. Stone, plant and ice
  // components that touch are one physical STRUCTURE (a building is stone walls +
  // wood roof + ivy), so they are unioned into type-agnostic ASSEMBLIES and fall
  // together. Without this, two interlocked components of different types each see
  // the other as a non-displaceable cell directly below and refuse to move, so an
  // ungrounded structure hangs in mid-air. `cellComp` and the stone→plant→ice
  // ordering are produced by computeGrounded(), which runs immediately before this.
  function moveRigidAssemblies() {
    const grid = S.grid;
    const stoneComponents = S.stoneComponents;
    const plantComponents = S.plantComponents;
    const iceComponents = S.iceComponents;
    const all = [];
    for (const c of stoneComponents) all.push(c);
    const nStone = all.length;
    for (const c of plantComponents) all.push(c);
    const nStonePlant = all.length;
    for (const c of iceComponents) all.push(c);
    const n = all.length;
    if (n === 0) return;

    for (const comp of all) {
      let ym = 0;
      for (const k of comp.cells) { const y = (k / cols) | 0; if (y > ym) ym = y; }
      comp.yMax = ym;
    }

    // Union components into assemblies by 8-adjacency (cellComp maps a cell to its
    // index in `all`, set by computeGrounded over the same lists in the same order).
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let i = 0; i < n; i++) {
      for (const k of all[i].cells) {
        const y = (k / cols) | 0; const x = k - y * cols;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox; const ny = y + oy;
            if (nx < 1 || nx >= cols - 1 || ny < 1 || ny >= rows) continue;
            const j = cellComp[ny * cols + nx];
            if (j >= 0) { const ri = find(i); const rj = find(j); if (ri !== rj) parent[ri] = rj; }
          }
        }
      }
    }

    // Group components by assembly; an assembly is grounded if any member is.
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (!g) { g = { comps: [], grounded: false, maxY: 0 }; groups.set(r, g); }
      g.comps.push(i);
      if (all[i].grounded) g.grounded = true;
      if (all[i].yMax > g.maxY) g.maxY = all[i].yMax;
    }
    const order = [...groups.values()].sort((a, b) => b.maxY - a.maxY);

    const matOf = (i, k) =>
      i < nStone ? STONE : (i < nStonePlant ? grid[k] : ICE);

    // Translate a whole assembly one cell along `dir` (+cols = down, -cols = up).
    // Displaced liquid is routed to connected free volume, so a sinking solid
    // raises reachable fluid instead of teleporting a sheet onto its top or
    // through unrelated walls. Non-liquid displaceables still fall back to
    // trailing cells.
    const translateAssembly = (grp, cells, dir) => {
      const dy = dir > 0 ? 1 : -1;
      const movedCells = new Set();
      // Can the whole assembly shift one cell along `dir`?
      for (const k of cells) {
        const leadK = k + dir;
        const leadY = (leadK / cols) | 0;
        if (leadY < 1 || leadY >= rows) return false;
        if (cells.has(leadK)) continue;
        if (!componentDisplaceable(grid[leadK])) return false;
      }
      for (const k of cells) {
        const nk = k + dir;
        movedCells.add(nk);
      }

      // Material shoved off the leading edge, plus trailing cells the assembly
      // vacates.
      const displaced = [];
      const vacated = [];
      for (const k of cells) {
        const leadK = k + dir;
        const lead = grid[leadK];
        if (!cells.has(leadK) && lead !== EMPTY && componentDisplaceable(lead)) {
          displaced.push({ material: lead, from: leadK });
        }
        if (!cells.has(k - dir)) vacated.push(k);
      }

      const liquidDisplacedCount = displaced.reduce((n, d) => n + (isLiquid(d.material) ? 1 : 0), 0);
      const sideSpillTargets = [];
      if (liquidDisplacedCount > 0) {
        const seen = new Set();
        const reserved = new Set();
        const queue = [];
        const neighborOffsets = dir > 0
          ? [-1, 1, cols, -cols]
          : [-1, 1, -cols, cols];
        const canVisit = (k) => {
          if (k < 0 || k >= grid.length || seen.has(k)) return false;
          const y = (k / cols) | 0;
          const x = k - y * cols;
          if (x <= 0 || x >= cols - 1 || y <= 0 || y >= rows) return false;
          if (cells.has(k) || movedCells.has(k)) return false;
          const m = grid[k];
          return m === EMPTY || isLiquid(m);
        };
        const enqueue = (k) => {
          if (!canVisit(k)) return;
          seen.add(k);
          queue.push(k);
        };

        for (const d of displaced) {
          if (!isLiquid(d.material)) continue;
          for (const off of neighborOffsets) enqueue(d.from + off);
        }

        for (let qi = 0; qi < queue.length && sideSpillTargets.length < liquidDisplacedCount; qi++) {
          const k = queue[qi];
          if (grid[k] === EMPTY) {
            if (!reserved.has(k)) {
              reserved.add(k);
              sideSpillTargets.push(k);
            }
            continue;
          }
          for (const off of neighborOffsets) enqueue(k + off);
        }
        if (sideSpillTargets.length < liquidDisplacedCount) {
          // No connected free volume for the displaced liquid. Treat the liquid
          // as incompressible and leave the rigid body in place instead of
          // teleporting fluid through walls or onto the trailing face.
          return false;
        }
      }

      // Capture each component's moved materials BEFORE clearing the grid.
      const moves = [];
      for (const ci of grp.comps) {
        const comp = all[ci];
        const isPlant = ci >= nStone && ci < nStonePlant;
        const mats = [];
        let wood = 0; let leaf = 0;
        for (const k of comp.cells) {
          const m = matOf(ci, k);
          mats.push([k + dir, m]);
          if (isPlant) { if (m === WOOD) wood++; else if (m === PLANT) leaf++; }
        }
        moves.push({ comp, isPlant, mats, wood, leaf });
      }

      for (const k of cells) writeGridIndex(k, EMPTY);

      for (const mv of moves) {
        const newCells = new Set();
        for (const [nk, m] of mv.mats) { writeGridIndex(nk, m); newCells.add(nk); }
        mv.comp.cells = newCells;
        mv.comp.yMax = Math.max(0, Math.min(rows - 1, mv.comp.yMax + dy));
        if (mv.isPlant) {
          mv.comp.woodCount = mv.wood;
          mv.comp.leafCount = mv.leaf;
          mv.comp.cacheDirty = true;
        }
      }

      // Preserve displaced material. Liquids spill beside the moved assembly;
      // non-liquids use the trailing cells as before.
      let di = 0;
      let si = 0;
      for (const d of displaced) {
        if (isLiquid(d.material)) {
          writeGridIndex(sideSpillTargets[si++], d.material);
          continue;
        }
        while (di < vacated.length && grid[vacated[di]] !== EMPTY) di++;
        if (di < vacated.length) writeGridIndex(vacated[di++], d.material);
      }
      return true;
    };

    const measureLiquidImmersion = (cells) => {
      let wetCells = 0;
      let exposedCells = 0;
      let liquidDensity = 0;
      let liquidContacts = 0;
      let bottomExposed = 0; // cells with open space directly below (the underside)
      let bottomLiquid = 0;  // of those, how many rest on liquid

      for (const k of cells) {
        const y = (k / cols) | 0;
        const x = k - y * cols;
        let wet = false;
        let exposed = false;

        if (x > 1 && !cells.has(k - 1)) {
          exposed = true;
          const m = grid[k - 1];
          if (isLiquid(m)) {
            wet = true;
            liquidDensity += DENSITY[m];
            liquidContacts++;
          }
        }
        if (x < cols - 2 && !cells.has(k + 1)) {
          exposed = true;
          const m = grid[k + 1];
          if (isLiquid(m)) {
            wet = true;
            liquidDensity += DENSITY[m];
            liquidContacts++;
          }
        }
        if (y > 1 && !cells.has(k - cols)) {
          exposed = true;
          // Liquid directly ABOVE a cell does not provide buoyant support — only
          // perimeter exposure. Counting it as "wet" let water poured onto an
          // ungrounded structure inflate its submersion measure and rocket it
          // upward toward the source. Sides and the cell below still count.
        }
        if (y < rows - 1 && !cells.has(k + cols)) {
          exposed = true;
          bottomExposed++;
          const m = grid[k + cols];
          if (isLiquid(m)) {
            wet = true;
            bottomLiquid++;
            liquidDensity += DENSITY[m];
            liquidContacts++;
          }
        }

        if (exposed) exposedCells++;
        if (wet) wetCells++;
      }

      if (liquidContacts === 0) return null;
      const requiredWetCells = Math.max(1, Math.ceil(Math.sqrt(cells.size) * BUOY_WET_PERIMETER_FRAC));
      if (wetCells < requiredWetCells) return null;
      return {
        wetCells,
        exposedCells,
        bottomExposed,
        bottomLiquid,
        liquidDensity: liquidDensity / liquidContacts,
      };
    };

    for (const grp of order) {
      if (grp.grounded) continue; // structure has a path to the floor — stays put

      const cells = new Set();
      for (const ci of grp.comps) for (const k of all[ci].cells) cells.add(k);

      // Assembly density, width, and actual wet
      // contact. Sparse contact keeps behaving like air; meaningful immersion uses
      // the contacted liquid density for generic floating/sinking.
      let weight = 0;
      let xMin = cols, xMax = 0;
      for (const ci of grp.comps) for (const k of all[ci].cells) {
        weight += DENSITY[matOf(ci, k)];
        const x = k - ((k / cols) | 0) * cols;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }

      const immersion = measureLiquidImmersion(cells);
      if (!immersion) {
        translateAssembly(grp, cells, cols); // in air — fall under gravity
        continue;
      }

      // Buoyancy: wet perimeter approximates displaced liquid in this coarse grid.
      // Equilibrium is density-scaled against exposed perimeter, not total area, so
      // a growing light body still floats while dense bodies still sink.
      const avgDensity = weight / cells.size;
      if (avgDensity > immersion.liquidDensity) {
        translateAssembly(grp, cells, cols);
        continue;
      }
      const targetWetCells = immersion.exposedCells * (avgDensity / immersion.liquidDensity) * BUOY_DRAFT_SCALE;
      const imbalance = immersion.wetCells - targetWetCells; // >0 over-submerged (rise), <0 sink
      const band = Math.max(BUOY_BAND_MIN, (xMax - xMin + 1) * BUOY_BAND_FRAC);
      // A body may only float UP when its underside genuinely rests in liquid — a
      // real pool buoys it up, but water merely running down its sides (a tap /
      // waterfall) does not. Without this gate a light body chases the falling
      // water column and rockets up to the source.
      const buoyantSupport =
        immersion.bottomExposed > 0 &&
        immersion.bottomLiquid >= immersion.bottomExposed * BUOY_SUPPORT_FRAC;
      if (imbalance < -band) translateAssembly(grp, cells, cols);        // too light a draught — sink
      else if (imbalance > band) {
        if (buoyantSupport) translateAssembly(grp, cells, -cols);        // over-submerged in liquid — rise
        else translateAssembly(grp, cells, cols);                        // only splashed — fall under gravity
      }
      // else within the deadband — rest
    }
  }

  // Scan the grid and register any stone/plant/ice cells not already owned by a
  // component (e.g. from a scene build or raw paint). Idempotent: cells already
  // in a component are skipped, so it can adopt orphaned cells on re-run.
  // Register seeded components. With no range, scans the whole grid; with
  // [colStart, colEnd) it scans only those columns (used after a world shift to
  // register just the freshly exposed band, additively). `bounded` keeps a
  // component inside one render-chunk box so huge contiguous regions (the stone
  // core) split into many small components — splitting/erasing then touches only a
  // tiny piece instead of flood-filling the whole underground.
  const registerSeededComponents = (colStart = 0, colEnd = cols) => {
    const grid = S.grid;
    const registerComponents = (materialCheck, components, makeComponent, bounded = false) => {
      const seen = new Uint8Array(cols * rows);
      for (const comp of components) {
        for (const k of comp.cells) seen[k] = 1;
      }
      for (let sy = 0; sy < rows; sy++) {
        for (let sx = colStart; sx < colEnd; sx++) {
          const k = sy * cols + sx;
          if (seen[k] || !materialCheck(grid[k])) continue;
          const bx = bounded ? sx >> CHUNK_SHIFT : 0;
          const by = bounded ? sy >> CHUNK_SHIFT : 0;
          const cells = new Set([k]);
          const queue = [k];
          seen[k] = 1;
          let yMax = sy;

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
                // Keep each component within a single render-chunk box.
                if (bounded && ((nx >> CHUNK_SHIFT) !== bx || (ny >> CHUNK_SHIFT) !== by)) continue;
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
      }
    };

    registerComponents(
      material => material === STONE,
      S.stoneComponents,
      (cells, yMax) => ({ id: S.nextStoneId++, cells, yMax }),
      true // chunk-bound stone so the underground isn't one giant component
    );
    registerComponents(
      isPlantMaterial,
      S.plantComponents,
      (cells, yMax) => {
        let woodCount = 0;
        let leafCount = 0;
        for (const k of cells) {
          if (grid[k] === WOOD) woodCount++;
          else if (grid[k] === PLANT) leafCount++;
        }
        return {
          id: S.nextPlantId++,
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
      S.iceComponents,
      (cells, yMax) => ({ id: S.nextIceId++, cells, yMax, cacheDirty: true })
    );
  };

  // Register a set of grid cells (already written as STONE) as a stone
  // component, merging with any adjacent existing stone components.
  function registerStoneCells(cells, yMax) {
    if (cells.size === 0) return;
    const grid = S.grid;

    const touchingComponentIds = new Set();
    for (const k of cells) {
      const y = (k / cols) | 0; const x = k - y * cols;
      const nks = neighborIndices8(x, y)
        .filter(nk => nk >= 0 && nk < grid.length && grid[nk] === STONE && !cells.has(nk));
      for (const nk of nks) {
        for (const comp of S.stoneComponents) {
          if (comp.cells.has(nk)) { touchingComponentIds.add(comp.id); break; }
        }
      }
    }

    let newComp = { id: S.nextStoneId++, cells, yMax };
    if (touchingComponentIds.size > 0) {
      const keep = [];
      for (const comp of S.stoneComponents) {
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
      S.stoneComponents = keep;
    }
    S.stoneComponents.push(newComp);
  }

  // Register a set of grid cells (already written as ICE) as an ice component,
  // merging with any adjacent existing ice components.
  function registerIceCells(cells, yMax) {
    if (cells.size === 0) return;
    const grid = S.grid;

    const touchingComponentIds = new Set();
    for (const k of cells) {
      const y = (k / cols) | 0; const x = k - y * cols;
      const nks = neighborIndices8(x, y)
        .filter(nk => nk >= 0 && nk < grid.length && grid[nk] === ICE && !cells.has(nk));
      for (const nk of nks) {
        for (const comp of S.iceComponents) {
          if (comp.cells.has(nk)) { touchingComponentIds.add(comp.id); break; }
        }
      }
    }

    let newComp = { id: S.nextIceId++, cells, yMax, cacheDirty: true };
    if (touchingComponentIds.size > 0) {
      const keep = [];
      for (const comp of S.iceComponents) {
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
      S.iceComponents = keep;
    }
    S.iceComponents.push(newComp);
  }

  function splitComponentsAfterErase(components, allowedMaterial) {
    const grid = S.grid;
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
          id: reusedOriginalId ? S.nextPlantId++ : comp.id,
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
    const grid = S.grid;
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

  return {
    computeGrounded,
    moveRigidAssemblies,
    registerSeededComponents,
    registerStoneCells,
    registerIceCells,
    splitComponentsAfterErase,
    splitRigidAfterErase,
  };
}
