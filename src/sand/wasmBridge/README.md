# Sand WASM Bridge

`engineFactory.js` is the production entrypoint for adapting the C++ ABI to the
JavaScript runtime.

## Ownership

- `engineFactory.js` creates the engine handle and groups the production ABI
  calls. Tests attach their extra ABI through `testHooks.js`.
- New bridge work should keep runtime-public methods clearly separate from
  test-only and legacy helpers.
- Do not add gameplay policy here. If a decision affects physics, tools, camera,
  world streaming, rendering, spawn placement, inventory, or snapshots, prefer a
  C++ ABI helper and keep JS as the adapter.
