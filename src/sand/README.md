# Sand engine

The site uses the same falling-sand runtime for the creative home-page hero and
the continuous **Aster** Earth expedition at `/game`. The player starts inside
Hearthwood Lodge, with wilderness, mountains, and caves in the same streaming
world. `/game?sandbox` opens the direct survival sandbox.

The simulation, WebGL2 renderer, camera, input policy, tools, actors, authored
missions, and world streaming run in C++ compiled to WebAssembly. JavaScript
owns browser lifecycle, canvas sizing, raw DOM events, audio presentation,
workers, and the ship/debrief presentation.

The runtime ships as a framework-free `<sand-game>` Web Component. React only
mounts that element on this site.

Timed buffs and debuffs share the C++ `StatusEffectSystem`, with data-defined
stacking, periodic damage/healing, movement, control, immunity and cleansing.
See [STATUS_EFFECTS.md](STATUS_EFFECTS.md) for ownership, save/prediction rules,
design research, and how to add effects and gear sources.

Weather defaults to pinned `clear`. `weather="auto"` runs a deterministic
wall-clock cycle that fades the presentation between clear and rain (sky tint,
cloud count, precipitation, and skylight interpolate on a continuous mix) and
flips the offline authority's discrete weather via a journaled `weather`
message so replays stay exact. The embed palette's Rain button pins rain or
clear at runtime through the same journaled path, suspending the cycle until
it is resumed. `weather="rain"` pins the rain profile. Rain
keeps its presentation changes within the sky, adds precipitation that falls
from the visible cloud bases, reduces effective skylight, and lets the offline
authority introduce water. Additional weather profiles share the same numeric
weather-ID path.
Rain is currently an Earth profile; selecting it with another planet normalizes
the weather to `clear` so visuals, lighting, and authority state stay aligned,
and auto cycling stays pinned clear there too.

## Runtime topology

Offline creative, survival sandbox, and campaign deployments use two engine
instances:

- An authority worker simulates cells, actors, tools, inventory, and streaming.
- A main-thread presentation engine applies backpressured world diffs and actor
  snapshots, renders WebGL, and predicts only the local survival player.

Player prediction advances at most one actor-clock recovery window beyond the
latest authority state, including unacknowledged input replay. Controls continue
reaching the worker during a stall. Checkpoint loading clears saved input
acknowledgements because input sequences belong to the current browser session.

Only one authority packet is in flight. Full snapshots are used for startup,
resize, and recovery. An ordinary stream shift sends its offset delta plus the
dirty rectangles containing the entering bands; the presentation mirror slides
both material grids and their texture-coordinate projections in place before applying them. Other turns send accumulated diffs.
The presentation mirror does not reconstruct static components because it never simulates them.
Local items, projectiles, and creatures cross the worker boundary as packed
transferable buffers. Live projectile and creature rendering interpolates between
confirmed snapshots with one actor tick of delay; it never extrapolates past the
authority. Collision mirrors remain at the newest snapshot. Spawns, projectile
phase changes, removals, and discontinuous relocations take effect immediately;
paused and replay views use exact snapshots. Unchanged render buffers are not
recopied into WebAssembly.

## Aster: continuous Earth expedition

`/game` mounts one `<sand-game planet="frontier" mission="frontier">` with a
fixed Aster Valley seed. Frontier uses Earth's terrain and presentation profiles;
its additional authored landmarks are streamed in absolute world coordinates.
There is no deployment, extraction, or world replacement between jobs.

`content/world.js` authors Hearthwood Lodge, its greenhouse and cellar, the
western railway, the flooded archive, and Windward Observatory. Material
blueprints use rectangles, polygons, and reusable prefabs in either simulated
layer. Named anchors connect residents, signs, quests, and development scenes.
`ContentSystem` consumes a validated per-engine package before terrain generation;
`worldgen_frontier.inc` clips and stamps that content as the world streams.
Component-aware repair restores the authored lodge within its declared repair
bounds. Natural hostile spawns exclude those bounds.

`mission_frontier.inc` evaluates authored reach, passage, drain, build, delivery, and encounter conditions,
prerequisites, and rewards. The railway needs an actor-height opening; the archive
needs a drainage route into its cistern; the mountain instrument requires a climb.
Returning to Vale completes the expedition after all three. Rewards are awarded
before completion is recorded, so a full inventory cannot silently lose them.

Vale opens the field journal. Osei and the pause menu offer lodge repairs.
`repairFrontierBase()` rebuilds loaded cells through `CellMutationBatch` and
invalidates the repair region's saved tiles, component fragments, and bodies.
Repairs preserve field terrain, inventory, and quest progress. The journaled
`repair-base` intent follows the worker authority and full-resync path.

`content/player.js` owns the player palette, seven animation clips, frame timing,
and source pixels. `content/creatureArt.js` owns all creature sprites and palettes.
Authored material tiles live in `content/materialArt.js`; `world.js` owns tile
overrides and ambient-light presentation. Foreground cells have one-device-pixel
gutters at scales of three pixels per cell and above, revealing the continuous
background texture. Rigid bodies carry texture coordinates through rotation,
baking, fracture, welding, streaming, and checkpoints. See `content/README.md`
for the material-art authoring loop.
The WebGL presenter reads this data; character pixels are not embedded in C++.

`react/SandCampaign.jsx` presents the journal, tracked destination, pause menu,
and maintenance dialogue. `J` opens the journal; `T` talks to nearby residents.
The field sketch is illustrative. Mobile layouts keep the runtime through resizes.

Development-only `/game?studio=hearth` opens the world workbench: scene selection,
authoritative pause/actor stepping, runtime inspection, a blueprint brush, and
player pixel/frame editing. Local saves validate all content and reload the real
game without a WASM rebuild. `npm run game:capture -- archive` produces a browser
screenshot and state JSON. See [content/README.md](content/README.md) for authoring
and [content/ROADMAP.md](content/ROADMAP.md) for the remaining rebuild stages.

World changes and job progress persist through streaming during the session.
Durable world saves are not implemented: reloading starts a fresh valley, as the
pause menu states. The legacy campaign metadata and mission definitions remain
available to direct engine consumers and old replay recipes; the Aster UI does
not use their progression, briefings, loadouts, or extraction flow.

## Planets and gravity

Planet identity is an engine-construction property and is immutable for that
engine's lifetime. The `<sand-game>` element reads `planet`, `world-seed`,
`mission`, and `loadout` when it connects; recreate the element to change any of
them. Planet and seed together select deterministic terrain and a matching
planetary backdrop.

Moon and Mars use separate terrain, cave, and surface-formation fields. Lunar
exploration crosses mineral spires; Martian exploration crosses weathered fins
and hoodoos. Procedural settlements and monuments belong to Earth.

The canonical campaign gravity scales are Earth `1.0`, Moon `0.33`, and Mars
`0.76`. The Web Component has no separate gravity attribute and campaign
deployments use those planet defaults. The internal engine adapter can override
gravity for tests and specialized hosts, clamped to `0.05`–`1.0`.

Gravity-driven actors, dropped items, arcing projectiles, and free rigid bodies
scale their acceleration continuously. Powders, liquids, and falling structural
components use a deterministic fractional-tick cadence shared by the foreground
and background layers. Liquid pressure and velocity also use scaled gravity.
The resulting freefall order for players, loose solids, fluids, and rigid bodies
is Earth, then Mars, then Moon.

## Two simulated layers

`Engine` owns foreground and background `Layer` instances. `useLayer()` points
hot paths at one layer. A world tick prepares both layers, advances all free
rigid bodies on one timeline, commits both body rasters, then steps foreground
and background cells before cross-layer reactions and transfer.

Both layers generate from the same seed, so their surface and shallow terrain
align. The background is rendered darker behind transparent foreground cells.
Powders and liquids can transfer when stuck if they can continue falling in the
other layer; blocked gas can transfer upward. Components and bodies never
transfer. Creative left-click targets foreground and right-click targets
background.

Stone, ice, and plant-family materials are component-backed. A component material
written directly to the grid without membership is removed during cleanup. Use a
component-aware edit path and call `syncComponents()` after test/runtime bulk
edits.

## Infinite world

The engine holds a finite loaded window over a procedural world. As the camera
approaches an edge, `shiftWorld` persists the leaving band by absolute chunk
coordinate and generates or restores the entering band. Horizontal and vertical
shifts are supported: surface exploration is horizontally unbounded and digging
can continue vertically.

World generation version 22 is canonical in absolute coordinates: viewport size changes
only the loaded window, never terrain, biome, cave, structure, or resource
placement for a seed. Continuous temperature, moisture, elevation, and
ruggedness fields select irregular 576–960-cell climate regions. Adjacent regions
may share a biome, creating longer uninterrupted stretches. Biome identities
remain continuous; soil depth and terrain shape blend across their boundaries.
Biome-specific relief, rolling or craggy detail, and elevation offsets blend
continuously across 128-cell surface knots. Plains have low rolling relief,
deserts have sandy dunes and cacti, bone highlands expose ivory crust and fossils, tundra carries
a snow mantle, jungles grow dense broadleaf vegetation, and swamps form low muddy
wetlands. Shallow swamp pools retain mud skin and soil in both layers, backed
by solid rock beneath the mantle. Groves and clearings vary vegetation density within each region;
separated trunk candidates keep tree silhouettes readable. Surface geology adds
moss-capped boulders, sandstone stacks, icy rocks, and pale Watchwood spires,
with bedrock roots and exclusions around cave mouths and settlements.
Bone highlands retain steep mountain relief and contain component-backed skulls,
rib arches, vertebral columns, and lashed timber stakes with bone tips. Their shared solid
mask preserves hollow sockets and rib gaps across both layers and streaming;
individual rib feet and buried roots anchor them beneath the pale crust. Distant fossil silhouettes
share the ivory-and-umber palette with rust, ochre, and teal underbrush accents.
A broad anomaly field selects Watchwood pockets: rounded plum-soil hills,
pale stone strata, and static ivory-eyed trees on branching burgundy trunks.
Their component-backed wood, sclera, iris, and pupil remain destructible; generated
eye trees have no growth, blinking, or tracking behavior. Plantable eyeball seeds
grow varied single crowns, asymmetric forks, and clustered eyes on leaning trunks;
leaf harvesting yields their species' seeds. The parallax grove varies stalk
height, lean, crown shape, branching, and spacing. Climate reads the base elevation
independently of biome-shaped relief.
Generated trees form a tall canopy above the undergrowth, with species-specific
trunks, broad crowns, buried roots and wider grove spacing. Seed-grown plants
have matching larger mature forms and bounded growth budgets. Canopy reach
is declared in the material profiles so crowns remain complete across streams.
Small background undergrowth fills wilderness between structures: bone highlands
mix ivory feathered scrub, rust brambles, ochre seed reeds, and teal curled lichen;
Watchwood mixes violet fans, forked eye shrubs, coiled fronds, and watching buds.
The other surface biomes have four families each: desert agave, prickly pears,
flowering barrels and dry scrub; tundra dwarf willow, branching lichen, heather
and cotton grass; plains wildflowers, seed grasses and clover; forest ferns,
mushroom clusters, mossy deadwood and berry shrubs; jungle split leaves,
flowering bracts, fern fans and bromeliads; swamp cattails, irises, cypress knees
and marsh ferns. Existing component-backed plant materials supply foliage,
flowers and stems; the flora remains static, destructible and passable in front.
Absolute, jittered slots and a patch-density field vary spacing; roots reach the
solid stratum, and construction footprints and cave mouths stay clear. Marsh
reeds can root in shallow water; other plants occupy dry ground. The parallax layers carry matching low vegetation in the same palettes.

