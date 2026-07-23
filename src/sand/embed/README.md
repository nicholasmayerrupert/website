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

## Host Layout

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

Changing `initial-tool` after mount forwards the legacy tool selection to the
runtime. Changing `mode` after mount is not a supported live transition; recreate
the element instead.

## Events

| Event | Detail | When |
| --- | --- | --- |
| `sand:drawmodechange` | `{ on: boolean }` | Creative palette toggles drawing. Bubbles and crosses the shadow boundary. |

## Runtime Behavior

- JavaScript owns DOM lifecycle, canvas sizing, raw browser events, and optional
  WebSocket transport.
- C++/WASM owns simulation, rendering, camera policy, player physics, tools,
  terrain streaming, spawn placement, and inventory state.
- Survival combines explosive combat with inventory-backed mining and building.
  The hotbar can hold bare-hand slots, mining tools, collected blocks, or dropped
  weapons; `E` opens the inventory/crafting modal and `Q` selects the square tool
  footprint.
- Hands, mining tools, and blocks show their footprint at the pointer. Weapons
  hide both that square and the legacy diamond preview while remaining aimed by
  the pointer.
- Touch/coarse-pointer creative mode starts with draw mode off and shows only a
  bottom `START` button so the host page can scroll. Starting reveals the normal
  controls; choosing `SCROLL` hides them again. Fine-pointer survival starts
  draw-enabled for immediate play.
- The mobile creative material picker accepts vertical touch scrolling while
  the movement and view controls remain available around it.

## Survival Controls

| Input | Action |
| --- | --- |
| `A` / `D` or arrows | Move |
| `W`, `↑`, or `Space` | Jump / swim |
| `S` / `↓` | Crouch / descend |
| `Shift` | Run |
| Pointer | Aim |
| Left mouse | Mine, place, or use selected weapon |
| Right mouse | Use the alternate/background layer where supported |
| `1`–`9` or wheel | Select hotbar slot, including an empty bare-hand slot |
| `E` | Open inventory and crafting |
| `Q` | Choose placement/mining footprint |
| `+`, `-`, `0` | Zoom in / out / reset |

## Multiplayer

Survival mode includes a collapsed connect panel. It expects the authoritative
server from:

```sh
npm run sand:server
```

Browsers are pure clients in that mode. Server and client must currently share
one authority window. The server expands and streams that window around the
connected player group; widely separated players increase its simulation cost.

## Boundary Rules

- The standalone embed must not import React, site pages, Tailwind config, or app
  CSS.
- Use `npm run build:embed` to verify bundle generation.
- Use `npm run check:embed` to verify the dependency boundary.
