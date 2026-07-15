import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'src/life/wasm/lifeSearch.js');
const roots = [resolve(root, 'src/life/cpp'), resolve(root, 'wasm/build-life.sh')];

async function collect(path, out = []) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    out.push(path);
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await collect(child, out);
    else out.push(child);
  }
  return out;
}

const files = [];
for (const path of roots) await collect(path, files);
const hash = createHash('sha256');
for (const path of files.sort()) {
  hash.update(relative(root, path));
  hash.update('\0');
  hash.update(await readFile(path));
  hash.update('\0');
}
const digest = hash.digest('hex');
const marker = `// LIFE_SOURCE_SHA256:${digest}`;

if (process.argv.includes('--write')) {
  const current = await readFile(output, 'utf8');
  await writeFile(output, `${current.replace(/\n?\/\/ LIFE_SOURCE_SHA256:[a-f0-9]+\s*$/, '')}\n${marker}\n`);
} else {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (!current.includes(marker)) {
    console.error('Life WASM is stale. Run: source wasm/emenv.sh && wasm/build-life.sh');
    process.exit(1);
  }
}
