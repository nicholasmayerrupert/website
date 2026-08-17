# Sand material model

`materials.schema.json` is the source of truth. `npm run generate` emits
`materials.generated.js` for JS and `cpp/engine/materials.generated.hpp` for C++.

## Fields

### Material ID

The material ID is exact identity: `SAND`, `WATER`, `WOOD`, `TNT`, etc. Rendering,
inventory, drops, durability, density, color, and special reactions use exact IDs
when the distinction matters.

Material IDs are stable API. Do not remove or renumber existing IDs; saves, tests,
networking, rendering, and the WASM grid all key off the numeric ID.

IDs occupy a byte-wide `0..255` address space and may be sparse. `TABLE_SIZE`
sizes constant-time lookup tables; it is not the number of defined materials.
Use `isMaterialId`/`MAT_DEFINED` at input boundaries, `MATERIAL_BY_ID[id]` for an
optional JS lookup, and `DEFINED_MATERIAL_IDS` for catalogue scans. `MATERIALS`
is compact authoring/UI data and must never be indexed by material ID.

### materialClass

`materialClass` is the broad gameplay/physics bucket:

- `none`: special non-material slot (`EMPTY`).
- `gas`: rises, decays, dissipates, and does not block.
- `solid`: loose granular material that falls and settles per-cell.
- `rigid`: structural material registered as a component or free body; can
  ground, fall as an assembly, split, bake, and block movement.
- `liquid`: flows, has density/mobility, and can buoy rigid bodies.

Use it for broad gameplay questions such as "is this blocking?", "is this a
liquid?", or "does this material count as rigid terrain?"

### kind

`kind` describes cell storage/topology: `NONE`, `POWDER`, `LIQUID`, `GAS`,
`COMPONENT`, or `FREE_RIGID`. The generated kind-to-placement mapping derives
whether generic tools erase, paint loose cells, or enter structural placement.
Broad simulation lists use `materialClass`; gas and liquid movement profiles
then select the detailed update behavior.

Do not treat `kind` as the general gameplay category when `materialClass` and
`flags` are more explicit.

### Placement and movement profiles

Generic runtime placement is generated as `MAT_PLACEMENT`:

- `erase`: clears cells (`NONE`).
- `paint`: writes ordinary loose cells (`POWDER`, `LIQUID`, and `GAS`).
- `structure`: creates registered components or owned rigid bodies
  (`COMPONENT` and `FREE_RIGID`).

All public material-placement paths follow this table. Structural material must
not be written as an unregistered grid cell; use the topology-aware placement or
`CellMutationBatch` APIs.

Every gas selects a `gasProfile`. It defines decay, trapped decay, upward and
sideways movement chance, persistence, and optional ceiling routing. Every
liquid selects a `liquidMovementProfile`. It defines mobility gating, whether a
clear vertical fall bypasses that gate, and an optional fixed fall-speed cap.
These profiles let another material reuse existing movement without an exact-ID
branch.

`contactHazardProfile` defines player damage, creature damage, cadence, and
priority for overlapping actor contacts. A damaging contact hazard also carries
the `spawnHazard` flag, while materials such as fuel or explosives may use only
the flag to keep authored spawns away without dealing direct contact damage.

`habitatProfile` marks reusable creature-habitat policy. The `aquatic` profile
currently makes water and brine viable for aquatic spawning and locomotion;
other liquids explicitly remain nonviable. `ambienceProfile` maps a material to
a generated continuous-sound group. Water and brine share one group, while fire,
lava, and acid select their existing groups. A new material can reuse either
policy without adding an engine-side material check.

### Rendering and light profiles

`transparency` is render-only and ranges from `0` (opaque) to `1` (invisible).
It defaults to `0`; the generated `MAT_TRANSPARENCY` table is the renderer's
source of truth. The alpha byte embedded in packed `color` values is not used
for material opacity.

