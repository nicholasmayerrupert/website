# Sand engine

The site uses the same falling-sand runtime for the creative home-page hero and
the IRIS campaign at `/game`. The campaign begins aboard the field ship Kestrel
and mounts a survival deployment only after the player selects a mission and
loadout. `/game?sandbox` bypasses the campaign shell and opens the direct
survival sandbox.

The simulation, WebGL2 renderer, camera, input policy, tools, actors, authored
missions, and world streaming run in C++ compiled to WebAssembly. JavaScript
owns browser lifecycle, canvas sizing, raw DOM events, audio presentation,
workers, WebSocket transport, and the ship/debrief presentation.

The runtime ships as a framework-free `<sand-game>` Web Component. React only
mounts that element on this site.

## Runtime topology

Offline creative, survival sandbox, and campaign deployments use two engine
instances:

- An authority worker simulates cells, actors, tools, inventory, and streaming.
- A main-thread presentation engine applies backpressured world diffs and actor
  snapshots, renders WebGL, and predicts only the local survival player.

Only one authority packet is in flight. A full snapshot is used for startup,
resize, and streaming; ordinary turns send accumulated diffs. The presentation
mirror does not reconstruct static components because it never simulates them.
Local items and projectiles cross the worker boundary as packed transferable
buffers, and unchanged render buffers are not recopied into WebAssembly between
actor snapshots.

Direct survival multiplayer replaces the authority worker with
`scripts/sand-server.mjs`. Clients send intents, apply authoritative state, and
reconcile local-player prediction. Authored campaign deployments use the offline
authority worker and do not show the multiplayer connect panel.

## IRIS campaign

`/game` is the mission deck for IRIS — Interstellar Rescue & Intervention
Service. The player deploys from Kestrel with the bound blast gun, an iron
mining tool, bounded material packs, and one unlocked enemy weapon recovered
from an operation. Completing an operation unlocks the next planet. Aborting
returns to the mission deck and failure opens a debrief; neither commits terrain
progress.

The campaign contains three sequential operations:

| Order | Planet | Mission | Authoritative objective sequence |
| --- | --- | --- | --- |
| 1 | Earth, 1.00 G | Greenfall Recovery (`greenfall-recovery`; tracker: Operation Greenfall) | Clear three demolition crew members; tag three surveyors with the rescue beam; reach the surface beacon. |
| 2 | Moon, 0.33 G | Silent Quarry (`silent-quarry`; tracker: Operation Silent Quarry) | Disable two shield anchors in separate mine branches; defeat the Quarry Foreman; reach the emergency pickup point. |
| 3 | Mars, 0.76 G | Red Furnace (`red-furnace`; tracker: Operation Red Furnace) | Disable three reactor anchors; defeat the Reactor Warden; breach the reactor core; escape to the surface pickup point. |

`MissionSystem` in `cpp/engine/missions.hpp` and
`cpp/engine/missions_impl.inc` owns live objective state, scripted actors,
safe actor placement, stage transitions, failure, extraction threat, completion,
and recovered-weapon reporting. Objective and extraction positions use absolute
world coordinates and remain stable across streaming. A mission starts only when
its required planet matches the engine planet. Player death fails every operation;
killing a Greenfall surveyor also fails that operation. Extraction immediately
opens a visible reinforcement breach and schedules additional habitat-valid
waves while the player returns; breaching the Red Furnace core also destabilizes
its surrounding terrain.

The worker sends packed mission and objective snapshots to the main thread. The
embed presents those snapshots as the mission tracker and world-space markers,
then emits lifecycle events for the React campaign shell. JavaScript never
duplicates objective progression.

`campaign/missions.js` owns ship-facing briefing text, mission order, loadout
budgets, and the mapping from recovered weapons to deployment stacks.
`campaign/campaignSave.js` validates the versioned `sand-campaign-v1`
local-storage record. It persists completed mission IDs, preferred loadouts,
unlocked weapons, and best times. An interrupted run stores only its mission,
seed, and normalized loadout; it does not serialize terrain.

