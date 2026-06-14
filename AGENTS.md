# Agent Instructions

## What this repo is

Nicholas Mayer-Rupert's personal website. React + Vite + Tailwind, deployed to
Cloudflare via Wrangler (`npm run dev`, `npm run build`, `npm run deploy`).

Its centerpiece is a **2D falling-sand simulation** rendered to a canvas on the
About page. Most agent work happens there. Map of the sim:

| Path | What it is |
| --- | --- |
| `src/sand/engine.js` | The simulation: physics, materials, the grid, rigid/plant components. Pure module, injectable RNG. **Performance- and correctness-sensitive — see below.** |
| `src/sand/renderCore.js` | Color lookup table + pixel fill. |
| `src/sand/rng.js` | `mulberry32` PRNG + `hashGrid` (deterministic checksums for the benchmark). |
| `src/sand/feed.js` | Safe helpers for placing materials at **runtime** (`placeMaterial`, `placeBatch`). |
| `src/sand/scenes/` | Scene definitions — the starting layout of the world. `index.js` is the registry; `landscapeScene.js` (default) and `castleScene.js` are the scenes. |
| `src/sand/worldgen/` | Procedural-generation foundation: `noise.js` (seeded value/fbm/ridged noise), `context.js` (fixed-scale, center-anchored coords + clipped primitives + shadow grid), `terrain.js` (height field, caves, water, scatter), `structures.js` (surface-snapped prefabs). |
| `src/About.jsx` | Canvas/pointer wrapper. Owns brushes, the toolbar, and wires the engine + scene together. |
| `scripts/bench-sand.mjs`, `bench/` | Deterministic headless benchmark + recorded baselines. |

## The sand engine (read before touching it)

- One grid of material ids. The `MAT` enum (`engine.js`): `EMPTY, SAND, WATER,
  STONE, OIL, FIRE, STEAM, SEED, WOOD, PLANT`.
- Loose materials (sand, water, oil, fire, steam) are plain grid cells.
- **`STONE` and the plant materials (`SEED`/`WOOD`/`PLANT`) are not loose pixels.**
  They live as connected *components* — rigid stone chunks and living plants —
  and each step they survive only by their component membership, carried into the
  next frame. A stone/plant cell written to the grid with no component gets erased
  every step and **flickers**.
  - **Seeding a scene:** nothing to do — after a scene builder runs, the engine
    registers stone/plant components automatically. Use `put`/`rect` freely.
  - **Placing at runtime** (brushes, programmatic edits): never write
    `STONE`/`SEED`/`WOOD`/`PLANT` via raw `paintDisc`/grid writes. Use
    `src/sand/feed.js` (`placeMaterial`, or paint a batch then call
    `engine.syncComponents()`).
- Before changing physics, benchmark it:
  `node scripts/bench-sand.mjs --compare bench/final.json`. Pure refactors must
  keep checksums **identical**; intended behavior changes must keep material
  counts within a few percent and pass the visual checklist in `bench/results.md`.
  The browser RNG is `Math.random` by design — don't "optimize" it to a custom PRNG.

## Creating or changing a scene

A **scene** seeds the initial world. It is a builder function plus an optional
list of emitters (continuous material sources). The engine calls the builder once
at startup with `{ cols, rows, MAT, rand, put, rect }`; stone/plant components are
registered automatically after it returns, so just place materials.

Scenes are listed in the registry `src/sand/scenes/index.js` and selected in the
browser with `?scene=<key>` (default: `landscape`).

### Author in world space, not fractions of the viewport

**Do not size features as fractions of `cols`/`rows`.** That rescales the whole
composition to the grid, so a narrow screen *squishes* it. Instead author at a
**fixed cell scale, anchored to the center and the bottom**, and let a narrow
viewport **crop** the sides (truncation) while a wide one reveals more world.

The `src/sand/worldgen/` foundation provides exactly this. Build on it:

```js
import { createWorldContext } from '../worldgen/context.js';
import { heightField, fillTerrain, carveCaves } from '../worldgen/terrain.js';
import { placeOnSurface, tree } from '../worldgen/structures.js';

export function buildMyScene(api) {            // api == { cols, rows, MAT, rand, put, rect }
  const ctx = createWorldContext(api);         // anchors (cx/worldX/fromBottom),
                                               // clipped primitives, seeded noise,
                                               // a queryable shadow grid
  const field = heightField(ctx);              // ordered passes — add/reorder freely
  fillTerrain(ctx, field);
  carveCaves(ctx, field);
  placeOnSurface(ctx, 0, tree);                // worldDx 0 == centered
  ctx.commit();                                // REQUIRED: flush shadow grid to engine
}

export const myEmitters = [
  { material: 2 /* MAT.WATER */, rateMs: 90, pos: { x: 0.5, y: 0.1 }, r: 2 },
];
```

Place features at world-x offsets (`ctx.cx(dx)`, `0` = center) and sample noise in
`ctx.worldX(gx)` so the landscape stays coherent as the window widens. Remember to
call `ctx.commit()` at the end. To add the scene, import it in
`src/sand/scenes/index.js` and add a `{ build, emitters }` entry.

The grid still caps at ~60,000 cells (`About.jsx` grows `cellSize` only on very
large viewports); fixed-scale authoring is what keeps narrow screens truncating
rather than scaling.

## Coding rules (Karpathy's four)

1. **Think before coding** — surface ambiguity, assumptions, and tradeoffs before
   changing code; don't assume silently.
2. **Simplicity first** — write the minimum code needed; no speculative features,
   abstractions, or configurability.
3. **Surgical changes** — touch only the files and lines needed; match existing
   style; don't refactor unrelated code.
4. **Goal-driven execution** — define success, verify with the smallest relevant
   check (run the app or the benchmark), and keep going until the goal is met.
