# Rigid smoothness evaluation

Starting revision: `455a103`. Branch: `rigid-smoothness-evaluation`.
The shipping solver is mode 45. Checksums may change; clipping protection,
continued sliding/toppling, stable rest, and affordable step time are required.

## Decision log

| Proposal | Status | Evidence |
| --- | --- | --- |
| 1. Accept raster-valid motion earlier | Reject tested prototype | Beam collision regression, slower crowded case, no peak-correction improvement. |
| 2. Unified foreground/background contact solve | Reject as a production change in this evaluation | Architecture review below; no full solver rewrite tested. |
| 3. Stable terrain contact directions | Reject tested variants | Unrestricted persistence suppresses real pivots. Large-body-only persistence is neutral alone; the combined improvement does not generalize. |
| 4. Time-scaled settling damping | Reject tested rates | One-tick rate misses the crowded settling deadline; combined rate increases large-stack repair jumps; double contact rate prevents toppling. |
| 5. Measure correction motion by stage | Keep | Baseline trace isolates corrections and exposes different outcomes despite passing clipping checks. |

## Baseline and method

Raw logs and temporary builds live in `.sand-artifacts/rigid-evaluation/`.
Durable results and source patches are in [bench/rigid-evaluation](../../bench/rigid-evaluation/).
All patches apply independently to starting revision `455a103`. No experimental
C++ or WASM changes are retained in the working engine.
The initial engine benchmark matches the committed terrain checksum.
Run comparisons with `RIGID_SOLVER_MODE=45`; some existing suites otherwise
select experimental mode 2. The crowded raster-island fixture explicitly uses 45.

The motion observer uses the existing opt-in engine trace. It reports net
translation plus radius times absolute rotation at each correction stage,
excluding ordinary velocity integration. This is a conservative perimeter-motion
bound, not rendered pixel movement or a sum of every solver iteration. Opposing
corrections within a stage can cancel. Optional missing world stages are combined
with the next recorded stage. It tracks one identified body, not the entire pile.
It skips inactive world ticks and ends when the selected body disappears (for
example, baking); that final removal tick is not measured.

The baseline passes seven focused suites. The existing `rigid-complex-stack`
fixture fails in shipping mode 45: seed 19 does not settle within 620 ticks
(tail point speed 0.04269, pose span 1.20909); seed 7 settles at tick 405.
Both seeds retain zero terrain penetration, committed ownership conflicts,
rejected cells, and failed raster projections. This failure predates experiments.

## Trials

### Time-scaled damping, alone

Replace each contact/fluid settling multiplier `factor` with `pow(factor, dt)`.
Six of seven focused suites pass. Crowded-island clipping and continued-motion
checks pass, but the pile misses its 320-tick settling deadline. On the tracked
joint body, peak correction travel drops from 2.10825 to 0.41139 cells, final
world-commit corrections from 46 ticks to 2. This is promising but insufficient
to retain without further settling checks. Logs: `damping-tests/`; patch:
`damping.patch` under the artifact root.

### Persistent terrain face directions, alone

Reuse a loaded cardinal terrain contact near the same local body anchor when
an ambiguous diagonal sample still has a clear outward adjacent cell. Reuses the
existing revision-keyed contact cache; does not smooth or erase collision cells.
Five of six focused suites pass. The three-cell-wide bar on a step fails to
topple (maximum angle about 1 degree; baseline requires at least 80). The crowded
joint-body trace is identical to baseline. Clipping guards still pass. Reject
this prototype alone: apparent support persistence can suppress a real pivot.
Logs: `terrain-anchors-tests/`; patch: `terrain-anchors.patch`.

### Damping plus persistent terrain directions

This combination is justified because weaker damping could release an
over-persistent supporting contact. It improves the crowded fixture: settles at
tick 268, tracked peak correction 0.26046, zero terrain penetration/ownership
conflicts/projection failures. However, the three-cell bar still sticks at about
1 degree. Reject unrestricted persistence even in combination. A follow-up
limits persistence to structure-scale bodies so small ledge pivots retain their
existing contact policy. Logs: `damping-anchors-tests/`.

### Earlier raster acceptance

The prototype saves substep starting poses and validates each contacting
candidate island along the proposed trajectory in <=0.25-cell perimeter steps,
with bounded refinement at the first invalid sample. It checks static terrain
(including the joint follower) and same-layer raster claims, retaining the
existing one-cell alias allowance. Final world validation remains enabled.
An already-invalid starting pose falls through to the existing recovery. Later
substeps regenerate contacts at the accepted pose. It does not add a new
constraint for each raster rejection or integrate both layers simultaneously.

Two of four focused suites pass. Terrain contact and ordinary toppling pass,
but staggered jagged beams violate the existing separation threshold (0.333
instead of >=0.4), and the crowded fixture does not settle within 320 ticks.
Tracked peak correction remains 2.10825. Crowded runtime rises from about 11.3
to 18.8 seconds (test elapsed, not an isolated performance benchmark).
Reject this implementation: accepting a sampled integer raster is insufficient
to preserve the continuous collision solver's shape separation and progress.
The single-layer beam regression is not addressed by synchronizing layers or
changing terrain normals. No combined trial is justified by that failure.
This does not disprove a future contact-generating transactional integrator.
Logs: `early-raster-tests/`; patch: `early-raster.patch`.

