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

`kind` is hot-loop tick and movement routing. It answers which
settling/update path currently handles the cell: `NONE`, `POWDER`, `LIQUID`,
`GAS`, `COMPONENT`, or `FREE_RIGID`.

Do not treat `kind` as the general gameplay category when `materialClass` and
`flags` are more explicit.

### transparency

`transparency` is render-only and ranges from `0` (opaque) to `1` (invisible).
It defaults to `0`; the generated `MAT_TRANSPARENCY` table is the renderer's
source of truth. The alpha byte embedded in legacy packed `color` values is not
used for material opacity.

### flags

`flags` are extra traits that cut across classes and IDs:

- `flammable`
- `dissolvable`
- `rigid`
- `bearing`
- `plantFamily`

Use flags for gameplay traits such as ignition, acid dissolving, support/bearing,
and plant-family behavior.

### Structural components

Every material with `kind: COMPONENT` uses the same static component registry and
the same rigid-body conversion path. Connected structural materials can therefore
detach as one mixed-material body.

Registration topology is chosen from material behavior within that registry:
plant-family materials use the `plantFamily` flag, ice uses its
exact material ID, and other structural materials use the chunk-bounded terrain
registration path. Growth, freezing, ignition, dissolving, and other special
behavior likewise dispatch from exact IDs or flags.

### bodyOwner

`bodyOwner` separates free rigid bodies from identical-looking static cells. A free
stone body stamps `STONE` into the grid so it renders, mines, and reacts as stone;
`bodyOwner[k] != -1`, exposed as `isBodyCell(k)`, is the distinction between that
free body cell and a static `STONE` component cell.

## Examples

- `WOOD`: id `WOOD`, `materialClass` `rigid`, `kind` `component`, flags
  `flammable`/`dissolvable`/`rigid`/`bearing`/`plantFamily`.
- `SAND`: id `SAND`, `materialClass` `solid`, `kind` `powder`.
- `WATER`: id `WATER`, `materialClass` `liquid`, `kind` `liquid`.
- `FIRE`: id `FIRE`, `materialClass` `gas`, `kind` `gas`.
- `TNT`: id `TNT`, `materialClass` `rigid`, `kind` `component`.
- `RIGID`: id `RIGID`, `materialClass` `rigid`, `kind` `free_rigid`. It has no
  static component form; acid, lava, and fire erode it through the free-body
  reaction path.
- `NEUTRONIUM`: id `NEUTRONIUM`, `materialClass` `rigid`, `kind` `component`.
  Each connected neutronium component or body emits a bounded radial force that
  attracts powders, liquids, and free rigid bodies while repelling gases in both
  simulated layers. Component mass sets force strength and reach, while the
  nearest occupied neutronium cell sets direction for both static and moving
  shapes. Strong fields replace ordinary downward loose-material settling.
  Pressure-blocked powders and liquids spread along force tangents to wrap around
  the source, while density displacement sorts denser materials inward and
  liquids into an outer shell. Force-balanced loose cells become inactive around
  a static source.

## Which field should code use?

- Rendering/inventory/drops: material ID.
- Movement dispatch: `kind`.
- Gameplay questions: `materialClass` + `flags`.
- Special structural behavior: exact material ID + flags.
- Static-vs-body distinction: `bodyOwner` / `isBodyCell`.
