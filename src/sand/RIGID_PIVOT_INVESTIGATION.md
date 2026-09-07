# Rigid pivot investigation

Investigated revision `a630329` on `codex/rigid-pivot-investigation`, in the
isolated `/private/tmp/website-rigid-pivot` worktree. The implementation keeps
contact damping for supported bodies and protects slow, unbalanced pivots.
The retained no-snap patch records the diagnostic experiment, not the fix.

## Confirmed failure

An off-centre L-shaped body or hollow rectangular frame can stop rotating and
sleep on a three-cell-wide stone post even though its centre of mass lies
outside that post. This occurs at sizes 32, 64 and 128 cells. Straight beams on
the same support topple. All probes use shipping solver mode 45, gravity 0.06,
ordinary rigid material, no fluids, and 600 ticks. Generic rigid material avoids
baking so the body can be observed after sleep.

| Shape | Size | Baseline maximum rotation | Baseline first sleep tick | Maximum rotation with angular snap disabled | First 45-degree tick with snap disabled |
| --- | ---: | ---: | ---: | ---: | ---: |
| L | 32 | 0.795° | 19 | 149.490° | 54 |
| L | 64 | 0.328° | 19 | 136.369° | 85 |
| L | 128 | 0.188° | 19 | 134.969° | 102 |
| Hollow frame | 32 | 0.472° | 19 | 195.453° | 77 |
| Hollow frame | 64 | 0.233° | 19 | 182.493° | 111 |
| Hollow frame | 128 | 0.136° | 19 | 104.375° | 131 |

Angles are maximum absolute accumulated rotation, not a final resting angle.
The 128-cell L has 3,840 cells and radius 97.11; the hollow frame has 7,168 cells
and radius 89.80. Their centres of mass start at x=329.87 and x=330, while the
post occupies x=[319,322]. These are materially unbalanced configurations.

This also occurs after falling: a 64-cell hollow frame dropped one cell rotates
only 0.356° and sleeps at tick 29. Disabling the snap lets it pass 45° at tick
111 and reach 118.715°. All nine probes dropped twelve cells topple with the
baseline, so initial impact strength affects whether the body escapes the trap.
This experiment does not establish that every awkward large-body landing has
the same cause.

## Mechanism

1. `rigid_step_substeps.inc`, near `spinGrowing`, applies contact damping and a
   hard angular-velocity cutoff. A body is classified as squat when its bounding
   box's long side is less than twice its short side. A sparse L or hollow frame
   therefore gets the same cutoff as a compact block.
2. Spin below `R_CONTACT_ZERO_SQUAT_ANG` (0.0005 radians/tick) is set to zero.
   Structure-scale bodies also require rim speed below 0.015 cells/tick, but
   their initial acceleration is small enough to satisfy both thresholds.
3. The growing-spin exemption requires `omega * omegaPre > 0`. Starting from
   zero fails that test. Repeatedly zeroing the new spin prevents it from ever
   establishing the protected, growing rotation.
4. The low-speed sleep gate then reaches `R_SLEEP_TICKS` (20). The saved support
   list records upward contacts, but this path does not establish that those
   contacts can balance the body's gravitational torque before sleeping it.

For the 128-cell hollow frame, the first solver step changes its angle by
0.0000707 radians, but reported angular velocity is already zero at tick end.
The same pattern repeats until it sleeps. The baseline has **zero measured
raster correction and zero terrain penetration** in these stuck cases, excluding
raster repair as the immediate cause of this reproduction.

Mass properties are computed from occupied cells, including each cell's own
square inertia, rather than from the bounding box. Existing inertia tests pass.
Larger radius and distributed mass make small initial angular acceleration
plausible; the error is deleting that motion and accepting an unbalanced rest.

## Controlled experiment and limits

`bench/rigid-pivot/no-angular-snap.patch` changes only the angular cutoff to zero.
All six initially stuck cases then topple and eventually sleep. Six balanced
beam/frame controls remain within 0.22° and sleep at tick 19. All measured
probes have zero terrain penetration. Maximum correction in the released
128-cell L is 0.0291 cells; the other five off-centre L/frame probes have zero.

Baseline suites passed: `rigid-inertia`, `rigid-rotation`,
`rigid-terrain-contact`, `rigid-topple`. The diagnostic build also passed the
latter three. This is not a broad pile, fluid, destruction, or performance
qualification. The existing large rotation test accepts only 0.15 radians of
roll and does not cover a low-energy, off-centre pivot or support balance.

The baseline engine checksum matches the committed `0xe1e87436`. Timing
comparison is skipped because this worktree runs Node 26 while the recorded
baseline uses Node 20. A raw diagnostic-engine benchmark produces `0x6fe116ce`:
removing the snap has wider simulation effects and must not be accepted solely
because these focused tests pass. Its alternate-loader benchmark reports the
shipping artifact in metadata, so do not use that metadata as build identity.
These checksums describe the initial experiment; implementation validation is
recorded below.

## Implemented support policy

