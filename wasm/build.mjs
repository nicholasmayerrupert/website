#!/usr/bin/env node

// Build the committed sand-engine JavaScript/WASM bundle.

import { statSync } from 'node:fs';
import {
  normalizeTextFile, requireEmscripten, run,
} from './emscripten.mjs';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const unknownArgs = args.filter((arg) => arg !== '--dev');

if (unknownArgs.length) {
  console.error('Usage: npm run build:sand -- [--dev]');
  process.exit(2);
}

const toolchain = requireEmscripten();

if (dev)
  console.log('=== DEV BUILD (SAND_INVARIANT_CHECKS) - do NOT commit this artifact ===');

run(process.execPath, ['scripts/generate-materials.mjs', '--check']);
run(process.execPath, ['scripts/generate-reactions.mjs', '--check']);
run(process.execPath, ['scripts/generate-abi.mjs', '--check']);
run(process.execPath, ['scripts/generate-biomes.mjs', '--check']);
run(process.execPath, ['scripts/check-sand-contracts.mjs']);

const output = 'src/sand/wasm/sandEngine.js';
const compilerArgs = [
  '-O3', '-msimd128', '-std=c++20',
  '-Wall', '-Wextra', '-Wpedantic', '-Wshadow', '-Wnull-dereference', '-Werror',
  ...(dev ? ['-DSAND_INVARIANT_CHECKS'] : []),
  '-s', 'MODULARIZE=1',
  '-s', 'EXPORT_ES6=1',
  '-s', 'ENVIRONMENT=web,node',
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', 'INITIAL_MEMORY=100663296',
  '-s', 'EXPORT_NAME=createSandModule',
  '-s', 'MAX_WEBGL_VERSION=2',
  '-s', 'MIN_WEBGL_VERSION=2',
  '-s', 'FULL_ES3=1',
  '-lGL',
  '-s', 'EXPORTED_RUNTIME_METHODS=["cwrap","HEAPU8","HEAP32","HEAPF32","HEAPF64","GL","specialHTMLTargets"]',
  '-s', 'EXPORTED_FUNCTIONS=["_malloc","_free"]',
  '--no-entry',
  'src/sand/cpp/sand.cpp',
  '-o', output,
];
run(toolchain.emxx, compilerArgs);
normalizeTextFile(output);

const wasmOutput = output.replace(/\.js$/, '.wasm');
console.log(`built ${output} (${statSync(output).size} bytes) + ${wasmOutput} (${statSync(wasmOutput).size} bytes)`);

run(process.execPath, [
  'scripts/write-wasm-build-info.mjs', output, ...(dev ? ['--dev'] : []),
], {
  environment: {
    ...process.env,
    SAND_EMCC_PATH: toolchain.emcc,
    SAND_EMCC_VERSION: toolchain.versionLine,
  },
});
