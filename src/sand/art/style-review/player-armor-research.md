# Player art and equipment

## Current game

`content/player.js` supplies a 32×44 body with authored animation clips.
`glDrawOnePlayer` in `cpp/engine/glpresenter_impl.inc` composites separately
posed arms and weapons. Equipment mostly recolors regions of the body palette;
helmet and chest details are also drawn with small rectangles. This does not
yet provide interchangeable, fully authored armor sprites.

## Examples from other games

- **Terraria:** tModLoader's player renderer documents separate skin, leggings,
  shoes, torso, head, hair, armor coat, arms, shields and held-item layers.
  Arms include their armor; held items can change their order relative to arms.
  This is a close fit for our aiming and equipment needs.
  [Primary documentation](https://docs.tmodloader.net/docs/stable/class_player_draw_layers.html).
- **Dead Cells:** Motion Twin artist Thomas Vasseur describes authoring models
  and skeletal animations in 3D, then exporting low-resolution PNG frames for
  the 2D game. Equipment can be attached to the model and share animations.
  This offers consistent proportions, but requires a model/render/export
  pipeline. It is an authoring approach, not evidence that the game composites
  a live 3D skeleton at runtime.
  [Artist's account](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-).

## Recommendation

Use layered pixel sprites for the player. One animation controller supplies a
shared pose/frame to body and equipment layers. Head/hair/helmet, torso/chest,
legs/greaves/boots, rear/front arms/gloves, cape and held items have explicit
draw order. Equipment swaps its own layer; it does not require a new complete
character sheet for every combination of items.

Modularity does not require rotating every limb as a rigid cutout. Author
pixel-correct limb poses where needed and use shared shoulder and hand anchors
for aiming. Preserve the connection between hand grips and gameplay muzzle or
weapon positions. Helmets must explicitly cover appropriate hair pixels, and
gloves must follow the selected hand pose.

First validate one body, one cloth outfit and one bulky armor outfit through
walking, jumping, aiming, attacking and guarding in both facings. Check overlap
at shoulders/waist, front/back arm order, helmet hair coverage and weapon grips
before producing a large equipment library.

The generated armless body is a style reference. It is not installed and does
not by itself solve equipment layering. This document proposes the next player
art workflow; it does not change the renderer.
