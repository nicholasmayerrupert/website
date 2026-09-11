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

### Cold startup

Build with `npm run build`, then run:

```sh
npm run bench:startup -- --json .sand-artifacts/startup.json
npm run bench:startup:compare
node scripts/bench-startup.mjs --site dist --compare .sand-artifacts/startup-before.json --target 25
```

The benchmark uses a fresh Chromium process and cache for each sample, three
fixed seeds (swamp, tundra/Watchwood boundary, plains), and two repetitions per
seed/profile. Desktop is 1440×900 at 20 Mbps with 40 ms added request latency;
mobile is a 390×844 touch viewport at 5 Mbps with 80 ms latency. One HTTP download
budget covers both page and worker traffic. Assets use fixed Brotli quality 6
in this laboratory server, independently of deployment compression. Mobile is
a viewport/network profile on the current host, not a phone CPU measurement.
No CPU throttle is applied. `--angle metal` may select hardware graphics on
macOS; compare only matching host/browser/renderer and profile settings.

Primary metrics are time from navigation to the first biome-correct backdrop
draw and first rendered authority snapshot. These are completed draw submissions,
not GPU/compositor presentation timestamps. The browser yields before shader
setup so the backdrop can paint. The report includes median/worst samples,
main-thread long-task blocking before terrain, compressed response-body bytes
requested by that milestone, and raw milestone/network diagnostics. The paint
input check holds for 250 ms and verifies both pointer edges reach the worker;
its elapsed time is diagnostic, not an input-latency benchmark. Comparison
requires identical initial world-packet hashes, camera positions, and biome
weights. A default compare rejects median startup regressions above 10%;
`--target 25` requires at least 25% faster backdrop and terrain in every profile.
Use `--only desktop` or `--repeat 3` with a matching reference for focused runs.
The committed reference is `bench/startup-baseline.json`; timing comparisons are
meaningful only on the recorded environment.

After `npm run build && npm run build:embed`, the `compiled-startup` suite checks
binary equality with the authoring compiler, creative/survival startup,
on-demand replay, corrupt-download retry, teardown before WebGL initialization,
and the standalone embed. Select related suites in one runner invocation.

### Runtime profiling

`node scripts/bench-projectile-render.mjs --json FILE` isolates main-thread
projectile presentation on unchanged terrain: idle, arrows, glowing rounds,
offscreen rounds, separated lights, and a 12-round volley. It reports render
and lighting percentiles and uploaded texels, checks against full-light pixels,
and asserts unchanged terrain. Use `--compare FILE` on the same browser/host;
these are submission timings, not GPU completion or overall FPS.

`node scripts/bench-first-actions.mjs --json FILE` opens fresh survival sessions
for sword, Ember, and Prism, then compares first/repeated attacks and confirmed
stationary enemy hits with audio enabled and disabled. It records frame gaps, long tasks,
render/worker timings, and the actual graphics renderer. Use `--only prism`,
`--audio on` or `--audio off` to narrow the run. On macOS, `--angle metal`
selects hardware graphics; default headless Chromium may use SwiftShader and
spend most of each frame waiting for software rendering. Compare identical
renderer configurations and inspect individual first-use gaps, not only p95.
`--warm-input` clicks a temporary button outside the game before each sequence to
separate first browser/audio activation from first use of a weapon or hit effect.
`--trace PREFIX` writes a Chrome timeline per session for native frame delays;
use untraced runs for timing comparisons.

`node scripts/bench-checkpoint.mjs --json FILE` compares synchronous checkpoint
writing with cooperative autosaves at three loaded-world widths. It reports
atomic capture time, total completion time, event-loop gaps and yields, and
requires byte-identical checkpoints. Repeat zero includes cold allocation;
later repetitions reuse the output buffer.

`node scripts/bench-adventure-actors.mjs --json FILE` measures quiet creative terrain, idle and walking exploration,
enemy charges, shockwaves, spell volleys, and overlapping Prism Choir, Hollow
Star, and Faultline casts in a generated two-layer world. It steps actors and
the world together at the worker's 1:1 cadence. `--only creative,idle,crossfire
--ticks 1800` compares settled terrain with 30 seconds of mixed enemy attacks
and their structural aftermath. Reports include combined turn timings,
over-budget turns, sleeping-world turns, and the eight worst active turns with
phase timings and work counts. Phase timers can overlap; do not sum them.
After rebuilding, use `--compare FILE` on the same host/runtime to check
terrain, actor, projectile, item, and discovery checksums and report actor/world
timing deltas. Use `--only idle,charges`, `--repeat 5`, or `--profile PREFIX` to
narrow or sample the workload. Fixture construction is outside the timings.
For named WASM profiles, build with `npm run build:sand -- --profile` and run
with `SAND_WASM_LOADER=.sand-artifacts/profile/sandEngine.js node --import
./scripts/sand-wasm-loader.mjs scripts/bench-adventure-actors.mjs --profile
.sand-artifacts/adventure`. These engine timings do not measure browser FPS.

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