Foreground caves combine noise caverns with a player-clear macro-region
backbone from the surface into an infinite deep-cavern graph. The normal cave
band extends to y=720. Entrances seek a hillside, bend beneath it, and vary in
width instead of exposing a straight cylindrical shaft.
The background is solid except for rare bounded, irregular recesses; it never
receives the foreground route graph. Upper and deep caves share a broad
transition, while stone blends through fine 2x2 mixed strata into darker
deepstone. Background recesses fade away before this overlap so streamed
transition tiles retain a continuous solid backdrop. The abyss contains broad
magma, geode, fossil, and fungal-void realms with chamber-scale lava seas and
landmarks.

Underground ruins are seated on the traversable cave graph and receive roomy side
passages. Large multi-level mines add rail galleries, stations, side chambers,
wide inter-level shafts, and surface headhouses. Mine interiors live in the
foreground while aligned timber frames, station walls, furnished workrooms,
carts, and rail beds remain solid in the background. Surface settlements contain
five to seven large role-specific buildings with distinct rooflines, terraced
foundations, broad masonry supports, slope stairs, a market, lantern-lit streets,
and a roofed well. Villages reserve their whole street with a gap between neighboring
settlements. Streets occupy a single dry biome, with wider wilderness gaps
between settlements. Homes have limewashed timber frames, tiled gables, shuttered
casements, projecting eaves, capped chimneys, and furnished rooms. Entrances open
through the left and right walls; the visible back wall carries windows and furniture.
Real candles, window lights,
hearths, and street lanterns illuminate the rooms and approaches. Occupations and
stable village variants select different wall heights, roof profiles, and window
compositions: squat workshops, tall apothecaries and granaries, and civic halls.
Repeated homes cycle through different silhouettes. Desert streets mix stepped
terraces, vaulted homes, pergolas, and windcatchers; timber streets mix gables,
shed roofs, cross gables, and gambrels. Watchwood uses round, twin, and pointed
domes. Every silhouette fits the village's reserved skyline and street footprint.
Shared street furniture uses the local masonry. Mine
headhouses have framed workshops, winding gear, and hanging lights. Cottages and
headhouses share `stampSurfaceHouseShell` for walls, roofs, windows, lights, and
side-entry clearance, with domestic furniture or mine machinery added by their callers. Snowy
longhouses, swamp stilt homes, tribal huts, and igloos have furnished, lit interiors
suited to their local architecture. Mine entrances exclude settlements, and ruin plans exclude both settlements
and mines; both simulated layers share these deterministic placement decisions.
The biome catalogue selects the settlement architecture. Watchwood uses pale
observation domes, ocular instruments, and burgundy ribs within the same reserved,
player-clear building footprints, with matching communal roofs and streets.
Ruins and homes keep player-clear foreground routes while
their coordinated background walls carry furniture, murals, storage, machinery,
and plant life; underground archetypes include lost archives with book bays,
reading desks, maps, balconies, and lecterns. Deep caverns add furnace citadels,
crystal observatories, fossil conservatories, and hanging archives; their
foreground halls remain player-clear while the background carries hearths,
scaffolds, exhibits, shelves, lamps, and machinery. Coal and copper have compact
starter lodes near the original spawn; iron, gold, and environmental hazards
unlock progressively deeper.

Large biome landmarks add 19 families, documented in [`LANDMARKS.md`](LANDMARKS.md).
Caves add eight upper-cave archetypes and twelve large deep chamber layouts:
sprawling cisterns, rail workings, chapels, buried castles and open mushroom colonies;
smaller workshops and nurseries; deep foundries, crystal instruments, fossil
excavations and fungal settlements. Eight designs use connected wings, sloping
passages and branches around preserved natural rock, with shared raster and
semantic interior plans in `cave_sites.hpp`. They share foreground doorways and galleries with
furnished rear walls, recessed masonry bays, and supported foreground ceiling
lanterns; buried piers meet the cave floor. Neighboring ruins
resolve overlaps deterministically and respect the larger deep monuments.
Acid springs use asymmetric bowls, stepped beds and paired pools with crystal
linings, mineral rims and banks fitted to natural rock, outside structure sites.
Their deterministic districts reserve space before ordinary settlements and mines;
whole-footprint biome and slope checks keep each site coherent. Foundations extend
column by column into terrain, tapered approaches meet the surrounding soil, and
cave openings remain clear. Swamp decks stand on piles; fallen serpents follow the
actual hillside. The material cells participate in ordinary component simulation.

`WorldContextSystem` exposes the semantic plan behind generated terrain at any
absolute coordinate: surface/cave biome, surface-relative depth, composable area
tags, stable feature identity and bounds, parent feature, and nested site role.
Worldgen and context queries share the plans for settlements, mines, ruins,
deep monuments, formations, and landmarks, so spawning and tools can target a
site without inspecting mutable cell materials. One compile-time registry row
owns each family's placement reach, profile eligibility, stage, write/layer
policy, exclusions, priority, semantics, and executable callbacks. These
records are regenerated from the seed and version rather than added to the
streaming store. `npm run test:world-context` covers feature nesting, spawn
affinity, viewport independence, and streaming stability. See
`WORLD_CONTEXT.md` for the model and extension path.

Only changed simulation tiles enter persistent streaming storage. Pristine
generated and prefetched tiles use RLE when useful and live in a bounded
disposable cache, so ordinary exploration does not grow storage with total
distance. Use `npm run test:worldgen` for canonical-coordinate, entrance shape,
connectivity, progression, reachability, and background-solidity checks;
`scripts/worldgen-structures-test.mjs` verifies grounded surface masonry, furnished
archives, large player-clear mines, and cross-layer rail alignment. `npm run test:prefetch`
covers deterministic restoration and storage bounds; `npm run test:deep-world`
flood-tests normal/deep connectivity and checks deep strata, biome diversity, lava
seas, monuments, and background solidity. `scripts/worldgen-version-test.mjs`
locks representative all-planet raster and semantic output to the explicit
world-generation version. `npm run worldgen:atlas`
writes `bench/worldgen-atlas.png`, with foreground above background;
`npm run worldgen:structure-atlas` finds representative structures and renders
their actual composited cell grids to `bench/structure-atlas.png`.

Creative worlds open with roughly 60% sky and 40% terrain or water across the
visible area. The camera solves against the full surface profile, clipping each
column to the viewport so an isolated peak cannot dominate the framing. The initial loaded window is
centered around that view so camera bounds cannot force the terrain upward.
Authority and presentation use the same recorded opening viewport dimensions.
Trees, structures, and decorative background ridges do not determine this framing;
subsequent camera movement and zoom remain user-controlled.

Zoom changes both the visible cell count and the loaded-window dimensions. A
larger zoomed-out window costs more to store and initially settle, while quiet
loaded terrain remains passive outside exact active spans. Extreme buffers shed
excess vertical runway before shrinking their streaming margin. The effective
zoom floor is limited by the device's WebGL texture dimensions rather than a
fixed cell cap.

The offline authority keeps a camera-centered 512×352 procedural simulation
focus independent of zoom. Moving the camera wakes only newly entered focus
bands; tools, reactions, loose materials, and bodies can keep their own activity
outside it until they settle. Loaded cells outside those regions remain visible,
streamable, and persistent without being advanced merely because zoom exposed
more of the world.

Pressing `L` while the local simulation surface owns keyboard input pauses the
authority and opens the deterministic replay panel. Its copy/paste capsule keeps
the real generated seed, initialization options (including weather),
authority-turn input/config/resize events, the total turn count, and sparse ranges for streaming transport
gates. Continuous tools use deterministic turn time. Replaying reconstructs a
fresh authority in a second worker, leaving the live worker paused, and caches visual keyframes plus per-turn
presentation deltas in independently compressed segments. Segments span at most
two seconds and close sooner when their uncompressed payload becomes large.
World shifts inside a segment store the shifted overlap plus its dirty bands
instead of a new full frame. The bottom timeline plays at 60 turns per second,
highlights every cached range (including disjoint ranges), shows the exact tick,
toggles play/pause with `Space`, steps one tick with `,` / `.`, and reconstructs
cached frames from their segment keyframe while the slider is dragged. Pressing
`R` during buffered replay restores the parked live world and continues the
game; `L` restores it and reopens the same logs panel `L` opens during live play.
Neither uses the replay playhead. The replay worker
simulates the capsule left to right as fast as it can, independent of the
playhead, and stores every encoded segment in a session-scoped IndexedDB store.
Playback reads those cached frames at 60 turns per second. The 128 MiB encoded RAM
tier demotes least-recently-used segments to that store instead of discarding
their timeline ranges. Decoded segments use a 24 MiB working-set target while
retaining the segment in use. Generated turns load from either tier without
re-simulating. Seeking never rewinds the authority; an uncached future turn waits
for the left-to-right builder, and an already-generated turn loads from cache.
`Resume here` discards the parked live worker, rebuilds the complete authority at the selected turn as fast as
the worker can step, without pacing or presenting intermediate frames, then
truncates the replay recipe there, clears held input, and continues live as a
new branch.
Completed buffering verifies the final tick, streamed offset, actor/topology
totals, and both-layer grid checksum.
Capsules are ABI-versioned and intentionally reject incompatible engine builds.
The copy/paste codec stores delta-tick event tuples, changed control/input fields,
and sparse transport-gate ranges, then uses gzip when the compressed text is
smaller. Version 2 plain-JSON capsules remain importable.

