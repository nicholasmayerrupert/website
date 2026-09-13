# The Quarry — `/3d`

A streaming creative demo with a free-flight camera, voxel mining, sand, reactive
fluids, combustion, stone and timber placement, and Box3D rigid bodies. It is
independent of the 2D game.

## Run and build

- `npm run dev`, then open `/3d` (or `/3d/`).
- `npm run build:3d` rebuilds the committed loader and WASM with the repository's
  pinned Emscripten 6.0.0. Box3D source and its MIT license are vendored; the
  exact upstream revision is in `vendor/box3d/UPSTREAM.md`.
- `npm run build` builds both the main site and the separate 3D entry and
  compresses their WASM. Ordinary site builds do not need Emscripten.
- After a production build, run
  `node scripts/run-tests.mjs --only 3d-engine,3d-materials,3d-detachment,3d-browser,3d-lighting,deployment`.

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

Entering chunks and their material counts are prepared with a 4 ms budget per simulation tick. A window
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
updates their poses without rebuilding render meshes. The atlas uses eight
32-body texture-array banks, with 256 poses in a uniform buffer rather than
individual fragment uniforms. CPU body volumes allocate on demand.

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
Edits reduce only the coarse cells covered by the changed fine chunk. An
unchanged reduction skips its GPU upload; it matches a full clipmap rebuild.

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
Temporal antialiasing and protruding procedural grass geometry are not implemented.
The material shader adds world-anchored stone strata, sand ripples, bark grain,
copper patina, foliage variation, and animated tapered grass surface detail.
Moving bodies use local texture coordinates. Pixel-footprint filtering fades
fine patterns before they become subpixel. Grass detail belongs to actual grass
voxels, so mining and combustion remove it along with the material.

`emissive_lights.hpp` caches exposed lava/fire faces in 16-cell clusters when a
render chunk changes. Sources use absolute coordinates across all detail levels;
finer coverage suppresses duplicate coarse sources. Up to 24 sources are selected,
and each pixel shades its strongest two contributions with terrain/body shadow
rays. `lighting_shader.inc` uses the same world-space terrain and body queries
for contact ambient occlusion, three fixed sky rays, sunlight, and emissive
shadows. Sky obstruction is weighted by hit distance, and an indirect-light
floor keeps sheltered surfaces legible. Two fixed sunlight samples soften shadow
edges. Voxel-volume entry normals follow the actual box face. Changing supported
terrain into a rigid body at the same pose preserves the illumination of both
the object and its surroundings.
This approximates indirect light without full global illumination, bloom,
or temporal accumulation.

The `3d-lighting` browser regression cuts a roof's one-voxel support while physics
is paused and compares the static and rigid renders. Albedo is held constant to
isolate lighting from body-local material patterns; the compiled traversal and
lighting shader remain intact. Only the removed cell and its shadow may change.

Box3D advances at 60 Hz with four substeps, with its length scale set to sixteen
voxels per metre. Static collision hulls are generated only near dynamic bodies,
using greedily merged solid boxes. Changed hulls rebuild before the next physics
step. `structural_support.inc` checks connectivity from edited cells, continuing
through saved or procedural geometry outside the loaded window. A pre-removal
3³-neighborhood proof skips that search when all surviving neighbors stay
connected locally. Possible bridge cuts track surviving neighbors through the
rest of the batch so further erosion cannot hide an orphan. Pending support
edits are processed before a running world shifts. Support is
proven by a continuous deep-rock column below both the caves and all known edits
in that column; a streaming boundary does not anchor an island. Disconnected
material transfers to moving voxel bodies, including its unloaded portions,
and saved terrain is cleared so it cannot reappear on a later visit. Sand runs
at 30 Hz over a list of grains, rather than scanning the entire terrain volume.

## Materials and interactions

`cpp/material_simulation.inc` owns active fluid motion, contact reactions, gas
lifetime, and body erosion. The behavior follows the 2D engine's material flags
and `ReactionSystem::applyAcid`, `applyLava`, and fire rules in
`../sand/cpp/engine/reactions_impl.inc`:

