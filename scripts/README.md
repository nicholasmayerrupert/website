# Sand testing and diagnostics

Run commands from the repository root. The manifest in `test-manifest.mjs`
owns suite names, timeouts, and scheduling. Use the runner for tests; common npm
aliases remain available. New suites do not need individual npm aliases.

## Select the work

```sh
node scripts/run-tests.mjs --help
node scripts/run-tests.mjs --group rigid --list
node scripts/run-tests.mjs --only rigid-placement-weld,worker-capture
node scripts/run-tests.mjs --only worker-capture --only replay-capture
node scripts/run-tests.mjs --group harness
```

Selections are combined, deduplicated, and run in manifest order. Generated-source
and WASM provenance checks run once per invocation. Exclusive suites run alone,
including in mixed browser/headless selections. `--jobs` changes concurrency
without overriding exclusivity. `--list` does not run preflight or tests.

Available groups: `rigid`, `replay`, `worker`, `generation`, and `harness`.
The replay group includes its focused browser cases; the worker group includes
the complete worker browser aggregate.

## Read a failure

Each invocation creates `.sand-artifacts/tests/<run>/` with complete per-suite
logs and `summary.json`. The console shows short failure excerpts, artifact
paths, and progress every 30 seconds. Use `--verbose` for live full output or
`--artifacts DIR` to choose an output directory.

The summary records exit status, timeout status, duration, a rerun command, and
common scenario environment parameters. Individual suites receive
`SAND_TEST_ARTIFACTS`, a directory for larger diagnostics. The browser harness
saves screenshots and game state on failure; the rubble suite saves its full
body diagnostics as JSON. A timeout preserves output received before termination.

## Compare with a revision

```sh
node scripts/run-tests.mjs --only worker-capture,replay-capture --compare-ref HEAD
```

The baseline is a temporary clean Git archive using that revision's original
runner, tests, and committed WASM. The current run uses the working tree.
Both reuse the installed `node_modules`; this command does not install older
dependencies. Baseline suites run serially for compatibility with older runners.
Temporary source files are removed afterward; logs and `comparison.json` remain.

Results distinguish passes in both, new failures, passes after a baseline
failure, failures in both, and missing baseline results. A failure in both does
not prove the cause is identical. Current failures still return a failing exit
status. Compare failing assertions and diagnostic artifacts before attributing
a regression. Older revisions must contain the manifest and runner.

## Browser cases

`worker-e2e` runs eight cases with a fresh browser context per case and one shared
Vite server. A failed case does not skip the remaining cases. Run a focused case:

```sh
node scripts/run-tests.mjs --only worker-seek-e2e
node scripts/run-tests.mjs --only worker-recovery-e2e,worker-mobile-e2e
```

The cases live in `worker-browser-cases.mjs`. `browser-harness.mjs` owns Vite
startup, browser/context cleanup, assertions, and failure artifacts. The seek
case explicitly prepares a captured session with world streaming. Replay turns,
actor ticks, and world ticks are separate counters; sleeping terrain may keep
its world tick unchanged while the authority continues running.
Mobile context options are declared beside the cases and use the same cleanup
and artifact handling as desktop contexts.

All Vite-backed browser suites use `startTestServer()` from `browser-harness.mjs`
for loopback port allocation, bounded HTTP readiness checks, startup diagnostics,
and process-tree cleanup. It returns `{ baseURL, close }`; `baseURL` has no
trailing slash. Call `close()` in a `finally` block, including when browser
launch or shutdown fails. Suites retain their own browser/context setup when
they need multiple engines, devices, or a continuous sequence of assertions.
The production startup-recovery suite owns its HTTP server because it serves
deliberately stale HTML and missing deployment assets.

## Stress and profiling

`node scripts/bench-burning-wood.mjs` measures a sustained fire cutting an
81,600-cell wood slab into moving fragments. Add `--surface` for erosion along
its supported top edge. Save the JSON output before changing the engine, then
pass `--compare FILE` with the same scene to check exact material/checksum
parity and report phase timing deltas. Fixture construction and fire injection
are outside the step timings.

```sh
node scripts/scenario-runner.mjs --scenario placement --sizes 80,160,240 --repeat 3
node scripts/scenario-runner.mjs --scenario aftermath --seed 1401181199 --steps 92
npm run build:sand -- --profile
node scripts/scenario-runner.mjs --scenario aftermath --profile --wasm .sand-artifacts/profile/sandEngine.js
node scripts/run-tests.mjs --only rigid-placement-weld --wasm .sand-artifacts/profile/sandEngine.js
```

Scenarios run in a Node worker. A parent watchdog terminates a worker that stops
reporting operations for `--timeout-ms` (default 30000). Failure artifacts retain
the last phase, seed, tick when available, and engine provenance. Results retain
all timing samples and report p50/p95/p99/max for each operation. Timing a
profiled run includes profiling overhead; use production builds for comparisons.

`--profile` on the scenario runner writes Chrome-compatible `.cpuprofile` files.
The separate profiling WASM build retains function names at production
optimization. `--out-dir DIR` selects another build directory. Diagnostic
artifacts never satisfy the production deployment provenance check.

The two `bench-tnt-*.mjs` commands are compatibility entries into this runner.
Scenario definitions live in `tnt-scenarios.mjs`; shared component-aware setup
lives in `sand-fixtures.mjs`. Keep deterministic assertions such as material
retention and reconstruction count alongside timing measurements.

## Remaining simulation issue

`rigid-tnt-rubble` can leave two significant bodies awake after its 900-tick
fixture. The original freeze-fix baseline produces identical non-timing
diagnostics. Its sleep assertion remains enabled; this is separate from the
replay test's corrected assumption about world-tick progress.

`rigid-world-raster-island` writes a `motion.json` report for its selected body,
separating solver bias, position projection, and raster repair travel, including
rotation at the body's perimeter. See [the rigid evaluation record](../src/sand/RIGID_EVALUATION.md)
for measured experiments, rejected patches, and known shipping-mode failures.

## Game authoring workbench

`npm run game:scenario -- --list` lists authored scenes. Use
`npm run game:scenario -- hearth --open` for the live workbench, or
`npm run game:capture -- archive` to save a screenshot and authority-state JSON
under `.sand-artifacts/scenes/`. These commands run the real worker and renderer.
The development route is `/game?studio=hearth`; add `&capture` to hide the tools.

`npm run content:check` validates maps, references, quest dependencies, palettes,
and animation frames without launching a browser or compiling WASM. The
`game-content` suite verifies the packet against real WASM. `game-studio-e2e`
checks local brush/frame edits, undo, pause/step, and scene reset; it does not save
changes to the content files. `campaign-e2e` exercises ordinary player controls.
