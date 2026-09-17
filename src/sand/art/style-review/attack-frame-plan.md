# Budget frames by visible action

Use one small source row per distinct attack body action. Start with four poses:
anticipation, release, follow-through, recovery. Map the first to windup, the
middle two to attack, and the last to recovery. A sustained action can loop its
middle poses. Durations come from gameplay; more drawings must not lengthen an
attack or change its damage window.

Generate each row separately using the same approved neutral character pose.
Keep head, palette, scale, facing and foot registration fixed. Projectiles,
breath, spell particles and impacts remain engine effects.

## Choose rows from the actual behavior

Inspect `cpp/engine/combat.hpp`, `enemy_attacks.def`, and the fallback branches
in `combat_impl.inc`, for the intended game mode. A numeric attack pattern is
not necessarily a new body action. Aster and survival sandbox can assign
quite different actions to the same underlying species.

| Aster creature | Row budget to start | Reason |
| --- | --- | --- |
| Skeleton dragon | 3 | Bite, rush, sustained fire breath |
| Frost giant | 3, already represented | Ice breath, ground smash, spear throw |
| Village guard / bone guard | 1 each | One melee action; improve anticipation, contact and follow-through |
| Village hunter / Oathless archer | 1 each | Draw, aim, release, recover |
| Thornbound Hart | 3 | Rush, ranged burst, expanding ring |
| Hollow Bellkeeper | 2 | Ring and ranged rune; two pattern IDs use the ring action |
| Mire Matron | 1 initially | Pattern changes spread; the body can share a good casting animation |
| Noncombat animals and residents | 0 attack rows | Spend their budget on movement, reactions and interactions |

The dragon images in this directory are a four-pose design study, not three
finished attack rows. Choose the design before generating its full motion set.

## Acceptance before adding more

1. At actual game size and normal speed, anticipation and release must be
   visibly different and communicate the action without relying on effects.
2. The release pose must align with the gameplay release; recovery should read
   as recovery. A held breath/cast must loop without a visible snap.
3. Check both facings and move/idle/attack transitions in the creature viewer.
   Head shape, equipment, scale and grounded foot position must stay consistent.
4. Add an in-between only for a specific missing motion: an unclear swing arc,
   an abrupt bend, a broken held loop. Holding a good pose longer is often enough.
5. Reuse rows when only projectile count, target, damage or effect color changes.
   A more dangerous variant may still deserve a distinct windup for readability.

A simple budget is nine shared poses (idle 1, walk 4, hurt 1, death 3), plus four
per distinct attack action: about 13 for one attack or 21 for three. Reusing an
idle recovery can reduce that; sustained loops may add a pose or two. These are
starting budgets, not fixed requirements.
