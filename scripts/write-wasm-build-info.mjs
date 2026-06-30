// Write provenance for the generated single-file sand WASM module.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

const outPath = process.argv[2] || 'src/sand/wasm/sandEngine.js';
const infoPath = process.argv[3] || `${dirname(outPath)}/build-info.json`;
const generatedPaths = new Set([
  'src/sand/wasm/sandEngine.js',
  'src/sand/wasm/build-info.json',
]);
const sourcePathPrefixes = [
  'src/sand/cpp/',
  'src/sand/materials.schema.json',
  'src/sand/materials.generated.js',
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

const bytes = readFileSync(outPath);
const root = safeExec('git', ['rev-parse', '--show-toplevel']) || process.cwd();
const info = {
  generatedAt: new Date().toISOString(),
  output: {
    path: relative(root, outPath).split('\\').join('/'),
    bytes: statSync(outPath).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fnv1a: `0x${fnv1a(bytes).toString(16)}`,
  },
  source: {
    commit: safeExec('git', ['rev-parse', '--short', 'HEAD']),
    dirty: gitDirty(),
  },
  toolchain: {
    emcc: safeExec('emcc', ['--version'])?.split('\n')[0] || null,
    emccPath: safeExec('which', ['emcc']),
  },
};

writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
console.log(`wrote ${infoPath}`);