### Replay inspect

`npm run replay:inspect -- <capsule-file>` decodes a capsule without starting the
engine or a browser. It prints named init (planet, weather, tool, materials),
event counts, a sparse timeline, activity bounds, the final checksum, ABI match
against this checkout, and a suggested microscope command. Use `--json` for the
same summary as JSON. Stdin is `-`. Inspect still prints when the ABI fingerprint
does not match; only a live replay requires a matching engine.

Save a pasted capsule to a file first. Chat wrapping and truncation break gzip.

### Replay microscope

`npm run replay:microscope -- <capsule-file>` opens a development authority in
headless Chromium and writes arbitrary timeline frames plus structured engine
diagnostics. The command starts and stops its own Vite server unless `--url` is
provided. Output defaults to a temporary directory and contains per-frame PNG
and JSON files, `report.json`, `inspect.txt`/`inspect.json`, and an HTML filmstrip.
If `--at`/`--filmstrip` are omitted it captures inspect-suggested turns (start,
activity, end) instead of only the last turn.

```sh
npm run replay:inspect -- issue.sand-replay
npm run replay:microscope -- issue.sand-replay \
  --at 0,3000,6138 --filmstrip 5100:5350:10 \
  --body 0:936 --focus body --cell 120,-40 \
  --around-anomalies 6
```

On a fresh machine, run `npm install` and `npx playwright install chromium`
once. The CLI and its Vite process lifecycle support Windows, macOS, and Linux.

Useful options include `--overlays`, `--scan-body-limit`, `--viewport`,
`--json-only`, and repeatable `--cell`/`--at` arguments. Run the command with
`--help` for the complete list. The scanner marks stalled unanchored bodies,
deep contacts, sleep/wake transitions, and terrain-contact transitions while
the authority advances. Forward seeks continue from the current state;
backward seeks rebuild the authority and deterministically replay to the target.

During a development session, `window.__sandReplayMicroscope` exposes the same
persistent timeline directly. Its main methods are `open`, `seek`, `step`,
`inspectBody`, `inspectCell`, `findBodies`, `selectBody`, `setOverlays`,
`screenBounds`, `nearbyEvents`, `timeline`, and `summary`. This is the preferred
surface for an automated browser agent that needs to move through a replay one
frame at a time and request close-up screenshots without copying the capsule
into its prompt. With a selected body, the default `selection` overlay limits
labels, velocity arrows, status, and contacts to that body while leaving nearby
body bounds faintly visible for context.

## Source map

- `cpp/sand.cpp`: unity translation unit and `Engine` composition.
- `cpp/engine/common.hpp`: shared types and constants.
- `cpp/engine/layer.hpp`: per-layer grids, caches, components, bodies, and stores.
- `cpp/engine/`: composed subsystem classes (most use a header plus an
  implementation include):
  audio, camera, components, crafting, creatures, explosives, spatial forces, GL presentation,
  growth, inventory, items, magic, missions, replication, player, projectiles, reactions,
  renderer, rigid bodies, status effects, terrain, tools, and semantic world context.
- `cpp/engine/world_context.hpp` and `world_context_impl.inc`: deterministic
  feature hierarchy and absolute-coordinate semantic queries.
- `cpp/engine/missions.hpp`, `missions.inc`, and `missions_impl.inc`: authored
  operation state, objectives, scripted actors, extraction, and snapshots.
- `cpp/engine/core.inc`: loose-material settling hot path.
- `cpp/engine/step.inc`: world-step coordinator and cross-layer transfer.
- `cpp/engine/rigid_world_step.inc`: world rigid scheduler and cached collision
  masks. Each joint object has one physical body and one shape per occupied
  layer. Contacts include layer identity; unrelated layers do not collide.
  Movement snapshots belong to their layers. Both rasters commit before erosion
  can change the body roster. Exact world raster validation guards the result.
- `cpp/engine/rigid_impl.inc`: rigid-body operations. `rigidStep()` coordinates
  `prepareRigidStep`, `solveRigidStep`, and `finalizeRigidStep`, whose definitions
  live in the prepare/substeps/finalize includes. Their per-tick `StepState`
  contains only data shared across phases; contact helpers and solver scratch
  stay inside the solve phase. Liquid coupling uses domain/projection/solve/
  writeback includes. `rigid_actors.inc` owns finite-mass actor response, moving
  support, and final actor/raster clearance.
- `cpp/engine/worldgen.inc`: groups deterministic terrain, surface/deep/off-world
  structure stamping under `worldgen_generation.inc`; loaded-window persistence,
  prefetch, shifting, and resize live separately in `world_streaming.inc`.
- `cpp/engine/worldgen_features.def`: one authoritative registry row per
  generated feature family, including dispatch, reach, composition, and context.
- `cpp/engine/abi.inc`: exported C ABI.
- `materials.schema.json`: material identity and generated behavior/render tables.
- `biomes.schema.json`: stable biome IDs, selection policy, and generated biome
  behavior descriptors.
- `abi.schema.json`: packed ABI layouts, stable planet descriptors, and shared
  enums.
- `wasmBridge/engineFactory.js`: production JS adapter for the WASM ABI.
- `wasmBridge/testHooks.js`: test-only ABI adapters.
- `game/createSandGame.js`: browser runtime and presentation loop.
- `worker/`: authority worker, main-thread replica client, prediction, and
  coordinate reconciliation.
- `game/replayCapsule.js`, `game/replayInspect.js`, `game/replayPanel.js`: versioned replay text codec, no-browser inspect summary, the `L` logs copy/paste UI, `R` to start buffered replay immediately, and `R`/`L` during replay to restore the parked live session.
- `embed/`: the Web Component and framework-free UI.
- `embed/missionHud.js`: mission snapshot labels, tracker, and objective markers.
- `campaign/missions.js`: campaign metadata and bounded loadout construction.
- `campaign/campaignSave.js`: sequential unlocks and validated local persistence.
- `react/SandCampaign.jsx`: Kestrel mission deck, briefing, deployment, and
  debrief flow.
- `react/SandGame.jsx`: React-to-Web-Component attribute and event bridge.
- `audio/sandAudio.js`: Web Audio mixer for semantic engine events.

`MATERIAL_MODEL.md`, `PERF.md`, `GROUNDING_INCREMENTAL.md`,
`SUPPORT_GRAPH.md`, and `RIGID_COLLISION.md` document the main invariants and
performance-sensitive systems.

## Building generated sources

Material, biome, or ABI schema changes:

```sh
npm run generate
```

C++ changes (from the repository root, on any supported OS):

```text
npm run build:sand
```

The WASM loader, SIMD-enabled binary, and `src/sand/wasm/build-info.json` are
committed so a normal site build does not require Emscripten. The site ships
that single SIMD package without a scalar fallback. `npm run sand:doctor`
checks its provenance and generated-source freshness. `npm run build:sand -- --dev`
enables the post-step component/body invariant validator. `wasm/README.md` has
the macOS, Linux, Windows, and WSL Emscripten setup instructions.

## Engine extension contracts

Subsystem implementations are called through their owning `Engine` member
(`tools`, `inv`, `comps`, `rigid`, and so on). Composition fragments only
declare owned subsystem members; they do not mirror methods onto `Engine`.
`scripts/check-sand-contracts.mjs` rejects forwarding façades. `Engine` methods
are reserved for operations that coordinate multiple subsystems.

Temporary layer selection uses `Engine::ActiveLayerScope`. Raw `useLayer()` is
limited to the top-level step phase transitions, and source checks reject direct
ambient-layer assignments elsewhere. ABI operations leave the foreground active.

Persistent per-cell ping-pong state is declared once in
`SAND_PERSISTENT_CELL_CHANNELS` in `cpp/engine/layer.hpp`. Each row names the
channel, value type and empty value, streamed store and encode/decode functions,
material predicate, and whitelist of `PCSO_*` motion operations. Allocation,
swapping, clearing, replica replacement, streaming, resizing, validation, and
release all expand the same list. A motion operation outside the whitelist
resets the channel to its empty value instead of carrying stale state. The row
owns storage and transport; the subsystem that computes or consumes the value
still owns that behavior. The engine-contract suite seeds every registered
channel and both phases, then verifies horizontal/vertical stream restore,
resize preservation, replica clearing, and motion-policy resets.

ABI layouts, callable exports, packed actor records, and inventory stacks live
in `abi.schema.json`. The ABI generator validates every C++ export against its
single JavaScript `cwrap`. Its derived runtime fingerprint includes the ABI,
material, biome, and reaction contracts; the generator never changes
`abiVersion`. Externally visible ABI changes require a manual ABI version bump.

Raster generation and semantic world context share the explicit
`WORLD_GENERATION_VERSION` in `cpp/engine/terrain.hpp`. Any intentional change
to generated cells, feature containment, or semantic identity increments that
version and adds the matching `GOLDEN_BY_VERSION` entry in
`scripts/worldgen-version-test.mjs` after the output has been inspected.
Feature IDs use a stable namespace so unrelated structure layouts retain their
procedural seeds across raster revisions; checkpoints check the generation version.

The extension path for each registry is explicit:

