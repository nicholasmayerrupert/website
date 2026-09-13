import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { requireEmscripten, run, normalizeTextFile } from './emscripten.mjs';

const toolchain = requireEmscripten();
const vendor = 'src/sand3d/vendor/box3d';
const out = 'src/sand3d/wasm';
const cache = '.cache/sand3d';
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });
const files = readdirSync(`${vendor}/src`).filter(f => f.endsWith('.c')).sort().map(f => `${vendor}/src/${f}`);
const flags = ['-O3', '-DNDEBUG', '-D_GNU_SOURCE=1', '-msimd128', '-msse2', '-ffp-contract=off', `-I${vendor}/include`];
const hash = createHash('sha256').update(toolchain.versionLine).update(JSON.stringify(flags));
for (const dir of [`${vendor}/src`, `${vendor}/include/box3d`]) {
  for (const file of readdirSync(dir).sort()) hash.update(readFileSync(`${dir}/${file}`));
}
const digest = hash.digest('hex');
const object = `${cache}/box3d.o`;
if (!existsSync(object) || !existsSync(`${cache}/hash`) || readFileSync(`${cache}/hash`, 'utf8') !== digest) {
  console.log('Compiling pinned Box3D C17 sources...');
  run(toolchain.emcc, [...flags, '-std=c17', ...files, '-r', '-o', object], { environment: toolchain.environment });
  writeFileSync(`${cache}/hash`, digest);
}
run(toolchain.emxx, [
  ...flags, '-std=c++20', 'src/sand3d/cpp/demo.cpp', object,
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=createVoxelDemo',
  '-sENVIRONMENT=web,worker,node', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1',
  '-sINITIAL_MEMORY=402653184', '-sMAXIMUM_MEMORY=1073741824', '-sSTACK_SIZE=4194304',
  '-sMIN_WEBGL_VERSION=2', '-sMAX_WEBGL_VERSION=2',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8"]',
  '--no-entry', '-o', `${out}/voxelDemo.js`,
], { environment: toolchain.environment });
normalizeTextFile(`${out}/voxelDemo.js`);
run(process.execPath, ['scripts/3d-build-info.mjs', '--write']);
console.log('Built the isolated 3D demo WASM.');
