# Cinderjaw Dragon

See the [general sprite guide](../README.md) for pose budgets and visual review.

The Cinderjaw Dragon uses a skeletal woodland-fantasy design. Exact generation
briefs are recorded in `prompts.json` and `walk-correction.txt`.

The active `locomotion-coarse-v1.png`, `attacks-coarse-v1.png` and registered
swim strip are compact transparent sources, with at most 24 opaque colors.
Their square source pixels contain no sub-pixel shading. Edit them directly;
use nearest-neighbor enlargement when inspecting or presenting the artwork.

Run `node scripts/author-enemy-art.mjs --only CINDERJAW_DRAGON` to import. The importer
uses a shared scale and palette for both sheets, fixed cell centers, and grounded
baselines. Output stays 84×56 at half-cell scale. Locomotion supplies idle, four
walk contacts/passing poses, hurt, and three death poses. Each attack sheet row
contains anticipation, contact, follow-through and recovery for bite, rush and
fire breath. `content/creatureAnimations.js` maps those rows explicitly; rush and
breath loop their two active poses. Flame projectiles remain engine effects.

Review `/game?creature=CINDERJAW_DRAGON`; `dinosaur-e2e` captures bite damage, rush
movement and the sustained flame stream in the real engine.
