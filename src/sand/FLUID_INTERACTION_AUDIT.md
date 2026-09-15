# 2D rigid/fluid and fluid/powder audit

Audited base: `32bb946`, branch `codex/rigid-fluid-audit`, isolated worktree `E:/00HOMEWORK/website-fluid-audit`. The findings below describe that baseline. Implemented changes and validation are recorded in the implementation sections.

## Finding: lava/powder exchanges have different rules from liquid/liquid

Lava is configured denser than sand (2.8 versus 1.6), so sinking through sand is permitted by `canDisplaceByLooseDensity` (`cpp/engine/members.inc:1145`). The speed is not governed by the liquid/liquid exchange law:

- Liquid/liquid swaps use density contrast × heavier-liquid mobility × 1.67, capped at 1. Both cells receive a movement stamp; disjoint pair scheduling prevents another exchange that tick (`core.inc:311–342`, `core.inc:490–543`). This is probability per eligible attempt, not per world tick.
- The early powder/liquid interface pass uses only the moving material's mobility, without density contrast (`core.inc:33–58`). Lava therefore gets a 35% attempt each gravity tick; sand gets 100%. The generic powder pass also has unconditional density-displacement paths (`core.inc:101`, `112`).
- Every third world tick, a second powder/liquid pass swaps every eligible pair of a randomly chosen checkerboard parity. It has no mobility/contrast gate and does not reject a cell that already moved (`core.inc:548–582`; schedule `step.inc:194`). A cell can consequently exchange twice in that tick. Merely adding a probability to one helper would leave other exchange paths inconsistent.
- Lava's straight-fall mobility bypass is **not a tunnel through occupied sand**. `liquidColumnPassable` accepts only empty/gas, and multicell fall stops at the first nonempty cell (`members.inc:1240`, `core.inc:156–175`, `267–290`). If powder falls away first, the vacancy is ordinary free volume and lava can follow into it.
- Background transfer is an additional route: a stuck dense loose cell can exchange into lighter material in the other layer if it can continue falling there. This route has no exchange probability (`step.inc:467–489`). The diagnostic below disables it to isolate the within-layer behavior.

Lava also melts snow, burns flammables, and reacts with water/acid/brine (`reactions_impl.inc:744–770`). Those cases must be distinguished from density exchange; inert sand and stone dust isolate movement cleanly.

### Reproduction

Run `node scripts/fluid-loose-audit.mjs` from this worktree. It uses the committed WASM, 24 fixed world seeds × 60 world ticks, a sealed one-cell-wide vertical lane, grounded stone walls, background disabled, and one identifiable moving cell. Output is `.sand-artifacts/fluid-loose-audit.json`.

| Scenario | Mean downward cells/tick | Two-cell steps | Observation |
| --- | ---: | ---: | --- |
| Lava through sand | 0.4868 | 71 / 1440 | All two-cell steps occur on every-third-tick tail cadence |
| Lava through stone dust | 0.4868 | 71 / 1440 | Identical traces despite different powder identity |
| Sand through water | 1.1569 | 226 / 1440 | Same extra-swap mechanism |
| Brine through water | 0.0153 | 0 / 1440 | Different density contrast; illustrative, not a matched viscosity comparison |
| Lava through empty space | 2.9 before floor approach | — | Clear fall accelerates 1, 2, 3 cells/tick, then stays at 3 |

The tracked mover remains exactly one cell in every run. These observations establish unexpectedly fast repeated exchanges, not arbitrary-distance tunneling. No replay of the user's exact scene was supplied.

**First change to make:** Give powder/liquid contacts one owner and one per-tick exchange budget, then use a shared density/viscosity rate across all paths that perform that exchange. Reuse the existing `swapSettledCells` mutation primitive, and extract common eligibility, probability and movement-stamp handling around it. Powder/liquid rates must use the participating liquid's mobility even when the denser mover is powder; using sand's mobility alone would miss drag from the liquid. Preserve explicit powder/powder exclusion and force direction. Keep empty-space falling separate. Test the two-cell case first, along with near-equal density, reversed stable ordering, material conservation, and both foreground-only and cross-layer scenes. This is local per-contact work and should be inexpensive; exact cost and gameplay tuning require measurement after implementation.

