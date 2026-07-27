# Incremental grounding

Grounding decides which rigid cells are connected to a support seed: the floor,
a streamed edge, or the engine's loose-material support rules. The result lives
in `Layer::groundedCell`; component and rigid-body movement depend on it.

A full `computeGrounded()` pass indexes components, resolves rigid support, then
overlays loose support. Static interior sets use the component graph; free-body
presence and directed buffer-boundary cases select the conservative cell flood.
Body-owned cells are excluded from static grounding because body/body support is
resolved by collision contacts. The engine caches the result and invalidates
each part separately.

## Cache states

- `groundDirty`: rigid topology changed; rebuild the component index and rigid
  flood.
- `groundContentDirty`: a locally proven removal changed component contents but
  did not change the supported set; rebuild bookkeeping without a full flood.
- `looseGroundDirty`: powder or liquid changed; refresh the affected loose
  columns over the cached rigid base.
- All clear with `groundBaseValid`: reuse the cached result.

Dual-layer grounding adds cross-layer bonds through `computeGroundedBoth()`.
Settled joint support can sleep while only loose material moves. A topology or
bond change restores each layer's independent base, rebuilds the joint closure,
and wakes cells that lost support.

## Safe removal fast path

Acid and fire can avoid a full reflood when `removalsKeepGroundingValid()` proves
that a removal did not disconnect support:

1. Partition removed cells into 8-connected blobs.
2. Reject blobs near support boundaries, powder, or outside the bounded size.
3. Check whether each blob's surviving rigid boundary reconnects locally.
4. If the bounded reconnect opens into several regions, use the capped exact
   fallback to prove that every formerly grounded region still reaches a seed.

Failure or an inconclusive cap always falls back to the full flood. Successful
checks patch only the removed cells in `groundedCell` and `groundRigidBase`.
Explosions that erase component-backed cells always rebuild exact support after
the complete blast transaction.

Blobs must be checked as groups: adjacent removals can sever a bridge even when
each cell appears safe in isolation. Distinct 8-connected blobs cannot hide one
another's local reconnect path, so they can be checked independently.

## Verification

`npm run test:grounding` covers the cache and removal paths. Debug verification
(`engine.setGroundingDebug(true, false)`) compares the optimized result with a
forced full flood. `engine_grounding_diag` reports fast-path and fallback counts
for benchmark diagnosis.
