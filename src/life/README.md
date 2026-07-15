# Game of Life search

The Life showcase keeps its Three.js renderer in `GameOfLife3D.jsx`. CPU-heavy
search lives here and runs in a dedicated Web Worker.

- `cpp/life_search.cpp` implements bit-packed Conway B3/S23 evolution, transient
  soup scoring, and exact finite-torus predecessor traversal.
- `cpp/third_party/minisat/` contains the pinned MiniSat 2.2.0 core under its MIT
  license. `ParseUtils.h` omits the unused zlib DIMACS stream and the old headers
  contain small C++20 compatibility fixes.
- `searchEngineWasm.js` is the typed JavaScript wrapper; `lifeSearchWorker.js`
  pumps bounded batches so Stop and progress messages remain responsive.
- `wasm/lifeSearch.js` is committed so normal Vite builds do not require
  Emscripten. Rebuild it with `npm run build:life`; `npm run build` rejects stale
  output.

Reverse search uses one incremental SAT transition formula. Target cells and
per-node parent blockers are assumptions, allowing learned clauses to survive
across the depth-first traversal. A solver budget interruption is `unknown`; only
an exact unsatisfiable result proves that a state has no predecessor.

Run `npm run test:life` for exhaustive 3x3 predecessor checks and forward/lifetime
fixtures, or `npm run bench:life` for deterministic soup and SAT throughput.
