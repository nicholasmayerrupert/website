# `<sand-game>` Embed API

The sand game ships as a framework-free Web Component. Build it with:

```sh
npm run build:embed
```

That emits one self-contained ES module:

```html
<script type="module" src="./sand-game.js"></script>
<sand-game mode="survival"></sand-game>
```

The bundle embeds the WASM engine, so host pages do not need a separate `.wasm`
asset or React/Tailwind runtime.

## IRIS campaign and direct survival

On this site, `/game` opens the mission deck for IRIS — Interstellar Rescue &
Intervention Service — aboard the field ship Kestrel. The React campaign shell
owns briefing, sequential unlocks, bounded loadout selection, deployment,
persistence, and debrief. It creates `<sand-game>` only for an active operation.
`/game?sandbox` bypasses that shell and mounts direct survival.

The standalone component contains the authoritative mission runtime, tracker,
and world-space objective markers, but it does not contain the Kestrel menus or
campaign save. A host starts an authored operation by supplying a matching
planet and mission:

```html
<sand-game
  mode="survival"
  planet="moon"
  mission="silent-quarry"
  world-seed="437632751"
  loadout="[]"
></sand-game>
```

The authored pairs are `earth` + `greenfall-recovery`, `moon` +
`silent-quarry`, and `mars` + `red-furnace`. A mismatched mission and planet
fails closed during authority-worker initialization.

## Host layout

`<sand-game>` fills its containing box. Give the host element or a parent an
explicit size:

```css
.game-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
}
```

```html
<div class="game-shell">
  <sand-game></sand-game>
</div>
```

The component uses a shadow root. The simulation canvas has id `sand-main` inside
that shadow root for benchmark tooling.

## Attributes

| Attribute | Values | Default | Notes |
| --- | --- | --- | --- |
| `mode` | `survival`, `creative` | `survival` | Survival starts the player armed and shows inventory, crafting, hotbar, and health UI. Creative uses free camera and palette. |
| `initial-tool` | legacy tool name | `cube` | Back-compat bridge for tests and old embeds. Creative palette uses material picks instead. |
| `auto-start` | presence | absent | Coarse-pointer creative mode starts with drawing active instead of showing its internal `START` button. |
| `planet` | `earth`, `moon`, `mars`, `ship` | `earth` | Selects immutable world identity, deterministic worldgen family, backdrop, and default gravity: `1.0`, `0.33`, `0.76`, or shipboard `1.0`. |
| `weather` | `auto`, `clear`, `rain` | `clear` | Pinned by default. `auto` runs the deterministic clear/rain cycle with gradual sky, cloud, and precipitation fades; explicit values pin the session. The palette's time control includes a Rain toggle that pins/unpins rain at runtime. |
| `mission` | `greenfall-recovery`, `silent-quarry`, `red-furnace` | absent | Starts the matching authoritative survival operation and enables the mission tracker and markers. |
| `world-seed` | unsigned 32-bit decimal | random per mount | Selects the deterministic world for this mount. Values are normalized with unsigned 32-bit semantics. |
| `loadout` | JSON array of inventory stacks | `[]` | Adds material or recovered-weapon stacks before the mission starts. Malformed JSON becomes an empty loadout. |

Changing `initial-tool` after mount forwards the legacy tool selection to the
runtime. `mode`, `planet`, `weather`, `mission`, `world-seed`, and `loadout` are
construction-time attributes; recreate the element to change them. The planet
is immutable for the engine lifetime, and an explicit `weather` pin is too;
`auto` weather still evolves on its own schedule. Rain currently supports
Earth; other planet/rain combinations normalize to clear. The component has no gravity attribute:
Earth, Moon, and Mars use `1.0`, `0.33`, and `0.76` gravity respectively.

Loadout entries use the generated ABI inventory-stack fields. The authority
accepts at most 16 entries, clamps each count to `0`–`5000`, and accepts material
stacks plus the recoverable enemy-weapon item kinds. The site campaign constructs
these arrays through `campaign/missions.js` rather than accepting raw player
input.

## Events

| Event | Detail | When |
| --- | --- | --- |
| `sand:drawmodechange` | `{ on: boolean }` | Creative palette toggles drawing. Bubbles and crosses the shadow boundary. |
| `sand:interaction` | `{ kind, button?, key? }` | An accepted primary/secondary surface press or WASD/arrow input reaches the game. |
| `sand:ready` | none | The engine, renderer, and mode-specific controls have initialized. Bubbles and crosses the shadow boundary. |
| `sand:error` | `{ message: string }` | Engine initialization failed and the embedded retry panel is available. |
| `sand:missionupdate` | presented mission snapshot | Authoritative mission state changes. |
| `sand:missioncomplete` | terminal mission snapshot plus `inventory` | Extraction completes. Emitted once per mount. |
| `sand:missionfailed` | terminal mission snapshot plus `inventory` | The operation fails. Emitted once per mount. |
| `sand:talkaction` | `{ action, actor }` | A player chooses an action from a talkable NPC conversation. |