- Water and acid fall and spread only toward a lower cell, searching eight
  horizontal directions up to eight cells away for a one-cell drop. Lava uses a
  two-cell reach and moves more slowly, giving it a steeper repose slope.
  Lookahead chooses the outlet, but liquid advances one adjacent cell at a time
  across a shelf instead of jumping over intervening flat ground.
  Liquid cells do not wander sideways on a settled surface. This approximates
  surface cohesion rather than physical surface tension. Density swaps let sand
  and stone dust sink through water and acid.
- Water or acid touching lava produces steam and loose stone dust. The residue
  remains granular, avoiding a separate rigid body for each cooled cell.
- Acid dissolves ordinary rock, copper, timber, plants, and powders; some acid is
  consumed, and erosion releases acrid smoke. Bedrock resists corrosion.
  Corrosion checks current contacts after fluid movement on each fluid step,
  independently of movement eligibility. Each eligible acid cell makes one
  dissolve roll at the 2D probability of 0.75; successful reactions retain the
  0.4 consumption probability and 0.5 smoke probability.
- Lava and fire ignite timber, leaves, and grass. Water extinguishes fire.
  Fire decays into smoke; steam rises and can condense back into water.
- Acid and heat also erode eligible materials on moving bodies. Voxel fragments
  and collision hulls rebuild together, preserving their transforms and momentum.

Fluids use an active-cell queue at 30 Hz. Stable enclosed cells sleep until a
neighbor changes; lower openings also wake surfaces within their downhill reach.
At most 24,000 queued cells are processed per pass, with
deferred cells going first next time. Structural reaction edits are batched;
the contact pass checks up to 24,000 queued cells and makes at most 32 erosion
or ignition edits per fluid step. Its cursor resumes beyond the last budgeted
edit so sustained contacts in one region cannot monopolize corrosion.
Ordinary liquid movement does not trigger connectivity searches. Pouring stops
after reaching the 200,000 active-window fluid/gas budget (one brush can cross
the threshold). Existing cells remain intact.
All material cells share chunk persistence and every distant voxel detail level.

The renderer traces through water, acid, and vapor to show the material behind
them, with depth tinting, surface highlights, animated ripples, and emissive lava
and flames. This is a single transmission layer; it does not simulate full
refraction or volumetric light scattering.
Three resistant trays at the spawn hold water, acid, and lava. `L` or the Lab
button positions the camera above them for experiments.

## Controls and scope

WASD/arrows fly, mouse looks, Space rises, C/Ctrl descends, Shift accelerates.
Hold left-click to use the selected tool; 1–5 select mining, sand, stone, timber,
or throwing; 6–9 select water, acid, lava, and fire. Brackets and the size slider change the brush. Escape pauses and
releases pointer lock. Right-drag looks when pointer lock is unavailable.
Touch uses drag-to-look, a movement pad, height buttons, and a held tool button.
The detail setting controls render resolution independently of CSS/device scale.

This is a creative terrain demo, not the 2D game's survival/content port. There
is no inventory or player collision. Fluids and sand use body occupancy for
collision; buoyancy and two-way fluid forces on Box3D are not implemented. Dynamic volumes
are at most 64³ cells (4 m per side); larger disconnected regions are partitioned.
The 256-active-body budget reports its limit. Structural edits are planned before
detachment; a cut requiring more bodies than available restores its structural
edits instead of leaving disconnected static material. An over-budget fracture
of an existing body remains one multi-shape body. Distant simulation
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
The material suite checks volume conservation, lateral flow, acid consumption,
quenching by water and acid, ignition and extinguishing, rigid-body erosion, and
fluid restoration after eviction. Browser checks exercise the new palette,
fluid shading, pouring onto lava, the lab shortcut, touch pouring, incremental
clipmap parity, emissive illumination, and solid occluders. Detachment regressions
cover fresh-world islands crossing both vertical window edges, physical falling,
preservation of unloaded geometry, batched erosion, and mining beyond 32 bodies.
The engine suite checks the 256-body limit, and the browser suite renders a body
in the second texture-array bank.
`node scripts/bench-3d.mjs --json FILE` measures engine/render submission and
normal RAF flight on the native GPU; add `--production` for built assets.
On Windows they use Direct3D11
to exercise native shader compilation; `node scripts/3d-browser-e2e.mjs --software`
checks SwiftShader, and `--dev` selects the development server. Touch emulation is not a
physical iPhone performance measurement.
