# Sprite authoring guide

## Workflow at a glance

- **Edit approved art with built-in ImageGen.** Supply the existing sheets as
  references; preserve character identity, equipment, facing and pose meanings.
  Keep raw generated PNGs in an ignored working directory until compacted;
  save only compact source PNGs and exact prompts in this directory.
- **Compaction is mandatory before import or commit.** Active PNGs have a real square pixel grid,
  flat palettes and binary transparency. Deterministic grid conversion and
  manual pixel touch-ups use the raster tools; edit these small PNGs directly.
  Preview enlarged pixels with nearest-neighbor sampling, without smoothing.
- **Use one coarse square grid.** Creature pixels occupy **0.5 × 0.5 world
  cells**. Request flat colors, about 12 colors total, three tones per material,
  and **no sub-pixel texture, gradients, antialiasing or fine fur**. Enforce the
  native grid during import; a blocky-looking source image alone is insufficient.
- **Keep only active sources.** Delete superseded sheets and duplicate references;
  keep experiments and review renders in an ignored directory. The manifest is
  the source inventory, and git history preserves previous art.
- **Keep one atlas per creature.** Four columns; normally 12 poses, plus a
  fourth row for three swimming poses. Give distinct boss attacks extra rows.
  Declare layout, clip mappings and any uneven row boundaries in the manifest.
- **Preserve physical size and registration.** Fit standing height; pad wide
  attacks and swimming poses instead of shrinking the body. Keep feet grounded
  and heads stable. Human NPCs target 10.5 cells; the player is about 10.25.
- **Keep the player modular.** Coarsen body and armor parts together while
  preserving pivots and equipment anchors. Parts use half-cell color blocks;
  the existing rig still rotates them on its finer coordinate grid.
- **Import, inspect, then test.** Review every native pose and animated loop
  in both facings at game size, including swimming. Fix clipping, stray pixels,
  missing facial features and weak gait changes. Run affected suites and build;
  passing tests do not establish visual quality. Keep this guide current.

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

**Required pipeline: generate → compact → touch up → import → review/test →
commit.** A generated sheet is not finished until it has been reduced to its
actual pixel grid. Never commit full-resolution generation outputs, enlarged
pixel-art copies, or multi-megabyte sprite references. This applies to every
new sprite, replacement sheet, armor component, swimming strip and character reference.

1. Keep raw generation outputs and temporary comparison images under an ignored
   directory such as `.sand-artifacts/sprite-authoring/`. Register the intended
   sheet layout and source row boundaries before conversion. When replacing a
   compact atlas with a fresh large image, update or clear its old `rowEdges`
   and remap `pixelDetails` to the new grid.
2. Place the sheet at its registered path and immediately run
   `node scripts/compact-sprite-art.mjs --references` from the repository root.
   Do not leave the raw large file in the art directory. New asset directories
   must be added to the compactor or reduced with the same grid/palette rules
   before their files are staged.
3. Touch up eyes and other essential details directly on the compact grid.
   Use hard transparency and nearest-neighbor previews; no smoothing or dithering.
4. Run the relevant importers, inspect the rebuilt animation at game size, and
   run the affected checks. Inspect PNG dimensions and file sizes before staging:
   active character sheets must fit within 512×512 pixels. Keep unused references
   outside the tracked source directory. Active sheets should be
   under 100 KB each; the art test enforces the source inventory and size limits. A compliant canvas size alone does not excuse
   texture noise or an unnecessarily large file.
5. Commit only the compact PNGs, prompts, registration metadata and regenerated
   runtime data. Delete temporary raw outputs after review; do not retain large
   originals elsewhere in the repository as backups.

`node scripts/compact-sprite-art.mjs` converts oversized active sources using
center-point sampling, explicit row boundaries and palette reduction without
dithering. Small sources are left untouched so hand edits survive reruns.
The short edge of each pose cell is normally 32 pixels, or 64 for large
creatures; aspect ratios are retained with integer grid rounding. Creature
sources use at most 16 opaque colors, and dragon sources at most 24. This
authoring grid is separate from the registered half-world-cell runtime grid.

Add `--references` to reduce archived sheets and character references to a
maximum 384-pixel edge and 32 colors. These are visual references, not active
import inputs. `source-grid-report.json` records dimensions and file sizes for
the conversion. Original generated sheets remain available in Git history;
shrinking tracked files does not remove those historical Git objects.

Transparent sources use alpha as their exact silhouette. Import does not
chroma-key their black pixels or remove detached one-pixel details. The fox's
eyes are manually placed in its 32×32 source poses, with closed eyelids in
the death poses. Its `atlas.pixelDetails` pins those source coordinates to
the nearest runtime pixel so the smaller game grid cannot skip the eyes.

Use complete body sprites for creatures. Keep movement, combat and swimming
in one atlas; revise deficient poses or add rows for extra actions. State the exact grid,
pose order, facing and limb positions in the prompt. Reference the approved
character, preserve its native resolution/palette, and keep details readable at
game scale. Leave room for extended hands, feet, tails and weapons.

Keep scale and head registration consistent; grounded feet share a contact
baseline. Keep left/right legs identifiable and knees anatomically correct.
Use the flat key background expected by that importer. Keep water, projectiles,
breath, splashes, particles and ground shadows out of character drawings when
the engine supplies them.

Production character art targets a half-world-cell visual pixel grid. All 30
creature appearances use a true `pixelScale: 0.5` native raster. The 29 appearances in
the main manifest use four-column sources under `creatures/atlases/`, with
swimming in an optional fourth row (the frost giant has six rows). The dragon
uses its dedicated half-cell importer. The
manifest declares the layout; wide poses add padding rather than reducing
standing height. Human NPC standing bodies target 10.5 cells to match the
player. Other creatures retain their manifest's physical target bounds.

The player uses `player/*-grid-v2.png` modular atlases, half-cell color samples,
and twelve-color palettes within the existing attachment coordinate space.
The [player guide](player/README.md) describes rig-grid and edge limitations.
Exact revision prompts are in `grid-v2-prompts.json` and `roster-grid-prompts.json`. Their shared requirement
is one square grid for outlines and details, flat colors, and **no sub-pixel
texturing**, gradients, fine fur, or smaller marks inside larger pixels.
Generated source art still requires native-raster and animation review.
The rabbit, frost giant and dragon replacement prompts and conversion settings
are in `sprite-redo-prompts.json`. The rabbit targets 12 native pixels in standing
height, including its ears. Show reviews from imported runtime pixels enlarged
with nearest-neighbor sampling; a high-resolution generation preview does not
demonstrate the final game resolution.

Existing unsuffixed and `-coarse-v1.png` sources remain reference art or active
sources for assets listed in their manifests. Collision, equipment, and attack
timing are independent of the source layout.

Retain active compact source images, exact prompts and registration/timing metadata.
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
- [Frost giant](frost-giant/README.md) and [skeleton dragon](cinderjaw-dragon/README.md)
- [Player components and armor](player/README.md)
- [Runtime animation architecture and checks](../ANIMATION.md)
