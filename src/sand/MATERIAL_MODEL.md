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

### componentGroup

`componentGroup` routes static component storage, registration, and splitting:

- `none`: no static component bookkeeping.
- `stone`: chunk-bounded static rigid components, same-material islands.
- `plant`: unbounded plant-family components, tree/vine/wood family.
- `ice`: unbounded ice components.

`componentGroup` is separate from exact material ID: many different rigid-looking
materials can share the same static component machinery.

### bodyOwner

`bodyOwner` separates free rigid bodies from identical-looking static cells. A free
stone body stamps `STONE` into the grid so it renders, mines, and reacts as stone;
`bodyOwner[k] != -1`, exposed as `isBodyCell(k)`, is the distinction between that
free body cell and a static `STONE` component cell.

## Examples

- `WOOD`: id `WOOD`, `materialClass` `rigid`, `kind` `component`,
  `componentGroup` `plant`, flags `flammable`/`dissolvable`/`rigid`/`bearing`/
  `plantFamily`.
- `SAND`: id `SAND`, `materialClass` `solid`, `kind` `powder`,
  `componentGroup` `none`.
- `WATER`: id `WATER`, `materialClass` `liquid`, `kind` `liquid`.
- `FIRE`: id `FIRE`, `materialClass` `gas`, `kind` `gas`.
- `TNT`: id `TNT`, `materialClass` `rigid`, `kind` `component`,
  `componentGroup` `stone`.

## Which field should code use?

- Rendering/inventory/drops: material ID.
- Movement dispatch: `kind`.
- Gameplay questions: `materialClass` + `flags`.
- Component splitting/registration: `componentGroup`.
- Static-vs-body distinction: `bodyOwner` / `isBodyCell`.
