#!/usr/bin/env node

// Cross-platform build for the sand engine's committed JavaScript/WASM bundle.

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, realpathSync, statSync,
} from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmDir = resolve(root, 'wasm');
const dev = process.argv.slice(2).includes('--dev');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--dev');

if (unknownArgs.length) {
  console.error(`Usage: npm run build:sand -- [--dev]`);
  process.exit(2);
}

const env = { ...process.env };

function envValue(commandEnv, name) {
  const key = Object.keys(commandEnv).find((candidate) => candidate.toUpperCase() === name);
  return key ? commandEnv[key] : '';
}

function setEnvValue(commandEnv, name, value) {
  const key = Object.keys(commandEnv).find((candidate) => candidate.toUpperCase() === name) || name;
  commandEnv[key] = value;
}

function commandPath(name, commandEnv = env) {
  if (name.includes('/') || name.includes('\\'))
    return existsSync(name) ? resolve(name) : null;

  const extensions = process.platform === 'win32'
    ? [...new Set([
      ...(envValue(commandEnv, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';'), '.PY',
    ])]
    : [''];
  for (const directory of envValue(commandEnv, 'PATH').split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep looking along PATH.
      }
    }
  }
  return null;
}

function run(command, args, {
  capture = false, commandEnv = env, optional = false,
} = {}) {
  let executable = commandPath(command, commandEnv) || command;
  let executableArgs = args;
  let shell = false;
  const extension = extname(executable).toLowerCase();
  if (process.platform === 'win32' && ['.bat', '.cmd', '.py'].includes(extension)) {
    const pythonScript = extension === '.py'
      ? executable
      : `${executable.slice(0, -extension.length)}.py`;
    const python = commandPath('python', commandEnv) || commandPath('python3', commandEnv);
    if (python && existsSync(pythonScript)) {
      executable = python;
      executableArgs = [pythonScript, ...args];
    } else {
      shell = extension !== '.py';
    }
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    env: commandEnv,
    encoding: 'utf8',
    shell,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (optional && (result.error || result.status !== 0)) return null;
  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return capture ? result.stdout.trim() : '';
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function configureHomebrew(emccPath) {
  if (process.platform !== 'darwin') return;
  if (env.EMSDK || env.EM_CONFIG || env.EM_CACHE || env.EM_LLVM_ROOT
      || env.EM_BINARYEN_ROOT || env.LLVM_ROOT || env.BINARYEN_ROOT
      || existsSync(join(env.HOME || '', '.emscripten'))) return;

  const brewPath = commandPath('brew');
  if (!brewPath) return;
  const brewPrefix = run(brewPath, ['--prefix'], { capture: true, optional: true });
  const emscriptenPrefix = run(brewPath, ['--prefix', 'emscripten'], { capture: true, optional: true });
  if (!brewPrefix || !emscriptenPrefix) return;
  const brewEmcc = join(brewPrefix, 'bin', 'emcc');
  const formulaEmcc = join(emscriptenPrefix, 'bin', 'emcc');
  const llvmRoot = join(emscriptenPrefix, 'libexec', 'llvm', 'bin');
  const binaryenRoot = join(emscriptenPrefix, 'libexec', 'binaryen');

  if ((!samePath(emccPath, brewEmcc) && !samePath(emccPath, formulaEmcc))
      || !existsSync(join(llvmRoot, 'clang'))
      || !existsSync(join(binaryenRoot, 'bin', 'wasm-opt'))
      || existsSync(join(emscriptenPrefix, 'libexec', '.emscripten'))) return;

  setEnvValue(env, 'PATH', [
    join(brewPrefix, 'bin'), llvmRoot, join(binaryenRoot, 'bin'), envValue(env, 'PATH'),
  ].filter(Boolean).join(delimiter));
  env.EM_CONFIG = join(wasmDir, '.cache', 'emscripten', '.emscripten');
  env.EM_CACHE = join(wasmDir, '.cache', 'emscripten', 'cache');
  env.EM_LLVM_ROOT = llvmRoot;
  env.EM_BINARYEN_ROOT = binaryenRoot;
  mkdirSync(dirname(env.EM_CONFIG), { recursive: true });
  if (!existsSync(env.EM_CONFIG)) run(emccPath, ['--generate-config']);
}

let emccPath = commandPath('emcc');
let emxxPath = commandPath('em++');
if (!emccPath || !emxxPath) {
  console.error('Emscripten is not active. Follow the setup for your OS in wasm/README.md, then run this command again.');
  process.exit(1);
}

configureHomebrew(emccPath);
emccPath = commandPath('emcc');
emxxPath = commandPath('em++');

if (dev)
  console.log('=== DEV BUILD (SAND_INVARIANT_CHECKS) - do NOT commit this artifact ===');

run(process.execPath, ['scripts/generate-materials.mjs', '--check']);
run(process.execPath, ['scripts/generate-abi.mjs', '--check']);

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
run(emxxPath, compilerArgs);

const wasmOutput = output.replace(/\.js$/, '.wasm');
console.log(`built ${output} (${statSync(output).size} bytes) + ${wasmOutput} (${statSync(wasmOutput).size} bytes)`);

env.SAND_EMCC_PATH = emccPath;
env.SAND_EMCC_VERSION = run(emccPath, ['--version'], { capture: true }).split('\n')[0];
run(process.execPath, [
  'scripts/write-wasm-build-info.mjs', output, ...(dev ? ['--dev'] : []),
]);
