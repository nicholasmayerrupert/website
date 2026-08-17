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

## Generated ABI and record ownership

`../abi.schema.json` is the source of truth for callable exports, shared enums,
planet descriptors, packed snapshots, and object-wire records. `npm run generate`
emits `../cpp/engine/abi.generated.hpp` and `abi.generated.js`. `recordCodec.js`
uses the generated descriptors for packing, unpacking, projection, and
validation; it does not own another field list.

The schema contains separate representations with separate producers and
consumers:

- A `structs.<name>` entry defines a packed record. `snapshotMember` reads from
  the writer's source record (normally C++, or JavaScript for a JavaScript
  writer), while `snapshotParameter` adds an explicit value to the generated
  writer call. A `wireCodec` on that struct generates its packed JavaScript
  codec.
- An `objectWires.<name>` entry defines an object projection used by network or
  state-sync code. The player object wire is independent of `playerSnapshot`.
- `structs.glPlayerExt` is the independent client-to-renderer player layout.
- `inventorySlot.objectWire` deliberately derives `inventoryStack` from the
  snapshot fields whose `objectWire` value is not `false`. This derivation is
  specific to records that declare `objectWire`; it is not a general link
  between equal field names.

## Adding an ABI or replicated field

1. Identify every representation that must carry the value and add a field to
   each of those schema records. A player value used by simulation, transport,
   and multiplayer presentation may need entries in `playerSnapshot`, the
   `player` object wire, and `glPlayerExt`.
2. Supply the value at each boundary. Add and populate the source-record member
   used by `snapshotMember`, pass every `snapshotParameter` at its generated
   writer call, expose an object-wire source or alias, and update the
   presentation consumer when it uses the field. Generated writers and codecs
   remove field-copy loops; they do not create the underlying gameplay state.
3. Manually increment `abiVersion` for every externally visible signature,
   layout, enum, or descriptor change. Generation derives ABI and actor-wire
   fingerprints but never changes the version. Increment `PROTOCOL_VERSION` in
   `../net/protocol.js` only when the wire envelope or protocol semantics change;
   actor-record shape compatibility is checked by its generated fingerprint.
4. Regenerate, rebuild, and run the focused suites through the test runner:

   ```sh
   npm run generate
   npm run build:sand -- --dev
   node scripts/run-tests.mjs --only abi-generator
   node scripts/run-tests.mjs --only abi-snapshot-writers
   node scripts/run-tests.mjs --only net-protocol
   ```

Add the owning engine, bridge, worker, or server round-trip suite when that
boundary consumes the field. Each focused runner invocation first checks
generated-source freshness, engine contracts, and committed-WASM provenance.
