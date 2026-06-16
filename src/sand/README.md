# Sand engine (`src/sand`)

A DOM-free falling-sand / cellular-automaton simulation. `createEngine()` in
`engine.js` returns a self-contained world. The interactive game is layered on
top and is itself drop-in / standalone: `game/createSandGame.js` is a
framework-agnostic (no-React) runtime — canvases, render loop, input, world
streaming — and `react/SandGame.jsx` is a thin React wrapper that mounts it and
renders `react/ToolPalette.jsx`. `src/About.jsx` just embeds `<SandGame>`, and
`scripts/bench-sand.mjs` drives the engine headlessly.

## Layout

| File | Responsibility |
|------|----------------|
| `engine.js` | Core: grid + double buffer, dirty-chunk tracking, the per-cell movement passes (sand/liquid/gas/relax/separate), the `step()` pipeline, public API, and module wiring (the shared context `S`). |
| `materials.js` | **Single source of truth for material identity** — one entry per material. Compiles to the flat typed-array tables (`DENSITY`, `KIND`, color LUT, …) the hot loops read. |
| `components.js` | Grid-aligned rigid components (stone/wood-plant/ice): support solver (`computeGrounded`), cohesive movement + buoyancy, register/split bookkeeping. |
| `rigidBodies.js` | Continuous free rigid bodies (float pose + rotation), rasterized into the grid each tick. Solver lives in `rigid2d.js`. |
| `reactions.js` | Per-tick material transforms: fire/water→steam, acid, lava, ice. |
| `growth.js` | Plant growth (trunk/branch/leaf). |
| `tools.js` | Interactive surface: brushes, stone/ice drafts, seed placement, emitters, scene init. |
| `renderCore.js` | DOM-free pixel fill; pulls colors/grain from `materials.js`. |

The hot per-cell movement and `step()` stay in `engine.js` for speed; everything
else is a `createX(S)` factory closed over the shared context `S`. Hot functions
read `S.grid` once per call into a local, so the inner loops use real locals.

## C++ / WebAssembly engine

`cpp/sand.cpp` is a C++ port of the simulation (CA, components, reactions,
growth, tools, streaming worldgen) compiled to `wasm/sandEngine.js` (single-file
ES module) via `wasm/build.sh` (needs emsdk: `source wasm/emenv.sh`). The
generated file is committed so `npm run build` never needs emcc. `engineWasm.js`
exposes `createEngineWasm()` with the same shape as `createEngine()` (grid is a
zero-copy `HEAPU8` view); `initSandWasm()` must resolve once first.

The WASM engine is now the **default** (the React wrapper awaits init then injects
`createEngineWasm` into `createSandGame`); opt back into the legacy JS engine with
`?engine=js`. Parity is behavioral, not bit-identical — verify with
`node scripts/wasm-parity.mjs` (CA / components / reactions / growth) and
`node scripts/wasm-rigid.mjs` (free rigid bodies), and
`node scripts/wasm-worksave.mjs` (edited bands persist across world shifts). The
full engine is ported — CA, components, reactions, growth, tools, free rigid
bodies (rigid2d), streaming worldgen (byte-identical to JS), and chunk-store
persistence of edits (materials + bodies) across world shifts. The only JS-only
piece left is the hand-authored fixed scenes (castle/noita), which the app does
not use — it always runs in infinite mode.

## Adding a material

1. **Add one entry to `MATERIALS` in `materials.js`** with a unique `id`
   (ids are stable — never renumber existing ones) and its `kind`, `density`,
   `looseSorted`, `mobility`, `color`, `textureAmp`, `renderAnim`. That single
   entry gives it its id (`MAT.NAME`), density/buoyancy, color, grain, mobility,
   and the correct motion pass — no other file needs editing for a normal
   powder, liquid, or gas. (See the GOO smoke test in git history for proof.)

2. **Only if it needs a brand-new *kind* of motion** (something no existing
   `KIND` covers) add a case to the dispatch in `engine.js` `step()`.

3. **Only if it reacts with other materials** add the rule to `reactions.js`.
   Reactions are intentionally explicit code (priority cascades, component
   splits, multi-hop spread don't fit a uniform data table).

## Verifying changes

```
node scripts/bench-sand.mjs --json bench/<name>.json   # snapshot
node scripts/bench-sand.mjs --compare bench/<name>.json # regress-check
node scripts/test-rigid-depenetration.mjs               # rigid-body validator
```

Pure refactors must keep the per-scenario `hash` identical. Behavior changes
should keep final material counts within a few % and pass a visual check
(run the app via `npm run dev`).
