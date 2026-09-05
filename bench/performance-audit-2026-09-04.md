# Sand engine performance audit — September 4, 2026

The largest opportunity is reducing structural repair and repeated raster validation. Raw body count, blast stencil evaluation, and the neutronium nearest-source index are not the dominant costs in the worst measured scenes. Mixed neutronium/water scenes also have substantial force sampling and rigid/fluid pressure costs.

## Measured results

Audited revision: `d1d49f2b53615f860246b232ea101b50fd84266d`. Production WASM: 1,572,068 bytes, FNV `0xcbb70158`. Host: Apple M1 Pro, macOS arm64, Node 20.19.5, Emscripten 6.0.0. The production provenance check passed; the main deterministic checksum is `0xcf5a0ed3`, matching the baseline. Benchmarks ran sequentially. No production engine changes or baseline updates were made for this audit.

Times below are **simulation milliseconds per world step**, not browser frame times. A 60 Hz authority turn has 16.67 ms for all its work. The live worker advances actors and the world together, so expensive world steps slow authoritative gameplay even if presentation stays smooth.

| Workload | Median | p95 | Interpretation |
| --- | ---: | ---: | --- |
| Main streaming benchmark, 768×320 | 2.56 | 13.49 | Existing baseline comparison passes |
| Generated terrain control, 1000×1000 | 5.95 | 36.91 | No injected reagent; includes initial terrain settling |
| Fire in generated terrain, 1000×1000 | 39.60 | 85.64 | Grounding and component indexing dominate |
| Acid in generated terrain, 1000×1000 | 15.90 | 78.75 | Structural refresh produces substantial tail latency |
| Acid over 32 slabs, 448×352 | 16.25 | 23.37 | Fragments grow to 156 bodies at peak |
| Water over the same 32 slabs | 7.94 | 8.99 | Comparison workload; bodies remain intact |
| 128 ordinary rigid bodies, 768×320 | 1.66 | 5.26 | Count alone is relatively inexpensive here |
| 128 neutronium bodies, 768×320 | 6.86 | 8.54 | Sustained contact solving dominates |
| Moving 900-cell neutronium + lava | 5.23 | 11.15 | Force wake and liquid motion dominate |
| Mixed cross-layer debris + neutronium + water, 768×384 | 68.92 | 81.78 | Every measured step exceeds 16.67 ms |
| Repeated TNT cuts and aftermath, 1024×768 | 51.02 | 397.13 | Worst observed world step: 435.77 ms |

Main, neutronium, mixed, and TNT workloads use three repetitions. Generated-terrain results are the median of three per-run quantiles from a paired idle/fire/acid control harness. Acid/water slabs are single production runs; their comparison is indicative, not an isolated chemistry microbenchmark, because erosion changes the scene. TNT aftermath quantiles are medians of three per-run quantiles; all three runs had identical per-tick grid hashes and body states.

Additional observations:

- The packed two-layer cave containing **19,577 TNT cells** has a median per-run worst detonation step of **21.45 ms**. Its staged wave runs from tick 27 through 87 and peaks at 27 foreground bodies. The 5,905-cell cave chain reaches 21.79 ms. These are distinct from the much more expensive repeated-cut aftermath fixture.
- A 60-body irregular pile takes 1.63 ms median / 4.91 ms p95. A compact burning-plant fixture takes 1.53 ms median / 7.96 ms p95, but lacks an explicit seed, so its counts are not a deterministic comparison target.
- Acid repeatedly quenching lava is comparatively cheap in the existing 420×280 fixture: 0.98 ms median versus 0.12 ms for idle lava. Cooling already produces loose stone dust, avoiding rigid-fragment growth.
- Static neutronium with lava takes 2.09 ms median; moving a 900-cell source raises it to 5.23 ms. Neutronium is not uniformly expensive: movement, wet area, and contact topology matter.

## Prioritized improvements

### 1. Localize cross-layer raster recovery — highest stall severity

The aftermath CPU profile attributes **33.1% of sampled world-step time** to the exact assignment validator inside `resolveWorldRasterAssignment()`. At the worst production step, `layersMs` is 417 ms but `bodyMs` reports only 111 ms; the global reconciliation passes are outside the body timer.

