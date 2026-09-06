# Procedural biome landmarks

`cpp/engine/worldgen_landmarks.inc` stamps foreground architecture and coordinated
background rooms from deterministic absolute-coordinate plans. `LANDMARKS` and
`landmarkKindForBiome` in `world_context.hpp` own the catalogue and selection.

| Biome | Landmarks |
| --- | --- |
| Plains | Windmill granges with lattice sails; stone aqueducts with dressed arch rings, keystones and hillside abutments |
| Forest | Unequal-towered castles; breached abbeys with rose windows |
| Desert | Gold-capped pyramids with galleries and burial chambers; pylon tomb complexes |
| Bone highlands | Fallen serpents with articulated ribs and limbs; rib-vaulted ceremonial halls; spiked hunter camps; tusk-bound lookouts |
| Tundra | Longhouses; suspended icewatch bridges; igloo clusters with entrance tunnels and sleeping platforms |
| Jungle | Stepped sun temples; overgrown colonnaded sanctuaries |
| Swamp | Stilt hamlets with boardwalks; partly submerged ruined rotundas |
| Watchwood | Iris cathedrals; domed star observatories |

## Placement and ground contact

A 640-cell district has a 46% landmark candidate chance. Four deterministic site
attempts test a full footprint against biome borders, water, slope, cave mouths,
and authored content. Rejected sites remain wilderness. Foreground and background
use the same foreground terrain queries and plan cache. Landmarks reserve space
before villages, mine entrances, ruins, formations, and trees.

Abbey and rotunda roofs retain continuous silhouettes; masonry courses, trim and
vegetation carry their weathering. Aqueduct piers carry a continuous channel with
radial stone joints and contrasting keystones.

Buildings use buried column foundations and up to 24-cell stepped soil approaches.
Swamp buildings use embedded piles. Serpent vertebrae follow a smoothed local ground
profile, each curved rib terminates in its own buried foot, and broken limbs rest
on the slope. Small fossil rib formations also extend individual feet into soil.
Support columns preserve natural cave voids rather than plugging entrances.

The generation version is 21; semantic landmarks use `WORLD_FEATURE.LANDMARK`.
The existing engine component-registration pass owns every rigid cell. No separate
visual overlay or unsimulated collider represents these landmarks.

Run `node scripts/run-tests.mjs --only worldgen-landmarks,bone-highlands,structures`
for catalogue reachability, biome coherence, viewport equivalence, streaming,
settling, and structure integration checks. `worldgen-version` protects the raster
and context fingerprint; `worldgen-quality` checks cave access.

## Player access

`worldgen_access.inc` provides shared access stamps. Apply access routes after
roofs, piers, furnishings and rubble: foreground aisles have thirteen cells of
clearance and two-cell-thick connected treads. The player is four cells wide and
eight high, steps up two cells, and jumps about twenty-six cells on Earth.
Tower, mine and facility stairwells use alternating five-cell landings twelve
cells apart, with an open channel beside each landing. Cave branches keep their
slopes gradual enough for ordinary walking. Rear bearing walls support the open
foreground facade through cross-layer contacts.

Room floors must connect to an entrance and back without mining or jetpack use.
Check ground approaches as well as door openings; an entrance facing another
building still needs an exterior route. Keep low ceilings and decorations out of
the full body clearance above stairs. Authored campaign repair/mining objectives
are intentional obstacles, while occupied buildings retain usable access.

`node scripts/run-tests.mjs --only worldgen-navigation` drives the production
player through settlement occupations, inhabited landmarks, legacy ruins, cave
galleries, mine offices, off-world facilities, the ship and authored lodge and
observatory. It checks return trips and includes sealed-wall and inescapable-drop
negative controls. Add destinations to `scripts/fixtures/structure-navigation.json`
and the navigation suite when adding a building archetype. Streaming and
simulation stability remain covered by the structure and cave architecture suites.

## Cave architecture

`cpp/engine/worldgen_cave_architecture.inc` draws coordinated two-layer cave
rooms. `cave_sites.hpp` plans connected wings and `worldgen_cave_sites.inc` stamps
their rooms, branches and foundations. Eight upper-cave archetypes extend the
existing ruin catalogue; the four deep cavern biomes each have three large chamber layouts.

