# Source this to put emcc/em++ on PATH for building the sand WASM engine.
# Usage:  source wasm/emenv.sh
# Homebrew Emscripten requires Python >=3.10. Xcode's /usr/bin/python3 can
# precede Homebrew on macOS even when emcc itself is found in /opt/homebrew.
if ! python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' 2>/dev/null \
   && [ -x /opt/homebrew/bin/python3 ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi
if [ -f "$HOME/Nick/emsdk/emsdk_env.sh" ]; then
  source "$HOME/Nick/emsdk/emsdk_env.sh"
elif command -v emcc >/dev/null 2>&1; then
  echo "Using existing emcc: $(command -v emcc)"
else
  echo "emcc not found. Install Emscripten or update wasm/emenv.sh." >&2
  return 1 2>/dev/null || exit 1
fi
