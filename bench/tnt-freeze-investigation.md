# TNT freeze investigation

Investigated at commit `b0a623a` using its committed production WASM.
The reported session has no replay capture, so its exact failing operation is
unknown. Two expensive paths reproduce under related conditions. Neither result
establishes that the original session was in that path.

## TNT placement into moving debris

Run `node scripts/bench-tnt-placement.mjs` for the small comparison, or append
`160 240` for the larger cases.

The manufactured fixture is a connected stone plate with isolated holes. One
held, zigzag TNT gesture collects empty cells throughout the plate. A floor
connection provides a static control; removing it produces one free rigid body.
No world tick runs during the measured mouse release.

Observed moving-plate release times before the fix:

| Plate dimensions | Release time |
| --- | ---: |
| 40 × 40 | 0.056–0.061 s |
| 80 × 80 | 0.809–0.812 s |
| 160 × 160 | 13.675 s |
| 240 × 240 | 75.209 s |

The checked 80 × 80 run places 701 TNT cells and replaces the same body 701
times. Its static control takes 0.372 ms. A separate 240 × 240 fixture with
only one horizontal stroke takes 1.175 s; eight passes take 8.741 s. The
equivalent static placements complete in approximately one millisecond.

At the investigated commit, `ToolSystem::finalizeDraft` filters the preview
against the current grid and `finalizeStructuralPlacement` processes
disconnected patches separately.
`RigidBodySystem::finishSpawn` welds each patch to the touched body by copying
its whole raster, removing the old body, creating a replacement, computing its
geometry and collision structures, and stamping it again. The mixed-material
spawn overload invokes `computeDerived` twice per replacement. When many
patches touch the same large body, the work multiplies patch count by body
reconstruction cost. With fixed hole spacing, doubling both fixture dimensions
increases each of those factors by approximately four.

This path executes on mouse release. Holding a preview alone does not invoke
it. The user's uncertainty about whether release occurred leaves it a candidate.
The fixture deliberately amplifies the workload; it is not a recovered snapshot
of the user's terrain.

## Settling after large cuts

Run `node scripts/bench-tnt-aftermath.mjs`. This scripts perimeter and diagonal
TNT cuts through a 1024 × 768 procedural window, seed 1401181199, while keeping
a separate TNT placement preview held. Explicit detonation calls and world
steps are timed separately. It is a constructed stress workload, not a replay
of the incident.

The production-engine sweep reached a 2.637 s world step at tick index 80.
A temporary build with function names enabled reproduced a 2.729 s maximum.
Profiling indices 60–91 sampled 51.693 s including scripted detonations:

- 32.084 s (62%) included `RigidBodySystem::ensureBodyRaster`.
- 21.086 s included `resolveStructureRasterOverlaps`.
- 13.330 s included the whole-assignment validation lambda inside
  `resolveWorldRasterAssignment`.

These are overlapping inclusive timings, not additive phase totals. Collision
correction repeatedly tries nearby poses and rebuilds their cell footprints.
The per-layer overlap solver tries up to four passes over pairs, two candidate
axes, two directions, sixteen offsets, and additional binary searches. Failed
corrections can compare previous poses against the entire body roster.

The cross-layer assignment search has candidate and raster-work budgets, but
its later rollback validation uses a separate limit of 64 whole-roster checks.
These limits do not impose one total raster-cell budget across all correction
paths. In `stepWorld`, world-contact relaxation and world-raster assignment are
included in `layersMs` but lack dedicated fine-phase timers, which makes their
cost less obvious in existing phase summaries.

The settling workload did not reproduce a single minute-long step. It confirms
a substantial separate bottleneck; extrapolating it to the original freeze
would require a capture or a matching reproduction.

## Why recovery controls also stop

At the investigated commit, worker phase breadcrumbs classify blocked work,
but do not display the authority
failure overlay. A synchronous operation can therefore stop updates without an
error message. `startReplay` marks the replay UI busy and waits for the worker's
verified export; `requestReplayExport` has no timeout. Pressing L during that
wait returns immediately because the UI is busy. A prolonged worker operation
therefore also explains the reported R-then-L failure.

## Validation and scope

- Existing `tnt-rigid-bake`, `worker-order`, and `worker-liveness` suites passed.
- Eight seeded repeated-placement workloads completed 5,760 world ticks and
  192 gestures without a permanent stall.
- Four broader cut/held-preview workloads completed 500 ticks each; the next
  workload exposed multi-second steps and was stopped for focused profiling.
- The placement benchmark checks exact TNT cell count, unchanged world tick,
  body count, and body-ID churn. Its default static/moving comparisons passed.

## Fixes and verification

Placement groups use both new-cell adjacency and shared existing rigid bodies.
Disconnected patches touching the same physical assembly are welded together
in one reconstruction. Growth origins retain independent placement behavior.
The moving 80, 160, and 240 fixtures now release in 3.12, 6.51, and 14.18 ms,
respectively, with exactly one body replacement each. The largest comparison
is 75.209 seconds before versus 0.01418 seconds after.

Raster overlap trials sample the smaller footprint against the larger body's
local mask. Mask coordinates use bounded integer rounding with the same valid
half-cell ownership as `lround`. Correction candidates and acceptance rules
are preserved. The held-preview aftermath fixture now peaks at 0.994 seconds
per world step, versus 2.637 seconds before. This reduces the measured bottleneck
but does not impose a global time budget or eliminate all expensive ticks.

Replay exports time out after five seconds. L can preempt R's pending capture
and immediately expose the independent journal. Late/superseded R results do
not start playback or overwrite the logs. A nonblocking status notice appears
after five seconds without simulation progress and clears when progress resumes.

Validation:

- New foreground/background perforated-body regressions verify a single
  replacement, complete cell ownership, unchanged tick, and momentum conservation.
- Existing placement welding, TNT baking, world-raster ownership, world-raster
  island, replay capture, and liveness suites pass.
- New worker-client tests cover export timeout, supersession, late responses,
  successful completion, shutdown cleanup, stall reporting, and recovery.
- Standard engine benchmark comparison retains checksum `0xcf5a0ed3`.
  Step p99 is 14.303 ms (14.799 ms in the immediate before run); the committed
  baseline remains valid. Production WASM was rebuilt.
- The 900-tick `rigid-tnt-rubble` suite fails its quiet-state assertion with two
  significant bodies still awake. Running the original committed WASM reproduces
  that failure with the same body states; terrain and ownership assertions pass.
  This is a pre-existing settling issue, not a regression from these fixes.
- The worker browser suite passes its startup, liveness, L-panel, and early
  replay checks, then times out at `worker-e2e.mjs:272` while resuming a seek.
  A separate clean archive of the original checkout times out at the same
  assertion. The focused capture/preemption tests pass independently.
- Production site build, changed-file ESLint checks, WASM provenance, and
  `git diff --check` pass.