The resolver has bounded search, but the bounds are large: 8,192 trial candidates, up to 16 million raster-cell operations in its search, and a separate allowance of 64 whole-roster rollback validations. A validation walks the bodies' raster footprints across both layers. Rechecking unrelated bodies on repeated candidate poses makes large fragments expensive even with modest body counts.

**Next implementation:** instrument validation calls/cells, trial rasterizations, rollback passes, and failure reasons. Retain fixed claims for unaffected bodies and validate only the changed contact island plus its possible collision partners. Use a conservative spatial query for those partners. Preserve the exact ownership and terrain checks, candidate order, and cross-layer atomicity. Reuse identical trial footprints where possible. Do not merely lower the budget or skip validation; that can park bodies or change collision outcomes.

**Verify:** the recorded aftermath trajectory, `rigid-world-raster`, `rigid-world-raster-island`, `rigid-large-body`, and the mixed benchmark. Measure p95/p99, recovery work, material retention, and final body motion together.

Sources: [`step.inc:271`](../src/sand/cpp/engine/step.inc), [`rigid_impl.inc:1027`](../src/sand/cpp/engine/rigid_impl.inc); search budget near line 1387 and rollback budget near line 1625.

### 2. Make cave cuts local to the cut, not the entire touched component

In the packed cave TNT profile, **66.0%** of sampled step time is under `splitRigidAfterStableErase()`, including **32.9%** under `patchStableComponentTopology()`. Blast evaluation itself is only about 0.5%. The existing wave and debris budgets are working; component repair remains expensive.

The repair identifies touched slots, but then floods their surviving cells. Adjacency repair walks **every cell in each changed slot**, probes eight neighbors, sorts new edges, and merges them into the global list. A small crater in a single enormous cave component still incurs large component-sized passes. The grounding-preservation proof does not currently eliminate those connectivity and adjacency scans.

**Next implementation:** extend the existing exact local-cut proof to stable-slot blast repair. For proven non-separating removals, retain component identity and patch only removed cells and incident contact edges. Edge contact counts or witnesses can establish whether the last connection actually disappeared. Keep the full flood for real or unproven fractures, and retain deterministic ordering where cell order affects later work. The existing acid local-proof and stable-slot mechanisms are useful starting points; this is an extension of them.

**Verify:** packed cave TNT, fire erosion, cross-layer support-loss cases, topology/retention assertions, and deterministic trajectories. Measure cells visited per cell removed; the desired scaling is with the cut boundary in the common non-separating case.

Source: [`components_impl.inc:1529`](../src/sand/cpp/engine/components_impl.inc), especially `patchStableComponentTopology()` and `splitRigidAfterStableErase()`.

### 3. Remove redundant grounding without changing its scheduling semantics

Generated-terrain profiles put **64.9% of fire** and **59.5% of acid** sampled step time under `computeGroundedBoth()`; component indexing accounts for 17.7% and 13.9%, respectively. These are inclusive percentages and must not be added together.

An unexpected caller is `finishBlastBatches()`: `applyExplosives()` invokes it every active layer, including empty batches. Before the per-batch no-op checks, it rebuilds grounding when the component index is invalid. Its inclusive profile share is 12.4% for fire and 43.0% for acid, although these are reagent fixtures rather than authored TNT chains. This couples ordinary topology edits to explosive finalization.

**Isolated experiment:** an early return for two empty batches was built outside the working tree and tested against the same generated-terrain controls. It changes idle and acid grid checksums. Fire's final grid checksum matches in that fixture. Therefore, the guard is **not a verified behavior-preserving optimization** and was not applied to the website engine. Its final timing and checksum results are recorded in the experiment section below.

**Next implementation:** identify which later consumers require the grounding refresh and move that obligation into explicit step coordination. Coalesce invalidations only where the same support state is observed by foreground, background, carry, and detachment. Separately, preserve exact component indices after proven safe cuts so the refresh is unnecessary in the first place. Do not assume an empty transaction currently has no simulation effects.

Sources: [`explosives_impl.inc:801`](../src/sand/cpp/engine/explosives_impl.inc), its final unconditional call in `applyExplosives()`, [`step.inc:244`](../src/sand/cpp/engine/step.inc), and [`components_impl.inc:42`](../src/sand/cpp/engine/components_impl.inc).

### 4. Optimize wet neutronium workloads and contact solving separately