These events bubble and cross the shadow boundary. A presented mission
snapshot contains `revision`, `missionId`, `planetId`, `phase`,
`objectiveCount`, `threatLevel`, extraction coordinates, `elapsedTicks`,
`recoveredWeaponMask`, `objectives`, `missionName`, `stageLabel`, and
`recoveredWeaponKinds`. Each objective is
`{ id, type, state, current, required, worldX, worldY, targetActorId, flags }`.
Mission, planet, phase, objective-type, and objective-state values come from
`abi.schema.json` and its generated bindings.

## Runtime Behavior

- JavaScript owns DOM lifecycle, canvas sizing, raw browser events, audio, and
  authority-worker messaging.
- C++/WASM owns simulation, rendering, camera policy, player physics, tools,
  terrain streaming, spawn placement, inventory state, and mission progression.
- Weather defaults to pinned `clear`. `weather="auto"` runs a deterministic
  wall-clock cycle that fades the presentation between clear and rain and
  flips the offline authority's discrete weather via a journaled message; the
  palette's Rain button (and the `setWeatherOverride` runtime handle) pins
  rain or clear and suspends the cycle until it is resumed.
- Planet gravity applies to players and other gravity-driven actors, rigid bodies,
  fluids, and loose solids. The deterministic fall order is Earth, Mars, Moon.
- A mission embed shows its tracker and objective markers. Direct survival
  without `mission` runs the same worker-backed sandbox without mission UI.
- Talkable human actors show a nearby world-space `TALK` button. Conversation
  actions cross the component boundary through `sand:talkaction`; aboard the
  Kestrel, Commander Vale's conversation is the only route to the mission
  console.
- Survival combines explosive combat with inventory-backed mining and building.
  The hotbar can hold bare-hand slots, mining tools, collected blocks, or dropped
  weapons; `E` opens the inventory/crafting modal and `Q` selects the square tool
  footprint. Creative `Q` restores the previously selected palette entry.
- Hands, mining tools, and blocks show their footprint at the pointer. Weapons
  hide both that square and the legacy diamond preview while remaining aimed by
  the pointer.
- Without `auto-start`, touch/coarse-pointer creative mode starts with draw mode
  off and shows only a bottom `START` button so the host page can scroll.
  Starting reveals the normal controls; choosing `SCROLL` hides them again.
  Fine-pointer survival starts draw-enabled for immediate play.
- The mobile creative material picker accepts vertical touch scrolling while
  the movement and view controls remain available around it.

## Survival Controls

| Input | Action |
| --- | --- |
| `A` / `D` or arrows | Move |
| `W` or `↑` | Jump / swim |
| `Space` | Jump, then hold for rechargeable jetpack thrust |
| `S` / `↓` | Crouch / descend |
| `Shift` | Run |
| `F` | Hold a 120-degree directional ward |
| Pointer | Aim |
| Left mouse | Mine, place, or use selected weapon |
| Right mouse | Use the alternate/background layer where supported |
| `1`–`9` or wheel | Select hotbar slot, including an empty bare-hand slot |
| `E` | Open inventory and crafting |
| `Q` | Choose placement/mining footprint |
| `+`, `-`, `0` | Zoom in / out / reset |
| `L` | Pause and open the authority-log copy/paste panel (local sessions). During buffered replay, restore the parked live world and reopen this panel |
| `R` | Capture this session and open buffered replay immediately. During buffered replay, restore the parked live world and continue the game |

The survival HUD exposes the player’s 100 health, rechargeable jetpack fuel, and
200-point directional ward. Hold `F` while aiming to raise the ward across the
120-degree sector in front of the player.

## Boundary Rules

- The standalone embed must not import React, site pages, Tailwind config, or app
  CSS.
- Use `npm run build:embed` to verify bundle generation.
- Use `npm run check:embed` to verify the dependency boundary.

Campaign and planet checks:

```sh
npm run test:campaign
npm run test:missions
node scripts/run-tests.mjs --only planet-gravity
node scripts/run-tests.mjs --browser --only campaign-e2e
```
