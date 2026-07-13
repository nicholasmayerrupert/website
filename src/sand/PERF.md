# Sand Performance Map

Use this file before optimizing the game. The goal is to make benchmark failures
actionable instead of just producing timing numbers.

## What Owns What

- C++/WASM owns simulation, terrain generation, world streaming, player/creature physics,
  spawn placement, tool policy, material rendering, WebGL compositing, camera
  behavior, and deterministic net snapshots.
- JavaScript owns DOM lifecycle, canvas sizing, browser event normalization,
  reduced-motion handling, worker/WebSocket transport, and framework/embed wrappers.
- Offline creative mode uses two WASM engines: the worker owns mutable world
  state, while the main thread owns a render-only mirror. Replication is bounded
  to one acknowledged packet in flight, so a slow renderer cannot build an
  unbounded diff queue or feed timing debt back into world simulation.
- The first pthread/checkerboard stage parallelizes full material-to-RGBA fill
  in the cross-origin-isolated site build. Cell movement remains serial: its
  shared simulation RNG, dirty-row bounds, and liquid displacement queue must
  become task-local before the same scheduler can safely own settle chunks.
  Current profiles are dominated by lighting and cross-layer grounding, not the
  already-cheap sand/liquid passes.
- Extreme-zoom structural adjacency is cached with `cellComp`: `indexComponents`
  rebuilds a sorted component-edge list only when topology is re-indexed, and
  ordinary joint passes union that list instead of walking every component cell
  and eight neighbours. The pthread build constructs the cache by chunks and
  also carries component cells into the double buffer with fixed deterministic
  offsets. Creative world workers select pthread WASM through
  `globalThis.crossOriginIsolated`, not a window-only check.
- Above 900k loaded cells, component grounding/assembly motion runs on alternating
  world ticks (30 Hz at a healthy 60 TPS); loose materials, reactions, tools, and
  actors keep their normal cadence. Free rigid bodies disable the deferral. This
  prevents background terrain assemblies from starving a large active liquid
  frontier; topology edits are reconciled at most one world tick later.
- Reaction-heavy active bands are classified once per layer: water/fire/acid/
  lava/salt retain their original ordered phases, while loose-density, powder,
  liquid, and gas movement reuse deterministic candidate lists instead of each
  scanning a mostly rigid million-cell band. Fire and acid pass exact erased-cell
  lists to the component splitter, so untouched plant components are moved through
  unchanged. Cross-layer transfer rejects empty/rigid pairs before neighbour probes.
- Creative mirror diffs copy validated rows with bulk `memcpy`; the wire format is
  unchanged, but large acid/fire dirty rectangles avoid byte-at-a-time encode/apply.
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
- `node scripts/bench-reactions.mjs`: deterministic 1000x1000 fire-on-plants and
  acid-on-terrain stress cases, including fine phase timings and checksums.
- `node scripts/bench-zoomed-out.mjs --cols 1000 --rows 1000 --reactions`:
  isolated real-browser worker runs for pan, water, fire, and acid.

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
- `step`: total C++ simulation tick wall time (`perfStepMs`).
- `actorMs`: players, items, and active creatures. Creature target scans are
  interval-gated and active populations are bounded by species/global and local
  density caps; hibernating off-window creatures do not enter this phase.
- **Fine `stepPhases` (primary — accumulate across both layers each tick):**

  | Phase | What it is | Owner |
  | --- | --- | --- |
  | `groundingMs` | per-layer `ensureGrounded` + joint `groundLayerBase` floods | `components.inc` |
  | `crossLayerGroundingMs` | joint bond scan + union-find after base floods | `components.inc` `computeGroundedBoth` |
  | `componentIndexMs` | `indexComponents()` (nested inside grounding) | `components.inc` |
  | `assemblyUnionMs` | `moveRigidAssemblies` + cross-layer assembly move | `rigid.inc` / `step.inc` |
  | `carryMs` | component/body carry-forward across the double buffer | `step.inc` |
  | `bodyMs` | free rigid bodies (`moveBodies`) | `rigid.inc` |
  | `sandMs` | density interface + `settleSand` | `core.inc` |
  | `liquidMs` | liquids + density-chain relocate | `core.inc` |
  | `gasMs` | fire/steam rise | `core.inc` |
  | `reactMs` | growth + reactions + acid/lava/ice/salt/explosives | `reactions.inc` / `growth.inc` |
  | `tailMs` | buffer swap + liquid relax/level/sinks | `step.inc` |
  | `layersMs` | wall time of both `stepLayer()` calls | `step.inc` |
  | `crossMs` | post-layer joint refresh + cross react/transfer | `step.inc` |

  `bench-sand.mjs` prints p50 for every fine phase and p95 for the usual hot
  buckets; `--compare` also prints phase p50 deltas so a step regression is
  immediately attributable. `getStepPerf()` still exposes **legacy aggregates**:
  `joint` = `groundingMs + crossLayerGroundingMs`, `settle` = sand+liquid+gas,
  `rigid` = assembly+body.
- **`stepVolume` (why a phase is expensive):** `dirtyChunks` / `dirtyRows` /
  `dirtyCells` (active region size), `componentCount` / `componentCellCount`,
  `crossBondCount`. Available from `getPerf()` and in the bench JSON.
- `renderFull`: CPU material-to-RGBA fill in `render.inc`; WebGL upload/composite
  is covered better by browser pan benchmarks (`lightMs` / `fillMs` / `uploadMs`).
- `shiftWorldMiss`: fresh terrain streaming. Inspect `worldgen.inc`, structure
  generation, component registration, and prefetch behavior.
- `shiftWorldHit`: cached terrain restore. Inspect chunk-store restore,
  component translation, body/item/player remapping, and dirty-mark restoration.
- `shiftPhases`: streaming internals. `translate` moves hot buffers,
  `register` rebuilds components, `buffers` shifts render/sim memory, `fill`
  generates or restores new bands.

## Surfaces that expose the breakdown

| Surface | How |
| --- | --- |
| Headless engine bench | `node scripts/bench-sand.mjs` — step/shift/render + fine phases + volume |
| Headless shift profiler | `node scripts/profile-shift.mjs` — shift phases + rest/active fine step phases |
| Browser pan bench | `node scripts/bench-pan.mjs` — frame + render phases + step phases via `__sandPerf` |
| In-game HUD / `perfStats()` | `createSandGame` + embed perf HUD; same fine fields |
| Spot acid/lava/ice benches | `acid-*-lag-bench.mjs` print fine phases on worst steps |

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
- **Sleeping settled joint-support closure**: with no residual unsupported bonds,
  pure powder/liquid motion now refreshes only dirty loose columns and preserves
  the last rigid cross-layer support result. Loose cells never ground rigid cells,
  so they cannot change rigid islands, component adjacency, or cross-layer
  co-occupation. Engines that have hosted growing plants/mycelium stay on the
  classic deterministic path; residual bonded assemblies, rigid edits, acid
  dissolves that sever a component pair's last overlap, streaming, live bodies,
  and forced verification also rebuild the graph. A safe acid bore scans the
  smaller touched component for another overlap and retains the sleeping closure
  when that cross-layer edge provably survives.

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
