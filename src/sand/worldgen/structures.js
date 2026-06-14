// Structure placement + a small library of prefabs. Prefabs draw with the same
// clipped primitives as terrain, so they truncate cleanly off-window and snap to
// whatever the ground happens to be at their world-x.

// Snap a prefab to the terrain surface at a world-x offset (0 == center). The
// builder receives the grid column and the surface row to build up from.
export function placeOnSurface(ctx, worldDx, builder, opts = {}) {
  const x = ctx.cx(worldDx);
  const baseY = ctx.surfaceAt(x);
  if (baseY >= ctx.rows) return; // nothing solid here (off-window) — skip
  builder(ctx, x, baseY, opts);
}

// A weathered stone tower: hollow shell, broken crenellations, an arched doorway,
// a couple of windows, ivy creeping up one face, and a torch ember. Fixed scale
// so it reads the same at any viewport width.
export function ruinedTower(ctx, x, baseY, opts = {}) {
  const { MAT, rng, rect, put, line } = ctx;
  const w = opts.width ?? 11 + Math.floor(rng() * 5); // 11..15
  const h = opts.height ?? 26 + Math.floor(rng() * 18); // 26..43
  const x0 = x - (w >> 1);
  const topY = baseY - h;

  // Solid shell, then hollow the interior leaving 1-cell walls.
  rect(x0, topY, w, h, MAT.STONE);
  rect(x0 + 1, topY + 1, w - 2, h - 2, MAT.EMPTY);

  // Stone floors every few rows for a lived-in silhouette (no loose fill — sand
  // inside the shell would falsely "support" the rigid stone and stop it falling).
  for (let fy = topY + 5; fy < baseY - 1; fy += 5) {
    rect(x0 + 1, fy, w - 2, 1, MAT.STONE);
  }

  // Broken crenellations along the top: random merlon heights, some missing.
  for (let cxp = x0; cxp < x0 + w; cxp += 2) {
    if (rng() < 0.25) continue; // a gap where the wall has fallen
    const mh = 1 + Math.floor(rng() * 2);
    rect(cxp, topY - mh, 1, mh + 1, MAT.STONE);
  }

  // Arched doorway at the base (carved out of the shell).
  const dw = Math.max(2, Math.floor(w * 0.32));
  const dh = Math.max(3, Math.floor(h * 0.28));
  const dx0 = x - (dw >> 1);
  rect(dx0, baseY - dh, dw, dh, MAT.EMPTY);
  put(dx0, baseY - dh, MAT.STONE);
  put(dx0 + dw - 1, baseY - dh, MAT.STONE);

  // Windows.
  for (let wy = topY + 3; wy < baseY - dh - 1; wy += 6) {
    put(x0, wy, MAT.EMPTY);
    put(x0 + w - 1, wy, MAT.EMPTY);
  }

  // Ivy creeping up the windward face, plus a torch ember inside.
  const ivyX = rng() < 0.5 ? x0 : x0 + w - 1;
  for (let iy = baseY - 1; iy > topY + 2; iy--) {
    if (rng() < 0.6) put(ivyX, iy, MAT.PLANT);
  }
  if (rng() < 0.8) put(x, baseY - 2, MAT.FIRE);

  // A little rubble skirt at the foot.
  line(x0 - 1, baseY - 1, x0 - 2, baseY - 1, MAT.STONE);
  line(x0 + w, baseY - 1, x0 + w + 1, baseY - 1, MAT.STONE);
}

// A simple tree: woody trunk with a couple of limbs and leafy blobs. Cheap,
// fixed-scale vegetation for dressing the surface.
export function tree(ctx, x, baseY, opts = {}) {
  const { MAT, rng, rect, put, line, disc } = ctx;
  const h = opts.height ?? 11 + Math.floor(rng() * 8); // 11..18
  const top = baseY - h;
  const trunkW = h >= 16 ? 2 : 1;

  rect(x, top, trunkW, h, MAT.WOOD);
  // Limbs.
  line(x, top + Math.floor(h * 0.4), x - 3, top + Math.floor(h * 0.18), MAT.WOOD);
  line(x, top + Math.floor(h * 0.55), x + 3, top + Math.floor(h * 0.32), MAT.WOOD);
  line(x, top + Math.floor(h * 0.7), x - 3, top + Math.floor(h * 0.5), MAT.WOOD);
  // Canopy blobs.
  disc(x, top, 4 + Math.floor(rng() * 2), MAT.PLANT);
  disc(x - 4, top + 2, 3, MAT.PLANT);
  disc(x + 4, top + 2, 3, MAT.PLANT);
  disc(x, top + 4, 3, MAT.PLANT);
  if (rng() < 0.15) put(x + 1, top - 1, MAT.FIRE); // rare autumn ember
}

