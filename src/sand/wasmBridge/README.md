# Sand WASM Bridge

`src/sand/engineWasm.js` is the stable public entrypoint. This folder holds the
implementation details for adapting the C++ ABI to the JavaScript runtime.

## Ownership

- `engineFactory.js` currently creates the engine handle and groups all ABI
  calls. It is compatibility-preserving: existing tests and runtime code still
  call the same methods through `createEngineWasm()`.
- New bridge work should keep runtime-public methods clearly separate from
  test-only and legacy helpers.
- Do not add gameplay policy here. If a decision affects physics, tools, camera,
  world streaming, rendering, spawn placement, inventory, or snapshots, prefer a
  C++ ABI helper and keep JS as the adapter.

## Future Split Points

When changing a bridge area substantially, peel the relevant group out of
`engineFactory.js` into a small module:

- `module.js`: singleton WASM initialization and cwrap table.
- `memory.js`: scratch allocation and typed-array helpers.
- `renderApi.js`: WebGL/context/pixel methods.
- `playerApi.js`: player snapshot/input/prediction methods.
- `inventoryApi.js`: hotbar/grid/cursor methods.
- `worldApi.js`: streaming, worldgen, and layer methods.
- `netSyncApi.js`: snapshot/diff serialization.
- `debugApi.js`: benchmark/test hooks.
