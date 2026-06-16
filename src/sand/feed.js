import { MAT } from './engine.js';

// --- Feeding the engine safely ---
//
// The grid stores one material id per cell, but STONE/SEED/WOOD/PLANT cells only
// survive frame-to-frame via their component membership (stoneComponents /
// plantComponents). prepareNextBuffer() clears them in every active region and
// the step's carry-forward pass rewrites them *from components*, not from the
// grid. So writing one of these materials straight into the grid (paintDisc, raw
// grid[]) without registering a component leaves an "orphan" cell that flickers:
// erased whenever its neighborhood is active, reappearing when idle.
//
// INVARIANT: never put MAT.STONE / MAT.PLANT / MAT.WOOD / MAT.SEED into the grid
// without a following engine.syncComponents(). The helpers below enforce it.
//
// Scene files loaded via `initialScene` do NOT need this — applyInitialScene()
// already calls registerSeededComponents() after the scene runs. Keep using
// put/rect there.

/** Materials that live in components and therefore require syncComponents(). */
export const COMPONENT_MATERIALS = new Set([
  MAT.STONE,
  MAT.SEED,
  MAT.WOOD,
  MAT.PLANT,
  MAT.DRIFTWOOD,
]);

/** True if placing `material` requires a component sync to avoid flicker. */
export function needsSync(material) {
  return COMPONENT_MATERIALS.has(material);
}

/**
 * Paint a disc of `material` and keep the component layer in sync.
 *
 * For fluids/powders this is just paintDisc (no sync, unchanged cost). For
 * component materials it runs engine.syncComponents() so the new cells are
 * adopted into a component and stop flickering — while still obeying full
 * physics (falling when unsupported, plants growing near water).
 *
 * Placing many discs in a loop? Skip this and call engine.paintDisc(...) for
 * each, then engine.syncComponents() ONCE at the end — the flood-fill is
 * O(grid), so per-disc syncing is wasteful. See placeBatch().
 */
export function placeMaterial(engine, cx, cy, radius, material, overwrite = false) {
  engine.paintDisc(cx, cy, radius, material, overwrite);
  if (needsSync(material)) engine.syncComponents();
}

/**
 * Run a batch of placements, then sync the component layer exactly once if any
 * of them touched a component material.
 *
 *   placeBatch(engine, (paint) => {
 *     paint(x0, y0, r, MAT.STONE);
 *     paint(x1, y1, r, MAT.PLANT);
 *   });
 *
 * The `paint(cx, cy, radius, material, overwrite?)` callback forwards to
 * engine.paintDisc and records whether a sync is needed.
 */
export function placeBatch(engine, fn) {
  let dirty = false;
  const paint = (cx, cy, radius, material, overwrite = false) => {
    engine.paintDisc(cx, cy, radius, material, overwrite);
    if (needsSync(material)) dirty = true;
  };
  fn(paint);
  if (dirty) engine.syncComponents();
}
