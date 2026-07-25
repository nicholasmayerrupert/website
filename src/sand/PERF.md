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
| `node scripts/bench-pan.mjs --compare bench/pan-baseline.json` | Check WebGL frame time, cursor mapping, and pan instability. |
| `npm run test:worldgen` | Check canonical coordinates, natural entrance shape, cave reachability, progression, and background solidity. |
| `npm run worldgen:atlas` | Render the foreground/background topology atlas to `bench/worldgen-atlas.png`. |
| `npm run bench:tnt` | Profile TNT chains, cave carving, grounding, debris, and aftermath. |
| `node scripts/bench-reactions.mjs` | Stress fire cutting plants and acid cutting terrain. |
| `node scripts/bench-zoomed-out.mjs --cols 1000 --rows 1000 --reactions` | Exercise the real browser worker at extreme zoom. |

Timing gates apply only when the baseline environment and benchmark dimensions
match. Checksums and work-volume counters remain comparable across environments.

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
| `groundingMs` | Per-layer grounding and joint base floods | `components_impl.inc` |
| `crossLayerGroundingMs` | Cross-layer bond collection and union | `components_impl.inc` |
| `componentIndexMs` | Component index and adjacency rebuild | `components_impl.inc` |
| `assemblyUnionMs` | Static and cross-layer assembly movement | `components_impl.inc`, `step.inc` |
| `carryMs` | Component/body double-buffer carry | `step.inc` |
| `bodyMs` | Free rigid-body simulation | `rigid_impl.inc` |
| `sandMs` | Density interface and powder movement | `core.inc` |
| `liquidMs` | Liquid movement and density displacement | `core.inc` |
| `gasMs` | Gas movement | `core.inc` |
| `reactMs` | Growth, reactions, and explosives | subsystem implementations |
| `tailMs` | Buffer swap and liquid relaxation | `step.inc` |
| `layersMs` | Both `stepLayer()` calls | `step.inc` |
| `crossMs` | Post-layer joint refresh and transfer | `step.inc` |

Legacy aggregates remain for older scripts: `joint` combines grounding phases,
`settle` combines sand/liquid/gas, and `rigid` combines assembly/body work.

`stepVolume` explains phase cost through active rows/cells, component counts, and
cross-layer bond counts. `shiftPhases` separates buffer movement, translation,
component registration, and generation/restoration. Browser presentation exposes
`lightMs`, `fillMs`, and `uploadMs`.

## Current structural optimizations

- Component indices cache same-layer adjacency instead of rescanning all rigid
  cells during each joint pass.
- Rigid grounding and loose support are cached and invalidated separately.
- A settled cross-layer support closure can sleep during loose-only motion.
- Above 900,000 loaded cells, grounding and assembly motion may run at 30 Hz;
  loose materials, reactions, tools, and actors keep their normal clocks. Free
  rigid bodies disable the deferral.
- Reaction passes build ordered active-material candidates once per layer.
- Fire and acid split only touched components; safe local cuts avoid full
  grounding floods.
- A locally proven cave blast keeps double-buffer carry sparse until loose
  support, assembly movement, a snapshot, resize, or world shift invalidates the
  proof.
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

These optimizations preserve deterministic output except the accepted cave-blast
carry change: removing redundant dirty rows changes shared-RNG consumption in the
aftermath while preserving fuse timing and crater geometry.

## Baseline policy

- A pure refactor must preserve the deterministic checksum.
- Explain a checksum change before updating a baseline.
- Confirm timing changes with repeated runs and phase medians; isolated p99
  movement is usually host noise.
- Update a committed baseline only when the behavior or measurement definition
  intentionally changed and the current environment is compatible.