**Physical limitation:** A packed powder bed has support/friction and pores; sorting occupied cells by density does not model those. A slower swap rate improves the visual symptom but cannot produce realistic seepage or fluidization. A bounded local packing/resistance factor is a possible next approximation, while actual saturation/porosity needs additional state. Porous-flow coupling is an established way to represent this distinction ([Lenaerts & Dutre, 2009](https://graphics.cs.kuleuven.be/publications/MixingFluidsAndGranularMaterials/)). Do not change densities merely to hide the rate mismatch.

## Rigid/fluid: current strengths and limits

The implementation already has a coupled pressure solver, not just an upward buoyancy force. Wet boundary cells seed a local domain, face velocities include rigid translation and angular velocity, the matrix includes body inverse mass/inertia, and pressure feeds impulses back to bodies (`rigid_fluid_domain.inc`, `rigid_fluid_projection.inc:299–388`, `rigid_fluid_solve.inc:89–136`, `300–319`). It uses cached pressure, an incomplete-factorization preconditioner, bounded PCG iterations, wet-face tangential drag, conservative internal momentum diffusion, selective post-motion correction, and body material displacement.

Actual domain radii are **4 normally, 3/2 for larger wet-body batches, 8 for ice, and up to 24 for mixed liquids** (`common.hpp:744–755`, `rigid_fluid_projection.inc:137–212`). `README.md:680–688` describes an older fixed-eight/full-mixed-pool scheme; `PERF.md:201–216` is closer to the current implementation.

Important approximation boundaries:

1. **Body geometry is binary raster occupancy.** Every wet face is an axis-aligned full cell face; sub-cell translations/rotation change pressure geometry discretely. This can make draft and torque depend on raster phase.
2. **Projection does not drive cellular transport.** The projected velocity is stored in `liquidVel`, but ordinary `core.inc` movement uses integer fall speed, occupancy, mobility and swaps; it never reads that velocity. Pressure/wet-face coupling therefore is not a complete incompressible fluid integrator. Diffusion and boundary damping also occur after projection. Exact final divergence or global momentum conservation should not be inferred from the pressure solve alone.
3. **Finite reservoir approximation.** Cutoff pressures come from nearby open columns without connectivity proof (`rigid_fluid_projection.inc:24–129`). Separate nearby pools or narrow channels merit tests. Domain viscosity reads outside velocity but updates only the local node (`rigid_fluid_writeback.inc:45–56`), treating the exterior as a reservoir rather than conserving momentum across that boundary. Ordinary negative pressures are clamped after a single solve; only ice gets another active-set pass (`rigid_fluid_solve.inc:138–141`, `288–299`). These are accuracy tradeoffs, not newly demonstrated failures.

### Ranked accuracy work, retaining bounded cost

| Priority | Proposal | Benefit and cost |
| --- | --- | --- |
| 1 | Add residual/divergence and boundary-slip diagnostics; adapt domain/corrector effort to the measured error of each connected wet region | Target extra work at difficult interfaces rather than enlarging all pools. Use existing node/face/timing counters. Compare 1/16/24-body cases so batch thresholds do not silently change flotation. Keep a hard work budget. |
| 2 | Use fractional **face lengths** and consistent moment arms from body geometry at wet boundaries | Smoother sub-cell buoyancy and torque without refining the whole world. Cache geometry-dependent weights and update only changed boundaries. This requires consistent pressure, exclusion and displacement geometry; changing weights alone can create contradictions. |
| 3 | Add conservative velocity-informed local transport, then material viscosity where needed | Makes pressure-induced currents influence actual liquid motion. Start with bounded adjacent swaps/fluxes and reciprocal boundary impulses. Larger than a tuning change: preserve one-cell ownership, mass, streaming/checkpoint state and replay determinism. A full FLIP/SPH/MPM replacement is not the first step. |

The coupled pressure structure aligns with the variational approach of [Batty, Bertails & Bridson (2007)](https://www.cs.ubc.ca/labs/imager/tr/2007/Batty_VariationalFluids/). Their [2D reference implementation](https://github.com/christopherbatty/FluidRigidCoupling2D) specifically uses face-length weights for improved boundary accuracy. These sources support improving boundary geometry while retaining a Cartesian grid; performance gains in this engine remain an engineering hypothesis.

For convincing highly viscous lava, mobility is only a movement gate. [Batty & Bridson (2008)](https://uwspace.uwaterloo.ca/items/8e918fe0-bd66-4524-b448-e559e4cd67d4) treats viscosity and free-surface stresses with an implicit solve, including buckling/coiling. That is a later, costlier option if those effects are desired. [Bridson's course notes](https://www.cs.ubc.ca/~rbridson/fluidsimulation/) provide pressure-solver and advection references; the engine already implements PCG, so adding PCG is not a new recommendation.

## Validation and performance evidence

- Existing `rigid-fluid-accuracy` and `liquid-mass` suites passed together through the test runner. They establish current flotation/interface/corrector and mass behavior, but do not assert lava/powder exchange rate or one-exchange-per-tick ownership. Logs: `.sand-artifacts/tests/2026-09-15T00-16-36.218Z-25952/`.
- `node scripts/bench-rigid-fluid.mjs`: 480×300, 12 wood bodies, 120 steps. Body phase p50/p95 **0.529/1.262 ms**, full step **0.925/1.962 ms**, checksum `0xbe0c5055`. This is a single Node/WASM run on this host, not browser FPS or a performance guarantee; the body phase includes work beyond pressure coupling.
- Future rigid changes should compare draft/torque versus fractional body position, closed-container volume and momentum, layered liquid equilibrium, thin gaps, fast entry, and large batches. Run the relevant before/after benchmarks, and update intentional stale baselines only with an implemented change.


## Implemented rigid/fluid performance changes

The retained performance work is a behavior-preserving refactor in two engine files:

- `cpp/engine/rigid_fluid_solve.inc`: the fluid stencil has at most two lower neighbours (west/up) and no triangles. Its incomplete-Cholesky common-neighbour correction is therefore identically zero. Remove that search and unroll the two-neighbour forward/backward substitutions, retaining the original subtraction order and pinned-node behavior.
- `cpp/engine/rigid_fluid_projection.inc`: store the hydrostatic reference-pressure scratch array by column (`x * rows + y`). Column integration now writes contiguous memory; all reference reads use the same layout. The material/body grids, pressure values, and equations are unchanged.

### Controlled measurements

To isolate performance from the concurrently implemented density-exchange fix, archive the original C++ sources at `32bb946` and overlay **only** those two files. Compile that copy using the same production Emscripten flags. Compare it with the preserved original production WASM, not the combined new behavior.

Six paired runs alternated baseline/optimized launch order. Each run used 160 ticks in four 480×300 scenes: 12 wood bodies, 24 wood bodies, one large wood body, and a growing ice body. Timing below is the paired p50 change in accumulated phase time; reductions are improvements.

| Scenario | Rigid/fluid coupling time | Full engine step time |
| --- | ---: | ---: |
| 12 wood bodies | −14.1% | −7.7% |
| 24 wood bodies | −15.9% | −7.1% |
| Large wood body | −6.6% | −3.7% |
| Ice | −5.0% | −2.8% |

The reference-pressure phase improved by 28–50%; the pressure solve improved by 5–8%. Every paired run had **identical per-tick grid checksums, body positions/velocities, solver work counts, and final complete checkpoint SHA-256**. Thus the speedup does not come from changing physics, tolerances, iteration counts, or simulation work. These are local Node/WASM measurements; host load varied, and they are not browser FPS guarantees.

The general engine benchmark also retained the original terrain checksum, **`0xa30dc201`**, with the isolated performance variant. Its `--compare` provenance gate uses the combined working-tree production build, so the isolated run was checksum-only; the coordinator runs the final production comparison for the combined change.

### Reproduction artifacts

The temporary fixtures and build copies are under `.sand-artifacts/`:

- `rigid-fluid-before/sandEngine.{js,wasm}`: original committed production artifact.
- `rigid-perf-source/src/sand/cpp/`: original C++ sources plus the two performance changes.
- `build-rigid-perf.mjs`: compiles that isolated source using production flags into `rigid-fluid-perf-only/`.
- `rigid-fluid-perf-audit.mjs`: four-scene profiling and exact-state capture.
- `rigid-fluid-ab.mjs`: alternating paired comparison with exact-state assertions.
- `rigid-fluid-ab-final/summary.json`: aggregate metrics and per-pair ratios; neighbouring JSON files contain individual runs.
- `rigid-fluid-perf-only/engine-benchmark.txt`: isolated checksum-only benchmark output. Its metadata reports the normal production path; the loader override selects the isolated binary.

Run from the isolated worktree in PowerShell:

```powershell
$env:AUDIT_AB_OUTPUT = '.sand-artifacts/rigid-fluid-ab-recheck'
node .sand-artifacts/rigid-fluid-ab.mjs
```

To profile only the optimized artifact:

```powershell
$env:SAND_WASM_LOADER = '.sand-artifacts/rigid-fluid-perf-only/sandEngine.js'
$env:AUDIT_OUTPUT = '.sand-artifacts/rigid-fluid-perf-only/recheck.json'
node --import ./scripts/sand-wasm-loader.mjs .sand-artifacts/rigid-fluid-perf-audit.mjs
```

The corresponding baseline loader is `.sand-artifacts/rigid-fluid-before/sandEngine.js`. The paired driver supplies these loader choices automatically. Benchmark baselines are not changed for the pure performance refactor; any update accompanying the combined density fix belongs to that intentional behavior change.

## Implemented powder/liquid exchange policy

All occupied loose-density exchanges share `allowLooseDensityExchange`: strict density eligibility, density-contrast probability, participating-liquid mobility, and source/destination movement guards. Powder/powder contacts remain supportive. The early interface pass owns ordinary powder/liquid settling; the extra third-tick swap pass and ordinary liquid/powder displacement bypasses are removed. Surface, force-directed, and cross-layer exchanges use the same policy. Rejected interface attempts leave ordinary empty-space falling available; gap-filling moves carry the occupied material's exchange lock. Empty-space fall acceleration remains separate. The third-tick phase still consumes its scheduled RNG sample so unrelated liquid-only scenes keep their deterministic sequence.

Regression coverage in `liquid-mass-test.mjs` includes lava/sand and near-equal lava/stone-dust rates, maximum one-cell exchanges, both-material conservation, stable sand-over-lava ordering, sand sinking through water, probabilistic cross-layer exchange, a clear fall beside a rejected density contact, and water/snow/oil gap-filling without a second exchange. The existing anti-geyser test counts water that reaches the floor below the original pool rectangle. Force tests allow time for viscosity-limited sorting while retaining conservation, final seam limits, and bounded settling.

### Final combined validation

- Production WASM rebuilt; generated-source and WASM provenance checks pass.
- Final combined runner: 8/9 suites pass (`mat-behavior`, `liquid-mass`, `gas-bubble`, `ice-body-growth`, `neutronium-force`, `rigid-displacement`, `rigid-fluid-accuracy`, `rigid-layer-solver`). The `layer` suite has only the same four vegetation-fixture failures reproduced with the unchanged baseline. Its bonded-ice, transfer, and other checks pass. Final logs: `.sand-artifacts/tests/2026-09-15T00-46-36.390Z-48700/`.
- The separately checked `planet-gravity` suite also fails on the unchanged baseline with identical terrain checksums and Kestrel fixture errors; these unrelated failures were not changed. Baseline evidence: `.sand-artifacts/fluid-base/.sand-artifacts/tests/2026-09-15T00-33-23.393Z-43020/` and the layer comparison at `2026-09-15T00-41-17.681Z-61168/`.
- Re-running the original 24-seed, 60-tick diagnostic gives lava/sand **0.16875 cells/tick**, lava/stone-dust **0.02431**, and sand/water **0.35764**, with no two-cell exchanges or tracked cell loss. Clear-air lava remains **2.9** before floor approach, and brine/water remains **0.01528**. Before/after artifacts: `.sand-artifacts/fluid-loose-before.json` and `.sand-artifacts/fluid-loose-audit.json`.
- The gap-lock regression exercised 72 initial water/snow exchanges and observed zero subsequent water/oil exchanges in the same tick. The clear-fall regression and both-material conservation checks pass.
- General engine checksum intentionally changes from `0xa30dc201` to `0x30d35298` with the density policy. `bench/baseline.json` was regenerated with two stable repeats. The isolated rigid-only refactor retains the original checksum.
- Panning passes both the same-host pre-change comparison and the committed baseline gate: horizontal instability **0.093/255**, vertical **0**, cursor mapping error **0 cells**. The committed pan baseline remains valid. Browser timing varies with host load; use the controlled rigid benchmark above for performance claims.

### Integration validation

The changes are integrated into `master` alongside the neutronium surface-leveling and powder-slumping work. The combined production WASM passes `liquid-mass`, `neutronium-force`, `rigid-fluid-accuracy`, and `rigid-displacement`. The broad mixed-pile fixture sleeps at tick 3007 after its last transient fire expires; its total settling limit is 3200 ticks, with shape and conservation assertions retained.

The integrated engine retains checksum `0x30d35298`. Panning reports zero horizontal/vertical instability and passes its regression gate. The final engine comparison passes step and world-shift timing thresholds but flags render p99 (4.488 ms versus 3.483 ms); render mean is 2.879 ms versus 2.743 ms. This unresolved whole-engine timing result is separate from the controlled, identical-state rigid-coupling measurements above.
