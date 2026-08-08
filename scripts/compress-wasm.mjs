#!/usr/bin/env node

import { promisify } from 'node:util';
import {
  brotliCompress, brotliDecompress, constants,
} from 'node:zlib';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const root = resolve(process.argv[2] || 'dist');

const wasmFiles = [];
const directories = [root];
while (directories.length) {
  const directory = directories.pop();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) directories.push(path);
    else if (entry.isFile() && entry.name.endsWith('.wasm')) wasmFiles.push(path);
  }
}

if (!wasmFiles.length) throw new Error(`No WebAssembly files found in ${root}.`);

for (const path of wasmFiles.sort()) {
  const input = await readFile(path);
  const output = await compress(input, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: input.length,
    },
  });
  const restored = await decompress(output);
  if (!input.equals(restored)) throw new Error(`Brotli verification failed for ${path}.`);

  await writeFile(`${path}.br`, output);
  const percent = (output.length / input.length * 100).toFixed(1);
  console.log(`compressed ${relative(process.cwd(), path)}: ${input.length} -> ${output.length} bytes (${percent}%)`);
}
