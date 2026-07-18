# Sand WASM Builds

`wasm/build.sh` is the only supported way to regenerate the committed sand engine
bundle:

```sh
source wasm/emenv.sh
wasm/build.sh
```

The build emits:

- `src/sand/wasm/sandEngine.js` — the Emscripten ES module loader.
- `src/sand/wasm/sandEngine.wasm` — the external engine binary. Vite fingerprints
  it once, and the browser presentation realm and authority worker share that URL.
- `src/sand/wasm/build-info.json` — provenance for both emitted artifacts: output
  sizes/hashes, source commit, source dirty state, and Emscripten identity.

`build-info.json` treats the generated WASM outputs as build products when
calculating `source.dirty`, so a clean source tree can produce a clean provenance
record even though the build just rewrote `sandEngine.js` and `sandEngine.wasm`.

After changing C++ or generated material tables, rebuild and run:

```sh
node scripts/bench-sand.mjs --compare bench/baseline.json
node scripts/bench-sand.mjs --scenario all --repeat 3
```
