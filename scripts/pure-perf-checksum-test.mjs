// Locks multi-scenario simulation checksums (pan-stream, liquid-active,
// components-active). Intentional behavior changes update these values; pure
// refactors must leave them untouched.
// Run: node scripts/pure-perf-checksum-test.mjs  (also via npm test:pure-perf)

import { execFileSync } from 'node:child_process';

const EXPECTED = {
  'pan-stream': 0xafe14479,
  'liquid-active': 0xf89039f1,
  'components-active': 0xd7f431ba,
};

let out = '';
for (const name of Object.keys(EXPECTED)) {
  out += execFileSync(process.execPath, ['scripts/bench-sand.mjs', '--scenario', name, '--checksum-only'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}
console.log(out);

let failures = 0;
for (const [name, want] of Object.entries(EXPECTED)) {
  const re = new RegExp(`sand engine benchmark:${name}[\\s\\S]*?checksum 0x([0-9a-f]+)`, 'i');
  const m = out.match(re);
  const got = m ? parseInt(m[1], 16) >>> 0 : null;
  const ok = got === (want >>> 0);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: got ${got === null ? 'missing' : '0x' + got.toString(16)} want 0x${(want >>> 0).toString(16)}`);
}
console.log(failures ? `\n${failures} pure-perf checksum(s) FAILED` : '\nall pure-perf checksums matched');
process.exit(failures ? 1 : 0);