The Kestrel remains fully walkable while its mission console is closed. Nearby
crew have world-space `TALK` controls, and Commander Vale's conversation is the
only route to the mission selector. The viewport-bounded console keeps
deployment controls visible above its scrolling briefing/loadout body. The
tapered hull contains non-blocking background-layer engineering, medbay,
transport, armory, command, hydroponics, galley, and archive stations while the
foreground main-deck route stays clear. Falling below the hull triggers a short
automatic transporter recovery. The ship runs the same two-layer cellular and
rigid-body physics as planetary deployments. Explosive weapons, TNT, reactions,
and bore cuts can all alter its foreground and background. A compact central
frame anchors the connected vessel; severed pieces enter the rigid-body system.
Maximum-emission `LIGHT` component panels illuminate both authored decks.

## Planets and gravity

Planet identity is an engine-construction property and is immutable for that
engine's lifetime. The `<sand-game>` element reads `planet`, `world-seed`,
`mission`, and `loadout` when it connects; recreate the element to change any of
them. Planet and seed together select deterministic terrain and a matching
planetary backdrop.

Moon and Mars use separate constructed-landmark catalogues as well as separate
terrain, cave, and surface-formation fields. Lunar exploration crosses mineral
spire fields, observatories, helium-3 mass drivers, and far-side relay
monasteries. Martian exploration crosses weathered fins and hoodoos, greenhouse
arcologies, industrial refineries, and armored canyon foundries. Each complex
has broad grounded foundations, a large surface silhouette, and three furnished,
player-clear underground decks.

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
hot paths at one layer. A world tick steps foreground, then background, then runs
cross-layer reactions and transfer.

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

Worldgen version 3 is canonical in absolute coordinates: viewport size changes
only the loaded window, never terrain, biome, cave, structure, or resource
placement for a seed. Continuous temperature, moisture, elevation, and
ruggedness fields select surface biomes; narrow deterministic ecotones blend
their soil and vegetation instead of creating hard seams.

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
and a roofed well. Ruins and homes keep player-clear foreground routes while
their coordinated background walls carry furniture, murals, storage, machinery,
and plant life; underground archetypes include lost archives with book bays,
reading desks, maps, balconies, and lecterns. Deep caverns add furnace citadels,
crystal observatories, fossil conservatories, and hanging archives; their
foreground halls remain player-clear while the background carries hearths,
scaffolds, exhibits, shelves, lamps, and machinery. Coal and copper have compact
starter lodes near the original spawn; iron, gold, and environmental hazards
unlock progressively deeper.

`WorldContextSystem` exposes the semantic plan behind generated terrain at any
absolute coordinate: surface/cave biome, surface-relative depth, composable area
tags, stable feature identity and bounds, parent feature, and nested site role.
Worldgen and context queries share the village, child-building, mine, and
off-world-facility plan functions, so spawning can target a settlement, home,
mine gallery, or facility without inspecting mutable cell materials. These
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
seas, monuments, and background solidity. `npm run worldgen:atlas`
writes `bench/worldgen-atlas.png`, with foreground above background;
`npm run worldgen:structure-atlas` finds representative structures and renders
their actual composited cell grids to `bench/structure-atlas.png`.

Zoom changes both the visible cell count and the loaded-window dimensions. A
larger zoomed-out window costs more to simulate. The effective zoom floor is
limited by the device's WebGL texture dimensions rather than a fixed cell cap.

## Source map

- `cpp/sand.cpp`: unity translation unit and `Engine` composition.
- `cpp/engine/common.hpp`: shared types and constants.
- `cpp/engine/layer.hpp`: per-layer grids, caches, components, bodies, and stores.
- `cpp/engine/`: composed subsystem classes (most use a header plus an
  implementation include):
  audio, camera, components, crafting, creatures, explosives, GL presentation,
  growth, inventory, items, missions, net sync, player, projectiles, reactions,
  renderer, rigid bodies, terrain, tools, and semantic world context.
- `cpp/engine/world_context.hpp` and `world_context_impl.inc`: deterministic
  feature hierarchy and absolute-coordinate semantic queries.
- `cpp/engine/missions.hpp`, `missions.inc`, and `missions_impl.inc`: authored
  operation state, objectives, scripted actors, extraction, and snapshots.
- `cpp/engine/core.inc`: loose-material settling hot path.
- `cpp/engine/step.inc`: world-step coordinator and cross-layer transfer.
- `cpp/engine/rigid_impl.inc`: rigid-body operations; the hot solver is grouped
  into prepare/contact/substep/finalize includes and liquid coupling into
  domain/projection/solve/writeback includes without adding runtime boundaries.
