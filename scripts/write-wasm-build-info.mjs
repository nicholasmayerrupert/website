// Write provenance for the generated sand loader and external WASM binary.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const allowDev = args.includes('--allow-dev');
const allowProfile = args.includes('--allow-profile');
const variant = args.includes('--dev') ? 'dev' : args.includes('--profile') ? 'profile' : 'production';
if ((allowDev || allowProfile) && !checkOnly) {
  console.error('--allow-dev and --allow-profile are valid only with --check');
  process.exit(2);
}
const positional = args.filter((arg) => !arg.startsWith('--'));
const outPath = positional[0] || 'src/sand/wasm/sandEngine.js';
const infoPath = positional[1] || `${dirname(outPath)}/build-info.json`;
const wasmPath = outPath.replace(/\.js$/, '.wasm');
const generatedPaths = new Set([
  'src/sand/wasm/sandEngine.js',
  'src/sand/wasm/sandEngine.wasm',
  'src/sand/wasm/build-info.json',
]);
const sourcePathPrefixes = [
  'src/sand/cpp/',
  'src/sand/materials.schema.json',
  'src/sand/materials.generated.js',
  'src/sand/reactions.schema.json',
  'src/sand/abi.schema.json',
  'src/sand/biomes.schema.json',
  'wasm/build.mjs',
  'wasm/emscripten.mjs',
  'wasm/emscripten-version.txt',
  'scripts/write-wasm-build-info.mjs',
  'scripts/generate-biomes.mjs',
  'scripts/generate-reactions.mjs',
];
const sourceRoots = [
  'src/sand/cpp',
  'src/sand/materials.schema.json',
  'src/sand/reactions.schema.json',
  'src/sand/abi.schema.json',
  'src/sand/biomes.schema.json',
  'wasm/build.mjs',
  'wasm/emscripten.mjs',
  'wasm/emscripten-version.txt',
  'scripts/write-wasm-build-info.mjs',
  'scripts/generate-biomes.mjs',
  'scripts/generate-reactions.mjs',
];

const safeExec = (cmd, argv = []) => {
  try { return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};
const gitDirty = () => {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' });
  if (status.status !== 0) return true;
  return status.stdout.split('\n').some((line) => {
    const path = line.slice(3).trim();
    return path && !generatedPaths.has(path) && sourcePathPrefixes.some((prefix) => path === prefix || path.startsWith(prefix));
  });
};
const fnv1a = (bytes) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

const root = safeExec('git', ['rev-parse', '--show-toplevel']) || process.cwd();
const collectFiles = (path, out = []) => {
  const absolute = resolve(root, path);
  const stat = statSync(absolute);
  if (!stat.isDirectory()) {
    out.push(absolute);
    return out;
  }
  for (const entry of readdirSync(absolute).sort())
    collectFiles(resolve(absolute, entry), out);
  return out;
};
const sourceHash = () => {
  const hash = createHash('sha256');
  const files = [];
  for (const path of sourceRoots) collectFiles(path, files);
  for (const path of files.sort()) {
    hash.update(relative(root, path).split('\\').join('/'));
    hash.update('\0');
    hash.update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
    hash.update('\0');
  }
  return hash.digest('hex');
};
const artifactInfo = (path) => {
  const bytes = readFileSync(path);
  return {
    path: relative(root, path).split('\\').join('/'),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fnv1a: `0x${fnv1a(bytes).toString(16)}`,
  };
};
const info = {
  generatedAt: new Date().toISOString(),
  output: artifactInfo(outPath),
  wasm: artifactInfo(wasmPath),
  source: {
    commit: safeExec('git', ['rev-parse', '--short', 'HEAD']),
    dirty: gitDirty(),
    sha256: sourceHash(),
  },
  variant,
  toolchain: {
    emcc: process.env.SAND_EMCC_VERSION
      || safeExec('emcc', ['--version'])?.split('\n')[0] || null,
    emccPath: process.env.SAND_EMCC_PATH
      || safeExec(process.platform === 'win32' ? 'where.exe' : 'which', ['emcc'])?.split('\n')[0] || null,
  },
};

if (checkOnly) {
  let recorded = null;
  try {
    recorded = JSON.parse(readFileSync(infoPath, 'utf8'));
  } catch {
    console.error(`Sand WASM provenance is missing: ${infoPath}`);
    process.exit(1);
  }
  const failures = [];
  if (recorded.variant !== 'production'
      && !(allowDev && recorded.variant === 'dev')
      && !(allowProfile && recorded.variant === 'profile'))
    failures.push(`build variant is ${recorded.variant || 'unknown'}, not production`);
  if (recorded.source?.sha256 !== info.source.sha256)
    failures.push('compiled source hash is stale');
  for (const key of ['output', 'wasm']) {
    if (recorded[key]?.bytes !== info[key].bytes
        || recorded[key]?.sha256 !== info[key].sha256)
      failures.push(`${key} artifact does not match build-info`);
  }
  if (failures.length) {
    console.error(`Sand WASM provenance failed: ${failures.join('; ')}.`);
    console.error('Run: npm run build:sand');
    process.exit(1);
  }
  console.log('sand WASM provenance is current');
  process.exit(0);
}

writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
console.log(`wrote ${infoPath}`);
