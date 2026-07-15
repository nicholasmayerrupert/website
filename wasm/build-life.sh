#!/usr/bin/env bash
# Build the standalone Game of Life search engine as a self-contained ES module.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p src/life/wasm

em++ \
  -O3 -std=c++20 \
  -I src/life/cpp/third_party \
  -I src/life/cpp/third_party/minisat \
  src/life/cpp/life_search.cpp \
  src/life/cpp/third_party/minisat/core/Solver.cc \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createLifeSearchModule \
  -s ENVIRONMENT=web,worker,node \
  -s SINGLE_FILE=1 \
  -s FILESYSTEM=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8"]' \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_life_create","_life_destroy","_life_stop","_life_start_soup","_life_soup_pump","_life_soups_searched","_life_soup_result_count","_life_soup_result_lifetime","_life_soup_result_reason","_life_soup_result_cells","_life_start_reverse","_life_reverse_pump","_life_reverse_status","_life_reverse_current_depth","_life_reverse_best_length","_life_reverse_best_layer","_life_reverse_parents","_life_reverse_backtracks","_life_reverse_cycle_prunes","_life_reverse_goe_leaves","_life_reverse_depth_cuts","_life_reverse_conflicts","_life_reverse_node_conflicts","_life_reverse_node_budget","_life_reverse_deferrals","_life_reverse_deferred_count","_life_reverse_task_resumes","_life_step","_life_measure_lifetime"]' \
  --no-entry \
  -o src/life/wasm/lifeSearch.js

node scripts/life-wasm-build-info.mjs --write
echo "built src/life/wasm/lifeSearch.js ($(wc -c < src/life/wasm/lifeSearch.js) bytes)"
