// Static boundary check for the drop-in <sand-game> bundle.
//
// The embed entry may depend on the framework-free sand runtime, generated
// materials, net protocol/client helpers, and the wasm bridge. It must not pull
// in the site's React app, Tailwind/CSS entrypoints, or bare npm packages.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, normalize, relative, resolve } from 'node:path';

const root = process.cwd();
const entry = resolve(root, 'src/sand/embed/sandGame.js');
const srcRoot = resolve(root, 'src');

const forbiddenPathPatterns = [
  /(^|\/)src\/App\.(jsx?|tsx?)$/,
  /(^|\/)src\/main\.(jsx?|tsx?)$/,
  /(^|\/)src\/index\.css$/,
  /(^|\/)src\/components\//,
  /(^|\/)src\/pages\//,
  /(^|\/)src\/assets\//,
  /(^|\/)src\/styles\//,
];
const forbiddenBarePackages = [
  /^@vitejs\//,
  /^@gsap\//,
  /^@lottiefiles\//,
  /^react$/,
  /^react-/,
  /^react\//,
  /^react-dom$/,
  /^react-dom\//,
  /^tailwindcss$/,
  /^three$/,
  /^gsap$/,
  /^lottie-/,
];

const importPattern = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const failures = [];
const visited = new Set();

function rel(path) {
  return relative(root, path).split('\\').join('/');
}

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return { bare: spec };
  const base = spec.startsWith('/') ? resolve(root, spec.slice(1)) : resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    resolve(base, 'index.js'),
    resolve(base, 'index.mjs'),
  ];
  const found = candidates.find((path) => existsSync(path));
  return found ? { file: found } : { missing: base };
}

function checkFile(path) {
  const file = normalize(path);
  if (visited.has(file)) return;
  visited.add(file);

  const relFile = rel(file);
  if (!file.startsWith(srcRoot) && !file.includes('/src/sand/wasm/')) {
    failures.push(`${relFile}: outside src/ boundary`);
  }
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(relFile)) failures.push(`${relFile}: forbidden site dependency`);
  }

  const source = readFileSync(file, 'utf8');
  importPattern.lastIndex = 0;
  for (const match of source.matchAll(importPattern)) {
    const spec = match[1] || match[2];
    const resolved = resolveModule(file, spec);
    if (resolved.bare) {
      if (relFile === 'src/sand/wasm/sandEngine.js' && resolved.bare === 'node:module') {
        continue;
      }
      if (forbiddenBarePackages.some((pattern) => pattern.test(resolved.bare))) {
        failures.push(`${relFile}: forbidden package import "${resolved.bare}"`);
      } else {
        failures.push(`${relFile}: bare package import "${resolved.bare}"`);
      }
      continue;
    }
    if (resolved.missing) {
      failures.push(`${relFile}: unresolved import "${spec}"`);
      continue;
    }
    if (!isAbsolute(resolved.file)) {
      failures.push(`${relFile}: non-absolute resolver output for "${spec}"`);
      continue;
    }
    checkFile(resolved.file);
  }
}

checkFile(entry);

if (failures.length) {
  console.error('embed boundary check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`embed boundary ok: ${visited.size} modules from ${rel(entry)}`);
