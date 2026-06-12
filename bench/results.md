# Sand engine optimization results — 2026-06-12

Benchmark: `node scripts/bench-sand.mjs` (deterministic, seeded mulberry32, two-run
JIT warmup, simulated 16ms clock). Baseline = `bench/baseline.json`, recorded on the
extracted-but-unoptimized engine (verbatim port of the original About.jsx code).
Final = `bench/final.json`. Hardware: dev machine, Node v24.

## Step time, baseline → final (avg ms/step, seeded rng)

| Scenario        | 240×120            | 384×216            |
|-----------------|--------------------|--------------------|
| settle          | 0.505 → 0.359 (−29%) | 1.005 → 0.693 (−31%) |
| water-heavy     | 1.064 → 0.835 (−22%) | 1.738 → 1.207 (−31%) |
| sand-water      | 0.984 → 0.851 (−14%) | 4.750 → 2.202 (−54%) |
| oil-fire-steam  | 1.007 → 0.718 (−29%) | 4.525 → 1.885 (−58%) |
| dense-chaos     | 1.308 → 0.816 (−38%) | 7.289 → 2.519 (−65%) |
| plant-growth    | 0.674 → 0.453 (−33%) | 3.311 → 0.981 (−70%) |

p95 improved by similar margins (dense-chaos 384×216: 11.26ms → 4.09ms, −64%).
With `--rng math` (what the browser actually uses — measured faster than mulberry32),
the worst case is dense-chaos 384×216 at ~2.5ms avg / ~4.0ms p95.

The deployed sim is additionally capped at 60,000 cells (cell size grows past 5px
on very large viewports), so the production worst case sits below the 384×216
bench size.

## What changed

1. **Dirty-marking redesign** (engine.js): per-cell writes now record two-compare
   per-row min/max spans; padding (±12 x / ±2 y) and render-chunk flags are derived
   once per step instead of on every write. Replaced the per-chunk bounding-rect
   machinery. (rng-stream-changing; material counts validated within a few %.)
2. **Allocation removal**: inlined `XY()` array destructuring everywhere
   (`y = (k / cols) | 0`), Set instead of `Array.includes` in plant water search.
   (pure refactor; checksums matched exactly.)
3. **Stationary-cell fast paths** in settleSand/settleWater/settleOil: cells fully
   embedded in their own material (or water on solid support, oil floating on
   water) skip rand() calls, flow scans, and the touchesGridEmpty check.
   (rng-stream-changing.)
4. **sealWaterPockets removed**: its pull-down rule is subsumed by
   relaxLiquidGaps' above-pull condition (`below === above`); saves 2 full passes
   every other tick.
5. **Render**: color-LUT pixel fill (renderCore.js, ~perf-neutral vs the JIT'd
   switch but headlessly benchable, `fill` column); gutter erase now one
   destination-out pattern fill instead of ~cols+rows clearRect calls per full
   render; cell-count cap for large viewports.
6. **PRNG**: kept `Math.random` as browser default — measured ~30% faster than
   mulberry32 at dense-chaos scale; mulberry32 is used only for deterministic
   benchmarks.

## Browser verification protocol (60fps @ 4x CPU throttle target)

1. `npm run dev`, open the About section in Chrome.
2. DevTools → Performance → CPU: 4x slowdown.
3. Exercise: initial settle; 10s water pour (draw mode); oil + fire ignition;
   dense paint stress.
4. Pass: no frames > 16.7ms in the trace; `window.__sandPerf()` (dev only) shows
   avgFrameMs ≤ 4ms and p95FrameMs ≤ 6ms under throttle.
