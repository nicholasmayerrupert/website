# Sand WASM Builds

## Build

From the repository root, on macOS, Linux, Windows, or WSL:

```text
npm run build:sand
```

Emscripten must be installed and active in the terminal. The build prints a link
to this file when it is not. Add `-- --dev` for the post-step invariant validator:

```text
npm run build:sand -- --dev
```

A development build writes to the production paths. Rebuild without `--dev`
before committing.

## Install Emscripten

Skip this section if `emcc --version` already works in the terminal.

### macOS

The shortest route uses Homebrew:

```sh
brew install emscripten
npm run build:sand
```

The build detects Homebrew Emscripten and uses its bundled LLVM, Binaryen, and a
gitignored cache at `wasm/.cache/emscripten`. It does not change a configured
emsdk or custom Emscripten environment. The official emsdk route described under
Linux also works on macOS.

### Linux

Install the [official emsdk](https://emscripten.org/docs/getting_started/downloads.html),
then activate it in the current terminal:

```sh
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
cd /path/to/website
npm run build:sand
```

### Windows

In PowerShell, install and activate the official emsdk:

```powershell
git clone https://github.com/emscripten-core/emsdk.git
Set-Location emsdk
.\emsdk.ps1 install latest
.\emsdk.ps1 activate latest
. .\emsdk_env.ps1
Set-Location C:\path\to\website
npm run build:sand
```

In Command Prompt, after cloning and entering the emsdk directory:

```bat
emsdk.bat install latest
emsdk.bat activate latest
emsdk_env.bat
cd C:\path\to\website
npm run build:sand
```

WSL follows the Linux instructions. The repository build command is the same in
every shell.

## Output

The build emits:

- `src/sand/wasm/sandEngine.js` — the Emscripten ES module loader.
- `src/sand/wasm/sandEngine.wasm` — the external engine binary. Vite fingerprints
  it once, and the browser presentation realm and authority worker share that URL.
- `src/sand/wasm/build-info.json` — provenance for both emitted artifacts: output
  sizes/hashes, source commit, source dirty state, and Emscripten identity.

`build-info.json` treats the generated WASM outputs as build products when
calculating `source.dirty`, so a clean source tree can produce a clean provenance
record even though the build just rewrote `sandEngine.js` and `sandEngine.wasm`.

After changing simulation or rendering behavior, rebuild and run the relevant
benchmark comparison, for example:

```sh
node scripts/bench-sand.mjs --compare bench/baseline.json
```

`./wasm/build.sh` remains a POSIX-shell wrapper for existing scripts. If needed,
`source wasm/emenv.sh` activates emsdk from `$EMSDK` or `$HOME/emsdk` and applies
the same isolated Homebrew setup. Neither shell file is required on Windows.
