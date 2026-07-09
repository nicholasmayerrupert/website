// Locks multi-scenario pure-perf grid checksums (pan-stream, liquid-active,
// components-active). Fails if a "perf" change alters sim identity.
// Run: node scripts/pure-perf-checksum-test.mjs  (also via npm test:pure-perf)

import { execFileSync } from 'node:child_process';

const EXPECTED = {
  'pan-stream': 0x6e008c76,
  'liquid-active': 0x5c0e546d,
  'components-active': 0xc5f396f3,
};

const out = execFileSync(process.execPath, ['scripts/bench-sand.mjs', '--scenario', 'all', '--checksum-only'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
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
