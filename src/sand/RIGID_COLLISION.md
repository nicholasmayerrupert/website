# Rigid-body collision

Free bodies use a continuous pose over a pixel occupancy mask. Mass, inertia,
boundary samples, and the local AABB are derived from occupied cells. The solver
lives in `rigid_impl.inc`.

## Collision pipeline

- Substep count uses linear speed plus angular tip speed, capped by
  `R_MAX_SUBSTEPS`.
- Boundary samples include cell centers, exposed face midpoints, and exposed
  convex corners. They are rebuilt only when occupancy changes.
- Sweep-and-prune generates horizontally overlapping body pairs. Candidate
  pairs are restored to body-index order before contact generation so the
  sequential impulse result stays deterministic.
- Body/body and body/terrain checks sweep each sample's relative substep path in
  increments no larger than `R_SWEEP_STEP` and refine the first hit.
- Contact normals come from the target mask. Contacts are bucketed by normal
  direction so distinct faces do not collapse into one diagonal manifold.
- Sequential impulses solve normal velocity, friction, penetration bias, and a
  fixed impact restitution target. Slow resting contacts target zero rebound.
- Raster depenetration remains a last-resort fallback.

Contact damping lets stable bodies sleep, but angular damping is skipped while a
contact is consistently converting a fall into a real topple. Bodies treat the
loaded-window boundary as solid; camera-driven streaming persists bodies through
the chunk store instead of using that collision wall.

## Component-to-body lifecycle

An erase, cut, or explosion marks the edited support closure. Grounding then
classifies the affected components before assembly motion; a formerly supported
connected group that lost its last static support is removed from the component
lists and spawned as one body. Naturally unsupported components retain their
lightweight component motion. Mixed-material groups carry an occupancy-sized
material map; mass, center of mass, inertia, stamping, erosion, TNT fuses, and
baking all use the material at each local cell. Cross-layer bonded groups split
into one body with a foreground solver leader and a background follower. Its
union mask supplies combined mass and collision against terrain in either layer,
while each layer stamps only its own materials. Damage refloods that union after
both mirrored cuts; disconnected pieces receive independent local centers of
mass, and a piece that survives in only one layer becomes an ordinary body there.
This joint is assigned only when one structural detachment creates both halves;
ordinary bodies never acquire a cross-layer joint through contact or overlap.

When a component-backed body sleeps on terrain or powder, its current raster is
registered as isolated material components and the body is deleted. Every
partition receives one baked-assembly tag, preventing stone, ice, plants, and
other materials from merging into unrelated same-material terrain. The ordinary
component contact graph supplies support and reconstructs the assembly when it
detaches; a cut that disconnects the raster produces independent pieces.
Cross-layer halves receive the same assembly tag and bake together. A body
floating in liquid or supported only by free bodies stays dynamic. The generic
`RIGID` material has no static component form and never bakes. A later structural
break rechecks the full detached assembly against its remaining granular
footprint, so a few trapped grains cannot pin a large baked island. If the loose
footprint drains completely, the baked component returns to the body solver;
intact supported stacks remain baked.

## Fluids and loose solids

Liquids do not collide as terrain. A sparse pressure projection gathers a
connected neighborhood around awake body surfaces, predicts liquid and body
gravity together, and solves pressure against liquid, terrain, free surfaces,
domain cutoffs, and the shared body degrees of freedom. The near-field band is
always eight cells deep, independent of body area. Overlapping body
neighborhoods form one domain. Only raster boundary cells seed it; liquid
covered by the solid is excluded, while liquid in a cavity enters through its
wet interior walls.

The unresolved reservoir uses hydrostatic profiles from the nearest open
columns on the two sides of each body. Each profile integrates the actual
material density down the column, so local surface height and stacked liquid
densities reach the cutoff without a connected-pool flood. Cutoff faces
interpolate the two profiles, retain the adjacent cellular velocity, use a
distance-scaled lateral pressure response, and exchange viscosity with that
reservoir. A sealed region with no nearby open column reuses its persistent
pressure. If the local band encounters more than one liquid material, the
connected liquid region joins the pressure projection so the density interface
is represented exactly. Pressure and viscosity apply equal-and-opposite
impulses to liquid and bodies. A nonnegative pressure constraint prevents
unphysical suction. The solve handles both layers of a cross-layer body as
separate fluid domains coupled by the shared body motion.
Its iteration cap and traversal orders are deterministic. Persistent cellular
liquid velocity propagates dynamic motion beyond the near-field cutoff across
ticks. For ordinary single-material pools, pressure cost scales with wet
perimeter rather than body or lake area.

Liquid cells carry compact two-axis coupling velocity in addition to the
cellular automaton's downward fall distance. Pressure is warm-started from the
prior tick, while conservative local viscosity damps grid-scale velocity
differences. Uniform motion is unchanged, so liquid on or inside a freely
falling body shares its frame without basin, cargo, or inside/outside
classification. A body in a terrain-supported pool receives buoyancy from the
pool's pressure field. Only local wet faces receive viscosity; liquid-only
contact does not use solid-contact settle damping. Fluid-supported bodies sleep
only after reaching a free surface and remaining below the fluid sleep velocity
through an extended quiet interval.

A body entering liquid relocates displaced cells to the nearest reachable
space, treating its own raster as traversal-only space. Other bodies remain
barriers.

Powders provide one-way support and can be displaced by a sufficiently heavy
body. Material above a body contributes granular confinement only when the
underside footprint can bear the body's mass, so loose cargo cannot slow or
re-ground an airborne body. Powders never push a rigid body upward.

## Invariants and limits

- A body stamps its real material into the grid; `bodyOwner` distinguishes it
  from identical static terrain.
- Body-owned cells are not grounding anchors. Static solids resting only on a
  free body detach and join the body solver.
- The sweep uses first-order target motion within each substep rather than exact
  continuous rotation.
- Curved masks can occupy several manifold buckets and cost more than flat
  contacts.
- Deep stacks converge at the sequential-impulse rate. Ordinary bodies use 64
  solver iterations; scenes containing only small blast debris use 16.

Constants live in `common.hpp`. Validate collision changes with
`npm run test:rigid-collision`, `npm run test:rigid-topple`,
`npm run test:rigidmat`, `npm run test:detached-rigid`, and
`npm run bench:rigid`.