| Extension | Authoritative edit | Generated/runtime path | Focused verification |
| --- | --- | --- | --- |
| Basic material using existing policies | One stable-ID `materials[]` record in `materials.schema.json`, selecting its class, `kind`, and existing movement, habitat, ambience, render, hazard, and trait profiles | `kind` derives placement; `materials.generated.{js,hpp}` supplies sparse validity and indexed behavior tables | `node scripts/run-tests.mjs --only mat-generator` and `node scripts/run-tests.mjs --only mat-flags` |
| Declarative reaction | One rule in `reactions.schema.json` | The reaction generator compiles material/trait/class/profile unions into fixed masks; indexed source buckets apply self, directional, overlap, or rigid-contact triggers with age, impact, cadence, probability, up to four effects, and topology-aware component/body transactions. The first production age rule also compiles in its persistent cell channel; catalogues without age rules pay no channel cost | `node scripts/run-tests.mjs --only reaction-generator`, `node scripts/run-tests.mjs --only reactions`, and the relevant chemistry suite |
| Specialized reaction pass | One `ReactionPassDescriptor` plus one uniformly shaped handler in `reactions.hpp` / `reactions_impl.inc` | The descriptor owns phase, priority, source selectors, cadence, layer policy, retry matching, and its callable; the handler is reserved for algorithms outside the generated trigger/effect vocabulary | `node scripts/run-tests.mjs --only acid-stuck`, `node scripts/run-tests.mjs --only structural-stress`, and a handler-specific suite |
| Persistent loose-cell side channel | One `SAND_PERSISTENT_CELL_CHANNELS` row in `layer.hpp`, plus producer/consumer logic in the owning subsystem | The row's empty value, predicate, codec, and `PCSO_*` whitelist drive allocation, two-phase swap, clear, movement, streaming, resize, replica replacement, validation, and release | `node scripts/run-tests.mjs --only engine-contract` plus the owning subsystem suite |
| Plant species using existing policies | One `plantSpecies` record plus any seed/wood/leaf material identity records it references, all in `materials.schema.json`; select reusable growth and worldgen profiles | Generated material/species tables drive growth, worldgen, crafting, and palette metadata | `node scripts/run-tests.mjs --only mat-generator`, `node scripts/run-tests.mjs --only flora`, and `node scripts/run-tests.mjs --only biomes` |
| Creature species | Append one stable-ID `CreatureSpecies.descriptors` record in `abi.schema.json` to reuse existing simulation, population, behavior, and render profiles, then bump `abiVersion`; `cpp/engine/creature_behavior_profiles.def` composes policies from `creature_behavior_policies.def`, and a new policy selector has one registry row plus its localized runtime handler; distinct artwork adds one `cpp/engine/creature_render_profiles.def` row plus its authored palette and clips in `content/creatureArt.js` | `creatures.generated.hpp` owns species descriptors, creative availability, natural-spawn rosters, bounded replication, and exhaustive behavior/render mappings; reusable passive species require no engine allowlist edits | `node scripts/run-tests.mjs --only abi-generator`, `node scripts/run-tests.mjs --only creatures`, and `node scripts/run-tests.mjs --only creatures-e2e` |
| Biome | Append one stable-ID surface or cave record in `biomes.schema.json`; climate is optional for profile-only biomes, surface rows declare structure eligibility, and offworld records inherit `offworldMaterialDefaults`; `cave_profile_handlers.def` composes selectors from `cave_handler_policies.def`; manually bump `abiVersion` because public biome enums import these IDs | Generated C++/JS descriptors own selection, terrain, flora, hazards, structure-material constraints, policy selectors, and ABI enum imports | `node scripts/run-tests.mjs --only biome-generator`, `node scripts/run-tests.mjs --only biomes`, and the relevant prefetch/seam suite; include `--only worldgen-version` when output changes |
| Planet using existing profiles | One explicit-ID `PlanetId.descriptors` record in `abi.schema.json`, selecting compatible generation/off-world-material and presentation profiles plus gameplay capabilities | Generated C++/JS descriptors own identity, gravity, load-bearing facility materials, capability flags, and lookup helpers | `node scripts/run-tests.mjs --only planet-selection`, `node scripts/run-tests.mjs --only planet-gravity`, and `node scripts/run-tests.mjs --only worldgen-version` |
| Generated feature/site family | One `worldgen_features.def` row plus its localized plan/query/overlap/stamp callbacks; add stable semantic enums in `abi.schema.json` only for a public identity | The row generates the family enum, callback declarations, dispatch, reach, composition, and context registration | `node scripts/run-tests.mjs --only world-context`, `node scripts/run-tests.mjs --only structures`, and `node scripts/run-tests.mjs --only worldgen-version` |
| Generation stage | One dense-ID `worldgen_stages.def` row in execution order plus a stage callback in `world_context_impl.inc`, or the shared generated-feature callback; insertion/reordering is a worldgen-version change | The row owns profile applicability, order, feature-stage selection, overscan, and dispatch | `node scripts/run-tests.mjs --only worldgen-quality`, `node scripts/run-tests.mjs --only worldgen-version`, and the affected domain suite |
| Ruin archetype | One dense-ID `worldgen_structure_archetypes.def` row plus its local stamp lambda in `worldgen_surface_structures.inc`; profile chances are increasing cumulative cutoffs | The row generates identity, selection metadata, bounds, and stamp dispatch; other structure families use `worldgen_features.def` | `node scripts/run-tests.mjs --only structures,worldgen-version` |
| Snapshot or ABI field | Add the field to every packed representation that carries it in `abi.schema.json`; authority snapshots and `glPlayerExt` are independent | The generator emits offsets, writers, and snapshot codecs for each declared representation; the owning subsystem supplies the value and presentation consumers read it | `node scripts/run-tests.mjs --only abi-generator`, `node scripts/run-tests.mjs --only abi-snapshot-writers`, and the relevant worker or presentation suite |

After an authoritative edit, refresh and validate generated sources before the
engine build:

```sh
npm run generate
npm run generate:check
node scripts/check-sand-contracts.mjs
npm run build:sand -- --dev
```

Run the focused tests from the table, then the required suite. Simulation or
render changes also compare the relevant committed benchmark; behavior-neutral
refactors retain the deterministic checksum:

```sh
npm test
node scripts/bench-sand.mjs --compare bench/baseline.json
node scripts/bench-pan.mjs --compare bench/pan-baseline.json       # presentation
node scripts/bench-actor-rigid.mjs --compare bench/actor-rigid-baseline.json
```

Every `scripts/run-tests.mjs --only ...` command performs generated-source,
engine-contract, and committed-WASM provenance checks before its suite. When a
confirmed behavior or performance change intentionally makes a benchmark
baseline stale, run that benchmark with `--update` and the same baseline path,
then immediately rerun `--compare`. Do not update a baseline to hide an
unexplained regression.

Adding a planet that reuses existing policies is one explicit-ID descriptor in
`PlanetId.descriptors`. A distinct generation or presentation behavior is a new
named profile: define the profile identity in `abi.schema.json`, implement it in
the owning terrain or presentation subsystem, and add its biome-selection policy
to `biomes.schema.json` when applicable. Appending a public planet increments
`abiVersion`; any resulting generated-world change also increments
`WORLD_GENERATION_VERSION` and adds its compatibility golden. Both generators
reject non-dense IDs and unknown biome/material/profile references.

Adding a biome is one stable-ID record in `biomes.schema.json`. A surface record
owns its ordered climate clauses, regional-profile membership, terrain skin and
soil, flora, structure materials, and named off-world material styles. A cave
record owns its shallow/deep profile segments, hazards, wall dressing, veins,
and monument materials. `npm run generate` emits the C++ and JavaScript
catalogues; descriptor reachability and all-planet generation tests cover every
record. Appending a public biome ID increments `abiVersion`. Increment the
world-generation version and add its compatibility golden whenever the record
changes generated cells or semantic biome output.

## Materials and simulation

`materials.schema.json` is the source of truth for IDs, class, movement kind,
density, durability, flags, color, transparency, emission, and render animation.
Existing numeric IDs are persistent world and replay data and must not be renumbered.

Loose powder, liquid, and gas cells live directly in the grid. Static rigid
materials share one component registry. Free bodies stamp their real material
into the grid and are distinguished by `bodyOwner`. Any unsupported inert
structural assembly converts into a continuous rigid body. Seeds and spores
always begin as one-cell bodies, then bake and start growing after they settle.
Growing components re-evaluate their current mass against liquid and powder
support whenever their shape changes. Connected plant-family cells remain one
logical component across bake cycles, and rigid fractures preserve their species.
When a seed-bearing tree rebakes after rigid motion, resumed growth derives an
upward leader and crown frame from the settled raster, so a fallen trunk bends
back toward the sky instead of reusing its invalid pre-fall axis.
Oak grows staggered spreading forks and a lobed crown using distinct
`OAK_SEED`/`OAK_WOOD`/`OAK_LEAF` identities. The palette exposes typed seeds;
default seed placement resolves to oak. Vines prefer downward growth and can
climb or spread along supporting surfaces when downward growth is blocked. Live static TNT fuses remain
cell-addressed, while a body fuse retains its body-local ignition front through
motion, splitting, welding, and baking.
Mixed assemblies retain a per-cell material map, so ore, masonry, timber,
foliage, and ice rotate together without losing their identities. Foreground and
background halves released by the same bonded structural break become one
cross-layer body with a shared pose and combined collision shape.

Creative and survival placement makes each connected structural island static
when it touches existing static structure. Otherwise it becomes a body, welding
to every same-layer body it touches or falling freely when unsupported. Blast
debris opts out of this placement weld.

