# Sand engine

A falling-sand / cellular-automaton simulation that runs on the About section of
the site. The simulation, rendering (material->RGBA + dirty rects), tool/pointer
semantics, and world streaming all run in C++ compiled to WebAssembly. JavaScript
is the browser shell: canvases, the RAF loop, the camera/present transform, input
forwarding, and the final canvas upload/blit. The UI is React.

  `cpp/engine/tools.inc`     brush/draft/seed primitives + the tool state machine
  `cpp/engine/render.inc`    material -> RGBA pixel generation (grain + animation)
  `cpp/engine/materials.generated.hpp`  ids/kinds/tables, generated from the schema

## Files

- `cpp/` — the C++ engine. `sand.cpp` pulls in one `.inc` file per subsystem
  (`engine/core.inc`, `components.inc`, `reactions.inc`, `growth.inc`,
  `rigid.inc`, `worldgen.inc`, `tools.inc`, …) plus `common.hpp` for the shared
  types and material tables.
- `wasm/` — `build.sh` compiles `cpp/` to `sandEngine.js` (a single self-contained
  ES module with the wasm embedded). The output is committed, so a normal
  `npm run build` never needs the C++ toolchain.
- `engineWasm.js` — loads the wasm module and exposes `createEngineWasm()`, the
  simulation handle. Call `initSandWasm()` once and wait for it before creating an
  engine. The grid lives in wasm memory and is read back as a zero-copy view.
- `materials.schema.json` — the single source of truth for material identity
  (ids, kinds, density, mobility, colors, render params). Run `npm run generate`
  to regenerate `materials.generated.js` and `cpp/engine/materials.generated.hpp`.
- `materials.js` — re-exports the generated registry and derives `MAT.<NAME>`.
- `camera.js` — the view over the world buffer.
- `game/createSandGame.js` — the browser shell: it owns the canvases, the RAF
  loop, the camera/present transform, and the engine handle. It translates
  browser pointer events to cell coords and forwards them; the engine owns tool
  policy, dirty rects, material->RGBA generation, and the world-shift decision.
  JS uploads the wasm pixel buffer and blits. No React.
- `react/SandGame.jsx` + `react/ToolPalette.jsx` — a thin React wrapper that mounts
  the runtime and draws the toolbar. `src/About.jsx` just renders `<SandGame>`.

## Building the C++

You only need this if you change anything under `cpp/`:

```
source wasm/emenv.sh   # puts emcc on PATH (Emscripten SDK under ~/Nick/emsdk)
wasm/build.sh          # regenerates src/sand/wasm/sandEngine.js
```

## Testing

```
node scripts/sand-test.mjs
```

Runs the engine headlessly and checks conservation, rigid components, reactions,
growth, free rigid bodies, and that edits survive a world shift.

## Adding a material

Add the id, color, density, kind, etc. as an entry in `materials.schema.json`,
then run `npm run generate` (regenerates the JS + C++ tables) and rebuild the
wasm. If it moves in a way no existing kind covers, or reacts with other
materials, add that to the relevant `.inc` file.
