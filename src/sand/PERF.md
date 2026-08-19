# Sand performance map

Use the deterministic headless benchmark for simulation, rendering, and world
streaming changes. Use the browser benchmark for WebGL presentation, cursor
mapping, and pan stability.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run sand:doctor` | Check generated sources, WASM provenance, and the recorded engine checksum. |
| `node scripts/bench-sand.mjs --compare bench/baseline.json` | Compare the main deterministic engine workload. |
| `node scripts/bench-sand.mjs --repeat 5 --compare bench/baseline.json` | Repeat the comparison to separate timing noise from a regression. |
| `node scripts/bench-sand.mjs --checksum-only` | Fast behavior check without timing. |
| `node scripts/bench-sand.mjs --scenario all --repeat 3` | Run the broader gameplay workload sweep. |
| `npm run bench:neutronium -- --repeat 3` | Profile static/moving neutronium against lava, rigid piles, stable contacts, and 128-body dense fields. |
| `npm run bench:rigid-brutal:compare` | Compare blast-carved cross-layer chunks, irregular RIGID bodies, moving neutronium, active water, tail latency, and 60 Hz backlog pressure. |
| `node scripts/bench-pan.mjs --compare bench/pan-baseline.json` | Check WebGL frame time, cursor mapping, two-axis cell stability, and parallax rigidity. |
| `npm run bench:actor-rigid:compare` | Check dense player/creature cadence plus kinematic body contacts, crushes, and actor/body determinism. |
| `npm run test:worldgen` | Check canonical coordinates, natural entrance shape, cave reachability, progression, and background solidity. |
| `npm run worldgen:atlas` | Render the foreground/background topology atlas to `bench/worldgen-atlas.png`. |
| `npm run bench:tnt` | Profile TNT chains, cave carving, grounding, debris, and aftermath. |
| `npm run bench:rigid-fluid` | Stress awake bodies in one large connected water domain. |
| `npm run bench:rigid-fluid-large` | Drop one 120×60 body into a large connected pool. |
| `npm run test:rigid-dense-pile` | Verify contact persistence, bounded late motion/raster conflicts, and island sleep for 100 irregular bodies. |
| `npm run test:rigid-large-body` | Verify long-face resting, rotational CCD, per-island cadence, and cross-layer TNT adherence. |
| `npm run test:rigid-shape-stress` | Drop convex, concave, hollow, stepped, thin, thick, small, and 120-cell bodies together; verify exact compound proxies, retention, overlap bounds, and sleep. |
| `npm run bench:rigid` | Measure many-body pile collision cost and total rigid step time. |
| `npm run bench:rigid-acid` | Measure collision, erosion, and connectivity repair while acid fragments 32 large piled bodies. |
| `npm run bench:rigid-long` | Continuously collide solid, thin, jagged, and L-shaped long bodies in one pile. |
| `npm run bench:ice-growth` | Track rigid/fluid cost while one floating ice body grows through a pool. |
| `node scripts/bench-reactions.mjs` | Stress fire cutting plants and acid cutting terrain. |
| `node scripts/acid-lava-lag-bench.mjs` | Compare an idle lava lake with repeated acid quenching and report rigid/reaction phase spikes. |
| `node scripts/bench-zoomed-out.mjs --cols 1000 --rows 1000 --reactions` | Exercise the real browser worker at extreme zoom. |

The main engine and pan benchmarks gate timings only when their recorded
environment and dimensions match. The rigid-brutal and actor-rigid tools are
behavior/fingerprint checks across machines; use same-host repeated runs for
their timing comparisons. Checksums and work-volume counters remain comparable
across environments.

## Engine scenarios

- `pan-stream`: stepping, rendering, and fresh/cached streaming.
- `liquid-active`: liquid flow, reactions, and dirty regions.
- `components-active`: component registration, movement, and streaming.
- `survival-actions`: player tools, inventory, mining, and placement.
- `net-apply`: authoritative diff serialization and replica application.

## Step metrics

`stepPhases` accumulates both layers for one world tick:

| Phase | Work | Main owner |
| --- | --- | --- |
| `forcePrepareMs` | Emitter aggregation, spatial bins, and nearest-source field preparation | `forces_impl.inc` |
| `forceWakeMs` | Changed/full force-bin target wake scans | `forces_impl.inc` |
| `groundingMs` | Per-layer grounding and joint base floods | `components_impl.inc` |
| `crossLayerGroundingMs` | Cross-layer bond collection and union | `components_impl.inc` |
| `componentIndexMs` | Component index and adjacency rebuild | `components_impl.inc` |
| `assemblyUnionMs` | Static support grouping and rigid-body detachment | `components_impl.inc`, `step.inc` |
| `carryMs` | Component/body double-buffer carry | `step.inc` |
| `bodyMs` | Free rigid-body simulation and ice accretion | `rigid_impl.inc`, `reactions_impl.inc` |
| `sandMs` | Density interface and powder movement | `core.inc` |
| `liquidMs` | Liquid movement and density displacement | `core.inc` |
| `gasMs` | Gas movement | `core.inc` |
| `reactMs` | Growth, reactions, and explosives | subsystem implementations |
| `tailMs` | Buffer swap and liquid relaxation | `step.inc` |
| `liquidRelaxMs` | Gap relaxation after the buffer swap (nested in `tailMs`) | `core.inc` |
| `liquidSurfaceMs` | Free-surface leveling after the buffer swap (nested in `tailMs`) | `core.inc` |
| `layersMs` | Both `stepLayer()` calls | `step.inc` |
| `crossMs` | Post-layer joint refresh and transfer | `step.inc` |

Legacy aggregates remain for older scripts: `joint` combines grounding phases,
`settle` combines sand/liquid/gas, and `rigid` combines assembly/body work.

`stepVolume` explains phase cost through active rows/cells, component counts, and
cross-layer bond counts. `shiftPhases` measures the cached return half of the
streaming loop and separates persistence, buffer movement, translation,
component registration, and restoration. Browser presentation exposes
`lightMs`, `fillMs`, and `uploadMs`.

## Current structural optimizations

- Dirty scheduling retains sorted row spans and merges only regions within the
  liquid solver's causal lookahead, so distant edits do not activate the terrain
  between them. Candidate gathering, reactions, settling, and cross-layer work
  consume those spans; rendering and replication retain exact dirty spans.
- The offline worker wakes procedural terrain in a camera-centered 512×352
  focus. Zoom changes storage and presentation dimensions without automatically
  advancing every newly visible cell; explicit edits and moving material retain
  their own active spans outside the focus.
- Stable static components use their cached positional index to carry only
  active/newly marked cells through the ping-pong buffers. Previous free-body
  footprints are tracked separately so vacated raster cells are still cleared.
- Growth, mycelium, ice, and moving-component passes use material/state-specific
  component registries. Add-only plant and ice growth patches the component
  index and adjacent graph edges locally; topology changes retain the full
  rebuild fallback.
- Component indices cache same-layer adjacency. Static interior support is
  solved over that graph; free bodies and sentinel-touching components retain
  the cell flood.
- Rigid grounding and loose support are cached and invalidated separately.
- A settled cross-layer support closure can sleep during loose-only motion.
- Unsupported static groups have one motion path: stable component slots are
  retired directly into same-layer or joint rigid bodies. Settled bodies that
  still have accepted rigid, powder, or liquid support remain baked; all actual
  motion, displacement, rotation, and later rebaking belong to the body solver.
- Component adjacency edges use dense-id counting passes, so the duplicate-heavy
  edge list produced by a blast cut is sorted in linear time.
- Joint support loss compares packed grounding bytes and expands only exact
  component/body 1-to-0 transitions into settle-band wakes.
- Above 900,000 loaded cells, grounding and assembly motion may run at 30 Hz;
  loose materials, reactions, tools, and actors keep their normal clocks. Free
  rigid bodies disable the deferral.
- Reaction passes build ordered active-material candidates once per layer.
- Free-body ice scans its cached raster boundary before rigid integration and
  preflights only the local cells selected to freeze. Supported ice can bake on
  pose stability while its outline is still accreting, so grounded bodies leave
  the solver without waiting for a quiet reaction window.
- Liquid-quenched lava becomes loose stone dust in place. It never enters the
  component registry or rigid-body solver, so fragmented cooling fronts scale as
  ordinary powder cells rather than disconnected rigid islands.
- Spatial force emitters use chunk-sized bins and aggregate neutronium by
  connected component/body, so force queries inspect nearby sources rather than
  summing every source cell. Neutronium direction uses a cached nearest-cell
  distance transform; unchanged static geometry reuses it, while changed or
  moving geometry updates the bounded source region plus force reach. Emitter
  fingerprints are computed once and reused by every covered bin. Dense moving-
  neutronium scenes use a balanced nearest-point index when the distance-field
  winner is not an eligible dominant body, preserving the exact source ordering
  without scanning every neutronium cell for every body. Exact loose-
  cell samples are cached in the affected chunks for the current tick, so settle,
  density, and liquid-tail ownership checks reuse the wake scan's result. Per-bin
  source signatures restrict moving/removed-field wakes to the swept bins; local
  force retries mark only their own dirty cell. Periodic coverage scans gather the
  minimum force and quadrant balance used by pressure flow without keeping the
  whole field scheduled. Coverage passes scan the union of affected and released
  bins once, and unrestricted loose-cell samples consume the nearest-field seed
  without rigid-body dominance checks. Static blocked cells park without
  rescheduling the layer,
  while already-awake rigid bodies retain their solver sleep progress when force
  is applied. Sleeping rigid contact islands ignore an unchanged force field and
  wake when their covered source-bin signature changes. Moving neutronium
  dominance is filtered from emitter cell-count
  metadata during the existing nearest-source query; it does not add a body-pair
  scan or a contact pass. Liquid fanning is a hashed alternate candidate inside
  the same active-cell force query and does not add a grid traversal. Tangential
  powder candidates reuse the ordinary constant-time density claim check. Players
  and mobile creatures add one chunk-bin force sample per actor tick; stationary
  mission fixtures remain anchored and add no query.
- A per-layer spore-presence latch skips dormant-mycelium component scans when
  the loaded terrain contains no mycelium spore.
- Fire and acid split only touched components. Base-grounded acid bites use a
  bounded exact-connectivity proof before falling back to a full component
  flood, and safe local cuts avoid full grounding floods.
- A TNT batch accumulates overlapping stencils into one bounds-local
  maximum-energy field, with generation-stamped sparse storage for widely
  separated waves. Each unique affected cell is classified once, each
  foreground/background cell is cut once, and component repair completes before
  physical or cosmetic aftermath is emitted. Cross-layer structural damage and
  shock are mirrored, while gas, flecks, and physical rubble remain
  source-layer-owned.
- Blast repair splits only the exact touched component slots and patches their
  incident adjacency edges. Genuine cuts rebuild support; loose support, rigid
  detachment, snapshots, resize, and world shifts still invalidate sparse carry.
- Live blast rubble stays body-owned, does not bear structural load, and does not
  invalidate cached cave grounding. Settled rubble bakes into ordinary static
  material once structural motion in its layer clears. Dense TNT fronts emit a
  bounded number of physical chunks.
- Rigid/fluid pressure projection uses deterministic overlapping four-cell
  neighborhoods seeded only by wet raster boundaries. Ice uses an eight-cell
  neighborhood so broad shallow rafts retain a density-based draft. Nearby
  open-column profiles provide mixed-density hydrostatic head without a
  connected-pool flood, while persistent liquid velocity carries dynamics
  beyond the cutoff. Mixed-liquid interfaces extend only the affected body's
  projection to a fixed 24-cell radius; cutoff faces use the adjacent density
  and the column's stratified pressure.
  Bodies with no adjacent liquid skip hydrostatic reference construction. Domain
  nodes regain deterministic grid order through stable linear radix passes, and
  the repeated body-boundary operator stores its invariant normal, lever arm,
  mass, and inertia data in one compact face stream.
  Pressure Krylov vectors use contiguous storage, the common unpinned iteration
  keeps its convergence and direction updates SIMD-vectorized, and the repeated
  matrix pass traverses compact dynamic faces. Extended ice projections resolve
  once more when clamping tensile pressure changes the active constraints.
- Body/body broadphase retains its sweep-and-prune order across ticks and repairs
  it with insertion sort, then restores surviving pairs to deterministic
  body-index order before generating contacts.
- Each body caches an exact non-overlapping rectangle cover of its occupied
  pixels. Current and predicted child transforms reuse one body pose for all
  candidate pairs at the same substep time. Highly compound pairs traverse
  balanced collision trees; child frames and swept node bounds are generated
  lazily once per body pose and reused by every body pair in that substep.
  Smaller compounds use direct endpoint-AABB rejection before oriented-box SAT.
  The surviving pairs return to child-index order, preserving deterministic
  contact generation. Manifolds clip both incident and reference edges against
  original-mask exposed spans, so decomposition seams cannot act as collision
  faces. Child and face-span ids participate in the warm-start key. A
  short-lived coherent child separating axis prevents a far-side feature from
  reversing a thin contact while the pair crosses a raster boundary.
- Rigid erosion tests only cached raster cells whose local eight-neighbourhood
  reaches the body's boundary, and bodies with no erodible material skip the
  pass entirely. Connectivity and ownership repair use dense generation stamps.
  Damage to joint foreground/background bodies batches geometry reconstruction
  until all erasures for the tick are known.
- A conservative tick-level candidate graph gives disconnected rigid islands
  independent substep cadences. Contact islands receive size-based solver
  budgets, bottom-up stack ordering, and coupled two-point solves for long
  support faces. Single-layer spatial-force islands with at least twelve bodies
  run velocity constraints to a no-op or the iteration cap; the resulting stable
  network has fewer repeated contacts and raster ownership conflicts under
  sustained force. Cross-layer joint islands retain residual convergence so
  their two rasters stay aligned.
- Rigid contact manifolds reject deep-overlap normals that oppose the pair's
  separating half-space. Stable local anchors persist normal/friction impulses
  across substeps and ticks, including short decaying persistence for large
  raster contacts, so dense piles converge from the previous solution and enter
  island sleep instead of cold-solving jitter indefinitely. Consecutive manifold
  points with the same persistent feature reuse one contact-cache lookup.
- Each contact stores its substep-constant inverse normal, tangent, and
  positional effective masses. Solver iterations reuse them instead of
  rebuilding and dividing by the same mass and inertia expression.
- Dense rigid scenes and bodies with at least 4,096 occupied cells build a
  conservative 8x8 terrain/material occupancy map. Swept terrain samples whose
  complete travel bounds miss every rigid bin are rejected before grid contact,
  and bodies whose transformed bounds miss every powder bin skip granular edge
  sampling. Small scenes retain direct probes so map construction cannot become
  their fixed cost.
- Large rotating bodies and long beams use exact angular sample trajectories.
  Compact bodies use tangent sweeps to keep the common debris path inexpensive;
  long and filled masks still receive convex-corner samples. Immutable sample
  radii and pair/body speed terms are cached outside the sample loops.
  Conservative swept oriented bounds test current and end axes with complete
  translation and rotational point-reach limits before the body/body raster
  fallback. Terrain rejection scans horizontal spans of an oriented bound
  expanded by the complete substep reach. Both paths reject only when the exact
  raster sweep cannot find a hit. Body pairs that are both at least 4:1 slender
  with `maxR >= 24` also receive a constant-cost oriented-rectangle reference
  axis after raster contact exists. Near-parallel pairs add two span constraints
  with raster-measured depth only when both masks tightly fit their bounds; thin
  masks must cover every major-axis row or column, while other masks must fill
  at least 75% of the bounds. Sparse broad bounds and crossed pairs keep their
  local raster anchors. Refined penetration and tighter slop remain confined to
  that path. A long/small pair only substitutes the long body's minor axis for
  center-to-center manifold filtering, and a large participant keeps the pair's
  missed contact anchors alive regardless of pair order.
- Inverse rasterization is cached by exact body pose, geometry revision, and
  loaded-grid dimensions. Fluid coupling, blocked-footprint probes, actor
  overlap, support checks, and final stamping reuse that footprint whenever the
  body has not moved between queries. A conservative center-line capsule rejects
  actor sweeps before rasterization when no live actor can be reached, and a
  boundary preflight skips fluid stamping when no awake body touches liquid.
- Layers with at least 8,192 body-owned cells snapshot material and ownership
  while clearing. Cells that return to the same body and material restore the
  snapshot directly while preserving grid-dirty, force, heat, and loose-support
  side effects; moved, blocked, and displaced cells retain the ordinary write
  path. This keeps very large irregular bodies exact without paying two full
  general-purpose grid mutations for every unchanged raster cell.
- The committed engine is one SIMD-enabled WASM package; `-O3` can vectorize
  contiguous solver, grid, and rendering loops without a parallel runtime.
  Threading rigid islands would require a shared-memory worker package plus
  cross-origin isolation on every deployment surface, which the current
  framework-free embed and Cloudflare configuration do not provide.
- Due TNT uses stable 14-cell spatial regions. Fronts spanning more than six
  regions consume the six nearest regions to the lowest-id bucket per tick
  until their backlog drains; smaller fronts finish atomically. Body-owned TNT
  shares a 1,200 source-cell budget with the static front.
- Presentation diffs use validated row copies and keep only one packet in flight.
- Pure camera pans retain the valid texture overlap and fill/upload only newly
  exposed edge bands; lighting flood queues carry their x coordinate so the hot
  propagation loop does not divide every visited cell index by the grid width.
- Static animated materials repaint only visible chunks that contain animation.
- Direct-mapped terrain-query caches avoid repeating surface, climate, cave, and
  cave-plan noise within fills and diagnostic scans.
- Streaming stores only changed tiles persistently. Recent pristine bands use a
  bounded baseline cache, and both stores choose compact RLE per tile when it is
  smaller than the raw payload.

These optimizations preserve deterministic output except accepted behavior
changes. The recorded checksum uses the native foreground-plus-background grid
hash. Earlier foreground-only records therefore differ even when the foreground
is unchanged. Current simulation hashes also reflect restored loose momentum
and stateful component continuity across streamed tiles, world-coordinate
reaction ordering, staggered world-column gravity, compound rigid contacts,
cave-blast carry, bounded broad TNT fronts, and world-wide cross-layer rigid
contact reconciliation. Those changes can alter the foreground itself, so a
checksum transition is not solely a measurement-scope change.

## Baseline policy

- A pure refactor must preserve the deterministic checksum.
- Explain a checksum change before updating a baseline.
- Confirm timing changes with repeated runs and phase medians. When both sides
  have at least three runs, the timing gate uses the median of their per-run
  metrics while still reporting the pooled raw values. Isolated host scheduling
  spikes do not fail the comparison, while a regression across most runs does.
- Update a committed baseline only when the behavior or measurement definition
  intentionally changed and the current environment is compatible.
