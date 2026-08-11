# WebAssembly builds

The repository uses Emscripten 6.0.0 from the official `emsdk` for both C++
engines. The pinned version is stored in `emscripten-version.txt`, and both
build commands reject a different active version.

The generated JavaScript and WebAssembly artifacts are committed. Ordinary
development, site builds, and deployments do not require Emscripten.

## Install the toolchain

Install and activate the pinned SDK on macOS or Linux:

```sh
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 6.0.0
./emsdk activate 6.0.0
source ./emsdk_env.sh
```

On Windows PowerShell:

```powershell
git clone https://github.com/emscripten-core/emsdk.git
Set-Location emsdk
.\emsdk.ps1 install 6.0.0
.\emsdk.ps1 activate 6.0.0
. .\emsdk_env.ps1
```

On Windows Command Prompt:

```bat
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
emsdk.bat install 6.0.0
emsdk.bat activate 6.0.0
emsdk_env.bat
```

Run `emcc --version` in the active terminal to verify the installation. WSL
uses the Linux commands.

## Sand engine

From the repository root:

```text
npm run build:sand
```

The build checks the generated material and ABI headers, compiles the vendored
Box2D 3.1.1 C17 sources, links them with the unity translation unit at
`src/sand/cpp/sand.cpp`, and writes:

- `src/sand/wasm/sandEngine.js` — Emscripten ES module loader.
- `src/sand/wasm/sandEngine.wasm` — external SIMD-enabled engine binary.
- `src/sand/wasm/build-info.json` — source, toolchain, size, and hash provenance.

Use the invariant-checking build while diagnosing component or body ownership:

```text
npm run build:sand -- --dev
```

The development variant writes to the production artifact paths. Run the
production command before committing generated artifacts.

Material or ABI schema edits require generated sources before compilation:

```text
npm run generate
npm run build:sand
```

## Game of Life engine

From the repository root:

```text
npm run build:life
```

The build writes the self-contained ES module at
`src/life/wasm/lifeSearch.js` and embeds its source-provenance marker.

## Site commands

`npm run dev` consumes the committed artifacts directly. `npm run build`
checks generated sources and both committed WASM artifacts, runs Vite, and
creates a quality-11 Brotli sibling for every WebAssembly file in `dist`.
Cloudflare serves those precompressed bytes at the fingerprinted `.wasm` URL.

`npm run build:full` rebuilds both committed engines with the pinned Emscripten
toolchain and then runs the production site build. `npm run deploy` uses the
committed engines, performs the production site build, and invokes Wrangler.
