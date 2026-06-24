#!/usr/bin/env bash
# Build the C++ sand engine to a single self-contained ES module WASM.
#
#   source wasm/emenv.sh && wasm/build.sh
#
# Emits src/sand/wasm/sandEngine.js (wasm embedded via SINGLE_FILE so Vite and
# Cloudflare need no special .wasm asset/MIME handling). The emitted file is
# committed so `npm run build` never needs emcc.
set -euo pipefail
cd "$(dirname "$0")/.."

# Fail fast if the generated material tables drift from materials.schema.json.
node scripts/generate-materials.mjs --check

OUT=src/sand/wasm/sandEngine.js

em++ \
  -O3 -std=c++20 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,node \
  -s SINGLE_FILE=1 \
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

node scripts/write-wasm-build-info.mjs "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
