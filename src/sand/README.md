# Sand engine

A falling-sand / cellular-automaton simulation that runs on the About section of
the site. The simulation is written in C++ and compiled to WebAssembly; the
rendering, input, and UI stay in JavaScript.

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
- `materials.js` — material ids, colors, and grain. The ids here must match the
  ones in `cpp/engine/common.hpp`.
- `renderCore.js` — fills pixels from the grid (colors + grain + fire/steam/lava
  shimmer).
- `camera.js` — the view over the world buffer.
- `game/createSandGame.js` — the runtime: it owns the canvases, the render loop,
  input, world streaming, and the engine. No React.
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

Add the id, color, density, kind, etc. in `materials.js` and the matching entry
in `cpp/engine/common.hpp` (keep the numeric ids in sync), then rebuild the wasm.
If it moves in a way no existing kind covers, or reacts with other materials, add
that to the relevant `.inc` file.
