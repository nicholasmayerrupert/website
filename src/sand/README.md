# Sand engine

A falling-sand / cellular-automaton simulation that runs on the About section of
the site. The simulation, **rendering (WebGL2 compositing)**, the **view camera**,
the **input policy**, tool/pointer semantics, and world streaming all run in C++
compiled to WebAssembly. JavaScript is a thin browser shell: it sizes the canvas,
runs the RAF/fixed-step loop, forwards raw DOM events (keys/pointer/resize) to the
engine, and carries the WebSocket multiplayer transport. It no longer touches
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

The only cross-layer interaction: a **powder or liquid** that is stuck in its layer
(can't move down) moves to the other layer at the same cell when that cell is empty
there **and it can keep falling there** (the "can keep falling" rule prevents
oscillation). Gases and solids/components/bodies never transfer.

Implementation: per-cell simulation state lives in `struct Layer` (members.inc);
the Engine holds `fg`/`bg` + an active-layer pointer `L`, with raw-pointer mirrors
of the hot indexed buffers so the settle hot path is layer-agnostic (`useLayer()`
repoints them). `step()` runs `stepLayer(&fg)` then `stepLayer(&bg)` under one tick,
then `transferPass()`. The foreground is stepped first so a single-layer scene
(background empty/disabled) is byte-identical to a one-grid build. Networking
(netsync.inc) serializes/hashes both grids in one opaque blob (no JS/protocol
change). **Right-click** in creative draw mode paints the selected material into the
background (left-click stays foreground); survival-mode RMB-mining is unchanged.

**Perf:** with both layers active (e.g. continuous panning, which streams + settles
both) the per-step cost is roughly 2× a single layer. An idle background (settled
terrain) is skipped, so a static scene costs about the same as one layer.

  `cpp/engine/tools.inc`     brush/draft/seed primitives + the tool state machine
  `cpp/engine/render.inc`    material -> RGBA pixel generation (grain + animation)
  `cpp/engine/materials.generated.hpp`  ids/kinds/tables, generated from the schema

## Files

- `cpp/` — the C++ engine. `sand.cpp` pulls in one `.inc` file per subsystem
  (`engine/core.inc`, `components.inc`, `reactions.inc`, `growth.inc`,
  `rigid.inc`, `worldgen.inc`, `tools.inc`, `render.inc`, …) plus `common.hpp` for
  the shared types and material tables.
  - `cpp/engine/gl_shared.hpp` + `gl.inc` — the WebGL2 compositor. `render.inc`
    still generates the cell pixels on the CPU; `gl.inc` uploads them into a
    `cols×rows` texture and draws the visible window (nearest upscale), the 1px
    gutter grid, the player overlay, and the draft preview. The sub-cell pan
    offset is snapped to whole device px here (the flicker fix). A world shift
    slides the texture with `glBlitFramebuffer` instead of repainting.
  - `cpp/engine/camera.inc` — the view camera (pan/bounds/follow), the
    pointer→aim-cell mapping, the player input bitmask, and the per-frame pan /
    world-stream drivers. JS just forwards held keys + the pointer.
- `wasm/` — `build.sh` compiles `cpp/` to `sandEngine.js` (a single self-contained
  ES module with the wasm embedded; built with WebGL2/`FULL_ES3`). The output is
  committed, so a normal `npm run build` never needs the C++ toolchain.
- `engineWasm.js` — loads the wasm module and exposes `createEngineWasm()`, the
  simulation+render+camera handle. Call `initSandWasm()` once and wait for it
  before creating an engine. The grid lives in wasm memory (zero-copy view).
- `materials.schema.json` — the single source of truth for material identity
  (ids, kinds, density, mobility, colors, render params). Run `npm run generate`
  to regenerate `materials.generated.js` and `cpp/engine/materials.generated.hpp`.
- `materials.js` — re-exports the generated registry and derives `MAT.<NAME>`.
- `game/createSandGame.js` — the framework-agnostic browser shell. It creates the
  canvas, hands it to the engine for a WebGL2 context, runs the RAF/fixed-step
  loop, forwards DOM events (`engine.inputKey/inputPointer/...`), drives
  `engine.glRenderFrame()` and `engine.streamWorld()`, and carries the net
  transport. No pixels, no camera math, no React.
- `embed/sandGame.js` — the `<sand-game>` Web Component: a shadow root holding the
  sim canvas + the vanilla palette. Drop-in for any page (`<script type=module>` +
  the tag); draw-mode changes are a `sand:drawmodechange` CustomEvent.
  `npm run build:embed` bundles it to one self-contained `dist-embed/sand-game.js`.
- `embed/toolPalette.js` — the framework-free tool palette (plain DOM + injected
  `<style>`, no Tailwind).
- `react/SandGame.jsx` — a ~15-line React shim that mounts `<sand-game>` and
  bridges its CustomEvent to a prop. `src/About.jsx` just renders `<SandGame>`.

## Building the C++

You only need this if you change anything under `cpp/`:

```
source wasm/emenv.sh   # puts emcc on PATH (Emscripten SDK under ~/Nick/emsdk)
wasm/build.sh          # regenerates src/sand/wasm/sandEngine.js
```

## Players

Terraria-like player characters are simulated **in C++** (`cpp/engine/player.inc`)
and presented in JS. JS only collects a normalized input bitmask (`INPUT.*` in
`engineWasm.js`, mirroring `enum PlayerInput`) plus an aim cell, forwards it with
`setPlayerInput(id, {bits, aimX, aimY, tool, seq})`, and reads `getPlayers()`
snapshots to draw an overlay. Physics is a deterministic fixed-timestep AABB
platformer (gravity, run/friction, edge-triggered jump, sub-cell-stepped
collision against any non-empty/non-liquid/non-gas cell). Players advance every
`step()`, even when the grid is static, and stay world-anchored across streaming
shifts. Determinism (no RNG) is what lets a fixed input stream replay identically
— the basis for the planned host-authoritative multiplayer.

A local player is spawned by `createSandGame` on the surface and the camera
follows it. **Play mode** (default) maps the keys to the character; **free-camera
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

## Testing

```
npm run test          # sand + players + net protocol (headless, CI-friendly)
npm run test:sand     # node scripts/sand-test.mjs
npm run test:players  # node scripts/player-test.mjs
npm run test:net      # node scripts/net-test.mjs
npm run test:e2e      # node scripts/player-e2e.mjs (headless Chromium gameplay)
npm run test:all      # npm run test && npm run build
```

`test:e2e` boots the dev server, drives the local player with real keyboard
events in headless Chromium (via the `playwright` library, like the pan bench),
and asserts spawn/grounding, input wiring, jump, dig, and camera-follow. It is
not in the required `npm run test` chain (it needs a browser), but is CI-runnable.

## Multiplayer (in progress)

The networking layer lives in `src/sand/net/` and is transport-agnostic so it
unit-tests in Node (`test:net`) with no real socket:

- `protocol.js` — the JSON wire format (`input`/`snapshot`/`join`/`leave`/
  `ping`/`pong`), strict decode/validation, and message builders. Integer fields
  are preserved exactly; out-of-range/malformed messages decode to `null`.
- `client.js` — `SequenceTracker` (drops reordered-late/duplicate packets),
  `InputSequencer`, and `applyInputStream` (reduces a lossy/shuffled input stream
  to the strictly-increasing accepted set).

The topology is **host-authoritative**: one browser runs the real engine,
clients send input and receive snapshots. Determinism (fixed timestep, no RNG in
player physics) is verified by a two-engine replay test: the same seed + same
ordered input stream, round-tripped through the protocol, yields identical final
player state and grid hash.

- `host.js` — the `Host`: owns the engine, spawns a player per client, applies
  inputs through a per-client sequence gate (drops reordered/duplicate packets),
  steps, and emits authoritative `snapshot`s (optionally with a world hash for
  divergence detection). Transport-agnostic — `test:net` drives it in-process.
- `scripts/dev-multiplayer-server.mjs` (`npm run mp:server`) — a pure WebSocket
  relay: rooms + membership + message forwarding. The first peer to join a room
  is the host; the server never simulates. A live two-client round-trip
  (input → host, snapshot → client, disconnect → leave) is covered by `test:net`.
- `gameNet.js` — the browser glue wired into `createSandGame`. The **host** peer
  runs the engine, spawns a player per remote client (reusing `Host`), and
  broadcasts snapshots; a **client** peer sends input and renders all players from
  the host's snapshots (smoothed). In DEV the `window.__sandNet` hooks
  (`host`/`join`/`disconnect`/`status`) drive it against the local relay.
  `scripts/mp-e2e.mjs` is a two-context Playwright test (host + client) asserting
  the client's input reaches the host, both peers observe it, and disconnect
  removes the remote player.

To try it locally: `npm run mp:server`, then open the site in two tabs, Host a
room in one and Join it (same code) in the other.

**World replication (Phase 6).** The host serializes its grid and the client
applies it so both see the same sand world:
- `cpp/engine/netsync.inc` — full snapshot (RLE over the grid) + dirty-rect diffs
  + a FNV grid hash, with apply functions; `net/worldSync.js` bridges them to the
  protocol (`world`/`diff` messages, base64).
- On join (or `resync`) the host sends a full snapshot; thereafter it streams
  per-step diffs. The client applies them, doesn't simulate the shared world
  itself (host-authoritative), and requests a `resync` when a diff's hash doesn't
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

Add the id, color, density, kind, etc. as an entry in `materials.schema.json`,
then run `npm run generate` (regenerates the JS + C++ tables) and rebuild the
wasm. If it moves in a way no existing kind covers, or reacts with other
materials, add that to the relevant `.inc` file.
