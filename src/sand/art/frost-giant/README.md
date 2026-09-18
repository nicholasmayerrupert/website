# Frost giant animation source

The active source is `../creatures/atlases/frost_giant.png`, a four-column,
six-row ImageGen atlas. Its exact edit prompt and generation ID are recorded in
`../roster-grid-prompts.json`. Only the registered compact atlas is retained.

| Row | Pose 1 | Pose 2 | Pose 3 | Pose 4 |
| --- | --- | --- | --- | --- |
| 1 | Left contact | Passing | Right contact | Opposite passing |
| 2 | Idle | Hurt | Kneeling death | Falling death |
| 3 | Breath windup | Breath active 1 | Breath active 2 | Breath recovery |
| 4 | Smash windup | Impact | Follow-through | Recovery |
| 5 | Spear windup | Release | Follow-through | Recovery |
| 6 | Settled death | Swim reach | Swim pull | Swim tuck |

`../creatures/manifest.json` owns source layout, height registration, palette
budget, and clip mappings. Import at 0.5 world cells per native pixel, with
39-pixel idle height and padding for extended arms. Windup, attack and recovery
contain three equal three-frame segments in breath/smash/spear order; held
drawings fill those slots. The four-frame `special` breath loop alternates its
two active drawings. Walking has four poses at twelve ticks each.

Rebuild with `node scripts/import-creature-art.mjs FROST_GIANT` or
`node scripts/author-enemy-art.mjs --only FROST_GIANT`. Both use the same atlas
importer. Engine effects supply the breath stream, held spear and projectile;
the sprite's hands remain empty.

Review `/game?creature=FROST_GIANT` for mirrored playback and all three attacks.
Run `node scripts/run-tests.mjs --only creature-art-atlas,creature-animation-e2e,frost-giant-e2e,creature-swim-e2e`.
