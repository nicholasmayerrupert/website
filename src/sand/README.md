# Sand engine

A falling-sand / cellular-automaton simulation that runs in the home-page hero
(creative mode, via `src/Hero.jsx`) and full-screen at `/game` (survival mode,
via `src/GamePage.jsx`). The simulation, **rendering (WebGL2 compositing)**, the **view camera**,
the **input policy**, tool/pointer semantics, and world streaming all run in C++
compiled to WebAssembly. JavaScript is a thin browser shell: it sizes the canvas,
runs the RAF with separate actor/world clocks, forwards raw DOM events (keys/pointer/resize) to the
engine, and carries worker/WebSocket transport. In offline creative mode a
dedicated worker owns cellular simulation, streaming, and tool writes; the main
thread keeps a render-only WASM mirror and applies one backpressured diff per RAF.
It no longer touches
pixels or owns the camera. The whole thing ships as a framework-free
`<sand-game>` Web Component; a tiny React wrapper mounts that element on this site.

## Two layers (foreground + background)

The engine simulates **two** independent grids — a foreground (`fg`) and a
background (`bg`) — both fully simulated (powder/liquid/gas settling, stone/plant/
ice components, fire/acid/lava/ice reactions, plant growth, free rigid bodies, and
generated terrain). They are a "2-deep" world: both layers generate from the SAME
seed, so the solid surface lines up and stays stable, and they diverge once you
dig/edit one of them. The background renders **behind** the foreground, **darker**
(empty foreground cells are transparent, so it shows through gaps/dug holes).

