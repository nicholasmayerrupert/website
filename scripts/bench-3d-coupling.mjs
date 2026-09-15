import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const e = await createModule({ wasmBinary: readFileSync('src/sand3d/wasm/voxelDemo.wasm') });
const put = (x, y, z, m) => e._demo_edit((x + .5) / 16, (y + .5) / 16, (z + .5) / 16, m);
const summary = a => {
  a.sort((a, b) => a - b);
  return { p50: a[Math.floor(a.length * .5)], p95: a[Math.floor(a.length * .95)], p99: a[Math.floor(a.length * .99)], max: a.at(-1) };
};
assert.equal(e._demo_create(0), 1);
try {
  const results = {};
  for (const size of [32, 64]) {
    e._demo_reset(); e._demo_pause(0);
    for (let z = 64; z < 64 + size; ++z) for (let x = 0; x < size; ++x) for (let y = -2; y < 48; ++y)
      put(x, y, z, y < 0 || x === 0 || x === size - 1 || z === 64 || z === 63 + size ? 2 : y < 24 ? 8 : 0);
    e._demo_step(1 / 60); e._demo_step(1 / 60);
    const water = e._demo_material_count(8);
    const body = e._demo_body_box((size / 2 - 8) / 16, 32 / 16, (64 + size / 2 - 8) / 16, 16, 16, 16, 4);
    e._demo_body_velocity(body, .2, -2, .1, .7, .3, .9);
    const times = [], phases = Array.from({ length: 5 }, () => []);
    for (let i = 0; i < 240; ++i) {
      const start = performance.now(); e._demo_step(1 / 60); times.push(performance.now() - start);
      const p = e._demo_coupling_ms() / 4;
      for (let k = 0; k < phases.length; ++k) phases[k].push(e.HEAPF32[p + k]);
    }
    assert.equal(e._demo_material_count(8), water, 'box impact conserves water');
    assert.equal(e._demo_loose_overlap(), 0, 'water stays outside the box');
    results[`pool${size}`] = { waterCells: (size - 2) ** 2 * 24, stepMs: summary(times), phases: Object.fromEntries(
      ['forces', 'raster', 'physics', 'displacement', 'wake'].map((name, i) => [name, summary(phases[i])])) };
  }
  console.log(JSON.stringify(results, null, 2));
  const flag = process.argv.indexOf('--json');
  if (flag >= 0) writeFileSync(process.argv[flag + 1], JSON.stringify(results, null, 2) + '\n');
} finally { e._demo_destroy(); }
