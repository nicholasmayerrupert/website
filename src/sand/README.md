# Sand engine

The site runs the same falling-sand game in two places: creative mode in the
home-page hero and survival mode at `/game`. The simulation, WebGL2 renderer,
camera, input policy, tools, actors, and world streaming run in C++ compiled to
WebAssembly. JavaScript owns browser lifecycle, canvas sizing, raw DOM events,
audio presentation, workers, and WebSocket transport.

The runtime ships as a framework-free `<sand-game>` Web Component. React only
mounts that element on this site.

## Runtime topology

Offline creative and survival use two engine instances:

- An authority worker simulates cells, actors, tools, inventory, and streaming.
- A main-thread presentation engine applies backpressured world diffs and actor
  snapshots, renders WebGL, and predicts only the local survival player.

Only one authority packet is in flight. A full snapshot is used for startup,
resize, and streaming; ordinary turns send accumulated diffs. The presentation
mirror does not reconstruct static components because it never simulates them.

Multiplayer replaces the authority worker with `scripts/sand-server.mjs`. Clients
send intents, apply authoritative state, and reconcile local-player prediction.

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

Zoom changes both the visible cell count and the loaded-window dimensions. A
larger zoomed-out window costs more to simulate. The effective zoom floor is
limited by the device's WebGL texture dimensions rather than a fixed cell cap.

## Source map

- `cpp/sand.cpp`: unity translation unit and `Engine` composition.
- `cpp/engine/common.hpp`: shared types and constants.
- `cpp/engine/layer.hpp`: per-layer grids, caches, components, bodies, and stores.
- `cpp/engine/`: eighteen composed subsystem classes (most use a header plus an
  implementation include):
  audio, camera, components, crafting, creatures, explosives, GL presentation,
  growth, inventory, items, net sync, player, projectiles, reactions, renderer,
  rigid bodies, terrain, and tools.
- `cpp/engine/core.inc`: loose-material settling hot path.
- `cpp/engine/step.inc`: world-step coordinator and cross-layer transfer.
- `cpp/engine/worldgen.inc`: streaming, chunk persistence, and terrain fills.
- `cpp/engine/abi.inc`: exported C ABI.
- `materials.schema.json`: material identity and generated behavior/render tables.
- `abi.schema.json`: packed ABI layouts and shared enums.
- `wasmBridge/engineFactory.js`: production JS adapter for the WASM ABI.
- `wasmBridge/testHooks.js`: test-only ABI adapters.
- `game/createSandGame.js`: browser runtime and presentation loop.
- `worker/`: offline authority worker and main-thread replica client.
- `net/`: multiplayer protocol, prediction, replication, and server authority.
- `embed/`: the Web Component and framework-free UI.
- `audio/sandAudio.js`: Web Audio mixer for semantic engine events.

`MATERIAL_MODEL.md`, `PERF.md`, `GROUNDING_INCREMENTAL.md`,
`SUPPORT_GRAPH.md`, and `RIGID_COLLISION.md` document the main invariants and
performance-sensitive systems.

## Building generated sources

Material or ABI schema changes:

```sh
npm run generate
```

C++ changes:

```sh
source wasm/emenv.sh
wasm/build.sh
```

The WASM loader, binary, and `src/sand/wasm/build-info.json` are committed so a
normal site build does not require Emscripten. `npm run sand:doctor` checks their
provenance and generated-source freshness. `wasm/build.sh --dev` enables the
post-step component/body invariant validator.

## Materials and simulation

`materials.schema.json` is the source of truth for IDs, class, movement kind,
density, durability, component group, flags, color, transparency, emission, and
render animation. Existing numeric IDs are persistent save/network data and must
not be renumbered.

Loose powder, liquid, and gas cells live directly in the grid. Static rigid
materials live in components. Free bodies stamp their real material into the
grid and are distinguished by `bodyOwner`; supported static forms bake back into
components when they settle.

Reactions are routed through generated flags where possible:

- Fire and lava ignite `flammable` cells.
- Acid dissolves `dissolvable` cells.
- Water, brine, ice, snow, salt, and lava handle freezing, melting, and quenching.
- Growth owns plant and mycelium expansion.
- Explosives own TNT/methane fuses, staged blasts, debris, shock, and chaining.

