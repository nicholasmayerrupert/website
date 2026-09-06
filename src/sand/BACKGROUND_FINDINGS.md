# Background investigation and correction

The screenshot shows a coherent Watchwood foreground, with a snow-covered far
mountain, green scenery at the left, and broad triangular faces across the plum
ridges. The investigation identified the following causes.

## Different regional maps at each depth

The investigated `createBiomeScenerySampler` grouped real climate districts by majority vote:
768 cells for near scenery, 1536 for the middle layer, and 3072 for the far layer.
The middle/far boundaries lie on their own regular lattices, while the actual
terrain has jittered boundaries. Tie-breaking can select another biome for an
entire distant group. This is fixed spatial scenery, but it does not guarantee
that the layers share the foreground's identity.

Confirmed with seed 7 at world x=416: the near and middle samples are Watchwood,
but the far sample is forest. At x=832, the samples are tundra, Watchwood, and
forest respectively. Forest's background profile carries alpine mountains and
snow, so the white distant peak does not imply a mountain biome underfoot.
The screenshot's seed and position were not supplied; these are reproducible
examples of the same mechanism, not a claim to have recovered that exact scene.

## Shading does not follow the local landform

`drawRidge` places triangular faces every 72 or 84 background pixels, regardless
of whether the anchor is a summit, valley, dune, or biome boundary. The triangle
uses the palette and relief at its left anchor but extends across neighboring
samples. Only the full ridge silhouette clips it. Consequently a large dark
triangle can span the spatial color blend and dominate a low rounded hillside.
The repeated triangular wedges are authored shading geometry, not transparent
layers accidentally rendering twice.

## Decorations have approximate ground placement

Eye groves and other scenery use the near ridge height at each trunk plus a row
offset. They do not sample a two-dimensional ground surface or interact with
individual shaded faces. A trunk base can therefore appear to stop halfway down
a face. These decorations are drawn with alpha 1; they are not crossfading.

## Implemented correction

All layers sample the same actual world-biome sequence; the independent majority
vote maps are removed. Each layer retains its own horizontal and vertical
parallax rate. Consequently a real boundary projects to different screen
positions at different depths, but layers no longer invent conflicting regions.
Scenery remains world-anchored: panning neither morphs heights nor fades plants.
A browser regression checks that all four terrain layers move at distinct rates.

Earth's mountain faces follow local peaks and downhill spans. Rolling hills and
dunes have no large triangular faces. Background fossils use tilted, rounded
skulls, tapering broken ribs, and small fragments at their bases.

This preserves real parallax rather than forcing boundaries into one vertical
line. Distant layers cover more world space, so neighboring biomes can still be
visible beyond the local region; that is the expected projection of a shared
world map.
