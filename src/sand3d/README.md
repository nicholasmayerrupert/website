# The Quarry — `/3d`

A bounded creative demo with a free-flight camera, voxel mining, sand, stone
and timber placement, and Box3D rigid bodies. It is independent of the 2D game.

## Run and build

- `npm run dev`, then open `/3d` (or `/3d/`).
- `npm run build:3d` rebuilds the committed loader and WASM with the repository's
  pinned Emscripten 6.0.0. Box3D source and its MIT license are vendored; the
  exact upstream revision is in `vendor/box3d/UPSTREAM.md`.
- `npm run build` builds both the main site and the separate 3D entry and
  compresses their WASM. Ordinary site builds do not need Emscripten.
- After a production build, run
  `node scripts/run-tests.mjs --only 3d-engine,3d-browser,deployment`.

## Loading boundary

`3d/index.html` loads only `main.js`, its own stylesheet, and its own WASM.
The homepage, `/game`, and case-study entries have no imports, preloads, or
prefetches for this demo. `vite.config.3d.js` runs as a separate build into
`dist` with `emptyOutDir: false`, so Rollup cannot split the portfolio's
existing shared chunks to accommodate the demo. Tailwind excludes this
self-styled directory from the site's class scan.

The initial implementation was checked against the baseline production build:
all 189 existing output files were byte-identical. The production browser test
also checks that the homepage requests no 3D assets and that `/3d` does not
load the 2D engine. The Cloudflare worker maps `/3d` to its dedicated HTML entry.
No new site-wide headers, workers, runtime dependencies, or homepage UI are added.

## Ownership

`cpp/demo.cpp` owns the simulation, camera, input policy, picking, tools, and
Box3D world. `cpp/renderer.hpp` owns the WebGL2 context and GLSL raycaster.
`main.js` owns DOM events, sizing, the bounded fixed-step/RAF loop, and controls.
The initialization screen renders one scene frame. Simulation and animation
start when the visitor enters. Menu, blur, and backgrounding stop the RAF loop;
page exit destroys the world and graphics context. A restored history entry
reloads to recreate disposed resources. Graphics failure provides a reload path.

The engine uses a 64 × 40 × 64 material grid. One voxel is one physics unit.
Anchored solid components connect to the bedrock floor. Mining runs a connectivity
pass and removes disconnected components from terrain, creating dynamic bodies
with their own local voxel volumes. Box3D advances at 60 Hz with four substeps.
Collision shapes are greedily merged, non-overlapping boxes; only dirty 8³
terrain chunks have their static collision rebuilt. Mining moving bodies splits
their local connectivity and preserves the remaining material and rigid velocity
field. Stone/timber placed against terrain participate in the same connectivity
rules. Sand advances at 30 Hz, conserving cells and using moving-solid occupancy
as a coarse obstacle field.

Rendering traverses voxel grids with DDA in a fullscreen fragment shader.
4³ occupancy summaries skip empty terrain. Dirty terrain blocks and changed
body volumes are uploaded to integer textures. Rays transform into each body's
local coordinates, so rigid rotation requires only pose updates. Visibility,
sun shadows, material variation, target highlighting, and distance fog are
computed from the voxels. There is no render mesh, Three.js, WebGPU requirement,
or dependency on hardware ray-tracing extensions.

## Controls and scope

WASD/arrows fly, mouse looks, Space rises, C/Ctrl descends, Shift accelerates.
Hold left-click to use the selected tool; 1–5 select mining, sand, stone, timber,
or throwing. Brackets and the size slider change the brush. Escape pauses and
releases pointer lock. Right-drag looks when pointer lock is unavailable.
Touch uses drag-to-look, a movement pad, height buttons, and a held tool button.
The detail setting controls render resolution independently of CSS/device scale.

This is a finite creative scene, not the 2D game's survival/content port. There
are no fluids, reactions, streaming, saves, inventory, or player collision.
Sand uses coarse body occupancy and displacement, not two-way granular forces
on Box3D. Dynamic volumes are at most 16³ cells; larger disconnected regions
are partitioned. The 32-body budget preserves excess disconnected terrain and
reports the limit; an over-budget fracture remains one multi-shape body.
Bodies falling beyond the site's bounds are retired. Reset restores the scene.

`?test` exposes `window.__voxelDemo` scenario hooks. Normal visits do not expose
them. The headless test covers movement, support removal, falling/ground contact,
body mining, sand conservation, attached placement, pause, and reset, and reports
step timings. Browser tests cover production loading boundaries, desktop input,
touch cancellation, layout, pause, and screenshots. Touch emulation is not a
physical iPhone performance measurement.
