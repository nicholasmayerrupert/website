# Regional world generation

The surface is a sequence of irregular, persistent climate regions. The shared
biome catalogue owns the nominal width and boundary jitter; a region spans
576–960 cells, and adjacent regions with the same climate form longer runs.
Biome identity never switches inside a region. Relief and soil depth soften
boundaries without introducing tiny biome islands.

The underlying continental terrain supplies hills, basins, and ranges. Biome
profiles control relief, elevation, detail wavelength, soil, and local geology.
Forests contain deterministic groves and glades; trunk spacing prevents dense
vegetation from becoming an unreadable wall. Natural formations share the
existing feature planning, clipping, and streaming paths. Settlements reserve
coherent dry streets within one biome.

## Research informing this design

- [Minecraft's world-generation overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/world-generation?view=minecraft-bedrock-stable)
  describes separate terrain, biome, structure, and feature passes. We retain a
  continuous base landscape and allow local variations within each biome.
- [Factorio's autoplace breakdown](https://www.factorio.com/blog/post/fff-258)
  separates regional quantities, candidate suitability, and placement. We use
  spatially correlated grove density plus separated candidates, and reject
  geological features at cave mouths and settlements.
- [Starbound's early biome design notes](https://playstarbound.com/biomes/)
  emphasize cohesive foreground/background vegetation and variation within a
  biome identity. Our palette, flora, soil, and formations come from that shared
  identity. These notes describe design intent, not a specification of the
  released game's placement algorithm.

These are adaptations for an infinite two-dimensional streaming world, not
reimplementations of those games' generators. Coordinates and seeds determine
the result independently of viewport dimensions or generation order.
