# Game content

`world.js` owns named sites, reusable material blueprints, landmark anchors,
quest conditions and rewards, dialogue, and development scenes. `player.js`
owns the player palette, pixel frames, and animation cadence. Files are validated
and compiled by `compile.js`, shared by Node and the browser/authority worker.

World rectangles have inclusive cell bounds. Polygons use scanline filling.
`fg`, `bg`, and `both` select simulated layers. Prefabs compose with `use` and
`at`. Sites can anchor their vertical coordinates to terrain with `surfaceAt`.
Anchors are referenced as `site.anchor`; quests never duplicate target positions.

The engine receives a bounded binary package when constructed, before generating
terrain. Each engine owns its package, including streaming/prefetch generation.
Editing content reloads the development page; it does not require recompiling
WebAssembly. Content fingerprints distinguish authored-world revisions.

## Authoring loop

1. Run `npm run dev` and open `/game?studio=hearth`.
2. Choose a scene, pause it, inspect player/quest state, or step an actor turn.
3. Expand **Edit blueprint** to stamp/cut physical foreground or background cells.
   **Edit player pixels** paints a selected animation frame and changes its timing.
4. Save to validate the complete package and reload the scene. Discard/undo keeps
   changes local. Reset rebuilds a fresh world at the selected scene.
5. Run `npm run content:check`, then `npm run game:capture -- <scene>` for a real
   browser screenshot and authority state under `.sand-artifacts/scenes/`.
   `npm run game:scenario -- --list` lists scenes; `--open` leaves a browser open.

For code-based authoring, the three source files are JSON-compatible object
literals exported from JavaScript modules. Keep them declarative: the local editor
parses and rewrites the object, rather than executing source supplied by the UI.
The development writer accepts only the three known files from local same-origin
requests. It is absent from production. The studio is also excluded from the
production route.

`creatureArt.js` supplies four poses per species. Player clips can contain 1–16
frames with independent cadence. Palette entry zero is transparent; source pixels
use palette symbols. `world.textures` supplies 8×8 material tiles. These tile the
simulated cells in absolute world coordinates. `presentation` sets surface/depth
ambient light and background tint. Art edits affect both the renderer and the
content fingerprint used to guard replay compatibility.

The workbench currently resets simulation on save. It does not preserve a running
world across content edits. Blueprint edits are generation operations, so the
engine registers components through its normal generation paths. Runtime repairs
use the component-aware mutation API. Never paint structural cells directly into
the raw grid during gameplay.

## Verification

`node scripts/run-tests.mjs --only game-content,frontier,anim,replay-capsule,game-studio-e2e,campaign-e2e`
checks the package, physical objectives, animations/replays, editor controls, and
ordinary player interactions. Browser suites require Playwright Chromium.
Procedural world generation has its own versioned golden; editable blueprint
revisions use the content fingerprint and content integration checks.