`lightProfile` selects light transmission, propagation loss, and face lighting.
When omitted, the material-class default applies; materials such as glass can
select a more precise profile without renderer code changes.

`emission` is the light intensity and `emissionProfile` is its spatial pattern
(`uniform`, sparse crystal, and sparse mycelium patterns are available).
`renderAnim` selects the base animated texture, while `renderDetailProfile`
selects generated highlight masks, colors, or mycelium nodules. A nonzero
emission requires a non-`none` emission profile.

### flags

`flags` are extra traits that cut across classes and IDs:

- `flammable`
- `dissolvable`
- `rigid`
- `bearing`
- `plantFamily`
- `quenchesLava`
- `relaxesGaps`
- `plantWood`
- `plantLeaf`
- `spawnHazard`
- `heatSource`

Use flags for gameplay traits such as ignition, acid dissolving, support/bearing,
lava quenching, liquid relaxation, actor-safe placement, heat ignition, and
plant-part roles. Generator invariants
keep topology and traits aligned: component/free-rigid kinds require rigid class
and flag; plant-family materials must be rigid components; wood/leaf roles must
belong to the plant family and are mutually exclusive.

### Crafting equivalence

`craftingFlags` augments a material's ordinary flags only for ingredient
matching. The generated `MAT_CRAFT_FLAGS` table is shared by C++ crafting and the
inventory HUD, so gameplay acceptance and UI availability cannot diverge. Use it
when a material should satisfy a trait recipe without acquiring that simulation
trait.

### Plant species and palette metadata

`plantSpecies` is the generated species registry. Each entry owns its stable
species ID, seed/trunk/foliage materials, palette visibility, and icon artwork.
The engine consumes generated species-to-material and material-to-species tables;
the creative palette consumes the same records. `palette.mainOrder` and
`palette.sections` define UI organization. Species-specific seed entries hidden
from the material list are derived from the species registry rather than an
exact material-name exception.

### Structural components

Every material with `kind: COMPONENT` uses the same static component registry and
the same rigid-body conversion path. Connected structural materials can therefore
detach as one mixed-material body.

Registration topology is chosen from material behavior within that registry.
Plant-family materials use the `plantFamily` flag; specialized growth, freezing,
ignition, dissolving, and other interactions dispatch from generated traits,
declarative reaction descriptors, or optimized handlers when topology demands
one.

### bodyOwner

`bodyOwner` separates free rigid bodies from identical-looking static cells. A free
stone body stamps `STONE` into the grid so it renders, mines, and reacts as stone;
`bodyOwner[k] != -1`, exposed as `isBodyCell(k)`, is the distinction between that
free body cell and a static `STONE` component cell.

## Choosing an extension mechanism

Start with the material record and add engine code only when the behavior is not
already represented:

1. Reuse existing `kind`, trait, and movement/render/gameplay profiles for a
   schema-only material. Generic placement is derived from `kind`.
2. For another set of parameters within an existing policy, add a reusable
   profile in `materials.schema.json` and select it from the material. For a
   genuinely distinct policy, add one generated selector and implement that
   selector in the subsystem that owns the behavior; do not add parallel
   material-ID switches to multiple consumers.
3. Express a local pair transformation as a `SimpleReactionDescriptor`. Use a
   registered reaction pass only when topology or ordering requires a custom
   handler.
4. Put state that follows a loose cell across ticks in one
   `SAND_PERSISTENT_CELL_CHANNELS` row. The row declares its empty value,
   material predicate, streaming codec, and supported `PCSO_*` operations; the
   owning subsystem produces and consumes the value. An unsupported operation
   clears the value instead of carrying it.
5. Keep state owned by a static component or free body on that topology record.
   It then follows component split/merge, body conversion, streaming, and
   destruction through the topology lifecycle rather than a loose-cell channel.