The mixed benchmark spends a mean **28.81 ms in the body phase**, **10.55 ms in liquid motion**, **6.34 ms in force wake**, and **4.77 ms in the tail**. Its rigid/fluid coupling subtotal is **11.46 ms**, including **7.00 ms in pressure solves**. CPU profiling confirms force sampling (19.5% inclusive under `sampleLayer()`) and rigid/fluid coupling (18.1%) as major consumers. Existing per-tick loose-force caches and bounded fluid domains are already present.

**Next implementation:** count force-cache hits/misses by caller, bin, and target class, and separate unchanged-field samples from genuinely changed geometry. Look for exact reuse across unchanged bins and repeated target classes. In fluid coupling, count repeated domains and matrix builds across substeps; reuse invariant domain/face data while geometry and wet boundaries remain unchanged. Preserve the pressure operator and force semantics. Batching dirty-row marks is another measured secondary target: `mergeRowSpan()` is 4.2% inclusive in this profile.

For **dry dense neutronium**, the diagnosis differs: the body phase is 6.02 ms of a 6.72 ms mean step, while force preparation is only 0.48 ms. Contact normal/friction solving accounts for substantial CPU time. Large forced islands intentionally run velocity iterations to a no-op or the cap; reducing iterations blindly risks persistent jitter and worse eventual performance. Investigate residuals, persistent contact quality, and sleep eligibility before adjusting that policy.

Sources: [`forces_impl.inc:1342`](../src/sand/cpp/engine/forces_impl.inc), `sampleLoose()` and `sampleBody()`; [`rigid_step_substeps.inc:1376`](../src/sand/cpp/engine/rigid_step_substeps.inc); [`rigid_impl.inc`](../src/sand/cpp/engine/rigid_impl.inc), `coupleLiquids()`.

### 5. Reduce repair and allocation work during body erosion

Acid over slabs raises mean step cost from 7.89 ms with water to 16.07 ms. The body phase accounts for 11.40 ms, or 71% of the acid run. In the acid profile, body erasure/connectivity repair is about 11% inclusive; fluid coupling, contacts, liquid movement, and raster work also matter. A connectivity-only optimization cannot remove the entire difference.

`erodeBodies()` already limits probes to cached boundaries. Once a body is damaged, `finishErasedBodies()` builds world-cell lists for the body roster, floods affected bodies, and calls `computeDerived()` even for a connected chip. That rebuild recalculates occupancy-derived geometry, boundary data, and collision proxies. Fire on free bodies uses the same path.

**Next implementation:** bucket only dirty bodies' world cells, reuse per-tick allocation scratch, and add an exact local no-split proof where possible. Consider incremental derived geometry only after measuring reconstruction cost separately. Preserve world-raster connectivity for rotated bodies; switching to local occupancy connectivity would reintroduce fragmentation errors documented in the code.

**Verify:** acid slabs and water comparison, body erosion/retention, rotated and joint fracture cases, and fire on seeded moving objects. Compare awake-body lifetime and peak fragment count as well as immediate step cost.

Source: [`rigid_impl.inc:3660`](../src/sand/cpp/engine/rigid_impl.inc), `finishErasedBodies()`, `erodeBodies()`, and `computeDerived()`.

## Empty-blast experiment: useful evidence, not a shippable fix

The isolated change was:

```cpp
if (!bb.any && (!otherBb || !otherBb->any)) return;
```

Both original and experimental controls ran three times without a CPU profiler attached. The experiment used the isolated optimized profiling WASM; named symbols are retained, but sampling was disabled. These are exploratory measurements, and the changed simulations prevent treating all timing differences as equal-work speedups.

| 1000×1000 fixture | Original median / p95 | Guard median / p95 | Original → experimental final grid hash |
| --- | ---: | ---: | --- |
| Idle terrain | 5.95 / 36.91 ms | 4.39 / 26.82 ms | `0xddd0253e` → `0xefa11870` |
| Fire | 39.60 / 85.64 ms | 38.29 / 70.58 ms | `0xe0af6f32` → same |
| Acid | 15.90 / 78.75 ms | 17.42 / 60.31 ms | `0x759033f3` → `0xc1cb5da2` |

The main benchmark checksum still matches `0xcf5a0ed3`, and all ten TNT benchmark rolling hashes match. That is insufficient: the independent terrain fixtures expose changed behavior. A fire final-grid match alone also does not establish identical intermediate trajectories. The result supports investigating the grounding dependency, not shipping the guard. The isolated patch and build provenance are saved with the raw artifacts.

