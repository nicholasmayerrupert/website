// Locks foreground+background simulation checksums for pan-stream,
// liquid-active, and components-active. Intentional behavior changes update
// these values; pure refactors must leave them untouched.
// Run: node scripts/pure-perf-checksum-test.mjs  (also via npm test:pure-perf)

import { execFileSync } from 'node:child_process';

const EXPECTED = {
  'pan-stream': 0xb1117be5,
  'liquid-active': 0xd38c113e,
  'components-active': 0xf21737d6,
};

let out = '';
const stable = new Map();
for (const name of Object.keys(EXPECTED)) {
  const scenarioOut = execFileSync(process.execPath, [
    'scripts/bench-sand.mjs', '--scenario', name, '--checksum-only', '--repeat', '3',
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  stable.set(name, !scenarioOut.includes('UNSTABLE ACROSS REPEATS'));
  out += scenarioOut;
}
console.log(out);

let failures = 0;
for (const [name, want] of Object.entries(EXPECTED)) {
  const re = new RegExp(`sand engine benchmark:${name}[\\s\\S]*?checksum 0x([0-9a-f]+)`, 'i');
  const m = out.match(re);
  const got = m ? parseInt(m[1], 16) >>> 0 : null;
  const ok = got === (want >>> 0) && stable.get(name);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: got ${got === null ? 'missing' : '0x' + got.toString(16)} want 0x${(want >>> 0).toString(16)}${stable.get(name) ? '' : ' (unstable)'}`);
}
console.log(failures ? `\n${failures} pure-perf checksum(s) FAILED` : '\nall pure-perf checksums matched');
process.exit(failures ? 1 : 0);
