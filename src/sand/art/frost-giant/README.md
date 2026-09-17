# Frost giant animation source

The game renders full, palette-indexed sprite frames. There is no runtime limb
rig. `animation-sheet.png` is the approved ImageGen character sheet: idle,
walk, ice breath, ground smash, ice spear, hurt, and death, with eight poses
per row. `../creatures/walk/frost_giant.png` supplies a dedicated four-pose
walk in a two-column, two-row grid: left contact, passing, right contact,
opposite passing. `walk-sheet.png` is its character reference. The main sheet
supplies the remaining poses.

Rebuild the game's art with:

```sh
node scripts/author-enemy-art.mjs --only FROST_GIANT
```

The importer requires the project's Playwright Chromium (`npm run setup:browsers`).
It decodes the PNGs locally, removes the background and isolated edge noise,
registers feet and pelvis, and quantizes to 24 shared colors. The dedicated
walk importer matches the idle height and palette. Output frames are
80×88 with 0.28 world cells per source pixel. Production ships the compiled
content packet, not the reference PNGs.

`scripts/import-frost-giant-art.mjs` owns crop boundaries and clip mapping.
Idle holds one neutral pose. Walking uses four complete poses at twelve ticks
per frame. Windup, attack, and recovery each contain three equal segments in
breath, smash, spear order. Sustained breath uses `special`. The renderer advances
death by actor lifetime. It filters short contact-velocity pulses before changing
between idle and walking, independently of the cyclic legacy pose counter.

The engine supplies breath, the growing held spear, projectile flight, and
impact particles. The importer removes the illustrated held spear to avoid
duplicating that effect. The death row retains the troll's collapsing body.

The sheets were generated with the built-in image tool. Compact walk prompts
and the leg-position guide live in `../creatures/walk/`. The reference walk prompt
is saved in [walk-prompt.txt](walk-prompt.txt). The character brief
was blue-gray skin, massive arms, short thick legs, an ivory beard and collar,
an ice crown and shoulder spikes, a leather belt with an icy buckle, and a
ragged ivory loincloth. The main sheet's sixth spear pose is an empty-handed
throwing follow-through. The walk prompt requested eight contact/down/pass/up
poses over two alternating steps, a fixed head and costume, a flat dark
background, and no effects or projectiles. Generated poses still need visual
review; the importer cannot establish anatomical correctness.

Open `/game?creature=FROST_GIANT` during development to review the source frames,
slow playback, mirror the character, and run all three real attacks. See
`src/sand/studio/README.md` for the viewer and its automation API.

Animation references:

- [SLYNYRD's walk-cycle breakdown](https://www.slynyrd.com/blog/2024/5/24/pixelblog-50-human-walk-cycle)
- [Hollow Knight's traditional sprite workflow](https://unity.com/made-with-unity/hollow-knight)
- [Dead Cells' authoring pipeline, by its artist](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)
