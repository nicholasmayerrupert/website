// Terrain, caves, water and surface scatter — all sampled in world-x so the
// landscape stays coherent and fixed-scale as the viewport widens.
//
// Convention: y grows downward, so a SMALLER surface row means HIGHER ground.

// Build a per-column surface row from layered fbm over world-x. Returns the
// surface array plus a few reference rows the rest of the pipeline shares.
export function heightField(ctx, opts = {}) {
  const { cols, rows, worldX, noise } = ctx;
  const {
    frequency = 0.028, // cycles per cell; ~36-cell hills at base octave
    octaves = 5,
    amplitude = Math.max(8, Math.floor(rows * 0.34)), // vertical relief in cells
    baseFromBottom = Math.max(10, Math.floor(rows * 0.42)), // avg surface height
  } = opts;

  const surface = new Int32Array(cols);
  const baseY = rows - 1 - baseFromBottom;
  for (let x = 0; x < cols; x++) {
    const n = noise.fbm2(worldX(x) * frequency, 0.5, { octaves, gain: 0.5 });
    // Bias toward gentle plains with occasional peaks.
    const shaped = Math.pow(n, 1.3);
    let y = Math.round(baseY - (shaped - 0.5) * 2 * amplitude);
    if (y < 2) y = 2;
    if (y > rows - 3) y = rows - 3;
    surface[x] = y;
  }

  const floorY = rows - 1;
  const seaLevel = Math.min(
    rows - 3,
    baseY + Math.max(2, Math.floor(rows * 0.06))
  );
  return { surface, seaLevel, floorY, baseY };
}

// Fill solid ground below the surface in layers: a grass/sand skin, a sand/dirt
// band, then a stone core down to the floor. Caves are carved afterward.
export function fillTerrain(ctx, field, opts = {}) {
  const { cols, rows, MAT, fillColumn, put } = ctx;
  const { surface } = field;
  const {
    skin = 1, // grass/sand dressing rows
    soil = Math.max(2, Math.floor(rows * 0.05)), // sand/dirt band
  } = opts;

  for (let x = 0; x < cols; x++) {
    const top = surface[x];
    // Stone core to the floor.
    fillColumn(x, top, rows - 1, MAT.STONE);
    // Sand/dirt band.
    for (let d = 0; d < soil; d++) put(x, top + skin + d, MAT.SAND);
    // Surface skin: grass on gentle slopes, bare sand on steep ones.
    const slope =
      Math.abs(surface[Math.min(cols - 1, x + 1)] - surface[Math.max(0, x - 1)]);
    for (let d = 0; d < skin; d++) {
      put(x, top + d, slope <= 1 ? MAT.PLANT : MAT.SAND);
    }
  }
}