| Cave environment | Discoveries |
| --- | --- |
| General cave network | Cistern districts with water bowls and valves; branching rail workings with stations and workshops |
| Crystal caves | Prism chapels with nested luminous arches; lapidary workshops with mounted lenses and specimen benches |
| Mushroom caves | Apothecaries with jars, shelves and copper stills; spore bell gardens with layered caps and gills |
| Lush caves | Buried castle wings with crenellated towers and a lower crypt; hanging nurseries with suspended baskets and growing beds |
| Magma depths | Furnace cathedrals; chain foundries with gantries and gears; basalt pumping halls |
| Geode depths | Astral sanctuaries with concentric instruments; crystal organs; suspended lens galleries |
| Fossil depths | Mounted leviathan excavations; ossuary amphitheaters; timber-braced dig camps |
| Fungal depths | Hanging archives; mushroom villages; braided root engines around luminous seed chambers |

Upper-cave ruins use a 76-cell lattice with a 32% candidate chance, subject to cave
floor and depth constraints. Biome preferences retain a neutral pool for older
ruins, cisterns and waystations. Neighboring candidates resolve overlapping
footprints by stable feature ID; shallow ruins also respect deep monuments.

Cisterns, waystations, prism chapels, spore gardens and root cloisters reserve
208–252-cell-wide sites, 82–103 cells tall. Four or five wings occupy different
levels, joined by sloping passages with upper branches and optional lower workings.
Castle sites always include a lower crypt. Rock remains between wings; mushroom
colonies occupy open vaulted pockets instead of enclosed masonry rooms. The whole
site must remain buried, including under hillsides. Workshops, apothecaries and
nurseries provide smaller discoveries between them.

Deep chain foundries, fossil dig camps and fungal villages also use connected
sites, with three main chambers and branching routes where cavern height permits.
Only actual rooms and passages count as indoor space; the reservation also protects
the intervening natural terrain from competing structures.

Deep halls are 124–160 cells wide (limited by their cavern) and 60–80 cells tall.
Foreground vaults, galleries and stairs surround a clear lower aisle. The rear
wall carries instruments, shelves, specimens and lamps. Doorways connect to the
cave network; buried piers search for bedrock independently instead of filling
whole voids. Foundation reservations below the floor do not count as interiors.

`node scripts/run-tests.mjs --only cave-architecture,structures,deep-world,world-context,worldgen-version`
checks the twenty layouts, player-sized connectivity across sprawling sites,
clear entrances, lighting, structural stability,
viewport-independent foundations, and streaming restoration.

## Acid springs

Crystal caves contain asymmetric bowls, mineral terraces and paired pools at
different elevations. Each bowl has a continuous crystal lining, a tapered stone
bank with a pale mineral rim, and unequal crystal growths at its edges. Pool
widths fit nearby natural rock; sites without solid banks or a buried central
anchor are rejected. Pools respect constructed-site reservations so they do not
cut through ruins. The ordinary hazard-depth ramp still applies.

## Wilderness undergrowth

`worldgen_undergrowth.inc` stamps four small growth forms per surface biome
in the simulated background, after trees. Bone scrub uses ivory branches with
rust brambles, ochre heads, and teal lichen. Watchwood uses burgundy stalks, violet
fronds, and turquoise eyes. Desert has agave, prickly pears, barrel cacti and scrub;
tundra has dwarf willow, lichen, heather and cotton grass. Plains mix grasses and
wildflowers; forest mixes ferns, fungi, deadwood and berries. Jungle has broad
leaves, bracts, fern fans and bromeliads; swamp has cattails, irises, cypress knees
and marsh ferns. Plant materials are available in the Flora palette.
Jittered 14-cell slots sample a broad density field; whole growth bounds exclude
construction and root sites exclude cave mouths. Marsh plants tolerate shallow
water; dry plants require exposed soil. Roots cross loose soil to solid ground. A 12-cell horizontal and 40-cell vertical generation halo
keeps silhouettes and buried roots independent of streaming bands.

`node scripts/run-tests.mjs --only biome-undergrowth,watchwood,bone-highlands`
checks wilderness coverage, distinct colors, clear foreground travel, grounding,
viewport parity, and restoration on both streaming axes across three seeds.