A plant species that reuses existing material, growth, and worldgen records is
one `plantSpecies` record; otherwise add its seed/wood/leaf material records in
the same schema. A different parameter set is one profile record plus that
species record. A genuinely distinct plant shape also adds its topology selector
to the material generator and one implementation for each affected growth or
worldgen path. Generated-flora changes increment `WORLD_GENERATION_VERSION` and
add the matching worldgen compatibility golden.

After a schema edit, run `npm run generate`, rebuild the WASM, and select focused
suites through `scripts/run-tests.mjs --only <manifest-key>` so generated-source,
contract, and WASM-provenance checks run first. Material catalogue changes start
with `mat-generator` and `mat-flags`; interactions add `mat-behavior`; plants add
`flora`, `biomes`, and `worldgen-version` when generated output changes.

## Examples

- `WOOD`: id `WOOD`, `materialClass` `rigid`, `kind` `component`, flags
  `flammable`/`dissolvable`/`rigid`/`bearing`/`plantFamily`.
- `SAND`: id `SAND`, `materialClass` `solid`, `kind` `powder`.
- `WATER`: id `WATER`, `materialClass` `liquid`, `kind` `liquid`.
- `LAVA`: id `LAVA`, `materialClass` `liquid`, `kind` `liquid`, and the
  `viscousGravity` movement profile.
- `STONE_DUST`: id `STONE_DUST`, `materialClass` `solid`, `kind` `powder`.
  Water, acid, and brine produce it when they quench lava.
- `FIRE`: id `FIRE`, `materialClass` `gas`, `kind` `gas`.
- `TNT`: id `TNT`, `materialClass` `rigid`, `kind` `component`.
- `RIGID`: id `RIGID`, `materialClass` `rigid`, `kind` `free_rigid`. It has no
  static component form; acid, lava, and fire erode it through the free-body
  reaction path.
- `NEUTRONIUM`: id `NEUTRONIUM`, `materialClass` `rigid`, `kind` `component`.
  Each connected neutronium component or body emits a bounded radial force that
  attracts powders, liquids, free rigid bodies, players, enemies, and mobile
  creatures while repelling gases in both simulated layers. Mobile actors sample
  one acceleration at their AABB center and resolve it through their ordinary
  collision and locomotion paths. Component mass sets force strength and reach,
  while the nearest occupied neutronium cell sets direction for both static and
  moving shapes. Between moving neutronium bodies, the source with more neutronium
  cells dominates; equal sizes use a stable layer/body identity tie-break, and only
  the subordinate receives attraction from that pair. Strong fields replace
  ordinary downward loose-material settling.
  Pressure-blocked powders and liquids spread along force tangents to wrap around
  the source. Powder tangents retain ordinary density displacement, allowing sand
  to move laterally through lighter liquids. Pressurized liquids occasionally take
  a lateral-inward free-volume route before their direct radial step, broadening
  the outer shell without changing density displacement. Force-balanced loose
  cells become inactive around a static source.

## Which field should code use?

- Rendering/inventory/drops: material ID.
- Sparse-ID validation: `isMaterialId` / `MAT_DEFINED`.
- Broad movement dispatch: `materialClass`; detailed gas/liquid behavior:
  generated movement profile.
- Generic placement: `MAT_PLACEMENT`.
- Gameplay questions: `materialClass` + `flags`.
- Actor contact damage: `MAT_CONTACT_HAZARD_PROFILE` and its generated profile
  tables; safe-spawn exclusion and explosive ignition use `spawnHazard` and
  `heatSource`.
- Aquatic viability and continuous sound: `MAT_AQUATIC_HABITAT` and
  `MAT_AMBIENCE_GROUP`.
- Recipe trait matching: `MAT_CRAFT_FLAGS`.
- Light, emission, and highlights: generated render profiles.
- Common pair transformations: the reaction descriptor catalogue.
- Specialized structural behavior: exact material ID/flags in an optimized
  handler when it cannot be expressed safely as a simple descriptor.
- Static-vs-body distinction: `bodyOwner` / `isBodyCell`.