Component-backed bodies bake after their rasterized material footprint remains
unchanged for 20 ticks with direct contact to a grounded static solid. Supported
ice can also bake after its pose remains quiet for 20 ticks while it is still
freezing. A mixed body becomes isolated, assembly-tagged material components:
the component contact graph retains the original object without merging its
stone, timber, ice, or plants into adjacent same-material terrain. Cuts rebuild
connectivity, so separated pieces detach independently. Both halves of a
cross-layer body bake with one assembly tag. Buoyancy and loose-medium
displacement are owned by the rigid-body solver. A body floating without
grounded-solid contact can sleep but does not bake, and the generic `RIGID` tool
material never bakes. Live blast rubble is non-structural and yields when
descending terrain reaches it. While a layer contains body-owned TNT, awake
bodies remain unbaked and sleeping component bodies can bake without the raster
countdown; normal raster sampling resumes after the last TNT body is gone so
fuse and chain-blast work stays distributed across simulation ticks.

Powders and liquids carry a per-cell downward fall speed. Liquids also carry a
compact two-axis velocity used by the rigid/fluid pressure solve; it is separate
from the cellular automaton's integer fall distance. A clear vertical fall
accelerates by one cell per world tick up to the material's terminal speed;
contact, diagonal avalanching, and lateral flow reset the stored momentum.
Rigid coupling projects a deterministic pressure domain around wet body
surfaces using a fixed eight-cell near-field band. Liquid hidden by a solid
raster never enters the matrix, and cavities are reached from their actual wet
walls rather than seeded through the body's whole bounding box. Two nearby open
columns per body supply the unresolved reservoir's hydrostatic pressure at the
cutoff; their vertical integration retains local wave height and mixed-liquid
density layers without walking the connected pool. Persistent liquid velocity
propagates dynamic motion across ticks. If the local band reaches a liquid
density interface, that connected liquid region joins the projection so the
interface remains exact. Ordinary single-material pressure work therefore
scales with wet surface area and the fixed band, not body area or lake area.

Spatial forces are target-masked radial or directional emitters consumed by
powders, liquids, gases, free rigid bodies, and mobile actors. Each emitter selects
which target classes it repels and which simulated layers it affects. Emitters are
indexed into chunk-sized bins, so affected cells, bodies, and actors inspect only
nearby sources.
Neutronium is an ultra-dense component material that contributes one radial
emitter per connected static component or moving body, attracts powders, liquids,
free rigid bodies, players, enemies, and mobile creatures, repels gases, and
targets both layers; larger neutronium masses increase the bounded strength and
reach without creating one emitter per material cell. Actor acceleration is
sampled once at each AABB center and retains the actor's collision and locomotion
rules. Force direction uses the nearest neutronium cell rather than the component
centroid, so long and irregular static or moving shapes attract along their local
surface while component mass still controls strength and reach.
Between moving neutronium bodies, the source with more neutronium cells dominates;
equal sizes use a stable layer/body identity tie-break. Only the subordinate body
receives that pair's attraction, so touching pieces can keep compacting without
their combined mass acquiring a reciprocal launch impulse. Inside a strong
neutronium field, force-directed settling owns loose-material motion
instead of the ordinary downward density, gap, and liquid surface passes.
Pressure-blocked powders and liquids can move along force tangents, so a mass
arriving from one direction wraps around the source instead of remaining in its
starting quadrant. Tangential powder steps use ordinary density displacement, so
sand can spread sideways through lighter water instead of retaining a narrow
inward stream. Pressurized liquids also occasionally choose a lateral-inward free
cell before the direct radial cell, widening incoming streams before they can form
narrow spires. Denser loose materials sort closer to the source, with water forming
the outer shell. Liquid↔liquid density exchanges follow the local force rather
than gravity, so oil poured after water still settles outside the water.
Layer-wide tangential flow stops after quadrant coverage is balanced or stops
improving, while pressure-backed powder keeps taking supported tangent steps
along an elongated neutronium face until its local column spreads.
A blocked static arrangement becomes inactive; moving neutronium bodies continue
to wake their field.

Reactions are routed through generated flags where possible:

- Fire and lava ignite `flammable` cells.
- Acid dissolves `dissolvable` cells.
- Water, brine, ice, snow, salt, and lava handle freezing, melting, and quenching.
  Water, acid, and brine quench lava into dense loose stone dust, so fragmented
  cooling fronts settle as powder instead of spawning disconnected rigid bodies.
  Static and free-body ice freeze water in their own layer and at co-occupied
  cells in the adjacent layer. Water frozen by a free body extends that body's
  occupancy; cross-layer growth promotes a single-layer body to a shared-pose
  foreground/background body. Free-body accretion runs before rigid integration
  and rejects local cells whose oriented footprint would overlap either layer's
  blocking terrain.
- Growth owns plant and mycelium expansion.
- Explosives own TNT/methane fuses, staged blasts, debris, shock, and chaining.

TNT uses precomputed radius stencils and a four-phase blast transaction. Active
craters first accumulate one maximum-energy field; the unique affected cells are
classified from the untouched foreground/background snapshot; both layers are
cut and repaired; then rubble, flecks, gas, and shock impulses consume the
completed removal set. Cross-layer structural damage and shock are mirrored;
gas, flecks, and physical rubble remain in the layer containing the explosive.
Blast-ignited TNT uses a three-tick chain fuse. Due TNT is divided into stable
14-cell spatial regions.
Fronts spanning at most six regions finish atomically. Broader fronts consume
the six nearest regions to the lowest-id bucket per tick until their live
backlog drains. Body-owned TNT shares a 1,200 source-cell budget with that
static front. Waiting TNT remains visible and simulated, while every consumed
region immediately runs its crater representative.
Blasts eject bounded physical rubble sampled from the undisturbed terrain toward
local open space. Dense chain fronts retain material flecks, gas from two
spatially distributed crater representatives per tick, and their staged crater
wave while pacing rigid rubble through a per-tick body budget.

## Actors and survival

Players, creatures, items, and projectiles are non-grid actors. Free rigid bodies
are entities whose occupancy is stamped into the material grid.
During the foreground rigid solve, each live player and creature contributes an
exact AABB kinematic collider. Rigid bodies receive ordinary contact normals,
friction, and torque from those colliders, while actor movement remains under
the gameplay controller. Sustained downward contact against terrain applies
cooldown-limited, nonlethal crush damage.
Players and other real-time actors advance on a deterministic 60 Hz actor clock;
cellular world work is attempted at most once per presentation frame and does not
accumulate catch-up debt.
The offline worker transfers dropped items, cosmetic debris, and projectiles to
the renderer as packed buffers at actor cadence. Nearby identical collectible materials
coagulate into normal inventory-sized stacks, while independent debris flecks
remain short-lived and visual-only.

Campaign deployments and `/game?sandbox` use the same explosive survival rules.
Players spawn with a lower-cadence automatic blast gun whose swept,
high-velocity rounds detonate on the first liquid, solid, or creature hit.
Dynamiteers throw wide, high-damage bouncing charges; bore sentinels telegraph,
lock, and then erase a player-traversable line through both simulated layers.
Captured bore cannons deal 70 damage to creatures while preserving the
sentinel's existing damage against players. Caustic mortarmen lob large,
double-payload terrain-poisoning acid shells; cluster wasps launch slow heavy
carriers that bounce off terrain and split on actor impact or fuse expiry into
sixteen independently scattering
mini-dynamites with distinct 0.1–0.37 second fuses and 18-cell blasts. Each
bomblet contributes reduced actor damage independently instead of losing most
of the volley to the ordinary explosion hurt cooldown; and
minigunners commit their aim
before saturating that line with long bursts of rapid, pinprick explosive rounds.
Blasts and bore cuts damage
and knock back actors as well as changing terrain. Health, dropped equipment,
the articulated player animation, an airborne rechargeable jetpack, and
immediate manual respawning at a chosen bed or a safe original-spawn location are
authoritative in the engine. The rendered
jetpack exposes its fuel level and animates twin thrust plumes without changing
that authority. Holding `F` raises a cursor-facing 120-degree ward with 200
durability; directional hits drain the ward instead of player health, and its
meter quickly recharges after combat. The raised ward is an exclusive stance:
shooting, mining, and placement remain disabled until it is lowered. Acid contact
damages players and corrodes creatures.
Mining, material pickups,
block placement, the 36-slot inventory, 1x1–10x10 tool-size presets (10x10 by
default), and crafting remain
part of survival: the starter mining tool is iron-tier, and defeated
demolition crews can also drop their weapons into
that same inventory. Captured dynamite satchels carry 10 throws, bore cannons 15
beams, acid mortars 20 shells, cluster launchers 15 carriers, and miniguns 250
rounds. Picking up a duplicate weapon merges its full ammo load into the existing
weapon, while the bound starter blast gun remains unlimited. The starting
universal dig tool rapidly cuts ordinary terrain without accelerating bare hands
or crafted material-specific picks.

Three movable material pools occupy ordinary inventory slots (initial hotbar
keys 7–9): building materials, powders, and liquids. Matching pickups go into
their pool without the ordinary 999-unit stack limit; quantities remain finite
and use checked int32 storage. Seeds, gases, tools, and weapons retain ordinary
stack behavior. In the E inventory panel, Auto consumes checked materials in
queue order; exact selection stops when that material runs out. Liquids start
with an exact selection, and hazardous materials start excluded from Auto.
Solid placement keeps its material for the current drag before advancing.
Take withdraws up to 999 to the cursor (Shift-click takes one); clicking a matching
pool deposits the cursor, and Store stacks deposits matching ordinary slots.
Crafting and mission deliveries can spend all stored materials regardless of
placement settings. Highlighted bag slots open directly on double-click (or
Enter while focused); Inventory is also a clickable hotbar button. The bag menu
shows enabled status, queue positions, density, hardness, and material traits.
Property sorting changes the display; Use as queue explicitly applies that order
to Auto. Click to pick up bags or drag them within the inventory; they cannot be
dropped. Depleted materials are hidden while their placement preferences are retained. Pool
containers are bound; death drops their contents as bulk material items. Pool
edits travel through authority intents and replay.

Projectile kind, fuse, and rotation plus creature attack state, progress, and
buffer-local aim are packed into the ABI snapshots; the worker mirror restores
that aim to the creature's absolute-world state. The server and worker transport
those authoritative snapshots rather than duplicating weapon or enemy policy in
JavaScript.

