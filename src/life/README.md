# Game of Life search

The Life showcase keeps its Three.js renderer in `GameOfLife3D.jsx`. CPU-heavy
search lives here and runs in a dedicated Web Worker.

- `cpp/life_search.cpp` implements bit-packed Conway B3/S23 evolution and
  transient soup scoring on a finite toroidal board.
- `searchEngineWasm.js` is the typed JavaScript wrapper; `lifeSearchWorker.js`
  pumps bounded batches so Stop and progress messages remain responsive.
- `wasm/lifeSearch.js` is committed so normal Vite builds do not require
  Emscripten. Rebuild it with `npm run build:life`; `npm run build` rejects stale
  output.

Run `npm run test:life` for forward, lifetime, and deterministic soup fixtures,
or `npm run bench:life` for soup throughput.
