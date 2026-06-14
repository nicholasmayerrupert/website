// A procedural landscape: rolling noise terrain with cave systems, water table,
// molten pockets, vegetation, and a centered ruined tower. Built on the worldgen
// foundation, so it is authored at a fixed cell scale and centered — a narrow
// viewport crops the sides, a wide one reveals more world.
//
// The scene is just an ORDERED LIST OF PASSES. Add a pass, reorder, or swap a
// prefab without touching the others — that is the extension point.

import { MAT } from '../engine.js';
import { createWorldContext } from '../worldgen/context.js';
import {
  heightField,
  fillTerrain,
  carveCaves,
  floodWater,
  lavaPockets,
  scatterSurface,
} from '../worldgen/terrain.js';
import {
  placeOnSurface,
  ruinedTower,
  watchtower,
  house,
  ruinedArch,
  well,
  tree,
} from '../worldgen/structures.js';

export function buildLandscapeScene(api) {
  const ctx = createWorldContext(api);
  const field = heightField(ctx);

  // Ground.
  fillTerrain(ctx, field);
  carveCaves(ctx, field);
  floodWater(ctx, field);
  lavaPockets(ctx, field);

  // Structures: a centered hero plus a scattered settlement of varied buildings.
  // Track occupied x-intervals so nothing overlaps.
  const span = ctx.cols * 0.92;
  const placed = [];
  const overlaps = (x0, x1) =>
    placed.some((p) => !(x1 < p.x0 - 2 || x0 > p.x1 + 2));
  const tryBuild = (dx, half, builder, opts) => {
    const gx = ctx.cx(dx);
    if (gx - half < 2 || gx + half > ctx.cols - 3) return false;
    if (overlaps(gx - half, gx + half)) return false;
    placed.push({ x0: gx - half, x1: gx + half });
    placeOnSurface(ctx, dx, builder, opts);
    return true;
  };

  // Centered hero structure.
  tryBuild(0, 8, ruinedTower);

  // Weighted palette of building types for the surrounding settlement.
  const palette = [
    { build: house, half: 10, weight: 4 },
    { build: well, half: 4, weight: 2 },
    { build: ruinedArch, half: 8, weight: 2 },
    { build: watchtower, half: 5, weight: 2 },
    { build: ruinedTower, half: 8, weight: 1 },
  ];
  const totalWeight = palette.reduce((s, p) => s + p.weight, 0);
  const pick = () => {
    let r = ctx.rng() * totalWeight;
    for (const p of palette) if ((r -= p.weight) <= 0) return p;
    return palette[0];
  };

  const targetBuildings = Math.round(ctx.cols / 55) + 3;
  let made = 0;
  for (let attempt = 0; made < targetBuildings && attempt < targetBuildings * 5; attempt++) {
    const dx = Math.round((ctx.rng() - 0.5) * span);
    const p = pick();
    if (tryBuild(dx, p.half, p.build)) made++;
  }

  // Vegetation fills the gaps between buildings.
  const treeCount = 5 + Math.floor(ctx.rng() * 6);
  for (let i = 0; i < treeCount; i++) {
    const dx = Math.round((ctx.rng() - 0.5) * span);
    const gx = ctx.cx(dx);
    if (overlaps(gx - 2, gx + 2)) continue;
    placeOnSurface(ctx, dx, tree);
  }
  scatterSurface(ctx, field);

  ctx.commit();
}

// Gentle taps so the world keeps evolving: a spring feeding the surface and a
// trickle of sand. pos is a fraction of the grid (engine convention).
export const landscapeEmitters = [
  { material: MAT.WATER, rateMs: 220, pos: { x: 0.34, y: 0.06 }, r: 1 },
  { material: MAT.SAND, rateMs: 260, pos: { x: 0.7, y: 0.06 }, r: 1 },
];
