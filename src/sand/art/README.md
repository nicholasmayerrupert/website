# Sprite authoring guide

Read this before generating or changing character sprites. These are starting
budgets, not quotas: use the fewest clearly different poses that communicate the
action. Add drawings when an actual playback review shows a missing movement
phase or an attack that cannot be distinguished from another.

**Keep this guide current.** When pose budgets, clip layouts, generation/import
workflows or review requirements change, update this README and the relevant
asset-specific README in the same change. Verify the current manifests and
runtime rather than assuming the examples below are permanent limits.

## Poses, frames and timing

A **pose** is a distinct drawing. A **frame** is an entry in a playback sequence;
clips can share poses. Holding a drawing longer does not require generating
another near-identical drawing: use frame durations. Count unique drawings
separately from clip entries and sheet cells.

For a typical creature, start with roughly **12 base poses**, or **15 including
swimming**:

| Action | Starting unique-pose budget | What the drawings must show |
| --- | --- | --- |
| Idle | 1 | Stable neutral silhouette; add a second only for useful idle motion. |
| Walk / primary locomotion | 4 | For bipeds: left leg far forward, legs close/passing, right leg far forward, opposite passing. Adapt the gait to the species. |
| One basic attack | 3 | Readable windup, release/contact, recovery. Use 4 if follow-through needs its own drawing. |
| Hurt | 1 | Clear reaction; timing and engine effects can provide emphasis. |
| Death | 3 | Loss of balance, collapse, settled body. |
| Swim, where needed | 3 | Long reach/extension, strong downward pull, compact recovery; equipped creatures can use extended kick, tucked knees, opposite kick. Usually 2–4 total. |
| Special / additional attack | Reuse first | Add only the distinct poses needed to explain a different action. |

Four almost-identical frames do not make a convincing walk or swim. Specify
large, deliberate changes in limb position while keeping the head, proportions
and costume consistent. Swimming needs visible propulsion and gathering limbs;
a horizontal body with tiny foot changes reads as hovering.

Give each **visually distinct attack** a planned sequence, often one source-sheet
row of 3–4 poses. Different projectile types alone do not require different body
animations. Shared windup/recovery poses are fine. Sustained attacks may need a
small active loop. Map sequences explicitly in `content/creatureAnimations.js`;
sheet rows do not determine gameplay timing or damage. Existing larger sets are
valid exceptions, not a minimum for new creatures.

Only add swimming drawings when the creature's movement needs them. Fish can
reuse aquatic locomotion; flyers and stationary creatures generally need none.
Reuse attack/hurt/death poses in water unless individual review shows a problem.

## Generation and import

Use complete body sprites for creatures. Generate a compact base sheet, then
small focused strips for deficient gaits or extra actions. State the exact grid,
pose order, facing and limb positions in the prompt. Reference the approved
character, preserve its native resolution/palette, and keep details readable at
game scale. Leave room for extended hands, feet, tails and weapons.

Keep scale and head registration consistent; grounded feet share a contact
baseline. Keep left/right legs identifiable and knees anatomically correct.
Use the flat key background expected by that importer. Keep water, projectiles,
breath, splashes, particles and ground shadows out of character drawings when
the engine supplies them.

Retain source images, exact prompts, references and registration/timing metadata.
Use the relevant importer; production consumes palette-indexed content rather
than the large source sheets. Preserve existing land/combat art when adding a
new clip. Check actual native dimensions in the manifest: canvas padding may be
needed for a wide stroke without changing pixel scale or the grounded anchor.

The **player is modular** so equipment and independently aimed arms can compose
correctly. Its component atlas and shared pose placements follow the existing
player pipeline; the creature's 12/15-pose budget does not apply to it. Armor
must cover its assigned parts in every pose and also work in inventory previews.

## Review every creature

Inspect each imported pose at native resolution, then watch the loop through the
game renderer at normal speed and game size. Check both facings, the last-to-first
transition, stable heads/scale, complete limbs, background specks and silhouette
clarity. Check walking/stopping/wall contact and swimming forward/upward/in place,
including entering and leaving water. A distinct-frame count cannot judge gait
quality. Regenerate weak poses rather than approving them solely because import
or tests succeeded. Record the individual review in the relevant manifest.

Use `/game?creature=VILLAGE_GUARD` (append `&swim` for water) and `/game?player`.
Run the focused checks documented for the affected assets; follow the repository
build/benchmark requirements when changing simulation or rendering code.

## Pipeline references

- [Compact creatures](creatures/README.md) and [swimming strips](creatures/swim/README.md)
- [Frost giant](frost-giant/README.md) and [skeleton dragon](skeleton-dragon/README.md)
- [Player components and armor](player/README.md)
- [Runtime animation architecture and checks](../ANIMATION.md)