## Measurement gaps to fix alongside the first optimization

- Add timers for `beginWorldContactRelax()`, `relaxWorldContacts()`, and `resolveWorldRasterAssignment()`. They are inside `layersMs` but outside `bodyMs`; the current breakdown hides the worst aftermath cost.
- Several solver work counters reset in `rigid_step_prepare.inc` for each layer solve, while many timing totals accumulate across layers. In a two-layer scene, the published contact/substep counters can describe only the last solve. Aggregate at world-tick scope or label and export each layer separately.
- Grounding/index timers can nest within reaction, layer, and cross-layer timers. Do not sum every reported phase or add inclusive CPU-profile percentages.
- The TNT benchmark's printed p95 is a quantile of only three **run-level peak values**, not per-tick p95. The scenario runner retains per-tick world timing, but reports only the maximum for direct detonation calls. Preserve their full samples too: direct detonation peaks here were 82–87 ms, outside the world-step table.
- Generated-terrain reaction tests need a control and warm/startup separation. The control added for this audit shows nontrivial terrain startup cost. The real worker also uses a 512×352 simulation focus; the million-cell headless stress test does not reproduce that focus policy.
- A browser follow-up should measure authority turn, tool application, diff serialization/bytes, mirror application, lighting, WebGL uploads, and input latency. The mixed benchmark's 16.33 ms median dual-layer CPU render fill and its summed frame proxy are not measurements of the actual worker/main-thread/GPU pipeline. Its simulated backlog is a pressure metric, not a real accumulating worker queue.

## Reproduction and artifacts

Raw logs, controls, profiles, source/build metadata, and experiment output are under `.sand-artifacts/performance-audit-2026-09-04/`. That directory is local and ignored by Git. The report is the durable repository artifact.

```sh
node .sand-artifacts/performance-audit-2026-09-04/run.mjs
node .sand-artifacts/performance-audit-2026-09-04/reaction-controls.mjs
npm run build:sand -- --profile
node .sand-artifacts/performance-audit-2026-09-04/profile.mjs
node .sand-artifacts/performance-audit-2026-09-04/analyze-profile.mjs \
  .sand-artifacts/performance-audit-2026-09-04/profile-aftermath/aftermath-0.cpuprofile
```

Profiles use a separate named-function build at production optimization. Profile percentages select stacks under `stepWorld()`/`step()` and exclude fixture construction, rendering, and result serialization. Some functions are inlined into larger callers, so an unattributed `stepLayer()` self sample is not proof that coordination itself is expensive. Profiles for slab erosion include its settling warmup; production timings above exclude that warmup. Function-level profiles are attribution evidence, not production timing comparisons.

Terrain/ABI edits appeared in the working tree during the audit; they were left untouched and are not included in these measurements. The isolated experiment was made from the audited Git revision. No results here claim to evaluate a subsequently rebuilt engine.

## Implementation follow-up

The first optimization pass addresses cross-layer raster validation, stable-slot cave-cut adjacency repair, and the mixed neutronium/fluid workload. The empty-blast grounding experiment remains excluded.

- **Raster validation:** conservative 16×16 body/terrain bins identify where exact cell claims can conflict. Large sparse footprints visit only those spans; small or densely overlapping footprints use the full scan. Trial order, overlap allowances, terrain predicates, and search budgets are unchanged. Invariant builds compare the result and violating-body vector against the full validator on every call.
- **Cave cuts:** when removal produces no new component slots, existing adjacency edges are retained only after finding a surviving contact, searching the smaller component. Genuine splits rebuild incident edges. Connectivity floods and fragment order are unchanged. Invariant builds compare the edge list with a full rebuild.
- **Neutronium/fluid:** ordinary force sampling returns immediately for neutronium-only emitter lists, while the separate nearest-neutronium query is unchanged. Final fluid impulse writeback evaluates only the body-boundary operator; pressure iterations still use the complete operator with identical arithmetic and convergence policy.

Measurements below compare production builds of the audited revision, with and without this patch, sequentially on the same M1 Pro using an explicitly pinned **Node 20.19.5** executable. Each workload uses three repetitions. Earlier exploratory runs selected Node 26 from the temporary directory and are not used for the final comparison. The frozen comparison isolates this patch from concurrent terrain/ABI work in the website workspace.

