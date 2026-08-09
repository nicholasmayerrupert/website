// Sand-engine health and provenance report.
//
// This is intentionally read-only for repo files. It checks generated material
// freshness, reports the committed WASM bundle identity, runs a checksum-only
// benchmark into /tmp, and prints the next command to run.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandPath } from '../wasm/emscripten.mjs';

const safeExec = (cmd, argv = []) => {
  try { return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return e.stdout?.toString().trim() || e.stderr?.toString().trim() || null; }
};
const fileHash = (path) => {
  const bytes = readFileSync(path);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
const fmtHex = (n) => `0x${(n >>> 0).toString(16)}`;
const status = (ok) => ok ? 'ok' : 'FAIL';
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

const loaderPath = 'src/sand/wasm/sandEngine.js';
const wasmPath = 'src/sand/wasm/sandEngine.wasm';
const wasmInfoPath = 'src/sand/wasm/build-info.json';
const baselinePath = 'bench/baseline.json';
const tmpJson = join(tmpdir(), `sand-doctor-${Date.now()}.json`);

const gitCommit = safeExec('git', ['rev-parse', '--short', 'HEAD']);
const gitDirty = spawnSync('git', ['diff', '--quiet']).status !== 0 || spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
const emccPath = commandPath('emcc');
const materialCheck = spawnSync(process.execPath, ['scripts/generate-materials.mjs', '--check'], { encoding: 'utf8' });
const wasmCheck = spawnSync(process.execPath, ['scripts/write-wasm-build-info.mjs', '--check'], { encoding: 'utf8' });
const bench = spawnSync(process.execPath, [
  'scripts/bench-sand.mjs', '--checksum-only', '--repeat', '3', '--json', tmpJson,
], { encoding: 'utf8' });

let benchResult = null;
try { benchResult = JSON.parse(readFileSync(tmpJson, 'utf8')); } catch { /* benchmark failed before writing */ }
let baseline = null;
try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { /* missing baseline */ }

const loaderStat = statSync(loaderPath);
const wasmStat = statSync(wasmPath);
const wasmInfo = readJson(wasmInfoPath);
const checksumStable = benchResult?.checksumStable === true;
const checksumScopeMatches = benchResult && baseline
  && benchResult.config?.checksumScope === baseline.config?.checksumScope;
const checksumMatches = checksumStable && checksumScopeMatches
  && benchResult.checksum === baseline.checksum;

console.log('\nsand doctor');
console.log(`  git: ${gitCommit || 'unknown'}${gitDirty ? ' dirty' : ' clean'}`);
console.log(`  emcc: ${emccPath || 'not found'}`);
console.log(`  materials: ${status(materialCheck.status === 0)}${materialCheck.status === 0 ? '' : ` (${(materialCheck.stderr || materialCheck.stdout).trim()})`}`);
console.log(`  wasm loader: ${loaderStat.size} bytes  fnv ${fmtHex(fileHash(loaderPath))}`);
console.log(`  wasm binary: ${wasmStat.size} bytes  fnv ${fmtHex(fileHash(wasmPath))}`);
if (wasmInfo) {
  console.log(`  wasm build-info: ${wasmInfo.source?.commit || 'unknown'}${wasmInfo.source?.dirty ? ' dirty' : ' clean'}  ${wasmInfo.toolchain?.emcc || 'emcc unknown'}`);
  console.log(`  wasm provenance: ${status(wasmCheck.status === 0)}${wasmCheck.status === 0 ? '' : ` (${(wasmCheck.stderr || wasmCheck.stdout).trim()})`}`);
  if (wasmInfo.output?.bytes !== loaderStat.size) console.log(`  wasm loader build-info size: FAIL (${wasmInfo.output?.bytes} recorded)`);
  if (wasmInfo.wasm?.bytes !== wasmStat.size) console.log(`  wasm binary build-info size: FAIL (${wasmInfo.wasm?.bytes} recorded)`);
} else {
  console.log('  wasm build-info: missing (run npm run build:sand)');
}
if (benchResult) {
  console.log(`  current checksum: ${fmtHex(benchResult.checksum)}  stable: ${benchResult.checksumStable ? 'yes' : 'no'}`);
  console.log(`  baseline checksum: ${baseline ? fmtHex(baseline.checksum) : 'missing'}`);
  console.log(`  checksum scope: ${status(!!checksumScopeMatches)} (${benchResult.config?.checksumScope || 'missing'})`);
  console.log(`  checksum vs baseline: ${status(!!checksumMatches)}`);
} else {
  console.log(`  checksum benchmark: FAIL`);
  if (bench.stderr || bench.stdout) console.log(String(bench.stderr || bench.stdout).trim());
}

console.log('\nnext commands');
if (!checksumMatches) {
  console.log(`  node scripts/bench-sand.mjs --repeat 5 --compare ${baselinePath}`);
  console.log('  Inspect src/sand/PERF.md before updating any baseline.');
} else {
  console.log(`  node scripts/bench-sand.mjs --repeat 5 --compare ${baselinePath}`);
  console.log('  node scripts/bench-pan.mjs --compare bench/pan-baseline.json');
}

process.exit(materialCheck.status === 0 && wasmCheck.status === 0
  && bench.status === 0 && checksumMatches ? 0 : 1);
