# Compact creature animation sheets

Read the [general sprite guide](../README.md) for pose budgets, generation and
individual visual-review requirements. This file describes the compact layout.

These ImageGen sheets supply 34 creatures including the frost giant. The
cinderjaw dragon has its own source directory and half-cell importer;
the player uses a separate modular component pipeline.
The engine draws complete palette-indexed sprites, with no runtime limb rig.

Unified sources live in `atlases/<creature>.png`, with four columns and either
three or four rows, or six for the frost giant. The per-creature `atlas` entry in `manifest.json` declares
the layout and swimming frame indices. Read left to right:

| Row | Pose 1 | Pose 2 | Pose 3 | Pose 4 |
| --- | --- | --- | --- | --- |
| 1 | Movement 1 | Movement 2 | Movement 3 | Movement 4 |
| 2 | Idle | Windup | Attack | Recovery |
| 3 | Hurt | Death 1 | Death 2 | Death 3 |
| 4 (optional) | Swim reach | Swim pull | Swim recovery | Empty |

The first row includes the authored walking poses. One source therefore owns
the creature's movement, combat, reactions, and swimming. Fish use three rows
and reuse movement for swimming. `../grid-v2-prompts.json` and
`../roster-grid-prompts.json` record exact built-in ImageGen prompts and IDs.
The frost giant's 24-pose layout is described in `../frost-giant/README.md`.
`atlas.count` declares larger pose sets. Optional `atlas.rowEdges` records
measured row boundaries in source pixels for unevenly spaced generated sheets.
The committed PNGs are compact, palette-limited sources with hard transparency;
`atlas.rowEdges` uses their current pixel coordinates. Optional
`atlas.pixelDetails` maps a pose index to `[x, y]` source points whose color must
survive native-grid sampling (for example, a manually placed eye). Edit these
pixels in the source PNG and keep their coordinates in sync with the manifest.

Unified atlases import at `pixelScale: 0.5`. Their native dimensions, rather
than the generated PNG dimensions, define the actual pixel grid. The importer
chooses scale from the idle pose and adds canvas padding for wide poses. Human
NPCs use `fit: "height"` and a 21-pixel standing target (10.5 world cells),
comparable to the player's 10.25-cell body. Wide weapons and swimming limbs
must not reduce standing height. Other revised creatures also use height fitting
with their established standing height rounded to the nearest half cell.
Human palette indices retain resident tints. The `creature-art-atlas` test checks
the native half-cell grid across all 35 runtime creature records.

Sources without an `atlas` entry use the three-row compact layout and the
separate supplements described below. Existing source PNGs remain references;
the manifest is the authority for which files are active.

Archived biped references include two-column, two-row walking sheets under `walk/`. Their
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
needed for art-only changes. Unified sources use at most twelve opaque colors,
or the registered human tint palette. Production ships the compiled content packet,
not the large source PNGs.

Review at `/game?creature=CLUSTER_WASP`, selecting any creature and clip. Use
source pixels for frame-by-frame inspection and the game view / live encounter
for motion and actual effects. See `src/sand/studio/README.md` for the shared
viewer controls and `window.__creatureViewer` automation API. Generated gait
and anatomy still require visual judgment; the importer only guarantees the
layout and content contract.
