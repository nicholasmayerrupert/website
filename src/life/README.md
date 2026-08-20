# Game of Life search

The Life showcase keeps its Three.js renderer in `GameOfLife3D.jsx`. CPU-heavy
search lives here and runs in a dedicated Web Worker.

- `cpp/life_search.cpp` implements bit-packed Conway B3/S23 evolution and exact,
  constant-memory orbit scoring on a finite toroidal board. The default 16×16
  board evolves four rows per machine word. A zero generation horizon searches
  until extinction or a repeat; positive horizons are optional safety limits.
  Results track both first-repeat length and repeat period, and loop results open
  directly at their cycle entry.
- `searchEngineWasm.js` is the typed JavaScript wrapper; `lifeSearchWorker.js`
  pumps bounded batches. `createLifeSearchClient.js` runs a configurable pool of
  independent workers, merges their length and non-trivial-period leaderboards,
  and terminates the pool immediately for Stop or Restart. The automatic default
  leaves two logical CPUs free and caps itself at eight; the manual control uses
  the same hardware-aware ceiling, up to sixteen. Workers tune their batch size
  to a short time budget. Reports are staggered by pool size and merged into at
  most ten UI refreshes per second so large pools do not flood the main thread.
- `wasm/lifeSearch.js` is committed so normal Vite builds do not require
  Emscripten. Rebuild it with `npm run build:life`; `npm run build` rejects stale
  output.

Run `npm run test:life` for forward, lifetime, and deterministic soup fixtures,
or `npm run bench:life` for soup throughput.
