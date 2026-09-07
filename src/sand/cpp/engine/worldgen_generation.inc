// New structure-stamping functions need __attribute__((minsize, noinline))
// and the scoped Clang minsize attribute push/pop used by the existing stamps,
// including coverage for local lambdas. This policy is per function, not per
// file; keep terrain sampling and simulation hot paths at -O3. See ../../PERF.md.
#include "worldgen_access.inc"
#include "worldgen_terrain.inc"
#include "worldgen_undergrowth.inc"
#include "worldgen_cave_architecture.inc"
#include "worldgen_cave_sites.inc"
#include "worldgen_surface_structures.inc"
#include "worldgen_landmarks.inc"
#include "worldgen_shallow_ecology.inc"
#include "worldgen_caves.inc"
#include "worldgen_offworld.inc"
#include "worldgen_frontier.inc"
#include "worldgen_fill.inc"
