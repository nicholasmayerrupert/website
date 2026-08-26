# Sand WASM Bridge

`engineFactory.js` is the production entrypoint for adapting the C++ ABI to the
JavaScript runtime.

## Ownership

- `engineFactory.js` creates the engine handle and groups the production ABI
  calls. Tests attach their extra ABI through `testHooks.js`.
- Runtime-public methods stay separate from test-only and compatibility helpers.
- Do not add gameplay policy here. If a decision affects physics, tools, camera,
  world streaming, rendering, spawn placement, inventory, or snapshots, prefer a
  C++ ABI helper and keep JS as the adapter.

## Generated ABI and snapshot ownership

`../abi.schema.json` is the source of truth for callable exports, shared enums,
planet descriptors, and packed snapshots. `npm run generate` emits
`../cpp/engine/abi.generated.hpp` and `abi.generated.js`. `snapshotCodec.js` uses
the generated descriptors for unpacking; it does not own another field list.

The schema contains separate representations with separate producers and
consumers:

- A `structs.<name>` entry defines a packed record. `snapshotMember` reads from
  the writer's source record (normally C++, or JavaScript for a JavaScript
  writer), while `snapshotParameter` adds an explicit value to the generated
  writer call. The same field descriptors generate its JavaScript unpacker.
- `structs.glPlayerExt` is the independent authority-snapshot-to-renderer player
  layout.

## Adding an ABI or snapshot field

1. Identify every packed representation that must carry the value and add a
   field to each schema record. A player value used by simulation and
   presentation may need entries in `playerSnapshot` and `glPlayerExt`.
2. Supply the value at each boundary. Add and populate the source-record member
   used by `snapshotMember`, pass every `snapshotParameter` at its generated
   writer call, and update the presentation consumer when it uses the field.
   Generated writers and codecs remove field-copy loops; they do not create the
   underlying gameplay state.
3. Manually increment `abiVersion` for every externally visible signature,
   layout, enum, or descriptor change. Generation derives the ABI fingerprint
   but never changes the version.
4. Regenerate, rebuild, and run the focused suites through the test runner:

   ```sh
   npm run generate
   npm run build:sand -- --dev
   node scripts/run-tests.mjs --only abi-generator
   node scripts/run-tests.mjs --only abi-snapshot-writers
   ```

Add the owning engine, bridge, worker, or presentation round-trip suite when that
boundary consumes the field. Each focused runner invocation first checks
generated-source freshness, engine contracts, and committed-WASM provenance.
