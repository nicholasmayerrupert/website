# Rigid-body collision

Free bodies use a continuous pose over a pixel occupancy mask. Mass, inertia,
boundary samples, and the local AABB are derived from occupied cells. The solver
lives in `rigid_impl.inc`.

## Collision pipeline

- A conservative full-tick broadphase partitions bodies into candidate islands.
  Each island chooses its own substep cadence from linear speed plus angular tip
  speed, capped by `R_MAX_SUBSTEPS`; an isolated fast projectile therefore does
  not make a distant resting structure run at the projectile's cadence. A pile
  containing at least four structure-scale bodies and a cross-layer joint uses
  at least four temporal substeps so support is relinearized through both layer
  passes before the next world tick.
- `computeDerived` converts each occupied row into runs and merges identical
  runs vertically. The result is an exact, non-overlapping rectangle cover of
  the pixel mask: a box or beam is one child and a 120×120 L with eight-cell
  arms is two. Each child face stores only the sub-spans exposed in the original
  mask, so internal decomposition seams cannot generate contacts. Dev builds
  verify exact coverage and face exposure after every validated phase.
- Boundary samples remain available for terrain collision and the conservative
  body/body sweep fallback. They include cell centers and exposed face
  midpoints. Large and slender masks also sample exposed convex corners so a
  rotating endpoint cannot cross a thin collider between face samples. Samples
  and compound children are rebuilt only when occupancy changes.
- A persistent sweep-and-prune order generates horizontally overlapping body
  pairs. Insertion repair is linear in the common coherent case. Candidate pairs
  are restored to body-index order before contact generation so the sequential
  impulse result stays deterministic.
- Body/body candidates first test overlapping child rectangles with oriented-box
  SAT. Highly compound pairs traverse balanced collision trees over bounds that
  span the current and substep-end poses. Child frames and swept node bounds are
  computed lazily once per body pose and reused across all candidate body pairs;
  smaller compounds use direct endpoint-AABB checks. Surviving pairs return to
  child-index order before contact generation. Reference and incident edges are
  clipped against exposed sub-spans on both children, producing one- or
  two-point local-feature manifolds. The current pose is tested first and the
  substep-end pose supplies speculative contacts. A coherent separating axis is
  retained briefly by body id and geometry revision; newly exposed far-side
  features cannot reverse an established contact while a thin pair is crossing
  a pixel boundary.
- Body/terrain checks sweep each sample's relative substep path in increments no
  larger than `R_SWEEP_STEP` and refine the first hit. The same sweep remains a
  body/body CCD fallback when the compound children have not reached a current
  overlap. Conservative swept oriented bounds test the bodies' current and end
  axes with translation and rotational point-reach limits; separation on any
  axis proves that a body pair cannot meet before entering that fallback. An
  in-bounds oriented terrain envelope expands the current bounds by the complete
  substep reach and scans only its horizontal row spans. An empty envelope proves
  that terrain sampling has no possible hit.
  Compact bodies use the point tangent over the short substep. Large rotating
  bodies, including very long beams, evaluate the exact constant-linear/angular
  trajectory and target rotation so a distant tip cannot tunnel through terrain
  or another body. Their immutable sample radii and substep-constant speed terms
  are computed outside the sample loops.
- After the raster sweep finds real contact between two genuinely large,
  slender bodies, oriented rectangles supply a stable minimum-overlap reference
  axis. Near-parallel pairs also receive two span support points so
  shallow-angle, longitudinally offset beams cannot pass through one another
  when sparse samples alternate sides. Crossed beams retain their local raster
  anchors, and positional bias always uses measured raster penetration rather
  than bounding-box overlap. Span points require both masks to fit their bounds
  closely: at least 75% of the bounding rectangle is occupied, or a mask no more
  than four cells thick has occupancy in every major-axis row or column. Sparse
  shapes with broad empty bounds or major-axis gaps keep only their real raster
  anchors, so a local contact cannot become a body-wide support surface. The
  fallback never creates contact from bounding rectangles alone and is
  restricted to pairs with `maxR >= 24` and at least a 4:1 bounding-box aspect
  ratio; ordinary debris retains the exact raster path and its lower collision
  cost. These pairs also use refined penetration depth and a tighter positional
  slop.
- Contact normals come from the target mask. A body sample surrounded by
  occupied mask cells uses its nearest empty axial direction instead of a radial
  guess. A symmetric terrain cell uses the side facing the body's center, so a
  one-cell wall produces a horizontal normal instead of an arbitrary upward one.
  Contacts are bucketed by normal direction so distinct faces do not collapse
  into one diagonal manifold. Body/body buckets must also face the separating
  half-space. A long/small pair derives it from the long body's minor axis, and
  parallel long pairs use their shared minor axis, rather than allowing
  longitudinally offset centers to hide a valid support face. First-hit sweep
  normals on sparse-bounds shapes use the entered local face even when a remote
  concave arm puts the body's center outside that local half-space. Far-side
  samples from a deep overlap are discarded instead of creating opposing
  constraints.
