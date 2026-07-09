# Sand Performance Map

Use this file before optimizing the game. The goal is to make benchmark failures
actionable instead of just producing timing numbers.

## What Owns What

- C++/WASM owns simulation, terrain generation, world streaming, player physics,
  spawn placement, tool policy, material rendering, WebGL compositing, camera
  behavior, and deterministic net snapshots.
- JavaScript owns DOM lifecycle, canvas sizing, browser event normalization,
  reduced-motion handling, WebSocket transport, and framework/embed wrappers.
- If a benchmark regression points at gameplay, rendering, camera, terrain,
  components, or materials, prefer moving the decision into C++ rather than adding
  another JS mirror.

## Benchmark Entry Points

- `npm run sand:doctor`: read-only provenance check. Reports generated-material
  freshness, WASM identity, current checksum, baseline checksum, and next command.
- `node scripts/bench-sand.mjs --compare bench/baseline.json`: deterministic
  headless engine benchmark. Use this first for C++ sim/render/streaming changes.
- `node scripts/bench-sand.mjs --repeat 5 --compare bench/baseline.json`: same
  benchmark with repeated runs to distinguish p99 noise from real regressions.
- `node scripts/bench-sand.mjs --checksum-only`: fast behavior check when timing
  is irrelevant.
- `node scripts/bench-sand.mjs --scenario all --repeat 3`: broader gameplay
  load sweep. Use it before and after performance work that touches tools,
  inventory/player input, components, liquids, or net snapshots.
- `node scripts/bench-pan.mjs --compare bench/pan-baseline.json`: browser/WebGL
  pan, cursor mapping, frame-time, and flicker check.

## Engine Scenarios

- `pan-stream`: baseline panning workload. Stresses step, render fill, and
  streaming in both generated and cached directions.
- `liquid-active`: water, oil, and acid activity. Use for reaction, flow, and
  dirty-chunk regressions.
- `components-active`: stone draft plus seeds. Use for component registration,
  rigid/plant lifetime, and world-shift remapping regressions.
- `survival-actions`: inventory-backed player tool use. Use for input policy,
  inventory bridges, mining/placement, and player interaction regressions.
- `net-apply`: serializes authoritative diffs into a second engine. Use for
  snapshot size, dirty propagation, and client-apply regressions.

## Metric Ownership

- `checksum`: deterministic terrain/simulation output. If it changes on a pure
  refactor, inspect `worldgen.inc`, generated material tables, and WASM rebuild
  provenance before updating the baseline.
- `step`: total C++ simulation tick. The per-LAYER `stepPhases`
  (`ground`/`rigid`/`react`/`carry`/`settle`/`tail`) only sum to a small fraction
  of `step` and are OVERWRITTEN by the second layer, so most of `step` is invisible
  there. The bench also prints `step()-level` phases that capture the rest:
  `joint` = `computeGroundedBoth` (the cross-layer grounding flood — usually the
  single largest cost in a two-layer world), `layers` = both `stepLayer` calls
  combined (carry-dominated on dense terrain), `cross` = cross-layer
  reactions/transfer. Narrow the owner: `joint` -> `components.inc`
  (computeGrounded/computeGroundedBoth), `carry` -> the component carry in
  `step.inc`, `ground`/`settle` -> `step.inc`, `react` -> `reactions.inc`,
  `rigid` -> `rigid.inc`, `tail` -> dirty bookkeeping and cross-layer cleanup.
- `renderFull`: CPU material-to-RGBA fill in `render.inc`; WebGL upload/composite
  is covered better by browser pan benchmarks.
- `shiftWorldMiss`: fresh terrain streaming. Inspect `worldgen.inc`, structure
  generation, component registration, and prefetch behavior.
- `shiftWorldHit`: cached terrain restore. Inspect chunk-store restore,
  component translation, body/item/player remapping, and dirty-mark restoration.
- `shiftPhases`: streaming internals. `translate` moves hot buffers,
  `register` rebuilds components, `buffers` shifts render/sim memory, `fill`
  generates or restores new bands.

## Baseline Policy

- Do not update `bench/baseline.json` just because timings improved or worsened.
  First explain checksum changes and run `--repeat 5`.
- A pure refactor should keep checksum stable. If it does not, record whether the
  difference comes from source behavior, generated materials, or a WASM/toolchain
  rebuild.
- If only p99 regresses but mean and phase medians are stable, treat it as noise
  until repeated runs confirm it.

## Grounding cost map (the dominant `step` cost in two-layer worlds)

