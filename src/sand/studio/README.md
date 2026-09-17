# Development viewers

`npm run dev`, then open `/game?studio=hearth` for the world workbench or
`/game?creature=FROST_GIANT` for the creature workbench. These routes are
available only in development. Links from the world workbench's creature
artwork drawer open each species directly.

## Creature workbench

The roster comes from `abi.schema.json`, and artwork comes from
`content/creatureArt.js`. A single WASM engine and WebGL canvas serve the
selected creature; changes destroy the previous engine. Aquatic creatures
get a water tank, flying creatures start above the ground, and canvas framing
accommodates the sprite's world size.

- **Controlled poses** freeze the AI and drive the engine's real animation
  states. Walking can translate across marked ground or stay in place. Facing,
  slow playback, pause, tick stepping, restart, and source-frame seeking are
  available. Hurt triggers the renderer's real health-change reaction.
- **Source pixels** and the clickable frame strip show authored pixels exactly,
  without lighting or effects. Use the frame slider or Next frame for exact
  inspection. Special always uses this view because its gameplay trigger is
  species-specific. Attack-stage strips use the same explicit clip/range mappings as the engine.
- **Live encounter** runs actors, terrain, attacks, and projectiles for four
  seconds, then resets. Some creatures do not attack. The pattern selector
  selects an initial pattern; subsequent behavior belongs to the real AI.
  AI progression and physical effects are intentionally distinct from source
  frame seeking.

The URL tracks the selected species. Unknown species fall back to the frost
giant. Nothing in the viewer writes art or changes the game's content.

## Browser inspection

After `window.__creatureViewer` exists:

```js
const viewer = window.__creatureViewer;
viewer.pause();
viewer.select({ creature: 'FROST_GIANT', mode: 'move', facing: 1, travel: false });
viewer.seekFrame(3);                // zero-based source frame; pauses playback
viewer.step(1);                     // one 60 Hz tick; remains paused
viewer.setSpeed(0.5);
viewer.play();
viewer.inspect();                  // selection, ticks, frames, actor, projectiles, GL context count
viewer.select({ mode: 'simulation', pattern: 2 }); // real ice-spear attack
viewer.step(65);
```

Modes: `idle`, `move`, `windup`, `attack`, `recover`, `hurt`, `death`, `special`,
`simulation`. Creature keys match `creatureArt.js`. `restart()` resets the scene
while retaining playback settings. `select()` retains unspecified settings.
`step(n)` is bounded to 600 ticks per call. Capture the canvas labelled
`Live creature preview` or `Source animation preview` with Playwright.

Focused validation:

```sh
node scripts/run-tests.mjs --only creature-viewer-e2e,frost-giant-e2e
```

The viewer suite checks the full roster, context reuse, playback controls,
source frames, deep links, and actual frost-breath projectiles. The frost suite
checks all three attacks and idle/walk stability through both native and
replicated rendering paths, including contact-velocity pulses at a wall.

## Player and armor review

Open `/game?player` to inspect generated player components and all existing armor
sets in the WebGL renderer. Choose a complete set or mix the six slots separately;
select any player state, facing, weapon, shield and aim angle. Pause and step for
foot and hand registration checks. No equipment or saves in the adventure are
modified by this viewer. `window.__playerViewer` supports `select`, `pause`,
`play`, `step`, `seek(frame)` and `inspect` for repeatable agent/browser checks.