- Per-layer contact caches match local anchors by stable body id, geometry
  revision, compound child and face-span feature ids, peer layer, and normal
  bucket. Persistent normal and friction impulses warm-start the next
  substep/tick, while restitution remains an impact-only target and positional
  bias stays separate. Large manifolds retain a missed anchor for up to two
  substeps with decaying impulses to bridge raster-boundary transitions. A
  mixed-size pair receives that persistence when either participant is large,
  independent of body-index order. Low-impact contacts between structure-scale
  bodies, and between a structure-scale body and terrain, retain the complete
  cached manifold impulse; smaller and changing contacts use the damped warm
  start.
- Sequential impulses solve normal velocity, static/dynamic friction,
  penetration bias, and a fixed impact restitution target. Ice contacts select a
  lower material-pair friction. Each contact's fixed inverse normal, tangent,
  and positional effective masses are prepared after the substep's wake
  decisions and reused for every solver iteration. Moving cross-layer bodies use
  the tighter positional slop against terrain as well as other bodies so both
  layer rasters remain outside the ground. After a terrain-supported body enters
  the existing settle band, its terrain contacts use the ordinary raster slop so
  half-cell contact depths do not alternate positional correction. Two
  well-separated contacts on one face use a coupled two-point normal solve,
  which prevents a long resting face from alternating support between its
  endpoints.
- Contact islands are ordered from the lowest contact upward for the first
  passes, then alternate direction. Iteration budgets scale with island size,
  retain a minimum for large bodies, and use the full cap for impacts. Islands
  of at least twelve single-layer bodies under spatial force also run velocity
  constraints to a no-op or the cap so sustained acceleration converges as one
  contact network. Cross-layer joint islands retain residual convergence.
- The continuous solve is reconciled with the integer output raster before
  stamping. Structure-scale bodies receive an exact footprint check. Shared
  output cells between two large bodies are separated by the smallest
  terrain-safe sub-cell translation when one exists. Terrain recovery then
  evaluates complete support islands; if it changes a pose, exact body-pair
  reconciliation runs once more so neither constraint class can invalidate the
  other. A pair that cannot be separated locally retains one or both bodies at
  their last jointly clear poses. An active body restored to an exact clear pose
  keeps its angular and tangential velocity. Dynamic contact islands remove
  only linear velocity relative to the island that points back through the
  rejected correction; terrain-contact and kinematic islands use the static
  world as that reference. Bodies already in the world rest
  band park there, as does the final whole-stamp fallback for a body with no
  representable proposed cells. One-cell lattice aliasing is tolerated while
  bodies remain dynamic, but overlapping bodies cannot bake into static terrain.
- Raster depenetration remains a last-resort fallback.

Contact damping lets stable bodies sleep, but angular damping is skipped while a
contact is consistently converting a fall into a real topple. In the current
world-bridge solver, a structure-scale body pivoting directly on terrain also
stays outside angular rest damping until its perimeter speed enters the rest
band. A body crossing an infinite world's loaded-window boundary stays fixed
until streaming brings its complete occupied shape back into the window. Finite-
world boundaries remain solid, and camera-driven streaming persists bodies
through the chunk store.

The ordinary sleep path uses tight instantaneous linear and angular velocity
thresholds. A cold fallback also tracks the centre of mass and two shape-scale
world-space probes. A contact island with frictional support sleeps when every
member remains inside the two-cell pose envelope for 180 world ticks. Actor
contact, spatial forces, fluid-only support, fast point motion, geometry changes,
and explicit wakes reset the envelope. Brief raster-manifold gaps retain an
already established probe; actual free fall leaves the speed band or pose
envelope before the sleep interval. The whole island sleeps together, and its
solved load-bearing anchors preserve diagonal and cross-layer support. For a
substantial ordinary body, a one-sided static terrain contact never becomes a
sleep anchor and carries no persistent friction when the body has no upward or
body contact, so a nearby wall cannot counter gravity after an impact ends.
Opposing walls can still support a genuinely wedged body. Tiny blast debris and
cross-layer joints retain their pile/contact policy. Component-backed bodies pass
through the same stable-raster and support checks before baking.

The exact inverse-raster footprint is cached for one pose and geometry revision.
Systems that query an unchanged pose reuse the same ordered world/local cells.
Actor pushing first rejects the complete swept center-line capsule when no live
actor AABB can intersect it. Contact uses the body's actual translation plus the
local angular sweep, so rotating tips push actors without a center translation.
Actor-owned collision queries test every other body's finalized raster directly
while body stamps are absent; a push blocked by terrain or another body applies
the actor's crush lifecycle when the body's occupied footprint is large enough
relative to the actor. Smaller trapped rubble stays pinned without becoming a
lethal slab. Actor resolution never changes either body's pose or velocity.
Fluid coupling performs a boundary-only liquid preflight before stamping body
footprints into its pressure domain.

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
both mirrored cuts. Foreground and background cells remain bonded while their
projected union is eight-connected, even if damage removes the last exactly
co-occupied cell. A real gap splits the union; disconnected pieces receive
independent local centers of mass, and a piece that survives in only one layer
becomes an ordinary body there.
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

