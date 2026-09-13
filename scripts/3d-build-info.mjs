import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const hash = createHash('sha256');
const walk = dir => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e =>
  e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
for (const file of [...walk('src/sand3d/cpp'), ...walk('src/sand3d/vendor'), 'wasm/build-3d.mjs', 'wasm/emscripten-version.txt']) {
  hash.update(file).update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
}
const info = {
  source: hash.digest('hex'),
  wasm: createHash('sha256').update(readFileSync('src/sand3d/wasm/voxelDemo.wasm')).digest('hex'),
  loader: createHash('sha256').update(readFileSync('src/sand3d/wasm/voxelDemo.js', 'utf8').replaceAll('\r\n', '\n')).digest('hex'),
  emscripten: readFileSync('wasm/emscripten-version.txt', 'utf8').trim(),
};
const path = 'src/sand3d/wasm/build-info.json';
if (process.argv.includes('--write')) writeFileSync(path, JSON.stringify(info, null, 2) + '\n');
else if (JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(info)) {
  throw new Error('3D WASM is stale. Run npm run build:3d.');
}
console.log('3D WASM provenance is current');
