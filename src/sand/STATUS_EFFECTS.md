# Status effects

`StatusEffectSystem` owns timed effects for players and creatures in C++/WASM.
The authority worker advances them; the browser receives presentation records and
movement/control modifiers for prediction. Effects are gameplay state, so DOM
updates, render frames, and wall-clock time never advance their timers.

## Design research

Three established designs informed this implementation:

- [Epic's Gameplay Effects documentation](https://dev.epicgames.com/documentation/unreal-engine/gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine?lang=en-US)
  separates immutable effect definitions from active instances, with explicit
  duration, periodic execution, stacking, and immunity rules. We use that
  separation and tag-based interactions without introducing an ability framework.
- [Minecraft's Effect API](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/effect?view=minecraft-bedrock-stable)
  exposes an effect's type, strength, and remaining ticks. Our instances carry
  those values plus periodic progress and source identity for deterministic saves.
- [ArenaNet's condition design discussion](https://www.guildwars2.com/en/news/combat-changes-dotsanddashes/)
  distinguishes duration stacking from intensity stacking, explains stack-cap
  problems when multiple attackers share a target, and describes whole-condition
  cleansing. Here stack policy and caps are explicit per definition, overflow is
  reported, and cleansing removes every matching stack. Movement buffs change
  ordinary locomotion; dodge distance remains fixed.

## Files and ownership

| File | Responsibility |
| --- | --- |
| `abi.schema.json`: `StatusEffect`, tags, controls, policies | Stable IDs, immutable rules and UI text |
| `scripts/status-effect-schema.mjs` | Validate definitions; emit shared C++ and JS tables |
| `cpp/engine/status_types.hpp` | Per-actor instances and cached modifiers |
| `cpp/engine/status{.hpp,_impl.inc}` | Apply, refresh, cleanse, tick, validate, snapshot |
| `content/equipment.js` | Gear's `statusEffects` and `cleanseTags` |
| `cpp/engine/checkpoint_impl.inc` | Version 8 serialization and older-save migration |
| `cpp/engine/gl_status_effects.inc` | Actor-attached visual cues, culled and drawn in WebGL |
| `embed/statusEffectHud.js` | Player badges, countdowns and accessible tooltips |

Effects live with their actor. No global actor-to-effect map or per-effect
callback allocation is needed. Unaffected actors allocate no instance storage.
Each actor has at most 32 instances; each effect has an explicit stack and duration
cap. Tick cost is linear in active instances. Locomotion reads cached multipliers
and control flags, rebuilt only when membership or strength changes. Status
snapshots aggregate stacks by effect and include only affected, active actors.

## Rules

Durations use the 60 Hz actor clock. Pausing or hibernating an off-window creature
pauses its effects. A bed's jump to morning does not fast-forward durations.
Death and respawn clear effects. Save/load preserves each stack's remaining time,
strength, source and next periodic pulse; old creature burn/chill/root timers
migrate on load. A source is an actor kind plus ID, or NONE/0 for the environment;
it need not remain loaded for an applied effect to continue. Source identity is
recorded for future attribution consumers, not currently used for kill credit.

- **Refresh:** equal strength retains the longer remaining duration. Stronger
  applications replace strength and remaining time; weaker ones are rejected.
- **Extend:** equal strength adds time up to the definition's cap. Strength
  replacement follows refresh rules.
- **Independent:** each application has its own timer, pulse phase and source.
  A full effect rejects new stacks rather than silently replacing another source.
- Reapplication preserves periodic progress, so frequent hits cannot postpone
  damage indefinitely. A pulse due on the final tick executes before expiration.
- Periodic damage bypasses armor, guard and strike immunity without granting new
  immunity frames. Damage resolves before healing; healing cannot revive an actor
  killed on that tick and never exceeds maximum health.
- Tag immunity rejects matching applications. `removeTags` cleanses matching
  effects on application. Wet removes Burning and grants FIRE immunity. Protected
  residents reject harmful effects; lava toads and bone dinosaurs reject FIRE.
- Movement multipliers compose multiplicatively and clamp to 0.1–3. Root blocks
  voluntary movement and jumping; gravity and external forces still apply.
  DISARM cancels active attacks/charges and blocks tools and guard.
- Remove-by-type and cleanse-by-tag remove all matching stacks. A zero cleanse
  mask explicitly means all effects, including buffs.

## Initial catalog

| Effect | Default | Policy | Behavior / current sources |
| --- | --- | --- | --- |
| Burning | 2 s | Refresh | 3 damage / 0.5 s; fire contact, Ember, Cindermaw |
| Chilled | 2.5 s | Refresh | 35% movement; Rime, Winterbreath, Hollow Star pull |
| Rooted | 1.5 s | Refresh | Root and disarm; Briar |
| Poisoned | 5 s | Independent, 5 | 2 damage / s per stack; available to content/engine callers |
| Bleeding | 3 s | Independent, 5 | 1 damage / 0.5 s per stack; available to content/engine callers |
| Regeneration | 5 s | Extend, 30 s cap | Heal 2 / s; Mending Tonic |
| Haste | 10 s | Extend, 30 s cap | 125% movement; Swiftness Tonic |
| Wet | 2 s | Refresh | Extinguish and resist FIRE; water/brine immersion |

Cleansing Tonic removes harmful effects. Tonics use the normal inventory and
crafting paths. Gear may override default application duration. Environmental
contact is sampled every six actor ticks, staggered by actor ID. Existing direct
contact damage remains separate from the lingering Burning effect.

## Adding content

1. Append a stable `StatusEffect` ID and descriptor in `abi.schema.json`. Supply
   duration/caps, stacking, periodic health delta, movement multiplier, tag masks,
   controls, visual profile, and UI name/description/glyph/color. Never reuse or reorder IDs.
2. Add `statusEffects: [{ effect: STATUS_EFFECT.YOUR_EFFECT, durationTicks: 180 }]` to gear,
   or call `E.status.apply(actor, STATUS_YOUR_EFFECT, ticks, strength, sourceKind,
   sourceId)` from the subsystem responsible for a confirmed hit. Zero ticks uses
   the definition default. Gear supports up to four applications per item.
3. Regenerate and rebuild with `npm run generate:abi` and `npm run build:sand`.
   Generated files are committed; never edit them directly.
4. Run `node scripts/run-tests.mjs --only status-effects,adventure-combat,game-content`.
   Add a behavior test when introducing a new mechanic, stacking rule or consumer.

The existing modifier vocabulary handles timed health, speed and control effects
without adding timers to actor structs or branches to every caller. A genuinely
new mechanic (for example, outgoing-damage reduction) should add one typed modifier
and one consumer in its owning subsystem, with schema validation and a behavior
test. Arbitrary scripts, event buses, permanent auras and cross-actor dependencies
are deliberately outside this system's current scope.

The bridge exposes `applyStatusEffect`, `removeStatusEffect`,
`cleanseStatusEffects`, and `getStatusEffects`. Applications return APPLIED,
REFRESHED, IMMUNE, FULL, WEAKER, or INVALID. Production browser input continues
through the existing authority intent path; direct application hooks are engine
and diagnostic APIs. The main-thread predictor consumes authoritative
`statusMoveScale` and `statusControls` without independently ticking effects or
health.

## Entity presentation

Each definition selects a reusable `StatusVisual` profile: fire, frost, vines,
poison, bleeding, healing, speed, water, or none. Active profiles are combined
into a cached bitmask and packed with player and creature poses; `glPlayerExt`
carries the same mask to the browser's presenter. Profiles compose when multiple
effects are active and clear when removed, expired or killed. New effect IDs can
reuse a profile without changing the rendering path.

`gl_status_effects.inc` attaches flames, ice, vines and particles to authored
sprite dimensions, using the confirmed actor clock. It emits bounded drawing
primitives only, with viewport culling and no terrain edits, RNG calls or
simulation particles. Player HUD badges provide the precise remaining duration;
entity cues make affected allies and enemies recognizable in the world.
