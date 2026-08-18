# Semantic world context

The infinite world has two kinds of state:

- Generated facts are pure functions of the world seed, planet, worldgen
  version, and absolute coordinates.
- Mutated cells and live actors are stored by the streaming and actor systems.

`WorldContextSystem` owns the generated facts used outside terrain stamping. A
query returns the owning biome family and biome, surface Y, depth, composable
area tags, and the innermost generated feature at one absolute world coordinate.
Feature IDs and parent IDs are stable within a worldgen/context version.

## Unified biome field

`engine.worldBiomeSample(worldX, worldY)` is the public biome query. One
deterministic, warped two-dimensional region field returns:

- `owner`: the nearest biome region's family and biome ID
- `neighbor`: the nearest distinct biome region
- `blend`: a normalized weight near their boundary

Surface and cave are families in this single field rather than independent
coordinate lookups. A narrow depth gate keeps the surface/cave handoff aligned
with the generated cave roof. Raster generation, semantic context, natural
spawning, and background presentation all consume the same result.

The owner controls topology and semantic identity. Material skins choose between
same-family neighbors with stable absolute-coordinate dithering, so chunk order
and streaming cannot move an ecotone. The backdrop uses the same pair and weight:
the sky and distant ridges stay stable, while deterministic mountain-scale slots
weave same-family artwork across one connected foreground silhouette. Cave biome
identity is confined to the nearest cave layer.

The compile-time catalogue is authored one row per family in
`cpp/engine/worldgen_features.def`. That row generates the family enum,
callback declarations, and `WorldContextSystem::FEATURES`; it owns the planet
profile mask, lattice, maximum overscan, generation stage, layer mask, write
policy, exclusions, semantic tags, ownership priority, feature kind, role, and
query/overlap/stamp callbacks. The catalogue currently plans:

- Earth settlements and their role-specific child buildings
- Earth mines and their headhouse/gallery roles
- Earth cave ruins and deep-cavern monuments
- Moon and Mars formations and facilities

The same pure plan functions are consumed by stamping and semantic queries, so
a record cannot drift from the anchor, dimensions, terrain constraints, feature
identity, or maximum reach used to stamp its geometry. Settlement membership
remains true if simulation later damages a building; it describes the
designated generated site rather than inferring meaning from mutable materials.

Feature selection and composition are explicit. Candidate acceptance resolves
the descriptor's exclusions through the same overlap callbacks used by context,
and the catalogue's priority determines both stamp order and semantic ownership.
Specificity and a stable feature-ID tie-break resolve the remaining overlap.
Broad planning bounds are only a search accelerator. In particular, a mine
reports gallery semantics only inside a stamped gallery, side room, station, or
shaft—not throughout its rectangular planning box.

## Context hierarchy

Area tags are composable. A village home interior has `SURFACE`, `STRUCTURE`,
`SETTLEMENT`, `BUILDING`, and `INDOOR`. Its feature is
`VILLAGE_BUILDING`, its role is `HOME`, and its parent ID identifies the
surrounding `VILLAGE`. A mine gallery uses `UNDERGROUND`, `STRUCTURE`, and
`MINE`.

`engine.worldContextAt(worldX, worldY)` exposes the packed context through the
WASM adapter as `biomeFamily`, `biome`, terrain fields, tags, and feature
identity. Bounds are inclusive. The query is independent of the loaded window,
camera, and viewport size.

## Natural spawn composition

`CreatureSpawnRule` retains physical and population policy: habitat, cadence,
distance, species cap, local density, and global cap.

`CreatureWorldRule` adds semantic policy:

- required and excluded area tags
- allowed surface-biome and cave-biome masks
- preferred tags and biome masks
- depth range
- base and preference weights

Natural candidates must pass the semantic rule and the live material-aware
habitat check. Manual spawn eggs and authored mission actors bypass natural
spawn policy. The encounter director uses the weights at its player focus to
select the first enemy archetype, then validates the final candidate context
after surface/cave snapping.

The survival combat pools are broad within their physical realm:

| Context | Eligible enemies | Affinities |
| --- | --- | --- |
| Any surface biome | Dynamiteer, caustic mortarman, cluster wasp | Dynamiteers favor open biomes and settlements; mortarmen favor desert and swamp; wasps favor forest, jungle, and swamp |
| Any cave biome | Bore sentinel, minigunner | Bore sentinels favor mines and geode/fossil depths; minigunners favor mines, facilities, and crystal/magma/void depths |

Surface combatants cannot naturally materialize inside designated building
interiors, and cave enemies cannot materialize beneath a settlement. The
director only falls back among species with positive weight at the player's
context; every final surface/cave-snapped pose is checked again.

Ambient wildlife has a separate four-second cadence and a three-creature share
of the eight-creature natural cap. Its semantic affinities influence selection,
then water, walking surface, cave floor, or open air determines whether the
selected species has a viable off-screen entry.

