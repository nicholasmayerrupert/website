# Agent Instructions

## What this repo is

Nicholas Mayer-Rupert's personal website. React + Vite + Tailwind, deployed to
Cloudflare via Wrangler (`npm run dev`, `npm run build`, `npm run deploy`).

Its centerpiece is a **2D falling-sand simulation** rendered to a canvas in the
home-page hero (creative) and at `/game` (survival). Most agent work happens
there. The simulation, **WebGL2 rendering**,
the **view camera**, **input policy**, tool semantics, and world streaming are
written in **C++ and compiled to WebAssembly**; JavaScript is a thin shell (sizes
the canvas, runs the RAF/fixed-step loop, forwards raw DOM events, carries the net
transport). It ships as a framework-free `<sand-game>` Web Component
(`src/sand/embed/`); a tiny React shim mounts it on this site. The engine runs
**two fully-simulated layers** — foreground + a darker background (`struct Layer`
in `cpp/engine/layer.hpp`; `useLayer()` repoints the Engine's active-layer
pointer `L`). `step()` steps `fg` then `bg` under one tick, then a
`transferPass()` moves stuck loose materials and blocked gas between layers. Every simulation
subsystem is a named class under `cpp/engine/`, composed by the Engine, which
keeps the coordinator role and settle core. Right-click in creative paints into
the background.
`src/sand/README.md` is the authoritative map — read it before touching the sim.
Quick orientation:

| Path | What it is |
| --- | --- |
| `src/sand/cpp/` | The C++ engine: eighteen subsystem classes under `engine/`, composed by a coordinator Engine (`sand.cpp`, one unity TU). From the repository root, rebuild on any OS with `npm run build:sand` (emits the committed `src/sand/wasm/sandEngine.{js,wasm}`); `npm run build:sand -- --dev` adds the post-step invariant validator. See `wasm/README.md` for toolchain setup. |
| `src/sand/wasmBridge/engineFactory.js` | Loads the wasm module; `createEngineWasm()` is the simulation/render/camera handle. Grid and render pixels are zero-copy views into wasm memory. |
| `src/sand/materials.schema.json` | Single source of truth for materials; `npm run generate` emits `materials.generated.{js,hpp}` (the build fails if they're stale). `materials.js` re-exports it + derives `MAT`. |
| `src/sand/game/createSandGame.js` | The thin browser shell: creates the canvas, runs the RAF/fixed-step loop, forwards DOM events to the engine, and drives `engine.glRenderFrame()`/`streamWorld()`. The engine owns rendering, the camera, input policy, tool policy, and the world-shift decision. |
| `src/sand/embed/` | The `<sand-game>` Web Component (`sandGame.js`) + vanilla palette (`toolPalette.js`). `npm run build:embed` → one self-contained `dist-embed/sand-game.js`. |
| `scripts/bench-sand.mjs`, `scripts/bench-pan.mjs`, `bench/` | Headless engine benchmark + Playwright pan/flicker benchmark + recorded baselines. |

The world is a **procedural, infinite, two-axis streaming** landscape generated in
`cpp/engine/worldgen.inc`. As the camera nears a buffer edge the loaded window
slides and a fresh band is generated or restored from the chunk store.

## The sand engine (read before touching it)

- One grid of material ids (defined in `materials.schema.json`; see `MAT` in
  `materials.js` and `enum Mat` in the generated `materials.generated.hpp`).
- Loose materials (sand, water, oil, fire, steam) are plain grid cells.
- **Stone-group materials, `ICE`, and plant materials are not loose pixels.**
  They live as connected *components* and survive each step only by their component
  membership. A component cell written to the grid with no membership gets erased
  every step and **flickers**. Use the engine's component-aware paths, then
  `engine.syncComponents()` for runtime edits.

## Benchmarks (run before/after any sim or render change)

- **Engine** (headless, Node): `node scripts/bench-sand.mjs` prints p50/p95/p99 for
  `step`, fine `stepPhases` (grounding/carry/sand/liquid/react/…), step volume
  counters, `shiftWorld` (cache miss/hit + phase breakdown), and `renderFull`,
  plus a deterministic terrain checksum. Compare against a baseline with
  `node scripts/bench-sand.mjs --compare bench/baseline.json` (re-record with
  `--update`; compare also prints phase p50 deltas). **Pure refactors must keep
  the checksum identical.** See `src/sand/PERF.md` for phase ownership.
- After a sim/render behavior or performance change is confirmed and before
  committing, rerun the relevant benchmark compare(s). If the compare reports that
  a committed baseline is stale and the change is intentional, update the
  baseline in the same change (`node scripts/bench-sand.mjs --update
  bench/baseline.json`, and the corresponding pan baseline command when the
  panning/flicker benchmark is affected). Do not leave known-stale benchmark
  baselines for the next agent.
- **Panning / flicker** (headless Chromium, Playwright): `node scripts/bench-pan.mjs`
  starts the dev server, scripts a pan, and reports the sub-cell pan *instability*
  (the bright-block flicker metric — must stay ~0) and frame timing. `--png bench/`
  dumps frames; `DSF=0.75 node …` emulates a zoomed-out browser; `--compare
  bench/pan-baseline.json` checks for regressions.
- The browser RNG is `Math.random` by design — don't "optimize" it to a custom PRNG.

## Coding rules (Karpathy's four)

1. **Think before coding** — surface ambiguity, assumptions, and tradeoffs before
   changing code; don't assume silently.
2. **Simplicity first** — write the minimum code needed; no speculative features,
   abstractions, or configurability.
3. **Surgical changes** — touch only the files and lines needed; match existing
   style; don't refactor unrelated code.
4. **Goal-driven execution** — define success, verify with the smallest relevant
   check (run the app or the benchmark), and keep going until the goal is met.
5. **Current-state comments** — when adding or editing comments, describe only
   what the code currently does. Do not include historical comparisons, prior
   behavior, migration notes, or phrases such as “25% deeper than its original
   boundary.”