Generic creative `RIGID` has no material-specific reaction flags, but its body
cells erode next to acid, lava, or fire. Component-backed bodies instead retain
their material identities and use the corresponding dissolvable or flammable
flags.

## Fluids and loose solids

Liquids do not collide as terrain. A sparse pressure projection gathers a
connected neighborhood around awake body surfaces, predicts liquid and body
gravity together, and solves pressure against liquid, terrain, free surfaces,
domain cutoffs, and the shared body degrees of freedom. The ordinary near-field
band is four cells deep, ice uses eight cells, and a density interface extends
only the affected body's band to 24 cells. These bounds are independent of body
area and reservoir size. Overlapping body neighborhoods form one domain. Only
raster boundary cells seed it; liquid covered by the solid is excluded, while
liquid in a cavity enters through its wet interior walls.

The unresolved reservoir uses hydrostatic profiles from the nearest open
columns on the two sides of each body. Each profile integrates the actual
material density down the column, so local surface height and stacked liquid
densities reach the cutoff without a connected-pool flood. Cutoff faces
interpolate the two profiles, retain the adjacent cellular velocity, use a
distance-scaled lateral pressure response, and exchange viscosity with that
reservoir. A sealed region with no nearby open column reuses its persistent
pressure. The same bounded band crosses liquid-density interfaces; its cutoff
faces use the adjacent material density and the mixed-density column profile.
Pressure and viscosity apply equal-and-opposite impulses to liquid and bodies.
A nonnegative pressure constraint prevents unphysical suction. The solve handles
both layers of a cross-layer body as separate fluid domains coupled by the shared
body motion.
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

A body entering liquid relocates displaced cells through reachable medium,
treating its own raster as traversal-only space. Other bodies remain barriers.
At a density stack and for liquids lighter than water, reachable free-surface
outlets are filled from the lowest row and spread across that row; ordinary
single-fluid wake exchange keeps its nearest-outlet behavior.

Powders provide one-way support and can be displaced by a sufficiently heavy
body. Material above a body contributes granular confinement only when the
underside footprint can bear the body's mass, so loose cargo cannot slow or
re-ground an airborne body. Powders never push a rigid body upward.

## Invariants and limits

- A body stamps its real material into the grid; `bodyOwner` distinguishes it
  from identical static terrain.
- Body-owned cells are not grounding anchors. Static solids resting only on a
  free body detach and join the body solver.
- Compact-body angular sweeps use a first-order tangent within each substep;
  large bodies and long beams use exact constant-velocity rotation.
- Curved masks can occupy several manifold buckets and cost more than flat
  contacts.
- Child rectangles are tested directly within small broadphase body pairs.
  Highly compound bodies use their balanced collision trees, with per-pose lazy
  caches for child frames and swept node bounds.
- Deep stacks converge at the sequential-impulse rate. An ordinary contact
  island starts at 12 iterations plus two per body, large-body islands use at
  least 32, impacts can use 64, and small blast-debris islands use 16.
- The shipped WASM solver is single-threaded. Its island partition is also the
  scheduling boundary for a future threaded build, but browser threads require
  a worker sidecar, shared memory, and cross-origin isolation across every host.

Constants live in `common.hpp`. Validate collision changes with
`npm run test:rigid-collision`, `npm run test:rigid-dense-pile`,
`npm run test:rigid-large-body`, `npm run test:rigid-shape-stress`,
`npm run test:rigid-complex-stack`, `node scripts/rigid-jitter-test.mjs`,
`npm run test:rigid-topple`,
`npm run test:rigidmat`, `npm run test:detached-rigid`, and
`npm run bench:rigid`. Use `npm run bench:rigid-acid` for repeated
large-body fragmentation and repair, and `npm run bench:rigid-long` for sustained
large/long-body contact.

## Design references

The contact persistence, block solve, island scheduling, substep, and continuous
collision choices follow the same families used by production engines:

- [Box2D Solver2D](https://box2d.org/posts/2024/02/solver2d/) compares PGS,
  temporal substepping, block solving, persistent anchors, soft constraints, and
  XPBD.
- [Box2D simulation islands](https://box2d.org/posts/2023/10/simulation-islands/)
  describes the graph boundary used for sleeping and parallel scheduling.
- [Jolt Physics architecture](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md)
  describes island-wide sleep and bounded world-space point motion over time.
- [Box2D continuous collision](https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf)
  and the [Box2D simulation documentation](https://box2d.org/documentation/md_simulation.html)
  cover time-of-impact and speculative contacts.
- [PhysX simulation](https://nvidia-omniverse.github.io/PhysX/physx/5.7.0/docs/Simulation.html)
  documents temporal Gauss-Seidel substepping and solver iteration controls.
- [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf)
  provides the compliance-based alternative for constraints that need
  timestep-independent stiffness.
