# Mining in Aster

## Research and design

Reviewed September 6, 2026:

- [Minecraft: Taking Inventory — Pickaxe](https://www.minecraft.net/en-us/article/taking-inventory-pickaxe) describes tool tiers that improve speed and unlock ore. Aster uses the existing material tier requirements; an inadequate pick leaves the ore intact and gives its target a red outline.
- [Stardew Valley: Pickaxes](https://stardewvalleywiki.com/Pickaxes) documents discrete strikes, reduced hit counts from upgrades, and harder rocks unlocked by stronger picks. Aster applies damage on contact, with a wind-up and recovery between strikes.
- [Minecraft controls](https://www.minecraft.net/en-us/article/minecraft-controls) uses the primary mouse button for attacking/breaking and the secondary button for placing. Aster keeps primary mining and its existing layer distinction: secondary excavates background walls through an open foreground.

These examples support readable targets, predictable effort, and meaningful upgrades. They do not establish one universally best mining system. Aster's small simulation cells and unstable terrain favor a connected patch per strike, with a short ray selecting the first surface toward the pointer. This avoids requiring precise clicks on individual pixels.

## Implemented rules

- Equip the pickaxe and hold primary to repeat swings. A started swing finishes after release. The selected surface remains fixed during that swing; the next swing follows the pointer.
- Reach is seven simulation cells from the shoulder. Aim may extend farther; the tool selects the first reachable surface along that direction.
- A strike affects a connected region of the same material within radius two, at most thirteen cells. The building footprint does not affect mining.
- Contact occurs eleven actor ticks after a swing starts. A full swing takes 28 minus twice the tool tier in ticks, with the cadence bonus capped at tier three.
- Each strike contributes `2 + tool tier` hardness units. With the starter iron pick, soil and wood take one hit, stone takes two, and iron ore takes three.
- Partial damage survives release and retargeting. Stronger tools can finish a partly mined patch. Material destruction uses component-aware removal, so unsupported structures and loose material keep their simulation behavior.
- A gold pickaxe is craftable at the forge for 24 gold ore, 48 iron ore, and 12 oak wood.
- Ore requiring a higher tier stays intact. The target outline turns red; the pickaxe tooltip explains this color.
- Liquids and gases are not excavated. Background mining cannot pass through a solid foreground surface.
- The renderer shows the connected outline, damage cracks, a swinging pickaxe, and material-colored chips. Drops use the existing physical item collection system. The frontier mining beam and cursor progress bar are absent.
- Saves retain their existing identity and checkpoint layout. Building, creative tools, and the direct sandbox keep their existing controls.

## Further tuning

Playtest tunnel clearance and ore income before changing recipe prices or vein generation. A separate shovel or axe should earn its inventory slot through a useful difference in behavior. The existing Stonebreak rune provides a place for later excavation-magic tuning; this pass does not change its balance or add a new spell.
