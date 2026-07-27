# Rigid-body collision

Free bodies use a continuous pose over a pixel occupancy mask. Mass, inertia,
boundary samples, and the local AABB are derived from occupied cells. The solver
lives in `rigid_impl.inc`.

## Collision pipeline

- Substep count uses linear speed plus angular tip speed, capped by
  `R_MAX_SUBSTEPS`.
- Boundary samples include cell centers, exposed face midpoints, and exposed
  convex corners. They are rebuilt only when occupancy changes.
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
while each layer stamps only its own materials. This joint is assigned only when
one structural detachment creates both halves; ordinary bodies never acquire a
cross-layer joint through contact or overlap.

When a component-backed body sleeps on terrain or powder, its current raster is
registered through the ordinary stone, ice, and plant component paths and the
body is deleted. Cross-layer halves sleep and bake together, then refresh their
shared component index and support closure before either layer can move the new
static components. A body floating in liquid or supported only by free bodies
stays dynamic. The generic `RIGID` material has no static component form and
never bakes. A later structural break rechecks the full detached assembly against
its remaining granular footprint, so a few trapped grains cannot pin a large
baked island. If the loose footprint drains completely, the baked component
returns to the body solver; intact supported stacks remain baked.

## Fluids and loose solids

Liquids do not collide as terrain. Buoyancy depends on exterior liquid connected
to the body's expanded raster boundary, material density, and drag. Fluid
retained in an open basin is cargo rather than displaced exterior volume, so it
falls with its container without slowing the container through self-buoyancy. A
body entering liquid relocates displaced cells to the nearest reachable space,
treating its own raster as traversal-only space. Other bodies remain barriers.

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
