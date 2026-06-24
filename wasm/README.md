# Sand WASM Builds

`wasm/build.sh` is the only supported way to regenerate the committed sand engine
bundle:

```sh
source wasm/emenv.sh
wasm/build.sh
```

The build emits:

- `src/sand/wasm/sandEngine.js` — single-file ES module with the wasm embedded.
- `src/sand/wasm/build-info.json` — provenance for the emitted bundle: output
  size/hash, source commit, source dirty state, and Emscripten identity.

`build-info.json` treats the generated WASM outputs as build products when
calculating `source.dirty`, so a clean source tree can produce a clean provenance
record even though the build just rewrote `sandEngine.js`.

After changing C++ or generated material tables, rebuild and run:

```sh
node scripts/bench-sand.mjs --compare bench/baseline.json
node scripts/bench-sand.mjs --scenario all --repeat 3
```
