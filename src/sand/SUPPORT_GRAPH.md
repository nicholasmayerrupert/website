# Support graph grounding

Foreground and background rigid components support one another where they occupy
the same cell. `computeGroundedBoth()` computes this joint support without
rescanning every rigid cell on every active tick.

## Current path

1. Restore each layer's independent grounding base when topology or bonds changed.
2. Run `groundLayerBase()` for each layer, using its cache when valid.
3. Stop if every component is independently grounded.
4. Otherwise collect cross-layer bonds for unsupported components, union cached
   same-layer adjacency, and propagate support through the resulting groups.
5. Preserve the settled closure while only loose material changes and no
   unsupported bond group remains.

Free bodies and forced verification use the conservative rebuild path. Fire may
defer a joint rebuild until the next tick after completing component membership
cleanup; acid and tool edits reconcile immediately.

## Important state

| Symbol | Meaning |
| --- | --- |
| `compAdjPairs` | Cached same-layer component adjacency. |
| `cgBonds` | Cross-layer bonds relevant to unsupported groups. |
| `jointSupportValid` | Both layers contain a valid joint-support closure. |
| `jointSupportSleeping` | Loose-only ticks may preserve that closure. |
| `jointDirty` / `jointBondsInvalid` | The next joint pass must rebuild bonds. |

The fallback is always the full grounding path. Validate changes with
`test:grounding`, `test:pure-perf`, `test:xlayer-fall`, `test:stone-layers`,
`test:component-erase`, and `test:rigid-spawn-joint`, then run the engine
benchmark comparison.
