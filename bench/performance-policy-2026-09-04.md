# Neutronium and explosion aftermath performance changes

This round permits deterministic trajectory/checksum changes, as authorized by the user. It follows the conservative optimizations in `8df65cc` and the [performance audit](performance-audit-2026-09-04.md).

## Production results

Measurements use Apple M1 Pro, macOS arm64, Node 20.19.5, Emscripten 6.0.0, and three repetitions per workload. Builds, tests, and timed benchmarks ran sequentially. Times are simulation milliseconds per world step; they exclude browser presentation.

| Workload / metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Repeated TNT cuts and aftermath, median | 63.42 | 59.94 | 5% |
| Repeated TNT cuts and aftermath, p95 | 353.58 | 261.08 | 26% |
| Repeated TNT cuts and aftermath, p99 | 448.07 | 305.75 | 32% |
| Mixed neutronium, water, and debris, median | 63.37 | 51.15 | 19% |
| Mixed neutronium, water, and debris, p95 | 78.26 | 64.52 | 18% |
| Mixed neutronium, water, and debris, p99 | 84.94 | 67.78 | 20% |
| Main streaming benchmark, median | 1.87 | 1.53 | 18% |
| Main streaming benchmark, p95 | 13.55 | 12.47 | 8% |

Aftermath values are medians of three per-run quantiles over the 92-step fixture. Mixed values cover 900 active samples. Mixed mean pressure-solve time fell from 6.68 to 3.89 ms, mean pressure iterations from 41.82 to 30.90, and mean force-wake time from 4.26 to 2.31 ms. These phase timings overlap other reported totals and must not be added to them.

The ten standard TNT fixtures retain their hashes. Their timing changes are smaller and mixed: full-tail medians range from 0.14 ms slower for a single open TNT cell to 5.09 ms faster for the 19,577-cell cave. The 1,225-cell stone-bed fixture is 0.89 ms slower (13.43 to 14.31 ms). The large repeated-cut aftermath fixture is a distinct, more demanding workload.

## Implementation

- Raster assignment validation caches sparse 64-cell occupancy words when a scene contains a footprint of at least 4,096 cells. Packed claims preserve the first owner, per-pair alias allowance, terrain checks, and joint-member behavior. Small scenes retain the cell scan. Invariant builds compare both validity and the violating-body set against the reference scan on every validation.
- Rollback checks the accepted endpoint first and bisects a valid bracket. Forward sampling remains the fallback when that endpoint is invalid. Search budgets remain bounded at their existing limits. Choosing a different bracket can change subsequent motion.
- Neutronium-only loose-force samples are shared between layers and target kinds; gas uses the opposite attraction vector. Ordinary/mixed emitters retain their separate sampling paths. Neutronium source selection is unchanged.
- Fluid pressure warm starts are stored per unit time and scaled to the current substep. Zero-time velocity correctors leave that cache intact. Ordinary domains may stop at a bounded relative/absolute residual; ice and zero-time correctors retain the strict tolerance. Converged iterations avoid an unnecessary preconditioner pass.
- The mixed and aftermath benchmark harnesses reject non-finite body position, angle, and velocity. These checks run outside the measured step interval.

## Verification and reproducibility

The integrated production build passed all 16 selected suites: neutronium force, rigid displacement, inertia, fluid accuracy, world raster, raster islands, large bodies, blast settling, explosives, rotation, window edges, shock, stamp rejection, grounding, component erase, and deterministic performance checksums.

Both committed performance baselines were refreshed from the integrated production build. Its three-run mixed comparison matched the measured fingerprint and contact/constraint counts, with 50.82 ms median and 63.62 ms p95 step times.

The final invariant build passed nine focused suites: neutronium force, rigid displacement, inertia, fluid accuracy, world raster, raster islands, large bodies, blast settling, and explosives. The full aftermath fixture also passed under invariant checks, including packed/reference validator agreement. Three production aftermath runs produced identical per-tick grid hashes and body states, ending with 108 bodies. All mixed runs remained finite, with the same initial and peak body counts as the baseline.

The new mixed fingerprint is `0x871653e4` (previously `0x26f54306`). Deterministic checksum expectations are now `0xb1117be5` for pan/stream, `0xd38c113e` for active liquids, and `0xf21737d6` for active components. Each repeated consistently before updating expectations. Invalid experimental runs are excluded from all reported timings.

The paired measurements used frozen trees at `/private/tmp/sand-policy-baseline` and `/private/tmp/sand-policy-optimized`. Both started from `8df65cc` plus the same then-current frontier work, isolating this change from subsequent concurrent frontier edits. Baseline production WASM SHA-256: `8ca11706a3eda9b98949665991b1a76aa667c390f96abaa81fda6e6a58707afe`. Optimized production WASM SHA-256: `b4cec28ab03dcf5d5a3189fc8b631045c7017c8e304747a258e4991241626c87`. Raw results and validation logs are in `.sand-artifacts/performance-policy/`; that directory is ignored by Git. The committed WASM is rebuilt from the integrated workspace, including concurrent frontier changes.

These are meaningful reductions, but the severe scenes still exceed the 16.67 ms budget for 60 Hz simulation. Structural reconstruction, grounding, remaining raster recovery, and wet-body solving still merit further work. This round does not establish new acid/fire performance numbers.
