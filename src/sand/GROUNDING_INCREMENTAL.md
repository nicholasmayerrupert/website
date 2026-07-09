# Incremental grounding

`computeGrounded()` (components.inc) decides, every active step, which rigid cells
(stone/ice/plant components) are connected through rigid material down to a *seed*
(the floor, a streamed buffer edge, or a powder resting on dense liquid). The result
lives in `groundedCell[]` and drives everything load-bearing: which components fall,
what counts as terrain for free rigid bodies, etc.

The full flood is O(rigid cells) and runs on *any* active step. When acid eats a large
grounded stone mass, that reflood dominated the frame cost. Incremental grounding cuts
it without changing behavior.

## The invariant that makes it safe

`groundedCell[]` is a **pure function of the grid**: a cell is grounded iff it is
connected to a seed. So *any* method that yields the true grounded set is byte-for-byte
identical to a full reflood. Correctness is therefore mechanically checkable, not
argued — see "Verification" below. Because grounding never draws RNG and only changes
*which* cells move, an identical `groundedCell[]` means an identical simulation
(identical checksums, identical multiplayer state).

## How it works

State is kept between steps. `Layer::groundDirty` means "the next pass must be a full
reflood". `ensureGroundedSingleLayer()` (the single-layer dispatch; the cross-layer
`computeGroundedBoth` path always refloods) picks:

- **Full reflood** (`computeGrounded`) when `groundDirty` — set by any component
  add / move / split / growth / sync.
- **Loose overlay refresh** when only `looseGroundDirty` is set — a powder or liquid
  cell changed since the last overlay. Powder *presence* alone no longer forces a
  pass (that was the old `groundSawPowder` always-on gate).
- **Incremental refresh** (`incrementalGroundingRefresh`) for acid pure-bore
  `groundContentDirty`: rebuilds the cheap bookkeeping (`cellComp`, per-component
  density, and each component's `grounded` flag *derived from the cached
  `groundedCell`*) and skips the expensive flood. `comp.grounded` is recomputed
  every step from the cache, so there is no stale-flag coupling with
  `splitRigidAfterErase`.
- **Full skip** when `groundDirty`, `groundContentDirty`, and `looseGroundDirty`
  are all clear (and the rigid base is valid): cached grounding is exact.

The win on the hot path comes from **acid removals**. When acid dissolves stone, instead
of forcing a reflood, `removalsKeepGroundingValid()` partitions the step's removed cells
into **8-connected components** and checks each component independently as its own blob
(`blobKeepsGroundingValid`). A single blob is *not a cut* when it is:

1. compact (bbox within `SPAN`) and clear of the floor/edge seed `MARGIN`;
2. no powder in the blob's neighbourhood (powder/liquid grounding nuance not modelled);
3. every surviving rigid neighbour of the blob still reconnects to the others through a
   bounded local flood that avoids the blob (`blobBoundaryReconnects`, with early-exit
   and a visit `cap`).

If *every* component holds, removing them is not a cut: the only grounding change is the
removed cells, which are patched to 0, and the cache stays valid. If any component fails
(a real cut / seed / powder / oversized blob), we reflood.

**Why partition** — and why per-component is sound. Removed cells must be checked as a
*blob*, not one at a time: two *adjacent* removals can together sever a bridge that
neither severs alone (the co-removed neighbour, already cleared to empty, otherwise looks
like plain empty space and hides the bridge — the original per-cell version had exactly
this bug, caught immediately by the verifier). But distinct 8-connected components are by
definition non-adjacent, so no component can hide a bridge running through another's
cells; any path through a removed cell reroutes locally around its own component using
surviving material, and disjoint components never share that reroute. Partitioning lets a
**wide erosion front** (a broad acid pool) split into many small blobs that each fast-path,
instead of the whole batch bailing on its combined `span` and reflooding every step.

## When it wins / falls back

- Boring a channel / compact erosion through bulk stone → fast path, big win.
- Wide-front erosion (broad acid pool) → each step's removals partition into small
  components that fast-path; only the steps where a component **genuinely severs a piece**
  (which must then fall) reflood. A wide *flat* front over a flat slab chips off many tiny
  fragments, so it still refloods often — those refloods are real (audited: 0 false cuts),
  not a fast-path limitation. Proving the large surviving mass is still grounded after a
  tiny chip detaches would need real dynamic connectivity (a far flood to the seed), which
  is deliberately out of scope here.
- Any powder/liquid-grounding scene, cross-layer scene, or structural change → full
  reflood (status quo).

The fallback is always the trusted `computeGrounded`, so the worst case is exactly
today's behavior. Setting `groundForceFull` disables the fast path entirely.

## Verification (scripts/grounding-incremental-test.mjs, in `npm test`)

- **VERIFY** (`engine.setGroundingDebug(verify=true)`): every step runs the fast path
  AND a full reflood and asserts `groundedCell`/`cellComp` are byte-equal. A long
  randomized fuzz of paint/erase/acid/lava/water/sand/ice/plant must report 0 mismatches.
- **CHECKSUM**: the same scenario run with the fast path vs `groundForceFull` must produce
  identical grid checksums at every step.
- The acid-burn block also asserts the fast path actually fires, so a future change can't
  silently disable it.
- The wide-acid-front block asserts the partition keeps `span` bails at zero (the whole
  batch never trips the combined-span limit) while staying byte-identical — locking in the
  reason the partition exists.

`engine_grounding_diag` exposes per-batch bail counts (`fast/edge/powder/cut/span`) for
tuning `SPAN` / `W` / `cap`.
