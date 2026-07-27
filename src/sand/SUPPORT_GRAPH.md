# Support graph grounding

Foreground and background rigid components support one another where they occupy
the same cell. `computeGroundedBoth()` computes this joint support without
rescanning every rigid cell on every active tick.

## Current path

1. Restore each layer's independent grounding base when topology or bonds changed.
2. For static interior components, union cached same-layer adjacency, seed the
   resulting roots from the floor and streamed edges, and stamp supported roots.
3. Use the cell flood when free bodies participate or a component touches a
   directed top/outer sentinel boundary.
4. Stop if every component is independently grounded.
5. Otherwise collect cross-layer bonds for unsupported components, union cached
   same-layer adjacency, and propagate support through the resulting groups.
6. Preserve the settled closure while only loose material changes and no
   unsupported bond group remains.

Free bodies, directed-boundary components, and forced verification use the
conservative cell flood. Fire may defer a joint rebuild until the next tick
after completing component membership cleanup; acid and tool edits reconcile
immediately.

## Important state

| Symbol | Meaning |
| --- | --- |
| `compAdjPairs` | Cached same-layer component adjacency. |
| `groundHasDirectedBoundaryComp` | Selects the cell flood for sentinel-touching component sets. |
| `cgBonds` | Cross-layer bonds relevant to unsupported groups. |
| `jointSupportValid` | Both layers contain a valid joint-support closure. |
| `jointSupportSleeping` | Loose-only ticks may preserve that closure. |
| `jointDirty` / `jointBondsInvalid` | The next joint pass must rebuild bonds. |

The fallback is always the full grounding path. Validate changes with
`test:grounding`, `test:pure-perf`, `test:xlayer-fall`, `test:stone-layers`,
`test:component-erase`, and `test:rigid-spawn-joint`, then run the engine
benchmark comparison.