The main cross-layer interaction: a **powder or liquid** that is stuck in its
layer (can't move down) moves to the other layer at the same cell when it can keep
falling there; a **gas** that is blocked from rising does the inverse, moving to
an empty same-cell target in the other layer only when it can keep rising there.
The "can keep moving" rule prevents oscillation. Solids/components/bodies never
transfer.

Implementation: per-cell simulation state lives in `struct Layer` (layer.hpp);
the Engine holds `fg`/`bg` + an active-layer pointer `L` (`useLayer()` just
repoints `L`; the hot paths read `L->` directly, with true function-local
pointer hoists in the flood/scan loops). `step()` runs `stepLayer(&fg)` then
`stepLayer(&bg)` under one tick, then `transferPass()`. The foreground is stepped first so a single-layer scene
(background empty/disabled) is byte-identical to a one-grid build. Networking
(netsync.inc) serializes/hashes both grids in one opaque blob (no JS/protocol
change). **Right-click** in creative draw mode paints the selected material into the
background (left-click stays foreground); survival-mode RMB-mining is unchanged.

**Perf:** with both layers active (e.g. continuous panning, which streams + settles
both) the per-step cost is roughly 2× a single layer. An idle background (settled
terrain) is skipped, so a static scene costs about the same as one layer.

  `cpp/engine/tools.hpp`     brush/draft/seed primitives + the tool state machine
  `cpp/engine/renderer.hpp`  material -> RGBA pixel generation (grain + animation)
  `cpp/engine/materials.generated.hpp`  ids/kinds/tables, generated from the schema

## Files

- `cpp/` — the C++ engine. Every simulation subsystem is a **named class**
  composed by the Engine (fifteen: ViewCamera, NetSync, TerrainGen, Renderer,
  GLPresenter, ItemSystem, InventorySystem, PlayerSystem, CreatureSystem, ToolSystem,
  ReactionSystem, ExplosivesSystem, GrowthSystem, ComponentSystem,
  RigidBodySystem). Each lives as `engine/<name>.hpp` (state + interface, with
  an `Engine&` back-reference) plus `engine/<name>_impl.inc` (method bodies,
  included from `sand.cpp` after the Engine definition — still one unity TU so
  emcc's cross-inlining stays free). The Engine itself keeps only the
  coordinator role: the two Layers, the shared sim RNG, the step pipeline
  (`step.inc`), the per-cell settle core (`core.inc` — deliberately inline,
  it IS the falling-sand engine's essence), worldgen streaming orchestration
  (`worldgen.inc`), and thin composition/shim blocks per subsystem. The
  JS<->WASM contract is generated from `abi.schema.json`
  (`abi.generated.{hpp,js}`); `wasm/build.sh --dev` compiles in a post-step
  invariant validator (aborts loudly on a broken component/body invariant).
  - `cpp/engine/gl_shared.hpp` + `gl.inc` — the WebGL2 compositor. `render.inc`
    still generates the cell pixels on the CPU; `gl.inc` uploads them into a
    `cols×rows` texture and draws the visible window (nearest upscale), the 1px
    gutter grid, the player overlay, and the draft preview. The sub-cell pan
    offset is snapped to whole device px here (the flicker fix). A world shift
    slides the texture with `glBlitFramebuffer` instead of repainting.
  - `cpp/engine/camera.inc` — the view camera (pan/bounds/follow), the
    pointer→aim-cell mapping, the player input bitmask, and the fixed-tick pan /
    world-stream drivers. JS just forwards held keys + the pointer.
- `wasm/` — `build.sh` compiles `cpp/` to `sandEngine.js` (a single self-contained
  ES module with the wasm embedded; built with WebGL2/`FULL_ES3`) and writes
  `src/sand/wasm/build-info.json` provenance. The output is committed, so a
  normal `npm run build` never needs the C++ toolchain.
- `wasmBridge/engineFactory.js` — loads the wasm module and exposes `createEngineWasm()`, the
  simulation+render+camera handle. Call `initSandWasm()` once and wait for it
  before creating an engine. The grid lives in wasm memory (zero-copy view).
- `materials.schema.json` — the single source of truth for material identity
  (ids, kinds, density, mobility, colors, render params). Run `npm run generate`
  to emit `materials.generated.js` and `cpp/engine/materials.generated.hpp`.
- `materials.js` — re-exports the generated registry and derives `MAT.<NAME>`.
- `MATERIAL_MODEL.md` — explains material IDs, classes, kinds, flags, component
  groups, and free-body ownership.
- `game/createSandGame.js` — the framework-agnostic browser shell. It creates the
  canvas, hands it to the engine for a WebGL2 context, runs the 60 Hz actor clock
  plus the no-catch-up world gate, forwards DOM events (`engine.inputKey/inputPointer/...`), drives
  `engine.glRenderFrame()` and `engine.streamWorld()`, and carries the net
  transport. No pixels, no camera math, no React.
- `worker/` — the offline creative world runner and its main-thread client. The
  worker sends a full RLE snapshot only for initialization, resize, or streaming;
  ordinary turns send accumulated diffs with one packet in flight. The main
  render mirror deliberately skips component reconstruction. Survival actors and
  multiplayer remain on their existing authoritative paths.
- `embed/sandGame.js` — the `<sand-game>` Web Component: a shadow root holding the
  sim canvas + the vanilla palette. Drop-in for any page (`<script type=module>` +
  the tag); draw-mode changes are a `sand:drawmodechange` CustomEvent.
  `npm run build:embed` bundles it to one self-contained `dist-embed/sand-game.js`.
- `embed/toolPalette.js` — the framework-free tool palette (plain DOM + injected
  `<style>`, no Tailwind).
- `react/SandGame.jsx` — a ~15-line React shim that mounts `<sand-game>` and
  bridges its CustomEvent to a prop. `src/Hero.jsx` renders `<SandGame>`;
  `src/GamePage.jsx` uses the `<sand-game>` element directly.

## Building the C++

You only need this if you change anything under `cpp/`:

```
source wasm/emenv.sh   # puts emcc on PATH (Emscripten SDK under ~/Nick/emsdk)
wasm/build.sh          # regenerates src/sand/wasm/sandEngine.js
```

The build also writes `src/sand/wasm/build-info.json` with output hashes, source
commit/dirty state, and Emscripten identity. `npm run sand:doctor` reports it.

## Players

Terraria-like player characters are simulated **in C++** (`cpp/engine/player.inc`)
and presented in JS. JS only collects a normalized input bitmask (`INPUT.*` in
`wasmBridge/engineFactory.js`, mirroring `enum PlayerInput`) plus an aim cell, forwards it with
`setPlayerInput(id, {bits, aimX, aimY, tool, seq})`, and reads `getPlayers()`
snapshots to draw an overlay. Physics is a deterministic fixed-timestep AABB
platformer (gravity, run/friction, edge-triggered jump, sub-cell-stepped
collision against solids/powders). Liquids remain pass-through cells but apply
drag, a capped fall speed, and jump/up swimming while submerged. Players and
items advance through `stepActors()` on a deterministic 60 Hz clock even when the
cellular world falls below 60 TPS; `stepWorld()` never catches up missed sand
ticks. The legacy `step()` composes both phases for tests/embedders. Players stay world-anchored across streaming
shifts. Determinism (no RNG) is what lets a fixed input stream replay identically
— the basis for server-authoritative multiplayer.

A local player is spawned by the engine on the surface and the camera follows it
from the JS runtime. **Play mode** (default) maps the keys to the character; **free-camera
mode** (`game.setPlayMode(false)`, used by the pan/flicker bench) pans the buffer
with WASD/arrows. The player overlay (AABB + facing eye) is drawn by the C++ GL
compositor from engine state; a networked client passes its host-snapshot players
to the engine to draw (`engine.glSetPlayers`).

### Controls (play mode)

| Keys | Action |
| --- | --- |
| `A` / `←`, `D` / `→` | move left / right (auto-climbs 1-cell ledges) |
| `W` / `↑` / `Space` | jump (only when grounded) |
| `S` / `↓` | down / crouch (placeholder) |
| `Shift` | run |
| mouse + `Draw` toggle | aim; LMB uses the selected tool, RMB mines — player-mediated, reach-limited (≤18 cells) and cooldown-throttled |

In free-camera mode the classic pointer tools (drafts + held paint/erase) are
used instead. Player tool policy (reach, cooldown, place-vs-mine, no building
inside your own body) lives in `cpp/engine/player.inc`.

## Creatures

Survival mode and the `/fps` diagnostics route have non-grid creatures simulated by `CreatureSystem`
(`cpp/engine/creatures.hpp` + `creatures_impl.inc`) on the same deterministic
actor clock as players and items. The species exercise reusable habitat and
locomotion combinations: minnows (water/brine-only wandering), pike
(aquatic predators that select the nearest prey creature, then a submerged
player), newts (surface enemies that walk and switch to swimming when
submerged), hares (hopping land animals), crawlers (hostile cave walkers), and
birds (airborne wanderers that avoid solids and liquids).

Each creature owns an AABB, health, velocity, facing, target id/type, attack and
hurt cooldowns, and an absolute-world pose. Absolute coordinates make creatures
stable across streaming shifts; off-window creatures hibernate and restore
without consuming actor time. `CREATURE_SPECIES` is the single table for
movement, sensing, combat, and `CreatureSpawnRule`. A spawn rule selects
region-time or continuous spawning and controls cadence, probability, habitat,
global active cap, local density radius/cap, and a min/max player distance band.
Continuous populations search the valid habitat around a live player, or around
the camera on `/fps`, so successful spawns appear in the loaded neighborhood
instead of elsewhere in the world buffer. The first valid representative seeds
immediately; replenishment is deliberately slow and is bounded by per-species,
same-species local, mixed-species local, and loaded-window caps. Region activation
remains available, is deterministic, and is recorded so revisiting a chunk cannot
duplicate its population.
Focus-based spawns also exclude the inner half of the current view: along the
candidate's direction, it must be beyond the halfway point from the player to
that screen edge (in addition to the species' fixed minimum distance).

Sprites are original two-frame pixel grids drawn by the C++ WebGL compositor,
with a health bar shown after damage. Player and creature sprite colors sample
the same computed foreground light field as nearby world cells. Survival mining
also checks creature hitboxes. Lethal contact damage returns the player to the
surface with brief spawn protection instead of leaving an invisible, disabled
actor. `/fps` enables hitbox outlines (cyan players, gold passive creatures, red
hostile creatures) and includes the active creature count in its HUD.
Multiplayer hosts replicate packed creature snapshots; clients render those
authoritative records without running creature AI locally.

### Zoom

In-game zoom (`+`/`−`/`0`, or the mobile zoom buttons) is a continuous scale on
logical cell size. The **loaded simulation window** (`cols×rows`) tracks the
current view plus stream margins: zoom out grows the buffer (more cells, higher
cost); zoom in shrinks it (cheaper `step`). World content survives via
`engine.resizeLoadedWindow` (tile/body stores). There is no hard zoom-out floor
— extreme zoom-out is allowed and will cost frames. Multiplayer clients keep the
host buffer size; their zoom is view-only within that window.

## Testing

```
npm run test          # sand + players + creatures + net protocol (headless, CI-friendly)
npm run test:sand     # node scripts/sand-test.mjs
npm run test:players  # node scripts/player-test.mjs
npm run test:creatures # node scripts/creature-test.mjs
npm run test:creatures-e2e # /fps spawn, animation, visibility, and hitbox pixels
npm run test:net      # node scripts/net-test.mjs
npm run test:e2e      # node scripts/player-e2e.mjs (headless Chromium gameplay)
npm run test:all      # npm run test && npm run build
```

`test:e2e` boots the dev server, drives the local player with real keyboard
events in headless Chromium (via the `playwright` library, like the pan bench),
and asserts spawn/grounding, input wiring, jump, dig, and camera-follow. It is
not in the required `npm run test` chain (it needs a browser), but is CI-runnable.

## Multiplayer

The networking layer lives in `src/sand/net/` and is transport-agnostic so it
unit-tests in Node (`test:net`) with no real socket:

- `protocol.js` — the JSON wire format (`input`/`snapshot`/`join`/`leave`/
  `ping`/`pong`), strict decode/validation, and message builders. Integer fields
  are preserved exactly; out-of-range/malformed messages decode to `null`.
- `client.js` — `SequenceTracker` (drops reordered-late/duplicate packets),
  `InputSequencer`, and `applyInputStream` (reduces a lossy/shuffled input stream
  to the strictly-increasing accepted set).

The production-oriented topology is **server-authoritative**:

```
browser <sand-game> clients
  -> input / inventory intents over WebSocket
scripts/sand-server.mjs
  -> C++/WASM Host + fixed-step engine
  -> world diffs, player snapshots, items, inventory, cursor
browser <sand-game> clients
```

- `scripts/sand-server.mjs` (`npm run sand:server`) — the authoritative headless
  server. It loads the WASM engine, owns the world, spawns one player per client,
  applies movement/tool/inventory intents, steps on a fixed timer, and broadcasts
  world diffs plus player/creature/item/inventory snapshots. Browsers are pure clients.
- `src/sand/net/host.js` — transport-free authority logic shared by the server and
  tests: player assignment, per-client input sequencing/rate limiting, validation,
  stepping, and snapshot creation.
- `src/sand/net/gameNet.js` — browser client glue wired into `createSandGame`.
  Offline, it is inert and the local browser engine runs single-player. Connected,
  it sends input/intents to `sand-server`, applies authoritative world diffs,
  predicts/reconciles only the local player, and renders server snapshots.
- `scripts/dev-multiplayer-server.mjs` — legacy/dev-only
  pure WebSocket relay. It tracks rooms and forwards messages; it does **not**
  simulate. Keep it for relay protocol tests and experiments, not as the main
  game authority.

To try the current authoritative path locally: `npm run sand:server`, then open
the site and join `ws://localhost:5191` from the multiplayer panel. `test:server`
checks the server round trip; `test:net` checks protocol/host/client logic in
process.

**World replication (Phase 6).** The host serializes its grid and the client
applies it so both see the same sand world:
- `cpp/engine/netsync.inc` — full snapshot (RLE over the grid) + dirty-rect diffs
  + a FNV grid hash, with apply functions; `net/worldSync.js` bridges them to the
  protocol (`world`/`diff` messages, base64).
- On join (or `resync`) the host sends a full snapshot; thereafter it streams
  per-step diffs. The client applies them, doesn't simulate the shared world
  itself (server-authoritative), and requests a `resync` when a diff's hash doesn't
  match (a dropped packet). `test:net` covers snapshot/diff/lost-diff-resync/
  join-in-progress; `mp-e2e.mjs` asserts the client's world matches the host and
  that a host dig replicates.
- **Limitation:** peers must share the same buffer size (window dimensions) — a
  client whose buffer differs keeps its own local world. Independent far-apart
  exploration isn't supported yet.

**Prediction + reconciliation (Phase 7).** `net/predict.js` lets the client
simulate its own player immediately (no input lag) and reconcile against the
host: it records each local input, and when an authoritative snapshot arrives it
snaps the player to the host state (`engine.setPlayerState`, including the hidden
`jumpReady`) and replays the inputs the host hasn't processed yet
(`engine.stepPlayerOnly` — one player, no world sim). Because the physics is
deterministic, prediction is exact and a mismatch converges in one correction;
render error is eased in (hard-snapped past a threshold). Reordered corrections
are ignored; a lost one is recovered by the next snapshot. `test:net` covers
zero-latency, ~100ms latency, mismatch convergence, reorder, and loss.

**Hardening (Phase 8).** The host never trusts a peer: clients send input only
(the protocol has no client→world-edit message, so a client cannot mutate the
host grid). `Host.applyInput` re-validates every field post-decode, clamps the
aim into the buffer (reach is additionally enforced in C++), and rate-limits each
client with a token bucket (default 90/s, burst 30) so a flood is dropped, not
simulated. Rooms are capped (`maxPlayers`, and the relay rejects an over-capacity
join). Disconnect removes the player. `test:net` covers room caps, field
validation, aim clamping, and rate limiting.

`sand-test` checks conservation, rigid components, reactions, growth, free rigid
bodies, tool/pointer policy, and that edits survive a world shift. `player-test`
covers spawn/snapshot, gravity, landing/grounded, thin-floor and wall collision,
jump gating, run+friction, and fixed-input determinism. Shared helpers live in
`scripts/sand-test-util.mjs`.

## Adding a material

`materials.schema.json` is the source of truth for material identity. Add the id,
color, density, kind, etc. there, then run `npm run generate`; it emits
`materials.generated.js` and `cpp/engine/materials.generated.hpp`. Rebuild the
wasm after changing the C++ tables. If it moves in a way no existing kind covers,
or reacts with other
materials, add that to the relevant `.inc` file. Ignition, dissolving, grounding,
and component registration are all driven off the schema `flags`/`componentGroup`,
so a material that reuses existing physics needs only a schema entry. Bumping past
the current `tableSize` (power-of-two headroom over the live ids) is fine — the
lookup tables and tests size off it.

## Material reactions (quick reference)

Local transforms live in `reactions.inc` (dispatched each layer step in
`step.inc`). Ignition and dissolving are **flag-driven**: fire and lava both ignite
any `flammable` cell, and acid eats any `dissolvable` cell — so the flag, not a
hardcoded id list, decides who reacts.

- **Fire**: water it touches turns to steam (and the fire is spent); ignites
  `flammable` neighbours (oil, gunpowder, the flammable plants — but NOT juicy
  cactus / wet mushrooms, which are flagged non-flammable); melts `SNOW` → water.
- **Oil**: flammable; a fire front whooshes along connected oil.
- **Gunpowder**: a fast fuse — catches on any flame with no roll and the burn front
  races through every adjacent grain, so a trail/pile deflagrates in a couple steps.
- **Acid**: bores through any `dissolvable` material (most solids), emitting acrid
  smoke ~half the time; decays as it works.
- **Lava**: ignites `flammable` neighbours; quenches against `WATER`/`ACID`/`BRINE`
  (→ steam) and hardens to stone; melts `SNOW` → water; rarely spits fire into air.
- **Ice**: melts to water next to fire/lava; slowly freezes adjacent `WATER` → ice.
- **Salt**: a de-icer/desiccant. Dissolves in `WATER` → **brine** (saltwater), and
  melts `ICE`/`SNOW` → brine on contact (the grain is spent).
- **Brine**: flows like water but is **freeze-immune** (the ice-freeze reaction only
  targets `WATER`), so salted meltwater never re-ices; still boils off on lava, and
  won't nourish plants (trees drink `WATER`), so saltwater kills crops.
- **TNT** (`explosives.inc`): lit by fire/lava (or a gunpowder fuse), it fuses then
  detonates a **`DURABILITY`-gated crater** — soft blocks blow up from farther out
  than hard ones. The blast scatters cosmetic particles, ejects rubble chunks (free
  bodies of the destroyed material that bake back into terrain), shoves nearby free
  bodies, and chains adjacent TNT. Each consumed TNT cell releases one aftermath
  cell: mostly acrid smoke, some steam, and a little fire. Works the same whether
  the TNT is a placed solid or a free TNT body.

## Rigid bodies that are real material (`rigid.inc` + the BODY-MATERIAL INVARIANT)

A free rigid body stamps its **real material** into the grid, so a stone body reads,
renders, mines, and reacts as `STONE`; `isBodyCell(k)` distinguishes it from static
terrain. A body whose material has a static form (stone-group, ice, or plant-family)
**bakes** into a normal component when it comes to rest; `RIGID` stays free forever.
Liquids provide buoyancy, so light bodies can rise/float in them. Powders/grains are
displaceable and provide one-way support: bodies and ungrounded solid components can
sink into them and settle, but grains never push solids upward. The cube tool spawns
a body of the selected solid (default `RIGID`); explosion debris is the other source.
See the invariant doc-block in `members.inc`.
