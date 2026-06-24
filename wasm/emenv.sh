# Source this to put emcc/em++ on PATH for building the sand WASM engine.
# Usage:  source wasm/emenv.sh
if [ -f "$HOME/Nick/emsdk/emsdk_env.sh" ]; then
  source "$HOME/Nick/emsdk/emsdk_env.sh"
elif command -v emcc >/dev/null 2>&1; then
  echo "Using existing emcc: $(command -v emcc)"
else
  echo "emcc not found. Install Emscripten or update wasm/emenv.sh." >&2
  return 1 2>/dev/null || exit 1
fi
