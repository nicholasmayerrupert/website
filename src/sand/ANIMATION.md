# Creature animation

`cpp/engine/creature_animation.hpp` owns creature presentation playback. The
simulation supplies motion, life state, attack stage, attack identity and attack
progress. `GLPresenter` adapts native creatures and replicated snapshots into
the same controller input and draws the returned frame. Neither path computes a
second live pose counter. The snapshot's `animFrame` carries the authoritative
death pose; it is zero for living creatures.

Each creature has a local clip clock. Entering a clip starts at its first pose;
repeated renders at one actor tick cannot advance it. Rewinding the actor clock
or returning after a long absence resets playback. Walking and swimming advance
proportionally to velocity relative to the species' nominal movement speed.
Flying uses elapsed time so a hovering creature keeps flapping. A shared speed
filter with separate start and stop thresholds suppresses brief collision
velocity pulses. These clocks are presentation state, not checkpoint state;
restoring a checkpoint restarts local idle/movement playback.

Priority is death, hurt/stun, rescue, attack phase, movement, then idle. Attack
poses follow authoritative phase progress and honor authored frame durations.
Looping attacks such as breath use the local clip clock. An attack retains its
pattern through recovery; the next pattern is selected when recovery finishes.
Gameplay owns damage, projectile launches, collision and cooldowns independently
of frame counts. Complete sprites contain body motion; the renderer adds no
walking bob or attack lunge to them. Hit reactions, lighting, telegraphs and
separate weapon/projectile effects remain presentation effects.

`content/creatureArt.js` stores palette-indexed frames and their durations.
`content/creatureAnimations.js` maps each attack's windup, release and recovery
to a named clip and explicit frame range. Unspecified attacks use the complete
standard clips. The compiler validates and packs the ranges in content wire
version 10. The viewer reads that same mapping; it does not infer frost attack
segments from frame counts. Additional attack poses can be imported and mapped
without adding species branches to the controller or renderer.

The player deliberately uses a separate body/arm/weapon composition because
weapons aim independently of locomotion. This controller does not alter player
animation, equipment or combat.

## Verification

Run related suites together:

```sh
node scripts/run-tests.mjs --only creature-animation,creature-animation-e2e,creature-viewer-e2e,frost-giant-e2e,dinosaur,adventure-combat,game-content
```

The controller test compiles the actual standalone C++ header and checks local
phase, speed, pause, rewind, collision settling, attack ranges, reactions,
hovering and vertical swimming. The browser test renders village guard and
frost giant through both native and replicated paths, compares blocked-pose
pixels and checks four distinct walking poses. It records a three-creature
walk / blocked / resume demonstration as `animation-test.webm`, with a PNG and
JSON checks alongside it in the test artifact directory. Wall-contact pulses
are injected for a repeatable rendering regression; the frost and combat
suites separately exercise actual attacks and projectiles.
