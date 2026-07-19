#!/usr/bin/env bash
# Build the standalone Game of Life search engine as a self-contained ES module.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p src/life/wasm

em++ \
  -O3 -std=c++20 \
  src/life/cpp/life_search.cpp \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createLifeSearchModule \
  -s ENVIRONMENT=web,worker,node \
  -s SINGLE_FILE=1 \
  -s FILESYSTEM=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=8388608 \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8"]' \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_life_create","_life_destroy","_life_stop","_life_start_soup","_life_soup_pump","_life_soups_searched","_life_soup_result_count","_life_soup_result_lifetime","_life_soup_result_transient","_life_soup_result_period","_life_soup_result_serial","_life_soup_result_reason","_life_soup_result_cells","_life_soup_loop_result_count","_life_soup_loop_result_lifetime","_life_soup_loop_result_transient","_life_soup_loop_result_period","_life_soup_loop_result_serial","_life_soup_loop_result_cells","_life_step","_life_measure_lifetime","_life_measure_period","_life_measure_transient"]' \
  --no-entry \
  -o src/life/wasm/lifeSearch.js

node scripts/life-wasm-build-info.mjs --write
echo "built src/life/wasm/lifeSearch.js ($(wc -c < src/life/wasm/lifeSearch.js) bytes)"
