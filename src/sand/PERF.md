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

`computeGroundedBoth` (`joint`) runs ~every active step because the soil-mantle
powder keeps `groundDirty` set (a powder layer always refloods — powder grounding
depends on liquids that move outside the component hooks). It is two full
`computeGrounded` floods. Within one flood the cost splits ~setup/seed/DFS; the
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

Future opportunities (NOT yet done — each needs byte-exact verification):

- Powder-aware incremental grounding: a layer reflood is only needed when a loose
  cell actually MOVED, not merely exists. Measured potential is modest on an active
  pan (~7-28% of passes are loose-static) and large for idle/building scenes, but it
  needs a robust "loose changed" signal covering EVERY loose grid write (settle,
  reactions, transfer, tools, worldgen) — fragile for a multiplayer-authoritative
  engine, so deferred.
- Active-region component carry: the `carry` phase re-touches every component cell
  (all terrain) each step; only cells in the active region need re-stamping. A naive
  active-region scan is NOT byte-identical because the old `prevCompCells` cleanup
  also re-wakes cells that leave component-hood (so loose material falls into
  freshly-erased holes); a correct version must replicate that wake.

## Baseline History

- `bench/baseline.json` was refreshed after `ec1ef4f` because the current stable
  checksum `0x52881001` was already present at pre-refactor commit `d4d0516`
  (`seed changes, mining changes`). The previous baseline checksum `0x729849dd`
  was stale relative to those gameplay/material changes, not caused by the later
  runtime-boundary refactor.
