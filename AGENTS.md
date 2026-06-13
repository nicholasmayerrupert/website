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
| `src/sand/scenes/` | Scene definitions — the starting layout of the world. `castleScene.js` is the only one today. |
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
list of emitters (continuous material sources).

**To change the current world:** edit `src/sand/scenes/castleScene.js`.

**To add a new scene:**

1. Create `src/sand/scenes/myScene.js`:

   ```js
   import { MAT } from '../engine.js';

   // The engine calls this once at startup with these helpers:
   //   cols, rows            grid dimensions
   //   rand()                float in [0, 1)
   //   MAT                   material id enum
   //   put(x, y, material)             set a single cell
   //   rect(x0, y0, w, h, material)    fill a rectangle
   // Stone/plant components are registered automatically after this returns,
   // so just place materials — no syncComponents needed here.
   export function buildMyScene({ cols, rows, MAT, rand, put, rect }) {
     rect(10, rows - 8, 40, 6, MAT.STONE); // a stone shelf
     put(20, rows - 9, MAT.SEED);          // a seed that will grow
   }

   // Optional: continuous sources. pos is fractional (0..1) of the grid.
   export const myEmitters = [
     { material: MAT.WATER, rateMs: 90, pos: { x: 0.5, y: 0.1 }, r: 2 },
   ];
   ```

2. Wire it in `src/About.jsx`: import `buildMyScene` / `myEmitters` and pass them
   to `createEngine({ ..., initialScene: buildMyScene, emitters: myEmitters })`
   (replacing `buildCastleScene` / `castleEmitters`).

The grid caps at ~60,000 cells (`About.jsx` grows `cellSize` to fit), so design
in fractions of `cols`/`rows` rather than absolute pixel counts.

## Coding rules (Karpathy's four)

1. **Think before coding** — surface ambiguity, assumptions, and tradeoffs before
   changing code; don't assume silently.
2. **Simplicity first** — write the minimum code needed; no speculative features,
   abstractions, or configurability.
3. **Surgical changes** — touch only the files and lines needed; match existing
   style; don't refactor unrelated code.
4. **Goal-driven execution** — define success, verify with the smallest relevant
   check (run the app or the benchmark), and keep going until the goal is met.