Village residents are generated from the same immutable plans as village
terrain. A stable site key places one villager in each material-valid building
interior and one in the outdoor commons. The twelve-resident loaded cap is
separate from ambient and combat capacity; hibernation preserves resident IDs
and prevents streaming from duplicating a site.

## Adding a generated site

1. Reuse an existing public feature kind, role, and area-tag composition when
   they describe the site. If a public identity is required, add it to
   `abi.schema.json` and manually increment `abiVersion`; generation derives the
   fingerprint but never changes the version.
2. Add one row to `cpp/engine/worldgen_features.def`. The registry generates the
   internal family enum, callback declarations, dispatch table, reach,
   composition, and context registration, so there is no parallel switch or
   registration site.
3. Implement that row's pure plan/query/overlap/stamp callbacks in
   `cpp/engine/world_context_impl.inc`. Keep an implementation-private plan
   beside them, or add one typed plan record and planner declaration to
   `cpp/engine/world_context.hpp` when specialized drawing code must consume it.
   The plan owns placement,
   sub-geometry, stable IDs, and candidate acceptance; both raster and context
   consume it. Specialized drawing code must not derive placement or containment
   independently. No generation-stage or context-dispatch switch is required.
4. Attach spawn rules through `CreatureWorldRule`; keep live collision and
   material eligibility in `boxFitsHabitat`.
5. Increment `WORLD_GENERATION_VERSION` in `cpp/engine/terrain.hpp` for a raster,
   containment, or semantic-identity change. After inspecting the intended
   all-planet raster and context result, add its matching `GOLDEN_BY_VERSION`
   entry in `scripts/worldgen-version-test.mjs`.
6. Add determinism, containment, overlap-priority, and streaming assertions to
   the appropriate suite, then run:

   ```sh
   npm run generate
   npm run build:sand -- --dev
   node scripts/run-tests.mjs --only world-context
   node scripts/run-tests.mjs --only structures
   node scripts/run-tests.mjs --only worldgen-version
   ```

## Adding a generation stage

`cpp/engine/worldgen_stages.def` is the registry for ordered whole-world passes.
It is separate from `cpp/engine/worldgen_features.def`, whose rows describe
candidate-planned feature families.

1. Add a row in execution order with a dense ID, generation-profile mask,
   optional feature stage, horizontal/vertical overscan, and callback. IDs are
   stable within a world-generation version; insertion or reordering is a
   versioned compatibility change. Use
   `runGeneratedFeatureStage` when the stage only schedules a feature phase.
2. For another pass shape, implement the uniformly shaped callback in
   `cpp/engine/world_context_impl.inc`. The registry generates its declaration
   and ordered dispatch entry.
3. Set overscan to contain the widest write performed outside the requested
   band and add an invariant when a fixed template determines that reach.
4. Increment the world-generation version, add the new version's inspected
   golden, and run `node scripts/run-tests.mjs --only worldgen-quality`,
   `node scripts/run-tests.mjs --only worldgen-version`, and the affected domain
   suite.

## Adding a facility or ruin archetype

`cpp/engine/worldgen_structure_archetypes.def` owns variants of the existing
off-world facility and cave-ruin families. Other structure families are
generated sites and use `cpp/engine/worldgen_features.def` instead.

1. Append a dense, stable-ID facility or ruin row with its selection, size,
   reach, and profile metadata. Facility `aboveDeckReach` contains every write
   above its deck. Ruin chances for the same preferred cave profile are
   increasing cumulative cutoffs in registry order.
2. Implement the row's named local stamp lambda in
   `cpp/engine/worldgen_offworld.inc` for a facility or
   `cpp/engine/worldgen_surface_structures.inc` for a ruin. The registry derives
   the enum, metadata table, reach, and stamp dispatch from the same row.
3. Increment the world-generation version, add the new version's inspected
   golden, and run `node scripts/run-tests.mjs --only structures` and
   `node scripts/run-tests.mjs --only worldgen-version`.

## Design references

The split follows Minecraft Bedrock's public model:

- [Biome tags are reusable by systems such as entity spawning](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/biomesreference/examples/components/minecraftbiomes_tags?view=minecraft-bedrock-stable).
- [Spawn conditions compose biome, light, density, distance, height, village,
  and weight policy](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/spawnrulesreference/examples/spawnrulescomponents/spawn_biomeconditions?view=minecraft-bedrock-stable).
- [Feature rules separate biome conditions and ordered placement
  passes](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/featuresreference/examples/features/feature_rule_conditions?view=minecraft-bedrock-stable).
- [Structure placement evaluates terrain constraints before stamping a
  template](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/featuresreference/examples/features/minecraft_structure_template_feature?view=minecraft-bedrock-stable).

The parent/child feature records also follow the interpretable, independently
controllable components described in [Hierarchically Composing Level Generators
for the Creation of Complex Structures](https://arxiv.org/abs/2302.01561).