Near rest, the solver checks the horizontal span of level contacts below the
centre of mass. A body outside that span by more than half a cell retains its
small angular velocity when it turns toward the overhang, and cannot enter
either low-motion sleep path. Existing linear damping, impact behavior,
collision impulses, and raster penetration guards remain active.
Touching contacts count even when their impulse is temporarily zero: excluding
them incorrectly classifies supported pieces in crowded piles as unbalanced.
Side contacts, supports at different heights, fluids, and spatial forces retain
the general settling policy.

For contacts between bodies, the connected island's mass-weighted centre must
also lie outside its terrain contact span before applying the exception.
This conservative check lets connected pieces counterbalance one another; it
does not replace the full contact solver with a single fixed pivot.

Sleeping bodies retain a 7×7 static-terrain occupancy stencil around each saved
support anchor. The existing support-change dirty flag gates stencil checks.
Removing part of a support wakes the body for another contact solve, even when
another cell remains near that anchor. Adding terrain alone does not invalidate
the stencil.

`rigid-pivot` adds mirrored L/frame cases at 32–128 cells, a 256-cell frame,
short falls, a support made from another body, balanced controls, and partial
support removal. Every tipping case checks direction, progress before sleep,
and absence of terrain penetration. Balanced controls must remain upright and
sleep. The original diagnostic remains available for motion traces and frames.

Contact normal quantization, manifold reduction, and raster recovery can still
matter in other concave landings. This fix addresses the demonstrated settling
and support-removal defects without rewriting those systems.

## Implementation validation

Seventeen related suites pass in shipping mode 45: pivot, collision, inertia,
rotation, terrain contact, toppling, fluid accuracy, dense piles, layer solver,
world raster, crowded raster island, large bodies, complex stacks, shape stress,
joint erase, stamp rejection, and actor/rigid contact. The production WASM and
site build both succeed. Results are retained in
`bench/rigid-pivot/fix-results.json`.

The 128-cell L reaches 45° at tick 101, the 128-cell frame at 130, and the
256-cell frame at 177; all subsequently sleep and have zero terrain penetration.
Balanced controls move at most 0.077° and sleep at tick 19. The partially removed
support wakes its frame, which reaches 45° at tick 322.

Two separately checked edge cases also fail on untouched `a630329`:
`rigid-blast-settle` exceeds its raster-alias allowance, and `rigid-window-edge`
observes three bodies where its fixture expects two. Their assertions remain
unchanged. No newly failing suite is accepted by relaxing a threshold.

The same-host, three-repeat engine comparison changes the deterministic checksum
from `0xe1e87436` to `0xe0214132`, as expected for the physics change. Mean step
time is 2.128 → 2.112 ms; raw p99 is 12.115 → 12.165 ms (+0.4%). All timing
gates pass. The baseline comparison uses a clean archive of `a630329` with the
same Node 26 runtime; it does not compare Node 26 timings against Node 20.
The committed engine baseline is updated, and its follow-up comparison passes.
The browser panning comparison also passes: horizontal/vertical instability and
near-ridge mismatch are all zero, with average/p95 frame times of 21.806/25.8 ms.

## Reproduction

```sh
node scripts/rigid-pivot-investigate.mjs
PIVOT_DROP=1 node scripts/rigid-pivot-investigate.mjs
PIVOT_OFFSET=0 PIVOT_SHAPES=bar,arch node scripts/rigid-pivot-investigate.mjs
RIGID_SOLVER_MODE=45 node scripts/run-tests.mjs \
  --only rigid-inertia,rigid-rotation,rigid-terrain-contact,rigid-topple
```

The probe reports measurements, not a pass/fail verdict. `PIVOT_SIZES`,
`PIVOT_SHAPES`, `PIVOT_MODES`, `PIVOT_DROP`, and `PIVOT_OFFSET` select scenarios.
`SAND_TEST_ARTIFACTS` selects the results directory; use a different directory
for each experiment. `PIVOT_SVG=1` writes exact raster frames at ticks 0, 19,
160 and 599, with an orange centre-of-mass marker.

To reproduce the original no-snap experiment, use a clean checkout of
`a630329`, copy the retained diagnostic script and patch into it, then build
and select a separate artifact:

```sh
git apply bench/rigid-pivot/no-angular-snap.patch
npm run build:sand -- --out-dir .sand-artifacts/no-angular-snap
SAND_WASM_LOADER=.sand-artifacts/no-angular-snap/sandEngine.js \
SAND_TEST_ARTIFACTS=.sand-artifacts/pivot-no-snap \
node --import ./scripts/sand-wasm-loader.mjs scripts/rigid-pivot-investigate.mjs
RIGID_SOLVER_MODE=45 node scripts/run-tests.mjs \
  --only rigid-rotation,rigid-terrain-contact,rigid-topple \
  --wasm .sand-artifacts/no-angular-snap/sandEngine.js
git apply -R bench/rigid-pivot/no-angular-snap.patch
```

The visual comparison is in `.sand-artifacts/pivot-comparison.png`.

Summary measurements are retained in `bench/rigid-pivot/results.json`. Full
per-tick samples and SVG frames are in this worktree's `.sand-artifacts/pivot*`
directories. No changes were made to the other agent's worktree.
