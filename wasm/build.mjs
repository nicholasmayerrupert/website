#!/usr/bin/env node

// Build the committed sand-engine JavaScript/WASM bundle.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  normalizeTextFile, requireEmscripten, run,
} from './emscripten.mjs';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const profile = args.includes('--profile');
let outputDirectory = null;
const unknownArgs = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--out-dir' && args[index + 1] && !args[index + 1].startsWith('--'))
    outputDirectory = args[++index];
  else if (arg !== '--dev' && arg !== '--profile') unknownArgs.push(arg);
}

if (unknownArgs.length || (dev && profile)) {
  console.error('Usage: npm run build:sand -- [--dev | --profile] [--out-dir DIR]');
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

const output = `${outputDirectory || (profile ? '.sand-artifacts/profile' : 'src/sand/wasm')}/sandEngine.js`;
if (profile && resolve(dirname(output)) === resolve('src/sand/wasm'))
  throw new Error('Profiling builds must use a separate output directory.');
mkdirSync(dirname(output), { recursive: true });
if (resolve(dirname(output)) !== resolve('src/sand/wasm'))
  writeFileSync(`${dirname(output)}/package.json`, '{"type":"module"}\n');
const compilerArgs = [
  '-O3', '-msimd128', '-std=c++20',
  '-Wall', '-Wextra', '-Wpedantic', '-Wshadow', '-Wnull-dereference', '-Werror',
  ...(dev ? ['-DSAND_INVARIANT_CHECKS'] : []),
  ...(profile ? ['--profiling-funcs'] : []),
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
run(toolchain.emxx, compilerArgs, { environment: toolchain.environment });
normalizeTextFile(output);

const wasmOutput = output.replace(/\.js$/, '.wasm');
console.log(`built ${output} (${statSync(output).size} bytes) + ${wasmOutput} (${statSync(wasmOutput).size} bytes)`);

run(process.execPath, [
  'scripts/write-wasm-build-info.mjs', output,
  ...(dev ? ['--dev'] : []), ...(profile ? ['--profile'] : []),
], {
  environment: {
    ...toolchain.environment,
    SAND_EMCC_PATH: toolchain.emcc,
    SAND_EMCC_VERSION: toolchain.versionLine,
  },
});