- `cpp/engine/worldgen.inc`: groups deterministic terrain, surface/deep/off-world
  structure stamping under `worldgen_generation.inc`; loaded-window persistence,
  prefetch, shifting, and resize live separately in `world_streaming.inc`.
- `cpp/engine/abi.inc`: exported C ABI.
- `materials.schema.json`: material identity and generated behavior/render tables.
- `abi.schema.json`: packed ABI layouts and shared enums.
- `wasmBridge/engineFactory.js`: production JS adapter for the WASM ABI.
- `wasmBridge/testHooks.js`: test-only ABI adapters.
- `game/createSandGame.js`: browser runtime and presentation loop.
- `worker/`: offline authority worker and main-thread replica client.
- `net/`: multiplayer protocol, prediction, replication, and server authority.
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

Material or ABI schema changes:

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

## Materials and simulation

`materials.schema.json` is the source of truth for IDs, class, movement kind,
density, durability, flags, color, transparency, emission, and render animation.
Existing numeric IDs are persistent save/network data and must not be renumbered.

Loose powder, liquid, and gas cells live directly in the grid. Static rigid
materials share one component registry. Free bodies stamp their real material
into the grid and are distinguished by `bodyOwner`. Any unsupported inert
structural assembly converts into a continuous rigid body; active growth sources
and live TNT fuses remain in their owning subsystem until that activity ends.
Mixed assemblies retain a per-cell material map, so ore, masonry, timber,
foliage, and ice rotate together without losing their identities. Foreground and
background halves released by the same bonded structural break become one
cross-layer body with a shared pose and combined collision shape.

Creative and survival placement makes each connected structural island static
when it touches existing static structure. Otherwise it becomes a body, welding
to every same-layer body it touches or falling freely when unsupported. Blast
debris opts out of this placement weld.

Component-backed bodies bake after sleeping with direct contact to a grounded
static solid. A mixed body becomes isolated, assembly-tagged material components:
the component contact graph retains the original object without merging its
stone, timber, ice, or plants into adjacent same-material terrain. Cuts rebuild
connectivity, so separated pieces detach independently. Both halves of a
cross-layer body bake with one assembly tag. Buoyancy and loose-medium
displacement are owned by the rigid-body solver. A body floating without
grounded-solid contact can sleep but does not bake, and the generic `RIGID` tool
material never bakes. Live blast rubble is non-structural and yields when
descending terrain reaches it.

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

Reactions are routed through generated flags where possible:

- Fire and lava ignite `flammable` cells.
- Acid dissolves `dissolvable` cells.
- Water, brine, ice, snow, salt, and lava handle freezing, melting, and quenching.
  Static and free-body ice freeze water in their own layer and at co-occupied
  cells in the adjacent layer. Water frozen by a free body extends that body's
  occupancy; cross-layer growth promotes a single-layer body to a shared-pose
  foreground/background body.
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
Fronts spanning at most six regions finish atomically, as do due fronts of at
most 2,048 cells. Broader fronts consume one compact six-by-two-region window per
tick until their live backlog drains. Waiting TNT remains visible and simulated,
while every consumed region immediately runs its crater representative.
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
remain short-lived and visual-only. Multiplayer replicates only collectible
items.

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
immediate manual respawning at a safe original-spawn location are
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

Projectile kind, fuse, and rotation plus creature attack state, progress, and
buffer-local aim are packed into the ABI snapshots; the worker mirror restores
that aim to the creature's absolute-world state. The server and worker transport
those authoritative snapshots rather than duplicating weapon or enemy policy in
JavaScript.

Creatures use absolute-world poses so they survive streaming. Off-window
creatures hibernate, natural populations are capped locally and globally, and
explicit spawn eggs bypass natural-spawn caps. Minnows, pike, foxes, hares,
crawlers, moles, and birds enter quietly on an ambient cadence, use a three-actor
share of the eight-actor natural cap, and retain material-aware water, surface,
cave, or air habitat requirements.
Survival encounters spend a shared deterministic threat budget at a paced
two-second cadence: habitat-valid entries beyond the real viewport margin are
preferred, while an audible, replicated 0.9–1.4 second breach portal telegraphs
the visible fallback before its reserved enemy becomes active. All three surface
combatants can appear in any surface biome and both cave combatants can appear
in any cave biome. Biomes and generated structures adjust their weights:
dynamiteers favor open terrain and settlements, mortarmen favor desert and
swamp, wasps favor forests, jungles, and swamps, bore sentinels favor mines and
geode/fossil depths, and minigunners favor mines, facilities, and
crystal/magma/void depths. Village interiors remain excluded from combat
spawning.