// A stone cottage with a pitched wood roof, a door, windows, and a chimney. The
// hearth fire is boxed in stone so it flickers without igniting the wood roof.
export function house(ctx, x, baseY, opts = {}) {
  const { MAT, rng, rect, put } = ctx;
  const w = opts.width ?? 13 + Math.floor(rng() * 7); // 13..19
  const h = opts.height ?? 9 + Math.floor(rng() * 5); // 9..13 wall (room for storeys)
  const x0 = x - (w >> 1);
  const top = baseY - h;

  rect(x0, top, w, h, MAT.STONE); // walls
  rect(x0 + 1, top + 1, w - 2, h, MAT.EMPTY); // hollow interior down to the floor

  // Storey floors (stone only — no loose fill inside the shell).
  for (let fy = top + 5; fy < baseY - 1; fy += 5) {
    rect(x0 + 1, fy, w - 2, 1, MAT.STONE);
  }

  // Pitched roof.
  const roofH = Math.max(4, Math.floor(w * 0.5));
  for (let dy = 0; dy < roofH; dy++) {
    const half = Math.floor((w / 2) * (roofH - dy) / roofH);
    rect(x - half, top - 1 - dy, half * 2 + 1, 1, MAT.WOOD);
  }

  // Doorway + windows on each storey.
  rect(x - 1, baseY - Math.max(3, Math.floor(h * 0.45)), 2, Math.max(3, Math.floor(h * 0.45)), MAT.EMPTY);
  for (let wy = top + 2; wy < baseY - 2; wy += 5) {
    put(x0 + 1, wy, MAT.EMPTY);
    put(x0 + w - 2, wy, MAT.EMPTY);
  }

  // Chimney stack with a boxed hearth fire.
  const chx = x0 + 1;
  rect(chx, top - roofH - 1, 1, roofH + h + 1, MAT.STONE);
  if (rng() < 0.7) put(chx, baseY - 2, MAT.FIRE);
}

// A weathered freestanding arch / broken gateway: two stone piers with a curved
// span over the top, some voussoirs missing, a little rubble and moss.
export function ruinedArch(ctx, x, baseY, opts = {}) {
  const { MAT, rng, rect, put } = ctx;
  const span = opts.span ?? 9 + Math.floor(rng() * 6); // 9..14
  const h = opts.height ?? 12 + Math.floor(rng() * 8);
  const lx = x - (span >> 1);
  const rx = x + (span >> 1);
  const topY = baseY - h;

  rect(lx, topY, 1 + (rng() < 0.5 ? 1 : 0), h, MAT.STONE);
  rect(rx, topY, 1, h, MAT.STONE);
  const rise = Math.max(1, Math.floor(span * 0.35));
  for (let i = 0; i <= span; i++) {
    const t = i / span;
    const yy = topY - Math.round(Math.sin(t * Math.PI) * rise);
    if (rng() < 0.8) put(lx + i, yy, MAT.STONE); // some stones fallen
  }
  if (rng() < 0.6) put(lx - 1, baseY - 1, MAT.STONE);
  if (rng() < 0.6) put(rx + 1, baseY - 1, MAT.STONE);
  if (rng() < 0.5) put(rx, topY, MAT.PLANT);
}

// A stone well: a hollow rim holding water, with two posts and a beam overhead.
export function well(ctx, x, baseY, opts = {}) {
  const { MAT, rect, put } = ctx;
  const r = opts.radius ?? 3;
  rect(x - r, baseY - 2, r * 2 + 1, 2, MAT.STONE); // rim
  rect(x - r + 1, baseY - 2, r * 2 - 1, 2, MAT.WATER); // water inside the rim
  // Posts + beam.
  put(x - r, baseY - 4, MAT.WOOD);
  put(x - r, baseY - 3, MAT.WOOD);
  put(x + r, baseY - 4, MAT.WOOD);
  put(x + r, baseY - 3, MAT.WOOD);
  rect(x - r, baseY - 5, r * 2 + 1, 1, MAT.WOOD);
}

// A tall slim watchtower: intact battlements, slit windows, and a beacon fire at
// the top (boxed in stone). A more vertical counterpoint to the ruined tower.
export function watchtower(ctx, x, baseY, opts = {}) {
  const { MAT, rng, rect, put } = ctx;
  const w = opts.width ?? 7;
  const h = opts.height ?? 34 + Math.floor(rng() * 18); // 34..51
  const x0 = x - (w >> 1);
  const top = baseY - h;

  rect(x0, top, w, h, MAT.STONE);
  rect(x0 + 1, top + 1, w - 2, h - 2, MAT.EMPTY);
  for (let fy = top + 6; fy < baseY - 1; fy += 6) rect(x0 + 1, fy, w - 2, 1, MAT.STONE);
  for (let cxp = x0; cxp < x0 + w; cxp += 2) rect(cxp, top - 2, 1, 2, MAT.STONE); // battlements
  rect(x - 1, baseY - 4, 2, 4, MAT.EMPTY); // door
  for (let wy = top + 4; wy < baseY - 4; wy += 6) {
    put(x0, wy, MAT.EMPTY);
    put(x0 + w - 1, wy, MAT.EMPTY);
  }
  if (rng() < 0.9) put(x, top + 1, MAT.FIRE); // beacon
}

// A flat plank bridge spanning a gap, supported by stone piers. Useful over caves
// or water basins. Spans from worldDx to worldDx+span at a fixed height.
export function bridge(ctx, x, baseY, opts = {}) {
  const { MAT, rect } = ctx;
  const span = opts.span ?? 12;
  const deckY = baseY - (opts.clearance ?? 4);
  rect(x, deckY, span, 1, MAT.WOOD);
  rect(x, deckY + 1, span, 1, MAT.WOOD);
  // Piers at each end down to the ground.
  rect(x, deckY, 1, baseY - deckY, MAT.STONE);
  rect(x + span - 1, deckY, 1, baseY - deckY, MAT.STONE);
}