`computeGroundedBoth` (`joint`) is the usual dominant `step` cost in two-layer
worlds. It no longer runs on purely idle settled structure (see idle-structure
joint skip below); remaining cost is mostly post-stream refloods and loose
overlay refreshes when powder/liquid actually writes. A full joint is two
`computeGrounded` floods plus optional cross-layer bonds. Within one flood the
8-neighbour rigid DFS dominates (it touches every grounded rigid cell once).

Optimizations already landed (all byte-identical to a full reflood — verified by
`test:grounding`, which asserts the cache equals a forced full reflood every step):

- DFS is division-free: a parallel x-stack carries each pushed cell's column so the
  flood never recomputes `k/cols`; row bounds use `(k+oy*cols) in [cols, gridLen)`.
- `computeGroundedBoth` early-outs the whole cross-layer bond machinery (and its two
  full-grid base snapshots) when every component is already grounded — the common
  settled-terrain pan case.
- `groundLayerBase` reuses a layer's cached BASE grounding instead of re-flooding it
  when that layer is clean and powder-free (the dry stone background, or any
  powder-free layer) — `groundDirty`/`groundContentDirty` gate it exactly like the
  single-layer incremental path.

Landed (byte-identical, pan-stream checksum stable):

- **Powder-aware grounding skip (`looseGroundDirty`)**: powder/liquid *presence*
  no longer forces a joint/overlay every step. Writes via `writeGridIndex` /
  `writeNextIndex` / `vacateForNextMove` / tools / transfer / blasts set
  `Layer::looseGroundDirty`; a fully stable layer early-outs `computeGrounded`,
  and `step()`'s joint gate uses `looseGroundDirty` instead of `groundSawPowder`.
  Guarded by `scripts/grounding-incremental-test.mjs` §5 (loose-static skip).
- **Cheaper joint bookkeeping**: `wakeCellsThatLostGrounding` iterates component/
  body cells only (not the full grid); `cgPrev*` snapshots are skipped when rigid
  topology cannot change (loose-only refresh).
- **Render fill**: `fillRenderSpan` short-circuits `EMPTY` cells (dominant open
  sky/caves) before noise/light work — pixel-identical for EMPTY.
- **Sparse only-loose columns + dual peer patch-wipe**: powder/liquid writes
  mark dirty columns (`looseDirtyCol` bitset). On pure only-loose refresh,
  only dirty columns re-copy rigid base + re-overlay; ungrounded comps clear
  joint patches so bonds re-apply. When one layer is rigid-dirty, the clean
  peer stamps rigid cells from `groundRigidBase` (drops joint patches) without
  a second full DFS. Multi-scenario pure-perf checksums preserved. Guarded by
  `scripts/grounding-incremental-test.mjs` §5–§7.
- **Idle-structure joint skip**: `step()` no longer forces `computeGroundedBoth`
  just because marked rows contain stone/plant/ice. Joint runs only on
  `jointDirty`, residual ungrounded `cgBonds`, rigid topology dirt, or loose
  writes. When every component is grounded (base or via bonds), `cgBonds` is
  cleared so the next idle tick can skip; `moveCrossLayerBondedAssemblies`
  dirties layers only when a group actually moves. When either layer needs a
  rigid recompute, both bases re-flood so prior joint patches cannot
  re-transmit support. Guarded by `scripts/grounding-incremental-test.mjs` §6
  (joint-idle) + layer/xlayer fall suites.

Future opportunities (NOT yet done — each needs byte-exact verification):

- Active-region component carry: the `carry` phase re-touches every component cell
  (all terrain) each step; only cells in the active region need re-stamping. A naive
  active-region scan is NOT byte-identical because the old `prevCompCells` cleanup
  also re-wakes cells that leave component-hood (so loose material falls into
  freshly-erased holes); a correct version must replicate that wake. (A
  next==grid skip was tried and changed the pan-stream checksum — left out.)
- In-place loose overlay without `groundRigidBase` memcpy (needs explicit 0/1
  writes for ungrounded powder); attempted and changed pan-stream checksum —
  needs more investigation before landing.
- Shift `groundedCell`/`groundRigidBase` with the grid so post-stream joint can
  flood only the entering band instead of the full window.

## Baseline History

- `bench/baseline.json` was refreshed after `ec1ef4f` because the current stable
  checksum `0x52881001` was already present at pre-refactor commit `d4d0516`
  (`seed changes, mining changes`). The previous baseline checksum `0x729849dd`
  was stale relative to those gameplay/material changes, not caused by the later
  runtime-boundary refactor.
