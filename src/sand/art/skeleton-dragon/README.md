# Approved skeleton dragon

The user selected `../style-review/dragon-candidate-v1.png`. `locomotion.png` and
`attacks.png` extend that design into the runtime animation set. Both sheets
were generated with the built-in image tool; briefs are in `prompts.json` and the
focused walk edit in `walk-correction.txt`.

Run `node scripts/author-enemy-art.mjs --only BONE_DINOSAUR` to import. The importer
uses a shared scale and palette for both sheets, fixed cell centers, and grounded
baselines. Output stays 84×56 at half-cell scale. Locomotion supplies idle, four
walk contacts/passing poses, hurt, and three death poses. Each attack sheet row
contains anticipation, contact, follow-through and recovery for bite, rush and
fire breath. `content/creatureAnimations.js` maps those rows explicitly; rush and
breath loop their two active poses. Flame projectiles remain engine effects.

Review `/game?creature=BONE_DINOSAUR`; `dinosaur-e2e` captures bite damage, rush
movement and the sustained flame stream in the real engine.
