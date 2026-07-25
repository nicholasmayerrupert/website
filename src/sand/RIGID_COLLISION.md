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

## Fluids and loose solids

Liquids do not collide as terrain. Buoyancy depends on submerged boundary samples,
material density, and drag. A body entering liquid relocates displaced cells to
the nearest reachable space, treating its own raster as traversal-only space.
Other bodies remain barriers.

Powders provide one-way support and can be displaced by a sufficiently heavy
body. They never push a rigid body upward.

## Invariants and limits

- A body stamps its real material into the grid; `bodyOwner` distinguishes it
  from identical static terrain.
- The sweep uses first-order target motion within each substep rather than exact
  continuous rotation.
- Curved masks can occupy several manifold buckets and cost more than flat
  contacts.
- Deep stacks converge at the sequential-impulse rate. Ordinary bodies use 64
  solver iterations; scenes containing only small blast debris use 16.

Constants live in `common.hpp`. Validate collision changes with
`npm run test:rigid-collision`, `npm run test:rigid-topple`,
`npm run test:rigidmat`, and `npm run bench:rigid`.