// Carve cave systems by tunneling: a handful of "worm" agents walk through the
// rock, each clearing a disc as it goes, wandering and branching into a network
// and occasionally opening a wider chamber. This reads as carved paths and rooms
// rather than scattered noise holes.
//
// Worms never enter the surface skin or the bottom floor band, so every column
// keeps a solid stone slab along the floor — the whole stone mass stays one
// ground-supported component (chambers are bubbles inside it) and roofs never fall.
export function carveCaves(ctx, field, opts = {}) {
  const { cols, rows, MAT, rng } = ctx;
  const { surface } = field;
  const {
    surfaceMargin = Math.max(3, Math.floor(rows * 0.05)),
    floorMargin = Math.max(2, Math.floor(rows * 0.04)),
    tunnels = Math.max(3, Math.round(cols / 32)) + 2, // density scales with width
    radius = 1.6, // base tunnel half-width (cells) — narrow passages
    radiusJitter = 0.9,
    minRadius = 1.1,
    chamberChance = 0.03, // per step: blow out a larger room
    branchChance = 0.05, // per step: split off a side passage
    maxGen = 2, // branch depth
    vertScale = 0.6, // squash vertical motion → horizontal galleries
    wander = 0.4, // radians of heading drift per step
  } = opts;

  const yMax = rows - 1 - floorMargin;
  const ceilAt = (x) => surface[Math.max(0, Math.min(cols - 1, x | 0))] + surfaceMargin;

  // Clear a disc to air, clamped to the cave band so we never breach the skin or
  // the floor slab.
  const carve = (cxp, cyp, r) => {
    const r2 = r * r;
    for (let oy = -Math.ceil(r); oy <= Math.ceil(r); oy++) {
      const y = (cyp + oy) | 0;
      if (y > yMax) continue;
      for (let ox = -Math.ceil(r); ox <= Math.ceil(r); ox++) {
        if (ox * ox + oy * oy > r2) continue;
        const x = (cxp + ox) | 0;
        if (y < ceilAt(x)) continue;
        ctx.put(x, y, MAT.EMPTY);
      }
    }
  };

  // Worm stack. Each: position, heading, radius, remaining steps, branch gen.
  const worms = [];
  for (let i = 0; i < tunnels; i++) {
    const x = 2 + rng() * (cols - 4);
    const ceil = ceilAt(x);
    if (ceil >= yMax) continue;
    const y = ceil + rng() * (yMax - ceil);
    const dir = rng() < 0.5 ? 0 : Math.PI; // bias horizontal
    worms.push({
      x,
      y,
      angle: dir + (rng() - 0.5) * 0.8,
      r: radius + rng() * radiusJitter,
      steps: Math.floor(cols * (0.8 + rng() * 0.9)), // long runs
      gen: 0,
    });
  }

  let budget = cols * 60; // safety cap on total work
  while (worms.length && budget > 0) {
    const w = worms.pop();
    for (let s = 0; s < w.steps && budget > 0; s++, budget--) {
      w.angle += (rng() - 0.5) * wander;

      // Keep inside the vertical band by steering away from ceiling/floor.
      const ceil = ceilAt(w.x);
      if (w.y < ceil) { w.y = ceil; w.angle = Math.abs(Math.sin(w.angle)) * 0.6; }
      else if (w.y > yMax) { w.y = yMax; w.angle = -Math.abs(Math.sin(w.angle)) * 0.6; }

      carve(w.x, w.y, w.r);
      if (rng() < chamberChance) carve(w.x, w.y, w.r + 2 + rng() * 2.5);

      if (w.gen < maxGen && rng() < branchChance) {
        worms.push({
          x: w.x,
          y: w.y,
          angle: w.angle + (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.6),
          r: Math.max(minRadius, w.r - 0.4),
          steps: Math.floor(w.steps * (0.5 + rng() * 0.4)),
          gen: w.gen + 1,
        });
      }

      // Slowly drift the tunnel radius for organic width variation.
      w.r += (rng() - 0.5) * 0.4;
      if (w.r < minRadius) w.r = minRadius;
      if (w.r > radius + radiusJitter + 0.5) w.r = radius + radiusJitter + 0.5;

      w.x += Math.cos(w.angle);
      w.y += Math.sin(w.angle) * vertScale;
      if (w.x < 1 || w.x > cols - 2) break;
    }
  }
}

// Flood water: surface basins that dip below sea level, plus a deep cave water
// table. Leaves higher caves as air. Fills only EMPTY cells, so it never erases
// stone.
export function floodWater(ctx, field, opts = {}) {
  const { cols, rows, MAT, putIfEmpty } = ctx;
  const { surface, seaLevel } = field;
  const {
    caveWaterFromBottom = Math.max(3, Math.floor(rows * 0.12)),
  } = opts;
  const caveWaterLevel = rows - 1 - caveWaterFromBottom;

  for (let x = 0; x < cols; x++) {
    // Surface pools: where the ground sits below sea level, fill the gap.
    for (let y = seaLevel; y < surface[x]; y++) putIfEmpty(x, y, MAT.WATER);
    // Deep underground lakes: flood carved air below the cave water line.
    for (let y = caveWaterLevel; y < rows - 1; y++) putIfEmpty(x, y, MAT.WATER);
  }
}

// Drop a few molten pockets deep in the stone. Uses rng so count/placement vary
// per load. Carves a small disc of lava surrounded by stone.
export function lavaPockets(ctx, field, opts = {}) {
  const { cols, rows, MAT, rng, disc } = ctx;
  const { surface } = field;
  const {
    count = 1 + Math.floor(rng() * 3),
    minDepthFromBottom = Math.max(3, Math.floor(rows * 0.08)),
    radius = Math.max(2, Math.floor(rows * 0.03)),
  } = opts;

  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * cols);
    const lo = surface[x] + Math.max(4, Math.floor(rows * 0.18));
    const hi = rows - 1 - minDepthFromBottom;
    if (hi <= lo) continue;
    const y = lo + Math.floor(rng() * (hi - lo));
    disc(x, y, radius, MAT.LAVA);
  }
}

// Scatter surface vegetation tufts and the occasional ember. Cheap detail that
// makes the skyline read as alive. Trees are placed separately (structures.js).
export function scatterSurface(ctx, field, opts = {}) {
  const { cols, MAT, rng, put } = ctx;
  const { surface } = field;
  const {
    tuftChance = 0.18,
    emberChance = 0.01,
  } = opts;

  for (let x = 1; x < cols - 1; x++) {
    const top = surface[x];
    const slope =
      Math.abs(surface[Math.min(cols - 1, x + 1)] - surface[Math.max(0, x - 1)]);
    if (slope > 1) continue; // only dress gentle ground
    const r = rng();
    if (r < emberChance) {
      put(x, top - 1, MAT.FIRE);
    } else if (r < tuftChance) {
      put(x, top - 1, MAT.PLANT);
      if (rng() < 0.4) put(x, top - 2, MAT.PLANT);
    }
  }
}
