# Rigid-body collision

Free bodies use a continuous Box2D pose over an exact pixel occupancy mask. The
physics adapter lives in `cpp/engine/rigid_box2d.inc`; the material-grid lifecycle
lives in `cpp/engine/rigid_impl.inc`.

## Box2D world

The engine owns one persistent Box2D 3.1.1 world. It retains bodies, contacts,
the broad phase, islands, warm-start impulses, and sleep state across sand ticks.
Gravity is converted from cells per tick squared to metres per second squared at
the adapter boundary. Box2D owns integration, continuous collision, contact
manifolds, restitution, friction, island solving, and sleep.

`computeDerived` converts identical occupied row runs into an exact,
non-overlapping rectangle cover. Each rectangle becomes one Box2D polygon shape;
mass and rotational inertia are assigned from the material-weighted pixel mask,
so compound decomposition does not change dynamics. A geometry revision rebuilds
only the affected Box2D body after erosion, accretion, fracture, or a layer-role
change. Box2D first derives shape extents for continuous collision, then receives
the exact material-weighted mass data. Fast ordinary compounds enable dynamic
bullet collision; structure-scale compounds retain continuous terrain collision
without paying the quadratic dynamic bullet sweep.

Static rigid cells are covered by vertically merged row-run rectangles in each
layer. Foreground and background terrain have distinct collision categories.
Ordinary bodies collide only with terrain and bodies in their own layer. A
cross-layer leader collides with both layers and all body categories; its passive
background follower shares the leader pose and is not inserted as another
dynamic body. Per-layer terrain revisions avoid rebuilding static shapes until
rigid occupancy changes.

Finite worlds add a one-cell Box2D rim. Infinite-world streaming sentinels are
not physical walls. World shifts keep the continuous body state and invalidate
the terrain cover for the newly loaded window. A body already crossing a loaded
lateral edge has only its outward horizontal motion clamped, without wall
friction. A body whose complete compound is not loaded is disabled and retains
its pose and velocity until a shift makes the compound complete again.

Players and creatures enter the foreground solve as short-lived kinematic AABBs.
The gameplay systems retain their poses. Rigid contacts supply ordinary normals,
friction, and torque, and accumulated contact impulse feeds bounded crush damage.

## Tick ordering

Both layers complete grounding, detachment, ice accretion, and spatial forces
before either layer asks Box2D to step. The first active body pass synchronizes
all foreground and background bodies, terrain, and actors, applies fluid velocity
exchange, and advances the shared world once. Each active layer then performs its
own grid reconciliation and stamping. This ordering lets a cross-layer body see
current terrain in both layers while preserving one shared pose.

The world uses eight substeps for small scenes, six from 24 bodies, and four from
96 bodies. Box2D continuous collision remains enabled at every density. Material
restitution is selected by a callback: terrain/body and body/body impacts use
separate thresholds. Ice-majority bodies receive low friction. Structure-scale
compounds use stronger Box2D damping while a solid contact is active so long
building-size contact islands become eligible for native sleep.

## Grid reconciliation and lifecycle

Box2D shapes are continuous while the sand world stores integer cells. Before a
pose is stamped, inverse rasterization maps world-cell centres into the body mask.
The footprint is cached by pose, geometry revision, and loaded-grid dimensions.
A small collision skin keeps ordinary resting contacts outside the integer
raster. Structure-scale and quiet contact poses receive exact terrain checks;
bounded sub-cell projection resolves remaining lattice aliasing. This projection
only reconciles the output raster and does not compute collision impulses.

Displaced powder, liquid, or gas is relocated to reachable exterior cells before
the body raster is committed. Other bodies and static solids remain barriers.
Component-backed bodies bake only after a stable raster touches valid support.
Every material partition receives one assembly id, preserving component identity
and later detachment. Both halves of a cross-layer body bake atomically with the
same assembly id. Generic creative `RIGID` never bakes.

Erosion and freezing edit the occupancy mask through component-aware paths. A
cross-layer edit repairs the union before rebuilding geometry; disconnected
pieces receive independent centres of mass and single-layer pieces become
ordinary bodies.

## Fluids and powders

Liquids are not Box2D terrain. A sparse pressure projection gathers a bounded
domain around wet raster faces, predicts shared liquid/body motion, and solves
pressure against free surfaces, static terrain, domain cutoffs, and body degrees
of freedom. Ordinary domains extend four cells, ice extends eight, and affected
mixed-density interfaces extend to 24 cells. Nearby open-column profiles provide
hydrostatic boundary pressure without flooding the whole reservoir.

Pressure and local tangential viscosity exchange momentum with the body before
the Box2D step. Box2D supplies gravity and solid contacts; the pressure solve
supplies buoyancy, added-mass response, and current drag. A post-advection
corrector runs only after sufficiently large wet travel. Pressure and persistent
cellular velocity are maintained independently for both layers of a cross-layer
body while acting on its shared velocity.

Fluid-supported bodies use a quiet counter and can sleep without baking. A new
adjacent current wakes them and transfers momentum. Gas is relocated but supplies
no support. Powder supplies one-way bearing and displacement but never upward
buoyancy. Each underside column integrates as many as seven grounded powder
cells, with a one-cell raster gap allowed. The supported fraction cancels the
same fraction of gravity and applies linear and angular drag, so concentrated or
fast heavy loads continue to sink. Fully supported quiet bodies sleep and
component-backed materials can bake. Loose cargo inside or above a body does not
count as bearing support.

## Invariants and validation

- `bodyOwner` distinguishes a moving body's material from static terrain.
- Body-owned cells never become static Box2D terrain.
- A passive cross-layer follower has no independent physics pose.
- Compound rectangles cover every occupied local cell exactly once.
- Static terrain is rebuilt after body creation, deletion, baking, streaming, or
  a static rigid/non-rigid occupancy transition.
- Loose-material volume is conserved by the displacement path within each
  scenario's documented impact tolerance.

Use the dev WASM build for ownership checks:

```text
npm run build:sand -- --dev
```

Validate changes with `npm run test:rigid-collision`,
`npm run test:rigid-fluid-accuracy`, `npm run test:xlayer-fall`,
`npm run test:rigid-terrain-contact`, `npm run test:rigid-dense-pile`,
`npm run test:rigid-large-body`, and `npm run test:rigid-shape-stress`. Compare
performance with `npm run bench:sand:compare`,
`npm run bench:rigid-brutal:compare`, and
`npm run bench:actor-rigid:compare`.

Box2D source and its MIT license are vendored under
`cpp/third_party/box2d/`. The upstream simulation guide is
<https://box2d.org/documentation/md_simulation.html>.
