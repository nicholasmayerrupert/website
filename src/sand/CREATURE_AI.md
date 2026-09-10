# Creature decisions and navigation

`CreatureSystem` separates target selection, movement intent, local navigation,
and collision. `creatures_impl.inc` owns perception, species locomotion and the
actor update. `creature_navigation.inc` owns arrival, terrain probes, steering,
and facing. Combat consumes the same target and attack profiles but owns its
committed windup, active phase and recovery.

Target scans use body centers, retain an eligible incumbent out to 125% of sight
range, and give it a 20% distance advantage against challengers. Dead or invalid
targets disappear on the next scan. Species scan intervals receive a small,
identity-based stagger. Village defenders retain their home-region eligibility
and swimmers only hunt players in viable water. Target detection can cross
terrain; a clear attack line is a separate requirement.

Walkers approach their current attack profile's reach. Melee stops inside reach;
ranged actors seek a near/far firing band. An arrival latch adds a margin before
movement resumes, so a target or projectile knockback near a boundary does not
alternate approach and retreat. Ranged actors close distance when terrain blocks
the shot. Attack phases hold locomotion intent while combat controls lunges.
Facing follows the target outside a two-cell dead zone, otherwise actual travel,
with a twelve-tick turn cooldown. Failed movement cannot make an idle actor flip.

Ground navigation reads the live foreground and checks the species' full body,
foot support, loaded bounds and damaging material. Ordinary level travel takes a
short lookahead. Obstacles, gaps and elevated targets trigger four candidates:
walk or jump in either direction. Each candidate simulates at most 64 actor ticks
with collision microsteps, horizontal acceleration, species gravity and jump speed.
A chosen jump keeps its direction while airborne; combat phases own their motion. Candidates must
end on safe support; damaging materials are also sampled along the arc. A cost
combines horizontal/vertical goal distance and small jumping/reversal penalties.
Only the best improving candidate becomes intent. Impossible routes cause a
stable wait. Idle wanderers can turn away after a blocked interval.

Successful plans last 12–16 ticks; unsuccessful probes wait 30–36 ticks before
retrying. Current clearance, hazards and support are checked before cached ground
intent is reused. This reacts to destruction and falling terrain without a
persistent navigation mesh or a rebuild proportional to the loaded world.
Water escape continues to use the habitat-aware bank search.

Swimmers and flyers probe their desired direction before moving and choose among
seven alternative headings around an obstacle. A bias toward the selected turn
side reduces oscillation at corners. Collision removes blocked velocity rather
than reflecting it into the next steering decision. Arrival slows targeted
flight/swimming, and an engaged flyer can follow a target underground without an
unrelated procedural surface-altitude correction.

Navigation state belongs to each `Creature`, travels with dormant streaming
records, and is saved in checkpoint v6. Earlier checkpoints load neutral
navigation state. The legacy 200-byte creature prefix is asserted at compile
time; new navigation members are written individually. No navigation decision
consumes the simulation RNG. Per-creature work and lookahead horizons are bounded;
there is no unbounded search or allocation proportional to world size.

This is local navigation, not a complete platform graph search. A tall wall or a
route requiring several platforms outside the lookahead can remain unreachable.
The actor waits and retries when terrain changes. For authored routes requiring
that broader reasoning, add a bounded platform/action graph above this movement
layer; its edges must represent physically valid jumps, drops and body sizes.
A grid A* path alone does not establish that a platforming actor can execute it.

## Research behind the design

- Craig Reynolds, [Steering Behaviors for Autonomous Characters](https://www.red3d.com/cwr/steer/gdc99/)
  (GDC 1999), separates action selection, steering and locomotion. That separation
  lets all species share intent/navigation while retaining water, flight and
  gravity constraints. His arrival and obstacle-avoidance behaviors informed the
  slowing and directional probes here.
- Amit Patel, [Introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html),
  distinguishes path search from movement, body sizes, dynamic obstacles and
  changing maps. The graph must model the actions an actor can execute. This
  engine's continuously changing terrain and small encounter population favor
  bounded physical local probes before maintaining a global platform graph.
- Eric Johnson, [Taming Spatial Queries: Tips for Natural Position Selection](https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter05_Taming_Spatial_Queries_Tips_for_Natural_Position_Selection.pdf)
  discusses score bias and hysteresis for stable position selection. Target
  preference and arrival margins here apply those principles to avoid repeated
  switching near equal scores or distance thresholds.

These sources inform the architecture; the particular horizons, distances and
cost weights above are game-specific tuning choices.

Run `node scripts/run-tests.mjs --only creature-ai,creatures,enemy-ecology` for
navigation regressions alongside habitat and combat compatibility. The focused
suite exercises arrival, competing targets, obstructed pursuit, terrain edits,
jumping, target reversal during a jump, unsafe gaps, overhead targets and checkpoint continuation.