TNT uses precomputed radius stencils, overlapping-blast energy dominance, batched
component repair, and sparse cave aftermath carry. The accepted large-cave
optimization can change gas/smoke/debris RNG outcomes by removing redundant
dirty-row RNG draws; fuse timing and crater geometry remain unchanged.

## Actors and survival

Players, creatures, items, and projectiles are non-grid actors. Free rigid bodies
are entities whose occupancy is stamped into the material grid.
Players and other real-time actors advance on a deterministic 60 Hz actor clock;
cellular world work is attempted at most once per presentation frame and does not
accumulate catch-up debt.
The offline worker transfers dropped items and cosmetic debris to the renderer as
one packed buffer at actor cadence. Nearby identical collectible materials
coagulate into normal inventory-sized stacks, while independent debris flecks
remain short-lived and visual-only. Multiplayer continues to replicate only
collectible items.

`/game` is explosive survival. Players spawn with a lower-cadence automatic
blast gun whose swept, high-velocity rounds detonate on the first liquid, solid,
or creature hit.
Dynamiteers throw wide, high-damage bouncing charges; bore sentinels telegraph,
lock, and then erase a thick line through both simulated layers. Caustic mortarmen lob large,
double-payload terrain-poisoning acid shells; cluster wasps launch slow heavy
carriers that split into eight short-fused, independently scattering
mini-dynamites; and minigunners commit their aim before saturating that line with
long bursts of rapid, pinprick explosive rounds.
Blasts and bore cuts damage
and knock back actors as well as changing terrain. Health, dropped equipment,
the articulated player animation, an airborne rechargeable jetpack, and
immediate manual respawning at a safe original-spawn location remain
authoritative in the engine. The rendered
jetpack exposes its fuel level and animates twin thrust plumes without changing
that authority. Holding `F` raises a cursor-facing 120-degree ward with 200
durability; directional hits drain the ward instead of player health, and its
meter quickly recharges after combat. Mining, material pickups,
block placement, the 36-slot inventory, 1x1–10x10 tool-size presets (10x10 by
default), and crafting remain
part of survival: the starter mining tool is iron-tier, and defeated
demolition crews can also drop their weapons into
that same inventory. Captured dynamite satchels carry 10 throws, bore cannons 15
beams, acid mortars 20 shells, cluster launchers 15 carriers, and miniguns 250
rounds. Picking up a duplicate weapon merges its full ammo load into the existing
weapon, while the bound starter blast gun remains unlimited. The starting
universal dig tool cuts ordinary terrain at
roughly thirteen times its previous rate without accelerating bare hands or crafted
material-specific picks.

Projectile kind, fuse, and rotation plus creature attack state, progress, and
buffer-local aim are packed into the ABI snapshots; the worker mirror restores
that aim to the creature's absolute-world state. The server and worker transport
those authoritative snapshots rather than duplicating weapon or enemy policy in
JavaScript.

Creatures use absolute-world poses so they survive streaming. Off-window
creatures hibernate, natural populations are capped locally and globally, and
explicit spawn eggs bypass natural-spawn caps. Minnows, pike, foxes, hares,
crawlers, moles, and birds are currently retired from natural spawning but remain
available through their creative eggs.
Survival encounters spend a shared deterministic threat budget at a paced
two-second cadence: habitat-valid entries beyond the real viewport margin are
preferred, while an audible, replicated 0.9–1.4 second breach portal telegraphs
the visible fallback before its reserved enemy becomes active.

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
reflections, and mechanical action. Audio asset provenance is in
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
```

`scripts/test-manifest.mjs` is the source of truth for executable test entries.
The runner checks that every `*-test.mjs`, `*-e2e.mjs`, and `*-repro.mjs` file is
declared before running suites. Browser suites allocate strict ports and have
per-suite timeouts.

For engine or renderer changes, benchmark before and after:

```sh
node scripts/bench-sand.mjs --compare bench/baseline.json
node scripts/bench-pan.mjs --compare bench/pan-baseline.json
```

Use the engine benchmark for simulation/render-fill/streaming changes and the pan
benchmark for WebGL presentation, pointer mapping, and flicker. Pure refactors
must preserve deterministic checksums. See `PERF.md` for metric ownership and
focused commands.

## Adding a material

1. Add the material to `materials.schema.json` without renumbering existing IDs.
2. Run `npm run generate`.
3. Add special movement or reaction code only if existing kinds and flags do not
   cover the behavior.
4. Rebuild WASM.
5. Run material tests and the relevant engine benchmark.