| Workload / metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Packed cave TNT, median total wave time | 1,048.08 ms | 639.95 ms | 38.9% |
| Packed cave TNT, median per-run worst step | 21.13 ms | 14.23 ms | 32.7% |
| 5,905-cell cave chain, median total wave time | 378.79 ms | 230.04 ms | 39.3% |
| Repeated-cut aftermath, median per-run p95 | 401.46 ms | 367.34 ms | 8.5% |
| Mixed debris/neutronium/water, step median | 68.42 ms | 66.79 ms | 2.4% |
| Mixed debris/neutronium/water, step p95 | 81.18 ms | 80.51 ms | 0.8% |
| Main streaming control, step p95 | 13.48 ms | 13.51 ms | −0.2% |

All ten TNT fixture rolling hashes match. The aftermath's complete recorded grid-hash and body-state trajectory matches at every event across all three repetitions (92 world steps per run). Its median step changes only from 51.09 to 50.48 ms; the benefit is concentrated in the slow tail, and severe stalls remain.

The mixed workload retains fingerprint `0x26f54306`, body-count peaks, and reported solver-work counts. Its small timing improvement is much less decisive than the cave TNT result, and its p99 increased from 84.66 to 86.28 ms in this run. It remains above the 60 Hz step budget throughout. Mean fluid writeback drops from 0.811 to 0.718 ms, but total fluid coupling does not show an improvement in this run. Further work should target the larger pressure-solve and force-query costs identified in the audit. Main streaming remains effectively unchanged and retains checksum `0xcf5a0ed3`.

Raw comparison logs, deterministic checks, build logs, and suite results are under `.sand-artifacts/performance-optimization/`. The baseline mixed benchmark completed its measurements and printed its fingerprint, then failed to open the comparison JSON missing from its temporary source tree; its recorded timing samples are still usable. The optimized comparison uses the committed baseline file.

### Validation and workspace integration

The isolated production patch passes `component-erase`, `neutronium-force`, `rigid-world-raster`, `rigid-world-raster-island`, `rigid-large-body`, `rigid-fluid-accuracy`, `explosives`, `grounding`, and `pure-perf`. A separate invariant build passes the neutronium, fluid accuracy, both raster suites, explosives, and the packed-cave TNT stress case. The `layer` suite's open-sky crown assertion fails identically on the original audited engine and the optimized engine; that existing failure is not suppressed.

The website's production WASM was rebuilt with both this patch and the current terrain/ABI edits. The eight targeted physics/topology suites pass in that combined build. Its checksum suite initially reports different terrain checksums. A second isolated control containing the current workspace edits **without any of the six performance source changes** reproduces all three new checksums exactly over three repetitions:

| Fixture | Audited revision, both variants | Current terrain, both variants |
| --- | --- | --- |
| pan-stream | `0xcf5a0ed3` | `0x4a887044` |
| liquid-active | `0x3a748881` | `0xa200c5f1` |
| components-active | `0x9e4754c9` | `0xbaaff10e` |

The checksum expectations and engine benchmark baseline are refreshed for the existing terrain edits after this control comparison. This baseline refresh is not evidence of a behavior change from the performance patch. The committed mixed benchmark also predates the audited engine: its old fingerprint is `0xc3ba1549`, whereas both original and optimized audited builds produce `0x26f54306`. It is refreshed with a three-repeat run of the integrated production build.

Final integrated validation passes **9/9 focused suites**, including the refreshed three-scenario checksum suite. Production WASM provenance is current. The integrated mixed benchmark passes against the frozen optimized result with the same fingerprint. Its three-repeat median/p95 are 66.20/79.74 ms; these later timings are not substituted into the isolated before/after table. The final streaming baseline records 2.00 ms median / 13.75 ms p95 on the changed terrain.

Relevant reproduction commands, after rebuilding production WASM:

```sh
node scripts/run-tests.mjs --only component-erase,neutronium-force,rigid-world-raster,rigid-world-raster-island,rigid-large-body,rigid-fluid-accuracy,explosives,grounding,pure-perf
node scripts/bench-sand.mjs --repeat 3 --compare bench/baseline.json
node scripts/bench-tnt.mjs
node scripts/scenario-runner.mjs --scenario aftermath --repeat 3
node scripts/bench-rigid-brutal.mjs --repeat 3 --compare bench/rigid-brutal-baseline.json
```
