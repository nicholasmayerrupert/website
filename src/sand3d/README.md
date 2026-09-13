# The Quarry — `/3d`

A streaming creative demo with a free-flight camera, voxel mining, sand, stone
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
Box3D world. `cpp/voxel_world.hpp` owns procedural generation and saved chunks;
`cpp/voxel_clipmap.hpp` builds the distant material volumes from that same world.
`cpp/renderer.hpp` owns the WebGL2 context and GLSL raycaster.
`main.js` owns DOM events, sizing, the bounded fixed-step/RAF loop, and controls.
The initialization screen renders one scene frame. Simulation and animation
start when the visitor enters. Menu, blur, and backgrounding stop the RAF loop;
page exit destroys the world and graphics context. A restored history entry
reloads to recreate disposed resources. Graphics failure provides a reload path.

## Streaming and rendering

Voxels measure **0.0625 metres per side**. The full-detail simulation window is
768 × 256 × 768 voxels (48 × 16 × 48 metres), stored in 4,608 reusable 32³ chunks.
The camera can travel in all three axes. Signed 64-bit voxel origins and local
physics coordinates keep Box3D near the origin as the world streams. Terrain is
seeded by absolute coordinates, with hills, underground caverns, copper seams,
trees, and the starter quarry at the origin.

Entering chunks are prepared with a 4 ms budget per simulation tick. A window
shift reuses retained chunks in place and replaces only the entering slabs; it
does not copy the entire volume. Modified departing chunks are run-length encoded
in an in-memory cache. Unchanged terrain is regenerated, so flying through new
terrain does not accumulate a history of unedited chunks. Edits and sand restore
when revisiting. Rigid bodies remain active outside the terrain window, with
collision chunks generated around them. Beyond 160 m they are suspended with
their voxel volumes, transforms, and velocities, then restored within 144 m.
Both thresholds are beyond the visible range.
The active terrain allocation is fixed; the cache grows with edited chunks and
archived bodies. **Persistence is for the current visit**, not across reloads.
Reset clears edits and restores the starting scene.

The renderer raycasts the same material cells used by simulation. An occupancy
hierarchy skips empty 32³, 16³, 8³, and 4³ regions before traversing individual voxels.
Only changed chunks and their occupancy nodes upload to the GPU. The hierarchy
uses an integer texture with nearest mip filtering so Direct3D exposes every
level to `texelFetch`. Moving bodies use a separate local voxel atlas; rotation
updates their poses without rebuilding render meshes.

Beyond the simulation window, three voxel clipmaps use 12.5 cm, 25 cm, and 50 cm
cells. Their coverage is 64 × 32 × 64 m, 128 × 64 × 128 m, and a 256 m cube.
All materials use the same volume traversal,
occupancy hierarchy, palette, and shadow path. Trees remain voxels, and sand,
placed materials, underground cavities, and mined air are represented at every
level. There are no separate tree primitives or terrain height-field renderers.
Moving bodies retain their local voxel atlas at all visible distances.

The shared generator samples procedural cells. Modified resident or saved chunks
override those samples using a conservative reduction: each fine column supplies
its uppermost occupied material, and the most frequent of those materials wins.
This retains thin surface layers and isolated placed voxels. Every edit dirties
all clipmaps, including deletion to air. Distant geometry has fewer cells, so
small shapes are approximated consistently across materials.

Clipmaps reuse retained chunks and prepare entering chunks with a 1.25 ms budget
per level per rendered frame. A complete band is published together. Initial
loading and test teleports prepare synchronously. Fog fades all geometry between
80 and 112 m, inside the outer cache boundary. The detail selector limits ray
count independently of device pixel ratio. Render caches allocate only on the
3D page; the WASM heap starts at 384 MiB and can grow to 1 GiB.

These choices follow the relevant techniques in Burkelbear Games’
[graphics explainer](https://www.youtube.com/watch?v=Y8HRCXxI0BY): hierarchical
empty-space skipping (3:00–3:41), distant terrain detail rings (4:11–4:32), and
reduced rendering resolution (7:59–8:08). This demo uses a WebGL2 fragment shader;
it does not require compute shaders, WebGPU, or hardware ray-tracing extensions.
Temporal antialiasing, emissive-light clustering, and procedural grass blades
from that video are not implemented.

Box3D advances at 60 Hz with four substeps, with its length scale set to sixteen
voxels per metre. Static collision hulls are generated only near dynamic bodies,
using greedily merged solid boxes. Changed hulls rebuild before the next physics
step. Mining checks connectivity from the edited cells; it does not scan the
entire world after each cut. Connected material touching the loaded boundary
remains anchored. Disconnected material becomes moving voxel bodies. Sand runs
at 30 Hz over a list of grains, rather than scanning the entire terrain volume.

## Controls and scope

WASD/arrows fly, mouse looks, Space rises, C/Ctrl descends, Shift accelerates.
Hold left-click to use the selected tool; 1–5 select mining, sand, stone, timber,
or throwing. Brackets and the size slider change the brush. Escape pauses and
releases pointer lock. Right-drag looks when pointer lock is unavailable.
Touch uses drag-to-look, a movement pad, height buttons, and a held tool button.
The detail setting controls render resolution independently of CSS/device scale.

This is a creative terrain demo, not the 2D game's survival/content port. There
are no fluids, reactions, inventory, or player collision. Sand uses coarse body
occupancy and displacement, not two-way granular forces on Box3D. Dynamic volumes
are at most 64³ cells (4 m per side); larger disconnected regions are partitioned.
The 32-active-body budget preserves excess disconnected terrain and reports the
limit; an over-budget fracture remains one multi-shape body. Distant simulation
is suspended, not continuously computed.

`?test` exposes `window.__voxelDemo` scenario hooks. Normal visits do not expose
them. The headless test covers movement, support removal, falling/ground contact,
body mining, sand conservation, attached placement, pause, and reset, and reports
step timings. It also checks edit and body restoration after complete eviction,
negative coordinates, vertical travel, million-metre coordinates, and continuous
fast diagonal flight with a bounded active window. Browser tests cover production loading boundaries, desktop input,
touch cancellation, layout, pause, native texture hierarchy sampling, continuous
flight across chunk boundaries, and screenshots. Material regression checks verify
GPU-visible sand after eviction, single-cell placements at all distant levels,
grass preservation, mined-air invalidation, bodies outside the terrain window,
and visible material more than 80 metres away.
On Windows they use Direct3D11
to exercise native shader compilation; `node scripts/3d-browser-e2e.mjs --software`
checks SwiftShader, and `--dev` selects the development server. Touch emulation is not a
physical iPhone performance measurement.