Creatures use absolute-world poses so they survive streaming. Off-window
creatures hibernate, nearby dormant creatures count toward local spawn density,
natural populations are capped locally and globally, and
explicit spawn eggs bypass natural-spawn caps. Minnows, pike, foxes, hares,
crawlers, moles, and birds enter quietly on an ambient cadence, use a three-actor
share of the eight-actor natural cap, and retain material-aware water, surface,
cave, or air habitat requirements.
Target retention, attack-distance arrival, facing stability and bounded physical
navigation are shared across species. Ground movement probes safe jumps against
the live terrain; swimmers and flyers steer around blocked headings. See
[`CREATURE_AI.md`](CREATURE_AI.md) for responsibilities, tuning, research, and
the local planner's limits. `creature-ai` covers navigation regressions.
Survival encounters spend a shared deterministic threat budget at a four-second
cadence. Natural entries must clear the actual camera and all player views by
20 cells; when there is no valid offscreen habitat the director waits. Combat
has a four-hostile cap and a twelve-point active threat ceiling in addition to
the eight-actor natural cap and local density limits. Defeats leave a five-second
collection lull. Explicit development/scripted breach requests remain separate
from natural population policy.

Surface and cave biome masks are hard exclusions. Plains and rocky regions carry
brigands; desert and swamp carry caustic casters; forests and jungles carry wasps.
Bore sentinels inhabit geode/fossil depths and archers inhabit crystal, magma,
and void depths. Adventure adds briar wolves in forest/Watchwood/jungle,
bell bats in rocky/Watchwood regions, fen wisps in swamp/jungle, frost giants in
tundra, cinderjaw tyrants in the bone highlands, mummies inside desert pyramid/tomb
landmarks, and lava toads in magma caves. The director samples entering bands as well as the current biome, and
validates each final pose against its own world context and physical habitat.
Pyramid room searches include floors above and below the natural surface.

Earth villages populate independently of the combat cap. Each material-valid
building interior has one deterministic resident site and each village has one
outdoor commons site. Homes populate within one second of loading, independently
of natural enemy spawning and the number of other residents. Floor searches account
for furniture and door thresholds. Stable site hashes assign
residents as villagers, guards, or hunters; commons have guards. Guards use
melee and hunters use bows against nearby hostiles, remain near their home,
and cannot damage the player. Each role has its own sprite set. Site identity follows
the immutable village/building plan, so residents hibernate and restore with
their absolute pose instead of duplicating as the window streams. Villagers,
surveyors, and IRIS crew render with an upright 9x10 human silhouette aligned to
their tall 4x8 actor shape.

### Controls

| Input | Survival | Creative/free camera |
| --- | --- | --- |
| `A/D` or arrows | Move | Pan |
| `W`, `↑` | Jump/swim | Pan up |
| `Space` | Jump, then hold for rechargeable jetpack thrust | Pan up |
| `S`, `↓` | Crouch/down | Pan down |
| `Shift` | Run | — |
| `F` | Hold a 120-degree directional ward | — |
| `1`–`9`, wheel | Select hotbar | — |
| `E` | Inventory/crafting | — |
| `Q` | Placement/mining footprint | Previous palette selection |
| Pointer | Aim and use selected hand, tool, block, or weapon | Paint, draft, erase, or spawn |
| `+`, `-`, `0` | Zoom in/out/reset | Zoom in/out/reset |

Free-camera keyboard and joystick panning advances on every display frame,
using elapsed time at a constant speed. The C++ camera caps stall recovery at
50 ms and the browser discards suspended time when the viewport resumes.
Physics and player input retain their fixed 60 Hz clock; replay owns its camera.

Coarse-pointer creative mode starts in scroll-safe mode behind a `START` button.
Its joystick, layer toggle, zoom controls, and material picker appear after the
user enables drawing.

## Rendering and audio

The C++ renderer generates material pixels and lighting, then the GL presenter
uploads dirty regions and composites both layers, actors, previews, and overlays.
Terrain grain is keyed to absolute world coordinates. Settled animated materials
repaint only visible chunks that contain animation.
Presentation mirrors coalesce synced lighting invalidations to an eight-Hz
wall-clock cadence while applying terrain and actor snapshots at their normal
rates. Incoming stream bands immediately refresh lighting in the visible window
and its safety margin; direct-sky provenance refreshes across all columns to
preserve offscreen shafts. Glass transmits skylight and local light with mild attenuation.
Jetpack exhaust, raised wards, and explosive or energy projectiles contribute a
capped set of render-only light sources to the same terrain-aware flood as fire
and lava. Their cell-quantized motion uses the existing throttled light solve, so
they illuminate walls and both layers without entering authority state or the
simulation checksum.

Bare hands, mining tools, and placeable blocks show the selected square footprint
at the pointer. Equipping a weapon hides both the footprint and the legacy
diamond tool preview so the weapon aim remains visually unambiguous.

Earth and Frontier's decorative Canvas2D backdrop uses the engine's surface
biome map. Sky colors ease around the survival player or creative camera center.
Each scenery layer projects fixed parallax coordinates into the biome map and
samples a permanent landscape: neighboring profiles connect through a smooth
192-cell transition band. All depths use the same real region sequence,
projected at independent horizontal scroll rates. Camera travel only translates
the landscape. Mountain shading follows local peaks and slopes; rounded hills
carry subtle ledges instead of triangular faces. Heights,
rock faces, snow, local colors, and vegetation share the same coordinate sampler.
Adding a biome profile automatically connects it to every other biome.
Trees and other vegetation use deterministic placement thresholds and render
fully opaque. The background has no decorative houses. Presentation caches use
absolute coordinates and reset when the engine changes; eviction cannot change
the generated scenery. Weather and day/night compose with the biome palette.
Simulated background walls retain their material opacity.

The ten-minute survival day is owned by `WorldClockSystem` and advances with
actor ticks. It pauses with gameplay, survives checkpoints, and drives both
skylight and resident sleep. Creative mode uses a presentation clock. Time-slider
holds and Auto toggles are recorded as replay events. Weather composes its sky
treatment and skylight scale over the time sample; rain advances on a separate
50 ms visual bucket, frozen by reduced-motion and test-pause policy. Its water is
generated by the deterministic offline authority and is included in replayed
world state.

`BedSystem` furnishes supported indoor spaces near resident homes with freestanding
beds. Beds are entity furniture, outside both material grids, replicated to the
WebGL presenter and saved with the world. At night residents walk to their beds
and rest under a blanket; daylight, nearby monsters, damage, fire, flooding, or
lost support keep them awake. Existing saves acquire beds as residents load.
Press `T` near a sleeping resident to wake them, then press `T` again to talk.
The nearby prompt and its click action also switch from waking to talking.
Players can click a nearby bed or press `E` to set their respawn point. At night
an unoccupied, safe bed lets the player rest under its blanket and advance to
morning after two seconds. Leave bed, `E`, `Escape`, movement, and danger interrupt
rest. Bed choices survive saving and world streaming; missing or blocked beds
fall back to the original spawn. Mine beds with a pickaxe to dismantle them into
wood and clear their respawn points; dismantled beds stay removed through saves
and streaming. `embed/bedHud.js` presents the interaction and
sleep controls, while `BedSystem` owns eligibility, time, occupancy, and respawn
anchors. Exercise these paths with the `beds`, `beds-e2e`, and `village-residents` suites.
Chests retain at least 24 stable storage slots, including empty slots. Inventory
and chest slots support cursor pickup, placement, swapping, splitting, dragging,
and Shift-click transfers; mining and placing a chest preserves its contents.

The authority emits bounded semantic sound events. `audio/sandAudio.js` owns
recorded samples, synthesized thuds and acid hiss, spatialization, loops, cooldowns, browser activation, mute,
and visibility. Player-facing follows horizontal cursor aim rather than movement,
so backpedaling preserves the aimed sprite and weapon direction. Jetpack thrust
uses filtered fire/air recordings with ignition and release, while the raised ward has
glass/air activation, a quiet sustained bed, impact, and break cues. Foley uses
alternate recorded takes for material impacts, weapon swings, clothing, and
pickups. Weapon reports layer compact CC0 recordings with mechanical action.
Every species has an explicit voice profile in `audio/creatureVoices.js`:
recorded calls, attacks, hurt and death performances, plus movement textures.
The authority emits species-tagged call, alert, attack, death and movement events;
`SE_CREATURE` identifies hurt. Calls are staggered every 11–18 seconds while idle,
footfalls require actual movement, and attack voices fire once per attack rather
than once per breath pulse. Sleeping residents stay quiet. Creature cooldowns
are separate by species and direction, with four background or eight foreground
voices reserved within the overall effects limit. The 112-file bank and its
reproducible editing recipe are documented in `audio/assets/creatures/README.md`.
`creature-audio` checks coverage and authoritative triggers;
`creature-audio-e2e` renders all 140 voice cues and exports a sound audition page.
The original [six-movement score](audio/score/README.md) has four exploration
pieces and two combat arrangements of a recurring melody. `audio/musicDirector.js`
streams local stereo tracks through crossfading Web Audio decks, retaining only
the active streams. Nearby hostiles and player damage trigger combat; bosses
select the heavier arrangement. A 14-second danger hold prevents rapid switching.
Music pauses with the game and audio lifecycle and briefly ducks under attacks.
Individual asset failures leave the other recordings playable. Rigid-body contacts
use a low noise/sine thud; fracture cues use their material textures. Acid dissolution
uses a quiet high-pass hiss. Explosions preserve a recorded attack and rolling
tail in one peak-normalized sample. Blast strength
controls pitch and weight, distance filters the high end, and each onset varies
slightly. Nearby terrain TNT cells share an 85 ms cooldown; separate locations
remain independently audible. Every projectile detonation gets its own onset.
Dense volleys fade the oldest explosion tails when their separate voice budget
fills, preserving new impacts without crowding out other gameplay cues.
Transporter transitions and successful rescue-beam tags share a distinct energy
cue.
Audio asset provenance is in
`audio/assets/README.md`.

See [world-generation design and research](WORLDGEN_DESIGN.md) for the regional
layout, per-biome shallow geology and cave ecology, and the references informing it.

