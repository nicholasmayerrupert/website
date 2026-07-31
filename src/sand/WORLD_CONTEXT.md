# Semantic world context

The infinite world has two kinds of state:

- Generated facts are pure functions of the world seed, planet, worldgen
  version, and absolute coordinates.
- Mutated cells and live actors are stored by the streaming and actor systems.

`WorldContextSystem` owns the generated facts used outside terrain stamping. A
query returns the surface biome, cave biome, surface Y, depth, composable area
tags, and the innermost generated feature at one absolute world coordinate.
Feature IDs and parent IDs are stable within a worldgen/context version.

The catalogue currently plans:

- Earth settlements and their role-specific child buildings
- Earth mines and their headhouse/gallery roles
- Moon and Mars facilities

The same plan functions are consumed by `worldgen.inc`, so a semantic record
cannot drift from the anchor, dimensions, or terrain constraints used to stamp
its geometry. Settlement membership remains true if simulation later damages a
building; it describes the designated generated site rather than inferring
meaning from mutable materials.

## Context hierarchy

Area tags are composable. A village home interior has `SURFACE`, `STRUCTURE`,
`SETTLEMENT`, `BUILDING`, and `INDOOR`. Its feature is
`VILLAGE_BUILDING`, its role is `HOME`, and its parent ID identifies the
surrounding `VILLAGE`. A mine gallery uses `UNDERGROUND`, `STRUCTURE`, and
`MINE`.

`engine.worldContextAt(worldX, worldY)` exposes the packed context through the
WASM adapter. Bounds are inclusive. The query is independent of the loaded
window, camera, and viewport size.

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

The current combat roster uses these affinities:

- Dynamiteers favor settlements and open/dry surface biomes.
- Bore sentinels favor mines, deep areas, geodes, and fossil caverns.
- Caustic mortarmen favor deserts, jungles, and swamps.
- Cluster wasps favor forests, jungles, and swamps.
- Minigunners favor mines, off-world facilities, deep areas, crystal caves,
  magma realms, and voids.

Surface combatants cannot naturally materialize inside designated building
interiors.

## Adding a generated site

1. Add a stable feature kind, role, or area tag to `abi.schema.json` and bump
   the ABI version.
2. Add one plan struct and pure plan function to `WorldContextSystem`. Include
   every placement constraint used by geometry generation.
3. Make the worldgen stamp consume that plan.
4. Extend `WorldContextSystem::at` from parent region to child site, returning
   the innermost matching record.
5. Add context determinism, nesting, and streaming checks to
   `scripts/world-context-test.mjs`.
6. Attach spawn rules through `CreatureWorldRule`; keep live collision and
   material eligibility in `boxFitsHabitat`.

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
