#!/usr/bin/env bash
# Build the C++ sand engine to an ES module plus an external WASM binary.
#
#   source wasm/emenv.sh && wasm/build.sh
#   source wasm/emenv.sh && wasm/build.sh --dev   # + SAND_INVARIANT_CHECKS
#
# Emits committed src/sand/wasm/sandEngine.{js,wasm}. Keeping the binary external
# lets browsers stream-compile it and lets the presentation realm and authority
# worker reuse the same fingerprinted Vite asset on a cold visit.
#
# --dev compiles in the post-step invariant validator (aborts loudly on a
# BODY-MATERIAL or component-cell violation). It writes the SAME output file so
# the whole test suite exercises it — rebuild WITHOUT --dev before committing;
# a dev artifact must never ship.
set -euo pipefail
cd "$(dirname "$0")/.."

DEV_FLAGS=()
if [[ "${1:-}" == "--dev" ]]; then
  DEV_FLAGS+=(-DSAND_INVARIANT_CHECKS)
  echo "=== DEV BUILD (SAND_INVARIANT_CHECKS) — do NOT commit this artifact ==="
fi

# Fail fast if the generated material tables or ABI manifest drift from their schemas.
node scripts/generate-materials.mjs --check
node scripts/generate-abi.mjs --check

build_engine() {
local OUT="$1"
shift
em++ \
  -O3 -std=c++20 \
  "$@" \
  ${DEV_FLAGS[@]+"${DEV_FLAGS[@]}"} \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,node \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s EXPORT_NAME=createSandModule \
  -s MAX_WEBGL_VERSION=2 \
  -s MIN_WEBGL_VERSION=2 \
  -s FULL_ES3=1 \
  -lGL \
  -s 'EXPORTED_RUNTIME_METHODS=["cwrap","HEAPU8","HEAP32","HEAPF32","HEAPF64","GL","specialHTMLTargets"]' \
  -s 'EXPORTED_FUNCTIONS=["_malloc","_free"]' \
  --no-entry \
  src/sand/cpp/sand.cpp \
  -o "$OUT"

local WASM_OUT="${OUT%.js}.wasm"
echo "built $OUT ($(wc -c < "$OUT") bytes) + $WASM_OUT ($(wc -c < "$WASM_OUT") bytes)"
}

build_engine src/sand/wasm/sandEngine.js
node scripts/write-wasm-build-info.mjs src/sand/wasm/sandEngine.js
