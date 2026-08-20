#!/usr/bin/env node

// Build the committed Game of Life search engine ES module.

import { mkdirSync, statSync } from 'node:fs';
import { requireEmscripten, run } from './emscripten.mjs';

if (process.argv.length > 2) {
  console.error('Usage: npm run build:life');
  process.exit(2);
}

const toolchain = requireEmscripten();
const output = 'src/life/wasm/lifeSearch.js';
mkdirSync('src/life/wasm', { recursive: true });

run(toolchain.emxx, [
  '-O3', '-std=c++20',
  'src/life/cpp/life_search.cpp',
  '-s', 'MODULARIZE=1',
  '-s', 'EXPORT_ES6=1',
  '-s', 'EXPORT_NAME=createLifeSearchModule',
  '-s', 'ENVIRONMENT=web,worker,node',
  '-s', 'SINGLE_FILE=1',
  '-s', 'FILESYSTEM=0',
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', 'INITIAL_MEMORY=2097152',
  '-s', 'EXPORTED_RUNTIME_METHODS=["cwrap","HEAPU8","HEAPF64"]',
  '-s', 'EXPORTED_FUNCTIONS=["_malloc","_free","_life_create","_life_destroy","_life_stop","_life_start_soup","_life_soup_pump","_life_soups_searched","_life_soup_result_count","_life_soup_result_lifetime","_life_soup_result_transient","_life_soup_result_period","_life_soup_result_serial","_life_soup_result_reason","_life_soup_result_cells","_life_soup_loop_result_count","_life_soup_loop_result_lifetime","_life_soup_loop_result_transient","_life_soup_loop_result_period","_life_soup_loop_result_serial","_life_soup_loop_result_cells","_life_step","_life_measure_orbit"]',
  '--no-entry',
  '-o', output,
]);

run(process.execPath, ['scripts/life-wasm-build-info.mjs', '--write']);
console.log(`built ${output} (${statSync(output).size} bytes)`);
