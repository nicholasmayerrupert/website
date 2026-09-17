# Compact creature animation sheets

Read the [general sprite guide](../README.md) for pose budgets, generation and
individual visual-review requirements. This file describes the compact layout.

These ImageGen sheets supply the 33 creatures other than the frost giant and
cinderjaw dragon. Both have their own source directories and importers;
the player uses a separate modular component pipeline.
The engine draws complete palette-indexed sprites, with no runtime limb rig.

Each sheet has four columns and three rows, read left to right:

| Row | Pose 1 | Pose 2 | Pose 3 | Pose 4 |
| --- | --- | --- | --- | --- |
| 1 | Movement 1 | Movement 2 | Movement 3 | Movement 4 |
| 2 | Idle | Windup | Attack | Recovery |
| 3 | Hurt | Death 1 | Death 2 | Death 3 |

Bipeds use separate two-column, two-row walking sheets under `walk/`. Their
four poses are left-leg-forward contact, close passing, right-leg-forward
contact, and opposite passing. The near leg stays lighter and the far leg stays
in shadow so the alternating feet remain readable. `pose-guide.svg` and its
PNG render specify the leg positions; `prompts.json` records the walking brief.
The dedicated sheets replace the movement row during import, matching idle
height, foot baseline, and palette. Most biped frames hold for nine ticks;
the frost giant holds for twelve.

This gives twelve unique base poses per compact creature. `special` reuses the attack pose.
The eight base clips are supplemented by a ninth `swim` clip; creatures that need
it have three additional poses in [swim/](swim/README.md), imported automatically
by this script. Other creatures reuse movement art for that clip. Combat
patterns, their timing, damage, projectiles, telegraphs, and particles still
come from the engine. Multiple attacks can share this compact anticipation /
release / recovery sequence.

`references/` preserves the original character references. `prompts.json`
records the generation prompts; `scripts/creature-art-prompts.mjs` builds them.
`manifest.json` owns sheet paths, native dimensions, pixel scale, target bounds,
optional per-frame anchors, clip pose overrides, and movement timing. Human NPC palettes retain the
indices used by the renderer's resident clothing and hair tints.

Rebuild all available compact sheets:

```sh
node scripts/import-creature-art.mjs
```

Rebuild selected creatures:

```sh
node scripts/import-creature-art.mjs FOX CLUSTER_WASP
```

The importer uses the project's Playwright Chromium to decode local PNGs
(`npm run setup:browsers` installs it). It removes the flat background and
isolated specks, uses one scale across each sheet, registers grounded movement
against a shared contact floor, and quantizes the complete set to at most 31
opaque colors. It writes `src/sand/content/creatureArt.js`; no WASM rebuild is
needed for art-only changes. Production ships the compiled content packet,
not the large source PNGs.

Review at `/game?creature=CLUSTER_WASP`, selecting any creature and clip. Use
source pixels for frame-by-frame inspection and the game view / live encounter
for motion and actual effects. See `src/sand/studio/README.md` for the shared
viewer controls and `window.__creatureViewer` automation API. Generated gait
and anatomy still require visual judgment; the importer only guarantees the
layout and content contract.
