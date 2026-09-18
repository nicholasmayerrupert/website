# Compact creature animation sheets

Read the [sprite guide](../README.md) before generating or changing art.
The roster has 27 base creatures and three villager appearance variants.
`manifest.json` registers 29 active atlases; the Cinderjaw Dragon uses the
compact sheets in `../cinderjaw-dragon/` and its registered swim strip.
The mummy remains part of the roster.

Each creature has one canonical name shared by schema, runtime art, source
filename, and the viewer. Named residents use the villager keeper, smith, or
scholar appearance; these are not additional enemy species.

Sources live in `atlases/<creature>.png`, normally four columns by three or
four rows. The first row contains four movement poses. The second contains
idle, windup, attack, and recovery. The third contains hurt and three death
poses. An optional fourth row contains three swim poses. The frost giant's
24-pose layout is documented in `../frost-giant/README.md`.

The manifest owns layout, clip mappings, native dimensions, target bounds,
palette limits, and source-pixel row boundaries. `atlas.pixelDetails` pins
important source pixels such as the fox's eyes during sampling. Keep those
coordinates synchronized when editing a sheet.

Runtime art uses a half-cell square grid and hard transparency. Standing
height controls registration; wide poses receive padding instead of shrinking
the body. Human NPC palettes preserve the renderer's clothing and hair tints.

```sh
node scripts/import-creature-art.mjs FOX BELL_BAT
node scripts/author-enemy-art.mjs
```

The first command imports selected registered atlases. The second rebuilds all
creature art, including the dragon and swimming. Import requires Playwright
Chromium. Review every changed pose and loop at `/game?creature=FOX` in both
facings, then run the relevant art and browser suites.

Only registered compact PNGs belong here. Keep raw generations, discarded
variants, and comparison renders in an ignored working directory. Git history
preserves previous sources. Exact active generation prompts are recorded in
`../grid-v2-prompts.json` and `../roster-grid-prompts.json`; their historical
wording does not define current creature identifiers.
