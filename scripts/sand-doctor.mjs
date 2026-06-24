// Quick sand-engine health/provenance report for humans and future agents.
//
// This is intentionally read-only for repo files. It checks generated material
// freshness, reports the committed WASM bundle identity, runs a checksum-only
// benchmark into /tmp, and prints the next command to run.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const wasmPath = 'src/sand/wasm/sandEngine.js';
const baselinePath = 'bench/baseline.json';
const tmpJson = join(tmpdir(), `sand-doctor-${Date.now()}.json`);

const gitCommit = safeExec('git', ['rev-parse', '--short', 'HEAD']);
const gitDirty = spawnSync('git', ['diff', '--quiet']).status !== 0 || spawnSync('git', ['diff', '--cached', '--quiet']).status !== 0;
const emccPath = safeExec('which', ['emcc']);
const materialCheck = spawnSync(process.execPath, ['scripts/generate-materials.mjs', '--check'], { encoding: 'utf8' });
const bench = spawnSync(process.execPath, ['scripts/bench-sand.mjs', '--checksum-only', '--json', tmpJson], { encoding: 'utf8' });

let benchResult = null;
try { benchResult = JSON.parse(readFileSync(tmpJson, 'utf8')); } catch { /* benchmark failed before writing */ }
let baseline = null;
try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { /* missing baseline */ }

const wasmStat = statSync(wasmPath);
const checksumMatches = benchResult && baseline && benchResult.checksum === baseline.checksum;

console.log('\nsand doctor');
console.log(`  git: ${gitCommit || 'unknown'}${gitDirty ? ' dirty' : ' clean'}`);
console.log(`  emcc: ${emccPath || 'not found'}`);
console.log(`  materials: ${status(materialCheck.status === 0)}${materialCheck.status === 0 ? '' : ` (${(materialCheck.stderr || materialCheck.stdout).trim()})`}`);
console.log(`  wasm: ${wasmStat.size} bytes  fnv ${fmtHex(fileHash(wasmPath))}`);
if (benchResult) {
  console.log(`  current checksum: ${fmtHex(benchResult.checksum)}  stable: ${benchResult.checksumStable ? 'yes' : 'no'}`);
  console.log(`  baseline checksum: ${baseline ? fmtHex(baseline.checksum) : 'missing'}`);
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

process.exit(materialCheck.status === 0 && bench.status === 0 ? 0 : 1);
