# Source this to put emcc/em++ on PATH for building the sand WASM engine.
# Usage:  source wasm/emenv.sh
if [ -f "$HOME/Nick/emsdk/emsdk_env.sh" ]; then
  source "$HOME/Nick/emsdk/emsdk_env.sh"
elif command -v emcc >/dev/null 2>&1; then
  echo "Using existing emcc: $(command -v emcc)"
  # Homebrew ships LLVM and Binaryen inside its Emscripten prefix, but an
  # unconfigured emcc does not discover those tools or a writable cache on its
  # own. Configure only that installation; emsdk, non-macOS hosts, and explicit
  # user configuration retain their existing environment.
  if [ "$(uname -s 2>/dev/null)" = "Darwin" ] \
     && command -v brew >/dev/null 2>&1 \
     && [ -z "${EMSDK:-}${EM_CONFIG:-}${EM_CACHE:-}${EM_LLVM_ROOT:-}${EM_BINARYEN_ROOT:-}" ] \
     && [ -z "${LLVM_ROOT:-}${BINARYEN_ROOT:-}" ] \
     && [ ! -f "$HOME/.emscripten" ]; then
    sand_brew_prefix="$(brew --prefix 2>/dev/null || true)"
    sand_emscripten_prefix="$(brew --prefix emscripten 2>/dev/null || true)"
    sand_emcc_path="$(command -v emcc)"
    if [ -n "$sand_brew_prefix" ] && [ -n "$sand_emscripten_prefix" ] \
       && { [ "$sand_emcc_path" = "$sand_brew_prefix/bin/emcc" ] \
            || [ "$sand_emcc_path" = "$sand_emscripten_prefix/bin/emcc" ]; } \
       && [ -x "$sand_emscripten_prefix/libexec/llvm/bin/clang" ] \
       && [ -x "$sand_emscripten_prefix/libexec/binaryen/bin/wasm-opt" ] \
       && [ ! -f "$sand_emscripten_prefix/libexec/.emscripten" ]; then
      if [ -n "${BASH_VERSION:-}" ]; then
        sand_emenv_source="${BASH_SOURCE[0]}"
      elif [ -n "${ZSH_VERSION:-}" ]; then
        sand_emenv_source="${(%):-%x}"
      else
        sand_emenv_source="$PWD/wasm/emenv.sh"
      fi
      sand_wasm_dir="$(CDPATH= cd -- "$(dirname -- "$sand_emenv_source")" 2>/dev/null && pwd)"
      if [ -z "$sand_wasm_dir" ]; then
        echo "Unable to locate the wasm directory for the Emscripten cache." >&2
        return 1 2>/dev/null || exit 1
      fi
      export PATH="$sand_brew_prefix/bin:$sand_emscripten_prefix/libexec/llvm/bin:$sand_emscripten_prefix/libexec/binaryen/bin:$PATH"
      export EM_CONFIG="$sand_wasm_dir/.cache/emscripten/.emscripten"
      export EM_CACHE="$sand_wasm_dir/.cache/emscripten/cache"
      export EM_LLVM_ROOT="$sand_emscripten_prefix/libexec/llvm/bin"
      export EM_BINARYEN_ROOT="$sand_emscripten_prefix/libexec/binaryen"
      if ! mkdir -p "$(dirname "$EM_CONFIG")"; then
        echo "Unable to create the Emscripten cache directory." >&2
        return 1 2>/dev/null || exit 1
      fi
      if [ ! -f "$EM_CONFIG" ] && ! emcc --generate-config >/dev/null; then
        echo "Unable to initialize the Homebrew Emscripten configuration." >&2
        return 1 2>/dev/null || exit 1
      fi
    fi
    unset sand_brew_prefix sand_emscripten_prefix sand_emcc_path
    unset sand_emenv_source sand_wasm_dir
  fi
else
  echo "emcc not found. Install Emscripten or update wasm/emenv.sh." >&2
  return 1 2>/dev/null || exit 1
fi
