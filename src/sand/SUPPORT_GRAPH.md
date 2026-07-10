# Support graph grounding

Persistent solid-component support graph for dual-layer joint grounding, plus
related grounding/carry hot-path work.

## Production path (shipped)

Joint steps (`computeGroundedBoth` when `sgCommitPrimary`, no free bodies):

1. **Wipe** joint patches when either layer’s rigid topology changed (same as classic).
2. **Independent bases** — `groundLayerBase` each layer (rigid flood + loose overlay, with cache reuse).
3. If every component is base-grounded → clear residual bonds, done.
4. Else if **`sgBondsValid`** and `cgBonds` non-empty (pure-loose re-entry) → re-stamp joint support via `expandSupportGraphFromBase` (UF + same-layer cluster walk) **without** rescanning cells.
5. Else **emit** `SolidNode` maps (O(components)), **collect** cross-layer bonds from ungrounded comps (O(ungrounded cells)), **expand** via classic UF, set `sgBondsValid`.

`groundForceFull` and free-body layers use the classic joint in `computeGroundedBoth`.

Single-layer grounding is unchanged (cell flood + incremental cache).

## Perf work landed (this pass)

| Change | Effect |
| --- | --- |
| Drop unused `cgCompDensity` sum in `indexComponents` | Less work per flood/index (density never read by motion) |
| Flood uses local `MAT_CLASS` / `MAT_FLAGS` pointers + `memset` | Slightly tighter rigid DFS |
| Bond persistence (`sgBondsValid`) | Skips O(ungrounded) bond scan on pure-loose re-entry |

**Measured** (pan-stream, `--repeat 5` vs `bench/baseline.json`): step.mean about **−4.5%**, pure-perf checksums unchanged. Joint wall time remains ~5.1–5.3 ms p50 (timer mostly in `groundingMs` after bond work moved out of `crossLayerGroundingMs`).

## Tried and not shipped

| Approach | Result |
| --- | --- |
| Full edge rebuild every joint frame | ~15 ms joint regression |
| Graph-stamped rigid bases | Pure-perf diverge (under-ground on chunk stone) |
| Island BFS joint after flood bases | stream+loose / pure-perf diverge |
| Shift `groundedCell` with the world | Changes `wakeCellsThatLostGrounding` → pure-perf diverge |
| Stream bulk reuse without floor-reachability cleanup | Pure-perf diverge (edge-only remnants) |
| Stream bulk reuse **with** floor-reachability cleanup | Identity green, **not faster** (cleanup ≈ full flood) |
| Active-region component carry (skip inactive `next` stamps) | Large step win but pure-perf diverge (ghost rigid / dirty volume) |

## Data

| Symbol | Role |
| --- | --- |
| `SolidNode` | One node per stone/plant/ice component |
| `sgFgNodeOfPos` / `sgBgNodeOfPos` | Positional comp index → node id |
| `sgCrossCount` / `sgAdj` | Full rebuild topology (offline / future) |
| `sgBondsValid` | `cgBonds` match co-occupation for residual joint |
| `sgCommitPrimary` | `true` — joint uses the path above |
| `groundStreamX*` / `Y*` | Entering band after `shiftWorld` (hook for future band-local flood) |

## Next (to beat ~5 ms joint for real)

1. **Band-local flood** that is cheaper than full DFS *and* strips edge-only remnants without an O(grounded) pass — or drop/redefine edge support at stream boundaries with an intentional checksum update.
2. **Active-region carry** with a pure-perf-safe prevCompCells policy (likely must re-stamp `next` for any comp that might sit in a soon-to-be-blanked band).
3. Fix graph-base identity on chunk-bounded infinite terrain, then O(components) grounding can replace cell DFS.

## Tests

- `npm run test:grounding`
- `npm run test:pure-perf`
- `npm run test:xlayer-fall` / `test:stone-layers` / `test:component-erase`
- `node scripts/bench-sand.mjs --compare bench/baseline.json`