### Unified foreground/background solve: architecture decision

The starting implementation already gives a joint object a canonical foreground
leader, combined mass/inertia, and a synchronized background follower. Contact
normal/friction impulses already update both participating bodies, including
peer-layer bodies. A second physical identity would duplicate existing machinery.
The remaining proposal is specifically to synchronize integration and contact
generation across layers.

That requires splitting `moveBodies`' clearing, solving, erosion/recovery,
displacement and stamping around a world-level scheduler, and moving rigid work
relative to layer reactions, growth, explosives and fluid updates. Current
`StepState`, contact scratch, terrain bins and caches assume an active layer;
simply concatenating both body lists would give invalid material queries and
collisions between unrelated foreground/background objects. A valid rewrite is
possible, but it is not a demonstrated smoothness fix, and does not eliminate the
nonlinear integer-raster acceptance problem.

Reject the broad rewrite for this change rather than ship an unvalidated
approximation. This is a scope/architecture judgment, not experimental evidence
that a properly implemented world solver would fail. Earlier raster acceptance
can be evaluated locally with the final world guard retained; it does not require
this rewrite first.

### Restricted persistence, alone and combined with damping

Structure-scale means radius >=64 cells or at least 4096 occupied cells, using
the existing engine predicate. Alone, the restricted contact change passes
toppling, terrain contact, and crowded-island checks, but its crowded motion
trace is exactly the baseline. There is no demonstrated standalone improvement.

With time-scaled damping, all seven focused suites pass. The crowded fixture
settles at tick 268 versus baseline 249, and its tracked peak correction falls
from 2.10825 to 0.26046 cells. Large-stack seed 7 settles at 355 versus 405;
seed 19 settles at 521 instead of remaining awake at 620. However, peak raster
repair translations increase from 1.82153/3.19185 to 2.63922/4.24719 cells for
seeds 7/19. These are world-wide translation diagnostics, distinct from the
single tracked body's perimeter-travel diagnostic. Reject the combination:
improved settling does not justify larger correction jumps under the user's
smoothness requirement.

Thirteen additional suites produce ten passes and three failures. A subsequent
baseline run confirms all three failing suites also fail without changes:
`rigid-jitter` seed 13 leaves two bodies, `rigid-blast-settle` exceeds its
one-cell alias allowance, and `rigid-sliver` fails its force-driven motion check.
The combination improves the sliver fixture from 27 blocked cells and two
ownership conflicts to zero of both, but does not fix its force-driven-motion
assertion. Those improvements are recorded without treating pre-existing suite
failures as new regressions or claiming the two runs fail identically.
Logs: `large-anchors-tests/`, `damping-large-anchors-tests/`,
`combination-validation/`, and `baseline-validation/`.

### Stronger time-scaled contact damping

The final calibration doubles the contact damping rate (`pow(factor, 2 * dt)`)
while retaining the one-tick fluid rate and restricted terrain persistence.
It again prevents the three-cell ledge bar from toppling, misses the crowded
settling deadline, and has 17 blocked cells in the sliver fixture. Reject.
The remaining large-stack run was interrupted once the independent toppling
regression established rejection; it is not counted as a completed comparison.
Logs: `damping-rate2-tests/`; patch: `damping-rate2.patch`.

## Retained change and reproduction

`scripts/rigid-motion-metrics.mjs` observes correction stages using the existing
test ABI. The crowded-island suite writes `motion.json` into its runner artifact
directory and guards the tracked peak correction at 2.2 cells (baseline 2.10825).
This includes rotational perimeter travel, which the translation-only raster
correction counter cannot show. Existing clipping, continued-motion, and sleep
assertions remain enabled. This guard records current behavior; it does not
claim the baseline is perfectly smooth.

Run the retained diagnostic:

```sh
node scripts/run-tests.mjs --only rigid-world-raster-island
```

To reproduce a rejected experiment in a checkout of `455a103`, apply its patch
from `bench/rigid-evaluation/`, then build and select the recorded suites:

```sh
npm run build:sand -- --out-dir .sand-artifacts/experiment
RIGID_SOLVER_MODE=45 node scripts/run-tests.mjs \
  --only rigid-topple,rigid-world-raster-island,rigid-large-body,rigid-terrain-contact \
  --wasm .sand-artifacts/experiment/sandEngine.js
```

Copy the retained motion helper and instrumented crowded-island test into that
checkout to obtain the stage report as well. `results.json` lists every completed
suite and its failures; interrupted suites are explicitly identified.

Final verification: the instrumented crowded-island suite passes, both changed
JavaScript files pass syntax checking, all seven saved patches pass
`git apply --check`, and `git diff --check` passes. The post-evaluation engine
benchmark matches the initial and committed checksum `0xb1117be5`; simulation
source and committed WASM are unchanged, so no benchmark baseline update is needed.
