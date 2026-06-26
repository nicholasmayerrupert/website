# Rigid-body collision (swept, mask-derived)

Hand-drawn rigid bodies are pixel **occupancy masks** with a continuous pose
(`px,py,angle`), linear/angular velocity, and mass/inertia derived from their
occupied cells. This document covers the collision pipeline in
`cpp/engine/rigid.inc` (`rigidStep`) and why it was reworked.

## Root cause of the old "thin shapes pass through each other" bug

The previous body↔body path had four compounding defects:

1. **Centre-to-centre normal overwrite.** It first computed a correct
   mask-derived surface normal per contact sample, then *threw it away* and
   replaced every contact normal with `normalize(A.center − B.center)` plus a
   single projection-overlap depth. An off-centre bar landing on a platform got
   a diagonal normal and was flung sideways instead of stopping.
2. **No sweep.** Contacts were only generated where a boundary **cell centre**
   was already inside the other mask *at the substep boundary*. A thin (1-cell)
   body moving ~0.6 cell/substep could sit above the target one substep and
   below it the next — never overlapping on a sampled frame — and tunnel clean
   through.
3. **Cell-centre-only sampling.** The body shape is the union of 1×1 squares,
   but only cell centres were tested, so the exposed *edges* of thin shapes were
   invisible to collision.
4. **Centre-velocity substeps.** Substep count came from body-centre linear
   speed only. A slowly-translating but fast-spinning bar took too few substeps
   and tunnelled at its endpoint (high angular tip speed, low centre speed).

## What changed

- **Mask-derived normals only.** `collectSweep` takes each contact normal from
  the *target* mask surface (`bodyNormalAt`), oriented from B→A by a `sign`. The
  centre-to-centre replacement is gone (a centre-to-centre direction survives
  only as a degenerate fallback when a manifold bucket's normals cancel).
- **Exposed-edge boundary samples.** `computeDerived` caches, per boundary cell,
  the cell centre **plus the midpoint of every exposed face**
  (`Body::boundarySamples`). Rebuilt only when occupancy changes, not per tick.
- **Swept sampling (body↔body and body↔terrain).** For each sample either record
  an existing penetration (t=0) or march the sample's per-substep **relative**
  path (sample velocity − target velocity at that point) through the target mask
  in steps ≤ `R_SWEEP_STEP` (0.4 cell), binary-searching the first impact. A
  point can no longer cross a thin body without generating a contact. Terrain
  uses the same swept helper against the static grid, generalising the old
  single-step predicted check (consistent normal orientation + skin).
- **Point-speed substeps.** Substep count uses `linear + |omega|·maxR` (max
  point speed incl. angular tip speed), so spinning bodies get enough substeps.
- **Contact skin.** Surfaces touch within `R_CONTACT_SKIN` (0.1 cell): the sweep
  marches an extra skin distance so resting contacts are detected before deep
  overlap (stable rest, minimal visible penetration, no visible float).
- **Bucketed manifold.** Samples are grouped by quantized normal direction (8
  sectors) so materially different faces stay separate instead of averaging into
  one diagonal normal; within a bucket the two tangential extremes are kept so a
  long contact gets stable torque at both ends. Deepest feeds the sleep gate.
- **Depenetration fallback** (`depenetrateBodyRaster`, unchanged) still runs
  after the solver as a last resort along valid mask normals — it is a fallback,
  not the primary mechanism.
- **Render-boundary wall.** `collectTerrain`'s `solid()` test treats any cell
  outside the loaded buffer (`x<0 || x>=cols || y<0 || y>=rows`) as solid, with an
  inward-pointing normal. A body's own motion can no longer carry it off the
  simulated window — where its raster is clipped away and it silently
  disappears. It rests against / is pushed back from the rim until that region
  streams into view (then it resumes). This is distinct from world-stream
  eviction, which legitimately carries bodies off-buffer and persists them
  (`csSaveBodiesLeaving`/`csRestoreBodies` in `shiftLayer`); the wall only blocks
  *self-propelled* exit, not camera-driven streaming.

Constants live in `common.hpp`: `R_SAFE_SUBSTEP` 0.5, `R_MAX_SUBSTEPS` 10,
`R_CONTACT_SKIN` 0.1, `R_SWEEP_STEP` 0.4.

## Tests

`scripts/rigid-collision-test.mjs` (wired into `npm test`) covers: vertical bar
on horizontal bridge over a gap (centred + off-centre, at several dt groupings),
off-centre impact producing an ~upward normal (peak |vx| stays ~0.05, near-zero
rotation), fast thin projectile vs a thin wall, rotating-bar endpoint strike,
two concave hand-drawn bodies keeping their occupancy shape, a thin body resting
on another for 1200+ ticks without sinking/drifting, and determinism. New test
ABI: `engine_body_state` / `engine_set_body_motion` (`_bodyState`,
`_setBodyMotion`).

## Benchmark

`scripts/bench-rigid.mjs` — 60 irregular hand-drawn bodies (bars/L/disc/blob)
trickled into a walled container, 700 ticks, measuring the rigid phase.

| build                | rigid p50 | p95    | mean   | total  |
|----------------------|-----------|--------|--------|--------|
| before (this change) | 2.6 ms    | 4.7 ms | 2.5 ms | 1742 ms|
| after                | 4.2 ms    | 13.8 ms| 5.3 ms | 3712 ms|

The swept sampling + richer manifold roughly doubles the rigid cost **under this
deliberately extreme 60-body pile-up**, which is still well inside a frame
budget. Realistic scenes have a handful of bodies; the general-world bench
(`bench-sand.mjs`) shows the rigid phase at ~0.03 ms with no bodies (unchanged).
Idle/sleeping bodies are broad-phase- and sleep-gated to near-zero cost. No
per-contact heap allocation was added (scratch `penAcc`/`terrAcc` reused; bucket
state is fixed-size stack arrays; boundary samples cached).

## Remaining limitations

- **Speculative reaction distance.** A fast body can stop up to one substep of
  relative motion (≤ ~`R_SAFE_SUBSTEP`) short of contact for a single tick, then
  close the gap next tick. Not visible at normal speeds.
- **Rotation within a substep is first-order.** The target's motion is
  approximated by subtracting its point velocity over the substep rather than
  re-rasterizing its rotated mask along the path. Adequate because substeps cap
  point motion to ≤ ~0.5 cell, but extreme spin + extreme translation together
  rely on the substep cap, not an exact time-of-impact.
- **Manifold quantization.** Smoothly curved contacts (e.g. a disc on ground)
  split across up to a few normal buckets, producing more contacts than a flat
  rest — the main source of the benchmark's cost under heavy piling.
- **Solver iterations unchanged (64).** Very deep single-column stacks still
  converge at the sequential-impulse rate; not exercised by the test scenes.
