# Modular player and armor

See the [general sprite guide](../README.md) for shared consistency and review
requirements; the player's component poses use this dedicated pipeline.

`base-grid-v2.png`, `wayfarer-grid-v2.png`, `hedgeweaver-grid-v2.png`, and
`hearthguard-grid-v2.png` were generated
with the built-in image tool; `prompts.json` records the exact briefs. Each atlas
has four columns and three rows, with ten occupied cells: head, torso, hips,
thigh, shin, boot, upper arm, forearm, hand, cape. The last two cells are empty.

Rebuild from the repository root:

```sh
node scripts/import-player-parts.mjs
node scripts/author-player-art.mjs
```

The importer registers each part at a fixed native size and pivot in
`content/playerParts.js`. `content/playerLayers.js` owns shared poses, inverse
pixel sampling, equipment-slot assignments, inventory icon composition, and
three material-color variants. The six existing armor sets keep their item
identities and stats. Wayfarer, Hedgeweaver and Hearthguard have distinct generated
silhouettes; Briarbound, Mistweaver and Oathkeeper reuse those shapes with material
color variants. All six slots can be mixed independently.

`content/player.js` stores the compiled appearance definitions and one placement
list per existing animation frame. Its flat body frames are baked previews and
the fallback for content without modular layers. For modular art, edit component
pixels and poses rather than the flattened preview. The wire compiler validates
and packs parts and placements; C++ renders the equipped parts using the same
frame index. No player mesh or image file is loaded at runtime.

The importer reads the `-grid-v2.png` component atlases.
These active atlases are compact transparent pixel art; edit the small source
pixels directly and use nearest-neighbor enlargement for visual review.
Part pivots and rig dimensions remain defined by the importer.
Exact ImageGen prompts and generation IDs are in `../grid-v2-prompts.json`. The brief requires one
square grid, flat colors, and no sub-pixel texturing. Import samples each part
at half-cell resolution, including transparency, then stores each sample in a
2×2 block within the rig's quarter-cell coordinate space. Odd part dimensions
clip the last block at the registered edge. Twelve colors per component set
keep fabric, hair, and armor from accumulating texture noise.

The 32×44 registration space, pivots, and attachment coordinates remain the
authority for articulation. Rotated and stretched parts rasterize on that
quarter-cell rig grid; this is not a claim that every moving silhouette edge
is globally aligned to half cells. The player remains modular rather than a
flattened creature sheet.

Body parts use a 32×44 native coordinate space. Legs use authored ankle positions
and a forward-bending knee solution. Grounded soles remain horizontal at the
same baseline; passing feet lift. Positive torso angles lean toward the facing.
Runtime arms retain the gameplay shoulder/elbow/hand positions and draw registered
upper-arm, forearm and hand art along them. Sword, bow, wand and shield anchors
remain owned by their existing combat/render paths. Armor changes appearance,
not damage, reach, inventory ownership or targeting.

Development review: `/game?player` renders controlled poses through WebGL and
supports mixed slots, both facings, weapons, raised shields, aim and frame stepping.
`window.__playerViewer` exposes `select`, `pause`, `play`, `step`, `seek`, `inspect`.
Use `node scripts/run-tests.mjs --only player-layers,player-layers-e2e,anim,shield,adventure-tools-e2e,adventure-inventory-e2e`.