## Tests and benchmarks

```sh
npm test                 # required headless suites
npm run test:browser     # Playwright browser suites
npm run test:all         # headless + lint + builds + browser suites
npm run lint
npm run build
npm run build:embed

npm run test:campaign
npm run test:missions
node scripts/run-tests.mjs --only planet-gravity
node scripts/run-tests.mjs --browser --only campaign-e2e
```

The campaign test covers mission order, sequential unlocks, bounded loadouts,
persistence validation, debrief rewards, and interrupted-run configuration. The
mission test exercises authoritative objective progression, rescue-beam
channel interruption and departure, mission/planet validation, extraction
dwell/reset, and recovered equipment.
The planet-gravity test covers deterministic planet terrain and the Earth >
Mars > Moon fall ordering. The campaign browser suite covers the Earth briefing
at desktop and high-zoom sizes, ship movement, pause across visibility changes,
real blast-gun combat, rescue-beam interaction, extraction, and failure/retry
presentation. It positions the player near encounters to shorten travel;
objective completion comes from the worker. Mission tests also step world
physics to catch unstable site foundations before combat, then traverse the
entire descent and return using movement and jetpack inputs without teleporting.

`scripts/test-manifest.mjs` is the source of truth for executable test entries.
See [`scripts/README.md`](../../scripts/README.md) for combined selection,
subsystem groups, failure artifacts, revision comparisons, isolated browser
cases, and profiling. For example, `node scripts/run-tests.mjs --only
rigid-placement-weld,worker-capture` runs both suites under one preflight and
scheduler; `--group rigid --list` lists the rigid group.
Before running a suite, the runner checks generated material/ABI/biome sources and
the committed WASM provenance without rebuilding. It also checks that every
`*-test.mjs`, `*-e2e.mjs`, and `*-repro.mjs` file is declared. Headless tests use two workers; browser suites
stay serial because their real-time rendering checks are contention-sensitive.
CPU/memory-heavy headless suites and every browser suite declare exclusive
concurrency in the manifest, so the runner drains active jobs before starting
them even when `--jobs` is overridden. Suite metadata also owns timeout values.
Pass `--jobs N` to `scripts/run-tests.mjs` or set `TEST_JOBS=N` to override that.
Passing suites are summarized by default; add `--verbose` for their full output.
Browser suites allocate strict ports and have per-suite timeouts.

For engine or renderer changes, benchmark before and after:

```sh
node scripts/bench-sand.mjs --compare bench/baseline.json
node scripts/bench-pan.mjs --compare bench/pan-baseline.json
node scripts/bench-actor-rigid.mjs --compare bench/actor-rigid-baseline.json
```

Detached-solid and loose-acceleration behavior has focused coverage in
`npm run test:detached-rigid` and `npm run test:loose-acceleration`.
Player/creature support, rolling, swept contact, moving-surface friction, and
bounded crushing are covered by `npm run test:actor-rigid`.

Use the engine benchmark for simulation/render-fill/streaming changes and the pan
benchmark for WebGL presentation, pointer mapping, two-axis cell stability, and
parallax rigidity. Use the actor/rigid benchmark for dense actor cadence and
finite-mass body contacts through player/creature populations. Pure refactors must
preserve deterministic checksums. See `PERF.md` for metric ownership and focused
commands.

## Adding a material

Choose the narrowest extension mechanism that expresses the behavior:

- A material that reuses existing policies is schema-only.
- Different constants within an existing policy belong in a reusable schema
  profile. A genuinely distinct policy adds one generated selector and one
  table-driven implementation in the subsystem that owns it.
- A local material-to-material transformation is a reaction descriptor.
- A generated reaction's age threshold automatically carries its loose-cell age
  through movement and streaming. Other history attached to a loose cell uses a
  persistent-channel row plus the producer/consumer in its owning subsystem.
  State attached to a component or free body belongs in that topology record.
- A custom reaction pass or topology handler is reserved for behavior whose
  ordering or structural mutation cannot be represented by those paths.

1. Add the material to `materials.schema.json` without renumbering existing IDs.
   Select its class and `kind`; `kind` derives generic placement. Select its
   gas/liquid movement, contact hazard, light transmission, habitat, ambience,
   emission, render-detail, and cross-cutting trait profiles there. The generator
   rejects incompatible class, component, plant-role, and profile combinations.
2. Set its creative folder/order in the schema palette block when the default
   catalogue order is not appropriate; the main palette includes every entry.
   Flora species, seed artwork, seed/trunk/foliage mapping, and
   crafting-equivalent flags also live in this schema, and the C++ engine and
   JavaScript HUD consume the same tables.
3. Express ordinary transformations as one rule in `reactions.schema.json`.
   Select materials directly or with `anyOf`, a material flag, class, or reaction
   profile; constrain each selector to loose cells, components, bodies, or any
   topology. Choose a self, directional target/contact, layer-overlap, or
   body-contact trigger, then declare age/impact thresholds, cadence,
   probability, and up to four effects. Effects can replace, place, remove,
   spawn a body, detach a component, or apply an impulse. `auto`, `static`,
   `body`, and `preserveOwner` policies prevent structural products from becoming
   orphan grid cells; `place` requires an empty target, while `replace` performs
   an explicit transmutation. Use a registered custom pass only when the
   generated vocabulary cannot express the algorithm or phase ordering.
4. Run `npm run generate`, rebuild WASM, run the focused suites through
   `scripts/run-tests.mjs --only <manifest-key>`, then compare the relevant engine
   benchmark. A behavior-preserving catalogue change must retain the
   deterministic checksum.

## Aster adventure

`/game` runs the Hollow Bell chapter. Its implementation and acceptance gates are
recorded in [content/ADVENTURE.md](content/ADVENTURE.md). `CombatSystem`,
`ContainerSystem`, `BedSystem`, `WorldClockSystem`, `DiscoverySystem`, and `CheckpointSystem` are composed by the
C++ engine. Equipment definitions live in `content/equipment.js`; structures,
NPCs, quests, and authored loot live in `content/world.js`.

`content/gearArt.js` supplies the shared 16×16 gear pixels for inventory icons
and held equipment. Swords, bows, and mining tools use articulated weapon art.
Potions stack to 99 and support right-click splitting. Inventory → Sort items
merges and groups pack contents while preserving the quickbar and equipment.
Pick up an item and use Drop one / Drop stack, or drag it onto the drop area.
Starter tools, spell abilities, and material bags stay protected from dropping.

`embed/inventoryWorkspace.js` arranges the adventure inventory into a persistent
pack and Equipment/Wands/Crafting/Materials workspaces, with a Chest workspace
while looting. On narrow screens, Pack is its own section. Search and category
filters highlight matching items without changing engine slot positions. The
fixed item inspector provides equip/transfer, pickup, and split actions; recipe
search and a ready-to-craft filter operate on recipes available at the current
station. All item mutations still go through `inventoryHud.js` engine intents.
`embed/adventureInventoryStyle.js` owns the responsive presentation. Exercise
these flows with `node scripts/run-tests.mjs --only
adventure-inventory-e2e,magic-e2e,adventure-e2e`.

The embed owns one Map/Journal/Inventory panel controller in
`embed/adventureHud.js`. Panel pause stops gameplay while preserving worker
transactions and presentation. `worker/adventureSaveStore.js` stores compressed
full checkpoints in IndexedDB. Checkpoint loading is intended for a fresh
authority engine. `?nosave` and studio/replay sessions do not write campaign saves.
Journal → Settings & controls → Start fresh clears adventure checkpoints and
the local journal, then reloads. The authority disables saving and drains any
in-progress checkpoint before deleting saves, including backups. Sound
preferences and unrelated browser storage are preserved.

Player content supports 29 named animation clips and creature content supports
eight named clips, with up to 32 frames and optional per-frame durations. Keep
the creature source formatted across lines: large single-line sprite literals
are expensive for the development server to transform.

Aster mining and material placement share circular radius presets, including
single-cell precision. Seeds always place and preview one cell. Mining reaches
12 cells and holds its selected target through the swing. Foreground mining
targets the first terrain surface; background mining follows the cursor, with
its brush center clamped to reach. Background brushes can center on empty gaps.
Each strike damages all eligible terrain cells inside the circle, including disconnected
fragments, using their cell-weighted average hardness. Tool-tier limits still
apply. Foreground targeting looks through liquids for terrain; liquid collection targets
liquids outside the player when no terrain is reached. Surrounding liquids do
not contribute to terrain mining difficulty or get removed by excavation. Weapons use
the right hand and shields the left, with depth following player facing. Raised
shields follow an oval around the visible body to cover overhead aim. Adventure
shields block the forward 180 degrees. Raising guard immediately cancels weapon,
spell, bow, mining, and placement actions; canceled actions never resolve later.
Shield quality reduces stamina costs, and timely raises halve the cost. An
ordinary 30-damage hit costs the starter buckler 38 stamina when held, or 19
when timed. Guard-hit flashes show the protected arc. Guard break has a committed recovery.
Stamina returns while a held guard is not taking hits.

Swords chain an opening slash, return cut, and heavy finisher. Hold the primary
action or press during recovery to buffer the next cut; an 18-tick idle window
keeps the chain open. The finisher deals 150% damage with stronger knockback and
costs 125% stamina. Guarding or switching weapons clears the chain. The renderer
uses the authoritative combo stage for the blade, body lean, and slash arcs.


Adventure enemy charges gouge terrain along their path, heavy strikes excavate
their marked areas, and expanding shockwaves fracture radial channels. These
attacks use bounded blast batches to cut and repair both terrain layers and
throw physical rubble and bright cosmetic sparks. Enemy arrows chip walls;
spell volleys travel into their first obstacle and burst into fire, water, acid,
or crystalline flecks. Terrain blast energy is separate from actor damage, so
strong excavation does not multiply the damage of a telegraphed strike.

Combat audio distinguishes a blade's air-cut from actual contact. Rune launches
combine recorded air movement with fire, glass, or wood textures; heavy
impacts, elemental bursts, and expanding shockwaves have separate semantic
events and layered recorded tails. The browser playback suite renders
a combat audio preview alongside its clipping and voice-admission checks.