Earth villages populate independently of the combat cap. Each material-valid
building interior has one deterministic resident site and each village has one
outdoor commons site, capped at twelve loaded villagers. Site identity follows
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
| `Q` | Placement/mining footprint | — |
| Pointer | Aim and use selected hand, tool, block, or weapon | Paint, draft, erase, or spawn |
| `+`, `-`, `0` | Zoom in/out/reset | Zoom in/out/reset |

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
rates. Glass transmits skylight and local light with mild attenuation.
Jetpack exhaust, raised wards, and explosive or energy projectiles contribute a
capped set of render-only light sources to the same terrain-aware flood as fire
and lava. Their cell-quantized motion uses the existing throttled light solve, so
they illuminate walls and both layers without entering saves, networking, or the
simulation checksum.

Bare hands, mining tools, and placeable blocks show the selected square footprint
at the pointer. Equipping a weapon hides both the footprint and the legacy
diamond tool preview so the weapon aim remains visually unambiguous.

The render-only day/night cycle drives the sky and skylight but not simulation or
network state. Creative mode can scrub and hold the cycle.

The authority emits bounded semantic sound events. `audio/sandAudio.js` owns
samples, synthesis, spatialization, loops, cooldowns, browser activation, mute,
and visibility. Player-facing follows horizontal cursor aim rather than movement,
so backpedaling preserves the aimed sprite and weapon direction. Jetpack thrust
uses layered body/hiss loops with ignition and release, while the raised ward has
an activation transient, sustained resonant bed, impact, and break cues. Weapon
reports layer compact CC0 recordings with synthesized pressure cracks, body,
reflections, and mechanical action. Every projectile detonation bypasses the
terrain-TNT chain cooldown and plays the same complete effect, runtime-mixed from
all three recorded TNT layers into one uncapped weapon voice; cluster volleys
therefore sound like sixteen staggered TNT blasts without tripling source count.
Transporter transitions and successful rescue-beam tags share a distinct energy
cue.
Audio asset provenance is in
`audio/assets/README.md`.

## Multiplayer

Run the authoritative server with:

```sh
npm run sand:server
```

Then connect a survival client to `ws://localhost:5191`. Relevant modules:

- `net/protocol.js`: validated wire messages and builders.
- `net/server/host.js`: transport-independent player/input authority.
- `net/server/stateSync.js`: actor, inventory, and item replication.
- `net/server/worldEncode.js` and `net/worldSync.js`: full/diff world transfer.
- `net/server/worldWindow.js`: shared streamed authority window.
- `net/gameNet.js`: browser transport and replica application.
- `net/predict.js`: local-player prediction and reconciliation.

The server keeps one chunk-aligned window around the connected player group.
Widely separated players expand it, subject to protocol dimension and
eight-million-cell limits. A window move sends an offset-aware full snapshot;
ordinary ticks send diffs and hashes. Clients request resynchronization after a
hash mismatch.

The host binds identity to the socket, validates every intent after decoding,
rate-limits input, clamps aim, and never accepts client world edits.

`scripts/dev-multiplayer-server.mjs` is a relay used only by relay tests and
experiments; it is not the authoritative game server.

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
interaction, mission/planet validation, extraction, and recovered equipment.
The planet-gravity test covers deterministic planet terrain and the Earth >
Mars > Moon fall ordering. The campaign browser suite covers Kestrel and all
three deployment configurations.

`scripts/test-manifest.mjs` is the source of truth for executable test entries.
The runner checks that every `*-test.mjs`, `*-e2e.mjs`, and `*-repro.mjs` file is
declared before running suites. Headless tests use two workers; browser suites
stay serial because their real-time rendering checks are contention-sensitive.
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
kinematic body contacts through player/creature populations. Pure refactors must
preserve deterministic checksums. See `PERF.md` for metric ownership and focused
commands.

## Adding a material

1. Add the material to `materials.schema.json` without renumbering existing IDs.
2. Run `npm run generate`.
3. Add special movement or reaction code only if existing kinds and flags do not
   cover the behavior.
4. Rebuild WASM.
5. Run material tests and the relevant engine benchmark.
