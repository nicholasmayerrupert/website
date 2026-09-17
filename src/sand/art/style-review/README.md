# Player and dragon art review

Open `/src/sand/art/style-review/index.html` on the development server for a
side-by-side comparison of the current sprites and generated candidates.
The dragon design is imported through `../skeleton-dragon/`; the player body
candidate is a style reference for the component pipeline in `../player/`.

- `dragon-candidate-v1.png`: **user-selected design**, with idle, bite anticipation, bite release and breath
  design poses in a two-by-two grid. This is a design study, not a complete
  movement or attack set. Complete runtime sheets live in `../skeleton-dragon/`.
- `player-body-candidate-v2.png`: six modular body-only poses. Head, torso,
  hips and legs are present; arms, hands and weapons are absent. A selected body
  needs native-resolution conversion and an attachment/aiming check before it
  can replace the existing body. Version 1 is retained as the uncorrected pass.
- `*-current.png`: source-pixel identity references rendered from game data.
- `*-before-grid.png`: current game poses arranged for direct comparison.
- `style-reference.png`: the current guard, hunter and bone guard palette/style.
- `prompts.json`: exact initial briefs. `player-walk-correction.txt` records the
  focused leg correction. All candidates used the built-in image-generation
  tool with local identity and style references.
- `attack-frame-plan.md`: proposed row budgets and acceptance criteria based
  on visible actions in Aster's current combat code.
- `player-armor-research.md`: current armor implementation, primary-source
  examples and a proposed layered player workflow.
- `caster-native-comparison.png`: acid caster before (top two rows) and after
  (bottom two rows), rendered from game pixels at 3×. The simplified caster is
  imported at the same 72×78 resolution and scale, with unchanged clip counts
  and timing. `caster-before-sheet.png` and `caster-before-walk.png` preserve
  the source art; `caster-simplification-prompts.json` records both edit briefs.

The originals and candidates have different source resolutions. These archived views
compare art direction; they are not a runtime animation-quality or performance
comparison. Gameplay timing, damage, projectiles and effects are unchanged.