`MagicSystem` owns player mana, wand recipes, charging, and paid spell chains.
`magic_recipes.inc` validates item/socket ownership and compiles a wand into an
immutable cast; `magic_impl.inc` runs mana recovery, charging, and payload emission.
Only wands cast. Spell runes and upgrades are leaf inventory items: neither can
own sockets or activate from the quickbar. `GEAR_FAMILY`, `WAND_UPGRADE`,
`WAND_SOCKET`, `SPELL_CONNECTION`, and `SPELL_EFFECT` are shared generated enums
from `abi.schema.json`. Authored wands declare `spellSlots`, `upgradeSlots`, and
`initialSpell` in `content/equipment.js`; the content compiler and engine reader
validate those fields and reject socket metadata on other item families.
The content wire format is v7; source world/art documents remain v3.
Every player has one 100-point mana pool across all wands, regenerating one point
per 15 living actor ticks (one per eight with Hearthstone). Full mana does not
bank recovery ticks. Mana cordials restore 55, capped at the player's maximum.
Wands have no mana storage: Hearth, Tideglass, and Bellwood have 3/4/5 spell
sockets, 2/3/4 separate upgrade sockets, and 36/30/24-tick casting cadences.
Each press selects the next occupied spell from left to right and wraps at the
end. Ordinary spells cast once per press. Sparks and Winterbreath sustain the
selected recipe while held, follow live aim, and pay for each three-tick pulse.
Releasing ends the stream; the next press selects the next socket. Switching,
guarding, disarming, and death cancel the hold. An unaffordable spell blocks
that position without spending or skipping.

Open Inventory → Wandcraft to swap spell runes and upgrades using the carried
inventory cursor. New travellers have a Hearth wand with Ember in quickbar slot 3, and Prism
Choir, Rime, Gale, Lumen, Bounce, and Double Shot in their pack. Three Blue
cordials occupy quickbar slot 5. The rune merchant sells
all nine upgrades (500–508). Amplify doubles damage and Double Shot doubles
copies; each adds 15% of base mana. Bounce adds two terrain ricochets and Homing
steers travelling spells; each adds 5%. Linger doubles the base lifetime for
10% extra base mana. These surcharges add, rather than multiply with damage or
copy count. Charge gathers up to twice the power over one second for up to 15%
extra base mana. Continuous spells ignore Charge and stream immediately.
Ordinary costs round up; continuous pulse costs round to the nearest mana point.
Cast Together, On Impact, and After Delay connect an occupied spell socket to the next occupied socket; choose the
source beneath the upgrade. Impact fires on contact or effect completion;
delay fires after 24 actor ticks or earlier completion. Lumen is instantaneous
healing and supports Cast Together as its outgoing connection.

The mana display previews the full next cast, or the current held pulse,
including every triggered copy. Connections form bounded, forward-only chains.
The engine pays once per cast or pulse, captures an immutable `SpellCast`, and advances the wand's cursor only after payment.
Charge pays on release and stops at an affordable strength; switching or guarding
cancels unpaid charge. A paid windup and its projectiles keep their recipe when
the held item changes. Socket edits are locked during casting. Queued payloads
emit after projectile compaction and share the 256-projectile limit.

Wand recipes and sequence positions belong to inventory items, including cursor,
chest, and dropped-item transfers. Checkpoint v6 stores those recipes, player
mana recovery, paid windups, projectile payloads, sword chains, and creature
navigation state; v2–v5 remain readable.
The `wand-socket` intent passes through the worker journal and replay codec.
`magic` covers mana, sequencing, charge, payload payment, save/load, transfers,
and terrain ricochets; `magic-e2e` exercises the real worker and desktop/touch
editor. The UI reads authoritative cost and capacity snapshots.

Prism Choir (306) fires five crystal shards with two terrain-cutting ricochets
each. Hollow Star (307) anchors at the aimed distance, attracts nearby foes,
dropped items and small rigid debris for 72 actor ticks, then collapses into a
crater. The caster and protected residents are exempt from its pull. Faultline
(308) sends regularly spaced eruptions along the aim direction, excavating both
layers and launching nearby enemies. Fields use the replicated `RUNE_FIELD`
projectile phase; their timers and ownership survive checkpoints and streaming.
Terrain repair runs on ricochet, eruption, or collapse rather than each attraction
tick. Casts and impacts have crystal, vacuum, and rock-fracture sound layers.

New travellers carry a loose Prism Choir rune in their pack. The cellar's third and fourth
coffers contain Hollow Star and Faultline, and the rune merchant trades all three
for copper, including in existing saves. Fen wisps use a three-shard choir on
their second attack; root knights and Cinder Castellans use Faultline; the Hollow
Bellkeeper alternates its radial toll with a Hollow Star. The original elemental
spells remain available.

Ordinary adventure attacks are declared in `cpp/engine/enemy_attacks.def`:
physical bites/lunges, melee swings, aimed slams, arrows, and elemental casts.
`CombatSystem` uses the same profile as locomotion and attack markers. Windup,
attack, and recovery sprite poses follow replicated phase progress. Ordinary
melee resolves on its contact frame and cannot damage through walls. Death clips
advance before the corpse is removed. `scripts/author-enemy-art.mjs` rebuilds the
frost giant, cinderjaw dragon, mummy, lava toad, guard, and hunter sprite sets.

Frost giants plant their feet for three committed attacks: a ninety-tick frost
stream, a ground-targeted smash with a sixteen-cell crater and physical debris,
and a twelve-cell ice spear that fractures and freezes its impact site. The
stream emits thirty overlapping frost pulses. Each attack has a distinct windup
and recovery; the spear visibly grows in the giant's hands before launch. Sprite
shoulders sit behind the head and collar, and the smash reaches the ground on
its contact frame. Windup, attack, and recovery clips contain three ordered
segments for breath, smash, and spear; the renderer selects the matching segment.
The giant steps through its weight shift and fractures into falling ice plates on death. `node scripts/author-enemy-art.mjs --only FROST_GIANT` rebuilds
just this sprite set. `frost-giant-e2e` captures the attacks through the WebGL
presentation path.

Cinderjaw dragons are large grounded skeletal dragons confined to bone-highlands surface
habitats. Surface entry checks the entire actor footprint and scans nearby
loaded ground heights so broad creatures can stand on slopes and fossil ledges.
Their cycle favors a crushing bite and a committed rush, followed by
a 96-tick fire stream (32 slow, overlapping pulses) and a long recovery. The
84×56 half-cell sprite articulates four legs, swept skull horns, open finger-bone
wings, ribs and a vertebral tail; an ember heart glows within the cage. Fire pulses emerge from
the mouth, retain ownership through checkpoints, and ignite open air at impact
without excavating stone. The dragon tolerates fire and drops a cinderjaw fang.
`node scripts/author-enemy-art.mjs --only BONE_DINOSAUR` rebuilds its eight clips;
`dinosaur` checks habitat, combat and persistence, and `dinosaur-e2e` captures
both melee attacks, the flame stream, burning terrain, and a full sprite atlas.

Winterbreath (309) sustains the frost giant's overlapping frost pulses while
held. It chills creatures, freezes water, and lays a two-cell ice skin against struck surfaces through component-aware
edits. The skin preserves its substrate and leaves occupied actor cells clear.
Frost breath and ice spears use distinct replicated projectile kinds with saved
lifetimes and ownership. Cindermaw (310) lobs a molten glob with a
bounded real-lava deposit; lingering lava also threatens its player caster.
Both use the shared rune, inventory, checkpoint, and render paths and can drop
from their associated creatures. Lava toads tolerate fire and lava contact.

Spell launches and the rendered wand share `MagicSystem::wandPose`, including
its hand anchor, aim direction and crystal tip. The caster-to-tip segment is
checked for terrain so a wand cannot fire through a nearby wall. A direct
lightning arc follows the rendered wand between confirmed pulses; its contact
endpoint remains authoritative. Lightning flags occupy the arc's `rotation`
snapshot field.

Projectile runes have reach suited to distant targets: Ember 160 cells, Rime
144, Gale 112, Stonebreak 104, Briar 128, Prism Choir 168, Hollow Star 144 and
Cindermaw 128. Faultline travels 96 cells at a steady eruption spacing;
Winterbreath reaches 80 cells. Lumen heals its caster.

Sparks (311) sustains one focused blue-white lightning arc with a 96-cell reach.
It hits immediately and stops at the first actor or solid terrain. Bounce reflects
the arc twice from terrain, sharing its range across all segments; only the final
segment delivers connected spells. Winterbreath pulses also ricochet with Bounce. Contact refreshes
a 24-tick Shocked stun and a 120-tick Electrified effect (40% slow, 2 damage every
30 ticks). Protected residents and the caster are exempt. A six-second crackle loop layers short recorded arcs, irregular snaps and a
quiet noise bed, with a brighter contact sound and a short release envelope.
The bolt uses a half-cell world pixel grid and hard-edged colors. Sparks and Winterbreath each cost one mana per pulse
(20 per second before regeneration). Their unpaid held recipes are transient
input state; checkpoints preserve already emitted projectiles and reset holds.

Lodge coffers contain runes and wand upgrades, including Sparks in the first
coffer and Winterbreath in the second. Procedural village chests each contain
one rune from the full twelve-rune pool and one of the nine upgrades, selected
by stable building identity. Loot is generated once and follows ordinary chest
transfer, packing, streaming, and checkpoint rules.

`cpp/engine/enemy_drops.def` assigns a guaranteed signature trophy and an optional
weapon, rune, or cordial to each adventure hostile. Bosses guarantee their listed
reward and three trophies. Trophies are droppable, stack to 99, persist in
checkpoints, and are reserved for future crafting. `content/equipment.js` owns
names and lore; `gearArt.js` supplies the shared inventory and ground-drop art.
Use `node scripts/run-tests.mjs --only enemy-ecology,adventure-combat,spell-diversity,survival-spawn-context,enemy-combat-e2e`
for the focused combat, ecology, loot, streaming, and browser checks.
